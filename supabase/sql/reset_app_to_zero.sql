-- ════════════════════════════════════════════════════════════════════
-- RESET APP A 0 — borra TODO lo transaccional, deja la app virgen
-- ────────────────────────────────────────────────────────────────────
-- Esto borra:
--   • orders (pedidos importados)
--   • production_logs (registros de producción)
--   • import_batches (lotes subidos)
--   • jornadas (cierres)
--   • notifications
--   • qr_scans
--   • carrier_state (cache, se regenera solo)
--
-- Esto NO toca:
--   • profiles (usuarios)
--   • sku_catalog (catálogo)
--   • channels (canales)
--   • role_permissions
--   • sku_categories
--   • auth.users (cuentas de login)
--
-- Cómo correr: Supabase Studio → SQL Editor → New query → pegar todo → Run
-- ════════════════════════════════════════════════════════════════════

BEGIN;

DELETE FROM public.production_logs;
DELETE FROM public.qr_scans;
DELETE FROM public.notifications;
DELETE FROM public.orders;
DELETE FROM public.import_batches;
DELETE FROM public.jornadas;
DELETE FROM public.carrier_state;

COMMIT;

-- Verificar (todos deben dar 0)
SELECT 'orders' AS t, count(*) FROM public.orders
UNION ALL SELECT 'production_logs', count(*) FROM public.production_logs
UNION ALL SELECT 'import_batches', count(*) FROM public.import_batches
UNION ALL SELECT 'jornadas', count(*) FROM public.jornadas
UNION ALL SELECT 'notifications', count(*) FROM public.notifications
UNION ALL SELECT 'qr_scans', count(*) FROM public.qr_scans
UNION ALL SELECT 'carrier_state', count(*) FROM public.carrier_state;
