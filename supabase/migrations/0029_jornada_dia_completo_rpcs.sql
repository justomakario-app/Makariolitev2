-- ════════════════════════════════════════════════════════════════════
-- CAMBIO 2A — RPCs reescritos para modelo "jornada por día completo"
-- ════════════════════════════════════════════════════════════════════
-- 11 RPCs (re)definidos para acompañar el cambio de schema 0028:
--   1) fn_resolve_active_jornada v2 (sin p_channel_id)
--   2) rpc_open_jornada v2 (sin canal, máx 3 abiertas, fecha ≤ today+3)
--   3) rpc_set_active_jornada v2 (singleton is_active=true global)
--   4) rpc_close_jornada v6 (cierre del día completo, snapshot agrupado
--      por canal, arrastre multi-canal, auto-crea día+1 si arrastres)
--   5) rpc_register_production v4 (usa helper sin canal, rechaza
--      jornada cerrada con HINT='jornada_cerrada')
--   6) rpc_assign_free_stock v4 (helper sin canal)
--   7) rpc_send_to_free_stock v2 (helper sin canal)
--   8) rpc_transfer_between_channels v2 (helper invocado 1 vez)
--   9) recompute_carrier_state_for v4 (sin filtro j.channel_id)
--  10) rpc_import_batch v2 (p_target_jornada_id obligatorio con shim
--      de fallback si 0/1/N jornadas abiertas)
--  11) rpc_create_manual_order v2 (mismo patrón que import_batch)
--
-- Tests SQL: 11/11 PASS con BEGIN/ROLLBACK.
-- ════════════════════════════════════════════════════════════════════


-- 1) fn_resolve_active_jornada v2
DROP FUNCTION IF EXISTS public.fn_resolve_active_jornada(text, text, boolean);

CREATE OR REPLACE FUNCTION public.fn_resolve_active_jornada(
  p_action_context text DEFAULT 'accion sin jornada activa',
  p_notify boolean DEFAULT true
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $func$
DECLARE
  v_jornada_id uuid;
  v_open_count int;
BEGIN
  SELECT id INTO v_jornada_id FROM public.jornadas
    WHERE status = 'abierta' AND is_active = true LIMIT 1;
  IF v_jornada_id IS NOT NULL THEN RETURN v_jornada_id; END IF;

  SELECT count(*) INTO v_open_count FROM public.jornadas WHERE status = 'abierta';

  IF v_open_count = 0 THEN
    INSERT INTO public.jornadas (fecha, status, abierta_at, is_active, snapshot)
    VALUES (current_date, 'abierta', now(), true, '[]'::jsonb)
    ON CONFLICT (fecha) DO UPDATE
      SET status = EXCLUDED.status,
          abierta_at = COALESCE(public.jornadas.abierta_at, EXCLUDED.abierta_at),
          is_active = true
    RETURNING id INTO v_jornada_id;
    INSERT INTO public.jornada_audit (jornada_id, accion, motivo, by_user)
    VALUES (v_jornada_id, 'abierta', 'Auto-apertura: ' || p_action_context, auth.uid());
  ELSIF v_open_count = 1 THEN
    UPDATE public.jornadas SET is_active = true
      WHERE status = 'abierta' RETURNING id INTO v_jornada_id;
    INSERT INTO public.jornada_audit (jornada_id, accion, motivo, by_user)
    VALUES (v_jornada_id, 'activada',
            'Auto-activacion (unica abierta): ' || p_action_context, auth.uid());
  ELSE
    RAISE EXCEPTION
      'Hay % jornadas abiertas, ninguna marcada como activa. Pedi al encargado que defina cual es la activa.',
      v_open_count
      USING ERRCODE='22023', HINT='no_active_jornada';
  END IF;
  RETURN v_jornada_id;
END;
$func$;
REVOKE ALL ON FUNCTION public.fn_resolve_active_jornada(text, boolean) FROM PUBLIC;


-- 2) rpc_open_jornada v2
DROP FUNCTION IF EXISTS public.rpc_open_jornada(text, date);

CREATE OR REPLACE FUNCTION public.rpc_open_jornada(
  p_fecha date DEFAULT NULL,
  p_channel_id text DEFAULT NULL
) RETURNS public.jornadas
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $func$
DECLARE
  v_role        role_enum;
  v_active_user boolean;
  v_fecha       date;
  v_open_count  int;
  v_has_active  boolean;
  v_jornada     public.jornadas;
