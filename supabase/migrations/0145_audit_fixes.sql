-- 0145 (LOCAL): correcciones de la auditoría adversarial sobre 0138-0144. Append-only.
-- Cierra: (A) doble reserva de reservar_jornada con tareas en_proceso; (B) demorado/reprogramado/
-- desconocido/cancelado/archivado que sólo excluía candidatos NUEVOS (ahora baja la demanda de lo ya
-- vinculado y no se le asigna terminado); (C) abrir_jornada saltaba el gate de capacidad; (D) cleanup
-- de reservar sin asiento en el ledger; (E) planificar/ejecutar/pausar sin REVOKE de anon/public;
-- (F) alerta 'reconocida' que no se reactivaba; (G) minimos sin chequeo de rol; (H) CHECK de
-- reservado/en_proceso ausente en pools no-mp; (I) coordinación reserva↔carga directa (libera reserva).

-- ── (H) CHECK reservado/en_proceso >= 0 en pools no-mp (NOT VALID, como 0128) ──
do $$ begin
  if not exists (select 1 from pg_constraint where conname='prod_stock_pieza_res_nn') then
    alter table public.prod_stock_pieza add constraint prod_stock_pieza_res_nn check (reservado>=0) not valid;
    alter table public.prod_stock_pieza add constraint prod_stock_pieza_enp_nn check (en_proceso>=0) not valid; end if;
  if not exists (select 1 from pg_constraint where conname='prod_stock_melamina_res_nn') then
    alter table public.prod_stock_melamina add constraint prod_stock_melamina_res_nn check (reservado>=0) not valid;
    alter table public.prod_stock_melamina add constraint prod_stock_melamina_enp_nn check (en_proceso>=0) not valid; end if;
  if not exists (select 1 from pg_constraint where conname='prod_stock_patas_res_nn') then
    alter table public.prod_stock_patas add constraint prod_stock_patas_res_nn check (reservado>=0) not valid;
    alter table public.prod_stock_patas add constraint prod_stock_patas_enp_nn check (en_proceso>=0) not valid; end if;
  if not exists (select 1 from pg_constraint where conname='prod_stock_terminado_res_nn') then
    alter table public.prod_stock_terminado add constraint prod_stock_terminado_res_nn check (reservado>=0) not valid;
    alter table public.prod_stock_terminado add constraint prod_stock_terminado_enp_nn check (en_proceso>=0) not valid; end if;
  if not exists (select 1 from pg_constraint where conname='prod_insumo_res_nn') then
    alter table public.prod_insumo add constraint prod_insumo_res_nn check (reservado>=0) not valid;
    alter table public.prod_insumo add constraint prod_insumo_enp_nn check (en_proceso>=0) not valid; end if;
end $$;

-- ── (E) REVOKE/GRANT de las 3 RPC de jornada nuevas (0138) que quedaron con EXECUTE a PUBLIC ──
do $$ declare f text; begin
  foreach f in array array['prod_rpc_planificar_jornada(jsonb)','prod_rpc_ejecutar_jornada(jsonb)','prod_rpc_pausar_jornada(jsonb)','prod_rpc_abrir_jornada(jsonb)'] loop
    execute 'revoke all on function public.'||f||' from public, anon';
    execute 'grant execute on function public.'||f||' to authenticated';
  end loop; end $$;

-- ── (B) helper: orden excluida de producción por estado canónico externo ──
create or replace function public.prod_fn_orden_excluida(p_order uuid)
returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $fn$
  select exists (select 1 from public.prod_orden_estado oe where oe.order_id=p_order
    and oe.estado_canonico in ('demorado','reprogramado','desconocido','cancelado','archivado'));
$fn$;
-- usada dentro de la vista security_invoker prod_v_jornada_demanda_neta → authenticated necesita EXECUTE
revoke execute on function public.prod_fn_orden_excluida(uuid) from public, anon;
grant execute on function public.prod_fn_orden_excluida(uuid) to authenticated;

