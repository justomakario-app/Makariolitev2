/* ══════════════════════════════════════════════════════════════════════════
   0168 — Mails lindos, y que tambien le lleguen AL CLIENTE

   0167 dejo el mail andando (Resend contesta 200), pero con dos limitaciones:
   el HTML era un <div> suelto con un titulo y un parrafo, y el unico aviso
   que salia era hacia adentro. Este archivo arregla las dos cosas.

   ── Que manda ahora ──
     1. Cuenta nueva      → al cliente: "tu cuenta ya esta lista"
                          → adentro:    "se registro fulano de tal empresa"
     2. Pedido nuevo      → al cliente: "recibimos tu pedido"
                          → adentro:    "entro un pedido" con la ficha entera
     3. Cambio de estado  → al cliente: confirmado / en produccion / listo /
                            despachado / facturado / anulado
   Lo de adentro sigue llegando siempre. Lo del cliente se puede apagar desde
   Administracion -> Avisos con "Avisarle tambien al cliente".

   ── Por que triggers y no tocar las RPC ──
   Lo obvio seria meter el mail adentro de b2b_rpc_enviar_pedido,
   b2b_rpc_alta_publica y b2b_rpc_canjear_invitacion. Son tres funciones
   grandes (7 KB la del pedido) y reescribirlas para agregar diez lineas
   significa volver a tipear el resto, donde un error no se nota al aplicar la
   migracion: se nota cuando un cliente no puede comprar.

   Los datos que hacen falta ya estan todos en las filas. b2b_pedido guarda
   numero, numero_mayorista, canal, totales, entrega y notas; b2b_usuario
   guarda mail, nombre y estado. Asi que los mails salen de dos triggers y
   NINGUNA de esas tres funciones se toca. El bloque del final lo verifica.

   De yapa, un trigger cubre caminos que la RPC no: si el estado se corrige a
   mano desde el panel, o desde otra RPC, el cliente igual se entera.

   ── La trampa de siempre ──
   Agregar un parametro NO reemplaza la funcion, crea una segunda. Con las dos
   vivas la llamada elige la vieja por coincidencia exacta y el cambio no se
   aplica nunca, en silencio. Por eso hay `drop function` explicitos.
   ══════════════════════════════════════════════════════════════════════════ */

/* Copia de las funciones que NO se tienen que tocar, para comparar al final.
   Temporal a proposito: es material de esta corrida. */
create temp table _mig0168_intactas as
  select p.proname, pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('b2b_rpc_enviar_pedido','b2b_rpc_alta_publica',
                       'b2b_rpc_canjear_invitacion','b2b_fn_sync_estado');


/* ── 1. El interruptor para los mails al cliente ─────────────────────────
   Aparte del `activo` general. Si el dueño quiere avisos internos pero
   todavia no quiere escribirle a los clientes, apaga solo este. */
alter table public.app_mail_config
  add column if not exists avisar_cliente boolean not null default true;

comment on column public.app_mail_config.avisar_cliente is
  'Si esta en false, los mails salen solo hacia adentro. El cliente no recibe nada.';


/* ── 2. Escapado ─────────────────────────────────────────────────────────
   El de 0167 escapaba solo '<'. Un cliente que se llame "Perez & Hijos"
   rompia el HTML y una comilla en una nota se metia adentro de un atributo.
   El & va PRIMERO: al reves se re-escapan los & que uno mismo acaba de
   generar y en el mail se lee "&amp;lt;". */
