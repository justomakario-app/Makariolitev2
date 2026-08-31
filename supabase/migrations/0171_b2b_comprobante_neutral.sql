/* ══════════════════════════════════════════════════════════════════════════
   0171 — El sistema nombra el comprobante, no declara lo que no hace
   ══════════════════════════════════════════════════════════════════════════

   0170 dejo al cliente elegir con IVA o sin IVA. La eleccion esta bien; el
   problema es como quedo escrita. En media docena de lugares el sistema
   decia, con todas las letras, "NO se emite factura", "queda como
   presupuesto y NO se factura", "el IVA que no se cobra habria sido $X".

   Eso no describe un pedido: describe una decision fiscal, y lo hace en
   superficies que se reenvian solas. El peor de todos era el mail al
   cliente, que llevaba la frase completa en la ficha bajo la clave
   "Facturacion" — un mail se reenvia mas facil que una captura.

   Lo que cambia es SOLO el texto. Un pedido sin IVA sigue cobrando el neto,
   sigue sin llevar factura y el equipo lo sigue distinguiendo de un
   golpe de vista. Lo unico que se va es el sistema afirmando por escrito
   algo que nadie le pregunto. Ahora dice que documento sale:

       con_iva = true   ->  FACTURA
       con_iva = false  ->  PRESUPUESTO, sin impuestos ni percepciones

   Dos funciones tocadas, las dos recreadas enteras (Postgres no parchea
   cuerpos) y byte por byte iguales a 0170 salvo las frases:

     · b2b_rpc_enviar_pedido — la nota interna del pedido mayorista y el
       aviso al equipo. Se va tambien el monto del IVA no cobrado: es un
       numero que nadie usa para trabajar y que quedaba escrito para siempre.
     · b2b_fn_pedido_mails  — el mail del cliente, el mail interno y los dos
       preheaders.

   No toca datos, ni la aritmetica, ni total_a_pagar, ni el trigger, ni
   quien puede ejecutar que: create or replace conserva los permisos.
   ══════════════════════════════════════════════════════════════════════════ */


/* ── 1. Lo que la columna significa, dicho sin declarar nada ────────────── */
comment on column public.b2b_pedido.con_iva is
  'true: se cobra total_con_iva y el comprobante es una factura al CUIT del cliente. false: se cobra total_neto y el comprobante es un presupuesto, sin impuestos ni percepciones. Lo elige el comprador al confirmar el pedido. No cambia la aritmetica: los tres totales se guardan siempre igual.';


/* ── 2. Enviar el pedido: la nota interna y el aviso al equipo ───────────
   Copiada de 0170 tal cual. Lo unico distinto son las frases de v_fact y
   las dos del aviso interno. */
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

  /* 0170 — Factura o presupuesto. Manda lo que vino en el payload: es el
     tilde que el comprador acaba de tocar en la pantalla de confirmar, y
     puede ser mas nuevo que lo guardado si toco y mando en el mismo
     movimiento. Si no vino nada, vale lo del borrador. Nunca queda nulo:
     sin decision explicita se factura, que es el default legal y el que no
     sorprende a nadie. */
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
    raise exception 'El minimo de compra % es $% (neto) y tu pedido suma $%.',
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

  /* 0170/0171 — La linea que le dice al equipo que comprobante lleva este
     pedido. Va arriba de todo en la nota del pedido mayorista porque es lo
     primero que se lee al abrirlo. Nombra el documento y nada mas: esta nota
     se imprime, se copia y se reenvia, y no tiene por que declarar nada.
     El CUIT se resuelve aca y no en la pantalla: el papel y el mail tienen
     que decir el mismo numero que figura en la ficha del cliente. */
  select nullif(trim(c.cuit), '') into v_cuit
    from public.customers_b2b c where c.id = v_cli;
  v_pagar := case when v_con_iva then v_total + v_iva else v_total end;
  if v_con_iva then
    v_fact := 'COMPROBANTE: FACTURA'
              || coalesce(' al CUIT ' || v_cuit, ' (OJO: este cliente no tiene CUIT cargado)')
              || '.' || e'\nTotal que acepto el cliente: $' || to_char(v_total, 'FM999G999G999D00')
              || ' neto + $' || to_char(v_iva, 'FM999G999G999D00')
              || ' de IVA = $' || to_char(v_total + v_iva, 'FM999G999G999D00') || '.';
  else
    v_fact := 'COMPROBANTE: PRESUPUESTO, sin impuestos ni percepciones.'
              || e'\nTotal que acepto el cliente: $' || to_char(v_total, 'FM999G999G999D00')
              || ' (neto).';
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
      || case when v_con_iva then '' else ' - presupuesto' end,
    v_comprador || ' cargo el pedido ' || v_numero_may || ' con la lista ' ||
    coalesce(v_canal_nombre, v_canal) || ' (' || v_lineas || ' productos, ' ||
    v_unid || ' unidades, $' || to_char(v_total, 'FM999G999G999D00') || ' neto). ' ||
    case when v_con_iva
         then 'Lleva factura: cobra $' || to_char(v_total + v_iva, 'FM999G999G999D00') ||
              coalesce(' al CUIT ' || v_cuit, ' (no tiene CUIT cargado)') || '.'
         else 'Queda como presupuesto: cobra $' || to_char(v_total, 'FM999G999G999D00') ||
              ', sin impuestos ni percepciones.' end ||
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

