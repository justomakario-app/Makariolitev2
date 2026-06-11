-- ════════════════════════════════════════════════════════════════════
-- PRODUCCIÓN EN LÍNEA — Fase 2: RPCs de carga por sector
-- ════════════════════════════════════════════════════════════════════
-- 16 RPCs SECURITY DEFINER (auth gate vía profiles.role, search_path
-- public/pg_temp) sobre las tablas prod_* (0071/0072). Mueven el stock
-- entre eslabones según la cadena confirmada.
--
-- ── Decisiones (flag) ────────────────────────────────────────────────
--  1. jornada_id: se toma de p_payload->>'jornada_id'; si no viene, se
--     resuelve la jornada ABIERTA de hoy. Error si no hay ninguna abierta.
--  2. Auditoría de los editar_*: la genera el trigger existente
--     prod_fn_auditoria (1 fila por campo); el RPC solo setea el motivo
--     vía set_config('prod.audit_motivo',…,true). No hay INSERT manual.
--  3. Corte de placa COMBINADA: acredita stock solo a la pieza primaria
--     (prod_placa.pieza_sku). Las piezas de prod_placa_pieza_extra NO se
--     acreditan (el brief especifica una sola).
--  4. piezas generadas = GREATEST(hojas*rendimiento - desperdicio, 0).
--     Los deltas de los editar_* se aplican crudos (pueden dejar stock
--     en negativo si ya se consumió).
-- ════════════════════════════════════════════════════════════════════

-- ════════════════ JORNADA ════════════════

CREATE OR REPLACE FUNCTION public.prod_rpc_abrir_jornada(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role role_enum; v_active boolean; v_id uuid; v_estado text;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('owner','admin','encargado') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;
  SELECT estado INTO v_estado FROM prod_jornada WHERE fecha = CURRENT_DATE;
  IF FOUND THEN
    IF v_estado = 'abierta' THEN RAISE EXCEPTION 'Ya hay una jornada abierta para hoy.' USING ERRCODE='42501';
    ELSE RAISE EXCEPTION 'La jornada de hoy ya fue cerrada.' USING ERRCODE='42501'; END IF;
  END IF;
  INSERT INTO prod_jornada (fecha, estado, abierta_por, abierta_at)
  VALUES (CURRENT_DATE, 'abierta', auth.uid(), now()) RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'jornada_id', v_id, 'fecha', CURRENT_DATE);
