-- ════════════════════════════════════════════════════════════════════
-- S2.27 — Remitos B2B
-- ════════════════════════════════════════════════════════════════════
-- Documento de entrega B2B con numeración propia REM-xxxx, link opcional
-- a un pedido_mayorista, entregas parciales y cierre automático del
-- pedido cuando se entrega el 100%.
--
-- ── Decisiones (consistentes con S2.26) ──────────────────────────────
--  1. RPCs owner+admin (Ventas operado por admins con permiso 'ventas').
--     RLS: SELECT owner+admin, escritura owner-only (path real = RPCs
--     SECURITY DEFINER).
--  2. Cierre automático: al CONFIRMAR un remito con pedido_id, si la suma
--     de cantidades remitidas (en TODOS los remitos confirmados del
--     pedido) cubre cada ítem del pedido → pedido pasa a 'entregado'.
--  3. Al ANULAR: si el pedido estaba 'entregado' y al recomputar ya no
--     está 100% cubierto → vuelve a 'listo'.
--  4. precio_unitario es REFERENCIAL (no afecta stock; no hay stock en
--     sku_catalog).
--  5. Funciones reutilizadas: set_updated_at, trg_audit_log,
--     _admin_check_periodo_cerrado.
-- ════════════════════════════════════════════════════════════════════

