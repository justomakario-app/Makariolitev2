-- 0152 · B2B (2/3) CATALOGO COMERCIAL Y PRECIOS.
--
-- POR QUE EXISTE ESTA MIGRACION
-- Hoy NO hay un solo precio en toda la base. sku_catalog (128 SKUs) no tiene columna de precio,
-- ni foto, ni descripcion, ni peso, ni bulto: sus 11 columnas son sku, modelo, color, color_hex,
-- categoria, es_fabricado, activo, created_at, updated_at, incompleto, es_insumo_interno.
-- Las UNICAS columnas monetarias del schema son precio_unitario en pedidos_mayoristas_items,
-- presupuestos_items y remitos_items — precio tipeado a mano documento por documento, y las tres
-- tablas estan en 0 filas. Una tienda B2B autoservicio no tiene de donde leer que mostrar.
--
-- MODELO (el del brief): UN precio_base por SKU x el coeficiente del canal del cliente.
--   distribuidor 0.55 · mayorista 0.70 · minorista 1.00   (b2b_canal, 0151)
--   precio_final = round(precio_base * coeficiente, 2)
-- precio_base es NETO, sin IVA. iva_pct se guarda por SKU y se expone aparte.
--
-- AISLAMIENTO DE PRECIOS (requisito explicito del brief)
--   b2b_producto NO es legible por el cliente: contiene precio_base, y precio_base es el precio
--   minorista (coef 1.00), o sea que verlo es ver el precio de todos los canales. El cliente
--   recibe SOLO su precio ya calculado, por RPC. Es la misma razon por la que b2b_canal quedo
--   cerrado en 0151. El aislamiento no depende de que el frontend "no pida" la columna.
--
-- No toca sku_catalog (se extiende de costado, 1:1), ni prod_*, ni el modulo admin.
-- ✅ APLICADA EN REMOTO el 2026-08-15. Dejo 61 filas en b2b_producto (los SKU vendibles),
--    todas SIN precio_base y despublicadas: esa es la lista de trabajo del dueno.

-- ─────────────────────────────────────────────────────────────────────────
-- (A) b2b_producto — la cara vendible de un SKU
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.b2b_producto (
  sku              text primary key references public.sku_catalog(sku) on delete cascade,
  precio_base      numeric(12,2) check (precio_base >= 0),
  moneda           text not null default 'ARS' check (moneda in ('ARS','USD')),
  iva_pct          numeric(5,2) not null default 21 check (iva_pct >= 0 and iva_pct <= 100),
  descripcion      text,
  foto_path        text,
  unidad_venta     text not null default 'unidad',
  bulto_cantidad   integer not null default 1 check (bulto_cantidad >= 1),
  multiplo_venta   integer not null default 1 check (multiplo_venta >= 1),
  minimo_sku       integer not null default 0 check (minimo_sku >= 0),
  orden            integer not null default 0,
  publicado        boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles(id),
  -- No se puede publicar algo sin precio: la tienda no tendria que mostrar.
  constraint b2b_producto_publicado_ck check (publicado = false or precio_base is not null)
);

comment on table public.b2b_producto is
  'Extension comercial 1:1 de sku_catalog para la tienda B2B. precio_base es NETO y equivale al precio minorista (coeficiente 1.00). NUNCA se expone al cliente: el cliente recibe su precio ya multiplicado por su coeficiente.';
comment on column public.b2b_producto.foto_path is
  'Path del objeto en Supabase Storage. El bucket se crea aparte desde el Dashboard; hoy storage.objects esta en 0 filas.';

create index if not exists b2b_producto_publicado_idx
  on public.b2b_producto (orden, sku) where publicado = true;

drop trigger if exists b2b_producto_updated_at on public.b2b_producto;
create trigger b2b_producto_updated_at before update on public.b2b_producto
  for each row execute function public.set_updated_at();

-- Alta perezosa: se crean las filas de los SKUs vendibles (los que NO son insumo interno)
-- despublicadas y sin precio, para que el admin tenga la lista de trabajo a cargar.
insert into public.b2b_producto (sku, publicado)
select s.sku, false
  from public.sku_catalog s
 where s.activo = true
   and coalesce(s.es_insumo_interno, false) = false
on conflict (sku) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- (B) Historial de precios — append-only por trigger.
--     Sin esto no hay forma de responder "a que precio estaba el 3 de marzo".
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.b2b_precio_historial (
  id             bigint generated always as identity primary key,
  sku            text not null,
  precio_ant     numeric(12,2),
  precio_nue     numeric(12,2),
  cambiado_por   uuid references public.profiles(id),
  cambiado_at    timestamptz not null default now()
);

create index if not exists b2b_precio_historial_sku_idx
  on public.b2b_precio_historial (sku, cambiado_at desc);

create or replace function public.b2b_fn_log_precio()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
begin
  if tg_op = 'UPDATE' and old.precio_base is not distinct from new.precio_base then
    return new;
  end if;
  insert into public.b2b_precio_historial (sku, precio_ant, precio_nue, cambiado_por)
  values (new.sku,
          case when tg_op = 'UPDATE' then old.precio_base else null end,
          new.precio_base,
          auth.uid());
  return new;
end $fn$;

