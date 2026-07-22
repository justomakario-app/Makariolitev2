-- 0146 (LOCAL): elimina el defecto reserva↔carga directa. La carga directa de CNC/Pino ahora ABSORBE
-- (libera) toda reserva/en_proceso pendiente para su mismo output ANTES de consumir de disponible, de modo
-- que hay UNA sola contabilidad transaccional del stock: no hay bloqueo falso (la MP reservada vuelve a
-- disponible antes del chequeo) ni reserva colgada (la tarea queda cancelada con su movimiento compensatorio).
-- Append-only.

-- Regla de reprogramado por fecha: un pedido reprogramado queda EXCLUIDO de la producción hasta su
-- nueva fecha; cuando reprogramada_para <= hoy vuelve a ser elegible (demorado/desconocido/cancelado/
-- archivado siguen siempre excluidos).
create or replace function public.prod_fn_orden_excluida(p_order uuid)
returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $fn$
  select exists (select 1 from public.prod_orden_estado oe where oe.order_id=p_order
    and ( oe.estado_canonico in ('demorado','desconocido','cancelado','archivado')
       or (oe.estado_canonico='reprogramado' and (oe.reprogramada_para is null or oe.reprogramada_para > current_date)) ));
$fn$;
revoke execute on function public.prod_fn_orden_excluida(uuid) from public, anon;
grant execute on function public.prod_fn_orden_excluida(uuid) to authenticated;

create or replace function public.prod_fn_liberar_tareas_output(p_jornada uuid, p_sector text, p_output text)
returns void language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare tr record;
begin
  for tr in select * from prod_tarea where jornada_id=p_jornada and sector=p_sector and output_sku=p_output
            and estado in ('reservada','en_proceso') for update loop
    if tr.reservado>0 then
      perform public.prod_fn_stock_apply(tr.input_pool,tr.input_sku,tr.reservado,-tr.reservado,0);
      insert into prod_stock_mov(jornada_id,tarea_id,pool,sku,tipo,cantidad,motivo,usuario)
        values(p_jornada,tr.id,tr.input_pool,tr.input_sku,'devolver',tr.reservado,'carga directa absorbe reserva',auth.uid());
    end if;
    if tr.en_proceso>0 then
      perform public.prod_fn_stock_apply(tr.input_pool,tr.input_sku,tr.en_proceso,0,-tr.en_proceso);
      insert into prod_stock_mov(jornada_id,tarea_id,pool,sku,tipo,cantidad,motivo,usuario)
        values(p_jornada,tr.id,tr.input_pool,tr.input_sku,'devolver',tr.en_proceso,'carga directa absorbe en_proceso',auth.uid());
    end if;
    update prod_tarea set estado='cancelada', reservado=0, en_proceso=0,
      nota=coalesce(nota,'')||' [absorbida por carga directa]' where id=tr.id;
  end loop;
end $fn$;
revoke execute on function public.prod_fn_liberar_tareas_output(uuid,text,text) from public, anon, authenticated;

