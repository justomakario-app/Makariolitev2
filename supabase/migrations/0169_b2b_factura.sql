/* ══ 0169 · FACTURAS PARA EL CLIENTE ══════════════════════════════════════
   El equipo sube la factura en PDF y el mayorista se la baja desde su
   cuenta. Es el comprobante de pago de 0167 dado vuelta: alla el cliente
   sube y el equipo mira, aca el equipo sube y el cliente mira. Mismo
   patron de bucket privado + tabla + borrado logico, porque ya esta
   probado.

   POR QUE UNA TABLA Y NO UNA COLUMNA EN b2b_pedido
   b2b_pedido ya tiene factura_nro y facturado_at desde 0158, pero eso es
   UN numero por pedido. En la vida real un pedido se factura en dos partes,
   o se emite una nota de credito despues, o se factura algo que nunca paso
   por la tienda. Una columna no da para eso; una tabla si.

   POR QUE pedido_id ES OPCIONAL
   El caso normal es la factura del pedido. Pero si el dueno le vende algo
   por telefono y le quiere dejar el comprobante en la cuenta igual, tiene
   que poder. La factura cuelga del CLIENTE (obligatorio) y opcionalmente
   del pedido. Si algun dia se borra un pedido, la factura queda: por eso
   el FK va con on delete set null y no con cascade — al reves que el
   comprobante de pago, que sin su pedido no significa nada.

   LO QUE NO HACE
   No emite ni numera nada, no habla con ARCA. Es un archivero: guarda el
   PDF que el dueno ya emitio afuera y se lo hace llegar al cliente. Marcar
   el pedido como facturado lo sigue haciendo b2b_rpc_admin_facturar_pedido,
   que no se toca.
   ═══════════════════════════════════════════════════════════════════════ */

begin;

/* Foto de las funciones que mueven plata o dan acceso. Al final del archivo
   se comparan contra si mismas: si algo de lo que escribi mas abajo las
   pisa aunque sea en un espacio, la migracion se aborta sola en vez de
   dejar la sorpresa para produccion. */
create temp table _mig0169_intactas as
select p.proname, pg_get_functiondef(p.oid) as def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('b2b_rpc_enviar_pedido', 'b2b_rpc_alta_publica',
                     'b2b_rpc_canjear_invitacion', 'b2b_fn_sync_estado',
                     'b2b_rpc_admin_facturar_pedido',
                     'b2b_rpc_adjuntar_comprobante');


/* ── 1. La tabla ─────────────────────────────────────────────────────────
   'tipo' existe porque en Argentina lo que se le manda al cliente no es
   siempre una factura: hay notas de credito, remitos y recibos. Meter todo
   como 'factura' obliga a leer el numero para saber que es. Default
   'factura', que es el 95% de los casos. */
create table if not exists public.b2b_factura (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid not null references public.customers_b2b(id),
  pedido_id     uuid references public.b2b_pedido(id) on delete set null,
  tipo          text not null default 'factura'
                  check (tipo in ('factura','nota_credito','recibo','remito','otro')),
  numero        text check (numero is null or length(numero) <= 40),
  fecha         date,
  total         numeric(14,2) check (total is null or total >= 0),
  path          text not null unique,
  mime          text not null check (mime in ('application/pdf','image/jpeg','image/png')),
  size_bytes    bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  nombre        text,
  nota          text check (nota is null or length(nota) <= 300),
  subida_por    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  eliminado_at  timestamptz,
  eliminado_por uuid references auth.users(id)
);

create index if not exists ix_b2b_factura_cliente on public.b2b_factura (cliente_id, fecha desc nulls last, created_at desc);
create index if not exists ix_b2b_factura_pedido  on public.b2b_factura (pedido_id);

/* Subir dos veces la misma factura al mismo cliente es un error de dedo, no
   un caso de uso. El indice es PARCIAL: solo mira las vivas, asi que si hay
   que reemplazar una se la borra (logico) y se sube de nuevo sin pelear. */
create unique index if not exists ux_b2b_factura_numero
  on public.b2b_factura (cliente_id, tipo, numero)
  where numero is not null and eliminado_at is null;

comment on table public.b2b_factura is
  'Comprobantes que el equipo le deja al mayorista para descargar (factura, nota de credito, remito). Borrado logico: una factura que el cliente ya vio no se evapora del registro.';
