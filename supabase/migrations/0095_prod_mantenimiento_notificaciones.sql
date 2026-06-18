-- ════════════════════════════════════════════════════════════════════
-- PRODUCCIÓN — Notificaciones en la cadena de mantenimiento (Fase 8)
-- ════════════════════════════════════════════════════════════════════
-- Cierra el cabo "Director escucha prod_mantenimiento (recibido_director)":
-- hoy el panel del director (owner/admin caen en el Panel del Encargado)
-- ya escucha prod_mantenimiento en vivo, pero NO le llegaba una notificación
-- cuando algo se le escala. Se agrega la cadena completa (tabla notifications,
-- tipo 'produccion', enum ya existente):
--   · al REPORTAR (sector) → avisa a encargado + owner/admin (a aprobar)
--   · al APROBAR coord (encargado) → avisa a owner/admin (director: a recibir)
-- 100% aditivo sobre las RPCs existentes (preserva validaciones y gate).
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.prod_rpc_reportar_mantenimiento(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE v_role role_enum; v_active boolean; v_id uuid; v_urg text; v_sector text; v_tipo text; v_maq text;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('cnc','melamina','pino','embalaje','encargado','owner','admin') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;
  v_urg := NULLIF(p_payload->>'urgencia','');
  IF v_urg IS NOT NULL AND v_urg NOT IN ('alta','media','baja') THEN RAISE EXCEPTION 'urgencia invalida.' USING ERRCODE='22023'; END IF;
  v_sector := NULLIF(trim(p_payload->>'sector'),'');
  v_tipo   := NULLIF(trim(p_payload->>'tipo'),'');
  v_maq    := NULLIF(trim(p_payload->>'maquina'),'');
  INSERT INTO prod_mantenimiento (sector, tipo, urgencia, maquina, descripcion, reportado_por)
  VALUES (v_sector, v_tipo, v_urg, v_maq, NULLIF(trim(p_payload->>'descripcion'),''), auth.uid())
  RETURNING id INTO v_id;

  -- Notificar a quienes aprueban/reciben: encargado + dirección
  INSERT INTO notifications (user_id, tipo, titulo, mensaje, link)
  SELECT pr.id, 'produccion'::notif_type_enum,
         'Mantenimiento' || CASE WHEN v_urg = 'alta' THEN ' URGENTE' ELSE '' END || ' · ' || COALESCE(v_sector, 'sector'),
         COALESCE(v_tipo, 'reporte') || COALESCE(' · ' || v_maq, ''),
         'produccion-hub'
  FROM profiles pr
  WHERE pr.active = true AND pr.role IN ('owner','admin','encargado') AND pr.id <> auth.uid();

  RETURN jsonb_build_object('ok', true, 'mantenimiento_id', v_id);
END $function$;

CREATE OR REPLACE FUNCTION public.prod_rpc_gestionar_mantenimiento(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE v_role role_enum; v_active boolean; v_estado text; v_sector text; v_tipo text;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  v_estado := p_payload->>'estado';
  IF v_estado NOT IN ('pendiente','aprobado_coord','recibido_director') THEN
    RAISE EXCEPTION 'estado invalido.' USING ERRCODE='22023'; END IF;
  -- 'recibido_director' es del director (owner/admin). El resto lo puede hacer el encargado.
  IF v_estado = 'recibido_director' THEN
    IF v_role NOT IN ('owner','admin') THEN
      RAISE EXCEPTION 'Solo el director recibe el mantenimiento.' USING ERRCODE='42501'; END IF;
  ELSE
    IF v_role NOT IN ('owner','admin','encargado') THEN
      RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;
  END IF;
  UPDATE prod_mantenimiento SET estado = v_estado, aprobado_por = auth.uid()
  WHERE id = (p_payload->>'id')::uuid
  RETURNING sector, tipo INTO v_sector, v_tipo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reporte no encontrado.' USING ERRCODE='P0002'; END IF;

  -- Al aprobar el coordinador, escalar al director (owner/admin) con notificación.
  IF v_estado = 'aprobado_coord' THEN
    INSERT INTO notifications (user_id, tipo, titulo, mensaje, link)
    SELECT pr.id, 'produccion'::notif_type_enum,
           'Mantenimiento para recibir · ' || COALESCE(v_sector, 'sector'),
           'El encargado aprobó un reporte' || COALESCE(' de ' || v_tipo, '') || '. Espera al director.',
           'produccion-hub'
    FROM profiles pr
    WHERE pr.active = true AND pr.role IN ('owner','admin') AND pr.id <> auth.uid();
  END IF;

  RETURN jsonb_build_object('ok', true);
END $function$;

-- ROLLBACK: re-aplicar las versiones previas (sin los bloques INSERT INTO notifications).
