-- ════════════════════════════════════════════════════════════════════
-- ADMIN MODULE — Checks Bulk Import (S2.5)
-- ════════════════════════════════════════════════════════════════════
-- 7 RPCs nuevos:
--   ISSUED:
--     1) rpc_admin_check_checks_issued_exist(p_payload jsonb)
--     2) rpc_admin_bulk_create_checks_issued(p_payload jsonb)
--     3) rpc_admin_bulk_update_checks_issued(p_payload jsonb)
--   RECEIVED:
--     4) rpc_admin_check_checks_received_exist(p_payload jsonb)
--     5) rpc_admin_bulk_create_checks_received(p_payload jsonb)
--     6) rpc_admin_bulk_update_checks_received(p_payload jsonb)
--   HELPER:
--     7) rpc_admin_resolve_entities_by_cuit(p_cuits text[], p_entity_type text)
--
-- Decisiones aplicadas:
--   #1 Plantilla received con emisor_* (2 cols).
--   #2 Mapeo de sinonimos de estado defensivo en RPC (CASE WHEN).
--   #3 SIN UNIQUE constraint nueva en BD (solo deteccion frontend).
--   #4 Signo movement = RESTA (saldo = saldo - v_monto) consistente
--      con rpc_admin_create_check ya en produccion.
--
-- Patron comun:
--   - SECURITY DEFINER + search_path explicito.
--   - Auth gate (sesion + role IN ('owner','admin')).
--   - No-atomico: subtransaccion BEGIN/EXCEPTION por item.
--   - bulk_update rechaza cambio de numero/banco/monto/fecha_emision
--     con reason='check_immutable'.
--   - generar_movement por item (default false en el payload).
--   - tipo movement = 'pago', monto positivo, signo via SALDO -= monto.
--   - Cero ALTER de tablas.
-- ════════════════════════════════════════════════════════════════════

