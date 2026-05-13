-- ════════════════════════════════════════════════════════════════════
-- FIX J.2 — rpc_assign_free_stock: aceptar p_motivo opcional
-- ════════════════════════════════════════════════════════════════════
-- Hoy, cuando admin mueve stock central → canal vía StockMovementModal
-- y escribe motivo, ese motivo se descarta silenciosamente porque la
-- firma del RPC no lo acepta. Esto rompe la auditoría: el log
-- [FROM_FREE_STOCK] queda sin motivo aunque el usuario lo escribió.
--
-- Cambio quirúrgico:
--   - Agregar p_motivo text DEFAULT NULL al final de la firma.
--   - Concatenar motivo a la nota del log (mismo patrón que ya usan
--     rpc_send_to_free_stock y rpc_transfer_between_channels).
--   - Resto del cuerpo IDÉNTICO a la versión actual (migration 0013):
--     auth check, validaciones, FIFO de free_stock, jornada resolution.
--
-- Retro-compat total: callers que no pasan p_motivo (todos los actuales
-- excepto el dispatcher del modal) siguen funcionando — el motivo
-- queda NULL y la nota es '[FROM_FREE_STOCK] cantidad=N' como antes.
--
-- DROP previo de la firma vieja (4 args) requerido para evitar
-- coexistencia ambigua con PostgREST (CREATE OR REPLACE no resuelve
-- el cambio de firma).
-- ════════════════════════════════════════════════════════════════════

-- DROP de la firma vieja (4 args) para evitar coexistencia + ambigüedad PostgREST
DROP FUNCTION IF EXISTS public.rpc_assign_free_stock(text, integer, text, uuid);

-- v2 con p_motivo opcional al final
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

  SELECT COALESCE(SUM(cantidad), 0)::int INTO v_total_libre
    FROM public.free_stock WHERE sku = p_sku;

  IF v_total_libre < p_cantidad THEN
    RAISE EXCEPTION 'Solo hay % unidades de % en stock libre (pediste %).',
      v_total_libre, p_sku, p_cantidad
      USING ERRCODE='22023', HINT='insufficient_free_stock';
  END IF;

  -- Resolver jornada destino (lógica idéntica a v1)
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

  -- Consumir free_stock FIFO por jornada de origen (sin cambios)
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

  -- Insertar production_log positivo. ÚNICO CAMBIO vs v1:
  -- agregar 'motivo=...' a la nota cuando p_motivo es no vacío.
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

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual, NO ejecutar sin entender la regresión):
-- 1) DROP FUNCTION public.rpc_assign_free_stock(text, integer, text, uuid, text);
-- 2) Re-aplicar la versión 4-args desde migration 0013.
-- ════════════════════════════════════════════════════════════════════
