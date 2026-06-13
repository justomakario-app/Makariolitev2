-- ════════════════════════════════════════════════════════════════════
-- RRHH — DNI editable (pedido de Seba / Jefe)
-- ════════════════════════════════════════════════════════════════════
-- Al pasar de CUIL a DNI (0076) se conservó la regla vieja: el DNI era
-- INMUTABLE post-alta. El Jefe pide que los DNI ya cargados se puedan
-- CORREGIR/editar. Se quita esa inmutabilidad en update + bulk_update.
-- El índice único `employees_dni_unique_idx` sigue evitando duplicados,
-- y el CHECK de formato sigue vigente. 100% aditivo (CREATE OR REPLACE).
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rpc_admin_update_employee(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_role role_enum; v_active boolean;
  v_id uuid := NULLIF(p_payload->>'id','')::uuid;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'id requerido' USING ERRCODE='22023'; END IF;

  PERFORM 1 FROM public.employees WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Empleado no existe' USING ERRCODE='22023'; END IF;

  -- DNI ahora EDITABLE: se actualiza si viene en el payload (se quitó la
  -- inmutabilidad). El índice único sigue impidiendo DNIs duplicados.
  BEGIN
    UPDATE public.employees SET
      dni = CASE WHEN p_payload ? 'dni' THEN COALESCE(NULLIF(trim(p_payload->>'dni'),''), dni) ELSE dni END,
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
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('index', v_index, 'reason', 'missing_id'));
      ELSIF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = v_id) THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('index', v_index, 'reason', 'not_found', 'id', v_id::text));
      ELSE
        -- DNI ahora EDITABLE también por bulk (se quitó la inmutabilidad).
        UPDATE public.employees SET
          dni = CASE WHEN v_item ? 'dni' THEN COALESCE(NULLIF(trim(v_item->>'dni'),''), dni) ELSE dni END,
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
    EXCEPTION
      WHEN OTHERS THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'index', v_index, 'reason', 'other', 'sqlstate', SQLSTATE, 'detail', SQLERRM));
    END;
    v_index := v_index + 1;
  END LOOP;

  RETURN jsonb_build_object('updated', v_count_updated, 'errors', v_errors);
END;
$function$;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual): restaurar las funciones de 0076 (con el bloqueo
-- 'dni_immutable').
-- ════════════════════════════════════════════════════════════════════
