-- ════════════════════════════════════════════════════════════════════
-- PRODUCCIÓN — Fase 6.0: poblar prod_insumo (materia prima trazable)
-- ════════════════════════════════════════════════════════════════════
-- prod_insumo estaba VACÍO → la vista prod_v_materia_prima calculaba la
-- necesidad (vía explosión del BOM) pero sin nombre/categoría/unidad, y la
-- pestaña Stock del Encargado no mostraba nada.
--
-- Los SKUs de materia prima (tornillos, cajas, soportes, tapatornillos,
-- filo, varilla) YA existen en prod_pieza con su nombre (cargados con el
-- catálogo). Acá se DERIVAN a prod_insumo: nombre del catálogo; categoría/
-- sector/unidad por prefijo. Stock 0 y mínimo 0 (la fábrica los carga con
-- los remitos de ingreso — Fase 6.2; los mínimos los fija el negocio).
--
-- 100% derivado de datos ya cargados. NO necesita a Seba. Aditivo e
-- idempotente (ON CONFLICT DO NOTHING). La unidad de COMPRA y el factor
-- de conversión (ej. tornillos por caja) son Fase 6.1 — eso sí espera a
-- Seba — y no se tocan acá: prod_insumo guarda la unidad de CONSUMO.
-- ════════════════════════════════════════════════════════════════════

INSERT INTO public.prod_insumo (sku, nombre, categoria, sector, stock_actual, stock_minimo, unidad)
SELECT
  p.sku,
  p.nombre,
  CASE substring(p.sku from '^[A-Z]+')
    WHEN 'TOR' THEN 'Tornillería'
    WHEN 'CAJ' THEN 'Cajas'
    WHEN 'SOP' THEN 'Soportes'
    WHEN 'AGU' THEN 'Tapatornillos'
    WHEN 'FIL' THEN 'Filo'
    WHEN 'VAR' THEN 'Varilla'
  END AS categoria,
  CASE substring(p.sku from '^[A-Z]+')
    WHEN 'TOR' THEN 'carpinteria'
    WHEN 'SOP' THEN 'carpinteria'
    WHEN 'CAJ' THEN 'embalaje'
    WHEN 'AGU' THEN 'embalaje'
    WHEN 'FIL' THEN 'melamina'
    WHEN 'VAR' THEN 'pino'
  END AS sector,
  0 AS stock_actual,
  0 AS stock_minimo,
  CASE substring(p.sku from '^[A-Z]+')
    WHEN 'FIL' THEN 'metro'
    WHEN 'VAR' THEN 'barra'
    ELSE 'unidad'
  END AS unidad
FROM public.prod_pieza p
WHERE p.sku ~ '^(TOR|CAJ|SOP|AGU|FIL|VAR)[0-9]'
ON CONFLICT (sku) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual): DELETE FROM public.prod_insumo
--   WHERE sku ~ '^(TOR|CAJ|SOP|AGU|FIL|VAR)[0-9]';
-- ════════════════════════════════════════════════════════════════════
