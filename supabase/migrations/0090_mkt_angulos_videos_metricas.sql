-- ════════════════════════════════════════════════════════════════════
-- MARKETING — Módulo 1/5: Ángulos de venta → Videos → Métricas
-- ════════════════════════════════════════════════════════════════════
-- El corazón del módulo de marketing. Tres niveles con drill-down:
--   ángulo de venta (Luxuria, Productos, Patria…) → sus videos → métricas.
-- Gate owner/admin/marketing. Aislado en tablas mkt_* (no toca nada).
--
-- API-READY: cada snapshot de métrica lleva `fuente` ('manual' por ahora,
-- 'api' cuando se integre Meta/IG/TikTok/YouTube) y `externo_id` para
-- matchear el objeto remoto. Hoy se carga a mano; el schema ya soporta
-- importar por API sin cambios.
-- ════════════════════════════════════════════════════════════════════

-- ── Ángulos de venta ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mkt_angulo (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      text NOT NULL,
  descripcion text,
  color       text DEFAULT '#7C3AED',
  orden       int  DEFAULT 0,
  activo      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid
);

-- ── Videos (por ángulo) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mkt_video (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  angulo_id    uuid NOT NULL REFERENCES public.mkt_angulo(id) ON DELETE CASCADE,
  titulo       text NOT NULL,
  plataforma   text DEFAULT 'instagram',  -- instagram | tiktok | youtube | meta
  formato      text DEFAULT 'reel',        -- reel | post | carrusel | story | video
  url          text,
  estado       text DEFAULT 'publicado',   -- borrador | programado | publicado
  fecha_publicacion date,
  externo_id   text,                        -- id del objeto remoto (API-ready)
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid
);
CREATE INDEX IF NOT EXISTS mkt_video_angulo_idx ON public.mkt_video(angulo_id);

-- ── Métricas (snapshots por video, en el tiempo) ──────────────────
CREATE TABLE IF NOT EXISTS public.mkt_video_metrica (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id       uuid NOT NULL REFERENCES public.mkt_video(id) ON DELETE CASCADE,
  fecha          date NOT NULL DEFAULT CURRENT_DATE,
  fuente         text NOT NULL DEFAULT 'manual',  -- manual | api
  alcance        int DEFAULT 0,   -- reach
  impresiones    int DEFAULT 0,
  reproducciones int DEFAULT 0,   -- views
  likes          int DEFAULT 0,
  comentarios    int DEFAULT 0,
  compartidos    int DEFAULT 0,   -- shares (clave para alcance)
  guardados      int DEFAULT 0,   -- saves (señal fuerte)
  vistas_3s      int DEFAULT 0,   -- para hook rate
  retencion_pct  numeric,         -- % retención / visualización promedio
  seguidores     int DEFAULT 0,   -- seguidores ganados desde el post
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  UNIQUE (video_id, fecha)         -- un snapshot por día (upsert)
);

