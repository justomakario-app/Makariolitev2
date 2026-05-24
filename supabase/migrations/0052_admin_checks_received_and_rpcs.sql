-- ════════════════════════════════════════════════════════════════════
-- ADMIN MODULE — Cheques recibidos + tracking de estado + 6 RPCs (B.4)
-- ════════════════════════════════════════════════════════════════════
-- 1) Aditivo en checks_issued: 4 columnas nuevas (fecha_cobro,
--    fecha_anulado, fecha_devuelto, updated_at) + trigger.
-- 2) Nueva tabla checks_received (espejo de checks_issued contra
--    customers_b2b) con RLS + 4 policies + indexes + trigger.
-- 3) Aditivo en customers_credit_movements: check_id FK + index.
-- 4) 6 RPCs nuevos:
--      - rpc_admin_create_check_received
--      - rpc_admin_update_check
--      - rpc_admin_delete_check
--      - rpc_admin_update_check_received
--      - rpc_admin_delete_check_received
--      - rpc_admin_change_check_status (unificado emitido/recibido)
--
-- Excepcion aprobada al "NO modificar tablas existentes": los ALTER son
-- ADD COLUMN nullable, aditivos puros, sobre tablas con 0 filas.
-- ════════════════════════════════════════════════════════════════════

-- ── (1) checks_issued: agregar tracking de estados + updated_at ─────
ALTER TABLE public.checks_issued
  ADD COLUMN IF NOT EXISTS fecha_cobro    date,
  ADD COLUMN IF NOT EXISTS fecha_anulado  date,
  ADD COLUMN IF NOT EXISTS fecha_devuelto date,
  ADD COLUMN IF NOT EXISTS updated_at     timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS checks_issued_set_updated_at ON public.checks_issued;
CREATE TRIGGER checks_issued_set_updated_at
  BEFORE UPDATE ON public.checks_issued
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── (2) checks_received: tabla espejo contra customers_b2b ──────────
CREATE TABLE IF NOT EXISTS public.checks_received (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero                   text NOT NULL,
  banco                    text NOT NULL,
  monto                    numeric NOT NULL CHECK (monto > 0),
  fecha_emision            date NOT NULL,
  fecha_cobro_estimada     date,
  fecha_cobro              date,
  fecha_anulado            date,
  fecha_devuelto           date,
  emisor_customer_b2b_id   uuid REFERENCES public.customers_b2b(id) ON DELETE RESTRICT,
  emisor_texto             text,
  estado                   text NOT NULL DEFAULT 'emitido'
                           CHECK (estado IN ('emitido','cobrado','anulado','devuelto')),
  notas                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid REFERENCES public.profiles(id),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT checks_received_emisor_required
    CHECK (emisor_customer_b2b_id IS NOT NULL OR emisor_texto IS NOT NULL)
);
COMMENT ON TABLE public.checks_received IS
  'Cheques recibidos de clientes B2B. Espejo de checks_issued.';

CREATE INDEX IF NOT EXISTS checks_received_customer_idx
  ON public.checks_received(emisor_customer_b2b_id);
CREATE INDEX IF NOT EXISTS checks_received_estado_idx
  ON public.checks_received(estado);
CREATE INDEX IF NOT EXISTS checks_received_fecha_emision_idx
  ON public.checks_received(fecha_emision DESC);

DROP TRIGGER IF EXISTS checks_received_set_updated_at ON public.checks_received;
CREATE TRIGGER checks_received_set_updated_at
  BEFORE UPDATE ON public.checks_received
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS + 4 policies (mismo patron que el resto de tablas admin)
ALTER TABLE public.checks_received ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "checks_received: admin select" ON public.checks_received;
CREATE POLICY "checks_received: admin select" ON public.checks_received
  FOR SELECT TO authenticated USING (is_owner_or_admin());

DROP POLICY IF EXISTS "checks_received: admin insert" ON public.checks_received;
CREATE POLICY "checks_received: admin insert" ON public.checks_received
  FOR INSERT TO authenticated WITH CHECK (is_owner_or_admin());

DROP POLICY IF EXISTS "checks_received: admin update" ON public.checks_received;
CREATE POLICY "checks_received: admin update" ON public.checks_received
  FOR UPDATE TO authenticated
  USING (is_owner_or_admin()) WITH CHECK (is_owner_or_admin());

