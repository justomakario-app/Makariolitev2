-- 0122 · FIX auditoría — la jornada operativa se define por estado='abierta', no por fecha=HOY.
-- abrir_jornada: idempotente (retoma la abierta, incluso de días previos); lock para dos aperturas concurrentes.
-- get_jornada_hoy: resuelve por estado='abierta' (retoma la de ayer). Alinea web/mobile (que llaman este RPC).
-- La unicidad global (a lo sumo 1 abierta) ya la garantiza ux_prod_jornada_una_abierta (0114) a nivel BD.
-- (Aplicada en remoto vía MCP el 2026-07-21 durante la corrección integral pre-push. SIN commitear aún.)

create or replace function public.prod_rpc_abrir_jornada(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_role role_enum; v_active boolean; v_id uuid; v_fecha date; v_n_abiertas int;
begin
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;

  -- Serializa aperturas concurrentes: la 2ª espera y verá la jornada de la 1ª.
  perform pg_advisory_xact_lock(hashtext('prod_abrir_jornada'));

  -- Bloqueo de datos: si (por corrupción previa) hubiera >1 abierta, no corregir en silencio.
  select count(*) into v_n_abiertas from prod_jornada where estado='abierta';
  if v_n_abiertas > 1 then
    raise exception 'Inconsistencia: hay % jornadas abiertas. Requiere reconciliacion manual.', v_n_abiertas using errcode='42501';
  end if;

  -- Ya hay una abierta (de hoy o de un día previo) => retomarla, sin duplicar.
  select id, fecha into v_id, v_fecha from prod_jornada where estado='abierta' order by fecha desc limit 1;
  if found then
    return jsonb_build_object('ok', true, 'jornada_id', v_id, 'fecha', v_fecha, 'retomada', true);
  end if;

  -- No hay abierta: crear la de HOY; si hoy ya existe (cerrada), retomarla (reabrir) sin duplicar (UNIQUE(fecha)).
  insert into prod_jornada (fecha, estado, abierta_por, abierta_at)
    values (current_date, 'abierta', auth.uid(), now())
  on conflict (fecha) do update set estado='abierta', cerrada_at=null, abierta_por=auth.uid(), abierta_at=now()
  returning id, fecha into v_id, v_fecha;
  return jsonb_build_object('ok', true, 'jornada_id', v_id, 'fecha', v_fecha, 'retomada', (v_fecha <> current_date));
end $function$;
grant execute on function public.prod_rpc_abrir_jornada(jsonb) to authenticated;

create or replace function public.prod_rpc_get_jornada_hoy(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_role role_enum; v_active boolean; v_j record;
begin
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('cnc','melamina','pino','embalaje','encargado','owner','admin') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  -- La jornada operativa es la ABIERTA (cualquier fecha), no la de hoy.
  select id, fecha, estado into v_j from prod_jornada where estado='abierta' order by fecha desc limit 1;
  if not found then return 'null'::jsonb; end if;
  return jsonb_build_object('jornada_id', v_j.id, 'fecha', v_j.fecha, 'estado', v_j.estado);
end $function$;
grant execute on function public.prod_rpc_get_jornada_hoy(jsonb) to authenticated;
