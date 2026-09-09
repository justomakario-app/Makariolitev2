-- ══════════════════════════════════════════════════════════════════════════════════════════
-- 0175 · La producción cargada sin jornada de demanda tiene que verse
-- ══════════════════════════════════════════════════════════════════════════════════════════
--
-- QUÉ SE ROMPIÓ
--
-- La 0173 le dio a cada sector su propia jornada, independiente de la jornada de demanda que
-- vincula pedidos. Fue lo que pidió Seba y está bien. Pero dejó un agujero: cuando el sector
-- carga con SU turno abierto y NO hay jornada de demanda, la fila entra con `jornada_id = NULL`.
--
--     v_jornada := coalesce(nullif(p_payload->>'jornada_id','')::uuid, prod_fn_jornada_lp_abierta());
--     -- v_jornada puede quedar en NULL, y el insert lo acepta.
--
-- Y TODO lo que lee producción filtra por `jornada_id`:
--
--   · prod_rpc_dashboard      → `where jornada_id = v_j`      ⇒ los cuatro contadores en 0
--   · prod_rpc_cerrar_jornada → `where jornada_id = v_id`     ⇒ el resumen del cierre miente
--   · prod_rpc_director_historico → `join prod_jornada on ...` INNER ⇒ la fila desaparece del
--     histórico permanente y del Excel. Para siempre.
--   · el panel del encargado  → `jid ? cortesDia(jid) : []`   ⇒ pantalla vacía
--
-- El operario apretó "Registrar", vio "+15 piezas", el stock efectivamente subió… y no aparece
-- en ninguna pantalla. Es exactamente la clase de bug que perseguimos en este proyecto: una
-- acción que dice que funcionó y no deja rastro donde alguien la va a buscar. Antes de la 0173
-- esto reventaba con un error duro y no se escribía nada; la 0173 lo convierte en un éxito
-- silencioso. Es una regresión, y se arregla ANTES de que la 0173 llegue a producción.
--
-- CÓMO SE ARREGLA
--
-- No moviendo dónde se escribe (el turno de sector es independiente a propósito), sino dándole
-- al turno una FECHA y haciendo que todo lo que agrega lea "lo de la jornada MÁS lo huérfano
-- de ese día". Estrictamente aditivo: nada de lo que hoy se cuenta deja de contarse.
--
--   A. `fecha` en prod_jornada_sector (hoy no tiene ninguna columna de día)
--   B. Cuatro vistas `prod_v_*_dia` que resuelven el día de cada fila
--   C. prod_rpc_dashboard suma los huérfanos del día
--   D. prod_rpc_cerrar_jornada idem, en el resumen del cierre
--   E. prod_rpc_director_historico: INNER JOIN → vistas por día (deja de perder filas)
--   F. prod_rpc_sector_estado: día operativo, "abrió hoy", turno de otro día, último turno
--   G. prod_v_turnos con fecha
--   H. revoke execute que la 0173 se olvidó en dos funciones SECURITY DEFINER
--
-- Depende de: 0173 (prod_jornada_sector, turno_id en las cuatro tablas) y 0174 (reescribe
-- prod_rpc_registrar_corte / _pino; acá NO se tocan, para no pisarse).
--
-- Rollback al pie.

begin;

-- ══════════════════════════════════════════════════════════════════════════════════════════
-- A. El turno de sector necesita una fecha
-- ══════════════════════════════════════════════════════════════════════════════════════════
--
-- La 0173 dejó sólo `abierta_at timestamptz`. Alcanza para "abierta hace 3 h" pero no para
-- "lo de hoy": comparar un timestamptz contra un día obliga a castear en cada consulta y no
-- se puede indexar bien. Con una `fecha` propia el turno es la unidad de día del sector.
--
-- `current_date` y no la fecha local de Argentina, a propósito: prod_jornada.fecha, orders,
-- jornadas comerciales y todo lo demás en esta base usan current_date (la base está en UTC).
-- Un turno con fecha local y una jornada con fecha UTC no cruzarían entre las 21 y las 24, y
-- ese desfasaje sería un bug peor que el que arregla. Si algún día se mueve el criterio, se
-- mueve para toda la base de una vez, no acá.

alter table public.prod_jornada_sector add column if not exists fecha date;

-- Los turnos que ya existan (0173 aplicada antes que esta) toman el día en que se abrieron.
update public.prod_jornada_sector set fecha = abierta_at::date where fecha is null;

alter table public.prod_jornada_sector alter column fecha set default current_date;
alter table public.prod_jornada_sector alter column fecha set not null;

