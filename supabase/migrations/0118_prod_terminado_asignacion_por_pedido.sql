-- 0118 · Ciclo de vida correcto de prod_stock_terminado (aditiva sobre 0117; NO reescribe 0117).
-- (Aplicada en remoto vía MCP el 2026-07-21 en pasos 0118 + 0118b + 0118c; este archivo consolida el ESTADO FINAL.)
-- terminado.disponible = unidades físicas terminadas LIBRES (no asignadas). Asignación por order_id en
-- prod_asignacion (ledger, nunca se borra). Embalaje asigna FIFO por antigüedad del pedido; excedente → libre.
-- Vincular/sync/arrastre auto-asignan libre antes de producir. Demanda por pedido = snapshot − asignado(pedido).
-- Lock por SKU + idempotencia por request_id. Single-tenant (lock por SKU). NO toca Carrier/despacho/legacy.

create table if not exists public.prod_asignacion (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null, producto_sku text not null, jornada_id uuid,
  cantidad integer not null,                       -- + asignada, − liberada
  tipo text not null check (tipo in ('asignada','liberada')),
  origen text, motivo text, request_id text, usuario uuid,
  created_at timestamptz not null default now());
create index if not exists ix_prod_asignacion_order on public.prod_asignacion(order_id);
create index if not exists ix_prod_asignacion_sku on public.prod_asignacion(producto_sku);
alter table public.prod_asignacion enable row level security;
drop policy if exists prod_asignacion_sel on public.prod_asignacion;
create policy prod_asignacion_sel on public.prod_asignacion for select using (
  exists (select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('owner','admin','encargado')));

create table if not exists public.prod_idempotencia (
  request_id text primary key, rpc text, resultado jsonb, created_at timestamptz not null default now());
alter table public.prod_idempotencia enable row level security;

create or replace function public.prod_fn_asignado(p_order uuid)
returns integer language sql stable security definer set search_path to 'public','pg_temp' as $function$
  select coalesce(sum(cantidad),0)::int from public.prod_asignacion where order_id = p_order;
$function$;

-- Auto-asignar stock LIBRE a los pedidos de la jornada (FIFO por antigüedad del pedido), lock por SKU.
create or replace function public.prod_fn_autoasignar_jornada(p_jornada uuid, p_origen text)
returns integer language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare s record; o record; v_libre int; v_need int; v_take int; v_total int := 0;
begin
  for s in (select distinct snapshot_sku sku from public.prod_jornada_orden
            where jornada_id=p_jornada and coalesce(snapshot_status,'')<>'cancelada') loop
    perform pg_advisory_xact_lock(hashtext('prod_term:'||s.sku));
    for o in (select jo.order_id, jo.snapshot_cantidad
              from public.prod_jornada_orden jo join public.orders ord on ord.id=jo.order_id
              where jo.jornada_id=p_jornada and jo.snapshot_sku=s.sku and coalesce(jo.snapshot_status,'')<>'cancelada'
              order by ord.created_at asc, ord.order_number asc, jo.order_id) loop
      select coalesce(disponible,0) into v_libre from public.prod_stock_terminado where producto_sku=s.sku;
      exit when coalesce(v_libre,0) <= 0;
      v_need := greatest(o.snapshot_cantidad - public.prod_fn_asignado(o.order_id), 0);
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
end $function$;

-- Demanda NETA POR PEDIDO (sin descontar terminado global).
create or replace view public.prod_v_jornada_demanda_neta as
with aj as (select id from public.prod_jornada where estado='abierta' order by fecha desc limit 1),
base as (
  select jo.snapshot_sku as sku,
    greatest(jo.snapshot_cantidad - coalesce((select sum(a.cantidad) from public.prod_asignacion a where a.order_id=jo.order_id),0), 0) as pendiente
  from public.prod_jornada_orden jo
  where jo.jornada_id in (select id from aj) and coalesce(jo.snapshot_status,'')<>'cancelada')