BEGIN
  SELECT role, active INTO v_role, v_active_user
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active_user = false THEN
    RAISE EXCEPTION 'Tu sesion expiro o tu cuenta esta desactivada.'
      USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin','encargado') THEN
    RAISE EXCEPTION 'Solo owner, admin o encargado pueden abrir jornadas.'
      USING ERRCODE='42501', HINT='not_authorized';
  END IF;

  v_fecha := COALESCE(p_fecha, current_date);
  IF v_fecha < current_date THEN
    RAISE EXCEPTION 'No se pueden abrir jornadas en fechas pasadas.'
      USING ERRCODE='22023', HINT='fecha_pasada';
  END IF;
  IF v_fecha > current_date + 3 THEN
    RAISE EXCEPTION 'Solo se pueden abrir jornadas hasta 3 dias hacia adelante.'
      USING ERRCODE='22023', HINT='fecha_muy_lejana';
  END IF;

  PERFORM 1 FROM public.jornadas WHERE status = 'abierta' FOR UPDATE;
  SELECT count(*) INTO v_open_count FROM public.jornadas WHERE status = 'abierta';

  IF v_open_count >= 3 THEN
    RAISE EXCEPTION 'Ya hay 3 jornadas abiertas. Cerra una antes de abrir otra.'
      USING ERRCODE='22023', HINT='max_3_abiertas';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.jornadas WHERE is_active = true) INTO v_has_active;

  INSERT INTO public.jornadas (fecha, status, abierta_at, is_active, snapshot)
  VALUES (v_fecha, 'abierta', now(), NOT v_has_active, '[]'::jsonb)
  RETURNING * INTO v_jornada;

  INSERT INTO public.jornada_audit (jornada_id, accion, by_user)
  VALUES (v_jornada.id, 'abierta', auth.uid());

  RETURN v_jornada;
END;
$func$;
REVOKE ALL ON FUNCTION public.rpc_open_jornada(date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_open_jornada(date, text) TO authenticated;


-- 3) rpc_set_active_jornada v2 (singleton global)
CREATE OR REPLACE FUNCTION public.rpc_set_active_jornada(p_jornada_id uuid)
RETURNS public.jornadas
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $func$
DECLARE
  v_role        role_enum;
  v_active_user boolean;
  v_jornada     public.jornadas;
BEGIN
  SELECT role, active INTO v_role, v_active_user
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active_user = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin','encargado') THEN
    RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501', HINT='not_authorized';
  END IF;

  SELECT * INTO v_jornada FROM public.jornadas WHERE id = p_jornada_id FOR UPDATE;
  IF v_jornada.id IS NULL THEN
    RAISE EXCEPTION 'Jornada no existe.' USING ERRCODE='23503';
  END IF;
  IF v_jornada.status <> 'abierta' THEN
    RAISE EXCEPTION 'Solo se puede activar una jornada abierta.'
      USING ERRCODE='22023', HINT='jornada_no_abierta';
  END IF;

  UPDATE public.jornadas SET is_active = false WHERE is_active = true;
  UPDATE public.jornadas SET is_active = true WHERE id = p_jornada_id
    RETURNING * INTO v_jornada;

  INSERT INTO public.jornada_audit (jornada_id, accion, by_user)
  VALUES (p_jornada_id, 'activada', auth.uid());

  RETURN v_jornada;
END;
$func$;
REVOKE ALL ON FUNCTION public.rpc_set_active_jornada(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_set_active_jornada(uuid) TO authenticated;


-- 4) rpc_close_jornada v6
DROP FUNCTION IF EXISTS public.rpc_close_jornada(text, date, jsonb);

CREATE OR REPLACE FUNCTION public.rpc_close_jornada(
  p_fecha date DEFAULT NULL,
  p_disposiciones jsonb DEFAULT NULL,
  p_channel_id text DEFAULT NULL  -- LEGACY shim
) RETURNS public.jornadas
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $func$
DECLARE
  v_role             role_enum;
  v_active_user      boolean;
  v_sector           text;
  v_fecha            date;
  v_jornada          public.jornadas;
  v_was_active       boolean;
  v_next_active      uuid;
  v_snapshot         jsonb;
  v_pedidos          int;
  v_unidades_p       int;
  v_unidades_d       int;
  v_faltante         int;
  v_order            record;
  v_next_fecha       date;
  v_next_jornada_id  uuid;
  v_total_arrastres  int := 0;
  v_dispo            jsonb;
  v_disposiciones    jsonb;
  v_sku              text;
  v_dispo_channel    text;
  v_stock_libre      int;
