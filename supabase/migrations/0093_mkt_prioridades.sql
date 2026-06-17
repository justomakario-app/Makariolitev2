-- ════════════════════════════════════════════════════════════════════
-- MARKETING — Módulo 4/5: Prioridades (pedidos + notificación)
-- ════════════════════════════════════════════════════════════════════
-- Tablero de pedidos del área. Al crear una prioridad se dispara una
-- notificación (tabla notifications, tipo 'sistema') al owner y al
-- encargado de marketing (rol 'marketing'), menos al que la creó.
-- Gate owner/admin/marketing. Reusa notifications.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.mkt_prioridad (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo        text NOT NULL,
  descripcion   text,
  urgencia      text DEFAULT 'media',      -- alta | media | baja
  area          text,                       -- destino / contexto
  estado        text DEFAULT 'pendiente',   -- pendiente | en_progreso | hecho
  solicitado_por uuid,
  asignado_a    uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mkt_prioridad_estado_idx ON public.mkt_prioridad(estado);

ALTER TABLE public.mkt_prioridad ENABLE ROW LEVEL SECURITY;
DO $rls$
BEGIN
  CREATE POLICY mkt_prioridad_sel ON public.mkt_prioridad FOR SELECT TO authenticated
    USING (current_user_role() = ANY (ARRAY['owner','admin','marketing']::role_enum[]));
  CREATE POLICY mkt_prioridad_all ON public.mkt_prioridad FOR ALL TO authenticated
    USING (current_user_role() = ANY (ARRAY['owner','admin','marketing']::role_enum[]))
    WITH CHECK (current_user_role() = ANY (ARRAY['owner','admin','marketing']::role_enum[]));
EXCEPTION WHEN duplicate_object THEN NULL;
END $rls$;
GRANT SELECT ON public.mkt_prioridad TO authenticated;

CREATE OR REPLACE FUNCTION public.mkt_rpc_crear_prioridad(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE v_role role_enum; v_active boolean; v_id uuid; v_urg text; v_titulo text; n_notif int := 0;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin','marketing') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  v_titulo := NULLIF(trim(p_payload->>'titulo'),'');
  IF v_titulo IS NULL THEN RAISE EXCEPTION 'Falta el titulo de la prioridad.' USING ERRCODE='22023'; END IF;
  v_urg := COALESCE(NULLIF(trim(p_payload->>'urgencia'),''),'media');

  INSERT INTO mkt_prioridad (titulo, descripcion, urgencia, area, asignado_a, solicitado_por)
  VALUES (v_titulo, NULLIF(trim(p_payload->>'descripcion'),''), v_urg, NULLIF(trim(p_payload->>'area'),''),
          NULLIF(p_payload->>'asignado_a','')::uuid, auth.uid())
  RETURNING id INTO v_id;

  -- Notificar a owner + encargado de marketing (menos al que la creó)
  INSERT INTO notifications (user_id, tipo, titulo, mensaje, link)
  SELECT pr.id, 'sistema'::notif_type_enum,
         'Nueva prioridad de Marketing' || CASE WHEN v_urg='alta' THEN ' (URGENTE)' ELSE '' END,
         v_titulo, 'marketing'
  FROM profiles pr
  WHERE pr.active = true AND pr.role IN ('owner','marketing') AND pr.id <> auth.uid();
  GET DIAGNOSTICS n_notif = ROW_COUNT;

  RETURN jsonb_build_object('id', v_id, 'notificados', n_notif);
END $fn$;

CREATE OR REPLACE FUNCTION public.mkt_rpc_gestionar_prioridad(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE v_role role_enum; v_active boolean;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin','marketing') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  UPDATE mkt_prioridad SET
    estado = COALESCE(NULLIF(trim(p_payload->>'estado'),''), estado),
    asignado_a = CASE WHEN p_payload ? 'asignado_a' THEN NULLIF(p_payload->>'asignado_a','')::uuid ELSE asignado_a END
  WHERE id = (p_payload->>'id')::uuid;
  RETURN jsonb_build_object('ok', true);
END $fn$;

CREATE OR REPLACE FUNCTION public.mkt_rpc_delete_prioridad(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE v_role role_enum; v_active boolean;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin','marketing') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  DELETE FROM mkt_prioridad WHERE id = (p_payload->>'id')::uuid;
  RETURN jsonb_build_object('ok', true);
END $fn$;

REVOKE EXECUTE ON FUNCTION public.mkt_rpc_crear_prioridad(jsonb), public.mkt_rpc_gestionar_prioridad(jsonb), public.mkt_rpc_delete_prioridad(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mkt_rpc_crear_prioridad(jsonb), public.mkt_rpc_gestionar_prioridad(jsonb), public.mkt_rpc_delete_prioridad(jsonb) TO authenticated;

-- ROLLBACK: DROP las 3 RPCs; DROP TABLE mkt_prioridad.
