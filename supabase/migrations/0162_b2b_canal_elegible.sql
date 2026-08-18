-- ═══════════════════════════════════════════════════════════════════════════
-- 0162 — El canal deja de ser fijo por cliente: lo elige el comprador
-- ───────────────────────────────────────────────────────────────────────────
-- Hasta acá cada cliente tenía UN canal (customers_b2b.b2b_canal) y toda la
-- tienda le mostraba esa lista y nada más. El dueño lo quiere al revés: una
-- sola cuenta, y en cada ingreso el comprador elige qué catálogo mirar —
-- mayorista o distribuidor — con su lista de precios y su mínimo de compra.
--
-- Cómo queda:
--   · customers_b2b.b2b_canales  → los canales HABILITADOS para ese cliente.
--                                  El dueño los marca; por defecto los dos.
--   · customers_b2b.b2b_canal    → sigue existiendo, ahora como el canal POR
--                                  DEFECTO (el que se abre si todavía no eligió).
--   · b2b_usuario.canal_activo   → el que eligió. Es pegajoso: queda elegido
--                                  entre sesiones hasta que lo cambie.
--
-- Por qué casi no hay que tocar nada más: todas las RPC de la tienda ya
-- resolvían el precio con b2b_fn_canal_actual(). Alcanza con que esa función
-- devuelva el canal ELEGIDO en vez del canal fijo y los precios se acomodan
-- solos en catálogo, carrito y envío.
--
-- Lo único que sí cambia de forma: el carrito pasa a ser UNO POR CANAL. Si
-- alguien arma un pedido mayorista y se pasa a distribuidor, no puede
-- encontrarse el carrito repreciado por debajo del mínimo del otro canal —
-- y al volver, su carrito mayorista sigue como lo dejó.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Canales habilitados por cliente ────────────────────────────────────
alter table public.customers_b2b
  add column if not exists b2b_canales text[] not null
      default array['mayorista','distribuidor']::text[];

-- Los que ya existían conservan EXACTAMENTE lo que tenían. Abrirles el otro
-- canal de prepo sería cambiarle el precio a un cliente vivo sin que nadie lo
-- decida; que el dueño los marque a mano desde el panel.
update public.customers_b2b
   set b2b_canales = array[b2b_canal]
 where b2b_canal is not null
   and b2b_canales = array['mayorista','distribuidor']::text[];

alter table public.customers_b2b
  drop constraint if exists customers_b2b_canales_ck;
alter table public.customers_b2b
  add constraint customers_b2b_canales_ck
  check (
    array_length(b2b_canales, 1) >= 1
    -- El canal por defecto tiene que estar entre los habilitados, o el cliente
    -- entra a un catálogo que no le corresponde.
    and (b2b_canal is null or b2b_canal = any(b2b_canales))
  );

comment on column public.customers_b2b.b2b_canales is
  'Canales que este cliente puede elegir en la tienda. b2b_canal es el que se abre por defecto y siempre es uno de estos.';

-- ── 2. El canal que eligió el comprador ───────────────────────────────────
alter table public.b2b_usuario
  add column if not exists canal_activo text;

comment on column public.b2b_usuario.canal_activo is
  'Catálogo que eligió mirar. Pegajoso entre sesiones. Si le sacan ese canal al cliente, b2b_fn_canal_actual() cae al canal por defecto sola.';

-- ── 3. El canal vigente = el elegido, revalidado en cada llamada ──────────
-- Se revalida SIEMPRE contra b2b_canales: si el dueño le saca un canal a un
-- cliente que lo tenía elegido, la próxima RPC ya lo cambia al de defecto en
-- vez de seguir cobrando la lista que le sacaron.
create or replace function public.b2b_fn_canal_actual()
 returns text
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(
    (select u.canal_activo
       from public.b2b_usuario u
       join public.customers_b2b c on c.id = u.cliente_id
       join public.b2b_canal ca    on ca.codigo = u.canal_activo
      where u.id = auth.uid()
        and u.estado = 'aprobado'
        and c.activo = true
        and c.b2b_habilitado = true
        and ca.activo = true
        and u.canal_activo = any(c.b2b_canales)),
    (select c.b2b_canal
       from public.b2b_usuario u
       join public.customers_b2b c on c.id = u.cliente_id
       join public.b2b_canal ca    on ca.codigo = c.b2b_canal
      where u.id = auth.uid()
        and u.estado = 'aprobado'
        and c.activo = true
        and c.b2b_habilitado = true
        and ca.activo = true)
  );
