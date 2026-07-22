-- 0126 · FIX auditoría — integridad de stock en la edición de cargas (ventana 24h).
-- editar_embalaje quedó incompatible con el modelo por-pedido (0118/0123): reversaba prod_stock_terminado
-- directo, sin tocar el ledger prod_asignacion, sin revertir insumos, y usando producto.patas_cant en vez
-- del BOM => editar un embalaje ya asignado dejaba stock libre negativo, asignaciones fantasma e insumos
-- desincronizados. La reversa correcta bajo asignación FIFO es ambigua (¿qué pedido pierde cobertura?),
-- así que se aplica un guard fail-safe (rechaza la edición in situ) para NO corromper stock. Corrección
-- correcta = registrar un embalaje corrector o gestionar el pedido. (Pendiente: reverse+reapply con tests.)
-- editar_corte/melamina/pino: se les agrega validación de enteros y guarda de stock no-negativo.
-- (Aplicada en remoto vía MCP el 2026-07-21 durante la corrección integral pre-push. SIN commitear aún.)

create or replace function public.prod_rpc_editar_embalaje(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_role role_enum; v_active boolean;
begin
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('encargado','owner','admin') then raise exception 'Solo encargado/owner/admin editan embalaje.' using errcode='42501'; end if;
  -- Guard fail-safe: bajo asignación por pedido (0118/0123) la edición in situ corrompería stock asignado/insumos.
  raise exception 'La edicion de embalaje no esta disponible bajo el modelo de asignacion por pedido. Registra un embalaje corrector o gestiona el pedido; no se edita en el lugar para no corromper el stock.'
    using errcode='0A000';
end $function$;

create or replace function public.prod_rpc_editar_corte(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_role role_enum; v_active boolean; v_c prod_corte%rowtype;
  v_new_placa text; v_hojas int; v_desp int;
  v_old_rend int; v_old_pieza text; v_new_rend int; v_new_pieza text; v_old_gen int; v_new_gen int; v_disp int;
begin
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
end $function$;

create or replace function public.prod_rpc_editar_melamina(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_role role_enum; v_active boolean; v_m prod_melamina%rowtype;
  v_term int; v_fallas int; v_old_consumo int; v_new_consumo int; v_disp_pieza int; v_disp_mel int;
begin
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
end $function$;

create or replace function public.prod_rpc_editar_pino(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_role role_enum; v_active boolean; v_p prod_pino%rowtype; v_term int; v_mas int; v_disp int; v_mas_cur int;
begin
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
end $function$;