BEGIN
  SELECT role, active INTO v_role, v_active_user
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active_user = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin','encargado') THEN
    RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501', HINT='not_authorized';
  END IF;

  IF p_channel_id IS NOT NULL THEN
    RAISE NOTICE 'rpc_close_jornada v6: p_channel_id=% recibido pero ignorado (shim). Cierra dia completo.', p_channel_id;
  END IF;

  v_fecha := COALESCE(p_fecha, current_date);
  IF v_fecha <> current_date THEN
    RAISE EXCEPTION 'Solo se puede cerrar la jornada del dia actual (% != %).',
      v_fecha, current_date USING ERRCODE='22023', HINT='fecha_no_actual';
  END IF;

  SELECT * INTO v_jornada FROM public.jornadas WHERE fecha = v_fecha FOR UPDATE;
  IF v_jornada.id IS NULL THEN
    RAISE EXCEPTION 'No existe jornada del %.', to_char(v_fecha, 'DD/MM/YYYY')
      USING ERRCODE='22023', HINT='jornada_not_found';
  END IF;
  IF v_jornada.status = 'cerrada' THEN
    RAISE EXCEPTION 'La jornada del % ya esta cerrada.', to_char(v_fecha, 'DD/MM/YYYY')
      USING ERRCODE='22023', HINT='already_closed';
  END IF;

  v_was_active := v_jornada.is_active;

  WITH skus_x_canal AS (
    SELECT o.channel_id, o.sku FROM public.orders o
      WHERE o.jornada_id = v_jornada.id AND o.status IN ('pendiente','arrastrado')
    UNION
    SELECT pl.channel_id, pl.sku FROM public.production_logs pl
      WHERE pl.jornada_id = v_jornada.id
  ),
  pedidos AS (
    SELECT channel_id, sku, COALESCE(SUM(cantidad), 0)::int AS pedido
      FROM public.orders
      WHERE jornada_id = v_jornada.id AND status IN ('pendiente','arrastrado')
      GROUP BY channel_id, sku
  ),
  producido AS (
    SELECT channel_id, sku, COALESCE(SUM(cantidad), 0)::int AS producido
      FROM public.production_logs
      WHERE jornada_id = v_jornada.id
      GROUP BY channel_id, sku
  ),
  rows AS (
    SELECT s.channel_id, s.sku, sc.modelo, sc.color,
      COALESCE(p.pedido, 0)     AS pedido,
      COALESCE(pr.producido, 0) AS producido,
      GREATEST(0, COALESCE(p.pedido, 0) - COALESCE(pr.producido, 0)) AS faltante,
      GREATEST(0, COALESCE(pr.producido, 0) - COALESCE(p.pedido, 0)) AS stock
    FROM skus_x_canal s
      LEFT JOIN public.sku_catalog sc ON sc.sku = s.sku
      LEFT JOIN pedidos p ON p.channel_id = s.channel_id AND p.sku = s.sku
      LEFT JOIN producido pr ON pr.channel_id = s.channel_id AND pr.sku = s.sku
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'channel_id', channel_id, 'sku', sku, 'modelo', modelo, 'color', color,
      'pedido', pedido, 'producido', producido, 'faltante', faltante, 'stock', stock
    ) ORDER BY channel_id, sku), '[]'::jsonb),
    COALESCE(SUM(pedido), 0)::int,
    COALESCE(SUM(producido), 0)::int,
    COALESCE(SUM(faltante), 0)::int
  INTO v_snapshot, v_unidades_p, v_unidades_d, v_faltante
  FROM rows;

  SELECT count(*) INTO v_pedidos FROM public.orders
   WHERE jornada_id = v_jornada.id AND status IN ('pendiente','arrastrado');

  v_sector := public.role_to_sector(v_role);

  UPDATE public.jornadas
  SET status='cerrada', is_active=false,
      pedidos_count=v_pedidos, unidades_pedidas=v_unidades_p,
      unidades_producidas=v_unidades_d, faltante_arrastrado=v_faltante,
      snapshot=v_snapshot, closed_by=auth.uid(), closed_at=now()
  WHERE id = v_jornada.id RETURNING * INTO v_jornada;

  IF v_was_active THEN
    SELECT id INTO v_next_active FROM public.jornadas
      WHERE status = 'abierta' AND id <> v_jornada.id
      ORDER BY fecha ASC LIMIT 1;
    IF v_next_active IS NOT NULL THEN
      UPDATE public.jornadas SET is_active = true WHERE id = v_next_active;
      INSERT INTO public.jornada_audit (jornada_id, accion, motivo, by_user)
      VALUES (v_next_active, 'activada',
              'Auto-activacion al cerrar la jornada activa anterior', auth.uid());
    END IF;
  END IF;

  IF p_disposiciones IS NULL THEN
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object(
        'channel_id', e->>'channel_id', 'sku', e->>'sku', 'accion', 'free_stock'
      )), '[]'::jsonb
    ) INTO v_disposiciones
    FROM jsonb_array_elements(v_snapshot) e
    WHERE COALESCE((e->>'stock')::int, 0) > 0;
  ELSE
    v_disposiciones := p_disposiciones;
  END IF;

  IF v_disposiciones IS NOT NULL THEN
    FOR v_dispo IN SELECT * FROM jsonb_array_elements(v_disposiciones)
    LOOP
      v_sku           := v_dispo->>'sku';
      v_dispo_channel := v_dispo->>'channel_id';
      IF v_sku IS NULL OR v_dispo_channel IS NULL THEN CONTINUE; END IF;
      IF (v_dispo->>'accion') = 'free_stock' THEN
        SELECT COALESCE(
          (v_dispo->>'cantidad')::int,
          (SELECT (e->>'stock')::int FROM jsonb_array_elements(v_snapshot) e
            WHERE e->>'sku' = v_sku AND e->>'channel_id' = v_dispo_channel)
        ) INTO v_stock_libre;
        IF v_stock_libre IS NULL OR v_stock_libre <= 0 THEN CONTINUE; END IF;

        INSERT INTO public.free_stock (sku, source_jornada_id, cantidad)
        VALUES (v_sku, v_jornada.id, v_stock_libre)
        ON CONFLICT (sku, source_jornada_id) DO UPDATE
          SET cantidad = public.free_stock.cantidad + EXCLUDED.cantidad;

        INSERT INTO public.production_logs
          (sku, channel_id, cantidad, operario_id, sector,
           fecha, hora, notas, jornada_id)
        VALUES
          (v_sku, v_dispo_channel, -v_stock_libre, auth.uid(), v_sector,
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
    WHERE o.jornada_id = v_jornada.id AND o.status IN ('pendiente','arrastrado')
  LOOP
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_snapshot) AS e
      WHERE e->>'sku' = v_order.sku
        AND e->>'channel_id' = v_order.channel_id
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
      v_total_arrastres := v_total_arrastres + 1;
    END IF;
    UPDATE public.orders SET status='archivado' WHERE id = v_order.id;
  END LOOP;

  IF v_total_arrastres > 0 THEN
    SELECT id INTO v_next_jornada_id FROM public.jornadas WHERE fecha = v_next_fecha;
    IF v_next_jornada_id IS NULL THEN
      INSERT INTO public.jornadas (fecha, status, abierta_at, is_active, snapshot)
      VALUES (v_next_fecha, 'abierta', now(), false, '[]'::jsonb)
      RETURNING id INTO v_next_jornada_id;
      INSERT INTO public.jornada_audit (jornada_id, accion, motivo, by_user)
      VALUES (v_next_jornada_id, 'abierta',
              'Auto-apertura por arrastre del cierre del ' || to_char(v_fecha, 'DD/MM'),
              auth.uid());
    END IF;
    UPDATE public.orders SET jornada_id = v_next_jornada_id
      WHERE fecha_pedido = v_next_fecha AND status = 'arrastrado' AND jornada_id IS NULL;
  END IF;

  INSERT INTO public.jornada_audit (jornada_id, accion, by_user)
  VALUES (v_jornada.id, 'cerrada', auth.uid());

  RETURN v_jornada;