-- (B) demanda neta: baja para órdenes excluidas (demorado/reprogramado/desconocido/cancelado/archivado)
create or replace view public.prod_v_jornada_demanda_neta as
 with aj as (select id from prod_jornada where fase='en_ejecucion' limit 1),
 base as (
   select jo.snapshot_sku as sku,
     greatest(jo.snapshot_cantidad - coalesce((select sum(a.cantidad) from prod_asignacion a where a.order_id=jo.order_id),0::bigint),0::bigint) as pendiente
   from prod_jornada_orden jo
   where jo.jornada_id in (select id from aj)
     and coalesce(jo.snapshot_status,'') <> all (array['cancelada','cumplida'])
     and not public.prod_fn_orden_excluida(jo.order_id)
 )
 select sku, sum(pendiente)::integer as demanda_neta from base group by sku having sum(pendiente) > 0::numeric;

-- (B/candidatos) candidatos excluye TODOS los estados canónicos de exclusión (incl cancelado/archivado)
create or replace function public.prod_fn_candidatos(p_origen jsonb, p_jornada uuid)
returns table(order_id uuid, sku text, channel text, cantidad integer, estado text)
language plpgsql stable security definer set search_path to 'public','pg_temp' as $fn$
declare v_tipo text := coalesce(p_origen->>'tipo',''); v_fecha date; v_piso date := current_date - 90; v_ids uuid[]; v_batch uuid;
begin
  if v_tipo = 'fecha_desde' then
    begin v_fecha := (p_origen->>'fecha')::date; exception when others then
      raise exception 'fecha invalida: use AAAA-MM-DD (recibido: %).', coalesce(p_origen->>'fecha','(vacia)') using errcode='22023'; end;
    if v_fecha is null then raise exception 'fecha requerida para el scope fecha_desde.' using errcode='22023'; end if;
    if v_fecha < v_piso then raise exception 'La fecha % supera el piso de 90 dias (%). Para incorporar ventas anteriores usa la seleccion explicita por pedido o por lote de importacion.', v_fecha, v_piso using errcode='22023'; end if;
  elsif v_tipo = 'order_ids' then
    begin select array_agg(v::uuid) into v_ids from jsonb_array_elements_text(coalesce(p_origen->'ids','[]'::jsonb)) v;
    exception when others then raise exception 'ids invalidos: se espera un array de UUID.' using errcode='22023'; end;
  elsif v_tipo = 'import_batch' then
    begin v_batch := (p_origen->>'import_batch_id')::uuid; exception when others then
      raise exception 'import_batch_id invalido (UUID requerido).' using errcode='22023'; end;
  end if;
  return query
  select o.id, o.sku, o.channel_id::text, o.cantidad, o.status::text
  from public.orders o
  where o.status::text in ('pendiente','arrastrado') and o.cancelled_at is null
    and (o.cantidad - public.prod_fn_asignado(o.id)) > 0
    and not public.prod_fn_orden_excluida(o.id)
    and case v_tipo
          when 'import_batch' then o.import_batch_id = v_batch
          when 'fecha_desde'  then o.created_at::date >= v_fecha
          when 'order_ids'    then o.id = any(coalesce(v_ids, '{}'::uuid[]))
          when 'arrastre'     then exists (select 1 from public.prod_jornada_orden jo join public.prod_jornada j on j.id=jo.jornada_id where jo.order_id=o.id and j.estado='cerrada')
          else false end
    and not exists (select 1 from public.prod_jornada_orden jo join public.prod_jornada j on j.id=jo.jornada_id
      where jo.order_id=o.id and j.estado='abierta' and jo.jornada_id <> coalesce(p_jornada,'00000000-0000-0000-0000-000000000000'::uuid));
end $fn$;
revoke execute on function public.prod_fn_candidatos(jsonb, uuid) from public, anon, authenticated;