-- ── (1) rpc_admin_check_checks_issued_exist ─────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_check_checks_issued_exist(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_pairs jsonb := COALESCE(p_payload->'pairs', '[]'::jsonb);
  v_existing jsonb;
  v_not_existing jsonb;
BEGIN
  SELECT role, active INTO v_role, v_active
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized';
  END IF;

  IF jsonb_typeof(v_pairs) <> 'array' THEN
    RAISE EXCEPTION 'pairs debe ser array' USING ERRCODE='22023';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'numero', ci.numero, 'banco', ci.banco, 'id', ci.id,
    'monto', ci.monto, 'estado', ci.estado,
    'fecha_emision', ci.fecha_emision
  )), '[]'::jsonb) INTO v_existing
  FROM public.checks_issued ci
  JOIN (
    SELECT (elem->>'numero')::text AS numero, (elem->>'banco')::text AS banco
    FROM jsonb_array_elements(v_pairs) AS elem
  ) t ON t.numero = ci.numero AND t.banco = ci.banco;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('numero', t.numero, 'banco', t.banco)), '[]'::jsonb)
    INTO v_not_existing
  FROM (
    SELECT (elem->>'numero')::text AS numero, (elem->>'banco')::text AS banco
    FROM jsonb_array_elements(v_pairs) AS elem
  ) t
  LEFT JOIN public.checks_issued ci
    ON ci.numero = t.numero AND ci.banco = t.banco
  WHERE ci.id IS NULL;

  RETURN jsonb_build_object('existing', v_existing, 'not_existing', v_not_existing);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_check_checks_issued_exist(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_check_checks_issued_exist(jsonb) TO authenticated;

-- ── (2) rpc_admin_bulk_create_checks_issued ─────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_bulk_create_checks_issued(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_items jsonb := COALESCE(p_payload->'items', '[]'::jsonb);
  v_count_created int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_check_id uuid;
  v_movement_id uuid;
  v_credit_id uuid;
  v_supplier_id uuid;
  v_monto numeric;
  v_numero text;
  v_banco text;
  v_estado_raw text;
  v_estado text;
  v_concepto text;
  v_generar_movement boolean;
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
      v_supplier_id := NULLIF(v_item->>'beneficiario_supplier_id', '')::uuid;
      v_monto       := (v_item->>'monto')::numeric;
      v_numero      := NULLIF(trim(v_item->>'numero'), '');
      v_banco       := NULLIF(trim(v_item->>'banco'), '');
      v_generar_movement := COALESCE((v_item->>'generar_movement')::boolean, false);

      v_estado_raw := lower(trim(COALESCE(v_item->>'estado', '')));
      v_estado := CASE v_estado_raw
        WHEN ''           THEN 'emitido'
        WHEN 'pendiente'  THEN 'emitido'
        WHEN 'emitido'    THEN 'emitido'
        WHEN 'cobrado'    THEN 'cobrado'
        WHEN 'pagado'     THEN 'cobrado'
        WHEN 'rechazado'  THEN 'devuelto'
        WHEN 'devuelto'   THEN 'devuelto'
        WHEN 'anulado'    THEN 'anulado'
        WHEN 'cancelado'  THEN 'anulado'
        ELSE NULL
      END;
      IF v_estado IS NULL THEN
        RAISE EXCEPTION 'Estado desconocido: %', v_estado_raw USING ERRCODE='22023';
      END IF;

      INSERT INTO public.checks_issued (
        numero, banco, monto, fecha_emision, fecha_cobro_estimada,
        beneficiario_supplier_id, beneficiario_texto, estado, notas, created_by
      ) VALUES (
        v_numero, v_banco, v_monto,
        (v_item->>'fecha_emision')::date,
        NULLIF(v_item->>'fecha_cobro_estimada', '')::date,
        v_supplier_id,
        NULLIF(trim(v_item->>'beneficiario_texto'), ''),
        v_estado,
        NULLIF(trim(v_item->>'notas'), ''),
        auth.uid()
      ) RETURNING id INTO v_check_id;

      IF v_generar_movement AND v_supplier_id IS NOT NULL THEN
        SELECT id INTO v_credit_id FROM public.suppliers_credit
          WHERE supplier_id = v_supplier_id FOR UPDATE;
        IF v_credit_id IS NULL THEN
          INSERT INTO public.suppliers_credit (supplier_id)
          VALUES (v_supplier_id)
          RETURNING id INTO v_credit_id;
        END IF;

        v_concepto := COALESCE(
          NULLIF(trim(v_item->>'concepto'), ''),
          'Pago con cheque ' || v_numero || ' ' || v_banco
        );

        INSERT INTO public.suppliers_credit_movements (
          supplier_credit_id, fecha, tipo, monto, concepto, check_id, created_by
        ) VALUES (
          v_credit_id, (v_item->>'fecha_emision')::date,
          'pago', v_monto, v_concepto, v_check_id, auth.uid()
        ) RETURNING id INTO v_movement_id;

        UPDATE public.suppliers_credit
          SET saldo = saldo - v_monto
          WHERE id = v_credit_id;
      END IF;

      v_count_created := v_count_created + 1;
    EXCEPTION
      WHEN unique_violation THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'index', v_index, 'reason', 'duplicate_check',
          'numero', v_item->>'numero', 'banco', v_item->>'banco'));
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

