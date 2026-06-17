-- ════════════════════════════════════════════════════════════════════
-- PRODUCCIÓN — Fase 5.5: vistas Compras + Orden por sector
-- ════════════════════════════════════════════════════════════════════
-- Cierra las 2 vistas que faltaban de §5.5 (las demás ya existen:
-- prod_v_explosion, prod_v_demanda_corte, prod_v_materia_prima, prod_v_resumen_dia).
--
-- 1) prod_v_compras — la "lista de compras". Seba (llamada): NO se convierte
--    a cajas/rollos; se trabaja en unidades de consumo ("qué se necesita y
--    listo"). Por eso es simplemente la materia prima con falta > 0.
--
-- 2) prod_v_orden_sector — qué le toca producir a cada sector hoy, derivado
--    de la explosión (reusa las vistas por sector ya existentes, sin
--    recalcular nada): CNC corta tapas · Melamina termina tapas (falta vs su
--    stock) · Pino hace patas · Embalaje arma los productos finales.
--
-- Solo lectura, derivadas, 100% aditivas. Grants = anon, authenticated
-- (igual que el resto de prod_v_*).
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.prod_v_compras AS
  SELECT sku, nombre, categoria, unidad, necesita, stock, falta
  FROM public.prod_v_materia_prima
  WHERE falta > 0;

GRANT SELECT ON public.prod_v_compras TO anon, authenticated;

CREATE OR REPLACE VIEW public.prod_v_orden_sector AS
  -- CNC: tapas a cortar
  SELECT 'cnc'::text AS sector, d.sku, pz.nombre, d.demanda::numeric AS cantidad
    FROM public.prod_v_demanda_corte d
    LEFT JOIN public.prod_pieza pz ON pz.sku = d.sku
    WHERE d.clase = 'tapa' AND d.demanda > 0
  UNION ALL
  -- Melamina: tapas a terminar (lo que falta sobre su propio stock)
  SELECT 'melamina'::text, m.pieza_sku, pz.nombre, m.falta::numeric
    FROM public.prod_v_prioridad_melamina m
    LEFT JOIN public.prod_pieza pz ON pz.sku = m.pieza_sku
    WHERE m.falta > 0
  UNION ALL
  -- Pino: patas a fabricar
  SELECT 'pino'::text, d.sku, pz.nombre, d.demanda::numeric
    FROM public.prod_v_demanda_corte d
    LEFT JOIN public.prod_pieza pz ON pz.sku = d.sku
    WHERE d.clase = 'pata' AND d.demanda > 0
  UNION ALL
  -- Embalaje: productos finales a armar
  SELECT 'embalaje'::text, r.producto_sku, r.nombre, r.pendiente::numeric
    FROM public.prod_v_resumen_dia r
    WHERE r.pendiente > 0;

GRANT SELECT ON public.prod_v_orden_sector TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual): DROP VIEW IF EXISTS public.prod_v_orden_sector;
--                    DROP VIEW IF EXISTS public.prod_v_compras;
-- ════════════════════════════════════════════════════════════════════
