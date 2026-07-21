-- 0112 · Punto 1+2 — La demanda operativa sale de la JORNADA ACTIVA (no global) + jornada operativa ÚNICA.
-- (Aplicada en remoto vía MCP el 2026-07-21; reconstruida como archivo local — no re-ejecutar.)
-- NOTA: la definición de "jornada activa" se afina a estado='abierta' en 0114 (alineación con el app real).

create unique index if not exists ux_prod_jornada_una_activa
  on public.prod_jornada ((true)) where estado in ('abierta','en_proceso');
comment on index public.ux_prod_jornada_una_activa is 'Punto 2 — a lo sumo UNA jornada abierta/en_proceso: garantiza jornada operativa única (sin doble asignación de stock entre jornadas).';

create or replace view public.prod_v_explosion as
with recursive aj as (
  select id from public.prod_jornada where estado in ('abierta','en_proceso') order by fecha desc limit 1
), base as (
  select jo.snapshot_sku as sku, sum(jo.snapshot_cantidad) as qty
  from public.prod_jornada_orden jo
  where jo.jornada_id in (select id from aj)
  group by jo.snapshot_sku
), expl as (
  select sku, qty, 0 as nivel from base
  union all
  select c.hijo_sku, e.qty*c.cantidad, e.nivel+1
  from expl e join public.prod_componente c on c.padre_sku = e.sku where e.nivel < 20
)
select sku, sum(qty)::integer as demanda, max(nivel) as nivel_max,
  not (sku in (select distinct padre_sku from public.prod_componente)) as es_hoja
from expl group by sku;
comment on view public.prod_v_explosion is 'Punto 1 — demanda OPERATIVA de la jornada ACTIVA (ventas vinculadas via prod_jornada_orden), explotada por BOM. Jornada cerrada/cancelada o sin vincular => vacio. La demanda global vive solo como resumen en prod_rpc_dashboard.';

create or replace view public.prod_v_resumen_global as
with neto as (
  select o.sku, o.channel_id, sum(o.cantidad) pedido
  from public.orders o where o.status::text in ('pendiente','arrastrado')
  group by o.sku, o.channel_id
)
select
  (select count(*) from public.orders where status::text in ('pendiente','arrastrado')) as ordenes_pendientes,
  (select coalesce(sum(cantidad),0) from public.orders where status::text in ('pendiente','arrastrado')) as unidades_pendientes,
  coalesce(sum(least(cs.producido, n.pedido)),0) as producidas_aplicables,
  coalesce(sum(greatest(n.pedido - coalesce(cs.producido,0),0)),0) as unidades_netas
from neto n left join public.carrier_state cs on cs.channel_id=n.channel_id and cs.sku=n.sku;
comment on view public.prod_v_resumen_global is 'Resumen GLOBAL de demanda pendiente (todas las ventas) — solo para el dashboard como panorama, NO como orden operativa de sector.';
