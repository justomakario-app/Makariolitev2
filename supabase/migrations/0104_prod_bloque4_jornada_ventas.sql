-- 0104 · BLOQUE 4 — Vínculo jornada <-> ventas (trazabilidad, idempotencia, sin doble proceso)
-- (Aplicada en remoto vía MCP el 2026-07-20; reconstruida como archivo local — no re-ejecutar.)

do $$ begin
  alter table public.prod_jornada drop constraint if exists prod_jornada_estado_chk;
  alter table public.prod_jornada add constraint prod_jornada_estado_chk
    check (estado in ('preparada','abierta','en_proceso','cerrada','cancelada'));
exception when others then null; end $$;

alter table public.prod_producto add column if not exists patas_confirmadas boolean not null default false;

create table if not exists public.prod_jornada_orden (
  jornada_id       uuid not null references public.prod_jornada(id) on delete cascade,
  order_id         uuid not null,
  snapshot_sku     text not null,
  snapshot_channel text,
  snapshot_cantidad integer not null,
  snapshot_status  text not null,
  vinculada_at     timestamptz not null default now(),
  vinculada_por    uuid,
  primary key (jornada_id, order_id)
);
comment on table public.prod_jornada_orden is 'Bloque 4 — qué ventas toma cada jornada productiva (snapshot). PK(jornada,order) impide duplicar en la misma jornada; el RPC impide que una orden esté en 2 jornadas activas.';
create index if not exists ix_prod_jornada_orden_order on public.prod_jornada_orden(order_id);
alter table public.prod_jornada_orden enable row level security;
do $$ begin
  create policy prod_jornada_orden_sel on public.prod_jornada_orden for select to authenticated using (true);
exception when duplicate_object then null; end $$;