DROP POLICY IF EXISTS "checks_received: admin delete" ON public.checks_received;
CREATE POLICY "checks_received: admin delete" ON public.checks_received
  FOR DELETE TO authenticated USING (is_owner_or_admin());

-- ── (3) customers_credit_movements: check_id FK ─────────────────────
ALTER TABLE public.customers_credit_movements
  ADD COLUMN IF NOT EXISTS check_id uuid
    REFERENCES public.checks_received(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS customers_credit_movements_check_idx
  ON public.customers_credit_movements(check_id) WHERE check_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════
-- 4) RPCs (6 nuevos)
-- ════════════════════════════════════════════════════════════════════

-- ── rpc_admin_create_check_received ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_create_check_received(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_check_id uuid;
  v_movement_id uuid := NULL;
  v_credit_id uuid;
  v_new_saldo numeric;
  v_customer_id uuid := NULLIF(p_payload->>'emisor_customer_b2b_id','')::uuid;
  v_monto numeric := (p_payload->>'monto')::numeric;
  v_numero text := p_payload->>'numero';
  v_banco text := p_payload->>'banco';
  v_generate boolean := COALESCE((p_payload->>'generate_customer_movement')::boolean, false);
BEGIN
  SELECT role, active INTO v_role, v_active
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized';
  END IF;

  INSERT INTO public.checks_received (
    numero, banco, monto, fecha_emision, fecha_cobro_estimada,
    emisor_customer_b2b_id, emisor_texto, estado, notas, created_by
  ) VALUES (
    v_numero,
    v_banco,
    v_monto,
    (p_payload->>'fecha_emision')::date,
    NULLIF(p_payload->>'fecha_cobro_estimada','')::date,
    v_customer_id,
    NULLIF(trim(p_payload->>'emisor_texto'),''),
    COALESCE(p_payload->>'estado', 'emitido'),
    NULLIF(trim(p_payload->>'notas'),''),
    auth.uid()
  ) RETURNING id INTO v_check_id;

  IF v_generate AND v_customer_id IS NOT NULL THEN
    SELECT id INTO v_credit_id FROM public.customers_credit
      WHERE customer_type = 'b2b' AND customer_b2b_id = v_customer_id FOR UPDATE;
    IF v_credit_id IS NULL THEN
      INSERT INTO public.customers_credit (customer_type, customer_b2b_id)
      VALUES ('b2b', v_customer_id)
      RETURNING id INTO v_credit_id;
    END IF;

    INSERT INTO public.customers_credit_movements (
      customer_credit_id, fecha, tipo, monto, concepto, check_id, created_by
    ) VALUES (
      v_credit_id,
      (p_payload->>'fecha_emision')::date,
      'pago',
      v_monto,
      'Cobro cheque #' || v_numero || ' ' || v_banco,
      v_check_id,
      auth.uid()
    ) RETURNING id INTO v_movement_id;

    UPDATE public.customers_credit
      SET saldo = saldo - v_monto
      WHERE id = v_credit_id
      RETURNING saldo INTO v_new_saldo;
  END IF;

  RETURN jsonb_build_object(
    'check_id', v_check_id,
    'customer_movement_id', v_movement_id,
    'nuevo_saldo_cliente', v_new_saldo
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_create_check_received(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_create_check_received(jsonb) TO authenticated;

-- ── rpc_admin_update_check (issued) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_update_check(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_check_id uuid := NULLIF(p_payload->>'check_id','')::uuid;
  v_current_status text;
  v_numero text := p_payload->>'numero';
  v_banco text := p_payload->>'banco';
  v_monto numeric;
BEGIN
  SELECT role, active INTO v_role, v_active
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized';
  END IF;

  IF v_check_id IS NULL THEN
    RAISE EXCEPTION 'check_id requerido' USING ERRCODE='22023';
  END IF;
  IF v_numero IS NULL OR length(trim(v_numero)) < 1 THEN
    RAISE EXCEPTION 'numero requerido' USING ERRCODE='22023';
  END IF;
  IF v_banco IS NULL OR length(trim(v_banco)) < 1 THEN
    RAISE EXCEPTION 'banco requerido' USING ERRCODE='22023';
  END IF;
  v_monto := (p_payload->>'monto')::numeric;
  IF v_monto IS NULL OR v_monto <= 0 THEN
    RAISE EXCEPTION 'monto debe ser positivo' USING ERRCODE='22023';
  END IF;

  SELECT estado INTO v_current_status
    FROM public.checks_issued WHERE id = v_check_id FOR UPDATE;
  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'Cheque no existe' USING ERRCODE='22023';
  END IF;
  IF v_current_status <> 'emitido' THEN
    RAISE EXCEPTION 'No se puede editar un cheque en estado %', v_current_status
      USING ERRCODE='42501', HINT='wrong_state';
  END IF;

  UPDATE public.checks_issued SET
    numero = v_numero,
    banco = v_banco,
    monto = v_monto,
    fecha_emision = (p_payload->>'fecha_emision')::date,
    fecha_cobro_estimada = NULLIF(p_payload->>'fecha_cobro_estimada','')::date,
    beneficiario_supplier_id = NULLIF(p_payload->>'beneficiario_supplier_id','')::uuid,
    beneficiario_texto = NULLIF(trim(p_payload->>'beneficiario_texto'),''),
    notas = NULLIF(trim(p_payload->>'notas'),'')
  WHERE id = v_check_id;

  RETURN jsonb_build_object('check_id', v_check_id, 'updated', true);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_update_check(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_update_check(jsonb) TO authenticated;

-- ── rpc_admin_delete_check (issued) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_delete_check(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_check_id uuid := NULLIF(p_payload->>'check_id','')::uuid;
  v_current_status text;
  v_has_movements boolean;
BEGIN
  SELECT role, active INTO v_role, v_active
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized';
  END IF;

  IF v_check_id IS NULL THEN
    RAISE EXCEPTION 'check_id requerido' USING ERRCODE='22023';
  END IF;

  SELECT estado INTO v_current_status
    FROM public.checks_issued WHERE id = v_check_id FOR UPDATE;
  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'Cheque no existe' USING ERRCODE='22023';
  END IF;
  IF v_current_status <> 'emitido' THEN
    RAISE EXCEPTION 'No se puede eliminar un cheque en estado %. Anulalo en cambio.', v_current_status
      USING ERRCODE='42501', HINT='wrong_state';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.suppliers_credit_movements WHERE check_id = v_check_id)
    INTO v_has_movements;
  IF v_has_movements THEN
    RAISE EXCEPTION 'No se puede eliminar: el cheque tiene movimientos asociados.'
      USING ERRCODE='42501', HINT='has_movements';
  END IF;

  DELETE FROM public.checks_issued WHERE id = v_check_id;
  RETURN jsonb_build_object('deleted', true, 'check_id', v_check_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_delete_check(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_delete_check(jsonb) TO authenticated;

-- ── rpc_admin_update_check_received ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_update_check_received(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_check_id uuid := NULLIF(p_payload->>'check_id','')::uuid;
  v_current_status text;
  v_numero text := p_payload->>'numero';
  v_banco text := p_payload->>'banco';
  v_monto numeric;
BEGIN
  SELECT role, active INTO v_role, v_active
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized';
  END IF;

  IF v_check_id IS NULL THEN RAISE EXCEPTION 'check_id requerido' USING ERRCODE='22023'; END IF;
  IF v_numero IS NULL OR length(trim(v_numero)) < 1 THEN
    RAISE EXCEPTION 'numero requerido' USING ERRCODE='22023';
  END IF;
  IF v_banco IS NULL OR length(trim(v_banco)) < 1 THEN
    RAISE EXCEPTION 'banco requerido' USING ERRCODE='22023';
  END IF;
  v_monto := (p_payload->>'monto')::numeric;
  IF v_monto IS NULL OR v_monto <= 0 THEN
    RAISE EXCEPTION 'monto debe ser positivo' USING ERRCODE='22023';
  END IF;

  SELECT estado INTO v_current_status
    FROM public.checks_received WHERE id = v_check_id FOR UPDATE;
  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'Cheque no existe' USING ERRCODE='22023';
  END IF;
  IF v_current_status <> 'emitido' THEN
    RAISE EXCEPTION 'No se puede editar un cheque en estado %', v_current_status
      USING ERRCODE='42501', HINT='wrong_state';
  END IF;

  UPDATE public.checks_received SET
    numero = v_numero,
    banco = v_banco,
    monto = v_monto,
    fecha_emision = (p_payload->>'fecha_emision')::date,
    fecha_cobro_estimada = NULLIF(p_payload->>'fecha_cobro_estimada','')::date,
    emisor_customer_b2b_id = NULLIF(p_payload->>'emisor_customer_b2b_id','')::uuid,
    emisor_texto = NULLIF(trim(p_payload->>'emisor_texto'),''),
    notas = NULLIF(trim(p_payload->>'notas'),'')
  WHERE id = v_check_id;

  RETURN jsonb_build_object('check_id', v_check_id, 'updated', true);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_update_check_received(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_update_check_received(jsonb) TO authenticated;

-- ── rpc_admin_delete_check_received ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_delete_check_received(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_check_id uuid := NULLIF(p_payload->>'check_id','')::uuid;
  v_current_status text;
  v_has_movements boolean;
BEGIN
  SELECT role, active INTO v_role, v_active
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized';
  END IF;

  IF v_check_id IS NULL THEN RAISE EXCEPTION 'check_id requerido' USING ERRCODE='22023'; END IF;

  SELECT estado INTO v_current_status
    FROM public.checks_received WHERE id = v_check_id FOR UPDATE;
  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'Cheque no existe' USING ERRCODE='22023';
  END IF;
  IF v_current_status <> 'emitido' THEN
    RAISE EXCEPTION 'No se puede eliminar un cheque en estado %. Anulalo en cambio.', v_current_status
      USING ERRCODE='42501', HINT='wrong_state';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.customers_credit_movements WHERE check_id = v_check_id)
    INTO v_has_movements;
  IF v_has_movements THEN
    RAISE EXCEPTION 'No se puede eliminar: el cheque tiene movimientos asociados.'
      USING ERRCODE='42501', HINT='has_movements';
  END IF;

  DELETE FROM public.checks_received WHERE id = v_check_id;
  RETURN jsonb_build_object('deleted', true, 'check_id', v_check_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_delete_check_received(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_delete_check_received(jsonb) TO authenticated;

-- ── rpc_admin_change_check_status (unificado) ───────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_change_check_status(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_check_type text := p_payload->>'check_type';
  v_check_id uuid   := NULLIF(p_payload->>'check_id','')::uuid;
  v_new_status text := p_payload->>'new_status';
  v_fecha_cambio date := COALESCE((p_payload->>'fecha_cambio')::date, current_date);
  v_generate boolean := COALESCE((p_payload->>'generate_movement')::boolean, true);
  v_notas text := NULLIF(trim(p_payload->>'notas'),'');
  v_current_status text;
  v_party_id uuid;
  v_monto numeric;
  v_numero text;
  v_banco text;
  v_credit_id uuid;
  v_movement_id uuid := NULL;
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

  IF v_check_id IS NULL THEN RAISE EXCEPTION 'check_id requerido' USING ERRCODE='22023'; END IF;
  IF v_check_type NOT IN ('issued','received') THEN
    RAISE EXCEPTION 'check_type invalido (issued|received)' USING ERRCODE='22023';
  END IF;
  IF v_new_status NOT IN ('cobrado','anulado','devuelto') THEN
    RAISE EXCEPTION 'new_status invalido (cobrado|anulado|devuelto)' USING ERRCODE='22023';
  END IF;

  IF v_check_type = 'issued' THEN
    SELECT estado, beneficiario_supplier_id, monto, numero, banco
      INTO v_current_status, v_party_id, v_monto, v_numero, v_banco
      FROM public.checks_issued WHERE id = v_check_id FOR UPDATE;
  ELSE
    SELECT estado, emisor_customer_b2b_id, monto, numero, banco
      INTO v_current_status, v_party_id, v_monto, v_numero, v_banco
      FROM public.checks_received WHERE id = v_check_id FOR UPDATE;
  END IF;
  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'Cheque no existe' USING ERRCODE='22023';
  END IF;

  IF v_current_status <> 'emitido' THEN
    RAISE EXCEPTION 'Cheque ya esta en estado %, no se puede cambiar', v_current_status
      USING ERRCODE='42501', HINT='wrong_state';
  END IF;

  IF v_check_type = 'issued' THEN
    UPDATE public.checks_issued SET
      estado = v_new_status,
      fecha_cobro    = CASE WHEN v_new_status = 'cobrado'  THEN v_fecha_cambio ELSE fecha_cobro    END,
      fecha_anulado  = CASE WHEN v_new_status = 'anulado'  THEN v_fecha_cambio ELSE fecha_anulado  END,
      fecha_devuelto = CASE WHEN v_new_status = 'devuelto' THEN v_fecha_cambio ELSE fecha_devuelto END,
      notas = CASE WHEN v_notas IS NULL THEN notas
                   ELSE COALESCE(notas || E'\n', '') || v_notas END
    WHERE id = v_check_id;
  ELSE
    UPDATE public.checks_received SET
      estado = v_new_status,
      fecha_cobro    = CASE WHEN v_new_status = 'cobrado'  THEN v_fecha_cambio ELSE fecha_cobro    END,
      fecha_anulado  = CASE WHEN v_new_status = 'anulado'  THEN v_fecha_cambio ELSE fecha_anulado  END,
      fecha_devuelto = CASE WHEN v_new_status = 'devuelto' THEN v_fecha_cambio ELSE fecha_devuelto END,
      notas = CASE WHEN v_notas IS NULL THEN notas
                   ELSE COALESCE(notas || E'\n', '') || v_notas END
    WHERE id = v_check_id;
  END IF;

  IF v_new_status = 'cobrado' AND v_generate AND v_party_id IS NOT NULL THEN
    IF v_check_type = 'issued' THEN
      SELECT id INTO v_credit_id FROM public.suppliers_credit
        WHERE supplier_id = v_party_id FOR UPDATE;
      IF v_credit_id IS NULL THEN
        INSERT INTO public.suppliers_credit (supplier_id) VALUES (v_party_id)
          RETURNING id INTO v_credit_id;
      END IF;
      INSERT INTO public.suppliers_credit_movements (
        supplier_credit_id, fecha, tipo, monto, concepto, check_id, created_by
      ) VALUES (
        v_credit_id, v_fecha_cambio, 'pago', v_monto,
        'Cobro cheque #' || v_numero || ' ' || v_banco,
        v_check_id, auth.uid()
      ) RETURNING id INTO v_movement_id;
      UPDATE public.suppliers_credit SET saldo = saldo - v_monto
        WHERE id = v_credit_id RETURNING saldo INTO v_new_saldo;
    ELSE
      SELECT id INTO v_credit_id FROM public.customers_credit
        WHERE customer_type = 'b2b' AND customer_b2b_id = v_party_id FOR UPDATE;
      IF v_credit_id IS NULL THEN
        INSERT INTO public.customers_credit (customer_type, customer_b2b_id)
          VALUES ('b2b', v_party_id) RETURNING id INTO v_credit_id;
      END IF;
      INSERT INTO public.customers_credit_movements (
        customer_credit_id, fecha, tipo, monto, concepto, check_id, created_by
      ) VALUES (
        v_credit_id, v_fecha_cambio, 'pago', v_monto,
        'Cobro cheque #' || v_numero || ' ' || v_banco,
        v_check_id, auth.uid()
      ) RETURNING id INTO v_movement_id;
      UPDATE public.customers_credit SET saldo = saldo - v_monto
        WHERE id = v_credit_id RETURNING saldo INTO v_new_saldo;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'check_id', v_check_id,
    'new_status', v_new_status,
    'movement_id', v_movement_id,
    'nuevo_saldo', v_new_saldo
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_change_check_status(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_change_check_status(jsonb) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual):
--   DROP FUNCTION IF EXISTS public.rpc_admin_change_check_status(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_admin_delete_check_received(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_admin_update_check_received(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_admin_create_check_received(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_admin_delete_check(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_admin_update_check(jsonb);
--   DROP INDEX IF EXISTS public.customers_credit_movements_check_idx;
--   ALTER TABLE public.customers_credit_movements DROP COLUMN IF EXISTS check_id;
--   DROP TRIGGER IF EXISTS checks_received_set_updated_at ON public.checks_received;
--   DROP TABLE IF EXISTS public.checks_received;
--   DROP TRIGGER IF EXISTS checks_issued_set_updated_at ON public.checks_issued;
--   ALTER TABLE public.checks_issued
--     DROP COLUMN IF EXISTS updated_at,
--     DROP COLUMN IF EXISTS fecha_devuelto,
--     DROP COLUMN IF EXISTS fecha_anulado,
--     DROP COLUMN IF EXISTS fecha_cobro;
-- ════════════════════════════════════════════════════════════════════