END;
$func$;
REVOKE ALL ON FUNCTION public.rpc_close_jornada(date, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_close_jornada(date, jsonb, text) TO authenticated;


-- 5) rpc_register_production v4
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
  v_role         role_enum;
  v_active_user  boolean;
  v_sector       text;
  v_log          public.production_logs;
  v_jornada_id   uuid;
  v_jornada_row  public.jornadas;
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
    IF v_jornada_row.status = 'cerrada' THEN
      RAISE EXCEPTION 'No podes cargar a una jornada cerrada (del %).',
        to_char(v_jornada_row.fecha, 'DD/MM')
        USING ERRCODE='22023', HINT='jornada_cerrada';
    END IF;
    v_jornada_id := p_jornada_id;
  ELSE
    v_jornada_id := public.fn_resolve_active_jornada(
      'carga ' || p_cantidad || ' uds de ' || p_sku || ' en ' || p_channel_id,
      false
    );
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


-- 6) rpc_assign_free_stock v4
CREATE OR REPLACE FUNCTION public.rpc_assign_free_stock(
  p_sku text,
  p_cantidad integer,
  p_target_channel_id text,
  p_target_jornada_id uuid DEFAULT NULL,
  p_motivo text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $func$
DECLARE
  v_role          role_enum;
  v_active_user   boolean;
  v_sector        text;
  v_jornada_id    uuid;
  v_total_libre   int;
  v_remaining     int;
  v_row           record;
  v_take          int;
BEGIN
  SELECT role, active INTO v_role, v_active_user FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active_user = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin','encargado') THEN
    RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501', HINT='not_authorized';
  END IF;
  IF p_cantidad <= 0 THEN
    RAISE EXCEPTION 'cantidad > 0.' USING ERRCODE='22023', HINT='invalid_qty';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sku_catalog WHERE sku=p_sku AND activo=true) THEN
    RAISE EXCEPTION 'SKU % no existe.', p_sku USING ERRCODE='23503';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.channels WHERE id = p_target_channel_id) THEN
    RAISE EXCEPTION 'Canal % no existe.', p_target_channel_id USING ERRCODE='23503';
  END IF;

  SELECT COALESCE(SUM(cantidad), 0)::int INTO v_total_libre
    FROM public.free_stock WHERE sku = p_sku;
  IF v_total_libre < p_cantidad THEN
    RAISE EXCEPTION 'Solo hay % uds de % en stock libre.', v_total_libre, p_sku
      USING ERRCODE='22023', HINT='insufficient_free_stock';
  END IF;

  IF p_target_jornada_id IS NOT NULL THEN
    SELECT id INTO v_jornada_id FROM public.jornadas
      WHERE id = p_target_jornada_id AND status = 'abierta';
    IF v_jornada_id IS NULL THEN
      RAISE EXCEPTION 'Jornada destino no existe o no esta abierta.'
        USING ERRCODE='22023', HINT='jornada_invalid';
    END IF;
  ELSE
    v_jornada_id := public.fn_resolve_active_jornada(
      'asigno ' || p_cantidad || ' uds de ' || p_sku || ' a ' || p_target_channel_id,
      false
    );
  END IF;

  v_remaining := p_cantidad;
  FOR v_row IN
    SELECT source_jornada_id, cantidad FROM public.free_stock
      WHERE sku = p_sku AND cantidad > 0 ORDER BY created_at ASC FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_row.cantidad, v_remaining);
    IF v_take = v_row.cantidad THEN
      DELETE FROM public.free_stock WHERE sku = p_sku
        AND source_jornada_id IS NOT DISTINCT FROM v_row.source_jornada_id;
    ELSE
      UPDATE public.free_stock SET cantidad = cantidad - v_take
        WHERE sku = p_sku AND source_jornada_id IS NOT DISTINCT FROM v_row.source_jornada_id;
    END IF;
    v_remaining := v_remaining - v_take;
  END LOOP;

  v_sector := public.role_to_sector(v_role);
  INSERT INTO public.production_logs
    (sku, channel_id, cantidad, operario_id, sector, fecha, hora, notas, jornada_id)
  VALUES
    (p_sku, p_target_channel_id, p_cantidad, auth.uid(), v_sector,
     current_date, current_time,
     '[FROM_FREE_STOCK] cantidad=' || p_cantidad ||
       CASE WHEN p_motivo IS NOT NULL AND length(trim(p_motivo)) > 0
         THEN ' motivo=' || trim(p_motivo) ELSE '' END,
     v_jornada_id);

  RETURN jsonb_build_object(
    'sku', p_sku, 'cantidad', p_cantidad,
    'target_channel_id', p_target_channel_id,
    'target_jornada_id', v_jornada_id,
    'motivo', p_motivo
  );
