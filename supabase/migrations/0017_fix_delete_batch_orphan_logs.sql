-- ════════════════════════════════════════════════════════════════════
-- FIX — rpc_delete_batch_full v2 + rpc_clean_orphan_logs
-- ════════════════════════════════════════════════════════════════════
-- Bug detectado en producción (2026-05-05):
--
-- Tras eliminar varios lotes de Colecta, el SKU MAD052 quedó con
-- carrier_state.producido=12 y stock=12, sin pedidos asociados. La UI
-- mostraba la fila en "Pendiente por SKU" con Pedido=0 / Producido=12
-- → confuso para el operario.
--
-- Causa raíz: rpc_delete_batch_full v1 borraba production_logs solo
-- de los SKUs que estaban EN ESE LOTE y solo desde imported_at. Si el
-- SKU recibía cargas manuales sin estar en ningún lote, esas cargas
-- quedaban como huérfanos.
--
-- v2 agrega un cleanup adicional al final del RPC: borra
-- production_logs del canal cuya orden ya no existe (status pendiente
-- o arrastrado), siempre que NO pertenezcan a una jornada cerrada
-- (preservación del ledger inmutable de cierres).
--
-- Además se agrega rpc_clean_orphan_logs(p_channel_id) — invocable
-- por owner/admin/encargado — para limpiar manualmente sin necesidad
-- de borrar un lote.
-- ════════════════════════════════════════════════════════════════════

-- ── rpc_delete_batch_full v2 ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_delete_batch_full(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $func$
DECLARE
  v_role          role_enum;
  v_active        boolean;
  v_channel_id    text;
  v_imported_at   timestamptz;
  v_skus          text[];
  v_orders_count  int;
  v_logs_count    int;
  v_orphan_count  int;
BEGIN
  SELECT role, active INTO v_role, v_active
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Usuario no autenticado o desactivado'
      USING ERRCODE = '42501';
  END IF;
  IF v_role NOT IN ('owner','admin','encargado') THEN
    RAISE EXCEPTION 'Solo owner/admin/encargado pueden eliminar lotes'
      USING ERRCODE = '42501';
  END IF;

  SELECT channel_id, imported_at INTO v_channel_id, v_imported_at
    FROM public.import_batches WHERE id = p_batch_id;
  IF v_channel_id IS NULL THEN
    RAISE EXCEPTION 'Lote % no existe', p_batch_id USING ERRCODE = '23503';
  END IF;

  SELECT array_agg(DISTINCT sku) INTO v_skus
    FROM public.orders WHERE import_batch_id = p_batch_id;
  IF v_skus IS NULL THEN v_skus := ARRAY[]::text[]; END IF;

  -- 1) Borrar logs vinculados al lote (lógica v1)
  DELETE FROM public.production_logs
   WHERE channel_id = v_channel_id
     AND sku = ANY(v_skus)
     AND created_at >= v_imported_at;
  GET DIAGNOSTICS v_logs_count = ROW_COUNT;

  -- 2) Borrar orders del lote
  DELETE FROM public.orders WHERE import_batch_id = p_batch_id;
  GET DIAGNOSTICS v_orders_count = ROW_COUNT;

  -- 3) Borrar el lote
  DELETE FROM public.import_batches WHERE id = p_batch_id;

  -- 4) NUEVO v2 — Cleanup de logs huérfanos:
  --    Logs cuyas órdenes ya no existen (status pendiente o arrastrado)
  --    y que NO pertenecen a una jornada cerrada (preserva snapshots).
  DELETE FROM public.production_logs pl
   WHERE pl.channel_id = v_channel_id
     AND NOT EXISTS (
       SELECT 1 FROM public.orders o
       WHERE o.channel_id = pl.channel_id
         AND o.sku = pl.sku
         AND o.status IN ('pendiente','arrastrado')
     )
     AND (
       pl.jornada_id IS NULL
       OR EXISTS (
         SELECT 1 FROM public.jornadas j
         WHERE j.id = pl.jornada_id AND j.status = 'abierta'
       )
     );
  GET DIAGNOSTICS v_orphan_count = ROW_COUNT;

  -- 5) Limpiar zombie rows del carrier_state (todo en 0)
  DELETE FROM public.carrier_state
   WHERE channel_id = v_channel_id
     AND pedido = 0 AND producido = 0
     AND faltante = 0 AND stock = 0;

  RETURN jsonb_build_object(
    'batch_id', p_batch_id,
    'channel_id', v_channel_id,
    'orders_deleted', v_orders_count,
    'production_logs_deleted', v_logs_count,
    'orphan_logs_cleaned', v_orphan_count,
    'skus_affected', to_jsonb(v_skus)
  );