REVOKE EXECUTE ON FUNCTION public.rpc_admin_bulk_create_checks_issued(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_bulk_create_checks_issued(jsonb) TO authenticated;

-- ── (3) rpc_admin_bulk_update_checks_issued ─────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_bulk_update_checks_issued(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_items jsonb := COALESCE(p_payload->'items', '[]'::jsonb);
  v_count_updated int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_item jsonb;
  v_index int := 0;
  v_id uuid;
  v_current record;
  v_estado_raw text;
  v_estado text;
  v_field_immutable text;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  IF jsonb_typeof(v_items) <> 'array' THEN
    RAISE EXCEPTION 'items debe ser array' USING ERRCODE='22023'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
    v_field_immutable := NULL;
    BEGIN
      v_id := NULLIF(v_item->>'id', '')::uuid;
      IF v_id IS NULL THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'index', v_index, 'reason', 'missing_id'));
      ELSE
        SELECT numero, banco, monto, fecha_emision
          INTO v_current
          FROM public.checks_issued WHERE id = v_id FOR UPDATE;
        IF NOT FOUND THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object(
            'index', v_index, 'reason', 'not_found', 'id', v_id::text));
        ELSE
          IF v_item ? 'numero' AND NULLIF(trim(v_item->>'numero'),'') IS DISTINCT FROM v_current.numero THEN
            v_field_immutable := 'numero';
          ELSIF v_item ? 'banco' AND NULLIF(trim(v_item->>'banco'),'') IS DISTINCT FROM v_current.banco THEN
            v_field_immutable := 'banco';
          ELSIF v_item ? 'monto' AND NULLIF(v_item->>'monto','')::numeric IS DISTINCT FROM v_current.monto THEN
            v_field_immutable := 'monto';
          ELSIF v_item ? 'fecha_emision' AND NULLIF(v_item->>'fecha_emision','')::date IS DISTINCT FROM v_current.fecha_emision THEN
            v_field_immutable := 'fecha_emision';
          END IF;

          IF v_field_immutable IS NOT NULL THEN
            v_errors := v_errors || jsonb_build_array(jsonb_build_object(
              'index', v_index, 'reason', 'check_immutable',
              'field', v_field_immutable,
              'detail', 'El campo ' || v_field_immutable || ' no se puede modificar post-alta del cheque'));
          ELSE
            v_estado := NULL;
            IF v_item ? 'estado' THEN
              v_estado_raw := lower(trim(COALESCE(v_item->>'estado','')));
              v_estado := CASE v_estado_raw
                WHEN ''           THEN NULL
                WHEN 'pendiente'  THEN 'emitido'
                WHEN 'emitido'    THEN 'emitido'
                WHEN 'cobrado'    THEN 'cobrado'
                WHEN 'pagado'     THEN 'cobrado'
                WHEN 'rechazado'  THEN 'devuelto'
                WHEN 'devuelto'   THEN 'devuelto'
                WHEN 'anulado'    THEN 'anulado'
                WHEN 'cancelado'  THEN 'anulado'
                ELSE '__INVALID__'
              END;
              IF v_estado = '__INVALID__' THEN
                RAISE EXCEPTION 'Estado desconocido: %', v_estado_raw USING ERRCODE='22023';
              END IF;
            END IF;

            UPDATE public.checks_issued SET
              fecha_cobro_estimada = CASE WHEN v_item ? 'fecha_cobro_estimada'
                                          THEN NULLIF(v_item->>'fecha_cobro_estimada','')::date
                                          ELSE fecha_cobro_estimada END,
              fecha_cobro          = CASE WHEN v_item ? 'fecha_cobro'
                                          THEN NULLIF(v_item->>'fecha_cobro','')::date
                                          ELSE fecha_cobro END,
              fecha_anulado        = CASE WHEN v_item ? 'fecha_anulado'
                                          THEN NULLIF(v_item->>'fecha_anulado','')::date
                                          ELSE fecha_anulado END,
              fecha_devuelto       = CASE WHEN v_item ? 'fecha_devuelto'
                                          THEN NULLIF(v_item->>'fecha_devuelto','')::date
                                          ELSE fecha_devuelto END,
              beneficiario_supplier_id = CASE WHEN v_item ? 'beneficiario_supplier_id'
                                              THEN NULLIF(v_item->>'beneficiario_supplier_id','')::uuid
                                              ELSE beneficiario_supplier_id END,
              beneficiario_texto   = CASE WHEN v_item ? 'beneficiario_texto'
                                          THEN NULLIF(trim(v_item->>'beneficiario_texto'),'')
                                          ELSE beneficiario_texto END,
              estado               = CASE WHEN v_estado IS NOT NULL THEN v_estado ELSE estado END,
              notas                = CASE WHEN v_item ? 'notas'
                                          THEN NULLIF(trim(v_item->>'notas'),'')
                                          ELSE notas END
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

