-- ════════════════════════════════════════════════════════════════════
-- MARKETING — Módulo 2/5: Calendario editorial (mkt_evento)
-- ════════════════════════════════════════════════════════════════════
-- Reemplaza el Excel: un solo calendario con cada pieza de contenido.
-- Campos derivados de cómo trabajan (Semana/Día/Temática/Objetivo/Material/
-- Audio/Copy/Arte/Notas/OK cliente/Status) + ENLACE al ángulo de venta.
-- Gate owner/admin/marketing. Aditivo.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.mkt_evento (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha         date NOT NULL DEFAULT CURRENT_DATE,
  titulo        text NOT NULL,
  plataforma    text DEFAULT 'instagram',   -- instagram | tiktok | youtube | meta | facebook
  formato       text DEFAULT 'reel',          -- reel | post | carrusel | story | guion | video
  objetivo      text,                          -- ventas | trafico | marca | branding ...
  angulo_id     uuid REFERENCES public.mkt_angulo(id) ON DELETE SET NULL,
  material_url  text,                          -- footage / Drive
  audio         text,
  copy          text,                          -- copy + hashtags
  arte_url      text,
  notas_diseno  text,
  notas_cm      text,
  estado        text DEFAULT 'idea',           -- idea | guion | a_grabar | editando | ok_cliente | programado | publicado
  responsable   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid
);
CREATE INDEX IF NOT EXISTS mkt_evento_fecha_idx  ON public.mkt_evento(fecha);
CREATE INDEX IF NOT EXISTS mkt_evento_angulo_idx ON public.mkt_evento(angulo_id);

ALTER TABLE public.mkt_evento ENABLE ROW LEVEL SECURITY;
DO $rls$
BEGIN
  CREATE POLICY mkt_evento_sel ON public.mkt_evento FOR SELECT TO authenticated
    USING (current_user_role() = ANY (ARRAY['owner','admin','marketing']::role_enum[]));
  CREATE POLICY mkt_evento_all ON public.mkt_evento FOR ALL TO authenticated
    USING (current_user_role() = ANY (ARRAY['owner','admin','marketing']::role_enum[]))
    WITH CHECK (current_user_role() = ANY (ARRAY['owner','admin','marketing']::role_enum[]));
EXCEPTION WHEN duplicate_object THEN NULL;
END $rls$;
GRANT SELECT ON public.mkt_evento TO authenticated;

CREATE OR REPLACE FUNCTION public.mkt_rpc_upsert_evento(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE v_role role_enum; v_active boolean; v_id uuid;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin','marketing') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  IF NULLIF(trim(p_payload->>'titulo'),'') IS NULL THEN RAISE EXCEPTION 'Falta el titulo.' USING ERRCODE='22023'; END IF;
  v_id := NULLIF(p_payload->>'id','')::uuid;
  IF v_id IS NULL THEN
    INSERT INTO mkt_evento (fecha, titulo, plataforma, formato, objetivo, angulo_id, material_url, audio, copy, arte_url, notas_diseno, notas_cm, estado, responsable, created_by)
    VALUES (
      COALESCE(NULLIF(p_payload->>'fecha','')::date, CURRENT_DATE), trim(p_payload->>'titulo'),
      COALESCE(NULLIF(trim(p_payload->>'plataforma'),''),'instagram'), COALESCE(NULLIF(trim(p_payload->>'formato'),''),'reel'),
      NULLIF(trim(p_payload->>'objetivo'),''), NULLIF(p_payload->>'angulo_id','')::uuid,
      NULLIF(trim(p_payload->>'material_url'),''), NULLIF(trim(p_payload->>'audio'),''), NULLIF(trim(p_payload->>'copy'),''),
      NULLIF(trim(p_payload->>'arte_url'),''), NULLIF(trim(p_payload->>'notas_diseno'),''), NULLIF(trim(p_payload->>'notas_cm'),''),
      COALESCE(NULLIF(trim(p_payload->>'estado'),''),'idea'), NULLIF(trim(p_payload->>'responsable'),''), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE mkt_evento SET
      fecha = COALESCE(NULLIF(p_payload->>'fecha','')::date, fecha), titulo = trim(p_payload->>'titulo'),
      plataforma = COALESCE(NULLIF(trim(p_payload->>'plataforma'),''), plataforma), formato = COALESCE(NULLIF(trim(p_payload->>'formato'),''), formato),
      objetivo = NULLIF(trim(p_payload->>'objetivo'),''), angulo_id = NULLIF(p_payload->>'angulo_id','')::uuid,
      material_url = NULLIF(trim(p_payload->>'material_url'),''), audio = NULLIF(trim(p_payload->>'audio'),''),
      copy = NULLIF(trim(p_payload->>'copy'),''), arte_url = NULLIF(trim(p_payload->>'arte_url'),''),
      notas_diseno = NULLIF(trim(p_payload->>'notas_diseno'),''), notas_cm = NULLIF(trim(p_payload->>'notas_cm'),''),
      estado = COALESCE(NULLIF(trim(p_payload->>'estado'),''), estado), responsable = NULLIF(trim(p_payload->>'responsable'),'')
    WHERE id = v_id;
  END IF;
  RETURN jsonb_build_object('id', v_id);
END $fn$;

CREATE OR REPLACE FUNCTION public.mkt_rpc_delete_evento(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE v_role role_enum; v_active boolean;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin','marketing') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  DELETE FROM mkt_evento WHERE id = (p_payload->>'id')::uuid;
  RETURN jsonb_build_object('ok', true);
END $fn$;

REVOKE EXECUTE ON FUNCTION public.mkt_rpc_upsert_evento(jsonb), public.mkt_rpc_delete_evento(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mkt_rpc_upsert_evento(jsonb), public.mkt_rpc_delete_evento(jsonb) TO authenticated;

-- ROLLBACK: DROP FUNCTION mkt_rpc_upsert_evento(jsonb), mkt_rpc_delete_evento(jsonb); DROP TABLE mkt_evento;
