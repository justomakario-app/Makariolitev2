/* ══ 0167 · PRESUPUESTO, DATOS DE PAGO, COMPROBANTE Y MAIL ════════════════
   Los cuatro pedidos del cliente que tocan la base. El quinto (mostrar el
   precio neto y con IVA) ya estaba hecho y no se toca.

   1. DATOS PARA TRANSFERENCIA (punto 5 del cliente)
      company_settings gana banco / cbu / alias / titular / cuit de la cuenta
      / notas de pago, y b2b_rpc_mi_cuenta empieza a devolver un bloque
      'emisor' con eso. Va en mi_cuenta y no en una RPC nueva porque
      mi_cuenta ya se llama al arrancar la tienda: el PDF y la pantalla de
      "pedido enviado" tienen los datos sin una vuelta mas al servidor.
      OJO: 'emisor' solo sale con la cuenta aprobada, y NUNCA incluye
      company_settings.notas, que es la nota interna del equipo.

   2. AVISO POR MAIL DE PEDIDO NUEVO (punto 3)
      pg_net + una tabla privada app_mail_config con el proveedor y la clave.
      b2b_fn_avisar_interno gana un disparo de mail cuando el aviso es de
      tipo 'nuevo_pedido' (hoy lo manda solo b2b_rpc_enviar_pedido, asi que
      no hay que tocar ninguna RPC) o cuando quien llama pide p_mail => true.
      Falla en silencio: si no hay clave, no hay destinatarios o el proveedor
      esta apagado, el pedido se envia igual y la campanita interna suena
      igual. Un mail que no sale nunca puede voltear un pedido.

   3. COMPROBANTE DE PAGO (punto 4)
      Tabla b2b_comprobante (un pedido puede tener varios: senia y saldo) +
      bucket privado b2b_comprobantes. Las policies del bucket NO pueden usar
      is_active_user(): el comprador mayorista no tiene fila en profiles. Van
      contra b2b_fn_cliente_actual(), que es quien lo identifica.
      Layout del path: <cliente_id>/<pedido_id>/<uuid>.<ext>. La primera
      carpeta es el cliente justamente para que la policy la pueda comparar.
      Borrar es logico (eliminado_at), no fisico: un comprobante de pago que
      el equipo ya miro no puede desaparecer del registro.

   4. PRESUPUESTO PDF (punto 2)
      No necesita tabla nueva: se arma en el browser con lo que ya devuelven
      las RPC. Lo que faltaba eran tres datos que el pedido tenia guardados y
      no salian — direccion de entrega, notas y condicion de pago — mas el
      iva_pct por linea. Se agregan a b2b_rpc_mis_pedidos.
   ═══════════════════════════════════════════════════════════════════════ */

begin;

/* ── 1. Datos de la cuenta bancaria ──────────────────────────────────────
   Van en company_settings y no en una tabla nueva porque son lo mismo que
   la razon social y el CUIT: la identidad del que cobra. El PDF ya arma su
   encabezado con esa fila. */
alter table public.company_settings
  add column if not exists banco           text,
  add column if not exists cbu             text,
  add column if not exists alias_cbu       text,
  add column if not exists titular_cuenta  text,
  add column if not exists cuit_cuenta     text,
  add column if not exists notas_pago      text;

comment on column public.company_settings.banco          is 'Banco de la cuenta donde se cobran las transferencias. Lo ve el cliente mayorista.';
comment on column public.company_settings.cbu            is 'CBU/CVU de esa cuenta. Lo ve el cliente mayorista.';
comment on column public.company_settings.alias_cbu      is 'Alias del CBU. Lo ve el cliente mayorista.';
comment on column public.company_settings.titular_cuenta is 'Titular de la cuenta. Lo ve el cliente mayorista.';
comment on column public.company_settings.cuit_cuenta    is 'CUIT del titular de la cuenta, cuando no es el mismo de la razon social.';
comment on column public.company_settings.notas_pago     is 'Texto libre que se imprime abajo de los datos de transferencia. Lo ve el cliente.';

/* El MERGE de siempre: si la clave no viene en el payload, la columna no se
   toca. Se agregan las seis nuevas al bloque original. */
