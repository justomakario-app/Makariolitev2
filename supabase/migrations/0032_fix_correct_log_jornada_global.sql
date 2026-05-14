-- ════════════════════════════════════════════════════════════════════
-- FIX — rpc_correct_log sin filtro de canal post-Cambio 2
-- ════════════════════════════════════════════════════════════════════
-- rpc_correct_log (creado en 0014) NO fue reescrito en 0029/0030/0031.
-- Tras migration 0028 (drop de jornadas.channel_id) quedaron 2 bloques
-- con referencias rotas a esa columna:
--
--   Bloque A — branch post-cierre (resuelve v_target_jornada_id cuando
--     el log corregido pertenece a una jornada CERRADA).
--   Bloque B — branch cambio de canal (resuelve v_new_target_jornada
--     cuando la corrección mueve la carga a otro canal).
--
-- Ambos hacían:
--   SELECT ... FROM jornadas WHERE channel_id = ... AND status='abierta' AND is_active=true
--   INSERT INTO jornadas (channel_id, fecha, ...) ON CONFLICT (channel_id, fecha) ...
--
-- → fallan con `column "channel_id" does not exist`.
--
-- Cambio MÍNIMO (mismo patrón que migration 0030 para rpc_edit_order):
--   - El SELECT busca la jornada activa GLOBAL (sin filtrar por canal).
--   - El INSERT omite channel_id; ON CONFLICT (fecha) en vez de
--     (channel_id, fecha).
--   - El branch `ELSE v_new_target_jornada := v_target_jornada_id` del
--     Bloque B queda IDÉNTICO.
--
-- TODO lo demás del RPC queda bit-perfect respecto a la versión viva:
-- firma, DECLARE, auth, validaciones (24h, ya compensado, anulación),
-- INSERT de la compensación, INSERT del log nuevo, notificación, RETURN,
-- REVOKE/GRANT. La firma NO cambia → CREATE OR REPLACE sin DROP.
--
-- NO se reescribe ningún otro RPC.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rpc_correct_log(
  p_log_id uuid,
  p_new_cantidad integer DEFAULT NULL::integer,
  p_new_channel_id text DEFAULT NULL::text,
  p_motivo text DEFAULT NULL::text,
  p_anular boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role                role_enum;
  v_active_user         boolean;
  v_log                 production_logs;
  v_is_owner            boolean;
  v_age_hours           numeric;
  v_log_jornada_status  jornada_status_enum;
  v_log_jornada_fecha   date;
  v_log_jornada_label   text;
  v_is_post_closure     boolean;
  v_already_compensated boolean;
  v_compensation_log    production_logs;
  v_new_log             production_logs;
  v_motivo_clean        text;
  v_target_jornada_id   uuid;
  v_new_target_jornada  uuid;
  v_tag_comp            text;
  v_tag_new             text;
  v_target_channel      text;
BEGIN
  SELECT role, active INTO v_role, v_active_user
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active_user = false THEN
    RAISE EXCEPTION 'Tu sesion expiro o tu cuenta esta desactivada.'
      USING ERRCODE='42501', HINT='auth';
  END IF;

  SELECT * INTO v_log FROM public.production_logs WHERE id = p_log_id;
  IF v_log.id IS NULL THEN
    RAISE EXCEPTION 'Esta carga ya no existe (puede haber sido eliminada).'
      USING ERRCODE='23503', HINT='not_found';
  END IF;

  v_is_owner := (v_log.operario_id = auth.uid());
  IF NOT v_is_owner AND v_role NOT IN ('owner','admin','encargado') THEN
    RAISE EXCEPTION 'No podes corregir cargas de otros operarios.'
      USING ERRCODE='42501', HINT='not_owner';
  END IF;

  IF v_log.jornada_id IS NOT NULL THEN
    SELECT status, fecha INTO v_log_jornada_status, v_log_jornada_fecha
      FROM public.jornadas WHERE id = v_log.jornada_id;
  END IF;
  v_is_post_closure := (v_log_jornada_status = 'cerrada');

  v_age_hours := EXTRACT(EPOCH FROM (now() - v_log.created_at)) / 3600.0;

  IF v_is_owner AND v_role NOT IN ('owner','admin','encargado') THEN
    IF v_is_post_closure THEN
      SELECT label INTO v_log_jornada_label FROM public.channels WHERE id = v_log.channel_id;
      RAISE EXCEPTION 'No podes corregir: el canal % ya tiene un cierre del %. Pediselo al encargado.',
        COALESCE(v_log_jornada_label, v_log.channel_id),
        to_char(v_log_jornada_fecha, 'DD/MM')
        USING ERRCODE='42501', HINT='jornada_cerrada';
    END IF;
    IF v_age_hours > 24 THEN
      RAISE EXCEPTION 'Pasaron mas de 24 horas desde que cargaste — pediselo al encargado.'
        USING ERRCODE='42501', HINT='window_24h';
    END IF;
  END IF;

  IF v_log.cantidad < 0 AND v_log.notas LIKE '[ANULADO]%' THEN
    RAISE EXCEPTION 'No se puede corregir una entrada de anulacion.'
      USING ERRCODE='22023', HINT='is_compensation';
  END IF;
  IF v_log.cantidad < 0 AND v_log.notas LIKE '[CORREGIDO POST-CIERRE]%' THEN
    RAISE EXCEPTION 'No se puede corregir un ajuste post-cierre.'
      USING ERRCODE='22023', HINT='is_post_closure_adjustment';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.production_logs
    WHERE notas LIKE '[ANULADO] log_id=' || v_log.id::text || '%'
       OR notas LIKE '[CORREGIDO POST-CIERRE] log_id=' || v_log.id::text || '%'
  ) INTO v_already_compensated;
  IF v_already_compensated THEN
    RAISE EXCEPTION 'Esta carga ya fue corregida o anulada anteriormente.'
      USING ERRCODE='22023', HINT='already_compensated';
  END IF;

  IF NOT p_anular AND p_new_cantidad IS NOT NULL AND p_new_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad nueva debe ser mayor a 0.'
      USING ERRCODE='22023', HINT='invalid_qty';
  END IF;

  v_motivo_clean := NULLIF(trim(coalesce(p_motivo, '')), '');

  -- ── Bloque A — resolución de jornada destino (post-cierre) ──
  -- Cambio 2A/2B: jornadas son GLOBALES. Único cambio respecto a 0014:
  -- el SELECT busca la activa global y el INSERT omite channel_id.
  IF v_is_post_closure THEN
    SELECT id INTO v_target_jornada_id
      FROM public.jornadas
      WHERE status = 'abierta' AND is_active = true
      LIMIT 1;
    IF v_target_jornada_id IS NULL THEN
      INSERT INTO public.jornadas
        (fecha, status, abierta_at, is_active, snapshot)
      VALUES
        (current_date, 'abierta', now(), true, '[]'::jsonb)
      ON CONFLICT (fecha) DO UPDATE
        SET is_active = true,
            abierta_at = COALESCE(public.jornadas.abierta_at, EXCLUDED.abierta_at)
      RETURNING id INTO v_target_jornada_id;
    END IF;
  ELSE
    v_target_jornada_id := v_log.jornada_id;
  END IF;

  IF v_is_post_closure THEN
    v_tag_comp := '[CORREGIDO POST-CIERRE]';
    v_tag_new  := '[POST-CIERRE]';
  ELSE
    v_tag_comp := '[ANULADO]';
    v_tag_new  := '[CORREGIDO]';
  END IF;

  INSERT INTO public.production_logs
    (sku, channel_id, cantidad, operario_id, sector, fecha, hora, notas, jornada_id)
  VALUES
    (v_log.sku, v_log.channel_id, -v_log.cantidad, auth.uid(),
     public.role_to_sector(v_role), current_date, current_time,
     v_tag_comp || ' log_id=' || v_log.id::text || COALESCE(' motivo=' || v_motivo_clean, ''),
     v_target_jornada_id)
  RETURNING * INTO v_compensation_log;

  IF NOT p_anular AND p_new_cantidad IS NOT NULL THEN
    v_target_channel := COALESCE(p_new_channel_id, v_log.channel_id);
    -- ── Bloque B — resolución de jornada destino (cambio de canal) ──
    -- Cambio 2A/2B: jornadas son GLOBALES. Mismo patrón que Bloque A.
    IF v_target_channel <> v_log.channel_id THEN
      SELECT id INTO v_new_target_jornada
        FROM public.jornadas
        WHERE status = 'abierta' AND is_active = true
        LIMIT 1;
      IF v_new_target_jornada IS NULL THEN
        INSERT INTO public.jornadas
          (fecha, status, abierta_at, is_active, snapshot)
        VALUES
          (current_date, 'abierta', now(), true, '[]'::jsonb)
        ON CONFLICT (fecha) DO UPDATE
          SET is_active = true,
              abierta_at = COALESCE(public.jornadas.abierta_at, EXCLUDED.abierta_at)
        RETURNING id INTO v_new_target_jornada;
      END IF;
    ELSE
      v_new_target_jornada := v_target_jornada_id;
    END IF;

    INSERT INTO public.production_logs
      (sku, channel_id, cantidad, operario_id, sector, fecha, hora, notas, jornada_id)
    VALUES
      (v_log.sku, v_target_channel, p_new_cantidad, auth.uid(),
       public.role_to_sector(v_role), current_date, current_time,
       v_tag_new || ' desde log_id=' || v_log.id::text || COALESCE(' motivo=' || v_motivo_clean, ''),
       v_new_target_jornada)
    RETURNING * INTO v_new_log;
  END IF;

  INSERT INTO public.notifications (user_id, tipo, titulo, mensaje, link)
  SELECT p.id, 'sistema',
    CASE
      WHEN v_is_post_closure AND p_anular THEN format('Anulacion post-cierre en %s', v_log.channel_id)
      WHEN v_is_post_closure              THEN format('Correccion post-cierre en %s', v_log.channel_id)
      WHEN p_anular                       THEN format('Anulacion en %s', v_log.channel_id)
      ELSE                                     format('Correccion en %s', v_log.channel_id)
    END,
    format('%s anulo %s uds de %s%s%s%s',
      (SELECT name FROM public.profiles WHERE id = auth.uid()),
      v_log.cantidad, v_log.sku,
      CASE WHEN p_anular THEN '' ELSE format(' y registro %s nuevas', p_new_cantidad) END,
      CASE WHEN v_is_post_closure THEN ' (post-cierre)' ELSE '' END,
      COALESCE(' · ' || v_motivo_clean, '')),
    format('/canal/%s', v_log.channel_id)
  FROM public.profiles p
  WHERE p.role IN ('owner','encargado') AND p.active = true AND p.id <> auth.uid();

  RETURN jsonb_build_object(
    'original_log_id', v_log.id,
    'compensation_log_id', v_compensation_log.id,
    'new_log_id', COALESCE(v_new_log.id, NULL),
    'anulado', p_anular,
    'is_post_closure', v_is_post_closure,
    'sku', v_log.sku,
    'channel_id', v_log.channel_id,
    'old_cantidad', v_log.cantidad,
    'new_cantidad', CASE WHEN p_anular THEN 0 ELSE COALESCE(p_new_cantidad, v_log.cantidad) END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_correct_log(uuid, integer, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_correct_log(uuid, integer, text, text, boolean) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual, si se necesita restaurar la versión rota):
-- Re-aplicar rpc_correct_log desde migration 0014 — pero esa versión
-- referencia jornadas.channel_id (columna inexistente post-0028) y
-- vuelve a fallar en los branches post-cierre y cambio de canal.
-- ════════════════════════════════════════════════════════════════════