select sku, sum(pendiente)::integer as demanda_neta from base group by sku having sum(pendiente) > 0;

-- Candidatos: excluir pedidos ya cubiertos (cantidad − asignado = 0).
create or replace function public.prod_fn_candidatos(p_origen jsonb, p_jornada uuid)
returns table(order_id uuid, sku text, channel text, cantidad integer, estado text)
language sql stable security definer set search_path to 'public','pg_temp' as $function$
  select o.id, o.sku, o.channel_id::text, o.cantidad, o.status::text
  from public.orders o
  where o.status::text in ('pendiente','arrastrado') and o.cancelled_at is null
    and (o.cantidad - public.prod_fn_asignado(o.id)) > 0
    and case coalesce(p_origen->>'tipo','')
          when 'import_batch' then o.import_batch_id::text = (p_origen->>'import_batch_id')
          when 'fecha_desde'  then o.created_at::date >= (p_origen->>'fecha')::date
          when 'order_ids'    then o.id in (select (v)::uuid from jsonb_array_elements_text(coalesce(p_origen->'ids','[]'::jsonb)) v)
          when 'arrastre'     then exists (select 1 from public.prod_jornada_orden jo join public.prod_jornada j on j.id=jo.jornada_id where jo.order_id=o.id and j.estado='cerrada')
          else false end
    and not exists (select 1 from public.prod_jornada_orden jo join public.prod_jornada j on j.id=jo.jornada_id
      where jo.order_id=o.id and j.estado='abierta' and jo.jornada_id <> coalesce(p_jornada,'00000000-0000-0000-0000-000000000000'::uuid));
$function$;

