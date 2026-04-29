-- ═══════════════════════════════════════════════════════════════════════════
-- 0002_auth_helpers.sql
-- Macario Lite — Auth helpers + trigger de signup
-- ───────────────────────────────────────────────────────────────────────────
-- Crea:
--   1. Trigger handle_new_user() en auth.users → autocreación de profile
--   2. Función is_owner_or_admin() — usada por RLS policies (Fase 3)
--   3. Función current_user_role() — devuelve role_enum del usuario actual
--   4. Función current_user_profile() — devuelve row completo del profile actual
--   5. Función resolve_username_to_email(text) — convención username → email virtual
--
-- Todas las funciones helper son SECURITY DEFINER (bypassan RLS) y STABLE
-- (cacheable dentro de una transacción).
--
-- search_path fijado a (public, pg_temp) en cada función para mitigar
-- search_path hijacking attacks.
-- ═══════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────
-- 1. handle_new_user() — autocreación de public.profiles al signup
-- ──────────────────────────────────────────────────────────────────────────
-- Se dispara AFTER INSERT en auth.users. Lee metadata del signUp call
-- (raw_user_meta_data jsonb) y crea la fila correspondiente en profiles.
--
-- Metadata esperada al hacer supabase.auth.signUp():
--   {
--     username: "sebastian",       -- requerido (si falta, se deriva del email)
--     name:     "Sebastián",       -- requerido (si falta, usa username)
--     role:     "owner",           -- opcional (default: 'embalaje')
--     area:     "Dirección",       -- opcional (texto libre)
--     created_by: "<uuid>"         -- opcional (uuid del owner que invitó)
--   }

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_username   text;
  v_name       text;
  v_role       role_enum;
  v_area       text;
  v_created_by uuid;
BEGIN
  -- username: del metadata, o derivado del email si falta
  v_username := COALESCE(
    NEW.raw_user_meta_data->>'username',
    regexp_replace(lower(split_part(NEW.email, '@', 1)), '[^a-z0-9_]', '_', 'g')
  );

  -- name: del metadata, o usa username como fallback
  v_name := COALESCE(NEW.raw_user_meta_data->>'name', v_username);

  -- role: del metadata, default a 'embalaje' (rol más restrictivo)
  v_role := COALESCE(
    (NEW.raw_user_meta_data->>'role')::role_enum,
    'embalaje'::role_enum
  );

  -- area: opcional
  v_area := NEW.raw_user_meta_data->>'area';

  -- created_by: opcional (uuid del owner/admin que invitó)
  v_created_by := NULLIF(NEW.raw_user_meta_data->>'created_by', '')::uuid;

  INSERT INTO public.profiles (id, username, name, email, role, area, created_by)
  VALUES (NEW.id, v_username, v_name, NEW.email, v_role, v_area, v_created_by);

  RETURN NEW;
EXCEPTION
  -- Si username ya existe (UNIQUE violation), agregar sufijo numérico aleatorio
  -- y reintentar. Caso edge: dos signups con el mismo username derivado del email.
  WHEN unique_violation THEN
    v_username := v_username || '_' || (floor(random() * 10000))::text;
    INSERT INTO public.profiles (id, username, name, email, role, area, created_by)
    VALUES (NEW.id, v_username, v_name, NEW.email, v_role, v_area, v_created_by);
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Trigger function: crea automáticamente public.profiles al INSERT en auth.users. Lee raw_user_meta_data para obtener username/name/role/area.';

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ──────────────────────────────────────────────────────────────────────────
-- 2. is_owner_or_admin() — helper para RLS policies
-- ──────────────────────────────────────────────────────────────────────────
-- Devuelve true si el usuario actual (auth.uid()) tiene role 'owner' o 'admin'
-- y está activo. Se usa MASIVAMENTE en RLS de Fase 3 — por eso STABLE
-- (cacheada dentro de la query) y SECURITY DEFINER (evita recursión RLS al
-- leer profiles desde sus propias policies).

CREATE OR REPLACE FUNCTION public.is_owner_or_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('owner', 'admin')
      AND active = true
  );
$$;

COMMENT ON FUNCTION public.is_owner_or_admin() IS
  'Devuelve true si auth.uid() tiene role owner|admin y está activo. SECURITY DEFINER para evitar recursión RLS. Usado en policies de Fase 3.';

-- ──────────────────────────────────────────────────────────────────────────
-- 3. current_user_role() — rol del usuario actual
-- ──────────────────────────────────────────────────────────────────────────
-- Devuelve el role_enum del usuario actual. Útil para:
--   - RLS policies que necesitan chequear roles específicos
--   - Frontend para decidir qué pantallas mostrar (junto con role_permissions)

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS role_enum
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT role FROM public.profiles
  WHERE id = auth.uid() AND active = true;
$$;

COMMENT ON FUNCTION public.current_user_role() IS
  'Devuelve role_enum del usuario actual o NULL si no logueado/inactivo. SECURITY DEFINER + STABLE para uso en RLS.';

-- ──────────────────────────────────────────────────────────────────────────
-- 4. current_user_profile() — profile completo del usuario actual
-- ──────────────────────────────────────────────────────────────────────────
-- Atajo para que el frontend obtenga su propio profile sin necesidad de
-- escribir un SELECT manual cada vez.

CREATE OR REPLACE FUNCTION public.current_user_profile()
RETURNS public.profiles
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT * FROM public.profiles WHERE id = auth.uid();
$$;

COMMENT ON FUNCTION public.current_user_profile() IS
  'Devuelve la fila completa de profiles del usuario actual. Atajo para el frontend.';

-- ──────────────────────────────────────────────────────────────────────────
-- 5. resolve_username_to_email() — convención username → email virtual
-- ──────────────────────────────────────────────────────────────────────────
-- Implementa la decisión B: la app usa username como handle de login, pero
-- Supabase Auth solo acepta email. Convención: {username}@macario.local
--
-- IMMUTABLE (pure function) → puede usarse desde el frontend ANTES de tener
-- sesión activa. GRANT EXECUTE TO anon para que el login funcione.

CREATE OR REPLACE FUNCTION public.resolve_username_to_email(p_username text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT lower(trim(p_username)) || '@macario.local';
$$;

COMMENT ON FUNCTION public.resolve_username_to_email(text) IS
  'Convierte un username a email virtual (decisión B: {username}@macario.local). IMMUTABLE — usable desde anon en el flow de login.';

-- ──────────────────────────────────────────────────────────────────────────
-- 6. GRANTS — permisos de ejecución
-- ──────────────────────────────────────────────────────────────────────────
-- handle_new_user() es trigger function — no necesita GRANT explícito.

-- Funciones para usuarios autenticados (las usan policies y frontend):
GRANT EXECUTE ON FUNCTION public.is_owner_or_admin()        TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_role()        TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_profile()     TO authenticated;

-- resolve_username_to_email: pública (anon puede llamarla en el login flow):
GRANT EXECUTE ON FUNCTION public.resolve_username_to_email(text) TO anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- FIN 0002_auth_helpers.sql
-- ══════════════════════════════════════════════════════════════════════════
