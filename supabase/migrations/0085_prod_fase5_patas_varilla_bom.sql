-- ════════════════════════════════════════════════════════════════════
-- PRODUCCIÓN — Fase 5.0/5b: patas y varilla al BOM (prod_componente)
-- ════════════════════════════════════════════════════════════════════
-- HALLAZGO (llamada con Seba + verificación): el motor saca la demanda de
-- patas de los COMPONENTES PAT del BOM (prod_v_demanda_corte usa
-- `es_hoja AND sku ~~ 'PAT%'`), NO del atributo prod_producto.patas_cant
-- que se cargó en 0081. Hoy casi ningún producto genera demanda de patas
-- porque las patas no están en el BOM. Acá se agregan como componentes.
--
-- Estructura de patas ya cargada: PAT001=1 chica, PAT002=1 grande,
-- PAT003=3 chicas, PAT004=3 grandes, PAT005=PAT003+PAT004 (3+3).
--
-- LÓGICA (regla validada por el único dato dado, SET REDONDA = PAT005):
-- cada SET = 2 mesas; sus patas = suma de las patas de esas 2 mesas
-- (3 por mesa). Tapa→pata de las mesas simples (derivado en 0081):
--   redonda 30/50 = grande · redonda 40 = chica · boomerang = chica ·
--   gota (incl. XL) = chica · rectangular = grande (×4).
-- Varilla: Yori/Hikari usan VAR002 (25 mm); la de 14 mm es de veladores
-- (fuera del sistema). Barras de 1 m: Yori 85 cm/pata → 1 pata/barra → 4
-- patas = 4 barras; Hikari 45 cm/pata → 2 patas/barra → 4 patas = 2 barras.
--
-- Aditivo e idempotente (ON CONFLICT (padre_sku,hijo_sku) DO UPDATE).
-- SET REDONDA (MAD095/096) ya tenía PAT005 → no se toca.
-- ════════════════════════════════════════════════════════════════════

INSERT INTO public.prod_componente (padre_sku, hijo_sku, cantidad) VALUES
  -- ── Mesas simples ──
  ('MAD010','PAT004',1), ('MAD011','PAT004',1),   -- redonda 30 → 3 grandes
  ('MAD020','PAT003',1), ('MAD021','PAT003',1),   -- redonda 40 → 3 chicas
  ('MAD030','PAT003',1), ('MAD031','PAT003',1),   -- boomerang → 3 chicas
  ('MAD040','PAT003',1), ('MAD041','PAT003',1),   -- gota XL → 3 chicas
  ('MAD051','PAT004',1), ('MAD052','PAT004',1),   -- redonda 50 → 3 grandes
  ('MAD200','PAT002',4), ('MAD201','PAT002',4),   -- rectangular → 4 grandes
  -- ── Sets (suma de las 2 mesas) ──
  ('MAD061','PAT003',2), ('MAD062','PAT003',2),   -- SET GOTA (gota+gota) → 6 chicas
  ('MAD190','PAT005',1), ('MAD191','PAT005',1),   -- SET REDONDA MARMOL (40+50) → 3 chicas + 3 grandes
  ('MAD301','PAT005',1), ('MAD302','PAT005',1),   -- BUMERANG (redonda30 + boomerang) → 3 grandes + 3 chicas
  ('MAD303','PAT003',2), ('MAD304','PAT003',2),   -- SET XL (gota XL ×2) → 6 chicas
  ('MAD350','PAT003',2), ('MAD351','PAT003',2),   -- SET DOBLE BOOM (boomerang ×2) → 6 chicas
  -- ── Yori / Hikari (varilla 25 mm) ──
  ('MAD300','VAR002',4),                          -- YORI → 4 barras (85 cm/pata)
  ('MAD401','VAR002',2)                           -- HIKARI → 2 barras (45 cm/pata, 2 patas/barra)
ON CONFLICT (padre_sku, hijo_sku) DO UPDATE SET cantidad = EXCLUDED.cantidad;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual): DELETE FROM public.prod_componente WHERE
--   (padre_sku, hijo_sku) IN (
--     ('MAD010','PAT004'),('MAD011','PAT004'),('MAD020','PAT003'),('MAD021','PAT003'),
--     ('MAD030','PAT003'),('MAD031','PAT003'),('MAD040','PAT003'),('MAD041','PAT003'),
--     ('MAD051','PAT004'),('MAD052','PAT004'),('MAD200','PAT002'),('MAD201','PAT002'),
--     ('MAD061','PAT003'),('MAD062','PAT003'),('MAD190','PAT005'),('MAD191','PAT005'),
--     ('MAD301','PAT005'),('MAD302','PAT005'),('MAD303','PAT003'),('MAD304','PAT003'),
--     ('MAD350','PAT003'),('MAD351','PAT003'),('MAD300','VAR002'),('MAD401','VAR002'));
-- ════════════════════════════════════════════════════════════════════
