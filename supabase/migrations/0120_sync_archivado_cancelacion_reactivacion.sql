-- 0120 · FIX auditoría — semántica correcta de 'archivado', cancelación/reactivación cross-jornada,
-- validación de jornada en el sync. Aditiva. NO toca datos legacy.
-- (Aplicada en remoto vía MCP el 2026-07-21 durante la corrección integral pre-push. SIN commitear aún.)

-- (1) Ampliar acciones del log de auditoría
alter table public.prod_jornada_orden_log drop constraint if exists prod_jornada_orden_log_accion_check;
alter table public.prod_jornada_orden_log add constraint prod_jornada_orden_log_accion_check
  check (accion in ('vinculada','actualizada','cancelada','cumplida','anomalia','reactivada'));

-- (2) Demanda operativa: excluir canceladas Y cumplidas (archivadas/despachadas)
create or replace view public.prod_v_jornada_demanda_neta as
with aj as (select id from public.prod_jornada where estado='abierta' order by fecha desc limit 1),
base as (
  select jo.snapshot_sku as sku,
    greatest(jo.snapshot_cantidad - coalesce((select sum(a.cantidad) from public.prod_asignacion a where a.order_id=jo.order_id),0), 0) as pendiente
  from public.prod_jornada_orden jo
  where jo.jornada_id in (select id from aj) and coalesce(jo.snapshot_status,'') not in ('cancelada','cumplida'))
select sku, sum(pendiente)::integer as demanda_neta from base group by sku having sum(pendiente) > 0;

-- (3) Sync con reglas correctas
create or replace function public.prod_rpc_jornada_sync(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_role role_enum; v_active boolean; v_j uuid; v_est text; v_origen jsonb; v_origen_txt text;
  v_new int:=0; v_upd int:=0; v_can int:=0; v_cum int:=0; v_react int:=0; v_anom int:=0; v_lib int:=0; v_asig int;
  r record; v_asignado int; v_exceso int;
begin
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_j := nullif(p_payload->>'jornada_id','')::uuid;
  if v_j is null then select id into v_j from prod_jornada where estado='abierta' order by fecha desc limit 1; end if;
  -- VALIDACIÓN: jornada existe y está abierta (cero mutaciones si no)
  select estado into v_est from prod_jornada where id = v_j;
  if v_j is null or v_est is null then raise exception 'Jornada inexistente.' using errcode='P0002'; end if;
  if v_est <> 'abierta' then raise exception 'La jornada no esta abierta (%).', v_est using errcode='42501'; end if;
  v_origen := coalesce(p_payload->'origen','{}'::jsonb);
  v_origen_txt := 'sync:'||coalesce(v_origen->>'tipo','manual');

  -- (A) REACTIVACIÓN: pedido antes incorporado+cancelado que hoy vuelve a activo → re-incorporar a la jornada ABIERTA.
  --     Conserva asignaciones (son globales por order_id). No trae las 506 legacy (nunca estuvieron en prod_jornada_orden).
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

  -- (B) CANCELACIÓN GLOBAL (incl. jornadas cerradas): pedido con cancelled_at y asignado no liberado → liberar 1 sola vez.
  for r in
    select jo.jornada_id, jo.order_id, jo.snapshot_sku, jo.snapshot_cantidad, jo.snapshot_status
    from prod_jornada_orden jo join orders o on o.id=jo.order_id
    where coalesce(jo.snapshot_status,'') not in ('cancelada','cumplida') and o.cancelled_at is not null
  loop
    perform pg_advisory_xact_lock(hashtext('prod_term:'||r.snapshot_sku));
    v_asignado := prod_fn_asignado(r.order_id);
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

  -- (C) ARCHIVADO = cumplido/despachado (sin cancelled_at): NO liberar; marcar 'cumplida'; anomalía si quedó pendiente.
  for r in
    select jo.jornada_id, jo.order_id, jo.snapshot_sku, jo.snapshot_cantidad, jo.snapshot_status
    from prod_jornada_orden jo join orders o on o.id=jo.order_id
    where coalesce(jo.snapshot_status,'') not in ('cancelada','cumplida') and o.cancelled_at is null and o.status::text='archivado'
  loop
    v_asignado := prod_fn_asignado(r.order_id);
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

  -- (D) CAMBIOS DE CANTIDAD en la jornada abierta (activas): reducir por debajo de lo asignado libera el exceso.
  for r in
    select jo.order_id, jo.snapshot_sku, jo.snapshot_cantidad, jo.snapshot_status, o.cantidad cant_actual, o.status::text estado_actual
    from prod_jornada_orden jo join orders o on o.id=jo.order_id
    where jo.jornada_id=v_j and coalesce(jo.snapshot_status,'') not in ('cancelada','cumplida')
      and o.cancelled_at is null and o.status::text in ('pendiente','arrastrado')
      and o.cantidad is distinct from jo.snapshot_cantidad
  loop
    perform pg_advisory_xact_lock(hashtext('prod_term:'||r.snapshot_sku));
    v_asignado := prod_fn_asignado(r.order_id);
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
end $function$;
revoke execute on function public.prod_rpc_jornada_sync(jsonb) from public, anon;
grant execute on function public.prod_rpc_jornada_sync(jsonb) to authenticated;
