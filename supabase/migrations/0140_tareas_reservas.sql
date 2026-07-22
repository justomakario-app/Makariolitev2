-- 0140 (LOCAL): ciclo tarea reservado→en_proceso→consumido. Append-only.
-- reservar_jornada crea tareas por sector y reserva el INPUT disponible; iniciar_tarea mueve
-- reservado→en_proceso atomicamente (parcial permitido, rol de sector); finalizar_tarea consume
-- exactamente lo iniciado, genera el output del sector y devuelve sobrantes reservados a disponible.
-- Las columnas disponible/reservado/en_proceso reflejan transiciones reales (ya no quedan en cero).
-- CNC/Pino ademas consumen materia prima en la carga directa (bloqueo si no hay config/stock).

alter table public.prod_insumo add column if not exists reservado int not null default 0;
alter table public.prod_insumo add column if not exists en_proceso int not null default 0;

create table if not exists public.prod_tarea (
  id uuid primary key default gen_random_uuid(),
  jornada_id uuid not null references public.prod_jornada(id) on delete cascade,
  sector text not null check (sector in ('cnc','melamina','pino')),
  input_pool text not null,       -- 'mp'|'pieza'
  input_sku text not null,
  output_pool text not null,      -- 'pieza'|'melamina'|'patas'
  output_sku text not null,       -- pieza_sku / tamano
  factor numeric not null,        -- output por unidad de input (rendimiento; melamina=1; patas/unidad)
  input_plan int not null check (input_plan >= 0),
  reservado int not null default 0,
  en_proceso int not null default 0,
  input_consumido int not null default 0,
  output_generado int not null default 0,
  estado text not null default 'planificada' check (estado in ('planificada','reservada','en_proceso','finalizada','cancelada','config_incompleta')),
  nota text,
  created_at timestamptz not null default now()
);
alter table public.prod_tarea enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='prod_tarea' and policyname='tarea_sel') then
    create policy tarea_sel on public.prod_tarea for select to authenticated using (true); end if;
end $$;
create index if not exists ix_prod_tarea_j on public.prod_tarea(jornada_id, sector);

-- Helper: aplica deltas a disponible/reservado/en_proceso del pool+sku indicado (los CHECK impiden negativos).
create or replace function public.prod_fn_stock_apply(p_pool text, p_sku text, d_disp int, d_res int, d_enp int)
returns void language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
begin
  if p_pool='mp' then
    insert into prod_stock_mp(mp_sku,disponible,reservado,en_proceso) values(p_sku,greatest(d_disp,0),greatest(d_res,0),greatest(d_enp,0))
      on conflict(mp_sku) do update set disponible=prod_stock_mp.disponible+d_disp, reservado=prod_stock_mp.reservado+d_res, en_proceso=prod_stock_mp.en_proceso+d_enp, updated_at=now();
  elsif p_pool='pieza' then
    insert into prod_stock_pieza(pieza_sku,disponible,reservado,en_proceso) values(p_sku,greatest(d_disp,0),greatest(d_res,0),greatest(d_enp,0))
      on conflict(pieza_sku) do update set disponible=prod_stock_pieza.disponible+d_disp, reservado=prod_stock_pieza.reservado+d_res, en_proceso=prod_stock_pieza.en_proceso+d_enp, updated_at=now();
  elsif p_pool='melamina' then
    insert into prod_stock_melamina(pieza_sku,disponible,reservado,en_proceso) values(p_sku,greatest(d_disp,0),greatest(d_res,0),greatest(d_enp,0))
      on conflict(pieza_sku) do update set disponible=prod_stock_melamina.disponible+d_disp, reservado=prod_stock_melamina.reservado+d_res, en_proceso=prod_stock_melamina.en_proceso+d_enp, updated_at=now();
  elsif p_pool='patas' then
    insert into prod_stock_patas(tamano,disponible,reservado,en_proceso) values(p_sku,greatest(d_disp,0),greatest(d_res,0),greatest(d_enp,0))
      on conflict(tamano) do update set disponible=prod_stock_patas.disponible+d_disp, reservado=prod_stock_patas.reservado+d_res, en_proceso=prod_stock_patas.en_proceso+d_enp, updated_at=now();
  elsif p_pool='terminado' then
    insert into prod_stock_terminado(producto_sku,disponible,reservado,en_proceso) values(p_sku,greatest(d_disp,0),greatest(d_res,0),greatest(d_enp,0))
      on conflict(producto_sku) do update set disponible=prod_stock_terminado.disponible+d_disp, reservado=prod_stock_terminado.reservado+d_res, en_proceso=prod_stock_terminado.en_proceso+d_enp, updated_at=now();
  elsif p_pool='insumo' then
    update prod_insumo set stock_actual=stock_actual+d_disp, reservado=reservado+d_res, en_proceso=en_proceso+d_enp, updated_at=now() where sku=p_sku;
  else raise exception 'pool desconocido %', p_pool using errcode='22023';
  end if;