create or replace function public.rpc_admin_update_company_settings(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare
  v_role role_enum; v_active boolean; v_id uuid;
  v_row public.company_settings%rowtype;
begin
  select role, active into v_role, v_active from public.profiles where id = auth.uid();
  if v_role is null or v_active = false then
    raise exception 'Tu sesion expiro.' using errcode='42501', hint='auth'; end if;
  if v_role not in ('owner','admin') then
    raise exception 'Solo owner/admin.' using errcode='42501', hint='not_authorized'; end if;

  select id into v_id from public.company_settings limit 1;
  if v_id is null then
    raise exception 'Configuracion de empresa no inicializada'
      using errcode='22023', hint='not_initialized';
  end if;

  update public.company_settings set
    razon_social  = case when p_payload ? 'razon_social'
                         then coalesce(nullif(trim(p_payload->>'razon_social'),''), razon_social)
                         else razon_social end,
    cuit          = case when p_payload ? 'cuit'           then nullif(trim(p_payload->>'cuit'),'')           else cuit           end,
    domicilio     = case when p_payload ? 'domicilio'      then nullif(trim(p_payload->>'domicilio'),'')      else domicilio      end,
    ciudad        = case when p_payload ? 'ciudad'         then nullif(trim(p_payload->>'ciudad'),'')         else ciudad         end,
    provincia     = case when p_payload ? 'provincia'      then nullif(trim(p_payload->>'provincia'),'')      else provincia      end,
    codigo_postal = case when p_payload ? 'codigo_postal'  then nullif(trim(p_payload->>'codigo_postal'),'')  else codigo_postal  end,
    telefono      = case when p_payload ? 'telefono'       then nullif(trim(p_payload->>'telefono'),'')       else telefono       end,
    email         = case when p_payload ? 'email'          then nullif(trim(p_payload->>'email'),'')          else email          end,
    notas         = case when p_payload ? 'notas'          then nullif(trim(p_payload->>'notas'),'')          else notas          end,
    banco         = case when p_payload ? 'banco'          then nullif(trim(p_payload->>'banco'),'')          else banco          end,
    cbu           = case when p_payload ? 'cbu'            then nullif(trim(p_payload->>'cbu'),'')            else cbu            end,
    alias_cbu     = case when p_payload ? 'alias_cbu'      then nullif(trim(p_payload->>'alias_cbu'),'')      else alias_cbu      end,
    titular_cuenta= case when p_payload ? 'titular_cuenta' then nullif(trim(p_payload->>'titular_cuenta'),'') else titular_cuenta end,
    cuit_cuenta   = case when p_payload ? 'cuit_cuenta'    then nullif(trim(p_payload->>'cuit_cuenta'),'')    else cuit_cuenta    end,
    notas_pago    = case when p_payload ? 'notas_pago'     then nullif(trim(p_payload->>'notas_pago'),'')     else notas_pago     end,
    updated_by    = auth.uid()
  where id = v_id
  returning * into v_row;

  return to_jsonb(v_row);
end $fn$;

/* ── 2. Quien es "el equipo" ─────────────────────────────────────────────
   owner/admin/ventas, con la cuenta activa. Existia repetido adentro de
   cada RPC; las policies del bucket nuevo lo necesitan como expresion. */
create or replace function public.b2b_fn_staff()
returns boolean language sql stable security definer
set search_path to 'public','pg_temp' as $fn$
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and active = true and role in ('owner','admin','ventas')
  );
$fn$;

/* ── 3. Configuracion del mail ───────────────────────────────────────────
   Tabla de UNA fila, con RLS prendida y CERO policies: PostgREST no la puede
   leer ni con sesion de owner. La clave del proveedor solo entra y sale por
   las funciones security definer de mas abajo, y la de lectura NO devuelve
   la clave: devuelve si hay una cargada. Nadie tiene por que ver esa clave
   en la pestana de red del navegador. */
create table if not exists public.app_mail_config (
  id            uuid primary key default gen_random_uuid(),
  proveedor     text not null default 'resend'
                check (proveedor in ('resend','brevo')),
  api_key       text,
  from_email    text,
  from_nombre   text not null default 'Justo Makario Home',
  destinatarios text,
  base_url      text not null default 'https://justomakario.lat',
  activo        boolean not null default false,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id)
);
alter table public.app_mail_config enable row level security;
revoke all on public.app_mail_config from anon, authenticated;

