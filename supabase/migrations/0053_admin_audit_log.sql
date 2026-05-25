-- ════════════════════════════════════════════════════════════════════
-- ADMIN MODULE — Audit Log Global (S2.0)
-- ════════════════════════════════════════════════════════════════════
-- Tabla append-only que registra TODAS las operaciones (INSERT/UPDATE/
-- DELETE) sobre 11 tablas: 9 admin + agent_conversations + profiles.
--
-- Mecanismo: trigger AFTER en cada tabla → llama a log_admin_action()
-- SECURITY DEFINER → INSERT en admin_audit_log. Captura best-effort de
-- IP/UA via current_setting('request.headers').
--
-- Filtro de noise: updates que solo cambian updated_at NO se loguean.
-- changes_json: completo (before + after) por simplicidad de query.
--
-- RLS: solo SELECT permitido a owner/admin. SIN policy INSERT/UPDATE/
-- DELETE — la tabla solo se escribe via log_admin_action() que es
-- SECURITY DEFINER y bypassea RLS automáticamente.
-- ════════════════════════════════════════════════════════════════════

-- ── (1) Tabla admin_audit_log ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ts              timestamptz NOT NULL DEFAULT now(),
  actor_id        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_source    text NOT NULL DEFAULT 'user'
                  CHECK (actor_source IN ('user','system','migration')),
  entity_type     text NOT NULL,
  entity_id       uuid NOT NULL,
  action          text NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  changes         jsonb NOT NULL,
  ip              inet,
  user_agent      text,
  request_id      text
);

COMMENT ON TABLE public.admin_audit_log IS
  'Append-only audit log de operaciones admin. Escrito SOLO via trigger trg_audit_log() SECURITY DEFINER.';

CREATE INDEX IF NOT EXISTS admin_audit_log_entity_idx
  ON public.admin_audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS admin_audit_log_actor_idx
  ON public.admin_audit_log(actor_id) WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS admin_audit_log_ts_idx
  ON public.admin_audit_log(ts DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_action_idx
  ON public.admin_audit_log(action);
CREATE INDEX IF NOT EXISTS admin_audit_log_entity_type_idx
  ON public.admin_audit_log(entity_type);

-- ── (2) RLS + policy SELECT (sin INSERT/UPDATE/DELETE) ──────────────
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_audit_log: admin select" ON public.admin_audit_log;
CREATE POLICY "admin_audit_log: admin select" ON public.admin_audit_log
  FOR SELECT TO authenticated USING (is_owner_or_admin());

-- ── (3) Función helper log_admin_action() ───────────────────────────
CREATE OR REPLACE FUNCTION public.log_admin_action(
  p_entity_type text,
  p_entity_id uuid,
  p_action text,
  p_changes jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id uuid;
  v_actor_id uuid := auth.uid();
  v_actor_source text;
  v_headers jsonb;
  v_ip inet;
  v_user_agent text;
  v_request_id text;
BEGIN
  IF v_actor_id IS NOT NULL THEN
    v_actor_source := 'user';
  ELSE
    v_actor_source := 'system';
  END IF;

  -- Best-effort: capturar headers HTTP si vienen via PostgREST.
  BEGIN
    v_headers := current_setting('request.headers', true)::jsonb;
  EXCEPTION WHEN OTHERS THEN
    v_headers := NULL;
  END;

  IF v_headers IS NOT NULL THEN
    BEGIN
      v_ip := split_part(v_headers->>'x-forwarded-for', ',', 1)::inet;
    EXCEPTION WHEN OTHERS THEN
      v_ip := NULL;
    END;
    v_user_agent := v_headers->>'user-agent';
    v_request_id := v_headers->>'x-request-id';
  END IF;

  INSERT INTO public.admin_audit_log (
    actor_id, actor_source, entity_type, entity_id, action, changes,
    ip, user_agent, request_id
  ) VALUES (
    v_actor_id, v_actor_source, p_entity_type, p_entity_id, p_action, p_changes,
    v_ip, v_user_agent, v_request_id
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.log_admin_action(text, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.log_admin_action(text, uuid, text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.log_admin_action(text, uuid, text, jsonb) IS
  'S2.0: Helper SECURITY DEFINER para escribir en admin_audit_log. Captura auth.uid() + IP/UA best-effort.';

-- ── (4) Función trigger trg_audit_log() ─────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_changes jsonb;
  v_entity_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_entity_id := (NEW).id;
    v_changes := jsonb_build_object('after', to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    v_entity_id := (NEW).id;
    -- Filtro de noise: si el unico cambio es updated_at, no loguear.
    IF to_jsonb(OLD) - 'updated_at' = to_jsonb(NEW) - 'updated_at' THEN
      RETURN NULL;
    END IF;
    v_changes := jsonb_build_object(
      'before', to_jsonb(OLD),
      'after',  to_jsonb(NEW)
    );
  ELSIF TG_OP = 'DELETE' THEN
    v_entity_id := (OLD).id;
    v_changes := jsonb_build_object('before', to_jsonb(OLD));
  ELSE
    RETURN NULL;
  END IF;

  PERFORM public.log_admin_action(
    TG_TABLE_NAME::text,
    v_entity_id,
    TG_OP::text,
    v_changes
  );

  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.trg_audit_log() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.trg_audit_log() TO authenticated;

COMMENT ON FUNCTION public.trg_audit_log() IS
  'S2.0: Trigger AFTER INSERT/UPDATE/DELETE generico. Aplica a 11 tablas admin+profiles+agent_conversations.';

-- ── (5) Aplicar trigger a las 11 tablas ─────────────────────────────
DO $$
DECLARE
  v_tbl text;
  v_tables text[] := ARRAY[
    'suppliers',
    'customers_b2b',
    'expenses',
    'checks_issued',
    'checks_received',
    'suppliers_credit',
    'suppliers_credit_movements',
    'customers_credit',
    'customers_credit_movements',
    'agent_conversations',
    'profiles'
  ];
BEGIN
  FOREACH v_tbl IN ARRAY v_tables LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON public.%I',
      v_tbl || '_audit_log_trg', v_tbl
    );
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.trg_audit_log()',
      v_tbl || '_audit_log_trg', v_tbl
    );
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual):
--   DROP TABLE IF EXISTS public.admin_audit_log CASCADE;
--   DROP FUNCTION IF EXISTS public.log_admin_action(text, uuid, text, jsonb);
--   DROP FUNCTION IF EXISTS public.trg_audit_log();
--   -- Los 11 triggers caen automáticamente con DROP FUNCTION CASCADE
--   -- (o se borran al hacer DROP TABLE ... CASCADE de admin_audit_log
--   -- si están enlazados — verificar).
-- ════════════════════════════════════════════════════════════════════