-- ── (1A) Enum ────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE remito_estado AS ENUM ('borrador','confirmado','anulado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── (1B) Secuencia + numeración REM-xxxx ─────────────────────────────
CREATE SEQUENCE IF NOT EXISTS remitos_seq START 1;
CREATE OR REPLACE FUNCTION public.fn_next_numero_remito()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$ BEGIN RETURN 'REM-' || LPAD(nextval('remitos_seq')::text, 4, '0'); END $$;
REVOKE EXECUTE ON FUNCTION public.fn_next_numero_remito() FROM anon, public;

-- ── (1C) Tabla remitos ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.remitos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  numero text UNIQUE NOT NULL,
  cliente_id uuid NOT NULL REFERENCES public.customers_b2b(id) ON DELETE RESTRICT,
  pedido_id uuid REFERENCES public.pedidos_mayoristas(id) ON DELETE SET NULL,
  fecha_emision date NOT NULL DEFAULT CURRENT_DATE,
  fecha_entrega date,
  estado remito_estado NOT NULL DEFAULT 'borrador',
  condicion_entrega text,
  transportista text,
  notas text,
  activo boolean DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS remitos_cliente_idx ON public.remitos(cliente_id);
CREATE INDEX IF NOT EXISTS remitos_pedido_idx  ON public.remitos(pedido_id);
CREATE INDEX IF NOT EXISTS remitos_estado_idx  ON public.remitos(estado);

-- ── (1D) Tabla remitos_items ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.remitos_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  remito_id uuid NOT NULL REFERENCES public.remitos(id) ON DELETE CASCADE,
  sku text NOT NULL REFERENCES public.sku_catalog(sku) ON DELETE RESTRICT,
  cantidad_remitida integer NOT NULL CHECK (cantidad_remitida > 0),
  precio_unitario numeric(12,2) NOT NULL DEFAULT 0 CHECK (precio_unitario >= 0),
  subtotal numeric(14,2) GENERATED ALWAYS AS (cantidad_remitida * precio_unitario) STORED,
  notas_item text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS remitos_items_remito_idx ON public.remitos_items(remito_id);

-- ── (1E) Triggers ────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_remitos_updated_at ON public.remitos;
CREATE TRIGGER trg_remitos_updated_at BEFORE UPDATE ON public.remitos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_audit_remitos ON public.remitos;
CREATE TRIGGER trg_audit_remitos AFTER INSERT OR UPDATE OR DELETE ON public.remitos
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit_log();
DROP TRIGGER IF EXISTS trg_audit_remitos_items ON public.remitos_items;
CREATE TRIGGER trg_audit_remitos_items AFTER INSERT OR UPDATE OR DELETE ON public.remitos_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit_log();

-- ── (1F) RLS ─────────────────────────────────────────────────────────
ALTER TABLE public.remitos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remitos_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rem_select" ON public.remitos;
CREATE POLICY "rem_select" ON public.remitos FOR SELECT TO authenticated USING (public.is_owner_or_admin());
DROP POLICY IF EXISTS "rem_insert" ON public.remitos;
CREATE POLICY "rem_insert" ON public.remitos FOR INSERT TO authenticated WITH CHECK (public.current_user_role() = 'owner');
DROP POLICY IF EXISTS "rem_update" ON public.remitos;
CREATE POLICY "rem_update" ON public.remitos FOR UPDATE TO authenticated USING (public.current_user_role() = 'owner') WITH CHECK (public.current_user_role() = 'owner');
DROP POLICY IF EXISTS "rem_delete" ON public.remitos;
CREATE POLICY "rem_delete" ON public.remitos FOR DELETE TO authenticated USING (public.current_user_role() = 'owner');

DROP POLICY IF EXISTS "remit_select" ON public.remitos_items;
CREATE POLICY "remit_select" ON public.remitos_items FOR SELECT TO authenticated USING (public.is_owner_or_admin());
DROP POLICY IF EXISTS "remit_insert" ON public.remitos_items;
CREATE POLICY "remit_insert" ON public.remitos_items FOR INSERT TO authenticated WITH CHECK (public.current_user_role() = 'owner');
DROP POLICY IF EXISTS "remit_update" ON public.remitos_items;
CREATE POLICY "remit_update" ON public.remitos_items FOR UPDATE TO authenticated USING (public.current_user_role() = 'owner') WITH CHECK (public.current_user_role() = 'owner');
DROP POLICY IF EXISTS "remit_delete" ON public.remitos_items;
CREATE POLICY "remit_delete" ON public.remitos_items FOR DELETE TO authenticated USING (public.current_user_role() = 'owner');

-- ── (1G) RPCs (owner+admin) ──────────────────────────────────────────

-- Listar (items + cliente + pedido vinculado + progreso de entrega)
CREATE OR REPLACE FUNCTION public.rpc_remitos_list(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role role_enum; v_active boolean;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;
  RETURN (
    SELECT jsonb_agg(row_to_json(r)) FROM (
      SELECT rm.id, rm.numero, rm.cliente_id, rm.pedido_id, rm.fecha_emision, rm.fecha_entrega,
             rm.estado, rm.condicion_entrega, rm.transportista, rm.notas, rm.created_at,
             cb.nombre AS cliente_nombre, cb.cuit AS cliente_cuit, cb.localidad AS cliente_localidad, cb.provincia AS cliente_provincia,
             ped.numero_pedido AS pedido_numero, ped.estado AS pedido_estado,
             prog.pedido_unidades, prog.remitido_unidades,
             COALESCE(it.total_ref, 0) AS total_ref,
             COALESCE(it.items, '[]'::jsonb) AS items
      FROM remitos rm
      JOIN customers_b2b cb ON cb.id = rm.cliente_id
      LEFT JOIN pedidos_mayoristas ped ON ped.id = rm.pedido_id
      LEFT JOIN LATERAL (
        SELECT SUM(ri.subtotal) AS total_ref,
               jsonb_agg(jsonb_build_object(
                 'id', ri.id, 'sku', ri.sku, 'cantidad_remitida', ri.cantidad_remitida,
                 'precio_unitario', ri.precio_unitario, 'subtotal', ri.subtotal, 'notas_item', ri.notas_item,
                 'modelo', sc.modelo, 'color', sc.color
               ) ORDER BY ri.created_at) AS items
        FROM remitos_items ri JOIN sku_catalog sc ON sc.sku = ri.sku
        WHERE ri.remito_id = rm.id
      ) it ON true
      LEFT JOIN LATERAL (
        SELECT (SELECT SUM(cantidad) FROM pedidos_mayoristas_items WHERE pedido_id = rm.pedido_id) AS pedido_unidades,
               (SELECT SUM(ri2.cantidad_remitida) FROM remitos r2 JOIN remitos_items ri2 ON ri2.remito_id = r2.id
                 WHERE r2.pedido_id = rm.pedido_id AND r2.estado = 'confirmado' AND r2.activo = true) AS remitido_unidades
      ) prog ON rm.pedido_id IS NOT NULL
      WHERE rm.activo = true
        AND ((p_payload->>'cliente_id') IS NULL OR rm.cliente_id = (p_payload->>'cliente_id')::uuid)
        AND ((p_payload->>'pedido_id') IS NULL OR rm.pedido_id = (p_payload->>'pedido_id')::uuid)
        AND ((p_payload->>'estado') IS NULL OR rm.estado = (p_payload->>'estado')::remito_estado)
        AND ((p_payload->>'desde') IS NULL OR rm.fecha_emision >= (p_payload->>'desde')::date)
        AND ((p_payload->>'hasta') IS NULL OR rm.fecha_emision <= (p_payload->>'hasta')::date)
      ORDER BY rm.created_at DESC
    ) r
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.rpc_remitos_list(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.rpc_remitos_list(jsonb) TO authenticated;

-- Crear remito + items (si vinculado, validar SKUs ∈ pedido)
CREATE OR REPLACE FUNCTION public.rpc_remitos_create(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_id uuid; v_numero text; v_item jsonb; v_fecha date; v_pedido_id uuid; v_sku text;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;

  v_fecha := COALESCE((p_payload->>'fecha_emision')::date, CURRENT_DATE);
  IF _admin_check_periodo_cerrado(v_fecha) THEN
    RAISE EXCEPTION 'Período contable cerrado.' USING ERRCODE='42501', HINT='periodo_cerrado'; END IF;

  v_pedido_id := NULLIF(p_payload->>'pedido_id','')::uuid;
  v_numero := fn_next_numero_remito();

  INSERT INTO remitos (numero, cliente_id, pedido_id, fecha_emision, fecha_entrega, estado, condicion_entrega, transportista, notas, created_by)
  VALUES (
    v_numero, (p_payload->>'cliente_id')::uuid, v_pedido_id, v_fecha,
    NULLIF(p_payload->>'fecha_entrega','')::date,
    COALESCE((p_payload->>'estado')::remito_estado, 'borrador'),
    NULLIF(trim(p_payload->>'condicion_entrega'),''), NULLIF(trim(p_payload->>'transportista'),''),
    NULLIF(trim(p_payload->>'notas'),''), auth.uid()
  ) RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'items','[]'::jsonb)) LOOP
    v_sku := v_item->>'sku';
    IF v_pedido_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM pedidos_mayoristas_items WHERE pedido_id = v_pedido_id AND sku = v_sku
    ) THEN
      RAISE EXCEPTION 'El SKU % no pertenece al pedido vinculado.', v_sku USING ERRCODE='22023';
    END IF;
    INSERT INTO remitos_items (remito_id, sku, cantidad_remitida, precio_unitario, notas_item)
    VALUES (v_id, v_sku, (v_item->>'cantidad_remitida')::integer,
            COALESCE((v_item->>'precio_unitario')::numeric, 0), NULLIF(trim(v_item->>'notas_item'),''));
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'numero', v_numero);
END $$;
REVOKE EXECUTE ON FUNCTION public.rpc_remitos_create(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.rpc_remitos_create(jsonb) TO authenticated;

-- Editar (solo borrador) — reemplaza campos + items (valida SKU∈pedido)
CREATE OR REPLACE FUNCTION public.rpc_remitos_update(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_role role_enum; v_active boolean; v_id uuid; v_estado remito_estado; v_pedido_id uuid; v_item jsonb; v_sku text;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;

  v_id := (p_payload->>'id')::uuid;
  SELECT estado, pedido_id INTO v_estado, v_pedido_id FROM remitos WHERE id = v_id AND activo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Remito no encontrado.' USING ERRCODE='P0002'; END IF;
  IF v_estado <> 'borrador' THEN RAISE EXCEPTION 'Solo se puede editar un remito en borrador.' USING ERRCODE='42501'; END IF;

  -- pedido_id efectivo para validar los items (si vino en el payload, usar ese)
  IF p_payload ? 'pedido_id' THEN v_pedido_id := NULLIF(p_payload->>'pedido_id','')::uuid; END IF;

  UPDATE remitos SET
    cliente_id = COALESCE((p_payload->>'cliente_id')::uuid, cliente_id),
    pedido_id = CASE WHEN p_payload ? 'pedido_id' THEN NULLIF(p_payload->>'pedido_id','')::uuid ELSE pedido_id END,
    fecha_emision = COALESCE((p_payload->>'fecha_emision')::date, fecha_emision),
    fecha_entrega = CASE WHEN p_payload ? 'fecha_entrega' THEN NULLIF(p_payload->>'fecha_entrega','')::date ELSE fecha_entrega END,
    condicion_entrega = CASE WHEN p_payload ? 'condicion_entrega' THEN NULLIF(trim(p_payload->>'condicion_entrega'),'') ELSE condicion_entrega END,
    transportista = CASE WHEN p_payload ? 'transportista' THEN NULLIF(trim(p_payload->>'transportista'),'') ELSE transportista END,
    notas = CASE WHEN p_payload ? 'notas' THEN NULLIF(trim(p_payload->>'notas'),'') ELSE notas END
  WHERE id = v_id;

  IF p_payload ? 'items' THEN
    DELETE FROM remitos_items WHERE remito_id = v_id;
    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'items','[]'::jsonb)) LOOP
      v_sku := v_item->>'sku';
      IF v_pedido_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM pedidos_mayoristas_items WHERE pedido_id = v_pedido_id AND sku = v_sku
      ) THEN
        RAISE EXCEPTION 'El SKU % no pertenece al pedido vinculado.', v_sku USING ERRCODE='22023';
      END IF;
      INSERT INTO remitos_items (remito_id, sku, cantidad_remitida, precio_unitario, notas_item)
      VALUES (v_id, v_sku, (v_item->>'cantidad_remitida')::integer,
              COALESCE((v_item->>'precio_unitario')::numeric, 0), NULLIF(trim(v_item->>'notas_item'),''));
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;
REVOKE EXECUTE ON FUNCTION public.rpc_remitos_update(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.rpc_remitos_update(jsonb) TO authenticated;

-- Confirmar (cierre automático del pedido si quedó 100% entregado)
CREATE OR REPLACE FUNCTION public.rpc_remitos_confirmar(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role role_enum; v_active boolean; v_rem remitos%ROWTYPE; v_cerrado boolean := false;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_rem FROM remitos WHERE id = (p_payload->>'id')::uuid AND activo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Remito no encontrado.' USING ERRCODE='P0002'; END IF;
  IF v_rem.estado = 'anulado' THEN RAISE EXCEPTION 'El remito está anulado.' USING ERRCODE='42501'; END IF;

  UPDATE remitos SET estado = 'confirmado' WHERE id = v_rem.id;

  -- Cierre automático: ¿el pedido quedó 100% entregado?
  IF v_rem.pedido_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM pedidos_mayoristas_items WHERE pedido_id = v_rem.pedido_id)
       AND NOT EXISTS (
         SELECT 1 FROM pedidos_mayoristas_items pmi
         WHERE pmi.pedido_id = v_rem.pedido_id
           AND pmi.cantidad > COALESCE((
             SELECT SUM(ri.cantidad_remitida) FROM remitos r JOIN remitos_items ri ON ri.remito_id = r.id
             WHERE r.pedido_id = v_rem.pedido_id AND r.estado = 'confirmado' AND r.activo = true AND ri.sku = pmi.sku
           ), 0)
       ) THEN
      UPDATE pedidos_mayoristas SET estado = 'entregado' WHERE id = v_rem.pedido_id AND estado <> 'entregado';
      v_cerrado := true;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'estado', 'confirmado', 'pedido_cerrado', v_cerrado);
