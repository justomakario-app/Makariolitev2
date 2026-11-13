-- ════════════════════════════════════════════════════════════════════
-- 0178 — RRHH: el valor del dia se puede editar en cada recibo
-- ════════════════════════════════════════════════════════════════════
-- Hasta hoy el "Valor del dia" del recibo no existia como dato: el modal y el PDF
-- lo calculaban al vuelo como sueldo_basico / 30 y el campo estaba bloqueado. El
-- backend nunca lo uso; solo servia para precargar el valor_unitario del item
-- "Dias trabajados" (ese valor_unitario SI queda guardado dentro de items).
--
-- Esta migracion agrega recibos.valor_dia, propio de cada recibo:
--   · NULL  = recibo de antes de la 0178, o que nadie edito. Se sigue mostrando
--             sueldo_basico/30, asi que los recibos existentes no cambian en nada:
--             el ALTER no reescribe filas y no dispara el trigger de auditoria.
--   · > 0   = valor cargado a mano en ESE recibo. No toca employees ni otros recibos.
--
-- rpc_admin_create_recibo y rpc_admin_update_recibo se re-emiten como copia LITERAL
-- de su ultima version viva (0076 y 0064) mas cuatro agregados marcados "0178":
-- la variable, el bloque de validacion, la escritura de la columna y valor_dia
-- en la respuesta (asi el front sabe que la columna existe y quedo guardada). Siguen
-- exigiendo owner/admin activo, rechazando anulados y periodos cerrados, en el mismo
-- orden de antes: un valor_dia invalido nunca se evalua antes que el permiso.
-- tests/rrhh-export-test.js verifica que la diferencia sea exactamente esa.
--
-- Quien/cuando/antes/despues: lo registra el trigger recibos_audit_log_trg
-- (0060 -> trg_audit_log de la 0053), que guarda la fila completa antes y despues
-- con auth.uid(). La columna nueva entra sola en ese jsonb.
--
-- Depende de: 0060 (recibos), 0064 (update_recibo), 0076 (create_recibo).
-- Rollback al pie.
-- ════════════════════════════════════════════════════════════════════

begin;

ALTER TABLE public.recibos ADD COLUMN IF NOT EXISTS valor_dia numeric(14,2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'recibos_valor_dia_positivo'
                    AND conrelid = 'public.recibos'::regclass) THEN
    ALTER TABLE public.recibos
      ADD CONSTRAINT recibos_valor_dia_positivo CHECK (valor_dia IS NULL OR valor_dia > 0);
  END IF;
END $$;

COMMENT ON COLUMN public.recibos.valor_dia IS
  '0178: valor del dia propio del recibo. NULL = se usa sueldo_basico/30 (recibos anteriores o no editados). Solo lo escriben rpc_admin_create_recibo / rpc_admin_update_recibo cuando el payload trae la clave valor_dia.';