comment on column public.b2b_factura.pedido_id is
  'Opcional: la factura puede no corresponder a ningun pedido de la tienda. Si el pedido se borra la factura sobrevive sin el (on delete set null).';

alter table public.b2b_factura enable row level security;

/* Leer: el equipo todo, el cliente lo suyo. Escribir es SOLO por las RPC de
   mas abajo, asi que no hay policy de insert/update/delete a proposito. */
drop policy if exists b2b_factura_sel on public.b2b_factura;
create policy b2b_factura_sel on public.b2b_factura
  for select to authenticated
  using (public.b2b_fn_staff() or cliente_id = public.b2b_fn_cliente_actual());


/* ── 2. El bucket ────────────────────────────────────────────────────────
   Privado. Una factura tiene el CUIT, el domicilio y lo que compro el
   cliente: publica seria un problema. Se mira con URL firmada.
   El path es <cliente_id>/<uuid>.<ext> — la primera carpeta es el cliente
   justamente para que la policy la pueda comparar sin salir a la tabla.
   No se anida por pedido como el comprobante, porque la factura puede no
   tener pedido. */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('b2b_facturas', 'b2b_facturas', false, 10485760,
        array['application/pdf','image/jpeg','image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = 10485760,
      allowed_mime_types = array['application/pdf','image/jpeg','image/png'];

drop policy if exists "b2b_facturas: select" on storage.objects;
drop policy if exists "b2b_facturas: insert" on storage.objects;
drop policy if exists "b2b_facturas: update" on storage.objects;
drop policy if exists "b2b_facturas: delete" on storage.objects;

/* El cliente LEE lo suyo. Va contra b2b_fn_cliente_actual() y no contra
   is_active_user(): el comprador mayorista no tiene fila en profiles, asi
   que is_active_user() le daria false y no veria nunca su propia factura. */
create policy "b2b_facturas: select" on storage.objects
  for select to authenticated
  using (bucket_id = 'b2b_facturas'
         and (public.b2b_fn_staff()
              or (storage.foldername(name))[1] = public.b2b_fn_cliente_actual()::text));

/* Escribir es solo del equipo. Al reves que el comprobante de pago: aca el
   que sube es el que factura, no el que compra. */
create policy "b2b_facturas: insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'b2b_facturas' and public.b2b_fn_staff());

create policy "b2b_facturas: update" on storage.objects
  for update to authenticated
  using      (bucket_id = 'b2b_facturas' and public.b2b_fn_staff())
  with check (bucket_id = 'b2b_facturas' and public.b2b_fn_staff());

create policy "b2b_facturas: delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'b2b_facturas' and public.b2b_fn_staff());


/* ── 3. Subir una factura ────────────────────────────────────────────────
   El archivo ya esta en el bucket (la policy garantizo que lo subio alguien
   del equipo). Esta RPC lo registra, lo ata al cliente y le avisa por mail.
   Vuelve a validar el path: la policy asegura QUIEN subio, esta funcion
   asegura A QUE CARPETA, que es lo que despues deja leer al cliente. */
create or replace function public.b2b_rpc_admin_subir_factura(p_payload jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public','pg_temp' as $fn$
declare
  v_cli uuid; v_ped public.b2b_pedido%rowtype; v_id uuid;
  v_path text; v_mime text; v_size bigint; v_tipo text;
  v_numero text; v_fecha date; v_total numeric;
  v_tiene_pedido boolean := false;
  v_mails text; v_nombre_cli text; v_etiqueta text; v_datos jsonb;
  v_cons text;
begin
  perform public.b2b_fn_guard();
  if not public.b2b_fn_staff() then
    raise exception 'Sin permiso.' using errcode='42501';
  end if;

  v_cli := nullif(p_payload->>'cliente_id','')::uuid;
  if v_cli is null then
    raise exception 'Falta el cliente.' using errcode='22023';
  end if;
  if not exists (select 1 from public.customers_b2b c where c.id = v_cli) then
    raise exception 'No encontramos ese cliente.' using errcode='P0002';
  end if;

  /* El pedido es opcional, pero si viene tiene que ser DE ESTE cliente: si
     no, la factura de uno le aparece colgada del pedido de otro. */
  if nullif(p_payload->>'pedido_id','') is not null then
    select * into v_ped from public.b2b_pedido
     where id = (p_payload->>'pedido_id')::uuid;
    if not found then
      raise exception 'No encontramos ese pedido.' using errcode='P0002';
    end if;
    if v_ped.cliente_id <> v_cli then
      raise exception 'Ese pedido es de otro cliente.' using errcode='22023';
    end if;
    if v_ped.estado = 'borrador' then
      raise exception 'Ese pedido todavia es un borrador del cliente.' using errcode='0A000';
    end if;
    v_tiene_pedido := true;
  end if;

  v_path := nullif(trim(p_payload->>'path'), '');
  v_mime := nullif(trim(p_payload->>'mime'), '');
  v_size := nullif(p_payload->>'size_bytes','')::bigint;
  if v_path is null or v_mime is null or v_size is null then
    raise exception 'Falta el archivo.' using errcode='22023';
  end if;
  if v_mime not in ('application/pdf','image/jpeg','image/png') then
    raise exception 'Solo aceptamos PDF, JPG o PNG.' using errcode='22023';
  end if;
  if v_size > 10485760 then
    raise exception 'El archivo no puede pesar mas de 10 MB.' using errcode='22023';
  end if;
  /* Sin esto se podria registrar un archivo guardado en la carpeta de otro
     cliente, y la policy de lectura — que mira la carpeta, no la tabla — se
     lo mostraria al cliente equivocado. */
  if position(v_cli::text || '/' in v_path) <> 1 then
    raise exception 'El archivo no quedo guardado en la carpeta de ese cliente.'
      using errcode='22023';
  end if;

  v_tipo   := coalesce(nullif(trim(p_payload->>'tipo'),''), 'factura');
  if v_tipo not in ('factura','nota_credito','recibo','remito','otro') then
    raise exception 'Tipo de comprobante desconocido.' using errcode='22023';
  end if;
  v_numero := left(nullif(trim(p_payload->>'numero'),''), 40);
  v_fecha  := nullif(p_payload->>'fecha','')::date;
  v_total  := nullif(p_payload->>'total','')::numeric;

  begin
    insert into public.b2b_factura (cliente_id, pedido_id, tipo, numero, fecha, total,
                                    path, mime, size_bytes, nombre, nota, subida_por)
    values (v_cli,
            case when v_tiene_pedido then v_ped.id else null end,
            v_tipo, v_numero, v_fecha, v_total,
            v_path, v_mime, v_size,
            left(nullif(trim(p_payload->>'nombre'),''), 160),
            left(nullif(trim(p_payload->>'nota'),''), 300),
            auth.uid())
    returning id into v_id;
  exception when unique_violation then
    /* Hay dos indices unicos y chocan por motivos distintos, asi que hay que
       preguntar cual salto. Culpar siempre al numero mandaba a buscar un
       comprobante repetido que no existia -- y peor, con el numero vacio el
       mensaje salia "con el numero <NULL>", que no dice nada. */
    get stacked diagnostics v_cons = constraint_name;
    if v_cons = 'b2b_factura_path_key' then
      raise exception 'Ese archivo ya esta cargado.' using errcode='23505';
    end if;
    raise exception 'Ya cargaste un comprobante con el numero % para este cliente.',
                    coalesce(v_numero, 's/n')
      using errcode='23505';
  end;

  /* ── El aviso al cliente ──────────────────────────────────────────────
     Va a TODOS los usuarios aprobados de ese cliente, no solo al titular:
     el que compra y el que paga suelen ser dos personas distintas, y la
     factura la necesita el segundo.
     Todo el bloque va envuelto: si el mail falla, la factura ya quedo
     guardada y el cliente igual la ve entrando a su cuenta. Un aviso que no
     sale no puede voltear la carga de una factura. */
  begin
    select string_agg(distinct lower(trim(u.email)), ',')
      into v_mails
      from public.b2b_usuario u
     where u.cliente_id = v_cli
       and u.estado = 'aprobado'
       and position('@' in coalesce(u.email,'')) > 1;

    if v_mails is not null then
      select c.nombre into v_nombre_cli from public.customers_b2b c where c.id = v_cli;

      v_etiqueta := case v_tipo
                      when 'nota_credito' then 'nota de credito'
                      when 'recibo'       then 'recibo'
                      when 'remito'       then 'remito'
                      when 'otro'         then 'comprobante'
                      else                     'factura' end;

      v_datos := '[]'::jsonb;
      if v_numero is not null then
        v_datos := v_datos || jsonb_build_array(jsonb_build_object(
                     'k', 'Comprobante', 'v', v_numero));
      end if;
      if v_fecha is not null then
        v_datos := v_datos || jsonb_build_array(jsonb_build_object(
                     'k', 'Fecha', 'v', to_char(v_fecha, 'DD/MM/YYYY')));
      end if;
      if v_tiene_pedido then
        v_datos := v_datos || jsonb_build_array(jsonb_build_object(
                     'k', 'Pedido', 'v', coalesce(v_ped.numero, '-')));
      end if;
      if v_total is not null then
        v_datos := v_datos || jsonb_build_array(jsonb_build_object(
                     'k', 'Total', 'v', '$ ' || to_char(v_total, 'FM999G999G999D00'),
                     'fuerte', true, 'sep', true));
      end if;

      perform public.b2b_fn_mail_cliente(
        v_mails,
        'Tu ' || v_etiqueta || coalesce(' ' || v_numero, '') || ' ya esta disponible',
        'Te dejamos tu ' || v_etiqueta,
        'Ya esta disponible para descargar desde tu cuenta, en la seccion '
        || 'Facturas. Queda guardada ahi para cuando la necesites.',
        jsonb_build_object(
          'eyebrow', upper(v_etiqueta),
          'preheader', upper(left(v_etiqueta, 1)) || substr(v_etiqueta, 2)
                       || coalesce(' ' || v_numero, '')
                       || coalesce(' - ' || v_nombre_cli, ''),
          'cta', 'Ver mis facturas',
          'datos', v_datos));
    end if;
  exception when others then null;
  end;

  return jsonb_build_object('ok', true, 'factura_id', v_id);
end $fn$;


/* ── 4. Sacar una factura ────────────────────────────────────────────────
   Logico y solo del equipo. El cliente no puede borrar la suya: la factura
   es del que la emite, no del que la recibe. */
create or replace function public.b2b_rpc_admin_borrar_factura(p_payload jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public','pg_temp' as $fn$
declare v_n integer;
begin
  perform public.b2b_fn_guard();
  if not public.b2b_fn_staff() then
    raise exception 'Sin permiso.' using errcode='42501';
  end if;

  update public.b2b_factura
     set eliminado_at = now(), eliminado_por = auth.uid()
   where id = nullif(p_payload->>'factura_id','')::uuid
     and eliminado_at is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'No encontramos esa factura.' using errcode='P0002';
  end if;
  return jsonb_build_object('ok', true);
end $fn$;


/* ── 5. Lo que ve el equipo ──────────────────────────────────────────────
   Sin filtro trae todas. Con pedido_id trae las de ese pedido, con
   cliente_id las de ese cliente. Devuelve el path: la app arma la URL
   firmada con el cliente de storage, igual que con los comprobantes. */
create or replace function public.b2b_rpc_admin_facturas(p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer
set search_path to 'public','pg_temp' as $fn$
declare v_ped uuid; v_cli uuid;
begin
  perform public.b2b_fn_guard();
  if not public.b2b_fn_staff() then
    raise exception 'Sin permiso.' using errcode='42501';
  end if;
  v_ped := nullif(p_payload->>'pedido_id','')::uuid;
  v_cli := nullif(p_payload->>'cliente_id','')::uuid;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', f.id, 'cliente_id', f.cliente_id, 'pedido_id', f.pedido_id,
             'tipo', f.tipo, 'numero', f.numero, 'fecha', f.fecha, 'total', f.total,
             'path', f.path, 'mime', f.mime, 'size_bytes', f.size_bytes,
             'nombre', f.nombre, 'nota', f.nota, 'created_at', f.created_at,
             'cliente', c.nombre, 'pedido_numero', p.numero,
             'subio', coalesce(pr.name, pr.email))
           order by f.fecha desc nulls last, f.created_at desc)
      from public.b2b_factura f
      join public.customers_b2b c on c.id = f.cliente_id
      left join public.b2b_pedido p on p.id = f.pedido_id
      left join public.profiles  pr on pr.id = f.subida_por
     where f.eliminado_at is null
       and (v_ped is null or f.pedido_id  = v_ped)
       and (v_cli is null or f.cliente_id = v_cli)
  ), '[]'::jsonb);
end $fn$;


/* ── 6. El historial del cliente ─────────────────────────────────────────
   Todas sus facturas juntas, no pedido por pedido. Es para cuando el
   contador le pide "mandame todo lo del trimestre". */
create or replace function public.b2b_rpc_mis_facturas(p_payload jsonb default '{}'::jsonb)
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
             'id', f.id, 'pedido_id', f.pedido_id, 'pedido_numero', p.numero,
             'tipo', f.tipo, 'numero', f.numero, 'fecha', f.fecha, 'total', f.total,
             'path', f.path, 'mime', f.mime, 'size_bytes', f.size_bytes,
             'nombre', f.nombre, 'nota', f.nota, 'created_at', f.created_at)
           order by f.fecha desc nulls last, f.created_at desc)
      from public.b2b_factura f
      left join public.b2b_pedido p on p.id = f.pedido_id
     where f.cliente_id = v_cli and f.eliminado_at is null
  ), '[]'::jsonb);
