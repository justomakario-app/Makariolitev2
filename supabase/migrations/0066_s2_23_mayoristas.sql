-- ════════════════════════════════════════════════════════════════════
-- S2.23 — Módulo Mayoristas
-- ════════════════════════════════════════════════════════════════════
-- 3 áreas conectadas: Ventas (gestión) → Producción (vista fabricación)
-- → Stock (descuento al entregar — DIFERIDO a S2.23b, ver nota abajo).
--
-- Crea: columnas mayorista en customers_b2b, enum de estados, tablas
-- pedidos_mayoristas (+ items), secuencia de numeración (MAY-0001),
-- triggers (updated_at + audit), RLS, 4 RPCs de mayoristas y EXTIENDE
-- los 2 RPCs de alta/edición de clientes B2B para persistir los campos
-- nuevos.
--
-- ── Divergencias respecto al brief (validadas con Jefe) ────────────────
--  1. El trigger de updated_at usa public.set_updated_at() (la función
--     real del repo, migration 0001). El brief usaba fn_set_updated_at()
--     que NO existe.
--  2. RLS de ESCRITURA (INSERT/UPDATE/DELETE) restringida a OWNER (no
--     owner+admin del brief). Motivo: los RPCs create/update_estado son
--     owner-only; sin esto un admin podría crear/editar pedidos por
--     PostgREST directo. SELECT queda owner+admin (los admins consultan).
--     Mismo criterio que S2.22.
--  3. EXTENSIÓN de rpc_admin_create_customer_b2b / rpc_admin_update_
--     customer_b2b: el brief solo agregaba columnas pero esos RPCs
--     (SECURITY DEFINER) listan columnas explícitas → sin extenderlos el
--     toggle "Es mayorista" + localidad/provincia no se guardaban.
--  4. DESCUENTO DE STOCK al entregar: sku_catalog NO tiene columna de
--     stock_actual. rpc_mayoristas_update_estado SOLO cambia el estado.
--     El descuento queda como S2.23b (sprint aparte).
-- ════════════════════════════════════════════════════════════════════

-- ── (1A) Extender customers_b2b ──────────────────────────────────────
ALTER TABLE public.customers_b2b
  ADD COLUMN IF NOT EXISTS es_mayorista boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS localidad text,
  ADD COLUMN IF NOT EXISTS provincia text;

