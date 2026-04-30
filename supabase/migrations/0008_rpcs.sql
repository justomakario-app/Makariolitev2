-- ═══════════════════════════════════════════════════════════════════════════
-- 0008_rpcs.sql — RPCs principales
-- ───────────────────────────────────────────────────────────────────────────
-- 3 RPCs:
--   1. rpc_register_production({sku, channel_id, cantidad, notas?})
--      → inserta production_log con operario_id=auth.uid() y sector
--        derivado del rol del operario.
--
--   2. rpc_import_batch({channel_id, filename, file_hash, storage_path?, items[]})
--      → atomic: crea import_batch + inserta orders + retorna metadata.
--        Idempotente: si file_hash ya existe, devuelve el batch existente.
--
--   3. rpc_close_jornada({channel_id, fecha?})
--      → atomic: snapshot del carrier_state + archive completed orders +
--        arrastrar faltante como nuevas orders status=arrastrado al día siguiente.
--
-- Todas SECURITY DEFINER + auth checks internos.
-- ═══════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────
-- Helper interno: derivar sector desde role
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.role_to_sector(p_role role_enum)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_role
    WHEN 'cnc'         THEN 'CNC'
    WHEN 'melamina'    THEN 'Melamina'
    WHEN 'pino'        THEN 'Pino'
    WHEN 'embalaje'    THEN 'Embalaje'
    WHEN 'carpinteria' THEN 'Carpintería'
    WHEN 'logistica'   THEN 'Logística'
    WHEN 'encargado'   THEN 'Encargado'
    WHEN 'owner'       THEN 'Dirección'
    WHEN 'admin'       THEN 'Administración'
    WHEN 'ventas'      THEN 'Ventas'
    WHEN 'marketing'   THEN 'Marketing'
    ELSE 'General'
  END;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- 1. rpc_register_production
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.rpc_register_production(
  p_sku        text,
  p_channel_id text,
  p_cantidad   int,
  p_notas      text DEFAULT NULL
)
RETURNS public.production_logs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role        role_enum;
  v_active      boolean;
  v_sector      text;
  v_log         public.production_logs;
BEGIN
  -- Auth check: el caller tiene que ser un user activo
  SELECT role, active INTO v_role, v_active
  FROM public.profiles WHERE id = auth.uid();

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado o sin profile' USING ERRCODE = '42501';
  END IF;
  IF v_active = false THEN
    RAISE EXCEPTION 'Usuario desactivado' USING ERRCODE = '42501';
  END IF;

  -- Validaciones de input
  IF p_cantidad = 0 THEN
    RAISE EXCEPTION 'cantidad no puede ser 0' USING ERRCODE = '22023';
  END IF;
  IF p_sku IS NULL OR p_channel_id IS NULL THEN
    RAISE EXCEPTION 'sku y channel_id son obligatorios' USING ERRCODE = '22023';
  END IF;

  -- Validar que el SKU existe y está activo
  IF NOT EXISTS (SELECT 1 FROM public.sku_catalog WHERE sku = p_sku AND activo = true) THEN
    RAISE EXCEPTION 'SKU % no existe o está inactivo', p_sku USING ERRCODE = '23503';
  END IF;
  -- Validar que el channel existe
  IF NOT EXISTS (SELECT 1 FROM public.channels WHERE id = p_channel_id) THEN
    RAISE EXCEPTION 'channel_id % no existe', p_channel_id USING ERRCODE = '23503';
  END IF;

  -- Sector derivado del rol del operario
  v_sector := public.role_to_sector(v_role);

  -- Insertar production_log
  INSERT INTO public.production_logs
    (sku, channel_id, cantidad, operario_id, sector, fecha, hora, notas)
  VALUES
    (p_sku, p_channel_id, p_cantidad, auth.uid(), v_sector,
     current_date, current_time, NULLIF(trim(coalesce(p_notas, '')), ''))
  RETURNING * INTO v_log;

  -- Trigger trg_prodlog_recompute_state actualiza carrier_state automáticamente.

  -- Notificación: si faltante llegó a 0, notificar a owner+encargado
  IF EXISTS (
    SELECT 1 FROM public.carrier_state
    WHERE channel_id = p_channel_id AND sku = p_sku AND faltante = 0 AND pedido > 0
  ) THEN
    INSERT INTO public.notifications (user_id, tipo, titulo, mensaje, link)
    SELECT
      p.id,
      'produccion',
      'Producción completada',
      format('Se completó el faltante para %s en %s.', p_sku, p_channel_id),
      format('/canal/%s', p_channel_id)
    FROM public.profiles p
    WHERE p.role IN ('owner', 'encargado') AND p.active = true;
  END IF;

  RETURN v_log;