END $$;
REVOKE EXECUTE ON FUNCTION public.prod_rpc_abrir_jornada(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.prod_rpc_abrir_jornada(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.prod_rpc_cerrar_jornada(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role role_enum; v_active boolean; v_id uuid; v_estado text;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('owner','admin','encargado') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;
  v_id := NULLIF(p_payload->>'jornada_id','')::uuid;
  IF v_id IS NULL THEN SELECT id INTO v_id FROM prod_jornada WHERE fecha = CURRENT_DATE AND estado = 'abierta'; END IF;
  SELECT estado INTO v_estado FROM prod_jornada WHERE id = v_id;
  IF v_id IS NULL OR NOT FOUND THEN RAISE EXCEPTION 'Jornada no encontrada.' USING ERRCODE='P0002'; END IF;
  IF v_estado <> 'abierta' THEN RAISE EXCEPTION 'La jornada ya está cerrada.' USING ERRCODE='42501'; END IF;
  UPDATE prod_jornada SET estado = 'cerrada', cerrada_at = now() WHERE id = v_id;
  RETURN jsonb_build_object('ok', true, 'jornada_id', v_id, 'resumen', jsonb_build_object(
    'cortes',   (SELECT count(*) FROM prod_corte    WHERE jornada_id = v_id),
    'melamina', (SELECT count(*) FROM prod_melamina WHERE jornada_id = v_id),
    'pino',     (SELECT count(*) FROM prod_pino     WHERE jornada_id = v_id),
    'embalaje', (SELECT count(*) FROM prod_embalaje WHERE jornada_id = v_id)
  ));
END $$;
REVOKE EXECUTE ON FUNCTION public.prod_rpc_cerrar_jornada(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.prod_rpc_cerrar_jornada(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.prod_rpc_get_jornada_hoy(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role role_enum; v_active boolean; v_j record;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('cnc','melamina','pino','embalaje','encargado','owner','admin') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;
  SELECT id, fecha, estado INTO v_j FROM prod_jornada WHERE fecha = CURRENT_DATE;
  IF NOT FOUND THEN RETURN 'null'::jsonb; END IF;
  RETURN jsonb_build_object('jornada_id', v_j.id, 'fecha', v_j.fecha, 'estado', v_j.estado);
END $$;
REVOKE EXECUTE ON FUNCTION public.prod_rpc_get_jornada_hoy(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.prod_rpc_get_jornada_hoy(jsonb) TO authenticated;

-- ════════════════ helper interno: resolver jornada abierta ════════════
-- (inline en cada registrar_* para mantener el patrón SECURITY DEFINER)

-- ════════════════ CNC ════════════════

CREATE OR REPLACE FUNCTION public.prod_rpc_registrar_corte(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_role role_enum; v_active boolean; v_jornada uuid;
  v_placa text; v_hojas int; v_desp int; v_rend int; v_pieza text; v_gen int; v_id uuid;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('cnc','encargado','owner','admin') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;
  v_jornada := NULLIF(p_payload->>'jornada_id','')::uuid;
  IF v_jornada IS NULL THEN SELECT id INTO v_jornada FROM prod_jornada WHERE fecha = CURRENT_DATE AND estado = 'abierta'; END IF;
  IF v_jornada IS NULL THEN RAISE EXCEPTION 'No hay jornada abierta.' USING ERRCODE='P0002'; END IF;

  v_placa := p_payload->>'placa_sku';
  v_hojas := COALESCE((p_payload->>'hojas')::int, 0);
  v_desp  := COALESCE((p_payload->>'desperdicio')::int, 0);
  SELECT rendimiento, pieza_sku INTO v_rend, v_pieza FROM prod_placa WHERE sku = v_placa;
  IF NOT FOUND THEN RAISE EXCEPTION 'Placa % no existe.', v_placa USING ERRCODE='22023'; END IF;
  IF v_pieza IS NULL THEN RAISE EXCEPTION 'La placa % no tiene pieza asociada.', v_placa USING ERRCODE='22023'; END IF;
  v_gen := GREATEST(v_hojas * COALESCE(v_rend,0) - v_desp, 0);

  INSERT INTO prod_corte (jornada_id, placa_sku, hojas, desperdicio, cargado_por, editable_hasta)
  VALUES (v_jornada, v_placa, v_hojas, v_desp, auth.uid(), now() + interval '24 hours') RETURNING id INTO v_id;

  INSERT INTO prod_stock_pieza (pieza_sku, disponible) VALUES (v_pieza, v_gen)
  ON CONFLICT (pieza_sku) DO UPDATE SET disponible = prod_stock_pieza.disponible + v_gen, updated_at = now();

  RETURN jsonb_build_object('ok', true, 'corte_id', v_id, 'piezas_generadas', v_gen);
END $$;
REVOKE EXECUTE ON FUNCTION public.prod_rpc_registrar_corte(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.prod_rpc_registrar_corte(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.prod_rpc_editar_corte(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_role role_enum; v_active boolean; v_c prod_corte%ROWTYPE;
  v_new_placa text; v_hojas int; v_desp int;
  v_old_rend int; v_old_pieza text; v_new_rend int; v_new_pieza text; v_old_gen int; v_new_gen int;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_c FROM prod_corte WHERE id = (p_payload->>'id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Corte no encontrado.' USING ERRCODE='P0002'; END IF;
  IF v_role = 'cnc' THEN
    IF v_c.editable_hasta <= now() THEN RAISE EXCEPTION 'Fuera de la ventana de 24h.' USING ERRCODE='42501'; END IF;
  ELSIF v_role NOT IN ('encargado','owner','admin') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;

  v_new_placa := COALESCE(NULLIF(p_payload->>'placa_sku',''), v_c.placa_sku);
  v_hojas := COALESCE((p_payload->>'hojas')::int, v_c.hojas);
  v_desp  := COALESCE((p_payload->>'desperdicio')::int, v_c.desperdicio);
  SELECT rendimiento, pieza_sku INTO v_old_rend, v_old_pieza FROM prod_placa WHERE sku = v_c.placa_sku;
  SELECT rendimiento, pieza_sku INTO v_new_rend, v_new_pieza FROM prod_placa WHERE sku = v_new_placa;
  v_old_gen := GREATEST(v_c.hojas * COALESCE(v_old_rend,0) - v_c.desperdicio, 0);
  v_new_gen := GREATEST(v_hojas * COALESCE(v_new_rend,0) - v_desp, 0);

  PERFORM set_config('prod.audit_motivo', NULLIF(p_payload->>'motivo',''), true);
  PERFORM set_config('prod.audit_sector', 'cnc', true);
  UPDATE prod_corte SET placa_sku = v_new_placa, hojas = v_hojas, desperdicio = v_desp WHERE id = v_c.id;

  IF v_old_pieza IS NOT NULL THEN
    UPDATE prod_stock_pieza SET disponible = disponible - v_old_gen, updated_at = now() WHERE pieza_sku = v_old_pieza;
  END IF;
  IF v_new_pieza IS NOT NULL THEN
    INSERT INTO prod_stock_pieza (pieza_sku, disponible) VALUES (v_new_pieza, v_new_gen)
    ON CONFLICT (pieza_sku) DO UPDATE SET disponible = prod_stock_pieza.disponible + v_new_gen, updated_at = now();
  END IF;

  RETURN jsonb_build_object('ok', true, 'delta_stock', v_new_gen - v_old_gen, 'old_generadas', v_old_gen, 'new_generadas', v_new_gen);
END $$;
REVOKE EXECUTE ON FUNCTION public.prod_rpc_editar_corte(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.prod_rpc_editar_corte(jsonb) TO authenticated;

-- ════════════════ MELAMINA ════════════════

CREATE OR REPLACE FUNCTION public.prod_rpc_registrar_melamina(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_role role_enum; v_active boolean; v_jornada uuid;
  v_pieza text; v_term int; v_fallas int; v_consumo int; v_disp int; v_id uuid; v_rest int;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('melamina','encargado','owner','admin') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;
  v_jornada := NULLIF(p_payload->>'jornada_id','')::uuid;
  IF v_jornada IS NULL THEN SELECT id INTO v_jornada FROM prod_jornada WHERE fecha = CURRENT_DATE AND estado = 'abierta'; END IF;
  IF v_jornada IS NULL THEN RAISE EXCEPTION 'No hay jornada abierta.' USING ERRCODE='P0002'; END IF;

  v_pieza := p_payload->>'pieza_sku';
  v_term  := COALESCE((p_payload->>'terminadas')::int, 0);
  v_fallas:= COALESCE((p_payload->>'fallas')::int, 0);
  v_consumo := v_term + v_fallas;
  SELECT COALESCE(disponible,0) INTO v_disp FROM prod_stock_pieza WHERE pieza_sku = v_pieza;
  v_disp := COALESCE(v_disp, 0);
  IF v_disp < v_consumo THEN
    RAISE EXCEPTION 'Stock de piezas crudas insuficiente (disp %, requiere %).', v_disp, v_consumo USING ERRCODE='42501'; END IF;

  INSERT INTO prod_melamina (jornada_id, pieza_sku, terminadas, fallas, cargado_por, editable_hasta)
  VALUES (v_jornada, v_pieza, v_term, v_fallas, auth.uid(), now() + interval '24 hours') RETURNING id INTO v_id;

  UPDATE prod_stock_pieza SET disponible = disponible - v_consumo, updated_at = now() WHERE pieza_sku = v_pieza
  RETURNING disponible INTO v_rest;
  INSERT INTO prod_stock_melamina (pieza_sku, disponible) VALUES (v_pieza, v_term)
  ON CONFLICT (pieza_sku) DO UPDATE SET disponible = prod_stock_melamina.disponible + v_term, updated_at = now();

  RETURN jsonb_build_object('ok', true, 'melamina_id', v_id, 'stock_pieza_restante', v_rest);
END $$;
REVOKE EXECUTE ON FUNCTION public.prod_rpc_registrar_melamina(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.prod_rpc_registrar_melamina(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.prod_rpc_editar_melamina(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_role role_enum; v_active boolean; v_m prod_melamina%ROWTYPE;
  v_term int; v_fallas int; v_old_consumo int; v_new_consumo int;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_m FROM prod_melamina WHERE id = (p_payload->>'id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro no encontrado.' USING ERRCODE='P0002'; END IF;
  IF v_role = 'melamina' THEN
    IF v_m.editable_hasta <= now() THEN RAISE EXCEPTION 'Fuera de la ventana de 24h.' USING ERRCODE='42501'; END IF;
  ELSIF v_role NOT IN ('encargado','owner','admin') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;

  v_term   := COALESCE((p_payload->>'terminadas')::int, v_m.terminadas);
  v_fallas := COALESCE((p_payload->>'fallas')::int, v_m.fallas);
  v_old_consumo := v_m.terminadas + v_m.fallas;
  v_new_consumo := v_term + v_fallas;

  PERFORM set_config('prod.audit_motivo', NULLIF(p_payload->>'motivo',''), true);
  PERFORM set_config('prod.audit_sector', 'melamina', true);
  UPDATE prod_melamina SET terminadas = v_term, fallas = v_fallas WHERE id = v_m.id;

  -- stock_pieza: devolver el consumo viejo, descontar el nuevo (delta = -(new-old))
  UPDATE prod_stock_pieza SET disponible = disponible + v_old_consumo - v_new_consumo, updated_at = now() WHERE pieza_sku = v_m.pieza_sku;
  -- stock_melamina: delta = new_term - old_term
  INSERT INTO prod_stock_melamina (pieza_sku, disponible) VALUES (v_m.pieza_sku, v_term - v_m.terminadas)
  ON CONFLICT (pieza_sku) DO UPDATE SET disponible = prod_stock_melamina.disponible + (v_term - v_m.terminadas), updated_at = now();

  RETURN jsonb_build_object('ok', true, 'delta_pieza', v_old_consumo - v_new_consumo, 'delta_melamina', v_term - v_m.terminadas);
END $$;
REVOKE EXECUTE ON FUNCTION public.prod_rpc_editar_melamina(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.prod_rpc_editar_melamina(jsonb) TO authenticated;

-- ════════════════ PINO ════════════════

CREATE OR REPLACE FUNCTION public.prod_rpc_registrar_pino(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_role role_enum; v_active boolean; v_jornada uuid;
  v_tamano text; v_term int; v_mas int; v_id uuid; v_disp int; v_masT int;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('pino','encargado','owner','admin') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;
  v_jornada := NULLIF(p_payload->>'jornada_id','')::uuid;
  IF v_jornada IS NULL THEN SELECT id INTO v_jornada FROM prod_jornada WHERE fecha = CURRENT_DATE AND estado = 'abierta'; END IF;
  IF v_jornada IS NULL THEN RAISE EXCEPTION 'No hay jornada abierta.' USING ERRCODE='P0002'; END IF;

  v_tamano := p_payload->>'tamano';
  IF v_tamano NOT IN ('chica','grande') THEN RAISE EXCEPTION 'tamano inválido (chica|grande).' USING ERRCODE='22023'; END IF;
  v_term := COALESCE((p_payload->>'terminadas')::int, 0);
  v_mas  := COALESCE((p_payload->>'masilladas')::int, 0);

  INSERT INTO prod_pino (jornada_id, tamano, terminadas, masilladas, cargado_por, editable_hasta)
  VALUES (v_jornada, v_tamano, v_term, v_mas, auth.uid(), now() + interval '24 hours') RETURNING id INTO v_id;

  INSERT INTO prod_stock_patas (tamano, disponible, masilladas) VALUES (v_tamano, v_term, v_mas)
  ON CONFLICT (tamano) DO UPDATE SET disponible = prod_stock_patas.disponible + v_term,
    masilladas = prod_stock_patas.masilladas + v_mas, updated_at = now()
  RETURNING disponible, masilladas INTO v_disp, v_masT;

  RETURN jsonb_build_object('ok', true, 'pino_id', v_id, 'stock_patas', jsonb_build_object('tamano', v_tamano, 'disponible', v_disp, 'masilladas', v_masT));
END $$;
REVOKE EXECUTE ON FUNCTION public.prod_rpc_registrar_pino(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.prod_rpc_registrar_pino(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.prod_rpc_editar_pino(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_role role_enum; v_active boolean; v_p prod_pino%ROWTYPE; v_term int; v_mas int;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_p FROM prod_pino WHERE id = (p_payload->>'id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro no encontrado.' USING ERRCODE='P0002'; END IF;
  IF v_role = 'pino' THEN
    IF v_p.editable_hasta <= now() THEN RAISE EXCEPTION 'Fuera de la ventana de 24h.' USING ERRCODE='42501'; END IF;
  ELSIF v_role NOT IN ('encargado','owner','admin') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;

  v_term := COALESCE((p_payload->>'terminadas')::int, v_p.terminadas);
  v_mas  := COALESCE((p_payload->>'masilladas')::int, v_p.masilladas);

  PERFORM set_config('prod.audit_motivo', NULLIF(p_payload->>'motivo',''), true);
  PERFORM set_config('prod.audit_sector', 'pino', true);
  UPDATE prod_pino SET terminadas = v_term, masilladas = v_mas WHERE id = v_p.id;

  UPDATE prod_stock_patas SET disponible = disponible + (v_term - v_p.terminadas),
    masilladas = masilladas + (v_mas - v_p.masilladas), updated_at = now() WHERE tamano = v_p.tamano;

  RETURN jsonb_build_object('ok', true, 'delta_disponible', v_term - v_p.terminadas, 'delta_masilladas', v_mas - v_p.masilladas);
END $$;
REVOKE EXECUTE ON FUNCTION public.prod_rpc_editar_pino(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.prod_rpc_editar_pino(jsonb) TO authenticated;

-- ════════════════ EMBALAJE ════════════════

CREATE OR REPLACE FUNCTION public.prod_rpc_registrar_embalaje(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_role role_enum; v_active boolean; v_jornada uuid;
  v_prod text; v_unid int; v_canal text; v_order uuid;
  v_patas_tipo text; v_patas_cant int; v_patas_need int; v_disp_patas int; v_id uuid; v_terminado int;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('embalaje','encargado','owner','admin') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;
  v_jornada := NULLIF(p_payload->>'jornada_id','')::uuid;
  IF v_jornada IS NULL THEN SELECT id INTO v_jornada FROM prod_jornada WHERE fecha = CURRENT_DATE AND estado = 'abierta'; END IF;
  IF v_jornada IS NULL THEN RAISE EXCEPTION 'No hay jornada abierta.' USING ERRCODE='P0002'; END IF;

  v_prod  := p_payload->>'producto_sku';
  v_unid  := COALESCE((p_payload->>'unidades')::int, 0);
  v_canal := NULLIF(trim(p_payload->>'canal'),'');
  v_order := NULLIF(p_payload->>'order_id','')::uuid;
  IF v_unid <= 0 THEN RAISE EXCEPTION 'unidades debe ser > 0.' USING ERRCODE='22023'; END IF;
  SELECT patas_tipo, COALESCE(patas_cant,0) INTO v_patas_tipo, v_patas_cant FROM prod_producto WHERE sku = v_prod;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto % no existe.', v_prod USING ERRCODE='22023'; END IF;

  -- Validar stock melamina por cada pieza de la receta
  IF EXISTS (
    SELECT 1 FROM prod_receta r
    LEFT JOIN prod_stock_melamina sm ON sm.pieza_sku = r.pieza_sku
    WHERE r.producto_sku = v_prod AND COALESCE(sm.disponible,0) < v_unid * r.cantidad
  ) THEN RAISE EXCEPTION 'Stock de melamina insuficiente para la receta.' USING ERRCODE='42501'; END IF;

  -- Validar stock patas
  IF v_patas_tipo IS NOT NULL AND v_patas_cant > 0 THEN
    v_patas_need := v_unid * v_patas_cant;
    SELECT COALESCE(disponible,0) INTO v_disp_patas FROM prod_stock_patas WHERE tamano = v_patas_tipo;
    IF COALESCE(v_disp_patas,0) < v_patas_need THEN RAISE EXCEPTION 'Stock de patas insuficiente (disp %, requiere %).', COALESCE(v_disp_patas,0), v_patas_need USING ERRCODE='42501'; END IF;
  END IF;

  INSERT INTO prod_embalaje (jornada_id, producto_sku, unidades, canal, cargado_por)
  VALUES (v_jornada, v_prod, v_unid, v_canal, auth.uid()) RETURNING id INTO v_id;

  -- Consumir melamina (por receta)
  UPDATE prod_stock_melamina sm SET disponible = sm.disponible - (v_unid * r.cantidad), updated_at = now()
  FROM prod_receta r WHERE r.producto_sku = v_prod AND sm.pieza_sku = r.pieza_sku;
  -- Consumir patas
  IF v_patas_tipo IS NOT NULL AND v_patas_cant > 0 THEN
    UPDATE prod_stock_patas SET disponible = disponible - (v_unid * v_patas_cant), updated_at = now() WHERE tamano = v_patas_tipo;
  END IF;
  -- Producir terminado
  INSERT INTO prod_stock_terminado (producto_sku, disponible) VALUES (v_prod, v_unid)
  ON CONFLICT (producto_sku) DO UPDATE SET disponible = prod_stock_terminado.disponible + v_unid, updated_at = now()
  RETURNING disponible INTO v_terminado;

  IF v_order IS NOT NULL THEN
    INSERT INTO prod_pedido_estado (order_id, estado, producto_sku, cantidad, registrado_por)
    VALUES (v_order, 'listo_despacho', v_prod, v_unid, auth.uid());
  END IF;

  RETURN jsonb_build_object('ok', true, 'embalaje_id', v_id, 'stock_terminado', v_terminado);
END $$;
REVOKE EXECUTE ON FUNCTION public.prod_rpc_registrar_embalaje(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.prod_rpc_registrar_embalaje(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.prod_rpc_editar_embalaje(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_role role_enum; v_active boolean; v_e prod_embalaje%ROWTYPE;
  v_prod text; v_unid int; v_patas_tipo text; v_patas_cant int;
  v_old_pt text; v_old_pc int;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('encargado','owner','admin') THEN RAISE EXCEPTION 'Solo encargado/owner/admin editan embalaje.' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_e FROM prod_embalaje WHERE id = (p_payload->>'id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro no encontrado.' USING ERRCODE='P0002'; END IF;

  -- DESHACER el embalaje viejo (devolver consumos, quitar producido)
  SELECT patas_tipo, COALESCE(patas_cant,0) INTO v_old_pt, v_old_pc FROM prod_producto WHERE sku = v_e.producto_sku;
  UPDATE prod_stock_melamina sm SET disponible = sm.disponible + (v_e.unidades * r.cantidad), updated_at = now()
  FROM prod_receta r WHERE r.producto_sku = v_e.producto_sku AND sm.pieza_sku = r.pieza_sku;
  IF v_old_pt IS NOT NULL AND v_old_pc > 0 THEN
    UPDATE prod_stock_patas SET disponible = disponible + (v_e.unidades * v_old_pc), updated_at = now() WHERE tamano = v_old_pt;
  END IF;
  UPDATE prod_stock_terminado SET disponible = disponible - v_e.unidades, updated_at = now() WHERE producto_sku = v_e.producto_sku;

  -- APLICAR el nuevo (puede cambiar producto/unidades)
  v_prod := COALESCE(NULLIF(p_payload->>'producto_sku',''), v_e.producto_sku);
  v_unid := COALESCE((p_payload->>'unidades')::int, v_e.unidades);
  IF v_unid <= 0 THEN RAISE EXCEPTION 'unidades debe ser > 0.' USING ERRCODE='22023'; END IF;
  SELECT patas_tipo, COALESCE(patas_cant,0) INTO v_patas_tipo, v_patas_cant FROM prod_producto WHERE sku = v_prod;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto % no existe.', v_prod USING ERRCODE='22023'; END IF;

  IF EXISTS (SELECT 1 FROM prod_receta r LEFT JOIN prod_stock_melamina sm ON sm.pieza_sku = r.pieza_sku
             WHERE r.producto_sku = v_prod AND COALESCE(sm.disponible,0) < v_unid * r.cantidad)
  THEN RAISE EXCEPTION 'Stock de melamina insuficiente para la receta.' USING ERRCODE='42501'; END IF;
  IF v_patas_tipo IS NOT NULL AND v_patas_cant > 0
     AND COALESCE((SELECT disponible FROM prod_stock_patas WHERE tamano = v_patas_tipo),0) < v_unid * v_patas_cant
  THEN RAISE EXCEPTION 'Stock de patas insuficiente.' USING ERRCODE='42501'; END IF;

  PERFORM set_config('prod.audit_motivo', NULLIF(p_payload->>'motivo',''), true);
  PERFORM set_config('prod.audit_sector', 'embalaje', true);
  UPDATE prod_embalaje SET producto_sku = v_prod, unidades = v_unid,
    canal = CASE WHEN p_payload ? 'canal' THEN NULLIF(trim(p_payload->>'canal'),'') ELSE canal END
  WHERE id = v_e.id;

  UPDATE prod_stock_melamina sm SET disponible = sm.disponible - (v_unid * r.cantidad), updated_at = now()
  FROM prod_receta r WHERE r.producto_sku = v_prod AND sm.pieza_sku = r.pieza_sku;
  IF v_patas_tipo IS NOT NULL AND v_patas_cant > 0 THEN
    UPDATE prod_stock_patas SET disponible = disponible - (v_unid * v_patas_cant), updated_at = now() WHERE tamano = v_patas_tipo;
  END IF;
  INSERT INTO prod_stock_terminado (producto_sku, disponible) VALUES (v_prod, v_unid)
  ON CONFLICT (producto_sku) DO UPDATE SET disponible = prod_stock_terminado.disponible + v_unid, updated_at = now();

  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.prod_rpc_editar_embalaje(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.prod_rpc_editar_embalaje(jsonb) TO authenticated;

-- ════════════════ SOLICITUDES ════════════════

CREATE OR REPLACE FUNCTION public.prod_rpc_crear_solicitud(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role role_enum; v_active boolean; v_jornada uuid; v_id uuid;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('cnc','melamina','pino','embalaje','encargado') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;
  v_jornada := NULLIF(p_payload->>'jornada_id','')::uuid;
  IF v_jornada IS NULL THEN SELECT id INTO v_jornada FROM prod_jornada WHERE fecha = CURRENT_DATE AND estado = 'abierta'; END IF;
  INSERT INTO prod_solicitud (jornada_id, sector, items, estado, solicitado_por)
  VALUES (v_jornada, NULLIF(trim(p_payload->>'sector'),''), COALESCE(p_payload->'items','[]'::jsonb), 'pendiente', auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'solicitud_id', v_id);
END $$;
REVOKE EXECUTE ON FUNCTION public.prod_rpc_crear_solicitud(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.prod_rpc_crear_solicitud(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.prod_rpc_gestionar_solicitud(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role role_enum; v_active boolean; v_estado text;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('owner','admin','encargado') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;
  v_estado := p_payload->>'estado';
  IF v_estado NOT IN ('aprobada_coord','recepcionada_admin') THEN RAISE EXCEPTION 'estado inválido.' USING ERRCODE='22023'; END IF;
  UPDATE prod_solicitud SET estado = v_estado, aprobado_por = auth.uid() WHERE id = (p_payload->>'id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud no encontrada.' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.prod_rpc_gestionar_solicitud(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.prod_rpc_gestionar_solicitud(jsonb) TO authenticated;

-- ════════════════ MANTENIMIENTO ════════════════

CREATE OR REPLACE FUNCTION public.prod_rpc_reportar_mantenimiento(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role role_enum; v_active boolean; v_id uuid; v_urg text;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('cnc','melamina','pino','embalaje','encargado','owner','admin') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;
  v_urg := NULLIF(p_payload->>'urgencia','');
  IF v_urg IS NOT NULL AND v_urg NOT IN ('alta','media','baja') THEN RAISE EXCEPTION 'urgencia inválida.' USING ERRCODE='22023'; END IF;
  INSERT INTO prod_mantenimiento (sector, tipo, urgencia, maquina, descripcion, reportado_por)
  VALUES (NULLIF(trim(p_payload->>'sector'),''), NULLIF(trim(p_payload->>'tipo'),''), v_urg,
          NULLIF(trim(p_payload->>'maquina'),''), NULLIF(trim(p_payload->>'descripcion'),''), auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'mantenimiento_id', v_id);
END $$;
REVOKE EXECUTE ON FUNCTION public.prod_rpc_reportar_mantenimiento(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.prod_rpc_reportar_mantenimiento(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.prod_rpc_gestionar_mantenimiento(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role role_enum; v_active boolean; v_estado text;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;
  v_estado := p_payload->>'estado';
  IF v_estado NOT IN ('pendiente','aprobado_coord','recibido_director') THEN RAISE EXCEPTION 'estado inválido.' USING ERRCODE='22023'; END IF;
  UPDATE prod_mantenimiento SET estado = v_estado, aprobado_por = auth.uid() WHERE id = (p_payload->>'id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reporte no encontrado.' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.prod_rpc_gestionar_mantenimiento(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.prod_rpc_gestionar_mantenimiento(jsonb) TO authenticated;

-- ════════════════ STOCK (lectura) ════════════════

CREATE OR REPLACE FUNCTION public.prod_rpc_get_stock(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role role_enum; v_active boolean;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('cnc','melamina','pino','embalaje','encargado','owner','admin') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object(
    'stock_pieza',     COALESCE((SELECT jsonb_agg(row_to_json(t)) FROM (SELECT pieza_sku, disponible, updated_at FROM prod_stock_pieza ORDER BY pieza_sku) t), '[]'::jsonb),
    'stock_melamina',  COALESCE((SELECT jsonb_agg(row_to_json(t)) FROM (SELECT pieza_sku, disponible, updated_at FROM prod_stock_melamina ORDER BY pieza_sku) t), '[]'::jsonb),
    'stock_patas',     COALESCE((SELECT jsonb_agg(row_to_json(t)) FROM (SELECT tamano, disponible, masilladas, updated_at FROM prod_stock_patas ORDER BY tamano) t), '[]'::jsonb),
    'stock_terminado', COALESCE((SELECT jsonb_agg(row_to_json(t)) FROM (SELECT producto_sku, disponible, updated_at FROM prod_stock_terminado ORDER BY producto_sku) t), '[]'::jsonb)
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.prod_rpc_get_stock(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.prod_rpc_get_stock(jsonb) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual): DROP FUNCTION IF EXISTS de los 16 prod_rpc_*(jsonb).
-- ════════════════════════════════════════════════════════════════════
