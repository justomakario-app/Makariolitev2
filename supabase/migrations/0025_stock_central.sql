-- ════════════════════════════════════════════════════════════════════
-- ETAPA STOCK CENTRAL — Cambio 1 (Fase 1, Step 1)
-- ════════════════════════════════════════════════════════════════════
-- 4 cambios en una migration:
--   1) fn_resolve_active_jornada(channel_id, action_context, notify)
--      Helper que extrae la lógica común de "buscar jornada activa,
--      promover única abierta, o auto-crear con notificación opcional".
--      Usado por rpc_send_to_free_stock y rpc_transfer_between_channels.
--      p_notify=false suprime el INSERT a notifications (movimientos de
--      stock no notifican porque el caller es admin/encargado/owner —
--      no tiene sentido auto-notificarse a sí mismo y a sus pares).
--
--   2) rpc_send_to_free_stock — canal → stock central, ad hoc.
--      Admin/encargado/owner mueve X unidades de un SKU desde un canal
--      a free_stock. Valida disponibilidad contra carrier_state.stock.
--      Inserta log negativo [TO_FREE_STOCK] + upsert en free_stock.
--
--   3) rpc_transfer_between_channels — canal A → canal B, atómico.
--      Admin/encargado/owner transfiere directo entre canales sin
--      pasar por stock. Una transacción con 2 logs:
--      [TRANSFER_OUT to=X] en origen, [TRANSFER_IN from=X] en destino.
--
--   4) rpc_close_jornada v5 — default invertido.
--      Si p_disposiciones IS NULL → auto-dispose TODO sobrante a stock.
--      Si caller pasa algo (incluso '[]'::jsonb), usa lo que mandó.
--      Para preservar el viejo default "stay-in-channel", pasar
--      p_disposiciones='[]'::jsonb explícito.
--
-- Schema sin cambios (cero ALTER TABLE).
-- Idempotente (CREATE OR REPLACE FUNCTION).
-- ════════════════════════════════════════════════════════════════════


-- ── 1) HELPER: fn_resolve_active_jornada ─────────────────────────────
-- side-effecting: puede crear jornada nueva + jornada_audit + notifications.
-- Lanza exception si hay >1 jornada abierta sin activa.
-- p_notify=false suprime notifications (uso interno por movimientos de stock).
CREATE OR REPLACE FUNCTION public.fn_resolve_active_jornada(
  p_channel_id text,
  p_action_context text DEFAULT 'cargo sin jornada activa',
  p_notify boolean DEFAULT true
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $func$
DECLARE
  v_jornada_id    uuid;
  v_open_count    int;
  v_channel_label text;
BEGIN
  -- 1) Jornada activa explícita
  SELECT id INTO v_jornada_id
    FROM public.jornadas
    WHERE channel_id = p_channel_id AND status = 'abierta' AND is_active = true
    LIMIT 1;
  IF v_jornada_id IS NOT NULL THEN RETURN v_jornada_id; END IF;

  -- 2) Sin activa: contar abiertas
  SELECT count(*) INTO v_open_count
    FROM public.jornadas
    WHERE channel_id = p_channel_id AND status = 'abierta';

  IF v_open_count = 0 THEN
    INSERT INTO public.jornadas
      (channel_id, fecha, status, abierta_at, is_active, snapshot)
    VALUES
      (p_channel_id, current_date, 'abierta', now(), true, '[]'::jsonb)
    ON CONFLICT (channel_id, fecha) DO UPDATE
      SET status = EXCLUDED.status,
          abierta_at = COALESCE(public.jornadas.abierta_at, EXCLUDED.abierta_at),
          is_active = true
    RETURNING id INTO v_jornada_id;

    INSERT INTO public.jornada_audit (jornada_id, accion, motivo, by_user)
    VALUES (v_jornada_id, 'abierta',
            'Auto-apertura: ' || p_action_context, auth.uid());

    -- Notificar a admins/encargados solo si el caller lo pidió.
    -- Movimientos de stock NO notifican porque el caller ya es
    -- admin/encargado/owner — sería auto-notificación inútil.
    IF p_notify THEN
      SELECT label INTO v_channel_label FROM public.channels WHERE id = p_channel_id;
      INSERT INTO public.notifications (user_id, tipo, titulo, mensaje, link)
      SELECT p.id, 'sistema',
        format('Jornada %s abierta automaticamente', COALESCE(v_channel_label, p_channel_id)),
        format('Se abrio una jornada nueva de %s del %s porque %s %s.',
          COALESCE(v_channel_label, p_channel_id),
          to_char(current_date, 'DD/MM'),
          (SELECT name FROM public.profiles WHERE id = auth.uid()),
          p_action_context),
        format('/canal/%s', p_channel_id)
      FROM public.profiles p
      WHERE p.role IN ('owner','admin','encargado')
        AND p.active = true AND p.id <> auth.uid();
    END IF;

  ELSIF v_open_count = 1 THEN
    UPDATE public.jornadas SET is_active = true
      WHERE channel_id = p_channel_id AND status = 'abierta'
    RETURNING id INTO v_jornada_id;

    INSERT INTO public.jornada_audit (jornada_id, accion, motivo, by_user)
    VALUES (v_jornada_id, 'activada',
            'Auto-activacion (unica abierta): ' || p_action_context, auth.uid());
  ELSE
    RAISE EXCEPTION
      'Hay % jornadas abiertas en %, ninguna marcada como activa. Pedi al encargado que defina cual es la jornada activa.',
      v_open_count, p_channel_id
      USING ERRCODE='22023', HINT='no_active_jornada';
  END IF;

  RETURN v_jornada_id;
