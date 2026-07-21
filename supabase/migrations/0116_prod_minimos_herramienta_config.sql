-- 0116 · Punto 4 — Herramienta de configuración de mínimos + alertas confiables + estado "sin configurar".
-- (Aplicada en remoto vía MCP el 2026-07-21; reconstruida como archivo local — no re-ejecutar.)

-- (1) Distinguir "mínimo = 0 configurado" de "sin configurar".
alter table public.prod_insumo add column if not exists minimo_configurado boolean not null default false;
alter table public.prod_insumo add column if not exists minimo_actualizado_por uuid;
alter table public.prod_insumo add column if not exists minimo_actualizado_at timestamptz;
comment on column public.prod_insumo.minimo_configurado is 'Punto 4 — TRUE si un usuario configuro el minimo explicitamente (aunque sea 0). FALSE = sin configurar (no es "stock saludable").';

-- (2) Auditoría de cambios de mínimo (quién / cuándo / motivo).
create table if not exists public.prod_minimo_log (
  id uuid primary key default gen_random_uuid(),
  insumo_sku text not null,
  minimo_anterior numeric,
  minimo_nuevo numeric not null,
  motivo text,
  usuario uuid,
  created_at timestamptz not null default now()
);
alter table public.prod_minimo_log enable row level security;
drop policy if exists prod_minimo_log_sel on public.prod_minimo_log;
create policy prod_minimo_log_sel on public.prod_minimo_log for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.role in ('owner','admin','encargado'))
);

-- (3) Trigger de alerta: solo si el mínimo fue configurado y es > 0.
create or replace function public.prod_fn_alerta_stock()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $function$
begin
  if coalesce(new.minimo_configurado,false) and coalesce(new.stock_minimo,0) > 0
     and new.stock_actual < new.stock_minimo then
    insert into public.prod_alerta (insumo_sku, nivel, stock_actual, stock_minimo)
    values (new.sku,
      case when new.stock_actual < new.stock_minimo * 0.5 then 'critico' else 'bajo' end,
      new.stock_actual, new.stock_minimo);
  end if;
  return new;
end $function$;

-- (4) RPC para configurar el mínimo (owner/admin/encargado), con validación + auditoría.
create or replace function public.prod_rpc_set_minimo(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_role role_enum; v_active boolean; v_sku text; v_min numeric; v_motivo text; v_ant numeric;
begin
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;

  v_sku := p_payload->>'sku';
  v_motivo := nullif(p_payload->>'motivo','');
  if (p_payload->>'minimo') is null or (p_payload->>'minimo') = '' then raise exception 'Falta el minimo.' using errcode='22023'; end if;
  begin v_min := (p_payload->>'minimo')::numeric; exception when others then raise exception 'Minimo invalido.' using errcode='22023'; end;
  if v_min < 0 then raise exception 'El minimo no puede ser negativo.' using errcode='22023'; end if;

  select stock_minimo into v_ant from prod_insumo where sku = v_sku;
  if not found then raise exception 'Insumo % no existe.', v_sku using errcode='P0002'; end if;

  update prod_insumo set stock_minimo = v_min, minimo_configurado = true,
    minimo_actualizado_por = auth.uid(), minimo_actualizado_at = now(), updated_at = now()
  where sku = v_sku;

  insert into prod_minimo_log (insumo_sku, minimo_anterior, minimo_nuevo, motivo, usuario)
  values (v_sku, v_ant, v_min, v_motivo, auth.uid());

  return jsonb_build_object('ok', true, 'sku', v_sku, 'minimo_anterior', v_ant, 'minimo_nuevo', v_min, 'configurado', true);
end $function$;
grant execute on function public.prod_rpc_set_minimo(jsonb) to authenticated;

-- (5) Vista de estado de mínimos (para UI): distingue sin_configurar / critico / bajo / ok.
create or replace view public.prod_v_minimos as
select i.sku, i.nombre, i.categoria, i.sector, i.unidad,
  i.stock_actual, i.stock_minimo, i.minimo_configurado,
  i.minimo_actualizado_por, i.minimo_actualizado_at,
  case
    when not i.minimo_configurado then 'sin_configurar'
    when i.stock_minimo = 0 then 'ok'
    when i.stock_actual < i.stock_minimo * 0.5 then 'critico'
    when i.stock_actual < i.stock_minimo then 'bajo'
    else 'ok'
  end as estado
from public.prod_insumo i;
comment on view public.prod_v_minimos is 'Punto 4 — estado de minimos por insumo: sin_configurar / critico / bajo / ok. sin_configurar NO es saludable.';