comment on table  public.app_mail_config is
  'Una sola fila. Como se manda el aviso de pedido nuevo por mail. RLS prendida sin policies a proposito: solo la tocan funciones security definer.';
comment on column public.app_mail_config.destinatarios is
  'Mails separados por coma. Vacio = se usa company_settings.email.';

insert into public.app_mail_config (proveedor, activo)
select 'resend', false
 where not exists (select 1 from public.app_mail_config);

/* ── 4. El envio ─────────────────────────────────────────────────────────
   Devuelve cuantos destinatarios salieron (0 = no se mando nada). NUNCA
   levanta excepcion: la llama b2b_fn_avisar_interno, que a su vez la llama
   b2b_rpc_enviar_pedido adentro de la transaccion del pedido. Un problema de
   configuracion del mail no puede voltear un pedido que el cliente ya
   confirmo.

   net.http_post encola y vuelve: no espera la respuesta del proveedor. El
   resultado queda en net._http_response y se mira con rpc_admin_mail_estado. */
create or replace function public.b2b_fn_mail_out(
  p_asunto text, p_html text, p_destinatarios text default null
) returns integer language plpgsql security definer
set search_path to 'public','pg_temp' as $fn$
declare
  v_cfg   public.app_mail_config%rowtype;
  v_to    text;
  v_lista text[];
  v_from  text;
  v_body  jsonb;
  v_head  jsonb;
  v_url   text;
begin
  select * into v_cfg from public.app_mail_config limit 1;
  if not found or v_cfg.activo is not true
     or coalesce(trim(v_cfg.api_key), '') = '' then
    return 0;
  end if;

  v_to := coalesce(nullif(trim(coalesce(p_destinatarios, v_cfg.destinatarios)), ''),
                   (select nullif(trim(email), '') from public.company_settings limit 1));
  if v_to is null then return 0; end if;

  select array_agg(s.x) into v_lista
    from (select distinct trim(t) as x
            from unnest(string_to_array(v_to, ',')) t
           where trim(t) <> '' and position('@' in t) > 1) s;
  if v_lista is null or cardinality(v_lista) = 0 then return 0; end if;

  v_from := coalesce(nullif(trim(v_cfg.from_email), ''), 'onboarding@resend.dev');

  if v_cfg.proveedor = 'brevo' then
    v_url  := 'https://api.brevo.com/v3/smtp/email';
    v_head := jsonb_build_object('Content-Type','application/json','api-key', v_cfg.api_key);
    v_body := jsonb_build_object(
                'sender', jsonb_build_object('name', v_cfg.from_nombre, 'email', v_from),
                'to', (select jsonb_agg(jsonb_build_object('email', e)) from unnest(v_lista) e),
                'subject', left(p_asunto, 200),
                'htmlContent', p_html);
  else
    v_url  := 'https://api.resend.com/emails';
    v_head := jsonb_build_object('Content-Type','application/json',
                                 'Authorization', 'Bearer ' || v_cfg.api_key);
    v_body := jsonb_build_object(
                'from', v_cfg.from_nombre || ' <' || v_from || '>',
                'to', to_jsonb(v_lista),
                'subject', left(p_asunto, 200),
                'html', p_html);
  end if;

  perform net.http_post(url := v_url, body := v_body, headers := v_head,
                        timeout_milliseconds := 8000);
  return cardinality(v_lista);
exception when others then
  -- Se traga cualquier cosa (pg_net caido, URL mal, lo que sea) a proposito.
  return 0;
end $fn$;

/* Envoltorio de presentacion: el cuerpo HTML del aviso. Se arma aca y no en
   cada RPC para que todos los mails del sistema se vean igual. */
