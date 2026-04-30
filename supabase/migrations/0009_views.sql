-- ═══════════════════════════════════════════════════════════════════════════
-- 0009_views.sql — Vistas para el frontend
-- ───────────────────────────────────────────────────────────────────────────
-- 3 vistas:
--   - view_dashboard_kpis     → suma por canal de unidades activas (hero del dashboard)
--   - view_historico_dia      → por fecha y canal, total producido (calendario)
--   - view_carrier_with_meta  → carrier_state JOIN sku_catalog (tabla del carrier)
--
-- Las vistas heredan RLS de las tablas subyacentes — no requieren policies propias.
-- ═══════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────
-- 1. view_dashboard_kpis
-- ──────────────────────────────────────────────────────────────────────────
-- Devuelve por canal: unidades activas (pedido), faltante, producido_hoy.
-- Usado por el hero del dashboard + las 4 cards.

CREATE OR REPLACE VIEW public.view_dashboard_kpis AS
SELECT
  c.id            AS channel_id,
  c.label,
  c.color,
  c.tipo_cierre,
  c.cierre_hora,
  COALESCE(SUM(cs.pedido),    0) AS unidades_activas,
  COALESCE(SUM(cs.faltante),  0) AS faltante_total,
  COALESCE(SUM(cs.producido), 0) AS producido_total,
  COALESCE(SUM(cs.stock),     0) AS stock_total,
  COUNT(*) FILTER (WHERE cs.faltante > 0) AS skus_con_faltante,
  -- Producido hoy: SUM de prod_logs del día
  (
    SELECT COALESCE(SUM(pl.cantidad), 0)
    FROM public.production_logs pl
    WHERE pl.channel_id = c.id
      AND pl.fecha = current_date
  ) AS producido_hoy
FROM public.channels c
LEFT JOIN public.carrier_state cs ON cs.channel_id = c.id
GROUP BY c.id, c.label, c.color, c.tipo_cierre, c.cierre_hora;

COMMENT ON VIEW public.view_dashboard_kpis IS
  'KPIs por canal para dashboard. Una fila por canal con totales agregados de carrier_state + producido_hoy.';

-- ──────────────────────────────────────────────────────────────────────────
-- 2. view_historico_dia
-- ──────────────────────────────────────────────────────────────────────────
-- Devuelve por fecha + canal: total producido, total registros.
-- Usado por el calendario mensual del histórico.

CREATE OR REPLACE VIEW public.view_historico_dia AS
SELECT
  pl.fecha,
  pl.channel_id,
  c.label AS channel_label,
  c.color AS channel_color,
  COUNT(*)              AS registros,
  SUM(pl.cantidad)      AS unidades,
  COUNT(DISTINCT pl.sku) AS skus_distintos,
  COUNT(DISTINCT pl.operario_id) AS operarios_distintos
FROM public.production_logs pl
JOIN public.channels c ON c.id = pl.channel_id
GROUP BY pl.fecha, pl.channel_id, c.label, c.color;

COMMENT ON VIEW public.view_historico_dia IS
  'Por fecha + canal: total producido, registros, SKUs distintos, operarios distintos. Calendario del histórico.';

-- ──────────────────────────────────────────────────────────────────────────
-- 3. view_carrier_with_meta
-- ──────────────────────────────────────────────────────────────────────────
-- carrier_state + JOIN sku_catalog → ahorra round-trip al frontend.

CREATE OR REPLACE VIEW public.view_carrier_with_meta AS
SELECT
  cs.channel_id,
  cs.sku,
  sc.modelo,
  sc.color,
  sc.color_hex,
  sc.categoria,
  sc.es_fabricado,
  sc.activo AS sku_activo,
  cs.pedido,
  cs.producido,
  cs.faltante,
  cs.stock,
  cs.updated_at
FROM public.carrier_state cs
JOIN public.sku_catalog sc ON sc.sku = cs.sku
WHERE sc.activo = true;

COMMENT ON VIEW public.view_carrier_with_meta IS
  'carrier_state + metadata del catálogo. Para tabla principal del carrier sin tener que hacer join client-side. Solo SKUs activos.';

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Grants — permitir SELECT a authenticated (las RLS de tablas subyacentes
--    siguen aplicando)
-- ──────────────────────────────────────────────────────────────────────────
GRANT SELECT ON public.view_dashboard_kpis     TO authenticated;
GRANT SELECT ON public.view_historico_dia      TO authenticated;
GRANT SELECT ON public.view_carrier_with_meta  TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- FIN 0009_views.sql
-- ══════════════════════════════════════════════════════════════════════════
