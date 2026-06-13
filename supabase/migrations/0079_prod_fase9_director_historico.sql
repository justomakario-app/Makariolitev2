-- ════════════════════════════════════════════════════════════════════
-- PRODUCCIÓN — Fase 9: Histórico, KPIs y Dashboard del Director (Capa 6)
-- ════════════════════════════════════════════════════════════════════
-- RPC de solo lectura que agrega la producción de un período [desde, hasta]
-- (por fecha de jornada) para el Dashboard del Director (= owner; no hay
-- rol 'director'). Devuelve KPIs, serie por día, top productos embalados,
-- mantenimientos recibidos y una comparativa contra el período anterior
-- de igual longitud. Solo owner/admin. 100% aditivo (no toca nada).
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.prod_rpc_director_historico(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_role role_enum; v_active boolean;
  v_hasta date := COALESCE(NULLIF(p_payload->>'hasta','')::date, CURRENT_DATE);
  v_desde date := COALESCE(NULLIF(p_payload->>'desde','')::date, CURRENT_DATE - 29);
  v_len int;
  v_prev_desde date; v_prev_hasta date;
  v_kpis jsonb; v_por_dia jsonb; v_top jsonb; v_mant jsonb;
  v_emb_actual numeric; v_emb_prev numeric;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo direccion.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  IF v_hasta < v_desde THEN
    RAISE EXCEPTION 'Rango invalido.' USING ERRCODE='22023'; END IF;

  v_len := (v_hasta - v_desde) + 1;
  v_prev_hasta := v_desde - 1;
  v_prev_desde := v_prev_hasta - (v_len - 1);

  -- KPIs del período (cortes netas con rendimiento de placa)
  SELECT jsonb_build_object(
    'jornadas',        (SELECT count(*) FROM prod_jornada WHERE fecha BETWEEN v_desde AND v_hasta),
    'piezas_cortadas', (SELECT COALESCE(SUM(GREATEST(c.hojas * COALESCE(pl.rendimiento,0) - c.desperdicio, 0)),0)
                          FROM prod_corte c JOIN prod_jornada jj ON jj.id = c.jornada_id
                          LEFT JOIN prod_placa pl ON pl.sku = c.placa_sku
                          WHERE jj.fecha BETWEEN v_desde AND v_hasta),
    'melamina_term',   (SELECT COALESCE(SUM(m.terminadas),0) FROM prod_melamina m JOIN prod_jornada jj ON jj.id = m.jornada_id WHERE jj.fecha BETWEEN v_desde AND v_hasta),
    'melamina_fallas', (SELECT COALESCE(SUM(m.fallas),0)     FROM prod_melamina m JOIN prod_jornada jj ON jj.id = m.jornada_id WHERE jj.fecha BETWEEN v_desde AND v_hasta),
    'patas_term',      (SELECT COALESCE(SUM(p.terminadas),0) FROM prod_pino p     JOIN prod_jornada jj ON jj.id = p.jornada_id WHERE jj.fecha BETWEEN v_desde AND v_hasta),
    'embalado',        (SELECT COALESCE(SUM(e.unidades),0)   FROM prod_embalaje e JOIN prod_jornada jj ON jj.id = e.jornada_id WHERE jj.fecha BETWEEN v_desde AND v_hasta),
    'mant_recibidos',  (SELECT count(*) FROM prod_mantenimiento WHERE estado='recibido_director' AND created_at::date BETWEEN v_desde AND v_hasta)
  ) INTO v_kpis;

  -- Comparativa: embalado período actual vs anterior (misma longitud)
  SELECT COALESCE(SUM(e.unidades),0) INTO v_emb_actual
    FROM prod_embalaje e JOIN prod_jornada jj ON jj.id = e.jornada_id WHERE jj.fecha BETWEEN v_desde AND v_hasta;
  SELECT COALESCE(SUM(e.unidades),0) INTO v_emb_prev
    FROM prod_embalaje e JOIN prod_jornada jj ON jj.id = e.jornada_id WHERE jj.fecha BETWEEN v_prev_desde AND v_prev_hasta;

  -- Serie por día (solo días con jornada)
  SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.dia), '[]'::jsonb) INTO v_por_dia FROM (
    SELECT jj.fecha AS dia,
      (SELECT COALESCE(SUM(GREATEST(c.hojas * COALESCE(pl.rendimiento,0) - c.desperdicio, 0)),0)
         FROM prod_corte c LEFT JOIN prod_placa pl ON pl.sku = c.placa_sku WHERE c.jornada_id = jj.id) AS cortes,
      (SELECT COALESCE(SUM(m.terminadas),0) FROM prod_melamina m WHERE m.jornada_id = jj.id) AS melamina,
      (SELECT COALESCE(SUM(p.terminadas),0) FROM prod_pino p     WHERE p.jornada_id = jj.id) AS pino,
      (SELECT COALESCE(SUM(e.unidades),0)   FROM prod_embalaje e WHERE e.jornada_id = jj.id) AS embalaje
    FROM prod_jornada jj WHERE jj.fecha BETWEEN v_desde AND v_hasta
  ) d;

  -- Top productos embalados
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.unidades DESC), '[]'::jsonb) INTO v_top FROM (
    SELECT e.producto_sku, COALESCE(pr.nombre, e.producto_sku) AS nombre, SUM(e.unidades) AS unidades
      FROM prod_embalaje e JOIN prod_jornada jj ON jj.id = e.jornada_id
      LEFT JOIN prod_producto pr ON pr.sku = e.producto_sku
      WHERE jj.fecha BETWEEN v_desde AND v_hasta
      GROUP BY e.producto_sku, pr.nombre
      ORDER BY unidades DESC LIMIT 15
  ) t;

  -- Mantenimientos recibidos por el director en el período
  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.created_at DESC), '[]'::jsonb) INTO v_mant FROM (
    SELECT id, sector, tipo, urgencia, maquina, descripcion, created_at
      FROM prod_mantenimiento
      WHERE estado='recibido_director' AND created_at::date BETWEEN v_desde AND v_hasta
  ) m;

  RETURN jsonb_build_object(
    'desde', v_desde, 'hasta', v_hasta,
    'kpis', v_kpis,
    'comparativa', jsonb_build_object('embalado_actual', v_emb_actual, 'embalado_prev', v_emb_prev,
                                      'prev_desde', v_prev_desde, 'prev_hasta', v_prev_hasta),
    'por_dia', v_por_dia,
    'top_productos', v_top,
    'mantenimientos', v_mant
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.prod_rpc_director_historico(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.prod_rpc_director_historico(jsonb) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual): DROP FUNCTION IF EXISTS public.prod_rpc_director_historico(jsonb);
-- ════════════════════════════════════════════════════════════════════