END;
$func$;

REVOKE ALL ON FUNCTION public.rpc_delete_batch_full(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_delete_batch_full(uuid) TO authenticated;

-- ── rpc_clean_orphan_logs — limpieza manual ─────────────────────────
-- Borra production_logs de un canal cuyas órdenes ya no existen
-- (status pendiente o arrastrado) y que NO están vinculados a una
-- jornada cerrada. Útil para arreglar state desbalanceado sin tener
-- que borrar y reimportar lotes.
CREATE OR REPLACE FUNCTION public.rpc_clean_orphan_logs(p_channel_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $func$
DECLARE
  v_role         role_enum;
  v_active       boolean;
  v_orphan_count int;
  v_skus         text[];
BEGIN
  SELECT role, active INTO v_role, v_active
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro o tu cuenta esta desactivada.'
      USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin','encargado') THEN
    RAISE EXCEPTION 'Solo owner/admin/encargado pueden limpiar logs huerfanos.'
      USING ERRCODE='42501', HINT='not_authorized';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.channels WHERE id = p_channel_id) THEN
    RAISE EXCEPTION 'El canal % no existe.', p_channel_id
      USING ERRCODE='23503', HINT='channel_not_found';
  END IF;

  -- SKUs que van a ser afectados (para el resultado)
  SELECT array_agg(DISTINCT pl.sku) INTO v_skus
    FROM public.production_logs pl
   WHERE pl.channel_id = p_channel_id
     AND NOT EXISTS (
       SELECT 1 FROM public.orders o
       WHERE o.channel_id = pl.channel_id AND o.sku = pl.sku
         AND o.status IN ('pendiente','arrastrado')
     )
     AND (pl.jornada_id IS NULL OR EXISTS (
       SELECT 1 FROM public.jornadas j
       WHERE j.id = pl.jornada_id AND j.status = 'abierta'
     ));

  DELETE FROM public.production_logs pl
   WHERE pl.channel_id = p_channel_id
     AND NOT EXISTS (
       SELECT 1 FROM public.orders o
       WHERE o.channel_id = pl.channel_id AND o.sku = pl.sku
         AND o.status IN ('pendiente','arrastrado')
     )
     AND (pl.jornada_id IS NULL OR EXISTS (
       SELECT 1 FROM public.jornadas j
       WHERE j.id = pl.jornada_id AND j.status = 'abierta'
     ));
  GET DIAGNOSTICS v_orphan_count = ROW_COUNT;

  -- Limpiar zombie rows del carrier_state
  DELETE FROM public.carrier_state
   WHERE channel_id = p_channel_id
     AND pedido = 0 AND producido = 0
     AND faltante = 0 AND stock = 0;

  RETURN jsonb_build_object(
    'channel_id', p_channel_id,
    'orphan_logs_deleted', v_orphan_count,
    'skus_affected', COALESCE(to_jsonb(v_skus), '[]'::jsonb)
  );
END;
$func$;

REVOKE ALL ON FUNCTION public.rpc_clean_orphan_logs(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_clean_orphan_logs(text) TO authenticated;
