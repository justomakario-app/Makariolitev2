-- ════════════════════════════════════════════════════════════════════
-- PRODUCCIÓN EN LÍNEA — Fase 5a: árbol de despiece recursivo + explosión
-- (Brief Lógica 2 · §4.2, §5, §6) — TODO ADITIVO, no toca nada existente.
-- ════════════════════════════════════════════════════════════════════
-- 1. prod_componente: el BOM unificado padre→hijo a cualquier profundidad.
--    Reemplaza las 4 hojas del Excel por una sola estructura recursiva.
-- 2. prod_v_explosion: estalla las ventas pendientes por el árbol,
--    multiplicando cantidades, hasta las hojas. Guarda de profundidad (<20)
--    para no colgar ante datos con ciclos.
-- 3. Salidas: demanda de piezas de corte (TAP + patas) y materia prima.
--
-- NOTA: los optimizadores de corte (placas combos / lineal cutting-stock,
-- §7) son Fase 5b — algoritmos dedicados (Edge Functions) que necesitan el
-- catálogo real cargado para validarse.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Árbol de despiece recursivo (BOM unificado) ──────────────────
CREATE TABLE IF NOT EXISTS public.prod_componente (
  padre_sku text NOT NULL,
  hijo_sku  text NOT NULL,
  cantidad  int  NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (padre_sku, hijo_sku)
);
COMMENT ON TABLE public.prod_componente IS 'Brief Lógica 2 §4.2 — BOM recursivo: el SKU padre se compone de cantidad×hijo. Una sola estructura para todo el árbol.';

ALTER TABLE public.prod_componente ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prod_componente_sel ON public.prod_componente;
CREATE POLICY prod_componente_sel ON public.prod_componente
  FOR SELECT TO authenticated
  USING (public.current_user_role() IN ('cnc','melamina','pino','embalaje','encargado','owner','admin'));

DROP POLICY IF EXISTS prod_componente_ins ON public.prod_componente;
CREATE POLICY prod_componente_ins ON public.prod_componente
  FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() IN ('owner','admin'));

DROP POLICY IF EXISTS prod_componente_upd ON public.prod_componente;
CREATE POLICY prod_componente_upd ON public.prod_componente
  FOR UPDATE TO authenticated
  USING (public.current_user_role() IN ('owner','admin'))
  WITH CHECK (public.current_user_role() IN ('owner','admin'));

DROP POLICY IF EXISTS prod_componente_del ON public.prod_componente;
CREATE POLICY prod_componente_del ON public.prod_componente
  FOR DELETE TO authenticated
  USING (public.current_user_role() IN ('owner','admin'));

-- ── 2. Motor de explosión (vista recursiva) ─────────────────────────
-- Demanda neta por producto = pedidos no despachados − producido (carrier_state),
-- igual que prod_v_demanda_tap. Luego baja por prod_componente multiplicando.
CREATE OR REPLACE VIEW public.prod_v_explosion AS
WITH RECURSIVE neto AS (
  SELECT o.sku, o.channel_id, sum(o.cantidad) AS pedido
  FROM public.orders o
  WHERE o.status::text <> 'despachado'
  GROUP BY o.sku, o.channel_id
),
base AS (
  SELECT n.sku AS sku,
         sum(GREATEST(n.pedido - COALESCE(cs.producido, 0), 0))::numeric AS qty
  FROM neto n
  LEFT JOIN public.carrier_state cs ON cs.channel_id = n.channel_id AND cs.sku = n.sku
  GROUP BY n.sku
  HAVING sum(GREATEST(n.pedido - COALESCE(cs.producido, 0), 0)) > 0
),
expl AS (
  SELECT b.sku, b.qty, 0 AS nivel
  FROM base b
  UNION ALL
  SELECT c.hijo_sku, e.qty * c.cantidad, e.nivel + 1
  FROM expl e
  JOIN public.prod_componente c ON c.padre_sku = e.sku
  WHERE e.nivel < 20                         -- guarda anti-ciclos
)
SELECT x.sku,
       sum(x.qty)::int AS demanda,
       max(x.nivel)    AS nivel_max,
       (x.sku NOT IN (SELECT DISTINCT padre_sku FROM public.prod_componente)) AS es_hoja
FROM expl x
GROUP BY x.sku;

COMMENT ON VIEW public.prod_v_explosion IS 'Brief Lógica 2 §5 — explosión: demanda total de cada SKU (a todos los niveles) derivada de las ventas pendientes vía el BOM recursivo.';

-- ── 3a. Demanda de piezas de CORTE (tapas + patas) ──────────────────
-- Tapas (TAP, salen de placa) y patas hoja (PAT001/PAT002, salen de listón).
CREATE OR REPLACE VIEW public.prod_v_demanda_corte AS
SELECT e.sku,
       e.demanda,
       CASE WHEN e.sku LIKE 'TAP%' THEN 'tapa' ELSE 'pata' END AS clase
FROM public.prod_v_explosion e
WHERE e.sku LIKE 'TAP%'
   OR (e.es_hoja AND e.sku LIKE 'PAT%');

COMMENT ON VIEW public.prod_v_demanda_corte IS 'Brief Lógica 2 §6.2 — piezas de corte (tapas + patas) que van a los optimizadores de corte, no a compras.';

-- ── 3b. Materia prima a reponer (insumos hoja vs stock) ──────────────
-- Hojas del árbol que NO son corte ni producto → se compran. Cruza contra
-- prod_insumo para el faltante. (Las unidades de compra son Fase 6.)
CREATE OR REPLACE VIEW public.prod_v_materia_prima AS
SELECT e.sku,
       i.nombre,
       i.categoria,
       i.unidad,
       e.demanda                                            AS necesita,
       COALESCE(i.stock_actual, 0)::int                     AS stock,
       GREATEST(e.demanda - COALESCE(i.stock_actual, 0), 0)::int AS falta
FROM public.prod_v_explosion e
LEFT JOIN public.prod_insumo i ON i.sku = e.sku
WHERE e.es_hoja
  AND e.sku NOT LIKE 'MAD%'
  AND e.sku NOT LIKE 'TAP%'
  AND e.sku NOT LIKE 'PAT%';

COMMENT ON VIEW public.prod_v_materia_prima IS 'Brief Lógica 2 §6.2/§8 — insumos hoja a reponer: demanda explotada vs stock = faltante (lista de compras base).';

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual):
--   DROP VIEW IF EXISTS public.prod_v_materia_prima;
--   DROP VIEW IF EXISTS public.prod_v_demanda_corte;
--   DROP VIEW IF EXISTS public.prod_v_explosion;
--   DROP TABLE IF EXISTS public.prod_componente;
-- ════════════════════════════════════════════════════════════════════
