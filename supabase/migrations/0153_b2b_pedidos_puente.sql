-- 0153 · B2B (3/3) CARRITO, PEDIDO Y **EL PUENTE AL ADMIN MAYORISTA**.
--
-- ESTO ES LO QUE PIDIO EL DUENO, TEXTUAL:
--   "Que esto tenga conexion con la parte de mayorista de administracion para que
--    automaticamente se llene todo y nos llegue una notificacion con su pedido y todo"
--
-- COMO SE CUMPLE
--   El cliente arma su carrito en b2b_pedido (estado 'borrador') y aprieta Enviar.
--   b2b_rpc_enviar_pedido hace, en UNA transaccion:
--     1. valida titularidad, minimos del canal, multiplos y que los SKUs sigan publicados
--     2. numera el pedido comercial con fn_next_numero_pedido_mayorista() — el MISMO
--        contador MAY-xxxx que usa el admin, asi que no hay dos numeraciones
--     3. INSERTA en pedidos_mayoristas + pedidos_mayoristas_items con estado 'cotizacion'
--        -> el pedido aparece solo en Ventas > Mayoristas, sin que nadie tipee nada
--     4. inserta la notificacion 'nuevo_pedido' para owner/admin/ventas
--     5. deja b2b_pedido.pedido_mayorista_id apuntando al pedido del admin
--   Despues, cuando el admin mueve el estado en Mayoristas, un trigger espeja ese estado
--   de vuelta al pedido del cliente. UNA sola direccion: el admin manda, la tienda refleja.
--   (Es la leccion de 0150: el espejo nunca maneja al maestro.)
--
-- LIMITE HONESTO DE LA NOTIFICACION — hay que decirlo antes de que sorprenda:
--   Este sistema NO puede mandar un mail, un WhatsApp ni un push. Verificado: no estan
--   instaladas pg_net, http ni pg_cron; no hay Database Webhooks (el schema supabase_functions
--   no existe); mobile/sw.js no tiene handler push; y 8 de 16 usuarios tienen mail @*.local
--   inventado. El unico canal real hoy es la campanita in-app, que SI llega en vivo porque
--   public.notifications viaja por supabase_realtime. O sea: el aviso aparece al instante
--   para quien tenga Makario Lite abierto, y queda esperando para quien no.
--   El hook para sacarlo afuera esta centralizado en b2b_fn_avisar_interno() (0151):
--   instalar pg_net y agregar ahi el POST alcanza; ninguna RPC cambia.
--   Ojo aparte: la bandeja tiene 2594 avisos y 2594 sin leer (2328 son "Produccion
--   completada"). Un 'nuevo_pedido' va a entrar ahi adentro. Conviene depurar antes.
--
-- POR QUE EL PEDIDO B2B **NO** ENTRA EN public.orders (decision deliberada)
--   orders es el pipeline de MercadoLibre/Tienda Nube: 13.246 filas, 100% origen='excel',
--   UNIQUE (channel_id, order_number, sku), y prod_fn_candidatos levanta cualquier fila
--   'pendiente'/'arrastrado' hacia Linea Productiva. Meter ahi el primer pedido manual de la
--   historia arrastraria el B2B a la jornada productiva y al cierre comercial de una.
--   Ademas order_origen_enum solo tiene 'excel' y 'manual', y hay 2 jornadas abiertas ahora
--   mismo, con lo cual toda escritura exigiria p_target_jornada_id. El puente se corta en
--   pedidos_mayoristas, que es exactamente donde el admin ya espera los pedidos B2B.
--   Conectar B2B -> orders -> produccion es un paso posterior y explicito.
--
-- ✅ APLICADA EN REMOTO el 2026-08-15. El puente existe pero todavia no puede dispararse:
--    b2b_fn_guard() corta con 42501 mientras app_flags.b2b siga en false.

-- ─────────────────────────────────────────────────────────────────────────
-- (A) Numeracion propia de la tienda (ademas del MAY-xxxx del admin)
-- ─────────────────────────────────────────────────────────────────────────

create sequence if not exists public.b2b_pedido_seq;
-- El default ACL de public concede rwU sobre cada secuencia nueva a anon y authenticated.
revoke all on sequence public.b2b_pedido_seq from anon, public, authenticated;

create or replace function public.b2b_fn_next_numero()
returns text language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
begin
  return 'B2B-' || lpad(nextval('public.b2b_pedido_seq')::text, 5, '0');
end $fn$;
revoke execute on function public.b2b_fn_next_numero() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- (B) b2b_pedido — es el carrito Y el pedido. El carrito vive en la base
--     (estado 'borrador'), no en localStorage: por eso sobrevive al cambio de
--     dispositivo, como pide el brief.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.b2b_pedido (
  id                    uuid primary key default gen_random_uuid(),
  numero                text unique,
  cliente_id            uuid not null references public.customers_b2b(id) on delete restrict,
  creado_por            uuid not null references public.b2b_usuario(id) on delete restrict,
  estado                text not null default 'borrador'
                          check (estado in ('borrador','enviado','confirmado','en_produccion',
                                            'listo_despacho','despachado','facturado','anulado')),
  canal                 text references public.b2b_canal(codigo),
  coeficiente           numeric(6,4),
  condicion_pago        text,
  direccion_entrega     text,
  fecha_entrega_deseada date,
  notas                 text,
  pedido_mayorista_id   uuid unique references public.pedidos_mayoristas(id) on delete set null,
  numero_mayorista      text,
  enviado_at            timestamptz,
  anulado_at            timestamptz,
  anulado_motivo        text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- Un pedido enviado tiene que tener numero, sello de envio y su par en el admin.
  constraint b2b_pedido_enviado_ck check (
    estado = 'borrador' or (numero is not null and enviado_at is not null)
  )
);

comment on table public.b2b_pedido is
  'Carrito persistente + pedido del cliente B2B. Al enviarse se materializa en pedidos_mayoristas (pedido_mayorista_id) y el estado del admin se espeja de vuelta por trigger.';

alter table public.b2b_pedido
  add column if not exists enviado_por uuid references public.b2b_usuario(id);
comment on column public.b2b_pedido.enviado_por is
  'Quien apreto Enviar. creado_por es solo quien abrio el carrito: con varios usuarios por cliente (que es justo lo que habilita 0151) no son el mismo.';

-- Un solo carrito abierto por cliente: el carrito ES el borrador.
create unique index if not exists b2b_pedido_borrador_uq
  on public.b2b_pedido (cliente_id) where estado = 'borrador';
create index if not exists b2b_pedido_cliente_idx
  on public.b2b_pedido (cliente_id, created_at desc);

drop trigger if exists b2b_pedido_updated_at on public.b2b_pedido;
create trigger b2b_pedido_updated_at before update on public.b2b_pedido
  for each row execute function public.set_updated_at();

create table if not exists public.b2b_pedido_item (
  id               uuid primary key default gen_random_uuid(),
  pedido_id        uuid not null references public.b2b_pedido(id) on delete cascade,
  sku              text not null references public.sku_catalog(sku) on delete restrict,
  cantidad         integer not null check (cantidad > 0),
  -- PRECIO CONGELADO al momento de agregar al carrito (requisito del brief). Si el dueno
  -- sube la lista despues, el pedido ya cargado no cambia. Se guarda tambien la base y el
  -- coeficiente con que se calculo, para poder auditar de donde salio el numero.
  precio_base_snap numeric(12,2) not null check (precio_base_snap >= 0),
  coeficiente_snap numeric(6,4)  not null check (coeficiente_snap > 0),
  precio_unitario  numeric(12,2) not null check (precio_unitario >= 0),
  iva_pct          numeric(5,2)  not null default 21,
  subtotal         numeric(14,2) generated always as (cantidad * precio_unitario) stored,
  notas_item       text,
  created_at       timestamptz not null default now(),
  unique (pedido_id, sku)
);

create index if not exists b2b_pedido_item_pedido_idx on public.b2b_pedido_item (pedido_id);

-- ─────────────────────────────────────────────────────────────────────────
-- (C) RLS — el cliente LEE lo suyo y nada mas. No escribe nunca por PostgREST:
--     no hay policy de INSERT/UPDATE/DELETE, asi que toda mutacion pasa por RPC.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.b2b_pedido      enable row level security;
alter table public.b2b_pedido_item enable row level security;

drop policy if exists b2b_pedido_sel on public.b2b_pedido;
create policy b2b_pedido_sel on public.b2b_pedido for select to authenticated
  using (cliente_id = public.b2b_fn_cliente_actual() or public.is_owner_or_admin());

drop policy if exists b2b_pedido_item_sel on public.b2b_pedido_item;
create policy b2b_pedido_item_sel on public.b2b_pedido_item for select to authenticated
  using (exists (
    select 1 from public.b2b_pedido p
     where p.id = b2b_pedido_item.pedido_id
       and (p.cliente_id = public.b2b_fn_cliente_actual() or public.is_owner_or_admin())
  ));

-- El cliente NO lee estas dos tablas por PostgREST, ni siquiera las propias.
-- b2b_pedido.coeficiente y b2b_pedido_item.precio_base_snap/coeficiente_snap revelan la
-- estructura de precios: con UN solo coeficiente + b2b_rpc_catalogo (que devuelve
-- precio_base*coef de todo el catalogo) se reconstruye el precio_base — o sea el precio
-- minorista completo — de todos los SKU. Lectura solo por RPC (b2b_rpc_carrito /
-- b2b_rpc_mis_pedidos / b2b_rpc_admin_pedidos), que son SECURITY DEFINER y no dependen de
-- estos grants. Las policies de arriba quedan como defensa en profundidad por si alguien
-- vuelve a conceder SELECT.
revoke all on public.b2b_pedido      from anon, public, authenticated;
revoke all on public.b2b_pedido_item from anon, public, authenticated;

drop trigger if exists b2b_pedido_audit on public.b2b_pedido;
create trigger b2b_pedido_audit after insert or update or delete on public.b2b_pedido
  for each row execute function public.trg_audit_log();

-- ─────────────────────────────────────────────────────────────────────────
-- (D) Mapeo de estados admin -> tienda, en un solo lugar
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.b2b_fn_map_estado(p_estado pedido_mayorista_estado)
returns text language sql immutable set search_path to 'public','pg_temp' as $fn$
  select case p_estado
           when 'cotizacion'   then 'enviado'
           when 'confirmado'   then 'confirmado'
           when 'en_produccion' then 'en_produccion'
           when 'listo'        then 'listo_despacho'
           when 'entregado'    then 'despachado'
           when 'cancelado'    then 'anulado'
         end;
$fn$;
-- No necesita grant: la unica llamada es desde b2b_fn_sync_estado, que es SECURITY DEFINER.
revoke execute on function public.b2b_fn_map_estado(pedido_mayorista_estado)
  from public, anon, authenticated;
-- Nota: 'facturado' existe en el estado de la tienda pero HOY nada lo emite: no hay tabla de
-- facturas ni integracion AFIP/ARCA en todo el sistema (la pestana Facturacion del admin es
-- un placeholder). Queda declarado para cuando exista.

-- Espejo admin -> tienda. Una sola direccion.
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
     and estado <> 'borrador';
  return new;
end $fn$;

drop trigger if exists b2b_tg_sync_estado on public.pedidos_mayoristas;
create trigger b2b_tg_sync_estado after update of estado on public.pedidos_mayoristas
  for each row when (old.estado is distinct from new.estado)
  execute function public.b2b_fn_sync_estado();

-- ─────────────────────────────────────────────────────────────────────────
-- (E) Vista para el admin: que pedidos entraron por la tienda
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
           where i.pedido_id = bp.id)  as unidades
    from public.b2b_pedido bp
    join public.pedidos_mayoristas pm on pm.id = bp.pedido_mayorista_id
    join public.customers_b2b c       on c.id = bp.cliente_id
    -- enviado_por y no creado_por: creado_por es solo quien abrio el carrito, y con varios
    -- usuarios por cliente el admin veria el pedido atribuido a quien no lo mando.
    join public.b2b_usuario u         on u.id = coalesce(bp.enviado_por, bp.creado_por);