REVOKE EXECUTE ON FUNCTION public.rpc_admin_bulk_update_checks_issued(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_bulk_update_checks_issued(jsonb) TO authenticated;

-- ── (4) rpc_admin_check_checks_received_exist ───────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_check_checks_received_exist(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_pairs jsonb := COALESCE(p_payload->'pairs', '[]'::jsonb);
  v_existing jsonb;
  v_not_existing jsonb;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  IF jsonb_typeof(v_pairs) <> 'array' THEN
    RAISE EXCEPTION 'pairs debe ser array' USING ERRCODE='22023'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'numero', cr.numero, 'banco', cr.banco, 'id', cr.id,
    'monto', cr.monto, 'estado', cr.estado,
    'fecha_emision', cr.fecha_emision
  )), '[]'::jsonb) INTO v_existing
  FROM public.checks_received cr
  JOIN (
    SELECT (elem->>'numero')::text AS numero, (elem->>'banco')::text AS banco
    FROM jsonb_array_elements(v_pairs) AS elem
  ) t ON t.numero = cr.numero AND t.banco = cr.banco;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('numero', t.numero, 'banco', t.banco)), '[]'::jsonb)
    INTO v_not_existing
  FROM (
    SELECT (elem->>'numero')::text AS numero, (elem->>'banco')::text AS banco
    FROM jsonb_array_elements(v_pairs) AS elem
  ) t
  LEFT JOIN public.checks_received cr ON cr.numero = t.numero AND cr.banco = t.banco
  WHERE cr.id IS NULL;

  RETURN jsonb_build_object('existing', v_existing, 'not_existing', v_not_existing);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_check_checks_received_exist(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_check_checks_received_exist(jsonb) TO authenticated;

-- ── (5) rpc_admin_bulk_create_checks_received ───────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_bulk_create_checks_received(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_items jsonb := COALESCE(p_payload->'items', '[]'::jsonb);
  v_count_created int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_check_id uuid;
  v_movement_id uuid;
  v_credit_id uuid;
  v_customer_id uuid;
  v_monto numeric;
  v_numero text;
  v_banco text;
  v_estado_raw text;
  v_estado text;
  v_concepto text;
  v_generar_movement boolean;
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
      v_customer_id := NULLIF(v_item->>'emisor_customer_b2b_id', '')::uuid;
      v_monto       := (v_item->>'monto')::numeric;
      v_numero      := NULLIF(trim(v_item->>'numero'), '');
      v_banco       := NULLIF(trim(v_item->>'banco'), '');
      v_generar_movement := COALESCE((v_item->>'generar_movement')::boolean, false);

      v_estado_raw := lower(trim(COALESCE(v_item->>'estado', '')));
      v_estado := CASE v_estado_raw
        WHEN ''           THEN 'emitido'
        WHEN 'pendiente'  THEN 'emitido'
        WHEN 'emitido'    THEN 'emitido'
        WHEN 'cobrado'    THEN 'cobrado'
        WHEN 'pagado'     THEN 'cobrado'
        WHEN 'rechazado'  THEN 'devuelto'
        WHEN 'devuelto'   THEN 'devuelto'
        WHEN 'anulado'    THEN 'anulado'
        WHEN 'cancelado'  THEN 'anulado'
        ELSE NULL
      END;
      IF v_estado IS NULL THEN
        RAISE EXCEPTION 'Estado desconocido: %', v_estado_raw USING ERRCODE='22023';
      END IF;

      INSERT INTO public.checks_received (
        numero, banco, monto, fecha_emision, fecha_cobro_estimada,
        emisor_customer_b2b_id, emisor_texto, estado, notas, created_by
      ) VALUES (
        v_numero, v_banco, v_monto,
        (v_item->>'fecha_emision')::date,
        NULLIF(v_item->>'fecha_cobro_estimada', '')::date,
        v_customer_id,
        NULLIF(trim(v_item->>'emisor_texto'), ''),
        v_estado,
        NULLIF(trim(v_item->>'notas'), ''),
        auth.uid()
      ) RETURNING id INTO v_check_id;

      IF v_generar_movement AND v_customer_id IS NOT NULL THEN
        SELECT id INTO v_credit_id FROM public.customers_credit
          WHERE customer_type = 'b2b' AND customer_b2b_id = v_customer_id FOR UPDATE;
        IF v_credit_id IS NULL THEN
          INSERT INTO public.customers_credit (customer_type, customer_b2b_id)
          VALUES ('b2b', v_customer_id)
          RETURNING id INTO v_credit_id;
        END IF;

        v_concepto := COALESCE(
          NULLIF(trim(v_item->>'concepto'), ''),
          'Cobro cheque ' || v_numero || ' ' || v_banco
        );

        INSERT INTO public.customers_credit_movements (
          customer_credit_id, fecha, tipo, monto, concepto, check_id, created_by
        ) VALUES (
          v_credit_id, (v_item->>'fecha_emision')::date,
          'pago', v_monto, v_concepto, v_check_id, auth.uid()
        ) RETURNING id INTO v_movement_id;

        UPDATE public.customers_credit
          SET saldo = saldo - v_monto
          WHERE id = v_credit_id;
      END IF;

      v_count_created := v_count_created + 1;
    EXCEPTION
      WHEN unique_violation THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'index', v_index, 'reason', 'duplicate_check',
          'numero', v_item->>'numero', 'banco', v_item->>'banco'));
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

