-- ══════════════════════════════════════════════════════════════════════════
-- 0172 — El mínimo de la RECOMPRA no es el de la primera compra
-- ──────────────────────────────────────────────────────────────────────────
-- La regla comercial siempre fue esta y el sistema no la sabía: al mayorista
-- se le pide $500.000 la PRIMERA vez y $300.000 en cada recompra. La tabla
-- tenía un solo número, así que a un cliente que ya había comprado se le
-- seguía exigiendo el mínimo de entrada y no podía emitir el pedido. Del lado
-- del cliente eso no se lee como un error del sistema: se lee como que no le
-- quieren vender.
--
-- Cómo queda:
--   · b2b_canal.minimo_recompra    el mínimo para el que ya compró. En null =
--                                  ese canal no distingue y sigue rigiendo
--                                  minimo_pedido para todos.
--   · customers_b2b.b2b_ya_compro  si ya tuvo su primera compra. Se prende
--                                  solo al enviar un pedido, y el dueño lo
--                                  puede prender a mano desde el panel.
--   · b2b_fn_minimo_pedido()       el ÚNICO lugar donde se decide cuál de los
--                                  dos rige.
--
-- Por qué un solo lugar y no un if repetido en cada RPC: cuatro pantallas
-- muestran el mínimo y una quinta función lo valida al enviar. Si cada una lo
-- calcula por su cuenta se pueden separar, y el síntoma es el peor de todos:
-- la barra del mínimo llena y el pedido que rebota igual. Es el mismo criterio
-- de b2b_fn_jornada_destino y de window.buscaEn — una decisión, un solo lugar.
--
-- Todo esto es base de datos. La tienda ya mostraba el mínimo que le manda el
-- servidor, así que empieza a regir sin tocar una línea de la web y sin
-- esperar un deploy.
-- ══════════════════════════════════════════════════════════════════════════

-- ── 1. Los dos mínimos ──────────────────────────────────────────
-- Queda en null para todos los canales menos mayorista, a propósito: así
-- ninguno cambia de comportamiento sin que alguien lo haya decidido.
alter table public.b2b_canal
  add column if not exists minimo_recompra numeric(12,2)
      check (minimo_recompra is null or minimo_recompra >= 0);

comment on column public.b2b_canal.minimo_recompra is
  'Minimo neto para un cliente que YA compro. Null = rige minimo_pedido siempre.';

update public.b2b_canal set minimo_recompra = 300000.00 where codigo = 'mayorista';

-- ── 2. Quién ya compró ────────────────────────────────────────────
alter table public.customers_b2b
  add column if not exists b2b_ya_compro boolean not null default false;

comment on column public.customers_b2b.b2b_ya_compro is
  'Ya tuvo su primera compra: le rige el minimo de recompra del canal. Se '
  'prende solo al enviar un pedido; el dueno lo prende a mano si la primera '
  'compra fue antes de la tienda y por eso no figura en la base.';

-- Arranque: los que ya tienen una compra DE VERDAD registrada. Una cotización
-- es un presupuesto, no una compra, y un cancelado tampoco cuenta.
-- Al cliente cuya primera compra fue por afuera hay que tildarlo a mano: no
-- hay de dónde deducirlo, y darle el mínimo bajo a todos por las dudas sería
-- regalar la regla que el dueño justamente quiere cobrar.
update public.customers_b2b c set b2b_ya_compro = true
 where c.b2b_ya_compro = false
   and (exists (select 1 from public.b2b_pedido p
                 where p.cliente_id = c.id and p.estado = 'enviado')
     or exists (select 1 from public.pedidos_mayoristas pm
                 where pm.cliente_id = c.id
                   and pm.estado in ('confirmado','en_produccion','listo','entregado')));

-- ── 3. El único lugar donde se decide cuál mínimo rige ───────────────
-- Devuelve null si el canal no existe, igual que la consulta que reemplaza:
-- las RPC ya trataban ese caso como "sin mínimo".
create or replace function public.b2b_fn_minimo_pedido(p_cliente uuid, p_canal text)
returns numeric language sql stable
set search_path to 'public','pg_temp' as $fn$
  select case
           when coalesce((select c.b2b_ya_compro
                            from public.customers_b2b c
                           where c.id = p_cliente), false)
                and ca.minimo_recompra is not null
             then ca.minimo_recompra
           else ca.minimo_pedido
         end
    from public.b2b_canal ca
   where ca.codigo = p_canal;
$fn$;