-- ── (1B) Enum de estados de pedido ───────────────────────────────────
DO $$ BEGIN
  CREATE TYPE pedido_mayorista_estado AS ENUM (
    'cotizacion','confirmado','en_produccion','listo','entregado','cancelado'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── (1C) Tabla pedidos_mayoristas ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pedidos_mayoristas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  numero_pedido text UNIQUE NOT NULL,
  cliente_id uuid NOT NULL REFERENCES public.customers_b2b(id) ON DELETE RESTRICT,
  fecha_pedido date NOT NULL DEFAULT CURRENT_DATE,
  fecha_entrega_estimada date,
  estado pedido_mayorista_estado NOT NULL DEFAULT 'cotizacion',
  condicion_pago text,
  notas text,
  activo boolean DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pedidos_mayoristas_cliente_idx
  ON public.pedidos_mayoristas(cliente_id);
CREATE INDEX IF NOT EXISTS pedidos_mayoristas_estado_idx
  ON public.pedidos_mayoristas(estado);

-- ── (1D) Tabla pedidos_mayoristas_items ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.pedidos_mayoristas_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  pedido_id uuid NOT NULL REFERENCES public.pedidos_mayoristas(id) ON DELETE CASCADE,
  sku text NOT NULL REFERENCES public.sku_catalog(sku) ON DELETE RESTRICT,
  cantidad integer NOT NULL CHECK (cantidad > 0),
  precio_unitario numeric(12,2) NOT NULL CHECK (precio_unitario >= 0),
  notas_item text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pedidos_mayoristas_items_pedido_idx
  ON public.pedidos_mayoristas_items(pedido_id);

-- ── (1E) Secuencia + fn de numeración (MAY-0001, MAY-0002...) ─────────
CREATE SEQUENCE IF NOT EXISTS pedidos_mayoristas_seq START 1;

CREATE OR REPLACE FUNCTION public.fn_next_numero_pedido_mayorista()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN 'MAY-' || LPAD(nextval('pedidos_mayoristas_seq')::text, 4, '0');
END $$;

-- Interna: solo la invoca rpc_mayoristas_create_pedido (SECURITY DEFINER).
-- Sin grant a clientes para que nadie queme valores de la secuencia.
REVOKE EXECUTE ON FUNCTION public.fn_next_numero_pedido_mayorista() FROM anon, public;

-- ── (1F) Trigger updated_at ──────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_pedidos_mayoristas_updated_at ON public.pedidos_mayoristas;
CREATE TRIGGER trg_pedidos_mayoristas_updated_at
  BEFORE UPDATE ON public.pedidos_mayoristas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── (1G) Audit triggers (función genérica trg_audit_log de 0053) ─────
DROP TRIGGER IF EXISTS trg_audit_pedidos_mayoristas ON public.pedidos_mayoristas;
CREATE TRIGGER trg_audit_pedidos_mayoristas
  AFTER INSERT OR UPDATE OR DELETE ON public.pedidos_mayoristas
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit_log();

DROP TRIGGER IF EXISTS trg_audit_pedidos_mayoristas_items ON public.pedidos_mayoristas_items;
CREATE TRIGGER trg_audit_pedidos_mayoristas_items
  AFTER INSERT OR UPDATE OR DELETE ON public.pedidos_mayoristas_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit_log();

-- ── (1H) RLS ─────────────────────────────────────────────────────────
ALTER TABLE public.pedidos_mayoristas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos_mayoristas_items ENABLE ROW LEVEL SECURITY;

-- SELECT: owner + admin (los admins consultan mayoristas/pedidos).
-- INSERT/UPDATE/DELETE: SOLO owner (ver decisión técnica #2).
DROP POLICY IF EXISTS "pm_select" ON public.pedidos_mayoristas;
CREATE POLICY "pm_select" ON public.pedidos_mayoristas FOR SELECT TO authenticated
  USING (public.is_owner_or_admin());
DROP POLICY IF EXISTS "pm_insert" ON public.pedidos_mayoristas;
CREATE POLICY "pm_insert" ON public.pedidos_mayoristas FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() = 'owner');
DROP POLICY IF EXISTS "pm_update" ON public.pedidos_mayoristas;
CREATE POLICY "pm_update" ON public.pedidos_mayoristas FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'owner')
  WITH CHECK (public.current_user_role() = 'owner');
DROP POLICY IF EXISTS "pm_delete" ON public.pedidos_mayoristas;
CREATE POLICY "pm_delete" ON public.pedidos_mayoristas FOR DELETE TO authenticated
  USING (public.current_user_role() = 'owner');

DROP POLICY IF EXISTS "pmi_select" ON public.pedidos_mayoristas_items;
CREATE POLICY "pmi_select" ON public.pedidos_mayoristas_items FOR SELECT TO authenticated
  USING (public.is_owner_or_admin());
DROP POLICY IF EXISTS "pmi_insert" ON public.pedidos_mayoristas_items;
CREATE POLICY "pmi_insert" ON public.pedidos_mayoristas_items FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() = 'owner');
DROP POLICY IF EXISTS "pmi_update" ON public.pedidos_mayoristas_items;
CREATE POLICY "pmi_update" ON public.pedidos_mayoristas_items FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'owner')
  WITH CHECK (public.current_user_role() = 'owner');
DROP POLICY IF EXISTS "pmi_delete" ON public.pedidos_mayoristas_items;
CREATE POLICY "pmi_delete" ON public.pedidos_mayoristas_items FOR DELETE TO authenticated
  USING (public.current_user_role() = 'owner');

-- ── (1I) RPCs mayoristas ─────────────────────────────────────────────

