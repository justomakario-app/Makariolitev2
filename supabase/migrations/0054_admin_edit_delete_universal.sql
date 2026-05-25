-- ════════════════════════════════════════════════════════════════════
-- ADMIN MODULE — Edit/Delete Universal (S2.1)
-- ════════════════════════════════════════════════════════════════════
-- 1) ADD COLUMN activo (boolean NOT NULL DEFAULT true) en 3 tablas:
--    suppliers, customers_b2b, expenses.
-- 2) Partial indexes WHERE activo=false para query "mostrar inactivos".
-- 3) 6 RPCs nuevos: update + delete de cada entidad.
--
-- Patron de delete: contar relaciones primero, bloquear con mensaje
-- detallado si hay > 0, DELETE fisico si limpio. UX: si bloqueado,
-- frontend ofrece "desactivar" (UPDATE activo=false).
--
-- Audit log (S2.0) captura automaticamente todos los UPDATE/DELETE
-- via trigger trg_audit_log() — sin modificacion de RPCs ni triggers.
-- ════════════════════════════════════════════════════════════════════

-- ── (1) ADD COLUMN activo + indexes partial ─────────────────────────
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;
ALTER TABLE public.customers_b2b
  ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS suppliers_inactive_idx
  ON public.suppliers(activo) WHERE activo = false;
CREATE INDEX IF NOT EXISTS customers_b2b_inactive_idx
  ON public.customers_b2b(activo) WHERE activo = false;
CREATE INDEX IF NOT EXISTS expenses_inactive_idx
  ON public.expenses(activo) WHERE activo = false;

-- ────────────────────────────────────────────────────────────────────
-- 6 RPCs (update + delete x 3 entidades)
-- ────────────────────────────────────────────────────────────────────