END;
$$;
COMMENT ON FUNCTION public.rpc_register_production(text, text, int, text) IS
  'Registra producción. Auto-completa operario_id=auth.uid() y sector=role_to_sector(role). Inserta log + trigger actualiza carrier_state. Si faltante llega a 0, notifica a owner+encargado.';

GRANT EXECUTE ON FUNCTION public.rpc_register_production(text, text, int, text) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. rpc_import_batch
-- ══════════════════════════════════════════════════════════════════════════
-- p_items: jsonb array con elementos {sku, cantidad, order_number?, cliente?, fecha_pedido?}
-- Retorna: { batch_id, inserted_count, ignored_skus[], existed (bool) }

CREATE OR REPLACE FUNCTION public.rpc_import_batch(
  p_channel_id   text,
  p_filename     text,
  p_file_hash    text,
  p_items        jsonb,
  p_storage_path text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role        role_enum;
  v_active      boolean;
  v_batch_id    uuid;
  v_existing_id uuid;
  v_item        jsonb;
  v_sku         text;
  v_cantidad    int;
  v_inserted    int := 0;
  v_unidades    int := 0;
  v_ignored     text[] := '{}';
BEGIN
  -- Auth check
  SELECT role, active INTO v_role, v_active
  FROM public.profiles WHERE id = auth.uid();

  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Usuario no autenticado o desactivado' USING ERRCODE = '42501';
  END IF;
  IF v_role NOT IN ('owner', 'admin', 'encargado') THEN
    RAISE EXCEPTION 'Solo owner, admin o encargado pueden importar lotes' USING ERRCODE = '42501';
  END IF;

  -- Validaciones de input
  IF p_channel_id IS NULL OR p_filename IS NULL OR p_file_hash IS NULL THEN
    RAISE EXCEPTION 'channel_id, filename y file_hash son obligatorios' USING ERRCODE = '22023';
  END IF;
  IF p_file_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'file_hash debe ser SHA-256 hex (64 chars [a-f0-9])' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.channels WHERE id = p_channel_id) THEN
    RAISE EXCEPTION 'channel_id % no existe', p_channel_id USING ERRCODE = '23503';
  END IF;

  -- Idempotencia: si ya existe un batch con ese hash, devolverlo sin re-insertar
  SELECT id INTO v_existing_id
  FROM public.import_batches WHERE file_hash = p_file_hash;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'batch_id', v_existing_id,
      'inserted_count', 0,
      'ignored_skus', '[]'::jsonb,
      'existed', true,
      'message', 'Ya importado anteriormente — no se duplicó.'
    );
  END IF;

  -- Crear batch
  INSERT INTO public.import_batches
    (channel_id, filename, file_hash, storage_path, imported_by, pedidos_count, unidades_count)
  VALUES
    (p_channel_id, p_filename, p_file_hash, p_storage_path, auth.uid(), 0, 0)
  RETURNING id INTO v_batch_id;

  -- Iterar items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_sku := upper(trim(v_item->>'sku'));
    v_cantidad := COALESCE((v_item->>'cantidad')::int, 0);

    IF v_cantidad <= 0 OR v_sku IS NULL OR v_sku = '' THEN
      CONTINUE;
    END IF;

    -- Si SKU desconocido o inactivo, agregar a ignored y skip
    IF NOT EXISTS (SELECT 1 FROM public.sku_catalog WHERE sku = v_sku AND activo = true) THEN
      v_ignored := array_append(v_ignored, v_sku);
      CONTINUE;
    END IF;

    -- Insertar order. Si hay duplicado por (channel_id, order_number, sku), skip.
    BEGIN
      INSERT INTO public.orders
        (channel_id, order_number, cliente, sku, cantidad,
         fecha_pedido, import_batch_id, status)
      VALUES (
        p_channel_id,
        COALESCE(NULLIF(trim(v_item->>'order_number'), ''),
                 'IMP-' || substr(md5(v_batch_id::text || v_sku || v_inserted::text), 1, 8)),
        NULLIF(trim(v_item->>'cliente'), ''),
        v_sku,
        v_cantidad,
        COALESCE((v_item->>'fecha_pedido')::date, current_date),
        v_batch_id,
        'pendiente'
      );
      v_inserted := v_inserted + 1;
      v_unidades := v_unidades + v_cantidad;
    EXCEPTION WHEN unique_violation THEN
      -- Order ya existe (mismo channel_id + order_number + sku) → skip silenciosamente
      NULL;
    END;
  END LOOP;

  -- Actualizar contadores del batch
  UPDATE public.import_batches
  SET pedidos_count     = v_inserted,
      unidades_count    = v_unidades,
      skus_desconocidos = (SELECT array(SELECT DISTINCT unnest FROM unnest(v_ignored)))
  WHERE id = v_batch_id;

  -- Notificación al encargado
  INSERT INTO public.notifications (user_id, tipo, titulo, mensaje, link)
  SELECT p.id, 'nuevo_pedido',
    format('Nuevo lote importado en %s', p_channel_id),
    format('%s pedidos · %s uds · archivo: %s', v_inserted, v_unidades, p_filename),
    format('/canal/%s', p_channel_id)
  FROM public.profiles p
  WHERE p.role IN ('encargado', 'owner') AND p.active = true;

  RETURN jsonb_build_object(
    'batch_id', v_batch_id,
    'inserted_count', v_inserted,
    'unidades_count', v_unidades,
    'ignored_skus', to_jsonb((SELECT array(SELECT DISTINCT unnest FROM unnest(v_ignored)))),
    'existed', false
  );
