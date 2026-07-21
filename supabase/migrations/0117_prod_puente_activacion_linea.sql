-- 0117 · Puente de activación de Línea Productiva (arranca en 0 a propósito).
-- (Aplicada en remoto vía MCP el 2026-07-21 en pasos 0117 + 0117b..0117f; este archivo consolida el ESTADO FINAL.)
-- Preview/confirm/sync de vinculación ventas↔jornada + auditoría + guarda de cierre + arrastre NETO.
-- Correctitud del arrastre: demanda operativa NETA de lo ya terminado; faltante stock-aware COMPLETO
-- (melamina + pieza cruda + patas por tamaño + insumos); stock persiste entre jornadas => no se re-demanda,
-- ni se re-fabrica, ni se re-consume lo ya hecho. NO toca datos legacy.

-- (1) Auditoría de vinculación/actualización/cancelación
create table if not exists public.prod_jornada_orden_log (
  id uuid primary key default gen_random_uuid(),
  jornada_id uuid not null,
  order_id uuid not null,
  accion text not null check (accion in ('vinculada','actualizada','cancelada')),
  cantidad_anterior integer,
  cantidad_nueva integer,
  estado_anterior text,
  estado_nuevo text,
  origen text,
  usuario uuid,
  created_at timestamptz not null default now()
);
alter table public.prod_jornada_orden_log enable row level security;
drop policy if exists prod_jornada_orden_log_sel on public.prod_jornada_orden_log;
create policy prod_jornada_orden_log_sel on public.prod_jornada_orden_log for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.role in ('owner','admin','encargado'))
);

-- (2) Demanda NETA de la jornada activa = bruto(vinculado, no cancelado) − ya terminado
create or replace view public.prod_v_jornada_demanda_neta as
with aj as (select id from public.prod_jornada where estado='abierta' order by fecha desc limit 1),
bruto as (
  select jo.snapshot_sku as sku, sum(jo.snapshot_cantidad) as qty
  from public.prod_jornada_orden jo
  where jo.jornada_id in (select id from aj) and coalesce(jo.snapshot_status,'') <> 'cancelada'
  group by jo.snapshot_sku)
select b.sku, greatest(b.qty - coalesce(t.disponible,0), 0)::integer as demanda_neta
from bruto b left join public.prod_stock_terminado t on t.producto_sku = b.sku
where greatest(b.qty - coalesce(t.disponible,0), 0) > 0;

create or replace view public.prod_v_explosion as
with recursive base as (select sku, demanda_neta::numeric as qty from public.prod_v_jornada_demanda_neta),
expl as (
  select sku, qty, 0 as nivel from base
  union all
  select c.hijo_sku, e.qty*c.cantidad, e.nivel+1
  from expl e join public.prod_componente c on c.padre_sku = e.sku where e.nivel < 20)
select sku, sum(qty)::integer as demanda, max(nivel) as nivel_max,
  not (sku in (select distinct padre_sku from public.prod_componente)) as es_hoja
from expl group by sku;

create or replace view public.prod_v_demanda_tap as
select r.pieza_sku, sum(n.demanda_neta * r.cantidad)::numeric as demanda
from public.prod_v_jornada_demanda_neta n join public.prod_receta r on r.producto_sku = n.sku
group by r.pieza_sku;

create or replace view public.prod_v_resumen_dia as
select pr.sku as producto_sku, pr.nombre, pr.color, n.demanda_neta as pendiente
from public.prod_v_jornada_demanda_neta n join public.prod_producto pr on pr.sku = n.sku
where n.demanda_neta > 0;

-- (2b) Faltante stock-aware COMPLETO (melamina + pieza cruda + patas por tamaño + insumos)
create or replace view public.prod_v_faltante as
select e.sku, e.demanda as demanda_bruta, e.nivel_max, e.es_hoja,
  coalesce(sp.disponible,0) as stock_pieza, coalesce(sp.reservado,0) as pieza_reservado,
  coalesce(sm.disponible,0) as stock_melamina, coalesce(sm.reservado,0) as melamina_reservado,
  ( greatest(coalesce(sp.disponible,0)-coalesce(sp.reservado,0),0)
    + greatest(coalesce(sm.disponible,0)-coalesce(sm.reservado,0),0)
    + coalesce(spa.disponible,0) + coalesce(i.stock_actual,0)::int ) as stock_utilizable,
  greatest( e.demanda
    - greatest(coalesce(sp.disponible,0)-coalesce(sp.reservado,0),0)
    - greatest(coalesce(sm.disponible,0)-coalesce(sm.reservado,0),0)
    - coalesce(spa.disponible,0) - coalesce(i.stock_actual,0)::int, 0) as faltante_neto
