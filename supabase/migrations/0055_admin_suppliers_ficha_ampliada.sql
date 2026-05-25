-- ════════════════════════════════════════════════════════════════════
-- ADMIN MODULE — Suppliers Ficha Ampliada (S2.2)
-- ════════════════════════════════════════════════════════════════════
-- 1) 11 columnas nuevas en suppliers (todas nullable, sin DEFAULT).
-- 2) 2 CHECK constraints (condicion_fiscal, estado_arca).
-- 3) Modificar rpc_admin_create_supplier para aceptar campos nuevos.
-- 4) Modificar rpc_admin_update_supplier para:
--    - Rechazar cambio de CUIT (HINT='cuit_immutable').
--    - Aceptar los 11 campos nuevos.
-- 5) RPC nuevo rpc_admin_get_supplier_historial(uuid) → jsonb.
--
-- Audit log (S2.0) captura automaticamente los UPDATE/INSERT via
-- trigger trg_audit_log() — sin cambios al trigger.
-- ════════════════════════════════════════════════════════════════════

-- ── (1) ADD COLUMNs ─────────────────────────────────────────────────
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS condicion_fiscal         text,
  ADD COLUMN IF NOT EXISTS condicion_iva            text,
  ADD COLUMN IF NOT EXISTS estado_arca              text,
  ADD COLUMN IF NOT EXISTS razon_social_arca        text,
  ADD COLUMN IF NOT EXISTS ultima_validacion_arca   timestamptz,
  ADD COLUMN IF NOT EXISTS provincia                text,
  ADD COLUMN IF NOT EXISTS ciudad                   text,
  ADD COLUMN IF NOT EXISTS direccion                text,
  ADD COLUMN IF NOT EXISTS codigo_postal            text,
  ADD COLUMN IF NOT EXISTS rubro                    text,
  ADD COLUMN IF NOT EXISTS productos_habituales     text;

-- ── (2) CHECK constraints (con DROP IF EXISTS para idempotencia) ──
ALTER TABLE public.suppliers
  DROP CONSTRAINT IF EXISTS suppliers_condicion_fiscal_check;
ALTER TABLE public.suppliers
  ADD CONSTRAINT suppliers_condicion_fiscal_check
    CHECK (condicion_fiscal IS NULL OR
           condicion_fiscal IN ('RI','Monotributo','Consumidor','Exento'));

ALTER TABLE public.suppliers
  DROP CONSTRAINT IF EXISTS suppliers_estado_arca_check;
ALTER TABLE public.suppliers
  ADD CONSTRAINT suppliers_estado_arca_check
    CHECK (estado_arca IS NULL OR
           estado_arca IN ('activo','inactivo','dado_baja'));

