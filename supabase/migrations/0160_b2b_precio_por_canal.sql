-- ════════════════════════════════════════════════════════════════════════════
-- 0160 — Precio de lista por canal (lo que el coeficiente no puede expresar)
--
-- QUE PASO
-- El dueno dejo los dos catalogos de julio ("Catologo mayorista/"): la lista
-- mayorista y la lista distribuidor, precio por precio. Cruzadas, dicen que el
-- modelo de 0152 no alcanza.
--
-- 0152 calcula TODO como  precio_base x coeficiente_del_canal  (distribuidor
-- 0,55 · mayorista 0,70). Con eso, la razon distribuidor/mayorista es la misma
-- para todos los productos: 0,55 / 0,70 = 0,7857. Siempre. Sin excepcion.
--
-- Las listas de verdad NO se comportan asi:
--
--     PRODUCTO                        MAYORISTA   DISTRIB.   dist/may
--     Set Mesas Boomerang                34.149     25.764     0,7545
--     Mesa Rectangular (blanco/negro)    22.315     18.290     0,8196
--     Velador Bali                       13.803     12.089     0,8758
--     Mesa de luz Hikari                 24.402     22.380     0,9171
--     Florero Baires                      4.700      4.500     0,9574
--     Box Aroma                           6.900      6.700     0,9710
--     Figura Muditando                    4.000      4.000     1,0000
--                                                    ...
--     min 0,7545 · max 1,0000 · promedio 0,8851   (27 productos comparados)
--
-- O sea: cada producto tiene su propio margen por canal, puesto a mano. No hay
-- un coeficiente que los explique. Si se cargaban los 61 precios con el modelo
-- viejo, la tienda le iba a cobrar mal al distribuidor en TODOS los productos:
-- de menos hasta un 19% en la linea 3D (Box Aroma: la formula da 5.421 y la
-- lista dice 6.700) y de mas en las mesas (Boomerang: la formula da 26.831 y la
-- lista dice 25.764). Plata real, en cada pedido.
--
-- QUE HACE ESTA MIGRACION
-- Agrega `b2b_precio_canal`: un precio explicito, opcional, por (sku, canal).
-- Cuando existe, MANDA. Cuando no existe, sigue valiendo precio_base x
-- coeficiente, exactamente como hasta ahora.
--
-- Es aditivo a proposito: no obliga a cargar 61 x 2 precios para arrancar. El
-- coeficiente queda como default razonable para lo que todavia no tiene lista,
-- y las listas de julio entran tal cual estan, sin redondeos ni inventos.
--
-- precio_base NO deja de ser obligatorio para publicar: sigue siendo el precio
-- de referencia (minorista, coeficiente 1,00) y la red de seguridad de
-- b2b_producto_publicado_ck. El precio por canal lo refina, no lo reemplaza.
--
-- SOBRE coeficiente_snap
-- b2b_pedido_item guarda precio_base_snap y coeficiente_snap para auditar de
-- donde salio el numero. Cuando el precio viene de una lista, ya no vale
-- precio_base_snap x coeficiente_snap = precio_unitario. Se decidio dejar
-- coeficiente_snap con el coeficiente REAL del canal (que es un dato cierto) en
-- vez de fabricar un coeficiente efectivo que nadie configuro. La trazabilidad
-- la da b2b_precio_historial, que a partir de aca tambien registra los precios
-- por canal. El numero que factura es precio_unitario, que se congela igual.
--
-- LO QUE NO CAMBIA
-- El cliente sigue sin ver precio_base, ni el coeficiente, ni el precio de otro
-- canal: b2b_rpc_catalogo devuelve un solo numero, el suyo. b2b_precio_canal se
-- suma a la lista de tablas que el cliente no puede leer.
-- ════════════════════════════════════════════════════════════════════════════

-- ── (A) La tabla ────────────────────────────────────────────────────────────
create table if not exists public.b2b_precio_canal (
  sku          text not null references public.b2b_producto(sku) on delete cascade,
  canal        text not null references public.b2b_canal(codigo) on update cascade,
  precio_neto  numeric(12,2) not null check (precio_neto > 0),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) on delete set null,
  primary key (sku, canal)
);

comment on table public.b2b_precio_canal is
  'Precio de lista NETO por (SKU, canal). Cuando hay fila, gana sobre b2b_producto.precio_base x b2b_canal.coeficiente (0160). Nunca se expone al cliente.';