END;
$func$;

REVOKE ALL ON FUNCTION public.fn_resolve_active_jornada(text, text, boolean) FROM PUBLIC;
-- Sin GRANT a authenticated: solo se invoca internamente por otros RPCs SECURITY DEFINER.


-- ── 2) rpc_send_to_free_stock ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_send_to_free_stock(
  p_sku text,
  p_cantidad integer,
  p_source_channel_id text,
  p_motivo text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $func$
DECLARE
  v_role         role_enum;
  v_active_user  boolean;
  v_sector       text;
  v_stock_disp   int;
  v_jornada_id   uuid;
  v_source_label text;
BEGIN
  SELECT role, active INTO v_role, v_active_user
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active_user = false THEN
    RAISE EXCEPTION 'Tu sesion expiro o tu cuenta esta desactivada.'
      USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin','encargado') THEN
    RAISE EXCEPTION 'No tenes permiso para mover stock.'
      USING ERRCODE='42501', HINT='not_authorized';
  END IF;

  IF p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0.'
      USING ERRCODE='22023', HINT='invalid_qty';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sku_catalog WHERE sku = p_sku AND activo = true) THEN
    RAISE EXCEPTION 'SKU % no existe o esta inactivo.', p_sku
      USING ERRCODE='23503', HINT='sku_not_found';
  END IF;
  SELECT label INTO v_source_label
    FROM public.channels WHERE id = p_source_channel_id;
  IF v_source_label IS NULL THEN
    RAISE EXCEPTION 'El canal % no existe.', p_source_channel_id
      USING ERRCODE='23503', HINT='channel_not_found';
  END IF;

  SELECT COALESCE(stock, 0) INTO v_stock_disp
    FROM public.carrier_state
    WHERE channel_id = p_source_channel_id AND sku = p_sku;
  IF v_stock_disp < p_cantidad THEN
    RAISE EXCEPTION 'Solo hay % unidades de % en %. Pediste %.',
      v_stock_disp, p_sku, v_source_label, p_cantidad
      USING ERRCODE='22023', HINT='insufficient_channel_stock';
  END IF;

  v_jornada_id := public.fn_resolve_active_jornada(
    p_source_channel_id,
    'movio ' || p_cantidad || ' uds de ' || p_sku || ' a stock central',
    false  -- no notificar: caller es admin/encargado/owner
  );

  v_sector := public.role_to_sector(v_role);

  INSERT INTO public.production_logs
    (sku, channel_id, cantidad, operario_id, sector,
     fecha, hora, notas, jornada_id)
  VALUES
    (p_sku, p_source_channel_id, -p_cantidad, auth.uid(), v_sector,
     current_date, current_time,
     '[TO_FREE_STOCK]' ||
       CASE WHEN p_motivo IS NOT NULL AND length(trim(p_motivo)) > 0
         THEN ' motivo=' || trim(p_motivo) ELSE '' END,
     v_jornada_id);

  INSERT INTO public.free_stock (sku, source_jornada_id, cantidad)
  VALUES (p_sku, v_jornada_id, p_cantidad)
  ON CONFLICT (sku, source_jornada_id) DO UPDATE
    SET cantidad = public.free_stock.cantidad + EXCLUDED.cantidad;

  RETURN jsonb_build_object(
    'sku', p_sku,
    'cantidad', p_cantidad,
    'source_channel_id', p_source_channel_id,
    'source_jornada_id', v_jornada_id,
    'motivo', p_motivo
  );