-- ── rpc_admin_update_supplier ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_update_supplier(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_id uuid := NULLIF(p_payload->>'id','')::uuid;
  v_nombre text;
  v_cuit text;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized';
  END IF;

  IF v_id IS NULL THEN RAISE EXCEPTION 'id requerido' USING ERRCODE='22023'; END IF;
  v_nombre := NULLIF(trim(p_payload->>'nombre'),'');
  IF v_nombre IS NULL OR length(v_nombre) < 1 OR length(v_nombre) > 120 THEN
    RAISE EXCEPTION 'nombre requerido (1-120 caracteres)' USING ERRCODE='22023';
  END IF;
  v_cuit := NULLIF(trim(p_payload->>'cuit'),'');
  IF v_cuit IS NOT NULL AND v_cuit !~ '^\d{2}-\d{8}-\d$' THEN
    RAISE EXCEPTION 'CUIT formato invalido (XX-XXXXXXXX-X)' USING ERRCODE='22023';
  END IF;

  PERFORM 1 FROM public.suppliers WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proveedor no existe' USING ERRCODE='22023';
  END IF;

  BEGIN
    UPDATE public.suppliers SET
      nombre   = v_nombre,
      cuit     = v_cuit,
      email    = NULLIF(trim(p_payload->>'email'),''),
      telefono = NULLIF(trim(p_payload->>'telefono'),''),
      notas    = NULLIF(trim(p_payload->>'notas'),''),
      activo   = COALESCE((p_payload->>'activo')::boolean, activo)
    WHERE id = v_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Ya existe otro proveedor con ese CUIT'
        USING ERRCODE='23505', HINT='duplicate_cuit';
  END;

  RETURN jsonb_build_object('supplier_id', v_id, 'updated', true);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_update_supplier(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_update_supplier(jsonb) TO authenticated;

-- ── rpc_admin_delete_supplier ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_delete_supplier(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_id uuid := NULLIF(p_payload->>'id','')::uuid;
  v_n_expenses int;
  v_n_credit int;
  v_n_checks int;
  v_total int;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  IF v_id IS NULL THEN RAISE EXCEPTION 'id requerido' USING ERRCODE='22023'; END IF;

  PERFORM 1 FROM public.suppliers WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proveedor no existe' USING ERRCODE='22023';
  END IF;

  SELECT count(*) INTO v_n_expenses FROM public.expenses WHERE supplier_id = v_id;
  SELECT count(*) INTO v_n_credit   FROM public.suppliers_credit WHERE supplier_id = v_id;
  SELECT count(*) INTO v_n_checks   FROM public.checks_issued WHERE beneficiario_supplier_id = v_id;

  v_total := v_n_expenses + v_n_credit + v_n_checks;

  IF v_total > 0 THEN
    RAISE EXCEPTION
      'No se puede eliminar: tiene % egresos asociados, % cuenta corriente, % cheques. Borra primero las relaciones o desactiva el proveedor.',
      v_n_expenses, v_n_credit, v_n_checks
      USING ERRCODE='42501', HINT='has_relations';
  END IF;

  DELETE FROM public.suppliers WHERE id = v_id;

  RETURN jsonb_build_object('deleted', true, 'supplier_id', v_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_delete_supplier(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_delete_supplier(jsonb) TO authenticated;

-- ── rpc_admin_update_customer_b2b ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_update_customer_b2b(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_id uuid := NULLIF(p_payload->>'id','')::uuid;
  v_nombre text;
  v_cuit text;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  IF v_id IS NULL THEN RAISE EXCEPTION 'id requerido' USING ERRCODE='22023'; END IF;
  v_nombre := NULLIF(trim(p_payload->>'nombre'),'');
  IF v_nombre IS NULL OR length(v_nombre) < 1 OR length(v_nombre) > 120 THEN
    RAISE EXCEPTION 'nombre requerido (1-120 caracteres)' USING ERRCODE='22023';
  END IF;
  v_cuit := NULLIF(trim(p_payload->>'cuit'),'');
  IF v_cuit IS NOT NULL AND v_cuit !~ '^\d{2}-\d{8}-\d$' THEN
    RAISE EXCEPTION 'CUIT formato invalido (XX-XXXXXXXX-X)' USING ERRCODE='22023';
  END IF;

  PERFORM 1 FROM public.customers_b2b WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente no existe' USING ERRCODE='22023';
  END IF;

  BEGIN
    UPDATE public.customers_b2b SET
      nombre   = v_nombre,
      cuit     = v_cuit,
      email    = NULLIF(trim(p_payload->>'email'),''),
      telefono = NULLIF(trim(p_payload->>'telefono'),''),
      notas    = NULLIF(trim(p_payload->>'notas'),''),
      activo   = COALESCE((p_payload->>'activo')::boolean, activo)
    WHERE id = v_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Ya existe otro cliente con ese CUIT'
        USING ERRCODE='23505', HINT='duplicate_cuit';
  END;

  RETURN jsonb_build_object('customer_b2b_id', v_id, 'updated', true);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_update_customer_b2b(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_update_customer_b2b(jsonb) TO authenticated;

-- ── rpc_admin_delete_customer_b2b ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_delete_customer_b2b(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_id uuid := NULLIF(p_payload->>'id','')::uuid;
  v_n_credit int;
  v_n_checks int;
  v_total int;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  IF v_id IS NULL THEN RAISE EXCEPTION 'id requerido' USING ERRCODE='22023'; END IF;

  PERFORM 1 FROM public.customers_b2b WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente no existe' USING ERRCODE='22023';
  END IF;

  SELECT count(*) INTO v_n_credit FROM public.customers_credit WHERE customer_b2b_id = v_id;
  SELECT count(*) INTO v_n_checks FROM public.checks_received WHERE emisor_customer_b2b_id = v_id;

  v_total := v_n_credit + v_n_checks;

  IF v_total > 0 THEN
    RAISE EXCEPTION
      'No se puede eliminar: tiene % cuenta corriente, % cheques recibidos. Borra primero las relaciones o desactiva el cliente.',
      v_n_credit, v_n_checks
      USING ERRCODE='42501', HINT='has_relations';
  END IF;

  DELETE FROM public.customers_b2b WHERE id = v_id;

  RETURN jsonb_build_object('deleted', true, 'customer_b2b_id', v_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_delete_customer_b2b(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_delete_customer_b2b(jsonb) TO authenticated;

-- ── rpc_admin_update_expense ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_update_expense(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_id uuid := NULLIF(p_payload->>'id','')::uuid;
  v_monto numeric;
  v_categoria text;
  v_medio_pago text;
  v_moneda text;
  v_concepto text;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  IF v_id IS NULL THEN RAISE EXCEPTION 'id requerido' USING ERRCODE='22023'; END IF;

  v_concepto := p_payload->>'concepto';
  IF v_concepto IS NULL OR length(trim(v_concepto)) < 1 OR length(v_concepto) > 500 THEN
    RAISE EXCEPTION 'concepto requerido (1-500 caracteres)' USING ERRCODE='22023';
  END IF;
  v_monto := (p_payload->>'monto_total')::numeric;
  IF v_monto IS NULL OR v_monto <= 0 THEN
    RAISE EXCEPTION 'monto debe ser positivo' USING ERRCODE='22023';
  END IF;
  v_categoria := p_payload->>'categoria';
  IF v_categoria NOT IN ('insumos','servicios','sueldos','impuestos','otros') THEN
    RAISE EXCEPTION 'categoria invalida' USING ERRCODE='22023';
  END IF;
  v_medio_pago := p_payload->>'medio_pago';
  IF v_medio_pago NOT IN ('efectivo','transferencia','cheque','tarjeta','otro') THEN
    RAISE EXCEPTION 'medio_pago invalido' USING ERRCODE='22023';
  END IF;
  v_moneda := COALESCE(p_payload->>'moneda', 'ARS');
  IF v_moneda NOT IN ('ARS','USD') THEN
    RAISE EXCEPTION 'moneda invalida' USING ERRCODE='22023';
  END IF;

  PERFORM 1 FROM public.expenses WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Egreso no existe' USING ERRCODE='22023';
  END IF;

  UPDATE public.expenses SET
    fecha            = COALESCE((p_payload->>'fecha')::date, fecha),
    supplier_id      = NULLIF(p_payload->>'supplier_id','')::uuid,
    concepto         = trim(v_concepto),
    monto_total      = v_monto,
    moneda           = v_moneda,
    iva_discriminado = NULLIF(p_payload->>'iva_discriminado','')::numeric,
    categoria        = v_categoria,
    medio_pago       = v_medio_pago,
    notas            = NULLIF(trim(p_payload->>'notas'),''),
    activo           = COALESCE((p_payload->>'activo')::boolean, activo)
  WHERE id = v_id;

  RETURN jsonb_build_object('expense_id', v_id, 'updated', true);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_update_expense(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_update_expense(jsonb) TO authenticated;

-- ── rpc_admin_delete_expense ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_delete_expense(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_id uuid := NULLIF(p_payload->>'id','')::uuid;
  v_n_movements int;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  IF v_id IS NULL THEN RAISE EXCEPTION 'id requerido' USING ERRCODE='22023'; END IF;

  PERFORM 1 FROM public.expenses WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Egreso no existe' USING ERRCODE='22023';
  END IF;

  SELECT count(*) INTO v_n_movements
    FROM public.suppliers_credit_movements
    WHERE expense_id = v_id;

  IF v_n_movements > 0 THEN
    RAISE EXCEPTION
      'No se puede eliminar: este egreso tiene % movimiento(s) en cta cte asociado(s). Borra primero el movimiento o desactiva el egreso.',
      v_n_movements
      USING ERRCODE='42501', HINT='has_relations';
  END IF;

  DELETE FROM public.expenses WHERE id = v_id;

  RETURN jsonb_build_object('deleted', true, 'expense_id', v_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_delete_expense(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_delete_expense(jsonb) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual):
--   DROP FUNCTION IF EXISTS public.rpc_admin_delete_expense(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_admin_update_expense(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_admin_delete_customer_b2b(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_admin_update_customer_b2b(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_admin_delete_supplier(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_admin_update_supplier(jsonb);
--   DROP INDEX IF EXISTS public.expenses_inactive_idx;
--   DROP INDEX IF EXISTS public.customers_b2b_inactive_idx;
--   DROP INDEX IF EXISTS public.suppliers_inactive_idx;
--   ALTER TABLE public.expenses DROP COLUMN IF EXISTS activo;
--   ALTER TABLE public.customers_b2b DROP COLUMN IF EXISTS activo;
--   ALTER TABLE public.suppliers DROP COLUMN IF EXISTS activo;
-- ════════════════════════════════════════════════════════════════════