$function$;

-- El coeficiente sale del canal vigente. Ya no mira customers_b2b: si lo
-- siguiera haciendo, elegir "distribuidor" mostraría precios de distribuidor
-- pero cobraría con el coeficiente del canal fijo.
create or replace function public.b2b_fn_coeficiente_actual()
 returns numeric
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select ca.coeficiente
    from public.b2b_canal ca
   where ca.codigo = public.b2b_fn_canal_actual()
     and ca.activo = true;
$function$;

-- ── 4. Un carrito por canal ───────────────────────────────────────────────
drop index if exists public.b2b_pedido_borrador_uq;
create unique index b2b_pedido_borrador_uq
    on public.b2b_pedido (cliente_id, canal)
 where estado = 'borrador';

create or replace function public.b2b_fn_carrito_id(p_cliente uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_id uuid; v_canal text; v_coef numeric;
begin
  v_canal := public.b2b_fn_canal_actual();
  if v_canal is null then
    raise exception 'Tu cuenta todavia no esta habilitada para comprar.' using errcode='42501';
  end if;

  -- Serializa por cliente Y CANAL: dos pestañas del mismo comprador en el
  -- mismo catálogo pasaban las dos el select de abajo y la segunda chocaba
  -- contra b2b_pedido_borrador_uq con un 23505 crudo. La clave lleva el canal
  -- porque desde ahora el índice único también lo lleva — y el envío de
  -- pedido toma este MISMO cerrojo (ver b2b_rpc_enviar_pedido).
  perform pg_advisory_xact_lock(hashtextextended(p_cliente::text || '|' || v_canal, 0));

  select id into v_id from public.b2b_pedido
   where cliente_id = p_cliente and canal = v_canal and estado = 'borrador';
  if v_id is not null then return v_id; end if;

  select coeficiente into v_coef from public.b2b_canal where codigo = v_canal;

  insert into public.b2b_pedido (cliente_id, creado_por, canal, coeficiente, condicion_pago)
  select p_cliente, auth.uid(), v_canal, v_coef, c.b2b_condicion_pago
    from public.customers_b2b c where c.id = p_cliente
  returning id into v_id;
  return v_id;
end $function$;

-- ── 5. Elegir catálogo ────────────────────────────────────────────────────
create or replace function public.b2b_rpc_set_canal(p_payload jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_canal text; v_cli uuid; v_ca public.b2b_canal%rowtype;
begin
  perform public.b2b_fn_guard();
  v_canal := nullif(trim(p_payload->>'canal'), '');

  select u.cliente_id into v_cli
    from public.b2b_usuario u
    join public.customers_b2b c on c.id = u.cliente_id
   where u.id = auth.uid()
     and u.estado = 'aprobado'
     and c.activo = true
     and c.b2b_habilitado = true;
  if v_cli is null then
    raise exception 'Tu cuenta todavia no esta habilitada para comprar.' using errcode='42501';
  end if;

  -- Un canal que existe pero que este cliente no tiene habilitado da el MISMO
  -- error que uno inventado: si no, la respuesta le sirve para averiguar qué
  -- listas de precios existen del otro lado.
  select ca.* into v_ca
    from public.b2b_canal ca
    join public.customers_b2b c on c.id = v_cli
   where ca.codigo = v_canal
     and ca.activo = true
     and v_canal = any(c.b2b_canales);
  if not found then
    raise exception 'Ese catalogo no esta habilitado para tu cuenta.' using errcode='42501';
  end if;

  update public.b2b_usuario set canal_activo = v_canal, updated_at = now()
   where id = auth.uid();

  return jsonb_build_object(
    'ok', true, 'canal', v_ca.codigo, 'nombre', v_ca.nombre,
    'minimo_pedido', v_ca.minimo_pedido, 'minimo_unidades', v_ca.minimo_unidades);
end $function$;

-- ── 6. Mi cuenta: qué catálogos puedo ver y en cuál estoy ─────────────────
create or replace function public.b2b_rpc_mi_cuenta(p_payload jsonb DEFAULT '{}'::jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_r jsonb; v_canal text;
begin
  if not public.b2b_fn_habilitado() then
    return jsonb_build_object('ok', false, 'motivo', 'b2b_deshabilitado');
  end if;

  v_canal := public.b2b_fn_canal_actual();

  select jsonb_build_object(
           'ok', true, 'usuario_id', u.id, 'nombre', u.nombre, 'email', u.email,
           'estado', u.estado, 'es_titular', u.es_titular,
           'rechazo_motivo', u.rechazo_motivo,
           -- El canal vigente: el que eligió, o el de defecto si todavía no
           -- eligió. La pantalla de "¿qué catálogo querés ver?" se muestra
           -- según canal_elegido, no según este.
           'canal', v_canal,
           'canal_elegido', (u.canal_activo is not null and u.canal_activo = v_canal),
           'cliente', case when u.estado = 'aprobado' then jsonb_build_object(
             'id', c.id, 'nombre', c.nombre, 'cuit', c.cuit,
             -- 'habilitado' es la única pregunta que hace la tienda para dejar
             -- comprar. Tiene que dar exactamente lo mismo que resuelve
             -- b2b_fn_coeficiente_actual(), o la pantalla ofrece un catálogo
             -- que después explota con 42501 en la primera RPC.
             'habilitado', (c.b2b_habilitado and c.activo and v_canal is not null),
             'condicion_pago', c.b2b_condicion_pago,
             'canal', v_canal,
             -- Los mínimos del canal VIGENTE, no los del canal por defecto.
             'minimo_pedido',   (select ca.minimo_pedido   from public.b2b_canal ca where ca.codigo = v_canal),
             'minimo_unidades', (select ca.minimo_unidades from public.b2b_canal ca where ca.codigo = v_canal),
             -- Todos los que puede elegir, para armar la pantalla de elección.
             'canales', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'codigo', ca.codigo, 'nombre', ca.nombre,
                        'minimo_pedido', ca.minimo_pedido,
                        'minimo_unidades', ca.minimo_unidades) order by ca.orden)
                 from public.b2b_canal ca
                where ca.activo = true and ca.codigo = any(c.b2b_canales)), '[]'::jsonb))
           else null end)
    into v_r
    from public.b2b_usuario u
    join public.customers_b2b c on c.id = u.cliente_id
   where u.id = auth.uid();

  if v_r is null then
    return jsonb_build_object('ok', false, 'motivo', 'sin_cuenta_b2b');
  end if;

  update public.b2b_usuario set ultimo_acceso_at = now()
   where id = auth.uid() and estado = 'aprobado';
  return v_r;