comment on function public.b2b_fn_minimo_pedido(uuid, text) is
  'El minimo que le rige a este cliente en este canal: el de recompra si ya '
  'compro, el de primera compra si no. Lo llaman TODAS las pantallas que '
  'muestran el minimo y tambien la que valida el envio, para que no se separen.';

-- No la llama nadie desde afuera: vive adentro de las RPC, que son security
-- definer y por eso la pueden ejecutar igual.
revoke execute on function public.b2b_fn_minimo_pedido(uuid, text) from public, anon, authenticated;

-- ── 4. Las RPC de la tienda ───────────────────────────────────
-- Mismo cuerpo que tenían; lo único que cambia es de dónde sale el número.

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
      /* 0172 - puede ser el minimo de recompra si este cliente ya compro.
         Sale de b2b_fn_minimo_pedido, la MISMA funcion que valida el envio: si
         la barra leyera un numero y el boton validara otro, el cliente veria
         el minimo cumplido y el pedido le rebotaria igual. */
      'minimo_pedido', public.b2b_fn_minimo_pedido(v_cli, p.canal),
      'minimo_unidades', ca.minimo_unidades
    )
    from public.b2b_pedido p
    left join public.b2b_canal ca on ca.codigo = p.canal
   where p.id = v_id
  );
end $function$;

