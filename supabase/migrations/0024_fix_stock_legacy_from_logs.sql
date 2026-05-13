-- ════════════════════════════════════════════════════════════════════
-- FIX recompute_carrier_state_for v3 — stock_legacy desde LOGS REALES
-- (no desde snapshots inmutables) — bug correcciones post-cierre
-- ════════════════════════════════════════════════════════════════════
-- Bug reportado por cliente (2026-05-13): tras anular o corregir un
-- log post-cierre, el snapshot de la jornada cerrada quedaba
-- desfasado de la realidad (snapshot dice "producido=17, stock=14"
-- pero los logs reales son 0). El trigger v2 (migration 0020) leía
-- stock_legacy desde esos snapshots inmutables → carrier_state
-- mostraba stock fantasma → pedidos aparecían "cubiertos" sin haber
-- sido producidos.
--
-- Caso concreto detectado:
--   - Jornada colecta del 2026-05-11 cerrada con snapshot que decía
--     producido=17 de MAD096.
--   - Logs originales se borraron post-cierre (vía rpc_delete_batch_full,
--     rpc_correct_log o reset parcial — todos caminos válidos).
--   - Los logs físicos en colecta quedaron en 0, pero el snapshot
--     inmutable seguía diciendo "stock=14".
--   - El trigger v2 leía ese snapshot → stock fantasma de 14 en
--     colecta+MAD096 → faltante=0 → pedido "cubierto".
--
-- Cambio quirúrgico:
--   - SOLO recompute_carrier_state_for cambia.
--   - stock_legacy ahora se calcula como:
--       MAX(0, SUM(logs de jornadas cerradas) − SUM(orders archivadas))
--     Refleja la realidad operativa actual: lo producido
--     históricamente menos lo despachado/demandado históricamente.
--     Si se anulan logs post-cierre, el cálculo se ajusta solo
--     (los logs negativos compensatorios reducen el SUM).
--   - Los snapshots de jornadas cerradas SE PRESERVAN intactos —
--     solo dejan de ser fuente de verdad para el trigger; quedan
--     como artefacto histórico para UI/reportes de cierres pasados.
--   - rpc_close_jornada SIN CAMBIOS (su lógica está bien — el
--     snapshot se calcula desde logs reales en el momento del cierre).
--   - rpc_correct_log SIN CAMBIOS.
--   - Frontend SIN CAMBIOS al data path (los selects sobre
--     carrier_state no varían).
--   - Schema SIN CAMBIOS (cero ALTER TABLE).
--
-- Idempotente: CREATE OR REPLACE FUNCTION.
-- Self-healing: el próximo INSERT/UPDATE/DELETE sobre orders o
-- production_logs re-dispara los triggers existentes → carrier_state
-- se recalcula con la fórmula nueva → stock fantasma desaparece
-- sin migración de data.
--
-- Bonus: este fix también resuelve el gap residual reportado hoy
-- (pedido=71 colecta vs faltante=59, 12 unidades de gap). Cuando se
-- ejecute el primer recompute con la lógica nueva, el faltante se
-- ajusta al valor correcto (porque stock_legacy de colecta pasa a
-- ser 0 — los logs reales están en flex, no en colecta).
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
  v_pedido               int;
  v_producido            int;
  v_producido_historico  int;
  v_pedido_archivado     int;
  v_stock_legacy         int;
  v_faltante             int;
  v_stock                int;
