-- ════════════════════════════════════════════════════════════════════
-- ADMIN MODULE — Cash Flow Diario (S2.16, arranque Fase 7)
-- ════════════════════════════════════════════════════════════════════
-- Sprint 11/22. Arranca Fase 7 (Contabilidad).
--
-- 1) Tabla cash_flow_manual (movimientos manuales con concepto libre).
-- 2) 5 RPCs nuevos: get_cash_flow + 4 CRUD de manuales.
--
-- DECISION JEFE (FASE 0): orders esta excluido del MVP por falta de
-- columna de monto. Cash flow se arma con 4 categorias:
--   - compras (expenses.activo=true, monto_total, fecha)
--   - sueldos (recibos.estado='emitido', total, fecha_pago)
--   - cheques (checks_issued + checks_received con signos)
--   - otros   (cash_flow_manual con activo=true)
--
-- Convencion de signos:
--   checks_received cobrado  →  + ingreso REAL (fecha_cobro)
--   checks_received emitido  →  + ingreso PROYECTADO (fecha_cobro_estimada)
--   checks_issued   cobrado  →  − egreso REAL (fecha_cobro)
--   checks_issued   emitido  →  − egreso PROYECTADO (fecha_cobro_estimada)
--   anulado / devuelto       →  excluido
--
-- Sin double counting: estados de cheques son mutuamente excluyentes
-- en un momento dado. Cuando emitido → cobrado, el cheque solo aparece
-- en "real" en su fecha_cobro.
--
-- Cero modificacion de tablas productivas. cash_flow_manual es aditiva.
-- ════════════════════════════════════════════════════════════════════

SET search_path = public;

-- ════════════════════════════════════════════════════════════════════
-- (1) TABLA cash_flow_manual
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.cash_flow_manual (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha       date NOT NULL,
  concepto    text NOT NULL,
  tipo        text NOT NULL CHECK (tipo IN ('ingreso','egreso')),
  monto       numeric(14,2) NOT NULL CHECK (monto > 0),
  categoria   text NOT NULL DEFAULT 'otros',
  notas       text,
  activo      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES public.profiles(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cash_flow_manual_concepto_length CHECK (length(concepto) BETWEEN 1 AND 200)
);

CREATE INDEX IF NOT EXISTS cash_flow_manual_fecha_idx     ON public.cash_flow_manual (fecha DESC);
CREATE INDEX IF NOT EXISTS cash_flow_manual_tipo_idx      ON public.cash_flow_manual (tipo);
CREATE INDEX IF NOT EXISTS cash_flow_manual_inactivo_idx  ON public.cash_flow_manual (activo) WHERE activo = false;
CREATE INDEX IF NOT EXISTS cash_flow_manual_categoria_idx ON public.cash_flow_manual (categoria);

-- Triggers
DROP TRIGGER IF EXISTS cash_flow_manual_set_updated_at ON public.cash_flow_manual;
CREATE TRIGGER cash_flow_manual_set_updated_at
  BEFORE UPDATE ON public.cash_flow_manual
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS cash_flow_manual_audit_log_trg ON public.cash_flow_manual;
CREATE TRIGGER cash_flow_manual_audit_log_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.cash_flow_manual
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit_log();

-- RLS
ALTER TABLE public.cash_flow_manual ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cash_flow_manual_select_owner_admin ON public.cash_flow_manual;
CREATE POLICY cash_flow_manual_select_owner_admin
  ON public.cash_flow_manual FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND active = true AND role IN ('owner','admin')));

DROP POLICY IF EXISTS cash_flow_manual_insert_owner_admin ON public.cash_flow_manual;
CREATE POLICY cash_flow_manual_insert_owner_admin
  ON public.cash_flow_manual FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND active = true AND role IN ('owner','admin')));

