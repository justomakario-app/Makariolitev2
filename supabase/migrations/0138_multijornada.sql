-- 0138 (LOCAL, NO aplicada en remoto): modelo multi-jornada (Fase 8).
-- Regla: hasta N jornadas ABIERTAS (config, default 3); exactamente UNA en_ejecucion.
-- Backward-compatible: al abrir se marca en_ejecucion; con 1 jornada el motor se comporta igual que antes.
-- prod_fn_jornada_activa() reemplaza el resolver 'estado=abierta limit 1' en las RPC operativas.

-- Config numérica/textual del módulo LP (max jornadas, umbrales de capacidad, etc.)
create table if not exists public.prod_config (
  clave text primary key,
  valor text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.prod_config enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='prod_config' and policyname='prod_config_sel') then
    create policy prod_config_sel on public.prod_config for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='prod_config' and policyname='prod_config_wr') then
    create policy prod_config_wr on public.prod_config for all to authenticated
      using (public.is_owner_or_admin()) with check (public.is_owner_or_admin());
  end if;
end $$;
insert into public.prod_config(clave,valor) values ('max_jornadas_abiertas','3') on conflict (clave) do nothing;

create or replace function public.prod_cfg_int(p_clave text, p_default int)
returns int language sql stable security definer set search_path to 'public','pg_temp' as $fn$
  select coalesce((select nullif(valor,'')::int from public.prod_config where clave=p_clave), p_default);
$fn$;
revoke execute on function public.prod_cfg_int(text,int) from public, anon, authenticated;

-- Fase de la jornada. estado (abierta/cerrada) se mantiene en sync para compatibilidad.
alter table public.prod_jornada add column if not exists fase text;
update public.prod_jornada set fase = case when estado='cerrada' then 'cerrada'
  when estado='abierta' then 'en_ejecucion' else 'planificada' end where fase is null;
alter table public.prod_jornada alter column fase set default 'planificada';
alter table public.prod_jornada alter column fase set not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='prod_jornada_fase_chk') then
    alter table public.prod_jornada add constraint prod_jornada_fase_chk
      check (fase in ('planificada','en_ejecucion','pausada','cerrada'));
  end if;
  if not exists (select 1 from pg_constraint where conname='prod_jornada_fase_estado_chk') then
    alter table public.prod_jornada add constraint prod_jornada_fase_estado_chk
      check ((fase='cerrada') = (estado='cerrada'));
  end if;
end $$;

-- Índices: a lo sumo UNA en_ejecucion; se elimina el de "una sola abierta" (ahora hay hasta N).
drop index if exists public.ux_prod_jornada_una_abierta;
create unique index if not exists ux_prod_jornada_una_ejecucion
  on public.prod_jornada ((true)) where (fase='en_ejecucion');

-- Tope de jornadas abiertas (planificada/en_ejecucion/pausada) configurable.
create or replace function public.prod_tg_jornada_max() returns trigger
language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_n int; v_max int;
begin
  if new.fase in ('planificada','en_ejecucion','pausada') then
    v_max := public.prod_cfg_int('max_jornadas_abiertas',3);
    select count(*) into v_n from public.prod_jornada
      where fase in ('planificada','en_ejecucion','pausada') and id <> new.id;
    if v_n + 1 > v_max then
      raise exception 'Tope de jornadas abiertas (% de %). Cerra o cerra una antes de abrir otra.', v_n+1, v_max using errcode='42501';
    end if;
  end if;
  return new;
end $fn$;
revoke execute on function public.prod_tg_jornada_max() from public, anon, authenticated;
drop trigger if exists prod_tg_jornada_max_ins on public.prod_jornada;
create trigger prod_tg_jornada_max_ins before insert or update of fase on public.prod_jornada
  for each row execute function public.prod_tg_jornada_max();

-- Helper: jornada en ejecución (la única que recibe producción/asignación).
create or replace function public.prod_fn_jornada_activa()
returns uuid language sql stable security definer set search_path to 'public','pg_temp' as $fn$
  select id from public.prod_jornada where fase='en_ejecucion' limit 1;
$fn$;
revoke execute on function public.prod_fn_jornada_activa() from public, anon, authenticated;