create or replace function public.b2b_fn_mail_html(
  p_titulo text, p_mensaje text, p_link text default null
) returns text language sql immutable
set search_path to 'public','pg_temp' as $fn$
  select
    '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;'
    || 'background:#f6f6f6;padding:28px 12px">'
    || '<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;'
    || 'border:1px solid #e9e9e9;overflow:hidden">'
    || '<div style="padding:20px 26px;border-bottom:1px solid #f0f0f0">'
    || '<span style="font-size:13px;letter-spacing:.16em;font-weight:800;color:#0A0A0A">JUSTO MAKARIO</span>'
    || '<span style="font-size:13px;letter-spacing:.16em;color:#888888"> HOME</span></div>'
    || '<div style="padding:26px">'
    || '<h1 style="margin:0 0 12px;font-size:18px;line-height:1.35;color:#0A0A0A">'
    || replace(coalesce(p_titulo,''), '<', '&lt;') || '</h1>'
    || '<p style="margin:0 0 18px;font-size:14px;line-height:1.65;color:#3A3A3A">'
    || replace(coalesce(p_mensaje,''), '<', '&lt;') || '</p>'
    || case when coalesce(trim(p_link), '') = '' then '' else
         '<a href="' || p_link || '" style="display:inline-block;background:#0A0A0A;color:#ffffff;'
         || 'text-decoration:none;padding:11px 20px;border-radius:8px;font-size:14px;'
         || 'font-weight:700">Abrir en el sistema</a>' end
    || '</div>'
    || '<div style="padding:16px 26px;background:#fafafa;border-top:1px solid #f0f0f0;'
    || 'font-size:12px;color:#888888">Aviso automatico del sistema interno. No hace falta responder.</div>'
    || '</div></div>';
$fn$;

/* ── 5. La campanita, ahora tambien por mail ─────────────────────────────
   Mismo cuerpo de siempre (0151) mas el disparo del mail. Se dispara cuando
   el aviso es de tipo 'nuevo_pedido' — que hoy solo emite
   b2b_rpc_enviar_pedido, o sea exactamente lo que pidio el cliente — o
   cuando quien llama lo pide explicito con p_mail => true.
   El parametro nuevo va al final y con default, asi las cuatro llamadas que
   ya existen siguen andando sin tocarlas. Pero OJO: agregar un parametro
   cambia la firma, o sea que un create or replace NO reemplaza, crea una
   segunda funcion. Con las dos vivas, una llamada de 5 argumentos elige la
   vieja por coincidencia exacta y el mail no sale nunca. Hay que borrar la
   vieja a mano. */
drop function if exists public.b2b_fn_avisar_interno(
  notif_type_enum, text, text, text, role_enum[]);

create or replace function public.b2b_fn_avisar_interno(
  p_tipo notif_type_enum, p_titulo text, p_mensaje text, p_link text,
  p_roles role_enum[], p_mail boolean default false
) returns integer language plpgsql security definer
set search_path to 'public','pg_temp' as $fn$
declare v_n integer; v_base text;
begin
  insert into public.notifications (user_id, tipo, titulo, mensaje, link)
  select pr.id, p_tipo, left(p_titulo, 200), left(p_mensaje, 1000), p_link
    from public.profiles pr
   where pr.active = true and pr.role = any (p_roles);
  get diagnostics v_n = row_count;

  if p_mail or p_tipo = 'nuevo_pedido' then
    select coalesce(nullif(trim(base_url), ''), '') into v_base
      from public.app_mail_config limit 1;
    perform public.b2b_fn_mail_out(
      left(p_titulo, 200),
      public.b2b_fn_mail_html(p_titulo, p_mensaje,
        case when coalesce(p_link,'') = '' or coalesce(v_base,'') = ''
             then null else v_base || p_link end));
  end if;

  return v_n;
end $fn$;

/* ── 6. Administrar el mail desde el panel ───────────────────────────────
   get NO devuelve la clave. Devuelve si hay una guardada. */
create or replace function public.rpc_admin_get_mail_config()
returns jsonb language plpgsql security definer
set search_path to 'public','pg_temp' as $fn$
declare v_cfg public.app_mail_config%rowtype;
begin
  if not public.is_owner_or_admin() then
    raise exception 'Solo owner/admin.' using errcode='42501'; end if;
  select * into v_cfg from public.app_mail_config limit 1;
  if not found then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object(
    'ok', true,
    'proveedor', v_cfg.proveedor,
    'from_email', v_cfg.from_email,
    'from_nombre', v_cfg.from_nombre,
    'destinatarios', v_cfg.destinatarios,
    'base_url', v_cfg.base_url,
    'activo', v_cfg.activo,
    'tiene_key', coalesce(trim(v_cfg.api_key), '') <> '',
    'updated_at', v_cfg.updated_at);
end $fn$;

/* set: mandar api_key vacia NO borra la guardada (mismo criterio que los
   datos de entrega del carrito). Para sacarla se manda api_key: null. */
