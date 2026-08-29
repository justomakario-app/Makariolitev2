/* ══════════════════════════════════════════════════════════════════════════
   0170 · CON IVA / SIN IVA — LO ELIGE EL COMPRADOR AL CONFIRMAR
   ══════════════════════════════════════════════════════════════════════════

   El problema real: muchos mayoristas compran sin IVA y transfieren; otros lo
   quieren computar y hay que facturarles. Hasta ahora el sistema mostraba los
   dos numeros siempre (neto e IVA aparte) y la decision se arreglaba por
   WhatsApp, fuera del sistema. Resultado: el pedido llegaba al equipo sin
   decir que hacer, y el que lo abria tenia que acordarse o preguntar.

   Desde 0170 la decision la toma el cliente en la pantalla, viaja pegada al
   pedido y llega escrita a la nota del pedido mayorista, al mail interno y al
   panel. El equipo abre el pedido y ya sabe si va a contabilidad o no.

   ── Como quedan los numeros ──────────────────────────────────────────────
   total_neto / total_iva / total_con_iva NO cambian de significado: siguen
   siendo la aritmetica del pedido y se guardan siempre los tres. Lo que
   agrega esta migracion es una bandera que dice CUAL de esos numeros se
   cobra, y una columna generada (total_a_pagar) que lo resuelve de una vez
   para que nadie lo calcule distinto en cada pantalla.

     con_iva = true   -> se cobra total_con_iva y se emite factura al CUIT
     con_iva = false  -> se cobra total_neto,  es presupuesto, no hay factura

   ── El minimo de compra no se toca ───────────────────────────────────────
   Se sigue midiendo sobre el neto, que es la misma base que valida
   b2b_rpc_enviar_pedido desde siempre. Si el minimo dependiera del tilde,
   destildar IVA bajaria el pedido abajo del minimo y el cliente no entenderia
   por que de golpe no puede enviar.

   ── Que NO hace ──────────────────────────────────────────────────────────
   No bloquea nada. Un pedido sin IVA se puede facturar igual si el cliente
   cambia de idea: el panel avisa y ofrece pasarlo a con IVA
   (b2b_rpc_admin_set_pedido_iva), pero no le traba la mano a nadie. La
   realidad de un mayorista cambia de idea mas seguido que un formulario.

   ── Cuenta bancaria ──────────────────────────────────────────────────────
   Es la misma con IVA y sin IVA (decision del dueno). Si algun dia hay una
   segunda cuenta, el lugar es company_settings + cajaTransferencia() del PDF,
   no aca.
   ══════════════════════════════════════════════════════════════════════════ */


/* ── 1. La bandera ──────────────────────────────────────────────────────
   Default true a proposito: los pedidos que ya existen se facturan, que es
   como venia funcionando el sistema hasta hoy. Un default false habria
   reescrito la historia de todos los pedidos viejos. */
alter table public.b2b_pedido
  add column if not exists con_iva boolean not null default true;

comment on column public.b2b_pedido.con_iva is
  'true: se cobra total_con_iva y se emite factura al CUIT del cliente. false: se cobra total_neto, queda como presupuesto y no se factura. Lo elige el comprador al confirmar el pedido. No cambia la aritmetica: los tres totales se guardan siempre igual.';


/* ── 2. Lo que hay que cobrar, calculado una sola vez ───────────────────
   Columna generada y no una cuenta en cada pantalla: la tienda, el panel, el
   PDF y los mails tienen que decir el mismo numero. Con un case repetido en
   cinco lugares, tarde o temprano uno queda viejo — y el que queda viejo es
   el que le muestra al cliente un total que no es el que se le cobra.

   Queda nula mientras el pedido es borrador (todavia no hay totales sellados),
   igual que total_neto y total_con_iva. */
alter table public.b2b_pedido
  add column if not exists total_a_pagar numeric(14,2)
    generated always as (case when con_iva then total_con_iva else total_neto end) stored;