-- abrir_jornada: retoma la ejecución si existe; si no, ejecuta la de hoy (backward-compatible).
create or replace function public.prod_rpc_abrir_jornada(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_id uuid; v_fecha date;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtext('prod_abrir_jornada'));
  select id, fecha into v_id, v_fecha from prod_jornada where fase='en_ejecucion' limit 1;
  if found then return jsonb_build_object('ok',true,'jornada_id',v_id,'fecha',v_fecha,'retomada',true); end if;
  -- promover una pausada/planificada de hoy si existe; si no, crear la de hoy
  select id, fecha into v_id, v_fecha from prod_jornada where fase in ('pausada','planificada') order by fecha desc limit 1;
  if found then
    update prod_jornada set fase='en_ejecucion', estado='abierta' where id=v_id;
    return jsonb_build_object('ok',true,'jornada_id',v_id,'fecha',v_fecha,'retomada',true);
  end if;
  insert into prod_jornada (fecha, estado, fase, abierta_por, abierta_at)
    values (current_date, 'abierta', 'en_ejecucion', auth.uid(), now())
  on conflict (fecha) do update set estado='abierta', fase='en_ejecucion', cerrada_at=null, abierta_por=auth.uid(), abierta_at=now()
  returning id, fecha into v_id, v_fecha;
  return jsonb_build_object('ok',true,'jornada_id',v_id,'fecha',v_fecha,'retomada',(v_fecha<>current_date));
end $fn$;

-- planificar_jornada: crea una jornada PLANIFICADA para una fecha (respeta el tope).
create or replace function public.prod_rpc_planificar_jornada(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_id uuid; v_fecha date;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtext('prod_abrir_jornada'));
  v_fecha := coalesce(nullif(p_payload->>'fecha','')::date, current_date);
  insert into prod_jornada (fecha, estado, fase, abierta_por, abierta_at)
    values (v_fecha, 'abierta', 'planificada', auth.uid(), now())
  on conflict (fecha) do update set estado='abierta',
    fase=case when prod_jornada.fase='cerrada' then 'planificada' else prod_jornada.fase end,
    cerrada_at=null
  returning id into v_id;
  return jsonb_build_object('ok',true,'jornada_id',v_id,'fecha',v_fecha,'fase','planificada');
end $fn$;