-- Dos triggers y no uno: con 'when (new.precio_base is not null)' unico, sacarle el precio a un
-- SKU (precio_base -> NULL) no quedaba registrado, o sea que el historial perdia justo el evento
-- de baja de precio. Y la clausula WHEN no puede referenciar OLD en un trigger que tambien es
-- ON INSERT. precio_nue ya es nullable y b2b_fn_log_precio tolera el NULL.
drop trigger if exists b2b_producto_log_precio on public.b2b_producto;
drop trigger if exists b2b_producto_log_precio_ins on public.b2b_producto;
drop trigger if exists b2b_producto_log_precio_upd on public.b2b_producto;
create trigger b2b_producto_log_precio_ins after insert on public.b2b_producto
  for each row when (new.precio_base is not null)
  execute function public.b2b_fn_log_precio();
create trigger b2b_producto_log_precio_upd after update of precio_base on public.b2b_producto
  for each row when (old.precio_base is distinct from new.precio_base)
  execute function public.b2b_fn_log_precio();

-- ─────────────────────────────────────────────────────────────────────────
-- (C) RLS — b2b_producto e historial son INTERNOS. Punto.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.b2b_producto        enable row level security;
alter table public.b2b_precio_historial enable row level security;

drop policy if exists b2b_producto_sel on public.b2b_producto;
create policy b2b_producto_sel on public.b2b_producto for select to authenticated
  using (public.is_owner_or_admin());

drop policy if exists b2b_precio_historial_sel on public.b2b_precio_historial;
create policy b2b_precio_historial_sel on public.b2b_precio_historial for select to authenticated
  using (public.is_owner_or_admin());

-- Se revoca tambien a authenticated: el default ACL de public concede arwdDxtm a anon Y
-- authenticated sobre cada tabla nueva. Sin esto, precio_base queda escribible (y la tabla
-- truncable) por el rol que ahora incluye a los clientes externos.
revoke all on public.b2b_producto         from anon, public, authenticated;
revoke all on public.b2b_precio_historial from anon, public, authenticated;
grant select on public.b2b_producto         to authenticated;
grant select on public.b2b_precio_historial to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- (D) RPCs
-- ─────────────────────────────────────────────────────────────────────────

-- (D.1) Catalogo del CLIENTE. Devuelve su precio y nada mas: ni precio_base, ni coeficiente,
--       ni el precio de otro canal. Un cliente de otro canal recibe otros numeros por la
--       misma llamada.
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
                 'precio_con_iva', round(p.precio_base * v_coef * (1 + p.iva_pct / 100), 2),
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

-- (D.2) Catalogo del ADMIN: precio_base + la grilla de precios de todos los canales.
create or replace function public.b2b_rpc_admin_catalogo(p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_temp' as $fn$
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
                   select jsonb_object_agg(c.codigo, round(p.precio_base * c.coeficiente, 2))
                     from public.b2b_canal c where c.activo = true)
               ) as x
          from public.b2b_producto p
          join public.sku_catalog s on s.sku = p.sku
         where (coalesce((p_payload->>'solo_publicados')::boolean, false) = false
                or p.publicado = true)
      ) t
  ), '[]'::jsonb);
end $fn$;
revoke execute on function public.b2b_rpc_admin_catalogo(jsonb) from public, anon;
grant  execute on function public.b2b_rpc_admin_catalogo(jsonb) to authenticated;

-- (D.3) Cargar / actualizar precio y atributos comerciales (owner/admin).
--       Acepta un SKU o un lote: {"items":[{"sku":"...","precio_base":1234, ...}, ...]}
create or replace function public.b2b_rpc_admin_set_producto(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare
  v_rol role_enum; v_item jsonb; v_items jsonb; v_n integer := 0;
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

    -- Se valida por item ANTES del insert: si no, b2b_producto_publicado_ck devuelve un 23514
    -- crudo con el nombre de la constraint y en un lote el admin no sabe cual item fallo.
    if coalesce((v_item->>'publicado')::boolean, false)
       and coalesce(nullif(v_item->>'precio_base','')::numeric,
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
      precio_base    = coalesce(nullif(v_item->>'precio_base','')::numeric, bp.precio_base),
      moneda         = coalesce(nullif(v_item->>'moneda',''), bp.moneda),
      iva_pct        = coalesce(nullif(v_item->>'iva_pct','')::numeric, bp.iva_pct),
      descripcion    = coalesce(nullif(trim(v_item->>'descripcion'),''), bp.descripcion),
      foto_path      = coalesce(nullif(trim(v_item->>'foto_path'),''), bp.foto_path),
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

-- (D.4) Canales: leer y ajustar coeficientes / minimos (owner-only para escribir).
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
        minimo_unidades = coalesce(nullif(v_c->>'minimo_unidades','')::integer, minimo_unidades),
        activo          = coalesce((v_c->>'activo')::boolean, activo)
      where codigo = v_c->>'codigo';
    end loop;
  end if;

  return coalesce((
    select jsonb_agg(row_to_json(c) order by c.orden)
      from (select codigo, nombre, coeficiente, minimo_pedido, minimo_unidades, orden, activo
              from public.b2b_canal) c
  ), '[]'::jsonb);
end $fn$;
revoke execute on function public.b2b_rpc_admin_canales(jsonb) from public, anon;
grant  execute on function public.b2b_rpc_admin_canales(jsonb) to authenticated;
