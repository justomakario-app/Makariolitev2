-- 0147 (LOCAL): RECONCILIACIÓN multijornada + cierre de auditoría. Append-only. No re-ejecutar en remoto.
--
-- CONTEXTO: YA EXISTE el sistema `jornadas` (dashboard): status abierta/cerrada, singleton is_active (la
-- "en ejecución"), hasta 3 abiertas y hasta 3 días adelante (rpc_open_jornada con FOR UPDATE, sin TOCTOU),
-- orders.jornada_id como ÚNICA asociación de ventas (import/manual/arrastre lo setean), y las RPC
-- rpc_open_jornada / rpc_set_active_jornada / rpc_close_jornada (con arrastre) + fn_resolve_active_jornada.
-- Lo agregado en 0138 sobre prod_jornada era un multijornada PARALELO (segunda fuente de verdad).
--
-- ESTE ARCHIVO reconcilia SIN reescribir migraciones anteriores:
--   (R1) prod_jornada pasa a ser un ESPEJO 1:1 de jornadas (MISMO id) mantenido por trigger: abrir/activar/
--        pausar(=desactivar)/cerrar del dashboard se reflejan de inmediato en LP, con el mismo identificador.
--   (R2) prod_fn_jornada_activa() resuelve la activa REAL (jornadas.is_active). Toda la LP la usa.
--   (R3) el tope de 3 lo controla SOLO jornadas: se elimina el trigger propio prod_tg_jornada_max_ins.
--   (R4) la asociación de ventas es orders.jornada_id (la MISMA del dashboard): prod_fn_candidatos —único
--        punto de selección que usan vincular/sync— pasa a derivar de orders.jornada_id (sin selección
--        paralela por fecha/lote ni exclusión cross-jornada: el FK único ya garantiza una sola jornada).
--   (R5) las RPC de jornada de LP DELEGAN en las RPC existentes (un solo flujo, sin flujos paralelos).
--
-- Y cierra la auditoría adversarial de multijornada (5 hallazgos confirmados):
--   (H1 alto) RLS INSERT/UPDATE directas sobre prod_jornada saltaban tope/guardas/kill-switch → como ahora
--             es un espejo derivado, se ELIMINAN sus policies de escritura (queda de solo lectura; sólo el
--             trigger SECURITY DEFINER lo escribe). No hay forma de desincronizar el espejo por PostgREST.
--   (H2 alto) un pedido activo en 2 jornadas → al derivar de orders.jornada_id (FK única) es estructuralmente
--             imposible; además el bloque de REACTIVACIÓN de jornada_sync se acota a o.jornada_id=v_j.
--   (H3 medio) reservar_jornada dimensionaba con la demanda en_ejecucion pero escribía al jornada_id recibido
--             → ahora reserva SIEMPRE sobre la jornada en ejecución (rechaza un jornada_id distinto).
--   (H4 medio) cerrar_jornada dejaba reservas/tareas colgadas → al cerrar una jornada se LIBERAN sus
--             reservas/en_proceso a disponible (vía el trigger de espejo).
--   (H5 bajo) crear_solicitud usaba el resolvedor legacy (fecha=hoy) → usa prod_fn_jornada_activa().
--
-- Producción legacy, `jornadas` y sus RPC quedan intactos. prod_jornada está VACÍA en remoto (LP nunca
-- operó): el espejo no colisiona con datos existentes.

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
-- (H1) prod_jornada pasa a SOLO LECTURA: se eliminan las policies de escritura directa (era el bypass).
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
drop policy if exists prod_jornada_ins on public.prod_jornada;
drop policy if exists prod_jornada_upd on public.prod_jornada;
-- (se conserva prod_jornada_sel: la UI necesita leer la jornada). La escritura es exclusiva del trigger.

