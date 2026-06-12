-- ════════════════════════════════════════════════════════════════════
-- PRODUCCIÓN — Hardening de seguridad (advisors de Supabase)
-- ════════════════════════════════════════════════════════════════════
-- El linter de Supabase marcó `prod_fn_alerta_stock` y `prod_fn_auditoria`
-- (ambas SECURITY DEFINER) como ejecutables por `anon`. Son TRIGGER
-- functions: disparan como parte del trigger (corren como su owner), NO
-- necesitan EXECUTE directo. Revocamos EXECUTE de anon/authenticated/public
-- para quitar superficie de ataque. Los triggers siguen funcionando igual.
--
-- (No tocamos las 4 policies UPDATE con WITH CHECK true: su cláusula USING
--  ya restringe correctamente por rol + ventana de 24h; el camino real de
--  escritura son las RPCs SECURITY DEFINER. Las RPCs y vistas SECURITY
--  DEFINER son el patrón deliberado del módulo.)
-- ════════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION public.prod_fn_alerta_stock() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.prod_fn_auditoria()    FROM anon, authenticated, public;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual):
--   GRANT EXECUTE ON FUNCTION public.prod_fn_alerta_stock() TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.prod_fn_auditoria()    TO anon, authenticated;
-- ════════════════════════════════════════════════════════════════════
