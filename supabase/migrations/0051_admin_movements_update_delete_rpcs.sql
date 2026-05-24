-- ════════════════════════════════════════════════════════════════════
-- ADMIN MODULE — 4 RPCs para UPDATE/DELETE de movements (B.5)
-- ════════════════════════════════════════════════════════════════════
-- Cierra el loop de cuentas corrientes: Noe puede editar/eliminar
-- movements MANUALES de su cuenta corriente con recompute atómico
-- del saldo del proveedor/cliente.
--
-- Reglas:
--   - SECURITY DEFINER + search_path explícito (idéntico patrón Tanda A).
--   - Gate de rol: solo owner/admin activo.
--   - Lock FOR UPDATE en el movement + en la cuenta antes de modificar.
--   - REJECT si expense_id IS NOT NULL OR check_id IS NOT NULL en los
--     RPCs de SUPPLIER (los automáticos solo se modifican vía su origen).
--   - Customer movements NO tienen origen automático → siempre editables.
--   - Recompute del saldo = saldo - delta_old + delta_new (UPDATE) o
--     saldo - delta_old (DELETE).
--
-- Esta migration es 100% aditiva. Sin DDL sobre tablas. Rollback simple:
--   DROP FUNCTION ... CASCADE; (al final del archivo).
-- ════════════════════════════════════════════════════════════════════