comment on column public.b2b_pedido.total_a_pagar is
  'Generada: el unico numero que el cliente tiene que transferir. con_iva ? total_con_iva : total_neto.';


/* ── 3. El carrito nuevo hereda la eleccion anterior ────────────────────
   Un mayorista que compra siempre sin IVA no tiene por que destildar la
   casilla en cada pedido. Se copia del ultimo pedido que mando; si es su
   primer pedido, con IVA. */
create or replace function public.b2b_fn_carrito_id(p_cliente uuid)
returns uuid language plpgsql security definer
set search_path to 'public','pg_temp' as $fn$
declare v_id uuid; v_canal text; v_coef numeric;
begin
  v_canal := public.b2b_fn_canal_actual();
  if v_canal is null then
    raise exception 'Tu cuenta todavia no esta habilitada para comprar.' using errcode='42501';
  end if;

  -- Serializa por cliente Y CANAL: dos pestanas del mismo comprador en el mismo
  -- catalogo pasaban las dos el select de abajo y la segunda chocaba contra
  -- b2b_pedido_borrador_uq con un 23505 crudo. La clave lleva el canal porque
  -- desde ahora el indice unico tambien lo lleva — y b2b_rpc_enviar_pedido
  -- toma este MISMO cerrojo.
  perform pg_advisory_xact_lock(hashtextextended(p_cliente::text || '|' || v_canal, 0));

  select id into v_id from public.b2b_pedido
   where cliente_id = p_cliente and canal = v_canal and estado = 'borrador';
  if v_id is not null then return v_id; end if;

  select coeficiente into v_coef from public.b2b_canal where codigo = v_canal;

  insert into public.b2b_pedido (cliente_id, creado_por, canal, coeficiente,
                                 condicion_pago, con_iva)
  select p_cliente, auth.uid(), v_canal, v_coef, c.b2b_condicion_pago,
         -- 0170: como compro la ultima vez. Se mira cualquier canal a
         -- proposito: la decision de IVA es del cliente, no del catalogo.
         coalesce((select p.con_iva from public.b2b_pedido p
                    where p.cliente_id = p_cliente and p.estado <> 'borrador'
                    order by p.created_at desc limit 1), true)
    from public.customers_b2b c where c.id = p_cliente
  returning id into v_id;
  return v_id;
end $fn$;


/* ── 4. Guardar el tilde ────────────────────────────────────────────────
   Mismo criterio que el resto de este RPC: lo que no viene en el payload no
   se pisa. Con un booleano hay que ser explicito — 'false' es un valor, no un
   campo vacio — asi que se pregunta por la clave, no por el valor. */
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
    notas                 = coalesce(nullif(trim(p_payload->>'notas'),''), notas),
    con_iva               = coalesce(
                              case when p_payload ? 'con_iva'
                                   then (p_payload->>'con_iva')::boolean end,
                              con_iva)
  where id = v_id and estado = 'borrador';

  return jsonb_build_object('ok', true, 'pedido_id', v_id);
end $fn$;


/* ── 5. El carrito devuelve la bandera ──────────────────────────────────
   Copiado de 0162 tal cual, con una clave mas. */
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
      -- 0170: el borrador se acuerda de si el comprador lo quiere con IVA o
      -- sin IVA, asi que al volver de otra pantalla el tilde sigue como estaba.
      'con_iva', p.con_iva,
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