END;
$func$;
REVOKE ALL ON FUNCTION public.rpc_assign_free_stock(text, integer, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_assign_free_stock(text, integer, text, uuid, text) TO authenticated;


-- 7) rpc_send_to_free_stock v2
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
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin','encargado') THEN
    RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501', HINT='not_authorized';
  END IF;
  IF p_cantidad <= 0 THEN
    RAISE EXCEPTION 'cantidad > 0.' USING ERRCODE='22023', HINT='invalid_qty';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sku_catalog WHERE sku=p_sku AND activo=true) THEN
    RAISE EXCEPTION 'SKU % no existe.', p_sku USING ERRCODE='23503';
  END IF;
  SELECT label INTO v_source_label FROM public.channels WHERE id = p_source_channel_id;
  IF v_source_label IS NULL THEN
    RAISE EXCEPTION 'Canal % no existe.', p_source_channel_id USING ERRCODE='23503';
  END IF;
  SELECT COALESCE(stock, 0) INTO v_stock_disp FROM public.carrier_state
    WHERE channel_id = p_source_channel_id AND sku = p_sku;
  IF v_stock_disp < p_cantidad THEN
    RAISE EXCEPTION 'Solo hay % uds de % en %. Pediste %.',
      v_stock_disp, p_sku, v_source_label, p_cantidad
      USING ERRCODE='22023', HINT='insufficient_channel_stock';
  END IF;

  v_jornada_id := public.fn_resolve_active_jornada(
    'movio ' || p_cantidad || ' uds de ' || p_sku || ' a stock central', false
  );
  v_sector := public.role_to_sector(v_role);

  INSERT INTO public.production_logs
    (sku, channel_id, cantidad, operario_id, sector, fecha, hora, notas, jornada_id)
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
    'sku', p_sku, 'cantidad', p_cantidad,
    'source_channel_id', p_source_channel_id,
    'source_jornada_id', v_jornada_id,
    'motivo', p_motivo
  );
