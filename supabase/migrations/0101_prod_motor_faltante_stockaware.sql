-- 0101_prod_motor_faltante_stockaware.sql
-- LÍNEA PRODUCTIVA · Bloques 5 (schema stock) + 6 (motor de faltantes) + 10 (acumulados)
-- Contexto: el motor de explosión calculaba demanda sobre orders con filtro
--   `status <> 'despachado'` — pero 'despachado' NO existe en order_status_enum
--   (pendiente|completado|arrastrado|archivado|cancelado), por lo que NO excluía nada
--   e incluía los ~9.116 pedidos 'archivado' (históricos) como demanda viva.
--   Ej. real MAD301: pedido calculado 4.938 vs real pendiente 278. => "acumulados incorrectos".
-- Además el plan de corte NO consultaba stock por sector (producía de más).
-- Cambios: (1) reservado/en_proceso en stock; (2) fix filtro de estado; (3) faltante
--   neto stock-aware; (4) el plan de corte consume el faltante neto (no la demanda bruta).
-- Idempotente. Preserva columnas de salida de las vistas (dependientes intactos).

-- ── 1) Stock por sector: reservado + en_proceso (aditivo, default 0) ──────────
alter table public.prod_stock_pieza     add column if not exists reservado  integer not null default 0;
alter table public.prod_stock_pieza     add column if not exists en_proceso integer not null default 0;
alter table public.prod_stock_melamina  add column if not exists reservado  integer not null default 0;
alter table public.prod_stock_melamina  add column if not exists en_proceso integer not null default 0;
alter table public.prod_stock_patas     add column if not exists reservado  integer not null default 0;
alter table public.prod_stock_patas     add column if not exists en_proceso integer not null default 0;
alter table public.prod_stock_terminado add column if not exists reservado  integer not null default 0;
alter table public.prod_stock_terminado add column if not exists en_proceso integer not null default 0;

-- ── 2) Motor: filtro de estado correcto (demanda viva = pendiente + arrastrado) ─
create or replace view public.prod_v_explosion as
with recursive neto as (
  select o.sku, o.channel_id, sum(o.cantidad) as pedido
  from public.orders o
  where o.status::text in ('pendiente','arrastrado')   -- FIX 0101 (antes: <> 'despachado' inexistente → incluía archivadas)
  group by o.sku, o.channel_id
), base as (
  select n.sku, sum(greatest(n.pedido - coalesce(cs.producido,0), 0)) as qty
  from neto n
  left join public.carrier_state cs on cs.channel_id = n.channel_id and cs.sku = n.sku
  group by n.sku
  having sum(greatest(n.pedido - coalesce(cs.producido,0), 0)) > 0
), expl as (
  select b.sku, b.qty, 0 as nivel from base b
  union all
  select c.hijo_sku, e.qty * c.cantidad, e.nivel + 1
  from expl e join public.prod_componente c on c.padre_sku = e.sku
  where e.nivel < 20
)
select sku,
       sum(qty)::integer as demanda,
       max(nivel) as nivel_max,
       not (sku in (select distinct padre_sku from public.prod_componente)) as es_hoja
from expl x
group by sku;

comment on view public.prod_v_explosion is
  'Brief Logica 2 §5 — explosion de demanda de ventas PENDIENTES/ARRASTRADAS via BOM recursivo. Fix 0101: filtro de estado (antes <> despachado inexistente incluia ~9116 archivadas).';

-- ── 3) Faltante NETO: demanda bruta - stock real utilizable por pieza ─────────
-- Utilizable = (pieza cruda CNC disponible - reservado) + (melamina terminada disponible - reservado).
-- Para PAT% (patas) el stock vive en prod_stock_patas por 'tamano' (no por sku) → utilizable 0 por ahora (TODO puente patas).
create or replace view public.prod_v_faltante as
select
  e.sku,
  e.demanda                                                             as demanda_bruta,
  e.nivel_max,
  e.es_hoja,
  coalesce(sp.disponible,0)                                             as stock_pieza,
  coalesce(sp.reservado,0)                                             as pieza_reservado,
  coalesce(sm.disponible,0)                                             as stock_melamina,
  coalesce(sm.reservado,0)                                            as melamina_reservado,
  greatest(coalesce(sp.disponible,0) - coalesce(sp.reservado,0), 0)
    + greatest(coalesce(sm.disponible,0) - coalesce(sm.reservado,0), 0) as stock_utilizable,
  greatest(
    e.demanda
    - greatest(coalesce(sp.disponible,0) - coalesce(sp.reservado,0), 0)
    - greatest(coalesce(sm.disponible,0) - coalesce(sm.reservado,0), 0)
  , 0)::integer                                                         as faltante_neto
from public.prod_v_explosion e
left join public.prod_stock_pieza    sp on sp.pieza_sku = e.sku
left join public.prod_stock_melamina sm on sm.pieza_sku = e.sku;

comment on view public.prod_v_faltante is
  'Bloque 6 — faltante neto = demanda bruta (explosion) - stock real utilizable por pieza (CNC crudo + melamina terminada), neto de reservas. Evita producir de mas.';

-- ── 4) Plan de corte: consumir FALTANTE NETO (no demanda bruta) ───────────────
-- Preserva columnas (sku, demanda, clase). 'demanda' pasa a ser el faltante neto.
create or replace view public.prod_v_demanda_corte as
select f.sku,
       f.faltante_neto as demanda,
       case when f.sku like 'TAP%' then 'tapa' else 'pata' end as clase
from public.prod_v_faltante f
where (f.sku like 'TAP%' or (f.es_hoja and f.sku like 'PAT%'))
  and f.faltante_neto > 0;

comment on view public.prod_v_demanda_corte is
  'Bloque 6/7 — demanda para el optimizador CNC = FALTANTE NETO (stock-aware). Antes: demanda bruta directa de explosion.';
