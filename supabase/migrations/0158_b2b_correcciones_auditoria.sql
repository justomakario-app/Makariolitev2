-- ════════════════════════════════════════════════════════════════════════════
-- 0158 — Correcciones de la auditoria completa del modulo B2B (2026-08-15)
--
-- Salio de barrer las 7 migraciones B2B y los tres frontends buscando lo que se
-- rompe con un mayorista adentro. Nada de esto es un agujero de seguridad — el
-- aislamiento de precios aguanto todo — pero si son cosas que le pasan a un
-- cliente real el primer dia.
--
-- LAS DECISIONES QUE TOMA ESTE ARCHIVO, y por que:
--
-- 1. EL PRECIO SE CONGELA AL ENVIAR, NO AL AGREGAR AL CARRITO.
--    Antes el snapshot se escribia en b2b_rpc_carrito_set_item. Un carrito
--    abandonado tres meses seguia comprando a la lista vieja, y bastaba con
--    dejar cosas adentro para blindarse contra cualquier aumento. Peor: si el
--    dueno le cambiaba el canal al cliente en el medio, las lineas viejas
--    quedaban con el coeficiente anterior y las nuevas con el nuevo — UN pedido
--    con DOS listas de precios.
--    Ahora el carrito MUESTRA el precio vigente (calculado en la lectura) y
--    b2b_rpc_enviar_pedido reescribe los snapshots contra la lista de hoy antes
--    de tocar nada. Lo que el cliente ve es lo que se congela. El precio
--    congelado protege un pedido YA ENVIADO — que es lo que pedia el brief —,
--    no habilita a comprar para siempre a la lista del ano pasado.
--
-- 2. EL CARRITO NO SE PUEDE TOCAR MIENTRAS SE ENVIA.
--    enviar_pedido tomaba 'for update' sobre el borrador, pero carrito_set_item
--    entraba por b2b_fn_carrito_id, que solo lockea cuando CREA. Con dos
--    pestanas abiertas se podian agregar renglones despues del corte: quedaban
--    en el pedido del cliente y no llegaban nunca a la administracion. Ahora
--    enviar toma el MISMO advisory lock por cliente, y las tres escrituras del
--    carrito releen el borrador con 'for update' y abortan con 0A000 si ya se
--    envio.
--
-- 3. UN PEDIDO QUE YA SE DESPACHO NO SE PUEDE ANULAR, aunque el estado
--    "vuelva". La anulacion del cliente miraba el estado ACTUAL. Si el dueno
--    retrocedia el estado en la administracion (para corregir un click), el
--    boton "Dar de baja" revivia sobre mercaderia que ya salio. Se sella
--    avanzado_at la primera vez que el pedido pasa de 'enviado' y no se borra
--    nunca mas. No se le restringe al dueno mover estados: corregirse es
--    legitimo, lo que no puede es habilitarle al cliente cancelar lo despachado.
--
-- 4. UN SKU DADO DE BAJA EN sku_catalog DEJA DE SER COMPRABLE.
--    b2b_producto.publicado y sku_catalog.activo son dos interruptores. El
--    catalogo miraba los dos, pero las escrituras solo miraban 'publicado': un
--    producto discontinuado desaparecia de la vista y se seguia pudiendo comprar
--    desde el carrito viejo, repetir y enviar.
--
-- 5. EL MINIMO POR SKU SE REVALIDA AL ENVIAR. Solo se revalidaba el multiplo.
--
-- 6. APROBAR UN USUARIO YA NO REVIVE UN CLIENTE CORTADO A PROPOSITO.
--    b2b_habilitado = false es el corte por deuda. Aprobar a un segundo
--    comprador lo prendia de nuevo sin avisar. Ahora solo se habilita en la
--    PRIMERA aprobacion del cliente, o si el dueno lo pide explicito con
--    rehabilitar_cliente:true.
--
-- 7. 'facturado' DEJA DE SER UN ESTADO INALCANZABLE. El brief lo pedia y el
--    CHECK lo aceptaba, pero ningun estado de la administracion mapeaba a el
--    (pedido_mayorista_estado no lo tiene y no se toca: es un enum del modulo
--    comercial legacy). Se resuelve con una RPC propia que el dueno dispara a
--    mano cuando emite la factura por fuera del sistema.
--
-- 8. LA MARCA b2b SE LEE DEL NAMESPACE CONFIABLE. handle_new_user aceptaba
--    b2b='true' desde raw_user_meta_data, que lo escribe quien se registra —
--    justo el namespace que la cabecera de 0155 declara no confiable. Se podia
--    silenciar el tripwire de alta publica mandandolo en el signup. Ahora solo
--    cuenta raw_app_meta_data (service_role). ⚠ Requiere b2b_signup >= v3, que
--    manda la marca ahi. Se despliega la funcion ANTES que esta migracion.
--
-- Tambien: revocar invitaciones (no habia forma), borrar un precio de verdad,
-- mi_cuenta que contempla cliente/canal dados de baja, redondeo en cascada para
-- que la tarjeta del catalogo y el carrito digan el mismo numero, el IVA del
-- pedido guardado, y repetir-pedido que no vacia el carrito si no va a poder
-- cargar nada.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- (A) Columnas nuevas
-- ─────────────────────────────────────────────────────────────────────────