create or replace function public.b2b_fn_html_esc(p text)
returns text language sql immutable
set search_path to 'public','pg_temp' as $fn$
  select replace(replace(replace(replace(coalesce(p, ''),
    '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;');
$fn$;

comment on function public.b2b_fn_html_esc(text) is
  'Escapa texto para meterlo en el HTML de un mail. El & va primero.';


/* ── 3. El mail ──────────────────────────────────────────────────────────
   Ahora es un documento HTML completo y no un fragmento. Recien con <head>
   se puede:
     · declarar color-scheme, si no Gmail y Apple Mail en modo oscuro
       invierten los colores y el negro de la marca sale gris sucio;
     · poner el viewport del telefono;
     · usar media queries, que es lo unico que se salva del <style> cuando
       Gmail lo poda.
   Todo lo demas va en tablas y estilos inline porque Outlook no entiende
   flex ni grid.

   El preheader es la linea que Gmail muestra en la bandeja al lado del
   asunto. Sin preheader ahi aparece el primer texto del cuerpo, que seria
   "JUSTO MAKARIO HOME". Con preheader, el pedido se entiende SIN abrir el
   mail.

   Firma nueva: se suma p_extra jsonb. Es UN parametro y no cinco a proposito,
   para no volver a pasar por el baile del drop cada vez que haga falta un
   dato mas.

     { "eyebrow":   texto chico de arriba de todo,
       "cta":       texto del boton,
       "preheader": lo que se ve en la bandeja de entrada,
       "pie":       el texto del pie (adentro dice una cosa, al cliente otra),
       "datos":     [ {"k":"Cliente","v":"...",             }
                      {"k":"Neto",   "v":"...","sep":true   }  linea divisoria
                      {"k":"Total",  "v":"...","fuerte":true} ] destacado }

   Todo opcional: sin p_extra sale el mail simple, y las llamadas de tres
   argumentos que ya existen siguen andando igual. */
drop function if exists public.b2b_fn_mail_html(text, text, text);

create or replace function public.b2b_fn_mail_html(
  p_titulo text, p_mensaje text, p_link text default null,
  p_extra jsonb default null
) returns text language sql immutable
set search_path to 'public','pg_temp' as $fn$
with x as (
  select coalesce(p_extra, '{}'::jsonb) as e
), v as (
  select
    public.b2b_fn_html_esc(coalesce(nullif(trim(e->>'eyebrow'), ''), 'Aviso del sistema')) as eyebrow,
    public.b2b_fn_html_esc(coalesce(nullif(trim(e->>'cta'), ''), 'Abrir en el sistema'))   as cta,
    public.b2b_fn_html_esc(left(coalesce(nullif(trim(e->>'preheader'), ''),
                                         coalesce(p_mensaje, '')), 160))                   as pre,
    public.b2b_fn_html_esc(coalesce(nullif(trim(e->>'pie'), ''),
      'Aviso automatico del sistema interno de Justo Makario Home. '
      'No hace falta responder este mail.'))                                               as pie,
    public.b2b_fn_html_esc(coalesce(p_titulo, ''))                                         as titulo,
    replace(public.b2b_fn_html_esc(coalesce(p_mensaje, '')), chr(10), '<br>')              as mensaje,
    public.b2b_fn_html_esc(coalesce(p_link, ''))                                           as link,
    coalesce(e->'datos', '[]'::jsonb)                                                      as datos
  from x
), filas as (
  select coalesce(string_agg(
    '<tr><td class="kv-k" style="'
      || case when t.ord = 1 then ''
              when coalesce((t.d->>'fuerte')::boolean, false)
                or coalesce((t.d->>'sep')::boolean, false)
              then 'border-top:1px solid #E4E0DA;'
              else 'border-top:1px solid #F1EEEA;' end
      || case when coalesce((t.d->>'fuerte')::boolean, false)
              then 'padding:15px 14px 14px 0;font-size:12px;color:#0A0A0A;'
              else 'padding:11px 14px 11px 0;font-size:11px;color:#A29C95;' end
      || 'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;'
      || 'font-weight:600;letter-spacing:.09em;text-transform:uppercase;vertical-align:top;">'
      || public.b2b_fn_html_esc(t.d->>'k')
    || '</td><td class="kv-v" align="right" style="'
      || case when t.ord = 1 then ''
              when coalesce((t.d->>'fuerte')::boolean, false)
                or coalesce((t.d->>'sep')::boolean, false)
              then 'border-top:1px solid #E4E0DA;'
              else 'border-top:1px solid #F1EEEA;' end
      || case when coalesce((t.d->>'fuerte')::boolean, false)
              then 'padding:15px 0 14px;font-size:19px;font-weight:800;color:#0A0A0A;'
              else 'padding:11px 0;font-size:14px;font-weight:600;color:#1A1A1A;' end
      || 'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;'
      || 'text-align:right;vertical-align:top;">'
      || public.b2b_fn_html_esc(t.d->>'v')
    || '</td></tr>', '' order by t.ord), '') as html
  from v, lateral jsonb_array_elements(v.datos) with ordinality as t(d, ord)
)
select
   '<!doctype html><html lang="es"><head>'
|| '<meta charset="utf-8">'
|| '<meta name="viewport" content="width=device-width,initial-scale=1">'
|| '<meta name="x-apple-disable-message-reformatting">'
|| '<meta name="color-scheme" content="light">'
|| '<meta name="supported-color-schemes" content="light">'
|| '<title>' || v.titulo || '</title>'
|| '<style>'
|| '@media only screen and (max-width:620px){'
|| '.sp{padding-left:24px!important;padding-right:24px!important}'
|| '.h1{font-size:21px!important}'
|| '.kv td{display:block!important;width:auto!important}'
|| '.kv .kv-k{padding-bottom:0!important;border-top:0!important}'
|| '.kv .kv-v{text-align:left!important;border-top:0!important;'
|| 'padding-top:2px!important;padding-bottom:12px!important}'
|| '}'
|| '</style></head>'
|| '<body style="margin:0;padding:0;background-color:#F0EFED;-webkit-font-smoothing:antialiased;">'

   /* La bandeja de entrada. El relleno de caracteres invisibles evita que
      Gmail siga leyendo el cuerpo y pegue "JUSTO MAKARIO" atras del resumen. */
|| '<div style="display:none;font-size:1px;color:#F0EFED;line-height:1px;max-height:0;'
|| 'max-width:0;opacity:0;overflow:hidden;mso-hide:all;">' || v.pre
|| repeat('&#8199;&#65279;', 30) || '</div>'

|| '<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" '
|| 'style="background-color:#F0EFED;"><tr><td align="center" style="padding:38px 12px 46px;">'
   /* 600px fijos rompen el telefono: el media query apila las filas pero la
      tabla sigue midiendo 600 y el mail se sale de la pantalla. Va fluida con
      un techo de 600. Outlook no entiende max-width y la estiraria hasta el
      borde de la ventana, asi que ahi adentro lo sostiene la tabla fantasma
      del comentario condicional, que el resto de los clientes ni ven. */
|| '<!--[if mso]><table role="presentation" border="0" cellpadding="0" '
|| 'cellspacing="0" width="600"><tr><td><![endif]-->'
|| '<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" '
|| 'style="width:100%;max-width:600px;">'

   /* Marca, afuera de la tarjeta */
|| '<tr><td align="center" style="padding:0 0 24px;">'
|| '<span style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;'
|| 'font-size:12px;font-weight:800;letter-spacing:.24em;color:#0A0A0A;">JUSTO MAKARIO</span>'
|| '<span style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;'
|| 'font-size:12px;font-weight:600;letter-spacing:.24em;color:#A8A39D;">&nbsp;HOME</span>'
|| '</td></tr>'

   /* La tarjeta */
|| '<tr><td style="background-color:#FFFFFF;border:1px solid #E6E3DF;border-radius:14px;">'
|| '<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">'

|| '<tr><td class="sp" style="padding:36px 38px 0;">'
|| '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;'
|| 'font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#B0AAA3;'
|| 'padding-bottom:14px;">' || v.eyebrow || '</div>'
|| '<h1 class="h1" style="margin:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;'
|| 'font-size:23px;line-height:1.32;font-weight:700;letter-spacing:-.01em;color:#0A0A0A;">'
|| v.titulo || '</h1>'
|| case when v.mensaje = '' then '' else
     '<p style="margin:14px 0 0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;'
     || 'font-size:15px;line-height:1.7;color:#4A4742;">' || v.mensaje || '</p>' end
|| '</td></tr>'

   /* La ficha, solo si vino algo */
|| case when f.html = '' then '' else
     '<tr><td class="sp" style="padding:26px 38px 0;">'
     || '<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" '
     || 'style="background-color:#FAF9F7;border:1px solid #F0EDE9;border-radius:11px;">'
     || '<tr><td style="padding:3px 20px 5px;">'
     || '<table role="presentation" class="kv" border="0" cellpadding="0" cellspacing="0" width="100%">'
     || f.html
     || '</table></td></tr></table></td></tr>' end

   /* El boton, o un respiro si no hay a donde ir */
|| case when v.link = '' then
     '<tr><td style="height:36px;line-height:36px;font-size:0;">&nbsp;</td></tr>'
   else
     '<tr><td class="sp" style="padding:28px 38px 36px;">'
     || '<table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr>'
     || '<td align="center" bgcolor="#0A0A0A" style="border-radius:10px;">'
     || '<a href="' || v.link || '" target="_blank" rel="noopener" '
     || 'style="display:inline-block;padding:14px 30px;'
     || 'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;'
     || 'font-size:14px;font-weight:700;letter-spacing:.01em;color:#FFFFFF;'
     || 'text-decoration:none;border-radius:10px;">' || v.cta || '</a>'
     || '</td></tr></table></td></tr>' end

|| '<tr><td class="sp" style="padding:18px 38px;background-color:#FAF9F7;border-top:1px solid #F0EDE9;'
|| 'border-radius:0 0 13px 13px;'
|| 'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;'
|| 'font-size:12px;line-height:1.6;color:#A8A39D;">' || v.pie || '</td></tr>'

|| '</table></td></tr></table>'
|| '<!--[if mso]></td></tr></table><![endif]-->'
|| '</td></tr></table></body></html>'
from v, filas f;
$fn$;

comment on function public.b2b_fn_mail_html(text, text, text, jsonb) is
  'Cuerpo HTML de los avisos. Documento completo, tablas y estilos inline: Outlook y Gmail no soportan otra cosa.';


/* ── 4. Mandarle al cliente ──────────────────────────────────────────────
   No alcanza con llamar a b2b_fn_mail_out con el mail del cliente. Esa
   funcion, si el destinatario viene vacio, cae en los destinatarios internos:
   un cliente sin mail cargado terminaria mandandonos a NOSOTROS un mail que
   dice "tu pedido ya esta". Aca se corta antes.

   Ademas arma el pie con los datos de contacto de la empresa, si estan
   cargados, y manda al cliente a la tienda y no al panel. */
create or replace function public.b2b_fn_mail_cliente(
  p_to text, p_asunto text, p_titulo text, p_mensaje text,
  p_extra jsonb default null
) returns integer language plpgsql security definer
set search_path to 'public','pg_temp' as $fn$
declare
  v_cfg   public.app_mail_config%rowtype;
  v_lista text[]; v_base text; v_pie text; v_co record;
begin
  select * into v_cfg from public.app_mail_config limit 1;
  if not found or v_cfg.activo is not true or v_cfg.avisar_cliente is not true then
    return 0;
  end if;

  -- Sin destinatario valido no se manda NADA. Nunca cae en el mail interno.
  select array_agg(s.x) into v_lista
    from (select distinct lower(trim(t)) as x
            from unnest(string_to_array(coalesce(p_to, ''), ',')) t
           where trim(t) <> '' and position('@' in t) > 1) s;
  if v_lista is null or cardinality(v_lista) = 0 then return 0; end if;

  v_base := coalesce(nullif(trim(v_cfg.base_url), ''), '');

  select nullif(trim(razon_social), '') as razon,
         nullif(trim(telefono), '')     as tel,
         nullif(trim(email), '')        as mail
    into v_co from public.company_settings limit 1;

  v_pie := 'Te escribimos por tu cuenta mayorista en '
        || coalesce(v_co.razon, 'Justo Makario Home') || '.'
        || coalesce(' Cualquier cosa, escribinos a ' || v_co.mail, '')
        || coalesce(case when v_co.mail is null then ' Cualquier cosa, llamanos al '
                         else ' o al ' end || v_co.tel, '')
        || case when v_co.mail is null and v_co.tel is null then '' else '.' end;

  return public.b2b_fn_mail_out(
    p_asunto,
    public.b2b_fn_mail_html(
      p_titulo, p_mensaje,
      nullif(v_base || '/tienda/', '/tienda/'),
      coalesce(p_extra, '{}'::jsonb)
        || jsonb_build_object('pie', v_pie)
        || case when coalesce(p_extra, '{}'::jsonb) ? 'cta'
                then '{}'::jsonb else jsonb_build_object('cta', 'Entrar a la tienda') end),
    array_to_string(v_lista, ','));
exception when others then
  return 0;   -- Un mail nunca puede voltear un pedido ni un registro.
end $fn$;

comment on function public.b2b_fn_mail_cliente(text, text, text, text, jsonb) is
  'Mail hacia afuera. Si el cliente no tiene mail valido no manda nada, en vez de caer en los destinatarios internos.';


/* ── 5. La campanita ─────────────────────────────────────────────────────
   Tres cambios:

   a) Se suma p_extra, para que el aviso interno tambien pueda llevar ficha.

   b) Se saca el `or p_tipo = 'nuevo_pedido'`. Antes ese tipo prendia el mail
      solo. Ahora el mail del pedido lo manda el trigger de abajo, que tiene
      todos los datos a mano; si se dejaba la condicion, por cada pedido
      salian DOS mails internos, uno pelado y uno completo.

   c) El mail queda envuelto en su propio bloque de excepcion. En 0167 solo
      b2b_fn_mail_out se tragaba los errores; el select del base_url y el
      armado del HTML quedaban afuera. Como todo esto corre ADENTRO de la
      transaccion del pedido, un error ahi volteaba un pedido que el cliente
      ya habia confirmado. Ahora no hay forma. */
drop function if exists public.b2b_fn_avisar_interno(
  notif_type_enum, text, text, text, role_enum[], boolean);

create or replace function public.b2b_fn_avisar_interno(
  p_tipo notif_type_enum, p_titulo text, p_mensaje text, p_link text,
  p_roles role_enum[], p_mail boolean default false, p_extra jsonb default null
) returns integer language plpgsql security definer
set search_path to 'public','pg_temp' as $fn$
declare v_n integer; v_base text;
begin
  insert into public.notifications (user_id, tipo, titulo, mensaje, link)
  select pr.id, p_tipo, left(p_titulo, 200), left(p_mensaje, 1000), p_link
    from public.profiles pr
   where pr.active = true and pr.role = any (p_roles);
  get diagnostics v_n = row_count;

  if p_mail then
    begin
      select coalesce(nullif(trim(base_url), ''), '') into v_base
        from public.app_mail_config limit 1;
      perform public.b2b_fn_mail_out(
        left(p_titulo, 200),
        public.b2b_fn_mail_html(p_titulo, p_mensaje,
          case when coalesce(p_link,'') = '' or coalesce(v_base,'') = ''
               then null else v_base || p_link end,
          p_extra));
    exception when others then
      null;
    end;
  end if;

  return v_n;
end $fn$;


/* ── 6. Los mails del pedido ─────────────────────────────────────────────
   Un solo trigger sobre b2b_pedido cubre los dos momentos:

     borrador -> enviado : el pedido entro. Mail al cliente ("lo recibimos") y
                           mail adentro con la ficha completa.
     cualquier otro salto: el estado cambio. Mail al cliente contandole que
                           paso.

   Va sobre b2b_pedido y no sobre pedidos_mayoristas a proposito: b2b_pedido
   es donde termina TODO, venga de la RPC de la tienda, del trigger que baja
   el estado del admin, o de una correccion a mano en el panel. Un solo lugar,
   ningun camino sin aviso. */
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

    -- La ficha. Neto / IVA / total con IVA los tres, que es justo lo que
    -- pidio el cliente para el presupuesto: que se vean las dos opciones.
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
      || jsonb_build_array(
           jsonb_build_object('k', 'Neto', 'sep', true,
             'v', '$ ' || to_char(coalesce(new.total_neto, 0), 'FM999G999G999D00')),
           jsonb_build_object('k', 'IVA',
             'v', '$ ' || to_char(coalesce(new.total_iva, 0), 'FM999G999G999D00')),
           jsonb_build_object('k', 'Total con IVA', 'fuerte', true,
             'v', '$ ' || to_char(coalesce(new.total_con_iva, 0), 'FM999G999G999D00')));

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
                     || to_char(coalesce(new.total_con_iva, 0), 'FM999G999G999D00') || ' con IVA',
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
                     || to_char(coalesce(new.total_con_iva, 0), 'FM999G999G999D00') || ' con IVA',
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
        jsonb_build_object('k', 'Total con IVA', 'sep', true,
          'v', '$ ' || to_char(coalesce(new.total_con_iva, 0), 'FM999G999G999D00')))));

  return new;