comment on column public.b2b_precio_canal.precio_neto is
  'Precio sin IVA que paga ese canal por ese SKU. Tal cual la lista, sin coeficientes.';

-- ── (B) Historial ───────────────────────────────────────────────────────────
-- Se reusa b2b_precio_historial (0152) con una columna nueva: canal null es el
-- precio_base de siempre, canal no null es un precio de lista. Asi "a que precio
-- estaba el 3 de marzo" se responde en una sola tabla y no en dos.
alter table public.b2b_precio_historial
  add column if not exists canal text;

comment on column public.b2b_precio_historial.canal is
  'null = cambio de precio_base. No null = cambio del precio de lista de ese canal (0160).';

create or replace function public.b2b_fn_log_precio_canal()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  insert into public.b2b_precio_historial (sku, canal, precio_ant, precio_nue, cambiado_por)
  values (
    coalesce(new.sku, old.sku),
    coalesce(new.canal, old.canal),
    case when tg_op in ('UPDATE','DELETE') then old.precio_neto end,
    case when tg_op in ('INSERT','UPDATE') then new.precio_neto end,
    auth.uid()
  );
  return null;
end $function$;

drop trigger if exists b2b_precio_canal_log on public.b2b_precio_canal;
create trigger b2b_precio_canal_log
  after insert or update of precio_neto or delete on public.b2b_precio_canal
  for each row execute function public.b2b_fn_log_precio_canal();

-- ── (C) Permisos ────────────────────────────────────────────────────────────
-- Misma regla que b2b_producto: contiene precios de TODOS los canales, asi que
-- un cliente que la lea ve la lista de sus competidores. Solo interno.
alter table public.b2b_precio_canal enable row level security;

revoke all on public.b2b_precio_canal from anon, public, authenticated;
grant select on public.b2b_precio_canal to authenticated;

drop policy if exists b2b_precio_canal_sel on public.b2b_precio_canal;
create policy b2b_precio_canal_sel on public.b2b_precio_canal
  for select to authenticated
  using (public.is_owner_or_admin());

-- ── (D) Resolucion del precio ───────────────────────────────────────────────
-- Un solo lugar donde se decide cuanto vale un SKU para un canal. Todas las RPC
-- pasan por aca: si manana cambia la regla, cambia una funcion y no ocho.
create or replace function public.b2b_fn_precio(
  p_sku text, p_canal text, p_precio_base numeric, p_coef numeric)
returns numeric
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(
    (select pc.precio_neto from public.b2b_precio_canal pc
      where pc.sku = p_sku and pc.canal = p_canal),
    round(p_precio_base * p_coef, 2));
$function$;

comment on function public.b2b_fn_precio(text, text, numeric, numeric) is
  'Precio neto de un SKU para un canal: la lista explicita si existe, si no precio_base x coeficiente (0160). Devuelve null si no hay ninguno de los dos.';

revoke execute on function public.b2b_fn_precio(text, text, numeric, numeric) from public, anon;
grant  execute on function public.b2b_fn_precio(text, text, numeric, numeric) to authenticated;

-- Canal del cliente que esta llamando. Se apoya en las dos funciones que ya
-- existen para heredar EXACTAMENTE el mismo criterio de habilitacion: si
-- b2b_fn_coeficiente_actual() devuelve null (canal apagado, cliente cortado),
-- esta tambien devuelve null y las RPC cortan igual que antes.
create or replace function public.b2b_fn_canal_actual()
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select c.b2b_canal
    from public.customers_b2b c
   where c.id = public.b2b_fn_cliente_actual()
     and public.b2b_fn_coeficiente_actual() is not null;
$function$;

revoke execute on function public.b2b_fn_canal_actual() from public, anon;
grant  execute on function public.b2b_fn_canal_actual() to authenticated;

