-- ════════════════════════════════════════════════════════════════════
-- MARKETING — Módulo 5/5: Dashboard general (RPC agregada)
-- ════════════════════════════════════════════════════════════════════
-- KPIs macro de todo marketing: orgánico (videos), pago (campañas) y
-- ángulos. Solo lectura, gate owner/admin/marketing. Lee de las vistas
-- mkt_v_* (la RPC es SECURITY DEFINER → agrega todo).
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.mkt_rpc_dashboard(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE
  v_role role_enum; v_active boolean;
  k jsonb; top_ang jsonb; top_vid jsonb;
  v_alcance bigint; v_repro bigint; v_er numeric; v_hook numeric; v_seg bigint; v_nvid int; v_nang int;
  v_gasto numeric; v_result bigint; v_ingr numeric; v_ncamp int;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin','marketing') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  -- Orgánico
  SELECT COALESCE(sum(alcance),0), COALESCE(sum(reproducciones),0),
         COALESCE(round(avg(NULLIF(er_pct,0)),2),0), COALESCE(round(avg(NULLIF(hook_pct,0)),2),0),
         COALESCE(sum(seguidores),0), count(1)
    INTO v_alcance, v_repro, v_er, v_hook, v_seg, v_nvid
  FROM mkt_v_video_resumen;
  SELECT count(1) INTO v_nang FROM mkt_angulo WHERE activo = true;

  -- Pago
  SELECT COALESCE(sum(gasto),0), COALESCE(sum(resultados),0), COALESCE(sum(ingresos),0)
    INTO v_gasto, v_result, v_ingr FROM mkt_v_campania_resumen;
  SELECT count(1) INTO v_ncamp FROM mkt_campania WHERE estado = 'activa';

  k := jsonb_build_object(
    'alcance', v_alcance, 'reproducciones', v_repro, 'er_promedio', v_er, 'hook_promedio', v_hook,
    'seguidores', v_seg, 'n_videos', v_nvid, 'n_angulos', v_nang,
    'gasto', v_gasto, 'resultados', v_result, 'ingresos', v_ingr, 'n_campanias', v_ncamp,
    'roas', CASE WHEN v_gasto>0 THEN round(v_ingr/v_gasto,2) ELSE 0 END,
    'cpr', CASE WHEN v_result>0 THEN round(v_gasto/v_result,2) ELSE 0 END
  );

  SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO top_ang FROM (
    SELECT id, nombre, color, n_videos, alcance_total, er_promedio, hook_promedio
    FROM mkt_v_angulo_resumen ORDER BY alcance_total DESC NULLS LAST LIMIT 5) t;

  SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO top_vid FROM (
    SELECT id, titulo, plataforma, alcance, er_pct, hook_pct
    FROM mkt_v_video_resumen ORDER BY er_pct DESC NULLS LAST, alcance DESC LIMIT 5) t;

  RETURN jsonb_build_object('kpis', k, 'top_angulos', top_ang, 'top_videos', top_vid);
END $fn$;

REVOKE EXECUTE ON FUNCTION public.mkt_rpc_dashboard(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mkt_rpc_dashboard(jsonb) TO authenticated;

-- ROLLBACK: DROP FUNCTION public.mkt_rpc_dashboard(jsonb);