REVOKE EXECUTE ON FUNCTION public.rpc_admin_bulk_create_checks_received(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_bulk_create_checks_received(jsonb) TO authenticated;

-- ── (6) rpc_admin_bulk_update_checks_received ───────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_bulk_update_checks_received(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_items jsonb := COALESCE(p_payload->'items', '[]'::jsonb);
  v_count_updated int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_item jsonb;
  v_index int := 0;
  v_id uuid;
  v_current record;
  v_estado_raw text;
  v_estado text;
  v_field_immutable text;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  IF jsonb_typeof(v_items) <> 'array' THEN
    RAISE EXCEPTION 'items debe ser array' USING ERRCODE='22023'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
    v_field_immutable := NULL;
    BEGIN
      v_id := NULLIF(v_item->>'id', '')::uuid;
      IF v_id IS NULL THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'index', v_index, 'reason', 'missing_id'));
      ELSE
        SELECT numero, banco, monto, fecha_emision
          INTO v_current
          FROM public.checks_received WHERE id = v_id FOR UPDATE;
        IF NOT FOUND THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object(
            'index', v_index, 'reason', 'not_found', 'id', v_id::text));
        ELSE
          IF v_item ? 'numero' AND NULLIF(trim(v_item->>'numero'),'') IS DISTINCT FROM v_current.numero THEN
            v_field_immutable := 'numero';
          ELSIF v_item ? 'banco' AND NULLIF(trim(v_item->>'banco'),'') IS DISTINCT FROM v_current.banco THEN
            v_field_immutable := 'banco';
          ELSIF v_item ? 'monto' AND NULLIF(v_item->>'monto','')::numeric IS DISTINCT FROM v_current.monto THEN
            v_field_immutable := 'monto';
          ELSIF v_item ? 'fecha_emision' AND NULLIF(v_item->>'fecha_emision','')::date IS DISTINCT FROM v_current.fecha_emision THEN
            v_field_immutable := 'fecha_emision';
          END IF;

          IF v_field_immutable IS NOT NULL THEN
            v_errors := v_errors || jsonb_build_array(jsonb_build_object(
              'index', v_index, 'reason', 'check_immutable',
              'field', v_field_immutable,
              'detail', 'El campo ' || v_field_immutable || ' no se puede modificar post-alta del cheque'));
          ELSE
            v_estado := NULL;
            IF v_item ? 'estado' THEN
              v_estado_raw := lower(trim(COALESCE(v_item->>'estado','')));
              v_estado := CASE v_estado_raw
                WHEN ''           THEN NULL
                WHEN 'pendiente'  THEN 'emitido'
                WHEN 'emitido'    THEN 'emitido'
                WHEN 'cobrado'    THEN 'cobrado'
                WHEN 'pagado'     THEN 'cobrado'
                WHEN 'rechazado'  THEN 'devuelto'
                WHEN 'devuelto'   THEN 'devuelto'
                WHEN 'anulado'    THEN 'anulado'
                WHEN 'cancelado'  THEN 'anulado'
                ELSE '__INVALID__'
              END;
              IF v_estado = '__INVALID__' THEN
                RAISE EXCEPTION 'Estado desconocido: %', v_estado_raw USING ERRCODE='22023';
              END IF;
            END IF;

            UPDATE public.checks_received SET
              fecha_cobro_estimada = CASE WHEN v_item ? 'fecha_cobro_estimada'
                                          THEN NULLIF(v_item->>'fecha_cobro_estimada','')::date
                                          ELSE fecha_cobro_estimada END,
              fecha_cobro          = CASE WHEN v_item ? 'fecha_cobro'
                                          THEN NULLIF(v_item->>'fecha_cobro','')::date
                                          ELSE fecha_cobro END,
              fecha_anulado        = CASE WHEN v_item ? 'fecha_anulado'
                                          THEN NULLIF(v_item->>'fecha_anulado','')::date
                                          ELSE fecha_anulado END,
              fecha_devuelto       = CASE WHEN v_item ? 'fecha_devuelto'
                                          THEN NULLIF(v_item->>'fecha_devuelto','')::date
                                          ELSE fecha_devuelto END,
              emisor_customer_b2b_id = CASE WHEN v_item ? 'emisor_customer_b2b_id'
                                            THEN NULLIF(v_item->>'emisor_customer_b2b_id','')::uuid
                                            ELSE emisor_customer_b2b_id END,
              emisor_texto         = CASE WHEN v_item ? 'emisor_texto'
                                          THEN NULLIF(trim(v_item->>'emisor_texto'),'')
                                          ELSE emisor_texto END,
              estado               = CASE WHEN v_estado IS NOT NULL THEN v_estado ELSE estado END,
              notas                = CASE WHEN v_item ? 'notas'
                                          THEN NULLIF(trim(v_item->>'notas'),'')
                                          ELSE notas END
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