-- (R3) el tope de 3 y su serialización viven SOLO en jornadas.rpc_open_jornada. Se retira el tope propio.
drop trigger if exists prod_tg_jornada_max_ins on public.prod_jornada;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
-- (H4) liberar reservas/en_proceso de una jornada (devuelve input a 'disponible' y cancela la tarea).
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.prod_fn_liberar_jornada_reservas(p_jornada uuid)
returns void language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare tr record;
begin
  for tr in select * from public.prod_tarea where jornada_id=p_jornada and estado in ('reservada','en_proceso') for update loop
    if tr.reservado>0 then
      perform public.prod_fn_stock_apply(tr.input_pool,tr.input_sku,tr.reservado,-tr.reservado,0);
      insert into public.prod_stock_mov(jornada_id,tarea_id,pool,sku,tipo,cantidad,motivo,usuario)
        values(p_jornada,tr.id,tr.input_pool,tr.input_sku,'devolver',tr.reservado,'cierre de jornada libera reserva',auth.uid());
    end if;
    if tr.en_proceso>0 then
      perform public.prod_fn_stock_apply(tr.input_pool,tr.input_sku,tr.en_proceso,0,-tr.en_proceso);
      insert into public.prod_stock_mov(jornada_id,tarea_id,pool,sku,tipo,cantidad,motivo,usuario)
        values(p_jornada,tr.id,tr.input_pool,tr.input_sku,'devolver',tr.en_proceso,'cierre de jornada libera en_proceso',auth.uid());
    end if;
    update public.prod_tarea set estado='cancelada', reservado=0, en_proceso=0,
      nota=coalesce(nota,'')||' [liberada por cierre de jornada]' where id=tr.id;
  end loop;
end $fn$;
revoke execute on function public.prod_fn_liberar_jornada_reservas(uuid) from public, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
-- (R1) Espejo prod_jornada ← jornadas (mismo id). estado/fase derivan de status/is_active.
--   status='cerrada'            → estado='cerrada', fase='cerrada'  (+ libera reservas de esa jornada)
--   status='abierta' & is_active→ estado='abierta', fase='en_ejecucion'
--   status='abierta' & !active  → estado='abierta', fase='pausada'
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.prod_fn_sync_jornada(p_id uuid)
returns void language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare j record; v_fase text; v_estado text;
begin
  select id, fecha, status, is_active, abierta_at, closed_at into j from public.jornadas where id=p_id;
  if not found then return; end if;
  if j.status='cerrada' then v_estado:='cerrada'; v_fase:='cerrada';
  elsif j.is_active then    v_estado:='abierta'; v_fase:='en_ejecucion';
  else                      v_estado:='abierta'; v_fase:='pausada';
  end if;
  -- salvaguarda del singleton: nunca dejar dos 'en_ejecucion' (los flujos de jornadas ya demoten la anterior
  -- en un statement separado, pero un UPDATE multi-fila directo podría intentarlo).
  if v_fase='en_ejecucion' then
    update public.prod_jornada set fase='pausada' where fase='en_ejecucion' and id <> p_id;
  end if;
  insert into public.prod_jornada (id, fecha, estado, fase, abierta_at, cerrada_at)
    values (j.id, j.fecha, v_estado, v_fase, j.abierta_at, j.closed_at)
  on conflict (id) do update set fecha=excluded.fecha, estado=excluded.estado, fase=excluded.fase, cerrada_at=excluded.cerrada_at;
  -- (H4) al cerrar, liberar reservas/en_proceso de la jornada (idempotente: luego no quedan tareas abiertas).
  if v_estado='cerrada' then perform public.prod_fn_liberar_jornada_reservas(j.id); end if;
end $fn$;
revoke execute on function public.prod_fn_sync_jornada(uuid) from public, anon, authenticated;

create or replace function public.prod_tg_sync_jornada() returns trigger
language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
begin perform public.prod_fn_sync_jornada(new.id); return new; end $fn$;
revoke execute on function public.prod_tg_sync_jornada() from public, anon, authenticated;
drop trigger if exists prod_tg_sync_jornada_aiu on public.jornadas;
create trigger prod_tg_sync_jornada_aiu after insert or update on public.jornadas
  for each row execute function public.prod_tg_sync_jornada();

-- backfill: espejar todas las jornadas existentes (idempotente).
do $$ declare r record; begin
  for r in select id from public.jornadas loop perform public.prod_fn_sync_jornada(r.id); end loop;
end $$;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
-- (R2) La jornada activa de LP = la activa REAL de jornadas (is_active). Toda la LP resuelve por acá.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.prod_fn_jornada_activa()
returns uuid language sql stable security definer set search_path to 'public','pg_temp' as $fn$
  select id from public.jornadas where status='abierta' and is_active=true limit 1;