END;
$func$;

REVOKE ALL ON FUNCTION public.rpc_send_to_free_stock(text, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_send_to_free_stock(text, integer, text, text) TO authenticated;


-- ── 3) rpc_transfer_between_channels ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_transfer_between_channels(
  p_sku text,
  p_cantidad integer,
  p_source_channel_id text,
  p_target_channel_id text,
  p_motivo text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $func$
DECLARE
  v_role            role_enum;
  v_active_user     boolean;
  v_sector          text;
  v_stock_disp      int;
  v_source_jornada  uuid;
  v_target_jornada  uuid;
  v_source_label    text;
  v_target_label    text;
  v_motivo_tag      text;
BEGIN
  SELECT role, active INTO v_role, v_active_user
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active_user = false THEN
    RAISE EXCEPTION 'Tu sesion expiro o tu cuenta esta desactivada.'
      USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin','encargado') THEN
    RAISE EXCEPTION 'No tenes permiso para mover stock.'
      USING ERRCODE='42501', HINT='not_authorized';
  END IF;

  IF p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0.'
      USING ERRCODE='22023', HINT='invalid_qty';
  END IF;
  IF p_source_channel_id = p_target_channel_id THEN
    RAISE EXCEPTION 'El canal origen y destino no pueden ser el mismo.'
      USING ERRCODE='22023', HINT='same_channel';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sku_catalog WHERE sku = p_sku AND activo = true) THEN
    RAISE EXCEPTION 'SKU % no existe o esta inactivo.', p_sku
      USING ERRCODE='23503', HINT='sku_not_found';
  END IF;
  SELECT label INTO v_source_label FROM public.channels WHERE id = p_source_channel_id;
  SELECT label INTO v_target_label FROM public.channels WHERE id = p_target_channel_id;
  IF v_source_label IS NULL THEN
    RAISE EXCEPTION 'El canal origen % no existe.', p_source_channel_id
      USING ERRCODE='23503', HINT='channel_not_found';
  END IF;
  IF v_target_label IS NULL THEN
    RAISE EXCEPTION 'El canal destino % no existe.', p_target_channel_id
      USING ERRCODE='23503', HINT='channel_not_found';
  END IF;

  SELECT COALESCE(stock, 0) INTO v_stock_disp
    FROM public.carrier_state
    WHERE channel_id = p_source_channel_id AND sku = p_sku;
  IF v_stock_disp < p_cantidad THEN
    RAISE EXCEPTION 'Solo hay % unidades de % en %. Pediste %.',
      v_stock_disp, p_sku, v_source_label, p_cantidad
      USING ERRCODE='22023', HINT='insufficient_channel_stock';
  END IF;

  v_source_jornada := public.fn_resolve_active_jornada(
    p_source_channel_id,
    'transfirio ' || p_cantidad || ' uds de ' || p_sku || ' hacia ' || v_target_label,
    false  -- no notificar
  );
  v_target_jornada := public.fn_resolve_active_jornada(
    p_target_channel_id,
    'recibio ' || p_cantidad || ' uds de ' || p_sku || ' desde ' || v_source_label,
    false  -- no notificar
  );

  v_sector := public.role_to_sector(v_role);
  v_motivo_tag := CASE
    WHEN p_motivo IS NOT NULL AND length(trim(p_motivo)) > 0
      THEN ' motivo=' || trim(p_motivo)
    ELSE ''
  END;

  INSERT INTO public.production_logs
    (sku, channel_id, cantidad, operario_id, sector,
     fecha, hora, notas, jornada_id)
  VALUES
    (p_sku, p_source_channel_id, -p_cantidad, auth.uid(), v_sector,
     current_date, current_time,
     '[TRANSFER_OUT to=' || p_target_channel_id || ']' || v_motivo_tag,
     v_source_jornada);

  INSERT INTO public.production_logs
    (sku, channel_id, cantidad, operario_id, sector,
     fecha, hora, notas, jornada_id)
  VALUES
    (p_sku, p_target_channel_id, p_cantidad, auth.uid(), v_sector,
     current_date, current_time,
     '[TRANSFER_IN from=' || p_source_channel_id || ']' || v_motivo_tag,
     v_target_jornada);

  RETURN jsonb_build_object(
    'sku', p_sku,
    'cantidad', p_cantidad,
    'source_channel_id', p_source_channel_id,
    'source_jornada_id', v_source_jornada,
    'target_channel_id', p_target_channel_id,
    'target_jornada_id', v_target_jornada,
    'motivo', p_motivo
  );