END;
$func$;
REVOKE ALL ON FUNCTION public.rpc_send_to_free_stock(text, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_send_to_free_stock(text, integer, text, text) TO authenticated;


-- 8) rpc_transfer_between_channels v2 (helper invocado 1 vez)
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
  v_role         role_enum;
  v_active_user  boolean;
  v_sector       text;
  v_stock_disp   int;
  v_jornada_id   uuid;
  v_source_label text;
  v_target_label text;
  v_motivo_tag   text;
BEGIN
  SELECT role, active INTO v_role, v_active_user
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active_user = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin','encargado') THEN
    RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501', HINT='not_authorized';
  END IF;
  IF p_cantidad <= 0 THEN
    RAISE EXCEPTION 'cantidad > 0.' USING ERRCODE='22023', HINT='invalid_qty';
  END IF;
  IF p_source_channel_id = p_target_channel_id THEN
    RAISE EXCEPTION 'Origen y destino no pueden ser el mismo canal.'
      USING ERRCODE='22023', HINT='same_channel';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sku_catalog WHERE sku=p_sku AND activo=true) THEN
    RAISE EXCEPTION 'SKU % no existe.', p_sku USING ERRCODE='23503';
  END IF;
  SELECT label INTO v_source_label FROM public.channels WHERE id = p_source_channel_id;
  SELECT label INTO v_target_label FROM public.channels WHERE id = p_target_channel_id;
  IF v_source_label IS NULL THEN
    RAISE EXCEPTION 'Canal origen no existe.' USING ERRCODE='23503';
  END IF;
  IF v_target_label IS NULL THEN
    RAISE EXCEPTION 'Canal destino no existe.' USING ERRCODE='23503';
  END IF;

  SELECT COALESCE(stock, 0) INTO v_stock_disp FROM public.carrier_state
    WHERE channel_id = p_source_channel_id AND sku = p_sku;
  IF v_stock_disp < p_cantidad THEN
    RAISE EXCEPTION 'Solo hay % uds de % en %. Pediste %.',
      v_stock_disp, p_sku, v_source_label, p_cantidad
      USING ERRCODE='22023', HINT='insufficient_channel_stock';
  END IF;

  -- v2: helper invocado UNA SOLA vez (no por canal)
  v_jornada_id := public.fn_resolve_active_jornada(
    'transfirio ' || p_cantidad || ' uds de ' || p_sku || ' de ' ||
    v_source_label || ' a ' || v_target_label, false
  );
  v_sector := public.role_to_sector(v_role);
  v_motivo_tag := CASE
    WHEN p_motivo IS NOT NULL AND length(trim(p_motivo)) > 0
      THEN ' motivo=' || trim(p_motivo) ELSE ''
  END;

  INSERT INTO public.production_logs
    (sku, channel_id, cantidad, operario_id, sector, fecha, hora, notas, jornada_id)
  VALUES
    (p_sku, p_source_channel_id, -p_cantidad, auth.uid(), v_sector,
     current_date, current_time,
     '[TRANSFER_OUT to=' || p_target_channel_id || ']' || v_motivo_tag,
     v_jornada_id);

  INSERT INTO public.production_logs
    (sku, channel_id, cantidad, operario_id, sector, fecha, hora, notas, jornada_id)
  VALUES
    (p_sku, p_target_channel_id, p_cantidad, auth.uid(), v_sector,
     current_date, current_time,
     '[TRANSFER_IN from=' || p_source_channel_id || ']' || v_motivo_tag,
     v_jornada_id);

  RETURN jsonb_build_object(
    'sku', p_sku, 'cantidad', p_cantidad,
    'source_channel_id', p_source_channel_id,
    'target_channel_id', p_target_channel_id,
    'jornada_id', v_jornada_id,
    'motivo', p_motivo
  );
