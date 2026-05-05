-- ════════════════════════════════════════════════════════════════════
-- POST-ETAPAS FIXES — bugs encontrados en diagnóstico del 2026-05-04
-- ════════════════════════════════════════════════════════════════════
-- B2: rpc_close_jornada v4 — al cerrar una jornada is_active, transferir
--     la marca a la siguiente jornada abierta del mismo canal (la más
--     vieja por fecha). Esto cumple lo que dice el documento del cliente:
--     "Si la jornada cerrada todavía tenía la marca de 'activa para
--     producción', el sistema la pasa automáticamente a la siguiente
--     jornada abierta del mismo canal — para que el rolling siga sin
--     huecos."
--
-- B6: rpc_register_production v3 — cuando auto-crea jornada (caso
--     "0 abiertas en el canal"), generar notificación para owner +
--     admin + encargado, así el equipo se entera. El documento promete
--     esa notificación en la FAQ.
-- ════════════════════════════════════════════════════════════════════

-- ── B2: rpc_close_jornada v4 ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_close_jornada(
  p_channel_id text,
  p_fecha date DEFAULT NULL,
  p_disposiciones jsonb DEFAULT NULL
) RETURNS public.jornadas
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $func$
DECLARE
  v_role        role_enum;
  v_active_user boolean;
  v_sector      text;
  v_fecha       date;
  v_jornada     public.jornadas;
  v_was_active  boolean;
  v_next_active uuid;
  v_snapshot    jsonb;
  v_pedidos     int;
  v_unidades_p  int;
  v_unidades_d  int;
  v_faltante    int;
  v_order       record;
  v_next_fecha  date;
  v_dispo       jsonb;
  v_sku         text;
  v_stock_libre int;
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

  -- Snapshot por SKU (igual que v3)
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

  -- ── B2 FIX: si la cerrada era is_active, transferir a la siguiente
  -- abierta del canal (la más vieja por fecha asc).
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
              'Auto-activación al cerrar la jornada activa anterior', auth.uid());
    END IF;
  END IF;

  -- Disposiciones de sobrantes (igual que v3)
  IF p_disposiciones IS NOT NULL THEN
    FOR v_dispo IN SELECT * FROM jsonb_array_elements(p_disposiciones)
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

-- ── B6: rpc_register_production v3 ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_register_production(
  p_sku text,
  p_channel_id text,
  p_cantidad integer,
  p_notas text DEFAULT NULL,
  p_jornada_id uuid DEFAULT NULL
) RETURNS public.production_logs
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $func$
DECLARE
  v_role           role_enum;
  v_active_user    boolean;
  v_sector         text;
  v_log            public.production_logs;
  v_jornada_id     uuid;
  v_open_count     int;
  v_jornada_row    public.jornadas;
  v_auto_created   boolean := false;
  v_channel_label  text;
