-- ════════════════════════════════════════════════════════════════════
-- S2.26 — Presupuestos B2B
-- ════════════════════════════════════════════════════════════════════
-- Tablas presupuestos (+items) con numeración propia PRES-xxxx, enum de
-- estados, triggers, RLS, y 5 RPCs. Al ACEPTAR un presupuesto se genera
-- automáticamente un pedido_mayorista (replicando la lógica de
-- rpc_mayoristas_create_pedido) y se guarda el pedido_id.
--
-- ── Decisiones (validadas con Jefe) ──────────────────────────────────
--  1. RPCs owner+admin (Ventas es operado por admins con permiso 'ventas').
--     RLS: SELECT owner+admin, escritura owner-only (mismo patrón que
--     pedidos_mayoristas; el path real de escritura son los RPCs
--     SECURITY DEFINER, que bypassean RLS).
--  2. Al aceptar, el precio_unitario del item del pedido = precio efectivo
--     = precio × (1-dto_item/100) × (1-dto_global/100), de modo que el
--     TOTAL del pedido generado == TOTAL del presupuesto aceptado.
--  3. Funciones reutilizadas: set_updated_at, trg_audit_log,
--     _admin_check_periodo_cerrado, fn_next_numero_pedido_mayorista.
-- ════════════════════════════════════════════════════════════════════

-- ── (1A) Enum ────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE presupuesto_estado AS ENUM ('borrador','enviado','aceptado','rechazado','vencido');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── (1B) Secuencia + numeración PRES-xxxx ────────────────────────────
CREATE SEQUENCE IF NOT EXISTS presupuestos_seq START 1;

CREATE OR REPLACE FUNCTION public.fn_next_numero_presupuesto()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$ BEGIN
  RETURN 'PRES-' || LPAD(nextval('presupuestos_seq')::text, 4, '0');
END $$;
REVOKE EXECUTE ON FUNCTION public.fn_next_numero_presupuesto() FROM anon, public;

-- ── (1C) Tabla presupuestos ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.presupuestos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  numero text UNIQUE NOT NULL,
  cliente_id uuid NOT NULL REFERENCES public.customers_b2b(id) ON DELETE RESTRICT,
  fecha_emision date NOT NULL DEFAULT CURRENT_DATE,
  dias_validez integer NOT NULL DEFAULT 15 CHECK (dias_validez >= 0),
  fecha_validez date GENERATED ALWAYS AS (fecha_emision + dias_validez) STORED,
  estado presupuesto_estado NOT NULL DEFAULT 'borrador',
  condicion_pago text,
  notas text,
  descuento_global numeric(5,2) NOT NULL DEFAULT 0 CHECK (descuento_global >= 0 AND descuento_global <= 100),
  pedido_id uuid REFERENCES public.pedidos_mayoristas(id) ON DELETE SET NULL,
  activo boolean DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS presupuestos_cliente_idx ON public.presupuestos(cliente_id);
CREATE INDEX IF NOT EXISTS presupuestos_estado_idx  ON public.presupuestos(estado);

-- ── (1D) Tabla presupuestos_items ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.presupuestos_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  presupuesto_id uuid NOT NULL REFERENCES public.presupuestos(id) ON DELETE CASCADE,
  sku text NOT NULL REFERENCES public.sku_catalog(sku) ON DELETE RESTRICT,
  cantidad integer NOT NULL CHECK (cantidad > 0),
  precio_unitario numeric(12,2) NOT NULL CHECK (precio_unitario >= 0),
  descuento_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (descuento_pct >= 0 AND descuento_pct <= 100),
  subtotal numeric(14,2) GENERATED ALWAYS AS (cantidad * precio_unitario * (1 - descuento_pct/100)) STORED,
  notas_item text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS presupuestos_items_pres_idx ON public.presupuestos_items(presupuesto_id);

-- ── (1E) Triggers ────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_presupuestos_updated_at ON public.presupuestos;
CREATE TRIGGER trg_presupuestos_updated_at BEFORE UPDATE ON public.presupuestos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_audit_presupuestos ON public.presupuestos;
CREATE TRIGGER trg_audit_presupuestos AFTER INSERT OR UPDATE OR DELETE ON public.presupuestos
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit_log();
DROP TRIGGER IF EXISTS trg_audit_presupuestos_items ON public.presupuestos_items;
CREATE TRIGGER trg_audit_presupuestos_items AFTER INSERT OR UPDATE OR DELETE ON public.presupuestos_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit_log();

