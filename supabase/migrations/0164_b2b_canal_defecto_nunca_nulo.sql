-- ════════════════════════════════════════════════════════════════════════
-- 0164 · El catálogo de arranque nunca puede quedar en NULL
--
-- POR QUÉ
-- Un cliente puede tener b2b_canales cargado (los catálogos que ve) y
-- b2b_canal en NULL (con cuál arranca). Pasa de verdad: el único cliente de
-- la tienda hoy está así — ['mayorista','distribuidor'] habilitados y
-- b2b_canal NULL — porque la lista de canales nació con un default en 0162 y
-- el canal de arranque nunca se llegó a elegir desde el panel.
--
-- Con b2b_fn_canal_actual() como estaba, ese cliente devolvía NULL: el primer
-- coalesce mira u.canal_activo (que un comprador nuevo no tiene) y el segundo
-- mira c.b2b_canal (NULL). Sin canal no hay precio — b2b_fn_precio se llama
-- con el canal — así que el catálogo entero le quedaba sin valuar.
--
-- Hoy eso no se ve, porque la pantalla de elección de catálogo (0162 + la
-- tienda) se mete antes: el comprador elige, se le graba canal_activo y de
-- ahí en más el primer coalesce contesta. Pero es una red que depende de que
-- el cliente tenga la lista cargada y de que el front la muestre. El default
-- no puede depender de eso.
--
-- QUÉ HACE
--   1. Deja a b2b_fn_canal_actual() con un tercer escalón: si no hay canal
--      activo y tampoco canal de arranque, cae al primero de los habilitados.
--      Es la MISMA regla que ya aplica b2b_rpc_admin_set_cliente cuando el
--      canal de arranque queda afuera de la lista (0162), así que no inventa
--      un criterio nuevo: lo hace valer siempre, no sólo al guardar la ficha.
--   2. Rellena los b2b_canal en NULL que ya existen, con el mismo criterio,
--      SOLO para los clientes que son de la tienda mayorista. b2b_canales
--      tiene default, así que lo tiene cargado hasta un cliente que nunca
--      pisó la tienda: llenarle el canal de arranque a ese lo haría aparecer
--      en la pestaña Clientes del panel (su filtro es "es_mayorista or
--      b2b_canal is not null"), que es justo lo que no queremos.
--
-- QUÉ NO HACE
--   · No toca precios ni pedidos: los pedidos enviados tienen su precio
--     congelado en b2b_pedido_item.precio_unitario.
--   · No cambia el canal de nadie que ya tenga uno.
--   · No toca b2b_canales: qué catálogos ve cada cliente se sigue decidiendo
--     desde el panel (pestaña Clientes).
--
-- Idempotente: se puede correr de nuevo sin efecto.
--
-- NOTA DE APLICACIÓN (2026-08-18): la primera pasada contra la base fue con
-- el UPDATE sin el filtro de "es de la tienda", y le puso arranque a un
-- cliente cargado ese mismo día que no es mayorista. Se revirtió a NULL en el
-- acto y el archivo quedó con el filtro. Correr este archivo de cero deja el
-- mismo estado que hay hoy en la base.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. El fallback ───────────────────────────────────────────────────────
create or replace function public.b2b_fn_canal_actual()
 returns text
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(
    -- (a) el que el comprador eligió, si sigue habilitado para su cliente
    (select u.canal_activo
       from public.b2b_usuario u
       join public.customers_b2b c on c.id = u.cliente_id
       join public.b2b_canal ca    on ca.codigo = u.canal_activo
      where u.id = auth.uid() and u.estado = 'aprobado'
        and c.activo = true and c.b2b_habilitado = true and ca.activo = true
        and u.canal_activo = any(c.b2b_canales)),
    -- (b) el catálogo de arranque del cliente
    (select c.b2b_canal
       from public.b2b_usuario u
       join public.customers_b2b c on c.id = u.cliente_id
       join public.b2b_canal ca    on ca.codigo = c.b2b_canal
      where u.id = auth.uid() and u.estado = 'aprobado'
        and c.activo = true and c.b2b_habilitado = true and ca.activo = true),
    -- (c) sin arranque cargado: el primero de los habilitados que esté activo.
    --     Es la misma regla de b2b_rpc_admin_set_cliente, aplicada siempre.
    (select x
       from public.b2b_usuario u
       join public.customers_b2b c on c.id = u.cliente_id
       cross join lateral unnest(c.b2b_canales) with ordinality as t(x, n)
       join public.b2b_canal ca    on ca.codigo = t.x
      where u.id = auth.uid() and u.estado = 'aprobado'
        and c.activo = true and c.b2b_habilitado = true and ca.activo = true
      order by t.n
      limit 1)
  );
$function$;

comment on function public.b2b_fn_canal_actual() is
  'Canal vigente del comprador logueado: el que eligió, si no el de arranque del cliente, si no el primero de los habilitados (0164). Nunca devuelve NULL para un cliente habilitado con al menos un catalogo activo.';

-- ── 2. Los que ya están en NULL ──────────────────────────────────────────
-- Se arregla el dato, no sólo la lectura: el panel, los reportes y cualquier
-- consulta que mire customers_b2b.b2b_canal directo tienen que ver lo mismo
-- que ve la tienda.
update public.customers_b2b c
   set b2b_canal = (
         select t.x
           from unnest(c.b2b_canales) with ordinality as t(x, n)
           join public.b2b_canal ca on ca.codigo = t.x
          where ca.activo = true
          order by t.n
          limit 1)
 where c.b2b_canal is null
   and c.b2b_canales is not null
   and array_length(c.b2b_canales, 1) >= 1
   and exists (select 1 from unnest(c.b2b_canales) x
                join public.b2b_canal ca on ca.codigo = x where ca.activo = true)
   -- Solo los que ya son de la tienda: marcados como mayoristas, o con algún
   -- comprador o pedido. Al resto, el canal de arranque se lo pone el dueño
   -- desde el panel el día que los sume (y si no, el escalon (c) de arriba
   -- los cubre igual).
   and (c.es_mayorista = true
        or exists (select 1 from public.b2b_usuario u where u.cliente_id = c.id)
        or exists (select 1 from public.b2b_pedido  p where p.cliente_id = c.id));

commit;