END;
$$;
COMMENT ON FUNCTION public.rpc_import_batch(text, text, text, jsonb, text) IS
  'Importa lote de Excel. Idempotente por file_hash. Retorna {batch_id, inserted_count, unidades_count, ignored_skus[], existed}. Genera notificación a encargado/owner.';

GRANT EXECUTE ON FUNCTION public.rpc_import_batch(text, text, text, jsonb, text) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- 3. rpc_close_jornada
-- ══════════════════════════════════════════════════════════════════════════
-- 1. Crea snapshot en jornadas con estado actual de carrier_state.
-- 2. Marca como 'archivado' las orders pendientes/arrastradas que ya están completadas.
-- 3. Las que tienen faltante > 0 → genera nuevas orders 'arrastrado' al día siguiente
--    y marca las originales como 'archivado' también.
-- 4. Vincula a la jornada via jornada_id.

CREATE OR REPLACE FUNCTION public.rpc_close_jornada(
  p_channel_id text,
  p_fecha      date DEFAULT NULL  -- default = current_date
)
RETURNS public.jornadas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role        role_enum;
  v_active      boolean;
  v_fecha       date;
  v_tipo_cierre cierre_enum;
  v_snapshot    jsonb;
  v_jornada     public.jornadas;
  v_pedidos     int;
  v_unidades_p  int;
  v_unidades_d  int;
  v_faltante    int;
  v_order       record;
