-- ═══════════════════════════════════════════════════════════════════════════
-- 0157 — "Repetir pedido": el pedido recurrente del mayorista
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El brief pedia pedidos recurrentes. Sin scheduler en la base (no hay pg_cron
-- habilitado) no existe el disparo automatico "todos los dia 1 generame esto".
-- Lo que el mayorista realmente hace, igual, es pedir lo mismo que la vez
-- pasada. Eso es lo que resuelve esta RPC: toma un pedido ya enviado del propio
-- cliente y lo vuelca en el carrito actual, en un solo click.
--
-- Tres decisiones que importan:
--
--  1) Se recarga a PRECIO DE HOY, no al precio congelado del pedido viejo. El
--     precio congelado protege un pedido ya enviado (0153); un pedido nuevo se
--     cobra a la lista vigente. Si no, repetir un pedido de hace un ano seria
--     una forma de comprar al precio del ano pasado.
--
--  2) Lo que ya no se puede vender NO se cuela: si el SKU se despublico, se
--     quedo sin precio o salio del catalogo, se omite y se informa cual y por
--     que. El cliente ve "estos 2 no estan disponibles", no un error opaco.
--
--  3) Si el multiplo de venta cambio (antes se vendia de a 1, ahora de a 6), la
--     cantidad se REDONDEA PARA ARRIBA al multiplo vigente y se informa. Nunca
--     para abajo: nadie quiere recibir menos de lo que pidio sin enterarse.
--
-- No toca nada de lo anterior: solo agrega una funcion.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.b2b_rpc_repetir_pedido(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare
  v_cli       uuid;
  v_coef      numeric;
  v_origen    public.b2b_pedido%rowtype;
  v_carrito   uuid;
  v_modo      text;
  v_it        record;
  v_p         public.b2b_producto%rowtype;
  v_cant      integer;
  v_previa    integer;
  v_motivo    text;
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

  -- El pedido de origen tiene que ser DE ESTE CLIENTE. Si no lo es, se responde
  -- lo mismo que si no existiera: un id ajeno no se distingue de uno inventado.
  select * into v_origen from public.b2b_pedido
   where cliente_id = v_cli
     and estado <> 'borrador'
     and ( (p_payload ? 'pedido_id' and id = nullif(p_payload->>'pedido_id','')::uuid)
        or (p_payload ? 'numero'    and numero = nullif(trim(p_payload->>'numero'),'')) );
  if not found then
    raise exception 'No encontramos ese pedido.' using errcode='P0002';
  end if;

  v_carrito := public.b2b_fn_carrito_id(v_cli);

  if v_modo = 'reemplazar' then
    delete from public.b2b_pedido_item where pedido_id = v_carrito;
  end if;

  for v_it in
    select i.sku, i.cantidad, i.notas_item
      from public.b2b_pedido_item i
     where i.pedido_id = v_origen.id
     order by i.sku
  loop
    v_motivo := null;

    select * into v_p from public.b2b_producto where sku = v_it.sku;
    if not found then
      v_motivo := 'ya no esta en el catalogo';
    elsif v_p.publicado = false then
      v_motivo := 'no esta publicado';
    elsif v_p.precio_base is null then
      v_motivo := 'no tiene precio cargado';
    end if;

    if v_motivo is not null then
      v_omitidos := v_omitidos || jsonb_build_object('sku', v_it.sku, 'motivo', v_motivo);
      continue;
    end if;

    -- Lo que ya haya en el carrito se suma (modo "agregar"); en "reemplazar" el
    -- carrito quedo vacio arriba, asi que v_previa es 0.
    select coalesce(cantidad, 0) into v_previa
      from public.b2b_pedido_item where pedido_id = v_carrito and sku = v_it.sku;
    v_cant := coalesce(v_previa, 0) + v_it.cantidad;

    -- Reglas vigentes del producto, siempre redondeando para arriba.
    if v_cant < v_p.minimo_sku then
      v_cant := v_p.minimo_sku;
    end if;
    if v_cant % v_p.multiplo_venta <> 0 then
      v_cant := v_cant + (v_p.multiplo_venta - (v_cant % v_p.multiplo_venta));
    end if;

    if v_cant <> coalesce(v_previa, 0) + v_it.cantidad then
      v_ajustados := v_ajustados || jsonb_build_object(
        'sku', v_it.sku,
        'pedida', v_it.cantidad,
        'cargada', v_cant,
        'motivo', 'ahora se vende de a ' || v_p.multiplo_venta ||
                  case when v_p.minimo_sku > 0 then ' (minimo ' || v_p.minimo_sku || ')' else '' end);
    end if;

    insert into public.b2b_pedido_item as it (
      pedido_id, sku, cantidad, precio_base_snap, coeficiente_snap,
      precio_unitario, iva_pct, notas_item
    ) values (
      v_carrito, v_it.sku, v_cant, v_p.precio_base, v_coef,
      round(v_p.precio_base * v_coef, 2), v_p.iva_pct, v_it.notas_item
    )
    on conflict (pedido_id, sku) do update set
      cantidad        = excluded.cantidad,
      -- Se re-congela a la lista de HOY: el carrito es un pedido nuevo.
      precio_base_snap = excluded.precio_base_snap,
      coeficiente_snap = excluded.coeficiente_snap,
      precio_unitario  = excluded.precio_unitario,
      iva_pct          = excluded.iva_pct,
      notas_item       = coalesce(it.notas_item, excluded.notas_item);

    v_agregados := v_agregados + 1;
  end loop;

  -- La direccion del pedido viejo solo se copia si el carrito no tiene una:
  -- repetir un pedido no puede pisar una direccion que el cliente ya escribio.
  update public.b2b_pedido
     set direccion_entrega = coalesce(direccion_entrega, v_origen.direccion_entrega)
   where id = v_carrito and estado = 'borrador';

  return jsonb_build_object(
    'ok', true,
    'pedido_id', v_carrito,
    'origen', v_origen.numero,
    'agregados', v_agregados,
    'omitidos', v_omitidos,
    'ajustados', v_ajustados
  );
end $fn$;

revoke execute on function public.b2b_rpc_repetir_pedido(jsonb) from public, anon;
grant  execute on function public.b2b_rpc_repetir_pedido(jsonb) to authenticated;

comment on function public.b2b_rpc_repetir_pedido(jsonb) is
  'Vuelca un pedido propio ya enviado en el carrito actual, a precio vigente. '
  'payload: {pedido_id|numero, modo:"agregar"|"reemplazar"}. '
  'Devuelve {ok, agregados, omitidos:[{sku,motivo}], ajustados:[{sku,pedida,cargada,motivo}]}.';