-- ── (E) Catalogo del CLIENTE ────────────────────────────────────────────────
create or replace function public.b2b_rpc_catalogo(p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_coef numeric; v_canal text; v_q text; v_cat text;
begin
  perform public.b2b_fn_guard();
  v_coef  := public.b2b_fn_coeficiente_actual();
  v_canal := public.b2b_fn_canal_actual();
  if v_coef is null then
    raise exception 'Tu cuenta todavia no esta habilitada para comprar.' using errcode='42501';
  end if;

  v_q   := nullif(trim(p_payload->>'q'), '');
  v_cat := nullif(trim(p_payload->>'categoria'), '');

  return coalesce((
    select jsonb_agg(x order by (x->>'orden')::int, x->>'sku')
      from (
        select jsonb_build_object(
                 'sku', p.sku,
                 'modelo', s.modelo,
                 'color', s.color,
                 'color_hex', s.color_hex,
                 'categoria', s.categoria,
                 'descripcion', p.descripcion,
                 'foto_path', p.foto_path,
                 'unidad_venta', p.unidad_venta,
                 'bulto_cantidad', p.bulto_cantidad,
                 'multiplo_venta', p.multiplo_venta,
                 'minimo_sku', p.minimo_sku,
                 'moneda', p.moneda,
                 'iva_pct', p.iva_pct,
                 'precio', public.b2b_fn_precio(p.sku, v_canal, p.precio_base, v_coef),
                 'precio_con_iva', round(public.b2b_fn_precio(p.sku, v_canal, p.precio_base, v_coef)
                                         * (1 + p.iva_pct / 100), 2),
                 'orden', p.orden
               ) as x
          from public.b2b_producto p
          join public.sku_catalog s on s.sku = p.sku
         where p.publicado = true
           and s.activo = true
           and (v_cat is null or s.categoria = v_cat)
           and (v_q is null or p.sku ilike '%' || v_q || '%'
                            or s.modelo ilike '%' || v_q || '%'
                            or s.color ilike '%' || v_q || '%')
      ) t
  ), '[]'::jsonb);
end $function$;

-- ── (F) Carrito: precio vivo ────────────────────────────────────────────────
create or replace function public.b2b_rpc_carrito(p_payload jsonb default '{}'::jsonb)
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
  -- v_coef null tambien corta: si le apagaron el canal al cliente, mostrarle un
  -- carrito con precios en blanco es peor que decirle que su cuenta no esta lista.
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
    join public.customers_b2b c on c.id = p.cliente_id
    left join public.b2b_canal ca on ca.codigo = c.b2b_canal
   where p.id = v_id
  );
end $function$;

