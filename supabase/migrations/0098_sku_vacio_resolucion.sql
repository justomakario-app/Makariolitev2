-- ════════════════════════════════════════════════════════════════════
-- VENTAS — FASE C: resolución de SKU vacío (Título+Variante → SKU)
-- ════════════════════════════════════════════════════════════════════
-- Bug: el parser descartaba en silencio ~28% de filas del Excel de ML que
-- vienen con la columna SKU vacía (pero con Título + Variante). Decisión del
-- Jefe: opción (a) tabla de mapeo Título+Variante → SKU, exacta. Acá se
-- AUTOAPRENDE: las filas que SÍ traen SKU enseñan el mapeo; las vacías se
-- resuelven contra él. Las que ni así se resuelven NO se pierden: van a una
-- cola de revisión (orders_sin_sku).
--
-- orders.sku tiene FK a sku_catalog → las no resueltas no pueden ir a orders.
-- 100% aditivo; preserva toda la lógica del import (canceladas, reprog, idem).
-- ════════════════════════════════════════════════════════════════════

-- Normalizador: minúsculas + trim + colapsar espacios.
CREATE OR REPLACE FUNCTION public.ml_norm(p text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $function$
  SELECT lower(trim(regexp_replace(COALESCE(p, ''), '\s+', ' ', 'g')));
$function$;

-- Mapeo aprendido Título+Variante → SKU.
CREATE TABLE IF NOT EXISTS public.ml_sku_map (
  titulo_norm     text NOT NULL,
  variante_norm   text NOT NULL DEFAULT '',
  sku             text NOT NULL,
  titulo_sample   text,
  variante_sample text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (titulo_norm, variante_norm)
);

-- Cola de revisión: pedidos cuyo SKU no se pudo resolver. Nunca se descartan.
CREATE TABLE IF NOT EXISTS public.orders_sin_sku (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id      text,
  order_number    text NOT NULL DEFAULT '',
  titulo          text NOT NULL DEFAULT '',
  variante        text NOT NULL DEFAULT '',
  cantidad        int,
  fecha_pedido    date,
  estado_ml       text,
  jornada_id      uuid,
  import_batch_id uuid,
  resuelto        boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_id, order_number, titulo, variante)
);

DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ml_sku_map','orders_sin_sku'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    BEGIN
      EXECUTE format($p$CREATE POLICY %1$s_sel ON public.%1$I FOR SELECT TO authenticated
        USING (current_user_role() = ANY (ARRAY['owner','admin','encargado']::role_enum[]));$p$, t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $rls$;
GRANT SELECT ON public.ml_sku_map, public.orders_sin_sku TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_import_batch(
  p_channel_id text, p_filename text, p_file_hash text, p_items jsonb,
  p_storage_path text DEFAULT NULL::text, p_target_jornada_id uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_role role_enum; v_active_user boolean; v_sector text; v_batch_id uuid; v_jornada_id uuid;
  v_item jsonb; v_open_count int; v_estado text; v_sku text; v_order_number text; v_cantidad int;
  v_existing public.orders%ROWTYPE; v_total_produced int; v_already_cancelled_qty int; v_recover int;
  v_inserted int := 0; v_unidades int := 0; v_cancelled_new int := 0; v_cancelled_existing int := 0;
  v_cancelled_post_produced int := 0; v_cancelled_already int := 0; v_skipped_unknown int := 0; v_free_stock_returned int := 0;
  v_descripcion text; v_reprogramada int := 0; v_reprog_new boolean;
  v_titulo text; v_variante text; v_sin_sku int := 0; v_resueltos int := 0;   -- Fase C
BEGIN
  SELECT role, active INTO v_role, v_active_user FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active_user = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin','encargado') THEN
    RAISE EXCEPTION 'Sin permiso para importar.' USING ERRCODE='42501', HINT='not_authorized'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.channels WHERE id = p_channel_id) THEN
    RAISE EXCEPTION 'Canal % no existe.', p_channel_id USING ERRCODE='23503'; END IF;

  IF p_target_jornada_id IS NOT NULL THEN
    SELECT id INTO v_jornada_id FROM public.jornadas WHERE id = p_target_jornada_id AND status = 'abierta';
    IF v_jornada_id IS NULL THEN
      RAISE EXCEPTION 'Jornada destino no existe o no esta abierta.' USING ERRCODE='22023', HINT='jornada_invalid'; END IF;
  ELSE
    SELECT count(*) INTO v_open_count FROM public.jornadas WHERE status='abierta';
    IF v_open_count = 0 THEN
      RAISE EXCEPTION 'No hay jornadas abiertas. Abri una antes de importar.' USING ERRCODE='22023', HINT='no_jornada';
    ELSIF v_open_count = 1 THEN
      SELECT id INTO v_jornada_id FROM public.jornadas WHERE status='abierta';
    ELSE
      RAISE EXCEPTION 'Hay % jornadas abiertas. Elegi a cual importar.', v_open_count USING ERRCODE='22023', HINT='multiple_jornadas';
    END IF;
  END IF;

  v_sector := public.role_to_sector(v_role);

  INSERT INTO public.import_batches (channel_id, filename, file_hash, imported_by, storage_path)
  VALUES (p_channel_id, p_filename, p_file_hash, auth.uid(), p_storage_path)
  RETURNING id INTO v_batch_id;

  -- ── PASS 1: aprender mapeo Título+Variante → SKU de las filas que SÍ traen SKU activo ──
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_sku    := NULLIF(trim(COALESCE(v_item->>'sku','')), '');
    v_titulo := NULLIF(trim(COALESCE(v_item->>'titulo','')), '');
    IF v_sku IS NOT NULL AND v_titulo IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.sku_catalog WHERE sku = upper(v_sku) AND activo = true) THEN
      INSERT INTO public.ml_sku_map (titulo_norm, variante_norm, sku, titulo_sample, variante_sample, updated_at)
      VALUES (public.ml_norm(v_titulo), public.ml_norm(COALESCE(v_item->>'variante','')),
              upper(v_sku), v_titulo, NULLIF(trim(COALESCE(v_item->>'variante','')),''), now())
      ON CONFLICT (titulo_norm, variante_norm) DO UPDATE
        SET sku = EXCLUDED.sku, titulo_sample = EXCLUDED.titulo_sample,
            variante_sample = EXCLUDED.variante_sample, updated_at = now();
    END IF;
  END LOOP;

  -- ── PASS 2: procesar items (resolviendo SKU vacío contra el mapeo) ──
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_estado := COALESCE(v_item->>'estado', '');
    v_descripcion := NULLIF(trim(COALESCE(v_item->>'descripcion', '')), '');
    v_sku    := NULLIF(trim(COALESCE(v_item->>'sku','')), '');
    v_titulo := NULLIF(trim(COALESCE(v_item->>'titulo','')), '');
    v_variante := NULLIF(trim(COALESCE(v_item->>'variante','')), '');
    v_cantidad := COALESCE((v_item->>'cantidad')::int, 0);
    v_order_number := COALESCE(v_item->>'order_number',
      'GEN-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || (v_inserted + v_cancelled_new)::text);

    -- Resolver SKU vacío por Título+Variante
    IF v_sku IS NULL AND v_titulo IS NOT NULL THEN
      SELECT sku INTO v_sku FROM public.ml_sku_map
        WHERE titulo_norm = public.ml_norm(v_titulo) AND variante_norm = public.ml_norm(COALESCE(v_variante,''));
      IF v_sku IS NOT NULL THEN v_resueltos := v_resueltos + 1; END IF;
    END IF;

    -- Sin SKU resuelto → cola de revisión (NO se pierde). Sigue al próximo item.
    IF v_sku IS NULL THEN
      INSERT INTO public.orders_sin_sku
        (channel_id, order_number, titulo, variante, cantidad, fecha_pedido, estado_ml, jornada_id, import_batch_id)
      VALUES (p_channel_id, v_order_number, COALESCE(v_titulo,''), COALESCE(v_variante,''), v_cantidad,
        COALESCE((v_item->>'fecha_pedido')::date, current_date), NULLIF(v_estado,''), v_jornada_id, v_batch_id)
      ON CONFLICT (channel_id, order_number, titulo, variante) DO NOTHING;
      v_sin_sku := v_sin_sku + 1;
      CONTINUE;
    END IF;

    v_sku := upper(v_sku);
    -- Si se resolvió un SKU que estaba en la cola, marcar como resuelto.
    UPDATE public.orders_sin_sku SET resuelto = true
      WHERE channel_id = p_channel_id AND order_number = v_order_number AND resuelto = false;

    IF NOT EXISTS (SELECT 1 FROM public.sku_catalog WHERE sku = v_sku AND activo = true) THEN
      v_skipped_unknown := v_skipped_unknown + 1;
      CONTINUE;
    END IF;

    -- ── CANCELADA ──
    IF public.es_venta_cancelada(v_estado) THEN
      SELECT * INTO v_existing FROM public.orders
        WHERE channel_id = p_channel_id AND order_number = v_order_number AND sku = v_sku FOR UPDATE;
      IF NOT FOUND THEN
        INSERT INTO public.orders
          (channel_id, order_number, cliente, sku, cantidad, fecha_pedido, status, import_batch_id, jornada_id,
           cancelled_at, cancelled_in_jornada_id, cancelacion_motivo, estado_ml)
        VALUES (p_channel_id, v_order_number, v_item->>'cliente', v_sku, v_cantidad,
          COALESCE((v_item->>'fecha_pedido')::date, current_date),
          'cancelado', v_batch_id, v_jornada_id, now(), v_jornada_id, v_descripcion, NULLIF(v_estado,''))
        ON CONFLICT (channel_id, order_number, sku) DO NOTHING;
        IF FOUND THEN v_cancelled_new := v_cancelled_new + 1; END IF;
      ELSIF v_existing.status = 'cancelado' THEN
        v_cancelled_already := v_cancelled_already + 1;
      ELSE
        SELECT GREATEST(0, COALESCE(SUM(pl.cantidad), 0)) INTO v_total_produced
          FROM public.production_logs pl
          WHERE pl.sku = v_existing.sku AND pl.channel_id = v_existing.channel_id AND pl.jornada_id = v_existing.jornada_id
            AND (pl.notas IS NULL OR pl.notas NOT LIKE '[CANCELACION]%');
        SELECT COALESCE(SUM(o.cantidad), 0) INTO v_already_cancelled_qty
          FROM public.orders o
          WHERE o.sku = v_existing.sku AND o.channel_id = v_existing.channel_id AND o.jornada_id = v_existing.jornada_id
            AND o.status = 'cancelado' AND o.id <> v_existing.id;
        v_recover := LEAST(v_existing.cantidad, GREATEST(0, v_total_produced - v_already_cancelled_qty));
        UPDATE public.orders
          SET status = 'cancelado', cancelled_at = now(), cancelled_in_jornada_id = v_jornada_id,
              cancelacion_motivo = COALESCE(v_descripcion, cancelacion_motivo), estado_ml = NULLIF(v_estado,'')
          WHERE id = v_existing.id;
        IF v_recover > 0 THEN
          INSERT INTO public.free_stock (sku, source_jornada_id, cantidad)
            VALUES (v_existing.sku, v_jornada_id, v_recover)
            ON CONFLICT (sku, source_jornada_id) DO UPDATE SET cantidad = public.free_stock.cantidad + EXCLUDED.cantidad;
          INSERT INTO public.production_logs (sku, channel_id, cantidad, operario_id, sector, fecha, hora, notas, jornada_id)
          VALUES (v_existing.sku, v_existing.channel_id, -v_recover, auth.uid(), v_sector, current_date, current_time,
            '[CANCELACION] order=' || v_existing.order_number, v_jornada_id);
          v_cancelled_post_produced := v_cancelled_post_produced + 1;
          v_free_stock_returned := v_free_stock_returned + v_recover;
        ELSE
          v_cancelled_existing := v_cancelled_existing + 1;
        END IF;
      END IF;

    -- ── REPROGRAMADA (demorado) ──
    ELSIF public.es_venta_reprogramada(v_estado) THEN
      v_reprog_new := NULL;
      INSERT INTO public.orders
        (channel_id, order_number, cliente, sku, cantidad, fecha_pedido, status, import_batch_id, jornada_id,
         reprogramada_at, reprogramada_motivo, reprogramada_in_jornada_id, estado_ml)
      VALUES (p_channel_id, v_order_number, v_item->>'cliente', v_sku, v_cantidad,
        COALESCE((v_item->>'fecha_pedido')::date, current_date),
        'pendiente', v_batch_id, v_jornada_id, now(), v_estado, v_jornada_id, NULLIF(v_estado,''))
      ON CONFLICT (channel_id, order_number, sku) DO UPDATE SET
        reprogramada_at = COALESCE(public.orders.reprogramada_at, now()),
        reprogramada_motivo = COALESCE(public.orders.reprogramada_motivo, EXCLUDED.reprogramada_motivo),
        reprogramada_in_jornada_id = COALESCE(public.orders.reprogramada_in_jornada_id, EXCLUDED.reprogramada_in_jornada_id),
        estado_ml = EXCLUDED.estado_ml
        WHERE public.orders.reprogramada_at IS NULL
      RETURNING (xmax = 0) INTO v_reprog_new;
      IF v_reprog_new IS TRUE THEN v_inserted := v_inserted + 1; v_unidades := v_unidades + v_cantidad; END IF;
      v_reprogramada := v_reprogramada + 1;

    -- ── A DESPACHAR ──
    ELSE
      INSERT INTO public.orders
        (channel_id, order_number, cliente, sku, cantidad, fecha_pedido, status, import_batch_id, jornada_id, estado_ml)
      VALUES (p_channel_id, v_order_number, v_item->>'cliente', v_sku, v_cantidad,
        COALESCE((v_item->>'fecha_pedido')::date, current_date),
        'pendiente', v_batch_id, v_jornada_id, NULLIF(v_estado,''))
      ON CONFLICT (channel_id, order_number, sku) DO NOTHING;
      IF FOUND THEN v_inserted := v_inserted + 1; v_unidades := v_unidades + v_cantidad; END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'batch_id', v_batch_id, 'jornada_id', v_jornada_id,
    'inserted_count', v_inserted, 'unidades_count', v_unidades,
    'reprogramada_count', v_reprogramada,
    'sku_resueltos_count', v_resueltos, 'sin_sku_count', v_sin_sku,
    'cancelled_new', v_cancelled_new, 'cancelled_existing', v_cancelled_existing,
    'cancelled_post_produced', v_cancelled_post_produced, 'cancelled_already', v_cancelled_already,
    'skipped_unknown_count', v_skipped_unknown, 'free_stock_returned', v_free_stock_returned
  );
END;
$function$;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual): re-aplicar 0097; DROP TABLE orders_sin_sku, ml_sku_map;
-- DROP FUNCTION ml_norm(text).
-- ════════════════════════════════════════════════════════════════════