create or replace function public.rpc_admin_set_mail_config(p_payload jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public','pg_temp' as $fn$
declare v_id uuid;
begin
  if not public.is_owner_or_admin() then
    raise exception 'Solo owner/admin.' using errcode='42501'; end if;

  select id into v_id from public.app_mail_config limit 1;
  if v_id is null then
    insert into public.app_mail_config (proveedor) values ('resend') returning id into v_id;
  end if;

  update public.app_mail_config set
    proveedor     = case when p_payload ? 'proveedor'
                         then coalesce(nullif(trim(p_payload->>'proveedor'),''), proveedor) else proveedor end,
    api_key       = case when p_payload ? 'api_key'
                         then case when jsonb_typeof(p_payload->'api_key') = 'null' then null
                                   else coalesce(nullif(trim(p_payload->>'api_key'),''), api_key) end
                         else api_key end,
    from_email    = case when p_payload ? 'from_email'    then nullif(trim(p_payload->>'from_email'),'')    else from_email    end,
    from_nombre   = case when p_payload ? 'from_nombre'
                         then coalesce(nullif(trim(p_payload->>'from_nombre'),''), from_nombre) else from_nombre end,
    destinatarios = case when p_payload ? 'destinatarios' then nullif(trim(p_payload->>'destinatarios'),'') else destinatarios end,
    base_url      = case when p_payload ? 'base_url'
                         then coalesce(nullif(trim(p_payload->>'base_url'),''), base_url) else base_url end,
    activo        = case when p_payload ? 'activo'        then (p_payload->>'activo')::boolean             else activo        end,
    updated_at    = now(),
    updated_by    = auth.uid()
  where id = v_id;

  return public.rpc_admin_get_mail_config();
end $fn$;

/* Prueba: manda un mail de verdad con un texto de ejemplo. Devuelve a cuantos
   salio; 0 significa "no se mando" y la pantalla lo explica. */
create or replace function public.rpc_admin_probar_mail(p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public','pg_temp' as $fn$
declare v_n integer; v_to text;
begin
  if not public.is_owner_or_admin() then
    raise exception 'Solo owner/admin.' using errcode='42501'; end if;
  v_to := nullif(trim(p_payload->>'destinatarios'), '');
  v_n := public.b2b_fn_mail_out(
    'Prueba de avisos - Justo Makario Home',
    public.b2b_fn_mail_html(
      'El aviso por mail quedo andando',
      'Si estas leyendo esto, cuando entre un pedido nuevo de la tienda mayorista te va a llegar un mail como este.',
      null),
    v_to);
  return jsonb_build_object('ok', v_n > 0, 'enviados', v_n);
end $fn$;

/* Ultimos intentos, para poder decir "el proveedor lo rechazo" en vez de
   "no llego". Lee net._http_response, que es donde pg_net deja el resultado. */
create or replace function public.rpc_admin_mail_estado(p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public','pg_temp','net' as $fn$
declare v jsonb;
begin
  if not public.is_owner_or_admin() then
    raise exception 'Solo owner/admin.' using errcode='42501'; end if;
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', r.id, 'status', r.status_code, 'error', r.error_msg,
             'cuando', r.created, 'respuesta', left(coalesce(r.content, ''), 300))
             order by r.created desc), '[]'::jsonb)
      into v
      from (select * from net._http_response order by created desc limit 10) r;
  exception when others then
    v := '[]'::jsonb;
  end;
  return jsonb_build_object('ok', true, 'intentos', v);
end $fn$;

/* ── 7. Comprobantes de pago ─────────────────────────────────────────────
   Un pedido puede tener varios: seniaron con una transferencia y pagaron el
   saldo con otra. Por eso es tabla y no una columna en b2b_pedido. */
create table if not exists public.b2b_comprobante (
  id            uuid primary key default gen_random_uuid(),
  pedido_id     uuid not null references public.b2b_pedido(id) on delete cascade,
  cliente_id    uuid not null references public.customers_b2b(id),
  path          text not null unique,
  mime          text not null check (mime in ('image/jpeg','image/png','application/pdf')),
  size_bytes    bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  nombre        text,
  monto         numeric(14,2) check (monto is null or monto >= 0),
  nota          text check (nota is null or length(nota) <= 300),
  subido_por    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  eliminado_at  timestamptz,
  eliminado_por uuid references auth.users(id)
);
create index if not exists ix_b2b_comprobante_pedido  on public.b2b_comprobante (pedido_id);
create index if not exists ix_b2b_comprobante_cliente on public.b2b_comprobante (cliente_id, created_at desc);