-- ── (G) Agregar / cambiar cantidad ──────────────────────────────────────────
create or replace function public.b2b_rpc_carrito_set_item(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cli uuid; v_id uuid; v_coef numeric; v_canal text; v_sku text; v_cant integer;
  v_pb numeric; v_pub boolean; v_mult integer; v_min integer; v_iva numeric; v_activo boolean;
begin
  perform public.b2b_fn_guard();
  v_cli   := public.b2b_fn_cliente_actual();
  v_coef  := public.b2b_fn_coeficiente_actual();
  v_canal := public.b2b_fn_canal_actual();
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
  -- El 'for update' hace dos cosas: corta si el pedido ya se envio desde otra
  -- pestana, y ordena la espera contra la transaccion de envio en vez de chocar.
  perform 1 from public.b2b_pedido where id = v_id and estado = 'borrador' for update;
  if not found then
    raise exception 'Este pedido ya se envio. Abri uno nuevo.' using errcode='0A000';
  end if;

  if v_cant = 0 then
    delete from public.b2b_pedido_item where pedido_id = v_id and sku = v_sku;
    return jsonb_build_object('ok', true, 'sku', v_sku, 'cantidad', 0);
  end if;

  select bp.precio_base, bp.publicado, bp.multiplo_venta, bp.minimo_sku, bp.iva_pct, s.activo
    into v_pb, v_pub, v_mult, v_min, v_iva, v_activo
    from public.b2b_producto bp
    join public.sku_catalog s on s.sku = bp.sku
   where bp.sku = v_sku;
  if not found or v_pub = false or v_pb is null or v_activo = false then
    raise exception 'Ese producto no esta disponible.' using errcode='P0002';
  end if;
  if v_cant % v_mult <> 0 then
    raise exception 'La cantidad de % debe ser multiplo de %.', v_sku, v_mult using errcode='22023';
  end if;
  if v_cant < v_min then
    raise exception 'El minimo por unidad de % es %.', v_sku, v_min using errcode='22023';
  end if;

  insert into public.b2b_pedido_item as it (
    pedido_id, sku, cantidad, precio_base_snap, coeficiente_snap, precio_unitario, iva_pct, notas_item
  ) values (
    v_id, v_sku, v_cant, v_pb, v_coef,
    public.b2b_fn_precio(v_sku, v_canal, v_pb, v_coef), v_iva,
    nullif(trim(p_payload->>'notas_item'), '')
  )
  on conflict (pedido_id, sku) do update set
    cantidad   = excluded.cantidad,
    notas_item = coalesce(excluded.notas_item, it.notas_item),
    -- Se refresca el snapshot aunque el congelado de verdad lo haga enviar_pedido:
    -- asi la fila de la base coincide con lo que la pantalla le esta mostrando.
    precio_base_snap = excluded.precio_base_snap,
    coeficiente_snap = excluded.coeficiente_snap,
    precio_unitario  = excluded.precio_unitario,
    iva_pct          = excluded.iva_pct;

  return jsonb_build_object('ok', true, 'sku', v_sku, 'cantidad', v_cant);
end $function$;

-- ── (H) Enviar: congelado del precio ────────────────────────────────────────
create or replace function public.b2b_rpc_enviar_pedido(p_payload jsonb default '{}'::jsonb)
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
  v_cliente_nombre text; v_comprador text; v_mal text;
begin
  perform public.b2b_fn_guard();
  v_cli   := public.b2b_fn_cliente_actual();
  v_coef  := public.b2b_fn_coeficiente_actual();
  v_canal := public.b2b_fn_canal_actual();
  if v_cli is null or v_coef is null then
    raise exception 'Tu cuenta todavia no esta habilitada para comprar.' using errcode='42501';
  end if;

  -- El MISMO cerrojo que toma b2b_fn_carrito_id. Sin esto, carrito_set_item de
  -- otra pestana entra despues del corte y agrega renglones que la fabrica
  -- nunca ve. El 'for update' de abajo solo no alcanzaba.
  perform pg_advisory_xact_lock(hashtextextended(v_cli::text, 0));

  select * into v_ped from public.b2b_pedido
   where cliente_id = v_cli and estado = 'borrador' for update;
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

  -- 2. SE CONGELA EL PRECIO ACA, contra la lista de HOY (la del canal si la hay,
  -- si no el coeficiente de HOY). Es el mismo numero que la pantalla viene
  -- mostrando (b2b_rpc_carrito resuelve igual), asi que el cliente no se entera
  -- de ningun cambio: lo que ve es lo que se guarda.
  update public.b2b_pedido_item i
     set precio_base_snap = bp.precio_base,
         coeficiente_snap = v_coef,
         precio_unitario  = public.b2b_fn_precio(bp.sku, v_canal, bp.precio_base, v_coef),
         iva_pct          = bp.iva_pct
    from public.b2b_producto bp
   where bp.sku = i.sku and i.pedido_id = v_ped.id;

  -- 3. Multiplos y minimos por SKU, con los valores vigentes
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

  -- 4. Minimos del canal
  select ca.minimo_pedido, ca.minimo_unidades into v_min_monto, v_min_unid
    from public.customers_b2b c join public.b2b_canal ca on ca.codigo = c.b2b_canal
   where c.id = v_cli;
  if v_min_monto > 0 and v_total < v_min_monto then
    raise exception 'El minimo de compra es % (sin IVA) y tu pedido suma %.', v_min_monto, v_total
      using errcode='22023';
  end if;
  if v_min_unid > 0 and v_unid < v_min_unid then
    raise exception 'El minimo es % unidades y tu pedido tiene %.', v_min_unid, v_unid
      using errcode='22023';
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
      coalesce('Pedido de la tienda B2B.' ||
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
         coeficiente = v_coef,
         total_neto = v_total, total_iva = v_iva, total_con_iva = v_total + v_iva
   where id = v_ped.id;

  -- 7. El aviso
  select c.nombre into v_cliente_nombre from public.customers_b2b c where c.id = v_cli;
  select u.nombre into v_comprador from public.b2b_usuario u where u.id = auth.uid();

  perform public.b2b_fn_avisar_interno(
    'nuevo_pedido',
    'Pedido B2B nuevo: ' || v_cliente_nombre,
    v_comprador || ' cargo el pedido ' || v_numero_may || ' (' || v_lineas || ' productos, ' ||
    v_unid || ' unidades, $' || to_char(v_total, 'FM999G999G999D00') ||
    ' neto / $' || to_char(v_total + v_iva, 'FM999G999G999D00') ||
    ' con IVA). Ya esta en Ventas > Mayoristas como cotizacion.',
    '/ventas?tab=mayoristas&pedido=' || v_numero_may,
    array['owner','admin','ventas']::role_enum[]
  );

  return jsonb_build_object('ok', true, 'pedido_id', v_ped.id, 'numero', v_numero_b2b,
                            'numero_mayorista', v_numero_may, 'total_neto', v_total,
                            'total_iva', v_iva, 'total_con_iva', v_total + v_iva,
                            'unidades', v_unid);
end $function$;

-- ── (I) Repetir pedido ──────────────────────────────────────────────────────
create or replace function public.b2b_rpc_repetir_pedido(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cli uuid; v_coef numeric; v_canal text; v_carrito uuid; v_modo text;
  v_origen public.b2b_pedido%rowtype;
  v_it record; v_cant integer; v_previa integer; v_repetibles integer;
  v_agregados integer := 0;
  v_omitidos  jsonb := '[]'::jsonb;
  v_ajustados jsonb := '[]'::jsonb;
begin
  perform public.b2b_fn_guard();
  v_cli   := public.b2b_fn_cliente_actual();
  v_coef  := public.b2b_fn_coeficiente_actual();
  v_canal := public.b2b_fn_canal_actual();
  if v_cli is null or v_coef is null then
    raise exception 'Tu cuenta todavia no esta habilitada para comprar.' using errcode='42501';
  end if;

  v_modo := lower(coalesce(nullif(trim(p_payload->>'modo'), ''), 'agregar'));
  if v_modo not in ('agregar', 'reemplazar') then
    raise exception 'Modo invalido: usa "agregar" o "reemplazar".' using errcode='22023';
  end if;

  select * into v_origen from public.b2b_pedido
   where cliente_id = v_cli
     and estado <> 'borrador'
     and ( (p_payload ? 'pedido_id' and id = nullif(p_payload->>'pedido_id','')::uuid)
        or (p_payload ? 'numero'    and numero = nullif(trim(p_payload->>'numero'),'')) );
  if not found then
    raise exception 'No encontramos ese pedido.' using errcode='P0002';
  end if;

  -- Se cuenta ANTES de tocar nada. En modo "reemplazar" el delete iba primero:
  -- si despues no entraba ninguna linea (todo despublicado), el cliente se
  -- quedaba sin el carrito que tenia Y sin el pedido que quiso repetir.
  select count(*) into v_repetibles
    from public.b2b_pedido_item i
    join public.b2b_producto bp on bp.sku = i.sku
    join public.sku_catalog s   on s.sku = i.sku
   where i.pedido_id = v_origen.id
     and bp.publicado and bp.precio_base is not null and s.activo;
  if v_repetibles = 0 then
    raise exception 'Ninguno de los productos de ese pedido sigue disponible.' using errcode='P0002';
  end if;

  v_carrito := public.b2b_fn_carrito_id(v_cli);
  perform 1 from public.b2b_pedido where id = v_carrito and estado = 'borrador' for update;
  if not found then
    raise exception 'Este pedido ya se envio. Abri uno nuevo.' using errcode='0A000';
  end if;

  if v_modo = 'reemplazar' then
    delete from public.b2b_pedido_item where pedido_id = v_carrito;
  end if;

  for v_it in
    select i.sku, i.cantidad,
           bp.precio_base, bp.publicado, bp.iva_pct, bp.multiplo_venta, bp.minimo_sku,
           s.activo
      from public.b2b_pedido_item i
      left join public.b2b_producto bp on bp.sku = i.sku
      left join public.sku_catalog s   on s.sku = i.sku
     where i.pedido_id = v_origen.id
     order by i.sku
  loop
    if v_it.precio_base is null or coalesce(v_it.publicado, false) = false
       or coalesce(v_it.activo, false) = false then
      v_omitidos := v_omitidos || jsonb_build_object(
        'sku', v_it.sku, 'motivo', 'ya no esta a la venta');
      continue;
    end if;

    select cantidad into v_previa from public.b2b_pedido_item
     where pedido_id = v_carrito and sku = v_it.sku;
    v_cant := coalesce(v_previa, 0) + v_it.cantidad;

    if v_cant < v_it.minimo_sku then
      v_ajustados := v_ajustados || jsonb_build_object(
        'sku', v_it.sku, 'pedida', v_cant, 'cargada', v_it.minimo_sku,
        'motivo', 'ahora el minimo es ' || v_it.minimo_sku);
      v_cant := v_it.minimo_sku;
    end if;
    if v_cant % v_it.multiplo_venta <> 0 then
      v_ajustados := v_ajustados || jsonb_build_object(
        'sku', v_it.sku, 'pedida', v_cant,
        'cargada', ((v_cant / v_it.multiplo_venta) + 1) * v_it.multiplo_venta,
        'motivo', 'ahora se vende de a ' || v_it.multiplo_venta);
      v_cant := ((v_cant / v_it.multiplo_venta) + 1) * v_it.multiplo_venta;
    end if;

    insert into public.b2b_pedido_item as it (
      pedido_id, sku, cantidad, precio_base_snap, coeficiente_snap, precio_unitario, iva_pct
    ) values (
      v_carrito, v_it.sku, v_cant, v_it.precio_base, v_coef,
      public.b2b_fn_precio(v_it.sku, v_canal, v_it.precio_base, v_coef), v_it.iva_pct
    )
    on conflict (pedido_id, sku) do update set
      cantidad         = excluded.cantidad,
      precio_base_snap = excluded.precio_base_snap,
      coeficiente_snap = excluded.coeficiente_snap,
      precio_unitario  = excluded.precio_unitario,
      iva_pct          = excluded.iva_pct;

    v_agregados := v_agregados + 1;
  end loop;

  update public.b2b_pedido
     set direccion_entrega = coalesce(direccion_entrega, v_origen.direccion_entrega)
   where id = v_carrito and estado = 'borrador';

  return jsonb_build_object('ok', true, 'pedido_id', v_carrito, 'origen', v_origen.numero,
    'agregados', v_agregados, 'omitidos', v_omitidos, 'ajustados', v_ajustados);
end $function$;

-- ── (J) Cambio de canal del cliente: repreciar el carrito abierto ───────────
create or replace function public.b2b_rpc_admin_set_cliente(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_rol role_enum; v_id uuid; v_canal text; v_hab boolean; v_c public.customers_b2b%rowtype;
  v_coef numeric;
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

  if p_payload ? 'canal' then
    v_canal := nullif(trim(p_payload->>'canal'), '');
    if v_canal is null or not exists (select 1 from public.b2b_canal where codigo = v_canal and activo) then
      raise exception 'Canal invalido o inactivo (%).', coalesce(v_canal,'null') using errcode='22023';
    end if;
  end if;

  if p_payload ? 'habilitado' then
    v_hab := (p_payload->>'habilitado')::boolean;
  end if;

  update public.customers_b2b set
    b2b_canal          = case when p_payload ? 'canal' then v_canal else b2b_canal end,
    b2b_habilitado     = case when p_payload ? 'habilitado' then coalesce(v_hab, b2b_habilitado) else b2b_habilitado end,
    b2b_condicion_pago = case when p_payload ? 'condicion_pago'
                              then nullif(trim(p_payload->>'condicion_pago'),'') else b2b_condicion_pago end,
    b2b_notas_internas = case when p_payload ? 'notas_internas'
                              then nullif(trim(p_payload->>'notas_internas'),'') else b2b_notas_internas end,
    es_mayorista       = case when p_payload ? 'habilitado' and coalesce(v_hab,false) then true else es_mayorista end
  where id = v_id;

  -- Los pedidos ya enviados NO se tocan: su precio quedo congelado. El carrito
  -- abierto si, porque todavia no es un pedido — si no, el cliente veria mitad
  -- de las lineas a la lista vieja y mitad a la nueva.
  if p_payload ? 'canal' and v_canal is distinct from v_c.b2b_canal then
    select coeficiente into v_coef from public.b2b_canal where codigo = v_canal;
    update public.b2b_pedido set canal = v_canal, coeficiente = v_coef
     where cliente_id = v_id and estado = 'borrador';
    update public.b2b_pedido_item i
       set coeficiente_snap = v_coef,
           precio_unitario  = public.b2b_fn_precio(bp.sku, v_canal, bp.precio_base, v_coef),
           precio_base_snap = bp.precio_base
      from public.b2b_producto bp, public.b2b_pedido p
     where bp.sku = i.sku and p.id = i.pedido_id
       and p.cliente_id = v_id and p.estado = 'borrador'
       and bp.precio_base is not null;
  end if;

  select * into v_c from public.customers_b2b where id = v_id;
  return jsonb_build_object(
    'ok', true, 'cliente_id', v_id, 'canal', v_c.b2b_canal,
    'habilitado', v_c.b2b_habilitado, 'condicion_pago', v_c.b2b_condicion_pago);
end $function$;

-- ── (K) Catalogo del ADMIN: precio resuelto + de donde sale ────────────────
-- `precios_por_canal` pasa a ser lo que el cliente REALMENTE va a pagar (lista
-- si hay, formula si no). Se agrega `precios_lista` con solo los explicitos,
-- para que la grilla pueda distinguir "esto lo escribi yo" de "esto lo calculo
-- el coeficiente" y no le haga creer al dueno que cargo algo que no cargo.
create or replace function public.b2b_rpc_admin_catalogo(p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_rol role_enum;
begin
  perform public.b2b_fn_guard();
  v_rol := public.current_user_role();
  if v_rol is null or v_rol not in ('owner','admin') then
    raise exception 'Sin permiso.' using errcode='42501';
  end if;

  return coalesce((
    select jsonb_agg(x order by x->>'sku')
      from (
        select jsonb_build_object(
                 'sku', p.sku, 'modelo', s.modelo, 'color', s.color,
                 'categoria', s.categoria, 'publicado', p.publicado,
                 'precio_base', p.precio_base, 'moneda', p.moneda, 'iva_pct', p.iva_pct,
                 'descripcion', p.descripcion, 'foto_path', p.foto_path,
                 'unidad_venta', p.unidad_venta, 'bulto_cantidad', p.bulto_cantidad,
                 'multiplo_venta', p.multiplo_venta, 'minimo_sku', p.minimo_sku,
                 'orden', p.orden,
                 'precios_por_canal', (
                   select jsonb_object_agg(c.codigo,
                            public.b2b_fn_precio(p.sku, c.codigo, p.precio_base, c.coeficiente))
                     from public.b2b_canal c where c.activo = true),
                 'precios_lista', coalesce((
                   select jsonb_object_agg(pc.canal, pc.precio_neto)
                     from public.b2b_precio_canal pc
                     join public.b2b_canal c2 on c2.codigo = pc.canal and c2.activo = true
                    where pc.sku = p.sku), '{}'::jsonb)
               ) as x
          from public.b2b_producto p
          join public.sku_catalog s on s.sku = p.sku
         where (coalesce((p_payload->>'solo_publicados')::boolean, false) = false
                or p.publicado = true)
      ) t
  ), '[]'::jsonb);
end $function$;

-- ── (L) Cargar precios de lista ─────────────────────────────────────────────
-- Se extiende el mismo RPC que ya usa la grilla. Payload por item:
--   {"sku":"MAD095", "precio_base":42063,
--    "precios_canal": {"mayorista":29444, "distribuidor":25015}}
-- Un canal en null o "" BORRA la lista de ese canal y lo devuelve a la formula.
-- Los canales que no vienen en el objeto no se tocan.
create or replace function public.b2b_rpc_admin_set_producto(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_rol role_enum; v_item jsonb; v_items jsonb; v_n integer := 0; v_pb numeric;
  v_canal text; v_precio numeric;
begin
  perform public.b2b_fn_guard();
  v_rol := public.current_user_role();
  if v_rol is null or v_rol not in ('owner','admin') then
    raise exception 'Sin permiso.' using errcode='42501';
  end if;

  v_items := case when p_payload ? 'items' then p_payload->'items'
                  else jsonb_build_array(p_payload) end;

  for v_item in select * from jsonb_array_elements(v_items) loop
    if not exists (select 1 from public.sku_catalog where sku = v_item->>'sku') then
      raise exception 'SKU inexistente (%).', coalesce(v_item->>'sku','null') using errcode='P0002';
    end if;

    -- Un precio en 0 pasaba el CHECK (>= 0) y se podia publicar: el distribuidor
    -- lo compraba a 0 x 0,55 = 0. No hay lista de precios con ceros; si algun dia
    -- hace falta regalar algo, se hace por nota de credito, no por lista.
    if v_item ? 'precio_base' then
      v_pb := nullif(v_item->>'precio_base','')::numeric;
      if v_pb is not null and v_pb <= 0 then
        raise exception 'El precio de % tiene que ser mayor que cero.', v_item->>'sku'
          using errcode='22023';
      end if;
    end if;

    -- Publicar sin precio se rechaza aca, con mensaje, mirando el precio que ya
    -- tiene cargado el producto cuando el payload no trae uno nuevo.
    if coalesce((v_item->>'publicado')::boolean, false)
       and coalesce(
             case when v_item ? 'precio_base' then nullif(v_item->>'precio_base','')::numeric end,
             (select precio_base from public.b2b_producto where sku = v_item->>'sku')) is null then
      raise exception 'No se puede publicar % sin precio.', v_item->>'sku' using errcode='22023';
    end if;

    -- (1) Asegurar la fila. Va SIEMPRE con publicado = false: asi la fila que se
    --     propone al insert no puede violar b2b_producto_publicado_ck, exista o
    --     no el producto. Si ya existe, el insert no hace nada. (0159)
    insert into public.b2b_producto (
      sku, precio_base, moneda, iva_pct, descripcion, foto_path,
      unidad_venta, bulto_cantidad, multiplo_venta, minimo_sku, orden, publicado, updated_by
    ) values (
      v_item->>'sku',
      nullif(v_item->>'precio_base','')::numeric,
      coalesce(nullif(v_item->>'moneda',''), 'ARS'),
      coalesce(nullif(v_item->>'iva_pct','')::numeric, 21),
      nullif(trim(v_item->>'descripcion'),''),
      nullif(trim(v_item->>'foto_path'),''),
      coalesce(nullif(trim(v_item->>'unidad_venta'),''), 'unidad'),
      coalesce(nullif(v_item->>'bulto_cantidad','')::integer, 1),
      coalesce(nullif(v_item->>'multiplo_venta','')::integer, 1),
      coalesce(nullif(v_item->>'minimo_sku','')::integer, 0),
      coalesce(nullif(v_item->>'orden','')::integer, 0),
      false,
      auth.uid()
    )
    on conflict (sku) do nothing;

    -- (2) Aplicar el cambio sobre la fila ya existente. El CHECK se evalua una
    --     sola vez, sobre el producto completo.
    update public.b2b_producto bp set
      precio_base    = case when v_item ? 'precio_base'
                            then nullif(v_item->>'precio_base','')::numeric else bp.precio_base end,
      moneda         = coalesce(nullif(v_item->>'moneda',''), bp.moneda),
      iva_pct        = coalesce(nullif(v_item->>'iva_pct','')::numeric, bp.iva_pct),
      descripcion    = case when v_item ? 'descripcion'
                            then nullif(trim(v_item->>'descripcion'),'') else bp.descripcion end,
      foto_path      = case when v_item ? 'foto_path'
                            then nullif(trim(v_item->>'foto_path'),'') else bp.foto_path end,
      unidad_venta   = coalesce(nullif(trim(v_item->>'unidad_venta'),''), bp.unidad_venta),
      bulto_cantidad = coalesce(nullif(v_item->>'bulto_cantidad','')::integer, bp.bulto_cantidad),
      multiplo_venta = coalesce(nullif(v_item->>'multiplo_venta','')::integer, bp.multiplo_venta),
      minimo_sku     = coalesce(nullif(v_item->>'minimo_sku','')::integer, bp.minimo_sku),
      orden          = coalesce(nullif(v_item->>'orden','')::integer, bp.orden),
      publicado      = coalesce((v_item->>'publicado')::boolean, bp.publicado),
      updated_by     = auth.uid()
    where bp.sku = v_item->>'sku';

    -- (3) Precios de lista por canal (0160). Va DESPUES del upsert porque la FK
    --     apunta a b2b_producto: un SKU que recien se crea tiene que existir
    --     antes de que se le pueda colgar un precio.
    if v_item ? 'precios_canal' then
      if jsonb_typeof(v_item->'precios_canal') <> 'object' then
        raise exception 'precios_canal tiene que ser un objeto {canal: precio}.' using errcode='22023';
      end if;
      for v_canal, v_precio in
        select k, nullif(v, '')::numeric from jsonb_each_text(v_item->'precios_canal') as e(k, v)
      loop
        if not exists (select 1 from public.b2b_canal where codigo = v_canal) then
          raise exception 'Canal inexistente (%).', v_canal using errcode='22023';
        end if;
        if v_precio is null then
          delete from public.b2b_precio_canal
           where sku = v_item->>'sku' and canal = v_canal;
        else
          if v_precio <= 0 then
            raise exception 'El precio % de % tiene que ser mayor que cero.',
              v_canal, v_item->>'sku' using errcode='22023';
          end if;
          insert into public.b2b_precio_canal (sku, canal, precio_neto, updated_by)
          values (v_item->>'sku', v_canal, v_precio, auth.uid())
          on conflict (sku, canal) do update
            set precio_neto = excluded.precio_neto,
                updated_at  = now(),
                updated_by  = excluded.updated_by;
        end if;
      end loop;
    end if;

    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('ok', true, 'actualizados', v_n);
end $function$;

comment on function public.b2b_rpc_admin_set_producto(jsonb) is
  'Carga precios y datos de venta del catalogo B2B por lote. Acepta payload parcial: '
  '{sku, publicado:true} publica sin tener que volver a mandar el precio (0159). '
  'precios_canal:{canal:precio} carga el precio de lista de ese canal; null lo borra (0160).';
