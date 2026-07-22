-- 0136 · F2 KILL-SWITCH real de Línea Productiva en base de datos (fail-closed).
-- Guard centralizado: si el flag 'linea_productiva' no existe, es NULL o está OFF → se deniega.
-- Se inyecta 'perform public.prod_fn_guard_lp()' como PRIMERA sentencia de las 18 RPC de LP que
-- mutan estado (inventario abajo). Las RPC de solo-lectura NO se guardan (no mutan). Aditiva; no
-- reescribe 0119–0135. Cada función se redefine con su cuerpo EXACTO vigente + el guard.
-- LOCAL: NO aplicada en remoto. Validada en entorno aislado.
--
-- RPC mutantes protegidas (18): abrir_jornada, cerrar_jornada, crear_solicitud, editar_corte, editar_melamina, editar_pino, editar_embalaje, gestionar_mantenimiento, gestionar_solicitud, ingresar_remito, jornada_sync, registrar_corte, registrar_melamina, registrar_pino, reportar_mantenimiento, set_minimo, stock_confirmar, vincular_confirmar.
-- + registrar_embalaje se protege en 0137 (junto con el guard de BOM).
-- RPC de solo-lectura NO guardadas (9): arrastre_preview, dashboard, director_historico,
--   embalaje_precheck, get_jornada_hoy, get_stock, plan_corte, stock_preview, vincular_preview.

create or replace function public.prod_fn_lp_habilitada()
returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $function$
  select coalesce((select enabled from public.app_flags where name = 'linea_productiva'), false);
$function$;
revoke execute on function public.prod_fn_lp_habilitada() from public, anon, authenticated;

create or replace function public.prod_fn_guard_lp()
returns void language plpgsql stable security definer set search_path to 'public','pg_temp' as $function$
begin
  if not public.prod_fn_lp_habilitada() then
    raise exception 'Linea Productiva no esta habilitada.' using errcode='42501';
  end if;
