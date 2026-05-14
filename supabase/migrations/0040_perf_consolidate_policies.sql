-- ════════════════════════════════════════════════════════════════════
-- PERFORMANCE — Consolidar multiple permissive policies
-- ════════════════════════════════════════════════════════════════════
-- Lint de Supabase (multiple_permissive_policies, nivel WARN) × 4:
--   Cuando una tabla tiene 2+ policies permisivas para el mismo rol y
--   la misma acción, Postgres evalúa TODAS en cada query. Consolidar a
--   una sola policy por acción evita el doble eval.
--
-- Los 4 casos y su fix:
--
-- #1 profiles · UPDATE — DOS policies permisivas:
--      "profiles: admin can update any"        USING is_owner_or_admin()
--      "profiles: user can update own basics"  USING id = auth.uid()
--    Fix: fusionar en UNA policy con la condición OR. Permiso efectivo
--    idéntico (admin O uno mismo). El trigger trg_profiles_protect_fields
--    sigue protegiendo los campos sensibles — la policy solo decide
--    QUIÉN puede tocar la fila, el trigger QUÉ campos.
--
-- #2 channels  / #3 role_permissions / #4 sku_categories — el solape es
--    porque la policy de escritura es FOR ALL, y ALL incluye SELECT, así
--    que choca con la policy "select for authenticated".
--    Fix: partir la policy FOR ALL en 3 policies explícitas
--    (FOR INSERT + FOR UPDATE + FOR DELETE). Así la escritura ya no
--    cubre SELECT y el solape desaparece. La policy de SELECT queda
--    intacta.
--
-- ── EDGE CASE documentado e intencional ──────────────────────────────
--   Antes: un owner/admin con active=false podía igual LEER
--   channels/role_permissions/sku_categories vía la policy FOR ALL.
--   Después: como las policies de escritura ya no cubren SELECT, ese
--   usuario desactivado lee SOLO vía "select for authenticated", que
--   exige is_active_user() = true. Resultado: un owner/admin
--   DESACTIVADO pierde el SELECT sobre esas 3 tablas.
--   Esto es ACEPTADO y de hecho más correcto: desactivado = sin acceso.
--   Un owner/admin desactivado es un escenario rarísimo.
--
-- NO se toca ninguna policy de rol anon (estas tablas no tienen
-- policies para anon). Comportamiento pre-login sin cambios.
-- ════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────
-- #1 — profiles UPDATE: fusionar 2 policies → 1
-- ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "profiles: admin can update any"       ON public.profiles;
DROP POLICY IF EXISTS "profiles: user can update own basics" ON public.profiles;

CREATE POLICY "profiles: update own or admin"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (is_owner_or_admin() OR (id = (select auth.uid())))
  WITH CHECK (is_owner_or_admin() OR (id = (select auth.uid())));

-- ────────────────────────────────────────────────────────────────────
-- #2 — channels: FOR ALL → FOR INSERT + UPDATE + DELETE
-- ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "channels: owner can write" ON public.channels;

CREATE POLICY "channels: owner can insert"
  ON public.channels FOR INSERT TO authenticated
  WITH CHECK (is_owner());

CREATE POLICY "channels: owner can update"
  ON public.channels FOR UPDATE TO authenticated
  USING (is_owner())
  WITH CHECK (is_owner());

CREATE POLICY "channels: owner can delete"
  ON public.channels FOR DELETE TO authenticated
  USING (is_owner());

-- ────────────────────────────────────────────────────────────────────
-- #3 — role_permissions: FOR ALL → FOR INSERT + UPDATE + DELETE
-- ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "role_permissions: owner can write" ON public.role_permissions;

CREATE POLICY "role_permissions: owner can insert"
  ON public.role_permissions FOR INSERT TO authenticated
  WITH CHECK (is_owner());

CREATE POLICY "role_permissions: owner can update"
  ON public.role_permissions FOR UPDATE TO authenticated
  USING (is_owner())
  WITH CHECK (is_owner());

CREATE POLICY "role_permissions: owner can delete"
  ON public.role_permissions FOR DELETE TO authenticated
  USING (is_owner());

-- ────────────────────────────────────────────────────────────────────
-- #4 — sku_categories: FOR ALL → FOR INSERT + UPDATE + DELETE
-- ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "sku_categories: admin can write" ON public.sku_categories;

CREATE POLICY "sku_categories: admin can insert"
  ON public.sku_categories FOR INSERT TO authenticated
  WITH CHECK (is_owner_or_admin());

CREATE POLICY "sku_categories: admin can update"
  ON public.sku_categories FOR UPDATE TO authenticated
  USING (is_owner_or_admin())
  WITH CHECK (is_owner_or_admin());

CREATE POLICY "sku_categories: admin can delete"
  ON public.sku_categories FOR DELETE TO authenticated
  USING (is_owner_or_admin());

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual — restaura las policies originales):
--
--   -- #1 profiles
--   DROP POLICY IF EXISTS "profiles: update own or admin" ON public.profiles;
--   CREATE POLICY "profiles: admin can update any" ON public.profiles
--     FOR UPDATE TO authenticated
--     USING (is_owner_or_admin()) WITH CHECK (is_owner_or_admin());
--   CREATE POLICY "profiles: user can update own basics" ON public.profiles
--     FOR UPDATE TO authenticated
--     USING (id = (select auth.uid())) WITH CHECK (id = (select auth.uid()));
--
--   -- #2 channels
--   DROP POLICY IF EXISTS "channels: owner can insert" ON public.channels;
--   DROP POLICY IF EXISTS "channels: owner can update" ON public.channels;
--   DROP POLICY IF EXISTS "channels: owner can delete" ON public.channels;
--   CREATE POLICY "channels: owner can write" ON public.channels
--     FOR ALL TO authenticated USING (is_owner()) WITH CHECK (is_owner());
--
--   -- #3 role_permissions
--   DROP POLICY IF EXISTS "role_permissions: owner can insert" ON public.role_permissions;
--   DROP POLICY IF EXISTS "role_permissions: owner can update" ON public.role_permissions;
--   DROP POLICY IF EXISTS "role_permissions: owner can delete" ON public.role_permissions;
--   CREATE POLICY "role_permissions: owner can write" ON public.role_permissions
--     FOR ALL TO authenticated USING (is_owner()) WITH CHECK (is_owner());
--
--   -- #4 sku_categories
--   DROP POLICY IF EXISTS "sku_categories: admin can insert" ON public.sku_categories;
--   DROP POLICY IF EXISTS "sku_categories: admin can update" ON public.sku_categories;
--   DROP POLICY IF EXISTS "sku_categories: admin can delete" ON public.sku_categories;
--   CREATE POLICY "sku_categories: admin can write" ON public.sku_categories
--     FOR ALL TO authenticated USING (is_owner_or_admin()) WITH CHECK (is_owner_or_admin());
-- ════════════════════════════════════════════════════════════════════
