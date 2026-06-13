-- ════════════════════════════════════════════════════════════════════
-- RRHH — Empleados: CUIL → DNI (pedido de Seba)
-- ════════════════════════════════════════════════════════════════════
-- Renombra employees.cuil → dni y todo lo que lo referencia: constraints,
-- índice único, snapshot recibos.empleado_cuil → empleado_dni, y las 8 RPCs.
-- Formato DNI con puntos (12.345.678). El CUIL existente se convierte a DNI
-- (los 8 dígitos del medio). Inmutabilidad post-alta se conserva (ahora DNI).
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Columna employees.cuil → dni ─────────────────────────────────
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_cuil_check;
DROP INDEX IF EXISTS public.employees_cuil_unique_idx;
ALTER TABLE public.employees RENAME COLUMN cuil TO dni;

-- Migrar dato existente: CUIL (XX-DDDDDDDD-V) → DNI con puntos.
UPDATE public.employees e SET dni = x.fmt
FROM (
  SELECT id,
         CASE WHEN length(n) = 8 THEN substr(n,1,2)||'.'||substr(n,3,3)||'.'||substr(n,6,3)
              WHEN length(n) = 7 THEN substr(n,1,1)||'.'||substr(n,2,3)||'.'||substr(n,5,3)
              ELSE n END AS fmt
  FROM (
    SELECT id, (substring(dni from 4 for 8))::bigint::text AS n
    FROM public.employees
    WHERE dni ~ '^\d{2}-\d{8}-\d$'
  ) s
) x
WHERE e.id = x.id;

-- Nuevo CHECK (DNI con puntos, 7-8 dígitos) + índice único.
ALTER TABLE public.employees ADD CONSTRAINT employees_dni_check
  CHECK (dni IS NULL OR dni ~ '^\d{1,2}\.\d{3}\.\d{3}$');
CREATE UNIQUE INDEX IF NOT EXISTS employees_dni_unique_idx
  ON public.employees (dni) WHERE dni IS NOT NULL;

-- ── 2. Snapshot de recibos: empleado_cuil → empleado_dni ────────────
ALTER TABLE public.recibos RENAME COLUMN empleado_cuil TO empleado_dni;