END;
$func$;
REVOKE ALL ON FUNCTION public.rpc_transfer_between_channels(text, integer, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_transfer_between_channels(text, integer, text, text, text) TO authenticated;


-- 9) recompute_carrier_state_for v4 (sin filtro j.channel_id)
CREATE OR REPLACE FUNCTION public.recompute_carrier_state_for(
  p_channel_id text,
  p_sku text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $func$
DECLARE
  v_pedido               int;
  v_producido            int;
  v_producido_historico  int;
  v_pedido_archivado     int;
  v_stock_legacy         int;
  v_faltante             int;
  v_stock                int;
BEGIN
  SELECT COALESCE(SUM(cantidad), 0) INTO v_pedido FROM public.orders
   WHERE channel_id = p_channel_id AND sku = p_sku AND status IN ('pendiente','arrastrado');

  SELECT GREATEST(0, COALESCE(SUM(pl.cantidad), 0)) INTO v_producido
   FROM public.production_logs pl
   WHERE pl.channel_id = p_channel_id AND pl.sku = p_sku
     AND (pl.jornada_id IS NULL OR EXISTS (
       SELECT 1 FROM public.jornadas j WHERE j.id = pl.jornada_id AND j.status = 'abierta'
     ));

  SELECT COALESCE(SUM(pl.cantidad), 0) INTO v_producido_historico
   FROM public.production_logs pl
   INNER JOIN public.jornadas j ON j.id = pl.jornada_id
   WHERE pl.channel_id = p_channel_id AND pl.sku = p_sku AND j.status = 'cerrada';

  SELECT COALESCE(SUM(cantidad), 0) INTO v_pedido_archivado
   FROM public.orders WHERE channel_id = p_channel_id AND sku = p_sku AND status = 'archivado';

  v_stock_legacy := GREATEST(0, v_producido_historico - v_pedido_archivado);
  v_faltante := GREATEST(0, v_pedido - v_producido - v_stock_legacy);
  v_stock := v_stock_legacy + GREATEST(0, v_producido - v_pedido);

  IF v_pedido = 0 AND v_producido = 0 AND v_stock_legacy = 0 THEN
    DELETE FROM public.carrier_state WHERE channel_id = p_channel_id AND sku = p_sku;
  ELSE
    INSERT INTO public.carrier_state
      (channel_id, sku, pedido, producido, faltante, stock)
    VALUES (p_channel_id, p_sku, v_pedido, v_producido, v_faltante, v_stock)
    ON CONFLICT (channel_id, sku) DO UPDATE SET
      pedido = EXCLUDED.pedido, producido = EXCLUDED.producido,
      faltante = EXCLUDED.faltante, stock = EXCLUDED.stock,
      updated_at = now();
  END IF;
END;
$func$;


-- 10) rpc_import_batch v2 con p_target_jornada_id (shim fallback si NULL)
DROP FUNCTION IF EXISTS public.rpc_import_batch(text, text, text, jsonb, text);

CREATE OR REPLACE FUNCTION public.rpc_import_batch(
  p_channel_id text,
  p_filename text,
  p_file_hash text,
  p_items jsonb,
  p_storage_path text DEFAULT NULL,
  p_target_jornada_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $func$
DECLARE
  v_role             role_enum;
  v_active_user      boolean;
  v_batch_id         uuid;
  v_jornada_id       uuid;
  v_item             jsonb;
  v_inserted         int := 0;
  v_cancelled        int := 0;
  v_skipped_unknown  int := 0;
  v_unidades         int := 0;
  v_estado           text;
  v_open_count       int;
BEGIN
  SELECT role, active INTO v_role, v_active_user
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active_user = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin','encargado') THEN
    RAISE EXCEPTION 'Sin permiso para importar.' USING ERRCODE='42501', HINT='not_authorized';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.channels WHERE id = p_channel_id) THEN
    RAISE EXCEPTION 'Canal % no existe.', p_channel_id USING ERRCODE='23503';
  END IF;

  IF p_target_jornada_id IS NOT NULL THEN
    SELECT id INTO v_jornada_id FROM public.jornadas
      WHERE id = p_target_jornada_id AND status = 'abierta';
    IF v_jornada_id IS NULL THEN
      RAISE EXCEPTION 'Jornada destino no existe o no esta abierta.'
        USING ERRCODE='22023', HINT='jornada_invalid';
    END IF;
  ELSE
    SELECT count(*) INTO v_open_count FROM public.jornadas WHERE status='abierta';
    IF v_open_count = 0 THEN
      RAISE EXCEPTION 'No hay jornadas abiertas. Abri una antes de importar.'
        USING ERRCODE='22023', HINT='no_jornada';
    ELSIF v_open_count = 1 THEN
      SELECT id INTO v_jornada_id FROM public.jornadas WHERE status='abierta';
    ELSE
      RAISE EXCEPTION 'Hay % jornadas abiertas. Elegi a cual importar.', v_open_count
        USING ERRCODE='22023', HINT='multiple_jornadas';
    END IF;
  END IF;

  INSERT INTO public.import_batches
    (channel_id, filename, file_hash, imported_by, storage_path)
  VALUES
    (p_channel_id, p_filename, p_file_hash, auth.uid(), p_storage_path)
  RETURNING id INTO v_batch_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_estado := COALESCE(v_item->>'estado', '');
    IF lower(trim(v_estado)) LIKE 'cancelada%' THEN
      v_cancelled := v_cancelled + 1;
      CONTINUE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.sku_catalog
      WHERE sku = v_item->>'sku' AND activo = true) THEN
      v_skipped_unknown := v_skipped_unknown + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.orders
      (channel_id, order_number, cliente, sku, cantidad, fecha_pedido,
       status, import_batch_id, jornada_id)
    VALUES (
      p_channel_id,
      COALESCE(v_item->>'order_number',
        'GEN-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || v_inserted::text),
      v_item->>'cliente',
      v_item->>'sku',
      (v_item->>'cantidad')::int,
      COALESCE((v_item->>'fecha_pedido')::date, current_date),
      'pendiente',
      v_batch_id,
      v_jornada_id
    )
    ON CONFLICT (channel_id, order_number, sku) DO NOTHING;
    IF FOUND THEN
      v_inserted := v_inserted + 1;
      v_unidades := v_unidades + (v_item->>'cantidad')::int;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'batch_id', v_batch_id,
    'jornada_id', v_jornada_id,
    'inserted_count', v_inserted,
    'unidades_count', v_unidades,
    'cancelled_count', v_cancelled,
    'skipped_unknown_count', v_skipped_unknown
  );