-- ── rpc_admin_update_supplier_credit_movement ──────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_update_supplier_credit_movement(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_movement_id uuid := NULLIF(p_payload->>'movement_id','')::uuid;
  v_old record;
  v_new_tipo text := p_payload->>'tipo';
  v_new_monto numeric;
  v_new_concepto text := p_payload->>'concepto';
  v_new_fecha date := COALESCE((p_payload->>'fecha')::date, current_date);
  v_delta_old numeric;
  v_delta_new numeric;
  v_new_saldo numeric;
BEGIN
  -- Gate de rol
  SELECT role, active INTO v_role, v_active
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized';
  END IF;

  -- Validar payload
  IF v_movement_id IS NULL THEN
    RAISE EXCEPTION 'movement_id requerido' USING ERRCODE='22023';
  END IF;
  IF v_new_tipo NOT IN ('compra','pago','ajuste','devolucion') THEN
    RAISE EXCEPTION 'tipo invalido: %', v_new_tipo USING ERRCODE='22023';
  END IF;
  v_new_monto := (p_payload->>'monto')::numeric;
  IF v_new_monto = 0 THEN
    RAISE EXCEPTION 'monto no puede ser 0' USING ERRCODE='22023';
  END IF;
  IF v_new_tipo IN ('compra','pago','devolucion') AND v_new_monto <= 0 THEN
    RAISE EXCEPTION 'monto debe ser positivo para tipo=%', v_new_tipo USING ERRCODE='22023';
  END IF;
  IF v_new_concepto IS NULL OR length(trim(v_new_concepto)) < 1 OR length(v_new_concepto) > 500 THEN
    RAISE EXCEPTION 'concepto invalido (1-500 chars)' USING ERRCODE='22023';
  END IF;

  -- Lock + leer movement existente
  SELECT * INTO v_old
    FROM public.suppliers_credit_movements
    WHERE id = v_movement_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movimiento no existe' USING ERRCODE='22023';
  END IF;

  -- REJECT si origen automático
  IF v_old.expense_id IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede editar movimientos auto-generados por egresos. Edita el egreso original en su tab.'
      USING ERRCODE='42501', HINT='auto_movement';
  END IF;
  IF v_old.check_id IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede editar movimientos auto-generados por cheques. Edita el cheque original.'
      USING ERRCODE='42501', HINT='auto_movement';
  END IF;

  -- Calcular deltas
  v_delta_old := CASE v_old.tipo
    WHEN 'compra'     THEN v_old.monto
    WHEN 'pago'       THEN -v_old.monto
    WHEN 'ajuste'     THEN v_old.monto
    WHEN 'devolucion' THEN -v_old.monto
  END;
  v_delta_new := CASE v_new_tipo
    WHEN 'compra'     THEN v_new_monto
    WHEN 'pago'       THEN -v_new_monto
    WHEN 'ajuste'     THEN v_new_monto
    WHEN 'devolucion' THEN -v_new_monto
  END;

  -- Lock suppliers_credit
  PERFORM 1 FROM public.suppliers_credit
    WHERE id = v_old.supplier_credit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'suppliers_credit no existe' USING ERRCODE='22023';
  END IF;

  -- UPDATE movement
  UPDATE public.suppliers_credit_movements
     SET fecha = v_new_fecha,
         tipo = v_new_tipo,
         monto = v_new_monto,
         concepto = trim(v_new_concepto)
   WHERE id = v_movement_id;

  -- UPDATE saldo con diferencial
  UPDATE public.suppliers_credit
     SET saldo = saldo - v_delta_old + v_delta_new
   WHERE id = v_old.supplier_credit_id
   RETURNING saldo INTO v_new_saldo;

  RETURN jsonb_build_object(
    'movement_id', v_movement_id,
    'nuevo_saldo', v_new_saldo
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_update_supplier_credit_movement(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_update_supplier_credit_movement(jsonb) TO authenticated;
COMMENT ON FUNCTION public.rpc_admin_update_supplier_credit_movement(jsonb) IS
  'B.5: Edita un movement MANUAL (expense_id IS NULL AND check_id IS NULL). Recompute atómico del saldo. Owner/admin only.';


-- ── rpc_admin_delete_supplier_credit_movement ──────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_delete_supplier_credit_movement(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_movement_id uuid := NULLIF(p_payload->>'movement_id','')::uuid;
  v_old record;
  v_delta_old numeric;
  v_new_saldo numeric;
BEGIN
  -- Gate de rol
  SELECT role, active INTO v_role, v_active
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized';
  END IF;

  IF v_movement_id IS NULL THEN
    RAISE EXCEPTION 'movement_id requerido' USING ERRCODE='22023';
  END IF;

  -- Lock + leer
  SELECT * INTO v_old
    FROM public.suppliers_credit_movements
    WHERE id = v_movement_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movimiento no existe' USING ERRCODE='22023';
  END IF;

  IF v_old.expense_id IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede eliminar movimientos auto-generados por egresos. Elimina el egreso original.'
      USING ERRCODE='42501', HINT='auto_movement';
  END IF;
  IF v_old.check_id IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede eliminar movimientos auto-generados por cheques. Elimina el cheque original.'
      USING ERRCODE='42501', HINT='auto_movement';
  END IF;

  v_delta_old := CASE v_old.tipo
    WHEN 'compra'     THEN v_old.monto
    WHEN 'pago'       THEN -v_old.monto
    WHEN 'ajuste'     THEN v_old.monto
    WHEN 'devolucion' THEN -v_old.monto
  END;

  PERFORM 1 FROM public.suppliers_credit
    WHERE id = v_old.supplier_credit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'suppliers_credit no existe' USING ERRCODE='22023';
  END IF;

  DELETE FROM public.suppliers_credit_movements WHERE id = v_movement_id;

  UPDATE public.suppliers_credit
     SET saldo = saldo - v_delta_old
   WHERE id = v_old.supplier_credit_id
   RETURNING saldo INTO v_new_saldo;

  RETURN jsonb_build_object(
    'deleted', true,
    'movement_id', v_movement_id,
    'nuevo_saldo', v_new_saldo
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_delete_supplier_credit_movement(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_delete_supplier_credit_movement(jsonb) TO authenticated;
COMMENT ON FUNCTION public.rpc_admin_delete_supplier_credit_movement(jsonb) IS
  'B.5: Elimina un movement MANUAL. Recompute atómico del saldo. Owner/admin only.';


-- ── rpc_admin_update_customer_credit_movement ──────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_update_customer_credit_movement(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_movement_id uuid := NULLIF(p_payload->>'movement_id','')::uuid;
  v_old record;
  v_new_tipo text := p_payload->>'tipo';
  v_new_monto numeric;
  v_new_concepto text := p_payload->>'concepto';
  v_new_fecha date := COALESCE((p_payload->>'fecha')::date, current_date);
  v_delta_old numeric;
  v_delta_new numeric;
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

  IF v_movement_id IS NULL THEN
    RAISE EXCEPTION 'movement_id requerido' USING ERRCODE='22023';
  END IF;
  IF v_new_tipo NOT IN ('cargo','pago','ajuste','devolucion') THEN
    RAISE EXCEPTION 'tipo invalido: %', v_new_tipo USING ERRCODE='22023';
  END IF;
  v_new_monto := (p_payload->>'monto')::numeric;
  IF v_new_monto = 0 THEN
    RAISE EXCEPTION 'monto no puede ser 0' USING ERRCODE='22023';
  END IF;
  IF v_new_tipo IN ('cargo','pago','devolucion') AND v_new_monto <= 0 THEN
    RAISE EXCEPTION 'monto debe ser positivo para tipo=%', v_new_tipo USING ERRCODE='22023';
  END IF;
  IF v_new_concepto IS NULL OR length(trim(v_new_concepto)) < 1 OR length(v_new_concepto) > 500 THEN
    RAISE EXCEPTION 'concepto invalido (1-500 chars)' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_old
    FROM public.customers_credit_movements
    WHERE id = v_movement_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movimiento no existe' USING ERRCODE='22023';
  END IF;

  -- Customers NO tienen movements automáticos. No hay REJECT por origen.

  v_delta_old := CASE v_old.tipo
    WHEN 'cargo'      THEN v_old.monto
    WHEN 'pago'       THEN -v_old.monto
    WHEN 'ajuste'     THEN v_old.monto
    WHEN 'devolucion' THEN -v_old.monto
  END;
  v_delta_new := CASE v_new_tipo
    WHEN 'cargo'      THEN v_new_monto
    WHEN 'pago'       THEN -v_new_monto
    WHEN 'ajuste'     THEN v_new_monto
    WHEN 'devolucion' THEN -v_new_monto
  END;

  PERFORM 1 FROM public.customers_credit
    WHERE id = v_old.customer_credit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customers_credit no existe' USING ERRCODE='22023';
  END IF;

  UPDATE public.customers_credit_movements
     SET fecha = v_new_fecha,
         tipo = v_new_tipo,
         monto = v_new_monto,
         concepto = trim(v_new_concepto)
   WHERE id = v_movement_id;

  UPDATE public.customers_credit
     SET saldo = saldo - v_delta_old + v_delta_new
   WHERE id = v_old.customer_credit_id
   RETURNING saldo INTO v_new_saldo;

  RETURN jsonb_build_object(
    'movement_id', v_movement_id,
    'nuevo_saldo', v_new_saldo
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_update_customer_credit_movement(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_update_customer_credit_movement(jsonb) TO authenticated;
COMMENT ON FUNCTION public.rpc_admin_update_customer_credit_movement(jsonb) IS
  'B.5: Edita un movement de cliente (todos son manuales). Recompute atómico del saldo. Owner/admin only.';


-- ── rpc_admin_delete_customer_credit_movement ──────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_delete_customer_credit_movement(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_movement_id uuid := NULLIF(p_payload->>'movement_id','')::uuid;
  v_old record;
  v_delta_old numeric;
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

  IF v_movement_id IS NULL THEN
    RAISE EXCEPTION 'movement_id requerido' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_old
    FROM public.customers_credit_movements
    WHERE id = v_movement_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movimiento no existe' USING ERRCODE='22023';
  END IF;

  v_delta_old := CASE v_old.tipo
    WHEN 'cargo'      THEN v_old.monto
    WHEN 'pago'       THEN -v_old.monto
    WHEN 'ajuste'     THEN v_old.monto
    WHEN 'devolucion' THEN -v_old.monto
  END;

  PERFORM 1 FROM public.customers_credit
    WHERE id = v_old.customer_credit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customers_credit no existe' USING ERRCODE='22023';
  END IF;

  DELETE FROM public.customers_credit_movements WHERE id = v_movement_id;

  UPDATE public.customers_credit
     SET saldo = saldo - v_delta_old
   WHERE id = v_old.customer_credit_id
   RETURNING saldo INTO v_new_saldo;

  RETURN jsonb_build_object(
    'deleted', true,
    'movement_id', v_movement_id,
    'nuevo_saldo', v_new_saldo
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_delete_customer_credit_movement(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_delete_customer_credit_movement(jsonb) TO authenticated;
COMMENT ON FUNCTION public.rpc_admin_delete_customer_credit_movement(jsonb) IS
  'B.5: Elimina un movement de cliente. Recompute atómico del saldo. Owner/admin only.';


-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual):
--   DROP FUNCTION IF EXISTS public.rpc_admin_update_supplier_credit_movement(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_admin_delete_supplier_credit_movement(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_admin_update_customer_credit_movement(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_admin_delete_customer_credit_movement(jsonb);
-- ════════════════════════════════════════════════════════════════════