-- La vista NO se abre a 'authenticated': el rol authenticated incluye a los clientes B2B, y
-- una vista corre con los permisos de su dueno (postgres), o sea que saltea la RLS de las
-- tablas de abajo. Abrirla seria darle a cada cliente los pedidos y totales de los demas.
-- Se lee solo desde b2b_rpc_admin_pedidos, que valida rol interno.
revoke all on public.b2b_v_pedidos_admin from anon, public, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- (F) RPCs del cliente
-- ─────────────────────────────────────────────────────────────────────────

-- Devuelve el carrito completo (creandolo si no existe). Uso interno de las RPC de abajo.
create or replace function public.b2b_fn_carrito_id(p_cliente uuid)
returns uuid language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_id uuid; v_canal text; v_coef numeric;
begin
  -- Serializa por cliente: sin esto, dos requests concurrentes (dos pestanas, doble tap del
  -- movil) pasan ambos el SELECT de abajo y el segundo choca contra b2b_pedido_borrador_uq
  -- con un 23505 crudo. Un 'for update' no sirve: en la carrera no hay fila que lockear.
  perform pg_advisory_xact_lock(hashtextextended(p_cliente::text, 0));

  select id into v_id from public.b2b_pedido
   where cliente_id = p_cliente and estado = 'borrador';
  if v_id is not null then return v_id; end if;

  select c.b2b_canal, ca.coeficiente into v_canal, v_coef
    from public.customers_b2b c join public.b2b_canal ca on ca.codigo = c.b2b_canal
   where c.id = p_cliente;

  insert into public.b2b_pedido (cliente_id, creado_por, canal, coeficiente, condicion_pago)
  select p_cliente, auth.uid(), v_canal, v_coef, c.b2b_condicion_pago
    from public.customers_b2b c where c.id = p_cliente
  returning id into v_id;
  return v_id;
