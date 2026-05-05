-- ════════════════════════════════════════════════════════════════════
-- ETAPA 4 — Stock libre (free_stock) + disposiciones en el cierre
-- ════════════════════════════════════════════════════════════════════
-- 1) Policies RLS para free_stock (lectura para owner/admin/encargado;
--    INSERT/UPDATE/DELETE solo por RPCs SECURITY DEFINER).
-- 2) rpc_close_jornada v3: nuevo parámetro opcional p_disposiciones jsonb
--    permite mover sobrantes a stock libre. Default = arrastrar (igual
--    a v2, retro-compatible).
-- 3) rpc_assign_free_stock: mueve stock libre a un canal (genera
--    production_log positivo + reduce free_stock).
-- 4) rpc_consume_free_stock: walk-in (reduce free_stock sin generar log).
--
-- Schema sin cambios — la tabla free_stock ya existía desde Etapa 1.
-- ════════════════════════════════════════════════════════════════════

-- ── 1) RLS policies para free_stock ─────────────────────────────────
DROP POLICY IF EXISTS free_stock_select ON public.free_stock;
CREATE POLICY free_stock_select ON public.free_stock
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.active = true
  ));

-- ── 2) rpc_close_jornada v3 con disposiciones ────────────────────────
DROP FUNCTION IF EXISTS public.rpc_close_jornada(text, date);

CREATE OR REPLACE FUNCTION public.rpc_close_jornada(
  p_channel_id text,
  p_fecha date DEFAULT NULL,
  p_disposiciones jsonb DEFAULT NULL
) RETURNS public.jornadas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $func$
DECLARE
  v_role        role_enum;
  v_active_user boolean;
  v_sector      text;
  v_fecha       date;
  v_jornada     public.jornadas;
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

  -- Snapshot por SKU (igual que v2)
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

  -- ── Disposiciones de sobrantes ─────────────────────────────────
  -- p_disposiciones: jsonb array de {sku, accion: 'free_stock', cantidad?}
  -- Si la cantidad no se especifica, mueve TODO el stock del SKU a libre.
  -- Si no se pasa p_disposiciones (NULL), todos los sobrantes quedan
  -- arrastrados (carrier_state.stock por canal — comportamiento v2).
  IF p_disposiciones IS NOT NULL THEN
    FOR v_dispo IN SELECT * FROM jsonb_array_elements(p_disposiciones)
    LOOP
      v_sku := v_dispo->>'sku';
      IF v_sku IS NULL THEN CONTINUE; END IF;

      IF (v_dispo->>'accion') = 'free_stock' THEN
        -- Calcular cantidad: o la pedida, o todo el stock del snapshot
        SELECT COALESCE((v_dispo->>'cantidad')::int,
                        (SELECT (e->>'stock')::int
                         FROM jsonb_array_elements(v_snapshot) e
                         WHERE e->>'sku' = v_sku))
        INTO v_stock_libre;

        IF v_stock_libre IS NULL OR v_stock_libre <= 0 THEN CONTINUE; END IF;

        -- Insertar en free_stock (PK = sku + source_jornada_id, así
        -- cada jornada que aporta queda trazable)
        INSERT INTO public.free_stock (sku, source_jornada_id, cantidad)
        VALUES (v_sku, v_jornada.id, v_stock_libre)
        ON CONFLICT (sku, source_jornada_id) DO UPDATE
          SET cantidad = public.free_stock.cantidad + EXCLUDED.cantidad;

        -- Compensación negativa en production_logs para que carrier_state
        -- baje el "producido" del canal (sino el stock se dobla).
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

  -- ── Arrastre de orders pendientes ─────────────────────────────────
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

