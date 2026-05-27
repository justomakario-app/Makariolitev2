-- ════════════════════════════════════════════════════════════════════
-- ADMIN MODULE — Recibos de sueldo + Company Settings (S2.12)
-- ════════════════════════════════════════════════════════════════════
-- 1) Tabla company_settings (singleton, datos del empleador para PDFs).
-- 2) Tabla recibos (adelanto/quincena/sueldo) con snapshot del
--    empleado al momento de la emision + items como JSONB.
-- 3) 7 RPCs nuevos: 2 para company_settings + 5 para recibos.
-- 4) Update de rpc_admin_delete_employee: remueve TODO de S2.11 ya
--    que ahora existe la tabla recibos. FK ON DELETE SET NULL cubre
--    el huerfano: si se borra un empleado, los recibos historicos
--    conservan empleado_cuil/empleado_nombre como snapshot.
-- 5) Audit log heredado: triggers AFTER ... EXECUTE trg_audit_log()
--    parametrizado (S2.0). Opcion B confirmada en pre-flight.
-- 6) Cero modificacion de produccion: tablas nuevas son aditivas.
--    employees.sueldo_bruto_base se referencia solo como
--    autocompletado desde frontend (snapshot en recibos.sueldo_basico).
-- ════════════════════════════════════════════════════════════════════

SET search_path = public;

-- ════════════════════════════════════════════════════════════════════
-- (1) TABLA company_settings (singleton)
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.company_settings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  razon_social  text NOT NULL DEFAULT 'MACARIO',
  cuit          text,
  domicilio     text,
  ciudad        text,
  provincia     text,
  codigo_postal text,
  telefono      text,
  email         text,
  notas         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES public.profiles(id)
);

-- Singleton enforcement: solo 1 fila permitida en toda la tabla.
CREATE UNIQUE INDEX IF NOT EXISTS company_settings_singleton_idx
  ON public.company_settings ((true));

-- Triggers
DROP TRIGGER IF EXISTS company_settings_set_updated_at ON public.company_settings;
CREATE TRIGGER company_settings_set_updated_at
  BEFORE UPDATE ON public.company_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS company_settings_audit_log_trg ON public.company_settings;
CREATE TRIGGER company_settings_audit_log_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.company_settings
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit_log();

-- INSERT inicial (placeholder; Noe edita despues desde la UI).
-- Va antes de ENABLE RLS para no depender de bypass.
INSERT INTO public.company_settings (razon_social)
  SELECT 'MACARIO'
  WHERE NOT EXISTS (SELECT 1 FROM public.company_settings);

-- RLS
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_settings_select_owner_admin ON public.company_settings;
CREATE POLICY company_settings_select_owner_admin
  ON public.company_settings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
       WHERE id = auth.uid()
         AND active = true
         AND role IN ('owner','admin')
    )
  );

DROP POLICY IF EXISTS company_settings_update_owner_admin ON public.company_settings;
CREATE POLICY company_settings_update_owner_admin
  ON public.company_settings
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
       WHERE id = auth.uid()
         AND active = true
         AND role IN ('owner','admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
       WHERE id = auth.uid()
         AND active = true
         AND role IN ('owner','admin')
    )
  );

-- NO INSERT/DELETE policies: la fila se crea aca y nunca se borra.

COMMENT ON TABLE public.company_settings IS
  'S2.12 — Datos del empleador (singleton). Editable solo por owner/admin.';