end $function$;

-- ── 7. El carrito informa el mínimo DE SU canal ──────────────────────────
-- Antes salía de customers_b2b.b2b_canal. Con dos catálogos abiertos eso
-- mostraba el mínimo del canal por defecto adentro del carrito del otro.
-- Ahora sale de p.canal, que es el canal con el que ese carrito nació.
create or replace function public.b2b_rpc_carrito(p_payload jsonb DEFAULT '{}'::jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_cli uuid; v_id uuid; v_coef numeric; v_canal text;
begin
  perform public.b2b_fn_guard();
  v_cli   := public.b2b_fn_cliente_actual();
  v_coef  := public.b2b_fn_coeficiente_actual();
  v_canal := public.b2b_fn_canal_actual();
  -- v_coef null también corta: si le apagaron el canal al cliente, mostrarle un
  -- carrito con precios en blanco es peor que decirle que su cuenta no está lista.
  if v_cli is null or v_coef is null then
    raise exception 'Tu cuenta todavia no esta habilitada para comprar.' using errcode='42501';
  end if;
  v_id := public.b2b_fn_carrito_id(v_cli);

  return (
    with linea as (
      select i.sku, i.cantidad, i.notas_item,
             s.modelo, s.color,
             bp.multiplo_venta, bp.bulto_cantidad, bp.minimo_sku,
             coalesce(bp.iva_pct, i.iva_pct) as iva_pct,
             -- Precio de HOY. Si el producto ya no esta, se muestra el ultimo
             -- conocido y la linea viaja con disponible=false para que la
             -- pantalla la marque en vez de mentir con un precio que no existe.
             coalesce(public.b2b_fn_precio(bp.sku, v_canal, bp.precio_base, v_coef),
                      i.precio_unitario) as precio_unitario,
             (bp.sku is not null and bp.publicado and bp.precio_base is not null
              and s.activo) as disponible
        from public.b2b_pedido_item i
        join public.sku_catalog s        on s.sku = i.sku
        left join public.b2b_producto bp on bp.sku = i.sku
       where i.pedido_id = v_id
    )
    select jsonb_build_object(
      'ok', true,
      'pedido_id', p.id,
      'estado', p.estado,
      'canal', p.canal,
      'canal_nombre', ca.nombre,
      'condicion_pago', p.condicion_pago,
      'direccion_entrega', p.direccion_entrega,
      'fecha_entrega_deseada', p.fecha_entrega_deseada,
      'notas', p.notas,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'sku', l.sku, 'modelo', l.modelo, 'color', l.color,
                 'cantidad', l.cantidad, 'precio_unitario', l.precio_unitario,
                 'iva_pct', l.iva_pct,
                 'subtotal', round(l.precio_unitario * l.cantidad, 2),
                 'multiplo_venta', l.multiplo_venta, 'bulto_cantidad', l.bulto_cantidad,
                 'minimo_sku', l.minimo_sku, 'disponible', l.disponible,
                 'notas_item', l.notas_item) order by l.sku)
          from linea l), '[]'::jsonb),
      'total_neto',    coalesce((select sum(round(l.precio_unitario * l.cantidad, 2)) from linea l), 0),
      'total_con_iva', coalesce((select sum(round(round(l.precio_unitario * l.cantidad, 2)
                                                 * (1 + l.iva_pct / 100), 2)) from linea l), 0),
      'unidades',      coalesce((select sum(l.cantidad) from linea l), 0),
      'no_disponibles',coalesce((select count(*) from linea l where l.disponible is not true), 0),
      'minimo_pedido', ca.minimo_pedido,
      'minimo_unidades', ca.minimo_unidades
    )
    from public.b2b_pedido p
    left join public.b2b_canal ca on ca.codigo = p.canal
   where p.id = v_id
  );