BEGIN
  -- Pedido vigente: orders pendientes/arrastradas (sin cambio).
  SELECT COALESCE(SUM(cantidad), 0) INTO v_pedido
  FROM public.orders
  WHERE channel_id = p_channel_id
    AND sku = p_sku
    AND status IN ('pendiente', 'arrastrado');

  -- Producido (jornada activa + legacy con jornada_id NULL).
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

  -- Stock legacy v3: desde LOGS REALES de jornadas cerradas, no
  -- desde snapshots. Suma positivos y negativos:
  --   - Logs positivos: producción confirmada en jornadas cerradas.
  --   - Logs negativos [ANULADO]: anulaciones post-cierre por admin.
  --   - Logs negativos [CORREGIDO POST-CIERRE]: compensatorios de
  --     correcciones post-cierre (cantidad o canal).
  --   - Logs negativos [FREE_STOCK]: dispossitions al cerrar (stock
  --     reservado para futuros pedidos via tabla free_stock aparte).
  -- Cualquier corrección posterior se refleja automáticamente.
  SELECT COALESCE(SUM(pl.cantidad), 0) INTO v_producido_historico
  FROM public.production_logs pl
  INNER JOIN public.jornadas j ON j.id = pl.jornada_id
  WHERE pl.channel_id = p_channel_id
    AND pl.sku = p_sku
    AND j.status = 'cerrada';

  -- Demanda histórica absorbida: orders ya archivadas (cerradas con
  -- jornada). Incluye tanto las cumplidas como las que se
  -- arrastraron — para la lógica de stock_legacy, ambas representan
  -- demanda demandada por el cliente en su momento. Las arrastradas
  -- generan UNA NUEVA order ('arrastrado'/'pendiente') que ya
  -- contamos en v_pedido arriba, así que no hay double-count.
  SELECT COALESCE(SUM(cantidad), 0) INTO v_pedido_archivado
  FROM public.orders
  WHERE channel_id = p_channel_id
    AND sku = p_sku
    AND status = 'archivado';

  v_stock_legacy := GREATEST(0, v_producido_historico - v_pedido_archivado);

  -- Faltante: pedido vigente cubierto con producido jornada activa
  -- + stock_legacy histórico.
  v_faltante := GREATEST(0, v_pedido - v_producido - v_stock_legacy);

  -- Stock disponible total = stock_legacy + sobrante de jornada activa.
  v_stock := v_stock_legacy + GREATEST(0, v_producido - v_pedido);

  -- Limpiar fila zombi solo si todo está en 0.
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
-- ROLLBACK (manual, NO ejecutar sin entender la regresión a v2):
-- Restablecer la versión v2 (migration 0020) que lee stock_legacy
-- desde los snapshots inmutables — reintroduciría el bug de stock
-- fantasma post-correcciones, pero preserva el comportamiento
-- pre-2026-05-13.
--
-- CREATE OR REPLACE FUNCTION public.recompute_carrier_state_for(
--   p_channel_id text, p_sku text
-- ) RETURNS void
-- LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
-- AS $func$
-- DECLARE v_pedido int; v_producido int; v_stock_legacy int;
--         v_faltante int; v_stock int;
-- BEGIN
--   SELECT COALESCE(SUM(cantidad), 0) INTO v_pedido
--   FROM public.orders
--   WHERE channel_id = p_channel_id AND sku = p_sku
--     AND status IN ('pendiente','arrastrado');
--
--   SELECT GREATEST(0, COALESCE(SUM(pl.cantidad), 0)) INTO v_producido
--   FROM public.production_logs pl
--   WHERE pl.channel_id = p_channel_id AND pl.sku = p_sku
--     AND (pl.jornada_id IS NULL OR EXISTS (
--       SELECT 1 FROM public.jornadas j
--       WHERE j.id = pl.jornada_id AND j.status='abierta'));
--
--   SELECT COALESCE(SUM((e->>'stock')::int), 0) INTO v_stock_legacy
--   FROM public.jornadas j, jsonb_array_elements(j.snapshot) AS e
--   WHERE j.channel_id = p_channel_id AND j.status='cerrada'
--     AND jsonb_typeof(j.snapshot)='array' AND e->>'sku' = p_sku;
--
--   v_faltante := GREATEST(0, v_pedido - v_producido - v_stock_legacy);
--   v_stock := v_stock_legacy + GREATEST(0, v_producido - v_pedido);
--
--   IF v_pedido=0 AND v_producido=0 AND v_stock_legacy=0 THEN
--     DELETE FROM public.carrier_state
--     WHERE channel_id = p_channel_id AND sku = p_sku;
--   ELSE
--     INSERT INTO public.carrier_state
--       (channel_id, sku, pedido, producido, faltante, stock)
--     VALUES (p_channel_id, p_sku, v_pedido, v_producido, v_faltante, v_stock)
--     ON CONFLICT (channel_id, sku) DO UPDATE SET
--       pedido = EXCLUDED.pedido, producido = EXCLUDED.producido,
--       faltante = EXCLUDED.faltante, stock = EXCLUDED.stock,
--       updated_at = now();
--   END IF;
-- END; $func$;
-- ════════════════════════════════════════════════════════════════════
