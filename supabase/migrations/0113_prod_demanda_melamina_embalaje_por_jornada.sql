-- 0113 · Punto 1 (cont.) — melamina (demanda_tap) y embalaje (resumen_dia) también salen de la JORNADA ACTIVA.
-- (Aplicada en remoto vía MCP el 2026-07-21; reconstruida como archivo local — no re-ejecutar.)
-- Antes leían orders global con el filtro buggy `<> 'despachado'` (incluía archivados). Ahora: jornada activa.
-- NOTA: la definición de "jornada activa" se afina a estado='abierta' en 0114.

create or replace view public.prod_v_demanda_tap as
with aj as (
  select id from public.prod_jornada where estado in ('abierta','en_proceso') order by fecha desc limit 1
), neto as (
  select jo.snapshot_sku as sku, sum(jo.snapshot_cantidad) as pedido
  from public.prod_jornada_orden jo where jo.jornada_id in (select id from aj)
  group by jo.snapshot_sku
)
select r.pieza_sku, sum(n.pedido * r.cantidad) as demanda
from neto n join public.prod_receta r on r.producto_sku = n.sku
group by r.pieza_sku;
comment on view public.prod_v_demanda_tap is 'Punto 1 — demanda de piezas melamina de la JORNADA ACTIVA (via prod_jornada_orden). Sin jornada activa => vacio. Alimenta prod_v_prioridad_melamina.';

create or replace view public.prod_v_resumen_dia as
with aj as (
  select id from public.prod_jornada where estado in ('abierta','en_proceso') order by fecha desc limit 1
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
comment on view public.prod_v_resumen_dia is 'Punto 1 — pendiente de embalaje de la JORNADA ACTIVA = demanda de la jornada − ya embalado en la jornada. Sin jornada activa => vacio.';
