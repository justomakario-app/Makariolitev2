-- ════════════════════════════════════════════════════════════════════
-- PRODUCCIÓN — Fase 5.0: atributos de SKU (Brief Lógica 2 §4.1, §8.1)
-- ════════════════════════════════════════════════════════════════════
-- Enriquece el catálogo con los atributos que el brief pide para clasificar
-- cada SKU. Hoy prod_pieza solo tiene (sku, nombre) y prod_producto los
-- atributos de mesa. Se agregan (aditivo, IF NOT EXISTS) y se POBLAN por
-- derivación del prefijo (no hay que pedir nada a Seba):
--
--   naturaleza  fabricado | corte | insumo | reventa
--   vendible    aparece en el catálogo de venta (B2B) — solo los productos
--   unidad_compra  se compra (insumo) → suma stock por remito
--   contenido_compra  unidades de consumo por unidad de compra (ej. filo
--                     rollo = 50 m). Seba: tornillos NO se desglosan por caja.
--   largo       cm de la barra/material que se corta (varilla 1 m = 100 cm)
--
-- Derivación (mejor lógica; corregible sin romper nada):
--   MAD*  → fabricado, vendible            (productos finales)
--   TAP*  → corte (se corta de placa)
--   PAT001/002 → corte (pino corta de listón/varilla)
--   PAT003/004/005, KIT* → fabricado (ensamblados)
--   SOP/TOR/AGU/CAJ/FIL/VAR → insumo, unidad_compra
--   FIL → contenido_compra 50 (rollo 50 m) · VAR → largo 100 (barra 1 m)
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.prod_pieza
  ADD COLUMN IF NOT EXISTS naturaleza       text,
  ADD COLUMN IF NOT EXISTS vendible         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS unidad_compra    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contenido_compra numeric,
  ADD COLUMN IF NOT EXISTS largo            numeric;  -- cm (material que se corta)

ALTER TABLE public.prod_producto
  ADD COLUMN IF NOT EXISTS naturaleza text    NOT NULL DEFAULT 'fabricado',
  ADD COLUMN IF NOT EXISTS vendible   boolean NOT NULL DEFAULT true;

-- ── Poblar naturaleza de las piezas ──
UPDATE public.prod_pieza SET naturaleza = CASE
  WHEN sku LIKE 'TAP%'              THEN 'corte'
  WHEN sku IN ('PAT001','PAT002')  THEN 'corte'
  WHEN sku LIKE 'PAT%'             THEN 'fabricado'
  WHEN sku LIKE 'KIT%'             THEN 'fabricado'
  WHEN sku LIKE 'SOP%'             THEN 'insumo'
  WHEN sku LIKE 'TOR%'             THEN 'insumo'
  WHEN sku LIKE 'AGU%'             THEN 'insumo'
  WHEN sku LIKE 'CAJ%'             THEN 'insumo'
  WHEN sku LIKE 'FIL%'             THEN 'insumo'
  WHEN sku LIKE 'VAR%'             THEN 'insumo'
  ELSE naturaleza END;

-- ── unidad de compra = insumos comprados ──
UPDATE public.prod_pieza SET unidad_compra = true
  WHERE sku ~ '^(SOP|TOR|AGU|CAJ|FIL|VAR)[0-9]';

-- ── contenido / largo conocidos ──
UPDATE public.prod_pieza SET contenido_compra = 50 WHERE sku LIKE 'FIL%';   -- rollo 50 m
UPDATE public.prod_pieza SET largo = 100            WHERE sku LIKE 'VAR%';  -- barra 1 m

-- (productos quedan fabricado/vendible por DEFAULT)

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual):
--   ALTER TABLE public.prod_pieza DROP COLUMN naturaleza, DROP COLUMN vendible,
--     DROP COLUMN unidad_compra, DROP COLUMN contenido_compra, DROP COLUMN largo;
--   ALTER TABLE public.prod_producto DROP COLUMN naturaleza, DROP COLUMN vendible;
-- ════════════════════════════════════════════════════════════════════