END;
$func$;

REVOKE ALL ON FUNCTION public.rpc_transfer_between_channels(text, integer, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_transfer_between_channels(text, integer, text, text, text) TO authenticated;


-- ── 4) rpc_close_jornada v5 — default invertido ──────────────────────
-- Cambio respecto a v4 (migration 0015):
--   - Nueva variable local v_disposiciones.
--   - Si p_disposiciones IS NULL → auto-genera para TODO SKU con stock>0
--     del snapshot (accion='free_stock' sin cantidad → toma todo).
--   - Si p_disposiciones NO es NULL → usa lo que mandó (incluso array vacío).
-- Resto del cuerpo idéntico a v4 (snapshot, auto-transfer is_active,
-- bucle disposiciones, arrastre orders, audit).
CREATE OR REPLACE FUNCTION public.rpc_close_jornada(
  p_channel_id text,
  p_fecha date DEFAULT NULL,
  p_disposiciones jsonb DEFAULT NULL
) RETURNS public.jornadas
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $func$
DECLARE
  v_role          role_enum;
  v_active_user   boolean;
  v_sector        text;
  v_fecha         date;
  v_jornada       public.jornadas;
  v_was_active    boolean;
  v_next_active   uuid;
  v_snapshot      jsonb;
  v_pedidos       int;
  v_unidades_p    int;
  v_unidades_d    int;
  v_faltante      int;
  v_order         record;
  v_next_fecha    date;
  v_dispo         jsonb;
  v_sku           text;
  v_stock_libre   int;
  v_disposiciones jsonb;  -- NUEVA en v5