exception when others then
  return new;   -- Ni el mail ni una nota rara pueden voltear un pedido.
end $fn$;

drop trigger if exists b2b_tg_pedido_mails on public.b2b_pedido;
create trigger b2b_tg_pedido_mails
  after update of estado on public.b2b_pedido
  for each row when (old.estado is distinct from new.estado)
  execute function public.b2b_fn_pedido_mails();


/* ── 7. Los mails de la cuenta ───────────────────────────────────────────
   Mismo criterio: sobre b2b_usuario, que es donde termina cualquier alta,
   venga del registro publico, de una invitacion canjeada o del panel.

     insert con estado 'aprobado'       → bienvenida al cliente + aviso adentro
     update de otro estado a 'aprobado' → "ya te habilitamos" al cliente

   Las dos RPC de registro siguen tocando la campanita como siempre. Aca solo
   se suman los mails. */
create or replace function public.b2b_fn_usuario_mails()
returns trigger language plpgsql security definer
set search_path to 'public','pg_temp' as $fn$
declare
  v_cli text; v_cuit text; v_canal text; v_otros int;
begin
  if new.estado <> 'aprobado' then return new; end if;
  -- OLD no existe en un INSERT: tocarlo ahi tira "record old is not assigned
  -- yet" y se come la excepcion de abajo, o sea que el alta se queda sin mail
  -- para siempre y en silencio. Por eso el chequeo va adentro del if.
  if tg_op = 'UPDATE' then
    if old.estado = 'aprobado' then return new; end if;
  end if;

  select c.nombre, c.cuit, ca.nombre
    into v_cli, v_cuit, v_canal
    from public.customers_b2b c
    left join public.b2b_canal ca on ca.codigo = coalesce(new.canal_activo, c.b2b_canal)
   where c.id = new.cliente_id;

  -- Al cliente: la bienvenida
  perform public.b2b_fn_mail_cliente(
    new.email,
    case when tg_op = 'INSERT' then 'Tu cuenta mayorista ya esta lista'
         else 'Ya habilitamos tu cuenta mayorista' end,
    case when tg_op = 'INSERT' then 'Tu cuenta ya esta lista'
         else 'Ya habilitamos tu cuenta' end,
    'Podes entrar a la tienda mayorista, ver el catalogo con tus precios y armar tu '
    'primer pedido cuando quieras. Entras con el mismo mail con el que te registraste.',
    jsonb_build_object(
      'eyebrow',   'Bienvenido',
      'cta',       'Entrar al catalogo',
      'preheader', 'Ya podes entrar a la tienda mayorista y ver tus precios.',
      'datos', jsonb_build_array(
        jsonb_build_object('k', 'Empresa', 'v', coalesce(v_cli, '')),
        jsonb_build_object('k', 'Tu mail', 'v', new.email))
        || case when v_canal is not null
                then jsonb_build_array(jsonb_build_object('k', 'Lista de precios', 'v', v_canal))
                else '[]'::jsonb end));

  -- Adentro: solo cuando la cuenta se crea, no cuando se aprueba una que ya
  -- estaba (ahi el aviso seria para el que acaba de apretar el boton).
  if tg_op = 'INSERT' then
    select count(*) - 1 into v_otros
      from public.b2b_usuario where cliente_id = new.cliente_id;

    perform public.b2b_fn_avisar_interno(
      'sistema'::notif_type_enum,
      'Cuenta nueva en la tienda: ' || coalesce(v_cli, new.nombre),
      new.nombre || ' se registro y ya puede comprar.' ||
      case when coalesce(v_otros, 0) > 0
           then ' Es el comprador numero ' || (v_otros + 1) || ' de esta empresa.'
           else '' end,
      '/ventas?tab=mayoristas',
      array[]::role_enum[],   -- la campanita ya la tocaron las RPC de registro
      true,
      jsonb_build_object(
        'eyebrow',   'Cliente nuevo',
        'cta',       'Ver el cliente',
        'preheader', coalesce(v_cli, new.nombre) || ' · ' || new.email,
        'datos', jsonb_build_array(
          jsonb_build_object('k', 'Empresa',  'v', coalesce(v_cli, '')),
          jsonb_build_object('k', 'Contacto', 'v', new.nombre),
          jsonb_build_object('k', 'Mail',     'v', new.email))
          || case when nullif(trim(coalesce(new.telefono, '')), '') is not null
                  then jsonb_build_array(jsonb_build_object('k', 'Telefono', 'v', new.telefono))
                  else '[]'::jsonb end
          || case when v_cuit is not null
                  then jsonb_build_array(jsonb_build_object('k', 'CUIT', 'v', v_cuit))
                  else '[]'::jsonb end
          || case when v_canal is not null
                  then jsonb_build_array(jsonb_build_object('k', 'Lista', 'v', v_canal))
                  else '[]'::jsonb end));
  end if;

  return new;
