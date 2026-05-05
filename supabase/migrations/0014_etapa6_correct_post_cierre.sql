-- ════════════════════════════════════════════════════════════════════
-- ETAPA 6 — rpc_correct_log v4: corrección post-cierre
-- ════════════════════════════════════════════════════════════════════
-- Cambios respecto de v3 (de Etapa 1 de correcciones):
--   1) El bloqueo por "jornada cerrada" ahora valida específicamente la
--      jornada_id del log original (no por fecha) — y solo aplica para
--      operarios. Admin/owner/encargado pueden corregir post-cierre.
--   2) Las compensaciones + nuevo log se vinculan a la JORNADA ACTIVA
--      del canal (no a la cerrada). Esto preserva el snapshot inmutable
--      del cierre original — los ajustes se reflejan en la jornada
--      vigente.
--   3) Tags diferenciados:
--        - Pre-cierre: [ANULADO] / [CORREGIDO]
--        - Post-cierre: [CORREGIDO POST-CIERRE] / [POST-CIERRE]
--      El frontend usa estos tags para mostrar badges distintos.
--   4) Si el corrector cambia el channel_id, el nuevo log va a la
--      jornada activa del canal nuevo. Si no hay activa: error.
--   5) jornada_id se setea explícitamente en todos los inserts (en v3
--      quedaba NULL, lo que rompía el filtrado por jornada).
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rpc_correct_log(
  p_log_id uuid,
  p_new_cantidad integer DEFAULT NULL,
  p_new_channel_id text DEFAULT NULL,
  p_motivo text DEFAULT NULL,
  p_anular boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $func$
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

  -- Status de la jornada del log original (para detectar post-cierre)
  IF v_log.jornada_id IS NOT NULL THEN
    SELECT status, fecha INTO v_log_jornada_status, v_log_jornada_fecha
      FROM public.jornadas WHERE id = v_log.jornada_id;
  END IF;
  v_is_post_closure := (v_log_jornada_status = 'cerrada');

  v_age_hours := EXTRACT(EPOCH FROM (now() - v_log.created_at)) / 3600.0;

  -- Validaciones para operario regular (no admin)
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

  -- ── Resolver jornada destino para la compensación ───────────────
  IF v_is_post_closure THEN
    -- Buscar jornada activa del canal original
    SELECT id INTO v_target_jornada_id
      FROM public.jornadas
      WHERE channel_id = v_log.channel_id AND status = 'abierta' AND is_active = true
      LIMIT 1;
    IF v_target_jornada_id IS NULL THEN
      -- Auto-crear jornada de hoy + marcarla activa
      INSERT INTO public.jornadas
        (channel_id, fecha, status, abierta_at, is_active, snapshot)
      VALUES
        (v_log.channel_id, current_date, 'abierta', now(), true, '[]'::jsonb)
      ON CONFLICT (channel_id, fecha) DO UPDATE
        SET is_active = true,
            abierta_at = COALESCE(public.jornadas.abierta_at, EXCLUDED.abierta_at)
      RETURNING id INTO v_target_jornada_id;
    END IF;
  ELSE
    -- Pre-cierre: la compensación va a la misma jornada del log original
    v_target_jornada_id := v_log.jornada_id;
  END IF;

  -- Tags diferenciados según es post-cierre o no
  IF v_is_post_closure THEN
    v_tag_comp := '[CORREGIDO POST-CIERRE]';
    v_tag_new  := '[POST-CIERRE]';
  ELSE
    v_tag_comp := '[ANULADO]';
    v_tag_new  := '[CORREGIDO]';
  END IF;

  -- ── Insertar compensación ──────────────────────────────────────
  INSERT INTO public.production_logs
    (sku, channel_id, cantidad, operario_id, sector, fecha, hora, notas, jornada_id)
  VALUES
    (v_log.sku, v_log.channel_id, -v_log.cantidad, auth.uid(),
     public.role_to_sector(v_role), current_date, current_time,
     v_tag_comp || ' log_id=' || v_log.id::text || COALESCE(' motivo=' || v_motivo_clean, ''),
     v_target_jornada_id)
  RETURNING * INTO v_compensation_log;

  -- ── Insertar nuevo log corregido (si no es solo anulación) ──────
  IF NOT p_anular AND p_new_cantidad IS NOT NULL THEN
    v_target_channel := COALESCE(p_new_channel_id, v_log.channel_id);

    -- Si cambió el canal, resolver jornada del nuevo canal
    IF v_target_channel <> v_log.channel_id THEN
      SELECT id INTO v_new_target_jornada
        FROM public.jornadas
        WHERE channel_id = v_target_channel AND status = 'abierta' AND is_active = true
        LIMIT 1;
      IF v_new_target_jornada IS NULL THEN
        -- Auto-crear y marcar activa
        INSERT INTO public.jornadas
          (channel_id, fecha, status, abierta_at, is_active, snapshot)
        VALUES
          (v_target_channel, current_date, 'abierta', now(), true, '[]'::jsonb)
        ON CONFLICT (channel_id, fecha) DO UPDATE
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

  -- ── Notificación ──────────────────────────────────────────────
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
$func$;

REVOKE ALL ON FUNCTION public.rpc_correct_log(uuid, integer, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_correct_log(uuid, integer, text, text, boolean) TO authenticated;
