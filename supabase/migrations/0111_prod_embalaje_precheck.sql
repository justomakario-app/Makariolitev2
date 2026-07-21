-- 0111 · Pre-check de Embalaje canónico (BOM), misma fuente que el consumo. Read-only.
-- (Aplicada en remoto vía MCP el 2026-07-20; reconstruida como archivo local — no re-ejecutar.)
create or replace function public.prod_rpc_embalaje_precheck(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_role role_enum; v_active boolean; v_prod text; v_unid int; res jsonb;
begin
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('embalaje','encargado','owner','admin') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_prod := p_payload->>'producto_sku';
  v_unid := greatest(coalesce((p_payload->>'unidades')::int,1), 1);
  if not exists (select 1 from prod_producto where sku=v_prod) then raise exception 'Producto % no existe.', v_prod using errcode='22023'; end if;

  with recursive bom as (
    select hijo_sku sku, cantidad::numeric qty from prod_componente where padre_sku=v_prod
    union all select c.hijo_sku, b.qty*c.cantidad from bom b join prod_componente c on c.padre_sku=b.sku
  ),
  leaves as (
    select b.sku, sum(b.qty) qty from bom b
    where not exists (select 1 from prod_componente c where c.padre_sku=b.sku) group by b.sku
  ),
  mel as (
    select r.pieza_sku sku, 'melamina'::text pool, 'melamina'::text sector,
      (v_unid*r.cantidad) requerido, coalesce(sm.disponible,0) disponible
    from prod_receta r left join prod_stock_melamina sm on sm.pieza_sku=r.pieza_sku
    where r.producto_sku=v_prod and public.prod_pieza_pool(r.pieza_sku)='melamina'
  ),
  pat as (
    select ('PATA '||upper(t.tamano)) sku, 'patas'::text pool, 'pino'::text sector,
      (v_unid*sum(l.qty))::int requerido, coalesce(max(sp.disponible),0) disponible
    from leaves l join prod_pata_tamano t on t.pieza_sku=l.sku
    left join prod_stock_patas sp on sp.tamano=t.tamano
    group by t.tamano
  ),
  ins as (
    select l.sku, 'insumo'::text pool, coalesce(i.sector,'insumo') sector,
      (v_unid*l.qty)::int requerido, coalesce(i.stock_actual,0)::int disponible
    from leaves l join prod_insumo i on i.sku=l.sku
  ),
  todo as (select * from mel union all select * from pat union all select * from ins)
  select jsonb_build_object(
    'producto', v_prod, 'unidades', v_unid,
    'componentes', coalesce((select jsonb_agg(jsonb_build_object(
        'componente', sku, 'pool', pool, 'sector', sector,
        'requerido', requerido, 'disponible', disponible,
        'faltante', greatest(requerido-disponible,0), 'suficiente', (disponible>=requerido))
        order by pool, sku) from todo), '[]'::jsonb),
    'suficiente_total', not exists (select 1 from todo where disponible < requerido)
  ) into res;
  return res;
end $function$;