-- ════════════════════════════════════════════════════════════════════
-- (2) TABLA recibos
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.recibos (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id            uuid REFERENCES public.employees(id) ON DELETE SET NULL,

  -- Snapshot del empleado al momento del recibo (inmutable post-alta)
  empleado_cuil          text NOT NULL,
  empleado_nombre        text NOT NULL,
  empleado_categoria     text,
  empleado_fecha_ingreso date,

  -- Tipo y periodo
  tipo                   text NOT NULL CHECK (tipo IN ('adelanto','quincena','sueldo')),
  periodo_desde          date NOT NULL,
  periodo_hasta          date NOT NULL,
  fecha_pago             date NOT NULL DEFAULT CURRENT_DATE,

  -- Snapshot del sueldo basico al momento del recibo
  sueldo_basico          numeric(14,2) NOT NULL CHECK (sueldo_basico >= 0),

  -- Items detallados (JSONB array de {concepto, cantidad, valor_unitario, subtotal, tipo})
  items                  jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Total = sum(items.subtotal). Frontend calcula, BD valida.
  total                  numeric(14,2) NOT NULL,

  -- Estado y metadata
  estado                 text NOT NULL DEFAULT 'emitido'
                           CHECK (estado IN ('emitido','anulado')),
  notas                  text,
  pdf_generado_at        timestamptz,

  -- Auditoria
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid REFERENCES public.profiles(id),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  -- Constraints adicionales
  CONSTRAINT recibos_periodo_check CHECK (periodo_hasta >= periodo_desde),
  CONSTRAINT recibos_items_is_array CHECK (jsonb_typeof(items) = 'array')
);

-- Indexes
CREATE INDEX IF NOT EXISTS recibos_employee_id_idx
  ON public.recibos (employee_id);

CREATE INDEX IF NOT EXISTS recibos_periodo_desde_idx
  ON public.recibos (periodo_desde DESC);

CREATE INDEX IF NOT EXISTS recibos_tipo_idx
  ON public.recibos (tipo);

CREATE INDEX IF NOT EXISTS recibos_estado_anulado_idx
  ON public.recibos (estado) WHERE estado = 'anulado';

CREATE INDEX IF NOT EXISTS recibos_created_at_idx
  ON public.recibos (created_at DESC);

-- Triggers
DROP TRIGGER IF EXISTS recibos_set_updated_at ON public.recibos;
CREATE TRIGGER recibos_set_updated_at
  BEFORE UPDATE ON public.recibos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS recibos_audit_log_trg ON public.recibos;
CREATE TRIGGER recibos_audit_log_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.recibos
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit_log();

-- RLS
ALTER TABLE public.recibos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recibos_select_owner_admin ON public.recibos;
CREATE POLICY recibos_select_owner_admin
  ON public.recibos
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
       WHERE id = auth.uid()
         AND active = true
         AND role IN ('owner','admin')
    )
  );

DROP POLICY IF EXISTS recibos_insert_owner_admin ON public.recibos;
CREATE POLICY recibos_insert_owner_admin
  ON public.recibos
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
       WHERE id = auth.uid()
         AND active = true
         AND role IN ('owner','admin')
    )
  );

DROP POLICY IF EXISTS recibos_update_owner_admin ON public.recibos;
CREATE POLICY recibos_update_owner_admin
  ON public.recibos
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
       WHERE id = auth.uid()
         AND active = true
         AND role IN ('owner','admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
       WHERE id = auth.uid()
         AND active = true
         AND role IN ('owner','admin')
    )
  );

DROP POLICY IF EXISTS recibos_delete_owner_admin ON public.recibos;
CREATE POLICY recibos_delete_owner_admin
  ON public.recibos
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
       WHERE id = auth.uid()
         AND active = true
         AND role IN ('owner','admin')
    )
  );

COMMENT ON TABLE public.recibos IS
  'S2.12 — Recibos de sueldo (adelanto/quincena/sueldo). Snapshot inmutable de empleado + items JSONB editables.';

-- ════════════════════════════════════════════════════════════════════
-- (3) UPDATE rpc_admin_delete_employee — remover TODO S2.12
-- ════════════════════════════════════════════════════════════════════
-- Reemplaza el cuerpo de la funcion sin el bloque TODO de S2.11.
-- Comportamiento identico (delete fisico). FK ON DELETE SET NULL en
-- recibos.employee_id se encarga del huerfano: el recibo conserva
-- snapshot empleado_cuil/empleado_nombre y queda como historico.
CREATE OR REPLACE FUNCTION public.rpc_admin_delete_employee(p_payload jsonb)
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

  IF v_id IS NULL THEN RAISE EXCEPTION 'id requerido' USING ERRCODE='22023'; END IF;

  -- Delete fisico. FK recibos.employee_id ON DELETE SET NULL preserva
  -- los recibos historicos (snapshot empleado_cuil/empleado_nombre).
  DELETE FROM public.employees WHERE id = v_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Empleado no existe' USING ERRCODE='22023';
  END IF;

  RETURN jsonb_build_object('employee_id', v_id, 'deleted', true);