exception when others then
  return new;   -- Un mail no puede impedir que alguien se registre.
end $fn$;

drop trigger if exists b2b_tg_usuario_mails on public.b2b_usuario;
create trigger b2b_tg_usuario_mails
  after insert or update of estado on public.b2b_usuario
  for each row execute function public.b2b_fn_usuario_mails();


/* ── 8. La prueba del panel, con la cara nueva ───────────────────────────
   Que "Guardar y probar" mande exactamente el mail que va a llegar cuando
   entre un pedido, con datos de ejemplo. Si la prueba se ve linda y el aviso
   de verdad no, la prueba no sirve para nada. */
create or replace function public.rpc_admin_probar_mail(p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public','pg_temp' as $fn$
declare v_n integer; v_to text; v_base text;
begin
  if not public.is_owner_or_admin() then
    raise exception 'Solo owner/admin.' using errcode='42501'; end if;
  v_to := nullif(trim(p_payload->>'destinatarios'), '');
  select coalesce(nullif(trim(base_url), ''), '') into v_base
    from public.app_mail_config limit 1;

  v_n := public.b2b_fn_mail_out(
    'Prueba de avisos - Justo Makario Home',
    public.b2b_fn_mail_html(
      'Los avisos por mail quedaron andando',
      'Asi se va a ver el mail cuando entre un pedido nuevo de la tienda mayorista. '
      'Los datos de abajo son de ejemplo.',
      nullif(v_base, ''),
      jsonb_build_object(
        'eyebrow',   'Prueba de configuracion',
        'cta',       'Abrir el sistema',
        'preheader', 'Prueba de los avisos por mail. Si llego esto, esta todo bien.',
        'datos', jsonb_build_array(
          jsonb_build_object('k', 'Cliente',   'v', 'Cliente de ejemplo'),
          jsonb_build_object('k', 'Comprador', 'v', 'Nombre del comprador'),
          jsonb_build_object('k', 'Pedido',    'v', 'MAY-0000'),
          jsonb_build_object('k', 'Lista',     'v', 'Mayorista'),
          jsonb_build_object('k', 'Productos', 'v', '4 productos · 19 unidades'),
          jsonb_build_object('k', 'Neto', 'sep', true, 'v', '$ 548.288,00'),
          jsonb_build_object('k', 'IVA',                'v', '$ 115.140,48'),
          jsonb_build_object('k', 'Total con IVA', 'fuerte', true, 'v', '$ 663.428,48')))),
    v_to);
  return jsonb_build_object('ok', v_n > 0, 'enviados', v_n);
end $fn$;


/* ── 9. El interruptor, visible desde el panel ───────────────────────────
   Si el campo no viaja en el get y en el set, el checkbox del modal no tiene
   de donde leer ni donde escribir. */
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
    'avisar_cliente', v_cfg.avisar_cliente,
    'tiene_key', coalesce(trim(v_cfg.api_key), '') <> '',
    'updated_at', v_cfg.updated_at);
