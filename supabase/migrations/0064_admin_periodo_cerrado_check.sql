-- ════════════════════════════════════════════════════════════════════
-- Fase 8 etapa 1.5 — Patch 17 RPCs con check de período cerrado
-- ════════════════════════════════════════════════════════════════════
-- Re-emite los 17 RPCs existentes agregando un bloque de validacion
-- al inicio (despues del auth gate, antes de los INSERT/UPDATE/DELETE)
-- que invoca _admin_check_periodo_cerrado(date) del helper de 0063.
--
-- PATTERNS:
--   A — fecha en payload directo (create/update con fecha)
--   B — lookup fecha del registro (delete/anular sin fecha en payload)
--   C — doble fecha (checks issued/received con fecha_emision +
--       fecha_cobro opcional)
--   D — change_check_status (valida fecha_cambio segun new_status)
--
-- Cero cambio de logica de negocio. Solo se inserta el bloque al
-- inicio. Cualquier RPC en periodo abierto sigue funcionando igual.
--
-- IMPORTANTE: si la migration 0063 no esta aplicada, esta migration
-- falla porque _admin_check_periodo_cerrado no existe. Confirmar
-- orden de aplicacion.
-- ════════════════════════════════════════════════════════════════════

SET search_path = public;

-- ════════════════════════════════════════════════════════════════════
-- EXPENSES (3 RPCs)
-- ════════════════════════════════════════════════════════════════════

