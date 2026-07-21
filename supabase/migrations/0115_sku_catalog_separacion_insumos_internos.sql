-- 0115 · Punto 3 — Separar SKUs internos de producción del catálogo de VENTA (aditivo, sin romper legacy/ML).
-- (Aplicada en remoto vía MCP el 2026-07-21; reconstruida como archivo local — no re-ejecutar.)
-- Regla basada en EVIDENCIA (no desactivar a ciegas):
--   INTERNO = está en prod_pieza/prod_insumo, NO es prod_producto, y NO tiene ventas (orders).
--   Los internos con ventas reales (repuestos) quedan VENDIBLES (es_insumo_interno=false).
--   No se toca `activo` ni se borra nada: ML/Ventas legacy y SKU_DB (lookup) siguen viendo todo.

alter table public.sku_catalog add column if not exists es_insumo_interno boolean not null default false;

update public.sku_catalog s set es_insumo_interno = true
where (exists (select 1 from public.prod_pieza pz where pz.sku = s.sku)
       or exists (select 1 from public.prod_insumo i where i.sku = s.sku))
  and not exists (select 1 from public.prod_producto p where p.sku = s.sku)
  and not exists (select 1 from public.orders o where o.sku = s.sku);

update public.sku_catalog s set es_insumo_interno = false
where s.es_insumo_interno = true
  and (exists (select 1 from public.prod_producto p where p.sku = s.sku)
       or exists (select 1 from public.orders o where o.sku = s.sku));

comment on column public.sku_catalog.es_insumo_interno is 'Punto 3 — TRUE = insumo/pieza interno de produccion, NO ofertar como producto vendible. Los repuestos con ventas reales quedan FALSE. No afecta `activo`; ML/lookup leen la tabla completa.';

create or replace view public.prod_v_sku_clasificado as
select s.sku, s.modelo, s.categoria, s.activo, s.es_insumo_interno,
  case
    when exists(select 1 from public.prod_producto p where p.sku=s.sku) then 'producto_venta'
    when s.es_insumo_interno then 'insumo_interno'
    when (exists(select 1 from public.prod_pieza pz where pz.sku=s.sku) or exists(select 1 from public.prod_insumo i where i.sku=s.sku)) then 'repuesto_vendible'
    else 'otro_catalogo'
  end as clase,
  exists(select 1 from public.orders o where o.sku=s.sku) as tiene_ventas
from public.sku_catalog s;
comment on view public.prod_v_sku_clasificado is 'Punto 3 — clasificacion de cada SKU del catalogo: producto_venta / repuesto_vendible / insumo_interno / otro_catalogo. Auditoria de la separacion venta vs produccion.';

create or replace view public.prod_v_catalogo_venta as
select s.* from public.sku_catalog s where s.es_insumo_interno = false;
comment on view public.prod_v_catalogo_venta is 'Punto 3 — catalogo comercial: sku_catalog SIN insumos internos. La UI de Ventas usa esto; ML/legacy siguen usando sku_catalog completo.';
