-- 0132 · M12 — prod_v_faltante: eliminar el doble conteo de SKUs dual-registrados.
-- Antes sumaba pieza + melamina + patas + insumo para el MISMO sku: un SKU registrado en dos
-- catálogos (ej. VAR en prod_pieza Y prod_insumo) contaba su stock dos veces y subestimaba el
-- faltante. Ahora el stock utilizable respeta el pool canónico (prod_pieza_pool):
--   insumo → solo prod_insumo · patas → solo prod_stock_patas · resto → pieza cruda + melamina
-- Columnas y tipos idénticos (contrato de la vista intacto). security_invoker se re-fija (0125).
-- LOCAL: NO aplicada en remoto (se aplica primero en el entorno aislado).

create or replace view public.prod_v_faltante as
select e.sku,
  e.demanda as demanda_bruta,
  e.nivel_max,
  e.es_hoja,
  coalesce(sp.disponible, 0) as stock_pieza,
  coalesce(sp.reservado, 0) as pieza_reservado,
  coalesce(sm.disponible, 0) as stock_melamina,
  coalesce(sm.reservado, 0) as melamina_reservado,
  (case public.prod_pieza_pool(e.sku)
     when 'insumo' then coalesce(i.stock_actual, 0::numeric)::integer
     when 'patas'  then coalesce(spa.disponible, 0)
     else greatest(coalesce(sp.disponible,0) - coalesce(sp.reservado,0), 0)
        + greatest(coalesce(sm.disponible,0) - coalesce(sm.reservado,0), 0)
   end) as stock_utilizable,
  greatest(e.demanda - (case public.prod_pieza_pool(e.sku)
     when 'insumo' then coalesce(i.stock_actual, 0::numeric)::integer
     when 'patas'  then coalesce(spa.disponible, 0)
     else greatest(coalesce(sp.disponible,0) - coalesce(sp.reservado,0), 0)
        + greatest(coalesce(sm.disponible,0) - coalesce(sm.reservado,0), 0)
   end), 0) as faltante_neto
from prod_v_explosion e
  left join prod_stock_pieza sp on sp.pieza_sku = e.sku
  left join prod_stock_melamina sm on sm.pieza_sku = e.sku
  left join prod_pata_tamano pt on pt.pieza_sku = e.sku
  left join prod_stock_patas spa on spa.tamano = pt.tamano
  left join prod_insumo i on i.sku = e.sku;

alter view public.prod_v_faltante set (security_invoker = on);
revoke all on public.prod_v_faltante from anon, public;
grant select on public.prod_v_faltante to authenticated;
