-- 0150: el cierre de Línea Productiva deja de arrastrar el cierre comercial. Append-only.
--
-- Síntoma reportado por el encargado (29/07): "cerré la jornada de línea productiva y me cerró
-- la de producción arrastrando todo al día siguiente ... son 2 sectores distintos".
--
-- Causa raíz (verificada contra el remoto, no supuesta): prod_rpc_cerrar_jornada delegaba el
-- cierre en public.rpc_close_jornada (0148, C1), que es el cierre COMERCIAL — archiva los
-- pedidos de la jornada y crea las copias de arrastre '-AYYYYMMDD' en la jornada siguiente. LP
-- no tenía cierre propio porque prod_jornada es un espejo 1:1 derivado de `jornadas`, escrito
-- únicamente por el trigger prod_tg_sync_jornada_aiu → prod_fn_sync_jornada.
--
-- Arreglo — darle a LP un cierre propio:
--   (A) prod_jornada gana columnas de LP: cierre_lp_at / cierre_lp_por, y el CHECK que ataba
--       fase y estado (bicondicional de la 0138) pasa a ser implicación: comercial cerrada ⇒ LP
--       cerrada, pero LP puede cerrar sola.
--   (B) prod_fn_sync_jornada respeta ese cierre. `fase` sigue reflejando el ciclo COMERCIAL
--       (is_active/status) y `estado` pasa a ser el estado de LP. La liberación de reservas
--       queda condicionada a jornadas.status='cerrada' — exactamente lo que disparaba antes —
--       y el cierre de LP la invoca por su cuenta, de modo que corre una sola vez por evento.
--   (C) prod_rpc_cerrar_jornada ya NO llama a rpc_close_jornada: marca el espejo y libera las
--       reservas de LP. Mismo contrato de respuesta que consume el frontend (ok /
--       requiere_confirmacion / mesas_pendientes_total / faltantes_piezas_count / resumen).
--   (D) prod_rpc_abrir_jornada limpia el cierre de LP ⇒ el mismo botón del panel del encargado
--       funciona como reabrir, sin cambiar el contrato con el frontend.
--   (E) prod_rpc_reservar_jornada gana la guardia de jornada abierta. Antes no le hacía falta:
--       tras el cierre comercial, prod_fn_jornada_activa() ya devolvía la jornada NUEVA. Al
--       desacoplar, la comercial sigue activa, así que sin esta guardia se podrían re-crear
--       reservas sobre una jornada de LP ya cerrada.
--
-- Por qué se reusa `estado` y no una columna nueva: las RPC que ya bloquean carga cuando la
-- jornada no está abierta — registrar_corte/melamina/pino/embalaje, vincular_confirmar y
-- jornada_sync — leen prod_jornada.estado. Reusarlo hace que el cierre de LP frene la línea sin
-- tocar ninguna de ellas. `fase` se deja intacta a propósito: prod_tg_jornada_max cuenta por
-- `fase` (tope de jornadas abiertas) y prod_rpc_get_jornada_hoy filtra fase='en_ejecucion' —
-- moverla alteraría el tope comercial y dejaría al panel sin jornada que mostrar.
--
-- Lo que esta migración NO toca: orders, jornadas, free_stock, production_logs ni ninguna
-- función comercial. LP no maneja estados comerciales (regla de alcance del dueño, 2026-07-23).

-- ══════════════════════════════════════════════════════════════════════════════════════════
-- (A) Estado de cierre propio de Línea Productiva
-- ══════════════════════════════════════════════════════════════════════════════════════════
alter table public.prod_jornada add column if not exists cierre_lp_at  timestamptz;
alter table public.prod_jornada add column if not exists cierre_lp_por uuid;

comment on column public.prod_jornada.cierre_lp_at is
  'Cierre propio de Linea Productiva, independiente de jornadas.status (cierre comercial). NULL = LP abierta.';
comment on column public.prod_jornada.cierre_lp_por is
  'Usuario que cerro la jornada de Linea Productiva.';

-- La 0138 ató fase y estado con un bicondicional — (fase='cerrada') = (estado='cerrada') — que
-- era correcto mientras LP no tenía cierre propio. Ahora hace falta la implicación en un solo
-- sentido: si la jornada COMERCIAL cerró, LP tambien está cerrada; pero LP puede cerrar sola
-- con la comercial todavía en ejecución. Sin este cambio, el cierre de LP viola el CHECK.
alter table public.prod_jornada drop constraint if exists prod_jornada_fase_estado_chk;
alter table public.prod_jornada add constraint prod_jornada_fase_estado_chk
  check (fase <> 'cerrada' or estado = 'cerrada');
comment on constraint prod_jornada_fase_estado_chk on public.prod_jornada is
  'fase=cerrada (comercial) obliga estado=cerrada (LP). El reciproco ya no: LP cierra sola.';