REVOKE EXECUTE ON FUNCTION public.rpc_admin_bulk_update_checks_received(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_bulk_update_checks_received(jsonb) TO authenticated;

-- ── (7) rpc_admin_resolve_entities_by_cuit ──────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_resolve_entities_by_cuit(
  p_cuits text[], p_entity_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_matches jsonb;
  v_unmatched jsonb;
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  IF p_entity_type NOT IN ('supplier','customer_b2b') THEN
    RAISE EXCEPTION 'entity_type debe ser supplier o customer_b2b' USING ERRCODE='22023';
  END IF;

  IF p_entity_type = 'supplier' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'cuit', s.cuit, 'id', s.id, 'nombre', s.nombre, 'activo', s.activo
    )), '[]'::jsonb) INTO v_matches
    FROM public.suppliers s
    WHERE s.cuit = ANY(p_cuits);

    SELECT COALESCE(jsonb_agg(c), '[]'::jsonb) INTO v_unmatched
    FROM (
      SELECT unnest(p_cuits) AS c
      EXCEPT
      SELECT cuit FROM public.suppliers WHERE cuit IS NOT NULL
    ) sub;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'cuit', cb.cuit, 'id', cb.id, 'nombre', cb.nombre, 'activo', cb.activo
    )), '[]'::jsonb) INTO v_matches
    FROM public.customers_b2b cb
    WHERE cb.cuit = ANY(p_cuits);

    SELECT COALESCE(jsonb_agg(c), '[]'::jsonb) INTO v_unmatched
    FROM (
      SELECT unnest(p_cuits) AS c
      EXCEPT
      SELECT cuit FROM public.customers_b2b WHERE cuit IS NOT NULL
    ) sub;
  END IF;

  RETURN jsonb_build_object('matches', v_matches, 'unmatched', v_unmatched);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_resolve_entities_by_cuit(text[], text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_resolve_entities_by_cuit(text[], text) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual):
--   DROP FUNCTION IF EXISTS public.rpc_admin_resolve_entities_by_cuit(text[], text);
--   DROP FUNCTION IF EXISTS public.rpc_admin_bulk_update_checks_received(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_admin_bulk_create_checks_received(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_admin_check_checks_received_exist(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_admin_bulk_update_checks_issued(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_admin_bulk_create_checks_issued(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_admin_check_checks_issued_exist(jsonb);
-- ════════════════════════════════════════════════════════════════════
