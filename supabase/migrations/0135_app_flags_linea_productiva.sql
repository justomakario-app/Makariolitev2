-- 0135 · Aislamiento de Línea Productiva: feature flag persistente (kill-switch sin redeploy).
-- El bundle candidato oculta las tabs de LP (Línea productiva / Tablero / Activar / Carga stock /
-- De fábrica) salvo que el flag 'linea_productiva' esté ON. FAIL-CLOSED: si la tabla no existe o
-- la lectura falla, el frontend trata el flag como OFF → LP queda aislada por defecto.
-- Rollout controlado: aplicar migraciones (flag OFF) → deploy → validar → encender el flag.
-- La Producción legacy y el resto de la navegación NO dependen de este flag.
-- LOCAL: NO aplicada en remoto (se aplica primero en el entorno aislado).

create table if not exists public.app_flags (
  name text primary key,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.app_flags enable row level security;

drop policy if exists app_flags_sel on public.app_flags;
create policy app_flags_sel on public.app_flags for select to authenticated using (true);
drop policy if exists app_flags_upd on public.app_flags;
create policy app_flags_upd on public.app_flags for update to authenticated
  using (is_owner_or_admin()) with check (is_owner_or_admin());

revoke all on public.app_flags from anon, public;
grant select on public.app_flags to authenticated;
grant update on public.app_flags to authenticated; -- acotado por la policy (solo owner/admin)

insert into public.app_flags (name, enabled) values ('linea_productiva', false)
on conflict (name) do nothing;