/* ── 3. Los mails ───────────────────────────────────────────────────────
   Copiada de 0170 tal cual. Cambian la clave de la ficha ("Facturacion"
   pasa a "Comprobante"), su valor, los dos preheaders y el rotulo del
   total en los mails de cambio de estado. */
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
                    then 'Factura'
                    else 'Presupuesto' end;

    -- La ficha. La parte de los numeros depende del comprobante: con factura
    -- se abre en neto + IVA + total; como presupuesto va un solo total, que
    -- es el que hay que pagar.
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
           /* En un presupuesto no se muestran ni el IVA ni el total con IVA.
              Son numeros que este pedido no va a cobrar: ponerlos al lado del
              que si se cobra hace que el cliente transfiera de mas o llame a
              preguntar cual de los dos vale. Un solo numero, el que se paga. */
           jsonb_build_array(
             jsonb_build_object('k', 'Total', 'sep', true, 'fuerte', true,
               'v', '$ ' || to_char(coalesce(new.total_neto, 0), 'FM999G999G999D00')))
         end
      || jsonb_build_array(jsonb_build_object('k', 'Comprobante', 'v', v_fact));

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
                     || case when new.con_iva then ' con IVA' else '' end,
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
                     || case when new.con_iva then ' con IVA' else ' presupuesto' end,
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
          'k', case when new.con_iva then 'Total con IVA' else 'Total' end,
          'sep', true,
          'v', '$ ' || to_char(case when new.con_iva then coalesce(new.total_con_iva, 0)
                                    else coalesce(new.total_neto, 0) end,
                               'FM999G999G999D00')))));

  return new;
exception when others then
  return new;   -- Ni el mail ni una nota rara pueden voltear un pedido.
end $fn$;

/* ── 4. Que ninguna de las frases haya sobrevivido ──────────────────────
   Barato y directo: si alguna volvio, la migracion entera se cae y la base
   queda como estaba. Se lee el fuente real de las funciones, no este
   archivo, asi que tambien atrapa una version vieja que hubiera quedado
   aplicada por otro lado. */
do $chk$
declare
  v_src  text;
  v_mala text;
begin
  select coalesce(string_agg(p.prosrc, e'\n'), '') into v_src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('b2b_rpc_enviar_pedido', 'b2b_fn_pedido_mails');

  if v_src = '' then
    raise exception '0171: no se encontraron las funciones que se acaban de crear.';
  end if;

  foreach v_mala in array array[
    'no se emite factura', 'no se factura', 'no lleva factura',
    'sin IVA', 'habria sido', 'Facturacion'
  ] loop
    if v_src ilike '%' || v_mala || '%' then
      raise exception '0171: quedo la frase "%" viva en el codigo de pedidos.', v_mala;
    end if;
  end loop;

  -- Y que lo nuevo este donde tiene que estar
  if v_src not like '%COMPROBANTE: PRESUPUESTO%' then
    raise exception '0171: no quedo la linea del comprobante en la nota interna.';
  end if;
  if v_src not like '%''Comprobante''%' then
    raise exception '0171: la ficha del mail no quedo con la clave Comprobante.';
  end if;
end $chk$;