DROP POLICY IF EXISTS cash_flow_manual_update_owner_admin ON public.cash_flow_manual;
CREATE POLICY cash_flow_manual_update_owner_admin
  ON public.cash_flow_manual FOR UPDATE
  USING      (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND active = true AND role IN ('owner','admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND active = true AND role IN ('owner','admin')));

DROP POLICY IF EXISTS cash_flow_manual_delete_owner_admin ON public.cash_flow_manual;
CREATE POLICY cash_flow_manual_delete_owner_admin
  ON public.cash_flow_manual FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND active = true AND role IN ('owner','admin')));

COMMENT ON TABLE public.cash_flow_manual IS
  'S2.16 — Movimientos manuales de cash flow (ingresos/egresos no derivados de otras tablas). Categoria libre con default ''otros''.';

-- ════════════════════════════════════════════════════════════════════
-- (2) RPC rpc_admin_get_cash_flow(p_fecha_desde, p_fecha_hasta, p_incluir_proyectado)
-- ════════════════════════════════════════════════════════════════════
-- Devuelve jsonb con:
--   {
--     "kpis": {
--       "total_ingresos_real": N,
--       "total_egresos_real":  N,
--       "saldo_periodo_real":  N,
--       "total_ingresos_proy": N,
--       "total_egresos_proy":  N,
--       "saldo_periodo_proy":  N,
--       "saldo_final_proyectado": N
--     },
--     "filas": [
--       { "fecha":"YYYY-MM-DD", "compras":N, "sueldos":N, "cheques":N,
--         "otros":N, "total_dia":N, "saldo_acumulado":N, "clase":"real" }
--     ],
--     "proyectado_filas": [
--       { "fecha":"YYYY-MM-DD", "cheques":N, "total_dia":N,
--         "saldo_acumulado":N, "clase":"proyectado" }
--     ]
--   }
-- Saldo acumulado calculado en BD con SUM() OVER (ORDER BY fecha)
-- para evitar bugs de orden en frontend.
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rpc_admin_get_cash_flow(
  p_fecha_desde date,
  p_fecha_hasta date,
  p_incluir_proyectado boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_filas jsonb;
  v_proy_filas jsonb;
  v_kpis jsonb;
BEGIN
  -- Auth gate
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  IF p_fecha_desde IS NULL OR p_fecha_hasta IS NULL THEN
    RAISE EXCEPTION 'Rango de fechas requerido' USING ERRCODE='22023', HINT='period_required'; END IF;

  IF p_fecha_hasta < p_fecha_desde THEN
    RAISE EXCEPTION 'fecha_hasta debe ser >= fecha_desde' USING ERRCODE='22023', HINT='invalid_period'; END IF;

  -- Filas REALES: UNION ALL de 5 fuentes, agrupado por fecha con 4 categorias.
  WITH movimientos AS (
    -- Compras (egresos reales)
    SELECT e.fecha AS fecha, 'compras'::text AS categoria, -e.monto_total AS monto
      FROM public.expenses e
     WHERE e.activo = true
       AND e.fecha BETWEEN p_fecha_desde AND p_fecha_hasta

    UNION ALL
    -- Sueldos (egresos reales)
    SELECT r.fecha_pago, 'sueldos', -r.total
      FROM public.recibos r
     WHERE r.estado = 'emitido'
       AND r.total > 0
       AND r.fecha_pago BETWEEN p_fecha_desde AND p_fecha_hasta

    UNION ALL
    -- Cheques received cobrados (ingreso real)
    SELECT cr.fecha_cobro, 'cheques', cr.monto
      FROM public.checks_received cr
     WHERE cr.estado = 'cobrado'
       AND cr.fecha_cobro IS NOT NULL
       AND cr.fecha_cobro BETWEEN p_fecha_desde AND p_fecha_hasta

    UNION ALL
    -- Cheques issued cobrados (egreso real)
    SELECT ci.fecha_cobro, 'cheques', -ci.monto
      FROM public.checks_issued ci
     WHERE ci.estado = 'cobrado'
       AND ci.fecha_cobro IS NOT NULL
       AND ci.fecha_cobro BETWEEN p_fecha_desde AND p_fecha_hasta

    UNION ALL
    -- Manual (real, segun tipo)
    SELECT m.fecha, COALESCE(NULLIF(trim(m.categoria),''), 'otros'),
           CASE WHEN m.tipo = 'ingreso' THEN m.monto ELSE -m.monto END
      FROM public.cash_flow_manual m
     WHERE m.activo = true
       AND m.fecha BETWEEN p_fecha_desde AND p_fecha_hasta
  ),
  agrupado AS (
    SELECT
      fecha,
      COALESCE(SUM(monto) FILTER (WHERE categoria = 'compras'), 0) AS compras,
      COALESCE(SUM(monto) FILTER (WHERE categoria = 'sueldos'), 0) AS sueldos,
      COALESCE(SUM(monto) FILTER (WHERE categoria = 'cheques'), 0) AS cheques,
      COALESCE(SUM(monto) FILTER (WHERE categoria NOT IN ('compras','sueldos','cheques')), 0) AS otros,
      COALESCE(SUM(monto), 0) AS total_dia
    FROM movimientos
    GROUP BY fecha
  ),
  con_saldo AS (
    SELECT a.*,
           SUM(a.total_dia) OVER (ORDER BY a.fecha ROWS UNBOUNDED PRECEDING) AS saldo_acumulado
      FROM agrupado a
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'fecha',            cs.fecha,
           'compras',          cs.compras,
           'sueldos',          cs.sueldos,
           'cheques',          cs.cheques,
           'otros',            cs.otros,
           'total_dia',        cs.total_dia,
           'saldo_acumulado',  cs.saldo_acumulado,
           'clase',            'real'
         ) ORDER BY cs.fecha), '[]'::jsonb)
    INTO v_filas
    FROM con_saldo cs;

  -- Filas PROYECTADAS (solo cheques emitidos no cobrados, si p_incluir_proyectado)
  IF p_incluir_proyectado THEN
    WITH proy AS (
      SELECT cr.fecha_cobro_estimada AS fecha, cr.monto AS monto
        FROM public.checks_received cr
       WHERE cr.estado = 'emitido'
         AND cr.fecha_cobro_estimada IS NOT NULL
         AND cr.fecha_cobro_estimada BETWEEN p_fecha_desde AND p_fecha_hasta
      UNION ALL
      SELECT ci.fecha_cobro_estimada, -ci.monto
        FROM public.checks_issued ci
       WHERE ci.estado = 'emitido'
         AND ci.fecha_cobro_estimada IS NOT NULL
         AND ci.fecha_cobro_estimada BETWEEN p_fecha_desde AND p_fecha_hasta
    ),
    proy_agrupado AS (
      SELECT fecha, COALESCE(SUM(monto), 0) AS total_dia
        FROM proy GROUP BY fecha
    ),
    proy_con_saldo AS (
      SELECT pa.*,
             SUM(pa.total_dia) OVER (ORDER BY pa.fecha ROWS UNBOUNDED PRECEDING) AS saldo_acumulado
        FROM proy_agrupado pa
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'fecha',            pcs.fecha,
             'cheques',          pcs.total_dia,
             'total_dia',        pcs.total_dia,
             'saldo_acumulado',  pcs.saldo_acumulado,
             'clase',            'proyectado'
           ) ORDER BY pcs.fecha), '[]'::jsonb)
      INTO v_proy_filas
      FROM proy_con_saldo pcs;
  ELSE
    v_proy_filas := '[]'::jsonb;
  END IF;

  -- KPIs
  WITH r AS (
    SELECT
      COALESCE(SUM((it->>'total_dia')::numeric) FILTER (WHERE (it->>'total_dia')::numeric > 0), 0) AS ingresos_real,
      COALESCE(SUM((it->>'total_dia')::numeric) FILTER (WHERE (it->>'total_dia')::numeric < 0), 0) AS egresos_real
      FROM jsonb_array_elements(v_filas) AS it
  ),
  p AS (
    SELECT
      COALESCE(SUM((it->>'total_dia')::numeric) FILTER (WHERE (it->>'total_dia')::numeric > 0), 0) AS ingresos_proy,
      COALESCE(SUM((it->>'total_dia')::numeric) FILTER (WHERE (it->>'total_dia')::numeric < 0), 0) AS egresos_proy
      FROM jsonb_array_elements(v_proy_filas) AS it
  )
  SELECT jsonb_build_object(
    'total_ingresos_real',     r.ingresos_real,
    'total_egresos_real',      r.egresos_real,
    'saldo_periodo_real',      r.ingresos_real + r.egresos_real,
    'total_ingresos_proy',     p.ingresos_proy,
    'total_egresos_proy',      p.egresos_proy,
    'saldo_periodo_proy',      p.ingresos_proy + p.egresos_proy,
    'saldo_final_proyectado',  (r.ingresos_real + r.egresos_real) + (p.ingresos_proy + p.egresos_proy)
  )
  INTO v_kpis
  FROM r, p;

  RETURN jsonb_build_object(
    'fecha_desde',           p_fecha_desde,
    'fecha_hasta',           p_fecha_hasta,
    'incluir_proyectado',    p_incluir_proyectado,
    'kpis',                  v_kpis,
    'filas',                 v_filas,
    'proyectado_filas',      v_proy_filas
  );