alter table public.b2b_pedido
  add column if not exists avanzado_at   timestamptz,
  add column if not exists total_neto    numeric(14,2),
  add column if not exists total_iva     numeric(14,2),
  add column if not exists total_con_iva numeric(14,2),
  add column if not exists facturado_at  timestamptz,
  add column if not exists factura_nro   text;

comment on column public.b2b_pedido.avanzado_at is
  'Primera vez que el pedido paso de "enviado" hacia adelante. Se sella una sola vez y no se limpia: es lo que impide que el cliente anule un pedido ya despachado si el estado de la administracion retrocede.';
comment on column public.b2b_pedido.total_con_iva is
  'Total que el cliente vio y acepto al enviar. Se guarda porque pedidos_mayoristas_items no tiene iva_pct y el numero se perderia.';

alter table public.b2b_invitacion
  add column if not exists revocada_at  timestamptz,
  add column if not exists revocada_por uuid references public.profiles(id);

-- ─────────────────────────────────────────────────────────────────────────
-- (B) Espejo de estados: sella avanzado_at y limpia la marca de anulacion
--     al reabrir (antes la fila decia 'confirmado' y 'anulado' a la vez)
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.b2b_fn_sync_estado()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_nuevo text;
begin
  v_nuevo := public.b2b_fn_map_estado(new.estado);
  if v_nuevo is null then return new; end if;
  update public.b2b_pedido
     set estado = v_nuevo,
         anulado_at = case when v_nuevo = 'anulado' then coalesce(anulado_at, now()) else null end,
         anulado_motivo = case when v_nuevo = 'anulado' then anulado_motivo else null end,
         avanzado_at = case
           when v_nuevo in ('confirmado','en_produccion','listo_despacho','despachado')
           then coalesce(avanzado_at, now()) else avanzado_at end
   where pedido_mayorista_id = new.id
     and estado is distinct from v_nuevo
     and estado <> 'borrador'
     -- Un pedido facturado a mano no vuelve atras por un cambio de estado en la
     -- administracion; anularlo si, porque anular es la correccion de verdad.
     and (estado <> 'facturado' or v_nuevo = 'anulado');
  return new;
end $fn$;