end $fn$;


/* ── 7. Mis pedidos, ahora con la factura adentro ────────────────────────
   Mismo cuerpo que 0167 mas la clave 'facturas'. Se agrega aca y no con una
   RPC nueva para que la tarjeta del pedido pueda mostrar el boton de
   descarga sin una segunda vuelta al servidor. */
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


/* ── 8. El listado del equipo avisa si ya tiene factura ──────────────────
   Columna nueva AL FINAL: create or replace view acepta agregar, no
   reordenar ni sacar. La tabla del panel la usa para el chip de la fila y
   para el filtro "Sin factura cargada". */
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
       where f.pedido_id = bp.id and f.eliminado_at is null) as facturas
   from b2b_pedido bp
     join pedidos_mayoristas pm on pm.id = bp.pedido_mayorista_id
     join customers_b2b c on c.id = bp.cliente_id
     join b2b_usuario u on u.id = coalesce(bp.enviado_por, bp.creado_por);


/* ── 9. Permisos ─────────────────────────────────────────────────────────
   Postgres le da EXECUTE a PUBLIC por defecto y anon/authenticated heredan
   de ahi: revocar solo a anon/authenticated no alcanza, hay que sacarselo a
   PUBLIC. Las tres RPC de administracion validan b2b_fn_staff() adentro,
   pero el grant se le da igual solo a authenticated: defensa en capas. */
