-- 0141 (LOCAL): capacidad productiva. Equivalencia a "sets" nullable y configurable por SKU;
-- umbrales advertencia/critica configurables; ejecutar exige capacidad calculable u override
-- autorizado (usuario+fecha+motivo, auditado). La capacidad NUNCA abre/divide/cierra jornadas.
-- Append-only.

alter table public.prod_producto add column if not exists sets_equiv numeric;  -- nullable = "no calculable"

insert into public.prod_config(clave,valor) values
  ('capacidad_advertencia','270'), ('capacidad_critica','300')
on conflict (clave) do nothing;

create table if not exists public.prod_capacidad_override (
  id uuid primary key default gen_random_uuid(),
  jornada_id uuid not null references public.prod_jornada(id) on delete cascade,
  usuario uuid,
  motivo text not null,
  sets_estimados numeric,
  created_at timestamptz not null default now()
);
alter table public.prod_capacidad_override enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='prod_capacidad_override' and policyname='capov_sel') then
    create policy capov_sel on public.prod_capacidad_override for select to authenticated using (true); end if;
end $$;

-- Capacidad de una jornada: suma(cantidad × sets_equiv). Si algun producto no tiene sets_equiv → no calculable.
create or replace function public.prod_fn_capacidad_jornada(p_jornada uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_temp' as $fn$
declare v_sets numeric; v_faltan int; v_adv int; v_cri int; v_nivel text; v_lista text;
begin
  select coalesce(sum(jo.snapshot_cantidad * pr.sets_equiv),0),
         count(*) filter (where pr.sets_equiv is null),
         string_agg(distinct jo.snapshot_sku, ', ') filter (where pr.sets_equiv is null)
    into v_sets, v_faltan, v_lista
  from prod_jornada_orden jo left join prod_producto pr on pr.sku=jo.snapshot_sku
  where jo.jornada_id=p_jornada and coalesce(jo.snapshot_status,'') not in ('cancelada','cumplida');
  v_adv := public.prod_cfg_int('capacidad_advertencia',270);
  v_cri := public.prod_cfg_int('capacidad_critica',300);
  if v_faltan > 0 then
    return jsonb_build_object('calculable',false,'nivel','no_calculable','faltan_equiv',v_faltan,'skus_sin_equiv',coalesce(v_lista,''),'advertencia',v_adv,'critica',v_cri);
  end if;
  v_nivel := case when v_sets >= v_cri then 'critica' when v_sets >= v_adv then 'advertencia' else 'ok' end;
  return jsonb_build_object('calculable',true,'sets',v_sets,'nivel',v_nivel,'advertencia',v_adv,'critica',v_cri);
end $fn$;
revoke execute on function public.prod_fn_capacidad_jornada(uuid) from public, anon;
grant execute on function public.prod_fn_capacidad_jornada(uuid) to authenticated;

-- RPC lectura: capacidad de la jornada (activa por defecto).
create or replace function public.prod_rpc_capacidad(p_payload jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_j uuid;
begin
  select role, active into v_role, v_active from profiles where id=auth.uid();
  if v_role is null or v_active=false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_j := coalesce(nullif(p_payload->>'jornada_id','')::uuid, public.prod_fn_jornada_activa());
  if v_j is null then return jsonb_build_object('calculable',false,'nivel','sin_jornada'); end if;
  return public.prod_fn_capacidad_jornada(v_j) || jsonb_build_object('jornada_id', v_j);
end $fn$;
revoke all on function public.prod_rpc_capacidad(jsonb) from public, anon;
grant execute on function public.prod_rpc_capacidad(jsonb) to authenticated;

-- RPC: setear equivalencia a sets por SKU comercial (owner/admin). Nullable = "no calculable".
create or replace function public.prod_rpc_set_sets_equiv(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_sku text; v_eq numeric;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id=auth.uid();
  if v_role is null or v_active=false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_sku := upper(nullif(trim(p_payload->>'sku'),''));
  if v_sku is null then raise exception 'sku requerido.' using errcode='22023'; end if;
  if not exists (select 1 from prod_producto where sku=v_sku) then raise exception 'Producto % no existe.', v_sku using errcode='22023'; end if;
  v_eq := nullif(p_payload->>'sets_equiv','')::numeric;  -- null = borrar (no calculable)
  if v_eq is not null and v_eq < 0 then raise exception 'sets_equiv no puede ser negativo.' using errcode='22023'; end if;
  update prod_producto set sets_equiv=v_eq where sku=v_sku;
  return jsonb_build_object('ok',true,'sku',v_sku,'sets_equiv',v_eq);
end $fn$;
revoke all on function public.prod_rpc_set_sets_equiv(jsonb) from public, anon;
grant execute on function public.prod_rpc_set_sets_equiv(jsonb) to authenticated;

-- ejecutar_jornada re-creada CON gate de capacidad: si no es calculable exige override con motivo (auditado).
create or replace function public.prod_rpc_ejecutar_jornada(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_id uuid; v_fase text; v_cap jsonb; v_motivo text;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_id := nullif(p_payload->>'jornada_id','')::uuid;
  if v_id is null then raise exception 'jornada_id requerido.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtext('prod_abrir_jornada'));
  select fase into v_fase from prod_jornada where id=v_id for update;
  if v_fase is null then raise exception 'Jornada inexistente.' using errcode='P0002'; end if;
  if v_fase='cerrada' then raise exception 'La jornada esta cerrada.' using errcode='42501'; end if;
  -- gate de capacidad: si no es calculable, exige override autorizado con motivo
  v_cap := public.prod_fn_capacidad_jornada(v_id);
  if (v_cap->>'calculable')::boolean is false then
    v_motivo := nullif(trim(p_payload->>'override_motivo'),'');
    if v_motivo is null then
      raise exception 'Capacidad incompleta/no calculable (SKUs sin equivalencia a sets: %). Complete sets_equiv o ejecute con override_motivo.', coalesce(v_cap->>'skus_sin_equiv','?') using errcode='42501';
    end if;
    insert into prod_capacidad_override(jornada_id,usuario,motivo) values (v_id, auth.uid(), v_motivo);
  end if;
  update prod_jornada set fase='pausada' where fase='en_ejecucion' and id<>v_id;
  update prod_jornada set fase='en_ejecucion', estado='abierta' where id=v_id;
  return jsonb_build_object('ok',true,'jornada_id',v_id,'fase','en_ejecucion','capacidad',v_cap);
end $fn$;