-- registrar_corte: absorbe reservas del output antes de consumir MP
create or replace function public.prod_rpc_registrar_corte(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_jornada uuid; v_est text;
  v_placa text; v_hojas int; v_desp int; v_rend int; v_pieza text; v_gen int; v_id uuid;
  v_mp text; v_oblig boolean; v_mpdisp int;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('cnc','encargado','owner','admin') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_jornada := nullif(p_payload->>'jornada_id','')::uuid;
  if v_jornada is null then v_jornada := public.prod_fn_jornada_activa(); end if;
  select estado into v_est from prod_jornada where id=v_jornada;
  if v_jornada is null or v_est is null then raise exception 'Jornada inexistente.' using errcode='P0002'; end if;
  if v_est <> 'abierta' then raise exception 'La jornada no esta abierta (%).', v_est using errcode='42501'; end if;
  v_placa := p_payload->>'placa_sku';
  v_hojas := public.prod_fn_int_arg(p_payload,'hojas',1,true);
  v_desp  := public.prod_fn_int_arg(p_payload,'desperdicio',0,false,0);
  select rendimiento, pieza_sku, mp_sku into v_rend, v_pieza, v_mp from prod_placa where sku = v_placa;
  if not found then raise exception 'Placa % no existe.', v_placa using errcode='22023'; end if;
  if v_pieza is null then raise exception 'La placa % no tiene pieza asociada.', v_placa using errcode='22023'; end if;
  perform public.prod_fn_liberar_tareas_output(v_jornada, 'cnc', v_pieza);  -- coordinación reserva↔directa
  v_oblig := public.prod_cfg_int('mp_consumo_obligatorio',1) = 1;
  if v_mp is not null then
    perform 1 from prod_stock_mp where mp_sku=v_mp for update;
    v_mpdisp := public.prod_fn_stock_disp('mp', v_mp);
    if v_mpdisp < v_hojas then raise exception 'Stock de placas insuficiente (disp %, requiere % hojas de %).', v_mpdisp, v_hojas, v_mp using errcode='42501'; end if;
    perform public.prod_fn_stock_apply('mp', v_mp, -v_hojas, 0, 0);
    insert into prod_stock_mov(jornada_id,pool,sku,tipo,cantidad,usuario) values (v_jornada,'mp',v_mp,'consumir',v_hojas,auth.uid());
  elsif v_oblig then
    raise exception 'Configuracion incompleta: la placa % no tiene materia prima configurada.', v_placa using errcode='42501';
  end if;
  v_gen := greatest(v_hojas * coalesce(v_rend,0) - v_desp, 0);
  insert into prod_corte (jornada_id, placa_sku, hojas, desperdicio, cargado_por, editable_hasta)
  values (v_jornada, v_placa, v_hojas, v_desp, auth.uid(), now() + interval '24 hours') returning id into v_id;
  insert into prod_stock_pieza (pieza_sku, disponible) values (v_pieza, v_gen)
  on conflict (pieza_sku) do update set disponible = prod_stock_pieza.disponible + v_gen, updated_at = now();
  return jsonb_build_object('ok', true, 'corte_id', v_id, 'piezas_generadas', v_gen);
end $fn$;

-- registrar_pino: absorbe reservas del output (tamaño) antes de consumir MP
create or replace function public.prod_rpc_registrar_pino(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_jornada uuid; v_est text;
  v_tamano text; v_term int; v_mas int; v_id uuid; v_disp int; v_masT int;
  v_pr record; v_oblig boolean; v_units int; v_mpdisp int;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('pino','encargado','owner','admin') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_jornada := nullif(p_payload->>'jornada_id','')::uuid;
  if v_jornada is null then v_jornada := public.prod_fn_jornada_activa(); end if;
  select estado into v_est from prod_jornada where id=v_jornada;
  if v_jornada is null or v_est is null then raise exception 'Jornada inexistente.' using errcode='P0002'; end if;
  if v_est <> 'abierta' then raise exception 'La jornada no esta abierta (%).', v_est using errcode='42501'; end if;
  v_tamano := p_payload->>'tamano';
  if v_tamano not in ('chica','grande') then raise exception 'tamano invalido (chica|grande).' using errcode='22023'; end if;
  v_term := public.prod_fn_int_arg(p_payload,'terminadas',0,false,0);
  v_mas  := public.prod_fn_int_arg(p_payload,'masilladas',0,false,0);
  if (v_term + v_mas) <= 0 then raise exception 'Debe registrar al menos una pata (terminadas o masilladas).' using errcode='22023'; end if;
  perform public.prod_fn_liberar_tareas_output(v_jornada, 'pino', v_tamano);  -- coordinación reserva↔directa
  v_oblig := public.prod_cfg_int('mp_consumo_obligatorio',1) = 1;
  select * into v_pr from prod_pino_receta where tamano=v_tamano;
  if found then
    v_units := ceil((v_term + v_mas)::numeric / v_pr.patas_por_unidad)::int;
    perform 1 from prod_stock_mp where mp_sku=v_pr.mp_sku for update;
    v_mpdisp := public.prod_fn_stock_disp('mp', v_pr.mp_sku);
    if v_mpdisp < v_units then raise exception 'Stock de materia prima de pino insuficiente (disp %, requiere %).', v_mpdisp, v_units using errcode='42501'; end if;
    perform public.prod_fn_stock_apply('mp', v_pr.mp_sku, -v_units, 0, 0);
    insert into prod_stock_mov(jornada_id,pool,sku,tipo,cantidad,usuario) values (v_jornada,'mp',v_pr.mp_sku,'consumir',v_units,auth.uid());
  elsif v_oblig then
    raise exception 'Configuracion incompleta: no hay receta de materia prima para patas %.', v_tamano using errcode='42501';
  end if;
  insert into prod_pino (jornada_id, tamano, terminadas, masilladas, cargado_por, editable_hasta)
  values (v_jornada, v_tamano, v_term, v_mas, auth.uid(), now() + interval '24 hours') returning id into v_id;
  insert into prod_stock_patas (tamano, disponible, masilladas) values (v_tamano, v_term, v_mas)
  on conflict (tamano) do update set disponible = prod_stock_patas.disponible + v_term,
    masilladas = prod_stock_patas.masilladas + v_mas, updated_at = now()
  returning disponible, masilladas into v_disp, v_masT;
  return jsonb_build_object('ok', true, 'pino_id', v_id, 'stock_patas', jsonb_build_object('tamano', v_tamano, 'disponible', v_disp, 'masilladas', v_masT));
end $fn$;
