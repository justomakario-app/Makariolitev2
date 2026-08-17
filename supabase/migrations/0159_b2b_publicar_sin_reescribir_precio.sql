-- ════════════════════════════════════════════════════════════════════════════
-- 0159 — Publicar un producto sin volver a escribir el precio
--
-- QUÉ SE ROMPÍA
-- La grilla de "Ventas → Tienda mayorista → Productos" guarda por lote y manda
-- SOLO lo que se tocó: {sku:'AGU001', publicado:true}. Si el precio se cargó en
-- un guardado anterior, ese payload no lo lleva.
--
-- b2b_rpc_admin_set_producto resolvía eso con un
--     insert into b2b_producto (...) values (...) on conflict (sku) do update ...
-- y ahí está la trampa: Postgres evalúa los CHECK sobre la fila PROPUESTA del
-- insert ANTES de resolver el on conflict. Aunque el SKU ya exista con precio,
-- la fila propuesta viaja con precio_base nulo y publicado = true, y eso choca
-- contra
--     b2b_producto_publicado_ck  CHECK (publicado = false or precio_base is not null)
--
-- Resultado: tildar "En la tienda" en un producto que ya tenía precio devolvía
-- 23514 y volteaba el lote entero. Es exactamente el paso que falta para poner
-- la tienda en marcha (cargar los 61 precios y publicarlos), así que no puede
-- depender de acordarse de re-tipear el precio en el mismo guardado.
--
-- CÓMO SE ARREGLA
-- Se parte el upsert en dos: se asegura la fila (siempre con publicado = false,
-- que nunca puede violar el CHECK) y después se actualiza. El CHECK pasa a
-- evaluarse una sola vez, sobre la fila final y completa.
--
-- La validación amable que ya estaba se mantiene y sigue siendo la que habla:
-- publicar un SKU que de verdad no tiene precio devuelve 22023 con el mensaje
-- "No se puede publicar X sin precio", no un error de constraint. El CHECK
-- queda como red de seguridad de la base, que es su lugar.
--
-- No cambia ninguna otra semántica: el operador '?' sigue distinguiendo "no
-- mandaron la clave" de "la mandaron vacía" (borrar un precio lo borra), el
-- precio en 0 se sigue rechazando y el SKU inexistente sigue dando P0002.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.b2b_rpc_admin_set_producto(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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

    -- Publicar sin precio se rechaza acá, con mensaje, mirando el precio que ya
    -- tiene cargado el producto cuando el payload no trae uno nuevo.
    if coalesce((v_item->>'publicado')::boolean, false)
       and coalesce(
             case when v_item ? 'precio_base' then nullif(v_item->>'precio_base','')::numeric end,
             (select precio_base from public.b2b_producto where sku = v_item->>'sku')) is null then
      raise exception 'No se puede publicar % sin precio.', v_item->>'sku' using errcode='22023';
    end if;

    -- (1) Asegurar la fila. Va SIEMPRE con publicado = false: asi la fila que se
    --     propone al insert no puede violar b2b_producto_publicado_ck, exista o
    --     no el producto. Si ya existe, el insert no hace nada.
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

    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('ok', true, 'actualizados', v_n);
end $function$;

comment on function public.b2b_rpc_admin_set_producto(jsonb) is
  'Carga precios y datos de venta del catalogo B2B por lote. Acepta payload parcial: '
  '{sku, publicado:true} publica sin tener que volver a mandar el precio (0159).';
