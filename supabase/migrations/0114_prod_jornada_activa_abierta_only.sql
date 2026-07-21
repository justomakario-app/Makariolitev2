-- 0114 · Alinear "jornada operativa" con el ciclo real del app: estado = 'abierta'.
-- (Aplicada en remoto vía MCP el 2026-07-21; reconstruida como archivo local — no re-ejecutar.)
--   abrir_jornada crea 'abierta'; cerrar_jornada -> 'cerrada'; frontend gatea estado==='abierta'.
--   'preparada' = staged (no operativa, no consume) = Opción A del brief. 'cancelada'/'cerrada' = terminal.
--   Así NO hay desajuste con jornadaAbierta del frontend y la jornada operativa es única y consistente.

drop index if exists public.ux_prod_jornada_una_activa;
create unique index if not exists ux_prod_jornada_una_abierta
  on public.prod_jornada ((true)) where estado = 'abierta';
comment on index public.ux_prod_jornada_una_abierta is 'Punto 2 — a lo sumo UNA jornada abierta: jornada operativa unica (sin doble reserva/consumo entre jornadas). Coincide con prod_rpc_abrir_jornada y jornadaAbierta del frontend.';

create or replace view public.prod_v_explosion as
with recursive aj as (
  select id from public.prod_jornada where estado = 'abierta' order by fecha desc limit 1
), base as (
  select jo.snapshot_sku as sku, sum(jo.snapshot_cantidad) as qty
  from public.prod_jornada_orden jo where jo.jornada_id in (select id from aj)
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

create or replace view public.prod_v_demanda_tap as
with aj as (
  select id from public.prod_jornada where estado = 'abierta' order by fecha desc limit 1
), neto as (
  select jo.snapshot_sku as sku, sum(jo.snapshot_cantidad) as pedido
  from public.prod_jornada_orden jo where jo.jornada_id in (select id from aj)
  group by jo.snapshot_sku
)
select r.pieza_sku, sum(n.pedido * r.cantidad) as demanda
from neto n join public.prod_receta r on r.producto_sku = n.sku
group by r.pieza_sku;

create or replace view public.prod_v_resumen_dia as
with aj as (
  select id from public.prod_jornada where estado = 'abierta' order by fecha desc limit 1
), neto as (
  select jo.snapshot_sku as sku, sum(jo.snapshot_cantidad) as pedido
  from public.prod_jornada_orden jo where jo.jornada_id in (select id from aj)
  group by jo.snapshot_sku
), hecho as (
  select e.producto_sku, sum(e.unidades) as embalado
  from public.prod_embalaje e where e.jornada_id in (select id from aj)
  group by e.producto_sku
)
select pr.sku as producto_sku, pr.nombre, pr.color,
  greatest(sum(n.pedido) - coalesce(max(h.embalado),0), 0)::integer as pendiente
from neto n
  join public.prod_producto pr on pr.sku = n.sku
  left join hecho h on h.producto_sku = pr.sku
group by pr.sku, pr.nombre, pr.color
having greatest(sum(n.pedido) - coalesce(max(h.embalado),0), 0) > 0;