-- ── RLS: owner/admin/marketing en todo ────────────────────────────
DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mkt_angulo','mkt_video','mkt_video_metrica'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    BEGIN
      EXECUTE format($p$
        CREATE POLICY %1$s_sel ON public.%1$I FOR SELECT TO authenticated
          USING (current_user_role() = ANY (ARRAY['owner','admin','marketing']::role_enum[]));$p$, t);
      EXECUTE format($p$
        CREATE POLICY %1$s_all ON public.%1$I FOR ALL TO authenticated
          USING (current_user_role() = ANY (ARRAY['owner','admin','marketing']::role_enum[]))
          WITH CHECK (current_user_role() = ANY (ARRAY['owner','admin','marketing']::role_enum[]));$p$, t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $rls$;

-- Grant de tabla (RLS filtra filas; las vistas son security_invoker → aplican el RLS del que consulta)
GRANT SELECT ON public.mkt_angulo, public.mkt_video, public.mkt_video_metrica TO authenticated;

-- ── Vista: video + última métrica + ER% y hook rate calculados ────
CREATE OR REPLACE VIEW public.mkt_v_video_resumen WITH (security_invoker = true) AS
SELECT v.id, v.angulo_id, v.titulo, v.plataforma, v.formato, v.url, v.estado, v.fecha_publicacion,
       m.fecha AS metrica_fecha, m.fuente,
       COALESCE(m.alcance,0) alcance, COALESCE(m.impresiones,0) impresiones, COALESCE(m.reproducciones,0) reproducciones,
       COALESCE(m.likes,0) likes, COALESCE(m.comentarios,0) comentarios, COALESCE(m.compartidos,0) compartidos,
       COALESCE(m.guardados,0) guardados, COALESCE(m.vistas_3s,0) vistas_3s, m.retencion_pct, COALESCE(m.seguidores,0) seguidores,
       CASE WHEN COALESCE(m.alcance,0) > 0
            THEN round((COALESCE(m.likes,0)+COALESCE(m.comentarios,0)+COALESCE(m.compartidos,0)+COALESCE(m.guardados,0))::numeric / m.alcance * 100, 2)
            ELSE 0 END AS er_pct,
       CASE WHEN COALESCE(m.impresiones,0) > 0
            THEN round(COALESCE(m.vistas_3s,0)::numeric / m.impresiones * 100, 2)
            ELSE 0 END AS hook_pct
FROM public.mkt_video v
LEFT JOIN LATERAL (
  SELECT * FROM public.mkt_video_metrica mm
  WHERE mm.video_id = v.id ORDER BY mm.fecha DESC, mm.created_at DESC LIMIT 1
) m ON true;
GRANT SELECT ON public.mkt_v_video_resumen TO authenticated;

-- ── Vista: ángulo + agregados ─────────────────────────────────────
CREATE OR REPLACE VIEW public.mkt_v_angulo_resumen WITH (security_invoker = true) AS
SELECT a.id, a.nombre, a.descripcion, a.color, a.orden, a.activo,
       count(vr.id) AS n_videos,
       COALESCE(sum(vr.alcance),0) AS alcance_total,
       COALESCE(sum(vr.reproducciones),0) AS reproducciones_total,
       COALESCE(round(avg(NULLIF(vr.er_pct,0)),2),0) AS er_promedio,
       COALESCE(round(avg(NULLIF(vr.hook_pct,0)),2),0) AS hook_promedio
FROM public.mkt_angulo a
LEFT JOIN public.mkt_v_video_resumen vr ON vr.angulo_id = a.id
GROUP BY a.id, a.nombre, a.descripcion, a.color, a.orden, a.activo;
GRANT SELECT ON public.mkt_v_angulo_resumen TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- RPCs (SECURITY DEFINER, gate owner/admin/marketing)
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.mkt_rpc_upsert_angulo(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE v_role role_enum; v_active boolean; v_id uuid;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin','marketing') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  IF NULLIF(trim(p_payload->>'nombre'),'') IS NULL THEN RAISE EXCEPTION 'Falta el nombre del angulo.' USING ERRCODE='22023'; END IF;
  v_id := NULLIF(p_payload->>'id','')::uuid;
  IF v_id IS NULL THEN
    INSERT INTO mkt_angulo (nombre, descripcion, color, orden, created_by)
    VALUES (trim(p_payload->>'nombre'), NULLIF(trim(p_payload->>'descripcion'),''),
            COALESCE(NULLIF(trim(p_payload->>'color'),''),'#7C3AED'), COALESCE((p_payload->>'orden')::int,0), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE mkt_angulo SET
      nombre = trim(p_payload->>'nombre'),
      descripcion = NULLIF(trim(p_payload->>'descripcion'),''),
      color = COALESCE(NULLIF(trim(p_payload->>'color'),''), color),
      orden = COALESCE((p_payload->>'orden')::int, orden),
      activo = COALESCE((p_payload->>'activo')::boolean, activo)
    WHERE id = v_id;
  END IF;
  RETURN jsonb_build_object('id', v_id);
END $fn$;

CREATE OR REPLACE FUNCTION public.mkt_rpc_delete_angulo(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE v_role role_enum; v_active boolean;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin','marketing') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  DELETE FROM mkt_angulo WHERE id = (p_payload->>'id')::uuid;  -- CASCADE borra videos + métricas
  RETURN jsonb_build_object('ok', true);
END $fn$;

CREATE OR REPLACE FUNCTION public.mkt_rpc_upsert_video(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE v_role role_enum; v_active boolean; v_id uuid;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin','marketing') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  IF NULLIF(p_payload->>'angulo_id','') IS NULL THEN RAISE EXCEPTION 'Falta el angulo.' USING ERRCODE='22023'; END IF;
  IF NULLIF(trim(p_payload->>'titulo'),'') IS NULL THEN RAISE EXCEPTION 'Falta el titulo del video.' USING ERRCODE='22023'; END IF;
  v_id := NULLIF(p_payload->>'id','')::uuid;
  IF v_id IS NULL THEN
    INSERT INTO mkt_video (angulo_id, titulo, plataforma, formato, url, estado, fecha_publicacion, externo_id, created_by)
    VALUES ((p_payload->>'angulo_id')::uuid, trim(p_payload->>'titulo'),
            COALESCE(NULLIF(trim(p_payload->>'plataforma'),''),'instagram'),
            COALESCE(NULLIF(trim(p_payload->>'formato'),''),'reel'),
            NULLIF(trim(p_payload->>'url'),''), COALESCE(NULLIF(trim(p_payload->>'estado'),''),'publicado'),
            NULLIF(p_payload->>'fecha_publicacion','')::date, NULLIF(trim(p_payload->>'externo_id'),''), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE mkt_video SET
      titulo = trim(p_payload->>'titulo'),
      plataforma = COALESCE(NULLIF(trim(p_payload->>'plataforma'),''), plataforma),
      formato = COALESCE(NULLIF(trim(p_payload->>'formato'),''), formato),
      url = NULLIF(trim(p_payload->>'url'),''),
      estado = COALESCE(NULLIF(trim(p_payload->>'estado'),''), estado),
      fecha_publicacion = NULLIF(p_payload->>'fecha_publicacion','')::date
    WHERE id = v_id;
  END IF;
  RETURN jsonb_build_object('id', v_id);
END $fn$;

CREATE OR REPLACE FUNCTION public.mkt_rpc_delete_video(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE v_role role_enum; v_active boolean;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin','marketing') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  DELETE FROM mkt_video WHERE id = (p_payload->>'id')::uuid;  -- CASCADE borra métricas
  RETURN jsonb_build_object('ok', true);
END $fn$;

CREATE OR REPLACE FUNCTION public.mkt_rpc_cargar_metrica(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE v_role role_enum; v_active boolean; v_id uuid;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin','marketing') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  IF NULLIF(p_payload->>'video_id','') IS NULL THEN RAISE EXCEPTION 'Falta el video.' USING ERRCODE='22023'; END IF;
  INSERT INTO mkt_video_metrica (video_id, fecha, fuente, alcance, impresiones, reproducciones,
      likes, comentarios, compartidos, guardados, vistas_3s, retencion_pct, seguidores, created_by)
  VALUES ((p_payload->>'video_id')::uuid,
      COALESCE(NULLIF(p_payload->>'fecha','')::date, CURRENT_DATE),
      COALESCE(NULLIF(trim(p_payload->>'fuente'),''),'manual'),
      COALESCE((p_payload->>'alcance')::int,0), COALESCE((p_payload->>'impresiones')::int,0),
      COALESCE((p_payload->>'reproducciones')::int,0), COALESCE((p_payload->>'likes')::int,0),
      COALESCE((p_payload->>'comentarios')::int,0), COALESCE((p_payload->>'compartidos')::int,0),
      COALESCE((p_payload->>'guardados')::int,0), COALESCE((p_payload->>'vistas_3s')::int,0),
      NULLIF(p_payload->>'retencion_pct','')::numeric, COALESCE((p_payload->>'seguidores')::int,0), auth.uid())
  ON CONFLICT (video_id, fecha) DO UPDATE SET
      fuente=EXCLUDED.fuente, alcance=EXCLUDED.alcance, impresiones=EXCLUDED.impresiones,
      reproducciones=EXCLUDED.reproducciones, likes=EXCLUDED.likes, comentarios=EXCLUDED.comentarios,
      compartidos=EXCLUDED.compartidos, guardados=EXCLUDED.guardados, vistas_3s=EXCLUDED.vistas_3s,
      retencion_pct=EXCLUDED.retencion_pct, seguidores=EXCLUDED.seguidores
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id);
END $fn$;

REVOKE EXECUTE ON FUNCTION public.mkt_rpc_upsert_angulo(jsonb), public.mkt_rpc_delete_angulo(jsonb),
  public.mkt_rpc_upsert_video(jsonb), public.mkt_rpc_delete_video(jsonb), public.mkt_rpc_cargar_metrica(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mkt_rpc_upsert_angulo(jsonb), public.mkt_rpc_delete_angulo(jsonb),
  public.mkt_rpc_upsert_video(jsonb), public.mkt_rpc_delete_video(jsonb), public.mkt_rpc_cargar_metrica(jsonb) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual): DROP las 2 vistas, las 5 RPCs y las 3 tablas (mkt_video_metrica,
-- mkt_video, mkt_angulo en ese orden por las FK).
-- ════════════════════════════════════════════════════════════════════
