-- 0142 (LOCAL): estados canonicos demorado/reprogramado con mapeo externo CONFIGURABLE.
-- Demorado/reprogramado/desconocido salen de nueva produccion (candidatos los excluye); al re-planificar
-- (reservar_jornada) las reservas no iniciadas se liberan porque la demanda baja. El material ya en
-- proceso permanece (stock fisico trazable). Estado externo no mapeado → 'desconocido' (fail-closed).
-- El mapeo definitivo del Excel queda como config pendiente; el MODELO y su funcionamiento quedan listos.
-- Append-only. NO toca el schema de orders.

create table if not exists public.prod_orden_estado (
  order_id uuid primary key,
  estado_canonico text not null check (estado_canonico in ('activo','demorado','reprogramado','cancelado','archivado','desconocido')),
  valor_externo text,
  motivo text,
  reprogramada_para date,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.prod_orden_estado enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='prod_orden_estado' and policyname='oe_sel') then
    create policy oe_sel on public.prod_orden_estado for select to authenticated using (true); end if;
end $$;

-- Mapeo configurable valor_externo (texto del Excel/ML) → estado canonico.
create table if not exists public.prod_estado_map (
  valor_externo text primary key,
  estado_canonico text not null check (estado_canonico in ('activo','demorado','reprogramado','cancelado','archivado','desconocido'))
);
alter table public.prod_estado_map enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='prod_estado_map' and policyname='em_sel') then
    create policy em_sel on public.prod_estado_map for select to authenticated using (true); end if;
  if not exists (select 1 from pg_policies where tablename='prod_estado_map' and policyname='em_wr') then
    create policy em_wr on public.prod_estado_map for all to authenticated using (public.is_owner_or_admin()) with check (public.is_owner_or_admin()); end if;
end $$;
-- Semillas base (ajustables cuando llegue el Excel definitivo).
insert into public.prod_estado_map(valor_externo,estado_canonico) values
  ('demorado','demorado'),('demorada','demorado'),('reprogramado','reprogramado'),('reprogramada','reprogramado'),
  ('envio reprogramado','reprogramado'),('cancelado','cancelado'),('cancelada','cancelado'),
  ('listo para despachar','activo'),('activo','activo'),('normal','activo')
on conflict (valor_externo) do nothing;

-- RPC: setear estado externo de un pedido (mapea; desconocido si no hay mapeo). owner/admin/encargado.
create or replace function public.prod_rpc_set_estado_externo(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_oid uuid; v_ext text; v_canon text; v_repro date;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id=auth.uid();
  if v_role is null or v_active=false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_oid := nullif(p_payload->>'order_id','')::uuid;
  v_ext := lower(nullif(trim(p_payload->>'valor_externo'),''));
  v_repro := nullif(p_payload->>'reprogramada_para','')::date;
  if v_oid is null or v_ext is null then raise exception 'order_id y valor_externo requeridos.' using errcode='22023'; end if;
  select estado_canonico into v_canon from prod_estado_map where valor_externo=v_ext;
  if v_canon is null then v_canon := 'desconocido'; end if;  -- fail-closed: sin mapeo → revision manual
  insert into prod_orden_estado(order_id,estado_canonico,valor_externo,reprogramada_para,updated_by)
    values(v_oid,v_canon,v_ext,v_repro,auth.uid())
  on conflict (order_id) do update set estado_canonico=excluded.estado_canonico, valor_externo=excluded.valor_externo,
    reprogramada_para=excluded.reprogramada_para, updated_by=auth.uid(), updated_at=now();
  return jsonb_build_object('ok',true,'order_id',v_oid,'estado_canonico',v_canon,'requiere_revision', v_canon='desconocido');
end $fn$;
revoke all on function public.prod_rpc_set_estado_externo(jsonb) from public, anon;
grant execute on function public.prod_rpc_set_estado_externo(jsonb) to authenticated;

-- candidatos re-creada: excluye demorado/reprogramado/desconocido de la nueva produccion.
-- (reprogramado vuelve a ser elegible cuando su reprogramada_para <= hoy Y se re-mapea a 'activo'.)
create or replace function public.prod_fn_candidatos(p_origen jsonb, p_jornada uuid)
returns table(order_id uuid, sku text, channel text, cantidad integer, estado text)
language plpgsql stable security definer set search_path to 'public','pg_temp' as $fn$
declare v_tipo text := coalesce(p_origen->>'tipo',''); v_fecha date; v_piso date := current_date - 90; v_ids uuid[]; v_batch uuid;
begin
  if v_tipo = 'fecha_desde' then
    begin v_fecha := (p_origen->>'fecha')::date; exception when others then
      raise exception 'fecha invalida: use AAAA-MM-DD (recibido: %).', coalesce(p_origen->>'fecha','(vacia)') using errcode='22023'; end;
    if v_fecha is null then raise exception 'fecha requerida para el scope fecha_desde.' using errcode='22023'; end if;
    if v_fecha < v_piso then raise exception 'La fecha % supera el piso de 90 dias (%). Para incorporar ventas anteriores usa la seleccion explicita por pedido o por lote de importacion.', v_fecha, v_piso using errcode='22023'; end if;
  elsif v_tipo = 'order_ids' then
    begin select array_agg(v::uuid) into v_ids from jsonb_array_elements_text(coalesce(p_origen->'ids','[]'::jsonb)) v;
    exception when others then raise exception 'ids invalidos: se espera un array de UUID.' using errcode='22023'; end;
  elsif v_tipo = 'import_batch' then
    begin v_batch := (p_origen->>'import_batch_id')::uuid; exception when others then
      raise exception 'import_batch_id invalido (UUID requerido).' using errcode='22023'; end;
  end if;
  return query
  select o.id, o.sku, o.channel_id::text, o.cantidad, o.status::text
  from public.orders o
  where o.status::text in ('pendiente','arrastrado') and o.cancelled_at is null
    and (o.cantidad - public.prod_fn_asignado(o.id)) > 0
    and not exists (select 1 from public.prod_orden_estado oe where oe.order_id=o.id
                    and oe.estado_canonico in ('demorado','reprogramado','desconocido'))
    and case v_tipo
          when 'import_batch' then o.import_batch_id = v_batch
          when 'fecha_desde'  then o.created_at::date >= v_fecha
          when 'order_ids'    then o.id = any(coalesce(v_ids, '{}'::uuid[]))
          when 'arrastre'     then exists (select 1 from public.prod_jornada_orden jo join public.prod_jornada j on j.id=jo.jornada_id where jo.order_id=o.id and j.estado='cerrada')
          else false end
    and not exists (select 1 from public.prod_jornada_orden jo join public.prod_jornada j on j.id=jo.jornada_id
      where jo.order_id=o.id and j.estado='abierta' and jo.jornada_id <> coalesce(p_jornada,'00000000-0000-0000-0000-000000000000'::uuid));
end $fn$;
revoke execute on function public.prod_fn_candidatos(jsonb, uuid) from public, anon, authenticated;
