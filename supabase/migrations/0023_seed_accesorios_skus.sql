-- ════════════════════════════════════════════════════════════════════
-- Carga inicial de 31 SKUs ACCESORIOS (piezas / repuestos)
-- ════════════════════════════════════════════════════════════════════
-- El cliente fabrica muebles. Cuando llegan piezas dañadas (una pata,
-- una tapa) necesita despachar solo el repuesto, no el mueble entero.
-- Estos repuestos requieren SKUs propios para poder ser cargados como
-- pedidos vía No Flex y Correo Argentino.
--
-- DECISIONES DEL CLIENTE (cargado tal cual, sin correcciones):
--   - Categoría: todos en "ACCESORIOS" (la migration 0022 la creó).
--   - Modelo: texto del Excel del cliente sin tocar typos ni espacios.
--     * TAP007/TAP009: espacio sobrante al final, intencional.
--     * TOR001/TOR004: "TORNILOS" con una sola L, intencional.
--   - color y color_hex: NULL en TODOS, no separar color del modelo.
--   - incompleto = TRUE en TODOS (cliente completa después foto/precio).
--   - activo = TRUE en TODOS.
--   - es_fabricado:
--       PATAS, SOPORTES, KITS, TAPAS → TRUE (los fabrica el cliente).
--       TORNILLOS, TAPA TORNILLOS    → FALSE (comprados).
--
-- IDEMPOTENCIA: cada INSERT con ON CONFLICT (sku) DO NOTHING.
-- Reaplicar la migration no rompe nada ni duplica filas.
--
-- ATOMICIDAD: la migration aplica en una sola transacción implícita.
-- Si cualquier INSERT viola un constraint inesperado (CHECK del regex
-- del SKU, FK rota, etc.), todo se revierte.
--
-- VERIFICACIÓN PREVIA: DO $$ ... RAISE EXCEPTION si ACCESORIOS no
-- existe (precondición declarada).
-- ════════════════════════════════════════════════════════════════════

-- Pre-check: ACCESORIOS debe existir en sku_categories
DO $mig$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.sku_categories WHERE name='ACCESORIOS') THEN
    RAISE EXCEPTION
      'Precondicion fallida: la categoria ACCESORIOS no existe en sku_categories. Aplicar 0022_fix_sku_category_atomic_upsert.sql primero.'
      USING ERRCODE='23503';
  END IF;
END $mig$;

-- ── PATAS (es_fabricado=TRUE) ──────────────────────────────────────
INSERT INTO public.sku_catalog (sku, modelo, color, color_hex, categoria, es_fabricado, activo, incompleto) VALUES
  ('PAT001', 'PATA CHICA',                   NULL, NULL, 'ACCESORIOS', TRUE, TRUE, TRUE),
  ('PAT002', 'PATA GRANDE',                  NULL, NULL, 'ACCESORIOS', TRUE, TRUE, TRUE),
  ('PAT003', 'SET PATAS CHICAS',             NULL, NULL, 'ACCESORIOS', TRUE, TRUE, TRUE),
  ('PAT004', 'SET PATAS GRANDES',            NULL, NULL, 'ACCESORIOS', TRUE, TRUE, TRUE),
  ('PAT005', 'SET PATAS CHICAS Y GRANDES',   NULL, NULL, 'ACCESORIOS', TRUE, TRUE, TRUE)
ON CONFLICT (sku) DO NOTHING;

-- ── SOPORTES (es_fabricado=TRUE) ───────────────────────────────────
INSERT INTO public.sku_catalog (sku, modelo, color, color_hex, categoria, es_fabricado, activo, incompleto) VALUES
  ('SOP001', 'SOPORTE BLANCO', NULL, NULL, 'ACCESORIOS', TRUE, TRUE, TRUE),
  ('SOP002', 'SOPORTE NEGRO',  NULL, NULL, 'ACCESORIOS', TRUE, TRUE, TRUE)
ON CONFLICT (sku) DO NOTHING;

-- ── KITS DE INSTALACIÓN (es_fabricado=TRUE) ────────────────────────
INSERT INTO public.sku_catalog (sku, modelo, color, color_hex, categoria, es_fabricado, activo, incompleto) VALUES
  ('KIT001', 'KIT INSTALACION SET',           NULL, NULL, 'ACCESORIOS', TRUE, TRUE, TRUE),
  ('KIT002', 'KIT INSTALACION RECTANGULAR',   NULL, NULL, 'ACCESORIOS', TRUE, TRUE, TRUE),
  ('KIT003', 'KIT INSTALACION YORI',          NULL, NULL, 'ACCESORIOS', TRUE, TRUE, TRUE),
  ('KIT004', 'KIT INSTALACION HIKARI X 1',    NULL, NULL, 'ACCESORIOS', TRUE, TRUE, TRUE),
  ('KIT005', 'KIT INSTALACION HIKARI X 2',    NULL, NULL, 'ACCESORIOS', TRUE, TRUE, TRUE)
ON CONFLICT (sku) DO NOTHING;