END $$;
REVOKE EXECUTE ON FUNCTION public.rpc_remitos_confirmar(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.rpc_remitos_confirmar(jsonb) TO authenticated;

-- Anular (revierte el pedido a 'listo' si ya no está 100% entregado)
CREATE OR REPLACE FUNCTION public.rpc_remitos_anular(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role role_enum; v_active boolean; v_rem remitos%ROWTYPE; v_ped_estado text; v_revertido boolean := false;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_rem FROM remitos WHERE id = (p_payload->>'id')::uuid AND activo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Remito no encontrado.' USING ERRCODE='P0002'; END IF;

  UPDATE remitos SET estado = 'anulado' WHERE id = v_rem.id;

  -- Si el pedido estaba 'entregado' y al recomputar ya no está 100% → 'listo'
  IF v_rem.pedido_id IS NOT NULL THEN
    SELECT estado::text INTO v_ped_estado FROM pedidos_mayoristas WHERE id = v_rem.pedido_id;
    IF v_ped_estado = 'entregado' AND EXISTS (
      SELECT 1 FROM pedidos_mayoristas_items pmi
      WHERE pmi.pedido_id = v_rem.pedido_id
        AND pmi.cantidad > COALESCE((
          SELECT SUM(ri.cantidad_remitida) FROM remitos r JOIN remitos_items ri ON ri.remito_id = r.id
          WHERE r.pedido_id = v_rem.pedido_id AND r.estado = 'confirmado' AND r.activo = true AND ri.sku = pmi.sku
        ), 0)
    ) THEN
      UPDATE pedidos_mayoristas SET estado = 'listo' WHERE id = v_rem.pedido_id;
      v_revertido := true;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'estado', 'anulado', 'pedido_revertido', v_revertido);
END $$;
REVOKE EXECUTE ON FUNCTION public.rpc_remitos_anular(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.rpc_remitos_anular(jsonb) TO authenticated;

-- Soft delete (solo borrador)
CREATE OR REPLACE FUNCTION public.rpc_remitos_soft_delete(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role role_enum; v_active boolean;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;

  UPDATE remitos SET activo = false WHERE id = (p_payload->>'id')::uuid AND estado = 'borrador';
  IF NOT FOUND THEN RAISE EXCEPTION 'No se puede eliminar: no existe o no está en borrador.' USING ERRCODE='P0002'; END IF;

  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.rpc_remitos_soft_delete(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.rpc_remitos_soft_delete(jsonb) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual):
--   DROP TABLE IF EXISTS public.remitos_items CASCADE;
--   DROP TABLE IF EXISTS public.remitos CASCADE;
--   DROP SEQUENCE IF EXISTS public.remitos_seq;
--   DROP FUNCTION IF EXISTS public.fn_next_numero_remito();
--   DROP FUNCTION IF EXISTS public.rpc_remitos_list(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_remitos_create(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_remitos_update(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_remitos_confirmar(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_remitos_anular(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_remitos_soft_delete(jsonb);
--   DROP TYPE IF EXISTS remito_estado;
-- ════════════════════════════════════════════════════════════════════
