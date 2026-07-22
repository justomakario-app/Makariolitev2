-- 0144 (LOCAL): fix multi-jornada. prod_v_jornada_demanda_neta resolvia "la abierta" por
-- (estado='abierta' order by fecha desc limit 1); con >1 jornada abierta eso elige la de fecha
-- mayor (una planificada), no la EN EJECUCION. Se corrige a fase='en_ejecucion'. Toda la cadena
-- de demanda (explosion→faltante→orden_sector, resumen_dia, prioridad) cuelga de esta vista, asi
-- que este unico fix propaga a todo el motor. CREATE OR REPLACE (columnas iguales) no rompe dependientes.
-- Append-only.

create or replace view public.prod_v_jornada_demanda_neta as
 with aj as (
   select prod_jornada.id from prod_jornada where prod_jornada.fase = 'en_ejecucion' limit 1
 ), base as (
   select jo.snapshot_sku as sku,
     greatest(jo.snapshot_cantidad - coalesce((select sum(a.cantidad) from prod_asignacion a where a.order_id = jo.order_id), 0::bigint), 0::bigint) as pendiente
   from prod_jornada_orden jo
   where (jo.jornada_id in (select aj.id from aj))
     and (coalesce(jo.snapshot_status, ''::text) <> all (array['cancelada'::text, 'cumplida'::text]))
 )
 select sku, sum(pendiente)::integer as demanda_neta
 from base group by sku having sum(pendiente) > 0::numeric;