comment on column public.prod_jornada_sector.fecha is
  'Dia del turno (current_date al abrirlo). Es el ancla de "lo de hoy" cuando la fila de produccion no tiene jornada de demanda.';

create index if not exists ix_prod_jornada_sector_fecha
  on public.prod_jornada_sector (fecha, sector);

-- ══════════════════════════════════════════════════════════════════════════════════════════
-- B. Las cuatro vistas por día
-- ══════════════════════════════════════════════════════════════════════════════════════════
--
-- `dia` = coalesce(jornada.fecha, turno.fecha, created_at::date). El orden importa y es
-- deliberado:
--
--   1º jornada.fecha  → si la fila TIENE jornada, su día es el mismo que hoy ya usa todo el
--                       sistema. Cero regresión: nada cambia de día ni de columna.
--   2º turno.fecha    → el caso roto. Sin jornada, la fila cae en el día del turno que la
--                       produjo, que es el día en que el operario efectivamente trabajó.
--   3º created_at     → todo lo cargado antes de la 0173 (sin turno) y cualquier fila
--                       huérfana de las dos cosas. Última red: preferible un día aproximado
--                       a una fila que no existe para nadie.
--
-- security_invoker=on por 0125: toda prod_v_* respeta la RLS del que consulta. Una vista nueva
-- sin esa marca reabriría el agujero que 0125 cerró. Dentro de las RPC SECURITY DEFINER el
-- invocador es el dueño de la función, así que ahí siguen viendo todo, como cuando leían la
-- tabla directo.
--
-- Columnas explícitas y no `c.*`: con `create or replace view` un `*` congela la lista de
-- columnas del día que se creó, y el próximo alter table sobre la tabla base hace fallar el
-- replace con un error que no dice nada.

create or replace view public.prod_v_corte_dia with (security_invoker = true) as
select c.id, c.jornada_id, c.turno_id, c.placa_sku, c.hojas, c.desperdicio,
       c.cargado_por, c.created_at, c.editable_hasta,
       coalesce(jj.fecha, ts.fecha, c.created_at::date) as dia,
       ts.sector as turno_sector, ts.estado as turno_estado
from public.prod_corte c
left join public.prod_jornada        jj on jj.id = c.jornada_id
left join public.prod_jornada_sector ts on ts.id = c.turno_id;

create or replace view public.prod_v_melamina_dia with (security_invoker = true) as
select m.id, m.jornada_id, m.turno_id, m.pieza_sku, m.terminadas, m.fallas,
       m.cargado_por, m.created_at, m.editable_hasta,
       coalesce(jj.fecha, ts.fecha, m.created_at::date) as dia,
       ts.sector as turno_sector, ts.estado as turno_estado
from public.prod_melamina m
left join public.prod_jornada        jj on jj.id = m.jornada_id
left join public.prod_jornada_sector ts on ts.id = m.turno_id;

create or replace view public.prod_v_pino_dia with (security_invoker = true) as
select p.id, p.jornada_id, p.turno_id, p.tamano, p.terminadas, p.masilladas,
       p.cargado_por, p.created_at, p.editable_hasta,
       coalesce(jj.fecha, ts.fecha, p.created_at::date) as dia,
       ts.sector as turno_sector, ts.estado as turno_estado
from public.prod_pino p
left join public.prod_jornada        jj on jj.id = p.jornada_id
left join public.prod_jornada_sector ts on ts.id = p.turno_id;

create or replace view public.prod_v_embalaje_dia with (security_invoker = true) as
select e.id, e.jornada_id, e.turno_id, e.producto_sku, e.unidades, e.canal,
       e.cargado_por, e.created_at,
       coalesce(jj.fecha, ts.fecha, e.created_at::date) as dia,
       ts.sector as turno_sector, ts.estado as turno_estado
from public.prod_embalaje e
left join public.prod_jornada        jj on jj.id = e.jornada_id
left join public.prod_jornada_sector ts on ts.id = e.turno_id;

comment on view public.prod_v_corte_dia is
  'prod_corte con el dia resuelto (jornada -> turno -> created_at). Lo que la produccion sin jornada de demanda necesita para no quedar invisible.';