-- ── 3. RPCs ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_create_employee(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_role role_enum; v_active boolean; v_employee_id uuid;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  BEGIN
    INSERT INTO public.employees (
      nombre, dni, fecha_nacimiento, email, telefono,
      direccion, ciudad, provincia, codigo_postal,
      fecha_ingreso, categoria, modalidad, tipo_contratacion,
      lugar_trabajo, convenio,
      sueldo_bruto_base, dias_vacaciones_anuales,
      banco, cbu, alias_cbu, forma_cobro,
      notas, valor_hora_extra, created_by
    ) VALUES (
      NULLIF(trim(p_payload->>'nombre'), ''),
      NULLIF(trim(p_payload->>'dni'), ''),
      NULLIF(p_payload->>'fecha_nacimiento', '')::date,
      NULLIF(trim(p_payload->>'email'), ''),
      NULLIF(trim(p_payload->>'telefono'), ''),
      NULLIF(trim(p_payload->>'direccion'), ''),
      NULLIF(trim(p_payload->>'ciudad'), ''),
      NULLIF(trim(p_payload->>'provincia'), ''),
      NULLIF(trim(p_payload->>'codigo_postal'), ''),
      NULLIF(p_payload->>'fecha_ingreso', '')::date,
      NULLIF(trim(p_payload->>'categoria'), ''),
      NULLIF(trim(p_payload->>'modalidad'), ''),
      NULLIF(trim(p_payload->>'tipo_contratacion'), ''),
      NULLIF(trim(p_payload->>'lugar_trabajo'), ''),
      NULLIF(trim(p_payload->>'convenio'), ''),
      NULLIF(p_payload->>'sueldo_bruto_base', '')::numeric,
      NULLIF(p_payload->>'dias_vacaciones_anuales', '')::int,
      NULLIF(trim(p_payload->>'banco'), ''),
      NULLIF(trim(p_payload->>'cbu'), ''),
      NULLIF(trim(p_payload->>'alias_cbu'), ''),
      NULLIF(trim(p_payload->>'forma_cobro'), ''),
      NULLIF(trim(p_payload->>'notas'), ''),
      COALESCE(NULLIF(p_payload->>'valor_hora_extra','')::numeric, 0),
      auth.uid()
    ) RETURNING id INTO v_employee_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Ya existe otro empleado con ese DNI' USING ERRCODE='23505', HINT='duplicate_dni';
  END;

  RETURN jsonb_build_object('employee_id', v_employee_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_admin_update_employee(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_role role_enum; v_active boolean;
  v_id uuid := NULLIF(p_payload->>'id','')::uuid;
  v_current_dni text; v_new_dni text;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'id requerido' USING ERRCODE='22023'; END IF;

  SELECT dni INTO v_current_dni FROM public.employees WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Empleado no existe' USING ERRCODE='22023'; END IF;

  IF p_payload ? 'dni' THEN
    v_new_dni := NULLIF(trim(p_payload->>'dni'),'');
    IF v_new_dni IS DISTINCT FROM v_current_dni THEN
      RAISE EXCEPTION 'El DNI no se puede modificar. Para corregir, dá de baja este empleado y creá uno nuevo.'
        USING ERRCODE='42501', HINT='dni_immutable';
    END IF;
  END IF;

  BEGIN
    UPDATE public.employees SET
      nombre = CASE WHEN p_payload ? 'nombre' THEN COALESCE(NULLIF(trim(p_payload->>'nombre'),''), nombre) ELSE nombre END,
      fecha_nacimiento = CASE WHEN p_payload ? 'fecha_nacimiento' THEN NULLIF(p_payload->>'fecha_nacimiento','')::date ELSE fecha_nacimiento END,
      email = CASE WHEN p_payload ? 'email' THEN NULLIF(trim(p_payload->>'email'),'') ELSE email END,
      telefono = CASE WHEN p_payload ? 'telefono' THEN NULLIF(trim(p_payload->>'telefono'),'') ELSE telefono END,
      direccion = CASE WHEN p_payload ? 'direccion' THEN NULLIF(trim(p_payload->>'direccion'),'') ELSE direccion END,
      ciudad = CASE WHEN p_payload ? 'ciudad' THEN NULLIF(trim(p_payload->>'ciudad'),'') ELSE ciudad END,
      provincia = CASE WHEN p_payload ? 'provincia' THEN NULLIF(trim(p_payload->>'provincia'),'') ELSE provincia END,
      codigo_postal = CASE WHEN p_payload ? 'codigo_postal' THEN NULLIF(trim(p_payload->>'codigo_postal'),'') ELSE codigo_postal END,
      fecha_ingreso = CASE WHEN p_payload ? 'fecha_ingreso' THEN NULLIF(p_payload->>'fecha_ingreso','')::date ELSE fecha_ingreso END,
      categoria = CASE WHEN p_payload ? 'categoria' THEN NULLIF(trim(p_payload->>'categoria'),'') ELSE categoria END,
      modalidad = CASE WHEN p_payload ? 'modalidad' THEN NULLIF(trim(p_payload->>'modalidad'),'') ELSE modalidad END,
      tipo_contratacion = CASE WHEN p_payload ? 'tipo_contratacion' THEN NULLIF(trim(p_payload->>'tipo_contratacion'),'') ELSE tipo_contratacion END,
      lugar_trabajo = CASE WHEN p_payload ? 'lugar_trabajo' THEN NULLIF(trim(p_payload->>'lugar_trabajo'),'') ELSE lugar_trabajo END,
      convenio = CASE WHEN p_payload ? 'convenio' THEN NULLIF(trim(p_payload->>'convenio'),'') ELSE convenio END,
      sueldo_bruto_base = CASE WHEN p_payload ? 'sueldo_bruto_base' THEN NULLIF(p_payload->>'sueldo_bruto_base','')::numeric ELSE sueldo_bruto_base END,
      dias_vacaciones_anuales = CASE WHEN p_payload ? 'dias_vacaciones_anuales' THEN NULLIF(p_payload->>'dias_vacaciones_anuales','')::int ELSE dias_vacaciones_anuales END,
      banco = CASE WHEN p_payload ? 'banco' THEN NULLIF(trim(p_payload->>'banco'),'') ELSE banco END,
      cbu = CASE WHEN p_payload ? 'cbu' THEN NULLIF(trim(p_payload->>'cbu'),'') ELSE cbu END,
      alias_cbu = CASE WHEN p_payload ? 'alias_cbu' THEN NULLIF(trim(p_payload->>'alias_cbu'),'') ELSE alias_cbu END,
      forma_cobro = CASE WHEN p_payload ? 'forma_cobro' THEN NULLIF(trim(p_payload->>'forma_cobro'),'') ELSE forma_cobro END,
      notas = CASE WHEN p_payload ? 'notas' THEN NULLIF(trim(p_payload->>'notas'),'') ELSE notas END,
      valor_hora_extra = CASE WHEN p_payload ? 'valor_hora_extra' THEN COALESCE(NULLIF(p_payload->>'valor_hora_extra','')::numeric, 0) ELSE valor_hora_extra END,
      activo = CASE WHEN p_payload ? 'activo' THEN COALESCE((p_payload->>'activo')::boolean, activo) ELSE activo END
    WHERE id = v_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Ya existe otro empleado con ese DNI' USING ERRCODE='23505', HINT='duplicate_dni';
  END;

  RETURN jsonb_build_object('employee_id', v_id, 'updated', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_admin_bulk_create_employees(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_role role_enum; v_active boolean;
  v_items jsonb := COALESCE(p_payload->'items', '[]'::jsonb);
  v_count_created int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_employee_id uuid;
  v_item jsonb;
  v_index int := 0;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  IF jsonb_typeof(v_items) <> 'array' THEN
    RAISE EXCEPTION 'items debe ser array' USING ERRCODE='22023'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
    BEGIN
      INSERT INTO public.employees (
        nombre, dni, fecha_nacimiento, email, telefono,
        direccion, ciudad, provincia, codigo_postal,
        fecha_ingreso, categoria, modalidad, tipo_contratacion,
        lugar_trabajo, convenio,
        sueldo_bruto_base, dias_vacaciones_anuales,
        banco, cbu, alias_cbu, forma_cobro,
        notas, created_by
      ) VALUES (
        NULLIF(trim(v_item->>'nombre'), ''),
        NULLIF(trim(v_item->>'dni'), ''),
        NULLIF(v_item->>'fecha_nacimiento', '')::date,
        NULLIF(trim(v_item->>'email'), ''),
        NULLIF(trim(v_item->>'telefono'), ''),
        NULLIF(trim(v_item->>'direccion'), ''),
        NULLIF(trim(v_item->>'ciudad'), ''),
        NULLIF(trim(v_item->>'provincia'), ''),
        NULLIF(trim(v_item->>'codigo_postal'), ''),
        NULLIF(v_item->>'fecha_ingreso', '')::date,
        NULLIF(trim(v_item->>'categoria'), ''),
        NULLIF(trim(v_item->>'modalidad'), ''),
        NULLIF(trim(v_item->>'tipo_contratacion'), ''),
        NULLIF(trim(v_item->>'lugar_trabajo'), ''),
        NULLIF(trim(v_item->>'convenio'), ''),
        NULLIF(v_item->>'sueldo_bruto_base', '')::numeric,
        NULLIF(v_item->>'dias_vacaciones_anuales', '')::int,
        NULLIF(trim(v_item->>'banco'), ''),
        NULLIF(trim(v_item->>'cbu'), ''),
        NULLIF(trim(v_item->>'alias_cbu'), ''),
        NULLIF(trim(v_item->>'forma_cobro'), ''),
        NULLIF(trim(v_item->>'notas'), ''),
        auth.uid()
      ) RETURNING id INTO v_employee_id;
      v_count_created := v_count_created + 1;
    EXCEPTION
      WHEN unique_violation THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'index', v_index, 'reason', 'duplicate_dni',
          'dni', v_item->>'dni'));
      WHEN check_violation THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'index', v_index, 'reason', 'check_violation', 'detail', SQLERRM));
      WHEN OTHERS THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'index', v_index, 'reason', 'other',
          'sqlstate', SQLSTATE, 'detail', SQLERRM));
    END;
    v_index := v_index + 1;
  END LOOP;

  RETURN jsonb_build_object('created', v_count_created, 'errors', v_errors);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_admin_bulk_update_employees(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_role role_enum; v_active boolean;
  v_items jsonb := COALESCE(p_payload->'items', '[]'::jsonb);
  v_count_updated int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_item jsonb;
  v_index int := 0;
  v_id uuid;
  v_current_dni text;
  v_new_dni text;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  IF jsonb_typeof(v_items) <> 'array' THEN
    RAISE EXCEPTION 'items debe ser array' USING ERRCODE='22023'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
    BEGIN
      v_id := NULLIF(v_item->>'id', '')::uuid;
      IF v_id IS NULL THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'index', v_index, 'reason', 'missing_id'));
      ELSE
        SELECT dni INTO v_current_dni FROM public.employees WHERE id = v_id FOR UPDATE;
        IF NOT FOUND THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object(
            'index', v_index, 'reason', 'not_found', 'id', v_id::text));
        ELSE
          -- DNI inmutable post-alta
          v_new_dni := NULLIF(trim(v_item->>'dni'),'');
          IF v_new_dni IS NOT NULL AND v_new_dni IS DISTINCT FROM v_current_dni THEN
            v_errors := v_errors || jsonb_build_array(jsonb_build_object(
              'index', v_index, 'reason', 'dni_immutable',
              'detail', 'El DNI no se puede modificar via bulk import',
              'current_dni', v_current_dni, 'new_dni', v_new_dni));
          ELSE
            UPDATE public.employees SET
              nombre = CASE WHEN v_item ? 'nombre' THEN COALESCE(NULLIF(trim(v_item->>'nombre'),''), nombre) ELSE nombre END,
              fecha_nacimiento = CASE WHEN v_item ? 'fecha_nacimiento' THEN NULLIF(v_item->>'fecha_nacimiento','')::date ELSE fecha_nacimiento END,
              email = CASE WHEN v_item ? 'email' THEN NULLIF(trim(v_item->>'email'),'') ELSE email END,
              telefono = CASE WHEN v_item ? 'telefono' THEN NULLIF(trim(v_item->>'telefono'),'') ELSE telefono END,
              direccion = CASE WHEN v_item ? 'direccion' THEN NULLIF(trim(v_item->>'direccion'),'') ELSE direccion END,
              ciudad = CASE WHEN v_item ? 'ciudad' THEN NULLIF(trim(v_item->>'ciudad'),'') ELSE ciudad END,
              provincia = CASE WHEN v_item ? 'provincia' THEN NULLIF(trim(v_item->>'provincia'),'') ELSE provincia END,
              codigo_postal = CASE WHEN v_item ? 'codigo_postal' THEN NULLIF(trim(v_item->>'codigo_postal'),'') ELSE codigo_postal END,
              fecha_ingreso = CASE WHEN v_item ? 'fecha_ingreso' THEN NULLIF(v_item->>'fecha_ingreso','')::date ELSE fecha_ingreso END,
              categoria = CASE WHEN v_item ? 'categoria' THEN NULLIF(trim(v_item->>'categoria'),'') ELSE categoria END,
              modalidad = CASE WHEN v_item ? 'modalidad' THEN NULLIF(trim(v_item->>'modalidad'),'') ELSE modalidad END,
              tipo_contratacion = CASE WHEN v_item ? 'tipo_contratacion' THEN NULLIF(trim(v_item->>'tipo_contratacion'),'') ELSE tipo_contratacion END,
              lugar_trabajo = CASE WHEN v_item ? 'lugar_trabajo' THEN NULLIF(trim(v_item->>'lugar_trabajo'),'') ELSE lugar_trabajo END,
              convenio = CASE WHEN v_item ? 'convenio' THEN NULLIF(trim(v_item->>'convenio'),'') ELSE convenio END,
              sueldo_bruto_base = CASE WHEN v_item ? 'sueldo_bruto_base' THEN NULLIF(v_item->>'sueldo_bruto_base','')::numeric ELSE sueldo_bruto_base END,
              dias_vacaciones_anuales = CASE WHEN v_item ? 'dias_vacaciones_anuales' THEN NULLIF(v_item->>'dias_vacaciones_anuales','')::int ELSE dias_vacaciones_anuales END,
              banco = CASE WHEN v_item ? 'banco' THEN NULLIF(trim(v_item->>'banco'),'') ELSE banco END,
              cbu = CASE WHEN v_item ? 'cbu' THEN NULLIF(trim(v_item->>'cbu'),'') ELSE cbu END,
              alias_cbu = CASE WHEN v_item ? 'alias_cbu' THEN NULLIF(trim(v_item->>'alias_cbu'),'') ELSE alias_cbu END,
              forma_cobro = CASE WHEN v_item ? 'forma_cobro' THEN NULLIF(trim(v_item->>'forma_cobro'),'') ELSE forma_cobro END,
              notas = CASE WHEN v_item ? 'notas' THEN NULLIF(trim(v_item->>'notas'),'') ELSE notas END,
              activo = CASE WHEN v_item ? 'activo' THEN COALESCE((v_item->>'activo')::boolean, activo) ELSE activo END
            WHERE id = v_id;
            v_count_updated := v_count_updated + 1;
          END IF;
        END IF;
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'index', v_index, 'reason', 'other',
          'sqlstate', SQLSTATE, 'detail', SQLERRM));
    END;
    v_index := v_index + 1;
  END LOOP;

  RETURN jsonb_build_object('updated', v_count_updated, 'errors', v_errors);
