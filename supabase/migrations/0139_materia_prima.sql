-- 0139 (LOCAL, NO aplicada en remoto): materia prima configurable (placas CNC + listones/varillas Pino),
-- con stock disponible/reservado/en_proceso y consumo real. Sin datos ficticios en datos reales:
-- si una placa/tamaño no tiene MP configurada o stock, la produccion se BLOQUEA ("Configuracion incompleta").
-- Append-only. Preserva el guard 0136 en las RPC que se re-crean (via 0140, aqui se agrega infraestructura).

-- ── Ledger inmutable de movimientos de stock (reservas, inicios, consumos, ajustes) ──
create table if not exists public.prod_stock_mov (
  id uuid primary key default gen_random_uuid(),
  jornada_id uuid references public.prod_jornada(id),
  tarea_id uuid,
  pool text not null,
  sku text not null,
  tipo text not null check (tipo in ('reservar','liberar','iniciar','consumir','producir','devolver','ajuste')),
  cantidad int not null,
  motivo text,
  usuario uuid,
  created_at timestamptz not null default now()
);
alter table public.prod_stock_mov enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='prod_stock_mov' and policyname='mov_sel') then
    create policy mov_sel on public.prod_stock_mov for select to authenticated using (true); end if;
end $$;
create index if not exists ix_prod_stock_mov_jt on public.prod_stock_mov(jornada_id, tarea_id);

-- ── Catalogo de materia prima ─────────────────────────────────────────────
create table if not exists public.prod_materia_prima (
  sku text primary key,
  nombre text not null,
  tipo text not null check (tipo in ('placa','liston','varilla','otro')),
  sector text,
  unidad text not null default 'u',
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.prod_stock_mp (
  mp_sku text primary key references public.prod_materia_prima(sku) on delete cascade,
  disponible int not null default 0 check (disponible >= 0),
  reservado  int not null default 0 check (reservado >= 0),
  en_proceso int not null default 0 check (en_proceso >= 0),
  updated_at timestamptz not null default now()
);
alter table public.prod_materia_prima enable row level security;
alter table public.prod_stock_mp enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='prod_materia_prima' and policyname='mp_sel') then
    create policy mp_sel on public.prod_materia_prima for select to authenticated using (true); end if;
  if not exists (select 1 from pg_policies where tablename='prod_materia_prima' and policyname='mp_wr') then
    create policy mp_wr on public.prod_materia_prima for all to authenticated using (public.is_owner_or_admin()) with check (public.is_owner_or_admin()); end if;
  if not exists (select 1 from pg_policies where tablename='prod_stock_mp' and policyname='smp_sel') then
    create policy smp_sel on public.prod_stock_mp for select to authenticated using (true); end if;
end $$;

-- Enlace placa → materia prima que consume (nullable = sin configurar → bloquea).
alter table public.prod_placa add column if not exists mp_sku text references public.prod_materia_prima(sku);
-- Receta de Pino: cuantas patas de un tamano rinde una unidad de su materia prima.
create table if not exists public.prod_pino_receta (
  tamano text primary key check (tamano in ('chica','grande')),
  mp_sku text not null references public.prod_materia_prima(sku),
  patas_por_unidad int not null check (patas_por_unidad > 0)
);
alter table public.prod_pino_receta enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='prod_pino_receta' and policyname='pr_sel') then
    create policy pr_sel on public.prod_pino_receta for select to authenticated using (true); end if;
  if not exists (select 1 from pg_policies where tablename='prod_pino_receta' and policyname='pr_wr') then
    create policy pr_wr on public.prod_pino_receta for all to authenticated using (public.is_owner_or_admin()) with check (public.is_owner_or_admin()); end if;
end $$;

-- ── RPC: alta/edicion de materia prima (owner/admin) ──────────────────────
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
  return jsonb_build_object('ok',true,'sku',v_sku);
end $fn$;

-- RPC: ajuste de stock de materia prima con motivo + auditoria (owner/admin/encargado).
create or replace function public.prod_rpc_mp_ajuste(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_sku text; v_delta int; v_motivo text; v_disp int;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active=false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_sku := upper(nullif(trim(p_payload->>'sku'),''));
  v_delta := public.prod_fn_int_arg(p_payload,'delta',0,false,-2000000000);
  v_motivo := nullif(trim(p_payload->>'motivo'),'');
  if v_sku is null then raise exception 'sku requerido.' using errcode='22023'; end if;
  if v_motivo is null then raise exception 'motivo requerido para ajustar stock.' using errcode='22023'; end if;
  if not exists (select 1 from prod_materia_prima where sku=v_sku) then raise exception 'Materia prima % no existe.', v_sku using errcode='22023'; end if;
  insert into prod_stock_mp(mp_sku,disponible) values (v_sku, greatest(v_delta,0))
    on conflict (mp_sku) do update set disponible = prod_stock_mp.disponible + v_delta, updated_at=now()
    returning disponible into v_disp;
  if v_disp < 0 then raise exception 'El ajuste dejaria stock negativo (% ).', v_disp using errcode='42501'; end if;
  insert into prod_stock_mov(jornada_id,tarea_id,pool,sku,tipo,cantidad,motivo,usuario)
    values (null,null,'mp',v_sku,'ajuste',v_delta,v_motivo,auth.uid());
  return jsonb_build_object('ok',true,'sku',v_sku,'disponible',v_disp);
end $fn$;

revoke all on function public.prod_rpc_mp_upsert(jsonb) from public, anon;
revoke all on function public.prod_rpc_mp_ajuste(jsonb) from public, anon;
grant execute on function public.prod_rpc_mp_upsert(jsonb) to authenticated;
grant execute on function public.prod_rpc_mp_ajuste(jsonb) to authenticated;

-- Vista de stock de MP (con minimo si estuviera configurado en 0143).
create or replace view public.prod_v_stock_mp as
  select mp.sku, mp.nombre, mp.tipo, mp.sector, mp.unidad,
    coalesce(s.disponible,0) disponible, coalesce(s.reservado,0) reservado, coalesce(s.en_proceso,0) en_proceso
  from public.prod_materia_prima mp left join public.prod_stock_mp s on s.mp_sku=mp.sku
  where mp.activo;
