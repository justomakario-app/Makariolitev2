-- 0124 · FIX auditoría — validación uniforme en mutadores de sector (corte/melamina/pino):
--  (§5) jornada resuelta por estado='abierta' (no por fecha=HOY) + si viene jornada_id, exigir que esté abierta;
--       jornada inexistente/cerrada/manipulada => error controlado y CERO mutaciones.
--  (§8) rechazar cantidades negativas/cero/no-enteras (helper prod_fn_int_arg).
--  Además: corrige el string mojibake de tamano en registrar_pino.
-- (Aplicada en remoto vía MCP el 2026-07-21 durante la corrección integral pre-push. SIN commitear aún.)

-- Helper de validación de enteros de payload (acepta número JSON o string numérico).
create or replace function public.prod_fn_int_arg(p_payload jsonb, p_key text, p_min int, p_required boolean, p_default int default 0)
returns int language plpgsql immutable set search_path to 'public','pg_temp' as $function$
declare t text; n numeric;
begin
  if (p_payload -> p_key) is null or jsonb_typeof(p_payload -> p_key) = 'null' then
    if p_required then raise exception '% es requerido.', p_key using errcode='22023'; end if;
    return p_default;
  end if;
  t := p_payload ->> p_key;
  if t is null or btrim(t) = '' then
    if p_required then raise exception '% es requerido.', p_key using errcode='22023'; end if;
    return p_default;
  end if;
  begin n := t::numeric; exception when others then raise exception '% debe ser numerico (recibido: %).', p_key, t using errcode='22023'; end;
  if n <> floor(n) then raise exception '% debe ser un entero sin decimales (recibido: %).', p_key, t using errcode='22023'; end if;
  if n < p_min then raise exception '% no puede ser menor que % (recibido: %).', p_key, p_min, t using errcode='22023'; end if;
  return n::int;
end $function$;
revoke execute on function public.prod_fn_int_arg(jsonb, text, int, boolean, int) from public, anon, authenticated;

create or replace function public.prod_rpc_registrar_corte(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_role role_enum; v_active boolean; v_jornada uuid; v_est text;
  v_placa text; v_hojas int; v_desp int; v_rend int; v_pieza text; v_gen int; v_id uuid;
begin
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
end $function$;

create or replace function public.prod_rpc_registrar_melamina(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_role role_enum; v_active boolean; v_jornada uuid; v_est text;
  v_pieza text; v_term int; v_fallas int; v_consumo int; v_disp int; v_id uuid; v_rest int;
begin
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
end $function$;

create or replace function public.prod_rpc_registrar_pino(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_role role_enum; v_active boolean; v_jornada uuid; v_est text;
  v_tamano text; v_term int; v_mas int; v_id uuid; v_disp int; v_masT int;
begin
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
end $function$;

revoke execute on function public.prod_rpc_registrar_corte(jsonb) from public, anon;
revoke execute on function public.prod_rpc_registrar_melamina(jsonb) from public, anon;
revoke execute on function public.prod_rpc_registrar_pino(jsonb) from public, anon;
grant execute on function public.prod_rpc_registrar_corte(jsonb) to authenticated;
grant execute on function public.prod_rpc_registrar_melamina(jsonb) to authenticated;
grant execute on function public.prod_rpc_registrar_pino(jsonb) to authenticated;