-- (B/autoasignar) no asignar terminado libre a órdenes excluidas
create or replace function public.prod_fn_autoasignar_jornada(p_jornada uuid, p_origen text)
returns integer language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare s record; o record; v_libre int; v_need int; v_take int; v_total int := 0;
begin
  for s in (select distinct snapshot_sku sku from public.prod_jornada_orden
            where jornada_id=p_jornada and coalesce(snapshot_status,'') not in ('cancelada','cumplida')) loop
    perform pg_advisory_xact_lock(hashtext('prod_term:'||s.sku));
    for o in (select jo.order_id, jo.snapshot_cantidad
              from public.prod_jornada_orden jo join public.orders ord on ord.id=jo.order_id
              where jo.jornada_id=p_jornada and jo.snapshot_sku=s.sku
                and coalesce(jo.snapshot_status,'') not in ('cancelada','cumplida')
                and ord.cancelled_at is null and ord.status::text in ('pendiente','arrastrado')
                and not public.prod_fn_orden_excluida(jo.order_id)
              order by ord.created_at asc, public.prod_fn_natkey(ord.order_number) asc, jo.order_id) loop
      select coalesce(disponible,0) into v_libre from public.prod_stock_terminado where producto_sku=s.sku;
      exit when coalesce(v_libre,0) <= 0;
      v_need := greatest(o.snapshot_cantidad - public.prod_fn_asignado(o.order_id, s.sku), 0);
      v_take := least(v_need, v_libre);
      if v_take > 0 then
        insert into public.prod_asignacion(order_id,producto_sku,jornada_id,cantidad,tipo,origen,usuario)
          values (o.order_id, s.sku, p_jornada, v_take, 'asignada', coalesce(p_origen,'auto'), auth.uid());
        update public.prod_stock_terminado set disponible = disponible - v_take, updated_at=now() where producto_sku=s.sku;
        v_total := v_total + v_take;
      end if;
    end loop;
  end loop;
  return v_total;
end $fn$;
revoke execute on function public.prod_fn_autoasignar_jornada(uuid, text) from public, anon, authenticated;

-- ── (F) recalc mínimos: reactivar 'reconocida'→'activa' si el faltante EMPEORA ──
create or replace function public.prod_fn_recalc_minimos()
returns int language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare mi record; v_disp int; v_niv text; v_row record; n int:=0;
begin
  for mi in (select pool, sku, minimo from prod_minimo where minimo > 0) loop
    v_disp := public.prod_fn_stock_disp(mi.pool, mi.sku);
    if v_disp < mi.minimo then
      v_niv := case when v_disp::numeric < mi.minimo::numeric/2 then 'critico' else 'bajo' end;
      select id, estado, nivel, disponible into v_row from prod_alerta_stock where pool=mi.pool and sku=mi.sku and estado <> 'resuelta' limit 1;
      if v_row.id is not null then
        update prod_alerta_stock set nivel=v_niv, disponible=v_disp, minimo=mi.minimo,
          -- reactivar si estaba 'reconocida' y el faltante empeoró (subió de nivel o bajó el disponible)
          estado = case when v_row.estado='reconocida' and (v_disp < v_row.disponible or (v_niv='critico' and v_row.nivel<>'critico')) then 'activa' else v_row.estado end,
          updated_at=now() where id=v_row.id;
      else
        insert into prod_alerta_stock(pool,sku,nivel,disponible,minimo) values(mi.pool,mi.sku,v_niv,v_disp,mi.minimo);
        n := n+1;
      end if;
    else
      update prod_alerta_stock set estado='resuelta', updated_at=now() where pool=mi.pool and sku=mi.sku and estado <> 'resuelta';
    end if;
  end loop;
  return n;
end $fn$;
revoke execute on function public.prod_fn_recalc_minimos() from public, anon, authenticated;