/* ── 6. Enviar: sella la decision y se la cuenta al equipo ──────────────
   Copiado de 0162 tal cual, con los agregados marcados 0170. */
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
  v_con_iva boolean; v_cuit text; v_pagar numeric; v_fact text;   -- 0170
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

  /* 0170 — Con IVA o sin IVA. Manda lo que vino en el payload: es el tilde
     que el comprador acaba de tocar en la pantalla de confirmar, y puede ser
     mas nuevo que lo guardado si toco y mando en el mismo movimiento. Si no
     vino nada, vale lo del borrador. Nunca queda nulo: sin decision explicita
     se factura, que es el default legal y el que no sorprende a nadie. */
  v_con_iva := coalesce(
    case when p_payload ? 'con_iva' then (p_payload->>'con_iva')::boolean end,
    v_ped.con_iva, true);

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

  /* 0170 — La linea que le dice al equipo que hacer con este pedido. Va
     arriba de todo en la nota del pedido mayorista porque es lo primero que
     se lee al abrirlo, y de ahi sale derecho a contabilidad o no sale.
     El CUIT se resuelve aca y no en la pantalla: el papel y el mail tienen
     que decir el mismo numero que figura en la ficha del cliente. */
  select nullif(trim(c.cuit), '') into v_cuit
    from public.customers_b2b c where c.id = v_cli;
  v_pagar := case when v_con_iva then v_total + v_iva else v_total end;
  if v_con_iva then
    v_fact := 'FACTURACION: CON IVA -- se emite factura'
              || coalesce(' al CUIT ' || v_cuit, ' (OJO: este cliente no tiene CUIT cargado)')
              || '.' || e'\nTotal que acepto el cliente: $' || to_char(v_total, 'FM999G999G999D00')
              || ' neto + $' || to_char(v_iva, 'FM999G999G999D00')
              || ' de IVA = $' || to_char(v_total + v_iva, 'FM999G999G999D00') || '.';
  else
    v_fact := 'FACTURACION: SIN IVA -- el cliente eligio presupuesto, NO se emite factura.'
              || e'\nTotal que acepto el cliente: $' || to_char(v_total, 'FM999G999G999D00')
              || ' (neto, sin IVA). El IVA que no se cobra habria sido $'
              || to_char(v_iva, 'FM999G999G999D00') || '.';
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
        e'\n' || v_fact ||
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
         total_neto = v_total, total_iva = v_iva, total_con_iva = v_total + v_iva,
         con_iva = v_con_iva
   where id = v_ped.id;

  -- 7. El aviso — dice con qué lista compró, que ahora la elige el cliente
  select c.nombre into v_cliente_nombre from public.customers_b2b c where c.id = v_cli;
  select u.nombre into v_comprador from public.b2b_usuario u where u.id = auth.uid();

  perform public.b2b_fn_avisar_interno(
    'nuevo_pedido',
    'Pedido B2B nuevo: ' || v_cliente_nombre || ' (' || coalesce(v_canal_nombre, v_canal) || ')'
      || case when v_con_iva then '' else ' - SIN IVA' end,
    v_comprador || ' cargo el pedido ' || v_numero_may || ' con la lista ' ||
    coalesce(v_canal_nombre, v_canal) || ' (' || v_lineas || ' productos, ' ||
    v_unid || ' unidades, $' || to_char(v_total, 'FM999G999G999D00') || ' neto). ' ||
    case when v_con_iva
         then 'Va CON IVA: cobra $' || to_char(v_total + v_iva, 'FM999G999G999D00') ||
              ' y se factura' || coalesce(' al CUIT ' || v_cuit, ' (no tiene CUIT cargado)') || '.'
         else 'Va SIN IVA: cobra $' || to_char(v_total, 'FM999G999G999D00') ||
              ', queda como presupuesto y NO se factura.' end ||
    ' Ya esta en Ventas > Mayoristas como cotizacion.',
    '/ventas?tab=mayoristas&pedido=' || v_numero_may,
    array['owner','admin','ventas']::role_enum[]
  );

  return jsonb_build_object('ok', true, 'pedido_id', v_ped.id, 'numero', v_numero_b2b,
                            'numero_mayorista', v_numero_may, 'canal', v_canal,
                            'total_neto', v_total,
                            'total_iva', v_iva, 'total_con_iva', v_total + v_iva,
                            'con_iva', v_con_iva, 'total_a_pagar', v_pagar,
                            'unidades', v_unid);