END;
$func$;
REVOKE ALL ON FUNCTION public.rpc_import_batch(text, text, text, jsonb, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_import_batch(text, text, text, jsonb, text, uuid) TO authenticated;


-- 11) rpc_create_manual_order v2 con p_target_jornada_id
DROP FUNCTION IF EXISTS public.rpc_create_manual_order(text, text, text, jsonb, text, boolean);

CREATE OR REPLACE FUNCTION public.rpc_create_manual_order(
  p_channel_id text,
  p_order_number text DEFAULT NULL,
  p_cliente text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_motivo text DEFAULT NULL,
  p_force_merge boolean DEFAULT false,
  p_target_jornada_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $func$
DECLARE
  v_role          role_enum;
  v_active_user   boolean;
  v_order_number  text;
  v_jornada_id    uuid;
  v_item          jsonb;
  v_inserted      int := 0;
  v_open_count    int;
BEGIN
  SELECT role, active INTO v_role, v_active_user
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active_user = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin','encargado') THEN
    RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501', HINT='not_authorized';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.channels WHERE id = p_channel_id) THEN
    RAISE EXCEPTION 'Canal % no existe.', p_channel_id USING ERRCODE='23503';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'El pedido debe tener al menos un item.' USING ERRCODE='22023';
  END IF;

  IF p_target_jornada_id IS NOT NULL THEN
    SELECT id INTO v_jornada_id FROM public.jornadas
      WHERE id = p_target_jornada_id AND status = 'abierta';
    IF v_jornada_id IS NULL THEN
      RAISE EXCEPTION 'Jornada destino no existe o no esta abierta.'
        USING ERRCODE='22023', HINT='jornada_invalid';
    END IF;
  ELSE
    SELECT count(*) INTO v_open_count FROM public.jornadas WHERE status='abierta';
    IF v_open_count = 0 THEN
      RAISE EXCEPTION 'No hay jornadas abiertas. Abri una antes de crear pedidos.'
        USING ERRCODE='22023', HINT='no_jornada';
    ELSIF v_open_count = 1 THEN
      SELECT id INTO v_jornada_id FROM public.jornadas WHERE status='abierta';
    ELSE
      RAISE EXCEPTION 'Hay % jornadas abiertas. Elegi a cual asignar el pedido.', v_open_count
        USING ERRCODE='22023', HINT='multiple_jornadas';
    END IF;
  END IF;

  v_order_number := COALESCE(p_order_number,
    'MAN-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' || substring(gen_random_uuid()::text, 1, 4));

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.sku_catalog
      WHERE sku = v_item->>'sku' AND activo = true) THEN
      RAISE EXCEPTION 'SKU % no existe.', v_item->>'sku' USING ERRCODE='23503';
    END IF;
    INSERT INTO public.orders
      (channel_id, order_number, cliente, sku, cantidad, fecha_pedido,
       status, origen, created_by, jornada_id)
    VALUES (
      p_channel_id, v_order_number, p_cliente,
      v_item->>'sku', (v_item->>'cantidad')::int,
      current_date, 'pendiente', 'manual', auth.uid(), v_jornada_id
    );
    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'order_number', v_order_number,
    'jornada_id', v_jornada_id,
    'items_inserted', v_inserted
  );
END;
$func$;
REVOKE ALL ON FUNCTION public.rpc_create_manual_order(text, text, text, jsonb, text, boolean, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_create_manual_order(text, text, text, jsonb, text, boolean, uuid) TO authenticated;
