-- ════════════════════════════════════════════════════════════════════
-- PRODUCCIÓN — Fase 5b: Optimizador de placas (CNC) · Brief Lógica 2 §7.2
-- ════════════════════════════════════════════════════════════════════
-- Dada la demanda de tapas (prod_v_demanda_corte), calcula el plan de
-- corte que minimiza la CANTIDAD de placas (y a igualdad, la merma),
-- aprovechando las placas COMBINADAS (rinden 2 medidas en un corte).
--
-- Lógica: las placas combinadas vinculan un par (tapa_prim, tapa_extra)
-- — ej. COM001 = TAP003(40)×8 + TAP005(50)×15. Para cada par se hace una
-- BÚSQUEDA EXACTA del nº de combos óptimo (escala diaria chica → barato):
-- por cada n de combos, se cubren los residuos con placas simples y se
-- elige el n de menor (placas, luego merma). Las tapas sin combo van a su
-- placa simple = ceil(demanda / rendimiento).
--
-- Solo lectura, gate cnc/encargado/owner/admin. 100% aditivo.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.prod_rpc_plan_corte(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_role role_enum; v_active boolean;
  v_plan jsonb := '[]'::jsonb;
  v_total_placas int := 0;
  v_total_merma  int := 0;
  c record;
  d_prim int; d_extra int;
  s_prim_rend int; s_prim_placa text; s_extra_rend int; s_extra_placa text;
  best_n int; best_cost int; best_merma int;
  n int; nmax int; prod_p int; prod_e int; res_p int; res_e int; sp int; se int; cost int; merma int;
  covered text[] := '{}';
  q int;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin','encargado','cnc') THEN
    RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  DROP TABLE IF EXISTS _dem;
  CREATE TEMP TABLE _dem ON COMMIT DROP AS
    SELECT sku, demanda::int AS d FROM prod_v_demanda_corte WHERE clase = 'tapa' AND demanda > 0;

  -- ── Pares con placa combinada ──────────────────────────────────────
  FOR c IN
    SELECT pl.sku AS placa, pl.material, pl.pieza_sku AS prim, pl.rendimiento AS r_prim,
           e.pieza_sku AS extra, e.rendimiento AS r_extra
    FROM prod_placa pl JOIN prod_placa_pieza_extra e ON e.placa_sku = pl.sku
    WHERE pl.combinada = true
  LOOP
    d_prim  := COALESCE((SELECT d FROM _dem WHERE sku = c.prim), 0);
    d_extra := COALESCE((SELECT d FROM _dem WHERE sku = c.extra), 0);
    covered := covered || c.prim || c.extra;
    IF d_prim = 0 AND d_extra = 0 THEN CONTINUE; END IF;

    SELECT rendimiento, sku INTO s_prim_rend,  s_prim_placa  FROM prod_placa WHERE combinada = false AND pieza_sku = c.prim  ORDER BY rendimiento DESC LIMIT 1;
    SELECT rendimiento, sku INTO s_extra_rend, s_extra_placa FROM prod_placa WHERE combinada = false AND pieza_sku = c.extra ORDER BY rendimiento DESC LIMIT 1;

    nmax := GREATEST(
      CASE WHEN c.r_prim  > 0 THEN CEIL(d_prim::numeric  / c.r_prim)  ELSE 0 END,
      CASE WHEN c.r_extra > 0 THEN CEIL(d_extra::numeric / c.r_extra) ELSE 0 END)::int;
    best_n := 0; best_cost := NULL; best_merma := NULL;
    FOR n IN 0..nmax LOOP
      prod_p := n * c.r_prim; prod_e := n * c.r_extra;
      res_p := GREATEST(d_prim - prod_p, 0); res_e := GREATEST(d_extra - prod_e, 0);
      -- si no hay placa simple para cubrir un residuo, ese n es inválido
      IF (res_p > 0 AND COALESCE(s_prim_rend,0) = 0) OR (res_e > 0 AND COALESCE(s_extra_rend,0) = 0) THEN
        CONTINUE; END IF;
      sp := CASE WHEN res_p > 0 THEN CEIL(res_p::numeric / s_prim_rend)::int  ELSE 0 END;
      se := CASE WHEN res_e > 0 THEN CEIL(res_e::numeric / s_extra_rend)::int ELSE 0 END;
      cost  := n + sp + se;
      merma := (prod_p + sp * COALESCE(s_prim_rend,0) - d_prim) + (prod_e + se * COALESCE(s_extra_rend,0) - d_extra);
      IF best_cost IS NULL OR cost < best_cost OR (cost = best_cost AND merma < best_merma) THEN
        best_cost := cost; best_merma := merma; best_n := n;
      END IF;
    END LOOP;

    IF best_n > 0 THEN
      v_plan := v_plan || jsonb_build_array(jsonb_build_object(
        'placa', c.placa, 'material', c.material, 'tipo', 'combinada', 'cantidad', best_n,
        'produce', jsonb_build_object(c.prim, best_n * c.r_prim, c.extra, best_n * c.r_extra)));
      v_total_placas := v_total_placas + best_n;
    END IF;
    prod_p := best_n * c.r_prim; prod_e := best_n * c.r_extra;
    res_p := GREATEST(d_prim - prod_p, 0); res_e := GREATEST(d_extra - prod_e, 0);
    IF res_p > 0 AND COALESCE(s_prim_rend,0) > 0 THEN
      sp := CEIL(res_p::numeric / s_prim_rend)::int;
      v_plan := v_plan || jsonb_build_array(jsonb_build_object(
        'placa', s_prim_placa, 'material', c.material, 'tipo', 'simple', 'cantidad', sp,
        'produce', jsonb_build_object(c.prim, sp * s_prim_rend)));
      v_total_placas := v_total_placas + sp;
    END IF;
    IF res_e > 0 AND COALESCE(s_extra_rend,0) > 0 THEN
      se := CEIL(res_e::numeric / s_extra_rend)::int;
      v_plan := v_plan || jsonb_build_array(jsonb_build_object(
        'placa', s_extra_placa, 'material', c.material, 'tipo', 'simple', 'cantidad', se,
        'produce', jsonb_build_object(c.extra, se * s_extra_rend)));
      v_total_placas := v_total_placas + se;
    END IF;
    v_total_merma := v_total_merma + COALESCE(best_merma, 0);
  END LOOP;

  -- ── Tapas sin combo → placa simple (ceil) ──────────────────────────
  FOR c IN
    SELECT DISTINCT ON (dm.sku) dm.sku, dm.d, pl.sku AS placa, pl.material, pl.rendimiento AS rend
    FROM _dem dm
    JOIN prod_placa pl ON pl.combinada = false AND pl.pieza_sku = dm.sku
    WHERE NOT (dm.sku = ANY(covered))
    ORDER BY dm.sku, pl.rendimiento DESC
  LOOP
    IF COALESCE(c.rend,0) = 0 THEN CONTINUE; END IF;
    q := CEIL(c.d::numeric / c.rend)::int;
    v_plan := v_plan || jsonb_build_array(jsonb_build_object(
      'placa', c.placa, 'material', c.material, 'tipo', 'simple', 'cantidad', q,
      'produce', jsonb_build_object(c.sku, q * c.rend)));
    v_total_placas := v_total_placas + q;
    v_total_merma  := v_total_merma + (q * c.rend - c.d);
  END LOOP;

  RETURN jsonb_build_object('total_placas', v_total_placas, 'total_merma', v_total_merma, 'plan', v_plan);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.prod_rpc_plan_corte(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.prod_rpc_plan_corte(jsonb) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual): DROP FUNCTION IF EXISTS public.prod_rpc_plan_corte(jsonb);
-- ════════════════════════════════════════════════════════════════════
