-- 0137 · F6 embalaje de producto SIN BOM → rechazo controlado; + F2 guard de flag.
-- registrar_embalaje: (1) guard del kill-switch (perform prod_fn_guard_lp); (2) si el producto no tiene
-- NI receta NI componentes válidos, 'Configuracion incompleta' antes de tocar stock/ledger → rollback
-- total, sin crear terminado/embalaje/asignación/idempotencia. Los 26 productos reales tienen BOM.
-- Aditiva; no reescribe migraciones previas. Definición = 0134 vigente + ambos guards.
-- LOCAL: NO aplicada en remoto. Validada en aislado (1u y cantidad excesiva → rechazo; conservación exacta).

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
  if v_jornada is null then select id into v_jornada from prod_jornada where estado='abierta' order by fecha desc limit 1; end if;
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
