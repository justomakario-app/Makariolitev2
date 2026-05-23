-- ════════════════════════════════════════════════════════════════════
-- ADMIN MODULE — 6 RPCs SECURITY DEFINER
-- ════════════════════════════════════════════════════════════════════
-- Cada RPC:
--   - SECURITY DEFINER + SET search_path = public, pg_temp.
--   - Auth + gate role IN ('owner','admin').
--   - Idempotente via CREATE OR REPLACE.
--   - REVOKE EXECUTE FROM anon, PUBLIC + GRANT EXECUTE TO authenticated.
-- Cero modificacion de RPCs/triggers/tablas de produccion.
-- ════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════
-- 1) rpc_admin_create_supplier
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rpc_admin_create_supplier(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_supplier_id uuid;
  v_credit_id uuid;
BEGIN
  SELECT role, active INTO v_role, v_active
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized';
  END IF;

  INSERT INTO public.suppliers (nombre, cuit, email, telefono, notas, created_by)
  VALUES (
    NULLIF(trim(p_payload->>'nombre'), ''),
    NULLIF(trim(p_payload->>'cuit'), ''),
    NULLIF(trim(p_payload->>'email'), ''),
    NULLIF(trim(p_payload->>'telefono'), ''),
    NULLIF(trim(p_payload->>'notas'), ''),
    auth.uid()
  )
  RETURNING id INTO v_supplier_id;

  INSERT INTO public.suppliers_credit (supplier_id)
  VALUES (v_supplier_id)
  RETURNING id INTO v_credit_id;

  RETURN jsonb_build_object(
    'supplier_id', v_supplier_id,
    'supplier_credit_id', v_credit_id
  );
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_create_supplier(jsonb) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_create_supplier(jsonb) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 2) rpc_admin_create_customer_b2b
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rpc_admin_create_customer_b2b(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_customer_id uuid;
  v_credit_id uuid;
BEGIN
  SELECT role, active INTO v_role, v_active
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized';
  END IF;

  INSERT INTO public.customers_b2b (nombre, cuit, email, telefono, notas, created_by)
  VALUES (
    NULLIF(trim(p_payload->>'nombre'), ''),
    NULLIF(trim(p_payload->>'cuit'), ''),
    NULLIF(trim(p_payload->>'email'), ''),
    NULLIF(trim(p_payload->>'telefono'), ''),
    NULLIF(trim(p_payload->>'notas'), ''),
    auth.uid()
  )
  RETURNING id INTO v_customer_id;

  INSERT INTO public.customers_credit (customer_type, customer_b2b_id)
  VALUES ('b2b', v_customer_id)
  RETURNING id INTO v_credit_id;

  RETURN jsonb_build_object(
    'customer_b2b_id', v_customer_id,
    'customer_credit_id', v_credit_id
  );
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_create_customer_b2b(jsonb) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_create_customer_b2b(jsonb) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 3) rpc_admin_create_expense
--    Crea expense + opcional suppliers_credit_movement segun reglas:
--      - generate_supplier_movement explicito → usar valor.
--      - Si no, default por medio_pago:
--        efectivo/transferencia → false (ya pagado).
--        cheque/tarjeta/otro    → true (queda pendiente en cta cte).
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rpc_admin_create_expense(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_generate_movement boolean;
  v_explicit jsonb;
BEGIN
  SELECT role, active INTO v_role, v_active
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized';
  END IF;

  -- Resolver generate_supplier_movement (decision B5 Sprint 1).
  v_explicit := p_payload->'generate_supplier_movement';
  IF v_explicit IS NOT NULL AND v_explicit::text <> 'null' THEN
    v_generate_movement := (p_payload->>'generate_supplier_movement')::boolean;
  ELSE
    v_generate_movement := CASE v_medio_pago
      WHEN 'efectivo' THEN false
      WHEN 'transferencia' THEN false
      ELSE true
    END;
  END IF;

  INSERT INTO public.expenses (
    fecha, supplier_id, concepto, monto_total, moneda, iva_discriminado,
    categoria, medio_pago, comprobante_url, ocr_raw_json, confirmed_by_human,
    notas, created_by
  ) VALUES (
    COALESCE((p_payload->>'fecha')::date, current_date),
    v_supplier_id,
    v_concepto,
    v_monto,
    COALESCE(p_payload->>'moneda', 'ARS'),
    NULLIF(p_payload->>'iva_discriminado', '')::numeric,
    p_payload->>'categoria',
    v_medio_pago,
    NULLIF(p_payload->>'comprobante_url', ''),
    p_payload->'ocr_raw_json',
    COALESCE((p_payload->>'confirmed_by_human')::boolean, false),
    NULLIF(trim(p_payload->>'notas'), ''),
    auth.uid()
  ) RETURNING id INTO v_expense_id;

  IF v_generate_movement AND v_supplier_id IS NOT NULL THEN
    SELECT id INTO v_credit_id FROM public.suppliers_credit
      WHERE supplier_id = v_supplier_id FOR UPDATE;
    IF v_credit_id IS NULL THEN
      INSERT INTO public.suppliers_credit (supplier_id)
      VALUES (v_supplier_id)
      RETURNING id INTO v_credit_id;
    END IF;

    INSERT INTO public.suppliers_credit_movements (
      supplier_credit_id, fecha, tipo, monto, concepto, expense_id, created_by
    ) VALUES (
      v_credit_id,
      COALESCE((p_payload->>'fecha')::date, current_date),
      'compra',
      v_monto,
      v_concepto,
      v_expense_id,
      auth.uid()
    ) RETURNING id INTO v_movement_id;

    UPDATE public.suppliers_credit
      SET saldo = saldo + v_monto
      WHERE id = v_credit_id
      RETURNING saldo INTO v_new_saldo;
  END IF;

  RETURN jsonb_build_object(
    'expense_id', v_expense_id,
    'supplier_movement_id', v_movement_id,
    'nuevo_saldo_proveedor', v_new_saldo,
    'generate_supplier_movement_used', v_generate_movement
  );
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_create_expense(jsonb) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_create_expense(jsonb) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 4) rpc_admin_create_check
--    Crea check + opcional movement (tipo='pago') si beneficiario es
--    supplier del catalogo y generate_supplier_movement=true.
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rpc_admin_create_check(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_check_id uuid;
  v_movement_id uuid := NULL;
  v_credit_id uuid;
  v_new_saldo numeric;
  v_supplier_id uuid := NULLIF(p_payload->>'beneficiario_supplier_id', '')::uuid;
  v_monto numeric := (p_payload->>'monto')::numeric;
  v_concepto text := p_payload->>'concepto';
  v_generate_movement boolean := COALESCE((p_payload->>'generate_supplier_movement')::boolean, false);
BEGIN
  SELECT role, active INTO v_role, v_active
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized';
  END IF;

  INSERT INTO public.checks_issued (
    numero, banco, monto, fecha_emision, fecha_cobro_estimada,
    beneficiario_supplier_id, beneficiario_texto, estado, notas, created_by
  ) VALUES (
    p_payload->>'numero',
    p_payload->>'banco',
    v_monto,
    (p_payload->>'fecha_emision')::date,
    NULLIF(p_payload->>'fecha_cobro_estimada', '')::date,
    v_supplier_id,
    NULLIF(trim(p_payload->>'beneficiario_texto'), ''),
    COALESCE(p_payload->>'estado', 'emitido'),
    NULLIF(trim(p_payload->>'notas'), ''),
    auth.uid()
  ) RETURNING id INTO v_check_id;

  IF v_generate_movement AND v_supplier_id IS NOT NULL THEN
    SELECT id INTO v_credit_id FROM public.suppliers_credit
      WHERE supplier_id = v_supplier_id FOR UPDATE;
    IF v_credit_id IS NULL THEN
      INSERT INTO public.suppliers_credit (supplier_id)
      VALUES (v_supplier_id)
      RETURNING id INTO v_credit_id;
    END IF;

    INSERT INTO public.suppliers_credit_movements (
      supplier_credit_id, fecha, tipo, monto, concepto, check_id, created_by
    ) VALUES (
      v_credit_id,
      (p_payload->>'fecha_emision')::date,
      'pago',
      v_monto,
      COALESCE(v_concepto, 'Pago con cheque ' || (p_payload->>'numero')),
      v_check_id,
      auth.uid()
    ) RETURNING id INTO v_movement_id;

    -- pago → saldo baja (le debemos menos)
    UPDATE public.suppliers_credit
      SET saldo = saldo - v_monto
      WHERE id = v_credit_id
      RETURNING saldo INTO v_new_saldo;
  END IF;

  RETURN jsonb_build_object(
    'check_id', v_check_id,
    'supplier_movement_id', v_movement_id,
    'nuevo_saldo_proveedor', v_new_saldo
  );
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_create_check(jsonb) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_create_check(jsonb) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 5) rpc_admin_create_customer_credit_movement
--    Direccion del delta:
--      cargo      → +monto (cliente debe mas)
--      pago       → -monto (cliente pago, debe menos)
--      ajuste     → +monto (signo viene en input, puede ser negativo)
--      devolucion → -monto (le devolvimos al cliente)
--    Para cargo/pago/devolucion: monto debe ser positivo.
--    Para ajuste: monto puede ser positivo o negativo (signed).
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rpc_admin_create_customer_credit_movement(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_movement_id uuid;
  v_credit_id uuid := NULLIF(p_payload->>'customer_credit_id', '')::uuid;
  v_tipo text := p_payload->>'tipo';
  v_monto numeric := (p_payload->>'monto')::numeric;
  v_delta numeric;
  v_new_saldo numeric;
BEGIN
  SELECT role, active INTO v_role, v_active
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized';
  END IF;

  IF v_credit_id IS NULL THEN
    RAISE EXCEPTION 'customer_credit_id requerido' USING ERRCODE='22023';
  END IF;
  IF v_tipo NOT IN ('cargo','pago','ajuste','devolucion') THEN
    RAISE EXCEPTION 'tipo invalido: %', v_tipo USING ERRCODE='22023';
  END IF;
  IF v_monto = 0 THEN
    RAISE EXCEPTION 'monto no puede ser 0' USING ERRCODE='22023';
  END IF;
  IF v_tipo IN ('cargo','pago','devolucion') AND v_monto <= 0 THEN
    RAISE EXCEPTION 'monto debe ser positivo para tipo=%', v_tipo USING ERRCODE='22023';
  END IF;

  v_delta := CASE v_tipo
    WHEN 'cargo' THEN v_monto
    WHEN 'pago' THEN -v_monto
    WHEN 'ajuste' THEN v_monto
    WHEN 'devolucion' THEN -v_monto
  END;

  PERFORM 1 FROM public.customers_credit WHERE id = v_credit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customers_credit no existe' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.customers_credit_movements (
    customer_credit_id, fecha, tipo, monto, concepto, referencia_externa, created_by
  ) VALUES (
    v_credit_id,
    COALESCE((p_payload->>'fecha')::date, current_date),
    v_tipo,
    v_monto,
    p_payload->>'concepto',
    NULLIF(trim(p_payload->>'referencia_externa'), ''),
    auth.uid()
  ) RETURNING id INTO v_movement_id;

  UPDATE public.customers_credit
    SET saldo = saldo + v_delta
    WHERE id = v_credit_id
    RETURNING saldo INTO v_new_saldo;

  RETURN jsonb_build_object(
    'movement_id', v_movement_id,
    'nuevo_saldo', v_new_saldo
  );
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_create_customer_credit_movement(jsonb) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_create_customer_credit_movement(jsonb) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 6) rpc_admin_create_supplier_credit_movement
--    Direccion del delta:
--      compra     → +monto (le debemos mas)
--      pago       → -monto (le pagamos, debemos menos)
--      ajuste     → +monto (signed)
--      devolucion → -monto (nos devolvio plata)
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rpc_admin_create_supplier_credit_movement(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_movement_id uuid;
  v_credit_id uuid := NULLIF(p_payload->>'supplier_credit_id', '')::uuid;
  v_tipo text := p_payload->>'tipo';
  v_monto numeric := (p_payload->>'monto')::numeric;
  v_delta numeric;
  v_new_saldo numeric;
BEGIN
  SELECT role, active INTO v_role, v_active
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized';
  END IF;

  IF v_credit_id IS NULL THEN
    RAISE EXCEPTION 'supplier_credit_id requerido' USING ERRCODE='22023';
  END IF;
  IF v_tipo NOT IN ('compra','pago','ajuste','devolucion') THEN
    RAISE EXCEPTION 'tipo invalido: %', v_tipo USING ERRCODE='22023';
  END IF;
  IF v_monto = 0 THEN
    RAISE EXCEPTION 'monto no puede ser 0' USING ERRCODE='22023';
  END IF;
  IF v_tipo IN ('compra','pago','devolucion') AND v_monto <= 0 THEN
    RAISE EXCEPTION 'monto debe ser positivo para tipo=%', v_tipo USING ERRCODE='22023';
  END IF;

  v_delta := CASE v_tipo
    WHEN 'compra' THEN v_monto
    WHEN 'pago' THEN -v_monto
    WHEN 'ajuste' THEN v_monto
    WHEN 'devolucion' THEN -v_monto
  END;

  PERFORM 1 FROM public.suppliers_credit WHERE id = v_credit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'suppliers_credit no existe' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.suppliers_credit_movements (
    supplier_credit_id, fecha, tipo, monto, concepto,
    expense_id, check_id, created_by
  ) VALUES (
    v_credit_id,
    COALESCE((p_payload->>'fecha')::date, current_date),
    v_tipo,
    v_monto,
    p_payload->>'concepto',
    NULLIF(p_payload->>'expense_id', '')::uuid,
    NULLIF(p_payload->>'check_id', '')::uuid,
    auth.uid()
  ) RETURNING id INTO v_movement_id;

  UPDATE public.suppliers_credit
    SET saldo = saldo + v_delta
    WHERE id = v_credit_id
    RETURNING saldo INTO v_new_saldo;

  RETURN jsonb_build_object(
    'movement_id', v_movement_id,
    'nuevo_saldo', v_new_saldo
  );
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_create_supplier_credit_movement(jsonb) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_create_supplier_credit_movement(jsonb) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual):
--   DROP FUNCTION IF EXISTS public.rpc_admin_create_supplier(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_admin_create_customer_b2b(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_admin_create_expense(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_admin_create_check(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_admin_create_customer_credit_movement(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_admin_create_supplier_credit_movement(jsonb);
-- ════════════════════════════════════════════════════════════════════