END;
$$;

COMMENT ON FUNCTION public.rpc_admin_delete_employee(jsonb) IS
  'S2.11 + S2.12 — Delete fisico. FK ON DELETE SET NULL en recibos cubre el huerfano.';

-- ════════════════════════════════════════════════════════════════════
-- (4) RPC rpc_admin_get_company_settings()
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rpc_admin_get_company_settings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_row public.company_settings%ROWTYPE;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  SELECT * INTO v_row FROM public.company_settings LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Configuracion de empresa no inicializada'
      USING ERRCODE='22023', HINT='not_initialized';
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- (5) RPC rpc_admin_update_company_settings(jsonb)
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rpc_admin_update_company_settings(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_id uuid;
  v_row public.company_settings%ROWTYPE;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  SELECT id INTO v_id FROM public.company_settings LIMIT 1;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Configuracion de empresa no inicializada'
      USING ERRCODE='22023', HINT='not_initialized';
  END IF;

  UPDATE public.company_settings SET
    razon_social  = CASE WHEN p_payload ? 'razon_social'
                         THEN COALESCE(NULLIF(trim(p_payload->>'razon_social'),''), razon_social)
                         ELSE razon_social END,
    cuit          = CASE WHEN p_payload ? 'cuit'
                         THEN NULLIF(trim(p_payload->>'cuit'),'')
                         ELSE cuit END,
    domicilio     = CASE WHEN p_payload ? 'domicilio'
                         THEN NULLIF(trim(p_payload->>'domicilio'),'')
                         ELSE domicilio END,
    ciudad        = CASE WHEN p_payload ? 'ciudad'
                         THEN NULLIF(trim(p_payload->>'ciudad'),'')
                         ELSE ciudad END,
    provincia     = CASE WHEN p_payload ? 'provincia'
                         THEN NULLIF(trim(p_payload->>'provincia'),'')
                         ELSE provincia END,
    codigo_postal = CASE WHEN p_payload ? 'codigo_postal'
                         THEN NULLIF(trim(p_payload->>'codigo_postal'),'')
                         ELSE codigo_postal END,
    telefono      = CASE WHEN p_payload ? 'telefono'
                         THEN NULLIF(trim(p_payload->>'telefono'),'')
                         ELSE telefono END,
    email         = CASE WHEN p_payload ? 'email'
                         THEN NULLIF(trim(p_payload->>'email'),'')
                         ELSE email END,
    notas         = CASE WHEN p_payload ? 'notas'
                         THEN NULLIF(trim(p_payload->>'notas'),'')
                         ELSE notas END,
    updated_by    = auth.uid()
  WHERE id = v_id
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- (6) RPC rpc_admin_create_recibo(jsonb)
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rpc_admin_create_recibo(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_employee public.employees%ROWTYPE;
  v_employee_id uuid := NULLIF(p_payload->>'employee_id','')::uuid;
  v_tipo text := NULLIF(trim(p_payload->>'tipo'),'');
  v_items jsonb := COALESCE(p_payload->'items', '[]'::jsonb);
  v_total numeric(14,2);
  v_recibo_id uuid;
  v_periodo_desde date;
  v_periodo_hasta date;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'employee_id requerido' USING ERRCODE='22023', HINT='employee_required'; END IF;
  IF v_tipo NOT IN ('adelanto','quincena','sueldo') THEN
    RAISE EXCEPTION 'Tipo invalido (adelanto/quincena/sueldo)' USING ERRCODE='22023', HINT='invalid_tipo'; END IF;
  IF jsonb_typeof(v_items) <> 'array' THEN
    RAISE EXCEPTION 'items debe ser un array' USING ERRCODE='22023', HINT='items_array'; END IF;

  SELECT * INTO v_employee FROM public.employees WHERE id = v_employee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Empleado no existe' USING ERRCODE='22023', HINT='employee_not_found'; END IF;

  v_periodo_desde := NULLIF(p_payload->>'periodo_desde','')::date;
  v_periodo_hasta := NULLIF(p_payload->>'periodo_hasta','')::date;
  IF v_periodo_desde IS NULL OR v_periodo_hasta IS NULL THEN
    RAISE EXCEPTION 'periodo_desde y periodo_hasta requeridos' USING ERRCODE='22023', HINT='periodo_required'; END IF;

  -- Total: si viene en payload usar ese, si no calcular del array
  v_total := COALESCE(
    NULLIF(p_payload->>'total','')::numeric,
    (SELECT COALESCE(SUM((item->>'subtotal')::numeric), 0)
       FROM jsonb_array_elements(v_items) AS item)
  );

  INSERT INTO public.recibos (
    employee_id, empleado_cuil, empleado_nombre,
    empleado_categoria, empleado_fecha_ingreso,
    tipo, periodo_desde, periodo_hasta, fecha_pago,
    sueldo_basico, items, total, notas, created_by
  ) VALUES (
    v_employee_id,
    COALESCE(v_employee.cuil, ''),
    v_employee.nombre,
    v_employee.categoria,
    v_employee.fecha_ingreso,
    v_tipo,
    v_periodo_desde,
    v_periodo_hasta,
    COALESCE(NULLIF(p_payload->>'fecha_pago','')::date, CURRENT_DATE),
    COALESCE(NULLIF(p_payload->>'sueldo_basico','')::numeric, v_employee.sueldo_bruto_base, 0),
    v_items,
    v_total,
    NULLIF(trim(p_payload->>'notas'),''),
    auth.uid()
  ) RETURNING id INTO v_recibo_id;

  RETURN jsonb_build_object('recibo_id', v_recibo_id, 'total', v_total);
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- (7) RPC rpc_admin_update_recibo(jsonb)
-- ════════════════════════════════════════════════════════════════════
-- Solo permite editar: items, fecha_pago, notas, pdf_generado_at.
-- NO permite cambiar employee_id, tipo, periodo, sueldo_basico
-- (snapshot inmutable). Total se recalcula si cambian items.
CREATE OR REPLACE FUNCTION public.rpc_admin_update_recibo(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_id uuid := NULLIF(p_payload->>'id','')::uuid;
  v_estado_actual text;
  v_items jsonb;
  v_total numeric(14,2);
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'id requerido' USING ERRCODE='22023'; END IF;

  SELECT estado, items INTO v_estado_actual, v_items
    FROM public.recibos WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recibo no existe' USING ERRCODE='22023', HINT='not_found'; END IF;
  IF v_estado_actual = 'anulado' THEN
    RAISE EXCEPTION 'No se puede editar un recibo anulado'
      USING ERRCODE='42501', HINT='recibo_anulado'; END IF;

  -- Si vienen items en payload, usarlos; si no, mantener los actuales
  IF p_payload ? 'items' THEN
    v_items := COALESCE(p_payload->'items', '[]'::jsonb);
    IF jsonb_typeof(v_items) <> 'array' THEN
      RAISE EXCEPTION 'items debe ser un array' USING ERRCODE='22023', HINT='items_array'; END IF;
  END IF;

  -- Total recalcula si vienen items, o si viene total explicito
  v_total := COALESCE(
    NULLIF(p_payload->>'total','')::numeric,
    (SELECT COALESCE(SUM((item->>'subtotal')::numeric), 0)
       FROM jsonb_array_elements(v_items) AS item)
  );

  UPDATE public.recibos SET
    items           = v_items,
    total           = v_total,
    fecha_pago      = CASE WHEN p_payload ? 'fecha_pago'
                           THEN NULLIF(p_payload->>'fecha_pago','')::date
                           ELSE fecha_pago END,
    notas           = CASE WHEN p_payload ? 'notas'
                           THEN NULLIF(trim(p_payload->>'notas'),'')
                           ELSE notas END,
    pdf_generado_at = CASE WHEN p_payload ? 'pdf_generado_at'
                           THEN NULLIF(p_payload->>'pdf_generado_at','')::timestamptz
                           ELSE pdf_generado_at END
  WHERE id = v_id;

  RETURN jsonb_build_object('recibo_id', v_id, 'updated', true, 'total', v_total);
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- (8) RPC rpc_admin_anular_recibo(jsonb)
-- ════════════════════════════════════════════════════════════════════
-- Soft delete: set estado='anulado'. Preserva audit trail (recibo
-- impreso ya entregado al empleado, no se puede borrar de la realidad).
CREATE OR REPLACE FUNCTION public.rpc_admin_anular_recibo(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_id uuid := NULLIF(p_payload->>'id','')::uuid;
  v_motivo text := NULLIF(trim(p_payload->>'motivo'),'');
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'id requerido' USING ERRCODE='22023'; END IF;

  UPDATE public.recibos SET
    estado = 'anulado',
    notas  = COALESCE(v_motivo, notas)
  WHERE id = v_id AND estado = 'emitido';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recibo no existe o ya esta anulado'
      USING ERRCODE='22023', HINT='not_found_or_already_anulado'; END IF;

  RETURN jsonb_build_object('recibo_id', v_id, 'anulado', true);
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- (9) RPC rpc_admin_delete_recibo(jsonb)
-- ════════════════════════════════════════════════════════════════════
-- Delete fisico (caso edge: recibo cargado con error). Prefiere anular.
CREATE OR REPLACE FUNCTION public.rpc_admin_delete_recibo(p_payload jsonb)
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

  DELETE FROM public.recibos WHERE id = v_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recibo no existe' USING ERRCODE='22023', HINT='not_found'; END IF;

  RETURN jsonb_build_object('recibo_id', v_id, 'deleted', true);
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- (10) RPC rpc_admin_list_recibos_by_period(date, date, text)
-- ════════════════════════════════════════════════════════════════════
-- Para boton "Generar PDFs del mes" en recibos-tab. Filtra por
-- estado='emitido' (anulados NO entran al lote).
CREATE OR REPLACE FUNCTION public.rpc_admin_list_recibos_by_period(
  p_desde date,
  p_hasta date,
  p_tipo  text DEFAULT NULL
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

  IF p_desde IS NULL OR p_hasta IS NULL THEN
    RAISE EXCEPTION 'Rango de fechas requerido' USING ERRCODE='22023', HINT='period_required'; END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.fecha_pago, r.empleado_nombre), '[]'::jsonb)
    INTO v_result
    FROM public.recibos r
   WHERE r.periodo_desde >= p_desde
     AND r.periodo_hasta <= p_hasta
     AND r.estado = 'emitido'
     AND (p_tipo IS NULL OR r.tipo = p_tipo);

  RETURN v_result;
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- (11) REVOKE EXECUTE FROM anon, public + GRANT a authenticated
--      (alineado con patron S2.11 para evitar warnings en advisors:
--       anon_security_definer_function_executable).
-- ════════════════════════════════════════════════════════════════════
REVOKE EXECUTE ON FUNCTION public.rpc_admin_get_company_settings()                          FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_update_company_settings(jsonb)                  FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_create_recibo(jsonb)                            FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_update_recibo(jsonb)                            FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_anular_recibo(jsonb)                            FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_delete_recibo(jsonb)                            FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_list_recibos_by_period(date, date, text)        FROM anon, public;

GRANT EXECUTE ON FUNCTION public.rpc_admin_get_company_settings()                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_update_company_settings(jsonb)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_create_recibo(jsonb)                            TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_update_recibo(jsonb)                            TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_anular_recibo(jsonb)                            TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_delete_recibo(jsonb)                            TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_list_recibos_by_period(date, date, text)        TO authenticated;
