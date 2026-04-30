-- ════════════════════════════════════════════════════════════════════
-- FIX: nombres cortos del catálogo según la lista del cliente
-- ────────────────────────────────────────────────────────────────────
-- Cómo correr:
--   1. Abrir Supabase Studio → SQL Editor
--   2. Pegar este archivo
--   3. Run
--   4. Verificar al final con el SELECT que ya viene incluido
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Mesas redondas ────────────────────────────────────────────────────
UPDATE public.sku_catalog SET modelo = 'Mesa Nórdica Petiribi'   , color = 'Blanco' WHERE sku = 'MAD050';
UPDATE public.sku_catalog SET modelo = 'Mesa Redonda'            , color = 'Blanco' WHERE sku = 'MAD051';
UPDATE public.sku_catalog SET modelo = 'Mesa Redonda'            , color = 'Negro'  WHERE sku = 'MAD052';

-- ── Sets Gota ─────────────────────────────────────────────────────────
UPDATE public.sku_catalog SET modelo = 'Set Gota'                , color = 'Blanco' WHERE sku = 'MAD061';
UPDATE public.sku_catalog SET modelo = 'Set Gota'                , color = 'Negro'  WHERE sku = 'MAD062';

-- ── Sets Redonda ──────────────────────────────────────────────────────
UPDATE public.sku_catalog SET modelo = 'Set Redonda'             , color = 'Blanco' WHERE sku = 'MAD095';
UPDATE public.sku_catalog SET modelo = 'Set Redonda'             , color = 'Negro'  WHERE sku = 'MAD096';

-- ── Mesa Púas/Gota (no estaba en la lista del cliente — mantengo) ────
UPDATE public.sku_catalog SET modelo = 'Mesa Púas/Gota Madera'   , color = 'Negro'  WHERE sku = 'MAD155';

-- ── Sets Simil Mármol ─────────────────────────────────────────────────
UPDATE public.sku_catalog SET modelo = 'Set Redonda Simil Marmol', color = 'Blanco' WHERE sku = 'MAD190';
UPDATE public.sku_catalog SET modelo = 'Set Redonda Simil Marmol', color = 'Negro'  WHERE sku = 'MAD191';

-- ── Rectangulares ─────────────────────────────────────────────────────
UPDATE public.sku_catalog SET modelo = 'Rectangular'             , color = 'Negro'  WHERE sku = 'MAD200';
UPDATE public.sku_catalog SET modelo = 'Rectangular'             , color = 'Blanco' WHERE sku = 'MAD201';

-- ── Recibidoras / Boomerang ───────────────────────────────────────────
UPDATE public.sku_catalog SET modelo = 'Yori'                    , color = NULL     WHERE sku = 'MAD300';
UPDATE public.sku_catalog SET modelo = 'Bumerang'                , color = 'Blanco' WHERE sku = 'MAD301';
UPDATE public.sku_catalog SET modelo = 'Boomerang'               , color = 'Negro'  WHERE sku = 'MAD302';

-- ── Set XL ────────────────────────────────────────────────────────────
UPDATE public.sku_catalog SET modelo = 'Set XL'                  , color = 'Negro'  WHERE sku = 'MAD303';
UPDATE public.sku_catalog SET modelo = 'Set XL'                  , color = 'Blanco' WHERE sku = 'MAD304';

-- ── Luz ───────────────────────────────────────────────────────────────
UPDATE public.sku_catalog SET modelo = 'Hikari'                  , color = NULL     WHERE sku = 'MAD401';

COMMIT;

-- Verificar resultado
SELECT sku, modelo, color FROM public.sku_catalog ORDER BY sku;
