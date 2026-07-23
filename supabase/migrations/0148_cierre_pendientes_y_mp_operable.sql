-- 0148: cierre coherente + materia prima operable con el catálogo real. Append-only.
--
-- Contexto (verificación post-publicación contra 92aa2e2):
-- (C1) prod_rpc_cerrar_jornada: la delegación de 0147 (R5) PERDIÓ la guardia de trabajo
--      pendiente de 0138 — ignoraba el flag 'forzar' y nunca devolvía requiere_confirmacion,
--      con lo cual el panel "Queda trabajo pendiente" del frontend quedó camino muerto y el
--      toast del encargado leía un 'resumen' que ya no venía en la respuesta. Se RESTAURA la
--      guardia + el resumen (idénticos a 0138) manteniendo la delegación del cierre real en
--      rpc_close_jornada (arrastre NETO + liberación de reservas vía espejo, como en 0147).
-- (C2) prod_rpc_mp_upsert: no existía NINGÚN código que escribiera prod_placa.mp_sku (grep
--      completo de migrations y web/), de modo que el consumo de MP jamás podía activarse
--      desde la UI. Ahora, al registrar una materia prima cuyo sku coincide con una placa del
--      catálogo (SKU de sistema — las 29 placas ya están en sku_catalog), la placa queda
--      auto-vinculada. No se crean códigos nuevos: se reusa el catálogo existente.
-- (C3) mp_consumo_obligatorio → '0': con las 29 placas sin mp_sku y prod_pino_receta vacía,
--      el valor '1' bloqueaba TODA carga directa de CNC y Pino ("Configuración incompleta")
--      ⇒ línea inoperable de punta a punta. Con '0' la línea opera YA con el catálogo real y
--      stock por pieza/melamina/patas/terminado; el chequeo de stock de MP es INCONDICIONAL
--      por placa/tamaño en cuanto su MP real queda cargada y vinculada (no depende de esta
--      config), así la activación del descuento de placas/listones es progresiva y sin datos
--      inventados. Para volver al bloqueo estricto: valor '1'.

-- ══════════════════════════════════════════════════════════════════════════════════════════
-- (C1) cerrar_jornada: guardia de pendientes + forzar + resumen, delegando en rpc_close_jornada
-- ══════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.prod_rpc_cerrar_jornada(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_id uuid; v_fecha date; v_row public.jornadas; v_forzar boolean;
  v_pend_mesas int; v_pend_detalle jsonb; v_falt jsonb; v_n int;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_id := coalesce(nullif(p_payload->>'jornada_id','')::uuid, public.prod_fn_jornada_activa());
  if v_id is null then raise exception 'No hay jornada activa para cerrar.' using errcode='P0002'; end if;
  select fecha into v_fecha from public.jornadas where id=v_id;
  if v_fecha is null then raise exception 'Jornada no encontrada.' using errcode='P0002'; end if;
  v_forzar := coalesce((p_payload->>'forzar')::boolean, false);
  -- guardia restaurada de 0138 (mismas consultas): mesas por armar + piezas faltantes
  select coalesce(sum(demanda_neta),0), coalesce(jsonb_agg(jsonb_build_object('sku',sku,'mesas_pendientes',demanda_neta) order by demanda_neta desc),'[]'::jsonb)
    into v_pend_mesas, v_pend_detalle from prod_v_jornada_demanda_neta;
  select coalesce(jsonb_agg(jsonb_build_object('sku',sku,'pool',prod_pieza_pool(sku),'faltante',faltante_neto) order by faltante_neto desc), '[]'::jsonb), count(*)
    into v_falt, v_n from prod_v_faltante where faltante_neto > 0 and es_hoja and prod_pieza_pool(sku) in ('melamina','patas','insumo');
  if (v_pend_mesas > 0 or v_n > 0) and not v_forzar then
    return jsonb_build_object('ok', false, 'requiere_confirmacion', true, 'motivo', 'trabajo_pendiente',
      'mesas_pendientes_total', v_pend_mesas, 'mesas_pendientes', v_pend_detalle,
      'faltantes_piezas_count', v_n, 'faltantes_piezas', v_falt,
      'mensaje', 'Queda trabajo pendiente. Volve a cerrar con forzar=true. Lo pendiente se arrastra NETO a la proxima jornada (no se re-fabrica lo ya hecho).');
  end if;
  v_row := public.rpc_close_jornada(v_fecha, null);  -- sistema existente (arrastre + libera reservas via espejo)
  return jsonb_build_object('ok', true, 'jornada_id', v_row.id, 'cerrada', true,
    'cerrada_con_pendientes', (v_pend_mesas > 0 or v_n > 0),
    'mesas_pendientes_arrastradas', v_pend_mesas, 'faltantes_piezas', v_falt,
    'resumen', jsonb_build_object(
      'cortes',   (select count(*) from prod_corte    where jornada_id = v_id),
      'melamina', (select count(*) from prod_melamina where jornada_id = v_id),
      'pino',     (select count(*) from prod_pino     where jornada_id = v_id),
      'embalaje', (select count(*) from prod_embalaje where jornada_id = v_id)));
end $fn$;
revoke all on function public.prod_rpc_cerrar_jornada(jsonb) from public, anon;
grant execute on function public.prod_rpc_cerrar_jornada(jsonb) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════════════
-- (C2) mp_upsert: auto-vínculo con la placa del catálogo cuando el sku coincide (sin códigos nuevos)
-- ══════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.prod_rpc_mp_upsert(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_sku text;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active=false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_sku := upper(nullif(trim(p_payload->>'sku'),''));
  if v_sku is null then raise exception 'sku requerido.' using errcode='22023'; end if;
  insert into prod_materia_prima(sku,nombre,tipo,sector,unidad,activo)
    values (v_sku, coalesce(p_payload->>'nombre',v_sku), coalesce(p_payload->>'tipo','otro'),
            nullif(p_payload->>'sector',''), coalesce(nullif(p_payload->>'unidad',''),'u'), coalesce((p_payload->>'activo')::boolean,true))
  on conflict (sku) do update set nombre=excluded.nombre, tipo=excluded.tipo, sector=excluded.sector, unidad=excluded.unidad, activo=excluded.activo;
  insert into prod_stock_mp(mp_sku) values (v_sku) on conflict (mp_sku) do nothing;
  -- (C2) conexión automática con el catálogo: si el sku es una placa, la placa consume esta MP.
  update prod_placa set mp_sku = v_sku where sku = v_sku and (mp_sku is null or mp_sku = v_sku);
  return jsonb_build_object('ok', true, 'sku', v_sku,
    'placa_vinculada', exists(select 1 from prod_placa where sku = v_sku and mp_sku = v_sku));
end $fn$;
revoke all on function public.prod_rpc_mp_upsert(jsonb) from public, anon;
grant execute on function public.prod_rpc_mp_upsert(jsonb) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════════════
-- (C3) línea operable ya: el consumo de MP deja de ser bloqueante mientras no haya MP cargada
-- ══════════════════════════════════════════════════════════════════════════════════════════
insert into public.prod_config (clave, valor) values ('mp_consumo_obligatorio','0')
on conflict (clave) do update set valor = '0', updated_at = now();