from public.prod_v_explosion e
  left join public.prod_stock_pieza sp on sp.pieza_sku = e.sku
  left join public.prod_stock_melamina sm on sm.pieza_sku = e.sku
  left join public.prod_pata_tamano pt on pt.pieza_sku = e.sku
  left join public.prod_stock_patas spa on spa.tamano = pt.tamano
  left join public.prod_insumo i on i.sku = e.sku;

-- (3) Candidatos por origen (excluye legacy por defecto: exige scope explícito)
create or replace function public.prod_fn_candidatos(p_origen jsonb, p_jornada uuid)
returns table(order_id uuid, sku text, channel text, cantidad integer, estado text)
language sql stable security definer set search_path to 'public','pg_temp' as $function$
  select o.id, o.sku, o.channel_id::text, o.cantidad, o.status::text
  from public.orders o
  where o.status::text in ('pendiente','arrastrado') and o.cancelled_at is null
    and case coalesce(p_origen->>'tipo','')
          when 'import_batch' then o.import_batch_id::text = (p_origen->>'import_batch_id')
          when 'fecha_desde'  then o.created_at::date >= (p_origen->>'fecha')::date
          when 'order_ids'    then o.id in (select (v)::uuid from jsonb_array_elements_text(coalesce(p_origen->'ids','[]'::jsonb)) v)
          when 'arrastre'     then exists (select 1 from public.prod_jornada_orden jo join public.prod_jornada j on j.id=jo.jornada_id where jo.order_id=o.id and j.estado='cerrada')
          else false end
    and not exists (select 1 from public.prod_jornada_orden jo join public.prod_jornada j on j.id=jo.jornada_id
      where jo.order_id=o.id and j.estado='abierta' and jo.jornada_id <> coalesce(p_jornada,'00000000-0000-0000-0000-000000000000'::uuid));
$function$;

