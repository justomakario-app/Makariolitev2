-- ════════════════════════════════════════════════════════════════════
-- PRODUCCIÓN — Fix de refs de KIT (Yori/Hikari/Rectangular) · cabo 0.2 #8
-- ════════════════════════════════════════════════════════════════════
-- Los kits de instalación de Yori/Hikari apuntaban al tornillo equivocado
-- (TOR005/006 = tornillos de RECTANGULAR), y el kit Rectangular Blanco
-- estaba incompleto. Esto hacía que la explosión NO diera exacto. Hay SKUs
-- dedicados cuyos nombres lo dejan sin ambigüedad:
--   TOR009 "TORNILLOS DE YORI" · TOR010 "TORNILOS HIKARI" · TOR011 "HIKARI X 2"
--   AGU005 "TAPA TORNILLOS HIKARI X 2 BLANCO"
--
-- Correcciones (derivadas de los nombres, sin Seba):
--   KIT003 (RECTANGULAR BLANCO, usa MAD201): faltaban TOR005+TOR006 → se agregan (espeja a KIT004 negro)
--   KIT005 (YORI, MAD300):   TOR005 → TOR009
--   KIT006 (HIKARI, MAD401): TOR006 → TOR010
--   KIT007 (HIKARI X2, sin uso hoy): TOR006 x2 → TOR011 x1 ; AGU004 x2 → AGU005 x1
-- ════════════════════════════════════════════════════════════════════

-- KIT003: completar los tornillos del rectangular blanco
INSERT INTO public.prod_componente (padre_sku, hijo_sku, cantidad) VALUES
  ('KIT003','TOR005',1), ('KIT003','TOR006',1)
ON CONFLICT (padre_sku, hijo_sku) DO NOTHING;

-- Limpieza de la causa raíz: una pieza fantasma con SKU '1' (fila del Excel
-- mal parseada) se quedó como "padre" con TOR005+TOR006 — eran los tornillos
-- del rectangular blanco (KIT003), que arriba ya se recuperan. Se elimina el
-- fantasma y sus aristas (no lo referencia ningún producto como hijo).
DELETE FROM public.prod_componente WHERE padre_sku = '1';
DELETE FROM public.prod_pieza WHERE sku = '1';

-- KIT005 (Yori): tornillo rectangular → tornillo de Yori
DELETE FROM public.prod_componente WHERE padre_sku='KIT005' AND hijo_sku='TOR005';
INSERT INTO public.prod_componente (padre_sku, hijo_sku, cantidad) VALUES ('KIT005','TOR009',1)
ON CONFLICT (padre_sku, hijo_sku) DO UPDATE SET cantidad = EXCLUDED.cantidad;

-- KIT006 (Hikari): tornillo rectangular → tornillo Hikari
DELETE FROM public.prod_componente WHERE padre_sku='KIT006' AND hijo_sku='TOR006';
INSERT INTO public.prod_componente (padre_sku, hijo_sku, cantidad) VALUES ('KIT006','TOR010',1)
ON CONFLICT (padre_sku, hijo_sku) DO UPDATE SET cantidad = EXCLUDED.cantidad;

-- KIT007 (Hikari x2, sin producto que lo use hoy): usar los SKU dedicados x2
DELETE FROM public.prod_componente WHERE padre_sku='KIT007' AND hijo_sku IN ('TOR006','AGU004');
INSERT INTO public.prod_componente (padre_sku, hijo_sku, cantidad) VALUES
  ('KIT007','TOR011',1), ('KIT007','AGU005',1)
ON CONFLICT (padre_sku, hijo_sku) DO UPDATE SET cantidad = EXCLUDED.cantidad;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual): revertir cada KIT a TOR005/TOR006/AGU004 y quitar
--   TOR005/TOR006 de KIT003, TOR009 de KIT005, TOR010 de KIT006,
--   TOR011/AGU005 de KIT007. El SKU fantasma '1' no se restituye (era basura).
-- ════════════════════════════════════════════════════════════════════