-- Embalaje: consume igual; ASIGNA FIFO (por antigüedad del pedido) y solo el excedente va a libre. Lock + idempotencia.
create or replace function public.prod_rpc_registrar_embalaje(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_role role_enum; v_active boolean; v_jornada uuid; v_prod text; v_unid int; v_canal text; v_desconocidas text;
  v_id uuid; v_reqid text; v_prev jsonb; v_rest int; v_take int; v_libre int; v_o record; res jsonb;
begin
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('embalaje','encargado','owner','admin') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_jornada := nullif(p_payload->>'jornada_id','')::uuid;
  if v_jornada is null then select id into v_jornada from prod_jornada where fecha=current_date and estado='abierta'; end if;
  if v_jornada is null then raise exception 'No hay jornada abierta.' using errcode='P0002'; end if;
  v_prod := p_payload->>'producto_sku';
  v_unid := coalesce((p_payload->>'unidades')::int, 0);
  v_canal := nullif(trim(p_payload->>'canal'),'');
  if v_unid <= 0 then raise exception 'unidades debe ser > 0.' using errcode='22023'; end if;
  if not exists (select 1 from prod_producto where sku=v_prod) then raise exception 'Producto % no existe.', v_prod using errcode='22023'; end if;
  v_reqid := nullif(p_payload->>'request_id','');
  if v_reqid is not null then select resultado into v_prev from prod_idempotencia where request_id=v_reqid; if found then return v_prev; end if; end if;
  perform pg_advisory_xact_lock(hashtext('prod_term:'||v_prod));

  with recursive bom as (select hijo_sku sku from prod_componente where padre_sku=v_prod
    union all select c.hijo_sku from bom b join prod_componente c on c.padre_sku=b.sku)
  select string_agg(distinct x.sku, ', ') into v_desconocidas from (select distinct sku from bom) x
  where not exists (select 1 from prod_componente c where c.padre_sku=x.sku) and public.prod_pieza_pool(x.sku)='desconocido';
  if v_desconocidas is not null then raise exception 'Configuracion incompleta: componentes sin pool (%).', v_desconocidas using errcode='42501'; end if;

  drop table if exists _patas_req;
  create temp table _patas_req on commit drop as
    with recursive bom as (select hijo_sku sku, cantidad::numeric qty from prod_componente where padre_sku=v_prod
      union all select c.hijo_sku, b.qty*c.cantidad from bom b join prod_componente c on c.padre_sku=b.sku)
    select t.tamano, (sum(b.qty)*v_unid)::int need from bom b join prod_pata_tamano t on t.pieza_sku=b.sku group by t.tamano;

  if exists (select 1 from prod_receta r left join prod_stock_melamina sm on sm.pieza_sku=r.pieza_sku
    where r.producto_sku=v_prod and public.prod_pieza_pool(r.pieza_sku)='melamina' and coalesce(sm.disponible,0) < v_unid*r.cantidad)
    then raise exception 'Stock de melamina insuficiente para la receta.' using errcode='42501'; end if;
  if exists (select 1 from _patas_req r left join prod_stock_patas sp on sp.tamano=r.tamano where coalesce(sp.disponible,0) < r.need)
    then raise exception 'Stock de patas insuficiente para la receta.' using errcode='42501'; end if;

  insert into prod_embalaje (jornada_id, producto_sku, unidades, canal, cargado_por)
    values (v_jornada, v_prod, v_unid, v_canal, auth.uid()) returning id into v_id;
  update prod_stock_melamina sm set disponible = sm.disponible - (v_unid*r.cantidad), updated_at=now()
    from prod_receta r where r.producto_sku=v_prod and sm.pieza_sku=r.pieza_sku and public.prod_pieza_pool(r.pieza_sku)='melamina';
  update prod_stock_patas sp set disponible = sp.disponible - r.need, updated_at=now() from _patas_req r where sp.tamano=r.tamano;

  v_rest := v_unid;
  for v_o in (select jo.order_id, jo.snapshot_cantidad,
                greatest(jo.snapshot_cantidad - public.prod_fn_asignado(jo.order_id),0) as pendiente
              from prod_jornada_orden jo join orders ord on ord.id=jo.order_id
              where jo.jornada_id=v_jornada and jo.snapshot_sku=v_prod and coalesce(jo.snapshot_status,'')<>'cancelada'
              order by ord.created_at asc, ord.order_number asc, jo.order_id) loop
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
  if v_reqid is not null then insert into prod_idempotencia(request_id,rpc,resultado)
    values (v_reqid,'registrar_embalaje',res) on conflict (request_id) do nothing; end if;
  return res;
end $function$;
grant execute on function public.prod_rpc_registrar_embalaje(jsonb) to authenticated;

-- Confirmar: tras vincular, auto-asignar stock libre.
create or replace function public.prod_rpc_vincular_confirmar(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_role role_enum; v_active boolean; v_j uuid; v_origen jsonb; v_estado text; v_new int; v_origen_txt text; v_asig int;
begin
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
end $function$;
grant execute on function public.prod_rpc_vincular_confirmar(jsonb) to authenticated;

-- Sync: liberar al bajar/cancelar (devuelve unidades a libre) + auto-asignar. Nunca borra movimientos.
create or replace function public.prod_rpc_jornada_sync(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_role role_enum; v_active boolean; v_j uuid; v_origen jsonb; v_origen_txt text;
  v_new int:=0; v_upd int:=0; v_can int:=0; v_lib int:=0; v_asig int; r record; v_asignado int; v_exceso int;
begin
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_j := nullif(p_payload->>'jornada_id','')::uuid;
  if v_j is null then select id into v_j from prod_jornada where estado='abierta' order by fecha desc limit 1; end if;
  if v_j is null then raise exception 'No hay jornada abierta.' using errcode='P0002'; end if;
  v_origen := coalesce(p_payload->'origen','{}'::jsonb);
  v_origen_txt := 'sync:'||coalesce(v_origen->>'tipo','manual');
  for r in select jo.order_id, jo.snapshot_sku, jo.snapshot_cantidad, jo.snapshot_status,
           o.cantidad as cant_actual, o.status::text as estado_actual, o.cancelled_at
    from prod_jornada_orden jo join orders o on o.id=jo.order_id
    where jo.jornada_id=v_j and coalesce(jo.snapshot_status,'')<>'cancelada'
  loop
    perform pg_advisory_xact_lock(hashtext('prod_term:'||r.snapshot_sku));
    v_asignado := prod_fn_asignado(r.order_id);
    if r.cancelled_at is not null or r.estado_actual not in ('pendiente','arrastrado') then
      if v_asignado > 0 then
        insert into prod_asignacion(order_id,producto_sku,jornada_id,cantidad,tipo,origen,motivo,usuario)
          values (r.order_id,r.snapshot_sku,v_j,-v_asignado,'liberada',v_origen_txt,'cancelacion',auth.uid());
        insert into prod_stock_terminado(producto_sku,disponible) values(r.snapshot_sku,v_asignado)
          on conflict (producto_sku) do update set disponible=prod_stock_terminado.disponible+v_asignado, updated_at=now();
        v_lib := v_lib + v_asignado;
      end if;
      update prod_jornada_orden set snapshot_status='cancelada' where jornada_id=v_j and order_id=r.order_id;
      insert into prod_jornada_orden_log(jornada_id,order_id,accion,cantidad_anterior,cantidad_nueva,estado_anterior,estado_nuevo,origen,usuario)
        values (v_j,r.order_id,'cancelada',r.snapshot_cantidad,0,r.snapshot_status,'cancelada',v_origen_txt,auth.uid());
      v_can := v_can+1;
    elsif r.cant_actual is distinct from r.snapshot_cantidad then
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
    end if;
  end loop;
  with cand as (select * from prod_fn_candidatos(v_origen, v_j)),
  ins as (insert into prod_jornada_orden (jornada_id, order_id, snapshot_sku, snapshot_channel, snapshot_cantidad, snapshot_status, vinculada_por)
    select v_j, order_id, sku, channel, cantidad, estado, auth.uid() from cand
    on conflict (jornada_id, order_id) do nothing
    returning order_id, snapshot_cantidad, snapshot_status)
  insert into prod_jornada_orden_log(jornada_id,order_id,accion,cantidad_anterior,cantidad_nueva,estado_anterior,estado_nuevo,origen,usuario)
  select v_j, order_id, 'vinculada', null, snapshot_cantidad, null, snapshot_status, v_origen_txt, auth.uid() from ins;
  get diagnostics v_new = row_count;
  v_asig := prod_fn_autoasignar_jornada(v_j, 'sync');
  return jsonb_build_object('ok',true,'jornada_id',v_j,'nuevas',v_new,'actualizadas',v_upd,'canceladas',v_can,
    'liberadas_a_stock_libre',v_lib,'auto_asignadas_de_stock_libre',v_asig);
end $function$;
grant execute on function public.prod_rpc_jornada_sync(jsonb) to authenticated;

-- Arrastre preview: pendiente por pedido = cantidad − asignado.
create or replace function public.prod_rpc_arrastre_preview(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_role role_enum; v_active boolean; v_j uuid;
begin
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_j := nullif(p_payload->>'jornada_id','')::uuid;
  if v_j is null then select id into v_j from prod_jornada where estado='abierta' order by fecha desc limit 1; end if;
  return jsonb_build_object('jornada_id', v_j,
    'pendientes_por_pedido', coalesce((
      select jsonb_agg(jsonb_build_object('order_id',order_id,'sku',sku,'cantidad',cantidad,
               'ya_asignado',public.prod_fn_asignado(order_id),
               'pendiente_real',greatest(cantidad-public.prod_fn_asignado(order_id),0)) order by sku)
      from prod_fn_candidatos('{"tipo":"arrastre"}'::jsonb, v_j)), '[]'::jsonb),
    'total_ventas_arrastrables', (select count(*) from prod_fn_candidatos('{"tipo":"arrastre"}'::jsonb, v_j)));
end $function$;
grant execute on function public.prod_rpc_arrastre_preview(jsonb) to authenticated;
