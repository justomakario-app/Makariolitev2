-- ════════════════════════════════════════════════════════════════════
-- ADMIN MODULE — Historial salarial + Reportes (S2.15)
-- ════════════════════════════════════════════════════════════════════
-- Sprint 10/22. Cierra Fase 6 (Sueldos): S2.11 + S2.12 + S2.15 ✅.
--
-- No hay DDL de tablas. Solo RPCs sobre recibos/employees (S2.12).
--
-- 1) rpc_admin_get_employee_historial(uuid) — UPDATE.
--    Reemplaza el placeholder S2.11 con datos reales:
--    total_recibos, ultimo_recibo, suma_anio, anio.
--    Sigue alimentando las stat cards del bloque Historial del
--    modal Empleado.
--
-- 2) rpc_admin_historial_empleado(uuid, int) — NUEVO.
--    Modal grande individual: empleado snapshot + totales
--    (year/month/avg/count) + por_mes (12 entradas con
--    generate_series + breakdown por tipo) + lista recibos.
--
-- 3) rpc_admin_reportes_global(int, int DEFAULT NULL) — NUEVO.
--    Tab Reportes: KPIs (total_year/month/avg/top/low) + tabla
--    por empleado activo.
--
-- 4) rpc_admin_recibos_detalle_empleado(uuid, int, int DEFAULT NULL,
--    text DEFAULT NULL) — NUEVO.
--    Lista filtrable de recibos del empleado (year/mes/tipo opc.)
--    para tabla del modal y exportación Excel.
--
-- Cero modificacion a tablas. Aprovecha indexes existentes:
--   recibos_employee_id_idx, recibos_periodo_desde_idx (S2.12).
--
-- Auth gate: patron S2.11/S2.12 (role_enum + active + mensajes
-- castellano + ERRCODE/HINT).
-- ════════════════════════════════════════════════════════════════════

SET search_path = public;

-- ════════════════════════════════════════════════════════════════════
-- (1) UPDATE rpc_admin_get_employee_historial — datos reales
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rpc_admin_get_employee_historial(p_employee_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_total_recibos int;
  v_ultimo jsonb;
  v_suma_anio numeric;
  v_year int := EXTRACT(YEAR FROM CURRENT_DATE)::int;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  IF p_employee_id IS NULL THEN
    RAISE EXCEPTION 'employee_id requerido' USING ERRCODE='22023', HINT='employee_required'; END IF;

  SELECT count(*) INTO v_total_recibos
    FROM public.recibos
   WHERE employee_id = p_employee_id AND estado='emitido';

  SELECT to_jsonb(r) INTO v_ultimo
    FROM (
      SELECT id, tipo, fecha_pago, total
        FROM public.recibos
       WHERE employee_id = p_employee_id AND estado='emitido'
       ORDER BY fecha_pago DESC LIMIT 1
    ) r;

  SELECT COALESCE(SUM(total), 0) INTO v_suma_anio
    FROM public.recibos
   WHERE employee_id = p_employee_id
     AND estado='emitido'
     AND EXTRACT(YEAR FROM fecha_pago)::int = v_year;

  RETURN jsonb_build_object(
    'employee_id',   p_employee_id,
    'total_recibos', v_total_recibos,
    'ultimo_recibo', v_ultimo,
    'suma_anio',     v_suma_anio,
    'anio',          v_year
  );
END;
$$;

COMMENT ON FUNCTION public.rpc_admin_get_employee_historial(uuid) IS
  'S2.11 + S2.15 — Stat cards del bloque Historial del modal Empleado. Datos reales.';

-- ════════════════════════════════════════════════════════════════════
-- (2) NUEVO rpc_admin_historial_empleado(uuid, int)
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rpc_admin_historial_empleado(
  p_employee_id uuid,
  p_year int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_empleado jsonb;
  v_totales jsonb;
  v_por_mes jsonb;
  v_recibos jsonb;
  v_count int;
  v_total_year numeric;
  v_total_mes_actual numeric;
  v_mes_actual int := EXTRACT(MONTH FROM CURRENT_DATE)::int;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  IF p_employee_id IS NULL OR p_year IS NULL THEN
    RAISE EXCEPTION 'employee_id y year requeridos'
      USING ERRCODE='22023', HINT='params_required'; END IF;

  SELECT to_jsonb(e) INTO v_empleado
    FROM (
      SELECT id, nombre, cuil, categoria, fecha_ingreso,
             sueldo_bruto_base, modalidad, lugar_trabajo, activo
        FROM public.employees WHERE id = p_employee_id
    ) e;
  IF v_empleado IS NULL THEN
    RAISE EXCEPTION 'Empleado no existe' USING ERRCODE='22023', HINT='employee_not_found'; END IF;

  SELECT count(*), COALESCE(SUM(total), 0)
    INTO v_count, v_total_year
    FROM public.recibos
   WHERE employee_id = p_employee_id
     AND estado='emitido'
     AND EXTRACT(YEAR FROM fecha_pago)::int = p_year;

  SELECT COALESCE(SUM(total), 0) INTO v_total_mes_actual
    FROM public.recibos
   WHERE employee_id = p_employee_id
     AND estado='emitido'
     AND EXTRACT(YEAR  FROM fecha_pago)::int = p_year
     AND EXTRACT(MONTH FROM fecha_pago)::int = v_mes_actual;

  v_totales := jsonb_build_object(
    'year_total',    v_total_year,
    'month_total',   v_total_mes_actual,
    'avg_monthly',   CASE WHEN v_count > 0 THEN v_total_year / 12.0 ELSE 0 END,
    'count_recibos', v_count
  );

  /* generate_series garantiza siempre 12 entradas (incluso meses sin
     recibos quedan con totales=0 y count=0). Breakdown por tipo via
     FILTER (WHERE ...) en el mismo agregado. Construimos el jsonb por
     fila con jsonb_build_object (evita row_to_jsonb(record) que no
     soporta records anonimos sin tipo registrado). */
  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY (m->>'mes')::int), '[]'::jsonb)
    INTO v_por_mes
    FROM (
      SELECT jsonb_build_object(
               'mes',            m.mes::int,
               'total',          COALESCE(SUM(r.total), 0),
               'count',          COUNT(r.id),
               'total_adelanto', COALESCE(SUM(r.total) FILTER (WHERE r.tipo = 'adelanto'), 0),
               'total_quincena', COALESCE(SUM(r.total) FILTER (WHERE r.tipo = 'quincena'), 0),
               'total_sueldo',   COALESCE(SUM(r.total) FILTER (WHERE r.tipo = 'sueldo'),   0)
             ) AS m
        FROM generate_series(1, 12) AS m(mes)
        LEFT JOIN public.recibos r
               ON r.employee_id = p_employee_id
              AND r.estado = 'emitido'
              AND EXTRACT(YEAR  FROM r.fecha_pago)::int = p_year
              AND EXTRACT(MONTH FROM r.fecha_pago)::int = m.mes
       GROUP BY m.mes
    ) sub;

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.fecha_pago DESC, r.created_at DESC), '[]'::jsonb)
    INTO v_recibos
    FROM public.recibos r
   WHERE r.employee_id = p_employee_id
     AND r.estado='emitido'
     AND EXTRACT(YEAR FROM r.fecha_pago)::int = p_year;

  RETURN jsonb_build_object(
    'empleado', v_empleado,
    'year',     p_year,
    'totales',  v_totales,
    'por_mes',  v_por_mes,
    'recibos',  v_recibos
  );
