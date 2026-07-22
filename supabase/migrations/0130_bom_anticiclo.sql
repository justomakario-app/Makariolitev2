-- 0130 · M10 — rechazo de BOM cíclico en prod_componente.
-- Un ciclo A→B→A inflaba la demanda ~20 pasadas en silencio (la CTE corta por nivel<20) y podía
-- desbordar integer tumbando las vistas dependientes. Preflight remoto (read-only): 0 ciclos hoy.
-- LOCAL: NO aplicada en remoto (se aplica primero en el entorno aislado).

create or replace function public.prod_tg_componente_anticiclo()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $function$
begin
  if new.padre_sku = new.hijo_sku then
    raise exception 'BOM ciclico: % no puede ser componente de si mismo.', new.padre_sku using errcode='23514';
  end if;
  -- ¿desde el hijo se alcanza al padre? => insertar/actualizar crearía un ciclo
  if exists (
    with recursive desc_ as (
      select c.hijo_sku, 1 as lvl from prod_componente c where c.padre_sku = new.hijo_sku
      union all
      select c.hijo_sku, d.lvl + 1 from desc_ d join prod_componente c on c.padre_sku = d.hijo_sku where d.lvl < 30
    )
    select 1 from desc_ where hijo_sku = new.padre_sku
  ) then
    raise exception 'BOM ciclico: agregar % como hijo de % crearia un ciclo.', new.hijo_sku, new.padre_sku using errcode='23514';
  end if;
  return new;
end $function$;
revoke execute on function public.prod_tg_componente_anticiclo() from public, anon, authenticated;

drop trigger if exists prod_componente_anticiclo on public.prod_componente;
create trigger prod_componente_anticiclo
  before insert or update on public.prod_componente
  for each row execute function public.prod_tg_componente_anticiclo();