create or replace function public.b2b_rpc_mi_cuenta(p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public','pg_temp' as $fn$
declare v_r jsonb; v_canal text; v_emisor jsonb;
begin
  if not public.b2b_fn_habilitado() then
    return jsonb_build_object('ok', false, 'motivo', 'b2b_deshabilitado');
  end if;

  v_canal := public.b2b_fn_canal_actual();

  select jsonb_build_object(
           'razon_social', cs.razon_social, 'cuit', cs.cuit,
           'domicilio', cs.domicilio, 'ciudad', cs.ciudad,
           'provincia', cs.provincia, 'codigo_postal', cs.codigo_postal,
           'telefono', cs.telefono, 'email', cs.email,
           'pago', jsonb_build_object(
             'banco', cs.banco, 'cbu', cs.cbu, 'alias', cs.alias_cbu,
             'titular', coalesce(cs.titular_cuenta, cs.razon_social),
             'cuit', coalesce(cs.cuit_cuenta, cs.cuit),
             'notas', cs.notas_pago,
             -- La tienda pregunta esto y no si vienen los campos: si el dueno
             -- todavia no cargo el CBU, no se dibuja la caja de transferencia
             -- con lugares vacios, directamente no se dibuja.
             'hay', (coalesce(trim(cs.cbu), '') <> '' or coalesce(trim(cs.alias_cbu), '') <> '')))
    into v_emisor
    from public.company_settings cs limit 1;

  select jsonb_build_object(
           'ok', true, 'usuario_id', u.id, 'nombre', u.nombre, 'email', u.email,
           'estado', u.estado, 'es_titular', u.es_titular,
           'rechazo_motivo', u.rechazo_motivo,
           -- El canal vigente: el que eligio, o el de defecto si todavia no
           -- eligio. La pantalla de "que catalogo queres ver" se muestra segun
           -- canal_elegido, no segun este.
           'canal', v_canal,
           'canal_elegido', (u.canal_activo is not null and u.canal_activo = v_canal),
           'emisor', case when u.estado = 'aprobado' then v_emisor else null end,
           'cliente', case when u.estado = 'aprobado' then jsonb_build_object(
             'id', c.id, 'nombre', c.nombre, 'cuit', c.cuit,
             -- 'habilitado' es la unica pregunta que hace la tienda para dejar
             -- comprar. Tiene que dar exactamente lo mismo que resuelve
             -- b2b_fn_coeficiente_actual(), o la pantalla ofrece un catalogo
             -- que despues explota con 42501 en la primera RPC.
             'habilitado', (c.b2b_habilitado and c.activo and v_canal is not null),
             'condicion_pago', c.b2b_condicion_pago,
             'canal', v_canal,
             -- 0172: el minimo que le rige HOY a este cliente, no el de tabla.
             'minimo_pedido',   public.b2b_fn_minimo_pedido(c.id, v_canal),
             'minimo_unidades', (select ca.minimo_unidades from public.b2b_canal ca where ca.codigo = v_canal),
             'canales', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'codigo', ca.codigo, 'nombre', ca.nombre,
                        'minimo_pedido', public.b2b_fn_minimo_pedido(c.id, ca.codigo),
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
end $fn$;

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
    'minimo_pedido', public.b2b_fn_minimo_pedido(v_cli, v_ca.codigo),
    'minimo_unidades', v_ca.minimo_unidades);
end $function$;

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
  /* 0172 - el monto sale de b2b_fn_minimo_pedido y no de la tabla: para un
     cliente que ya compro rige el minimo de recompra. Es el mismo numero que
     el carrito le viene mostrando, porque es la misma funcion. */
  select public.b2b_fn_minimo_pedido(v_cli, v_canal), ca.minimo_unidades, ca.nombre
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

  /* Desde aca este cliente ya compro, asi que al proximo pedido le rige el
     minimo de recompra. Se marca una sola vez y no se desmarca solo: si un
     pedido despues se cae, que lo decida el dueno desde el panel. */
  update public.customers_b2b set b2b_ya_compro = true
   where id = v_cli and b2b_ya_compro = false;

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

-- ── 5. El panel ────────────────────────────────────────────────
-- Para que el dueño pueda ver y mover los dos mínimos, y tildar a mano al
-- cliente cuya primera compra no está en el sistema.

create or replace function public.b2b_rpc_admin_canales(p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_rol role_enum; v_c jsonb;
begin
  perform public.b2b_fn_guard();
  v_rol := public.current_user_role();
  if v_rol is null or v_rol not in ('owner','admin') then
    raise exception 'Sin permiso.' using errcode='42501';
  end if;

  if p_payload ? 'canales' then
    if v_rol <> 'owner' then
      raise exception 'Solo el dueno puede cambiar coeficientes.' using errcode='42501';
    end if;
    for v_c in select * from jsonb_array_elements(p_payload->'canales') loop
      update public.b2b_canal set
        nombre          = coalesce(nullif(trim(v_c->>'nombre'),''), nombre),
        coeficiente     = coalesce(nullif(v_c->>'coeficiente','')::numeric, coeficiente),
        minimo_pedido   = coalesce(nullif(v_c->>'minimo_pedido','')::numeric, minimo_pedido),
        -- Con "case when ?" y no con coalesce, para que se pueda DEJAR EN NULL
        -- (= este canal no distingue recompra) mandando el campo vacio.
        minimo_recompra = case when v_c ? 'minimo_recompra'
                               then nullif(v_c->>'minimo_recompra','')::numeric
                               else minimo_recompra end,
        minimo_unidades = coalesce(nullif(v_c->>'minimo_unidades','')::integer, minimo_unidades),
        activo          = coalesce((v_c->>'activo')::boolean, activo)
      where codigo = v_c->>'codigo';
    end loop;
  end if;

  return coalesce((
    select jsonb_agg(row_to_json(c) order by c.orden)
      from (select codigo, nombre, coeficiente, minimo_pedido, minimo_recompra,
                   minimo_unidades, orden, activo
              from public.b2b_canal) c
  ), '[]'::jsonb);
end $fn$;
revoke execute on function public.b2b_rpc_admin_canales(jsonb) from public, anon;
grant  execute on function public.b2b_rpc_admin_canales(jsonb) to authenticated;

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
    es_mayorista       = case when p_payload ? 'habilitado' and coalesce(v_hab,false) then true else es_mayorista end,
    -- 0172: el tilde de "ya compro". Hace falta a mano para el cliente cuya
    -- primera compra fue antes de que existiera la tienda: esa venta no esta
    -- en la base, y sin el tilde se le pediria el minimo de entrada para
    -- siempre.
    b2b_ya_compro      = case when p_payload ? 'ya_compro'
                              then coalesce((p_payload->>'ya_compro')::boolean, b2b_ya_compro)
                              else b2b_ya_compro end
  where id = v_id;

  -- Los carritos NO se tocan y ya no hay que repreciarlos: desde 0162 cada
  -- borrador nace con su canal y se valúa siempre con ese. Si le sacan un
  -- canal al cliente, su carrito de ese catálogo queda guardado y vuelve a
  -- aparecer intacto el día que se lo rehabiliten.

  select * into v_c from public.customers_b2b where id = v_id;
  return jsonb_build_object(
    'ok', true, 'cliente_id', v_id, 'canal', v_c.b2b_canal, 'canales', to_jsonb(v_c.b2b_canales),
    'habilitado', v_c.b2b_habilitado, 'condicion_pago', v_c.b2b_condicion_pago,
    'ya_compro', v_c.b2b_ya_compro,
    'minimo_vigente', public.b2b_fn_minimo_pedido(v_id, v_c.b2b_canal));
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
      -- 0172: si ya compro, y cuanto le rige HOY. Es el numero que el dueno
      -- necesita cuando el cliente lo llama, sin tener que abrir la tienda.
      'ya_compro', c.b2b_ya_compro,
      'minimo_vigente', public.b2b_fn_minimo_pedido(c.id, c.b2b_canal),
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