-- ── (G) minimos: chequeo de rol (owner/admin/encargado) como sus hermanas ──
create or replace function public.prod_rpc_minimos(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id=auth.uid();
  if v_role is null or v_active=false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  perform public.prod_fn_recalc_minimos();
  return jsonb_build_object('ok',true,
    'alertas', coalesce((select jsonb_agg(jsonb_build_object('id',id,'pool',pool,'sku',sku,'nivel',nivel,'disponible',disponible,'minimo',minimo,'estado',estado) order by nivel desc, pool, sku)
                         from prod_alerta_stock where estado <> 'resuelta'),'[]'::jsonb),
    'configurados', (select count(*) from prod_minimo where minimo>0));
end $fn$;
revoke all on function public.prod_rpc_minimos(jsonb) from public, anon;
grant execute on function public.prod_rpc_minimos(jsonb) to authenticated;

-- ── (A/D) reservar_jornada: idempotente (descuenta trabajo EN PROCESO en vuelo) + asiento en el ledger ──
create or replace function public.prod_rpc_reservar_jornada(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_j uuid; o record; v_placa record; v_hojas int; v_res int; v_disp int;
  v_creadas int:=0; v_incompletas int:=0; v_reservado_total int:=0; v_tam text; v_pr record; v_units int; v_enp int;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id=auth.uid();
  if v_role is null or v_active=false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_j := coalesce(nullif(p_payload->>'jornada_id','')::uuid, public.prod_fn_jornada_activa());
  if v_j is null then raise exception 'No hay jornada en ejecucion.' using errcode='P0002'; end if;
  for o in (select * from prod_tarea where jornada_id=v_j and estado in ('planificada','reservada')) loop
    if o.reservado>0 then
      perform public.prod_fn_stock_apply(o.input_pool,o.input_sku,o.reservado,-o.reservado,0);
      insert into prod_stock_mov(jornada_id,tarea_id,pool,sku,tipo,cantidad,motivo,usuario)
        values(v_j,o.id,o.input_pool,o.input_sku,'liberar',o.reservado,'recalculo reservar_jornada',auth.uid());
    end if;
    delete from prod_tarea where id=o.id;
  end loop;
  for o in (select sku, cantidad::int cant from prod_v_orden_sector where sector='cnc' and cantidad>0) loop
    select p.sku, p.rendimiento, p.mp_sku into v_placa from prod_placa p where p.pieza_sku=o.sku and p.combinada=false order by p.rendimiento desc limit 1;
    if not found or v_placa.rendimiento is null or v_placa.rendimiento=0 then
      insert into prod_tarea(jornada_id,sector,input_pool,input_sku,output_pool,output_sku,factor,input_plan,estado,nota)
        values(v_j,'cnc','mp',coalesce(v_placa.sku,'?'),'pieza',o.sku,1,0,'config_incompleta','sin placa/rendimiento para '||o.sku);
      v_incompletas:=v_incompletas+1; continue; end if;
    v_hojas := ceil(o.cant::numeric / v_placa.rendimiento)::int;
    select coalesce(sum(reservado+en_proceso),0) into v_enp from prod_tarea where jornada_id=v_j and sector='cnc' and output_sku=o.sku and estado='en_proceso';
    v_hojas := greatest(v_hojas - v_enp, 0);
    if v_hojas=0 then continue; end if;
    if v_placa.mp_sku is null then
      insert into prod_tarea(jornada_id,sector,input_pool,input_sku,output_pool,output_sku,factor,input_plan,estado,nota)
        values(v_j,'cnc','mp',v_placa.sku,'pieza',o.sku,v_placa.rendimiento,v_hojas,'config_incompleta','placa '||v_placa.sku||' sin materia prima configurada');
      v_incompletas:=v_incompletas+1; continue; end if;
    v_disp := public.prod_fn_stock_disp('mp',v_placa.mp_sku); v_res := least(v_hojas, v_disp);
    insert into prod_tarea(jornada_id,sector,input_pool,input_sku,output_pool,output_sku,factor,input_plan,reservado,estado)
      values(v_j,'cnc','mp',v_placa.mp_sku,'pieza',o.sku,v_placa.rendimiento,v_hojas,v_res, case when v_res>0 then 'reservada' else 'planificada' end);
    if v_res>0 then perform public.prod_fn_stock_apply('mp',v_placa.mp_sku,-v_res,v_res,0);
      insert into prod_stock_mov(jornada_id,pool,sku,tipo,cantidad,usuario) values(v_j,'mp',v_placa.mp_sku,'reservar',v_res,auth.uid());
      v_reservado_total:=v_reservado_total+v_res; end if;
    v_creadas:=v_creadas+1;
  end loop;
  for o in (select sku, cantidad::int cant from prod_v_orden_sector where sector='melamina' and cantidad>0) loop
    select coalesce(sum(reservado+en_proceso),0) into v_enp from prod_tarea where jornada_id=v_j and sector='melamina' and output_sku=o.sku and estado='en_proceso';
    v_units := greatest(o.cant - v_enp, 0);
    if v_units=0 then continue; end if;
    v_disp := public.prod_fn_stock_disp('pieza',o.sku); v_res := least(v_units, v_disp);
    insert into prod_tarea(jornada_id,sector,input_pool,input_sku,output_pool,output_sku,factor,input_plan,reservado,estado)
      values(v_j,'melamina','pieza',o.sku,'melamina',o.sku,1,v_units,v_res, case when v_res>0 then 'reservada' else 'planificada' end);
    if v_res>0 then perform public.prod_fn_stock_apply('pieza',o.sku,-v_res,v_res,0);
      insert into prod_stock_mov(jornada_id,pool,sku,tipo,cantidad,usuario) values(v_j,'pieza',o.sku,'reservar',v_res,auth.uid());
      v_reservado_total:=v_reservado_total+v_res; end if;
    v_creadas:=v_creadas+1;
  end loop;
  for o in (select sku, cantidad::int cant from prod_v_orden_sector where sector='pino' and cantidad>0) loop
    select tamano into v_tam from prod_pata_tamano where pieza_sku=o.sku;
    select * into v_pr from prod_pino_receta where tamano=v_tam;
    if v_tam is null or not found then
      insert into prod_tarea(jornada_id,sector,input_pool,input_sku,output_pool,output_sku,factor,input_plan,estado,nota)
        values(v_j,'pino','mp','?','patas',coalesce(v_tam,o.sku),1,0,'config_incompleta','sin receta de pino para '||o.sku);
      v_incompletas:=v_incompletas+1; continue; end if;
    v_units := ceil(o.cant::numeric / v_pr.patas_por_unidad)::int;
    select coalesce(sum(reservado+en_proceso),0) into v_enp from prod_tarea where jornada_id=v_j and sector='pino' and output_sku=v_tam and estado='en_proceso';
    v_units := greatest(v_units - v_enp, 0);
    if v_units=0 then continue; end if;
    v_disp := public.prod_fn_stock_disp('mp',v_pr.mp_sku); v_res := least(v_units, v_disp);
    insert into prod_tarea(jornada_id,sector,input_pool,input_sku,output_pool,output_sku,factor,input_plan,reservado,estado)
      values(v_j,'pino','mp',v_pr.mp_sku,'patas',v_tam,v_pr.patas_por_unidad,v_units,v_res, case when v_res>0 then 'reservada' else 'planificada' end);
    if v_res>0 then perform public.prod_fn_stock_apply('mp',v_pr.mp_sku,-v_res,v_res,0);
      insert into prod_stock_mov(jornada_id,pool,sku,tipo,cantidad,usuario) values(v_j,'mp',v_pr.mp_sku,'reservar',v_res,auth.uid());
      v_reservado_total:=v_reservado_total+v_res; end if;
    v_creadas:=v_creadas+1;
  end loop;
  return jsonb_build_object('ok',true,'jornada_id',v_j,'tareas_creadas',v_creadas,'config_incompletas',v_incompletas,'input_reservado',v_reservado_total);
end $fn$;
revoke all on function public.prod_rpc_reservar_jornada(jsonb) from public, anon;
grant execute on function public.prod_rpc_reservar_jornada(jsonb) to authenticated;

-- ── (C) abrir_jornada con GATE de capacidad al pasar a en_ejecucion (mismo control que ejecutar) ──
create or replace function public.prod_rpc_abrir_jornada(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_id uuid; v_fecha date; v_cap jsonb; v_motivo text;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtext('prod_abrir_jornada'));
  select id, fecha into v_id, v_fecha from prod_jornada where fase='en_ejecucion' limit 1;
  if found then return jsonb_build_object('ok',true,'jornada_id',v_id,'fecha',v_fecha,'retomada',true); end if;
  select id, fecha into v_id, v_fecha from prod_jornada where fase in ('pausada','planificada') order by fecha desc limit 1;
  if not found then
    insert into prod_jornada (fecha, estado, fase, abierta_por, abierta_at)
      values (current_date, 'abierta', 'planificada', auth.uid(), now())
    on conflict (fecha) do update set estado='abierta',
      fase=case when prod_jornada.fase='cerrada' then 'planificada' else prod_jornada.fase end, cerrada_at=null
    returning id, fecha into v_id, v_fecha;
  end if;
  v_cap := public.prod_fn_capacidad_jornada(v_id);
  if (v_cap->>'calculable')::boolean is false then
    v_motivo := nullif(trim(p_payload->>'override_motivo'),'');
    if v_motivo is null then
      raise exception 'Capacidad incompleta/no calculable (SKUs sin equivalencia a sets: %). Complete sets_equiv o abra con override_motivo.', coalesce(v_cap->>'skus_sin_equiv','?') using errcode='42501';
    end if;
    insert into prod_capacidad_override(jornada_id,usuario,motivo) values (v_id, auth.uid(), v_motivo);
  end if;
  update prod_jornada set fase='en_ejecucion', estado='abierta' where id=v_id;
  return jsonb_build_object('ok',true,'jornada_id',v_id,'fecha',v_fecha,'retomada',(v_fecha<>current_date),'capacidad',v_cap);
end $fn$;
revoke all on function public.prod_rpc_abrir_jornada(jsonb) from public, anon;
grant execute on function public.prod_rpc_abrir_jornada(jsonb) to authenticated;

-- ── (B) registrar_embalaje: NO asignar producto terminado a órdenes excluidas (demorado/reprogramado/etc.) ──
create or replace function public.prod_rpc_registrar_embalaje(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
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
                and not public.prod_fn_orden_excluida(jo.order_id)
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
end $fn$;

-- ── FIX inicio/fin PARCIAL: prod_fn_int_arg(payload,key,MIN,required,DEFAULT). 0140 pasaba el
-- reservado/en_proceso como MIN (rompía el inicio parcial). Correcto: min=1, default=todo lo disponible. ──
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
  v_q := public.prod_fn_int_arg(p_payload,'cantidad',1,false,greatest(tr.reservado,1));
  if v_q > tr.reservado then raise exception 'Solo hay % reservado (pediste %).', tr.reservado, v_q using errcode='42501'; end if;
  perform public.prod_fn_stock_apply(tr.input_pool, tr.input_sku, 0, -v_q, v_q);
  update prod_tarea set reservado=reservado-v_q, en_proceso=en_proceso+v_q, estado='en_proceso' where id=v_id;
  insert into prod_stock_mov(jornada_id,tarea_id,pool,sku,tipo,cantidad,usuario) values(tr.jornada_id,v_id,tr.input_pool,tr.input_sku,'iniciar',v_q,auth.uid());
  return jsonb_build_object('ok',true,'tarea_id',v_id,'en_proceso',tr.en_proceso+v_q,'reservado_restante',tr.reservado-v_q);
end $fn$;
create or replace function public.prod_rpc_finalizar_tarea(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_id uuid; v_q int; tr record; v_out int;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id=auth.uid();
  if v_role is null or v_active=false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  v_id := nullif(p_payload->>'tarea_id','')::uuid;
  if v_id is null then raise exception 'tarea_id requerido.' using errcode='22023'; end if;
  select * into tr from prod_tarea where id=v_id for update;
  if not found then raise exception 'Tarea inexistente.' using errcode='P0002'; end if;
  if v_role not in ('owner','admin','encargado', tr.sector::role_enum) then raise exception 'Sin permiso para el sector %.', tr.sector using errcode='42501'; end if;
  v_q := public.prod_fn_int_arg(p_payload,'cantidad',1,false,greatest(tr.en_proceso,1));
  if v_q > tr.en_proceso then raise exception 'Solo hay % en proceso (pediste %).', tr.en_proceso, v_q using errcode='42501'; end if;
  perform public.prod_fn_stock_apply(tr.input_pool, tr.input_sku, 0, 0, -v_q);
  insert into prod_stock_mov(jornada_id,tarea_id,pool,sku,tipo,cantidad,usuario) values(tr.jornada_id,v_id,tr.input_pool,tr.input_sku,'consumir',v_q,auth.uid());
  v_out := floor(v_q * tr.factor)::int;
  if v_out > 0 then
    perform public.prod_fn_stock_apply(tr.output_pool, tr.output_sku, v_out, 0, 0);
    insert into prod_stock_mov(jornada_id,tarea_id,pool,sku,tipo,cantidad,usuario) values(tr.jornada_id,v_id,tr.output_pool,tr.output_sku,'producir',v_out,auth.uid());
  end if;
  update prod_tarea set en_proceso=en_proceso-v_q, input_consumido=input_consumido+v_q, output_generado=output_generado+v_out,
    estado = case when (en_proceso-v_q)=0 and reservado=0 then 'finalizada' else 'en_proceso' end where id=v_id;
  return jsonb_build_object('ok',true,'tarea_id',v_id,'input_consumido',v_q,'output_generado',v_out);
end $fn$;
do $$ declare f text; begin
  foreach f in array array['prod_rpc_iniciar_tarea(jsonb)','prod_rpc_finalizar_tarea(jsonb)'] loop
    execute 'revoke all on function public.'||f||' from public, anon';
    execute 'grant execute on function public.'||f||' to authenticated';
  end loop; end $$;