-- ── (3) Reemplazar rpc_admin_create_supplier (acepta campos nuevos) ─
CREATE OR REPLACE FUNCTION public.rpc_admin_create_supplier(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_supplier_id uuid;
  v_credit_id uuid;
BEGIN
  SELECT role, active INTO v_role, v_active
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized';
  END IF;

  INSERT INTO public.suppliers (
    nombre, cuit, email, telefono, notas, created_by,
    condicion_fiscal, condicion_iva, estado_arca, razon_social_arca,
    ultima_validacion_arca,
    provincia, ciudad, direccion, codigo_postal,
    rubro, productos_habituales
  ) VALUES (
    NULLIF(trim(p_payload->>'nombre'), ''),
    NULLIF(trim(p_payload->>'cuit'), ''),
    NULLIF(trim(p_payload->>'email'), ''),
    NULLIF(trim(p_payload->>'telefono'), ''),
    NULLIF(trim(p_payload->>'notas'), ''),
    auth.uid(),
    NULLIF(trim(p_payload->>'condicion_fiscal'), ''),
    NULLIF(trim(p_payload->>'condicion_iva'), ''),
    NULLIF(trim(p_payload->>'estado_arca'), ''),
    NULLIF(trim(p_payload->>'razon_social_arca'), ''),
    NULLIF(p_payload->>'ultima_validacion_arca', '')::timestamptz,
    NULLIF(trim(p_payload->>'provincia'), ''),
    NULLIF(trim(p_payload->>'ciudad'), ''),
    NULLIF(trim(p_payload->>'direccion'), ''),
    NULLIF(trim(p_payload->>'codigo_postal'), ''),
    NULLIF(trim(p_payload->>'rubro'), ''),
    NULLIF(trim(p_payload->>'productos_habituales'), '')
  )
  RETURNING id INTO v_supplier_id;

  INSERT INTO public.suppliers_credit (supplier_id)
  VALUES (v_supplier_id)
  RETURNING id INTO v_credit_id;

  RETURN jsonb_build_object(
    'supplier_id', v_supplier_id,
    'supplier_credit_id', v_credit_id
  );
END;
$function$;

-- ── (4) Reemplazar rpc_admin_update_supplier ────────────────────────
--   - Rechaza cambio de CUIT (HINT='cuit_immutable').
--   - Acepta los 11 campos nuevos.
CREATE OR REPLACE FUNCTION public.rpc_admin_update_supplier(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_id uuid := NULLIF(p_payload->>'id','')::uuid;
  v_nombre text;
  v_cuit text;
  v_current_cuit text;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  IF v_id IS NULL THEN RAISE EXCEPTION 'id requerido' USING ERRCODE='22023'; END IF;
  v_nombre := NULLIF(trim(p_payload->>'nombre'),'');
  IF v_nombre IS NULL OR length(v_nombre) < 1 OR length(v_nombre) > 120 THEN
    RAISE EXCEPTION 'nombre requerido (1-120 caracteres)' USING ERRCODE='22023'; END IF;
  v_cuit := NULLIF(trim(p_payload->>'cuit'),'');
  IF v_cuit IS NOT NULL AND v_cuit !~ '^\d{2}-\d{8}-\d$' THEN
    RAISE EXCEPTION 'CUIT formato invalido (XX-XXXXXXXX-X)' USING ERRCODE='22023'; END IF;

  -- Lock + verificar existencia + leer cuit actual
  SELECT cuit INTO v_current_cuit
    FROM public.suppliers WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proveedor no existe' USING ERRCODE='22023';
  END IF;

  -- Rechazar cambio de CUIT (S2.2)
  IF v_cuit IS DISTINCT FROM v_current_cuit THEN
    RAISE EXCEPTION
      'El CUIT no se puede modificar. Para corregir, da de baja este proveedor y crea uno nuevo.'
      USING ERRCODE='42501', HINT='cuit_immutable';
  END IF;

  BEGIN
    UPDATE public.suppliers SET
      nombre   = v_nombre,
      email    = NULLIF(trim(p_payload->>'email'),''),
      telefono = NULLIF(trim(p_payload->>'telefono'),''),
      notas    = NULLIF(trim(p_payload->>'notas'),''),
      activo   = COALESCE((p_payload->>'activo')::boolean, activo),
      condicion_fiscal       = NULLIF(trim(p_payload->>'condicion_fiscal'),''),
      condicion_iva          = NULLIF(trim(p_payload->>'condicion_iva'),''),
      estado_arca            = NULLIF(trim(p_payload->>'estado_arca'),''),
      razon_social_arca      = NULLIF(trim(p_payload->>'razon_social_arca'),''),
      ultima_validacion_arca = NULLIF(p_payload->>'ultima_validacion_arca','')::timestamptz,
      provincia              = NULLIF(trim(p_payload->>'provincia'),''),
      ciudad                 = NULLIF(trim(p_payload->>'ciudad'),''),
      direccion              = NULLIF(trim(p_payload->>'direccion'),''),
      codigo_postal          = NULLIF(trim(p_payload->>'codigo_postal'),''),
      rubro                  = NULLIF(trim(p_payload->>'rubro'),''),
      productos_habituales   = NULLIF(trim(p_payload->>'productos_habituales'),'')
    WHERE id = v_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Ya existe otro proveedor con ese CUIT'
        USING ERRCODE='23505', HINT='duplicate_cuit';
  END;

  RETURN jsonb_build_object('supplier_id', v_id, 'updated', true);
END;
$function$;

-- ── (5) RPC nuevo rpc_admin_get_supplier_historial ──────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_get_supplier_historial(p_supplier_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_total_egresos int;
  v_suma_egresos numeric;
  v_ultimos_egresos jsonb;
  v_count_cheques int;
  v_cheques jsonb;
  v_saldo numeric;
  v_ultimos_movements jsonb;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  IF p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'supplier_id requerido' USING ERRCODE='22023';
  END IF;

  SELECT count(*), COALESCE(sum(monto_total), 0)
    INTO v_total_egresos, v_suma_egresos
    FROM public.expenses
    WHERE supplier_id = p_supplier_id;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_ultimos_egresos
  FROM (
    SELECT id, fecha, concepto, monto_total, moneda, categoria, medio_pago
    FROM public.expenses
    WHERE supplier_id = p_supplier_id
    ORDER BY fecha DESC, created_at DESC
    LIMIT 5
  ) t;

  SELECT count(*) INTO v_count_cheques
    FROM public.checks_issued
    WHERE beneficiario_supplier_id = p_supplier_id;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_cheques
  FROM (
    SELECT id, numero, banco, monto, estado, fecha_emision, fecha_cobro_estimada
    FROM public.checks_issued
    WHERE beneficiario_supplier_id = p_supplier_id
    ORDER BY fecha_emision DESC
    LIMIT 10
  ) t;

  SELECT COALESCE(sc.saldo, 0) INTO v_saldo
    FROM public.suppliers_credit sc
    WHERE sc.supplier_id = p_supplier_id;
  IF v_saldo IS NULL THEN v_saldo := 0; END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_ultimos_movements
  FROM (
    SELECT m.id, m.fecha, m.tipo, m.monto, m.concepto,
           (m.expense_id IS NOT NULL OR m.check_id IS NOT NULL) AS es_automatico
    FROM public.suppliers_credit_movements m
    JOIN public.suppliers_credit sc ON sc.id = m.supplier_credit_id
    WHERE sc.supplier_id = p_supplier_id
    ORDER BY m.fecha DESC, m.created_at DESC
    LIMIT 10
  ) t;

  RETURN jsonb_build_object(
    'total_egresos',      v_total_egresos,
    'suma_egresos',       v_suma_egresos,
    'ultimos_egresos',    v_ultimos_egresos,
    'count_cheques',      v_count_cheques,
    'cheques',            v_cheques,
    'saldo',              v_saldo,
    'ultimos_movements',  v_ultimos_movements
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_get_supplier_historial(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_get_supplier_historial(uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual):
--   DROP FUNCTION IF EXISTS public.rpc_admin_get_supplier_historial(uuid);
--   -- Restaurar rpc_admin_create_supplier desde 0048
--   -- Restaurar rpc_admin_update_supplier desde 0054
--   ALTER TABLE public.suppliers DROP CONSTRAINT IF EXISTS suppliers_estado_arca_check;
--   ALTER TABLE public.suppliers DROP CONSTRAINT IF EXISTS suppliers_condicion_fiscal_check;
--   ALTER TABLE public.suppliers
--     DROP COLUMN IF EXISTS productos_habituales,
--     DROP COLUMN IF EXISTS rubro,
--     DROP COLUMN IF EXISTS codigo_postal,
--     DROP COLUMN IF EXISTS direccion,
--     DROP COLUMN IF EXISTS ciudad,
--     DROP COLUMN IF EXISTS provincia,
--     DROP COLUMN IF EXISTS ultima_validacion_arca,
--     DROP COLUMN IF EXISTS razon_social_arca,
--     DROP COLUMN IF EXISTS estado_arca,
--     DROP COLUMN IF EXISTS condicion_iva,
--     DROP COLUMN IF EXISTS condicion_fiscal;
-- ════════════════════════════════════════════════════════════════════