-- ejecutar_jornada: marca UNA jornada en_ejecucion; la que estuviera en ejecución pasa a pausada.
create or replace function public.prod_rpc_ejecutar_jornada(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_id uuid; v_fase text;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_id := nullif(p_payload->>'jornada_id','')::uuid;
  if v_id is null then raise exception 'jornada_id requerido.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtext('prod_abrir_jornada'));
  select fase into v_fase from prod_jornada where id=v_id for update;
  if v_fase is null then raise exception 'Jornada inexistente.' using errcode='P0002'; end if;
  if v_fase='cerrada' then raise exception 'La jornada esta cerrada.' using errcode='42501'; end if;
  update prod_jornada set fase='pausada' where fase='en_ejecucion' and id<>v_id;
  update prod_jornada set fase='en_ejecucion', estado='abierta' where id=v_id;
  return jsonb_build_object('ok',true,'jornada_id',v_id,'fase','en_ejecucion');
end $fn$;

-- pausar_jornada: la jornada en ejecución pasa a pausada (queda sin activa hasta ejecutar otra).
create or replace function public.prod_rpc_pausar_jornada(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_id uuid; v_fase text;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_id := coalesce(nullif(p_payload->>'jornada_id','')::uuid, public.prod_fn_jornada_activa());
  if v_id is null then raise exception 'No hay jornada en ejecucion.' using errcode='P0002'; end if;
  select fase into v_fase from prod_jornada where id=v_id for update;
  if v_fase is distinct from 'en_ejecucion' then raise exception 'La jornada no esta en ejecucion (%).', v_fase using errcode='42501'; end if;
  update prod_jornada set fase='pausada' where id=v_id;
  return jsonb_build_object('ok',true,'jornada_id',v_id,'fase','pausada');
end $fn$;

-- get_jornada_hoy → jornada en ejecucion
CREATE OR REPLACE FUNCTION public.prod_rpc_get_jornada_hoy(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_role role_enum; v_active boolean; v_j record;
begin
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('cnc','melamina','pino','embalaje','encargado','owner','admin') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  -- La jornada operativa es la ABIERTA (cualquier fecha), no la de hoy.
  select id, fecha, estado into v_j from prod_jornada where fase='en_ejecucion' limit 1;
  if not found then return 'null'::jsonb; end if;
  return jsonb_build_object('jornada_id', v_j.id, 'fecha', v_j.fecha, 'estado', v_j.estado);
end $function$
;

-- cerrar_jornada → cierra la ACTIVA, setea fase=cerrada
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
  if v_id is null then v_id := public.prod_fn_jornada_activa(); end if;
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
  update prod_jornada set estado='cerrada', fase='cerrada', cerrada_at=now() where id=v_id;
  return jsonb_build_object('ok', true, 'jornada_id', v_id, 'cerrada_con_pendientes', (v_pend_mesas>0 or v_n>0),
    'mesas_pendientes_arrastradas', v_pend_mesas, 'faltantes_piezas', v_falt,
    'resumen', jsonb_build_object(
      'cortes', (select count(*) from prod_corte where jornada_id=v_id),
      'melamina', (select count(*) from prod_melamina where jornada_id=v_id),
      'pino', (select count(*) from prod_pino where jornada_id=v_id),
      'embalaje', (select count(*) from prod_embalaje where jornada_id=v_id)));
end $function$
;

-- prod_rpc_registrar_corte → jornada activa
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
  if v_jornada is null then v_jornada := public.prod_fn_jornada_activa(); end if;
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

-- prod_rpc_registrar_melamina → jornada activa
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
  if v_jornada is null then v_jornada := public.prod_fn_jornada_activa(); end if;
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

-- prod_rpc_registrar_pino → jornada activa
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
  if v_jornada is null then v_jornada := public.prod_fn_jornada_activa(); end if;
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

-- prod_rpc_registrar_embalaje → jornada activa
CREATE OR REPLACE FUNCTION public.prod_rpc_registrar_embalaje(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_role role_enum; v_active boolean; v_jornada uuid; v_est text; v_prod text; v_unid int; v_canal text;
  v_desconocidas text; v_id uuid; v_reqid text; v_hash text; v_ins int; v_prev jsonb; v_prev_hash text;
  v_rest int; v_take int; v_libre int; v_o record; v_falta text; res jsonb;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('embalaje','encargado','owner','admin') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_jornada := nullif(p_payload->>'jornada_id','')::uuid;
  if v_jornada is null then v_jornada := public.prod_fn_jornada_activa(); end if;
  select estado into v_est from prod_jornada where id=v_jornada;
  if v_jornada is null or v_est is null then raise exception 'Jornada inexistente.' using errcode='P0002'; end if;
  if v_est <> 'abierta' then raise exception 'La jornada no esta abierta (%).', v_est using errcode='42501'; end if;
  v_prod := p_payload->>'producto_sku';
  v_unid := coalesce((p_payload->>'unidades')::int, 0);
  v_canal := nullif(trim(p_payload->>'canal'),'');
  if v_unid <= 0 then raise exception 'unidades debe ser > 0.' using errcode='22023'; end if;
  if not exists (select 1 from prod_producto where sku=v_prod) then raise exception 'Producto % no existe.', v_prod using errcode='22023'; end if;
  if not exists (select 1 from prod_receta where producto_sku=v_prod)
     and not exists (select 1 from prod_componente where padre_sku=v_prod) then
    raise exception 'Configuracion incompleta: el producto % no tiene receta ni componentes (BOM).', v_prod using errcode='42501';
  end if;

  v_reqid := nullif(p_payload->>'request_id','');
  if v_reqid is not null then
    v_hash := md5('registrar_embalaje|'||v_prod||'|'||v_unid::text||'|'||coalesce(v_jornada::text,''));
    insert into prod_idempotencia(request_id, rpc, op_hash) values (v_reqid,'registrar_embalaje',v_hash)
      on conflict (request_id) do nothing;
    get diagnostics v_ins = row_count;
    if v_ins = 0 then
      select op_hash, resultado into v_prev_hash, v_prev from prod_idempotencia where request_id=v_reqid for update;
      if v_prev_hash is distinct from v_hash then
        raise exception 'request_id reutilizado con un payload distinto.' using errcode='23505';
      end if;
      return v_prev;
    end if;
  end if;

  with recursive bom as (select hijo_sku sku, 1 lvl from prod_componente where padre_sku=v_prod
    union all select c.hijo_sku, b.lvl+1 from bom b join prod_componente c on c.padre_sku=b.sku where b.lvl<20)
  select string_agg(distinct x.sku, ', ') into v_desconocidas from (select distinct sku from bom) x
  where not exists (select 1 from prod_componente c where c.padre_sku=x.sku) and public.prod_pieza_pool(x.sku)='desconocido';
  if v_desconocidas is not null then raise exception 'Configuracion incompleta: componentes sin pool (%).', v_desconocidas using errcode='42501'; end if;

  drop table if exists _patas_req;
  create temp table _patas_req on commit drop as
    with recursive bom as (select hijo_sku sku, cantidad::numeric qty, 1 lvl from prod_componente where padre_sku=v_prod
      union all select c.hijo_sku, b.qty*c.cantidad, b.lvl+1 from bom b join prod_componente c on c.padre_sku=b.sku where b.lvl<20)
    select t.tamano, (sum(b.qty)*v_unid)::int need from bom b join prod_pata_tamano t on t.pieza_sku=b.sku group by t.tamano;
  drop table if exists _ins_req;
  create temp table _ins_req on commit drop as
    with recursive bom as (select hijo_sku sku, cantidad::numeric qty, 1 lvl from prod_componente where padre_sku=v_prod
      union all select c.hijo_sku, b.qty*c.cantidad, b.lvl+1 from bom b join prod_componente c on c.padre_sku=b.sku where b.lvl<20),
    hojas as (select sku, sum(qty) qty from bom b where not exists(select 1 from prod_componente c where c.padre_sku=b.sku) group by sku)
    select i.sku, (h.qty*v_unid)::int need from hojas h join prod_insumo i on i.sku=h.sku;

  perform 1 from prod_stock_melamina where pieza_sku in
    (select r.pieza_sku from prod_receta r where r.producto_sku=v_prod and public.prod_pieza_pool(r.pieza_sku)='melamina')
    order by pieza_sku for update;
  perform 1 from prod_stock_patas where tamano in (select tamano from _patas_req) order by tamano for update;
  perform 1 from prod_insumo where sku in (select sku from _ins_req) order by sku for update;

  select string_agg(r.pieza_sku,',') into v_falta from prod_receta r left join prod_stock_melamina sm on sm.pieza_sku=r.pieza_sku
    where r.producto_sku=v_prod and public.prod_pieza_pool(r.pieza_sku)='melamina' and coalesce(sm.disponible,0) < v_unid*r.cantidad;
  if v_falta is not null then raise exception 'Stock de melamina insuficiente (%).', v_falta using errcode='42501'; end if;
  select string_agg(pr.tamano,',') into v_falta from _patas_req pr left join prod_stock_patas sp on sp.tamano=pr.tamano where coalesce(sp.disponible,0) < pr.need;
  if v_falta is not null then raise exception 'Stock de patas insuficiente (%).', v_falta using errcode='42501'; end if;
  select string_agg(ir.sku,',') into v_falta from _ins_req ir join prod_insumo i on i.sku=ir.sku where coalesce(i.stock_actual,0) < ir.need;
  if v_falta is not null then raise exception 'Stock de insumo insuficiente (%).', v_falta using errcode='42501'; end if;

  update prod_stock_melamina sm set disponible = sm.disponible - (v_unid*r.cantidad), updated_at=now()
    from prod_receta r where r.producto_sku=v_prod and sm.pieza_sku=r.pieza_sku and public.prod_pieza_pool(r.pieza_sku)='melamina';
  update prod_stock_patas sp set disponible = sp.disponible - pr.need, updated_at=now() from _patas_req pr where sp.tamano=pr.tamano;
  insert into prod_embalaje (jornada_id, producto_sku, unidades, canal, cargado_por)
    values (v_jornada, v_prod, v_unid, v_canal, auth.uid()) returning id into v_id;

  perform pg_advisory_xact_lock(hashtext('prod_term:'||v_prod));
  v_rest := v_unid;
  for v_o in (select jo.order_id, jo.snapshot_cantidad,
                greatest(jo.snapshot_cantidad - public.prod_fn_asignado(jo.order_id, jo.snapshot_sku),0) as pendiente
              from prod_jornada_orden jo join orders ord on ord.id=jo.order_id
              where jo.jornada_id=v_jornada and jo.snapshot_sku=v_prod
                and coalesce(jo.snapshot_status,'') not in ('cancelada','cumplida')
                and ord.cancelled_at is null and ord.status::text in ('pendiente','arrastrado')
              order by ord.created_at asc, public.prod_fn_natkey(ord.order_number) asc, jo.order_id) loop
    exit when v_rest <= 0;
    v_take := least(v_o.pendiente, v_rest);
    if v_take > 0 then
      insert into prod_asignacion(order_id,producto_sku,jornada_id,cantidad,tipo,origen,request_id,usuario)
        values (v_o.order_id, v_prod, v_jornada, v_take, 'asignada', 'embalaje', v_reqid, auth.uid());
      v_rest := v_rest - v_take;
    end if;
  end loop;
  if v_rest > 0 then
    insert into prod_stock_terminado(producto_sku, disponible) values (v_prod, v_rest)
      on conflict (producto_sku) do update set disponible = prod_stock_terminado.disponible + v_rest, updated_at=now();
  end if;
  select coalesce(disponible,0) into v_libre from prod_stock_terminado where producto_sku=v_prod;

  res := jsonb_build_object('ok',true,'embalaje_id',v_id,'unidades',v_unid,
    'asignadas_a_pedidos', v_unid - v_rest, 'a_stock_libre', v_rest, 'stock_terminado_libre', v_libre);
  if v_reqid is not null then update prod_idempotencia set resultado=res where request_id=v_reqid; end if;
  return res;
end $function$
;

-- prod_rpc_jornada_sync → jornada activa
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
  if v_j is null then v_j := public.prod_fn_jornada_activa(); end if;
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

-- prod_rpc_vincular_preview → jornada activa
CREATE OR REPLACE FUNCTION public.prod_rpc_vincular_preview(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_role role_enum; v_active boolean; v_j uuid; v_origen jsonb;
begin
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_j := nullif(p_payload->>'jornada_id','')::uuid;
  if v_j is null then v_j := public.prod_fn_jornada_activa(); end if;
  v_origen := coalesce(p_payload->'origen','{}'::jsonb);
  return jsonb_build_object('jornada_id', v_j, 'origen', v_origen,
    'total_ventas', (select count(*) from prod_fn_candidatos(v_origen, v_j)),
    'total_unidades', (select coalesce(sum(cantidad),0) from prod_fn_candidatos(v_origen, v_j)),
    'ya_vinculadas_en_jornada', (select count(*) from prod_jornada_orden jo where jo.jornada_id=v_j and coalesce(jo.snapshot_status,'')<>'cancelada'),
    'detalle', coalesce((select jsonb_agg(jsonb_build_object('sku',sku,'unidades',cantidad,'canal',channel) order by sku) from prod_fn_candidatos(v_origen, v_j)), '[]'::jsonb));
end $function$
;

-- prod_rpc_vincular_confirmar → jornada activa
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
  if v_j is null then v_j := public.prod_fn_jornada_activa(); end if;
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

-- prod_rpc_arrastre_preview → jornada activa
CREATE OR REPLACE FUNCTION public.prod_rpc_arrastre_preview(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_role role_enum; v_active boolean; v_j uuid;
begin
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_j := nullif(p_payload->>'jornada_id','')::uuid;
  if v_j is null then v_j := public.prod_fn_jornada_activa(); end if;
  return jsonb_build_object('jornada_id', v_j,
    'pendientes_por_pedido', coalesce((
      select jsonb_agg(jsonb_build_object('order_id',order_id,'sku',sku,'cantidad',cantidad,
               'ya_asignado',public.prod_fn_asignado(order_id),
               'pendiente_real',greatest(cantidad-public.prod_fn_asignado(order_id),0)) order by sku)
      from prod_fn_candidatos('{"tipo":"arrastre"}'::jsonb, v_j)), '[]'::jsonb),
    'total_ventas_arrastrables', (select count(*) from prod_fn_candidatos('{"tipo":"arrastre"}'::jsonb, v_j)));
end $function$
;