end $function$;


/* ── 7. Mis pedidos: el cliente ve como quedo cada uno ──────────────────
   Copiado de 0169 tal cual, con dos claves mas al final de cada pedido. */
create or replace function public.b2b_rpc_mis_pedidos(p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer
set search_path to 'public','pg_temp' as $fn$
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
             'direccion_entrega', p.direccion_entrega,
             'notas', p.notas,
             'condicion_pago', p.condicion_pago,
             'canal', p.canal,
             'con_iva', p.con_iva,
             'total_a_pagar', p.total_a_pagar,
             'total_neto', coalesce(p.total_neto,
                             (select coalesce(sum(i.subtotal),0) from public.b2b_pedido_item i
                               where i.pedido_id = p.id)),
             'total_con_iva', p.total_con_iva,
             'unidades', (select coalesce(sum(i.cantidad),0) from public.b2b_pedido_item i
                           where i.pedido_id = p.id),
             'items', (select coalesce(jsonb_agg(jsonb_build_object(
                          'sku', i.sku, 'modelo', s.modelo, 'color', s.color,
                          'cantidad', i.cantidad, 'iva_pct', i.iva_pct,
                          'precio_unitario', i.precio_unitario, 'subtotal', i.subtotal)
                        order by i.sku), '[]'::jsonb)
                       from public.b2b_pedido_item i
                       join public.sku_catalog s on s.sku = i.sku
                      where i.pedido_id = p.id),
             'comprobantes', (select coalesce(jsonb_agg(jsonb_build_object(
                          'id', k.id, 'path', k.path, 'mime', k.mime,
                          'nombre', k.nombre, 'monto', k.monto, 'nota', k.nota,
                          'size_bytes', k.size_bytes, 'created_at', k.created_at)
                        order by k.created_at desc), '[]'::jsonb)
                       from public.b2b_comprobante k
                      where k.pedido_id = p.id and k.eliminado_at is null),
             'facturas', (select coalesce(jsonb_agg(jsonb_build_object(
                          'id', f.id, 'tipo', f.tipo, 'numero', f.numero,
                          'fecha', f.fecha, 'total', f.total, 'path', f.path,
                          'mime', f.mime, 'nombre', f.nombre, 'nota', f.nota,
                          'size_bytes', f.size_bytes, 'created_at', f.created_at)
                        order by f.fecha desc nulls last, f.created_at desc), '[]'::jsonb)
                       from public.b2b_factura f
                      where f.pedido_id = p.id and f.eliminado_at is null))
           order by p.created_at desc)
      from public.b2b_pedido p
     where p.cliente_id = v_cli and p.estado <> 'borrador'
  ), '[]'::jsonb);
end $fn$;


/* ── 8. El panel lo ve en la fila ───────────────────────────────────────
   Columnas nuevas AL FINAL: create or replace view acepta agregar, no
   reordenar ni sacar. La tabla del panel usa con_iva para el chip de la fila
   y total_a_pagar para no volver a hacer la cuenta. */