comment on table public.b2b_comprobante is
  'Comprobantes de transferencia que sube el mayorista desde la tienda. Borrado logico (eliminado_at): un pago que el equipo ya miro no puede desaparecer del registro.';

alter table public.b2b_comprobante enable row level security;

drop policy if exists b2b_comprobante_sel on public.b2b_comprobante;
create policy b2b_comprobante_sel on public.b2b_comprobante
  for select to authenticated
  using (public.b2b_fn_staff() or cliente_id = public.b2b_fn_cliente_actual());
-- Escribir es SOLO por las RPC de mas abajo. Sin policy de insert/update/delete.

/* ── 8. El bucket ────────────────────────────────────────────────────────
   Privado: son comprobantes de pago. Se miran con signed URL.
   Las policies van contra b2b_fn_cliente_actual() y no contra
   is_active_user(): el comprador mayorista no tiene fila en profiles, asi
   que is_active_user() le da false y no podria subir nada. */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('b2b_comprobantes', 'b2b_comprobantes', false, 10485760,
        array['image/jpeg','image/png','application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg','image/png','application/pdf'];

drop policy if exists "b2b_comprobantes: select" on storage.objects;
drop policy if exists "b2b_comprobantes: insert" on storage.objects;
drop policy if exists "b2b_comprobantes: update" on storage.objects;
drop policy if exists "b2b_comprobantes: delete" on storage.objects;

create policy "b2b_comprobantes: select" on storage.objects
  for select to authenticated
  using (bucket_id = 'b2b_comprobantes'
         and (public.b2b_fn_staff()
              or (storage.foldername(name))[1] = public.b2b_fn_cliente_actual()::text));

create policy "b2b_comprobantes: insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'b2b_comprobantes'
              and public.b2b_fn_cliente_actual() is not null
              and (storage.foldername(name))[1] = public.b2b_fn_cliente_actual()::text);

create policy "b2b_comprobantes: update" on storage.objects
  for update to authenticated
  using (bucket_id = 'b2b_comprobantes'
         and (storage.foldername(name))[1] = public.b2b_fn_cliente_actual()::text)
  with check (bucket_id = 'b2b_comprobantes'
              and (storage.foldername(name))[1] = public.b2b_fn_cliente_actual()::text);

/* Borrar el archivo lo puede hacer el equipo. El cliente NO: cuando saca un
   comprobante de la pantalla se marca eliminado_at y el archivo queda. */
create policy "b2b_comprobantes: delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'b2b_comprobantes' and public.b2b_fn_staff());

/* ── 9. Adjuntar ─────────────────────────────────────────────────────────
   El archivo ya se subio al bucket (la policy de insert garantizo que fue a
   la carpeta del cliente). Esta RPC lo registra contra el pedido y avisa.
   Vuelve a validar el path: la policy asegura la primera carpeta, esta
   funcion asegura que la segunda sea el pedido que dice ser. */
