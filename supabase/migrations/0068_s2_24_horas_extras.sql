-- ════════════════════════════════════════════════════════════════════
-- S2.24 — Gestión de horas extras
-- ════════════════════════════════════════════════════════════════════
-- Agrega valor_hora_extra a employees, crea la tabla horas_extras
-- (con total/periodo generados), triggers (updated_at + audit), RLS,
-- 5 RPCs de gestión, y EXTIENDE los RPCs de alta/edición de empleado
-- para persistir valor_hora_extra.
--
-- ── Notas / decisiones técnicas ───────────────────────────────────────
--  1. Funciones reutilizadas (verificadas en BD): set_updated_at(),
--     trg_audit_log() (0053), _admin_check_periodo_cerrado(date) (0064a).
--  2. RLS usa el helper is_owner_or_admin() (= owner|admin activo, lo
--     mismo que el EXISTS inline del brief).
--  3. RRHH es owner-only en la navegación; los RPCs permiten owner+admin
--     (como pidió el brief). En la práctica solo el owner llega al tab.
--  4. EXTENSIÓN de rpc_admin_create_employee / rpc_admin_update_employee:
--     el modal de empleado (sección Liquidación) suma el campo
--     valor_hora_extra; sin extender ambos RPCs no persistiría en alta ni
--     edición. Se reproducen TAL CUAL + el campo nuevo (patrón `?` para
--     no pisar en update).
-- ════════════════════════════════════════════════════════════════════

-- ── (1A) Columna valor_hora_extra en employees ───────────────────────
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS valor_hora_extra numeric(10,2) DEFAULT 0;

