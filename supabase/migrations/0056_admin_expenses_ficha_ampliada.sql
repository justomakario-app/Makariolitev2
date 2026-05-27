-- ════════════════════════════════════════════════════════════════════
-- ADMIN MODULE — Expenses Ficha Ampliada (S2.3)
-- ════════════════════════════════════════════════════════════════════
-- Orden: ADD COLUMNs → DROP CHECK viejo → UPDATE categorias →
--        CREATE CHECK nuevo → CHECK nuevos → indexes → RPCs.
-- ════════════════════════════════════════════════════════════════════

-- ── (1) ADD COLUMNs ─────────────────────────────────────────────────
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS tipo_comprobante        text,
  ADD COLUMN IF NOT EXISTS clase_comprobante       text,
  ADD COLUMN IF NOT EXISTS condicion_comprobante   text,
  ADD COLUMN IF NOT EXISTS punto_venta             text,
  ADD COLUMN IF NOT EXISTS numero_comprobante      text,
  ADD COLUMN IF NOT EXISTS fecha_vencimiento       date,
  ADD COLUMN IF NOT EXISTS cae                     text,
  ADD COLUMN IF NOT EXISTS condicion_pago          text,
  ADD COLUMN IF NOT EXISTS concepto_libre          text,
  ADD COLUMN IF NOT EXISTS razon_social_proveedor  text,
  ADD COLUMN IF NOT EXISTS condicion_iva_proveedor text,
  ADD COLUMN IF NOT EXISTS subtotal_neto           numeric,
  ADD COLUMN IF NOT EXISTS iva_pct                 numeric,
  ADD COLUMN IF NOT EXISTS iva_monto               numeric,
  ADD COLUMN IF NOT EXISTS otros_tributos_desc     text,
  ADD COLUMN IF NOT EXISTS otros_tributos_pct      numeric,
  ADD COLUMN IF NOT EXISTS otros_tributos_monto    numeric,
  ADD COLUMN IF NOT EXISTS items                   jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS comprobante_url         text,
  ADD COLUMN IF NOT EXISTS comprobante_mime        text,
  ADD COLUMN IF NOT EXISTS comprobante_size_bytes  int;

-- ── (2) DROP CHECK categoria viejo PRIMERO (para permitir UPDATE) ──
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_categoria_check;

-- ── (3) Migrar categorias existentes (sin CHECK activo) ────────────
UPDATE public.expenses
   SET categoria = 'materiales_insumos'
 WHERE categoria = 'insumos';

-- ── (4) CREATE CHECK categoria nuevo con 11 valores ─────────────────
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_categoria_check
    CHECK (categoria IN (
      'materiales_insumos',
      'fletes',
      'logistica_flex',
      'correo_encomiendas',
      'gastos_fijos',
      'honorarios',
      'servicios',
      'intereses_financiacion',
      'sueldos',
      'impuestos',
      'otros'
    ));

-- ── (5) Nuevos CHECK constraints ────────────────────────────────────
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_tipo_comprobante_check;
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_tipo_comprobante_check
    CHECK (tipo_comprobante IS NULL OR
           tipo_comprobante IN ('factura','nota_credito','nota_debito','recibo','ticket'));

ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_clase_comprobante_check;
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_clase_comprobante_check
    CHECK (clase_comprobante IS NULL OR
           clase_comprobante IN ('A','B','C','M'));

ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_condicion_comprobante_check;
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_condicion_comprobante_check
    CHECK (condicion_comprobante IS NULL OR
           condicion_comprobante IN ('original','duplicado'));

ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_condicion_pago_check;
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_condicion_pago_check
    CHECK (condicion_pago IS NULL OR
           condicion_pago IN ('contado','cuenta_corriente','financiado','otro'));

-- ── (6) Indexes partial ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS expenses_tipo_comprobante_idx
  ON public.expenses (tipo_comprobante)
  WHERE tipo_comprobante IS NOT NULL;

CREATE INDEX IF NOT EXISTS expenses_fecha_vencimiento_idx
  ON public.expenses (fecha_vencimiento)
  WHERE fecha_vencimiento IS NOT NULL;