END;
$$;

COMMENT ON FUNCTION public.rpc_admin_historial_empleado(uuid, int) IS
  'S2.15 — Modal grande individual: empleado + KPIs + por_mes (12 entradas) + recibos del año.';

-- ════════════════════════════════════════════════════════════════════
-- (3) NUEVO rpc_admin_reportes_global(int, int DEFAULT NULL)
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rpc_admin_reportes_global(
  p_year int,
  p_mes  int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_tabla jsonb;
  v_kpis jsonb;
  v_total_year numeric;
  v_total_mes numeric;
  v_empleados_count int;
  v_top jsonb;
  v_low jsonb;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  IF p_year IS NULL THEN
    RAISE EXCEPTION 'year requerido' USING ERRCODE='22023', HINT='year_required'; END IF;

  /* Tabla por empleado activo: LEFT JOIN garantiza que aparezcan
     empleados sin recibos. total_month respeta filtro opcional. */
  WITH ag AS (
    SELECT
      e.id                                                                                                                                                                 AS employee_id,
      e.nombre,
      e.cuil,
      e.categoria,
      e.activo,
      COALESCE(SUM(r.total) FILTER (WHERE EXTRACT(YEAR  FROM r.fecha_pago)::int = p_year), 0)                                                                                AS total_year,
      COALESCE(SUM(r.total) FILTER (WHERE EXTRACT(YEAR  FROM r.fecha_pago)::int = p_year
                                      AND (p_mes IS NULL OR EXTRACT(MONTH FROM r.fecha_pago)::int = p_mes)), 0)                                                              AS total_month,
      COUNT(r.id)            FILTER (WHERE EXTRACT(YEAR FROM r.fecha_pago)::int = p_year)                                                                                    AS count_recibos_year,
      COALESCE(SUM(r.total) FILTER (WHERE EXTRACT(YEAR FROM r.fecha_pago)::int = p_year AND r.tipo='adelanto'), 0)                                                          AS total_adelanto,
      COALESCE(SUM(r.total) FILTER (WHERE EXTRACT(YEAR FROM r.fecha_pago)::int = p_year AND r.tipo='quincena'), 0)                                                          AS total_quincena,
      COALESCE(SUM(r.total) FILTER (WHERE EXTRACT(YEAR FROM r.fecha_pago)::int = p_year AND r.tipo='sueldo'),   0)                                                          AS total_sueldo
      FROM public.employees e
      LEFT JOIN public.recibos r
             ON r.employee_id = e.id AND r.estado='emitido'
     WHERE e.activo = true
     GROUP BY e.id, e.nombre, e.cuil, e.categoria, e.activo
  ),
  ag_with_ultimo AS (
    SELECT a.*,
           (SELECT to_jsonb(u) FROM (
              SELECT r.id, r.tipo, r.fecha_pago, r.total
                FROM public.recibos r
               WHERE r.employee_id = a.employee_id
                 AND r.estado='emitido'
               ORDER BY r.fecha_pago DESC LIMIT 1
            ) u) AS ultimo_recibo
      FROM ag a
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.total_year DESC), '[]'::jsonb)
    INTO v_tabla
    FROM ag_with_ultimo t;

  SELECT COALESCE(SUM(total), 0) INTO v_total_year
    FROM public.recibos
   WHERE estado='emitido' AND EXTRACT(YEAR FROM fecha_pago)::int = p_year;

  SELECT COALESCE(SUM(total), 0) INTO v_total_mes
    FROM public.recibos
   WHERE estado='emitido'
     AND EXTRACT(YEAR FROM fecha_pago)::int = p_year
     AND (p_mes IS NULL OR EXTRACT(MONTH FROM fecha_pago)::int = p_mes);

  SELECT count(*) INTO v_empleados_count
    FROM public.employees WHERE activo = true;

  /* Top/Low entre empleados con total_year > 0. Si solo hay 1, top===low. */
  WITH ranked AS (
    SELECT employee_id, nombre, total_year
      FROM jsonb_to_recordset(v_tabla) AS t(employee_id uuid, nombre text, total_year numeric)
     WHERE total_year > 0
  )
  SELECT
    (SELECT to_jsonb(r) FROM (SELECT * FROM ranked ORDER BY total_year DESC LIMIT 1) r),
    (SELECT to_jsonb(r) FROM (SELECT * FROM ranked ORDER BY total_year ASC  LIMIT 1) r)
    INTO v_top, v_low;

  v_kpis := jsonb_build_object(
    'total_year',       v_total_year,
    'total_month',      CASE WHEN p_mes IS NULL THEN NULL ELSE v_total_mes END,
    'avg_per_employee', CASE WHEN v_empleados_count > 0 THEN v_total_year / v_empleados_count ELSE 0 END,
    'top_employee',     v_top,
    'low_employee',     v_low,
    'empleados_count',  v_empleados_count
  );

  RETURN jsonb_build_object(
    'year',  p_year,
    'mes',   p_mes,
    'kpis',  v_kpis,
    'tabla', v_tabla
  );