END;
$function$;

-- check_cuils_exist → check_dnis_exist
DROP FUNCTION IF EXISTS public.rpc_admin_check_cuils_exist(text[]);
CREATE OR REPLACE FUNCTION public.rpc_admin_check_dnis_exist(p_dnis text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_role role_enum; v_active boolean;
  v_existing jsonb;
  v_not_existing jsonb;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'dni', e.dni, 'id', e.id, 'nombre', e.nombre, 'activo', e.activo
  )), '[]'::jsonb) INTO v_existing
  FROM public.employees e
  WHERE e.dni = ANY(p_dnis);

  SELECT COALESCE(jsonb_agg(c), '[]'::jsonb) INTO v_not_existing
  FROM (
    SELECT unnest(p_dnis) AS c
    EXCEPT
    SELECT dni FROM public.employees WHERE dni IS NOT NULL
  ) sub;

  RETURN jsonb_build_object('existing', v_existing, 'not_existing', v_not_existing);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_check_dnis_exist(text[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_check_dnis_exist(text[]) TO authenticated;

-- create_recibo: snapshot empleado_dni
CREATE OR REPLACE FUNCTION public.rpc_admin_create_recibo(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_role role_enum; v_active boolean;
  v_employee public.employees%ROWTYPE;
  v_employee_id uuid := NULLIF(p_payload->>'employee_id','')::uuid;
  v_tipo text := NULLIF(trim(p_payload->>'tipo'),'');
  v_items jsonb := COALESCE(p_payload->'items', '[]'::jsonb);
  v_total numeric(14,2); v_recibo_id uuid;
  v_periodo_desde date; v_periodo_hasta date;
  v_fecha_pago_check date;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  v_fecha_pago_check := COALESCE(NULLIF(p_payload->>'fecha_pago','')::date, CURRENT_DATE);
  IF public._admin_check_periodo_cerrado(v_fecha_pago_check) THEN
    RAISE EXCEPTION 'Periodo contable cerrado para esa fecha de pago.' USING ERRCODE='42501', HINT='periodo_cerrado'; END IF;
  IF v_employee_id IS NULL THEN RAISE EXCEPTION 'employee_id requerido' USING ERRCODE='22023', HINT='employee_required'; END IF;
  IF v_tipo NOT IN ('adelanto','quincena','sueldo') THEN RAISE EXCEPTION 'Tipo invalido (adelanto/quincena/sueldo)' USING ERRCODE='22023', HINT='invalid_tipo'; END IF;
  IF jsonb_typeof(v_items) <> 'array' THEN RAISE EXCEPTION 'items debe ser un array' USING ERRCODE='22023', HINT='items_array'; END IF;
  SELECT * INTO v_employee FROM public.employees WHERE id = v_employee_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Empleado no existe' USING ERRCODE='22023', HINT='employee_not_found'; END IF;
  v_periodo_desde := NULLIF(p_payload->>'periodo_desde','')::date;
  v_periodo_hasta := NULLIF(p_payload->>'periodo_hasta','')::date;
  IF v_periodo_desde IS NULL OR v_periodo_hasta IS NULL THEN RAISE EXCEPTION 'periodo_desde y periodo_hasta requeridos' USING ERRCODE='22023', HINT='periodo_required'; END IF;
  v_total := COALESCE(NULLIF(p_payload->>'total','')::numeric,
    (SELECT COALESCE(SUM((item->>'subtotal')::numeric), 0) FROM jsonb_array_elements(v_items) AS item));
  INSERT INTO public.recibos (employee_id, empleado_dni, empleado_nombre, empleado_categoria, empleado_fecha_ingreso,
    tipo, periodo_desde, periodo_hasta, fecha_pago, sueldo_basico, items, total, notas, created_by) VALUES (
    v_employee_id, COALESCE(v_employee.dni, ''), v_employee.nombre, v_employee.categoria, v_employee.fecha_ingreso,
    v_tipo, v_periodo_desde, v_periodo_hasta, v_fecha_pago_check,
    COALESCE(NULLIF(p_payload->>'sueldo_basico','')::numeric, v_employee.sueldo_bruto_base, 0),
    v_items, v_total, NULLIF(trim(p_payload->>'notas'),''), auth.uid()
  ) RETURNING id INTO v_recibo_id;
  RETURN jsonb_build_object('recibo_id', v_recibo_id, 'total', v_total);
END; $function$;

-- historial: empleado.dni
CREATE OR REPLACE FUNCTION public.rpc_admin_historial_empleado(p_employee_id uuid, p_year integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_role role_enum; v_active boolean;
  v_empleado jsonb; v_totales jsonb; v_por_mes jsonb; v_recibos jsonb;
  v_count int; v_total_year numeric; v_total_mes_actual numeric;
  v_mes_actual int := EXTRACT(MONTH FROM CURRENT_DATE)::int;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  IF p_employee_id IS NULL OR p_year IS NULL THEN
    RAISE EXCEPTION 'employee_id y year requeridos' USING ERRCODE='22023', HINT='params_required'; END IF;

  SELECT to_jsonb(e) INTO v_empleado
    FROM (SELECT id, nombre, dni, categoria, fecha_ingreso, sueldo_bruto_base, modalidad, lugar_trabajo, activo
            FROM public.employees WHERE id = p_employee_id) e;
  IF v_empleado IS NULL THEN
    RAISE EXCEPTION 'Empleado no existe' USING ERRCODE='22023', HINT='employee_not_found'; END IF;

  SELECT count(*), COALESCE(SUM(total), 0) INTO v_count, v_total_year
    FROM public.recibos WHERE employee_id = p_employee_id AND estado='emitido'
     AND EXTRACT(YEAR FROM fecha_pago)::int = p_year;

  SELECT COALESCE(SUM(total), 0) INTO v_total_mes_actual
    FROM public.recibos WHERE employee_id = p_employee_id AND estado='emitido'
     AND EXTRACT(YEAR FROM fecha_pago)::int = p_year
     AND EXTRACT(MONTH FROM fecha_pago)::int = v_mes_actual;

  v_totales := jsonb_build_object(
    'year_total', v_total_year, 'month_total', v_total_mes_actual,
    'avg_monthly', CASE WHEN v_count > 0 THEN v_total_year / 12.0 ELSE 0 END,
    'count_recibos', v_count);

  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY (m->>'mes')::int), '[]'::jsonb) INTO v_por_mes
    FROM (
      SELECT jsonb_build_object(
               'mes', m.mes::int,
               'total', COALESCE(SUM(r.total), 0),
               'count', COUNT(r.id),
               'total_adelanto', COALESCE(SUM(r.total) FILTER (WHERE r.tipo = 'adelanto'), 0),
               'total_quincena', COALESCE(SUM(r.total) FILTER (WHERE r.tipo = 'quincena'), 0),
               'total_sueldo',   COALESCE(SUM(r.total) FILTER (WHERE r.tipo = 'sueldo'),   0)
             ) AS m
        FROM generate_series(1, 12) AS m(mes)
        LEFT JOIN public.recibos r ON r.employee_id = p_employee_id AND r.estado = 'emitido'
              AND EXTRACT(YEAR FROM r.fecha_pago)::int = p_year
              AND EXTRACT(MONTH FROM r.fecha_pago)::int = m.mes
       GROUP BY m.mes) sub;

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.fecha_pago DESC, r.created_at DESC), '[]'::jsonb) INTO v_recibos
    FROM public.recibos r WHERE r.employee_id = p_employee_id AND r.estado='emitido'
     AND EXTRACT(YEAR FROM r.fecha_pago)::int = p_year;

  RETURN jsonb_build_object('empleado', v_empleado, 'year', p_year, 'totales', v_totales, 'por_mes', v_por_mes, 'recibos', v_recibos);