$fn$;
revoke execute on function public.prod_fn_jornada_activa() from public, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
-- (R4/H2) prod_fn_candidatos = las ventas que el DASHBOARD asoció a esa jornada (orders.jornada_id). Único
--   punto de selección de vincular/sync. Al ser el FK único la fuente, un pedido nunca está en 2 jornadas.
--   Se conserva la firma (p_origen se ignora: la selección por fecha/lote/arrastre ya no aplica — la hace
--   el dashboard). Se mantienen las exclusiones de negocio (pendiente/arrastrado, no cancelado, con saldo
--   por asignar, no excluido por estado externo).
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.prod_fn_candidatos(p_origen jsonb, p_jornada uuid)
returns table(order_id uuid, sku text, channel text, cantidad integer, estado text)
language sql stable security definer set search_path to 'public','pg_temp' as $fn$
  select o.id, o.sku, o.channel_id::text, o.cantidad, o.status::text
  from public.orders o
  where o.jornada_id = p_jornada
    and o.status::text in ('pendiente','arrastrado') and o.cancelled_at is null
    and (o.cantidad - public.prod_fn_asignado(o.id)) > 0
    and not public.prod_fn_orden_excluida(o.id);
$fn$;
revoke execute on function public.prod_fn_candidatos(jsonb, uuid) from public, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
-- vincular_preview (SOLO LECTURA, NO gateado por el flag): ventas de la jornada que aún requieren producción.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.prod_rpc_vincular_preview(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_j uuid; v_origen jsonb;
begin
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_j := coalesce(nullif(p_payload->>'jornada_id','')::uuid, public.prod_fn_jornada_activa());
  v_origen := coalesce(p_payload->'origen','{}'::jsonb);
  return jsonb_build_object('jornada_id', v_j, 'origen', v_origen,
    'total_ventas', (select count(*) from prod_fn_candidatos(v_origen, v_j)),
    'total_unidades', (select coalesce(sum(cantidad),0) from prod_fn_candidatos(v_origen, v_j)),
    'ya_vinculadas_en_jornada', (select count(*) from prod_jornada_orden jo where jo.jornada_id=v_j and coalesce(jo.snapshot_status,'')<>'cancelada'),
    'detalle', coalesce((select jsonb_agg(jsonb_build_object('sku',sku,'unidades',cantidad,'canal',channel) order by sku) from prod_fn_candidatos(v_origen, v_j)), '[]'::jsonb));
end $fn$;

-- vincular_confirmar (MUTA, gateada por el flag): snapshotea las ventas de la jornada + auto-asigna libre.
create or replace function public.prod_rpc_vincular_confirmar(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_j uuid; v_origen jsonb; v_estado text; v_new int; v_origen_txt text; v_asig int;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_j := coalesce(nullif(p_payload->>'jornada_id','')::uuid, public.prod_fn_jornada_activa());
  if v_j is null then raise exception 'No hay jornada activa (abrí/activá una desde el dashboard).' using errcode='P0002'; end if;
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
  v_asig := prod_fn_autoasignar_jornada(v_j, 'vincular');
  return jsonb_build_object('ok', true, 'jornada_id', v_j, 'vinculadas_nuevas', v_new, 'auto_asignadas_de_stock_libre', v_asig,
    'total_en_jornada', (select count(*) from prod_jornada_orden where jornada_id=v_j and coalesce(snapshot_status,'')<>'cancelada'));
end $fn$;

-- jornada_sync (MUTA, gateada): reactivación (acotada a la jornada), cancelación/archivado global (libera),
--   cambios de cantidad/SKU, nuevas ventas de la jornada, y auto-asignación. Preserva lo producido.
create or replace function public.prod_rpc_jornada_sync(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_j uuid; v_est text; v_origen jsonb; v_origen_txt text;
  v_new int:=0; v_upd int:=0; v_can int:=0; v_cum int:=0; v_react int:=0; v_anom int:=0; v_lib int:=0; v_asig int;
  r record; v_asignado int; v_exceso int;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_j := coalesce(nullif(p_payload->>'jornada_id','')::uuid, public.prod_fn_jornada_activa());
  select estado into v_est from prod_jornada where id = v_j;
  if v_j is null or v_est is null then raise exception 'Jornada inexistente.' using errcode='P0002'; end if;
  if v_est <> 'abierta' then raise exception 'La jornada no esta abierta (%).', v_est using errcode='42501'; end if;
  v_origen := coalesce(p_payload->'origen','{}'::jsonb);
  v_origen_txt := 'sync:'||coalesce(v_origen->>'tipo','manual');

  -- (A) REACTIVACIÓN — acotada a órdenes que pertenecen a esta jornada (H2: evita cruce entre jornadas).
  with react as (
    select o.id order_id, o.sku, o.channel_id::text ch, o.cantidad, o.status::text st
    from orders o
    where o.jornada_id = v_j and o.cancelled_at is null and o.status::text in ('pendiente','arrastrado')
      and exists (select 1 from prod_jornada_orden jo where jo.order_id=o.id and coalesce(jo.snapshot_status,'')='cancelada')
      and not exists (select 1 from prod_jornada_orden j2 where j2.order_id=o.id and j2.jornada_id=v_j and coalesce(j2.snapshot_status,'') not in ('cancelada','cumplida'))
  ), ins as (
    insert into prod_jornada_orden (jornada_id, order_id, snapshot_sku, snapshot_channel, snapshot_cantidad, snapshot_status, vinculada_por)
    select v_j, order_id, sku, ch, cantidad, st, auth.uid() from react
    on conflict (jornada_id, order_id) do update set snapshot_status = excluded.snapshot_status, snapshot_cantidad = excluded.snapshot_cantidad
    returning order_id, snapshot_cantidad)
  insert into prod_jornada_orden_log(jornada_id,order_id,accion,cantidad_anterior,cantidad_nueva,estado_anterior,estado_nuevo,origen,usuario)
  select v_j, order_id, 'reactivada', null, snapshot_cantidad, 'cancelada', 'pendiente', v_origen_txt, auth.uid() from ins;
  get diagnostics v_react = row_count;

  -- (B) CANCELACIÓN GLOBAL (incl. jornadas cerradas): liberar el neto del SKU del snapshot, 1 sola vez.
  for r in
    select jo.jornada_id, jo.order_id, jo.snapshot_sku, jo.snapshot_cantidad, jo.snapshot_status
    from prod_jornada_orden jo join orders o on o.id=jo.order_id
    where coalesce(jo.snapshot_status,'') not in ('cancelada','cumplida') and o.cancelled_at is not null
  loop
    perform pg_advisory_xact_lock(hashtext('prod_term:'||r.snapshot_sku));
    v_asignado := prod_fn_asignado(r.order_id, r.snapshot_sku);
    if v_asignado > 0 then
      insert into prod_asignacion(order_id,producto_sku,jornada_id,cantidad,tipo,origen,motivo,usuario)
        values (r.order_id,r.snapshot_sku,r.jornada_id,-v_asignado,'liberada',v_origen_txt,'cancelacion',auth.uid());
      insert into prod_stock_terminado(producto_sku,disponible) values(r.snapshot_sku,v_asignado)
        on conflict (producto_sku) do update set disponible=prod_stock_terminado.disponible+v_asignado, updated_at=now();
      v_lib := v_lib + v_asignado;
    end if;
    update prod_jornada_orden set snapshot_status='cancelada' where jornada_id=r.jornada_id and order_id=r.order_id;
    insert into prod_jornada_orden_log(jornada_id,order_id,accion,cantidad_anterior,cantidad_nueva,estado_anterior,estado_nuevo,origen,usuario)
      values (r.jornada_id,r.order_id,'cancelada',r.snapshot_cantidad,v_asignado,r.snapshot_status,'cancelada',v_origen_txt,auth.uid());
    v_can := v_can+1;
  end loop;

  -- (C) ARCHIVADO = cumplido/despachado: NO liberar; anomalía si quedó pendiente.
  for r in
    select jo.jornada_id, jo.order_id, jo.snapshot_sku, jo.snapshot_cantidad, jo.snapshot_status
    from prod_jornada_orden jo join orders o on o.id=jo.order_id
    where coalesce(jo.snapshot_status,'') not in ('cancelada','cumplida') and o.cancelled_at is null and o.status::text='archivado'
  loop
    v_asignado := prod_fn_asignado(r.order_id, r.snapshot_sku);
    update prod_jornada_orden set snapshot_status='cumplida' where jornada_id=r.jornada_id and order_id=r.order_id;
    if v_asignado < r.snapshot_cantidad then
      insert into prod_jornada_orden_log(jornada_id,order_id,accion,cantidad_anterior,cantidad_nueva,estado_anterior,estado_nuevo,origen,usuario)
        values (r.jornada_id,r.order_id,'anomalia',r.snapshot_cantidad,v_asignado,r.snapshot_status,'archivado_con_pendiente',v_origen_txt,auth.uid());
      v_anom := v_anom+1;
    else
      insert into prod_jornada_orden_log(jornada_id,order_id,accion,cantidad_anterior,cantidad_nueva,estado_anterior,estado_nuevo,origen,usuario)
        values (r.jornada_id,r.order_id,'cumplida',r.snapshot_cantidad,v_asignado,r.snapshot_status,'cumplida',v_origen_txt,auth.uid());
    end if;
    v_cum := v_cum+1;
  end loop;

  -- (D) CAMBIOS de cantidad O de SKU en la jornada abierta (pedidos activos).
  for r in
    select jo.order_id, jo.snapshot_sku, jo.snapshot_cantidad, jo.snapshot_status,
           o.cantidad cant_actual, o.status::text estado_actual, o.sku sku_actual
    from prod_jornada_orden jo join orders o on o.id=jo.order_id
    where jo.jornada_id=v_j and coalesce(jo.snapshot_status,'') not in ('cancelada','cumplida')
      and o.cancelled_at is null and o.status::text in ('pendiente','arrastrado')
      and (o.cantidad is distinct from jo.snapshot_cantidad or o.sku is distinct from jo.snapshot_sku)
  loop
    perform pg_advisory_xact_lock(hashtext('prod_term:'||r.snapshot_sku));
    if r.sku_actual is distinct from r.snapshot_sku then
      v_asignado := prod_fn_asignado(r.order_id, r.snapshot_sku);
      if v_asignado > 0 then
        insert into prod_asignacion(order_id,producto_sku,jornada_id,cantidad,tipo,origen,motivo,usuario)
          values (r.order_id,r.snapshot_sku,v_j,-v_asignado,'liberada',v_origen_txt,'cambio_sku',auth.uid());
        insert into prod_stock_terminado(producto_sku,disponible) values(r.snapshot_sku,v_asignado)
          on conflict (producto_sku) do update set disponible=prod_stock_terminado.disponible+v_asignado, updated_at=now();
        v_lib := v_lib + v_asignado;
      end if;
      update prod_jornada_orden set snapshot_sku=r.sku_actual, snapshot_cantidad=r.cant_actual, snapshot_status=r.estado_actual
        where jornada_id=v_j and order_id=r.order_id;
      insert into prod_jornada_orden_log(jornada_id,order_id,accion,cantidad_anterior,cantidad_nueva,estado_anterior,estado_nuevo,origen,usuario)
        values (v_j,r.order_id,'actualizada',r.snapshot_cantidad,r.cant_actual,'sku '||r.snapshot_sku,'sku '||r.sku_actual,v_origen_txt,auth.uid());
    else
      v_asignado := prod_fn_asignado(r.order_id, r.snapshot_sku);
      if r.cant_actual < v_asignado then
        v_exceso := v_asignado - r.cant_actual;
        insert into prod_asignacion(order_id,producto_sku,jornada_id,cantidad,tipo,origen,motivo,usuario)
          values (r.order_id,r.snapshot_sku,v_j,-v_exceso,'liberada',v_origen_txt,'reduccion',auth.uid());
        insert into prod_stock_terminado(producto_sku,disponible) values(r.snapshot_sku,v_exceso)
          on conflict (producto_sku) do update set disponible=prod_stock_terminado.disponible+v_exceso, updated_at=now();
        v_lib := v_lib + v_exceso;
      end if;
      update prod_jornada_orden set snapshot_cantidad=r.cant_actual, snapshot_status=r.estado_actual where jornada_id=v_j and order_id=r.order_id;
      insert into prod_jornada_orden_log(jornada_id,order_id,accion,cantidad_anterior,cantidad_nueva,estado_anterior,estado_nuevo,origen,usuario)
        values (v_j,r.order_id,'actualizada',r.snapshot_cantidad,r.cant_actual,r.snapshot_status,r.estado_actual,v_origen_txt,auth.uid());
    end if;
    v_upd := v_upd+1;
  end loop;

  -- (E) NUEVAS ventas de la jornada (orders.jornada_id) aún no snapshoteadas.
  with cand as (select * from prod_fn_candidatos(v_origen, v_j)),
  ins as (
    insert into prod_jornada_orden (jornada_id, order_id, snapshot_sku, snapshot_channel, snapshot_cantidad, snapshot_status, vinculada_por)
    select v_j, order_id, sku, channel, cantidad, estado, auth.uid() from cand
    on conflict (jornada_id, order_id) do nothing
    returning order_id, snapshot_cantidad, snapshot_status)
  insert into prod_jornada_orden_log(jornada_id,order_id,accion,cantidad_anterior,cantidad_nueva,estado_anterior,estado_nuevo,origen,usuario)
  select v_j, order_id, 'vinculada', null, snapshot_cantidad, null, snapshot_status, v_origen_txt, auth.uid() from ins;
  get diagnostics v_new = row_count;

  v_asig := prod_fn_autoasignar_jornada(v_j, 'sync');
  return jsonb_build_object('ok',true,'jornada_id',v_j,'nuevas',v_new,'actualizadas',v_upd,'canceladas',v_can,
    'cumplidas',v_cum,'reactivadas',v_react,'anomalias_archivado_con_pendiente',v_anom,
    'liberadas_a_stock_libre',v_lib,'auto_asignadas_de_stock_libre',v_asig);
end $fn$;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
-- (R5) Las RPC de jornada de LP DELEGAN en el sistema existente (un solo flujo, mismo tope/permiso/arrastre).
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
-- abrir/retomar: usa fn_resolve_active_jornada (abre/activa la del dashboard).
create or replace function public.prod_rpc_abrir_jornada(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_id uuid; v_fecha date;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_id := public.fn_resolve_active_jornada('Linea Productiva: abrir jornada', false);  -- sistema existente
  select fecha into v_fecha from public.jornadas where id=v_id;
  return jsonb_build_object('ok',true,'jornada_id',v_id,'fecha',v_fecha,'retomada',true);
end $fn$;

-- planificar: abre una jornada (dashboard) para la fecha dada (valida rol, tope 3, 3 días adelante).
create or replace function public.prod_rpc_planificar_jornada(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_row public.jornadas; v_fecha date;
begin
  perform public.prod_fn_guard_lp();
  v_fecha := coalesce(nullif(p_payload->>'fecha','')::date, current_date);
  v_row := public.rpc_open_jornada(v_fecha);  -- sistema existente
  return jsonb_build_object('ok',true,'jornada_id',v_row.id,'fecha',v_row.fecha,
    'fase', case when v_row.is_active then 'en_ejecucion' else 'pausada' end);
end $fn$;

-- ejecutar: activa una jornada abierta (dashboard).
create or replace function public.prod_rpc_ejecutar_jornada(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_id uuid; v_row public.jornadas;
begin
  perform public.prod_fn_guard_lp();
  v_id := nullif(p_payload->>'jornada_id','')::uuid;
  if v_id is null then raise exception 'jornada_id requerido.' using errcode='22023'; end if;
  v_row := public.rpc_set_active_jornada(v_id);  -- sistema existente
  return jsonb_build_object('ok',true,'jornada_id',v_row.id,'fase','en_ejecucion');
end $fn$;

-- pausar: el sistema existente no tiene "pausa" explícita; activar otra jornada cambia la activa.
create or replace function public.prod_rpc_pausar_jornada(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
begin
  perform public.prod_fn_guard_lp();
  raise exception 'El sistema de jornadas no admite "pausar" aislado: activá otra jornada abierta para cambiar la activa (dashboard o "Ejecutar").' using errcode='0A000';
end $fn$;

-- cerrar: cierra la jornada (dashboard, con arrastre) por fecha de la jornada indicada/activa.
create or replace function public.prod_rpc_cerrar_jornada(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_id uuid; v_fecha date; v_row public.jornadas;
begin
  perform public.prod_fn_guard_lp();
  v_id := coalesce(nullif(p_payload->>'jornada_id','')::uuid, public.prod_fn_jornada_activa());
  if v_id is null then raise exception 'No hay jornada activa para cerrar.' using errcode='P0002'; end if;
  select fecha into v_fecha from public.jornadas where id=v_id;
  v_row := public.rpc_close_jornada(v_fecha, null);  -- sistema existente (arrastre + libera reservas vía espejo)
  return jsonb_build_object('ok',true,'jornada_id',v_row.id,'cerrada',true);
end $fn$;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
-- (H3) reservar_jornada: SIEMPRE opera sobre la jornada en ejecución (no cruza demanda de A con reservas de
--   B). Idéntica a 0145 salvo la resolución de v_j al inicio.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.prod_rpc_reservar_jornada(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_j uuid; o record; v_placa record; v_hojas int; v_res int; v_disp int;
  v_creadas int:=0; v_incompletas int:=0; v_reservado_total int:=0; v_tam text; v_pr record; v_units int; v_enp int;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id=auth.uid();
  if v_role is null or v_active=false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_j := public.prod_fn_jornada_activa();
  if v_j is null then raise exception 'No hay jornada en ejecucion.' using errcode='P0002'; end if;
  -- (H3) si se pasa un jornada_id distinto de la en ejecución, se rechaza (la demanda se lee de la activa).
  if nullif(p_payload->>'jornada_id','') is not null and (p_payload->>'jornada_id')::uuid <> v_j then
    raise exception 'Solo se puede reservar sobre la jornada en ejecucion.' using errcode='42501';
  end if;
  for o in (select * from prod_tarea where jornada_id=v_j and estado in ('planificada','reservada')) loop
    if o.reservado>0 then
      perform public.prod_fn_stock_apply(o.input_pool,o.input_sku,o.reservado,-o.reservado,0);
      insert into prod_stock_mov(jornada_id,tarea_id,pool,sku,tipo,cantidad,motivo,usuario)
        values(v_j,o.id,o.input_pool,o.input_sku,'liberar',o.reservado,'recalculo reservar_jornada',auth.uid());
    end if;
    delete from prod_tarea where id=o.id;
  end loop;
  for o in (select sku, cantidad::int cant from prod_v_orden_sector where sector='cnc' and cantidad>0) loop
    select p.sku, p.rendimiento, p.mp_sku into v_placa from prod_placa p where p.pieza_sku=o.sku and p.combinada=false order by p.rendimiento desc limit 1;
    if not found or v_placa.rendimiento is null or v_placa.rendimiento=0 then
      insert into prod_tarea(jornada_id,sector,input_pool,input_sku,output_pool,output_sku,factor,input_plan,estado,nota)
        values(v_j,'cnc','mp',coalesce(v_placa.sku,'?'),'pieza',o.sku,1,0,'config_incompleta','sin placa/rendimiento para '||o.sku);
      v_incompletas:=v_incompletas+1; continue; end if;
    v_hojas := ceil(o.cant::numeric / v_placa.rendimiento)::int;
    select coalesce(sum(reservado+en_proceso),0) into v_enp from prod_tarea where jornada_id=v_j and sector='cnc' and output_sku=o.sku and estado='en_proceso';
    v_hojas := greatest(v_hojas - v_enp, 0);
    if v_hojas=0 then continue; end if;
    if v_placa.mp_sku is null then
      insert into prod_tarea(jornada_id,sector,input_pool,input_sku,output_pool,output_sku,factor,input_plan,estado,nota)
        values(v_j,'cnc','mp',v_placa.sku,'pieza',o.sku,v_placa.rendimiento,v_hojas,'config_incompleta','placa '||v_placa.sku||' sin materia prima configurada');
      v_incompletas:=v_incompletas+1; continue; end if;
    v_disp := public.prod_fn_stock_disp('mp',v_placa.mp_sku); v_res := least(v_hojas, v_disp);
    insert into prod_tarea(jornada_id,sector,input_pool,input_sku,output_pool,output_sku,factor,input_plan,reservado,estado)
      values(v_j,'cnc','mp',v_placa.mp_sku,'pieza',o.sku,v_placa.rendimiento,v_hojas,v_res, case when v_res>0 then 'reservada' else 'planificada' end);
    if v_res>0 then perform public.prod_fn_stock_apply('mp',v_placa.mp_sku,-v_res,v_res,0);
      insert into prod_stock_mov(jornada_id,pool,sku,tipo,cantidad,usuario) values(v_j,'mp',v_placa.mp_sku,'reservar',v_res,auth.uid());
      v_reservado_total:=v_reservado_total+v_res; end if;
    v_creadas:=v_creadas+1;
  end loop;
  for o in (select sku, cantidad::int cant from prod_v_orden_sector where sector='melamina' and cantidad>0) loop
    select coalesce(sum(reservado+en_proceso),0) into v_enp from prod_tarea where jornada_id=v_j and sector='melamina' and output_sku=o.sku and estado='en_proceso';
    v_units := greatest(o.cant - v_enp, 0);
    if v_units=0 then continue; end if;
    v_disp := public.prod_fn_stock_disp('pieza',o.sku); v_res := least(v_units, v_disp);
    insert into prod_tarea(jornada_id,sector,input_pool,input_sku,output_pool,output_sku,factor,input_plan,reservado,estado)
      values(v_j,'melamina','pieza',o.sku,'melamina',o.sku,1,v_units,v_res, case when v_res>0 then 'reservada' else 'planificada' end);
    if v_res>0 then perform public.prod_fn_stock_apply('pieza',o.sku,-v_res,v_res,0);
      insert into prod_stock_mov(jornada_id,pool,sku,tipo,cantidad,usuario) values(v_j,'pieza',o.sku,'reservar',v_res,auth.uid());
      v_reservado_total:=v_reservado_total+v_res; end if;
    v_creadas:=v_creadas+1;
  end loop;
  for o in (select sku, cantidad::int cant from prod_v_orden_sector where sector='pino' and cantidad>0) loop
    select tamano into v_tam from prod_pata_tamano where pieza_sku=o.sku;
    select * into v_pr from prod_pino_receta where tamano=v_tam;
    if v_tam is null or not found then
      insert into prod_tarea(jornada_id,sector,input_pool,input_sku,output_pool,output_sku,factor,input_plan,estado,nota)
        values(v_j,'pino','mp','?','patas',coalesce(v_tam,o.sku),1,0,'config_incompleta','sin receta de pino para '||o.sku);
      v_incompletas:=v_incompletas+1; continue; end if;
    v_units := ceil(o.cant::numeric / v_pr.patas_por_unidad)::int;
    select coalesce(sum(reservado+en_proceso),0) into v_enp from prod_tarea where jornada_id=v_j and sector='pino' and output_sku=v_tam and estado='en_proceso';
    v_units := greatest(v_units - v_enp, 0);
    if v_units=0 then continue; end if;
    v_disp := public.prod_fn_stock_disp('mp',v_pr.mp_sku); v_res := least(v_units, v_disp);
    insert into prod_tarea(jornada_id,sector,input_pool,input_sku,output_pool,output_sku,factor,input_plan,reservado,estado)
      values(v_j,'pino','mp',v_pr.mp_sku,'patas',v_tam,v_pr.patas_por_unidad,v_units,v_res, case when v_res>0 then 'reservada' else 'planificada' end);
    if v_res>0 then perform public.prod_fn_stock_apply('mp',v_pr.mp_sku,-v_res,v_res,0);
      insert into prod_stock_mov(jornada_id,pool,sku,tipo,cantidad,usuario) values(v_j,'mp',v_pr.mp_sku,'reservar',v_res,auth.uid());
      v_reservado_total:=v_reservado_total+v_res; end if;
    v_creadas:=v_creadas+1;
  end loop;
  return jsonb_build_object('ok',true,'jornada_id',v_j,'tareas_creadas',v_creadas,'config_incompletas',v_incompletas,'input_reservado',v_reservado_total);
end $fn$;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
-- (H5) crear_solicitud: resuelve la jornada por prod_fn_jornada_activa() (no por 'fecha=hoy and abierta').
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.prod_rpc_crear_solicitud(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_jornada uuid; v_id uuid;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('cnc','melamina','pino','embalaje','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_jornada := nullif(p_payload->>'jornada_id','')::uuid;
  if v_jornada is null then v_jornada := public.prod_fn_jornada_activa(); end if;
  insert into prod_solicitud (jornada_id, sector, items, estado, solicitado_por)
  values (v_jornada, nullif(trim(p_payload->>'sector'),''), coalesce(p_payload->'items','[]'::jsonb), 'pendiente', auth.uid())
  returning id into v_id;
  return jsonb_build_object('ok', true, 'solicitud_id', v_id);
end $fn$;

-- ── GRANTs (preview NO gateado; el resto muta y queda en authenticated; revoke anon/public) ──
grant execute on function public.prod_rpc_vincular_preview(jsonb) to authenticated;
do $$ declare f text; begin
  foreach f in array array[
    'prod_rpc_vincular_confirmar(jsonb)','prod_rpc_jornada_sync(jsonb)','prod_rpc_abrir_jornada(jsonb)',
    'prod_rpc_planificar_jornada(jsonb)','prod_rpc_ejecutar_jornada(jsonb)','prod_rpc_pausar_jornada(jsonb)',
    'prod_rpc_cerrar_jornada(jsonb)','prod_rpc_reservar_jornada(jsonb)','prod_rpc_crear_solicitud(jsonb)'] loop
    execute 'revoke all on function public.'||f||' from public, anon';
    execute 'grant execute on function public.'||f||' to authenticated';
  end loop; end $$;

-- ── Vista de solo lectura de jornadas para LP (consume las existentes; no crea paralelas) ──
create or replace view public.prod_v_jornadas as
  select j.id, j.fecha, j.status as estado,
    case when j.status='cerrada' then 'cerrada' when j.is_active then 'en_ejecucion' else 'pausada' end as fase,
    j.is_active, j.abierta_at, j.closed_at,
    (select count(*) from public.orders o where o.jornada_id=j.id and o.status::text in ('pendiente','arrastrado')) as pedidos_activos
  from public.jornadas j where j.status='abierta' or j.closed_at > now() - interval '2 days'
  order by j.fecha desc;
revoke all on public.prod_v_jornadas from public, anon;
grant select on public.prod_v_jornadas to authenticated;
