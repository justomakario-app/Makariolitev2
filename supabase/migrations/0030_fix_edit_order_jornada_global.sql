-- ════════════════════════════════════════════════════════════════════
-- FIX — rpc_edit_order branch ELSE sin filtro de canal post-2A
-- ════════════════════════════════════════════════════════════════════
-- Migration 0028 dropeó la columna jornadas.channel_id. rpc_edit_order
-- (creado en 0019) NO fue reescrito en 0029, y su branch ELSE (cuando
-- la order tiene jornada_id=NULL) hace:
--
--   SELECT id INTO v_active_jornada
--     FROM public.jornadas
--     WHERE channel_id = p_channel_id      ← columna inexistente post-0028
--       AND status = 'abierta'
--       AND is_active = true
--
-- Esto falla en runtime con `column "channel_id" does not exist` si
-- alguien edita un pedido con jornada_id=NULL (orden Excel pre-2A o
-- legacy).
--
-- Cambio MÍNIMO: solo el WHERE de ese SELECT pierde el filtro por
-- channel_id. El RPC queda BIT-PERFECT respecto a la versión 0019
-- salvo esa línea y el comentario inmediato anterior. Todo lo demás
-- (firma, DECLARE, validaciones, lock, IF-branch de jornada cerrada,
-- mensaje del RAISE, UPDATE de orders, loops MODIFICAR/QUITAR/AGREGAR,
-- INSERT en order_edit_log, notificación, RETURN, REVOKE/GRANT)
-- queda IDÉNTICO al original.
--
-- NO se reescribe ningún otro RPC.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rpc_edit_order(
  p_channel_id    text,
  p_order_number  text,
  p_cambios       jsonb,
  p_motivo        text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $func$
DECLARE
  v_role            role_enum;
  v_active_user     boolean;
  v_user_name       text;
  v_channel_label   text;
  v_pedido_existe   boolean;
  v_jornada_id      uuid;
  v_jornada_status  jornada_status_enum;
  v_jornada_fecha   date;
  v_jornada_label   text;
  v_active_jornada  uuid;
  v_modificar       jsonb;
  v_agregar         jsonb;
  v_quitar          jsonb;
  v_change          jsonb;
  v_sku             text;
  v_cant_nueva      int;
  v_cant_anterior   int;
  v_version_in      int;
  v_motivo_clean    text;
  v_existing_cliente text;
  v_changes_count   int := 0;
  v_log_count       int := 0;
  v_items_out       jsonb := '[]'::jsonb;
  v_row             record;
BEGIN
  -- ── Auth ──
  SELECT role, active, name INTO v_role, v_active_user, v_user_name
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active_user = false THEN
    RAISE EXCEPTION 'Tu sesion expiro o tu cuenta esta desactivada.'
      USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin','encargado') THEN
    RAISE EXCEPTION 'No tenes permiso para editar pedidos.'
      USING ERRCODE='42501', HINT='not_authorized';
  END IF;

  -- ── Channel ──
  SELECT label INTO v_channel_label FROM public.channels WHERE id = p_channel_id;
  IF v_channel_label IS NULL THEN
    RAISE EXCEPTION 'El canal % no existe.', p_channel_id
      USING ERRCODE='23503', HINT='channel_not_found';
  END IF;
  IF p_channel_id = 'distribuidor' THEN
    RAISE EXCEPTION 'Distribuidor esta fuera del scope de edicion.'
      USING ERRCODE='22023', HINT='out_of_scope';
  END IF;

  -- ── Pedido existe ──
  SELECT EXISTS (
    SELECT 1 FROM public.orders
    WHERE channel_id = p_channel_id AND order_number = p_order_number
  ) INTO v_pedido_existe;
  IF NOT v_pedido_existe THEN
    RAISE EXCEPTION 'El pedido % no existe en %.', p_order_number, v_channel_label
      USING ERRCODE='23503', HINT='order_not_found';
  END IF;

  -- ── Lock + leer jornada del pedido (todos los items deberían tener la misma) ──
  -- Lock de los rows del pedido para evitar race con otra edición concurrente.
  PERFORM 1 FROM public.orders
   WHERE channel_id = p_channel_id AND order_number = p_order_number
   FOR UPDATE;

  -- Tomar la jornada_id de cualquier item del pedido (todos comparten el mismo)
  SELECT jornada_id, cliente INTO v_jornada_id, v_existing_cliente
    FROM public.orders
    WHERE channel_id = p_channel_id AND order_number = p_order_number
    LIMIT 1;

  -- ── Resolver jornada destino ──
  -- Si los items tienen jornada_id NULL (típico Excel pre-cierre), usar la
  -- jornada activa del canal. Si no hay activa, error claro.
  -- Si tienen jornada_id seteado y está cerrada → bloqueo placeholder.
  IF v_jornada_id IS NOT NULL THEN
    SELECT status, fecha INTO v_jornada_status, v_jornada_fecha
      FROM public.jornadas WHERE id = v_jornada_id;
    IF v_jornada_status = 'cerrada' THEN
      RAISE EXCEPTION 'Este pedido esta en una jornada cerrada (% del %). Pediselo a un admin (el flujo de ajuste post-cierre se va a implementar proximamente).',
        v_channel_label, to_char(v_jornada_fecha, 'DD/MM')
        USING ERRCODE='42501', HINT='jornada_cerrada';
    END IF;
    -- Jornada abierta: usar esa misma como destino de cambios.
    v_active_jornada := v_jornada_id;
  ELSE
    -- Cambio 2A/2B: jornadas son GLOBALES (sin channel_id). Si la order
    -- no tiene jornada asignada (Excel pre-cierre o legacy), buscamos
    -- la activa global. Único cambio respecto a 0019: el WHERE de este
    -- SELECT pierde `channel_id = p_channel_id AND`.
    SELECT id INTO v_active_jornada
      FROM public.jornadas
      WHERE status = 'abierta' AND is_active = true
      LIMIT 1;
    IF v_active_jornada IS NULL THEN
      RAISE EXCEPTION 'No hay jornada activa para %. Pedile al encargado que abra una antes de editar.', v_channel_label
        USING ERRCODE='22023', HINT='no_active_jornada';
    END IF;
    -- Vincular todos los items del pedido a la jornada activa antes de editar
    UPDATE public.orders
       SET jornada_id = v_active_jornada
     WHERE channel_id = p_channel_id AND order_number = p_order_number AND jornada_id IS NULL;
  END IF;

  -- ── Parsear cambios ──
  v_modificar := COALESCE(p_cambios->'modificar', '[]'::jsonb);
  v_agregar   := COALESCE(p_cambios->'agregar',   '[]'::jsonb);
  v_quitar    := COALESCE(p_cambios->'quitar',    '[]'::jsonb);

  IF jsonb_array_length(v_modificar) = 0
     AND jsonb_array_length(v_agregar) = 0
     AND jsonb_array_length(v_quitar) = 0 THEN
    RAISE EXCEPTION 'No hay cambios para aplicar.'
      USING ERRCODE='22023', HINT='no_changes';
  END IF;

  v_motivo_clean := NULLIF(trim(coalesce(p_motivo, '')), '');

  -- ── MODIFICAR (con optimistic locking + log atómico) ──
  FOR v_change IN SELECT * FROM jsonb_array_elements(v_modificar) LOOP
    v_sku := upper(trim(v_change->>'sku'));
    v_cant_nueva := (v_change->>'cantidad_nueva')::int;
    v_version_in := (v_change->>'version')::int;

    IF v_cant_nueva IS NULL OR v_cant_nueva <= 0 THEN
      RAISE EXCEPTION 'cantidad_nueva debe ser > 0 para % (si queres quitar el item, usa quitar).', v_sku
        USING ERRCODE='22023', HINT='invalid_qty';
    END IF;

    -- Leer cantidad actual antes del UPDATE (para log)
    SELECT cantidad INTO v_cant_anterior
      FROM public.orders
      WHERE channel_id = p_channel_id AND order_number = p_order_number AND sku = v_sku;

    -- UPDATE con check de version
    UPDATE public.orders
       SET cantidad = v_cant_nueva, version = version + 1
     WHERE channel_id = p_channel_id
       AND order_number = p_order_number
       AND sku = v_sku
       AND version = v_version_in;

    IF NOT FOUND THEN
      -- Verificar si fue version mismatch o item no existe
      IF v_cant_anterior IS NULL THEN
        RAISE EXCEPTION 'El item % no existe en pedido %.', v_sku, p_order_number
          USING ERRCODE='23503', HINT='item_not_found';
      ELSE
        RAISE EXCEPTION 'Este pedido fue modificado por otro usuario mientras editabas. Recarga la pantalla para ver los cambios actuales.'
          USING ERRCODE='40001', HINT='concurrent_edit';
      END IF;
    END IF;

    -- INSERT log (atómico con UPDATE — si falla, rollback total)
    INSERT INTO public.order_edit_log
      (channel_id, order_number, sku, evento, cantidad_anterior, cantidad_nueva, motivo, by_user)
    VALUES
      (p_channel_id, p_order_number, v_sku, 'cantidad_changed', v_cant_anterior, v_cant_nueva, v_motivo_clean, auth.uid());

    v_changes_count := v_changes_count + 1;
    v_log_count := v_log_count + 1;
  END LOOP;

  -- ── QUITAR (con optimistic locking + log atómico) ──
  FOR v_change IN SELECT * FROM jsonb_array_elements(v_quitar) LOOP
    v_sku := upper(trim(v_change->>'sku'));
    v_version_in := (v_change->>'version')::int;

    SELECT cantidad INTO v_cant_anterior
      FROM public.orders
      WHERE channel_id = p_channel_id AND order_number = p_order_number AND sku = v_sku;

    DELETE FROM public.orders
     WHERE channel_id = p_channel_id
       AND order_number = p_order_number
       AND sku = v_sku
       AND version = v_version_in;

    IF NOT FOUND THEN
      IF v_cant_anterior IS NULL THEN
        RAISE EXCEPTION 'El item % no existe en pedido %.', v_sku, p_order_number
          USING ERRCODE='23503', HINT='item_not_found';
      ELSE
        RAISE EXCEPTION 'Este pedido fue modificado por otro usuario mientras editabas. Recarga la pantalla.'
          USING ERRCODE='40001', HINT='concurrent_edit';
      END IF;
    END IF;

    INSERT INTO public.order_edit_log
      (channel_id, order_number, sku, evento, cantidad_anterior, cantidad_nueva, motivo, by_user)
    VALUES
      (p_channel_id, p_order_number, v_sku, 'item_removed', v_cant_anterior, NULL, v_motivo_clean, auth.uid());

    v_changes_count := v_changes_count + 1;
    v_log_count := v_log_count + 1;
  END LOOP;

  -- ── AGREGAR (no aplica optimistic locking — son items nuevos) ──
  FOR v_change IN SELECT * FROM jsonb_array_elements(v_agregar) LOOP
    v_sku := upper(trim(v_change->>'sku'));
    v_cant_nueva := (v_change->>'cantidad')::int;

    IF v_sku IS NULL OR v_sku = '' THEN
      RAISE EXCEPTION 'Hay un item nuevo sin SKU.'
        USING ERRCODE='22023', HINT='empty_sku';
    END IF;
    IF v_cant_nueva IS NULL OR v_cant_nueva <= 0 THEN
      RAISE EXCEPTION 'La cantidad de % debe ser > 0.', v_sku
        USING ERRCODE='22023', HINT='invalid_qty';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.sku_catalog WHERE sku = v_sku AND activo = true) THEN
      RAISE EXCEPTION 'SKU % no existe o esta inactivo.', v_sku
        USING ERRCODE='23503', HINT='sku_not_found';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.orders
      WHERE channel_id = p_channel_id AND order_number = p_order_number AND sku = v_sku
    ) THEN
      RAISE EXCEPTION 'El item % ya existe en pedido %. Usa modificar en vez de agregar.', v_sku, p_order_number
        USING ERRCODE='23505', HINT='item_already_exists';
    END IF;

    INSERT INTO public.orders
      (channel_id, order_number, cliente, sku, cantidad,
       fecha_pedido, status, jornada_id, origen, version, created_by)
    VALUES (
      p_channel_id, p_order_number, v_existing_cliente, v_sku, v_cant_nueva,
      current_date, 'pendiente', v_active_jornada, 'manual', 1, auth.uid()
    );

    INSERT INTO public.order_edit_log
      (channel_id, order_number, sku, evento, cantidad_anterior, cantidad_nueva, motivo, by_user)
    VALUES
      (p_channel_id, p_order_number, v_sku, 'item_added', NULL, v_cant_nueva, v_motivo_clean, auth.uid());

    v_changes_count := v_changes_count + 1;
    v_log_count := v_log_count + 1;
  END LOOP;

  -- ── Construir items finales ──
  FOR v_row IN
    SELECT sku, cantidad, version FROM public.orders
    WHERE channel_id = p_channel_id AND order_number = p_order_number
    ORDER BY sku
  LOOP
    v_items_out := v_items_out || jsonb_build_object('sku', v_row.sku, 'cantidad', v_row.cantidad, 'version', v_row.version);
  END LOOP;

  -- ── Notificación ──
  INSERT INTO public.notifications (user_id, tipo, titulo, mensaje, link)
  SELECT p.id, 'sistema',
    format('Pedido %s editado en %s', p_order_number, v_channel_label),
    format('%s aplico %s cambio(s) sobre el pedido %s%s',
      v_user_name, v_changes_count, p_order_number,
      COALESCE(' - ' || v_motivo_clean, '')),
    format('/canal/%s', p_channel_id)
  FROM public.profiles p
  WHERE p.role IN ('owner','encargado') AND p.active = true AND p.id <> auth.uid();

  RETURN jsonb_build_object(
    'order_number',     p_order_number,
    'channel_id',       p_channel_id,
    'changes_applied',  v_changes_count,
    'log_entries',      v_log_count,
    'items_after_edit', v_items_out
  );
END;
$func$;

REVOKE ALL ON FUNCTION public.rpc_edit_order(text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_edit_order(text, text, jsonb, text) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual, si los tests fallan o si descubrimos regresión):
-- Re-aplicar la versión original de rpc_edit_order desde migration 0019
-- (el bloque ELSE incluía `WHERE channel_id = p_channel_id AND ...` que
-- rompe post-0028).
-- ════════════════════════════════════════════════════════════════════