-- ══════════════════════════════════════════════════════════════════════════════════════════
-- (B) Espejo: `fase` = ciclo comercial, `estado` = ciclo de LP
-- ══════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.prod_fn_sync_jornada(p_id uuid)
returns void language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare j record; v_fase text; v_estado text; v_cierre_lp timestamptz;
begin
  select id, fecha, status, is_active, abierta_at, closed_at into j from public.jornadas where id=p_id;
  if not found then return; end if;

  -- El cierre de LP sobrevive a las re-sincronizaciones: no viaja en el on conflict de abajo.
  select cierre_lp_at into v_cierre_lp from public.prod_jornada where id=p_id;

  if j.status='cerrada' then v_fase:='cerrada';
  elsif j.is_active then     v_fase:='en_ejecucion';
  else                       v_fase:='pausada';
  end if;

  -- LP puede estar cerrada con la jornada comercial abierta; el cierre comercial cierra ambas.
  if j.status='cerrada' or v_cierre_lp is not null then v_estado:='cerrada'; else v_estado:='abierta'; end if;

  if v_fase='en_ejecucion' then
    update public.prod_jornada set fase='pausada' where fase='en_ejecucion' and id <> p_id;
  end if;

  insert into public.prod_jornada (id, fecha, estado, fase, abierta_at, cerrada_at)
    values (j.id, j.fecha, v_estado, v_fase, j.abierta_at, j.closed_at)
  on conflict (id) do update set fecha=excluded.fecha, estado=excluded.estado, fase=excluded.fase, cerrada_at=excluded.cerrada_at;

  -- Igual que antes de la 0150: la liberación la dispara el cierre COMERCIAL. El cierre de LP la
  -- invoca desde prod_rpc_cerrar_jornada, para que corra una sola vez por evento de cierre.
  if j.status='cerrada' then perform public.prod_fn_liberar_jornada_reservas(j.id); end if;
end $fn$;

revoke all on function public.prod_fn_sync_jornada(uuid) from public, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════════════
-- (C) Cierre de LP: sin arrastre, sin tocar pedidos ni la jornada comercial
-- ══════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.prod_rpc_cerrar_jornada(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
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
    'resumen', jsonb_build_object(
      'cortes',   (select count(*) from prod_corte    where jornada_id = v_id),
      'melamina', (select count(*) from prod_melamina where jornada_id = v_id),
      'pino',     (select count(*) from prod_pino     where jornada_id = v_id),
      'embalaje', (select count(*) from prod_embalaje where jornada_id = v_id)));
end $fn$;

revoke all on function public.prod_rpc_cerrar_jornada(jsonb) from public, anon;
grant execute on function public.prod_rpc_cerrar_jornada(jsonb) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════════════
-- (D) Abrir = también reabrir LP (mismo botón del panel del encargado)
-- ══════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.prod_rpc_abrir_jornada(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_id uuid; v_fecha date; v_rows int;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;

  v_id := public.fn_resolve_active_jornada('Linea Productiva: abrir jornada', false);
  select fecha into v_fecha from public.jornadas where id=v_id;

  -- Si la comercial ya estaba abierta y activa, fn_resolve_active_jornada devuelve sin tocar
  -- `jornadas` ⇒ el trigger de espejo no corre. Re-sincronizamos a mano para que `fase` refleje
  -- la realidad comercial ANTES de tocar `estado`: si el espejo estuviera desfasado (fase=cerrada
  -- con la comercial abierta), la reapertura chocaría contra prod_jornada_fase_estado_chk.
  perform public.prod_fn_sync_jornada(v_id);

  -- Reapertura de LP, sólo mientras la jornada COMERCIAL siga abierta. Un cierre comercial no se
  -- reabre desde acá: es una operación destructiva y queda fuera del alcance de LP.
  update public.prod_jornada pj
     set estado='abierta', cierre_lp_at=null, cierre_lp_por=null
   where pj.id = v_id and pj.cierre_lp_at is not null
     and exists (select 1 from public.jornadas j where j.id = v_id and j.status = 'abierta');
  get diagnostics v_rows = row_count;

  return jsonb_build_object('ok',true,'jornada_id',v_id,'fecha',v_fecha,'retomada',true,'reabierta',(v_rows > 0));
end $fn$;

revoke all on function public.prod_rpc_abrir_jornada(jsonb) from public, anon;
grant execute on function public.prod_rpc_abrir_jornada(jsonb) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════════════
-- (E) Reservar exige jornada de LP abierta
--     Idéntica a la versión vigente salvo la guardia agregada arriba del recálculo.
-- ══════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.prod_rpc_reservar_jornada(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_j uuid; v_est text; o record; v_placa record; v_hojas int; v_res int; v_disp int;
  v_creadas int:=0; v_incompletas int:=0; v_reservado_total int:=0; v_tam text; v_pr record; v_units int; v_enp int;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id=auth.uid();
  if v_role is null or v_active=false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_j := public.prod_fn_jornada_activa();
  if v_j is null then raise exception 'No hay jornada en ejecucion.' using errcode='P0002'; end if;
  if nullif(p_payload->>'jornada_id','') is not null and (p_payload->>'jornada_id')::uuid <> v_j then
    raise exception 'Solo se puede reservar sobre la jornada en ejecucion.' using errcode='42501';
  end if;
  -- 0150: la jornada comercial puede seguir abierta con LP ya cerrada.
  select estado into v_est from prod_jornada where id=v_j;
  if v_est is distinct from 'abierta' then
    raise exception 'La jornada no esta abierta (%).', coalesce(v_est,'inexistente') using errcode='42501';
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

revoke all on function public.prod_rpc_reservar_jornada(jsonb) from public, anon;
grant execute on function public.prod_rpc_reservar_jornada(jsonb) to authenticated;