-- ── (1B) Tabla horas_extras ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.horas_extras (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  fecha date NOT NULL,
  cantidad_horas numeric(5,2) NOT NULL CHECK (cantidad_horas > 0),
  valor_hora numeric(10,2) NOT NULL CHECK (valor_hora >= 0),
  total numeric(12,2) GENERATED ALWAYS AS (cantidad_horas * valor_hora) STORED,
  descripcion text,
  periodo_mes integer GENERATED ALWAYS AS (EXTRACT(MONTH FROM fecha)::integer) STORED,
  periodo_anio integer GENERATED ALWAYS AS (EXTRACT(YEAR FROM fecha)::integer) STORED,
  liquidado boolean DEFAULT false,
  recibo_id uuid REFERENCES public.recibos(id) ON DELETE SET NULL,
  activo boolean DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS horas_extras_employee_idx ON public.horas_extras(employee_id);
CREATE INDEX IF NOT EXISTS horas_extras_periodo_idx  ON public.horas_extras(periodo_anio, periodo_mes);

-- ── (1C) Trigger updated_at ──────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_horas_extras_updated_at ON public.horas_extras;
CREATE TRIGGER trg_horas_extras_updated_at
  BEFORE UPDATE ON public.horas_extras
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── (1D) Audit log ───────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_audit_horas_extras ON public.horas_extras;
CREATE TRIGGER trg_audit_horas_extras
  AFTER INSERT OR UPDATE OR DELETE ON public.horas_extras
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit_log();

-- ── (1E) RLS (owner+admin vía helper) ────────────────────────────────
ALTER TABLE public.horas_extras ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "he_select" ON public.horas_extras;
CREATE POLICY "he_select" ON public.horas_extras FOR SELECT TO authenticated
  USING (public.is_owner_or_admin());
DROP POLICY IF EXISTS "he_insert" ON public.horas_extras;
CREATE POLICY "he_insert" ON public.horas_extras FOR INSERT TO authenticated
  WITH CHECK (public.is_owner_or_admin());
DROP POLICY IF EXISTS "he_update" ON public.horas_extras;
CREATE POLICY "he_update" ON public.horas_extras FOR UPDATE TO authenticated
  USING (public.is_owner_or_admin()) WITH CHECK (public.is_owner_or_admin());
DROP POLICY IF EXISTS "he_delete" ON public.horas_extras;
CREATE POLICY "he_delete" ON public.horas_extras FOR DELETE TO authenticated
  USING (public.is_owner_or_admin());

-- ── (1F) RPCs ────────────────────────────────────────────────────────

-- Listar hs extras (filtros opcionales: employee_id, periodo_mes/anio, liquidado)
CREATE OR REPLACE FUNCTION public.rpc_rrhh_list_horas_extras(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role role_enum; v_active boolean;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;
  RETURN (
    SELECT jsonb_agg(row_to_json(r)) FROM (
      SELECT
        he.id, he.fecha, he.cantidad_horas, he.valor_hora, he.total,
        he.descripcion, he.periodo_mes, he.periodo_anio,
        he.liquidado, he.recibo_id, he.activo, he.employee_id,
        e.nombre AS empleado_nombre, e.categoria AS empleado_categoria,
        e.valor_hora_extra AS empleado_valor_hora_extra
      FROM horas_extras he
      JOIN employees e ON e.id = he.employee_id
      WHERE he.activo = true
        AND ((p_payload->>'employee_id') IS NULL OR he.employee_id = (p_payload->>'employee_id')::uuid)
        AND ((p_payload->>'periodo_mes') IS NULL OR he.periodo_mes = (p_payload->>'periodo_mes')::integer)
        AND ((p_payload->>'periodo_anio') IS NULL OR he.periodo_anio = (p_payload->>'periodo_anio')::integer)
        AND ((p_payload->>'liquidado') IS NULL OR he.liquidado = (p_payload->>'liquidado')::boolean)
      ORDER BY he.fecha DESC
    ) r
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.rpc_rrhh_list_horas_extras(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.rpc_rrhh_list_horas_extras(jsonb) TO authenticated;

-- Crear hora extra (valor_hora del payload, o fallback al del empleado)
CREATE OR REPLACE FUNCTION public.rpc_rrhh_create_hora_extra(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_id uuid; v_valor_hora numeric;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;

  IF _admin_check_periodo_cerrado(COALESCE((p_payload->>'fecha')::date, CURRENT_DATE)) THEN
    RAISE EXCEPTION 'Período contable cerrado.'
      USING ERRCODE='42501', HINT='periodo_cerrado'; END IF;

  IF NULLIF(p_payload->>'valor_hora','') IS NOT NULL THEN
    v_valor_hora := (p_payload->>'valor_hora')::numeric;
  ELSE
    SELECT valor_hora_extra INTO v_valor_hora FROM employees WHERE id = (p_payload->>'employee_id')::uuid;
  END IF;
  v_valor_hora := COALESCE(v_valor_hora, 0);

  INSERT INTO horas_extras (employee_id, fecha, cantidad_horas, valor_hora, descripcion, created_by)
  VALUES (
    (p_payload->>'employee_id')::uuid,
    (p_payload->>'fecha')::date,
    (p_payload->>'cantidad_horas')::numeric,
    v_valor_hora,
    NULLIF(trim(p_payload->>'descripcion'),''),
    auth.uid()
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;
REVOKE EXECUTE ON FUNCTION public.rpc_rrhh_create_hora_extra(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.rpc_rrhh_create_hora_extra(jsonb) TO authenticated;

-- Soft delete (solo si NO está liquidada)
CREATE OR REPLACE FUNCTION public.rpc_rrhh_delete_hora_extra(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role role_enum; v_active boolean;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;

  UPDATE horas_extras SET activo = false
  WHERE id = (p_payload->>'id')::uuid AND liquidado = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se puede eliminar: no existe o ya fue liquidada.' USING ERRCODE='P0002'; END IF;

  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.rpc_rrhh_delete_hora_extra(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.rpc_rrhh_delete_hora_extra(jsonb) TO authenticated;

-- Reporte mensual agrupado por empleado
CREATE OR REPLACE FUNCTION public.rpc_rrhh_reporte_hs_extras(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role role_enum; v_active boolean;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;
  RETURN (
    SELECT jsonb_agg(row_to_json(r)) FROM (
      SELECT
        e.id AS employee_id, e.nombre AS empleado_nombre, e.categoria, e.valor_hora_extra,
        COUNT(he.id) AS cantidad_registros,
        SUM(he.cantidad_horas) AS total_horas,
        SUM(he.total) AS total_pesos,
        SUM(CASE WHEN he.liquidado THEN he.total ELSE 0 END) AS total_liquidado,
        SUM(CASE WHEN NOT he.liquidado THEN he.total ELSE 0 END) AS total_pendiente,
        jsonb_agg(jsonb_build_object(
          'id', he.id, 'fecha', he.fecha, 'cantidad_horas', he.cantidad_horas,
          'valor_hora', he.valor_hora, 'total', he.total,
          'descripcion', he.descripcion, 'liquidado', he.liquidado
        ) ORDER BY he.fecha) AS detalle
      FROM employees e
      JOIN horas_extras he ON he.employee_id = e.id
      WHERE he.activo = true
        AND he.periodo_mes = (p_payload->>'periodo_mes')::integer
        AND he.periodo_anio = (p_payload->>'periodo_anio')::integer
      GROUP BY e.id, e.nombre, e.categoria, e.valor_hora_extra
      ORDER BY e.nombre
    ) r
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.rpc_rrhh_reporte_hs_extras(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.rpc_rrhh_reporte_hs_extras(jsonb) TO authenticated;

-- Actualizar valor_hora_extra del empleado (quick edit)
CREATE OR REPLACE FUNCTION public.rpc_rrhh_update_valor_hora(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role role_enum; v_active boolean;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;

  UPDATE employees
  SET valor_hora_extra = COALESCE((p_payload->>'valor_hora_extra')::numeric, 0)
  WHERE id = (p_payload->>'employee_id')::uuid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Empleado no encontrado.' USING ERRCODE='P0002'; END IF;

  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.rpc_rrhh_update_valor_hora(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.rpc_rrhh_update_valor_hora(jsonb) TO authenticated;

-- ── (1G) EXTENSIÓN de los RPCs de empleado (persistir valor_hora_extra) ─
-- Reproducción fiel de los actuales + el campo nuevo.

CREATE OR REPLACE FUNCTION public.rpc_admin_create_employee(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
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
      nombre, cuil, fecha_nacimiento, email, telefono,
      direccion, ciudad, provincia, codigo_postal,
      fecha_ingreso, categoria, modalidad, tipo_contratacion,
      lugar_trabajo, convenio,
      sueldo_bruto_base, dias_vacaciones_anuales,
      banco, cbu, alias_cbu, forma_cobro,
      notas, valor_hora_extra, created_by
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
      COALESCE(NULLIF(p_payload->>'valor_hora_extra','')::numeric, 0),
      auth.uid()
    ) RETURNING id INTO v_employee_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Ya existe otro empleado con ese CUIL' USING ERRCODE='23505', HINT='duplicate_cuil';
  END;

  RETURN jsonb_build_object('employee_id', v_employee_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_admin_update_employee(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum; v_active boolean;
  v_id uuid := NULLIF(p_payload->>'id','')::uuid;
  v_current_cuil text; v_new_cuil text;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'id requerido' USING ERRCODE='22023'; END IF;

  SELECT cuil INTO v_current_cuil FROM public.employees WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Empleado no existe' USING ERRCODE='22023'; END IF;

  IF p_payload ? 'cuil' THEN
    v_new_cuil := NULLIF(trim(p_payload->>'cuil'),'');
    IF v_new_cuil IS DISTINCT FROM v_current_cuil THEN
      RAISE EXCEPTION 'El CUIL no se puede modificar. Para corregir, dá de baja este empleado y creá uno nuevo.'
        USING ERRCODE='42501', HINT='cuil_immutable';
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
      RAISE EXCEPTION 'Ya existe otro empleado con ese CUIL' USING ERRCODE='23505', HINT='duplicate_cuil';
  END;

  RETURN jsonb_build_object('employee_id', v_id, 'updated', true);
END;
$function$;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual):
--   DROP TABLE IF EXISTS public.horas_extras CASCADE;
--   DROP FUNCTION IF EXISTS public.rpc_rrhh_list_horas_extras(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_rrhh_create_hora_extra(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_rrhh_delete_hora_extra(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_rrhh_reporte_hs_extras(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_rrhh_update_valor_hora(jsonb);
--   ALTER TABLE public.employees DROP COLUMN IF EXISTS valor_hora_extra;
--   -- (los RPCs rpc_admin_*_employee extendidos quedan; reaplicar versión
--   --  previa si se quiere revertir el extend)
-- ════════════════════════════════════════════════════════════════════
