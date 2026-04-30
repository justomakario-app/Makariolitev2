-- ═══════════════════════════════════════════════════════════════════════════
-- 0003_rls_catalog.sql — RLS para datos maestros (catálogo y configuración)
-- ───────────────────────────────────────────────────────────────────────────
-- Tablas:
--   channels, sku_categories, sku_catalog, role_permissions
--
-- Patrón general:
--   - SELECT: cualquier autenticado activo
--   - INSERT/UPDATE/DELETE: owner o admin (channels y role_permissions: solo owner)
--
-- Idempotente: DROP POLICY IF EXISTS antes de CREATE POLICY.
-- ═══════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────
-- Helper: is_active_user() — chequea active=true en profiles
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND active = true
  );
$$;
COMMENT ON FUNCTION public.is_active_user() IS
  'Devuelve true si auth.uid() tiene un profile activo. Usado en RLS para bloquear usuarios desactivados.';

GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated;

-- Helper: is_owner() — solo el rol owner
CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'owner' AND active = true
  );
$$;
COMMENT ON FUNCTION public.is_owner() IS
  'Devuelve true si auth.uid() tiene role=owner y active=true. Usado en RLS de tablas críticas (channels, role_permissions).';

GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- 1. channels
-- ══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "channels: select for authenticated" ON public.channels;
CREATE POLICY "channels: select for authenticated"
  ON public.channels FOR SELECT
  TO authenticated
  USING (public.is_active_user());

DROP POLICY IF EXISTS "channels: owner can write" ON public.channels;
CREATE POLICY "channels: owner can write"
  ON public.channels FOR ALL
  TO authenticated
  USING (public.is_owner())
  WITH CHECK (public.is_owner());

-- ══════════════════════════════════════════════════════════════════════════
-- 2. sku_categories
-- ══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "sku_categories: select for authenticated" ON public.sku_categories;
CREATE POLICY "sku_categories: select for authenticated"
  ON public.sku_categories FOR SELECT
  TO authenticated
  USING (public.is_active_user());

DROP POLICY IF EXISTS "sku_categories: admin can write" ON public.sku_categories;
CREATE POLICY "sku_categories: admin can write"
  ON public.sku_categories FOR ALL
  TO authenticated
  USING (public.is_owner_or_admin())
  WITH CHECK (public.is_owner_or_admin());

-- ══════════════════════════════════════════════════════════════════════════
-- 3. sku_catalog
-- ══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "sku_catalog: select for authenticated" ON public.sku_catalog;
CREATE POLICY "sku_catalog: select for authenticated"
  ON public.sku_catalog FOR SELECT
  TO authenticated
  USING (public.is_active_user());

DROP POLICY IF EXISTS "sku_catalog: admin can insert" ON public.sku_catalog;
CREATE POLICY "sku_catalog: admin can insert"
  ON public.sku_catalog FOR INSERT
  TO authenticated
  WITH CHECK (public.is_owner_or_admin());

DROP POLICY IF EXISTS "sku_catalog: admin can update" ON public.sku_catalog;
CREATE POLICY "sku_catalog: admin can update"
  ON public.sku_catalog FOR UPDATE
  TO authenticated
  USING (public.is_owner_or_admin())
  WITH CHECK (public.is_owner_or_admin());

-- DELETE intencionalmente bloqueado (solo soft-delete via UPDATE activo=false).
-- Nadie puede DELETE — ni owner. Si en el futuro se quiere permitir, agregar policy.

-- ══════════════════════════════════════════════════════════════════════════
-- 4. role_permissions
-- ══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "role_permissions: select for authenticated" ON public.role_permissions;
CREATE POLICY "role_permissions: select for authenticated"
  ON public.role_permissions FOR SELECT
  TO authenticated
  USING (public.is_active_user());

DROP POLICY IF EXISTS "role_permissions: owner can write" ON public.role_permissions;
CREATE POLICY "role_permissions: owner can write"
  ON public.role_permissions FOR ALL
  TO authenticated
  USING (public.is_owner())
  WITH CHECK (public.is_owner());

-- ══════════════════════════════════════════════════════════════════════════
-- FIN 0003_rls_catalog.sql
-- ══════════════════════════════════════════════════════════════════════════
