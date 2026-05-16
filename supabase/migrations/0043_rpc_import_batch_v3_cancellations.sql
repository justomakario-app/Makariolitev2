-- ════════════════════════════════════════════════════════════════════
-- FEATURE — Cancelaciones ML: rpc_import_batch v3 (procesa cancelados)
-- ════════════════════════════════════════════════════════════════════
-- Antes (v2): los items con estado="Venta cancelada..." se contaban en
-- v_cancelled y CONTINUE — no se persistian en ninguna parte.
--
-- Ahora (v3): procesa cancelaciones segun los 4 casos definidos por
-- el cliente (Sebastian, encargado):
--
--   CASO A — order NO existe (channel,order_number,sku) y viene cancelada:
--     INSERT con status='cancelado', jornada_id=v_jornada_id (la del
--     import), cancelled_at=now(), cancelled_in_jornada_id=v_jornada_id.
--
--   CASO B — order EXISTE en pendiente/arrastrado/archivado y NO tuvo
--     produccion (o la produccion ya fue compensada por cancelaciones
--     previas): UPDATE status='cancelado', cancelled_at,
--     cancelled_in_jornada_id. Mantiene jornada_id original.
--
--   CASO C — order EXISTE con production_logs y produccion remanente >0:
--     UPDATE status='cancelado' + INSERT en free_stock (source=jornada
--     del import) + INSERT compensatorio en production_logs (cantidad=
--     -v_recover, jornada_id=v_jornada_id) con notas '[CANCELACION]
--     order=...'. La heuristica de recovery:
--        v_recover = min(o.cantidad,
--                        max(0, total_produced - already_cancelled_qty))
--     donde:
--        - total_produced = SUM positivo de production_logs.cantidad
--          filtrado por sku+channel+jornada ORIGINAL de la order.
--        - already_cancelled_qty = SUM de cantidad de otras orders del
--          mismo sku+channel+jornada con status='cancelado' (evita
--          doble-recovery cuando se cancelan varias hermanas en serie).
--
--   CASO D — order EXISTE ya en status='cancelado': no-op (idempotente).
--
-- Items NO cancelados: comportamiento IDENTICO al v2 (INSERT pendiente
-- ... ON CONFLICT DO NOTHING).
--
-- Items con SKU desconocido (cancelados o no): skip (igual que v2).
--
-- Cero cambio en:
--   - Firma (mantiene 6 parametros del v2).
--   - rpc_close_jornada (sus filtros status IN ('pendiente','arrastrado')
--     ya excluyen canceladas).
--   - recompute_carrier_state_for + trg_orders_recompute_state (sus
--     filtros tambien excluyen canceladas - sin regresion).
--   - REVOKE EXECUTE de migration 0036 (firma idem -> permisos
--     preservados).
--
-- Retorna JSONB extendido con conteos por caso para el frontend:
--   batch_id, jornada_id, inserted_count, unidades_count,
--   cancelled_new, cancelled_existing, cancelled_post_produced,
--   cancelled_already, skipped_unknown_count, free_stock_returned.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rpc_import_batch(
  p_channel_id        text,
  p_filename          text,
  p_file_hash         text,
  p_items             jsonb,
  p_storage_path      text DEFAULT NULL::text,
  p_target_jornada_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role             role_enum;
  v_active_user      boolean;
  v_sector           text;
  v_batch_id         uuid;
  v_jornada_id       uuid;
  v_item             jsonb;
  v_open_count       int;
  v_estado           text;
  v_sku              text;
  v_order_number     text;
  v_cantidad         int;
  v_existing         public.orders%ROWTYPE;
  v_total_produced       int;
  v_already_cancelled_qty int;
  v_recover          int;
  v_inserted                int := 0;
  v_unidades                int := 0;
  v_cancelled_new           int := 0;
  v_cancelled_existing      int := 0;
  v_cancelled_post_produced int := 0;
  v_cancelled_already       int := 0;
  v_skipped_unknown         int := 0;
  v_free_stock_returned     int := 0;
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

  v_sector := public.role_to_sector(v_role);

  INSERT INTO public.import_batches
    (channel_id, filename, file_hash, imported_by, storage_path)
  VALUES
    (p_channel_id, p_filename, p_file_hash, auth.uid(), p_storage_path)
  RETURNING id INTO v_batch_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_estado := COALESCE(v_item->>'estado', '');
    v_sku := v_item->>'sku';
    v_cantidad := COALESCE((v_item->>'cantidad')::int, 0);
    v_order_number := COALESCE(v_item->>'order_number',
      'GEN-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' ||
      (v_inserted + v_cancelled_new)::text);

    IF NOT EXISTS (SELECT 1 FROM public.sku_catalog
      WHERE sku = v_sku AND activo = true) THEN
      v_skipped_unknown := v_skipped_unknown + 1;
      CONTINUE;
    END IF;

    -- Detector robusto (spec Sebastian): includes "cancelada".
    -- El v2 usaba 'cancelada%' (startsWith) que NUNCA matcheaba
    -- "Venta cancelada. No despaches." → de ahi el bug reportado.
    IF lower(trim(v_estado)) LIKE '%cancelada%' THEN
      -- ═══ RAMA CANCELACION ═══════════════════════════════════════
      SELECT * INTO v_existing FROM public.orders
        WHERE channel_id = p_channel_id
          AND order_number = v_order_number
          AND sku = v_sku
        FOR UPDATE;

      IF NOT FOUND THEN
        -- CASO A: order NUEVA marcada cancelada de entrada
        INSERT INTO public.orders
          (channel_id, order_number, cliente, sku, cantidad, fecha_pedido,
           status, import_batch_id, jornada_id,
           cancelled_at, cancelled_in_jornada_id)
        VALUES (
          p_channel_id, v_order_number, v_item->>'cliente', v_sku, v_cantidad,
          COALESCE((v_item->>'fecha_pedido')::date, current_date),
          'cancelado', v_batch_id, v_jornada_id,
          now(), v_jornada_id
        )
        ON CONFLICT (channel_id, order_number, sku) DO NOTHING;
        IF FOUND THEN
          v_cancelled_new := v_cancelled_new + 1;
        END IF;

      ELSIF v_existing.status = 'cancelado' THEN
        -- CASO D: idempotente
        v_cancelled_already := v_cancelled_already + 1;

      ELSE
        -- CASO B o C: existe en pendiente/arrastrado/archivado/completado
        -- v_total_produced excluye las compensatorias [CANCELACION] propias
        -- para no descontar dos veces cuando se cancelan varias hermanas
        -- del mismo (sku,channel,jornada) en serie (v_already_cancelled_qty
        -- ya se encarga de descontar lo cancelado).
        SELECT GREATEST(0, COALESCE(SUM(pl.cantidad), 0)) INTO v_total_produced
          FROM public.production_logs pl
          WHERE pl.sku = v_existing.sku
            AND pl.channel_id = v_existing.channel_id
            AND pl.jornada_id = v_existing.jornada_id
            AND (pl.notas IS NULL OR pl.notas NOT LIKE '[CANCELACION]%');

        SELECT COALESCE(SUM(o.cantidad), 0) INTO v_already_cancelled_qty
          FROM public.orders o
          WHERE o.sku = v_existing.sku
            AND o.channel_id = v_existing.channel_id
            AND o.jornada_id = v_existing.jornada_id
            AND o.status = 'cancelado'
            AND o.id <> v_existing.id;

        v_recover := LEAST(v_existing.cantidad,
                           GREATEST(0, v_total_produced - v_already_cancelled_qty));

        UPDATE public.orders
          SET status = 'cancelado',
              cancelled_at = now(),
              cancelled_in_jornada_id = v_jornada_id
          WHERE id = v_existing.id;

        IF v_recover > 0 THEN
          -- CASO C: devolver producido a free_stock + log compensatorio
          INSERT INTO public.free_stock (sku, source_jornada_id, cantidad)
            VALUES (v_existing.sku, v_jornada_id, v_recover)
            ON CONFLICT (sku, source_jornada_id) DO UPDATE
              SET cantidad = public.free_stock.cantidad + EXCLUDED.cantidad;

          INSERT INTO public.production_logs
            (sku, channel_id, cantidad, operario_id, sector,
             fecha, hora, notas, jornada_id)
          VALUES (
            v_existing.sku, v_existing.channel_id, -v_recover,
            auth.uid(), v_sector, current_date, current_time,
            '[CANCELACION] order=' || v_existing.order_number,
            v_jornada_id
          );

          v_cancelled_post_produced := v_cancelled_post_produced + 1;
          v_free_stock_returned := v_free_stock_returned + v_recover;
        ELSE
          -- CASO B: sin produccion remanente, solo marcar cancelada
          v_cancelled_existing := v_cancelled_existing + 1;
        END IF;
      END IF;

    ELSE
      -- ═══ RAMA NORMAL (no cancelado) - identico a v2 ════════════
      INSERT INTO public.orders
        (channel_id, order_number, cliente, sku, cantidad, fecha_pedido,
         status, import_batch_id, jornada_id)
      VALUES (
        p_channel_id, v_order_number, v_item->>'cliente', v_sku, v_cantidad,
        COALESCE((v_item->>'fecha_pedido')::date, current_date),
        'pendiente', v_batch_id, v_jornada_id
      )
      ON CONFLICT (channel_id, order_number, sku) DO NOTHING;
      IF FOUND THEN
        v_inserted := v_inserted + 1;
        v_unidades := v_unidades + v_cantidad;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'batch_id',                  v_batch_id,
    'jornada_id',                v_jornada_id,
    'inserted_count',            v_inserted,
    'unidades_count',            v_unidades,
    'cancelled_new',             v_cancelled_new,
    'cancelled_existing',        v_cancelled_existing,
    'cancelled_post_produced',   v_cancelled_post_produced,
    'cancelled_already',         v_cancelled_already,
    'skipped_unknown_count',     v_skipped_unknown,
    'free_stock_returned',       v_free_stock_returned
  );
END;
$function$;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual): restaurar el v2 con su body original que descartaba
-- cancelados. Copia bit-perfect del def actual disponible en
-- supabase/migrations/0029_jornada_dia_completo_rpcs.sql.
-- Tras rollback de 0043, las cancelaciones nuevas vuelven a descartarse
-- (sin tocar las que ya quedaron persistidas con status='cancelado' por
-- el v3, que siguen existiendo pero ya no se actualizan).
-- ════════════════════════════════════════════════════════════════════