-- ── 3) rpc_assign_free_stock ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_assign_free_stock(
  p_sku text,
  p_cantidad integer,
  p_target_channel_id text,
  p_target_jornada_id uuid DEFAULT NULL
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
  SELECT role, active INTO v_role, v_active_user
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active_user = false THEN
    RAISE EXCEPTION 'Tu sesion expiro o tu cuenta esta desactivada.'
      USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin','encargado') THEN
    RAISE EXCEPTION 'No tenes permiso para asignar stock libre.'
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
  IF NOT EXISTS (SELECT 1 FROM public.channels WHERE id = p_target_channel_id) THEN
    RAISE EXCEPTION 'El canal % no existe.', p_target_channel_id
      USING ERRCODE='23503', HINT='channel_not_found';
  END IF;

  -- Stock libre disponible total para el SKU
  SELECT COALESCE(SUM(cantidad), 0)::int INTO v_total_libre
    FROM public.free_stock WHERE sku = p_sku;

  IF v_total_libre < p_cantidad THEN
    RAISE EXCEPTION 'Solo hay % unidades de % en stock libre (pediste %).',
      v_total_libre, p_sku, p_cantidad
      USING ERRCODE='22023', HINT='insufficient_free_stock';
  END IF;

  -- Resolver jornada destino
  IF p_target_jornada_id IS NOT NULL THEN
    SELECT id INTO v_jornada_id FROM public.jornadas
     WHERE id = p_target_jornada_id AND channel_id = p_target_channel_id AND status = 'abierta';
    IF v_jornada_id IS NULL THEN
      RAISE EXCEPTION 'La jornada destino no existe, no es del canal o no esta abierta.'
        USING ERRCODE='22023', HINT='jornada_invalid';
    END IF;
  ELSE
    SELECT id INTO v_jornada_id FROM public.jornadas
     WHERE channel_id = p_target_channel_id AND status = 'abierta' AND is_active = true
     LIMIT 1;
    IF v_jornada_id IS NULL THEN
      INSERT INTO public.jornadas (channel_id, fecha, status, abierta_at, is_active, snapshot)
      VALUES (p_target_channel_id, current_date, 'abierta', now(), true, '[]'::jsonb)
      ON CONFLICT (channel_id, fecha) DO UPDATE
        SET is_active = true,
            abierta_at = COALESCE(public.jornadas.abierta_at, EXCLUDED.abierta_at)
      RETURNING id INTO v_jornada_id;
    END IF;
  END IF;

  -- Consumir free_stock FIFO por jornada de origen
  v_remaining := p_cantidad;
  FOR v_row IN
    SELECT source_jornada_id, cantidad FROM public.free_stock
     WHERE sku = p_sku AND cantidad > 0
     ORDER BY created_at ASC
     FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_row.cantidad, v_remaining);
    IF v_take = v_row.cantidad THEN
      DELETE FROM public.free_stock
       WHERE sku = p_sku AND source_jornada_id IS NOT DISTINCT FROM v_row.source_jornada_id;
    ELSE
      UPDATE public.free_stock
         SET cantidad = cantidad - v_take
       WHERE sku = p_sku AND source_jornada_id IS NOT DISTINCT FROM v_row.source_jornada_id;
    END IF;
    v_remaining := v_remaining - v_take;
  END LOOP;

  v_sector := public.role_to_sector(v_role);

  -- Insertar production_log positivo en la jornada destino — produce
  -- "producción virtual" con etiqueta especial.
  INSERT INTO public.production_logs
    (sku, channel_id, cantidad, operario_id, sector, fecha, hora, notas, jornada_id)
  VALUES
    (p_sku, p_target_channel_id, p_cantidad, auth.uid(), v_sector,
     current_date, current_time,
     '[FROM_FREE_STOCK] cantidad=' || p_cantidad,
     v_jornada_id);

  RETURN jsonb_build_object(
    'sku', p_sku, 'cantidad', p_cantidad,
    'target_channel_id', p_target_channel_id,
    'target_jornada_id', v_jornada_id
  );
END;
$func$;

REVOKE ALL ON FUNCTION public.rpc_assign_free_stock(text, integer, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_assign_free_stock(text, integer, text, uuid) TO authenticated;

-- ── 4) rpc_consume_free_stock — walk-in ──────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_consume_free_stock(
  p_sku text,
  p_cantidad integer,
  p_motivo text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $func$
DECLARE
  v_role        role_enum;
  v_active_user boolean;
  v_total_libre int;
  v_remaining   int;
  v_row         record;
  v_take        int;
BEGIN
  SELECT role, active INTO v_role, v_active_user
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active_user = false THEN
    RAISE EXCEPTION 'Tu sesion expiro o tu cuenta esta desactivada.'
      USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin','encargado') THEN
    RAISE EXCEPTION 'No tenes permiso para consumir stock libre.'
      USING ERRCODE='42501', HINT='not_authorized';
  END IF;

  IF p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0.'
      USING ERRCODE='22023', HINT='invalid_qty';
  END IF;

  SELECT COALESCE(SUM(cantidad), 0)::int INTO v_total_libre
    FROM public.free_stock WHERE sku = p_sku;

  IF v_total_libre < p_cantidad THEN
    RAISE EXCEPTION 'Solo hay % unidades de % en stock libre (pediste %).',
      v_total_libre, p_sku, p_cantidad
      USING ERRCODE='22023', HINT='insufficient_free_stock';
  END IF;

  v_remaining := p_cantidad;
  FOR v_row IN
    SELECT source_jornada_id, cantidad FROM public.free_stock
     WHERE sku = p_sku AND cantidad > 0
     ORDER BY created_at ASC FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_row.cantidad, v_remaining);
    IF v_take = v_row.cantidad THEN
      DELETE FROM public.free_stock
       WHERE sku = p_sku AND source_jornada_id IS NOT DISTINCT FROM v_row.source_jornada_id;
    ELSE
      UPDATE public.free_stock
         SET cantidad = cantidad - v_take
       WHERE sku = p_sku AND source_jornada_id IS NOT DISTINCT FROM v_row.source_jornada_id;
    END IF;
    v_remaining := v_remaining - v_take;
  END LOOP;

  -- Registrar en notifications (audit trail simple sin tabla nueva)
  INSERT INTO public.notifications (user_id, tipo, titulo, mensaje, link)
  SELECT p.id, 'sistema',
    'Consumo de stock libre',
    format('%s: %s uds de %s consumidas (walk-in)%s',
      (SELECT name FROM public.profiles WHERE id = auth.uid()),
      p_cantidad, p_sku,
      CASE WHEN p_motivo IS NOT NULL THEN ' - ' || p_motivo ELSE '' END),
    null
  FROM public.profiles p
  WHERE p.role IN ('owner','admin') AND p.active = true AND p.id <> auth.uid();

  RETURN jsonb_build_object('sku', p_sku, 'cantidad', p_cantidad, 'motivo', p_motivo);
END;
$func$;

REVOKE ALL ON FUNCTION public.rpc_consume_free_stock(text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_consume_free_stock(text, integer, text) TO authenticated;
