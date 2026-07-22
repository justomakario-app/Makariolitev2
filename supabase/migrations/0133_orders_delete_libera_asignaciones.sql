-- 0133 · M13 — integridad ledger↔orders al eliminar pedidos.
-- prod_asignacion.order_id no tiene FK a orders (decisión: no bloquear el flujo real de borrado de
-- pedidos con RESTRICT, ni borrar el ledger con CASCADE). En su lugar: trigger BEFORE DELETE que
-- libera el neto asignado a stock libre EXACTAMENTE una vez (mismo patrón que la cancelación 0120)
-- y marca los vínculos del pedido como 'cancelada'. Así nunca quedan unidades atrapadas en un
-- pedido inexistente y la conservación se mantiene.
-- Preflight remoto (read-only, 2026-07-21): 0 asignaciones huérfanas hoy.
-- LOCAL: NO aplicada en remoto (se aplica primero en el entorno aislado).

create or replace function public.prod_tg_orders_delete_libera()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare r record; v_j uuid;
begin
  for r in
    select producto_sku, sum(cantidad)::int as net
    from public.prod_asignacion where order_id = old.id
    group by producto_sku having sum(cantidad) > 0
  loop
    perform pg_advisory_xact_lock(hashtext('prod_term:'||r.producto_sku));
    select jornada_id into v_j from public.prod_jornada_orden where order_id = old.id limit 1;
    insert into public.prod_asignacion(order_id, producto_sku, jornada_id, cantidad, tipo, origen, motivo, usuario)
      values (old.id, r.producto_sku, v_j, -r.net, 'liberada', 'orders_delete', 'pedido eliminado', auth.uid());
    insert into public.prod_stock_terminado(producto_sku, disponible) values (r.producto_sku, r.net)
      on conflict (producto_sku) do update set disponible = prod_stock_terminado.disponible + r.net, updated_at = now();
  end loop;
  update public.prod_jornada_orden set snapshot_status = 'cancelada'
    where order_id = old.id and coalesce(snapshot_status,'') not in ('cancelada','cumplida');
  return old;
end $function$;
revoke execute on function public.prod_tg_orders_delete_libera() from public, anon, authenticated;

drop trigger if exists orders_delete_libera_lp on public.orders;
create trigger orders_delete_libera_lp
  before delete on public.orders
  for each row execute function public.prod_tg_orders_delete_libera();