END;
$$;

COMMENT ON FUNCTION public.rpc_admin_get_cash_flow(date, date, boolean) IS
  'S2.16 — Cash flow agrupado por fecha con 4 categorias. Real (UNION ALL 5 fuentes) + proyectado (cheques emitidos) condicional. Saldo acumulado calculado en BD.';

-- ════════════════════════════════════════════════════════════════════
-- (3) RPC rpc_admin_list_cash_flow_manual(...)
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rpc_admin_list_cash_flow_manual(
  p_fecha_desde date,
  p_fecha_hasta date,
  p_tipo        text DEFAULT NULL,
  p_include_inactivos boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_result jsonb;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  IF p_fecha_desde IS NULL OR p_fecha_hasta IS NULL THEN
    RAISE EXCEPTION 'Rango de fechas requerido' USING ERRCODE='22023', HINT='period_required'; END IF;

  IF p_tipo IS NOT NULL AND p_tipo NOT IN ('ingreso','egreso') THEN
    RAISE EXCEPTION 'Tipo invalido (ingreso/egreso)'
      USING ERRCODE='22023', HINT='invalid_tipo'; END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.fecha DESC, m.created_at DESC), '[]'::jsonb)
    INTO v_result
    FROM public.cash_flow_manual m
   WHERE m.fecha BETWEEN p_fecha_desde AND p_fecha_hasta
     AND (p_include_inactivos = true OR m.activo = true)
     AND (p_tipo IS NULL OR m.tipo = p_tipo);

  RETURN v_result;
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- (4) RPC rpc_admin_create_cash_flow_manual(payload)
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rpc_admin_create_cash_flow_manual(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_id uuid;
  v_fecha date; v_concepto text; v_tipo text; v_monto numeric(14,2);
  v_categoria text; v_notas text;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  v_fecha    := NULLIF(p_payload->>'fecha','')::date;
  v_concepto := NULLIF(trim(p_payload->>'concepto'),'');
  v_tipo     := NULLIF(trim(p_payload->>'tipo'),'');
  v_monto    := NULLIF(p_payload->>'monto','')::numeric;
  v_categoria:= COALESCE(NULLIF(lower(trim(p_payload->>'categoria')),''), 'otros');
  v_notas    := NULLIF(trim(p_payload->>'notas'),'');

  IF v_fecha IS NULL THEN
    RAISE EXCEPTION 'fecha requerida' USING ERRCODE='22023', HINT='fecha_required'; END IF;
  IF v_concepto IS NULL OR length(v_concepto) < 1 OR length(v_concepto) > 200 THEN
    RAISE EXCEPTION 'concepto requerido (1-200 caracteres)' USING ERRCODE='22023', HINT='concepto_invalid'; END IF;
  IF v_tipo NOT IN ('ingreso','egreso') THEN
    RAISE EXCEPTION 'tipo invalido (ingreso/egreso)' USING ERRCODE='22023', HINT='invalid_tipo'; END IF;
  IF v_monto IS NULL OR v_monto <= 0 THEN
    RAISE EXCEPTION 'monto debe ser > 0' USING ERRCODE='22023', HINT='monto_positive'; END IF;

  INSERT INTO public.cash_flow_manual (fecha, concepto, tipo, monto, categoria, notas, created_by)
  VALUES (v_fecha, v_concepto, v_tipo, v_monto, v_categoria, v_notas, auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('cash_flow_manual_id', v_id);
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- (5) RPC rpc_admin_update_cash_flow_manual(payload)
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rpc_admin_update_cash_flow_manual(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_id uuid := NULLIF(p_payload->>'id','')::uuid;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'id requerido' USING ERRCODE='22023'; END IF;

  UPDATE public.cash_flow_manual SET
    fecha     = CASE WHEN p_payload ? 'fecha'     THEN NULLIF(p_payload->>'fecha','')::date                                    ELSE fecha     END,
    concepto  = CASE WHEN p_payload ? 'concepto'  THEN COALESCE(NULLIF(trim(p_payload->>'concepto'),''), concepto)             ELSE concepto  END,
    tipo      = CASE WHEN p_payload ? 'tipo'      THEN COALESCE(NULLIF(trim(p_payload->>'tipo'),''), tipo)                     ELSE tipo      END,
    monto     = CASE WHEN p_payload ? 'monto'     THEN NULLIF(p_payload->>'monto','')::numeric                                  ELSE monto     END,
    categoria = CASE WHEN p_payload ? 'categoria' THEN COALESCE(NULLIF(lower(trim(p_payload->>'categoria')),''), 'otros')      ELSE categoria END,
    notas     = CASE WHEN p_payload ? 'notas'     THEN NULLIF(trim(p_payload->>'notas'),'')                                    ELSE notas     END,
    activo    = CASE WHEN p_payload ? 'activo'    THEN COALESCE((p_payload->>'activo')::boolean, activo)                       ELSE activo    END
  WHERE id = v_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movimiento manual no existe' USING ERRCODE='22023', HINT='not_found'; END IF;

  RETURN jsonb_build_object('cash_flow_manual_id', v_id, 'updated', true);
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- (6) RPC rpc_admin_delete_cash_flow_manual(payload) — soft delete
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rpc_admin_delete_cash_flow_manual(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_id uuid := NULLIF(p_payload->>'id','')::uuid;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'id requerido' USING ERRCODE='22023'; END IF;

  UPDATE public.cash_flow_manual SET activo = false WHERE id = v_id AND activo = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movimiento manual no existe o ya esta inactivo'
      USING ERRCODE='22023', HINT='not_found_or_inactive'; END IF;

  RETURN jsonb_build_object('cash_flow_manual_id', v_id, 'soft_deleted', true);
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- (7) REVOKE EXECUTE FROM anon, public + GRANT a authenticated
-- ════════════════════════════════════════════════════════════════════
REVOKE EXECUTE ON FUNCTION public.rpc_admin_get_cash_flow(date, date, boolean)         FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_list_cash_flow_manual(date, date, text, boolean) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_create_cash_flow_manual(jsonb)             FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_update_cash_flow_manual(jsonb)             FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_delete_cash_flow_manual(jsonb)             FROM anon, public;

GRANT EXECUTE ON FUNCTION public.rpc_admin_get_cash_flow(date, date, boolean)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_list_cash_flow_manual(date, date, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_create_cash_flow_manual(jsonb)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_update_cash_flow_manual(jsonb)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_delete_cash_flow_manual(jsonb)              TO authenticated;
