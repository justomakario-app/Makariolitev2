-- ═══════════════════════════════════════════════════════════════════════════
-- seed.sql — DATA DE DEMO (NO obligatoria para producción)
-- ───────────────────────────────────────────────────────────────────────────
-- Carga los 18 SKUs del mock (window.SKU_DB en mock.js).
-- Para correr: aplicar manualmente vía MCP / Supabase CLI / dashboard.
-- En producción: si Aarón pasa el SKU DE PRODUCTOS.xlsx real, reemplazar este
-- archivo con el catálogo verdadero antes de seedear.
--
-- Idempotente: ON CONFLICT (sku) DO UPDATE.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.sku_catalog (sku, modelo, color, color_hex, categoria, es_fabricado, activo) VALUES
  ('MAD050', 'Mesa Nórdica Blanca Petiribi',     'Blanco', '#ffffff', 'Mesas',       true, true),
  ('MAD051', 'Mesa Redonda Negra',               'Negro',  '#1a1a1a', 'Mesas',       true, true),
  ('MAD052', 'Mesa Redonda Negra',               'Negro',  '#1a1a1a', 'Mesas',       true, true),
  ('MAD061', 'Set Gota Blanco',                  'Blanco', '#ffffff', 'Mesas',       true, true),
  ('MAD062', 'Set Gota Negra',                   'Negro',  '#1a1a1a', 'Mesas',       true, true),
  ('MAD095', 'Set Redonda Blanco',               'Blanco', '#ffffff', 'Mesas',       true, true),
  ('MAD096', 'Set Redonda Negra',                'Negro',  '#1a1a1a', 'Mesas',       true, true),
  ('MAD155', 'Mesa Púas/Gota Madera Negro',      'Negro',  '#1a1a1a', 'Mesas',       true, true),
  ('MAD190', 'Set Redonda Simil Marmol Blanco',  'Blanco', '#ffffff', 'Mesas',       true, true),
  ('MAD191', 'Set Redonda Simil Marmol Negra',   'Negro',  '#1a1a1a', 'Mesas',       true, true),
  ('MAD200', 'Rectangular Negra',                'Negro',  '#1a1a1a', 'Ratonas',     true, true),
  ('MAD201', 'Rectangular Blanco',               'Blanco', '#ffffff', 'Ratonas',     true, true),
  ('MAD300', 'Yori',                             NULL,     NULL,      'Recibidoras', true, true),
  ('MAD301', 'Bumerang Blanco',                  'Blanco', '#ffffff', 'Ratonas',     true, true),
  ('MAD302', 'Boomerang Negra',                  'Negro',  '#1a1a1a', 'Ratonas',     true, true),
  ('MAD303', 'Set XL Negra',                     'Negro',  '#1a1a1a', 'Mesas',       true, true),
  ('MAD304', 'Set XL Blanco',                    'Blanco', '#ffffff', 'Mesas',       true, true),
  ('MAD401', 'Hikari',                           NULL,     NULL,      'Luz',         true, true)
ON CONFLICT (sku) DO UPDATE SET
  modelo       = EXCLUDED.modelo,
  color        = EXCLUDED.color,
  color_hex    = EXCLUDED.color_hex,
  categoria    = EXCLUDED.categoria,
  es_fabricado = EXCLUDED.es_fabricado,
  activo       = EXCLUDED.activo;