-- ── TAPAS (es_fabricado=TRUE) ──────────────────────────────────────
-- TAP007 y TAP009 tienen espacio sobrante al final intencional (decisión cliente).
INSERT INTO public.sku_catalog (sku, modelo, color, color_hex, categoria, es_fabricado, activo, incompleto) VALUES
  ('TAP001', 'REDONDA 30 BLANCO',                NULL, NULL, 'ACCESORIOS', TRUE, TRUE, TRUE),
  ('TAP002', 'REDONDA 30 NEGRO',                 NULL, NULL, 'ACCESORIOS', TRUE, TRUE, TRUE),
  ('TAP003', 'REDONDA 40 BLANCO',                NULL, NULL, 'ACCESORIOS', TRUE, TRUE, TRUE),
  ('TAP004', 'REDONDA 40 NEGRO',                 NULL, NULL, 'ACCESORIOS', TRUE, TRUE, TRUE),
  ('TAP005', 'REDONDA 50 BLANCO',                NULL, NULL, 'ACCESORIOS', TRUE, TRUE, TRUE),
  ('TAP006', 'REDONDA 50 NEGRO',                 NULL, NULL, 'ACCESORIOS', TRUE, TRUE, TRUE),
  ('TAP007', 'REDONDA 40 SIMIL MARMOL BLANCO ',  NULL, NULL, 'ACCESORIOS', TRUE, TRUE, TRUE),
  ('TAP008', 'REDONDA 40 SIMIL MARMOL NEGRO',    NULL, NULL, 'ACCESORIOS', TRUE, TRUE, TRUE),
  ('TAP009', 'REDONDA 50 SIMIL MARMOL BLANCO ',  NULL, NULL, 'ACCESORIOS', TRUE, TRUE, TRUE),
  ('TAP010', 'REDONDA 50 SIMIL MARMOL NEGRO',    NULL, NULL, 'ACCESORIOS', TRUE, TRUE, TRUE),
  ('TAP011', 'BOOMERANG BLANCO',                 NULL, NULL, 'ACCESORIOS', TRUE, TRUE, TRUE),
  ('TAP012', 'BOOMERANG NEGRO',                  NULL, NULL, 'ACCESORIOS', TRUE, TRUE, TRUE)
ON CONFLICT (sku) DO NOTHING;

-- ── TORNILLOS (es_fabricado=FALSE — comprados) ─────────────────────
-- TOR001 y TOR004 dicen "TORNILOS" (una sola L) intencional (cliente).
INSERT INTO public.sku_catalog (sku, modelo, color, color_hex, categoria, es_fabricado, activo, incompleto) VALUES
  ('TOR001', 'TORNILOS DE SOPORTE DE PATA',  NULL, NULL, 'ACCESORIOS', FALSE, TRUE, TRUE),
  ('TOR002', 'TORNILLOS DE SOPORTE DE TAPA', NULL, NULL, 'ACCESORIOS', FALSE, TRUE, TRUE),
  ('TOR003', 'TORNILLOS DE YORI',            NULL, NULL, 'ACCESORIOS', FALSE, TRUE, TRUE),
  ('TOR004', 'TORNILOS HIKARI',              NULL, NULL, 'ACCESORIOS', FALSE, TRUE, TRUE)
ON CONFLICT (sku) DO NOTHING;

-- ── TAPA TORNILLOS (es_fabricado=FALSE — comprados) ────────────────
INSERT INTO public.sku_catalog (sku, modelo, color, color_hex, categoria, es_fabricado, activo, incompleto) VALUES
  ('AGU001', 'TAPA TORNILLOS YORI',         NULL, NULL, 'ACCESORIOS', FALSE, TRUE, TRUE),
  ('AGU002', 'TAPA TORNILLOS HIKARI X 1',   NULL, NULL, 'ACCESORIOS', FALSE, TRUE, TRUE),
  ('AGU003', 'TAPA TORNILLOS HIKARI X 2',   NULL, NULL, 'ACCESORIOS', FALSE, TRUE, TRUE)
ON CONFLICT (sku) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual, NO ejecutar sin verificar):
-- DELETE FROM public.sku_catalog WHERE sku IN (
--   'PAT001','PAT002','PAT003','PAT004','PAT005',
--   'SOP001','SOP002',
--   'KIT001','KIT002','KIT003','KIT004','KIT005',
--   'TAP001','TAP002','TAP003','TAP004','TAP005','TAP006',
--   'TAP007','TAP008','TAP009','TAP010','TAP011','TAP012',
--   'TOR001','TOR002','TOR003','TOR004',
--   'AGU001','AGU002','AGU003'
-- );
--
-- Pre-condición del rollback: ningún pedido (orders) ni log de
-- producción (production_logs) debe referenciar estos SKUs, sino la
-- FK con ON DELETE RESTRICT bloquea el DELETE. En ese caso, deactivar
-- vía UPDATE sku_catalog SET activo=FALSE WHERE sku IN (...) en lugar
-- de borrar.
-- ════════════════════════════════════════════════════════════════════
