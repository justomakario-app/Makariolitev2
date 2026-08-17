-- ═══════════════════════════════════════════════════════════════════════════
-- 0161 — El pedido facturado se ve, y deja de perderse solo
--
-- 0158 agregó b2b_rpc_admin_facturar_pedido, facturado_at y factura_nro. Lo
-- que no agregó fue por dónde usarlos: b2b_v_pedidos_admin nunca expuso el
-- estado del lado tienda ni el número de factura, así que el panel no tenía
-- cómo saber si un pedido ya estaba facturado ni cómo mostrarlo. La RPC
-- quedó escrita, con permisos, y sin una sola llamada en toda la app.
--
-- Dos cosas, entonces:
--
--   (A) La vista devuelve estado_tienda, facturado_at y factura_nro. El
--       estado del admin (pedidos_mayoristas.estado) y el de la tienda
--       (b2b_pedido.estado) NO son lo mismo y esto es justo el caso donde
--       se separan: facturar mueve el de la tienda a 'facturado' y deja el
--       del admin en 'entregado'. Sin las dos columnas, el panel muestra
--       "Despachado" para siempre y el dueño no sabe qué facturó.
--
--   (B) El espejo admin → tienda deja de pisar un 'facturado'.
--       b2b_fn_sync_estado mapea el estado del admin al de la tienda cada
--       vez que el primero cambia. Como 'facturado' no existe del lado del
--       admin, ningún mapeo lo devuelve: alcanzaba con corregir el estado
--       del pedido (entregado → listo → entregado, que es lo que se hace
--       cuando alguien se equivocó de fila) para que la tienda volviera a
--       'despachado' y el pedido quedara sin facturar... con facturado_at y
--       factura_nro todavía cargados. Un registro que se contradice solo.
--       Ahora un pedido facturado no baja de estado. La única excepción es
--       'anulado': si el pedido se cancela, la tienda tiene que enterarse,
--       facturado o no.
--
-- Nada de esto cambia precios, pedidos ni permisos.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- (A) Vista del admin: agregar el estado de la tienda y los datos de factura
--     Las columnas nuevas van al final, que es lo único que permite
--     `create or replace view` sin dropear (y dropearla obligaría a recrear
--     los grants, que es justo donde se filtran los permisos).
-- ─────────────────────────────────────────────────────────────────────────

create or replace view public.b2b_v_pedidos_admin as
  select pm.id               as pedido_mayorista_id,
         pm.numero_pedido,
         pm.estado           as estado_admin,
         pm.fecha_pedido,
         pm.fecha_entrega_estimada,
         c.id                as cliente_id,
         c.nombre            as cliente,
         c.b2b_canal         as canal,
         bp.id               as b2b_pedido_id,
         bp.numero           as numero_b2b,
         bp.enviado_at,
         coalesce(bp.enviado_por, bp.creado_por) as b2b_usuario_id,
         u.nombre            as comprador,
         u.email             as comprador_email,
         (select coalesce(sum(i.subtotal), 0) from public.b2b_pedido_item i
           where i.pedido_id = bp.id)  as total_neto,
         (select coalesce(sum(i.cantidad), 0) from public.b2b_pedido_item i
           where i.pedido_id = bp.id)  as unidades,
         -- ── 0161: lo que faltaba para que el panel pudiera facturar ──
         bp.estado           as estado_tienda,
         bp.facturado_at,
         bp.factura_nro
    from public.b2b_pedido bp
    join public.pedidos_mayoristas pm on pm.id = bp.pedido_mayorista_id
    join public.customers_b2b c       on c.id = bp.cliente_id
    join public.b2b_usuario u         on u.id = coalesce(bp.enviado_por, bp.creado_por);

-- Sigue cerrada a authenticated (incluye a los clientes B2B): una vista corre
-- con los permisos de su dueño y saltearía la RLS de las tablas de abajo.
-- Se lee solo desde b2b_rpc_admin_pedidos, que valida el rol interno.
revoke all on public.b2b_v_pedidos_admin from anon, public, authenticated;

comment on view public.b2b_v_pedidos_admin is
  'Pedidos que entraron por la tienda mayorista, para el panel. estado_admin es el de '
  'pedidos_mayoristas (lo que maneja el dueño) y estado_tienda el de b2b_pedido (lo que ve '
  'el cliente): coinciden salvo en facturado, que solo existe del lado tienda (0161).';

-- ─────────────────────────────────────────────────────────────────────────
-- (B) El espejo no degrada un pedido ya facturado
--     Antes: `estado is distinct from v_nuevo and estado <> 'borrador'`.
--     Corregir el estado del admin sobre un pedido facturado lo devolvía a
--     'despachado' dejando factura_nro cargado.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.b2b_fn_sync_estado()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_nuevo text;
begin
  v_nuevo := public.b2b_fn_map_estado(new.estado);
  if v_nuevo is null then return new; end if;
  update public.b2b_pedido
     set estado = v_nuevo,
         anulado_at = case when v_nuevo = 'anulado' then coalesce(anulado_at, now()) else anulado_at end
   where pedido_mayorista_id = new.id
     and estado is distinct from v_nuevo
     and estado <> 'borrador'
     -- 0161: un pedido facturado no vuelve atrás porque alguien corrigió el
     -- estado del admin. Anular sí lo pisa: si el pedido se cae, el cliente
     -- tiene que verlo, esté facturado o no.
     and (estado <> 'facturado' or v_nuevo = 'anulado');
  return new;
end $fn$;

comment on function public.b2b_fn_sync_estado() is
  'Espejo pedidos_mayoristas.estado -> b2b_pedido.estado, una sola direccion. 0161: no '
  'degrada un pedido facturado (salvo para anularlo).';
