-- ════════════════════════════════════════════════════════════════════
-- ADMIN MODULE — Employees (S2.11)
-- ════════════════════════════════════════════════════════════════════
-- 1) Tabla employees con 24 columnas + 7 CHECK + 3 indexes + RLS.
-- 2) 2 triggers: set_updated_at + audit_log (Opcion B confirmada por
--    pre-flight: trg_audit_log() ya es parametrizado via TG_TABLE_NAME).
-- 3) 7 RPCs (NO rpc_admin_list_employees por decision Jefe: SELECT
--    directo desde frontend reutilizando RLS).
--
-- Audit log captura employees automaticamente via el nuevo trigger
-- employees_audit_log_trg → trg_audit_log() (heredado S2.0).
-- ════════════════════════════════════════════════════════════════════

-- ── (1) Tabla employees ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.employees (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuil                    text,
  activo                  boolean NOT NULL DEFAULT true,

  -- Bloque 1: datos personales
  nombre                  text NOT NULL,
  fecha_nacimiento        date,
  email                   text,
  telefono                text,
  direccion               text,
  ciudad                  text,
  provincia               text,
  codigo_postal           text,

  -- Bloque 2: datos laborales
  fecha_ingreso           date,
  categoria               text,
  modalidad               text,
  tipo_contratacion       text,
  lugar_trabajo           text,
  convenio                text,

  -- Bloque 3: liquidacion base
  sueldo_bruto_base       numeric,
  dias_vacaciones_anuales int,

  -- Bloque 4: datos de pago
  banco                   text,
  cbu                     text,
  alias_cbu               text,
  forma_cobro             text,

  -- Auditoria
  notas                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid REFERENCES public.profiles(id),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- ── (2) CHECK constraints ───────────────────────────────────────────
ALTER TABLE public.employees ADD CONSTRAINT employees_nombre_check
  CHECK (length(nombre) >= 1 AND length(nombre) <= 120);

ALTER TABLE public.employees ADD CONSTRAINT employees_cuil_check
  CHECK (cuil IS NULL OR cuil ~ '^\d{2}-\d{8}-\d$');

ALTER TABLE public.employees ADD CONSTRAINT employees_modalidad_check
  CHECK (modalidad IS NULL OR modalidad IN ('full_time','part_time','horas','eventual'));

ALTER TABLE public.employees ADD CONSTRAINT employees_tipo_contratacion_check
  CHECK (tipo_contratacion IS NULL OR tipo_contratacion IN ('relacion_dependencia','monotributo','autonomo','eventual'));

ALTER TABLE public.employees ADD CONSTRAINT employees_forma_cobro_check
  CHECK (forma_cobro IS NULL OR forma_cobro IN ('transferencia','efectivo','cheque','otro'));

ALTER TABLE public.employees ADD CONSTRAINT employees_sueldo_bruto_base_check
  CHECK (sueldo_bruto_base IS NULL OR sueldo_bruto_base >= 0);

ALTER TABLE public.employees ADD CONSTRAINT employees_cbu_check
  CHECK (cbu IS NULL OR cbu ~ '^\d{22}$');

-- ── (3) Indexes ─────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS employees_cuil_unique_idx
  ON public.employees (cuil) WHERE cuil IS NOT NULL;

CREATE INDEX IF NOT EXISTS employees_inactive_idx
  ON public.employees (activo) WHERE activo = false;

CREATE INDEX IF NOT EXISTS employees_nombre_idx
  ON public.employees (lower(nombre));

-- ── (4) Triggers ────────────────────────────────────────────────────
CREATE TRIGGER employees_set_updated_at
  BEFORE UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER employees_audit_log_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit_log();

-- ── (5) RLS ─────────────────────────────────────────────────────────
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY employees_select_owner_or_admin ON public.employees
  FOR SELECT TO authenticated
  USING (public.is_owner_or_admin());

CREATE POLICY employees_modify_owner_or_admin ON public.employees
  FOR ALL TO authenticated
  USING (public.is_owner_or_admin())
  WITH CHECK (public.is_owner_or_admin());

-- ════════════════════════════════════════════════════════════════════
-- RPCs (7 nuevos — NO rpc_admin_list_employees)
-- ════════════════════════════════════════════════════════════════════

-- ── (RPC 1) rpc_admin_create_employee ───────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_create_employee(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_employee_id uuid;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  BEGIN
    INSERT INTO public.employees (
      nombre, cuil, fecha_nacimiento, email, telefono,
      direccion, ciudad, provincia, codigo_postal,
      fecha_ingreso, categoria, modalidad, tipo_contratacion,
      lugar_trabajo, convenio,
      sueldo_bruto_base, dias_vacaciones_anuales,
      banco, cbu, alias_cbu, forma_cobro,
      notas, created_by
    ) VALUES (
      NULLIF(trim(p_payload->>'nombre'), ''),
      NULLIF(trim(p_payload->>'cuil'), ''),
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
      auth.uid()
    ) RETURNING id INTO v_employee_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Ya existe otro empleado con ese CUIL'
        USING ERRCODE='23505', HINT='duplicate_cuil';
  END;

  RETURN jsonb_build_object('employee_id', v_employee_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_create_employee(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_create_employee(jsonb) TO authenticated;

-- ── (RPC 2) rpc_admin_update_employee (con cuil_immutable + MERGE) ──
CREATE OR REPLACE FUNCTION public.rpc_admin_update_employee(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum; v_active boolean;
  v_id uuid := NULLIF(p_payload->>'id','')::uuid;
  v_current_cuil text;
  v_new_cuil text;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  IF v_id IS NULL THEN RAISE EXCEPTION 'id requerido' USING ERRCODE='22023'; END IF;

  SELECT cuil INTO v_current_cuil FROM public.employees WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Empleado no existe' USING ERRCODE='22023'; END IF;

  -- Rechazar cambio de CUIL (paralelo a cuit_immutable en suppliers S2.2)
  IF p_payload ? 'cuil' THEN
    v_new_cuil := NULLIF(trim(p_payload->>'cuil'),'');
    IF v_new_cuil IS DISTINCT FROM v_current_cuil THEN
      RAISE EXCEPTION
        'El CUIL no se puede modificar. Para corregir, dá de baja este empleado y creá uno nuevo.'
        USING ERRCODE='42501', HINT='cuil_immutable';
    END IF;
  END IF;

  BEGIN
    UPDATE public.employees SET
      nombre = CASE WHEN p_payload ? 'nombre'
                    THEN COALESCE(NULLIF(trim(p_payload->>'nombre'),''), nombre)
                    ELSE nombre END,
      fecha_nacimiento = CASE WHEN p_payload ? 'fecha_nacimiento'
                              THEN NULLIF(p_payload->>'fecha_nacimiento','')::date
                              ELSE fecha_nacimiento END,
      email = CASE WHEN p_payload ? 'email'
                   THEN NULLIF(trim(p_payload->>'email'),'')
                   ELSE email END,
      telefono = CASE WHEN p_payload ? 'telefono'
                      THEN NULLIF(trim(p_payload->>'telefono'),'')
                      ELSE telefono END,
      direccion = CASE WHEN p_payload ? 'direccion'
                       THEN NULLIF(trim(p_payload->>'direccion'),'')
                       ELSE direccion END,
      ciudad = CASE WHEN p_payload ? 'ciudad'
                    THEN NULLIF(trim(p_payload->>'ciudad'),'')
                    ELSE ciudad END,
      provincia = CASE WHEN p_payload ? 'provincia'
                       THEN NULLIF(trim(p_payload->>'provincia'),'')
                       ELSE provincia END,
      codigo_postal = CASE WHEN p_payload ? 'codigo_postal'
                           THEN NULLIF(trim(p_payload->>'codigo_postal'),'')
                           ELSE codigo_postal END,
      fecha_ingreso = CASE WHEN p_payload ? 'fecha_ingreso'
                           THEN NULLIF(p_payload->>'fecha_ingreso','')::date
                           ELSE fecha_ingreso END,
      categoria = CASE WHEN p_payload ? 'categoria'
                       THEN NULLIF(trim(p_payload->>'categoria'),'')
                       ELSE categoria END,
      modalidad = CASE WHEN p_payload ? 'modalidad'
                       THEN NULLIF(trim(p_payload->>'modalidad'),'')
                       ELSE modalidad END,
      tipo_contratacion = CASE WHEN p_payload ? 'tipo_contratacion'
                               THEN NULLIF(trim(p_payload->>'tipo_contratacion'),'')
                               ELSE tipo_contratacion END,
      lugar_trabajo = CASE WHEN p_payload ? 'lugar_trabajo'
                           THEN NULLIF(trim(p_payload->>'lugar_trabajo'),'')
                           ELSE lugar_trabajo END,
      convenio = CASE WHEN p_payload ? 'convenio'
                      THEN NULLIF(trim(p_payload->>'convenio'),'')
                      ELSE convenio END,
      sueldo_bruto_base = CASE WHEN p_payload ? 'sueldo_bruto_base'
                               THEN NULLIF(p_payload->>'sueldo_bruto_base','')::numeric
                               ELSE sueldo_bruto_base END,
      dias_vacaciones_anuales = CASE WHEN p_payload ? 'dias_vacaciones_anuales'
                                     THEN NULLIF(p_payload->>'dias_vacaciones_anuales','')::int
                                     ELSE dias_vacaciones_anuales END,
      banco = CASE WHEN p_payload ? 'banco'
                   THEN NULLIF(trim(p_payload->>'banco'),'')
                   ELSE banco END,
      cbu = CASE WHEN p_payload ? 'cbu'
                 THEN NULLIF(trim(p_payload->>'cbu'),'')
                 ELSE cbu END,
      alias_cbu = CASE WHEN p_payload ? 'alias_cbu'
                       THEN NULLIF(trim(p_payload->>'alias_cbu'),'')
                       ELSE alias_cbu END,
      forma_cobro = CASE WHEN p_payload ? 'forma_cobro'
                         THEN NULLIF(trim(p_payload->>'forma_cobro'),'')
                         ELSE forma_cobro END,
      notas = CASE WHEN p_payload ? 'notas'
                   THEN NULLIF(trim(p_payload->>'notas'),'')
                   ELSE notas END,
      activo = CASE WHEN p_payload ? 'activo'
                    THEN COALESCE((p_payload->>'activo')::boolean, activo)
                    ELSE activo END
    WHERE id = v_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Ya existe otro empleado con ese CUIL'
        USING ERRCODE='23505', HINT='duplicate_cuil';
  END;

  RETURN jsonb_build_object('employee_id', v_id, 'updated', true);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_update_employee(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_update_employee(jsonb) TO authenticated;

-- ── (RPC 3) rpc_admin_delete_employee (fisico + TODO S2.12) ─────────
CREATE OR REPLACE FUNCTION public.rpc_admin_delete_employee(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- TODO S2.12: cuando se cree la tabla 'recibos', sumar check
  -- similar a rpc_admin_delete_supplier (S2.1):
  --   IF (SELECT count(*) FROM recibos WHERE employee_id = v_id) > 0 THEN
  --     UPDATE employees SET activo=false WHERE id = v_id;
  --     RETURN jsonb_build_object('soft_deleted', true,
  --                               'reason', 'has_recibos');
  --   END IF;
  -- (luego sigue el DELETE actual como fallback)

  DELETE FROM public.employees WHERE id = v_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Empleado no existe' USING ERRCODE='22023';
  END IF;

  RETURN jsonb_build_object('employee_id', v_id, 'deleted', true);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_delete_employee(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_delete_employee(jsonb) TO authenticated;

-- ── (RPC 4) rpc_admin_get_employee_historial (placeholder S2.15) ────
CREATE OR REPLACE FUNCTION public.rpc_admin_get_employee_historial(p_employee_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum; v_active boolean;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  -- Placeholder S2.15: cuando se cree la tabla 'recibos', llenar con
  -- totales reales (total_recibos, ultimo_recibo, suma_anio, etc).
  RETURN jsonb_build_object(
    'employee_id', p_employee_id,
    'total_recibos', 0,
    'ultimo_recibo', null,
    'placeholder', 'Historial disponible en S2.15'
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_get_employee_historial(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_get_employee_historial(uuid) TO authenticated;

-- ── (RPC 5) rpc_admin_check_cuils_exist ─────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_check_cuils_exist(p_cuils text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
    'cuil', e.cuil, 'id', e.id, 'nombre', e.nombre, 'activo', e.activo
  )), '[]'::jsonb) INTO v_existing
  FROM public.employees e
  WHERE e.cuil = ANY(p_cuils);

  SELECT COALESCE(jsonb_agg(c), '[]'::jsonb) INTO v_not_existing
  FROM (
    SELECT unnest(p_cuils) AS c
    EXCEPT
    SELECT cuil FROM public.employees WHERE cuil IS NOT NULL
  ) sub;

  RETURN jsonb_build_object('existing', v_existing, 'not_existing', v_not_existing);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_check_cuils_exist(text[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_check_cuils_exist(text[]) TO authenticated;

-- ── (RPC 6) rpc_admin_bulk_create_employees ─────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_bulk_create_employees(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
        nombre, cuil, fecha_nacimiento, email, telefono,
        direccion, ciudad, provincia, codigo_postal,
        fecha_ingreso, categoria, modalidad, tipo_contratacion,
        lugar_trabajo, convenio,
        sueldo_bruto_base, dias_vacaciones_anuales,
        banco, cbu, alias_cbu, forma_cobro,
        notas, created_by
      ) VALUES (
        NULLIF(trim(v_item->>'nombre'), ''),
        NULLIF(trim(v_item->>'cuil'), ''),
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
          'index', v_index, 'reason', 'duplicate_cuil',
          'cuil', v_item->>'cuil'));
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

REVOKE EXECUTE ON FUNCTION public.rpc_admin_bulk_create_employees(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_bulk_create_employees(jsonb) TO authenticated;

-- ── (RPC 7) rpc_admin_bulk_update_employees ─────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_bulk_update_employees(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum; v_active boolean;
  v_items jsonb := COALESCE(p_payload->'items', '[]'::jsonb);
  v_count_updated int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_item jsonb;
  v_index int := 0;
  v_id uuid;
  v_current_cuil text;
  v_new_cuil text;
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
        SELECT cuil INTO v_current_cuil FROM public.employees WHERE id = v_id FOR UPDATE;
        IF NOT FOUND THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object(
            'index', v_index, 'reason', 'not_found', 'id', v_id::text));
        ELSE
          v_new_cuil := NULLIF(trim(v_item->>'cuil'),'');
          IF v_new_cuil IS NOT NULL AND v_new_cuil IS DISTINCT FROM v_current_cuil THEN
            v_errors := v_errors || jsonb_build_array(jsonb_build_object(
              'index', v_index, 'reason', 'cuil_immutable',
              'detail', 'El CUIL no se puede modificar via bulk import',
              'current_cuil', v_current_cuil, 'new_cuil', v_new_cuil));
          ELSE
            UPDATE public.employees SET
              nombre = CASE WHEN v_item ? 'nombre'
                            THEN COALESCE(NULLIF(trim(v_item->>'nombre'),''), nombre)
                            ELSE nombre END,
              fecha_nacimiento = CASE WHEN v_item ? 'fecha_nacimiento'
                                      THEN NULLIF(v_item->>'fecha_nacimiento','')::date
                                      ELSE fecha_nacimiento END,
              email = CASE WHEN v_item ? 'email'
                           THEN NULLIF(trim(v_item->>'email'),'')
                           ELSE email END,
              telefono = CASE WHEN v_item ? 'telefono'
                              THEN NULLIF(trim(v_item->>'telefono'),'')
                              ELSE telefono END,
              direccion = CASE WHEN v_item ? 'direccion'
                               THEN NULLIF(trim(v_item->>'direccion'),'')
                               ELSE direccion END,
              ciudad = CASE WHEN v_item ? 'ciudad'
                            THEN NULLIF(trim(v_item->>'ciudad'),'')
                            ELSE ciudad END,
              provincia = CASE WHEN v_item ? 'provincia'
                               THEN NULLIF(trim(v_item->>'provincia'),'')
                               ELSE provincia END,
              codigo_postal = CASE WHEN v_item ? 'codigo_postal'
                                   THEN NULLIF(trim(v_item->>'codigo_postal'),'')
                                   ELSE codigo_postal END,
              fecha_ingreso = CASE WHEN v_item ? 'fecha_ingreso'
                                   THEN NULLIF(v_item->>'fecha_ingreso','')::date
                                   ELSE fecha_ingreso END,
              categoria = CASE WHEN v_item ? 'categoria'
                               THEN NULLIF(trim(v_item->>'categoria'),'')
                               ELSE categoria END,
              modalidad = CASE WHEN v_item ? 'modalidad'
                               THEN NULLIF(trim(v_item->>'modalidad'),'')
                               ELSE modalidad END,
              tipo_contratacion = CASE WHEN v_item ? 'tipo_contratacion'
                                       THEN NULLIF(trim(v_item->>'tipo_contratacion'),'')
                                       ELSE tipo_contratacion END,
              lugar_trabajo = CASE WHEN v_item ? 'lugar_trabajo'
                                   THEN NULLIF(trim(v_item->>'lugar_trabajo'),'')
                                   ELSE lugar_trabajo END,
              convenio = CASE WHEN v_item ? 'convenio'
                              THEN NULLIF(trim(v_item->>'convenio'),'')
                              ELSE convenio END,
              sueldo_bruto_base = CASE WHEN v_item ? 'sueldo_bruto_base'
                                       THEN NULLIF(v_item->>'sueldo_bruto_base','')::numeric
                                       ELSE sueldo_bruto_base END,
              dias_vacaciones_anuales = CASE WHEN v_item ? 'dias_vacaciones_anuales'
                                             THEN NULLIF(v_item->>'dias_vacaciones_anuales','')::int
                                             ELSE dias_vacaciones_anuales END,
              banco = CASE WHEN v_item ? 'banco'
                           THEN NULLIF(trim(v_item->>'banco'),'')
                           ELSE banco END,
              cbu = CASE WHEN v_item ? 'cbu'
                         THEN NULLIF(trim(v_item->>'cbu'),'')
                         ELSE cbu END,
              alias_cbu = CASE WHEN v_item ? 'alias_cbu'
                               THEN NULLIF(trim(v_item->>'alias_cbu'),'')
                               ELSE alias_cbu END,
              forma_cobro = CASE WHEN v_item ? 'forma_cobro'
                                 THEN NULLIF(trim(v_item->>'forma_cobro'),'')
                                 ELSE forma_cobro END,
              notas = CASE WHEN v_item ? 'notas'
                           THEN NULLIF(trim(v_item->>'notas'),'')
                           ELSE notas END,
              activo = CASE WHEN v_item ? 'activo'
                            THEN COALESCE((v_item->>'activo')::boolean, activo)
                            ELSE activo END
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

REVOKE EXECUTE ON FUNCTION public.rpc_admin_bulk_update_employees(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_bulk_update_employees(jsonb) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual):
--   DROP FUNCTION IF EXISTS public.rpc_admin_bulk_update_employees(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_admin_bulk_create_employees(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_admin_check_cuils_exist(text[]);
--   DROP FUNCTION IF EXISTS public.rpc_admin_get_employee_historial(uuid);
--   DROP FUNCTION IF EXISTS public.rpc_admin_delete_employee(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_admin_update_employee(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_admin_create_employee(jsonb);
--   DROP POLICY IF EXISTS employees_modify_owner_or_admin ON public.employees;
--   DROP POLICY IF EXISTS employees_select_owner_or_admin ON public.employees;
--   DROP TRIGGER IF EXISTS employees_audit_log_trg ON public.employees;
--   DROP TRIGGER IF EXISTS employees_set_updated_at ON public.employees;
--   DROP TABLE IF EXISTS public.employees;
-- ════════════════════════════════════════════════════════════════════
