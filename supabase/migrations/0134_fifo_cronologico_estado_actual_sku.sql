-- 0134 · M14 + M15 + M16 — asignación consciente del estado ACTUAL del pedido, del SKU y del orden cronológico.
--  M14: embalaje y autoasignar ya NO asignan a pedidos cancelados/archivados con snapshot viejo
--       (predicados sobre orders: cancelled_at is null + status in pendiente/arrastrado).
--  M15: prod_fn_asignado gana filtro por producto_sku (firma (uuid, text default null); la vieja (uuid)
--       se elimina); el sync detecta cambio de SKU del pedido: libera el neto del SKU viejo, actualiza
--       el snapshot y deja que la autoasignación cubra el SKU nuevo.
--  M16: FIFO cronológico real: created_at + orden NATURAL de order_number (numérico por segmentos,
--       no lexicográfico: '99' < '100') + order_id como desempate determinista.
-- LOCAL: NO aplicada en remoto (se aplica primero en el entorno aislado).

-- ── M16: clave de orden natural ──────────────────────────────────────────────
create or replace function public.prod_fn_natkey(p_txt text)
returns text language sql immutable set search_path to 'public','pg_temp' as $function$
  select coalesce(string_agg(
           case when t.part ~ '^[0-9]+$' then lpad(t.part, 12, '0') else t.part end, '' order by t.ord), '')
  from (
    select (r.m)[1] as part, r.ord
    from regexp_matches(coalesce(p_txt,''), '[0-9]+|[^0-9]+', 'g') with ordinality as r(m, ord)
  ) t
$function$;
revoke execute on function public.prod_fn_natkey(text) from public, anon;
grant execute on function public.prod_fn_natkey(text) to authenticated;

-- ── M15: prod_fn_asignado con filtro opcional por SKU ───────────────────────
drop function if exists public.prod_fn_asignado(uuid);
create or replace function public.prod_fn_asignado(p_order uuid, p_sku text default null)
returns integer language sql stable security definer set search_path to 'public','pg_temp' as $function$
  select coalesce(sum(cantidad),0)::int from public.prod_asignacion
  where order_id = p_order and (p_sku is null or producto_sku = p_sku);
$function$;
revoke execute on function public.prod_fn_asignado(uuid, text) from public, anon, authenticated;

-- ── M14+M16: autoasignar con estado actual + orden natural ──────────────────
create or replace function public.prod_fn_autoasignar_jornada(p_jornada uuid, p_origen text)
returns integer language plpgsql security definer set search_path to 'public','pg_temp' as $function$
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
end $function$;
revoke execute on function public.prod_fn_autoasignar_jornada(uuid, text) from public, anon, authenticated;

-- ── M14+M16: registrar_embalaje — FIFO con estado actual + orden natural ────
-- (idéntica a 0123 salvo el loop FIFO: predicados de orders + natkey + fn_asignado con sku)
create or replace function public.prod_rpc_registrar_embalaje(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_role role_enum; v_active boolean; v_jornada uuid; v_est text; v_prod text; v_unid int; v_canal text;
  v_desconocidas text; v_id uuid; v_reqid text; v_hash text; v_ins int; v_prev jsonb; v_prev_hash text;
  v_rest int; v_take int; v_libre int; v_o record; v_falta text; res jsonb;
begin
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('embalaje','encargado','owner','admin') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_jornada := nullif(p_payload->>'jornada_id','')::uuid;
  if v_jornada is null then select id into v_jornada from prod_jornada where estado='abierta' order by fecha desc limit 1; end if;
  select estado into v_est from prod_jornada where id=v_jornada;
  if v_jornada is null or v_est is null then raise exception 'Jornada inexistente.' using errcode='P0002'; end if;
  if v_est <> 'abierta' then raise exception 'La jornada no esta abierta (%).', v_est using errcode='42501'; end if;
  v_prod := p_payload->>'producto_sku';
  v_unid := coalesce((p_payload->>'unidades')::int, 0);
  v_canal := nullif(trim(p_payload->>'canal'),'');
  if v_unid <= 0 then raise exception 'unidades debe ser > 0.' using errcode='22023'; end if;
  if not exists (select 1 from prod_producto where sku=v_prod) then raise exception 'Producto % no existe.', v_prod using errcode='22023'; end if;

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
end $function$;
revoke execute on function public.prod_rpc_registrar_embalaje(jsonb) from public, anon;
grant execute on function public.prod_rpc_registrar_embalaje(jsonb) to authenticated;

-- ── M15: sync detecta cambio de SKU (además de cantidad); resto idéntico a 0120 ──
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
end $function$;
revoke execute on function public.prod_rpc_jornada_sync(jsonb) from public, anon;
grant execute on function public.prod_rpc_jornada_sync(jsonb) to authenticated;
