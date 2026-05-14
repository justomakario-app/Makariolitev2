-- ════════════════════════════════════════════════════════════════════
-- PERFORMANCE — RLS init plan: envolver auth.uid() con (select auth.uid())
-- ════════════════════════════════════════════════════════════════════
-- Lint de Supabase (auth_rls_initplan, nivel WARN) × 11:
--   Cuando una RLS policy llama auth.uid() DIRECTAMENTE, Postgres lo
--   re-evalúa fila por fila. Envolviéndolo en (select auth.uid()) el
--   planner lo trata como InitPlan: se evalúa UNA sola vez por query.
--
-- Alcance: SOLO se envuelve auth.uid(). NO se tocan los helpers
--   (is_active_user, is_owner_or_admin, current_user_role, is_owner) —
--   son funciones STABLE, el linter no las marca, y tocarlas sería
--   ampliar el alcance del cambio.
--
-- Se usa ALTER POLICY (no DROP+CREATE): no hay ventana sin policy, el
-- cambio es atómico dentro de la transacción de la migration.
--
-- Cambio PURAMENTE de performance — el comportamiento de acceso es
-- idéntico: (select auth.uid()) devuelve el mismo valor que auth.uid().
--
-- Las 11 policies y su transformación:
--
--  1. import_batches "admin and encargado can insert"  [INSERT, WITH CHECK]
--       ... AND (imported_by = auth.uid())
--     → ... AND (imported_by = (select auth.uid()))
--  2. production_logs "insert own logs only"           [INSERT, WITH CHECK]
--       (is_active_user() AND (operario_id = auth.uid()))
--     → (is_active_user() AND (operario_id = (select auth.uid())))
--  3. qr_scans "insert own scans only"                 [INSERT, WITH CHECK]
--       (is_active_user() AND (operario_id = auth.uid()))
--     → (is_active_user() AND (operario_id = (select auth.uid())))
--  4. profiles "select for authenticated"              [SELECT, USING]
--       (is_active_user() OR (id = auth.uid()))
--     → (is_active_user() OR (id = (select auth.uid())))
--  5. profiles "user can update own basics"            [UPDATE, USING + WITH CHECK]
--       (id = auth.uid())  →  (id = (select auth.uid()))
--  6. notifications "select own"                       [SELECT, USING]
--       (user_id = auth.uid())  →  (user_id = (select auth.uid()))
--  7. notifications "update own"                       [UPDATE, USING + WITH CHECK]
--       (user_id = auth.uid())  →  (user_id = (select auth.uid()))
--  8. notifications "delete own"                       [DELETE, USING]
--       (user_id = auth.uid())  →  (user_id = (select auth.uid()))
--  9. jornada_audit "jornada_audit_select_admins"      [SELECT, USING]
--       EXISTS(... WHERE p.id = auth.uid() AND ...)
--     → EXISTS(... WHERE p.id = (select auth.uid()) AND ...)
-- 10. free_stock "free_stock_select"                   [SELECT, USING]
--       EXISTS(... WHERE p.id = auth.uid() AND p.active)
--     → EXISTS(... WHERE p.id = (select auth.uid()) AND p.active)
-- 11. order_edit_log "order_edit_log_select_authenticated" [SELECT, USING]
--       EXISTS(... WHERE p.id = auth.uid() AND p.active)
--     → EXISTS(... WHERE p.id = (select auth.uid()) AND p.active)
-- ════════════════════════════════════════════════════════════════════

-- 1) import_batches: admin and encargado can insert
ALTER POLICY "import_batches: admin and encargado can insert" ON public.import_batches
  WITH CHECK (
    (is_owner_or_admin() OR (current_user_role() = 'encargado'::role_enum))
    AND (imported_by = (select auth.uid()))
  );

-- 2) production_logs: insert own logs only
ALTER POLICY "production_logs: insert own logs only" ON public.production_logs
  WITH CHECK (is_active_user() AND (operario_id = (select auth.uid())));

-- 3) qr_scans: insert own scans only
ALTER POLICY "qr_scans: insert own scans only" ON public.qr_scans
  WITH CHECK (is_active_user() AND (operario_id = (select auth.uid())));

-- 4) profiles: select for authenticated
ALTER POLICY "profiles: select for authenticated" ON public.profiles
  USING (is_active_user() OR (id = (select auth.uid())));

-- 5) profiles: user can update own basics
ALTER POLICY "profiles: user can update own basics" ON public.profiles
  USING (id = (select auth.uid()))
  WITH CHECK (id = (select auth.uid()));

-- 6) notifications: select own
ALTER POLICY "notifications: select own" ON public.notifications
  USING (user_id = (select auth.uid()));

-- 7) notifications: update own
ALTER POLICY "notifications: update own" ON public.notifications
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

-- 8) notifications: delete own
ALTER POLICY "notifications: delete own" ON public.notifications
  USING (user_id = (select auth.uid()));

-- 9) jornada_audit: jornada_audit_select_admins
ALTER POLICY "jornada_audit_select_admins" ON public.jornada_audit
  USING (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = (select auth.uid())
      AND p.active = true
      AND p.role = ANY (ARRAY['owner'::role_enum, 'admin'::role_enum, 'encargado'::role_enum])
  ));

-- 10) free_stock: free_stock_select
ALTER POLICY "free_stock_select" ON public.free_stock
  USING (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = (select auth.uid()) AND p.active = true
  ));

-- 11) order_edit_log: order_edit_log_select_authenticated
ALTER POLICY "order_edit_log_select_authenticated" ON public.order_edit_log
  USING (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = (select auth.uid()) AND p.active = true
  ));

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual — restaura las 11 policies a auth.uid() directo):
--
--   ALTER POLICY "import_batches: admin and encargado can insert" ON public.import_batches
--     WITH CHECK ((is_owner_or_admin() OR (current_user_role() = 'encargado'::role_enum))
--                 AND (imported_by = auth.uid()));
--   ALTER POLICY "production_logs: insert own logs only" ON public.production_logs
--     WITH CHECK (is_active_user() AND (operario_id = auth.uid()));
--   ALTER POLICY "qr_scans: insert own scans only" ON public.qr_scans
--     WITH CHECK (is_active_user() AND (operario_id = auth.uid()));
--   ALTER POLICY "profiles: select for authenticated" ON public.profiles
--     USING (is_active_user() OR (id = auth.uid()));
--   ALTER POLICY "profiles: user can update own basics" ON public.profiles
--     USING (id = auth.uid()) WITH CHECK (id = auth.uid());
--   ALTER POLICY "notifications: select own" ON public.notifications
--     USING (user_id = auth.uid());
--   ALTER POLICY "notifications: update own" ON public.notifications
--     USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
--   ALTER POLICY "notifications: delete own" ON public.notifications
--     USING (user_id = auth.uid());
--   ALTER POLICY "jornada_audit_select_admins" ON public.jornada_audit
--     USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.active = true
--            AND p.role = ANY (ARRAY['owner'::role_enum,'admin'::role_enum,'encargado'::role_enum])));
--   ALTER POLICY "free_stock_select" ON public.free_stock
--     USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.active = true));
--   ALTER POLICY "order_edit_log_select_authenticated" ON public.order_edit_log
--     USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.active = true));
-- ════════════════════════════════════════════════════════════════════