create or replace function public.prod_rpc_vincular_jornada(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_role role_enum; v_active boolean; v_j uuid; v_estado text; v_linked int;
begin
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;

  v_j := nullif(p_payload->>'jornada_id','')::uuid;
  if v_j is null then
    select id into v_j from prod_jornada where fecha = current_date and estado in ('abierta','preparada','en_proceso') order by coalesce(abierta_at, now()) desc limit 1;
  end if;
  if v_j is null then raise exception 'No hay jornada activa (preparada/abierta/en_proceso).' using errcode='P0002'; end if;
  select estado into v_estado from prod_jornada where id = v_j;
  if v_estado in ('cerrada','cancelada') then raise exception 'La jornada esta % : no admite vinculacion.', v_estado using errcode='42501'; end if;

  with cand as (
    select o.id, o.sku, o.channel_id, o.cantidad, o.status::text st
    from orders o
    where o.status::text in ('pendiente','arrastrado')
      and not exists (
        select 1 from prod_jornada_orden jo join prod_jornada j on j.id = jo.jornada_id
        where jo.order_id = o.id and j.estado in ('abierta','preparada','en_proceso') and jo.jornada_id <> v_j)
  ), ins as (
    insert into prod_jornada_orden (jornada_id, order_id, snapshot_sku, snapshot_channel, snapshot_cantidad, snapshot_status, vinculada_por)
    select v_j, id, sku, channel_id, cantidad, st, auth.uid() from cand
    on conflict (jornada_id, order_id) do nothing
    returning 1
  )
  select count(*) into v_linked from ins;
  return jsonb_build_object('ok', true, 'jornada_id', v_j, 'vinculadas_nuevas', v_linked,
    'total_en_jornada', (select count(*) from prod_jornada_orden where jornada_id = v_j));
end $function$;

create or replace function public.prod_rpc_set_jornada_estado(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_role role_enum; v_active boolean; v_j uuid; v_nuevo text; v_actual text;
begin
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_j := (p_payload->>'jornada_id')::uuid; v_nuevo := p_payload->>'estado';
  if v_nuevo not in ('preparada','abierta','en_proceso','cerrada','cancelada') then raise exception 'Estado invalido.' using errcode='22023'; end if;
  select estado into v_actual from prod_jornada where id = v_j;
  if v_actual is null then raise exception 'Jornada inexistente.' using errcode='P0002'; end if;
  if v_actual in ('cerrada','cancelada') then raise exception 'Jornada % es terminal.', v_actual using errcode='42501'; end if;
  update prod_jornada set estado = v_nuevo,
    cerrada_at = case when v_nuevo in ('cerrada','cancelada') then now() else cerrada_at end
  where id = v_j;
  return jsonb_build_object('ok', true, 'jornada_id', v_j, 'estado', v_nuevo);
end $function$;

create or replace view public.prod_v_explosion_jornada as
with recursive base as (
  select jo.jornada_id, jo.snapshot_sku as sku, sum(jo.snapshot_cantidad) as qty
  from public.prod_jornada_orden jo group by jo.jornada_id, jo.snapshot_sku
), expl as (
  select jornada_id, sku, qty, 0 as nivel from base
  union all
  select e.jornada_id, c.hijo_sku, e.qty*c.cantidad, e.nivel+1
  from expl e join public.prod_componente c on c.padre_sku = e.sku where e.nivel < 20
)
select jornada_id, sku, sum(qty)::integer as demanda, max(nivel) as nivel_max,
  not (sku in (select distinct padre_sku from public.prod_componente)) as es_hoja,
  public.prod_pieza_pool(sku) as pool
from expl group by jornada_id, sku;
comment on view public.prod_v_explosion_jornada is 'Bloque 4 — demanda por jornada (snapshot de ventas vinculadas) explotada por BOM. Bruta (sin producido; la jornada es objetivo productivo propio).';

create or replace view public.prod_v_faltante_jornada as
select e.jornada_id, e.sku, e.demanda as demanda_bruta, e.es_hoja, e.pool,
  greatest(coalesce(sp.disponible,0)-coalesce(sp.reservado,0),0)
    + greatest(coalesce(sm.disponible,0)-coalesce(sm.reservado,0),0) as stock_utilizable,
  greatest(e.demanda
    - greatest(coalesce(sp.disponible,0)-coalesce(sp.reservado,0),0)
    - greatest(coalesce(sm.disponible,0)-coalesce(sm.reservado,0),0), 0)::integer as faltante_neto
from public.prod_v_explosion_jornada e
left join public.prod_stock_pieza    sp on sp.pieza_sku = e.sku
left join public.prod_stock_melamina sm on sm.pieza_sku = e.sku;
comment on view public.prod_v_faltante_jornada is 'Bloque 4/6 — faltante neto por jornada (demanda bruta - stock utilizable por pieza).';

create or replace view public.prod_v_producto_receta_estado as
select p.sku, p.nombre, p.vendible, p.patas_confirmadas,
  exists (select 1 from prod_componente c where c.padre_sku = p.sku and c.hijo_sku like 'PAT%') as tiene_patas_bom,
  case
    when exists (
      with recursive b as (
        select hijo_sku sku from prod_componente where padre_sku=p.sku
        union all select c.hijo_sku from b join prod_componente c on c.padre_sku=b.sku)
      select 1 from (select distinct sku from b) x
      where not exists(select 1 from prod_componente c where c.padre_sku=x.sku) and prod_pieza_pool(x.sku)='desconocido'
    ) then 'INCOMPLETA_CONFIG'
    when exists (select 1 from prod_componente c where c.padre_sku=p.sku and c.hijo_sku like 'PAT%') and p.patas_confirmadas = false
      then 'INCOMPLETA_PATAS'
    else 'COMPLETA'
  end as receta_estado
from prod_producto p where p.vendible;
comment on view public.prod_v_producto_receta_estado is 'Bloque 4 — completitud de receta: INCOMPLETA_CONFIG (hoja sin pool) / INCOMPLETA_PATAS (patas sin confirmar Seba) / COMPLETA.';