BEGIN
  SELECT role, active INTO v_role, v_active_user
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active_user = false THEN
    RAISE EXCEPTION 'Tu sesion expiro o tu cuenta esta desactivada.'
      USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin','encargado') THEN
    RAISE EXCEPTION 'Solo owner, admin o encargado pueden cerrar jornadas.'
      USING ERRCODE='42501', HINT='not_authorized';
  END IF;

  v_fecha := COALESCE(p_fecha, current_date);

  IF NOT EXISTS (SELECT 1 FROM public.channels WHERE id = p_channel_id) THEN
    RAISE EXCEPTION 'El canal % no existe.', p_channel_id
      USING ERRCODE='23503', HINT='channel_not_found';
  END IF;

  SELECT * INTO v_jornada FROM public.jornadas
   WHERE channel_id = p_channel_id AND fecha = v_fecha
   FOR UPDATE;

  IF v_jornada.id IS NULL THEN
    RAISE EXCEPTION 'No existe jornada para % del %. Tenes que abrirla antes de cerrarla.',
      p_channel_id, to_char(v_fecha, 'DD/MM/YYYY')
      USING ERRCODE='22023', HINT='jornada_not_found';
  END IF;

  IF v_jornada.status = 'cerrada' THEN
    RAISE EXCEPTION 'La jornada de % del % ya esta cerrada.',
      p_channel_id, to_char(v_fecha, 'DD/MM/YYYY')
      USING ERRCODE='22023', HINT='already_closed';
  END IF;

  v_was_active := v_jornada.is_active;

  -- Snapshot por SKU (igual a v4)
  WITH skus_canal AS (
    SELECT sku FROM public.orders
     WHERE channel_id = p_channel_id AND status IN ('pendiente','arrastrado')
    UNION
    SELECT sku FROM public.production_logs
     WHERE jornada_id = v_jornada.id
  ),
  pedidos_por_sku AS (
    SELECT sku, COALESCE(SUM(cantidad), 0)::int AS pedido
      FROM public.orders
      WHERE channel_id = p_channel_id AND status IN ('pendiente','arrastrado')
      GROUP BY sku
  ),
  producido_por_sku AS (
    SELECT sku, COALESCE(SUM(cantidad), 0)::int AS producido
      FROM public.production_logs
      WHERE jornada_id = v_jornada.id
      GROUP BY sku
  ),
  rows AS (
    SELECT
      s.sku, sc.modelo, sc.color,
      COALESCE(p.pedido, 0) AS pedido,
      COALESCE(pr.producido, 0) AS producido,
      GREATEST(0, COALESCE(p.pedido, 0) - COALESCE(pr.producido, 0)) AS faltante,
      GREATEST(0, COALESCE(pr.producido, 0) - COALESCE(p.pedido, 0)) AS stock
    FROM skus_canal s
      LEFT JOIN public.sku_catalog sc ON sc.sku = s.sku
      LEFT JOIN pedidos_por_sku p ON p.sku = s.sku
      LEFT JOIN producido_por_sku pr ON pr.sku = s.sku
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'sku', sku, 'modelo', modelo, 'color', color,
      'pedido', pedido, 'producido', producido,
      'faltante', faltante, 'stock', stock
    ) ORDER BY sku), '[]'::jsonb),
    COALESCE(SUM(pedido), 0)::int,
    COALESCE(SUM(producido), 0)::int,
    COALESCE(SUM(faltante), 0)::int
  INTO v_snapshot, v_unidades_p, v_unidades_d, v_faltante
  FROM rows;

  SELECT count(*) INTO v_pedidos
  FROM public.orders
  WHERE channel_id = p_channel_id AND status IN ('pendiente','arrastrado');

  v_sector := public.role_to_sector(v_role);

  UPDATE public.jornadas
  SET status='cerrada', is_active=false,
      pedidos_count=v_pedidos, unidades_pedidas=v_unidades_p,
      unidades_producidas=v_unidades_d, faltante_arrastrado=v_faltante,
      snapshot=v_snapshot, closed_by=auth.uid(), closed_at=now()
  WHERE id = v_jornada.id
  RETURNING * INTO v_jornada;

  -- Auto-transfer is_active a siguiente jornada abierta (igual a v4)
  IF v_was_active THEN
    SELECT id INTO v_next_active
      FROM public.jornadas
      WHERE channel_id = p_channel_id AND status = 'abierta'
      ORDER BY fecha ASC
      LIMIT 1;
    IF v_next_active IS NOT NULL THEN
      UPDATE public.jornadas SET is_active = true WHERE id = v_next_active;
      INSERT INTO public.jornada_audit (jornada_id, accion, motivo, by_user)
      VALUES (v_next_active, 'activada',
              'Auto-activacion al cerrar la jornada activa anterior', auth.uid());
    END IF;
  END IF;

  -- v4->v5 CHANGE: si caller no pasó disposiciones → auto-genera para
  -- TODO SKU con stock>0 del snapshot. Si pasó algo (incluso array vacío),
  -- respetar lo que mandó.
  IF p_disposiciones IS NULL THEN
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('sku', e->>'sku', 'accion', 'free_stock')),
      '[]'::jsonb
    ) INTO v_disposiciones
    FROM jsonb_array_elements(v_snapshot) e
    WHERE COALESCE((e->>'stock')::int, 0) > 0;
  ELSE
    v_disposiciones := p_disposiciones;
  END IF;

  -- Disposiciones de sobrantes (cuerpo idéntico a v4, usa v_disposiciones)
  IF v_disposiciones IS NOT NULL THEN
    FOR v_dispo IN SELECT * FROM jsonb_array_elements(v_disposiciones)
    LOOP
      v_sku := v_dispo->>'sku';
      IF v_sku IS NULL THEN CONTINUE; END IF;

      IF (v_dispo->>'accion') = 'free_stock' THEN
        SELECT COALESCE((v_dispo->>'cantidad')::int,
                        (SELECT (e->>'stock')::int
                         FROM jsonb_array_elements(v_snapshot) e
                         WHERE e->>'sku' = v_sku))
        INTO v_stock_libre;

        IF v_stock_libre IS NULL OR v_stock_libre <= 0 THEN CONTINUE; END IF;

        INSERT INTO public.free_stock (sku, source_jornada_id, cantidad)
        VALUES (v_sku, v_jornada.id, v_stock_libre)
        ON CONFLICT (sku, source_jornada_id) DO UPDATE
          SET cantidad = public.free_stock.cantidad + EXCLUDED.cantidad;

        INSERT INTO public.production_logs
          (sku, channel_id, cantidad, operario_id, sector,
           fecha, hora, notas, jornada_id)
        VALUES
          (v_sku, p_channel_id, -v_stock_libre, auth.uid(), v_sector,
           current_date, current_time,
           '[FREE_STOCK] al_cerrar_jornada=' || v_jornada.id::text,
           v_jornada.id);
      END IF;
    END LOOP;
  END IF;

  -- Arrastre de orders pendientes (igual a v4)
  v_next_fecha := v_fecha + 1;

  FOR v_order IN
    SELECT o.id, o.channel_id, o.order_number, o.cliente, o.sku, o.cantidad
    FROM public.orders o
    WHERE o.channel_id = p_channel_id AND o.status IN ('pendiente','arrastrado')
  LOOP
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_snapshot) AS e
      WHERE e->>'sku' = v_order.sku
        AND COALESCE((e->>'faltante')::int, 0) > 0
    ) THEN
      INSERT INTO public.orders
        (channel_id, order_number, cliente, sku, cantidad, fecha_pedido, status)
      VALUES (
        v_order.channel_id,
        v_order.order_number || '-A' || to_char(v_fecha, 'YYYYMMDD'),
        v_order.cliente, v_order.sku, v_order.cantidad,
        v_next_fecha, 'arrastrado'
      )
      ON CONFLICT (channel_id, order_number, sku) DO NOTHING;
    END IF;

    UPDATE public.orders
       SET status='archivado', jornada_id=v_jornada.id
     WHERE id = v_order.id;
  END LOOP;

  INSERT INTO public.jornada_audit (jornada_id, accion, by_user)
  VALUES (v_jornada.id, 'cerrada', auth.uid());

  RETURN v_jornada;
END;
$func$;

REVOKE ALL ON FUNCTION public.rpc_close_jornada(text, date, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_close_jornada(text, date, jsonb) TO authenticated;


-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual, NO ejecutar sin entender la regresión):
-- 1) DROP FUNCTION public.rpc_send_to_free_stock(text, integer, text, text);
-- 2) DROP FUNCTION public.rpc_transfer_between_channels(text, integer, text, text, text);
-- 3) DROP FUNCTION public.fn_resolve_active_jornada(text, text, boolean);
-- 4) Re-aplicar rpc_close_jornada v4 desde migration 0015.
-- ════════════════════════════════════════════════════════════════════
