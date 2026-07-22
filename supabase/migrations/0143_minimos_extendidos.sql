-- 0143 (LOCAL): minimos y alertas extendidos a todos los pools (MP/placas, crudo, melamina, patas,
-- insumos por sector, terminado). Configurable por pool/sku. Alertas con dedup (una activa por pool+sku)
-- y reactivacion (si se resuelve y vuelve a faltar, se crea una nueva). Append-only.

create table if not exists public.prod_minimo (
  pool text not null check (pool in ('mp','pieza','melamina','patas','terminado','insumo')),
  sku text not null,
  minimo int not null check (minimo >= 0),
  sector text,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (pool, sku)
);
alter table public.prod_minimo enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='prod_minimo' and policyname='min_sel') then
    create policy min_sel on public.prod_minimo for select to authenticated using (true); end if;
end $$;

create table if not exists public.prod_alerta_stock (
  id uuid primary key default gen_random_uuid(),
  pool text not null,
  sku text not null,
  nivel text not null check (nivel in ('bajo','critico')),
  disponible int not null,
  minimo int not null,
  estado text not null default 'activa' check (estado in ('activa','reconocida','resuelta')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.prod_alerta_stock enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='prod_alerta_stock' and policyname='as_sel') then
    create policy as_sel on public.prod_alerta_stock for select to authenticated using (true); end if;
end $$;
-- dedup: a lo sumo UNA alerta no-resuelta por pool+sku
create unique index if not exists ux_prod_alerta_stock_activa on public.prod_alerta_stock(pool,sku) where estado <> 'resuelta';

-- Recalcula alertas de minimos: dedup (actualiza la activa) + reactivacion (resuelta→nueva si reaparece).
create or replace function public.prod_fn_recalc_minimos()
returns int language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare mi record; v_disp int; v_niv text; v_id uuid; n int:=0;
begin
  for mi in (select pool, sku, minimo from prod_minimo where minimo > 0) loop
    v_disp := public.prod_fn_stock_disp(mi.pool, mi.sku);
    if v_disp < mi.minimo then
      v_niv := case when v_disp::numeric < mi.minimo::numeric/2 then 'critico' else 'bajo' end;
      select id into v_id from prod_alerta_stock where pool=mi.pool and sku=mi.sku and estado <> 'resuelta' limit 1;
      if v_id is not null then
        update prod_alerta_stock set nivel=v_niv, disponible=v_disp, minimo=mi.minimo, updated_at=now() where id=v_id;
      else
        insert into prod_alerta_stock(pool,sku,nivel,disponible,minimo) values(mi.pool,mi.sku,v_niv,v_disp,mi.minimo);
        n := n+1;
      end if;
    else
      update prod_alerta_stock set estado='resuelta', updated_at=now() where pool=mi.pool and sku=mi.sku and estado <> 'resuelta';
    end if;
  end loop;
  return n;
end $fn$;
revoke execute on function public.prod_fn_recalc_minimos() from public, anon, authenticated;

-- RPC: setear minimo por pool/sku (owner/admin/encargado) + recalculo.
create or replace function public.prod_rpc_set_minimo_pool(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_pool text; v_sku text; v_min int;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id=auth.uid();
  if v_role is null or v_active=false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_pool := nullif(p_payload->>'pool',''); v_sku := upper(nullif(trim(p_payload->>'sku'),''));
  v_min := public.prod_fn_int_arg(p_payload,'minimo',0,false,0);
  if v_pool is null or v_sku is null then raise exception 'pool y sku requeridos.' using errcode='22023'; end if;
  if v_pool not in ('mp','pieza','melamina','patas','terminado','insumo') then raise exception 'pool invalido %.', v_pool using errcode='22023'; end if;
  insert into prod_minimo(pool,sku,minimo,sector,updated_by) values(v_pool,v_sku,v_min,nullif(p_payload->>'sector',''),auth.uid())
    on conflict (pool,sku) do update set minimo=excluded.minimo, sector=excluded.sector, updated_by=auth.uid(), updated_at=now();
  perform public.prod_fn_recalc_minimos();
  return jsonb_build_object('ok',true,'pool',v_pool,'sku',v_sku,'minimo',v_min);
end $fn$;

-- RPC: reconocer una alerta (no la resuelve; evita ruido). Vuelve a 'activa' si el faltante empeora via recalc.
create or replace function public.prod_rpc_reconocer_alerta(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_id uuid;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id=auth.uid();
  if v_role is null or v_active=false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_id := nullif(p_payload->>'alerta_id','')::uuid;
  update prod_alerta_stock set estado='reconocida', updated_at=now() where id=v_id and estado='activa';
  return jsonb_build_object('ok',true,'alerta_id',v_id);
end $fn$;

-- RPC lectura: recalcula y devuelve alertas activas.
create or replace function public.prod_rpc_minimos(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean;
begin
  perform public.prod_fn_guard_lp();  -- recalcula alertas (muta prod_alerta_stock) → fail-closed
  select role, active into v_role, v_active from profiles where id=auth.uid();
  if v_role is null or v_active=false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  perform public.prod_fn_recalc_minimos();
  return jsonb_build_object('ok',true,
    'alertas', coalesce((select jsonb_agg(jsonb_build_object('id',id,'pool',pool,'sku',sku,'nivel',nivel,'disponible',disponible,'minimo',minimo,'estado',estado) order by nivel desc, pool, sku)
                         from prod_alerta_stock where estado <> 'resuelta'),'[]'::jsonb),
    'configurados', (select count(*) from prod_minimo where minimo>0));
end $fn$;

do $$ declare f text; begin
  foreach f in array array['prod_rpc_set_minimo_pool(jsonb)','prod_rpc_reconocer_alerta(jsonb)','prod_rpc_minimos(jsonb)'] loop
    execute 'revoke all on function public.'||f||' from public, anon';
    execute 'grant execute on function public.'||f||' to authenticated';
  end loop; end $$;
