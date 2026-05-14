-- ════════════════════════════════════════════════════════════════════
-- HOUSEKEEPING — Limpiar shims p_channel_id de rpc_open/close_jornada
-- ════════════════════════════════════════════════════════════════════
-- Cambio 2A (migration 0029) dejó un parámetro `p_channel_id` como shim
-- retro-compat en rpc_open_jornada y rpc_close_jornada. Tras el Cambio 2B
-- ningún caller del frontend lo pasa:
--   - rpc_open_jornada: el body NUNCA usó p_channel_id (param 100% muerto).
--   - rpc_close_jornada: el body solo lo usaba para un RAISE NOTICE de
--     descarte (líneas 217-219 de 0029). No afecta lógica funcional.
--
-- Esta migration elimina el parámetro de ambas firmas. El body de cada
-- RPC queda IDÉNTICO a 0029 salvo:
--   - rpc_open_jornada: 0 cambios al body (el param ni se mencionaba).
--   - rpc_close_jornada: se elimina el bloque IF p_channel_id IS NOT NULL
--     THEN RAISE NOTICE ... END IF.
--
-- DROP previo de las firmas viejas requerido: PostgREST/Postgres no
-- pueden "reemplazar" una función cambiando su lista de parámetros con
-- CREATE OR REPLACE — hay que DROP + CREATE.
--
-- NO se tocan: SECURITY DEFINER, search_path, lógica de negocio,
-- validaciones, snapshot, arrastres, auto-dispose, REVOKE/GRANT (salvo
-- la firma).
-- ════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────
-- 1) rpc_open_jornada — sin p_channel_id
-- ────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.rpc_open_jornada(date, text);

CREATE OR REPLACE FUNCTION public.rpc_open_jornada(
  p_fecha date DEFAULT NULL
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
REVOKE ALL ON FUNCTION public.rpc_open_jornada(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_open_jornada(date) TO authenticated;


-- ────────────────────────────────────────────────────────────────────
-- 2) rpc_close_jornada — sin p_channel_id
-- ────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.rpc_close_jornada(date, jsonb, text);

CREATE OR REPLACE FUNCTION public.rpc_close_jornada(
  p_fecha date DEFAULT NULL,
  p_disposiciones jsonb DEFAULT NULL
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
REVOKE ALL ON FUNCTION public.rpc_close_jornada(date, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_close_jornada(date, jsonb) TO authenticated;


-- ────────────────────────────────────────────────────────────────────
-- 3) DROP view_dashboard_kpis — view huérfana sin callers
-- ────────────────────────────────────────────────────────────────────
-- Creada en migration 0009 para el hero del dashboard del modelo viejo
-- (mock.js → MOCK.dash). El frontend actual (data.js) NO la consulta:
-- el dashboard se alimenta de computeCarriersForJornada. Sin callers en
-- código vivo ni en otras views/RPCs. Se elimina como deuda técnica.
-- ROLLBACK: re-aplicar el CREATE OR REPLACE VIEW desde migration 0009.
DROP VIEW IF EXISTS public.view_dashboard_kpis;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual, si se necesita restaurar los shims):
-- Re-aplicar las firmas de migration 0029:
--   DROP FUNCTION public.rpc_open_jornada(date);
--   DROP FUNCTION public.rpc_close_jornada(date, jsonb);
--   ...y re-crear con el parámetro `p_channel_id text DEFAULT NULL`
--   (en open_jornada al final; en close_jornada al final + el bloque
--    IF p_channel_id IS NOT NULL THEN RAISE NOTICE ... END IF).
-- ════════════════════════════════════════════════════════════════════