-- (4) PREVIEW read-only
create or replace function public.prod_rpc_vincular_preview(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_role role_enum; v_active boolean; v_j uuid; v_origen jsonb;
begin
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_j := nullif(p_payload->>'jornada_id','')::uuid;
  if v_j is null then select id into v_j from prod_jornada where estado='abierta' order by fecha desc limit 1; end if;
  v_origen := coalesce(p_payload->'origen','{}'::jsonb);
  return jsonb_build_object('jornada_id', v_j, 'origen', v_origen,
    'total_ventas', (select count(*) from prod_fn_candidatos(v_origen, v_j)),
    'total_unidades', (select coalesce(sum(cantidad),0) from prod_fn_candidatos(v_origen, v_j)),
    'ya_vinculadas_en_jornada', (select count(*) from prod_jornada_orden jo where jo.jornada_id=v_j and coalesce(jo.snapshot_status,'')<>'cancelada'),
    'detalle', coalesce((select jsonb_agg(jsonb_build_object('sku',sku,'unidades',cantidad,'canal',channel) order by sku) from prod_fn_candidatos(v_origen, v_j)), '[]'::jsonb));
end $function$;
grant execute on function public.prod_rpc_vincular_preview(jsonb) to authenticated;

-- (5) CONFIRMAR (idempotente, auditado, transaccional)
create or replace function public.prod_rpc_vincular_confirmar(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_role role_enum; v_active boolean; v_j uuid; v_origen jsonb; v_estado text; v_new int; v_origen_txt text;
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
  ins as (
    insert into prod_jornada_orden (jornada_id, order_id, snapshot_sku, snapshot_channel, snapshot_cantidad, snapshot_status, vinculada_por)
    select v_j, order_id, sku, channel, cantidad, estado, auth.uid() from cand
    on conflict (jornada_id, order_id) do nothing
    returning order_id, snapshot_sku, snapshot_cantidad, snapshot_status)
  insert into prod_jornada_orden_log (jornada_id, order_id, accion, cantidad_anterior, cantidad_nueva, estado_anterior, estado_nuevo, origen, usuario)
  select v_j, order_id, 'vinculada', null, snapshot_cantidad, null, snapshot_status, v_origen_txt, auth.uid() from ins;
  get diagnostics v_new = row_count;
  return jsonb_build_object('ok', true, 'jornada_id', v_j, 'vinculadas_nuevas', v_new,
    'total_en_jornada', (select count(*) from prod_jornada_orden where jornada_id=v_j and coalesce(snapshot_status,'')<>'cancelada'));
end $function$;
grant execute on function public.prod_rpc_vincular_confirmar(jsonb) to authenticated;

-- (6) SYNC (nuevas + cambios de cantidad + cancelaciones, auditado; preserva lo producido)
create or replace function public.prod_rpc_jornada_sync(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_role role_enum; v_active boolean; v_j uuid; v_origen jsonb; v_origen_txt text; v_new int:=0; v_upd int:=0; v_can int:=0; r record;
begin
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_j := nullif(p_payload->>'jornada_id','')::uuid;
  if v_j is null then select id into v_j from prod_jornada where estado='abierta' order by fecha desc limit 1; end if;
  if v_j is null then raise exception 'No hay jornada abierta.' using errcode='P0002'; end if;
  v_origen := coalesce(p_payload->'origen','{}'::jsonb);
  v_origen_txt := 'sync:'||coalesce(v_origen->>'tipo','manual');
  for r in
    select jo.order_id, jo.snapshot_cantidad, jo.snapshot_status, o.cantidad as cant_actual, o.status::text as estado_actual, o.cancelled_at
    from prod_jornada_orden jo join orders o on o.id=jo.order_id
    where jo.jornada_id=v_j and coalesce(jo.snapshot_status,'')<>'cancelada'
  loop
    if r.cancelled_at is not null or r.estado_actual not in ('pendiente','arrastrado') then
      update prod_jornada_orden set snapshot_status='cancelada' where jornada_id=v_j and order_id=r.order_id;
      insert into prod_jornada_orden_log(jornada_id,order_id,accion,cantidad_anterior,cantidad_nueva,estado_anterior,estado_nuevo,origen,usuario)
      values (v_j,r.order_id,'cancelada',r.snapshot_cantidad,0,r.snapshot_status,'cancelada',v_origen_txt,auth.uid());
      v_can := v_can+1;
    elsif r.cant_actual is distinct from r.snapshot_cantidad then
      update prod_jornada_orden set snapshot_cantidad=r.cant_actual, snapshot_status=r.estado_actual where jornada_id=v_j and order_id=r.order_id;
      insert into prod_jornada_orden_log(jornada_id,order_id,accion,cantidad_anterior,cantidad_nueva,estado_anterior,estado_nuevo,origen,usuario)
      values (v_j,r.order_id,'actualizada',r.snapshot_cantidad,r.cant_actual,r.snapshot_status,r.estado_actual,v_origen_txt,auth.uid());
      v_upd := v_upd+1;
    end if;
  end loop;
  with cand as (select * from prod_fn_candidatos(v_origen, v_j)),
  ins as (
    insert into prod_jornada_orden (jornada_id, order_id, snapshot_sku, snapshot_channel, snapshot_cantidad, snapshot_status, vinculada_por)
    select v_j, order_id, sku, channel, cantidad, estado, auth.uid() from cand
    on conflict (jornada_id, order_id) do nothing
    returning order_id, snapshot_cantidad, snapshot_status)
  insert into prod_jornada_orden_log(jornada_id,order_id,accion,cantidad_anterior,cantidad_nueva,estado_anterior,estado_nuevo,origen,usuario)
  select v_j, order_id, 'vinculada', null, snapshot_cantidad, null, snapshot_status, v_origen_txt, auth.uid() from ins;
  get diagnostics v_new = row_count;
  return jsonb_build_object('ok',true,'jornada_id',v_j,'nuevas',v_new,'actualizadas',v_upd,'canceladas',v_can);
end $function$;
grant execute on function public.prod_rpc_jornada_sync(jsonb) to authenticated;

-- (7) ARRASTRE preview: pendientes reales de jornadas cerradas (neto terminado)
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
    'pendientes_por_producto', coalesce((
      select jsonb_agg(jsonb_build_object('sku',sku,'bruto_pendiente',bruto,'ya_terminado',term,'neto_a_incorporar',greatest(bruto-term,0)) order by sku)
      from (select c.sku, sum(c.cantidad) bruto, coalesce(max(t.disponible),0) term
            from prod_fn_candidatos('{"tipo":"arrastre"}'::jsonb, v_j) c
            left join prod_stock_terminado t on t.producto_sku=c.sku group by c.sku) x
      where greatest(bruto-term,0) > 0), '[]'::jsonb),
    'total_ventas_arrastrables', (select count(*) from prod_fn_candidatos('{"tipo":"arrastre"}'::jsonb, v_j)));
end $function$;
grant execute on function public.prod_rpc_arrastre_preview(jsonb) to authenticated;

-- (8) CERRAR con guarda: dispara si hay mesas pendientes (demanda neta) o faltante de HOJAS producibles.
create or replace function public.prod_rpc_cerrar_jornada(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_role role_enum; v_active boolean; v_id uuid; v_estado text; v_forzar boolean; v_falt jsonb; v_n int; v_pend_mesas int; v_pend_detalle jsonb;
begin
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
end $function$;
grant execute on function public.prod_rpc_cerrar_jornada(jsonb) to authenticated;
