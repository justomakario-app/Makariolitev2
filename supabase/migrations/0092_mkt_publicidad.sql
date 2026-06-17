-- ════════════════════════════════════════════════════════════════════
-- MARKETING — Módulo 3/5: Publicidad (campañas pagas)
-- ════════════════════════════════════════════════════════════════════
-- Campañas (Meta Ads / IG / TikTok / YouTube) + snapshots de métricas.
-- La vista calcula CPM, CPC, CTR, CPR (costo por resultado) y ROAS solos.
-- API-ready (fuente manual/api + externo_id). Gate owner/admin/marketing.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.mkt_campania (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre       text NOT NULL,
  plataforma   text DEFAULT 'meta',        -- meta | instagram | tiktok | youtube
  objetivo     text,                        -- ventas | trafico | alcance | mensajes | leads
  fecha_inicio date,
  fecha_fin    date,
  presupuesto  numeric,
  estado       text DEFAULT 'activa',       -- activa | pausada | finalizada
  externo_id   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid
);

CREATE TABLE IF NOT EXISTS public.mkt_campania_metrica (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campania_id   uuid NOT NULL REFERENCES public.mkt_campania(id) ON DELETE CASCADE,
  fecha         date NOT NULL DEFAULT CURRENT_DATE,
  fuente        text NOT NULL DEFAULT 'manual',
  gasto         numeric DEFAULT 0,
  impresiones   int DEFAULT 0,
  alcance       int DEFAULT 0,
  clicks        int DEFAULT 0,
  resultados    int DEFAULT 0,             -- conversiones (compras/leads/mensajes)
  tipo_resultado text,                      -- qué cuenta como resultado
  ingresos      numeric DEFAULT 0,          -- revenue atribuido → ROAS
  frecuencia    numeric,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  UNIQUE (campania_id, fecha)
);

DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mkt_campania','mkt_campania_metrica'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    BEGIN
      EXECUTE format($p$CREATE POLICY %1$s_sel ON public.%1$I FOR SELECT TO authenticated
        USING (current_user_role() = ANY (ARRAY['owner','admin','marketing']::role_enum[]));$p$, t);
      EXECUTE format($p$CREATE POLICY %1$s_all ON public.%1$I FOR ALL TO authenticated
        USING (current_user_role() = ANY (ARRAY['owner','admin','marketing']::role_enum[]))
        WITH CHECK (current_user_role() = ANY (ARRAY['owner','admin','marketing']::role_enum[]));$p$, t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $rls$;
GRANT SELECT ON public.mkt_campania, public.mkt_campania_metrica TO authenticated;

-- Vista: campaña + última métrica + métricas calculadas
CREATE OR REPLACE VIEW public.mkt_v_campania_resumen WITH (security_invoker = true) AS
SELECT c.id, c.nombre, c.plataforma, c.objetivo, c.fecha_inicio, c.fecha_fin, c.presupuesto, c.estado,
       m.fecha AS metrica_fecha, m.fuente,
       COALESCE(m.gasto,0) gasto, COALESCE(m.impresiones,0) impresiones, COALESCE(m.alcance,0) alcance,
       COALESCE(m.clicks,0) clicks, COALESCE(m.resultados,0) resultados, m.tipo_resultado,
       COALESCE(m.ingresos,0) ingresos, m.frecuencia,
       CASE WHEN COALESCE(m.impresiones,0)>0 THEN round(COALESCE(m.gasto,0)/m.impresiones*1000,2) ELSE 0 END AS cpm,
       CASE WHEN COALESCE(m.clicks,0)>0 THEN round(COALESCE(m.gasto,0)/m.clicks,2) ELSE 0 END AS cpc,
       CASE WHEN COALESCE(m.impresiones,0)>0 THEN round(COALESCE(m.clicks,0)::numeric/m.impresiones*100,2) ELSE 0 END AS ctr,
       CASE WHEN COALESCE(m.resultados,0)>0 THEN round(COALESCE(m.gasto,0)/m.resultados,2) ELSE 0 END AS cpr,
       CASE WHEN COALESCE(m.gasto,0)>0 THEN round(COALESCE(m.ingresos,0)/m.gasto,2) ELSE 0 END AS roas
FROM public.mkt_campania c
LEFT JOIN LATERAL (
  SELECT * FROM public.mkt_campania_metrica mm WHERE mm.campania_id = c.id ORDER BY mm.fecha DESC, mm.created_at DESC LIMIT 1
) m ON true;
GRANT SELECT ON public.mkt_v_campania_resumen TO authenticated;

CREATE OR REPLACE FUNCTION public.mkt_rpc_upsert_campania(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE v_role role_enum; v_active boolean; v_id uuid;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin','marketing') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  IF NULLIF(trim(p_payload->>'nombre'),'') IS NULL THEN RAISE EXCEPTION 'Falta el nombre de la campania.' USING ERRCODE='22023'; END IF;
  v_id := NULLIF(p_payload->>'id','')::uuid;
  IF v_id IS NULL THEN
    INSERT INTO mkt_campania (nombre, plataforma, objetivo, fecha_inicio, fecha_fin, presupuesto, estado, externo_id, created_by)
    VALUES (trim(p_payload->>'nombre'), COALESCE(NULLIF(trim(p_payload->>'plataforma'),''),'meta'), NULLIF(trim(p_payload->>'objetivo'),''),
      NULLIF(p_payload->>'fecha_inicio','')::date, NULLIF(p_payload->>'fecha_fin','')::date, NULLIF(p_payload->>'presupuesto','')::numeric,
      COALESCE(NULLIF(trim(p_payload->>'estado'),''),'activa'), NULLIF(trim(p_payload->>'externo_id'),''), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE mkt_campania SET nombre=trim(p_payload->>'nombre'),
      plataforma=COALESCE(NULLIF(trim(p_payload->>'plataforma'),''),plataforma), objetivo=NULLIF(trim(p_payload->>'objetivo'),''),
      fecha_inicio=NULLIF(p_payload->>'fecha_inicio','')::date, fecha_fin=NULLIF(p_payload->>'fecha_fin','')::date,
      presupuesto=NULLIF(p_payload->>'presupuesto','')::numeric, estado=COALESCE(NULLIF(trim(p_payload->>'estado'),''),estado)
    WHERE id=v_id;
  END IF;
  RETURN jsonb_build_object('id', v_id);
END $fn$;

CREATE OR REPLACE FUNCTION public.mkt_rpc_delete_campania(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE v_role role_enum; v_active boolean;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin','marketing') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  DELETE FROM mkt_campania WHERE id = (p_payload->>'id')::uuid;
  RETURN jsonb_build_object('ok', true);
END $fn$;

CREATE OR REPLACE FUNCTION public.mkt_rpc_cargar_campania_metrica(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $fn$
DECLARE v_role role_enum; v_active boolean; v_id uuid;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin','marketing') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  IF NULLIF(p_payload->>'campania_id','') IS NULL THEN RAISE EXCEPTION 'Falta la campania.' USING ERRCODE='22023'; END IF;
  INSERT INTO mkt_campania_metrica (campania_id, fecha, fuente, gasto, impresiones, alcance, clicks, resultados, tipo_resultado, ingresos, frecuencia, created_by)
  VALUES ((p_payload->>'campania_id')::uuid, COALESCE(NULLIF(p_payload->>'fecha','')::date, CURRENT_DATE),
    COALESCE(NULLIF(trim(p_payload->>'fuente'),''),'manual'), COALESCE(NULLIF(p_payload->>'gasto','')::numeric,0),
    COALESCE((p_payload->>'impresiones')::int,0), COALESCE((p_payload->>'alcance')::int,0), COALESCE((p_payload->>'clicks')::int,0),
    COALESCE((p_payload->>'resultados')::int,0), NULLIF(trim(p_payload->>'tipo_resultado'),''),
    COALESCE(NULLIF(p_payload->>'ingresos','')::numeric,0), NULLIF(p_payload->>'frecuencia','')::numeric, auth.uid())
  ON CONFLICT (campania_id, fecha) DO UPDATE SET fuente=EXCLUDED.fuente, gasto=EXCLUDED.gasto, impresiones=EXCLUDED.impresiones,
    alcance=EXCLUDED.alcance, clicks=EXCLUDED.clicks, resultados=EXCLUDED.resultados, tipo_resultado=EXCLUDED.tipo_resultado,
    ingresos=EXCLUDED.ingresos, frecuencia=EXCLUDED.frecuencia
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id);
END $fn$;

REVOKE EXECUTE ON FUNCTION public.mkt_rpc_upsert_campania(jsonb), public.mkt_rpc_delete_campania(jsonb), public.mkt_rpc_cargar_campania_metrica(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mkt_rpc_upsert_campania(jsonb), public.mkt_rpc_delete_campania(jsonb), public.mkt_rpc_cargar_campania_metrica(jsonb) TO authenticated;

-- ROLLBACK: DROP las 3 RPCs, la vista, mkt_campania_metrica, mkt_campania.