-- Listar mayoristas (owner+admin)
CREATE OR REPLACE FUNCTION public.rpc_mayoristas_list(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role role_enum; v_active boolean;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;
  RETURN (
    SELECT jsonb_agg(row_to_json(c)) FROM (
      SELECT id, nombre, cuit, email, telefono, localidad, provincia, notas, activo, es_mayorista
      FROM customers_b2b
      WHERE es_mayorista = true AND activo = true
      ORDER BY nombre
    ) c
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.rpc_mayoristas_list(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.rpc_mayoristas_list(jsonb) TO authenticated;

-- Crear pedido con items (owner-only)
CREATE OR REPLACE FUNCTION public.rpc_mayoristas_create_pedido(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_pedido_id uuid;
  v_numero text;
  v_item jsonb;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('owner') THEN
    RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;

  -- Período contable cerrado
  IF _admin_check_periodo_cerrado(COALESCE((p_payload->>'fecha_pedido')::date, CURRENT_DATE)) THEN
    RAISE EXCEPTION 'Período contable cerrado.'
      USING ERRCODE='42501', HINT='periodo_cerrado'; END IF;

  v_numero := fn_next_numero_pedido_mayorista();

  INSERT INTO pedidos_mayoristas (
    numero_pedido, cliente_id, fecha_pedido, fecha_entrega_estimada,
    estado, condicion_pago, notas, created_by
  ) VALUES (
    v_numero,
    (p_payload->>'cliente_id')::uuid,
    COALESCE((p_payload->>'fecha_pedido')::date, CURRENT_DATE),
    NULLIF(p_payload->>'fecha_entrega_estimada','')::date,
    COALESCE((p_payload->>'estado')::pedido_mayorista_estado, 'cotizacion'),
    NULLIF(trim(p_payload->>'condicion_pago'),''),
    NULLIF(trim(p_payload->>'notas'),''),
    auth.uid()
  ) RETURNING id INTO v_pedido_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'items','[]'::jsonb)) LOOP
    INSERT INTO pedidos_mayoristas_items (pedido_id, sku, cantidad, precio_unitario, notas_item)
    VALUES (
      v_pedido_id,
      v_item->>'sku',
      (v_item->>'cantidad')::integer,
      (v_item->>'precio_unitario')::numeric,
      NULLIF(trim(v_item->>'notas_item'),'')
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'pedido_id', v_pedido_id, 'numero_pedido', v_numero);
END $$;
REVOKE EXECUTE ON FUNCTION public.rpc_mayoristas_create_pedido(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.rpc_mayoristas_create_pedido(jsonb) TO authenticated;

-- Actualizar estado del pedido (owner-only)
CREATE OR REPLACE FUNCTION public.rpc_mayoristas_update_estado(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_estado_nuevo pedido_mayorista_estado;
  v_pedido pedidos_mayoristas%ROWTYPE;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('owner') THEN
    RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;

  v_estado_nuevo := (p_payload->>'estado')::pedido_mayorista_estado;

  SELECT * INTO v_pedido FROM pedidos_mayoristas
  WHERE id = (p_payload->>'pedido_id')::uuid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido no encontrado.' USING ERRCODE='P0002'; END IF;

  UPDATE pedidos_mayoristas
  SET estado = v_estado_nuevo
  WHERE id = v_pedido.id;

  -- DESCUENTO DE STOCK al pasar a 'entregado': DIFERIDO a S2.23b.
  -- sku_catalog no tiene columna de stock_actual; el descuento se
  -- implementará cuando exista esa pieza. Por ahora solo cambia el estado.

  RETURN jsonb_build_object('ok', true, 'pedido_id', v_pedido.id, 'estado', v_estado_nuevo);
END $$;
REVOKE EXECUTE ON FUNCTION public.rpc_mayoristas_update_estado(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.rpc_mayoristas_update_estado(jsonb) TO authenticated;

-- Listar pedidos (owner+admin) con filtro opcional cliente/estado
CREATE OR REPLACE FUNCTION public.rpc_mayoristas_list_pedidos(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role role_enum; v_active boolean;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;
  RETURN (
    SELECT jsonb_agg(row_to_json(p)) FROM (
      SELECT
        pm.id, pm.numero_pedido, pm.fecha_pedido, pm.fecha_entrega_estimada,
        pm.estado, pm.condicion_pago, pm.notas, pm.created_at, pm.cliente_id,
        cb.nombre AS cliente_nombre, cb.localidad, cb.provincia,
        (
          SELECT jsonb_agg(jsonb_build_object(
            'sku', pmi.sku, 'cantidad', pmi.cantidad,
            'precio_unitario', pmi.precio_unitario,
            'modelo', sc.modelo, 'color', sc.color
          ))
          FROM pedidos_mayoristas_items pmi
          JOIN sku_catalog sc ON sc.sku = pmi.sku
          WHERE pmi.pedido_id = pm.id
        ) AS items
      FROM pedidos_mayoristas pm
      JOIN customers_b2b cb ON cb.id = pm.cliente_id
      WHERE pm.activo = true
        AND ((p_payload->>'cliente_id') IS NULL OR pm.cliente_id = (p_payload->>'cliente_id')::uuid)
        AND ((p_payload->>'estado') IS NULL OR pm.estado = (p_payload->>'estado')::pedido_mayorista_estado)
      ORDER BY pm.created_at DESC
    ) p
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.rpc_mayoristas_list_pedidos(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.rpc_mayoristas_list_pedidos(jsonb) TO authenticated;

-- ── (1J) EXTENSIÓN de los RPCs de cliente B2B (gap del brief) ────────
-- Se reproducen TAL CUAL los actuales + 3 campos nuevos (es_mayorista,
-- localidad, provincia). En el UPDATE se usa el operador `?` (existencia
-- de key) para que callers que NO mandan esos campos (ej: desactivar/
-- reactivar de customers-tab) NO los pisen.

CREATE OR REPLACE FUNCTION public.rpc_admin_create_customer_b2b(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_customer_id uuid;
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

  INSERT INTO public.customers_b2b (nombre, cuit, email, telefono, notas, es_mayorista, localidad, provincia, created_by)
  VALUES (
    NULLIF(trim(p_payload->>'nombre'), ''),
    NULLIF(trim(p_payload->>'cuit'), ''),
    NULLIF(trim(p_payload->>'email'), ''),
    NULLIF(trim(p_payload->>'telefono'), ''),
    NULLIF(trim(p_payload->>'notas'), ''),
    COALESCE((p_payload->>'es_mayorista')::boolean, false),
    NULLIF(trim(p_payload->>'localidad'), ''),
    NULLIF(trim(p_payload->>'provincia'), ''),
    auth.uid()
  )
  RETURNING id INTO v_customer_id;

  INSERT INTO public.customers_credit (customer_type, customer_b2b_id)
  VALUES ('b2b', v_customer_id)
  RETURNING id INTO v_credit_id;

  RETURN jsonb_build_object(
    'customer_b2b_id', v_customer_id,
    'customer_credit_id', v_credit_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_admin_update_customer_b2b(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum; v_active boolean;
  v_id uuid := NULLIF(p_payload->>'id','')::uuid;
  v_nombre text; v_cuit text;
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
  PERFORM 1 FROM public.customers_b2b WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente no existe' USING ERRCODE='22023'; END IF;
  BEGIN
    UPDATE public.customers_b2b SET
      nombre=v_nombre, cuit=v_cuit,
      email=NULLIF(trim(p_payload->>'email'),''),
      telefono=NULLIF(trim(p_payload->>'telefono'),''),
      notas=NULLIF(trim(p_payload->>'notas'),''),
      activo=COALESCE((p_payload->>'activo')::boolean, activo),
      es_mayorista = CASE WHEN p_payload ? 'es_mayorista'
                          THEN COALESCE((p_payload->>'es_mayorista')::boolean, es_mayorista)
                          ELSE es_mayorista END,
      localidad    = CASE WHEN p_payload ? 'localidad'
                          THEN NULLIF(trim(p_payload->>'localidad'),'')
                          ELSE localidad END,
      provincia    = CASE WHEN p_payload ? 'provincia'
                          THEN NULLIF(trim(p_payload->>'provincia'),'')
                          ELSE provincia END
    WHERE id = v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Ya existe otro cliente con ese CUIT' USING ERRCODE='23505', HINT='duplicate_cuit';
  END;
  RETURN jsonb_build_object('customer_b2b_id', v_id, 'updated', true);
END;
$function$;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual):
--   DROP TABLE IF EXISTS public.pedidos_mayoristas_items CASCADE;
--   DROP TABLE IF EXISTS public.pedidos_mayoristas CASCADE;
--   DROP SEQUENCE IF EXISTS public.pedidos_mayoristas_seq;
--   DROP FUNCTION IF EXISTS public.fn_next_numero_pedido_mayorista();
--   DROP FUNCTION IF EXISTS public.rpc_mayoristas_list(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_mayoristas_create_pedido(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_mayoristas_update_estado(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_mayoristas_list_pedidos(jsonb);
--   DROP TYPE IF EXISTS pedido_mayorista_estado;
--   ALTER TABLE public.customers_b2b
--     DROP COLUMN IF EXISTS es_mayorista,
--     DROP COLUMN IF EXISTS localidad,
--     DROP COLUMN IF EXISTS provincia;
--   -- (los RPCs rpc_admin_*_customer_b2b extendidos quedan; reaplicar
--   --  la versión previa si se quiere revertir el extend)
-- ════════════════════════════════════════════════════════════════════