end $fn$;
revoke execute on function public.b2b_fn_carrito_id(uuid) from public, anon, authenticated;

create or replace function public.b2b_rpc_carrito(p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_cli uuid; v_id uuid;
begin
  perform public.b2b_fn_guard();
  v_cli := public.b2b_fn_cliente_actual();
  if v_cli is null then
    raise exception 'Tu cuenta todavia no esta habilitada para comprar.' using errcode='42501';
  end if;
  v_id := public.b2b_fn_carrito_id(v_cli);

  return (
    select jsonb_build_object(
      'ok', true,
      'pedido_id', p.id,
      'estado', p.estado,
      'condicion_pago', p.condicion_pago,
      'direccion_entrega', p.direccion_entrega,
      'fecha_entrega_deseada', p.fecha_entrega_deseada,
      'notas', p.notas,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'sku', i.sku, 'modelo', s.modelo, 'color', s.color,
                 'cantidad', i.cantidad, 'precio_unitario', i.precio_unitario,
                 'iva_pct', i.iva_pct, 'subtotal', i.subtotal,
                 'multiplo_venta', bp.multiplo_venta, 'bulto_cantidad', bp.bulto_cantidad,
                 'notas_item', i.notas_item) order by i.sku)
          from public.b2b_pedido_item i
          join public.sku_catalog s   on s.sku = i.sku
          left join public.b2b_producto bp on bp.sku = i.sku
         where i.pedido_id = p.id), '[]'::jsonb),
      'total_neto', coalesce((select sum(i.subtotal) from public.b2b_pedido_item i
                               where i.pedido_id = p.id), 0),
      'unidades', coalesce((select sum(i.cantidad) from public.b2b_pedido_item i
                             where i.pedido_id = p.id), 0),
      'minimo_pedido', ca.minimo_pedido,
      'minimo_unidades', ca.minimo_unidades
    )
    from public.b2b_pedido p
    join public.customers_b2b c on c.id = p.cliente_id
    left join public.b2b_canal ca on ca.codigo = c.b2b_canal
   where p.id = v_id
  );