BEGIN
  SELECT role, active INTO v_role, v_active_user
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado o sin profile' USING ERRCODE='42501';
  END IF;
  IF v_active_user = false THEN
    RAISE EXCEPTION 'Usuario desactivado' USING ERRCODE='42501';
  END IF;

  IF p_cantidad = 0 THEN
    RAISE EXCEPTION 'cantidad no puede ser 0' USING ERRCODE='22023';
  END IF;
  IF p_sku IS NULL OR p_channel_id IS NULL THEN
    RAISE EXCEPTION 'sku y channel_id son obligatorios' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sku_catalog WHERE sku = p_sku AND activo = true) THEN
    RAISE EXCEPTION 'SKU % no existe o esta inactivo', p_sku USING ERRCODE='23503';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.channels WHERE id = p_channel_id) THEN
    RAISE EXCEPTION 'channel_id % no existe', p_channel_id USING ERRCODE='23503';
  END IF;

  IF p_jornada_id IS NOT NULL THEN
    SELECT * INTO v_jornada_row FROM public.jornadas
     WHERE id = p_jornada_id FOR SHARE;
    IF v_jornada_row.id IS NULL THEN
      RAISE EXCEPTION 'La jornada elegida no existe.'
        USING ERRCODE='23503', HINT='jornada_invalid';
    END IF;
    IF v_jornada_row.channel_id <> p_channel_id THEN
      RAISE EXCEPTION 'La jornada elegida es del canal %, no de %.',
        v_jornada_row.channel_id, p_channel_id
        USING ERRCODE='22023', HINT='jornada_wrong_channel';
    END IF;
    IF v_jornada_row.status = 'cerrada' THEN
      RAISE EXCEPTION 'No podes cargar a una jornada cerrada (% del %).',
        v_jornada_row.channel_id, to_char(v_jornada_row.fecha, 'DD/MM')
        USING ERRCODE='22023', HINT='jornada_cerrada';
    END IF;
    v_jornada_id := p_jornada_id;
  ELSE
    SELECT id INTO v_jornada_id
      FROM public.jornadas
      WHERE channel_id = p_channel_id AND status = 'abierta' AND is_active = true
      LIMIT 1;

    IF v_jornada_id IS NULL THEN
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

        v_auto_created := true;

        INSERT INTO public.jornada_audit (jornada_id, accion, motivo, by_user)
        VALUES (v_jornada_id, 'abierta',
                'Auto-apertura por carga sin jornada activa', auth.uid());
      ELSIF v_open_count = 1 THEN
        UPDATE public.jornadas SET is_active = true
         WHERE channel_id = p_channel_id AND status = 'abierta'
        RETURNING id INTO v_jornada_id;

        INSERT INTO public.jornada_audit (jornada_id, accion, motivo, by_user)
        VALUES (v_jornada_id, 'activada',
                'Auto-activación (única abierta del canal)', auth.uid());
      ELSE
        RAISE EXCEPTION
          'Hay % jornadas abiertas en %, ninguna marcada como activa. Pedi al encargado que defina cual es la jornada activa.',
          v_open_count, p_channel_id
          USING ERRCODE='22023', HINT='no_active_jornada';
      END IF;
    END IF;
  END IF;

  v_sector := public.role_to_sector(v_role);

  INSERT INTO public.production_logs
    (sku, channel_id, cantidad, operario_id, sector, fecha, hora, notas, jornada_id)
  VALUES
    (p_sku, p_channel_id, p_cantidad, auth.uid(), v_sector,
     current_date, current_time,
     NULLIF(trim(coalesce(p_notas, '')), ''),
     v_jornada_id)
  RETURNING * INTO v_log;

  -- ── B6 FIX: notificar a admins cuando el sistema auto-crea jornada
  IF v_auto_created THEN
    SELECT label INTO v_channel_label FROM public.channels WHERE id = p_channel_id;
    INSERT INTO public.notifications (user_id, tipo, titulo, mensaje, link)
    SELECT p.id, 'sistema',
      format('Jornada %s abierta automaticamente', COALESCE(v_channel_label, p_channel_id)),
      format('Se abrio una jornada nueva de %s del %s porque %s cargo sin jornada activa.',
        COALESCE(v_channel_label, p_channel_id),
        to_char(current_date, 'DD/MM'),
        (SELECT name FROM public.profiles WHERE id = auth.uid())),
      format('/canal/%s', p_channel_id)
    FROM public.profiles p
    WHERE p.role IN ('owner','admin','encargado') AND p.active = true AND p.id <> auth.uid();
  END IF;

  -- Notificación si faltante=0 (lógica existente preservada)
  IF EXISTS (
    SELECT 1 FROM public.carrier_state
    WHERE channel_id = p_channel_id AND sku = p_sku AND faltante = 0 AND pedido > 0
  ) THEN
    INSERT INTO public.notifications (user_id, tipo, titulo, mensaje, link)
    SELECT p.id, 'produccion',
      'Producción completada',
      format('Se completó el faltante para %s en %s.', p_sku, p_channel_id),
      format('/canal/%s', p_channel_id)
    FROM public.profiles p
    WHERE p.role IN ('owner','encargado') AND p.active = true;
  END IF;

  RETURN v_log;
END;
$func$;

REVOKE ALL ON FUNCTION public.rpc_register_production(text, text, integer, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_register_production(text, text, integer, text, uuid) TO authenticated;