-- (1) PATTERN A: rpc_admin_create_expense
CREATE OR REPLACE FUNCTION public.rpc_admin_create_expense(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_expense_id uuid;
  v_movement_id uuid := NULL;
  v_credit_id uuid;
  v_new_saldo numeric;
  v_supplier_id uuid := NULLIF(p_payload->>'supplier_id', '')::uuid;
  v_medio_pago text := p_payload->>'medio_pago';
  v_monto numeric := (p_payload->>'monto_total')::numeric;
  v_concepto text := p_payload->>'concepto';
  v_tipo_comprobante text := NULLIF(trim(p_payload->>'tipo_comprobante'), '');
  v_signo int;
  v_generate_movement boolean;
  v_explicit jsonb;
  v_items jsonb := COALESCE(p_payload->'items', '[]'::jsonb);
  v_fecha_check date := COALESCE((p_payload->>'fecha')::date, current_date);
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  -- Fase 8: check periodo cerrado
  IF public._admin_check_periodo_cerrado(v_fecha_check) THEN
    RAISE EXCEPTION 'Periodo contable cerrado para esa fecha. Solicitar reapertura al owner.'
      USING ERRCODE='42501', HINT='periodo_cerrado'; END IF;

  IF jsonb_typeof(v_items) <> 'array' THEN
    RAISE EXCEPTION 'items debe ser un array jsonb' USING ERRCODE='22023', HINT='items_invalid'; END IF;

  v_signo := CASE WHEN v_tipo_comprobante = 'nota_credito' THEN -1 ELSE 1 END;
  v_explicit := p_payload->'generate_supplier_movement';
  IF v_explicit IS NOT NULL AND v_explicit::text <> 'null' THEN
    v_generate_movement := (p_payload->>'generate_supplier_movement')::boolean;
  ELSE
    v_generate_movement := CASE v_medio_pago WHEN 'efectivo' THEN false WHEN 'transferencia' THEN false ELSE true END;
  END IF;

  INSERT INTO public.expenses (
    fecha, supplier_id, concepto, monto_total, moneda, iva_discriminado,
    categoria, medio_pago, comprobante_url, ocr_raw_json, confirmed_by_human,
    notas, created_by, tipo_comprobante, clase_comprobante, condicion_comprobante,
    punto_venta, numero_comprobante, fecha_vencimiento, cae, condicion_pago, concepto_libre,
    razon_social_proveedor, condicion_iva_proveedor, subtotal_neto, iva_pct, iva_monto,
    otros_tributos_desc, otros_tributos_pct, otros_tributos_monto, items, comprobante_mime, comprobante_size_bytes
  ) VALUES (
    v_fecha_check, v_supplier_id, v_concepto, v_monto,
    COALESCE(p_payload->>'moneda', 'ARS'), NULLIF(p_payload->>'iva_discriminado', '')::numeric,
    p_payload->>'categoria', v_medio_pago,
    NULLIF(trim(p_payload->>'comprobante_url'), ''), p_payload->'ocr_raw_json',
    COALESCE((p_payload->>'confirmed_by_human')::boolean, false),
    NULLIF(trim(p_payload->>'notas'), ''), auth.uid(),
    v_tipo_comprobante, NULLIF(trim(p_payload->>'clase_comprobante'), ''),
    NULLIF(trim(p_payload->>'condicion_comprobante'), ''),
    NULLIF(trim(p_payload->>'punto_venta'), ''), NULLIF(trim(p_payload->>'numero_comprobante'), ''),
    NULLIF(p_payload->>'fecha_vencimiento', '')::date, NULLIF(trim(p_payload->>'cae'), ''),
    NULLIF(trim(p_payload->>'condicion_pago'), ''), NULLIF(trim(p_payload->>'concepto_libre'), ''),
    NULLIF(trim(p_payload->>'razon_social_proveedor'), ''), NULLIF(trim(p_payload->>'condicion_iva_proveedor'), ''),
    NULLIF(p_payload->>'subtotal_neto', '')::numeric, NULLIF(p_payload->>'iva_pct', '')::numeric,
    NULLIF(p_payload->>'iva_monto', '')::numeric, NULLIF(trim(p_payload->>'otros_tributos_desc'), ''),
    NULLIF(p_payload->>'otros_tributos_pct', '')::numeric, NULLIF(p_payload->>'otros_tributos_monto', '')::numeric,
    v_items, NULLIF(trim(p_payload->>'comprobante_mime'), ''),
    NULLIF(p_payload->>'comprobante_size_bytes', '')::int
  ) RETURNING id INTO v_expense_id;

  IF v_generate_movement AND v_supplier_id IS NOT NULL THEN
    SELECT id INTO v_credit_id FROM public.suppliers_credit WHERE supplier_id = v_supplier_id FOR UPDATE;
    IF v_credit_id IS NULL THEN
      INSERT INTO public.suppliers_credit (supplier_id) VALUES (v_supplier_id) RETURNING id INTO v_credit_id;
    END IF;
    INSERT INTO public.suppliers_credit_movements (
      supplier_credit_id, fecha, tipo, monto, concepto, expense_id, created_by
    ) VALUES (
      v_credit_id, v_fecha_check,
      CASE WHEN v_tipo_comprobante = 'nota_credito' THEN 'ajuste' ELSE 'compra' END,
      v_monto * v_signo, v_concepto, v_expense_id, auth.uid()
    ) RETURNING id INTO v_movement_id;
    UPDATE public.suppliers_credit SET saldo = saldo + (v_monto * v_signo)
      WHERE id = v_credit_id RETURNING saldo INTO v_new_saldo;
  END IF;

  RETURN jsonb_build_object('expense_id', v_expense_id, 'supplier_movement_id', v_movement_id,
    'nuevo_saldo_proveedor', v_new_saldo, 'generate_supplier_movement_used', v_generate_movement, 'movement_signo', v_signo);
END;
$$;

-- (2) PATTERN A + B mixto: rpc_admin_update_expense (valida fecha actual + nueva)
CREATE OR REPLACE FUNCTION public.rpc_admin_update_expense(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_id uuid := NULLIF(p_payload->>'id','')::uuid;
  v_concepto text; v_monto numeric; v_categoria text; v_medio_pago text; v_moneda text;
  v_items jsonb; v_new_tipo text; v_old_tipo text; v_old_monto numeric;
  v_fecha_actual date; v_fecha_nueva date;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'id requerido' USING ERRCODE='22023'; END IF;

  -- Fase 8: lookup fecha actual + validar
  SELECT fecha INTO v_fecha_actual FROM public.expenses WHERE id = v_id;
  IF v_fecha_actual IS NOT NULL AND public._admin_check_periodo_cerrado(v_fecha_actual) THEN
    RAISE EXCEPTION 'Periodo contable cerrado. No se puede modificar movimiento en periodo cerrado.'
      USING ERRCODE='42501', HINT='periodo_cerrado'; END IF;
  IF p_payload ? 'fecha' THEN
    v_fecha_nueva := NULLIF(p_payload->>'fecha','')::date;
    IF v_fecha_nueva IS NOT NULL AND public._admin_check_periodo_cerrado(v_fecha_nueva) THEN
      RAISE EXCEPTION 'Periodo contable cerrado para la nueva fecha.'
        USING ERRCODE='42501', HINT='periodo_cerrado'; END IF;
  END IF;

  IF p_payload ? 'concepto' THEN
    v_concepto := p_payload->>'concepto';
    IF v_concepto IS NULL OR length(trim(v_concepto)) < 1 OR length(v_concepto) > 500 THEN
      RAISE EXCEPTION 'concepto requerido (1-500 caracteres)' USING ERRCODE='22023'; END IF;
  END IF;
  IF p_payload ? 'monto_total' THEN
    v_monto := (p_payload->>'monto_total')::numeric;
    IF v_monto IS NULL OR v_monto <= 0 THEN RAISE EXCEPTION 'monto debe ser positivo' USING ERRCODE='22023'; END IF;
  END IF;
  IF p_payload ? 'categoria' THEN
    v_categoria := p_payload->>'categoria';
    IF v_categoria NOT IN ('materiales_insumos','fletes','logistica_flex','correo_encomiendas','gastos_fijos',
                           'honorarios','servicios','intereses_financiacion','sueldos','impuestos','otros') THEN
      RAISE EXCEPTION 'categoria invalida' USING ERRCODE='22023'; END IF;
  END IF;
  IF p_payload ? 'medio_pago' THEN
    v_medio_pago := p_payload->>'medio_pago';
    IF v_medio_pago NOT IN ('efectivo','transferencia','cheque','tarjeta','otro') THEN
      RAISE EXCEPTION 'medio_pago invalido' USING ERRCODE='22023'; END IF;
  END IF;
  IF p_payload ? 'moneda' THEN
    v_moneda := p_payload->>'moneda';
    IF v_moneda NOT IN ('ARS','USD') THEN RAISE EXCEPTION 'moneda invalida' USING ERRCODE='22023'; END IF;
  END IF;
  IF p_payload ? 'items' THEN
    v_items := p_payload->'items';
    IF jsonb_typeof(v_items) <> 'array' THEN
      RAISE EXCEPTION 'items debe ser un array jsonb' USING ERRCODE='22023', HINT='items_invalid'; END IF;
  END IF;

  SELECT tipo_comprobante, monto_total INTO v_old_tipo, v_old_monto FROM public.expenses WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Egreso no existe' USING ERRCODE='22023'; END IF;

  IF p_payload ? 'tipo_comprobante' THEN
    v_new_tipo := NULLIF(trim(p_payload->>'tipo_comprobante'), '');
    IF (v_old_tipo = 'nota_credito') <> (v_new_tipo = 'nota_credito') THEN
      RAISE WARNING 'Cambio de tipo_comprobante implica cambio de signo en movement asociado. El movement NO se recalcula automaticamente. Workaround: borrar y recrear el egreso.'
        USING HINT='movement_sign_change_not_recalculated';
    END IF;
  END IF;

  UPDATE public.expenses SET
    fecha = CASE WHEN p_payload ? 'fecha' THEN COALESCE((p_payload->>'fecha')::date, fecha) ELSE fecha END,
    supplier_id = CASE WHEN p_payload ? 'supplier_id' THEN NULLIF(p_payload->>'supplier_id','')::uuid ELSE supplier_id END,
    concepto = CASE WHEN p_payload ? 'concepto' THEN trim(v_concepto) ELSE concepto END,
    monto_total = CASE WHEN p_payload ? 'monto_total' THEN v_monto ELSE monto_total END,
    moneda = CASE WHEN p_payload ? 'moneda' THEN v_moneda ELSE moneda END,
    iva_discriminado = CASE WHEN p_payload ? 'iva_discriminado' THEN NULLIF(p_payload->>'iva_discriminado','')::numeric ELSE iva_discriminado END,
    categoria = CASE WHEN p_payload ? 'categoria' THEN v_categoria ELSE categoria END,
    medio_pago = CASE WHEN p_payload ? 'medio_pago' THEN v_medio_pago ELSE medio_pago END,
    notas = CASE WHEN p_payload ? 'notas' THEN NULLIF(trim(p_payload->>'notas'),'') ELSE notas END,
    activo = CASE WHEN p_payload ? 'activo' THEN COALESCE((p_payload->>'activo')::boolean, activo) ELSE activo END,
    tipo_comprobante = CASE WHEN p_payload ? 'tipo_comprobante' THEN NULLIF(trim(p_payload->>'tipo_comprobante'),'') ELSE tipo_comprobante END,
    clase_comprobante = CASE WHEN p_payload ? 'clase_comprobante' THEN NULLIF(trim(p_payload->>'clase_comprobante'),'') ELSE clase_comprobante END,
    condicion_comprobante = CASE WHEN p_payload ? 'condicion_comprobante' THEN NULLIF(trim(p_payload->>'condicion_comprobante'),'') ELSE condicion_comprobante END,
    punto_venta = CASE WHEN p_payload ? 'punto_venta' THEN NULLIF(trim(p_payload->>'punto_venta'),'') ELSE punto_venta END,
    numero_comprobante = CASE WHEN p_payload ? 'numero_comprobante' THEN NULLIF(trim(p_payload->>'numero_comprobante'),'') ELSE numero_comprobante END,
    fecha_vencimiento = CASE WHEN p_payload ? 'fecha_vencimiento' THEN NULLIF(p_payload->>'fecha_vencimiento','')::date ELSE fecha_vencimiento END,
    cae = CASE WHEN p_payload ? 'cae' THEN NULLIF(trim(p_payload->>'cae'),'') ELSE cae END,
    condicion_pago = CASE WHEN p_payload ? 'condicion_pago' THEN NULLIF(trim(p_payload->>'condicion_pago'),'') ELSE condicion_pago END,
    concepto_libre = CASE WHEN p_payload ? 'concepto_libre' THEN NULLIF(trim(p_payload->>'concepto_libre'),'') ELSE concepto_libre END,
    razon_social_proveedor = CASE WHEN p_payload ? 'razon_social_proveedor' THEN NULLIF(trim(p_payload->>'razon_social_proveedor'),'') ELSE razon_social_proveedor END,
    condicion_iva_proveedor = CASE WHEN p_payload ? 'condicion_iva_proveedor' THEN NULLIF(trim(p_payload->>'condicion_iva_proveedor'),'') ELSE condicion_iva_proveedor END,
    subtotal_neto = CASE WHEN p_payload ? 'subtotal_neto' THEN NULLIF(p_payload->>'subtotal_neto','')::numeric ELSE subtotal_neto END,
    iva_pct = CASE WHEN p_payload ? 'iva_pct' THEN NULLIF(p_payload->>'iva_pct','')::numeric ELSE iva_pct END,
    iva_monto = CASE WHEN p_payload ? 'iva_monto' THEN NULLIF(p_payload->>'iva_monto','')::numeric ELSE iva_monto END,
    otros_tributos_desc = CASE WHEN p_payload ? 'otros_tributos_desc' THEN NULLIF(trim(p_payload->>'otros_tributos_desc'),'') ELSE otros_tributos_desc END,
    otros_tributos_pct = CASE WHEN p_payload ? 'otros_tributos_pct' THEN NULLIF(p_payload->>'otros_tributos_pct','')::numeric ELSE otros_tributos_pct END,
    otros_tributos_monto = CASE WHEN p_payload ? 'otros_tributos_monto' THEN NULLIF(p_payload->>'otros_tributos_monto','')::numeric ELSE otros_tributos_monto END,
    items = CASE WHEN p_payload ? 'items' THEN v_items ELSE items END,
    comprobante_url = CASE WHEN p_payload ? 'comprobante_url' THEN NULLIF(trim(p_payload->>'comprobante_url'),'') ELSE comprobante_url END,
    comprobante_mime = CASE WHEN p_payload ? 'comprobante_mime' THEN NULLIF(trim(p_payload->>'comprobante_mime'),'') ELSE comprobante_mime END,
    comprobante_size_bytes = CASE WHEN p_payload ? 'comprobante_size_bytes' THEN NULLIF(p_payload->>'comprobante_size_bytes','')::int ELSE comprobante_size_bytes END
  WHERE id = v_id;

  RETURN jsonb_build_object('expense_id', v_id, 'updated', true);
END;
$$;

-- (3) PATTERN B: rpc_admin_delete_expense (lookup fecha)
CREATE OR REPLACE FUNCTION public.rpc_admin_delete_expense(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_id uuid := NULLIF(p_payload->>'id','')::uuid;
  v_n_movements int;
  v_fecha_actual date;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'id requerido' USING ERRCODE='22023'; END IF;

  -- Fase 8: lookup fecha + validar
  SELECT fecha INTO v_fecha_actual FROM public.expenses WHERE id = v_id;
  IF v_fecha_actual IS NOT NULL AND public._admin_check_periodo_cerrado(v_fecha_actual) THEN
    RAISE EXCEPTION 'Periodo contable cerrado. No se puede eliminar movimiento en periodo cerrado.'
      USING ERRCODE='42501', HINT='periodo_cerrado'; END IF;

  PERFORM 1 FROM public.expenses WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Egreso no existe' USING ERRCODE='22023'; END IF;
  SELECT count(*) INTO v_n_movements FROM public.suppliers_credit_movements WHERE expense_id = v_id;
  IF v_n_movements > 0 THEN
    RAISE EXCEPTION 'No se puede eliminar: este egreso tiene % movimiento(s) en cta cte asociado(s). Borra primero el movimiento o desactiva el egreso.',
      v_n_movements USING ERRCODE='42501', HINT='has_relations';
  END IF;
  DELETE FROM public.expenses WHERE id = v_id;
  RETURN jsonb_build_object('deleted', true, 'expense_id', v_id);
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- RECIBOS (4 RPCs)
-- ════════════════════════════════════════════════════════════════════

-- (4) PATTERN A: rpc_admin_create_recibo
CREATE OR REPLACE FUNCTION public.rpc_admin_create_recibo(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
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
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  -- Fase 8: check periodo cerrado sobre fecha_pago
  v_fecha_pago_check := COALESCE(NULLIF(p_payload->>'fecha_pago','')::date, CURRENT_DATE);
  IF public._admin_check_periodo_cerrado(v_fecha_pago_check) THEN
    RAISE EXCEPTION 'Periodo contable cerrado para esa fecha de pago.'
      USING ERRCODE='42501', HINT='periodo_cerrado'; END IF;

  IF v_employee_id IS NULL THEN RAISE EXCEPTION 'employee_id requerido' USING ERRCODE='22023', HINT='employee_required'; END IF;
  IF v_tipo NOT IN ('adelanto','quincena','sueldo') THEN
    RAISE EXCEPTION 'Tipo invalido (adelanto/quincena/sueldo)' USING ERRCODE='22023', HINT='invalid_tipo'; END IF;
  IF jsonb_typeof(v_items) <> 'array' THEN
    RAISE EXCEPTION 'items debe ser un array' USING ERRCODE='22023', HINT='items_array'; END IF;

  SELECT * INTO v_employee FROM public.employees WHERE id = v_employee_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Empleado no existe' USING ERRCODE='22023', HINT='employee_not_found'; END IF;

  v_periodo_desde := NULLIF(p_payload->>'periodo_desde','')::date;
  v_periodo_hasta := NULLIF(p_payload->>'periodo_hasta','')::date;
  IF v_periodo_desde IS NULL OR v_periodo_hasta IS NULL THEN
    RAISE EXCEPTION 'periodo_desde y periodo_hasta requeridos' USING ERRCODE='22023', HINT='periodo_required'; END IF;

  v_total := COALESCE(NULLIF(p_payload->>'total','')::numeric,
    (SELECT COALESCE(SUM((item->>'subtotal')::numeric), 0) FROM jsonb_array_elements(v_items) AS item));

  INSERT INTO public.recibos (
    employee_id, empleado_cuil, empleado_nombre, empleado_categoria, empleado_fecha_ingreso,
    tipo, periodo_desde, periodo_hasta, fecha_pago,
    sueldo_basico, items, total, notas, created_by
  ) VALUES (
    v_employee_id, COALESCE(v_employee.cuil, ''), v_employee.nombre,
    v_employee.categoria, v_employee.fecha_ingreso,
    v_tipo, v_periodo_desde, v_periodo_hasta, v_fecha_pago_check,
    COALESCE(NULLIF(p_payload->>'sueldo_basico','')::numeric, v_employee.sueldo_bruto_base, 0),
    v_items, v_total, NULLIF(trim(p_payload->>'notas'),''), auth.uid()
  ) RETURNING id INTO v_recibo_id;

  RETURN jsonb_build_object('recibo_id', v_recibo_id, 'total', v_total);
END;
$$;

-- (5) PATTERN A + B: rpc_admin_update_recibo (fecha actual + nueva)
CREATE OR REPLACE FUNCTION public.rpc_admin_update_recibo(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_id uuid := NULLIF(p_payload->>'id','')::uuid;
  v_estado_actual text; v_items jsonb; v_total numeric(14,2);
  v_fecha_actual date; v_fecha_nueva date;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'id requerido' USING ERRCODE='22023'; END IF;

  -- Fase 8: lookup fecha_pago actual + validar
  SELECT fecha_pago INTO v_fecha_actual FROM public.recibos WHERE id = v_id;
  IF v_fecha_actual IS NOT NULL AND public._admin_check_periodo_cerrado(v_fecha_actual) THEN
    RAISE EXCEPTION 'Periodo contable cerrado. No se puede modificar recibo en periodo cerrado.'
      USING ERRCODE='42501', HINT='periodo_cerrado'; END IF;
  IF p_payload ? 'fecha_pago' THEN
    v_fecha_nueva := NULLIF(p_payload->>'fecha_pago','')::date;
    IF v_fecha_nueva IS NOT NULL AND public._admin_check_periodo_cerrado(v_fecha_nueva) THEN
      RAISE EXCEPTION 'Periodo contable cerrado para la nueva fecha de pago.'
        USING ERRCODE='42501', HINT='periodo_cerrado'; END IF;
  END IF;

  SELECT estado, items INTO v_estado_actual, v_items FROM public.recibos WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recibo no existe' USING ERRCODE='22023', HINT='not_found'; END IF;
  IF v_estado_actual = 'anulado' THEN
    RAISE EXCEPTION 'No se puede editar un recibo anulado' USING ERRCODE='42501', HINT='recibo_anulado'; END IF;

  IF p_payload ? 'items' THEN
    v_items := COALESCE(p_payload->'items', '[]'::jsonb);
    IF jsonb_typeof(v_items) <> 'array' THEN
      RAISE EXCEPTION 'items debe ser un array' USING ERRCODE='22023', HINT='items_array'; END IF;
  END IF;

  v_total := COALESCE(NULLIF(p_payload->>'total','')::numeric,
    (SELECT COALESCE(SUM((item->>'subtotal')::numeric), 0) FROM jsonb_array_elements(v_items) AS item));

  UPDATE public.recibos SET
    items = v_items, total = v_total,
    fecha_pago = CASE WHEN p_payload ? 'fecha_pago' THEN NULLIF(p_payload->>'fecha_pago','')::date ELSE fecha_pago END,
    notas = CASE WHEN p_payload ? 'notas' THEN NULLIF(trim(p_payload->>'notas'),'') ELSE notas END,
    pdf_generado_at = CASE WHEN p_payload ? 'pdf_generado_at' THEN NULLIF(p_payload->>'pdf_generado_at','')::timestamptz ELSE pdf_generado_at END
  WHERE id = v_id;

  RETURN jsonb_build_object('recibo_id', v_id, 'updated', true, 'total', v_total);
END;
$$;

-- (6) PATTERN B: rpc_admin_anular_recibo (lookup fecha_pago)
CREATE OR REPLACE FUNCTION public.rpc_admin_anular_recibo(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_id uuid := NULLIF(p_payload->>'id','')::uuid;
  v_motivo text := NULLIF(trim(p_payload->>'motivo'),'');
  v_fecha_actual date;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'id requerido' USING ERRCODE='22023'; END IF;

  -- Fase 8: lookup fecha_pago + validar
  SELECT fecha_pago INTO v_fecha_actual FROM public.recibos WHERE id = v_id;
  IF v_fecha_actual IS NOT NULL AND public._admin_check_periodo_cerrado(v_fecha_actual) THEN
    RAISE EXCEPTION 'Periodo contable cerrado. No se puede anular recibo en periodo cerrado.'
      USING ERRCODE='42501', HINT='periodo_cerrado'; END IF;

  UPDATE public.recibos SET
    estado = 'anulado',
    notas  = COALESCE(v_motivo, notas)
  WHERE id = v_id AND estado = 'emitido';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recibo no existe o ya esta anulado' USING ERRCODE='22023', HINT='not_found_or_already_anulado'; END IF;

  RETURN jsonb_build_object('recibo_id', v_id, 'anulado', true);
END;
$$;

-- (7) PATTERN B: rpc_admin_delete_recibo (lookup fecha_pago)
CREATE OR REPLACE FUNCTION public.rpc_admin_delete_recibo(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_id uuid := NULLIF(p_payload->>'id','')::uuid;
  v_fecha_actual date;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'id requerido' USING ERRCODE='22023'; END IF;

  -- Fase 8: lookup fecha_pago + validar
  SELECT fecha_pago INTO v_fecha_actual FROM public.recibos WHERE id = v_id;
  IF v_fecha_actual IS NOT NULL AND public._admin_check_periodo_cerrado(v_fecha_actual) THEN
    RAISE EXCEPTION 'Periodo contable cerrado. No se puede eliminar recibo en periodo cerrado.'
      USING ERRCODE='42501', HINT='periodo_cerrado'; END IF;

  DELETE FROM public.recibos WHERE id = v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recibo no existe' USING ERRCODE='22023', HINT='not_found'; END IF;
  RETURN jsonb_build_object('recibo_id', v_id, 'deleted', true);
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- CHECKS ISSUED (3 RPCs) — PATTERN C: doble fecha
-- ════════════════════════════════════════════════════════════════════

-- (8) PATTERN C: rpc_admin_create_check (fecha_emision + fecha_cobro_estimada NO valida porque es proyeccion)
CREATE OR REPLACE FUNCTION public.rpc_admin_create_check(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_check_id uuid; v_movement_id uuid := NULL; v_credit_id uuid; v_new_saldo numeric;
  v_supplier_id uuid := NULLIF(p_payload->>'beneficiario_supplier_id', '')::uuid;
  v_monto numeric := (p_payload->>'monto')::numeric;
  v_concepto text := p_payload->>'concepto';
  v_generate_movement boolean := COALESCE((p_payload->>'generate_supplier_movement')::boolean, false);
  v_fecha_emision date := (p_payload->>'fecha_emision')::date;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  -- Fase 8: check fecha_emision en periodo cerrado
  IF v_fecha_emision IS NOT NULL AND public._admin_check_periodo_cerrado(v_fecha_emision) THEN
    RAISE EXCEPTION 'Periodo contable cerrado para esa fecha de emision.'
      USING ERRCODE='42501', HINT='periodo_cerrado'; END IF;

  INSERT INTO public.checks_issued (
    numero, banco, monto, fecha_emision, fecha_cobro_estimada,
    beneficiario_supplier_id, beneficiario_texto, estado, notas, created_by
  ) VALUES (
    p_payload->>'numero', p_payload->>'banco', v_monto,
    v_fecha_emision, NULLIF(p_payload->>'fecha_cobro_estimada', '')::date,
    v_supplier_id, NULLIF(trim(p_payload->>'beneficiario_texto'), ''),
    COALESCE(p_payload->>'estado', 'emitido'),
    NULLIF(trim(p_payload->>'notas'), ''), auth.uid()
  ) RETURNING id INTO v_check_id;

  IF v_generate_movement AND v_supplier_id IS NOT NULL THEN
    SELECT id INTO v_credit_id FROM public.suppliers_credit WHERE supplier_id = v_supplier_id FOR UPDATE;
    IF v_credit_id IS NULL THEN
      INSERT INTO public.suppliers_credit (supplier_id) VALUES (v_supplier_id) RETURNING id INTO v_credit_id;
    END IF;
    INSERT INTO public.suppliers_credit_movements (
      supplier_credit_id, fecha, tipo, monto, concepto, check_id, created_by
    ) VALUES (
      v_credit_id, v_fecha_emision, 'pago', v_monto,
      COALESCE(v_concepto, 'Pago con cheque ' || (p_payload->>'numero')),
      v_check_id, auth.uid()
    ) RETURNING id INTO v_movement_id;
    UPDATE public.suppliers_credit SET saldo = saldo - v_monto
      WHERE id = v_credit_id RETURNING saldo INTO v_new_saldo;
  END IF;

  RETURN jsonb_build_object('check_id', v_check_id, 'supplier_movement_id', v_movement_id, 'nuevo_saldo_proveedor', v_new_saldo);
END;
$$;

-- (9) PATTERN C: rpc_admin_update_check
CREATE OR REPLACE FUNCTION public.rpc_admin_update_check(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_check_id uuid := NULLIF(p_payload->>'check_id','')::uuid;
  v_current_status text;
  v_numero text := p_payload->>'numero';
  v_banco text := p_payload->>'banco';
  v_monto numeric;
  v_fecha_actual date; v_fecha_nueva date;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  IF v_check_id IS NULL THEN RAISE EXCEPTION 'check_id requerido' USING ERRCODE='22023'; END IF;

  -- Fase 8: lookup fecha_emision actual + validar
  SELECT fecha_emision INTO v_fecha_actual FROM public.checks_issued WHERE id = v_check_id;
  IF v_fecha_actual IS NOT NULL AND public._admin_check_periodo_cerrado(v_fecha_actual) THEN
    RAISE EXCEPTION 'Periodo contable cerrado. No se puede modificar cheque en periodo cerrado.'
      USING ERRCODE='42501', HINT='periodo_cerrado'; END IF;
  IF p_payload ? 'fecha_emision' THEN
    v_fecha_nueva := NULLIF(p_payload->>'fecha_emision','')::date;
    IF v_fecha_nueva IS NOT NULL AND public._admin_check_periodo_cerrado(v_fecha_nueva) THEN
      RAISE EXCEPTION 'Periodo contable cerrado para la nueva fecha de emision.'
        USING ERRCODE='42501', HINT='periodo_cerrado'; END IF;
  END IF;

  IF v_numero IS NULL OR length(trim(v_numero)) < 1 THEN RAISE EXCEPTION 'numero requerido' USING ERRCODE='22023'; END IF;
  IF v_banco IS NULL OR length(trim(v_banco)) < 1 THEN RAISE EXCEPTION 'banco requerido' USING ERRCODE='22023'; END IF;
  v_monto := (p_payload->>'monto')::numeric;
  IF v_monto IS NULL OR v_monto <= 0 THEN RAISE EXCEPTION 'monto debe ser positivo' USING ERRCODE='22023'; END IF;

  SELECT estado INTO v_current_status FROM public.checks_issued WHERE id = v_check_id FOR UPDATE;
  IF v_current_status IS NULL THEN RAISE EXCEPTION 'Cheque no existe' USING ERRCODE='22023'; END IF;
  IF v_current_status <> 'emitido' THEN
    RAISE EXCEPTION 'No se puede editar un cheque en estado %', v_current_status USING ERRCODE='42501', HINT='wrong_state';
  END IF;

  UPDATE public.checks_issued SET
    numero = v_numero, banco = v_banco, monto = v_monto,
    fecha_emision = (p_payload->>'fecha_emision')::date,
    fecha_cobro_estimada = NULLIF(p_payload->>'fecha_cobro_estimada','')::date,
    beneficiario_supplier_id = NULLIF(p_payload->>'beneficiario_supplier_id','')::uuid,
    beneficiario_texto = NULLIF(trim(p_payload->>'beneficiario_texto'),''),
    notas = NULLIF(trim(p_payload->>'notas'),'')
  WHERE id = v_check_id;

  RETURN jsonb_build_object('check_id', v_check_id, 'updated', true);
END;
$$;

-- (10) PATTERN B: rpc_admin_delete_check (lookup fecha_emision)
CREATE OR REPLACE FUNCTION public.rpc_admin_delete_check(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_check_id uuid := NULLIF(p_payload->>'check_id','')::uuid;
  v_current_status text; v_has_movements boolean;
  v_fecha_actual date;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  IF v_check_id IS NULL THEN RAISE EXCEPTION 'check_id requerido' USING ERRCODE='22023'; END IF;

  -- Fase 8: lookup fecha_emision + validar
  SELECT fecha_emision INTO v_fecha_actual FROM public.checks_issued WHERE id = v_check_id;
  IF v_fecha_actual IS NOT NULL AND public._admin_check_periodo_cerrado(v_fecha_actual) THEN
    RAISE EXCEPTION 'Periodo contable cerrado. No se puede eliminar cheque en periodo cerrado.'
      USING ERRCODE='42501', HINT='periodo_cerrado'; END IF;

  SELECT estado INTO v_current_status FROM public.checks_issued WHERE id = v_check_id FOR UPDATE;
  IF v_current_status IS NULL THEN RAISE EXCEPTION 'Cheque no existe' USING ERRCODE='22023'; END IF;
  IF v_current_status <> 'emitido' THEN
    RAISE EXCEPTION 'No se puede eliminar un cheque en estado %. Anulalo en cambio.', v_current_status
      USING ERRCODE='42501', HINT='wrong_state';
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.suppliers_credit_movements WHERE check_id = v_check_id) INTO v_has_movements;
  IF v_has_movements THEN
    RAISE EXCEPTION 'No se puede eliminar: el cheque tiene movimientos asociados.' USING ERRCODE='42501', HINT='has_movements';
  END IF;
  DELETE FROM public.checks_issued WHERE id = v_check_id;
  RETURN jsonb_build_object('deleted', true, 'check_id', v_check_id);
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- CHECKS RECEIVED (3 RPCs) — mismo patron que issued
-- ════════════════════════════════════════════════════════════════════

-- (11) PATTERN C: rpc_admin_create_check_received
CREATE OR REPLACE FUNCTION public.rpc_admin_create_check_received(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_check_id uuid; v_movement_id uuid := NULL; v_credit_id uuid; v_new_saldo numeric;
  v_customer_id uuid := NULLIF(p_payload->>'emisor_customer_b2b_id','')::uuid;
  v_monto numeric := (p_payload->>'monto')::numeric;
  v_numero text := p_payload->>'numero'; v_banco text := p_payload->>'banco';
  v_generate boolean := COALESCE((p_payload->>'generate_customer_movement')::boolean, false);
  v_fecha_emision date := (p_payload->>'fecha_emision')::date;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  -- Fase 8: check fecha_emision
  IF v_fecha_emision IS NOT NULL AND public._admin_check_periodo_cerrado(v_fecha_emision) THEN
    RAISE EXCEPTION 'Periodo contable cerrado para esa fecha de emision.'
      USING ERRCODE='42501', HINT='periodo_cerrado'; END IF;

  INSERT INTO public.checks_received (
    numero, banco, monto, fecha_emision, fecha_cobro_estimada,
    emisor_customer_b2b_id, emisor_texto, estado, notas, created_by
  ) VALUES (
    v_numero, v_banco, v_monto, v_fecha_emision,
    NULLIF(p_payload->>'fecha_cobro_estimada','')::date,
    v_customer_id, NULLIF(trim(p_payload->>'emisor_texto'),''),
    COALESCE(p_payload->>'estado', 'emitido'),
    NULLIF(trim(p_payload->>'notas'),''), auth.uid()
  ) RETURNING id INTO v_check_id;

  IF v_generate AND v_customer_id IS NOT NULL THEN
    SELECT id INTO v_credit_id FROM public.customers_credit
      WHERE customer_type = 'b2b' AND customer_b2b_id = v_customer_id FOR UPDATE;
    IF v_credit_id IS NULL THEN
      INSERT INTO public.customers_credit (customer_type, customer_b2b_id)
        VALUES ('b2b', v_customer_id) RETURNING id INTO v_credit_id;
    END IF;
    INSERT INTO public.customers_credit_movements (
      customer_credit_id, fecha, tipo, monto, concepto, check_id, created_by
    ) VALUES (
      v_credit_id, v_fecha_emision, 'pago', v_monto,
      'Cobro cheque #' || v_numero || ' ' || v_banco,
      v_check_id, auth.uid()
    ) RETURNING id INTO v_movement_id;
    UPDATE public.customers_credit SET saldo = saldo - v_monto
      WHERE id = v_credit_id RETURNING saldo INTO v_new_saldo;
  END IF;

  RETURN jsonb_build_object('check_id', v_check_id, 'customer_movement_id', v_movement_id, 'nuevo_saldo_cliente', v_new_saldo);
END;
$$;

-- (12) PATTERN C: rpc_admin_update_check_received
CREATE OR REPLACE FUNCTION public.rpc_admin_update_check_received(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_check_id uuid := NULLIF(p_payload->>'check_id','')::uuid;
  v_current_status text;
  v_numero text := p_payload->>'numero'; v_banco text := p_payload->>'banco';
  v_monto numeric;
  v_fecha_actual date; v_fecha_nueva date;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  IF v_check_id IS NULL THEN RAISE EXCEPTION 'check_id requerido' USING ERRCODE='22023'; END IF;

  SELECT fecha_emision INTO v_fecha_actual FROM public.checks_received WHERE id = v_check_id;
  IF v_fecha_actual IS NOT NULL AND public._admin_check_periodo_cerrado(v_fecha_actual) THEN
    RAISE EXCEPTION 'Periodo contable cerrado. No se puede modificar cheque en periodo cerrado.'
      USING ERRCODE='42501', HINT='periodo_cerrado'; END IF;
  IF p_payload ? 'fecha_emision' THEN
    v_fecha_nueva := NULLIF(p_payload->>'fecha_emision','')::date;
    IF v_fecha_nueva IS NOT NULL AND public._admin_check_periodo_cerrado(v_fecha_nueva) THEN
      RAISE EXCEPTION 'Periodo contable cerrado para la nueva fecha de emision.'
        USING ERRCODE='42501', HINT='periodo_cerrado'; END IF;
  END IF;

  IF v_numero IS NULL OR length(trim(v_numero)) < 1 THEN RAISE EXCEPTION 'numero requerido' USING ERRCODE='22023'; END IF;
  IF v_banco IS NULL OR length(trim(v_banco)) < 1 THEN RAISE EXCEPTION 'banco requerido' USING ERRCODE='22023'; END IF;
  v_monto := (p_payload->>'monto')::numeric;
  IF v_monto IS NULL OR v_monto <= 0 THEN RAISE EXCEPTION 'monto debe ser positivo' USING ERRCODE='22023'; END IF;

  SELECT estado INTO v_current_status FROM public.checks_received WHERE id = v_check_id FOR UPDATE;
  IF v_current_status IS NULL THEN RAISE EXCEPTION 'Cheque no existe' USING ERRCODE='22023'; END IF;
  IF v_current_status <> 'emitido' THEN
    RAISE EXCEPTION 'No se puede editar un cheque en estado %', v_current_status USING ERRCODE='42501', HINT='wrong_state';
  END IF;

  UPDATE public.checks_received SET
    numero = v_numero, banco = v_banco, monto = v_monto,
    fecha_emision = (p_payload->>'fecha_emision')::date,
    fecha_cobro_estimada = NULLIF(p_payload->>'fecha_cobro_estimada','')::date,
    emisor_customer_b2b_id = NULLIF(p_payload->>'emisor_customer_b2b_id','')::uuid,
    emisor_texto = NULLIF(trim(p_payload->>'emisor_texto'),''),
    notas = NULLIF(trim(p_payload->>'notas'),'')
  WHERE id = v_check_id;

  RETURN jsonb_build_object('check_id', v_check_id, 'updated', true);
END;
$$;

-- (13) PATTERN B: rpc_admin_delete_check_received (lookup fecha_emision)
CREATE OR REPLACE FUNCTION public.rpc_admin_delete_check_received(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_check_id uuid := NULLIF(p_payload->>'check_id','')::uuid;
  v_current_status text; v_has_movements boolean;
  v_fecha_actual date;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  IF v_check_id IS NULL THEN RAISE EXCEPTION 'check_id requerido' USING ERRCODE='22023'; END IF;

  SELECT fecha_emision INTO v_fecha_actual FROM public.checks_received WHERE id = v_check_id;
  IF v_fecha_actual IS NOT NULL AND public._admin_check_periodo_cerrado(v_fecha_actual) THEN
    RAISE EXCEPTION 'Periodo contable cerrado. No se puede eliminar cheque en periodo cerrado.'
      USING ERRCODE='42501', HINT='periodo_cerrado'; END IF;

  SELECT estado INTO v_current_status FROM public.checks_received WHERE id = v_check_id FOR UPDATE;
  IF v_current_status IS NULL THEN RAISE EXCEPTION 'Cheque no existe' USING ERRCODE='22023'; END IF;
  IF v_current_status <> 'emitido' THEN
    RAISE EXCEPTION 'No se puede eliminar un cheque en estado %. Anulalo en cambio.', v_current_status
      USING ERRCODE='42501', HINT='wrong_state';
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.customers_credit_movements WHERE check_id = v_check_id) INTO v_has_movements;
  IF v_has_movements THEN
    RAISE EXCEPTION 'No se puede eliminar: el cheque tiene movimientos asociados.' USING ERRCODE='42501', HINT='has_movements';
  END IF;
  DELETE FROM public.checks_received WHERE id = v_check_id;
  RETURN jsonb_build_object('deleted', true, 'check_id', v_check_id);
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- CHANGE CHECK STATUS (1 RPC) — PATTERN D
-- ════════════════════════════════════════════════════════════════════

-- (14) PATTERN D: rpc_admin_change_check_status
-- Valida v_fecha_cambio (fecha del evento contable) sin importar el
-- new_status: cobrado / anulado / devuelto siempre cambian el cash flow.
CREATE OR REPLACE FUNCTION public.rpc_admin_change_check_status(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_check_type text := p_payload->>'check_type';
  v_check_id uuid   := NULLIF(p_payload->>'check_id','')::uuid;
  v_new_status text := p_payload->>'new_status';
  v_fecha_cambio date := COALESCE((p_payload->>'fecha_cambio')::date, current_date);
  v_generate boolean := COALESCE((p_payload->>'generate_movement')::boolean, true);
  v_notas text := NULLIF(trim(p_payload->>'notas'),'');
  v_current_status text;
  v_party_id uuid; v_monto numeric; v_numero text; v_banco text;
  v_credit_id uuid; v_movement_id uuid := NULL; v_new_saldo numeric;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  -- Fase 8 PATTERN D: validar fecha_cambio en periodo cerrado
  IF public._admin_check_periodo_cerrado(v_fecha_cambio) THEN
    RAISE EXCEPTION 'Periodo contable cerrado para esa fecha de cambio.'
      USING ERRCODE='42501', HINT='periodo_cerrado'; END IF;

  IF v_check_id IS NULL THEN RAISE EXCEPTION 'check_id requerido' USING ERRCODE='22023'; END IF;
  IF v_check_type NOT IN ('issued','received') THEN
    RAISE EXCEPTION 'check_type invalido (issued|received)' USING ERRCODE='22023'; END IF;
  IF v_new_status NOT IN ('cobrado','anulado','devuelto') THEN
    RAISE EXCEPTION 'new_status invalido (cobrado|anulado|devuelto)' USING ERRCODE='22023'; END IF;

  IF v_check_type = 'issued' THEN
    SELECT estado, beneficiario_supplier_id, monto, numero, banco
      INTO v_current_status, v_party_id, v_monto, v_numero, v_banco
      FROM public.checks_issued WHERE id = v_check_id FOR UPDATE;
  ELSE
    SELECT estado, emisor_customer_b2b_id, monto, numero, banco
      INTO v_current_status, v_party_id, v_monto, v_numero, v_banco
      FROM public.checks_received WHERE id = v_check_id FOR UPDATE;
  END IF;
  IF v_current_status IS NULL THEN RAISE EXCEPTION 'Cheque no existe' USING ERRCODE='22023'; END IF;
  IF v_current_status <> 'emitido' THEN
    RAISE EXCEPTION 'Cheque ya esta en estado %, no se puede cambiar', v_current_status USING ERRCODE='42501', HINT='wrong_state';
  END IF;

  IF v_check_type = 'issued' THEN
    UPDATE public.checks_issued SET
      estado = v_new_status,
      fecha_cobro    = CASE WHEN v_new_status = 'cobrado'  THEN v_fecha_cambio ELSE fecha_cobro    END,
      fecha_anulado  = CASE WHEN v_new_status = 'anulado'  THEN v_fecha_cambio ELSE fecha_anulado  END,
      fecha_devuelto = CASE WHEN v_new_status = 'devuelto' THEN v_fecha_cambio ELSE fecha_devuelto END,
      notas = CASE WHEN v_notas IS NULL THEN notas ELSE COALESCE(notas || E'\n', '') || v_notas END
    WHERE id = v_check_id;
  ELSE
    UPDATE public.checks_received SET
      estado = v_new_status,
      fecha_cobro    = CASE WHEN v_new_status = 'cobrado'  THEN v_fecha_cambio ELSE fecha_cobro    END,
      fecha_anulado  = CASE WHEN v_new_status = 'anulado'  THEN v_fecha_cambio ELSE fecha_anulado  END,
      fecha_devuelto = CASE WHEN v_new_status = 'devuelto' THEN v_fecha_cambio ELSE fecha_devuelto END,
      notas = CASE WHEN v_notas IS NULL THEN notas ELSE COALESCE(notas || E'\n', '') || v_notas END
    WHERE id = v_check_id;
  END IF;

  IF v_new_status = 'cobrado' AND v_generate AND v_party_id IS NOT NULL THEN
    IF v_check_type = 'issued' THEN
      SELECT id INTO v_credit_id FROM public.suppliers_credit WHERE supplier_id = v_party_id FOR UPDATE;
      IF v_credit_id IS NULL THEN
        INSERT INTO public.suppliers_credit (supplier_id) VALUES (v_party_id) RETURNING id INTO v_credit_id;
      END IF;
      INSERT INTO public.suppliers_credit_movements (
        supplier_credit_id, fecha, tipo, monto, concepto, check_id, created_by
      ) VALUES (
        v_credit_id, v_fecha_cambio, 'pago', v_monto,
        'Cobro cheque #' || v_numero || ' ' || v_banco, v_check_id, auth.uid()
      ) RETURNING id INTO v_movement_id;
      UPDATE public.suppliers_credit SET saldo = saldo - v_monto WHERE id = v_credit_id RETURNING saldo INTO v_new_saldo;
    ELSE
      SELECT id INTO v_credit_id FROM public.customers_credit
        WHERE customer_type = 'b2b' AND customer_b2b_id = v_party_id FOR UPDATE;
      IF v_credit_id IS NULL THEN
        INSERT INTO public.customers_credit (customer_type, customer_b2b_id) VALUES ('b2b', v_party_id) RETURNING id INTO v_credit_id;
      END IF;
      INSERT INTO public.customers_credit_movements (
        customer_credit_id, fecha, tipo, monto, concepto, check_id, created_by
      ) VALUES (
        v_credit_id, v_fecha_cambio, 'pago', v_monto,
        'Cobro cheque #' || v_numero || ' ' || v_banco, v_check_id, auth.uid()
      ) RETURNING id INTO v_movement_id;
      UPDATE public.customers_credit SET saldo = saldo - v_monto WHERE id = v_credit_id RETURNING saldo INTO v_new_saldo;
    END IF;
  END IF;

  RETURN jsonb_build_object('check_id', v_check_id, 'new_status', v_new_status, 'movement_id', v_movement_id, 'nuevo_saldo', v_new_saldo);
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- CASH FLOW MANUAL (3 RPCs)
-- ════════════════════════════════════════════════════════════════════

-- (15) PATTERN A: rpc_admin_create_cash_flow_manual
CREATE OR REPLACE FUNCTION public.rpc_admin_create_cash_flow_manual(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
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

  -- Fase 8: check fecha en periodo cerrado
  IF v_fecha IS NOT NULL AND public._admin_check_periodo_cerrado(v_fecha) THEN
    RAISE EXCEPTION 'Periodo contable cerrado para esa fecha.'
      USING ERRCODE='42501', HINT='periodo_cerrado'; END IF;

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

-- (16) PATTERN A + B: rpc_admin_update_cash_flow_manual
CREATE OR REPLACE FUNCTION public.rpc_admin_update_cash_flow_manual(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_id uuid := NULLIF(p_payload->>'id','')::uuid;
  v_fecha_actual date; v_fecha_nueva date;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'id requerido' USING ERRCODE='22023'; END IF;

  -- Fase 8: lookup fecha actual + validar
  SELECT fecha INTO v_fecha_actual FROM public.cash_flow_manual WHERE id = v_id;
  IF v_fecha_actual IS NOT NULL AND public._admin_check_periodo_cerrado(v_fecha_actual) THEN
    RAISE EXCEPTION 'Periodo contable cerrado. No se puede modificar movimiento en periodo cerrado.'
      USING ERRCODE='42501', HINT='periodo_cerrado'; END IF;
  IF p_payload ? 'fecha' THEN
    v_fecha_nueva := NULLIF(p_payload->>'fecha','')::date;
    IF v_fecha_nueva IS NOT NULL AND public._admin_check_periodo_cerrado(v_fecha_nueva) THEN
      RAISE EXCEPTION 'Periodo contable cerrado para la nueva fecha.'
        USING ERRCODE='42501', HINT='periodo_cerrado'; END IF;
  END IF;

  UPDATE public.cash_flow_manual SET
    fecha     = CASE WHEN p_payload ? 'fecha'     THEN NULLIF(p_payload->>'fecha','')::date                                ELSE fecha     END,
    concepto  = CASE WHEN p_payload ? 'concepto'  THEN COALESCE(NULLIF(trim(p_payload->>'concepto'),''), concepto)         ELSE concepto  END,
    tipo      = CASE WHEN p_payload ? 'tipo'      THEN COALESCE(NULLIF(trim(p_payload->>'tipo'),''), tipo)                 ELSE tipo      END,
    monto     = CASE WHEN p_payload ? 'monto'     THEN NULLIF(p_payload->>'monto','')::numeric                              ELSE monto     END,
    categoria = CASE WHEN p_payload ? 'categoria' THEN COALESCE(NULLIF(lower(trim(p_payload->>'categoria')),''), 'otros')  ELSE categoria END,
    notas     = CASE WHEN p_payload ? 'notas'     THEN NULLIF(trim(p_payload->>'notas'),'')                                ELSE notas     END,
    activo    = CASE WHEN p_payload ? 'activo'    THEN COALESCE((p_payload->>'activo')::boolean, activo)                   ELSE activo    END
  WHERE id = v_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Movimiento manual no existe' USING ERRCODE='22023', HINT='not_found'; END IF;

  RETURN jsonb_build_object('cash_flow_manual_id', v_id, 'updated', true);
END;
$$;

-- (17) PATTERN B: rpc_admin_delete_cash_flow_manual (soft delete, lookup fecha)
CREATE OR REPLACE FUNCTION public.rpc_admin_delete_cash_flow_manual(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_id uuid := NULLIF(p_payload->>'id','')::uuid;
  v_fecha_actual date;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'id requerido' USING ERRCODE='22023'; END IF;

  -- Fase 8: lookup fecha + validar
  SELECT fecha INTO v_fecha_actual FROM public.cash_flow_manual WHERE id = v_id;
  IF v_fecha_actual IS NOT NULL AND public._admin_check_periodo_cerrado(v_fecha_actual) THEN
    RAISE EXCEPTION 'Periodo contable cerrado. No se puede eliminar movimiento en periodo cerrado.'
      USING ERRCODE='42501', HINT='periodo_cerrado'; END IF;

  UPDATE public.cash_flow_manual SET activo = false WHERE id = v_id AND activo = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movimiento manual no existe o ya esta inactivo' USING ERRCODE='22023', HINT='not_found_or_inactive'; END IF;

  RETURN jsonb_build_object('cash_flow_manual_id', v_id, 'soft_deleted', true);
END;
$$;