end $function$;
revoke execute on function public.prod_fn_guard_lp() from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prod_rpc_abrir_jornada(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_role role_enum; v_active boolean; v_id uuid; v_fecha date; v_n_abiertas int;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;

  -- Serializa aperturas concurrentes: la 2ª espera y verá la jornada de la 1ª.
  perform pg_advisory_xact_lock(hashtext('prod_abrir_jornada'));

  -- Bloqueo de datos: si (por corrupción previa) hubiera >1 abierta, no corregir en silencio.
  select count(*) into v_n_abiertas from prod_jornada where estado='abierta';
  if v_n_abiertas > 1 then
    raise exception 'Inconsistencia: hay % jornadas abiertas. Requiere reconciliacion manual.', v_n_abiertas using errcode='42501';
  end if;

  -- Ya hay una abierta (de hoy o de un día previo) => retomarla, sin duplicar.
  select id, fecha into v_id, v_fecha from prod_jornada where estado='abierta' order by fecha desc limit 1;
  if found then
    return jsonb_build_object('ok', true, 'jornada_id', v_id, 'fecha', v_fecha, 'retomada', true);
  end if;

  -- No hay abierta: crear la de HOY; si hoy ya existe (cerrada), retomarla (reabrir) sin duplicar (UNIQUE(fecha)).
  insert into prod_jornada (fecha, estado, abierta_por, abierta_at)
    values (current_date, 'abierta', auth.uid(), now())
  on conflict (fecha) do update set estado='abierta', cerrada_at=null, abierta_por=auth.uid(), abierta_at=now()
  returning id, fecha into v_id, v_fecha;
  return jsonb_build_object('ok', true, 'jornada_id', v_id, 'fecha', v_fecha, 'retomada', (v_fecha <> current_date));
end $function$
;

CREATE OR REPLACE FUNCTION public.prod_rpc_cerrar_jornada(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_role role_enum; v_active boolean; v_id uuid; v_estado text; v_forzar boolean; v_falt jsonb; v_n int; v_pend_mesas int; v_pend_detalle jsonb;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_id := nullif(p_payload->>'jornada_id','')::uuid;
  if v_id is null then select id into v_id from prod_jornada where estado='abierta' order by fecha desc limit 1; end if;
  select estado into v_estado from prod_jornada where id=v_id;
  if v_id is null or v_estado is null then raise exception 'Jornada no encontrada.' using errcode='P0002'; end if;
  if v_estado <> 'abierta' then raise exception 'La jornada ya esta cerrada.' using errcode='42501'; end if;
  v_forzar := coalesce((p_payload->>'forzar')::boolean, false);
  select coalesce(sum(demanda_neta),0), coalesce(jsonb_agg(jsonb_build_object('sku',sku,'mesas_pendientes',demanda_neta) order by demanda_neta desc),'[]'::jsonb)
    into v_pend_mesas, v_pend_detalle from prod_v_jornada_demanda_neta;
  select coalesce(jsonb_agg(jsonb_build_object('sku',sku,'pool',prod_pieza_pool(sku),'faltante',faltante_neto) order by faltante_neto desc), '[]'::jsonb), count(*)
    into v_falt, v_n from prod_v_faltante where faltante_neto > 0 and es_hoja and prod_pieza_pool(sku) in ('melamina','patas','insumo');
  if (v_pend_mesas > 0 or v_n > 0) and not v_forzar then
    return jsonb_build_object('ok', false, 'requiere_confirmacion', true, 'motivo', 'trabajo_pendiente',
      'mesas_pendientes_total', v_pend_mesas, 'mesas_pendientes', v_pend_detalle,
      'faltantes_piezas_count', v_n, 'faltantes_piezas', v_falt,
      'mensaje', 'Queda trabajo pendiente. Volve a cerrar con forzar=true. Lo pendiente se arrastra NETO a la proxima jornada (no se re-fabrica lo ya hecho).');
  end if;
  update prod_jornada set estado='cerrada', cerrada_at=now() where id=v_id;
  return jsonb_build_object('ok', true, 'jornada_id', v_id, 'cerrada_con_pendientes', (v_pend_mesas>0 or v_n>0),
    'mesas_pendientes_arrastradas', v_pend_mesas, 'faltantes_piezas', v_falt,
    'resumen', jsonb_build_object(
      'cortes', (select count(*) from prod_corte where jornada_id=v_id),
      'melamina', (select count(*) from prod_melamina where jornada_id=v_id),
      'pino', (select count(*) from prod_pino where jornada_id=v_id),
      'embalaje', (select count(*) from prod_embalaje where jornada_id=v_id)));
end $function$
;

CREATE OR REPLACE FUNCTION public.prod_rpc_crear_solicitud(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_role role_enum; v_active boolean; v_jornada uuid; v_id uuid;
BEGIN
  perform public.prod_fn_guard_lp();
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('cnc','melamina','pino','embalaje','encargado') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;
  v_jornada := NULLIF(p_payload->>'jornada_id','')::uuid;
  IF v_jornada IS NULL THEN SELECT id INTO v_jornada FROM prod_jornada WHERE fecha = CURRENT_DATE AND estado = 'abierta'; END IF;
  INSERT INTO prod_solicitud (jornada_id, sector, items, estado, solicitado_por)
  VALUES (v_jornada, NULLIF(trim(p_payload->>'sector'),''), COALESCE(p_payload->'items','[]'::jsonb), 'pendiente', auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'solicitud_id', v_id);
END $function$
;

CREATE OR REPLACE FUNCTION public.prod_rpc_editar_corte(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_role role_enum; v_active boolean; v_c prod_corte%rowtype;
  v_new_placa text; v_hojas int; v_desp int;
  v_old_rend int; v_old_pieza text; v_new_rend int; v_new_pieza text; v_old_gen int; v_new_gen int; v_disp int;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  select * into v_c from prod_corte where id = (p_payload->>'id')::uuid;
  if not found then raise exception 'Corte no encontrado.' using errcode='P0002'; end if;
  if v_role = 'cnc' then
    if v_c.editable_hasta <= now() then raise exception 'Fuera de la ventana de 24h.' using errcode='42501'; end if;
  elsif v_role not in ('encargado','owner','admin') then raise exception 'Sin permiso.' using errcode='42501'; end if;

  v_new_placa := coalesce(nullif(p_payload->>'placa_sku',''), v_c.placa_sku);
  v_hojas := public.prod_fn_int_arg(p_payload,'hojas',1,false,v_c.hojas);
  v_desp  := public.prod_fn_int_arg(p_payload,'desperdicio',0,false,v_c.desperdicio);
  select rendimiento, pieza_sku into v_old_rend, v_old_pieza from prod_placa where sku = v_c.placa_sku;
  select rendimiento, pieza_sku into v_new_rend, v_new_pieza from prod_placa where sku = v_new_placa;
  if v_new_pieza is null then raise exception 'La placa % no existe o no tiene pieza.', v_new_placa using errcode='22023'; end if;
  v_old_gen := greatest(v_c.hojas * coalesce(v_old_rend,0) - v_c.desperdicio, 0);
  v_new_gen := greatest(v_hojas * coalesce(v_new_rend,0) - v_desp, 0);

  -- Guarda no-negativo: no permitir revertir piezas que ya se consumieron aguas abajo.
  if v_old_pieza is not null then
    select coalesce(disponible,0) into v_disp from prod_stock_pieza where pieza_sku = v_old_pieza;
    if coalesce(v_disp,0) - v_old_gen < 0 then
      raise exception 'No se puede editar: % piezas de % ya fueron consumidas (stock % < % a revertir).', v_old_gen, v_old_pieza, coalesce(v_disp,0), v_old_gen using errcode='42501';
    end if;
  end if;

  perform set_config('prod.audit_motivo', nullif(p_payload->>'motivo',''), true);
  perform set_config('prod.audit_sector', 'cnc', true);
  update prod_corte set placa_sku = v_new_placa, hojas = v_hojas, desperdicio = v_desp where id = v_c.id;
  if v_old_pieza is not null then
    update prod_stock_pieza set disponible = disponible - v_old_gen, updated_at = now() where pieza_sku = v_old_pieza;
  end if;
  if v_new_pieza is not null then
    insert into prod_stock_pieza (pieza_sku, disponible) values (v_new_pieza, v_new_gen)
    on conflict (pieza_sku) do update set disponible = prod_stock_pieza.disponible + v_new_gen, updated_at = now();
  end if;
  return jsonb_build_object('ok', true, 'delta_stock', v_new_gen - v_old_gen, 'old_generadas', v_old_gen, 'new_generadas', v_new_gen);
end $function$
;

CREATE OR REPLACE FUNCTION public.prod_rpc_editar_melamina(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_role role_enum; v_active boolean; v_m prod_melamina%rowtype;
  v_term int; v_fallas int; v_old_consumo int; v_new_consumo int; v_disp_pieza int; v_disp_mel int;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  select * into v_m from prod_melamina where id = (p_payload->>'id')::uuid;
  if not found then raise exception 'Registro no encontrado.' using errcode='P0002'; end if;
  if v_role = 'melamina' then
    if v_m.editable_hasta <= now() then raise exception 'Fuera de la ventana de 24h.' using errcode='42501'; end if;
  elsif v_role not in ('encargado','owner','admin') then raise exception 'Sin permiso.' using errcode='42501'; end if;

  v_term   := public.prod_fn_int_arg(p_payload,'terminadas',0,false,v_m.terminadas);
  v_fallas := public.prod_fn_int_arg(p_payload,'fallas',0,false,v_m.fallas);
  v_old_consumo := v_m.terminadas + v_m.fallas;
  v_new_consumo := v_term + v_fallas;

  -- Guardas no-negativo: piezas crudas y melamina terminada resultantes >= 0.
  select coalesce(disponible,0) into v_disp_pieza from prod_stock_pieza where pieza_sku = v_m.pieza_sku;
  if coalesce(v_disp_pieza,0) + v_old_consumo - v_new_consumo < 0 then
    raise exception 'No se puede editar: faltan piezas crudas para el nuevo consumo (disp % + % - %).', coalesce(v_disp_pieza,0), v_old_consumo, v_new_consumo using errcode='42501';
  end if;
  select coalesce(disponible,0) into v_disp_mel from prod_stock_melamina where pieza_sku = v_m.pieza_sku;
  if coalesce(v_disp_mel,0) + (v_term - v_m.terminadas) < 0 then
    raise exception 'No se puede editar: % melaminas ya fueron consumidas (stock % < reduccion %).', v_m.pieza_sku, coalesce(v_disp_mel,0), (v_m.terminadas - v_term) using errcode='42501';
  end if;

  perform set_config('prod.audit_motivo', nullif(p_payload->>'motivo',''), true);
  perform set_config('prod.audit_sector', 'melamina', true);
  update prod_melamina set terminadas = v_term, fallas = v_fallas where id = v_m.id;
  update prod_stock_pieza set disponible = disponible + v_old_consumo - v_new_consumo, updated_at = now() where pieza_sku = v_m.pieza_sku;
  insert into prod_stock_melamina (pieza_sku, disponible) values (v_m.pieza_sku, v_term - v_m.terminadas)
  on conflict (pieza_sku) do update set disponible = prod_stock_melamina.disponible + (v_term - v_m.terminadas), updated_at = now();
  return jsonb_build_object('ok', true, 'delta_pieza', v_old_consumo - v_new_consumo, 'delta_melamina', v_term - v_m.terminadas);
end $function$
;

CREATE OR REPLACE FUNCTION public.prod_rpc_editar_pino(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_role role_enum; v_active boolean; v_p prod_pino%rowtype; v_term int; v_mas int; v_disp int; v_mas_cur int;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  select * into v_p from prod_pino where id = (p_payload->>'id')::uuid;
  if not found then raise exception 'Registro no encontrado.' using errcode='P0002'; end if;
  if v_role = 'pino' then
    if v_p.editable_hasta <= now() then raise exception 'Fuera de la ventana de 24h.' using errcode='42501'; end if;
  elsif v_role not in ('encargado','owner','admin') then raise exception 'Sin permiso.' using errcode='42501'; end if;

  v_term := public.prod_fn_int_arg(p_payload,'terminadas',0,false,v_p.terminadas);
  v_mas  := public.prod_fn_int_arg(p_payload,'masilladas',0,false,v_p.masilladas);

  select coalesce(disponible,0), coalesce(masilladas,0) into v_disp, v_mas_cur from prod_stock_patas where tamano = v_p.tamano;
  if coalesce(v_disp,0) + (v_term - v_p.terminadas) < 0 then
    raise exception 'No se puede editar: % patas ya fueron consumidas (stock % < reduccion %).', v_p.tamano, coalesce(v_disp,0), (v_p.terminadas - v_term) using errcode='42501';
  end if;
  if coalesce(v_mas_cur,0) + (v_mas - v_p.masilladas) < 0 then
    raise exception 'No se puede editar: masilladas resultantes negativas para %.', v_p.tamano using errcode='42501';
  end if;

  perform set_config('prod.audit_motivo', nullif(p_payload->>'motivo',''), true);
  perform set_config('prod.audit_sector', 'pino', true);
  update prod_pino set terminadas = v_term, masilladas = v_mas where id = v_p.id;
  update prod_stock_patas set disponible = disponible + (v_term - v_p.terminadas),
    masilladas = masilladas + (v_mas - v_p.masilladas), updated_at = now() where tamano = v_p.tamano;
  return jsonb_build_object('ok', true, 'delta_disponible', v_term - v_p.terminadas, 'delta_masilladas', v_mas - v_p.masilladas);
end $function$
;

CREATE OR REPLACE FUNCTION public.prod_rpc_editar_embalaje(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_role role_enum; v_active boolean;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('encargado','owner','admin') then raise exception 'Solo encargado/owner/admin editan embalaje.' using errcode='42501'; end if;
  -- Guard fail-safe: bajo asignación por pedido (0118/0123) la edición in situ corrompería stock asignado/insumos.
  raise exception 'La edicion de embalaje no esta disponible bajo el modelo de asignacion por pedido. Registra un embalaje corrector o gestiona el pedido; no se edita en el lugar para no corromper el stock.'
    using errcode='0A000';
end $function$
;

CREATE OR REPLACE FUNCTION public.prod_rpc_gestionar_mantenimiento(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_role role_enum; v_active boolean; v_estado text; v_sector text; v_tipo text;
BEGIN
  perform public.prod_fn_guard_lp();
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
END $function$
;

CREATE OR REPLACE FUNCTION public.prod_rpc_gestionar_solicitud(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_role role_enum; v_active boolean; v_estado text;
BEGIN
  perform public.prod_fn_guard_lp();
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('owner','admin','encargado') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;
  v_estado := p_payload->>'estado';
  IF v_estado NOT IN ('aprobada_coord','recepcionada_admin') THEN RAISE EXCEPTION 'estado inválido.' USING ERRCODE='22023'; END IF;
  UPDATE prod_solicitud SET estado = v_estado, aprobado_por = auth.uid() WHERE id = (p_payload->>'id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud no encontrada.' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('ok', true);
END $function$
;

CREATE OR REPLACE FUNCTION public.prod_rpc_ingresar_remito(p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum; v_active boolean;
  v_items jsonb; v_item jsonb;
  v_sku text; v_cant numeric;
  v_remito_id uuid;
  v_count int := 0; v_total numeric := 0;
  v_exists boolean;
BEGIN
  perform public.prod_fn_guard_lp();
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin','encargado') THEN
    RAISE EXCEPTION 'Sin permiso para cargar remitos.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  v_items := p_payload->'items';
  IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'El remito no tiene items.' USING ERRCODE='22023', HINT='empty_items'; END IF;

  -- Validación previa (todo o nada): cada item con SKU conocido y cantidad > 0.
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    v_sku  := v_item->>'sku';
    v_cant := COALESCE((v_item->>'cantidad')::numeric, 0);
    IF v_sku IS NULL OR v_sku = '' THEN
      RAISE EXCEPTION 'Hay un item sin SKU.' USING ERRCODE='22023', HINT='bad_item'; END IF;
    IF v_cant <= 0 THEN
      RAISE EXCEPTION 'Cantidad invalida para %.', v_sku USING ERRCODE='22023', HINT='bad_qty'; END IF;
    SELECT true INTO v_exists FROM prod_insumo WHERE sku = v_sku;
    IF v_exists IS NOT TRUE THEN
      RAISE EXCEPTION 'El insumo % no existe.', v_sku USING ERRCODE='23503', HINT='unknown_sku'; END IF;
  END LOOP;

  -- Cabecera del remito (registro de entrada).
  INSERT INTO prod_remito (proveedor, nro_remito, fecha, items, cargado_por)
  VALUES (
    NULLIF(trim(p_payload->>'proveedor'), ''),
    NULLIF(trim(p_payload->>'nro_remito'), ''),
    COALESCE(NULLIF(p_payload->>'fecha','')::date, CURRENT_DATE),
    v_items,
    auth.uid()
  ) RETURNING id INTO v_remito_id;

  -- Suma de stock por item.
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    v_sku  := v_item->>'sku';
    v_cant := (v_item->>'cantidad')::numeric;
    UPDATE prod_insumo
      SET stock_actual = COALESCE(stock_actual, 0) + v_cant, updated_at = now()
      WHERE sku = v_sku;
    v_count := v_count + 1;
    v_total := v_total + v_cant;
  END LOOP;

  RETURN jsonb_build_object('remito_id', v_remito_id, 'items', v_count, 'total_unidades', v_total);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.prod_rpc_jornada_sync(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_role role_enum; v_active boolean; v_j uuid; v_est text; v_origen jsonb; v_origen_txt text;
  v_new int:=0; v_upd int:=0; v_can int:=0; v_cum int:=0; v_react int:=0; v_anom int:=0; v_lib int:=0; v_asig int;
  r record; v_asignado int; v_exceso int;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_j := nullif(p_payload->>'jornada_id','')::uuid;
  if v_j is null then select id into v_j from prod_jornada where estado='abierta' order by fecha desc limit 1; end if;
  select estado into v_est from prod_jornada where id = v_j;
  if v_j is null or v_est is null then raise exception 'Jornada inexistente.' using errcode='P0002'; end if;
  if v_est <> 'abierta' then raise exception 'La jornada no esta abierta (%).', v_est using errcode='42501'; end if;
  v_origen := coalesce(p_payload->'origen','{}'::jsonb);
  v_origen_txt := 'sync:'||coalesce(v_origen->>'tipo','manual');

  -- (A) REACTIVACIÓN
  with react as (
    select o.id order_id, o.sku, o.channel_id::text ch, o.cantidad, o.status::text st
    from orders o
    where o.cancelled_at is null and o.status::text in ('pendiente','arrastrado')
      and exists (select 1 from prod_jornada_orden jo where jo.order_id=o.id and coalesce(jo.snapshot_status,'')='cancelada')
      and not exists (select 1 from prod_jornada_orden j2 where j2.order_id=o.id and j2.jornada_id=v_j and coalesce(j2.snapshot_status,'') not in ('cancelada','cumplida'))
  ), ins as (
    insert into prod_jornada_orden (jornada_id, order_id, snapshot_sku, snapshot_channel, snapshot_cantidad, snapshot_status, vinculada_por)
    select v_j, order_id, sku, ch, cantidad, st, auth.uid() from react
    on conflict (jornada_id, order_id) do update set snapshot_status = excluded.snapshot_status, snapshot_cantidad = excluded.snapshot_cantidad
    returning order_id, snapshot_cantidad)
  insert into prod_jornada_orden_log(jornada_id,order_id,accion,cantidad_anterior,cantidad_nueva,estado_anterior,estado_nuevo,origen,usuario)
  select v_j, order_id, 'reactivada', null, snapshot_cantidad, 'cancelada', 'pendiente', v_origen_txt, auth.uid() from ins;
  get diagnostics v_react = row_count;

  -- (B) CANCELACIÓN GLOBAL (incl. jornadas cerradas): liberar el neto del SKU del snapshot, 1 sola vez.
  for r in
    select jo.jornada_id, jo.order_id, jo.snapshot_sku, jo.snapshot_cantidad, jo.snapshot_status
    from prod_jornada_orden jo join orders o on o.id=jo.order_id
    where coalesce(jo.snapshot_status,'') not in ('cancelada','cumplida') and o.cancelled_at is not null
  loop
    perform pg_advisory_xact_lock(hashtext('prod_term:'||r.snapshot_sku));
    v_asignado := prod_fn_asignado(r.order_id, r.snapshot_sku);
    if v_asignado > 0 then
      insert into prod_asignacion(order_id,producto_sku,jornada_id,cantidad,tipo,origen,motivo,usuario)
        values (r.order_id,r.snapshot_sku,r.jornada_id,-v_asignado,'liberada',v_origen_txt,'cancelacion',auth.uid());
      insert into prod_stock_terminado(producto_sku,disponible) values(r.snapshot_sku,v_asignado)
        on conflict (producto_sku) do update set disponible=prod_stock_terminado.disponible+v_asignado, updated_at=now();
      v_lib := v_lib + v_asignado;
    end if;
    update prod_jornada_orden set snapshot_status='cancelada' where jornada_id=r.jornada_id and order_id=r.order_id;
    insert into prod_jornada_orden_log(jornada_id,order_id,accion,cantidad_anterior,cantidad_nueva,estado_anterior,estado_nuevo,origen,usuario)
      values (r.jornada_id,r.order_id,'cancelada',r.snapshot_cantidad,v_asignado,r.snapshot_status,'cancelada',v_origen_txt,auth.uid());
    v_can := v_can+1;
  end loop;

  -- (C) ARCHIVADO = cumplido/despachado: NO liberar; anomalía si quedó pendiente.
  for r in
    select jo.jornada_id, jo.order_id, jo.snapshot_sku, jo.snapshot_cantidad, jo.snapshot_status
    from prod_jornada_orden jo join orders o on o.id=jo.order_id
    where coalesce(jo.snapshot_status,'') not in ('cancelada','cumplida') and o.cancelled_at is null and o.status::text='archivado'
  loop
    v_asignado := prod_fn_asignado(r.order_id, r.snapshot_sku);
    update prod_jornada_orden set snapshot_status='cumplida' where jornada_id=r.jornada_id and order_id=r.order_id;
    if v_asignado < r.snapshot_cantidad then
      insert into prod_jornada_orden_log(jornada_id,order_id,accion,cantidad_anterior,cantidad_nueva,estado_anterior,estado_nuevo,origen,usuario)
        values (r.jornada_id,r.order_id,'anomalia',r.snapshot_cantidad,v_asignado,r.snapshot_status,'archivado_con_pendiente',v_origen_txt,auth.uid());
      v_anom := v_anom+1;
    else
      insert into prod_jornada_orden_log(jornada_id,order_id,accion,cantidad_anterior,cantidad_nueva,estado_anterior,estado_nuevo,origen,usuario)
        values (r.jornada_id,r.order_id,'cumplida',r.snapshot_cantidad,v_asignado,r.snapshot_status,'cumplida',v_origen_txt,auth.uid());
    end if;
    v_cum := v_cum+1;
  end loop;

  -- (D) CAMBIOS de cantidad O de SKU en la jornada abierta (pedidos activos).
  for r in
    select jo.order_id, jo.snapshot_sku, jo.snapshot_cantidad, jo.snapshot_status,
           o.cantidad cant_actual, o.status::text estado_actual, o.sku sku_actual
    from prod_jornada_orden jo join orders o on o.id=jo.order_id
    where jo.jornada_id=v_j and coalesce(jo.snapshot_status,'') not in ('cancelada','cumplida')
      and o.cancelled_at is null and o.status::text in ('pendiente','arrastrado')
      and (o.cantidad is distinct from jo.snapshot_cantidad or o.sku is distinct from jo.snapshot_sku)
  loop
    perform pg_advisory_xact_lock(hashtext('prod_term:'||r.snapshot_sku));
    if r.sku_actual is distinct from r.snapshot_sku then
      -- M15: cambio de SKU → liberar TODO el neto asignado del SKU viejo y re-apuntar el snapshot.
      v_asignado := prod_fn_asignado(r.order_id, r.snapshot_sku);
      if v_asignado > 0 then
        insert into prod_asignacion(order_id,producto_sku,jornada_id,cantidad,tipo,origen,motivo,usuario)
          values (r.order_id,r.snapshot_sku,v_j,-v_asignado,'liberada',v_origen_txt,'cambio_sku',auth.uid());
        insert into prod_stock_terminado(producto_sku,disponible) values(r.snapshot_sku,v_asignado)
          on conflict (producto_sku) do update set disponible=prod_stock_terminado.disponible+v_asignado, updated_at=now();
        v_lib := v_lib + v_asignado;
      end if;
      update prod_jornada_orden set snapshot_sku=r.sku_actual, snapshot_cantidad=r.cant_actual, snapshot_status=r.estado_actual
        where jornada_id=v_j and order_id=r.order_id;
      insert into prod_jornada_orden_log(jornada_id,order_id,accion,cantidad_anterior,cantidad_nueva,estado_anterior,estado_nuevo,origen,usuario)
        values (v_j,r.order_id,'actualizada',r.snapshot_cantidad,r.cant_actual,'sku '||r.snapshot_sku,'sku '||r.sku_actual,v_origen_txt,auth.uid());
    else
      v_asignado := prod_fn_asignado(r.order_id, r.snapshot_sku);
      if r.cant_actual < v_asignado then
        v_exceso := v_asignado - r.cant_actual;
        insert into prod_asignacion(order_id,producto_sku,jornada_id,cantidad,tipo,origen,motivo,usuario)
          values (r.order_id,r.snapshot_sku,v_j,-v_exceso,'liberada',v_origen_txt,'reduccion',auth.uid());
        insert into prod_stock_terminado(producto_sku,disponible) values(r.snapshot_sku,v_exceso)
          on conflict (producto_sku) do update set disponible=prod_stock_terminado.disponible+v_exceso, updated_at=now();
        v_lib := v_lib + v_exceso;
      end if;
      update prod_jornada_orden set snapshot_cantidad=r.cant_actual, snapshot_status=r.estado_actual where jornada_id=v_j and order_id=r.order_id;
      insert into prod_jornada_orden_log(jornada_id,order_id,accion,cantidad_anterior,cantidad_nueva,estado_anterior,estado_nuevo,origen,usuario)
        values (v_j,r.order_id,'actualizada',r.snapshot_cantidad,r.cant_actual,r.snapshot_status,r.estado_actual,v_origen_txt,auth.uid());
    end if;
    v_upd := v_upd+1;
  end loop;

  -- (E) NUEVAS del origen provisto
  with cand as (select * from prod_fn_candidatos(v_origen, v_j)),
  ins as (
    insert into prod_jornada_orden (jornada_id, order_id, snapshot_sku, snapshot_channel, snapshot_cantidad, snapshot_status, vinculada_por)
    select v_j, order_id, sku, channel, cantidad, estado, auth.uid() from cand
    on conflict (jornada_id, order_id) do nothing
    returning order_id, snapshot_cantidad, snapshot_status)
  insert into prod_jornada_orden_log(jornada_id,order_id,accion,cantidad_anterior,cantidad_nueva,estado_anterior,estado_nuevo,origen,usuario)
  select v_j, order_id, 'vinculada', null, snapshot_cantidad, null, snapshot_status, v_origen_txt, auth.uid() from ins;
  get diagnostics v_new = row_count;

  v_asig := prod_fn_autoasignar_jornada(v_j, 'sync');
  return jsonb_build_object('ok',true,'jornada_id',v_j,'nuevas',v_new,'actualizadas',v_upd,'canceladas',v_can,
    'cumplidas',v_cum,'reactivadas',v_react,'anomalias_archivado_con_pendiente',v_anom,
    'liberadas_a_stock_libre',v_lib,'auto_asignadas_de_stock_libre',v_asig);
end $function$
;

CREATE OR REPLACE FUNCTION public.prod_rpc_registrar_corte(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_role role_enum; v_active boolean; v_jornada uuid; v_est text;
  v_placa text; v_hojas int; v_desp int; v_rend int; v_pieza text; v_gen int; v_id uuid;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('cnc','encargado','owner','admin') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_jornada := nullif(p_payload->>'jornada_id','')::uuid;
  if v_jornada is null then select id into v_jornada from prod_jornada where estado='abierta' order by fecha desc limit 1; end if;
  select estado into v_est from prod_jornada where id=v_jornada;
  if v_jornada is null or v_est is null then raise exception 'Jornada inexistente.' using errcode='P0002'; end if;
  if v_est <> 'abierta' then raise exception 'La jornada no esta abierta (%).', v_est using errcode='42501'; end if;

  v_placa := p_payload->>'placa_sku';
  v_hojas := public.prod_fn_int_arg(p_payload,'hojas',1,true);
  v_desp  := public.prod_fn_int_arg(p_payload,'desperdicio',0,false,0);
  select rendimiento, pieza_sku into v_rend, v_pieza from prod_placa where sku = v_placa;
  if not found then raise exception 'Placa % no existe.', v_placa using errcode='22023'; end if;
  if v_pieza is null then raise exception 'La placa % no tiene pieza asociada.', v_placa using errcode='22023'; end if;
  v_gen := greatest(v_hojas * coalesce(v_rend,0) - v_desp, 0);

  insert into prod_corte (jornada_id, placa_sku, hojas, desperdicio, cargado_por, editable_hasta)
  values (v_jornada, v_placa, v_hojas, v_desp, auth.uid(), now() + interval '24 hours') returning id into v_id;
  insert into prod_stock_pieza (pieza_sku, disponible) values (v_pieza, v_gen)
  on conflict (pieza_sku) do update set disponible = prod_stock_pieza.disponible + v_gen, updated_at = now();

  return jsonb_build_object('ok', true, 'corte_id', v_id, 'piezas_generadas', v_gen);
end $function$
;

CREATE OR REPLACE FUNCTION public.prod_rpc_registrar_melamina(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_role role_enum; v_active boolean; v_jornada uuid; v_est text;
  v_pieza text; v_term int; v_fallas int; v_consumo int; v_disp int; v_id uuid; v_rest int;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('melamina','encargado','owner','admin') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_jornada := nullif(p_payload->>'jornada_id','')::uuid;
  if v_jornada is null then select id into v_jornada from prod_jornada where estado='abierta' order by fecha desc limit 1; end if;
  select estado into v_est from prod_jornada where id=v_jornada;
  if v_jornada is null or v_est is null then raise exception 'Jornada inexistente.' using errcode='P0002'; end if;
  if v_est <> 'abierta' then raise exception 'La jornada no esta abierta (%).', v_est using errcode='42501'; end if;

  v_pieza := p_payload->>'pieza_sku';
  v_term  := public.prod_fn_int_arg(p_payload,'terminadas',0,false,0);
  v_fallas:= public.prod_fn_int_arg(p_payload,'fallas',0,false,0);
  v_consumo := v_term + v_fallas;
  if v_consumo <= 0 then raise exception 'Debe registrar al menos una pieza (terminadas o fallas).' using errcode='22023'; end if;
  select coalesce(disponible,0) into v_disp from prod_stock_pieza where pieza_sku = v_pieza;
  v_disp := coalesce(v_disp, 0);
  if v_disp < v_consumo then raise exception 'Stock de piezas crudas insuficiente (disp %, requiere %).', v_disp, v_consumo using errcode='42501'; end if;

  insert into prod_melamina (jornada_id, pieza_sku, terminadas, fallas, cargado_por, editable_hasta)
  values (v_jornada, v_pieza, v_term, v_fallas, auth.uid(), now() + interval '24 hours') returning id into v_id;
  update prod_stock_pieza set disponible = disponible - v_consumo, updated_at = now() where pieza_sku = v_pieza returning disponible into v_rest;
  insert into prod_stock_melamina (pieza_sku, disponible) values (v_pieza, v_term)
  on conflict (pieza_sku) do update set disponible = prod_stock_melamina.disponible + v_term, updated_at = now();

  return jsonb_build_object('ok', true, 'melamina_id', v_id, 'stock_pieza_restante', v_rest);
end $function$
;

CREATE OR REPLACE FUNCTION public.prod_rpc_registrar_pino(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_role role_enum; v_active boolean; v_jornada uuid; v_est text;
  v_tamano text; v_term int; v_mas int; v_id uuid; v_disp int; v_masT int;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('pino','encargado','owner','admin') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_jornada := nullif(p_payload->>'jornada_id','')::uuid;
  if v_jornada is null then select id into v_jornada from prod_jornada where estado='abierta' order by fecha desc limit 1; end if;
  select estado into v_est from prod_jornada where id=v_jornada;
  if v_jornada is null or v_est is null then raise exception 'Jornada inexistente.' using errcode='P0002'; end if;
  if v_est <> 'abierta' then raise exception 'La jornada no esta abierta (%).', v_est using errcode='42501'; end if;

  v_tamano := p_payload->>'tamano';
  if v_tamano not in ('chica','grande') then raise exception 'tamano invalido (chica|grande).' using errcode='22023'; end if;
  v_term := public.prod_fn_int_arg(p_payload,'terminadas',0,false,0);
  v_mas  := public.prod_fn_int_arg(p_payload,'masilladas',0,false,0);
  if (v_term + v_mas) <= 0 then raise exception 'Debe registrar al menos una pata (terminadas o masilladas).' using errcode='22023'; end if;

  insert into prod_pino (jornada_id, tamano, terminadas, masilladas, cargado_por, editable_hasta)
  values (v_jornada, v_tamano, v_term, v_mas, auth.uid(), now() + interval '24 hours') returning id into v_id;
  insert into prod_stock_patas (tamano, disponible, masilladas) values (v_tamano, v_term, v_mas)
  on conflict (tamano) do update set disponible = prod_stock_patas.disponible + v_term,
    masilladas = prod_stock_patas.masilladas + v_mas, updated_at = now()
  returning disponible, masilladas into v_disp, v_masT;

  return jsonb_build_object('ok', true, 'pino_id', v_id, 'stock_patas', jsonb_build_object('tamano', v_tamano, 'disponible', v_disp, 'masilladas', v_masT));
end $function$
;

CREATE OR REPLACE FUNCTION public.prod_rpc_reportar_mantenimiento(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_role role_enum; v_active boolean; v_id uuid; v_urg text; v_sector text; v_tipo text; v_maq text;
BEGIN
  perform public.prod_fn_guard_lp();
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
END $function$
;

CREATE OR REPLACE FUNCTION public.prod_rpc_set_minimo(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_role role_enum; v_active boolean; v_sku text; v_min numeric; v_motivo text; v_ant numeric;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;

  v_sku := p_payload->>'sku';
  v_motivo := nullif(p_payload->>'motivo','');
  if (p_payload->>'minimo') is null or (p_payload->>'minimo') = '' then raise exception 'Falta el minimo.' using errcode='22023'; end if;
  begin v_min := (p_payload->>'minimo')::numeric; exception when others then raise exception 'Minimo invalido.' using errcode='22023'; end;
  if v_min < 0 then raise exception 'El minimo no puede ser negativo.' using errcode='22023'; end if;

  select stock_minimo into v_ant from prod_insumo where sku = v_sku;
  if not found then raise exception 'Insumo % no existe.', v_sku using errcode='P0002'; end if;

  update prod_insumo set stock_minimo = v_min, minimo_configurado = true,
    minimo_actualizado_por = auth.uid(), minimo_actualizado_at = now(), updated_at = now()
  where sku = v_sku;

  insert into prod_minimo_log (insumo_sku, minimo_anterior, minimo_nuevo, motivo, usuario)
  values (v_sku, v_ant, v_min, v_motivo, auth.uid());

  return jsonb_build_object('ok', true, 'sku', v_sku, 'minimo_anterior', v_ant, 'minimo_nuevo', v_min, 'configurado', true);
end $function$
;

CREATE OR REPLACE FUNCTION public.prod_rpc_stock_confirmar(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_role role_enum; v_active boolean; v_lote text; f jsonb; v jsonb; v_aplicadas int:=0; v_ya int:=0; v_tam text;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id=auth.uid();
  if v_role is null or v_active=false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_lote := nullif(p_payload->>'lote_id','');
  if v_lote is null then raise exception 'lote_id requerido.' using errcode='22023'; end if;
  for f in select * from jsonb_array_elements(coalesce(p_payload->'filas','[]'::jsonb)) loop
    v := prod_stock_validar_fila(f->>'sku', f->>'bucket', (f->>'cantidad')::int, f->>'motivo');
    if v->>'estado'='bloqueada' then raise exception 'Fila bloqueada (% / %): %', f->>'sku', f->>'bucket', v->>'detalle' using errcode='42501'; end if;
  end loop;
  for f in select * from jsonb_array_elements(coalesce(p_payload->'filas','[]'::jsonb)) loop
    insert into prod_stock_ajuste(lote_id, sku, bucket, cantidad, origen, motivo, usuario)
    values (v_lote, f->>'sku', f->>'bucket', (f->>'cantidad')::int, coalesce(f->>'origen','carga_inicial'), f->>'motivo', auth.uid())
    on conflict (lote_id, sku, bucket) do nothing;
    if not found then v_ya:=v_ya+1; continue; end if;
    v_aplicadas := v_aplicadas+1;
    case f->>'bucket'
      when 'pieza' then insert into prod_stock_pieza(pieza_sku,disponible) values(f->>'sku',(f->>'cantidad')::int)
        on conflict(pieza_sku) do update set disponible=prod_stock_pieza.disponible+(f->>'cantidad')::int, updated_at=now();
      when 'melamina' then insert into prod_stock_melamina(pieza_sku,disponible) values(f->>'sku',(f->>'cantidad')::int)
        on conflict(pieza_sku) do update set disponible=prod_stock_melamina.disponible+(f->>'cantidad')::int, updated_at=now();
      when 'terminado' then insert into prod_stock_terminado(producto_sku,disponible) values(f->>'sku',(f->>'cantidad')::int)
        on conflict(producto_sku) do update set disponible=prod_stock_terminado.disponible+(f->>'cantidad')::int, updated_at=now();
      when 'patas' then
        select tamano into v_tam from prod_pata_tamano where pieza_sku=f->>'sku';
        insert into prod_stock_patas(tamano,disponible) values(v_tam,(f->>'cantidad')::int)
        on conflict(tamano) do update set disponible=prod_stock_patas.disponible+(f->>'cantidad')::int, updated_at=now();
      when 'insumo' then update prod_insumo set stock_actual=coalesce(stock_actual,0)+(f->>'cantidad')::int, updated_at=now() where sku=f->>'sku';
    end case;
  end loop;
  return jsonb_build_object('ok',true,'lote_id',v_lote,'aplicadas_nuevas',v_aplicadas,'ya_aplicadas_idempotente',v_ya);
end $function$
;

CREATE OR REPLACE FUNCTION public.prod_rpc_vincular_confirmar(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_role role_enum; v_active boolean; v_j uuid; v_origen jsonb; v_estado text; v_new int; v_origen_txt text; v_asig int;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_j := nullif(p_payload->>'jornada_id','')::uuid;
  if v_j is null then select id into v_j from prod_jornada where estado='abierta' order by fecha desc limit 1; end if;
  if v_j is null then raise exception 'No hay jornada abierta.' using errcode='P0002'; end if;
  select estado into v_estado from prod_jornada where id=v_j;
  if v_estado is distinct from 'abierta' then raise exception 'La jornada no esta abierta (%).', v_estado using errcode='42501'; end if;
  v_origen := coalesce(p_payload->'origen','{}'::jsonb);
  v_origen_txt := coalesce(v_origen->>'tipo','') || case when v_origen ? 'import_batch_id' then ':'||(v_origen->>'import_batch_id') else '' end;
  with cand as (select * from prod_fn_candidatos(v_origen, v_j)),
  ins as (insert into prod_jornada_orden (jornada_id, order_id, snapshot_sku, snapshot_channel, snapshot_cantidad, snapshot_status, vinculada_por)
    select v_j, order_id, sku, channel, cantidad, estado, auth.uid() from cand
    on conflict (jornada_id, order_id) do nothing
    returning order_id, snapshot_cantidad, snapshot_status)
  insert into prod_jornada_orden_log (jornada_id, order_id, accion, cantidad_anterior, cantidad_nueva, estado_anterior, estado_nuevo, origen, usuario)
  select v_j, order_id, 'vinculada', null, snapshot_cantidad, null, snapshot_status, v_origen_txt, auth.uid() from ins;
  get diagnostics v_new = row_count;
  v_asig := prod_fn_autoasignar_jornada(v_j, 'vincular');
  return jsonb_build_object('ok', true, 'jornada_id', v_j, 'vinculadas_nuevas', v_new, 'auto_asignadas_de_stock_libre', v_asig,
    'total_en_jornada', (select count(*) from prod_jornada_orden where jornada_id=v_j and coalesce(snapshot_status,'')<>'cancelada'));
end $function$
;

