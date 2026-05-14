-- ════════════════════════════════════════════════════════════════════
-- HARDENING — REVOKE EXECUTE de anon/authenticated + fijar search_path
-- ════════════════════════════════════════════════════════════════════
-- Lints de Supabase resueltos:
--   - anon_security_definer_function_executable (25 de 26).
--   - authenticated_security_definer_function_executable (7 de 26).
--   - function_search_path_mutable (1: set_updated_at).
--
-- Clasificación de las 26 funciones SECURITY DEFINER (análisis del
-- uso real en RLS policies + callers del frontend):
--
--   GRUPO 1 — 7 funciones SIN uso en RLS policies, NO llamadas por el
--     frontend. Se revoca anon + PUBLIC + authenticated:
--       current_user_profile, fn_resolve_active_jornada,
--       recompute_carrier_state_for, handle_new_user,
--       trg_orders_recompute_state, trg_prodlog_recompute_state,
--       trg_profiles_protect_fields.
--
--   GRUPO 2a — 3 helpers usados DENTRO de RLS policies (NO en tablas
--     que el frontend consulta pre-login). Se revoca anon + PUBLIC,
--     pero NO authenticated (revocarlo rompería las RLS policies que
--     los invocan → cualquier query del usuario logueado fallaría):
--       is_owner, is_owner_or_admin, current_user_role.
--
--   GRUPO 2b — is_active_user: helper usado en 13 RLS policies SELECT,
--     incluyendo sku_catalog/channels/sku_categories que el frontend
--     consulta PRE-LOGIN como rol anon (warmup de cache offline en
--     data.js). NO se toca ni anon ni authenticated. Su lint queda
--     como falso positivo justificado.
--
--   GRUPO 3 — 15 RPCs: 14 llamados por el frontend + rpc_clean_orphan_
--     logs (mantenimiento manual). Se revoca anon + PUBLIC, pero NO
--     authenticated (el frontend los invoca autenticado — es su
--     propósito). Su lint authenticated_* queda como falso positivo
--     justificado.
--
--   set_updated_at — trigger function SECURITY INVOKER sin search_path
--     fijo. Se le aplica SET search_path = public, pg_temp.
--
-- Lints que persisten (falsos positivos aceptados, documentados en
-- docs/CAMBIO_2_CIERRE.md): 1 anon (is_active_user) + 19 authenticated
-- (4 helpers RLS del Grupo 2 + 15 RPCs del Grupo 3) — todos
-- técnicamente imposibles de revocar sin romper RLS o la app.
-- ════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────
-- 1) REVOKE EXECUTE FROM anon, PUBLIC — 25 funciones (todas menos is_active_user)
-- ────────────────────────────────────────────────────────────────────

-- GRUPO 1 (7) — sin uso en RLS, no llamadas por frontend
REVOKE EXECUTE ON FUNCTION public.current_user_profile()                                   FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_resolve_active_jornada(text, boolean)                  FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recompute_carrier_state_for(text, text)                   FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                                        FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_orders_recompute_state()                             FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_prodlog_recompute_state()                            FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_profiles_protect_fields()                            FROM anon, PUBLIC;

-- GRUPO 2a (3) — helpers usados en RLS policies (no pre-login)
REVOKE EXECUTE ON FUNCTION public.is_owner()                                               FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_owner_or_admin()                                      FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_user_role()                                      FROM anon, PUBLIC;

-- GRUPO 3 (15) — RPCs del frontend + rpc_clean_orphan_logs
REVOKE EXECUTE ON FUNCTION public.rpc_assign_free_stock(text, integer, text, uuid, text)    FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_clean_orphan_logs(text)                               FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_close_jornada(date, jsonb)                            FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_consume_free_stock(text, integer, text)               FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_correct_log(uuid, integer, text, text, boolean)       FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_create_manual_order(text, text, text, jsonb, text, boolean, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_delete_batch_full(uuid)                               FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_edit_order(text, text, jsonb, text)                   FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_import_batch(text, text, text, jsonb, text, uuid)      FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_open_jornada(date)                                    FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_register_production(text, text, integer, text, uuid)  FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_send_to_free_stock(text, integer, text, text)         FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_set_active_jornada(uuid)                              FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_transfer_between_channels(text, integer, text, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_upsert_sku(text, text, text, text, text, boolean, boolean, boolean, boolean) FROM anon, PUBLIC;

-- ────────────────────────────────────────────────────────────────────
-- 2) REVOKE EXECUTE FROM authenticated — solo GRUPO 1 (7)
--    NO se incluyen: helpers RLS (Grupo 2), RPCs frontend ni
--    rpc_clean_orphan_logs (Grupo 3) — revocarlos rompería RLS o la app.
-- ────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.current_user_profile()                  FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_resolve_active_jornada(text, boolean) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_carrier_state_for(text, text)  FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                       FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_orders_recompute_state()            FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_prodlog_recompute_state()           FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_profiles_protect_fields()           FROM authenticated;

-- ────────────────────────────────────────────────────────────────────
-- 3) set_updated_at — fijar search_path (lint function_search_path_mutable)
-- ────────────────────────────────────────────────────────────────────
ALTER FUNCTION public.set_updated_at() SET search_path = public, pg_temp;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual, si se necesita restaurar los GRANT originales):
--
--   -- Re-otorgar EXECUTE a las 25 funciones revocadas de anon/PUBLIC:
--   GRANT EXECUTE ON FUNCTION public.current_user_profile() TO anon, PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.fn_resolve_active_jornada(text, boolean) TO anon, PUBLIC;
--   ... (idem para las 25)
--
--   -- Re-otorgar EXECUTE a las 7 del Grupo 1 para authenticated:
--   GRANT EXECUTE ON FUNCTION public.current_user_profile() TO authenticated;
--   ... (idem para las 7)
--
--   -- Quitar el search_path de set_updated_at:
--   ALTER FUNCTION public.set_updated_at() RESET search_path;
-- ════════════════════════════════════════════════════════════════════