create or replace function public.b2b_rpc_adjuntar_comprobante(p_payload jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public','pg_temp' as $fn$
declare
  v_cli uuid; v_ped public.b2b_pedido%rowtype; v_id uuid;
  v_path text; v_mime text; v_size bigint; v_esperado text;
  v_cliente_nombre text; v_comprador text; v_monto numeric;
begin
  perform public.b2b_fn_guard();
  v_cli := public.b2b_fn_cliente_actual();
  if v_cli is null then
    raise exception 'Tu cuenta todavia no esta habilitada.' using errcode='42501';
  end if;

  select * into v_ped from public.b2b_pedido
   where id = nullif(p_payload->>'pedido_id','')::uuid and cliente_id = v_cli;
  if not found then
    raise exception 'No encontramos ese pedido.' using errcode='P0002';
  end if;
  if v_ped.estado in ('borrador','anulado') then
    raise exception 'Solo se puede adjuntar un comprobante a un pedido enviado.'
      using errcode='0A000';
  end if;

  v_path := nullif(trim(p_payload->>'path'), '');
  v_mime := nullif(trim(p_payload->>'mime'), '');
  v_size := nullif(p_payload->>'size_bytes','')::bigint;
  if v_path is null or v_mime is null or v_size is null then
    raise exception 'Falta el archivo.' using errcode='22023';
  end if;
  if v_mime not in ('image/jpeg','image/png','application/pdf') then
    raise exception 'Solo aceptamos JPG, PNG o PDF.' using errcode='22023';
  end if;
  if v_size > 10485760 then
    raise exception 'El archivo no puede pesar mas de 10 MB.' using errcode='22023';
  end if;

  v_esperado := v_cli::text || '/' || v_ped.id::text || '/';
  if position(v_esperado in v_path) <> 1 then
    raise exception 'El archivo no corresponde a este pedido.' using errcode='22023';
  end if;

  v_monto := nullif(p_payload->>'monto','')::numeric;

  insert into public.b2b_comprobante (pedido_id, cliente_id, path, mime, size_bytes,
                                      nombre, monto, nota, subido_por)
  values (v_ped.id, v_cli, v_path, v_mime, v_size,
          left(nullif(trim(p_payload->>'nombre'),''), 160),
          v_monto,
          left(nullif(trim(p_payload->>'nota'),''), 300),
          auth.uid())
  returning id into v_id;

  select c.nombre into v_cliente_nombre from public.customers_b2b c where c.id = v_cli;
  select u.nombre into v_comprador from public.b2b_usuario u where u.id = auth.uid();

  perform public.b2b_fn_avisar_interno(
    'sistema',
    'Comprobante de pago: ' || coalesce(v_cliente_nombre, 'cliente'),
    coalesce(v_comprador, 'El cliente') || ' adjunto un comprobante al pedido ' ||
    coalesce(v_ped.numero_mayorista, v_ped.numero, '') ||
    case when v_monto is not null
         then ' por $' || to_char(v_monto, 'FM999G999G999D00') else '' end ||
    '. Se ve en Ventas > Mayoristas, en el detalle del pedido.',
    case when v_ped.numero_mayorista is null then null
         else '/ventas?tab=mayoristas&pedido=' || v_ped.numero_mayorista end,
    array['owner','admin','ventas']::role_enum[],
    true);

  return jsonb_build_object('ok', true, 'comprobante_id', v_id);
end $fn$;

/* Sacarlo de la pantalla. Borrado logico y solo el propio: el equipo lo
   sigue viendo en la base si tiene que auditar un pago. */
create or replace function public.b2b_rpc_borrar_comprobante(p_payload jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public','pg_temp' as $fn$
declare v_cli uuid; v_n integer;
begin
  perform public.b2b_fn_guard();
  v_cli := public.b2b_fn_cliente_actual();
  if v_cli is null then
    raise exception 'Tu cuenta todavia no esta habilitada.' using errcode='42501';
  end if;

  update public.b2b_comprobante
     set eliminado_at = now(), eliminado_por = auth.uid()
   where id = nullif(p_payload->>'comprobante_id','')::uuid
     and cliente_id = v_cli
     and eliminado_at is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'No encontramos ese comprobante.' using errcode='P0002';
  end if;
  return jsonb_build_object('ok', true);
end $fn$;

/* Lo que ve el equipo. Devuelve el path: la app arma la signed URL con el
   cliente de storage, igual que hace con admin_receipts. */
create or replace function public.b2b_rpc_admin_comprobantes(p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer
set search_path to 'public','pg_temp' as $fn$
declare v_ped uuid;
begin
  perform public.b2b_fn_guard();
  if not public.b2b_fn_staff() then
    raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_ped := nullif(p_payload->>'pedido_id','')::uuid;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', k.id, 'pedido_id', k.pedido_id, 'path', k.path, 'mime', k.mime,
             'size_bytes', k.size_bytes, 'nombre', k.nombre, 'monto', k.monto,
             'nota', k.nota, 'created_at', k.created_at,
             'cliente', c.nombre, 'subio', u.nombre)
           order by k.created_at desc)
      from public.b2b_comprobante k
      join public.customers_b2b c on c.id = k.cliente_id
      left join public.b2b_usuario u on u.id = k.subido_por
     where k.eliminado_at is null
       and (v_ped is null or k.pedido_id = v_ped)
  ), '[]'::jsonb);
