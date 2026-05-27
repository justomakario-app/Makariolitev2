-- ════════════════════════════════════════════════════════════════════
-- ADMIN MODULE — Cierres contables (Fase 8 / S2.19 + S2.20)
-- ════════════════════════════════════════════════════════════════════
-- Sprint 12/22. Cierre contable mensual + anual con bloqueo via RPC
-- validation (no triggers). Reapertura SOLO owner con motivo escrito.
--
-- Migration 0063 = parte A:
--   1) Tabla cierres_periodo (18 columnas + snapshot jsonb).
--   2) Helper _admin_check_periodo_cerrado(date) STABLE.
--   3) 7 RPCs nuevos:
--      a. rpc_admin_get_cierres
--      b. rpc_admin_preview_cierre
--      c. rpc_admin_crear_cierre              (UNION ALL + snapshot)
--      d. rpc_admin_reabrir_cierre            (solo owner + bloqueo posteriores)
--      e. rpc_admin_get_reporte_cierre        (usa snapshot guardado)
--      f. rpc_admin_get_saldo_historico
--      g. rpc_admin_validar_periodo_apertura  (wrapper publico)
--
-- Migration 0064 (parte B, separada) patcheara los 17 RPCs existentes
-- con el bloque de validacion al inicio. NO se ejecuta en este archivo.
--
-- Cero modificacion de produccion. Tabla y RPCs aditivos.
-- ════════════════════════════════════════════════════════════════════

SET search_path = public;

-- ════════════════════════════════════════════════════════════════════
-- (1) TABLA cierres_periodo
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.cierres_periodo (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo                        text NOT NULL CHECK (tipo IN ('mensual','anual')),
  periodo_desde               date NOT NULL,
  periodo_hasta               date NOT NULL,
  estado                      text NOT NULL DEFAULT 'cerrado'
                                CHECK (estado IN ('cerrado','reabierto')),

  -- Snapshot saldos
  saldo_apertura              numeric(14,2) NOT NULL DEFAULT 0,
  saldo_cierre                numeric(14,2) NOT NULL,
  saldo_acumulado_historico   numeric(14,2) NOT NULL,
  total_ingresos              numeric(14,2) NOT NULL,
  total_egresos               numeric(14,2) NOT NULL,
  count_movimientos           int NOT NULL DEFAULT 0,

  -- Auditoria cierre
  cerrado_at                  timestamptz NOT NULL DEFAULT now(),
  cerrado_por                 uuid REFERENCES public.profiles(id),
  notas                       text,

  -- Reapertura (solo owner)
  motivo_reapertura           text,
  reabierto_at                timestamptz,
  reabierto_por               uuid REFERENCES public.profiles(id),

  -- Snapshot detallado para el reporte (sin recalcular)
  -- { breakdown_categorias, top_proveedores, top_empleados, periodo_anterior }
  snapshot_jsonb              jsonb,

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cierres_periodo_check          CHECK (periodo_hasta >= periodo_desde),
  CONSTRAINT cierres_periodo_saldo_check    CHECK (saldo_cierre = saldo_apertura + total_ingresos + total_egresos),
  CONSTRAINT cierres_periodo_motivo_length  CHECK (motivo_reapertura IS NULL OR length(motivo_reapertura) BETWEEN 1 AND 500),
  CONSTRAINT cierres_periodo_reabierto_check CHECK (
    (estado = 'cerrado'  AND motivo_reapertura IS NULL AND reabierto_at IS NULL AND reabierto_por IS NULL) OR
    (estado = 'reabierto' AND motivo_reapertura IS NOT NULL AND reabierto_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS cierres_periodo_estado_idx ON public.cierres_periodo (estado);
CREATE INDEX IF NOT EXISTS cierres_periodo_tipo_idx   ON public.cierres_periodo (tipo);
CREATE INDEX IF NOT EXISTS cierres_periodo_desde_idx  ON public.cierres_periodo (periodo_desde, periodo_hasta);

/* UNIQUE solo entre cierres del mismo tipo activos.
   Permite mensual + anual coexistir si ambos cubren una fecha. */
CREATE UNIQUE INDEX IF NOT EXISTS cierres_periodo_unique_active_idx
  ON public.cierres_periodo (tipo, periodo_desde, periodo_hasta)
  WHERE estado = 'cerrado';

-- Triggers
DROP TRIGGER IF EXISTS cierres_periodo_set_updated_at ON public.cierres_periodo;
CREATE TRIGGER cierres_periodo_set_updated_at
  BEFORE UPDATE ON public.cierres_periodo
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS cierres_periodo_audit_log_trg ON public.cierres_periodo;
CREATE TRIGGER cierres_periodo_audit_log_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.cierres_periodo
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit_log();

-- RLS
ALTER TABLE public.cierres_periodo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cierres_periodo_select_owner_admin ON public.cierres_periodo;
CREATE POLICY cierres_periodo_select_owner_admin
  ON public.cierres_periodo FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND active = true AND role IN ('owner','admin')));

DROP POLICY IF EXISTS cierres_periodo_insert_owner_admin ON public.cierres_periodo;
CREATE POLICY cierres_periodo_insert_owner_admin
  ON public.cierres_periodo FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND active = true AND role IN ('owner','admin')));