-- ─────────────────────────────────────────────────────────────────────────
-- (C) El carrito muestra el PRECIO VIGENTE, y dice que linea dejo de estar
--     disponible en vez de esperar al click de Enviar para contarlo
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.b2b_rpc_carrito(p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_cli uuid; v_id uuid; v_coef numeric;
begin
  perform public.b2b_fn_guard();
  v_cli  := public.b2b_fn_cliente_actual();
  v_coef := public.b2b_fn_coeficiente_actual();
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
             coalesce(round(bp.precio_base * v_coef, 2), i.precio_unitario) as precio_unitario,
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
end $fn$;
revoke execute on function public.b2b_rpc_carrito(jsonb) from public, anon;
grant  execute on function public.b2b_rpc_carrito(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- (D) Alta/baja de linea: no se puede tocar un pedido que ya se envio, y el
--     SKU dado de baja en el catalogo maestro deja de entrar
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.b2b_rpc_carrito_set_item(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare
  v_cli uuid; v_id uuid; v_coef numeric; v_sku text; v_cant integer;
  v_pb numeric; v_pub boolean; v_mult integer; v_min integer; v_iva numeric; v_activo boolean;
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
    v_id, v_sku, v_cant, v_pb, v_coef, round(v_pb * v_coef, 2), v_iva,
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
end $fn$;
revoke execute on function public.b2b_rpc_carrito_set_item(jsonb) from public, anon;
grant  execute on function public.b2b_rpc_carrito_set_item(jsonb) to authenticated;

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
  perform 1 from public.b2b_pedido where id = v_id and estado = 'borrador' for update;
  if not found then
    raise exception 'Este pedido ya se envio. Abri uno nuevo.' using errcode='0A000';
  end if;

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
-- (E) ★ EL PUENTE ★ — ahora congela el precio ACA, con el mismo candado que
--     usa el carrito, y guarda el total con IVA que el cliente acepto
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.b2b_rpc_enviar_pedido(p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare
  v_cli uuid; v_coef numeric; v_ped public.b2b_pedido%rowtype;
  v_min_monto numeric; v_min_unid integer;
  v_total numeric; v_iva numeric; v_unid integer; v_lineas integer;
  v_numero_may text; v_numero_b2b text; v_pm_id uuid;
  v_cliente_nombre text; v_comprador text; v_mal text;
begin
  perform public.b2b_fn_guard();
  v_cli  := public.b2b_fn_cliente_actual();
  v_coef := public.b2b_fn_coeficiente_actual();
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

  -- ── 1. Todo lo del pedido sigue existiendo, publicado y con precio ────
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

  -- ── 2. ★ SE CONGELA EL PRECIO ACA ★ ──────────────────────────────────
  -- Contra la lista de HOY y el coeficiente de HOY. Es el mismo numero que la
  -- pantalla viene mostrando (b2b_rpc_carrito calcula igual), asi que el cliente
  -- no se entera de ningun cambio: lo que ve es lo que se guarda.
  update public.b2b_pedido_item i
     set precio_base_snap = bp.precio_base,
         coeficiente_snap = v_coef,
         precio_unitario  = round(bp.precio_base * v_coef, 2),
         iva_pct          = bp.iva_pct
    from public.b2b_producto bp
   where bp.sku = i.sku and i.pedido_id = v_ped.id;

  -- ── 3. Multiplos y minimos por SKU, con los valores vigentes ─────────
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

  -- ── 4. Minimos del canal ─────────────────────────────────────────────
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

  -- ── 5. Se materializa en el admin, con el MISMO contador MAY-xxxx ─────
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

  -- ── 6. Se sella el pedido del cliente ────────────────────────────────
  v_numero_b2b := public.b2b_fn_next_numero();
  update public.b2b_pedido
     set estado = 'enviado', numero = v_numero_b2b, enviado_at = now(),
         enviado_por = auth.uid(),
         pedido_mayorista_id = v_pm_id, numero_mayorista = v_numero_may,
         coeficiente = v_coef,
         total_neto = v_total, total_iva = v_iva, total_con_iva = v_total + v_iva
   where id = v_ped.id;

  -- ── 7. El aviso ──────────────────────────────────────────────────────
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
end $fn$;
revoke execute on function public.b2b_rpc_enviar_pedido(jsonb) from public, anon;
grant  execute on function public.b2b_rpc_enviar_pedido(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- (F) Anular: nunca sobre algo que ya salio de la fabrica
-- ─────────────────────────────────────────────────────────────────────────

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
  -- El estado puede haber vuelto a 'enviado' porque el dueno retrocedio el de la
  -- administracion. avanzado_at no vuelve: si el pedido llego a moverse alguna
  -- vez, el cliente ya no lo cancela solo.
  if v_p.avanzado_at is not null then
    raise exception 'Este pedido ya se puso en marcha. Escribinos para darlo de baja.'
      using errcode='0A000';
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
-- (G) Historial del cliente: suma el total con IVA y la marca de facturado
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
             'anulado_motivo', p.anulado_motivo,
             'factura_nro', p.factura_nro,
             'total_neto', coalesce(p.total_neto,
                             (select coalesce(sum(i.subtotal),0) from public.b2b_pedido_item i
                               where i.pedido_id = p.id)),
             'total_con_iva', p.total_con_iva,
             'unidades', (select coalesce(sum(i.cantidad),0) from public.b2b_pedido_item i
                           where i.pedido_id = p.id),
             'items', (select coalesce(jsonb_agg(jsonb_build_object(
                          'sku', i.sku, 'modelo', s.modelo, 'color', s.color,
                          'cantidad', i.cantidad,
                          'precio_unitario', i.precio_unitario, 'subtotal', i.subtotal)
                        order by i.sku), '[]'::jsonb)
                       from public.b2b_pedido_item i
                       join public.sku_catalog s on s.sku = i.sku
                      where i.pedido_id = p.id))
           order by p.created_at desc)
      from public.b2b_pedido p
     where p.cliente_id = v_cli and p.estado <> 'borrador'
  ), '[]'::jsonb);
end $fn$;
revoke execute on function public.b2b_rpc_mis_pedidos(jsonb) from public, anon;
grant  execute on function public.b2b_rpc_mis_pedidos(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- (H) Repetir pedido: no vacia el carrito si no va a poder cargar nada,
--     y respeta el SKU dado de baja
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.b2b_rpc_repetir_pedido(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare
  v_cli uuid; v_coef numeric; v_carrito uuid; v_modo text;
  v_origen public.b2b_pedido%rowtype;
  v_it record; v_cant integer; v_previa integer; v_repetibles integer;
  v_agregados integer := 0;
  v_omitidos  jsonb := '[]'::jsonb;
  v_ajustados jsonb := '[]'::jsonb;
begin
  perform public.b2b_fn_guard();
  v_cli  := public.b2b_fn_cliente_actual();
  v_coef := public.b2b_fn_coeficiente_actual();
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
      round(v_it.precio_base * v_coef, 2), v_it.iva_pct
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
end $fn$;
revoke execute on function public.b2b_rpc_repetir_pedido(jsonb) from public, anon;
grant  execute on function public.b2b_rpc_repetir_pedido(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- (I) Facturado: el ultimo estado del brief, que hasta ahora no lo emitia
--     nadie. No se toca el enum de la administracion (es del modulo comercial
--     legacy): lo marca el dueno desde el panel B2B cuando emite la factura.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.b2b_rpc_admin_facturar_pedido(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_rol role_enum; v_p public.b2b_pedido%rowtype;
begin
  perform public.b2b_fn_guard();
  v_rol := public.current_user_role();
  if v_rol is null or v_rol not in ('owner','admin') then
    raise exception 'Sin permiso.' using errcode='42501';
  end if;

  select * into v_p from public.b2b_pedido
   where id = nullif(p_payload->>'pedido_id','')::uuid for update;
  if not found then
    raise exception 'Pedido no encontrado.' using errcode='P0002';
  end if;
  if v_p.estado not in ('despachado','facturado') then
    raise exception 'Solo se factura un pedido ya despachado (este esta en %).', v_p.estado
      using errcode='0A000';
  end if;

  update public.b2b_pedido
     set estado = 'facturado',
         facturado_at = coalesce(facturado_at, now()),
         factura_nro  = coalesce(nullif(trim(p_payload->>'factura_nro'),''), factura_nro)
   where id = v_p.id;

  return jsonb_build_object('ok', true, 'pedido_id', v_p.id, 'estado', 'facturado');
end $fn$;
revoke execute on function public.b2b_rpc_admin_facturar_pedido(jsonb) from public, anon;
grant  execute on function public.b2b_rpc_admin_facturar_pedido(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- (J) Revocar una invitacion. No habia forma: si el admin cerraba el modal sin
--     copiar el codigo, ese token quedaba vivo hasta vencer, invisible.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.b2b_rpc_revocar_invitacion(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_rol role_enum; v_id uuid; v_est text;
begin
  perform public.b2b_fn_guard();
  v_rol := public.current_user_role();
  if v_rol is null or v_rol not in ('owner','admin') then
    raise exception 'Sin permiso.' using errcode='42501';
  end if;

  v_id := nullif(p_payload->>'invitacion_id','')::uuid;
  if v_id is null then
    raise exception 'Falta invitacion_id.' using errcode='22023';
  end if;

  select estado into v_est from public.b2b_invitacion where id = v_id for update;
  if not found then
    raise exception 'Invitacion no encontrada.' using errcode='P0002';
  end if;
  if v_est = 'usada' then
    raise exception 'Esa invitacion ya se uso: no se puede anular. Suspende al usuario desde Accesos.'
      using errcode='0A000';
  end if;
  if v_est = 'revocada' then
    return jsonb_build_object('ok', true, 'invitacion_id', v_id, 'estado', 'revocada');
  end if;

  update public.b2b_invitacion
     set estado = 'revocada', revocada_at = now(), revocada_por = auth.uid()
   where id = v_id;

  return jsonb_build_object('ok', true, 'invitacion_id', v_id, 'estado', 'revocada');
end $fn$;
revoke execute on function public.b2b_rpc_revocar_invitacion(jsonb) from public, anon;
grant  execute on function public.b2b_rpc_revocar_invitacion(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- (K) Ver invitacion con la tienda apagada: decirlo, en vez de hacerle creer
--     al mayorista que su codigo esta mal
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.b2b_rpc_ver_invitacion(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_inv public.b2b_invitacion%rowtype; v_nombre text;
begin
  if not public.b2b_fn_habilitado() then
    return jsonb_build_object('ok', false, 'motivo', 'b2b_deshabilitado');
  end if;
  select * into v_inv from public.b2b_invitacion
   where token_hash = encode(extensions.digest(coalesce(p_payload->>'token',''), 'sha256'), 'hex');
  if not found or v_inv.estado <> 'pendiente' or v_inv.expira_at < now() then
    return jsonb_build_object('ok', false, 'motivo', 'invitacion_invalida');
  end if;
  select nombre into v_nombre from public.customers_b2b where id = v_inv.cliente_id;
  return jsonb_build_object('ok', true, 'email', v_inv.email,
                            'cliente', coalesce(v_nombre, v_inv.cliente_nombre));
end $fn$;
revoke execute on function public.b2b_rpc_ver_invitacion(jsonb) from public;
grant  execute on function public.b2b_rpc_ver_invitacion(jsonb) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- (L) Aprobar un usuario no revive un cliente cortado a proposito
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.b2b_rpc_resolver_usuario(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare
  v_rol role_enum; v_estado text; v_uid uuid; v_u public.b2b_usuario%rowtype;
  v_primera boolean;
begin
  perform public.b2b_fn_guard();
  v_rol := public.current_user_role();
  if v_rol is null or v_rol not in ('owner','admin') then
    raise exception 'Sin permiso.' using errcode='42501';
  end if;

  v_uid    := nullif(p_payload->>'usuario_id','')::uuid;
  v_estado := nullif(trim(p_payload->>'estado'),'');
  if v_estado is null or v_estado not in ('aprobado','rechazado','suspendido','pendiente') then
    raise exception 'Estado invalido (%).', coalesce(v_estado,'null') using errcode='22023';
  end if;

  select * into v_u from public.b2b_usuario where id = v_uid for update;
  if not found then
    raise exception 'Usuario B2B no encontrado.' using errcode='P0002';
  end if;

  -- Se mira ANTES del update: despues, este mismo usuario ya figura aprobado.
  v_primera := not exists (
    select 1 from public.b2b_usuario u2
     where u2.cliente_id = v_u.cliente_id and u2.estado = 'aprobado' and u2.id <> v_uid);

  update public.b2b_usuario
     set estado         = v_estado,
         aprobado_por   = case when v_estado = 'aprobado' then auth.uid() else aprobado_por end,
         aprobado_at    = case when v_estado = 'aprobado' then now() else aprobado_at end,
         rechazo_motivo = case when v_estado in ('rechazado','suspendido')
                               then nullif(trim(p_payload->>'motivo'),'') else null end
   where id = v_uid;

  -- Aprobar habilita al cliente SOLO la primera vez (o si el dueno lo pide
  -- explicito). b2b_habilitado = false es el corte por deuda: aprobar a un
  -- segundo comprador no puede reabrirle la cuenta corriente sin que nadie
  -- lo decida.
  if v_estado = 'aprobado' then
    update public.customers_b2b
       set es_mayorista = true,
           b2b_habilitado = case
             when coalesce((p_payload->>'rehabilitar_cliente')::boolean, false) then true
             when v_primera then true
             else b2b_habilitado end
     where id = v_u.cliente_id;
  end if;

  return jsonb_build_object('ok', true, 'usuario_id', v_uid, 'estado', v_estado,
                            'cliente_habilitado',
                            (select b2b_habilitado from public.customers_b2b where id = v_u.cliente_id));
end $fn$;
revoke execute on function public.b2b_rpc_resolver_usuario(jsonb) from public, anon;
grant  execute on function public.b2b_rpc_resolver_usuario(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- (M) mi_cuenta mira lo mismo que las RPC de compra: cliente dado de baja y
--     canal apagado tambien cierran la tienda, con su motivo propio
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.b2b_rpc_mi_cuenta(p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_r jsonb;
begin
  if not public.b2b_fn_habilitado() then
    return jsonb_build_object('ok', false, 'motivo', 'b2b_deshabilitado');
  end if;
  select jsonb_build_object(
           'ok', true, 'usuario_id', u.id, 'nombre', u.nombre, 'email', u.email,
           'estado', u.estado, 'es_titular', u.es_titular,
           'rechazo_motivo', u.rechazo_motivo,
           'cliente', case when u.estado = 'aprobado' then jsonb_build_object(
             'id', c.id, 'nombre', c.nombre, 'cuit', c.cuit,
             -- 'habilitado' es la unica pregunta que hace la tienda para dejar
             -- comprar. Tiene que dar exactamente lo mismo que resuelve
             -- b2b_fn_coeficiente_actual(), o la pantalla ofrece un catalogo
             -- que despues explota con 42501 en la primera RPC.
             'habilitado', (c.b2b_habilitado and c.activo and coalesce(ca.activo, false)),
             'condicion_pago', c.b2b_condicion_pago,
             'canal', c.b2b_canal,
             'minimo_pedido', ca.minimo_pedido, 'minimo_unidades', ca.minimo_unidades)
           else null end)
    into v_r
    from public.b2b_usuario u
    join public.customers_b2b c on c.id = u.cliente_id
    left join public.b2b_canal ca on ca.codigo = c.b2b_canal
   where u.id = auth.uid();

  if v_r is null then
    return jsonb_build_object('ok', false, 'motivo', 'sin_cuenta_b2b');
  end if;

  update public.b2b_usuario set ultimo_acceso_at = now()
   where id = auth.uid() and estado = 'aprobado';
  return v_r;
end $fn$;
revoke execute on function public.b2b_rpc_mi_cuenta(jsonb) from public, anon;
grant  execute on function public.b2b_rpc_mi_cuenta(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- (N) Catalogo: el IVA se calcula sobre el precio YA redondeado, para que la
--     tarjeta y el carrito digan el mismo numero hasta el ultimo centavo
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.b2b_rpc_catalogo(p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_temp' as $fn$
declare
  v_coef numeric; v_q text; v_cat text;
begin
  perform public.b2b_fn_guard();
  v_coef := public.b2b_fn_coeficiente_actual();
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
                 'precio', round(p.precio_base * v_coef, 2),
                 'precio_con_iva', round(round(p.precio_base * v_coef, 2) * (1 + p.iva_pct / 100), 2),
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
end $fn$;
revoke execute on function public.b2b_rpc_catalogo(jsonb) from public, anon;
grant  execute on function public.b2b_rpc_catalogo(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- (O) Cargar productos: borrar un precio lo borra de verdad, y un precio en 0
--     se rechaza (una celda corrida de Excel vendia el mueble a cero)
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.b2b_rpc_admin_set_producto(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare
  v_rol role_enum; v_item jsonb; v_items jsonb; v_n integer := 0; v_pb numeric;
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

    if coalesce((v_item->>'publicado')::boolean, false)
       and coalesce(
             case when v_item ? 'precio_base' then nullif(v_item->>'precio_base','')::numeric end,
             (select precio_base from public.b2b_producto where sku = v_item->>'sku')) is null then
      raise exception 'No se puede publicar % sin precio.', v_item->>'sku' using errcode='22023';
    end if;

    insert into public.b2b_producto as bp (
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
      coalesce((v_item->>'publicado')::boolean, false),
      auth.uid()
    )
    on conflict (sku) do update set
      -- El operador '?' distingue "no mandaron la clave" de "la mandaron vacia".
      -- Con coalesce, vaciar el precio en la grilla no lo borraba nunca: el toast
      -- decia guardado y el numero viejo seguia ahi.
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
      updated_by     = auth.uid();
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('ok', true, 'actualizados', v_n);
end $fn$;
revoke execute on function public.b2b_rpc_admin_set_producto(jsonb) from public, anon;
grant  execute on function public.b2b_rpc_admin_set_producto(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- (P) Cambiar de canal reprecia el carrito abierto en el acto
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.b2b_rpc_admin_set_cliente(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
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
           precio_unitario  = round(bp.precio_base * v_coef, 2),
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
end $fn$;
revoke execute on function public.b2b_rpc_admin_set_cliente(jsonb) from public, anon;
grant  execute on function public.b2b_rpc_admin_set_cliente(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- (Q) La marca b2b se lee SOLO del namespace que escribe el service_role
--     ⚠ Requiere b2b_signup v3+ desplegada (manda app_metadata.b2b).
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
DECLARE
  v_username   text;
  v_name       text;
  v_role       role_enum;
  v_area       text;
  v_created_by uuid;
  v_hubo       boolean;
BEGIN
  -- ── B2B (0151/0158): el cliente externo NO es empleado. Sin profile,
  -- is_active_user() es false y quedan cerradas las tablas cuya policy la llama.
  -- Se mira SOLO raw_app_meta_data: raw_user_meta_data lo escribe quien se
  -- registra, asi que leerlo aca dejaba apagar el tripwire de abajo mandando
  -- {"data":{"b2b":"true"}} en el signup publico.
  IF NEW.raw_app_meta_data->>'b2b' = 'true' THEN
    RETURN NEW;
  END IF;

  -- ── (0155) Sin marca interna no hay empleado.
  IF COALESCE(NEW.raw_app_meta_data->>'interno', '') <> 'true' THEN
    INSERT INTO public.auth_alta_bloqueada (user_id, email, motivo, metadata)
    VALUES (NEW.id, NEW.email,
            case when NEW.raw_user_meta_data->>'b2b' = 'true'
                 then 'alta que se declara b2b sin venir del service_role: no se creo profile'
                 else 'alta sin app_metadata.interno: no se creo profile' end,
            NEW.raw_user_meta_data);

    SELECT EXISTS (
      SELECT 1 FROM public.auth_alta_bloqueada
       WHERE created_at > now() - interval '1 hour' AND user_id <> NEW.id
    ) INTO v_hubo;

    IF NOT v_hubo THEN
      INSERT INTO public.notifications (user_id, tipo, titulo, mensaje, link)
      SELECT pr.id, 'sistema',
             'Alguien intento registrarse solo',
             'Se creo una credencial sin invitacion (' || COALESCE(NEW.email, 's/d') ||
             ') y quedo SIN acceso, que es lo esperado. Si no lo hizo nadie del equipo, ' ||
             'conviene revisar que "Allow new users to sign up" siga apagado en Supabase.',
             NULL
        FROM public.profiles pr
       WHERE pr.active = true AND pr.role IN ('owner','admin');
    END IF;

    RETURN NEW;
  END IF;

  v_username := COALESCE(
    NEW.raw_user_meta_data->>'username',
    regexp_replace(lower(split_part(NEW.email, '@', 1)), '[^a-z0-9_]', '_', 'g')
  );
  v_name := COALESCE(NEW.raw_user_meta_data->>'name', v_username);
  v_role := COALESCE((NEW.raw_user_meta_data->>'role')::role_enum, 'embalaje'::role_enum);
  v_area := NEW.raw_user_meta_data->>'area';
  v_created_by := NULLIF(NEW.raw_user_meta_data->>'created_by', '')::uuid;

  INSERT INTO public.profiles (id, username, name, email, role, area, created_by)
  VALUES (NEW.id, v_username, v_name, NEW.email, v_role, v_area, v_created_by);

  RETURN NEW;
EXCEPTION
  WHEN unique_violation THEN
    v_username := v_username || '_' || (floor(random() * 10000))::text;
    INSERT INTO public.profiles (id, username, name, email, role, area, created_by)
    VALUES (NEW.id, v_username, v_name, NEW.email, v_role, v_area, v_created_by);
    RETURN NEW;
END;
$fn$;
