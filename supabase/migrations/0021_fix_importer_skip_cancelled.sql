-- ════════════════════════════════════════════════════════════════════
-- FIX importador Excel ML — saltear pedidos cancelados
-- ════════════════════════════════════════════════════════════════════
-- Bug reportado por cliente: el importador cargaba como pedidos activos
-- las filas con Estado "Cancelada. No despaches" (con o sin punto al
-- final). La planta producía unidades que nadie iba a despachar.
--
-- Defensa en profundidad: el frontend filtra los items cancelados
-- antes de llamar al RPC y NO los incluye en p_items. Pero el RPC
-- también filtra como red de seguridad por si llega algo desde otro
-- cliente (versión vieja del frontend, integración futura, etc.).
--
-- Filtro: case-insensitive, items cuyo campo `estado` arranca con
-- "cancelada". Cubre las 2 variantes reales del Excel ML observadas:
--   - "Cancelada. No despaches"
--   - "Cancelada. No despaches."
-- y cualquier futura variante de ML que arranque igual.
--
-- Comportamiento defensivo (Q2):
--   - Si la columna "Estado" no existe en el Excel, el frontend pasa
--     items sin campo `estado`. El RPC trata `null` como "" → no
--     matchea el filtro → importa normal. Compatible con planillas
--     genéricas (Distribuidor, etc.).
--   - Si un item llega con `estado` undefined/null, NO se cancela
--     (default seguro).
--
-- Cambio en el response: agrega `cancelled_count: int` al jsonb de
-- retorno. Frontend lo usa para verificación cruzada con su propio
-- conteo y como auditoría histórica. En el path de idempotencia
-- (file_hash duplicado) también se devuelve cancelled_count: 0 para
-- shape consistente.
--
-- Idempotente: CREATE OR REPLACE FUNCTION.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rpc_import_batch(
  p_channel_id   text,
  p_filename     text,
  p_file_hash    text,
  p_items        jsonb,
  p_storage_path text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $func$
DECLARE
  v_role             role_enum;
  v_active           boolean;
  v_batch_id         uuid;
  v_existing_id      uuid;
  v_item             jsonb;
  v_sku              text;
  v_cantidad         int;
  v_estado           text;
  v_inserted         int := 0;
  v_unidades         int := 0;
  v_cancelled_count  int := 0;
  v_ignored          text[] := '{}';
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
      'cancelled_count', 0,
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
    v_sku      := upper(trim(v_item->>'sku'));
    v_cantidad := COALESCE((v_item->>'cantidad')::int, 0);
    v_estado   := COALESCE(v_item->>'estado', '');

    -- ── Filtro defensivo de cancelados ──
    -- Si llega un item con estado "cancelada..." (case-insensitive),
    -- saltearlo y sumar al contador. El frontend hoy filtra antes de
    -- llamar al RPC, pero esta es la red de seguridad para versiones
    -- viejas del cliente o integraciones futuras.
    IF lower(v_estado) LIKE 'cancelada%' THEN
      v_cancelled_count := v_cancelled_count + 1;
      CONTINUE;
    END IF;

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
    'batch_id',         v_batch_id,
    'inserted_count',   v_inserted,
    'unidades_count',   v_unidades,
    'ignored_skus',     to_jsonb((SELECT array(SELECT DISTINCT unnest FROM unnest(v_ignored)))),
    'cancelled_count',  v_cancelled_count,
    'existed',          false
  );
END;
$func$;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual, NO ejecutar sin entender la regresión):
-- Aplicar la versión anterior del RPC desde la migration 0008/posterior
-- (sin el bloque de filtro cancelados ni el campo cancelled_count en
-- el response). El campo `estado` en p_items que llega desde el
-- frontend nuevo queda ignorado silenciosamente — no rompe nada.
-- Cero pérdida de datos en cualquier dirección.
-- ════════════════════════════════════════════════════════════════════
