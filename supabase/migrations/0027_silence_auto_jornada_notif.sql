-- ════════════════════════════════════════════════════════════════════
-- FIX J.3 — Silenciar notifs spam de auto-apertura de jornada
-- ════════════════════════════════════════════════════════════════════
-- Cuando rpc_register_production v3 (migration 0015) detecta que un
-- operario carga sin jornada activa, auto-crea la jornada del canal Y
-- notifica a admins/encargados. En operación real, eso genera spam:
-- el primer día se podrían recibir 12+ notificaciones (operarios x
-- canales) mientras los admins abren las jornadas reales del día.
--
-- Cambio quirúrgico: eliminar el bloque IF v_auto_created THEN INSERT
-- INTO notifications. La trazabilidad de auto-apertura sigue intacta
-- en jornada_audit con accion='abierta' y motivo='Auto-apertura por
-- carga sin jornada activa'.
--
-- Variables v_auto_created y v_channel_label quedan declaradas
-- (sin uso post-fix) por si la decisión se revierte en el futuro —
-- minimiza diff y deja el código preparado.
--
-- NO TOCA:
--   - INSERT INTO production_logs (sigue cargando producción).
--   - Validación auth/rol (intacta).
--   - INSERT INTO jornadas (auto-creación en sí — sigue creando).
--   - INSERT INTO jornada_audit (trazabilidad intacta).
--   - Triggers sobre carrier_state (no son parte del RPC).
--   - El SEGUNDO INSERT INTO notifications de "Producción completada"
--     cuando faltante llega a 0 — ese SE MANTIENE (es info útil).
-- ════════════════════════════════════════════════════════════════════

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
    SELECT id INTO v_jornada_id FROM public.jornadas
     WHERE channel_id = p_channel_id AND status = 'abierta' AND is_active = true LIMIT 1;

    IF v_jornada_id IS NULL THEN
      SELECT count(*) INTO v_open_count FROM public.jornadas
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
                'Auto-activacion (unica abierta del canal)', auth.uid());
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

  -- J.3 FIX (2026-05-13): el bloque que notificaba a admins/encargados
  -- cuando se auto-creaba jornada FUE ELIMINADO. Razon: spam — el
  -- caller suele ser el mismo grupo que recibiría la notif. La
  -- trazabilidad sigue intacta en jornada_audit (accion='abierta'
  -- motivo='Auto-apertura por carga sin jornada activa'). Las
  -- variables v_auto_created y v_channel_label quedan declaradas por
  -- si la decision se revierte en el futuro.

  -- Notif "Producción completada" cuando faltante llega a 0: SE MANTIENE.
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

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual, NO ejecutar sin entender el bug original):
-- Re-aplicar rpc_register_production v3 desde migration 0015. Volvería
-- a generar spam de notifs cuando operarios cargan sin jornada activa.
-- ════════════════════════════════════════════════════════════════════