revoke all on public.prod_v_corte_dia    from public, anon;
revoke all on public.prod_v_melamina_dia from public, anon;
revoke all on public.prod_v_pino_dia     from public, anon;
revoke all on public.prod_v_embalaje_dia from public, anon;
grant select on public.prod_v_corte_dia    to authenticated;
grant select on public.prod_v_melamina_dia to authenticated;
grant select on public.prod_v_pino_dia     to authenticated;
grant select on public.prod_v_embalaje_dia to authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════════════
-- C. Dashboard: los cuatro contadores dejan de mostrar 0
-- ══════════════════════════════════════════════════════════════════════════════════════════
--
-- Único cambio respecto de la versión viva: el bloque 'sectores' y el `v_dia` que necesita.
-- El resto es idéntico, copiado tal cual, para que el diff del que revise sea chico.
--
-- El predicado es aditivo: `jornada_id = v_j` (lo que ya contaba) OR `jornada_id is null and
-- dia = v_dia` (lo huérfano de ese día). Ninguna fila que hoy cuenta deja de contar.
--
-- `v_dia := coalesce(fecha de la jornada, current_date)` cubre el peor caso: NO hay ninguna
-- jornada. Ahí `v_j` es null, el primer término nunca da true, y sin el fallback los
-- contadores volverían a dar 0 — que es justo el bug.

