-- ═══════════════════════════════════════════════════════════════════════════
-- 0005_rls_user.sql — RLS para datos del propio usuario
-- ───────────────────────────────────────────────────────────────────────────
-- Tablas:
--   profiles, notifications
--
-- Patrón:
--   - profiles: SELECT autenticados; el propio user puede UPDATE solo
--     name/avatar_color; owner+admin pueden hacer todo.
--   - notifications: solo el propio user las ve y las modifica (leida).
--     INSERT bloqueado para clientes — solo via triggers/RPCs en Fase 5.
-- ═══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════
-- 1. profiles
-- ══════════════════════════════════════════════════════════════════════════

-- SELECT: todos los autenticados activos pueden ver todos los profiles
-- (necesario para mostrar nombres en logs, listas, asignaciones, etc.)
DROP POLICY IF EXISTS "profiles: select for authenticated" ON public.profiles;
CREATE POLICY "profiles: select for authenticated"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (public.is_active_user() OR id = auth.uid());
  -- el OR id = auth.uid() permite que el user vea su propio profile incluso
  -- si está marcado como active=false (necesario para flow de logout limpio)

-- INSERT: solo owner o admin pueden crear profiles directamente.
-- Caso normal: profile se crea automáticamente via handle_new_user trigger
-- al hacer auth.signUp. Pero permitimos INSERT directo para casos admin.
DROP POLICY IF EXISTS "profiles: admin can insert" ON public.profiles;
CREATE POLICY "profiles: admin can insert"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (public.is_owner_or_admin());

-- UPDATE: dos paths
--   (a) owner/admin pueden actualizar cualquier campo de cualquier profile
--   (b) el propio user puede actualizar su profile pero solo name y avatar_color
--       (los demás campos los gestiona owner/admin)
-- Implementamos como dos policies separadas — permissive (OR).
DROP POLICY IF EXISTS "profiles: admin can update any" ON public.profiles;
CREATE POLICY "profiles: admin can update any"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (public.is_owner_or_admin())
  WITH CHECK (public.is_owner_or_admin());

DROP POLICY IF EXISTS "profiles: user can update own basics" ON public.profiles;
CREATE POLICY "profiles: user can update own basics"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    -- columnas que NO pueden cambiar via esta policy las protege un trigger
    -- en Fase 5 (BEFORE UPDATE en profiles) — RLS no soporta column-level
    -- WITH CHECK directamente en pg < 16. Por ahora permitimos el UPDATE y
    -- el trigger 0007 va a revertir cambios en role/active/username/email.
  );

-- DELETE: solo owner. Pero el flow recomendado es soft-delete (UPDATE active=false).
DROP POLICY IF EXISTS "profiles: owner can delete" ON public.profiles;
CREATE POLICY "profiles: owner can delete"
  ON public.profiles FOR DELETE
  TO authenticated
  USING (public.is_owner());

-- ══════════════════════════════════════════════════════════════════════════
-- 2. notifications
-- ══════════════════════════════════════════════════════════════════════════

-- SELECT: solo las propias
DROP POLICY IF EXISTS "notifications: select own" ON public.notifications;
CREATE POLICY "notifications: select own"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- UPDATE: solo las propias (típicamente para marcar leida=true)
DROP POLICY IF EXISTS "notifications: update own" ON public.notifications;
CREATE POLICY "notifications: update own"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- DELETE: solo las propias
DROP POLICY IF EXISTS "notifications: delete own" ON public.notifications;
CREATE POLICY "notifications: delete own"
  ON public.notifications FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- INSERT: NO POLICY → bloqueado para todos los authenticated.
-- Los triggers/RPCs de Fase 5 son SECURITY DEFINER → bypass RLS.

-- ══════════════════════════════════════════════════════════════════════════
-- FIN 0005_rls_user.sql
-- ══════════════════════════════════════════════════════════════════════════
