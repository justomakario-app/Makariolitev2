-- ════════════════════════════════════════════════════════════════════
-- FIX cierre de jornada — separar "producido" (jornada activa) de
-- "stock_legacy" (sobrante acumulado de cierres pasados)
-- ════════════════════════════════════════════════════════════════════
-- Bug reportado por cliente: tras cerrar una jornada, carrier_state.
-- producido sigue acumulando producción de jornadas cerradas → la
-- próxima jornada arranca viciada con "Producidas: N" cuando debería
-- ser 0. El stock acumulado SÍ debe preservarse — es lo único que se
-- mantiene entre jornadas.
--
-- Cambio mínimo y quirúrgico:
--   - Solo se modifica recompute_carrier_state_for (función SQL).
--   - Sin migration de schema (no ALTER TABLE).
--   - Sin cambios en RPCs (rpc_close_jornada/rpc_import_batch/etc.).
--   - Sin cambios en frontend (los selects de carrier_state no cambian).
--   - Self-healing automático vía triggers existentes
--     (orders_recompute_state + prodlog_recompute_state).
--
-- Idempotente: CREATE OR REPLACE FUNCTION.
-- Aplicación segura: el deploy NO modifica data — solo cambia cómo se
-- recalcula el carrier_state en los próximos triggers. Después del
-- deploy puede ejecutarse un recálculo masivo opcional para acelerar.
--
-- Performance medida (datos reales 2026-05-06):
--   - Query stock_legacy: 1.16 ms (Bitmap Heap Scan + Function Scan)
--   - Query producido filtrado: 3.22 ms (Index Scan + SubPlan EXISTS)
--   - Total por trigger: ~4.4 ms
-- TODO performance a 6+ meses: si la operación crece (>200 jornadas
-- cerradas) considerar índice GIN sobre snapshot:
--   CREATE INDEX ON jornadas USING gin (snapshot jsonb_path_ops)
--     WHERE status='cerrada';
-- No agregado ahora — fuera de scope de este parche.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.recompute_carrier_state_for(
  p_channel_id text,
  p_sku text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $func$
DECLARE
  v_pedido       int;
  v_producido    int;   -- producción de jornada activa + logs sin jornada (legacy)
  v_stock_legacy int;   -- sobrante acumulado de cierres pasados (snapshots)
  v_faltante     int;
  v_stock        int;
BEGIN
  -- Pedido: orders pendientes/arrastradas (sin cambio respecto v1).
  SELECT COALESCE(SUM(cantidad), 0) INTO v_pedido
  FROM public.orders
  WHERE channel_id = p_channel_id
    AND sku = p_sku
    AND status IN ('pendiente', 'arrastrado');

  -- Producido: SOLO logs vinculados a jornadas abiertas o sin jornada
  -- (datos legacy pre-feature de jornadas con jornada_id IS NULL —
  -- son producción no archivada todavía, cuentan como jornada actual).
  -- Producción de jornadas cerradas NO contribuye más a "producido".
  SELECT GREATEST(0, COALESCE(SUM(pl.cantidad), 0)) INTO v_producido
  FROM public.production_logs pl
  WHERE pl.channel_id = p_channel_id
    AND pl.sku = p_sku
    AND (
      pl.jornada_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.jornadas j
        WHERE j.id = pl.jornada_id AND j.status = 'abierta'
      )
    );

  -- Stock legacy: sobrante acumulado de los snapshots inmutables de
  -- jornadas cerradas. Cada snapshot tiene un array jsonb con un
  -- objeto por SKU; cada objeto trae un "stock" calculado al momento
  -- del cierre (= producido_jornada - despachado_jornada).
  -- jsonb_typeof = 'array' es defensivo: snapshots backfilleados
  -- pueden tener '[]'::jsonb (array vacío) y la query maneja ese caso
  -- sin problema. Si por algún motivo histórico hubiera snapshot NULL
  -- u otro tipo, este filtro lo saltea.
  SELECT COALESCE(SUM((e->>'stock')::int), 0) INTO v_stock_legacy
  FROM public.jornadas j,
       jsonb_array_elements(j.snapshot) AS e
  WHERE j.channel_id = p_channel_id
    AND j.status = 'cerrada'
    AND jsonb_typeof(j.snapshot) = 'array'
    AND e->>'sku' = p_sku;

  -- Faltante: pedido cubre primero con producido de la jornada activa,
  -- y si todavía falta, con stock_legacy.
  v_faltante := GREATEST(0, v_pedido - v_producido - v_stock_legacy);

  -- Stock disponible total: stock acumulado heredado + sobrante de la
  -- jornada activa que no fue consumido por pedidos pendientes.
  v_stock := v_stock_legacy + GREATEST(0, v_producido - v_pedido);

  -- Limpiar fila zombie SOLO si no hay actividad ni stock acumulado.
  -- Diferencia con v1: agregamos la check de v_stock_legacy = 0 para
  -- preservar filas con stock heredado de cierres pasados.
  IF v_pedido = 0 AND v_producido = 0 AND v_stock_legacy = 0 THEN
    DELETE FROM public.carrier_state
    WHERE channel_id = p_channel_id AND sku = p_sku;
  ELSE
    INSERT INTO public.carrier_state
      (channel_id, sku, pedido, producido, faltante, stock)
    VALUES
      (p_channel_id, p_sku, v_pedido, v_producido, v_faltante, v_stock)
    ON CONFLICT (channel_id, sku) DO UPDATE SET
      pedido     = EXCLUDED.pedido,
      producido  = EXCLUDED.producido,
      faltante   = EXCLUDED.faltante,
      stock      = EXCLUDED.stock,
      updated_at = now();
  END IF;
END;
$func$;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual, NO ejecutar sin entender la regresión):
-- Para volver a la versión v1 (con bug presente) ejecutar:
--
-- CREATE OR REPLACE FUNCTION public.recompute_carrier_state_for(
--   p_channel_id text, p_sku text
-- ) RETURNS void
-- LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
-- AS $func$
-- DECLARE v_pedido int; v_producido int; v_faltante int; v_stock int;
-- BEGIN
--   SELECT COALESCE(SUM(cantidad), 0) INTO v_pedido
--     FROM public.orders WHERE channel_id = p_channel_id AND sku = p_sku
--     AND status IN ('pendiente','arrastrado');
--   SELECT GREATEST(0, COALESCE(SUM(cantidad), 0)) INTO v_producido
--     FROM public.production_logs WHERE channel_id = p_channel_id AND sku = p_sku;
--   v_faltante := GREATEST(0, v_pedido - v_producido);
--   v_stock := GREATEST(0, v_producido - v_pedido);
--   IF v_pedido = 0 AND v_producido = 0 THEN
--     DELETE FROM public.carrier_state WHERE channel_id = p_channel_id AND sku = p_sku;
--   ELSE
--     INSERT INTO public.carrier_state (channel_id, sku, pedido, producido, faltante, stock)
--     VALUES (p_channel_id, p_sku, v_pedido, v_producido, v_faltante, v_stock)
--     ON CONFLICT (channel_id, sku) DO UPDATE SET
--       pedido = EXCLUDED.pedido, producido = EXCLUDED.producido,
--       faltante = EXCLUDED.faltante, stock = EXCLUDED.stock, updated_at = now();
--   END IF;
-- END;
-- $func$;
--
-- Self-healing inverso: cualquier trigger sobre orders/logs recontamina
-- el carrier_state con el bug original. Cero pérdida de datos.
-- ════════════════════════════════════════════════════════════════════