create or replace function public.prod_rpc_dashboard(p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_j uuid; v_jrow record; v_use_j boolean; v_pino text;
        v_dia date;
begin
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado','cnc','melamina','pino','embalaje') then raise exception 'Sin permiso.' using errcode='42501'; end if;

  v_j := nullif(p_payload->>'jornada_id','')::uuid;
  if v_j is null then select id into v_j from prod_jornada where estado in ('abierta','en_proceso','preparada') order by fecha desc limit 1; end if;
  select id, fecha, estado into v_jrow from prod_jornada where id = v_j;
  v_use_j := v_j is not null and exists (select 1 from prod_jornada_orden where jornada_id = v_j);
  v_dia := coalesce(v_jrow.fecha, current_date);

  select case when bool_and(patas_confirmadas) then 'operativo' else 'pendiente_validacion_patas' end into v_pino
  from prod_producto where vendible and exists (select 1 from prod_componente c where c.padre_sku = prod_producto.sku and c.hijo_sku like 'PAT%');
  v_pino := coalesce(v_pino, 'operativo');

  return jsonb_build_object(
    'generado_at', now(),
    'jornada', case when v_jrow.id is not null then jsonb_build_object('id',v_jrow.id,'fecha',v_jrow.fecha,'estado',v_jrow.estado) else null end,
    'dia', v_dia,
    'resumen', jsonb_build_object(
      'fuente', case when v_use_j then 'jornada' else 'demanda_global_pendiente' end,
      'ordenes_vinculadas', case when v_use_j then (select count(*) from prod_jornada_orden where jornada_id=v_j)
                                 else (select count(*) from orders where status::text in ('pendiente','arrastrado')) end,
      'unidades_vendidas', case when v_use_j then (select coalesce(sum(snapshot_cantidad),0) from prod_jornada_orden where jornada_id=v_j)
                                else (select coalesce(sum(cantidad),0) from orders where status::text in ('pendiente','arrastrado')) end,
      'unidades_producidas_aplicables', (select coalesce(sum(least(cs.producido, p.ped)),0)
        from (select sku,channel_id,sum(cantidad) ped from orders where status::text in ('pendiente','arrastrado') group by 1,2) p
        join carrier_state cs on cs.sku=p.sku and cs.channel_id=p.channel_id),
      'unidades_netas_a_producir', (select coalesce(sum(greatest(p.ped-coalesce(cs.producido,0),0)),0)
        from (select sku,channel_id,sum(cantidad) ped from orders where status::text in ('pendiente','arrastrado') group by 1,2) p
        left join carrier_state cs on cs.sku=p.sku and cs.channel_id=p.channel_id),
      'excedente_producido_pendiente_conciliacion', (select coalesce(sum(greatest(cs.producido - coalesce(p.ped,0),0)),0)
        from carrier_state cs left join (select sku,channel_id,sum(cantidad) ped from orders where status::text in ('pendiente','arrastrado') group by 1,2) p
          on p.sku=cs.sku and p.channel_id=cs.channel_id where cs.producido>0)
    ),
    'necesidades_por_pieza', (select coalesce(jsonb_agg(t order by t->>'faltante_neto' desc),'[]'::jsonb) from (
        select jsonb_build_object('sku',sku,'pool',prod_pieza_pool(sku),'demanda_bruta',demanda_bruta,
          'stock_utilizable',stock_utilizable,'faltante_neto',faltante_neto) as t
        from prod_v_faltante where faltante_neto > 0 order by faltante_neto desc limit 100) x),
    'stock', jsonb_build_object(
      'canonico_pieza_cnc', (select coalesce(sum(disponible),0) from prod_stock_pieza),
      'canonico_melamina', (select coalesce(sum(disponible),0) from prod_stock_melamina),
      'canonico_patas', (select coalesce(sum(disponible),0) from prod_stock_patas),
      'canonico_terminado', (select coalesce(sum(disponible),0) from prod_stock_terminado),
      'legacy_free_stock_pendiente_conciliacion', (select coalesce(sum(cantidad),0) from free_stock),
      'carga_inicial_lotes', (select count(distinct lote_id) from prod_stock_ajuste)
    ),
    'sectores', jsonb_build_object(
      -- 0175: `jornada_id = v_j` OR huérfano del día. Sin la segunda mitad, un sector que
      -- trabajó todo el día sin jornada de demanda abierta figuraba con 0 cargas.
      'cnc_cortes',         (select count(*) from prod_v_corte_dia    x where (v_j is not null and x.jornada_id = v_j) or (x.jornada_id is null and x.dia = v_dia)),
      'melamina_registros', (select count(*) from prod_v_melamina_dia x where (v_j is not null and x.jornada_id = v_j) or (x.jornada_id is null and x.dia = v_dia)),
      'pino_registros',     (select count(*) from prod_v_pino_dia     x where (v_j is not null and x.jornada_id = v_j) or (x.jornada_id is null and x.dia = v_dia)),
      'embalaje_registros', (select count(*) from prod_v_embalaje_dia x where (v_j is not null and x.jornada_id = v_j) or (x.jornada_id is null and x.dia = v_dia)),
      -- Cuántas de esas cargas quedaron sin jornada de demanda. Si esto es > 0 el encargado
      -- tiene que saberlo: son horas de taller que no están imputadas a ningún pedido.
      'sin_jornada_demanda', (
        (select count(*) from prod_v_corte_dia    x where x.jornada_id is null and x.dia = v_dia) +
        (select count(*) from prod_v_melamina_dia x where x.jornada_id is null and x.dia = v_dia) +
        (select count(*) from prod_v_pino_dia     x where x.jornada_id is null and x.dia = v_dia) +
        (select count(*) from prod_v_embalaje_dia x where x.jornada_id is null and x.dia = v_dia)),
      'pino_estado', v_pino
    ),
    'calidad_datos', jsonb_build_object(
      'recetas_completa', (select count(*) from prod_v_producto_receta_estado where receta_estado='COMPLETA'),
      'recetas_incompleta_patas', (select count(*) from prod_v_producto_receta_estado where receta_estado='INCOMPLETA_PATAS'),
      'recetas_incompleta_config', (select count(*) from prod_v_producto_receta_estado where receta_estado='INCOMPLETA_CONFIG'),
      'skus_sin_pool_desconocido', (select count(*) from (select sku from prod_pieza union select pieza_sku from prod_receta) s where prod_pieza_pool(s.sku)='desconocido')
    )
  );
end $fn$;

revoke all on function public.prod_rpc_dashboard(jsonb) from public, anon;
grant execute on function public.prod_rpc_dashboard(jsonb) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════════════
-- D. Cierre de jornada: el resumen deja de mentir
-- ══════════════════════════════════════════════════════════════════════════════════════════
--
-- Mismo predicado aditivo. El encargado cierra el día y ve "cortes: 0" mientras el de CNC
-- estuvo ocho horas cortando: el resumen del cierre es lo último que alguien mira antes de
-- irse, y era donde el bug se veía más caro.
--
-- Todo lo demás es idéntico a la versión viva.

create or replace function public.prod_rpc_cerrar_jornada(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_id uuid; v_fecha date; v_est text; v_forzar boolean;
  v_pend_mesas int; v_pend_detalle jsonb; v_falt jsonb; v_n int; v_tareas int;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;

  v_id := coalesce(nullif(p_payload->>'jornada_id','')::uuid, public.prod_fn_jornada_activa());
  if v_id is null then raise exception 'No hay jornada activa para cerrar.' using errcode='P0002'; end if;

  -- Lock sobre el espejo (no sobre la tabla comercial): serializa cierres simultaneos en LP.
  select estado, fecha into v_est, v_fecha from public.prod_jornada where id=v_id for update;
  if v_est is null then raise exception 'Jornada no encontrada.' using errcode='P0002'; end if;
  if v_est <> 'abierta' then
    raise exception 'La jornada de Linea Productiva ya esta cerrada (%).', v_est using errcode='42501';
  end if;

  v_forzar := coalesce((p_payload->>'forzar')::boolean, false);
  select coalesce(sum(demanda_neta),0), coalesce(jsonb_agg(jsonb_build_object('sku',sku,'mesas_pendientes',demanda_neta) order by demanda_neta desc),'[]'::jsonb)
    into v_pend_mesas, v_pend_detalle from prod_v_jornada_demanda_neta;
  select coalesce(jsonb_agg(jsonb_build_object('sku',sku,'pool',prod_pieza_pool(sku),'faltante',faltante_neto) order by faltante_neto desc), '[]'::jsonb), count(*)
    into v_falt, v_n from prod_v_faltante where faltante_neto > 0 and es_hoja and prod_pieza_pool(sku) in ('melamina','patas','insumo');

  if (v_pend_mesas > 0 or v_n > 0) and not v_forzar then
    return jsonb_build_object('ok', false, 'requiere_confirmacion', true, 'motivo', 'trabajo_pendiente',
      'mesas_pendientes_total', v_pend_mesas, 'mesas_pendientes', v_pend_detalle,
      'faltantes_piezas_count', v_n, 'faltantes_piezas', v_falt,
      'mensaje', 'Queda trabajo pendiente. Volve a cerrar con forzar=true. Se cierra SOLO la jornada de Linea Productiva: los pedidos y la jornada de Produccion no se tocan. Lo pendiente queda como esta y vuelve a aparecer al reabrir; las tareas reservadas o en curso se cancelan y su material vuelve al stock.');
  end if;

  select count(*) into v_tareas from public.prod_tarea where jornada_id=v_id and estado in ('reservada','en_proceso');

  update public.prod_jornada
     set estado='cerrada', cierre_lp_at=now(), cierre_lp_por=auth.uid()
   where id=v_id;

  -- Devuelve al stock lo reservado y lo que estaba en proceso, y cancela esas tareas. Opera solo
  -- sobre prod_tarea / prod_stock_mov / prod_fn_stock_apply — nada de orders ni free_stock.
  perform public.prod_fn_liberar_jornada_reservas(v_id);

  return jsonb_build_object('ok', true, 'jornada_id', v_id, 'fecha', v_fecha, 'cerrada', true,
    'ambito', 'linea_productiva', 'arrastre', false,
    'cerrada_con_pendientes', (v_pend_mesas > 0 or v_n > 0),
    'mesas_pendientes_total', v_pend_mesas, 'faltantes_piezas', v_falt,
    'tareas_liberadas', v_tareas,
    -- 0175: aditivo. Lo de la jornada MÁS lo que se cargó ese día sin jornada de demanda.
    'resumen', jsonb_build_object(
      'cortes',   (select count(*) from prod_v_corte_dia    x where x.jornada_id = v_id or (x.jornada_id is null and x.dia = v_fecha)),
      'melamina', (select count(*) from prod_v_melamina_dia x where x.jornada_id = v_id or (x.jornada_id is null and x.dia = v_fecha)),
      'pino',     (select count(*) from prod_v_pino_dia     x where x.jornada_id = v_id or (x.jornada_id is null and x.dia = v_fecha)),
      'embalaje', (select count(*) from prod_v_embalaje_dia x where x.jornada_id = v_id or (x.jornada_id is null and x.dia = v_fecha))),
    'resumen_sin_jornada', jsonb_build_object(
      'cortes',   (select count(*) from prod_v_corte_dia    x where x.jornada_id is null and x.dia = v_fecha),
      'melamina', (select count(*) from prod_v_melamina_dia x where x.jornada_id is null and x.dia = v_fecha),
      'pino',     (select count(*) from prod_v_pino_dia     x where x.jornada_id is null and x.dia = v_fecha),
      'embalaje', (select count(*) from prod_v_embalaje_dia x where x.jornada_id is null and x.dia = v_fecha)));
end $fn$;

revoke all on function public.prod_rpc_cerrar_jornada(jsonb) from public, anon;
grant execute on function public.prod_rpc_cerrar_jornada(jsonb) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════════════
-- E. Histórico del director: el INNER JOIN que borraba filas para siempre
-- ══════════════════════════════════════════════════════════════════════════════════════════
--
--     from prod_corte c JOIN prod_jornada jj ON jj.id = c.jornada_id
--
-- Con jornada_id null ese JOIN descarta la fila. El dashboard mostraba 0 pero al menos la fila
-- existía; acá desaparece del registro permanente y del Excel que se exporta. Nadie la va a
-- volver a buscar.
--
-- Se reescribe leyendo las vistas por día. Es un superconjunto estricto de lo que traía antes:
-- una fila con jornada sigue cayendo en jj.fecha (`dia` la resuelve primero), y las que no
-- tienen jornada ahora caen en el día de su turno en vez de caerse del informe.
--
-- `por_dia` también cambia de motor: antes recorría prod_jornada, así que un día sin jornada
-- de demanda no aparecía en la serie aunque el taller hubiera trabajado. Ahora recorre la
-- unión de días con jornada y días con turno de sector.

create or replace function public.prod_rpc_director_historico(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare
  v_role role_enum; v_active boolean;
  v_hasta date := coalesce(nullif(p_payload->>'hasta','')::date, current_date);
  v_desde date := coalesce(nullif(p_payload->>'desde','')::date, current_date - 29);
  v_len int;
  v_prev_desde date; v_prev_hasta date;
  v_kpis jsonb; v_por_dia jsonb; v_top jsonb; v_mant jsonb;
  v_emb_actual numeric; v_emb_prev numeric;
begin
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then
    raise exception 'Tu sesion expiro.' using errcode='42501', hint='auth'; end if;
  if v_role not in ('owner','admin') then
    raise exception 'Solo direccion.' using errcode='42501', hint='not_authorized'; end if;
  if v_hasta < v_desde then
    raise exception 'Rango invalido.' using errcode='22023'; end if;

  v_len := (v_hasta - v_desde) + 1;
  v_prev_hasta := v_desde - 1;
  v_prev_desde := v_prev_hasta - (v_len - 1);

  select jsonb_build_object(
    'jornadas',        (select count(*) from prod_jornada where fecha between v_desde and v_hasta),
    -- Turnos de sector cerrados en el período: el trabajo real del taller, haya habido o no
    -- jornada de demanda. Es el número que faltaba para poder comparar una cosa con la otra.
    'turnos_sector',   (select count(*) from prod_jornada_sector where fecha between v_desde and v_hasta),
    -- Sigue usando prod_placa.rendimiento (la medida principal) y NO el rendimiento_total de
    -- la 0174. A propósito: el histórico tiene que cuadrar con lo que efectivamente entró al
    -- stock, y las medidas extra de las placas combinadas recién se acreditan desde la 0174.
    -- Contarlas hacia atrás inflaría la serie con piezas que nunca figuraron en el inventario.
    -- Vale revisarlo cuando la 0174 lleve un tiempo corriendo.
    'piezas_cortadas', (select coalesce(sum(greatest(c.hojas * coalesce(pl.rendimiento,0) - c.desperdicio, 0)),0)
                          from prod_v_corte_dia c
                          left join prod_placa pl on pl.sku = c.placa_sku
                          where c.dia between v_desde and v_hasta),
    'melamina_term',   (select coalesce(sum(m.terminadas),0) from prod_v_melamina_dia m where m.dia between v_desde and v_hasta),
    'melamina_fallas', (select coalesce(sum(m.fallas),0)     from prod_v_melamina_dia m where m.dia between v_desde and v_hasta),
    'patas_term',      (select coalesce(sum(p.terminadas),0) from prod_v_pino_dia     p where p.dia between v_desde and v_hasta),
    'embalado',        (select coalesce(sum(e.unidades),0)   from prod_v_embalaje_dia e where e.dia between v_desde and v_hasta),
    'mant_recibidos',  (select count(*) from prod_mantenimiento where estado='recibido_director' and created_at::date between v_desde and v_hasta),
    -- Cuánto de todo eso quedó sin imputar a una jornada de demanda.
    'sin_jornada_demanda', (
      (select count(*) from prod_v_corte_dia    x where x.jornada_id is null and x.dia between v_desde and v_hasta) +
      (select count(*) from prod_v_melamina_dia x where x.jornada_id is null and x.dia between v_desde and v_hasta) +
      (select count(*) from prod_v_pino_dia     x where x.jornada_id is null and x.dia between v_desde and v_hasta) +
      (select count(*) from prod_v_embalaje_dia x where x.jornada_id is null and x.dia between v_desde and v_hasta))
  ) into v_kpis;

  -- Comparativa: embalado período actual vs anterior (misma longitud)
  select coalesce(sum(e.unidades),0) into v_emb_actual
    from prod_v_embalaje_dia e where e.dia between v_desde and v_hasta;
  select coalesce(sum(e.unidades),0) into v_emb_prev
    from prod_v_embalaje_dia e where e.dia between v_prev_desde and v_prev_hasta;

  -- Serie por día: días con jornada de demanda UNION días con turno de sector.
  select coalesce(jsonb_agg(to_jsonb(d) order by d.dia), '[]'::jsonb) into v_por_dia from (
    select x.dia,
      (select coalesce(sum(greatest(c.hojas * coalesce(pl.rendimiento,0) - c.desperdicio, 0)),0)
         from prod_v_corte_dia c left join prod_placa pl on pl.sku = c.placa_sku where c.dia = x.dia) as cortes,
      (select coalesce(sum(m.terminadas),0) from prod_v_melamina_dia m where m.dia = x.dia) as melamina,
      (select coalesce(sum(p.terminadas),0) from prod_v_pino_dia     p where p.dia = x.dia) as pino,
      (select coalesce(sum(e.unidades),0)   from prod_v_embalaje_dia e where e.dia = x.dia) as embalaje
    from (
      select fecha as dia from prod_jornada        where fecha between v_desde and v_hasta
      union
      select fecha        from prod_jornada_sector where fecha between v_desde and v_hasta
    ) x
  ) d;

  -- Top productos embalados
  select coalesce(jsonb_agg(to_jsonb(t) order by t.unidades desc), '[]'::jsonb) into v_top from (
    select e.producto_sku, coalesce(pr.nombre, e.producto_sku) as nombre, sum(e.unidades) as unidades
      from prod_v_embalaje_dia e
      left join prod_producto pr on pr.sku = e.producto_sku
      where e.dia between v_desde and v_hasta
      group by e.producto_sku, pr.nombre
      order by unidades desc limit 15
  ) t;

  -- Mantenimientos recibidos por el director en el período
  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at desc), '[]'::jsonb) into v_mant from (
    select id, sector, tipo, urgencia, maquina, descripcion, created_at
      from prod_mantenimiento
      where estado='recibido_director' and created_at::date between v_desde and v_hasta
  ) m;

  return jsonb_build_object(
    'desde', v_desde, 'hasta', v_hasta,
    'kpis', v_kpis,
    'comparativa', jsonb_build_object('embalado_actual', v_emb_actual, 'embalado_prev', v_emb_prev,
                                      'prev_desde', v_prev_desde, 'prev_hasta', v_prev_hasta),
    'por_dia', v_por_dia,
    'top_productos', v_top,
    'mantenimientos', v_mant
  );
end $fn$;

revoke all on function public.prod_rpc_director_historico(jsonb) from public, anon;
grant execute on function public.prod_rpc_director_historico(jsonb) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════════════
-- F. Estado de sectores: día operativo, "abrió hoy", turno colgado de ayer
-- ══════════════════════════════════════════════════════════════════════════════════════════
--
-- Tres arreglos sobre la versión de la 0173:
--
-- 1. `fecha_operativa` = coalesce(fecha de la jornada, current_date). El panel del encargado
--    necesita un día para leer producción aunque no haya jornada; que lo dé la base y no el
--    reloj del navegador (una tablet del taller con la hora mal desplazaba todo un día).
--
-- 2. `abrio_hoy` / `ultimo_cierre_hoy`. El cartel ámbar "Sin abrir todavía — no puede cargar
--    producción" se pintaba con `ultimo_cierre`, que era el máximo histórico: después del
--    primer cierre de la vida de ese sector, el cartel ya no podía volver a aparecer nunca.
--    La alarma más importante del panel se apagaba sola a los dos días.
--
-- 3. `turno_de_otro_dia`. Un turno que quedó abierto de ayer se sigue comiendo lo que se carga
--    hoy. No se cierra solo (nadie quiere que el sistema le cierre el turno a alguien que está
--    trabajando de noche), pero se avisa, que es lo que hace falta para que el operario lo
--    cierre y abra el de hoy.
--
-- `ultimo_turno_id` es el último turno del sector EN EL DÍA operativo, abierto o cerrado: con
-- eso la pantalla del sector puede seguir mostrando lo que cargó después de cerrar, en vez de
-- quedarse en blanco como si no hubiera trabajado.

create or replace function public.prod_rpc_sector_estado(p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_mio text; v_j uuid; v_fecha date; v_dia date; v_out jsonb;
begin
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('cnc','melamina','pino','embalaje','encargado','owner','admin') then
    raise exception 'Sin permiso.' using errcode='42501';
  end if;

  v_mio := public.prod_fn_sector_de_rol(v_role);
  v_j   := public.prod_fn_jornada_lp_abierta();
  select fecha into v_fecha from public.prod_jornada where id = v_j;
  v_dia := coalesce(v_fecha, current_date);

  select coalesce(jsonb_agg(x order by x->>'sector'), '[]'::jsonb) into v_out from (
    select jsonb_build_object(
      'sector', s.sector,
      'abierta', (t.id is not null),
      'turno_id', t.id,
      'abierta_at', t.abierta_at,
      'abierta_por', t.abierta_por,
      'abierta_por_nombre', p.name,
      'jornada_id', t.jornada_id,
      'fecha', t.fecha,
      -- El turno abierto arrastra de un día anterior: lo que se cargue hoy queda contado ahí.
      'turno_de_otro_dia', (t.id is not null and t.fecha is distinct from v_dia),
      -- El último cierre de toda la historia. Sirve para "cerró hace 3 h" y nada más: para
      -- decidir si el sector trabajó hoy hay que mirar abrio_hoy.
      'ultimo_cierre', (select max(z.cerrada_at) from public.prod_jornada_sector z
                         where z.sector = s.sector and z.estado='cerrada'),
      'abrio_hoy', exists (select 1 from public.prod_jornada_sector z
                            where z.sector = s.sector and z.fecha = v_dia),
      'ultimo_cierre_hoy', (select max(z.cerrada_at) from public.prod_jornada_sector z
                             where z.sector = s.sector and z.fecha = v_dia and z.estado='cerrada'),
      -- Último turno del día (abierto o cerrado): con esto la pantalla del sector sigue
      -- mostrando lo que cargó aunque ya haya cerrado.
      'ultimo_turno_id', (select z.id from public.prod_jornada_sector z
                           where z.sector = s.sector and z.fecha = v_dia
                           order by z.abierta_at desc limit 1),
      'turnos_hoy', (select count(*) from public.prod_jornada_sector z
                      where z.sector = s.sector and z.fecha = v_dia)
    ) as x
    from (values ('cnc'),('melamina'),('pino'),('embalaje')) as s(sector)
    left join public.prod_jornada_sector t
           on t.sector = s.sector and t.estado = 'abierta'
    left join public.profiles p on p.id = t.abierta_por
  ) q;

  return jsonb_build_object(
    'mi_sector', v_mio,
    'jornada_id', v_j,
    'fecha', v_fecha,
    -- El día que la pantalla tiene que usar para leer producción. Nunca null.
    'fecha_operativa', v_dia,
    'hoy', current_date,
    'hay_jornada_demanda', (v_j is not null),
    'sectores', v_out);
end $fn$;

revoke all on function public.prod_rpc_sector_estado(jsonb) from public, anon;
grant execute on function public.prod_rpc_sector_estado(jsonb) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════════════
-- G. prod_v_turnos con fecha
-- ══════════════════════════════════════════════════════════════════════════════════════════
--
-- La pantalla de historial de turnos filtra por día; sin la columna tendría que traerse todo
-- y filtrar en el navegador. `drop` sin cascade a propósito: si algo dependiera de la vista,
-- que falle acá y no en silencio.

drop view if exists public.prod_v_turnos;

create view public.prod_v_turnos with (security_invoker = true) as
select t.id, t.sector, t.estado, t.fecha, t.jornada_id, j.fecha as jornada_fecha,
       t.abierta_at, t.cerrada_at,
       round(extract(epoch from (coalesce(t.cerrada_at, now()) - t.abierta_at)) / 3600.0, 1) as horas,
       t.abierta_por, pa.name as abierta_por_nombre,
       t.cerrada_por, pc.name as cerrada_por_nombre,
       t.resumen
from public.prod_jornada_sector t
left join public.prod_jornada j on j.id = t.jornada_id
left join public.profiles pa on pa.id = t.abierta_por
left join public.profiles pc on pc.id = t.cerrada_por;

revoke all on public.prod_v_turnos from public, anon;
grant select on public.prod_v_turnos to authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════════════
-- H. Los dos revoke que faltaban
-- ══════════════════════════════════════════════════════════════════════════════════════════
--
-- prod_fn_exigir_turno y prod_fn_sector_turno sí tienen su revoke en la 0173. Estas dos no, y
-- son igual de SECURITY DEFINER: quedaron ejecutables por PUBLIC (o sea, también por anon con
-- la clave pública). No exponen datos graves, pero la regla del proyecto es que ninguna
-- SECURITY DEFINER interna sea invocable desde el cliente. Se cierra el descuido.
--
-- Ninguna vista ni policy las usa (sólo las llaman RPC SECURITY DEFINER, que corren como
-- dueño), así que revocar no rompe nada.

revoke execute on function public.prod_fn_jornada_lp_abierta() from public, anon, authenticated;
revoke execute on function public.prod_fn_sector_de_rol(public.role_enum) from public, anon, authenticated;

commit;

-- ══════════════════════════════════════════════════════════════════════════════════════════
-- Rollback
-- ══════════════════════════════════════════════════════════════════════════════════════════
--   drop view if exists public.prod_v_corte_dia, public.prod_v_melamina_dia,
--                       public.prod_v_pino_dia,  public.prod_v_embalaje_dia;
--   alter table public.prod_jornada_sector drop column if exists fecha;
--   -- y volver a aplicar las definiciones de 0173 para prod_rpc_sector_estado / prod_v_turnos,
--   -- y las vivas antes de esta migración para prod_rpc_dashboard / prod_rpc_cerrar_jornada /
--   -- prod_rpc_director_historico.
