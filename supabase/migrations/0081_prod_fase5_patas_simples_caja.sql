-- ════════════════════════════════════════════════════════════════════
-- PRODUCCIÓN — Fase 5.0 (parcial): patas de mesas simples + caja Hikari
-- ════════════════════════════════════════════════════════════════════
-- Aplica lo que se DEDUJO del catálogo (receta→tapa→placa) + datos ya
-- dados por Seba, sin tocar el .xlsx ni hacer updates sueltos a mano.
--
-- patas_tipo usa 'chica'/'grande' para casar con prod_stock_patas.tamano
-- (PAT001 = chica, PAT002 = grande). Cada mesa lleva 3 patas; rectangular 4.
--
-- PENDIENTE de Seba (NO se tocan acá): patas de los SETs (la suma simple
-- no cierra — SET XL = 2 gota XL pero usa PAT001 y PAT002), y hikari/yori
-- (patas de varilla). Esos quedan con patas_cant=0 hasta la respuesta.
-- 100% sobre datos ya cargados; reversible.
-- ════════════════════════════════════════════════════════════════════

-- Redonda 30 (MAD010/011) y Redonda 50 (MAD051/052 = "MESA REDONDA", su
-- receta usa TAP005/006 que son las de 50) → PAT002 (grande) ×3
UPDATE public.prod_producto SET patas_tipo='grande', patas_cant=3
  WHERE sku IN ('MAD010','MAD011','MAD051','MAD052');

-- Redonda 40 (MAD020/021), Boomerang (MAD030/031), Gota XL (MAD040/041)
--   → PAT001 (chica) ×3
UPDATE public.prod_producto SET patas_tipo='chica', patas_cant=3
  WHERE sku IN ('MAD020','MAD021','MAD030','MAD031','MAD040','MAD041');

-- Rectangular (MAD200/201) → PAT002 (grande) ×4
UPDATE public.prod_producto SET patas_tipo='grande', patas_cant=4
  WHERE sku IN ('MAD200','MAD201');

-- Corrección de la caja del Hikari (Seba): Caja N°2 → N°1
UPDATE public.prod_producto SET kit_embalaje = jsonb_build_object('caja','N°1')
  WHERE sku='MAD401';

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual): volver patas_tipo/patas_cant a NULL/0 en esos SKUs
-- y kit_embalaje del MAD401 a {"caja":"N°2"}.
-- ════════════════════════════════════════════════════════════════════