create or replace view public.b2b_v_pedidos_admin as
 select pm.id as pedido_mayorista_id,
    pm.numero_pedido,
    pm.estado as estado_admin,
    pm.fecha_pedido,
    pm.fecha_entrega_estimada,
    c.id as cliente_id,
    c.nombre as cliente,
    c.b2b_canal as canal,
    bp.id as b2b_pedido_id,
    bp.numero as numero_b2b,
    bp.enviado_at,
    coalesce(bp.enviado_por, bp.creado_por) as b2b_usuario_id,
    u.nombre as comprador,
    u.email as comprador_email,
    ( select coalesce(sum(i.subtotal), 0::numeric)
        from b2b_pedido_item i where i.pedido_id = bp.id) as total_neto,
    ( select coalesce(sum(i.cantidad), 0::bigint)
        from b2b_pedido_item i where i.pedido_id = bp.id) as unidades,
    bp.estado as estado_tienda,
    bp.facturado_at,
    bp.factura_nro,
    ( select count(*) from b2b_comprobante k
       where k.pedido_id = bp.id and k.eliminado_at is null) as comprobantes,
    bp.direccion_entrega,
    bp.notas as notas_cliente,
    bp.condicion_pago,
    bp.total_con_iva,
    c.cuit as cliente_cuit,
    ( select count(*) from b2b_factura f
       where f.pedido_id = bp.id and f.eliminado_at is null) as facturas,
    bp.con_iva,
    bp.total_a_pagar
   from b2b_pedido bp
     join pedidos_mayoristas pm on pm.id = bp.pedido_mayorista_id
     join customers_b2b c on c.id = bp.cliente_id
     join b2b_usuario u on u.id = coalesce(bp.enviado_por, bp.creado_por);


/* ── 9. Que el equipo pueda corregirlo ──────────────────────────────────
   El cliente llama y dice "mandamela con factura". Sin esto, el pedido
   quedaria diciendo sin IVA para siempre y el papel no coincidiria con lo
   que se emitio. No cambia el estado, asi que no dispara el mail de cambio
   de estado (b2b_tg_pedido_mails escucha UPDATE OF estado): el equipo avisa
   por donde venia hablando, que es lo que hace igual.

   No toca los totales. Los tres siguen siendo los que el cliente acepto;
   total_a_pagar se recalcula solo porque es generada. */