end $fn$;
revoke execute on function public.b2b_rpc_carrito(jsonb) from public, anon;
grant  execute on function public.b2b_rpc_carrito(jsonb) to authenticated;

-- Alta / cambio / baja de una linea. cantidad = 0 borra.
create or replace function public.b2b_rpc_carrito_set_item(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare
  v_cli uuid; v_id uuid; v_coef numeric; v_sku text; v_cant integer;
  v_p public.b2b_producto%rowtype;
begin
  perform public.b2b_fn_guard();
  v_cli  := public.b2b_fn_cliente_actual();
  v_coef := public.b2b_fn_coeficiente_actual();
  if v_cli is null or v_coef is null then
    raise exception 'Tu cuenta todavia no esta habilitada para comprar.' using errcode='42501';
  end if;

  v_sku  := nullif(trim(p_payload->>'sku'), '');
  v_cant := coalesce((p_payload->>'cantidad')::integer, 0);
  if v_sku is null then
    raise exception 'Falta el SKU.' using errcode='22023';
  end if;
  if v_cant < 0 then
    raise exception 'La cantidad no puede ser negativa.' using errcode='22023';
  end if;

  v_id := public.b2b_fn_carrito_id(v_cli);

  if v_cant = 0 then
    delete from public.b2b_pedido_item where pedido_id = v_id and sku = v_sku;
    return jsonb_build_object('ok', true, 'sku', v_sku, 'cantidad', 0);
  end if;

  select * into v_p from public.b2b_producto where sku = v_sku;
  if not found or v_p.publicado = false or v_p.precio_base is null then
    raise exception 'Ese producto no esta disponible.' using errcode='P0002';
  end if;
  if v_cant % v_p.multiplo_venta <> 0 then
    raise exception 'La cantidad de % debe ser multiplo de %.', v_sku, v_p.multiplo_venta
      using errcode='22023';
  end if;
  if v_cant < v_p.minimo_sku then
    raise exception 'El minimo por unidad de % es %.', v_sku, v_p.minimo_sku
      using errcode='22023';
  end if;

  insert into public.b2b_pedido_item as it (
    pedido_id, sku, cantidad, precio_base_snap, coeficiente_snap, precio_unitario, iva_pct, notas_item
  ) values (
    v_id, v_sku, v_cant, v_p.precio_base, v_coef,
    round(v_p.precio_base * v_coef, 2), v_p.iva_pct,
    nullif(trim(p_payload->>'notas_item'), '')
  )
  on conflict (pedido_id, sku) do update set
    cantidad   = excluded.cantidad,
    notas_item = coalesce(excluded.notas_item, it.notas_item);

  return jsonb_build_object('ok', true, 'sku', v_sku, 'cantidad', v_cant);
end $fn$;
revoke execute on function public.b2b_rpc_carrito_set_item(jsonb) from public, anon;
grant  execute on function public.b2b_rpc_carrito_set_item(jsonb) to authenticated;

-- Datos de cabecera del carrito (entrega, notas)
create or replace function public.b2b_rpc_carrito_set_datos(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_cli uuid; v_id uuid;
begin
  perform public.b2b_fn_guard();
  v_cli := public.b2b_fn_cliente_actual();
  if v_cli is null then
    raise exception 'Tu cuenta todavia no esta habilitada para comprar.' using errcode='42501';
  end if;
  v_id := public.b2b_fn_carrito_id(v_cli);

  update public.b2b_pedido set
    direccion_entrega     = coalesce(nullif(trim(p_payload->>'direccion_entrega'),''), direccion_entrega),
    fecha_entrega_deseada = coalesce(nullif(p_payload->>'fecha_entrega_deseada','')::date, fecha_entrega_deseada),
    notas                 = coalesce(nullif(trim(p_payload->>'notas'),''), notas)
  where id = v_id and estado = 'borrador';

  return jsonb_build_object('ok', true, 'pedido_id', v_id);
end $fn$;
revoke execute on function public.b2b_rpc_carrito_set_datos(jsonb) from public, anon;
grant  execute on function public.b2b_rpc_carrito_set_datos(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- (G) ★ EL PUENTE ★  borrador -> pedidos_mayoristas + notificacion
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.b2b_rpc_enviar_pedido(p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare
  v_cli uuid; v_id uuid; v_ped public.b2b_pedido%rowtype;
  v_min_monto numeric; v_min_unid integer;
  v_total numeric; v_unid integer; v_lineas integer;
  v_numero_may text; v_numero_b2b text; v_pm_id uuid;
  v_cliente_nombre text; v_comprador text; v_mal text;
begin
  perform public.b2b_fn_guard();
  v_cli := public.b2b_fn_cliente_actual();
  if v_cli is null then
    raise exception 'Tu cuenta todavia no esta habilitada para comprar.' using errcode='42501';
  end if;

  -- Se toma el borrador con lock: dos clicks simultaneos no generan dos pedidos.
  select * into v_ped from public.b2b_pedido
   where cliente_id = v_cli and estado = 'borrador' for update;
  if not found then
    raise exception 'No hay un pedido en preparacion.' using errcode='P0002';
  end if;

  select coalesce(sum(i.subtotal), 0), coalesce(sum(i.cantidad), 0), count(*)
    into v_total, v_unid, v_lineas
    from public.b2b_pedido_item i where i.pedido_id = v_ped.id;
  if v_lineas = 0 then
    raise exception 'El pedido no tiene productos.' using errcode='22023';
  end if;

  -- Los productos siguen publicados y con el multiplo vigente
  select string_agg(x.sku, ', ') into v_mal
    from (
      select i.sku from public.b2b_pedido_item i
      left join public.b2b_producto p on p.sku = i.sku
      where i.pedido_id = v_ped.id
        and (p.sku is null or p.publicado = false or i.cantidad % p.multiplo_venta <> 0)
    ) x;
  if v_mal is not null then
    raise exception 'Revisa estos productos antes de enviar: %.', v_mal using errcode='22023';
  end if;

  -- Minimos del canal
  select ca.minimo_pedido, ca.minimo_unidades into v_min_monto, v_min_unid
    from public.customers_b2b c join public.b2b_canal ca on ca.codigo = c.b2b_canal
   where c.id = v_cli;
  if v_min_monto > 0 and v_total < v_min_monto then
    raise exception 'El minimo de compra es % y tu pedido suma %.', v_min_monto, v_total
      using errcode='22023';
  end if;
  if v_min_unid > 0 and v_unid < v_min_unid then
    raise exception 'El minimo es % unidades y tu pedido tiene %.', v_min_unid, v_unid
      using errcode='22023';
  end if;

  -- Periodo contable cerrado (misma regla que el resto del modulo comercial)
  if public._admin_check_periodo_cerrado(current_date) then
    raise exception 'El periodo contable esta cerrado. Contactanos para cargar el pedido.'
      using errcode='42501', hint='periodo_cerrado';
  end if;

  -- ── 1. Se materializa en el admin, con el MISMO contador MAY-xxxx ──────
  v_numero_may := public.fn_next_numero_pedido_mayorista();

  insert into public.pedidos_mayoristas (
    numero_pedido, cliente_id, fecha_pedido, fecha_entrega_estimada,
    estado, condicion_pago, notas, created_by
  ) values (
    v_numero_may, v_cli, current_date, v_ped.fecha_entrega_deseada,
    'cotizacion',
    v_ped.condicion_pago,
    trim(both e'\n' from
      coalesce('Pedido de la tienda B2B.' ||
        case when v_ped.direccion_entrega is not null
             then e'\nEntrega: ' || v_ped.direccion_entrega else '' end ||
        case when v_ped.notas is not null
             then e'\nNota del cliente: ' || v_ped.notas else '' end, '')),
    auth.uid()
  ) returning id into v_pm_id;

  insert into public.pedidos_mayoristas_items (pedido_id, sku, cantidad, precio_unitario, notas_item)
  select v_pm_id, i.sku, i.cantidad, i.precio_unitario, i.notas_item
    from public.b2b_pedido_item i where i.pedido_id = v_ped.id;

  -- ── 2. Se sella el pedido del cliente ─────────────────────────────────
  v_numero_b2b := public.b2b_fn_next_numero();
  update public.b2b_pedido
     set estado = 'enviado', numero = v_numero_b2b, enviado_at = now(),
         enviado_por = auth.uid(),
         pedido_mayorista_id = v_pm_id, numero_mayorista = v_numero_may
   where id = v_ped.id;

  -- ── 3. El aviso ───────────────────────────────────────────────────────
  select c.nombre into v_cliente_nombre from public.customers_b2b c where c.id = v_cli;
  select u.nombre into v_comprador from public.b2b_usuario u where u.id = auth.uid();

  perform public.b2b_fn_avisar_interno(
    'nuevo_pedido',
    'Pedido B2B nuevo: ' || v_cliente_nombre,
    v_comprador || ' cargo el pedido ' || v_numero_may || ' (' || v_lineas || ' productos, ' ||
    v_unid || ' unidades, $' || to_char(v_total, 'FM999G999G999D00') ||
    ' neto). Ya esta en Ventas > Mayoristas como cotizacion.',
    '/ventas?tab=mayoristas&pedido=' || v_numero_may,
    array['owner','admin','ventas']::role_enum[]
  );

  return jsonb_build_object('ok', true, 'pedido_id', v_ped.id, 'numero', v_numero_b2b,
                            'numero_mayorista', v_numero_may, 'total_neto', v_total,
                            'unidades', v_unid);
end $fn$;
revoke execute on function public.b2b_rpc_enviar_pedido(jsonb) from public, anon;
grant  execute on function public.b2b_rpc_enviar_pedido(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- (H) Historial del cliente y anulacion temprana
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.b2b_rpc_mis_pedidos(p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_temp' as $fn$
declare v_cli uuid;
begin
  perform public.b2b_fn_guard();
  v_cli := public.b2b_fn_cliente_actual();
  if v_cli is null then
    raise exception 'Tu cuenta todavia no esta habilitada.' using errcode='42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'pedido_id', p.id, 'numero', p.numero, 'estado', p.estado,
             'enviado_at', p.enviado_at, 'fecha_entrega_deseada', p.fecha_entrega_deseada,
             'total_neto', (select coalesce(sum(i.subtotal),0) from public.b2b_pedido_item i
                             where i.pedido_id = p.id),
             'unidades', (select coalesce(sum(i.cantidad),0) from public.b2b_pedido_item i
                           where i.pedido_id = p.id),
             'items', (select coalesce(jsonb_agg(jsonb_build_object(
                          'sku', i.sku, 'cantidad', i.cantidad,
                          'precio_unitario', i.precio_unitario, 'subtotal', i.subtotal)
                        order by i.sku), '[]'::jsonb)
                       from public.b2b_pedido_item i where i.pedido_id = p.id))
           order by p.created_at desc)
      from public.b2b_pedido p
     where p.cliente_id = v_cli and p.estado <> 'borrador'
  ), '[]'::jsonb);
end $fn$;
revoke execute on function public.b2b_rpc_mis_pedidos(jsonb) from public, anon;
grant  execute on function public.b2b_rpc_mis_pedidos(jsonb) to authenticated;

-- El cliente puede dar de baja su pedido SOLO mientras el admin no lo toco todavia
-- (pedidos_mayoristas sigue en 'cotizacion'). Despues, lo cancela el admin.
create or replace function public.b2b_rpc_anular_pedido(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_cli uuid; v_p public.b2b_pedido%rowtype; v_est pedido_mayorista_estado; v_cn text;
begin
  perform public.b2b_fn_guard();
  v_cli := public.b2b_fn_cliente_actual();
  if v_cli is null then
    raise exception 'Tu cuenta todavia no esta habilitada.' using errcode='42501';
  end if;

  select * into v_p from public.b2b_pedido
   where id = nullif(p_payload->>'pedido_id','')::uuid and cliente_id = v_cli for update;
  if not found then
    raise exception 'Pedido no encontrado.' using errcode='P0002';
  end if;
  if v_p.estado <> 'enviado' then
    raise exception 'El pedido ya esta en curso. Escribinos para darlo de baja.' using errcode='0A000';
  end if;

  select estado into v_est from public.pedidos_mayoristas where id = v_p.pedido_mayorista_id for update;
  if v_est is distinct from 'cotizacion' then
    raise exception 'El pedido ya esta en curso. Escribinos para darlo de baja.' using errcode='0A000';
  end if;

  update public.pedidos_mayoristas set estado = 'cancelado' where id = v_p.pedido_mayorista_id;
  update public.b2b_pedido
     set estado = 'anulado', anulado_at = now(),
         anulado_motivo = nullif(trim(p_payload->>'motivo'),'')
   where id = v_p.id;

  select nombre into v_cn from public.customers_b2b where id = v_cli;
  perform public.b2b_fn_avisar_interno(
    'sistema',
    'Pedido B2B anulado: ' || v_cn,
    'El cliente anulo el pedido ' || coalesce(v_p.numero_mayorista, v_p.numero) || '.',
    '/ventas?tab=mayoristas&pedido=' || coalesce(v_p.numero_mayorista, ''),
    array['owner','admin','ventas']::role_enum[]
  );

  return jsonb_build_object('ok', true, 'pedido_id', v_p.id, 'estado', 'anulado');
end $fn$;
revoke execute on function public.b2b_rpc_anular_pedido(jsonb) from public, anon;
grant  execute on function public.b2b_rpc_anular_pedido(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- (I) Lo que el admin ve de la tienda
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.b2b_rpc_admin_pedidos(p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_temp' as $fn$
declare v_rol role_enum;
begin
  perform public.b2b_fn_guard();
  v_rol := public.current_user_role();
  if v_rol is null or v_rol not in ('owner','admin','ventas') then
    raise exception 'Sin permiso.' using errcode='42501';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(v) order by v.enviado_at desc)
      from public.b2b_v_pedidos_admin v
     where (nullif(p_payload->>'estado','') is null
            or v.estado_admin::text = p_payload->>'estado')
  ), '[]'::jsonb);
end $fn$;
revoke execute on function public.b2b_rpc_admin_pedidos(jsonb) from public, anon;
grant  execute on function public.b2b_rpc_admin_pedidos(jsonb) to authenticated;