-- create_recibo: copia de la 0076 + valor_dia
CREATE OR REPLACE FUNCTION public.rpc_admin_create_recibo(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_role role_enum; v_active boolean;
  v_employee public.employees%ROWTYPE;
  v_employee_id uuid := NULLIF(p_payload->>'employee_id','')::uuid;
  v_tipo text := NULLIF(trim(p_payload->>'tipo'),'');
  v_items jsonb := COALESCE(p_payload->'items', '[]'::jsonb);
  v_total numeric(14,2); v_recibo_id uuid;
  v_periodo_desde date; v_periodo_hasta date;
  v_fecha_pago_check date;
  v_valor_dia numeric; -- 0178
BEGIN
  SELECT role, active INTO v_role, v_active FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  v_fecha_pago_check := COALESCE(NULLIF(p_payload->>'fecha_pago','')::date, CURRENT_DATE);
  IF public._admin_check_periodo_cerrado(v_fecha_pago_check) THEN
    RAISE EXCEPTION 'Periodo contable cerrado para esa fecha de pago.' USING ERRCODE='42501', HINT='periodo_cerrado'; END IF;
  IF v_employee_id IS NULL THEN RAISE EXCEPTION 'employee_id requerido' USING ERRCODE='22023', HINT='employee_required'; END IF;
  IF v_tipo NOT IN ('adelanto','quincena','sueldo') THEN RAISE EXCEPTION 'Tipo invalido (adelanto/quincena/sueldo)' USING ERRCODE='22023', HINT='invalid_tipo'; END IF;
  IF jsonb_typeof(v_items) <> 'array' THEN RAISE EXCEPTION 'items debe ser un array' USING ERRCODE='22023', HINT='items_array'; END IF;
  SELECT * INTO v_employee FROM public.employees WHERE id = v_employee_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Empleado no existe' USING ERRCODE='22023', HINT='employee_not_found'; END IF;
  v_periodo_desde := NULLIF(p_payload->>'periodo_desde','')::date;
  v_periodo_hasta := NULLIF(p_payload->>'periodo_hasta','')::date;
  IF v_periodo_desde IS NULL OR v_periodo_hasta IS NULL THEN RAISE EXCEPTION 'periodo_desde y periodo_hasta requeridos' USING ERRCODE='22023', HINT='periodo_required'; END IF;
  -- 0178: valor del dia propio del recibo ─────────────────────────────
  -- Clave ausente o null = no se toca nada: en create queda NULL (el recibo
  -- sigue mostrando sueldo_basico/30, igual que antes de la 0178) y en update
  -- conserva lo guardado. Ninguna otra RPC escribe esta columna.
  IF COALESCE(jsonb_typeof(p_payload->'valor_dia'), 'null') <> 'null' THEN
    IF jsonb_typeof(p_payload->'valor_dia') NOT IN ('number','string')
       OR trim(p_payload->>'valor_dia') !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
      RAISE EXCEPTION 'El valor del dia tiene que ser un numero (ej: 1500.50).'
        USING ERRCODE='22023', HINT='valor_dia_invalido'; END IF;
    v_valor_dia := trim(p_payload->>'valor_dia')::numeric;
    IF v_valor_dia <= 0 THEN
      RAISE EXCEPTION 'El valor del dia tiene que ser mayor a 0.'
        USING ERRCODE='22023', HINT='valor_dia_invalido'; END IF;
    IF v_valor_dia >= 1000000000000 THEN
      RAISE EXCEPTION 'El valor del dia esta fuera de rango.'
        USING ERRCODE='22023', HINT='valor_dia_invalido'; END IF;
    IF v_valor_dia <> round(v_valor_dia, 2) THEN
      RAISE EXCEPTION 'El valor del dia admite hasta 2 decimales.'
        USING ERRCODE='22023', HINT='valor_dia_invalido'; END IF;
  END IF;
  -- /0178
  v_total := COALESCE(NULLIF(p_payload->>'total','')::numeric,
    (SELECT COALESCE(SUM((item->>'subtotal')::numeric), 0) FROM jsonb_array_elements(v_items) AS item));
  INSERT INTO public.recibos (employee_id, empleado_dni, empleado_nombre, empleado_categoria, empleado_fecha_ingreso,
    tipo, periodo_desde, periodo_hasta, fecha_pago, sueldo_basico, items, total, notas, created_by, valor_dia) VALUES (
    v_employee_id, COALESCE(v_employee.dni, ''), v_employee.nombre, v_employee.categoria, v_employee.fecha_ingreso,
    v_tipo, v_periodo_desde, v_periodo_hasta, v_fecha_pago_check,
    COALESCE(NULLIF(p_payload->>'sueldo_basico','')::numeric, v_employee.sueldo_bruto_base, 0),
    v_items, v_total, NULLIF(trim(p_payload->>'notas'),''), auth.uid(), v_valor_dia
  ) RETURNING id INTO v_recibo_id;
  RETURN jsonb_build_object('recibo_id', v_recibo_id, 'total', v_total, 'valor_dia', v_valor_dia); -- 0178
END; $function$;

-- update_recibo: copia de la 0064 + valor_dia
CREATE OR REPLACE FUNCTION public.rpc_admin_update_recibo(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_role role_enum; v_active boolean;
  v_id uuid := NULLIF(p_payload->>'id','')::uuid;
  v_estado_actual text; v_items jsonb; v_total numeric(14,2);
  v_fecha_actual date; v_fecha_nueva date;
  v_valor_dia numeric; -- 0178
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

  -- 0178: valor del dia propio del recibo ─────────────────────────────
  -- Clave ausente o null = no se toca nada: en create queda NULL (el recibo
  -- sigue mostrando sueldo_basico/30, igual que antes de la 0178) y en update
  -- conserva lo guardado. Ninguna otra RPC escribe esta columna.
  IF COALESCE(jsonb_typeof(p_payload->'valor_dia'), 'null') <> 'null' THEN
    IF jsonb_typeof(p_payload->'valor_dia') NOT IN ('number','string')
       OR trim(p_payload->>'valor_dia') !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
      RAISE EXCEPTION 'El valor del dia tiene que ser un numero (ej: 1500.50).'
        USING ERRCODE='22023', HINT='valor_dia_invalido'; END IF;
    v_valor_dia := trim(p_payload->>'valor_dia')::numeric;
    IF v_valor_dia <= 0 THEN
      RAISE EXCEPTION 'El valor del dia tiene que ser mayor a 0.'
        USING ERRCODE='22023', HINT='valor_dia_invalido'; END IF;
    IF v_valor_dia >= 1000000000000 THEN
      RAISE EXCEPTION 'El valor del dia esta fuera de rango.'
        USING ERRCODE='22023', HINT='valor_dia_invalido'; END IF;
    IF v_valor_dia <> round(v_valor_dia, 2) THEN
      RAISE EXCEPTION 'El valor del dia admite hasta 2 decimales.'
        USING ERRCODE='22023', HINT='valor_dia_invalido'; END IF;
  END IF;
  -- /0178

  v_total := COALESCE(NULLIF(p_payload->>'total','')::numeric,
    (SELECT COALESCE(SUM((item->>'subtotal')::numeric), 0) FROM jsonb_array_elements(v_items) AS item));

  UPDATE public.recibos SET
    items = v_items, total = v_total,
    valor_dia = COALESCE(v_valor_dia, valor_dia), -- 0178
    fecha_pago = CASE WHEN p_payload ? 'fecha_pago' THEN NULLIF(p_payload->>'fecha_pago','')::date ELSE fecha_pago END,
    notas = CASE WHEN p_payload ? 'notas' THEN NULLIF(trim(p_payload->>'notas'),'') ELSE notas END,
    pdf_generado_at = CASE WHEN p_payload ? 'pdf_generado_at' THEN NULLIF(p_payload->>'pdf_generado_at','')::timestamptz ELSE pdf_generado_at END
  WHERE id = v_id;

  RETURN jsonb_build_object('recibo_id', v_id, 'updated', true, 'total', v_total,
    'valor_dia', (SELECT valor_dia FROM public.recibos WHERE id = v_id)); -- 0178
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_create_recibo(jsonb) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.rpc_admin_update_recibo(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_create_recibo(jsonb) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_update_recibo(jsonb) TO authenticated;

commit;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual, en este orden, dentro de begin/commit):
--   1. Si hay valores editados que se quieran conservar, sacarlos antes:
--        SELECT id, valor_dia FROM public.recibos WHERE valor_dia IS NOT NULL;
--      (Los importes NO se pierden: viven en items[].valor_unitario y en total.
--       Lo unico que vuelve atras es el "Valor del dia" mostrado: sueldo/30.)
--   2. Re-emitir rpc_admin_create_recibo tal como esta en la 0076 y
--      rpc_admin_update_recibo tal como esta en la 0064 (copiar los bloques).
--   3. ALTER TABLE public.recibos DROP CONSTRAINT IF EXISTS recibos_valor_dia_positivo;
--      ALTER TABLE public.recibos DROP COLUMN IF EXISTS valor_dia;
--   El front nuevo sin la columna sigue funcionando: valor_dia llega undefined y
--   cae a sueldo/30, el modal detecta que falta la columna y deja el campo
--   bloqueado (y si igual se mandara, avisa que no se guardo). No hace falta
--   volver el front atras, aunque se puede.
-- ════════════════════════════════════════════════════════════════════
