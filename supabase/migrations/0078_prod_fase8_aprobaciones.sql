-- ════════════════════════════════════════════════════════════════════
-- PRODUCCIÓN — Fase 8: Flujos de aprobación
-- ════════════════════════════════════════════════════════════════════
-- Decisión del Jefe (2026-06-13): el ENCARGADO de producción es quien
-- aprueba (coordina). Para solicitudes de insumos ya alcanzaba
-- (prod_rpc_gestionar_solicitud admite owner/admin/encargado). Para
-- mantenimiento NO: la RPC solo admitía owner/admin, así que el encargado
-- no podía aprobar. Se amplía:
--   • encargado/owner/admin → puede marcar 'aprobado_coord' (y 'pendiente')
--   • SOLO owner/admin (= director, no hay rol 'director') → 'recibido_director'
-- Además se publica prod_solicitud en realtime para que el panel del
-- encargado vea las solicitudes nuevas en vivo (Fase 4.2). 100% aditivo.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.prod_rpc_gestionar_mantenimiento(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE v_role role_enum; v_active boolean; v_estado text;
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
  UPDATE prod_mantenimiento SET estado = v_estado, aprobado_por = auth.uid() WHERE id = (p_payload->>'id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reporte no encontrado.' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('ok', true);
END $function$;

-- prod_solicitud → realtime (idempotente; misma publicación que la Fase 4.2)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'prod_solicitud'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.prod_solicitud;
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual): restaurar la RPC a owner/admin (def previa) y
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.prod_solicitud;
-- ════════════════════════════════════════════════════════════════════