revoke all on function public.b2b_rpc_admin_subir_factura(jsonb)  from public, anon;
revoke all on function public.b2b_rpc_admin_borrar_factura(jsonb) from public, anon;
revoke all on function public.b2b_rpc_admin_facturas(jsonb)       from public, anon;
revoke all on function public.b2b_rpc_mis_facturas(jsonb)         from public, anon;

grant execute on function public.b2b_rpc_admin_subir_factura(jsonb)  to authenticated;
grant execute on function public.b2b_rpc_admin_borrar_factura(jsonb) to authenticated;
grant execute on function public.b2b_rpc_admin_facturas(jsonb)       to authenticated;
grant execute on function public.b2b_rpc_mis_facturas(jsonb)         to authenticated;

grant select on public.b2b_factura to authenticated;


/* ── 10. Que nada de lo de arriba haya tocado lo que cobra ───────────────
   Si alguna de estas cambio aunque sea en un comentario, esto aborta la
   transaccion entera y la base queda como estaba. */
do $chk$
declare v_mal text;
begin
  select string_agg(i.proname, ', ') into v_mal
    from _mig0169_intactas i
    join pg_proc p on p.proname = i.proname
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   where pg_get_functiondef(p.oid) <> i.def;
  if v_mal is not null then
    raise exception '0169 toco funciones que no debia: %', v_mal;
  end if;
  if (select count(*) from _mig0169_intactas) <> 6 then
    raise exception '0169: esperaba 6 funciones protegidas, encontre %',
      (select count(*) from _mig0169_intactas);
  end if;
  raise notice '0169: las funciones de pedidos, altas y facturacion quedaron intactas.';
end $chk$;

drop table if exists _mig0169_intactas;

commit;