/* UPDATE: SOLO owner (reapertura). Admin no puede reabrir. */
DROP POLICY IF EXISTS cierres_periodo_update_owner_only ON public.cierres_periodo;
CREATE POLICY cierres_periodo_update_owner_only
  ON public.cierres_periodo FOR UPDATE
  USING      (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND active = true AND role = 'owner'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND active = true AND role = 'owner'));

/* DELETE: nadie. Cierres no se borran. */

COMMENT ON TABLE public.cierres_periodo IS
  'Fase 8 — Cierres contables mensuales/anuales. Bloqueo via _admin_check_periodo_cerrado() en RPCs.';

-- ════════════════════════════════════════════════════════════════════
-- (2) HELPER _admin_check_periodo_cerrado(date)
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._admin_check_periodo_cerrado(p_fecha date)
RETURNS boolean
LANGUAGE plpgsql
STABLE                        -- cacheable dentro de un statement
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_fecha IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.cierres_periodo
     WHERE estado = 'cerrado'
       AND p_fecha BETWEEN periodo_desde AND periodo_hasta
    LIMIT 1
  );
END;
$$;

COMMENT ON FUNCTION public._admin_check_periodo_cerrado(date) IS
  'Fase 8 — Devuelve true si p_fecha cae en algun cierre activo. Usado desde RPCs (patch en migration 0064).';