-- ── (7) Reemplazar rpc_admin_create_expense ─────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_create_expense(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_expense_id uuid;
  v_movement_id uuid := NULL;
  v_credit_id uuid;
  v_new_saldo numeric;
  v_supplier_id uuid := NULLIF(p_payload->>'supplier_id', '')::uuid;
  v_medio_pago text := p_payload->>'medio_pago';
  v_monto numeric := (p_payload->>'monto_total')::numeric;
  v_concepto text := p_payload->>'concepto';
  v_tipo_comprobante text := NULLIF(trim(p_payload->>'tipo_comprobante'), '');
  v_signo int;
  v_generate_movement boolean;
  v_explicit jsonb;
  v_items jsonb := COALESCE(p_payload->'items', '[]'::jsonb);
BEGIN
  SELECT role, active INTO v_role, v_active
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized';
  END IF;

  IF jsonb_typeof(v_items) <> 'array' THEN
    RAISE EXCEPTION 'items debe ser un array jsonb' USING ERRCODE='22023', HINT='items_invalid';
  END IF;

  v_signo := CASE
    WHEN v_tipo_comprobante = 'nota_credito' THEN -1
    ELSE 1
  END;

  v_explicit := p_payload->'generate_supplier_movement';
  IF v_explicit IS NOT NULL AND v_explicit::text <> 'null' THEN
    v_generate_movement := (p_payload->>'generate_supplier_movement')::boolean;
  ELSE
    v_generate_movement := CASE v_medio_pago
      WHEN 'efectivo' THEN false
      WHEN 'transferencia' THEN false
      ELSE true
    END;
  END IF;

  INSERT INTO public.expenses (
    fecha, supplier_id, concepto, monto_total, moneda, iva_discriminado,
    categoria, medio_pago, comprobante_url, ocr_raw_json, confirmed_by_human,
    notas, created_by,
    tipo_comprobante, clase_comprobante, condicion_comprobante,
    punto_venta, numero_comprobante, fecha_vencimiento, cae,
    condicion_pago, concepto_libre,
    razon_social_proveedor, condicion_iva_proveedor,
    subtotal_neto, iva_pct, iva_monto,
    otros_tributos_desc, otros_tributos_pct, otros_tributos_monto,
    items, comprobante_mime, comprobante_size_bytes
  ) VALUES (
    COALESCE((p_payload->>'fecha')::date, current_date),
    v_supplier_id,
    v_concepto,
    v_monto,
    COALESCE(p_payload->>'moneda', 'ARS'),
    NULLIF(p_payload->>'iva_discriminado', '')::numeric,
    p_payload->>'categoria',
    v_medio_pago,
    NULLIF(trim(p_payload->>'comprobante_url'), ''),
    p_payload->'ocr_raw_json',
    COALESCE((p_payload->>'confirmed_by_human')::boolean, false),
    NULLIF(trim(p_payload->>'notas'), ''),
    auth.uid(),
    v_tipo_comprobante,
    NULLIF(trim(p_payload->>'clase_comprobante'), ''),
    NULLIF(trim(p_payload->>'condicion_comprobante'), ''),
    NULLIF(trim(p_payload->>'punto_venta'), ''),
    NULLIF(trim(p_payload->>'numero_comprobante'), ''),
    NULLIF(p_payload->>'fecha_vencimiento', '')::date,
    NULLIF(trim(p_payload->>'cae'), ''),
    NULLIF(trim(p_payload->>'condicion_pago'), ''),
    NULLIF(trim(p_payload->>'concepto_libre'), ''),
    NULLIF(trim(p_payload->>'razon_social_proveedor'), ''),
    NULLIF(trim(p_payload->>'condicion_iva_proveedor'), ''),
    NULLIF(p_payload->>'subtotal_neto', '')::numeric,
    NULLIF(p_payload->>'iva_pct', '')::numeric,
    NULLIF(p_payload->>'iva_monto', '')::numeric,
    NULLIF(trim(p_payload->>'otros_tributos_desc'), ''),
    NULLIF(p_payload->>'otros_tributos_pct', '')::numeric,
    NULLIF(p_payload->>'otros_tributos_monto', '')::numeric,
    v_items,
    NULLIF(trim(p_payload->>'comprobante_mime'), ''),
    NULLIF(p_payload->>'comprobante_size_bytes', '')::int
  ) RETURNING id INTO v_expense_id;

  IF v_generate_movement AND v_supplier_id IS NOT NULL THEN
    SELECT id INTO v_credit_id FROM public.suppliers_credit
      WHERE supplier_id = v_supplier_id FOR UPDATE;
    IF v_credit_id IS NULL THEN
      INSERT INTO public.suppliers_credit (supplier_id)
      VALUES (v_supplier_id)
      RETURNING id INTO v_credit_id;
    END IF;

    INSERT INTO public.suppliers_credit_movements (
      supplier_credit_id, fecha, tipo, monto, concepto, expense_id, created_by
    ) VALUES (
      v_credit_id,
      COALESCE((p_payload->>'fecha')::date, current_date),
      CASE WHEN v_tipo_comprobante = 'nota_credito' THEN 'ajuste' ELSE 'compra' END,
      v_monto * v_signo,
      v_concepto,
      v_expense_id,
      auth.uid()
    ) RETURNING id INTO v_movement_id;

    UPDATE public.suppliers_credit
      SET saldo = saldo + (v_monto * v_signo)
      WHERE id = v_credit_id
      RETURNING saldo INTO v_new_saldo;
  END IF;

  RETURN jsonb_build_object(
    'expense_id', v_expense_id,
    'supplier_movement_id', v_movement_id,
    'nuevo_saldo_proveedor', v_new_saldo,
    'generate_supplier_movement_used', v_generate_movement,
    'movement_signo', v_signo
  );
END;
$function$;

-- ── (8) Reemplazar rpc_admin_update_expense (patron MERGE) ──────────
--   NOTA: el caso edge "UPDATE cambia tipo_comprobante de/a nota_credito"
--   NO recalcula el movement asociado. El RPC emite RAISE WARNING.
--   Workaround para Noe: borrar y recrear el egreso (delete cascadea
--   el movement vía S2.1). Recalculo automatico difered a sprint
--   hardening de cuentas corrientes.
CREATE OR REPLACE FUNCTION public.rpc_admin_update_expense(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum; v_active boolean;
  v_id uuid := NULLIF(p_payload->>'id','')::uuid;
  v_concepto text;
  v_monto numeric;
  v_categoria text;
  v_medio_pago text;
  v_moneda text;
  v_items jsonb;
  v_new_tipo text;
  v_old_tipo text;
  v_old_monto numeric;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'id requerido' USING ERRCODE='22023'; END IF;

  IF p_payload ? 'concepto' THEN
    v_concepto := p_payload->>'concepto';
    IF v_concepto IS NULL OR length(trim(v_concepto)) < 1 OR length(v_concepto) > 500 THEN
      RAISE EXCEPTION 'concepto requerido (1-500 caracteres)' USING ERRCODE='22023'; END IF;
  END IF;

  IF p_payload ? 'monto_total' THEN
    v_monto := (p_payload->>'monto_total')::numeric;
    IF v_monto IS NULL OR v_monto <= 0 THEN
      RAISE EXCEPTION 'monto debe ser positivo' USING ERRCODE='22023'; END IF;
  END IF;

  IF p_payload ? 'categoria' THEN
    v_categoria := p_payload->>'categoria';
    IF v_categoria NOT IN (
      'materiales_insumos','fletes','logistica_flex','correo_encomiendas',
      'gastos_fijos','honorarios','servicios','intereses_financiacion',
      'sueldos','impuestos','otros'
    ) THEN
      RAISE EXCEPTION 'categoria invalida' USING ERRCODE='22023'; END IF;
  END IF;

  IF p_payload ? 'medio_pago' THEN
    v_medio_pago := p_payload->>'medio_pago';
    IF v_medio_pago NOT IN ('efectivo','transferencia','cheque','tarjeta','otro') THEN
      RAISE EXCEPTION 'medio_pago invalido' USING ERRCODE='22023'; END IF;
  END IF;

  IF p_payload ? 'moneda' THEN
    v_moneda := p_payload->>'moneda';
    IF v_moneda NOT IN ('ARS','USD') THEN
      RAISE EXCEPTION 'moneda invalida' USING ERRCODE='22023'; END IF;
  END IF;

  IF p_payload ? 'items' THEN
    v_items := p_payload->'items';
    IF jsonb_typeof(v_items) <> 'array' THEN
      RAISE EXCEPTION 'items debe ser un array jsonb' USING ERRCODE='22023', HINT='items_invalid';
    END IF;
  END IF;

  SELECT tipo_comprobante, monto_total INTO v_old_tipo, v_old_monto
    FROM public.expenses WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Egreso no existe' USING ERRCODE='22023'; END IF;

  IF p_payload ? 'tipo_comprobante' THEN
    v_new_tipo := NULLIF(trim(p_payload->>'tipo_comprobante'), '');
    IF (v_old_tipo = 'nota_credito') <> (v_new_tipo = 'nota_credito') THEN
      RAISE WARNING 'Cambio de tipo_comprobante implica cambio de signo en movement asociado. El movement NO se recalcula automaticamente. Workaround: borrar y recrear el egreso.'
        USING HINT='movement_sign_change_not_recalculated';
    END IF;
  END IF;

  UPDATE public.expenses SET
    fecha = CASE WHEN p_payload ? 'fecha'
                 THEN COALESCE((p_payload->>'fecha')::date, fecha)
                 ELSE fecha END,
    supplier_id = CASE WHEN p_payload ? 'supplier_id'
                       THEN NULLIF(p_payload->>'supplier_id','')::uuid
                       ELSE supplier_id END,
    concepto = CASE WHEN p_payload ? 'concepto'
                    THEN trim(v_concepto)
                    ELSE concepto END,
    monto_total = CASE WHEN p_payload ? 'monto_total'
                       THEN v_monto
                       ELSE monto_total END,
    moneda = CASE WHEN p_payload ? 'moneda'
                  THEN v_moneda
                  ELSE moneda END,
    iva_discriminado = CASE WHEN p_payload ? 'iva_discriminado'
                            THEN NULLIF(p_payload->>'iva_discriminado','')::numeric
                            ELSE iva_discriminado END,
    categoria = CASE WHEN p_payload ? 'categoria'
                     THEN v_categoria
                     ELSE categoria END,
    medio_pago = CASE WHEN p_payload ? 'medio_pago'
                      THEN v_medio_pago
                      ELSE medio_pago END,
    notas = CASE WHEN p_payload ? 'notas'
                 THEN NULLIF(trim(p_payload->>'notas'),'')
                 ELSE notas END,
    activo = CASE WHEN p_payload ? 'activo'
                  THEN COALESCE((p_payload->>'activo')::boolean, activo)
                  ELSE activo END,
    tipo_comprobante = CASE WHEN p_payload ? 'tipo_comprobante'
                            THEN NULLIF(trim(p_payload->>'tipo_comprobante'),'')
                            ELSE tipo_comprobante END,
    clase_comprobante = CASE WHEN p_payload ? 'clase_comprobante'
                             THEN NULLIF(trim(p_payload->>'clase_comprobante'),'')
                             ELSE clase_comprobante END,
    condicion_comprobante = CASE WHEN p_payload ? 'condicion_comprobante'
                                 THEN NULLIF(trim(p_payload->>'condicion_comprobante'),'')
                                 ELSE condicion_comprobante END,
    punto_venta = CASE WHEN p_payload ? 'punto_venta'
                       THEN NULLIF(trim(p_payload->>'punto_venta'),'')
                       ELSE punto_venta END,
    numero_comprobante = CASE WHEN p_payload ? 'numero_comprobante'
                              THEN NULLIF(trim(p_payload->>'numero_comprobante'),'')
                              ELSE numero_comprobante END,
    fecha_vencimiento = CASE WHEN p_payload ? 'fecha_vencimiento'
                             THEN NULLIF(p_payload->>'fecha_vencimiento','')::date
                             ELSE fecha_vencimiento END,
    cae = CASE WHEN p_payload ? 'cae'
               THEN NULLIF(trim(p_payload->>'cae'),'')
               ELSE cae END,
    condicion_pago = CASE WHEN p_payload ? 'condicion_pago'
                          THEN NULLIF(trim(p_payload->>'condicion_pago'),'')
                          ELSE condicion_pago END,
    concepto_libre = CASE WHEN p_payload ? 'concepto_libre'
                          THEN NULLIF(trim(p_payload->>'concepto_libre'),'')
                          ELSE concepto_libre END,
    razon_social_proveedor = CASE WHEN p_payload ? 'razon_social_proveedor'
                                  THEN NULLIF(trim(p_payload->>'razon_social_proveedor'),'')
                                  ELSE razon_social_proveedor END,
    condicion_iva_proveedor = CASE WHEN p_payload ? 'condicion_iva_proveedor'
                                   THEN NULLIF(trim(p_payload->>'condicion_iva_proveedor'),'')
                                   ELSE condicion_iva_proveedor END,
    subtotal_neto = CASE WHEN p_payload ? 'subtotal_neto'
                         THEN NULLIF(p_payload->>'subtotal_neto','')::numeric
                         ELSE subtotal_neto END,
    iva_pct = CASE WHEN p_payload ? 'iva_pct'
                   THEN NULLIF(p_payload->>'iva_pct','')::numeric
                   ELSE iva_pct END,
    iva_monto = CASE WHEN p_payload ? 'iva_monto'
                     THEN NULLIF(p_payload->>'iva_monto','')::numeric
                     ELSE iva_monto END,
    otros_tributos_desc = CASE WHEN p_payload ? 'otros_tributos_desc'
                               THEN NULLIF(trim(p_payload->>'otros_tributos_desc'),'')
                               ELSE otros_tributos_desc END,
    otros_tributos_pct = CASE WHEN p_payload ? 'otros_tributos_pct'
                              THEN NULLIF(p_payload->>'otros_tributos_pct','')::numeric
                              ELSE otros_tributos_pct END,
    otros_tributos_monto = CASE WHEN p_payload ? 'otros_tributos_monto'
                                THEN NULLIF(p_payload->>'otros_tributos_monto','')::numeric
                                ELSE otros_tributos_monto END,
    items = CASE WHEN p_payload ? 'items'
                 THEN v_items
                 ELSE items END,
    comprobante_url = CASE WHEN p_payload ? 'comprobante_url'
                           THEN NULLIF(trim(p_payload->>'comprobante_url'),'')
                           ELSE comprobante_url END,
    comprobante_mime = CASE WHEN p_payload ? 'comprobante_mime'
                            THEN NULLIF(trim(p_payload->>'comprobante_mime'),'')
                            ELSE comprobante_mime END,
    comprobante_size_bytes = CASE WHEN p_payload ? 'comprobante_size_bytes'
                                  THEN NULLIF(p_payload->>'comprobante_size_bytes','')::int
                                  ELSE comprobante_size_bytes END
  WHERE id = v_id;

  RETURN jsonb_build_object('expense_id', v_id, 'updated', true);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_create_expense(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_create_expense(jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_update_expense(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_update_expense(jsonb) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual):
--   ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_condicion_pago_check;
--   ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_condicion_comprobante_check;
--   ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_clase_comprobante_check;
--   ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_tipo_comprobante_check;
--   DROP INDEX IF EXISTS public.expenses_fecha_vencimiento_idx;
--   DROP INDEX IF EXISTS public.expenses_tipo_comprobante_idx;
--   ALTER TABLE public.expenses DROP CONSTRAINT expenses_categoria_check;
--   UPDATE public.expenses SET categoria='insumos' WHERE categoria='materiales_insumos';
--   ALTER TABLE public.expenses ADD CONSTRAINT expenses_categoria_check
--     CHECK (categoria IN ('insumos','servicios','sueldos','impuestos','otros'));
--   ALTER TABLE public.expenses
--     DROP COLUMN IF EXISTS comprobante_size_bytes,
--     DROP COLUMN IF EXISTS comprobante_mime,
--     DROP COLUMN IF EXISTS items,
--     DROP COLUMN IF EXISTS otros_tributos_monto,
--     DROP COLUMN IF EXISTS otros_tributos_pct,
--     DROP COLUMN IF EXISTS otros_tributos_desc,
--     DROP COLUMN IF EXISTS iva_monto,
--     DROP COLUMN IF EXISTS iva_pct,
--     DROP COLUMN IF EXISTS subtotal_neto,
--     DROP COLUMN IF EXISTS condicion_iva_proveedor,
--     DROP COLUMN IF EXISTS razon_social_proveedor,
--     DROP COLUMN IF EXISTS concepto_libre,
--     DROP COLUMN IF EXISTS condicion_pago,
--     DROP COLUMN IF EXISTS cae,
--     DROP COLUMN IF EXISTS fecha_vencimiento,
--     DROP COLUMN IF EXISTS numero_comprobante,
--     DROP COLUMN IF EXISTS punto_venta,
--     DROP COLUMN IF EXISTS condicion_comprobante,
--     DROP COLUMN IF EXISTS clase_comprobante,
--     DROP COLUMN IF EXISTS tipo_comprobante;
--   -- NO dropear comprobante_url (pre-existente B.3).
--   -- Restaurar rpc_admin_create_expense desde 0046 (B.3).
--   -- Restaurar rpc_admin_update_expense desde 0054 (S2.1).
-- ════════════════════════════════════════════════════════════════════