end $fn$;

/* ── 10. Mi cuenta, con los datos del que cobra ──────────────────────────
   Mismo cuerpo que 0162 mas el bloque 'emisor'. Sale solo con la cuenta
   aprobada, y sin company_settings.notas, que es interna. */
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
             'minimo_pedido',   (select ca.minimo_pedido   from public.b2b_canal ca where ca.codigo = v_canal),
             'minimo_unidades', (select ca.minimo_unidades from public.b2b_canal ca where ca.codigo = v_canal),
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
end $fn$;

/* ── 11. Mis pedidos, con lo que necesita el presupuesto ─────────────────
   Se agregan cuatro cosas que el pedido ya tenia guardadas y no salian:
   direccion de entrega, notas, condicion de pago y el iva_pct de cada
   linea. Mas los comprobantes ya adjuntados, para que el boton diga
   "Agregar otro" cuando ya hay uno. */
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
                      where k.pedido_id = p.id and k.eliminado_at is null))
           order by p.created_at desc)
      from public.b2b_pedido p
     where p.cliente_id = v_cli and p.estado <> 'borrador'
  ), '[]'::jsonb);
end $fn$;

/* ── 12. El listado del equipo avisa si hay comprobante ──────────────────
   Columnas nuevas al final: create or replace view acepta agregar, no
   reordenar ni sacar. La tabla del panel las usa para el clip y para armar
   el PDF de produccion sin pedir el detalle de nuevo. */
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
    c.cuit as cliente_cuit
   from b2b_pedido bp
     join pedidos_mayoristas pm on pm.id = bp.pedido_mayorista_id
     join customers_b2b c on c.id = bp.cliente_id
     join b2b_usuario u on u.id = coalesce(bp.enviado_por, bp.creado_por);

/* ── 13. Permisos ─────────────────────────────────────────────────────────
   Postgres le da EXECUTE a PUBLIC por defecto, y anon/authenticated heredan
   de ahi. O sea que un 'revoke ... from anon, authenticated' NO alcanza: hay
   que sacarselo a PUBLIC. Sin esto, b2b_fn_mail_out queda colgando en
   /rest/v1/rpc/b2b_fn_mail_out y cualquiera con sesion (o sin sesion) manda
   mails con el remitente de la empresa al destinatario que quiera. */
revoke all on function public.b2b_fn_mail_out(text, text, text)  from public, anon, authenticated;
revoke all on function public.b2b_fn_mail_html(text, text, text) from public, anon, authenticated;
revoke all on function public.b2b_fn_avisar_interno(
  notif_type_enum, text, text, text, role_enum[], boolean)       from public, anon, authenticated;
-- Las tres se llaman solo desde otras funciones security definer, que corren
-- como el dueno: sacarles el permiso al rol web no las rompe.

revoke all on function public.b2b_fn_staff()                      from public, anon;
revoke all on function public.b2b_rpc_adjuntar_comprobante(jsonb) from public, anon;
revoke all on function public.b2b_rpc_borrar_comprobante(jsonb)   from public, anon;
revoke all on function public.b2b_rpc_admin_comprobantes(jsonb)   from public, anon;
revoke all on function public.rpc_admin_get_mail_config()         from public, anon;
revoke all on function public.rpc_admin_set_mail_config(jsonb)    from public, anon;
revoke all on function public.rpc_admin_probar_mail(jsonb)        from public, anon;
revoke all on function public.rpc_admin_mail_estado(jsonb)        from public, anon;

grant execute on function public.b2b_fn_staff()                      to authenticated;
grant execute on function public.b2b_rpc_adjuntar_comprobante(jsonb) to authenticated;
grant execute on function public.b2b_rpc_borrar_comprobante(jsonb)   to authenticated;
grant execute on function public.b2b_rpc_admin_comprobantes(jsonb)   to authenticated;
grant execute on function public.rpc_admin_get_mail_config()         to authenticated;
grant execute on function public.rpc_admin_set_mail_config(jsonb)    to authenticated;
grant execute on function public.rpc_admin_probar_mail(jsonb)        to authenticated;
grant execute on function public.rpc_admin_mail_estado(jsonb)        to authenticated;
grant select on public.b2b_comprobante to authenticated;

commit;