create or replace function public.b2b_rpc_admin_set_pedido_iva(p_payload jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public','pg_temp' as $fn$
declare v_id uuid; v_val boolean; v_p public.b2b_pedido%rowtype;
begin
  perform public.b2b_fn_guard();
  if not public.b2b_fn_staff() then
    raise exception 'Sin permiso.' using errcode='42501';
  end if;

  v_id  := nullif(p_payload->>'pedido_id','')::uuid;
  v_val := (p_payload->>'con_iva')::boolean;
  if v_id is null or v_val is null then
    raise exception 'Falta pedido_id o con_iva.' using errcode='22023';
  end if;

  -- Un borrador no: ese carrito es del cliente y lo esta tocando el.
  update public.b2b_pedido set con_iva = v_val
   where id = v_id and estado <> 'borrador'
  returning * into v_p;
  if not found then
    raise exception 'No encontramos ese pedido (o todavia es un carrito abierto del cliente).'
      using errcode='P0002';
  end if;

  return jsonb_build_object('ok', true, 'pedido_id', v_p.id, 'con_iva', v_p.con_iva,
                            'total_a_pagar', v_p.total_a_pagar);
end $fn$;

revoke all    on function public.b2b_rpc_admin_set_pedido_iva(jsonb) from public, anon;
grant  execute on function public.b2b_rpc_admin_set_pedido_iva(jsonb) to authenticated;


/* ── 10. Los mails dicen lo que se cobra ────────────────────────────────
   Copiado de 0168 tal cual, con los agregados marcados 0170. */
create or replace function public.b2b_fn_pedido_mails()
returns trigger language plpgsql security definer
set search_path to 'public','pg_temp' as $fn$
declare
  v_cli       text;
  v_comprador text;
  v_mails     text;
  v_canal     text;
  v_lineas    int;
  v_unid      int;
  v_datos     jsonb;
  v_tit       text;
  v_msg       text;
  v_eyebrow   text;
  v_num       text;
  v_pagar     numeric;   -- 0170
  v_fact      text;      -- 0170
begin
  v_num := coalesce(new.numero_mayorista, new.numero, '');

  -- A quien le escribimos: el comprador que lo mando, y el mail de la empresa
  -- si es otro. b2b_fn_mail_cliente los deduplica.
  select c.nombre,
         concat_ws(',', nullif(trim(u.email), ''), nullif(trim(c.email), ''))
    into v_cli, v_mails
    from public.customers_b2b c
    left join public.b2b_usuario u
      on u.id = coalesce(new.enviado_por, new.creado_por)
   where c.id = new.cliente_id;

  select ca.nombre into v_canal
    from public.b2b_canal ca where ca.codigo = new.canal;
  v_canal := coalesce(v_canal, new.canal, 'mayorista');

  /* ══ Pedido nuevo ══ */
  if old.estado = 'borrador' and new.estado = 'enviado' then
    select coalesce(count(*), 0), coalesce(sum(cantidad), 0)
      into v_lineas, v_unid
      from public.b2b_pedido_item where pedido_id = new.id;

    select coalesce(nombre, '') into v_comprador
      from public.b2b_usuario where id = coalesce(new.enviado_por, new.creado_por);

    /* 0170 — Lo que este pedido cobra de verdad, que desde ahora no siempre
       es el total con IVA. */
    v_pagar := case when new.con_iva then coalesce(new.total_con_iva, 0)
                    else coalesce(new.total_neto, 0) end;
    v_fact  := case when new.con_iva
                    then 'Con IVA - emitimos factura'
                    else 'Sin IVA - presupuesto, no se emite factura' end;

    -- La ficha. Desde 0170 la parte de los numeros depende del tilde: con IVA
    -- se abre en neto + IVA + total (que es lo que pidio el cliente para el
    -- presupuesto), sin IVA va un solo total.
    v_datos :=
      jsonb_build_array(
        jsonb_build_object('k', 'Pedido',    'v', v_num),
        jsonb_build_object('k', 'Lista',     'v', v_canal),
        jsonb_build_object('k', 'Productos',
          'v', coalesce(v_lineas, 0) || ' productos · ' || coalesce(v_unid, 0) || ' unidades'))
      || case when new.fecha_entrega_deseada is not null
              then jsonb_build_array(jsonb_build_object('k', 'Entrega deseada',
                     'v', to_char(new.fecha_entrega_deseada, 'DD/MM/YYYY')))
              else '[]'::jsonb end
      || case when nullif(trim(coalesce(new.condicion_pago, '')), '') is not null
              then jsonb_build_array(jsonb_build_object('k', 'Condicion de pago',
                     'v', new.condicion_pago))
              else '[]'::jsonb end
      || case when nullif(trim(coalesce(new.direccion_entrega, '')), '') is not null
              then jsonb_build_array(jsonb_build_object('k', 'Entregar en',
                     'v', new.direccion_entrega))
              else '[]'::jsonb end
      || case when new.con_iva then
           jsonb_build_array(
             jsonb_build_object('k', 'Neto', 'sep', true,
               'v', '$ ' || to_char(coalesce(new.total_neto, 0), 'FM999G999G999D00')),
             jsonb_build_object('k', 'IVA',
               'v', '$ ' || to_char(coalesce(new.total_iva, 0), 'FM999G999G999D00')),
             jsonb_build_object('k', 'Total con IVA', 'fuerte', true,
               'v', '$ ' || to_char(coalesce(new.total_con_iva, 0), 'FM999G999G999D00')))
         else
           /* Sin IVA no se muestran ni el IVA ni el total con IVA. Son numeros
              que este pedido no va a cobrar: ponerlos al lado del que si se
              cobra hace que el cliente transfiera de mas o llame a preguntar
              cual de los dos vale. Un solo numero, el que hay que pagar. */
           jsonb_build_array(
             jsonb_build_object('k', 'Total', 'sep', true, 'fuerte', true,
               'v', '$ ' || to_char(coalesce(new.total_neto, 0), 'FM999G999G999D00')))
         end
      || jsonb_build_array(jsonb_build_object('k', 'Facturacion', 'v', v_fact));

    -- Al cliente
    perform public.b2b_fn_mail_cliente(
      v_mails,
      'Recibimos tu pedido ' || v_num,
      'Recibimos tu pedido',
      'Ya lo tenemos. Lo estamos revisando y te avisamos apenas quede confirmado. '
      'Mientras tanto lo podes seguir desde tu cuenta.',
      jsonb_build_object(
        'eyebrow',   'Pedido recibido',
        'cta',       'Ver mi pedido',
        'preheader', 'Pedido ' || v_num || ' · ' || coalesce(v_unid, 0) || ' unidades · $'
                     || to_char(v_pagar, 'FM999G999G999D00')
                     || case when new.con_iva then ' con IVA' else ' sin IVA' end,
        'datos',     jsonb_build_array(
                       jsonb_build_object('k', 'Cliente', 'v', coalesce(v_cli, '')))
                     || v_datos));

    -- Y adentro, con la ficha entera
    perform public.b2b_fn_avisar_interno(
      'sistema'::notif_type_enum,
      'Pedido B2B nuevo: ' || coalesce(v_cli, '') || ' (' || v_canal || ')',
      coalesce(nullif(v_comprador, ''), 'El comprador') || ' cargo el pedido ' || v_num ||
      ' desde la tienda. Ya esta en Ventas > Mayoristas como cotizacion.',
      '/ventas?tab=mayoristas&pedido=' || coalesce(new.numero_mayorista, ''),
      array[]::role_enum[],   -- la campanita ya la toco b2b_rpc_enviar_pedido
      true,
      jsonb_build_object(
        'eyebrow',   'Pedido nuevo de la tienda',
        'cta',       'Abrir el pedido',
        'preheader', coalesce(v_cli, '') || ' · ' || coalesce(v_unid, 0) || ' unidades · $'
                     || to_char(v_pagar, 'FM999G999G999D00')
                     || case when new.con_iva then ' con IVA' else ' SIN IVA' end,
        'datos',
          jsonb_build_array(
            jsonb_build_object('k', 'Cliente',   'v', coalesce(v_cli, '')),
            jsonb_build_object('k', 'Comprador', 'v', coalesce(nullif(v_comprador, ''), '-')))
          || v_datos
          || case when nullif(trim(coalesce(new.notas, '')), '') is not null
                  then jsonb_build_array(jsonb_build_object('k', 'Nota del cliente',
                         'sep', true, 'v', new.notas))
                  else '[]'::jsonb end));

    return new;
  end if;

  /* ══ Cambio de estado ══ */
  case new.estado
    when 'confirmado' then
      v_eyebrow := 'Pedido confirmado';
      v_tit := 'Confirmamos tu pedido';
      v_msg := 'Ya esta confirmado y entra en preparacion. Te vamos avisando a medida que avanza.';
    when 'en_produccion' then
      v_eyebrow := 'En produccion';
      v_tit := 'Tu pedido esta en produccion';
      v_msg := 'Lo estamos fabricando. Cuando este listo para salir te escribimos de nuevo.';
    when 'listo_despacho' then
      v_eyebrow := 'Listo para despachar';
      v_tit := 'Tu pedido esta listo';
      v_msg := 'Terminamos de prepararlo y ya queda listo para despachar.';
    when 'despachado' then
      v_eyebrow := 'Despachado';
      v_tit := 'Tu pedido salio';
      v_msg := 'Ya salio para la direccion de entrega. Cualquier cosa con la entrega, escribinos.';
    when 'facturado' then
      v_eyebrow := 'Facturado';
      v_tit := 'Tu pedido esta facturado';
      v_msg := 'Emitimos la factura de este pedido'
               || coalesce(' (' || nullif(trim(new.factura_nro), '') || ')', '') || '.';
    when 'anulado' then
      v_eyebrow := 'Pedido anulado';
      v_tit := 'Se anulo tu pedido';
      v_msg := coalesce(nullif(trim(new.anulado_motivo), ''), 'El pedido quedo anulado.')
               || ' Si fue un error o queres volver a cargarlo, escribinos.';
    else
      return new;   -- 'enviado' o 'borrador': el cliente ya lo sabe.
  end case;

  perform public.b2b_fn_mail_cliente(
    v_mails,
    v_tit || ' · ' || v_num,
    v_tit,
    v_msg,
    jsonb_build_object(
      'eyebrow',   v_eyebrow,
      'cta',       'Ver mi pedido',
      'preheader', 'Pedido ' || v_num || ' · ' || lower(v_eyebrow),
      'datos', jsonb_build_array(
        jsonb_build_object('k', 'Pedido',  'v', v_num),
        jsonb_build_object('k', 'Cliente', 'v', coalesce(v_cli, '')),
        jsonb_build_object('k', 'Lista',   'v', v_canal),
        jsonb_build_object(
          'k', case when new.con_iva then 'Total con IVA' else 'Total (sin IVA)' end,
          'sep', true,
          'v', '$ ' || to_char(case when new.con_iva then coalesce(new.total_con_iva, 0)
                                    else coalesce(new.total_neto, 0) end,
                               'FM999G999G999D00')))));

  return new;
exception when others then
  return new;   -- Ni el mail ni una nota rara pueden voltear un pedido.
end $fn$;


/* ── 11. Que haya quedado como dice arriba ──────────────────────────────
   Si algo de esto no da, la migracion entera se cae y la base queda como
   estaba. Es barato y evita descubrirlo con un pedido real adentro. */
do $chk$
declare v_n int;
begin
  -- La bandera existe, no admite nulos y arranca en true
  select count(*) into v_n from information_schema.columns
   where table_schema='public' and table_name='b2b_pedido'
     and column_name='con_iva' and is_nullable='NO' and column_default like '%true%';
  if v_n <> 1 then raise exception '0170: b2b_pedido.con_iva no quedo como se esperaba.'; end if;

  -- total_a_pagar es generada (si alguien la puede escribir a mano, deja de
  -- ser una sola fuente y vuelve el problema que vino a resolver)
  select count(*) into v_n from information_schema.columns
   where table_schema='public' and table_name='b2b_pedido'
     and column_name='total_a_pagar' and is_generated='ALWAYS';
  if v_n <> 1 then raise exception '0170: total_a_pagar no quedo generada.'; end if;

  -- Ningun pedido viejo quedo sin decision
  select count(*) into v_n from public.b2b_pedido where con_iva is null;
  if v_n <> 0 then raise exception '0170: quedaron % pedidos con con_iva nulo.', v_n; end if;

  -- El panel las ve
  select count(*) into v_n from information_schema.columns
   where table_schema='public' and table_name='b2b_v_pedidos_admin'
     and column_name in ('con_iva','total_a_pagar');
  if v_n <> 2 then raise exception '0170: la vista del panel no trae con_iva/total_a_pagar.'; end if;

  -- La RPC del equipo existe y no la puede llamar cualquiera
  if to_regprocedure('public.b2b_rpc_admin_set_pedido_iva(jsonb)') is null then
    raise exception '0170: falta b2b_rpc_admin_set_pedido_iva.';
  end if;
  if has_function_privilege('anon', 'public.b2b_rpc_admin_set_pedido_iva(jsonb)', 'execute') then
    raise exception '0170: anon puede ejecutar b2b_rpc_admin_set_pedido_iva.';
  end if;

  -- Y la aritmetica cierra en los pedidos que ya estaban
  select count(*) into v_n from public.b2b_pedido
   where estado <> 'borrador' and total_neto is not null
     and total_a_pagar is distinct from
         (case when con_iva then total_con_iva else total_neto end);
  if v_n <> 0 then raise exception '0170: % pedidos con total_a_pagar mal.', v_n; end if;
end $chk$;