END;
$function$;

-- reportes_global: e.dni
CREATE OR REPLACE FUNCTION public.rpc_admin_reportes_global(p_year integer, p_mes integer DEFAULT NULL::integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_role role_enum; v_active boolean;
  v_tabla jsonb; v_kpis jsonb;
  v_total_year numeric; v_total_mes numeric; v_empleados_count int;
  v_top jsonb; v_low jsonb;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  IF p_year IS NULL THEN
    RAISE EXCEPTION 'year requerido' USING ERRCODE='22023', HINT='year_required'; END IF;

  WITH ag AS (
    SELECT e.id AS employee_id, e.nombre, e.dni, e.categoria, e.activo,
      COALESCE(SUM(r.total) FILTER (WHERE EXTRACT(YEAR FROM r.fecha_pago)::int = p_year), 0) AS total_year,
      COALESCE(SUM(r.total) FILTER (WHERE EXTRACT(YEAR FROM r.fecha_pago)::int = p_year
        AND (p_mes IS NULL OR EXTRACT(MONTH FROM r.fecha_pago)::int = p_mes)), 0) AS total_month,
      COUNT(r.id) FILTER (WHERE EXTRACT(YEAR FROM r.fecha_pago)::int = p_year) AS count_recibos_year,
      COALESCE(SUM(r.total) FILTER (WHERE EXTRACT(YEAR FROM r.fecha_pago)::int = p_year AND r.tipo='adelanto'), 0) AS total_adelanto,
      COALESCE(SUM(r.total) FILTER (WHERE EXTRACT(YEAR FROM r.fecha_pago)::int = p_year AND r.tipo='quincena'), 0) AS total_quincena,
      COALESCE(SUM(r.total) FILTER (WHERE EXTRACT(YEAR FROM r.fecha_pago)::int = p_year AND r.tipo='sueldo'),   0) AS total_sueldo
      FROM public.employees e
      LEFT JOIN public.recibos r ON r.employee_id = e.id AND r.estado='emitido'
     WHERE e.activo = true
     GROUP BY e.id, e.nombre, e.dni, e.categoria, e.activo
  ),
  ag_with_ultimo AS (
    SELECT a.*, (SELECT to_jsonb(u) FROM (
        SELECT r.id, r.tipo, r.fecha_pago, r.total FROM public.recibos r
         WHERE r.employee_id = a.employee_id AND r.estado='emitido'
         ORDER BY r.fecha_pago DESC LIMIT 1) u) AS ultimo_recibo
      FROM ag a
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.total_year DESC), '[]'::jsonb) INTO v_tabla
    FROM ag_with_ultimo t;

  SELECT COALESCE(SUM(total), 0) INTO v_total_year
    FROM public.recibos WHERE estado='emitido' AND EXTRACT(YEAR FROM fecha_pago)::int = p_year;
  SELECT COALESCE(SUM(total), 0) INTO v_total_mes
    FROM public.recibos WHERE estado='emitido' AND EXTRACT(YEAR FROM fecha_pago)::int = p_year
     AND (p_mes IS NULL OR EXTRACT(MONTH FROM fecha_pago)::int = p_mes);
  SELECT count(*) INTO v_empleados_count FROM public.employees WHERE activo = true;

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
    'total_year', v_total_year,
    'total_month', CASE WHEN p_mes IS NULL THEN NULL ELSE v_total_mes END,
    'avg_per_employee', CASE WHEN v_empleados_count > 0 THEN v_total_year / v_empleados_count ELSE 0 END,
    'top_employee', v_top, 'low_employee', v_low, 'empleados_count', v_empleados_count);

  RETURN jsonb_build_object('year', p_year, 'mes', p_mes, 'kpis', v_kpis, 'tabla', v_tabla);
END;
$function$;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual): renombrar dni→cuil, restaurar CHECK/índice CUIL,
-- recibos.empleado_dni→empleado_cuil, y volver a las RPCs con cuil.
-- ════════════════════════════════════════════════════════════════════