end $function$;

-- ── 8. Enviar: el borrador DE ESE canal, y el mínimo DE ESE canal ────────
create or replace function public.b2b_rpc_enviar_pedido(p_payload jsonb DEFAULT '{}'::jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cli uuid; v_coef numeric; v_canal text; v_ped public.b2b_pedido%rowtype;
  v_min_monto numeric; v_min_unid integer;
  v_total numeric; v_iva numeric; v_unid integer; v_lineas integer;
  v_numero_may text; v_numero_b2b text; v_pm_id uuid;
  v_cliente_nombre text; v_comprador text; v_canal_nombre text; v_mal text;
begin
  perform public.b2b_fn_guard();
  v_cli   := public.b2b_fn_cliente_actual();
  v_coef  := public.b2b_fn_coeficiente_actual();
  v_canal := public.b2b_fn_canal_actual();
  if v_cli is null or v_coef is null then
    raise exception 'Tu cuenta todavia no esta habilitada para comprar.' using errcode='42501';
  end if;

  -- El MISMO cerrojo que toma b2b_fn_carrito_id (cliente|canal desde 0162).
  -- Sin esto, carrito_set_item de otra pestaña entra después del corte y
  -- agrega renglones que la fábrica nunca ve. El 'for update' de abajo solo
  -- no alcanzaba.
  perform pg_advisory_xact_lock(hashtextextended(v_cli::text || '|' || v_canal, 0));

  -- Filtra por canal: el comprador puede tener un carrito abierto en cada
  -- catálogo y sólo se envía el que está mirando.
  select * into v_ped from public.b2b_pedido
   where cliente_id = v_cli and canal = v_canal and estado = 'borrador' for update;
  if not found then
    raise exception 'No hay un pedido en preparacion.' using errcode='P0002';
  end if;

  select count(*) into v_lineas from public.b2b_pedido_item where pedido_id = v_ped.id;
  if v_lineas = 0 then
    raise exception 'El pedido no tiene productos.' using errcode='22023';
  end if;

  -- 1. Todo lo del pedido sigue existiendo, publicado y con precio
  select string_agg(x.sku, ', ') into v_mal
    from (
      select i.sku from public.b2b_pedido_item i
      left join public.b2b_producto bp on bp.sku = i.sku
      left join public.sku_catalog s   on s.sku = i.sku
      where i.pedido_id = v_ped.id
        and (bp.sku is null or bp.publicado = false or bp.precio_base is null
             or s.activo = false)
    ) x;
  if v_mal is not null then
    raise exception 'Estos productos ya no estan disponibles, sacalos del pedido: %.', v_mal
      using errcode='22023';
  end if;

  -- 2. SE CONGELA EL PRECIO ACÁ, contra la lista de HOY del canal elegido.
  -- Es el mismo número que la pantalla viene mostrando (b2b_rpc_carrito
  -- resuelve igual), así que el cliente no se entera de ningún cambio: lo
  -- que ve es lo que se guarda.
  update public.b2b_pedido_item i
     set precio_base_snap = bp.precio_base,
         coeficiente_snap = v_coef,
         precio_unitario  = public.b2b_fn_precio(bp.sku, v_canal, bp.precio_base, v_coef),
         iva_pct          = bp.iva_pct
    from public.b2b_producto bp
   where bp.sku = i.sku and i.pedido_id = v_ped.id;

  -- 3. Múltiplos y mínimos por SKU, con los valores vigentes
  select string_agg(x.sku, ', ') into v_mal
    from (
      select i.sku from public.b2b_pedido_item i
      join public.b2b_producto bp on bp.sku = i.sku
      where i.pedido_id = v_ped.id
        and (i.cantidad % bp.multiplo_venta <> 0 or i.cantidad < bp.minimo_sku)
    ) x;
  if v_mal is not null then
    raise exception 'Revisa las cantidades de estos productos antes de enviar: %.', v_mal
      using errcode='22023';
  end if;

  select coalesce(sum(i.subtotal), 0),
         coalesce(sum(round(i.subtotal * i.iva_pct / 100, 2)), 0),
         coalesce(sum(i.cantidad), 0)
    into v_total, v_iva, v_unid
    from public.b2b_pedido_item i where i.pedido_id = v_ped.id;

  -- 4. Mínimos DEL CANAL ELEGIDO (antes salían del canal fijo del cliente)
  select ca.minimo_pedido, ca.minimo_unidades, ca.nombre
    into v_min_monto, v_min_unid, v_canal_nombre
    from public.b2b_canal ca where ca.codigo = v_canal;
  if v_min_monto > 0 and v_total < v_min_monto then
    raise exception 'El minimo de compra % es $% (sin IVA) y tu pedido suma $%.',
      v_canal_nombre, to_char(v_min_monto, 'FM999G999G999D00'), to_char(v_total, 'FM999G999G999D00')
      using errcode='22023';
  end if;
  if v_min_unid > 0 and v_unid < v_min_unid then
    raise exception 'El minimo % es de % unidades y tu pedido tiene %.',
      v_canal_nombre, v_min_unid, v_unid using errcode='22023';
  end if;

  if public._admin_check_periodo_cerrado(current_date) then
    raise exception 'El periodo contable esta cerrado. Contactanos para cargar el pedido.'
      using errcode='42501', hint='periodo_cerrado';
  end if;

  -- 5. Se materializa en el admin, con el MISMO contador MAY-xxxx
  v_numero_may := public.fn_next_numero_pedido_mayorista();

  insert into public.pedidos_mayoristas (
    numero_pedido, cliente_id, fecha_pedido, fecha_entrega_estimada,
    estado, condicion_pago, notas, created_by
  ) values (
    v_numero_may, v_cli, current_date, v_ped.fecha_entrega_deseada,
    'cotizacion',
    v_ped.condicion_pago,
    trim(both e'\n' from
      coalesce('Pedido de la tienda B2B (lista ' || coalesce(v_canal_nombre, v_canal) || ').' ||
        e'\nTotal que acepto el cliente: $' || to_char(v_total, 'FM999G999G999D00') ||
        ' neto + $' || to_char(v_iva, 'FM999G999G999D00') ||
        ' de IVA = $' || to_char(v_total + v_iva, 'FM999G999G999D00') || '.' ||
        case when v_ped.direccion_entrega is not null
             then e'\nEntrega: ' || v_ped.direccion_entrega else '' end ||
        case when v_ped.notas is not null
             then e'\nNota del cliente: ' || v_ped.notas else '' end, '')),
    auth.uid()
  ) returning id into v_pm_id;

  insert into public.pedidos_mayoristas_items (pedido_id, sku, cantidad, precio_unitario, notas_item)
  select v_pm_id, i.sku, i.cantidad, i.precio_unitario, i.notas_item
    from public.b2b_pedido_item i where i.pedido_id = v_ped.id;

  -- 6. Se sella el pedido del cliente
  v_numero_b2b := public.b2b_fn_next_numero();
  update public.b2b_pedido
     set estado = 'enviado', numero = v_numero_b2b, enviado_at = now(),
         enviado_por = auth.uid(),
         pedido_mayorista_id = v_pm_id, numero_mayorista = v_numero_may,
         canal = v_canal, coeficiente = v_coef,
         total_neto = v_total, total_iva = v_iva, total_con_iva = v_total + v_iva
   where id = v_ped.id;

  -- 7. El aviso — dice con qué lista compró, que ahora la elige el cliente
  select c.nombre into v_cliente_nombre from public.customers_b2b c where c.id = v_cli;
  select u.nombre into v_comprador from public.b2b_usuario u where u.id = auth.uid();

  perform public.b2b_fn_avisar_interno(
    'nuevo_pedido',
    'Pedido B2B nuevo: ' || v_cliente_nombre || ' (' || coalesce(v_canal_nombre, v_canal) || ')',
    v_comprador || ' cargo el pedido ' || v_numero_may || ' con la lista ' ||
    coalesce(v_canal_nombre, v_canal) || ' (' || v_lineas || ' productos, ' ||
    v_unid || ' unidades, $' || to_char(v_total, 'FM999G999G999D00') ||
    ' neto / $' || to_char(v_total + v_iva, 'FM999G999G999D00') ||
    ' con IVA). Ya esta en Ventas > Mayoristas como cotizacion.',
    '/ventas?tab=mayoristas&pedido=' || v_numero_may,
    array['owner','admin','ventas']::role_enum[]
  );

  return jsonb_build_object('ok', true, 'pedido_id', v_ped.id, 'numero', v_numero_b2b,
                            'numero_mayorista', v_numero_may, 'canal', v_canal,
                            'total_neto', v_total,
                            'total_iva', v_iva, 'total_con_iva', v_total + v_iva,
                            'unidades', v_unid);
end $function$;

-- ── 9. El panel: marcar qué catálogos ve cada cliente ────────────────────
create or replace function public.b2b_rpc_admin_set_cliente(p_payload jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_rol role_enum; v_id uuid; v_canal text; v_canales text[]; v_hab boolean;
  v_c public.customers_b2b%rowtype; v_mal text;
begin
  perform public.b2b_fn_guard();
  v_rol := public.current_user_role();
  if v_rol is null or v_rol not in ('owner','admin') then
    raise exception 'Sin permiso.' using errcode='42501';
  end if;

  v_id := nullif(p_payload->>'cliente_id','')::uuid;
  if v_id is null then
    raise exception 'Falta cliente_id.' using errcode='22023';
  end if;
  select * into v_c from public.customers_b2b where id = v_id for update;
  if not found then
    raise exception 'Cliente no encontrado.' using errcode='P0002';
  end if;

  if p_payload ? 'canales' then
    select array_agg(distinct x) into v_canales
      from jsonb_array_elements_text(p_payload->'canales') x
     where nullif(trim(x),'') is not null;
    if v_canales is null or array_length(v_canales, 1) = 0 then
      raise exception 'Hay que dejarle habilitado al menos un catalogo.' using errcode='22023';
    end if;
    select string_agg(x, ', ') into v_mal from unnest(v_canales) x
     where not exists (select 1 from public.b2b_canal where codigo = x and activo);
    if v_mal is not null then
      raise exception 'Canal invalido o inactivo (%).', v_mal using errcode='22023';
    end if;
  end if;

  if p_payload ? 'canal' then
    v_canal := nullif(trim(p_payload->>'canal'), '');
    if v_canal is null or not exists (select 1 from public.b2b_canal where codigo = v_canal and activo) then
      raise exception 'Canal invalido o inactivo (%).', coalesce(v_canal,'null') using errcode='22023';
    end if;
  end if;

  -- El canal por defecto tiene que quedar adentro de los habilitados. Si el
  -- dueño manda los dos campos, mandan los 'canales'; si sólo achica la lista
  -- y el defecto queda afuera, se corre al primero que quedó.
  v_canales := coalesce(v_canales, v_c.b2b_canales);
  v_canal   := coalesce(v_canal, v_c.b2b_canal);
  if v_canal is null or not (v_canal = any(v_canales)) then
    v_canal := v_canales[1];
  end if;

  if p_payload ? 'habilitado' then
    v_hab := (p_payload->>'habilitado')::boolean;
  end if;

  update public.customers_b2b set
    b2b_canales        = v_canales,
    b2b_canal          = v_canal,
    b2b_habilitado     = case when p_payload ? 'habilitado' then coalesce(v_hab, b2b_habilitado) else b2b_habilitado end,
    b2b_condicion_pago = case when p_payload ? 'condicion_pago'
                              then nullif(trim(p_payload->>'condicion_pago'),'') else b2b_condicion_pago end,
    b2b_notas_internas = case when p_payload ? 'notas_internas'
                              then nullif(trim(p_payload->>'notas_internas'),'') else b2b_notas_internas end,
    es_mayorista       = case when p_payload ? 'habilitado' and coalesce(v_hab,false) then true else es_mayorista end
  where id = v_id;

  -- Los carritos NO se tocan y ya no hay que repreciarlos: desde 0162 cada
  -- borrador nace con su canal y se valúa siempre con ese. Si le sacan un
  -- canal al cliente, su carrito de ese catálogo queda guardado y vuelve a
  -- aparecer intacto el día que se lo rehabiliten.

  select * into v_c from public.customers_b2b where id = v_id;
  return jsonb_build_object(
    'ok', true, 'cliente_id', v_id, 'canal', v_c.b2b_canal, 'canales', to_jsonb(v_c.b2b_canales),
    'habilitado', v_c.b2b_habilitado, 'condicion_pago', v_c.b2b_condicion_pago);
end $function$;

create or replace function public.b2b_rpc_admin_clientes(p_payload jsonb DEFAULT '{}'::jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_rol role_enum; v_r jsonb;
begin
  perform public.b2b_fn_guard();
  v_rol := public.current_user_role();
  if v_rol is null or v_rol not in ('owner','admin','ventas') then
    raise exception 'Sin permiso.' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(x order by x->>'nombre'), '[]'::jsonb) into v_r from (
    select jsonb_build_object(
      'cliente_id', c.id, 'nombre', c.nombre, 'cuit', c.cuit,
      'canal', c.b2b_canal, 'canales', to_jsonb(c.b2b_canales),
      'habilitado', c.b2b_habilitado, 'activo', c.activo,
      'condicion_pago', c.b2b_condicion_pago, 'notas_internas', c.b2b_notas_internas,
      'coeficiente', ca.coeficiente,
      'usuarios', (select count(*) from public.b2b_usuario u where u.cliente_id = c.id),
      'usuarios_pendientes', (select count(*) from public.b2b_usuario u
                               where u.cliente_id = c.id and u.estado = 'pendiente'),
      'pedidos', (select count(*) from public.b2b_pedido p
                   where p.cliente_id = c.id and p.estado <> 'borrador'),
      'ultimo_pedido', (select max(p.enviado_at) from public.b2b_pedido p
                         where p.cliente_id = c.id and p.enviado_at is not null),
      'total_pedido', (select coalesce(sum(i.subtotal), 0)
                         from public.b2b_pedido p
                         join public.b2b_pedido_item i on i.pedido_id = p.id
                        where p.cliente_id = c.id
                          and p.estado not in ('borrador','anulado'))
    ) as x
      from public.customers_b2b c
      left join public.b2b_canal ca on ca.codigo = c.b2b_canal
     where c.es_mayorista = true or c.b2b_canal is not null
  ) t;
  return v_r;
end $function$;

-- ── 10. Permisos ─────────────────────────────────────────────────────────
revoke all on function public.b2b_rpc_set_canal(jsonb) from public;
grant execute on function public.b2b_rpc_set_canal(jsonb) to authenticated;
-- b2b_rpc_set_canal nace con execute para 'anon' por los privilegios por
-- defecto del schema public de Supabase. Sin sesion no hace nada (auth.uid() es
-- null y corta con 42501), pero el resto de las RPC del cliente no lo tienen y
-- una funcion que puede llamar cualquiera desde internet no deberia figurar en
-- la lista por descuido.
revoke execute on function public.b2b_rpc_set_canal(jsonb) from anon;