end $fn$;

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
    activo         = case when p_payload ? 'activo'         then (p_payload->>'activo')::boolean         else activo end,
    avisar_cliente = case when p_payload ? 'avisar_cliente' then (p_payload->>'avisar_cliente')::boolean  else avisar_cliente end,
    updated_at    = now(),
    updated_by    = auth.uid()
  where id = v_id;

  return public.rpc_admin_get_mail_config();
end $fn$;


/* ── 10. Permisos ────────────────────────────────────────────────────────
   Las firmas cambiaron, asi que los revoke de 0167 quedaron apuntando a
   funciones que ya no existen. Hay que rehacerlos o las nuevas quedan
   colgando en /rest/v1/rpc/ y cualquiera con sesion manda mails a mano. */
revoke all on function public.b2b_fn_html_esc(text)                     from public, anon, authenticated;
revoke all on function public.b2b_fn_mail_html(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.b2b_fn_mail_cliente(text, text, text, text, jsonb)
                                                                        from public, anon, authenticated;
revoke all on function public.b2b_fn_pedido_mails()                     from public, anon, authenticated;
revoke all on function public.b2b_fn_usuario_mails()                    from public, anon, authenticated;
revoke all on function public.b2b_fn_avisar_interno(
  notif_type_enum, text, text, text, role_enum[], boolean, jsonb)       from public, anon, authenticated;

revoke all on function public.rpc_admin_probar_mail(jsonb)     from public, anon;
revoke all on function public.rpc_admin_get_mail_config()      from public, anon;
revoke all on function public.rpc_admin_set_mail_config(jsonb) from public, anon;
grant execute on function public.rpc_admin_probar_mail(jsonb)     to authenticated;
grant execute on function public.rpc_admin_get_mail_config()      to authenticated;
grant execute on function public.rpc_admin_set_mail_config(jsonb) to authenticated;


/* ── 11. La verificacion ─────────────────────────────────────────────────
   Toda la gracia de haber hecho esto con triggers es no haber tocado las
   funciones que crean pedidos y cuentas. Si alguna quedo distinta, algo se
   fue de las manos y la migracion no se aplica. */
do $verif$
declare r record; v_ahora text;
begin
  for r in select proname, def from _mig0168_intactas loop
    select pg_get_functiondef(p.oid) into v_ahora
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.proname;
    if v_ahora is distinct from r.def then
      raise exception '0168: %() quedo modificada y no tenia que tocarse. Abortado.', r.proname;
    end if;
  end loop;
  raise notice '0168: las funciones de pedidos y de alta quedaron intactas.';
end $verif$;

drop table if exists _mig0168_intactas;