-- ── (1F) RLS (SELECT owner+admin · escritura owner-only) ─────────────
ALTER TABLE public.presupuestos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presupuestos_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pres_select" ON public.presupuestos;
CREATE POLICY "pres_select" ON public.presupuestos FOR SELECT TO authenticated USING (public.is_owner_or_admin());
DROP POLICY IF EXISTS "pres_insert" ON public.presupuestos;
CREATE POLICY "pres_insert" ON public.presupuestos FOR INSERT TO authenticated WITH CHECK (public.current_user_role() = 'owner');
DROP POLICY IF EXISTS "pres_update" ON public.presupuestos;
CREATE POLICY "pres_update" ON public.presupuestos FOR UPDATE TO authenticated USING (public.current_user_role() = 'owner') WITH CHECK (public.current_user_role() = 'owner');
DROP POLICY IF EXISTS "pres_delete" ON public.presupuestos;
CREATE POLICY "pres_delete" ON public.presupuestos FOR DELETE TO authenticated USING (public.current_user_role() = 'owner');

DROP POLICY IF EXISTS "presit_select" ON public.presupuestos_items;
CREATE POLICY "presit_select" ON public.presupuestos_items FOR SELECT TO authenticated USING (public.is_owner_or_admin());
DROP POLICY IF EXISTS "presit_insert" ON public.presupuestos_items;
CREATE POLICY "presit_insert" ON public.presupuestos_items FOR INSERT TO authenticated WITH CHECK (public.current_user_role() = 'owner');
DROP POLICY IF EXISTS "presit_update" ON public.presupuestos_items;
CREATE POLICY "presit_update" ON public.presupuestos_items FOR UPDATE TO authenticated USING (public.current_user_role() = 'owner') WITH CHECK (public.current_user_role() = 'owner');
DROP POLICY IF EXISTS "presit_delete" ON public.presupuestos_items;
CREATE POLICY "presit_delete" ON public.presupuestos_items FOR DELETE TO authenticated USING (public.current_user_role() = 'owner');

-- ── (1G) RPCs (owner+admin) ──────────────────────────────────────────

-- Helper interno: gate owner+admin (raise si no).
-- (inline en cada RPC para mantener el patrón del proyecto)