end $fn$;
revoke execute on function public.prod_fn_stock_apply(text,text,int,int,int) from public, anon, authenticated;

create or replace function public.prod_fn_stock_disp(p_pool text, p_sku text)
returns int language plpgsql stable security definer set search_path to 'public','pg_temp' as $fn$
declare v int;
begin
  if p_pool='mp' then select coalesce(disponible,0) into v from prod_stock_mp where mp_sku=p_sku;
  elsif p_pool='pieza' then select coalesce(disponible,0) into v from prod_stock_pieza where pieza_sku=p_sku;
  elsif p_pool='melamina' then select coalesce(disponible,0) into v from prod_stock_melamina where pieza_sku=p_sku;
  elsif p_pool='patas' then select coalesce(disponible,0) into v from prod_stock_patas where tamano=p_sku;
  elsif p_pool='terminado' then select coalesce(disponible,0) into v from prod_stock_terminado where producto_sku=p_sku;
  elsif p_pool='insumo' then select coalesce(stock_actual,0) into v from prod_insumo where sku=p_sku;
  end if;
  return coalesce(v,0);
end $fn$;
revoke execute on function public.prod_fn_stock_disp(text,text) from public, anon, authenticated;

-- ── reservar_jornada: crea tareas por sector y reserva el input disponible ──
create or replace function public.prod_rpc_reservar_jornada(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_j uuid; o record; v_placa record; v_hojas int; v_res int; v_disp int;
  v_creadas int:=0; v_incompletas int:=0; v_reservado_total int:=0; v_tam text; v_pr record; v_units int;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id=auth.uid();
  if v_role is null or v_active=false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_j := coalesce(nullif(p_payload->>'jornada_id','')::uuid, public.prod_fn_jornada_activa());
  if v_j is null then raise exception 'No hay jornada en ejecucion.' using errcode='P0002'; end if;
  -- idempotente: limpia reservas previas de la jornada (devuelve reservado a disponible) antes de recalcular
  for o in (select * from prod_tarea where jornada_id=v_j and estado in ('planificada','reservada')) loop
    if o.reservado>0 then perform public.prod_fn_stock_apply(o.input_pool,o.input_sku,o.reservado,-o.reservado,0); end if;
    delete from prod_tarea where id=o.id;
  end loop;

  -- CNC: por cada TAP a cortar, hojas = ceil(cant/rendimiento); reserva placa (MP)
  for o in (select sku, cantidad::int cant from prod_v_orden_sector where sector='cnc' and cantidad>0) loop
    select p.sku, p.rendimiento, p.mp_sku into v_placa from prod_placa p where p.pieza_sku=o.sku and p.combinada=false order by p.rendimiento desc limit 1;
    if not found or v_placa.rendimiento is null or v_placa.rendimiento=0 then
      insert into prod_tarea(jornada_id,sector,input_pool,input_sku,output_pool,output_sku,factor,input_plan,estado,nota)
        values(v_j,'cnc','mp',coalesce(v_placa.sku,'?'),'pieza',o.sku,1,0,'config_incompleta','sin placa/rendimiento para '||o.sku);
      v_incompletas:=v_incompletas+1; continue;
    end if;
    v_hojas := ceil(o.cant::numeric / v_placa.rendimiento)::int;
    if v_placa.mp_sku is null then
      insert into prod_tarea(jornada_id,sector,input_pool,input_sku,output_pool,output_sku,factor,input_plan,estado,nota)
        values(v_j,'cnc','mp',v_placa.sku,'pieza',o.sku,v_placa.rendimiento,v_hojas,'config_incompleta','placa '||v_placa.sku||' sin materia prima configurada');
      v_incompletas:=v_incompletas+1; continue;
    end if;
    v_disp := public.prod_fn_stock_disp('mp',v_placa.mp_sku);
    v_res := least(v_hojas, v_disp);
    insert into prod_tarea(jornada_id,sector,input_pool,input_sku,output_pool,output_sku,factor,input_plan,reservado,estado)
      values(v_j,'cnc','mp',v_placa.mp_sku,'pieza',o.sku,v_placa.rendimiento,v_hojas,v_res, case when v_res>0 then 'reservada' else 'planificada' end);
    if v_res>0 then perform public.prod_fn_stock_apply('mp',v_placa.mp_sku,-v_res,v_res,0);
      insert into prod_stock_mov(jornada_id,pool,sku,tipo,cantidad,usuario) values(v_j,'mp',v_placa.mp_sku,'reservar',v_res,auth.uid());
      v_reservado_total:=v_reservado_total+v_res; end if;
    v_creadas:=v_creadas+1;
  end loop;

  -- Melamina: reserva crudo (pieza) para las tapas que faltan terminar
  for o in (select sku, cantidad::int cant from prod_v_orden_sector where sector='melamina' and cantidad>0) loop
    v_disp := public.prod_fn_stock_disp('pieza',o.sku);
    v_res := least(o.cant, v_disp);
    insert into prod_tarea(jornada_id,sector,input_pool,input_sku,output_pool,output_sku,factor,input_plan,reservado,estado)
      values(v_j,'melamina','pieza',o.sku,'melamina',o.sku,1,o.cant,v_res, case when v_res>0 then 'reservada' else 'planificada' end);
    if v_res>0 then perform public.prod_fn_stock_apply('pieza',o.sku,-v_res,v_res,0);
      insert into prod_stock_mov(jornada_id,pool,sku,tipo,cantidad,usuario) values(v_j,'pieza',o.sku,'reservar',v_res,auth.uid());
      v_reservado_total:=v_reservado_total+v_res; end if;
    v_creadas:=v_creadas+1;
  end loop;

  -- Pino: por cada pata (PAT) a fabricar, mapear tamano y reservar listones (MP) segun receta
  for o in (select sku, cantidad::int cant from prod_v_orden_sector where sector='pino' and cantidad>0) loop
    select tamano into v_tam from prod_pata_tamano where pieza_sku=o.sku;
    select * into v_pr from prod_pino_receta where tamano=v_tam;
    if v_tam is null or not found then
      insert into prod_tarea(jornada_id,sector,input_pool,input_sku,output_pool,output_sku,factor,input_plan,estado,nota)
        values(v_j,'pino','mp','?','patas',coalesce(v_tam,o.sku),1,0,'config_incompleta','sin receta de pino para '||o.sku);
      v_incompletas:=v_incompletas+1; continue;
    end if;
    v_units := ceil(o.cant::numeric / v_pr.patas_por_unidad)::int;
    v_disp := public.prod_fn_stock_disp('mp',v_pr.mp_sku);
    v_res := least(v_units, v_disp);
    insert into prod_tarea(jornada_id,sector,input_pool,input_sku,output_pool,output_sku,factor,input_plan,reservado,estado)
      values(v_j,'pino','mp',v_pr.mp_sku,'patas',v_tam,v_pr.patas_por_unidad,v_units,v_res, case when v_res>0 then 'reservada' else 'planificada' end);
    if v_res>0 then perform public.prod_fn_stock_apply('mp',v_pr.mp_sku,-v_res,v_res,0);
      insert into prod_stock_mov(jornada_id,pool,sku,tipo,cantidad,usuario) values(v_j,'mp',v_pr.mp_sku,'reservar',v_res,auth.uid());
      v_reservado_total:=v_reservado_total+v_res; end if;
    v_creadas:=v_creadas+1;
  end loop;

  return jsonb_build_object('ok',true,'jornada_id',v_j,'tareas_creadas',v_creadas,'config_incompletas',v_incompletas,'input_reservado',v_reservado_total);
end $fn$;

-- ── iniciar_tarea: mueve `cantidad` de input reservado → en_proceso (parcial, rol de sector) ──
create or replace function public.prod_rpc_iniciar_tarea(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_id uuid; v_q int; tr record;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id=auth.uid();
  if v_role is null or v_active=false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  v_id := nullif(p_payload->>'tarea_id','')::uuid;
  if v_id is null then raise exception 'tarea_id requerido.' using errcode='22023'; end if;
  select * into tr from prod_tarea where id=v_id for update;
  if not found then raise exception 'Tarea inexistente.' using errcode='P0002'; end if;
  if v_role not in ('owner','admin','encargado', tr.sector::role_enum) then raise exception 'Sin permiso para el sector %.', tr.sector using errcode='42501'; end if;
  if tr.estado='config_incompleta' then raise exception 'Configuracion incompleta: %', coalesce(tr.nota,'faltan datos') using errcode='42501'; end if;
  if tr.estado in ('finalizada','cancelada') then raise exception 'La tarea ya esta %.', tr.estado using errcode='42501'; end if;
  v_q := public.prod_fn_int_arg(p_payload,'cantidad',greatest(tr.reservado,1),true);
  if v_q > tr.reservado then raise exception 'Solo hay % reservado (pediste %).', tr.reservado, v_q using errcode='42501'; end if;
  perform public.prod_fn_stock_apply(tr.input_pool, tr.input_sku, 0, -v_q, v_q); -- reservado→en_proceso
  update prod_tarea set reservado=reservado-v_q, en_proceso=en_proceso+v_q, estado='en_proceso' where id=v_id;
  insert into prod_stock_mov(jornada_id,tarea_id,pool,sku,tipo,cantidad,usuario) values(tr.jornada_id,v_id,tr.input_pool,tr.input_sku,'iniciar',v_q,auth.uid());
  return jsonb_build_object('ok',true,'tarea_id',v_id,'en_proceso',tr.en_proceso+v_q,'reservado_restante',tr.reservado-v_q);
end $fn$;

-- ── finalizar_tarea: consume `cantidad` de input en_proceso, genera output, devuelve sobrantes ──
create or replace function public.prod_rpc_finalizar_tarea(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_id uuid; v_q int; tr record; v_out int; v_masilladas int;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id=auth.uid();
  if v_role is null or v_active=false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  v_id := nullif(p_payload->>'tarea_id','')::uuid;
  if v_id is null then raise exception 'tarea_id requerido.' using errcode='22023'; end if;
  select * into tr from prod_tarea where id=v_id for update;
  if not found then raise exception 'Tarea inexistente.' using errcode='P0002'; end if;
  if v_role not in ('owner','admin','encargado', tr.sector::role_enum) then raise exception 'Sin permiso para el sector %.', tr.sector using errcode='42501'; end if;
  v_q := public.prod_fn_int_arg(p_payload,'cantidad',greatest(tr.en_proceso,1),true);
  if v_q > tr.en_proceso then raise exception 'Solo hay % en proceso (pediste %).', tr.en_proceso, v_q using errcode='42501'; end if;
  -- consumir input en_proceso
  perform public.prod_fn_stock_apply(tr.input_pool, tr.input_sku, 0, 0, -v_q);
  insert into prod_stock_mov(jornada_id,tarea_id,pool,sku,tipo,cantidad,usuario) values(tr.jornada_id,v_id,tr.input_pool,tr.input_sku,'consumir',v_q,auth.uid());
  -- generar output (factor)
  v_out := floor(v_q * tr.factor)::int;
  if v_out > 0 then
    perform public.prod_fn_stock_apply(tr.output_pool, tr.output_sku, v_out, 0, 0);
    insert into prod_stock_mov(jornada_id,tarea_id,pool,sku,tipo,cantidad,usuario) values(tr.jornada_id,v_id,tr.output_pool,tr.output_sku,'producir',v_out,auth.uid());
  end if;
  update prod_tarea set en_proceso=en_proceso-v_q, input_consumido=input_consumido+v_q, output_generado=output_generado+v_out,
    estado = case when (en_proceso-v_q)=0 and reservado=0 then 'finalizada' else 'en_proceso' end where id=v_id;
  return jsonb_build_object('ok',true,'tarea_id',v_id,'input_consumido',v_q,'output_generado',v_out);
end $fn$;

-- ── cancelar_tarea: devuelve reservado y en_proceso a disponible (movimiento compensatorio) ──
create or replace function public.prod_rpc_cancelar_tarea(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_id uuid; tr record;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id=auth.uid();
  if v_role is null or v_active=false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_id := nullif(p_payload->>'tarea_id','')::uuid;
  select * into tr from prod_tarea where id=v_id for update;
  if not found then raise exception 'Tarea inexistente.' using errcode='P0002'; end if;
  if tr.estado in ('finalizada','cancelada') then raise exception 'La tarea ya esta %.', tr.estado using errcode='42501'; end if;
  if tr.reservado>0 then perform public.prod_fn_stock_apply(tr.input_pool,tr.input_sku,tr.reservado,-tr.reservado,0);
    insert into prod_stock_mov(jornada_id,tarea_id,pool,sku,tipo,cantidad,usuario) values(tr.jornada_id,v_id,tr.input_pool,tr.input_sku,'devolver',tr.reservado,auth.uid()); end if;
  if tr.en_proceso>0 then perform public.prod_fn_stock_apply(tr.input_pool,tr.input_sku,tr.en_proceso,0,-tr.en_proceso);
    insert into prod_stock_mov(jornada_id,tarea_id,pool,sku,tipo,cantidad,usuario) values(tr.jornada_id,v_id,tr.input_pool,tr.input_sku,'devolver',tr.en_proceso,auth.uid()); end if;
  update prod_tarea set estado='cancelada', reservado=0, en_proceso=0 where id=v_id;
  return jsonb_build_object('ok',true,'tarea_id',v_id);
end $fn$;

do $$ declare f text; begin
  foreach f in array array['prod_rpc_reservar_jornada(jsonb)','prod_rpc_iniciar_tarea(jsonb)','prod_rpc_finalizar_tarea(jsonb)','prod_rpc_cancelar_tarea(jsonb)'] loop
    execute 'revoke all on function public.'||f||' from public, anon';
    execute 'grant execute on function public.'||f||' to authenticated';
  end loop; end $$;

create or replace view public.prod_v_tareas as
  select t.*, j.fase jornada_fase from public.prod_tarea t join public.prod_jornada j on j.id=t.jornada_id
  where j.fase <> 'cerrada';

-- Config: consumo de MP obligatorio en la carga directa de CNC/Pino (default ON).
insert into public.prod_config(clave,valor) values ('mp_consumo_obligatorio','1') on conflict (clave) do nothing;

-- registrar_corte: consume la materia prima (placa) configurada; bloquea si falta config/stock.
create or replace function public.prod_rpc_registrar_corte(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_jornada uuid; v_est text;
  v_placa text; v_hojas int; v_desp int; v_rend int; v_pieza text; v_gen int; v_id uuid;
  v_mp text; v_oblig boolean; v_mpdisp int;
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
  select rendimiento, pieza_sku, mp_sku into v_rend, v_pieza, v_mp from prod_placa where sku = v_placa;
  if not found then raise exception 'Placa % no existe.', v_placa using errcode='22023'; end if;
  if v_pieza is null then raise exception 'La placa % no tiene pieza asociada.', v_placa using errcode='22023'; end if;
  v_oblig := public.prod_cfg_int('mp_consumo_obligatorio',1) = 1;
  if v_mp is not null then
    perform 1 from prod_stock_mp where mp_sku=v_mp for update;
    v_mpdisp := public.prod_fn_stock_disp('mp', v_mp);
    if v_mpdisp < v_hojas then raise exception 'Stock de placas insuficiente (disp %, requiere % hojas de %).', v_mpdisp, v_hojas, v_mp using errcode='42501'; end if;
    perform public.prod_fn_stock_apply('mp', v_mp, -v_hojas, 0, 0);
    insert into prod_stock_mov(jornada_id,pool,sku,tipo,cantidad,usuario) values (v_jornada,'mp',v_mp,'consumir',v_hojas,auth.uid());
  elsif v_oblig then
    raise exception 'Configuracion incompleta: la placa % no tiene materia prima configurada.', v_placa using errcode='42501';
  end if;
  v_gen := greatest(v_hojas * coalesce(v_rend,0) - v_desp, 0);
  insert into prod_corte (jornada_id, placa_sku, hojas, desperdicio, cargado_por, editable_hasta)
  values (v_jornada, v_placa, v_hojas, v_desp, auth.uid(), now() + interval '24 hours') returning id into v_id;
  insert into prod_stock_pieza (pieza_sku, disponible) values (v_pieza, v_gen)
  on conflict (pieza_sku) do update set disponible = prod_stock_pieza.disponible + v_gen, updated_at = now();
  return jsonb_build_object('ok', true, 'corte_id', v_id, 'piezas_generadas', v_gen);
end $fn$;

-- registrar_pino: consume listones/varillas segun receta; bloquea si falta config/stock.
create or replace function public.prod_rpc_registrar_pino(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_jornada uuid; v_est text;
  v_tamano text; v_term int; v_mas int; v_id uuid; v_disp int; v_masT int;
  v_pr record; v_oblig boolean; v_units int; v_mpdisp int;
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
  v_oblig := public.prod_cfg_int('mp_consumo_obligatorio',1) = 1;
  select * into v_pr from prod_pino_receta where tamano=v_tamano;
  if found then
    v_units := ceil((v_term + v_mas)::numeric / v_pr.patas_por_unidad)::int;
    perform 1 from prod_stock_mp where mp_sku=v_pr.mp_sku for update;
    v_mpdisp := public.prod_fn_stock_disp('mp', v_pr.mp_sku);
    if v_mpdisp < v_units then raise exception 'Stock de materia prima de pino insuficiente (disp %, requiere %).', v_mpdisp, v_units using errcode='42501'; end if;
    perform public.prod_fn_stock_apply('mp', v_pr.mp_sku, -v_units, 0, 0);
    insert into prod_stock_mov(jornada_id,pool,sku,tipo,cantidad,usuario) values (v_jornada,'mp',v_pr.mp_sku,'consumir',v_units,auth.uid());
  elsif v_oblig then
    raise exception 'Configuracion incompleta: no hay receta de materia prima para patas %.', v_tamano using errcode='42501';
  end if;
  insert into prod_pino (jornada_id, tamano, terminadas, masilladas, cargado_por, editable_hasta)
  values (v_jornada, v_tamano, v_term, v_mas, auth.uid(), now() + interval '24 hours') returning id into v_id;
  insert into prod_stock_patas (tamano, disponible, masilladas) values (v_tamano, v_term, v_mas)
  on conflict (tamano) do update set disponible = prod_stock_patas.disponible + v_term,
    masilladas = prod_stock_patas.masilladas + v_mas, updated_at = now()
  returning disponible, masilladas into v_disp, v_masT;
  return jsonb_build_object('ok', true, 'pino_id', v_id, 'stock_patas', jsonb_build_object('tamano', v_tamano, 'disponible', v_disp, 'masilladas', v_masT));
end $fn$;