-- ════════════════════════════════════════════════════════════════════
-- (3) RPC rpc_admin_get_cierres(year, tipo)
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rpc_admin_get_cierres(
  p_year int DEFAULT NULL,
  p_tipo text DEFAULT NULL
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

  IF p_tipo IS NOT NULL AND p_tipo NOT IN ('mensual','anual') THEN
    RAISE EXCEPTION 'Tipo invalido' USING ERRCODE='22023', HINT='invalid_tipo'; END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.periodo_hasta DESC, c.cerrado_at DESC), '[]'::jsonb)
    INTO v_result
    FROM public.cierres_periodo c
   WHERE (p_year IS NULL OR EXTRACT(YEAR FROM c.periodo_desde)::int = p_year
                          OR EXTRACT(YEAR FROM c.periodo_hasta)::int = p_year)
     AND (p_tipo IS NULL OR c.tipo = p_tipo);

  RETURN v_result;
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- (4) RPC rpc_admin_preview_cierre(tipo, desde, hasta)
-- ════════════════════════════════════════════════════════════════════
-- Calcula totales sin crear el cierre. Util para mostrar al usuario
-- antes de confirmar.
CREATE OR REPLACE FUNCTION public.rpc_admin_preview_cierre(
  p_tipo  text,
  p_desde date,
  p_hasta date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_apertura numeric(14,2);
  v_ingresos numeric(14,2);
  v_egresos  numeric(14,2);
  v_count    int;
  v_overlap_count int;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  IF p_tipo NOT IN ('mensual','anual') THEN
    RAISE EXCEPTION 'Tipo invalido' USING ERRCODE='22023', HINT='invalid_tipo'; END IF;
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde THEN
    RAISE EXCEPTION 'Periodo invalido' USING ERRCODE='22023', HINT='invalid_periodo'; END IF;

  -- Saldo apertura: ultimo cierre cerrado anterior (cualquier tipo)
  SELECT COALESCE(saldo_cierre, 0) INTO v_apertura
    FROM public.cierres_periodo
   WHERE estado = 'cerrado' AND periodo_hasta < p_desde
   ORDER BY periodo_hasta DESC LIMIT 1;
  v_apertura := COALESCE(v_apertura, 0);

  -- Totales del periodo (UNION ALL 5 fuentes, mismo patron que S2.16)
  WITH mov AS (
    SELECT -monto_total AS m FROM public.expenses
     WHERE activo = true AND fecha BETWEEN p_desde AND p_hasta
    UNION ALL
    SELECT -total FROM public.recibos
     WHERE estado='emitido' AND total > 0 AND fecha_pago BETWEEN p_desde AND p_hasta
    UNION ALL
    SELECT monto FROM public.checks_received
     WHERE estado='cobrado' AND fecha_cobro IS NOT NULL
       AND fecha_cobro BETWEEN p_desde AND p_hasta
    UNION ALL
    SELECT -monto FROM public.checks_issued
     WHERE estado='cobrado' AND fecha_cobro IS NOT NULL
       AND fecha_cobro BETWEEN p_desde AND p_hasta
    UNION ALL
    SELECT (CASE WHEN tipo='ingreso' THEN monto ELSE -monto END)
      FROM public.cash_flow_manual
     WHERE activo = true AND fecha BETWEEN p_desde AND p_hasta
  )
  SELECT COALESCE(SUM(m) FILTER (WHERE m > 0), 0),
         COALESCE(SUM(m) FILTER (WHERE m < 0), 0),
         count(*)
    INTO v_ingresos, v_egresos, v_count
    FROM mov;

  -- Detectar overlap con cierre del MISMO tipo (informativo)
  SELECT count(*) INTO v_overlap_count
    FROM public.cierres_periodo
   WHERE estado = 'cerrado' AND tipo = p_tipo
     AND (periodo_desde, periodo_hasta + 1) OVERLAPS (p_desde, p_hasta + 1);

  RETURN jsonb_build_object(
    'tipo',           p_tipo,
    'periodo_desde',  p_desde,
    'periodo_hasta',  p_hasta,
    'saldo_apertura', v_apertura,
    'total_ingresos', v_ingresos,
    'total_egresos',  v_egresos,
    'saldo_cierre',   v_apertura + v_ingresos + v_egresos,
    'count_movimientos', v_count,
    'overlap_existente', v_overlap_count > 0
  );
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- (5) RPC rpc_admin_crear_cierre(payload)
-- ════════════════════════════════════════════════════════════════════
-- Crea el cierre con snapshot del periodo. Valida:
--   - Tipo valido, periodo valido.
--   - Sin solapamiento con cierre activo del mismo tipo (OVERLAPS).
-- Calcula saldo_acumulado_historico = acum anterior + variacion actual.
CREATE OR REPLACE FUNCTION public.rpc_admin_crear_cierre(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_tipo  text := NULLIF(trim(p_payload->>'tipo'),'');
  v_desde date := NULLIF(p_payload->>'periodo_desde','')::date;
  v_hasta date := NULLIF(p_payload->>'periodo_hasta','')::date;
  v_notas text := NULLIF(trim(p_payload->>'notas'),'');
  v_apertura numeric(14,2);
  v_ingresos numeric(14,2);
  v_egresos  numeric(14,2);
  v_cierre   numeric(14,2);
  v_count    int;
  v_acum_anterior numeric(14,2);
  v_acum     numeric(14,2);
  v_snapshot jsonb;
  v_breakdown jsonb;
  v_top_prov  jsonb;
  v_top_empl  jsonb;
  v_id uuid;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  IF v_tipo NOT IN ('mensual','anual') THEN
    RAISE EXCEPTION 'Tipo invalido (mensual/anual)' USING ERRCODE='22023', HINT='invalid_tipo'; END IF;
  IF v_desde IS NULL OR v_hasta IS NULL OR v_hasta < v_desde THEN
    RAISE EXCEPTION 'Periodo invalido' USING ERRCODE='22023', HINT='invalid_periodo'; END IF;

  /* Solapamiento con cierre activo del MISMO tipo */
  IF EXISTS (
    SELECT 1 FROM public.cierres_periodo
     WHERE estado = 'cerrado' AND tipo = v_tipo
       AND (periodo_desde, periodo_hasta + 1) OVERLAPS (v_desde, v_hasta + 1)
  ) THEN
    RAISE EXCEPTION 'Ya existe un cierre activo del mismo tipo que se solapa con este periodo.'
      USING ERRCODE='23505', HINT='cierre_overlap'; END IF;

  /* Saldo apertura = saldo_cierre del ultimo cierre cerrado anterior */
  SELECT COALESCE(saldo_cierre, 0) INTO v_apertura
    FROM public.cierres_periodo
   WHERE estado = 'cerrado' AND periodo_hasta < v_desde
   ORDER BY periodo_hasta DESC LIMIT 1;
  v_apertura := COALESCE(v_apertura, 0);

  /* Totales reales del periodo (UNION ALL 5 fuentes) */
  WITH mov AS (
    SELECT -monto_total AS m FROM public.expenses
     WHERE activo = true AND fecha BETWEEN v_desde AND v_hasta
    UNION ALL
    SELECT -total FROM public.recibos
     WHERE estado='emitido' AND total > 0 AND fecha_pago BETWEEN v_desde AND v_hasta
    UNION ALL
    SELECT monto FROM public.checks_received
     WHERE estado='cobrado' AND fecha_cobro IS NOT NULL
       AND fecha_cobro BETWEEN v_desde AND v_hasta
    UNION ALL
    SELECT -monto FROM public.checks_issued
     WHERE estado='cobrado' AND fecha_cobro IS NOT NULL
       AND fecha_cobro BETWEEN v_desde AND v_hasta
    UNION ALL
    SELECT (CASE WHEN tipo='ingreso' THEN monto ELSE -monto END)
      FROM public.cash_flow_manual
     WHERE activo = true AND fecha BETWEEN v_desde AND v_hasta
  )
  SELECT COALESCE(SUM(m) FILTER (WHERE m > 0), 0),
         COALESCE(SUM(m) FILTER (WHERE m < 0), 0),
         count(*)
    INTO v_ingresos, v_egresos, v_count
    FROM mov;

  v_cierre := v_apertura + v_ingresos + v_egresos;

  /* Acumulado historico = ultimo acum anterior + variacion del periodo
     (donde variacion = saldo_cierre - saldo_apertura = ingresos+egresos). */
  SELECT COALESCE(saldo_acumulado_historico, 0) INTO v_acum_anterior
    FROM public.cierres_periodo
   WHERE estado = 'cerrado' AND periodo_hasta < v_desde
   ORDER BY periodo_hasta DESC LIMIT 1;
  v_acum_anterior := COALESCE(v_acum_anterior, 0);
  v_acum := v_acum_anterior + v_ingresos + v_egresos;

  /* Snapshot: breakdown por categoria, top 5 proveedores, top 5 empleados */
  v_breakdown := jsonb_build_object(
    'compras', (SELECT COALESCE(SUM(monto_total), 0)
                  FROM public.expenses
                 WHERE activo = true AND fecha BETWEEN v_desde AND v_hasta),
    'sueldos', (SELECT COALESCE(SUM(total), 0)
                  FROM public.recibos
                 WHERE estado='emitido' AND total > 0 AND fecha_pago BETWEEN v_desde AND v_hasta),
    'cheques_cobrados_in', (SELECT COALESCE(SUM(monto), 0)
                              FROM public.checks_received
                             WHERE estado='cobrado' AND fecha_cobro IS NOT NULL
                               AND fecha_cobro BETWEEN v_desde AND v_hasta),
    'cheques_cobrados_out', (SELECT COALESCE(SUM(monto), 0)
                              FROM public.checks_issued
                             WHERE estado='cobrado' AND fecha_cobro IS NOT NULL
                               AND fecha_cobro BETWEEN v_desde AND v_hasta),
    'otros_ingreso', (SELECT COALESCE(SUM(monto), 0)
                        FROM public.cash_flow_manual
                       WHERE activo = true AND tipo='ingreso'
                         AND fecha BETWEEN v_desde AND v_hasta),
    'otros_egreso',  (SELECT COALESCE(SUM(monto), 0)
                        FROM public.cash_flow_manual
                       WHERE activo = true AND tipo='egreso'
                         AND fecha BETWEEN v_desde AND v_hasta)
  );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'supplier_id', t.supplier_id,
           'nombre',      t.nombre,
           'total',       t.total
         ) ORDER BY t.total DESC), '[]'::jsonb)
    INTO v_top_prov
    FROM (
      SELECT e.supplier_id, COALESCE(s.nombre, 'Sin proveedor') AS nombre, SUM(e.monto_total) AS total
        FROM public.expenses e
        LEFT JOIN public.suppliers s ON s.id = e.supplier_id
       WHERE e.activo = true AND e.fecha BETWEEN v_desde AND v_hasta
       GROUP BY e.supplier_id, s.nombre
       ORDER BY total DESC LIMIT 5
    ) t;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'employee_id', t.employee_id,
           'nombre',      t.empleado_nombre,
           'total',       t.total
         ) ORDER BY t.total DESC), '[]'::jsonb)
    INTO v_top_empl
    FROM (
      SELECT r.employee_id, r.empleado_nombre, SUM(r.total) AS total
        FROM public.recibos r
       WHERE r.estado='emitido' AND r.total > 0
         AND r.fecha_pago BETWEEN v_desde AND v_hasta
       GROUP BY r.employee_id, r.empleado_nombre
       ORDER BY total DESC LIMIT 5
    ) t;

  v_snapshot := jsonb_build_object(
    'breakdown_categorias', v_breakdown,
    'top_proveedores',      v_top_prov,
    'top_empleados',        v_top_empl
  );

  INSERT INTO public.cierres_periodo (
    tipo, periodo_desde, periodo_hasta,
    saldo_apertura, saldo_cierre, saldo_acumulado_historico,
    total_ingresos, total_egresos, count_movimientos,
    cerrado_por, notas, snapshot_jsonb
  ) VALUES (
    v_tipo, v_desde, v_hasta,
    v_apertura, v_cierre, v_acum,
    v_ingresos, v_egresos, v_count,
    auth.uid(), v_notas, v_snapshot
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'cierre_id',                 v_id,
    'saldo_apertura',            v_apertura,
    'saldo_cierre',              v_cierre,
    'saldo_acumulado_historico', v_acum,
    'total_ingresos',            v_ingresos,
    'total_egresos',             v_egresos,
    'count_movimientos',         v_count
  );
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- (6) RPC rpc_admin_reabrir_cierre(payload)
-- ════════════════════════════════════════════════════════════════════
-- SOLO owner. Bloquea si hay cierres posteriores cerrados (decision #2).
CREATE OR REPLACE FUNCTION public.rpc_admin_reabrir_cierre(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_id uuid := NULLIF(p_payload->>'cierre_id','')::uuid;
  v_motivo text := NULLIF(trim(p_payload->>'motivo'),'');
  v_target_hasta date;
  v_posterior_nombre text;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;

  /* SOLO owner */
  IF v_role <> 'owner' THEN
    RAISE EXCEPTION 'Solo owner puede reabrir cierres.'
      USING ERRCODE='42501', HINT='not_owner'; END IF;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'cierre_id requerido' USING ERRCODE='22023', HINT='id_required'; END IF;
  IF v_motivo IS NULL OR length(v_motivo) < 1 THEN
    RAISE EXCEPTION 'Motivo de reapertura requerido (1-500 caracteres)'
      USING ERRCODE='22023', HINT='motivo_required'; END IF;
  IF length(v_motivo) > 500 THEN
    RAISE EXCEPTION 'Motivo demasiado largo (max 500 caracteres)'
      USING ERRCODE='22023', HINT='motivo_too_long'; END IF;

  /* Validar que el cierre existe y esta cerrado */
  SELECT periodo_hasta INTO v_target_hasta
    FROM public.cierres_periodo WHERE id = v_id AND estado = 'cerrado';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cierre no existe o ya esta reabierto'
      USING ERRCODE='22023', HINT='not_found_or_reabierto'; END IF;

  /* Bloqueo: cierres posteriores cerrados (decision #2) */
  SELECT (tipo || ' ' || periodo_desde::text || ' al ' || periodo_hasta::text)
    INTO v_posterior_nombre
    FROM public.cierres_periodo
   WHERE estado = 'cerrado' AND periodo_desde > v_target_hasta
   ORDER BY periodo_desde ASC LIMIT 1;
  IF v_posterior_nombre IS NOT NULL THEN
    RAISE EXCEPTION 'Existen cierres posteriores. Reabri el mas reciente primero: %', v_posterior_nombre
      USING ERRCODE='42501', HINT='cierre_posterior_existe'; END IF;

  UPDATE public.cierres_periodo SET
    estado            = 'reabierto',
    motivo_reapertura = v_motivo,
    reabierto_at      = now(),
    reabierto_por     = auth.uid()
  WHERE id = v_id;

  RETURN jsonb_build_object('cierre_id', v_id, 'reabierto', true);
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- (7) RPC rpc_admin_get_reporte_cierre(cierre_id)
-- ════════════════════════════════════════════════════════════════════
-- Devuelve payload del reporte usando snapshot_jsonb guardado + agrega
-- comparativa con periodo anterior.
CREATE OR REPLACE FUNCTION public.rpc_admin_get_reporte_cierre(p_cierre_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_cierre jsonb;
  v_anterior jsonb;
  v_target_desde date;
  v_target_tipo  text;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  IF p_cierre_id IS NULL THEN
    RAISE EXCEPTION 'cierre_id requerido' USING ERRCODE='22023', HINT='id_required'; END IF;

  SELECT to_jsonb(c), c.periodo_desde, c.tipo
    INTO v_cierre, v_target_desde, v_target_tipo
    FROM public.cierres_periodo c
   WHERE c.id = p_cierre_id;
  IF v_cierre IS NULL THEN
    RAISE EXCEPTION 'Cierre no existe' USING ERRCODE='22023', HINT='not_found'; END IF;

  /* Periodo anterior (mismo tipo, periodo_hasta < target_desde) */
  SELECT to_jsonb(c) INTO v_anterior
    FROM public.cierres_periodo c
   WHERE c.tipo = v_target_tipo
     AND c.estado = 'cerrado'
     AND c.periodo_hasta < v_target_desde
   ORDER BY c.periodo_hasta DESC LIMIT 1;

  RETURN jsonb_build_object(
    'cierre',           v_cierre,
    'periodo_anterior', v_anterior
  );
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- (8) RPC rpc_admin_get_saldo_historico()
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rpc_admin_get_saldo_historico()
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

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'cierre_id',                 c.id,
           'tipo',                      c.tipo,
           'periodo_desde',             c.periodo_desde,
           'periodo_hasta',             c.periodo_hasta,
           'saldo_cierre',              c.saldo_cierre,
           'saldo_acumulado_historico', c.saldo_acumulado_historico,
           'estado',                    c.estado
         ) ORDER BY c.periodo_hasta ASC), '[]'::jsonb)
    INTO v_result
    FROM public.cierres_periodo c
   WHERE c.estado = 'cerrado';

  RETURN v_result;
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- (9) RPC rpc_admin_validar_periodo_apertura(fecha)
-- ════════════════════════════════════════════════════════════════════
-- Wrapper publico del helper privado. Devuelve { cerrado: bool,
-- cierre_id?, periodo_desde?, periodo_hasta? } para que el frontend
-- pueda dar feedback inmediato sin esperar al error del RPC.
CREATE OR REPLACE FUNCTION public.rpc_admin_validar_periodo_apertura(p_fecha date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_row jsonb;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  IF p_fecha IS NULL THEN
    RAISE EXCEPTION 'fecha requerida' USING ERRCODE='22023', HINT='fecha_required'; END IF;

  SELECT to_jsonb(c) INTO v_row
    FROM (
      SELECT id AS cierre_id, tipo, periodo_desde, periodo_hasta
        FROM public.cierres_periodo
       WHERE estado='cerrado' AND p_fecha BETWEEN periodo_desde AND periodo_hasta
       LIMIT 1
    ) c;

  IF v_row IS NULL THEN
    RETURN jsonb_build_object('cerrado', false);
  ELSE
    RETURN jsonb_build_object('cerrado', true) || v_row;
  END IF;
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- (10) REVOKE EXECUTE FROM anon, public + GRANT a authenticated
-- ════════════════════════════════════════════════════════════════════
REVOKE EXECUTE ON FUNCTION public._admin_check_periodo_cerrado(date)            FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_get_cierres(int, text)              FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_preview_cierre(text, date, date)    FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_crear_cierre(jsonb)                 FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_reabrir_cierre(jsonb)               FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_get_reporte_cierre(uuid)            FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_get_saldo_historico()               FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_validar_periodo_apertura(date)      FROM anon, public;

GRANT EXECUTE ON FUNCTION public._admin_check_periodo_cerrado(date)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_get_cierres(int, text)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_preview_cierre(text, date, date)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_crear_cierre(jsonb)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_reabrir_cierre(jsonb)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_get_reporte_cierre(uuid)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_get_saldo_historico()                TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_validar_periodo_apertura(date)       TO authenticated;
