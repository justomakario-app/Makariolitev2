-- ════════════════════════════════════════════════════════════════════
-- S2.22 — Sistema de cuentas de usuario con permisos por módulo
-- ════════════════════════════════════════════════════════════════════
-- Crea la tabla user_module_permissions: por cada (user_id, module) define
-- si ese usuario puede acceder al módulo. SOLO se usa para refinar la
-- navegación de los usuarios con role 'admin' (modelo "reemplazo total"):
-- un admin con filas en esta tabla ve EXCLUSIVAMENTE los módulos con
-- can_access = true (+ Perfil/Notificaciones, siempre visibles).
--
-- Semántica "fail-open": un admin SIN filas en esta tabla conserva el
-- comportamiento actual (ve todo su ROLE_NAV). El frontend (data.js) sólo
-- aplica el filtro cuando hay al menos una fila.
--
-- owner: NO usa esta tabla — ve todo por rol.
-- operarios (cnc/melamina/.../encargado/ventas/marketing): tampoco.
--
-- ── Decisiones técnicas (divergencias respecto al brief original) ──────
--  1. El trigger de audit se llama public.trg_audit_log() en este repo
--     (no fn_audit_log()). Ver migration 0053.
--  2. RLS de ESCRITURA restringida a OWNER (no owner+admin como el brief).
--     Motivo de seguridad: si un admin pudiera INSERT/UPDATE/DELETE directo
--     vía PostgREST, podría auto-asignarse módulos y romper el modelo de
--     permisos. El ÚNICO camino de escritura legítimo es el RPC
--     rpc_admin_upsert_user_permissions (owner-only) y el seed por
--     service_role (que bypassa RLS). SELECT sí queda en owner+admin para
--     que un admin pueda leer sus propios permisos al bootstrap.
--  3. Se reutiliza el helper is_owner_or_admin() (migration 0002) para el
--     SELECT en vez de reescribir el EXISTS inline.
-- ════════════════════════════════════════════════════════════════════

-- ── (1) Tabla ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_module_permissions (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module      text NOT NULL,
  can_access  boolean DEFAULT true,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (user_id, module)
);

COMMENT ON TABLE public.user_module_permissions IS
  'S2.22: permisos por módulo para usuarios admin. Una fila por (user_id, module). Escrito SOLO vía rpc_admin_upsert_user_permissions (owner) o service_role.';

-- ── (2) RLS ──────────────────────────────────────────────────────────
ALTER TABLE public.user_module_permissions ENABLE ROW LEVEL SECURITY;

-- SELECT: owner + admin activos (el admin necesita leer sus propios permisos).
DROP POLICY IF EXISTS "ump_select" ON public.user_module_permissions;
CREATE POLICY "ump_select" ON public.user_module_permissions
  FOR SELECT TO authenticated
  USING (public.is_owner_or_admin());

-- INSERT/UPDATE/DELETE: SOLO owner activo (ver decisión técnica #2 arriba).
DROP POLICY IF EXISTS "ump_insert" ON public.user_module_permissions;
CREATE POLICY "ump_insert" ON public.user_module_permissions
  FOR INSERT TO authenticated
  WITH CHECK (public.current_user_role() = 'owner');

DROP POLICY IF EXISTS "ump_update" ON public.user_module_permissions;
CREATE POLICY "ump_update" ON public.user_module_permissions
  FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'owner')
  WITH CHECK (public.current_user_role() = 'owner');

DROP POLICY IF EXISTS "ump_delete" ON public.user_module_permissions;
CREATE POLICY "ump_delete" ON public.user_module_permissions
  FOR DELETE TO authenticated
  USING (public.current_user_role() = 'owner');

-- ── (3) Audit trigger (patrón existente — función trg_audit_log de 0053) ─
DROP TRIGGER IF EXISTS user_module_permissions_audit_log_trg
  ON public.user_module_permissions;
CREATE TRIGGER user_module_permissions_audit_log_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.user_module_permissions
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit_log();

-- ── (4) RPC upsert de permisos (owner-only) ──────────────────────────
-- Borra TODOS los permisos del usuario y reinserta el set nuevo.
-- p_payload = { user_id: uuid, modules: [ { module: text, can_access: bool }, ... ] }
CREATE OR REPLACE FUNCTION public.rpc_admin_upsert_user_permissions(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role     role_enum;
  v_active   boolean;
  v_user_id  uuid;
  v_modules  jsonb;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE = '42501';
  END IF;
  IF v_role NOT IN ('owner') THEN
    RAISE EXCEPTION 'Sin permiso.' USING ERRCODE = '42501';
  END IF;

  v_user_id := (p_payload->>'user_id')::uuid;
  v_modules := p_payload->'modules';

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id requerido.' USING ERRCODE = '22023';
  END IF;

  -- Reemplazo total del set de permisos del usuario.
  DELETE FROM public.user_module_permissions WHERE user_id = v_user_id;

  IF v_modules IS NOT NULL AND jsonb_typeof(v_modules) = 'array' THEN
    INSERT INTO public.user_module_permissions (user_id, module, can_access)
    SELECT v_user_id,
           mod->>'module',
           COALESCE((mod->>'can_access')::boolean, true)
    FROM jsonb_array_elements(v_modules) AS mod
    WHERE COALESCE(mod->>'module', '') <> '';
  END IF;

  RETURN jsonb_build_object('ok', true, 'user_id', v_user_id);
END $$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_upsert_user_permissions(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_upsert_user_permissions(jsonb) TO authenticated;

COMMENT ON FUNCTION public.rpc_admin_upsert_user_permissions(jsonb) IS
  'S2.22: owner-only. Reemplaza el set de permisos por módulo de un usuario. payload={user_id, modules:[{module,can_access}]}.';

-- ── (5) RPC get permisos de un usuario (owner+admin) ─────────────────
-- p_payload = { user_id: uuid }
CREATE OR REPLACE FUNCTION public.rpc_admin_get_user_permissions(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role    role_enum;
  v_active  boolean;
  v_result  jsonb;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE = '42501';
  END IF;
  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Sin permiso.' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_agg(jsonb_build_object('module', module, 'can_access', can_access))
  INTO v_result
  FROM public.user_module_permissions
  WHERE user_id = (p_payload->>'user_id')::uuid;

  RETURN jsonb_build_object('ok', true, 'permissions', COALESCE(v_result, '[]'::jsonb));
END $$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_get_user_permissions(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_get_user_permissions(jsonb) TO authenticated;

COMMENT ON FUNCTION public.rpc_admin_get_user_permissions(jsonb) IS
  'S2.22: owner+admin. Devuelve los permisos por módulo de un usuario. payload={user_id}. Un admin lo usa para leer SUS propios permisos al bootstrap.';

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual):
--   DROP TABLE IF EXISTS public.user_module_permissions CASCADE;
--   DROP FUNCTION IF EXISTS public.rpc_admin_upsert_user_permissions(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_admin_get_user_permissions(jsonb);
-- ════════════════════════════════════════════════════════════════════