BEGIN
  -- Auth check
  SELECT role, active INTO v_role, v_active
  FROM public.profiles WHERE id = auth.uid();

  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Usuario no autenticado o desactivado' USING ERRCODE = '42501';
  END IF;
  IF v_role NOT IN ('owner', 'admin', 'encargado') THEN
    RAISE EXCEPTION 'Solo owner, admin o encargado pueden cerrar jornadas' USING ERRCODE = '42501';
  END IF;

  v_fecha := COALESCE(p_fecha, current_date);

  -- Validar que el canal tiene cierre horario (Colecta/Flex)
  SELECT tipo_cierre INTO v_tipo_cierre
  FROM public.channels WHERE id = p_channel_id;

  IF v_tipo_cierre IS NULL THEN
    RAISE EXCEPTION 'channel_id % no existe', p_channel_id USING ERRCODE = '23503';
  END IF;
  IF v_tipo_cierre <> 'horario' THEN
    RAISE EXCEPTION 'Solo canales con tipo_cierre=horario pueden cerrar jornada (canal % es %)',
      p_channel_id, v_tipo_cierre USING ERRCODE = '22023';
  END IF;

  -- Generar snapshot del carrier_state actual para ese canal
  SELECT
    jsonb_agg(jsonb_build_object(
      'sku',       cs.sku,
      'modelo',    sc.modelo,
      'color',     sc.color,
      'pedido',    cs.pedido,
      'producido', cs.producido,
      'faltante',  cs.faltante,
      'stock',     cs.stock
    ) ORDER BY cs.sku),
    COALESCE(SUM(cs.pedido), 0),
    COALESCE(SUM(cs.producido), 0),
    COALESCE(SUM(cs.faltante), 0)
  INTO v_snapshot, v_unidades_p, v_unidades_d, v_faltante
  FROM public.carrier_state cs
  LEFT JOIN public.sku_catalog sc ON sc.sku = cs.sku
  WHERE cs.channel_id = p_channel_id;

  -- Contar pedidos activos
  SELECT count(*) INTO v_pedidos
  FROM public.orders
  WHERE channel_id = p_channel_id
    AND status IN ('pendiente', 'arrastrado');

  -- Crear jornada
  INSERT INTO public.jornadas
    (channel_id, fecha, pedidos_count, unidades_pedidas, unidades_producidas,
     faltante_arrastrado, snapshot, closed_by)
  VALUES
    (p_channel_id, v_fecha, v_pedidos, v_unidades_p, v_unidades_d,
     v_faltante, COALESCE(v_snapshot, '[]'::jsonb), auth.uid())
  RETURNING * INTO v_jornada;

  -- Marcar orders activas como archivadas (las que están completadas) y
  -- generar nuevas orders 'arrastrado' para faltantes al día siguiente.
  FOR v_order IN
    SELECT o.id, o.channel_id, o.order_number, o.cliente, o.sku, o.cantidad
    FROM public.orders o
    WHERE o.channel_id = p_channel_id
      AND o.status IN ('pendiente', 'arrastrado')
  LOOP
    -- Si el SKU tiene faltante a nivel del carrier (sumando todas las orders),
    -- duplicamos esta orden como 'arrastrado' al día siguiente.
    -- Decisión simplificada: arrastramos TODAS las orders del SKU si hay faltante.
    -- (En el rewire del frontend Fase 7, podemos refinar a arrastrar proporcionalmente)
    IF EXISTS (
      SELECT 1 FROM public.carrier_state cs
      WHERE cs.channel_id = p_channel_id AND cs.sku = v_order.sku AND cs.faltante > 0
    ) THEN
      INSERT INTO public.orders
        (channel_id, order_number, cliente, sku, cantidad,
         fecha_pedido, status)
      VALUES (
        v_order.channel_id,
        v_order.order_number || '-A' || to_char(v_fecha, 'YYYYMMDD'),
        v_order.cliente,
        v_order.sku,
        v_order.cantidad,
        v_fecha + 1,
        'arrastrado'
      )
      ON CONFLICT (channel_id, order_number, sku) DO NOTHING;
    END IF;

    -- Marcar la orden original como archivada y vincular a la jornada
    UPDATE public.orders
    SET status = 'archivado', jornada_id = v_jornada.id
    WHERE id = v_order.id;
  END LOOP;

  -- Después del cierre, los triggers ya recalcularon carrier_state.
  -- El frontend va a ver el estado actualizado (faltante = 0 en lo que no tenía,
  -- y faltante volverá a aparecer cuando los arrastrados se procesen mañana).

  RETURN v_jornada;
END;
$$;
COMMENT ON FUNCTION public.rpc_close_jornada(text, date) IS
  'Cierra jornada para un canal con tipo_cierre=horario. Crea snapshot, archiva orders pendientes y arrastra faltantes al día siguiente como nuevas orders status=arrastrado. Atomic.';

GRANT EXECUTE ON FUNCTION public.rpc_close_jornada(text, date) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- FIN 0008_rpcs.sql
-- ══════════════════════════════════════════════════════════════════════════