END;
$$;

COMMENT ON FUNCTION public.rpc_admin_reportes_global(int, int) IS
  'S2.15 — Tab Reportes: KPIs comparativos + tabla por empleado activo con totales año/mes.';

-- ════════════════════════════════════════════════════════════════════
-- (4) NUEVO rpc_admin_recibos_detalle_empleado(uuid, int, int, text)
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rpc_admin_recibos_detalle_empleado(
  p_employee_id uuid,
  p_year int,
  p_mes  int  DEFAULT NULL,
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

  IF p_employee_id IS NULL OR p_year IS NULL THEN
    RAISE EXCEPTION 'employee_id y year requeridos'
      USING ERRCODE='22023', HINT='params_required'; END IF;

  IF p_tipo IS NOT NULL AND p_tipo NOT IN ('adelanto','quincena','sueldo') THEN
    RAISE EXCEPTION 'Tipo invalido (adelanto/quincena/sueldo)'
      USING ERRCODE='22023', HINT='invalid_tipo'; END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.fecha_pago DESC, r.created_at DESC), '[]'::jsonb)
    INTO v_result
    FROM public.recibos r
   WHERE r.employee_id = p_employee_id
     AND r.estado = 'emitido'
     AND EXTRACT(YEAR FROM r.fecha_pago)::int = p_year
     AND (p_mes  IS NULL OR EXTRACT(MONTH FROM r.fecha_pago)::int = p_mes)
     AND (p_tipo IS NULL OR r.tipo = p_tipo);

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.rpc_admin_recibos_detalle_empleado(uuid, int, int, text) IS
  'S2.15 — Lista filtrable de recibos por empleado/año/mes/tipo (modal individual + Excel).';

-- ════════════════════════════════════════════════════════════════════
-- (5) REVOKE EXECUTE FROM anon, public + GRANT a authenticated
-- ════════════════════════════════════════════════════════════════════
REVOKE EXECUTE ON FUNCTION public.rpc_admin_get_employee_historial(uuid)                                  FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_historial_empleado(uuid, int)                                 FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_reportes_global(int, int)                                     FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_recibos_detalle_empleado(uuid, int, int, text)                FROM anon, public;

GRANT EXECUTE ON FUNCTION public.rpc_admin_get_employee_historial(uuid)                                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_historial_empleado(uuid, int)                                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_reportes_global(int, int)                                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_recibos_detalle_empleado(uuid, int, int, text)                 TO authenticated;