-- Listar (auto-vence borrador/enviado con validez pasada) + items + totales
CREATE OR REPLACE FUNCTION public.rpc_presupuestos_list(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role role_enum; v_active boolean;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;

  -- Auto-vencer
  UPDATE presupuestos SET estado='vencido'
  WHERE estado IN ('borrador','enviado') AND fecha_validez < CURRENT_DATE AND activo = true;

  RETURN (
    SELECT jsonb_agg(row_to_json(p)) FROM (
      SELECT pr.id, pr.numero, pr.cliente_id, pr.fecha_emision, pr.fecha_validez, pr.dias_validez,
             pr.estado, pr.condicion_pago, pr.notas, pr.descuento_global, pr.pedido_id, pr.created_at,
             cb.nombre AS cliente_nombre, cb.cuit AS cliente_cuit, cb.localidad AS cliente_localidad, cb.provincia AS cliente_provincia,
             ped.numero_pedido AS pedido_numero,
             COALESCE(it.subtotal_items, 0) AS subtotal_items,
             ROUND(COALESCE(it.subtotal_items, 0) * (1 - pr.descuento_global/100), 2) AS total,
             COALESCE(it.items, '[]'::jsonb) AS items
      FROM presupuestos pr
      JOIN customers_b2b cb ON cb.id = pr.cliente_id
      LEFT JOIN pedidos_mayoristas ped ON ped.id = pr.pedido_id
      LEFT JOIN LATERAL (
        SELECT SUM(pi.subtotal) AS subtotal_items,
               jsonb_agg(jsonb_build_object(
                 'id', pi.id, 'sku', pi.sku, 'cantidad', pi.cantidad,
                 'precio_unitario', pi.precio_unitario, 'descuento_pct', pi.descuento_pct,
                 'subtotal', pi.subtotal, 'notas_item', pi.notas_item,
                 'modelo', sc.modelo, 'color', sc.color
               ) ORDER BY pi.created_at) AS items
        FROM presupuestos_items pi JOIN sku_catalog sc ON sc.sku = pi.sku
        WHERE pi.presupuesto_id = pr.id
      ) it ON true
      WHERE pr.activo = true
        AND ((p_payload->>'estado') IS NULL OR pr.estado = (p_payload->>'estado')::presupuesto_estado)
        AND ((p_payload->>'cliente_id') IS NULL OR pr.cliente_id = (p_payload->>'cliente_id')::uuid)
        AND ((p_payload->>'desde') IS NULL OR pr.fecha_emision >= (p_payload->>'desde')::date)
        AND ((p_payload->>'hasta') IS NULL OR pr.fecha_emision <= (p_payload->>'hasta')::date)
      ORDER BY pr.created_at DESC
    ) p
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.rpc_presupuestos_list(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.rpc_presupuestos_list(jsonb) TO authenticated;

-- Crear presupuesto + items
CREATE OR REPLACE FUNCTION public.rpc_presupuestos_create(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role role_enum; v_active boolean; v_id uuid; v_numero text; v_item jsonb; v_fecha date;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;

  v_fecha := COALESCE((p_payload->>'fecha_emision')::date, CURRENT_DATE);
  IF _admin_check_periodo_cerrado(v_fecha) THEN
    RAISE EXCEPTION 'Período contable cerrado.' USING ERRCODE='42501', HINT='periodo_cerrado'; END IF;

  v_numero := fn_next_numero_presupuesto();

  INSERT INTO presupuestos (numero, cliente_id, fecha_emision, dias_validez, estado, condicion_pago, notas, descuento_global, created_by)
  VALUES (
    v_numero, (p_payload->>'cliente_id')::uuid, v_fecha,
    COALESCE((p_payload->>'dias_validez')::integer, 15),
    COALESCE((p_payload->>'estado')::presupuesto_estado, 'borrador'),
    NULLIF(trim(p_payload->>'condicion_pago'),''), NULLIF(trim(p_payload->>'notas'),''),
    COALESCE((p_payload->>'descuento_global')::numeric, 0),
    auth.uid()
  ) RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'items','[]'::jsonb)) LOOP
    INSERT INTO presupuestos_items (presupuesto_id, sku, cantidad, precio_unitario, descuento_pct, notas_item)
    VALUES (v_id, v_item->>'sku', (v_item->>'cantidad')::integer, (v_item->>'precio_unitario')::numeric,
            COALESCE((v_item->>'descuento_pct')::numeric, 0), NULLIF(trim(v_item->>'notas_item'),''));
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'numero', v_numero);
END $$;
REVOKE EXECUTE ON FUNCTION public.rpc_presupuestos_create(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.rpc_presupuestos_create(jsonb) TO authenticated;

-- Editar (solo si estado='borrador') — reemplaza campos + items
CREATE OR REPLACE FUNCTION public.rpc_presupuestos_update(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role role_enum; v_active boolean; v_id uuid; v_estado presupuesto_estado; v_item jsonb;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;

  v_id := (p_payload->>'id')::uuid;
  SELECT estado INTO v_estado FROM presupuestos WHERE id = v_id AND activo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Presupuesto no encontrado.' USING ERRCODE='P0002'; END IF;
  IF v_estado <> 'borrador' THEN RAISE EXCEPTION 'Solo se puede editar un presupuesto en borrador.' USING ERRCODE='42501'; END IF;

  UPDATE presupuestos SET
    cliente_id = COALESCE((p_payload->>'cliente_id')::uuid, cliente_id),
    fecha_emision = COALESCE((p_payload->>'fecha_emision')::date, fecha_emision),
    dias_validez = COALESCE((p_payload->>'dias_validez')::integer, dias_validez),
    condicion_pago = CASE WHEN p_payload ? 'condicion_pago' THEN NULLIF(trim(p_payload->>'condicion_pago'),'') ELSE condicion_pago END,
    notas = CASE WHEN p_payload ? 'notas' THEN NULLIF(trim(p_payload->>'notas'),'') ELSE notas END,
    descuento_global = COALESCE((p_payload->>'descuento_global')::numeric, descuento_global)
  WHERE id = v_id;

  IF p_payload ? 'items' THEN
    DELETE FROM presupuestos_items WHERE presupuesto_id = v_id;
    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'items','[]'::jsonb)) LOOP
      INSERT INTO presupuestos_items (presupuesto_id, sku, cantidad, precio_unitario, descuento_pct, notas_item)
      VALUES (v_id, v_item->>'sku', (v_item->>'cantidad')::integer, (v_item->>'precio_unitario')::numeric,
              COALESCE((v_item->>'descuento_pct')::numeric, 0), NULLIF(trim(v_item->>'notas_item'),''));
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;
REVOKE EXECUTE ON FUNCTION public.rpc_presupuestos_update(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.rpc_presupuestos_update(jsonb) TO authenticated;

-- Cambiar estado (al aceptar → genera pedido_mayorista con precio efectivo)
CREATE OR REPLACE FUNCTION public.rpc_presupuestos_update_estado(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_estado_nuevo presupuesto_estado;
  v_pres presupuestos%ROWTYPE;
  v_pedido_id uuid; v_numero text; v_global numeric;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;

  v_estado_nuevo := (p_payload->>'estado')::presupuesto_estado;
  SELECT * INTO v_pres FROM presupuestos WHERE id = (p_payload->>'id')::uuid AND activo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Presupuesto no encontrado.' USING ERRCODE='P0002'; END IF;

  IF v_estado_nuevo = 'aceptado' THEN
    -- Idempotente: si ya tiene pedido, no recrear
    IF v_pres.pedido_id IS NOT NULL THEN
      UPDATE presupuestos SET estado = 'aceptado' WHERE id = v_pres.id;
      RETURN jsonb_build_object('ok', true, 'estado', 'aceptado', 'pedido_id', v_pres.pedido_id);
    END IF;

    IF _admin_check_periodo_cerrado(CURRENT_DATE) THEN
      RAISE EXCEPTION 'Período contable cerrado.' USING ERRCODE='42501', HINT='periodo_cerrado'; END IF;

    v_numero := fn_next_numero_pedido_mayorista();
    v_global := COALESCE(v_pres.descuento_global, 0);

    INSERT INTO pedidos_mayoristas (numero_pedido, cliente_id, fecha_pedido, estado, condicion_pago, notas, created_by)
    VALUES (v_numero, v_pres.cliente_id, CURRENT_DATE, 'confirmado', v_pres.condicion_pago, v_pres.notas, auth.uid())
    RETURNING id INTO v_pedido_id;

    -- Precio efectivo: dto item + dto global horneados → total pedido == total presupuesto
    INSERT INTO pedidos_mayoristas_items (pedido_id, sku, cantidad, precio_unitario, notas_item)
    SELECT v_pedido_id, pi.sku, pi.cantidad,
           ROUND(pi.precio_unitario * (1 - pi.descuento_pct/100) * (1 - v_global/100), 2),
           pi.notas_item
    FROM presupuestos_items pi WHERE pi.presupuesto_id = v_pres.id;

    UPDATE presupuestos SET estado = 'aceptado', pedido_id = v_pedido_id WHERE id = v_pres.id;
    RETURN jsonb_build_object('ok', true, 'estado', 'aceptado', 'pedido_id', v_pedido_id, 'pedido_numero', v_numero);
  ELSE
    UPDATE presupuestos SET estado = v_estado_nuevo WHERE id = v_pres.id;
    RETURN jsonb_build_object('ok', true, 'estado', v_estado_nuevo);
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.rpc_presupuestos_update_estado(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.rpc_presupuestos_update_estado(jsonb) TO authenticated;

-- Soft delete (no si está aceptado)
CREATE OR REPLACE FUNCTION public.rpc_presupuestos_soft_delete(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role role_enum; v_active boolean;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;

  UPDATE presupuestos SET activo = false
  WHERE id = (p_payload->>'id')::uuid AND estado <> 'aceptado';
  IF NOT FOUND THEN RAISE EXCEPTION 'No se puede eliminar: no existe o ya fue aceptado.' USING ERRCODE='P0002'; END IF;

  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.rpc_presupuestos_soft_delete(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.rpc_presupuestos_soft_delete(jsonb) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual):
--   DROP TABLE IF EXISTS public.presupuestos_items CASCADE;
--   DROP TABLE IF EXISTS public.presupuestos CASCADE;
--   DROP SEQUENCE IF EXISTS public.presupuestos_seq;
--   DROP FUNCTION IF EXISTS public.fn_next_numero_presupuesto();
--   DROP FUNCTION IF EXISTS public.rpc_presupuestos_list(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_presupuestos_create(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_presupuestos_update(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_presupuestos_update_estado(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_presupuestos_soft_delete(jsonb);
--   DROP TYPE IF EXISTS presupuesto_estado;
-- ════════════════════════════════════════════════════════════════════
