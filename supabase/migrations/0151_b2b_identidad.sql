-- 0151 · B2B (1/3) IDENTIDAD DEL CLIENTE EXTERNO — fail-closed.
--
-- POR QUE EXISTE ESTA MIGRACION
-- Makario Lite hoy no tiene ningun concepto de "cliente externo": role_enum tiene 11 roles
-- internos y ninguno de cliente, y customers_b2b no tiene una sola columna que la ate a
-- auth.users. Ademas las tablas operativas (orders, jornadas, production_logs, sku_catalog,
-- profiles...) abren SELECT con is_active_user(), que NO mira el rol: solo mira profiles.active.
-- Consecuencia: si a un mayorista se le da un login "normal", handle_new_user le crea un profile
-- con role='embalaje' y active=true, y pasa a leer TODA la operacion interna. No es un permiso
-- a afinar: es una fuga de datos inmediata.
--
-- LA SOLUCION DE ESTA MIGRACION: el usuario B2B NO tiene fila en profiles.
--   sin profile  ->  is_active_user() = false  ->  quedan cerradas las tablas internas cuya
--   policy llama a is_active_user() (11 tablas en el remoto al 2026-08-14).
--   su identidad vive en b2b_usuario (auth.users -> customers_b2b) y se resuelve con
--   b2b_fn_cliente_actual(), que es el unico predicado que abre las tablas b2b_*.
--
-- ⚠ OJO: el aislamiento NO alcanza por construccion. Contra el remoto habia 14 policies SELECT
--   con predicado literal 'true', 4 vistas sin security_invoker (dos legibles con la anon key) y
--   prod_pata_tamano sin RLS, todas legibles por cualquier authenticated. Eso se cierra en
--   0154_cerrar_lecturas_authenticated.sql, que es REQUISITO para poner app_flags.b2b en true.
--
-- ⚠ BAJA DE UN CLIENTE B2B — NO se borra desde el Dashboard de Auth.
--   b2b_usuario.id cascadea desde auth.users, pero b2b_pedido.creado_por (0153) es
--   ON DELETE RESTRICT: apenas el cliente mando un pedido, el borrado del usuario falla con
--   foreign_key_violation y el mensaje no explica nada. La baja es
--   b2b_rpc_resolver_usuario({usuario_id, estado:'suspendido'}), que ademas conserva el
--   historial de pedidos y la trazabilidad.
--
-- ALCANCE / NO ALCANCE
--   · Aditiva. No toca orders, ni profiles, ni role_enum, ni Linea Productiva, ni el modulo
--     administrativo existente. La unica funcion preexistente que se redefine es
--     handle_new_user(), y solo se le agrega UNA rama al principio (todo el camino interno
--     queda byte a byte igual).
--   · Fail-closed detras del flag 'b2b' (mismo patron que 'linea_productiva' en 0135/0136).
--     Con el flag OFF, ninguna RPC B2B que muta hace nada.
--
-- ⚠ PARA EL DUENO — VERIFICAR ANTES DE ABRIR EL REGISTRO
--   handle_new_user() toma el rol de raw_user_meta_data->>'role', que es el namespace que el
--   cliente controla en un signup publico. Si en el Dashboard esta habilitado "Allow new users
--   to sign up", cualquiera puede registrarse pidiendo role='owner'. Esta migracion NO cambia
--   eso (cambiarlo romperia la edge function invite_user, que manda el rol por user_metadata).
--   Recomendacion: dejar el signup publico APAGADO y dar de alta a los B2B por edge function
--   con service_role, igual que invite_user. El diseno de abajo funciona en ese modo.
--
-- ✅ APLICADA EN REMOTO el 2026-08-15, con autorizacion expresa del dueno, junto con
--    0152-0154. El flag 'b2b' quedo en false: el modulo existe y esta apagado.

-- ─────────────────────────────────────────────────────────────────────────
-- (A) Kill-switch del modulo B2B
-- ─────────────────────────────────────────────────────────────────────────

insert into public.app_flags (name, enabled) values ('b2b', false)
on conflict (name) do nothing;

create or replace function public.b2b_fn_habilitado()
returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $fn$
  select coalesce((select enabled from public.app_flags where name = 'b2b'), false);
$fn$;
revoke execute on function public.b2b_fn_habilitado() from public, anon, authenticated;

create or replace function public.b2b_fn_guard()
returns void language plpgsql stable security definer set search_path to 'public','pg_temp' as $fn$
begin
  if not public.b2b_fn_habilitado() then
    raise exception 'El modulo B2B no esta habilitado.' using errcode='42501';
  end if;
end $fn$;
revoke execute on function public.b2b_fn_guard() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- (B) Canal comercial B2B (el coeficiente de precio)
--
-- OJO: public.channels NO es esto. channels son los canales logisticos de MercadoLibre /
-- Tienda Nube (colecta, flex, tiendanube, distribuidor, no_flex, correo_argentino) y tienen
-- semantica de cierre de jornada. b2b_canal es el segmento comercial del cliente externo.
-- Son dos cosas distintas y no se cruzan.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.b2b_canal (
  codigo           text primary key,
  nombre           text not null,
  coeficiente      numeric(6,4) not null check (coeficiente > 0 and coeficiente <= 5),
  minimo_pedido    numeric(12,2) not null default 0 check (minimo_pedido >= 0),
  minimo_unidades  integer       not null default 0 check (minimo_unidades >= 0),
  orden            smallint      not null default 0,
  activo           boolean       not null default true,
  created_at       timestamptz   not null default now(),
  updated_at       timestamptz   not null default now()
);

comment on table public.b2b_canal is
  'Segmento comercial del cliente B2B. El precio final = b2b_producto.precio_base * coeficiente. Distinto de public.channels (canales logisticos ML/TN).';

insert into public.b2b_canal (codigo, nombre, coeficiente, orden) values
  ('distribuidor', 'Distribuidor', 0.5500, 1),
  ('mayorista',    'Mayorista',    0.7000, 2),
  ('minorista',    'Minorista',    1.0000, 3)
on conflict (codigo) do nothing;

drop trigger if exists b2b_canal_updated_at on public.b2b_canal;
create trigger b2b_canal_updated_at before update on public.b2b_canal
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- (C) customers_b2b se convierte en el cliente B2B (no se crea una tabla paralela)
--
-- Decision deliberada: pedidos_mayoristas.cliente_id ya apunta a customers_b2b. Si el cliente
-- de la tienda B2B fuera otra tabla, el pedido no podria aterrizar en el admin sin un mapeo.
-- Se extiende la tabla que ya existe.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.customers_b2b
  add column if not exists b2b_canal            text references public.b2b_canal(codigo),
  add column if not exists b2b_habilitado       boolean not null default false,
  add column if not exists b2b_condicion_pago   text,
  add column if not exists b2b_notas_internas   text;

comment on column public.customers_b2b.b2b_habilitado is
  'true = el cliente puede operar en la tienda B2B. Requiere b2b_canal cargado.';

-- Un cliente habilitado tiene que tener canal: sin canal no hay precio.
do $do$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'customers_b2b_b2b_canal_ck'
  ) then
    alter table public.customers_b2b
      add constraint customers_b2b_b2b_canal_ck
      check (b2b_habilitado = false or b2b_canal is not null);
  end if;
end $do$;

-- ─────────────────────────────────────────────────────────────────────────
-- (D) b2b_usuario — el puente que hoy no existe: auth.users -> customers_b2b
--     Varios usuarios por cliente (el que compra, el que administra).
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.b2b_usuario (
  id                uuid primary key references auth.users(id) on delete cascade,
  cliente_id        uuid not null references public.customers_b2b(id) on delete restrict,
  email             text not null,
  nombre            text not null,
  telefono          text,
  estado            text not null default 'pendiente'
                      check (estado in ('pendiente','aprobado','rechazado','suspendido')),
  es_titular        boolean not null default false,
  aprobado_por      uuid references public.profiles(id),
  aprobado_at       timestamptz,
  rechazo_motivo    text,
  ultimo_acceso_at  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index if not exists b2b_usuario_email_uq
  on public.b2b_usuario (lower(email));
create index if not exists b2b_usuario_cliente_idx
  on public.b2b_usuario (cliente_id) where estado = 'aprobado';
create index if not exists b2b_usuario_pendientes_idx
  on public.b2b_usuario (created_at desc) where estado = 'pendiente';

comment on table public.b2b_usuario is
  'Identidad del cliente externo. Un usuario B2B NO tiene fila en profiles: por eso is_active_user() es false. El cierre del resto del perimetro (policies con qual=true, vistas sin security_invoker, prod_pata_tamano) lo hace 0154.';

drop trigger if exists b2b_usuario_updated_at on public.b2b_usuario;
create trigger b2b_usuario_updated_at before update on public.b2b_usuario
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- (E) b2b_invitacion — alta por link, con aprobacion manual posterior
--     El token se guarda HASHEADO (pgcrypto ya esta instalado): si se filtra la tabla,
--     no se filtran invitaciones vivas.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.b2b_invitacion (
  id              uuid primary key default gen_random_uuid(),
  token_hash      text not null unique,
  email           text not null,
  cliente_id      uuid references public.customers_b2b(id) on delete cascade,
  cliente_nombre  text,
  cliente_cuit    text,
  canal           text not null references public.b2b_canal(codigo),
  estado          text not null default 'pendiente'
                    check (estado in ('pendiente','usada','revocada')),
  expira_at       timestamptz not null,
  usada_at        timestamptz,
  usada_por       uuid references auth.users(id),
  created_by      uuid not null references public.profiles(id),
  created_at      timestamptz not null default now(),
  constraint b2b_invitacion_destino_ck
    check (cliente_id is not null or nullif(trim(cliente_nombre), '') is not null)
);

create index if not exists b2b_invitacion_estado_idx
  on public.b2b_invitacion (estado, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- (F) Helpers de identidad B2B (los usan las policies de 0152 y 0153)
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.b2b_fn_cliente_actual()
returns uuid language sql stable security definer set search_path to 'public','pg_temp' as $fn$
  select u.cliente_id
    from public.b2b_usuario u
    join public.customers_b2b c on c.id = u.cliente_id
   where u.id = auth.uid()
     and u.estado = 'aprobado'
     and c.activo = true
     and c.b2b_habilitado = true
   limit 1;
$fn$;
revoke execute on function public.b2b_fn_cliente_actual() from public, anon;
grant  execute on function public.b2b_fn_cliente_actual() to authenticated;

create or replace function public.b2b_fn_es_cliente()
returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $fn$
  select public.b2b_fn_cliente_actual() is not null;
$fn$;
revoke execute on function public.b2b_fn_es_cliente() from public, anon;
grant  execute on function public.b2b_fn_es_cliente() to authenticated;

-- Coeficiente del cliente que esta llamando. NUNCA se expone el coeficiente de otro canal.
create or replace function public.b2b_fn_coeficiente_actual()
returns numeric language sql stable security definer set search_path to 'public','pg_temp' as $fn$
  select ca.coeficiente
    from public.b2b_usuario u
    join public.customers_b2b c on c.id = u.cliente_id
    join public.b2b_canal ca    on ca.codigo = c.b2b_canal
   where u.id = auth.uid()
     and u.estado = 'aprobado'
     and c.activo = true
     and c.b2b_habilitado = true
     and ca.activo = true
   limit 1;
$fn$;
revoke execute on function public.b2b_fn_coeficiente_actual() from public, anon;
grant  execute on function public.b2b_fn_coeficiente_actual() to authenticated;

-- Aviso interno reutilizable. Es el UNICO canal de salida que este sistema tiene hoy:
-- la campanita in-app (public.notifications ya viaja por supabase_realtime).
-- No hay pg_net, ni pg_cron, ni Database Webhooks, ni push, ni mail entregable.
-- HOOK POINT: el dia que se instale pg_net, el envio externo (mail / WhatsApp / webhook)
-- se agrega ACA ADENTRO y ninguna RPC que la llama necesita cambiar.
create or replace function public.b2b_fn_avisar_interno(
  p_tipo notif_type_enum, p_titulo text, p_mensaje text, p_link text, p_roles role_enum[]
) returns integer language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_n integer;
begin
  insert into public.notifications (user_id, tipo, titulo, mensaje, link)
  select pr.id, p_tipo, left(p_titulo, 200), left(p_mensaje, 1000), p_link
    from public.profiles pr
   where pr.active = true
     and pr.role = any (p_roles);
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;
revoke execute on function public.b2b_fn_avisar_interno(notif_type_enum, text, text, text, role_enum[])
  from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- (G) handle_new_user: una sola rama nueva al principio.
--     Si el alta se declara B2B, NO se crea profile. Todo el resto queda igual.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
DECLARE
  v_username   text;
  v_name       text;
  v_role       role_enum;
  v_area       text;
  v_created_by uuid;
BEGIN
  -- ── B2B (0151): el cliente externo NO es empleado. Sin profile, is_active_user() es
  -- false y quedan cerradas las tablas cuya policy la llama. Su identidad se crea en
  -- b2b_usuario. El resto del perimetro lo cierra 0154 (requisito para prender el flag).
  IF COALESCE(NEW.raw_user_meta_data->>'b2b', NEW.raw_app_meta_data->>'b2b') = 'true' THEN
    RETURN NEW;
  END IF;

  -- username: del metadata, o derivado del email si falta
  v_username := COALESCE(
    NEW.raw_user_meta_data->>'username',
    regexp_replace(lower(split_part(NEW.email, '@', 1)), '[^a-z0-9_]', '_', 'g')
  );

  -- name: del metadata, o usa username como fallback
  v_name := COALESCE(NEW.raw_user_meta_data->>'name', v_username);

  -- role: del metadata, default a 'embalaje' (rol más restrictivo)
  v_role := COALESCE(
    (NEW.raw_user_meta_data->>'role')::role_enum,
    'embalaje'::role_enum
  );

  -- area: opcional
  v_area := NEW.raw_user_meta_data->>'area';

  -- created_by: opcional (uuid del owner/admin que invitó)
  v_created_by := NULLIF(NEW.raw_user_meta_data->>'created_by', '')::uuid;

  INSERT INTO public.profiles (id, username, name, email, role, area, created_by)
  VALUES (NEW.id, v_username, v_name, NEW.email, v_role, v_area, v_created_by);

  RETURN NEW;
EXCEPTION
  -- Si username ya existe (UNIQUE violation), agregar sufijo numérico aleatorio
  -- y reintentar. Caso edge: dos signups con el mismo username derivado del email.
  WHEN unique_violation THEN
    v_username := v_username || '_' || (floor(random() * 10000))::text;
    INSERT INTO public.profiles (id, username, name, email, role, area, created_by)
    VALUES (NEW.id, v_username, v_name, NEW.email, v_role, v_area, v_created_by);
    RETURN NEW;
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────
-- (G bis) log_admin_action fail-soft — SIN ESTO EL MODULO NO ARRANCA
--
-- admin_audit_log.actor_id tiene FK a profiles(id) (admin_audit_log_actor_id_fkey), y
-- trg_audit_log esta colgado de customers_b2b, pedidos_mayoristas y pedidos_mayoristas_items.
-- Como el cliente B2B NO tiene profile (esa es toda la idea del aislamiento), la primera vez
-- que un cliente mande un pedido, el trigger de auditoria intentaria escribir su uuid en
-- actor_id y reventaria con foreign_key_violation: el pedido no entraria nunca.
-- Se hace fail-soft: si el actor no es un empleado, se registra como 'system' y su uuid queda
-- guardado dentro de changes->>'actor_externo', asi no se pierde la trazabilidad.
-- Para los usuarios internos el comportamiento es identico al de hoy.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.log_admin_action(
  p_entity_type text, p_entity_id uuid, p_action text, p_changes jsonb
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $fn$
DECLARE
  v_id uuid;
  v_actor_id uuid := auth.uid();
  v_actor_source text;
  v_headers jsonb;
  v_ip inet;
  v_user_agent text;
  v_request_id text;
BEGIN
  IF v_actor_id IS NOT NULL THEN
    v_actor_source := 'user';
  ELSE
    v_actor_source := 'system';
  END IF;

  -- ── B2B (0151): actor externo, sin fila en profiles ──
  IF v_actor_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_actor_id) THEN
    p_changes      := COALESCE(p_changes, '{}'::jsonb)
                      || jsonb_build_object('actor_externo', v_actor_id);
    v_actor_source := 'system';
    v_actor_id     := NULL;
  END IF;

  BEGIN
    v_headers := current_setting('request.headers', true)::jsonb;
  EXCEPTION WHEN OTHERS THEN
    v_headers := NULL;
  END;

  IF v_headers IS NOT NULL THEN
    BEGIN
      v_ip := split_part(v_headers->>'x-forwarded-for', ',', 1)::inet;
    EXCEPTION WHEN OTHERS THEN
      v_ip := NULL;
    END;
    v_user_agent := v_headers->>'user-agent';
    v_request_id := v_headers->>'x-request-id';
  END IF;

  INSERT INTO public.admin_audit_log (
    actor_id, actor_source, entity_type, entity_id, action, changes,
    ip, user_agent, request_id
  ) VALUES (
    v_actor_id, v_actor_source, p_entity_type, p_entity_id, p_action, p_changes,
    v_ip, v_user_agent, v_request_id
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────
-- (H) RLS
--     Regla del modulo: el cliente NUNCA escribe por PostgREST. Solo lee lo suyo.
--     Toda mutacion pasa por RPC SECURITY DEFINER con validacion de titularidad.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.b2b_canal      enable row level security;
alter table public.b2b_usuario    enable row level security;
alter table public.b2b_invitacion enable row level security;

-- b2b_canal: SOLO interno. Si el cliente pudiera leerlo, veria el coeficiente de los
-- otros canales y deduciria el precio de la competencia. Su precio lo recibe ya calculado.
drop policy if exists b2b_canal_sel on public.b2b_canal;
create policy b2b_canal_sel on public.b2b_canal for select to authenticated
  using (public.is_owner_or_admin());

drop policy if exists b2b_usuario_sel on public.b2b_usuario;
create policy b2b_usuario_sel on public.b2b_usuario for select to authenticated
  using (id = auth.uid() or public.is_owner_or_admin());

drop policy if exists b2b_invitacion_sel on public.b2b_invitacion;
create policy b2b_invitacion_sel on public.b2b_invitacion for select to authenticated
  using (public.is_owner_or_admin());

-- El default ACL de public concede arwdDxtm a anon Y authenticated sobre cada tabla nueva:
-- hay que revocar a authenticated tambien, no alcanza con anon/public. Si no, estas tablas
-- quedan con INSERT/UPDATE/DELETE/TRUNCATE para un rol que ahora incluye clientes externos
-- (hoy lo tapa la RLS, no el grant — y TRUNCATE ni siquiera pasa por RLS).
revoke all on public.b2b_canal      from anon, public, authenticated;
revoke all on public.b2b_usuario    from anon, public, authenticated;
revoke all on public.b2b_invitacion from anon, public, authenticated;
grant select on public.b2b_canal      to authenticated;
grant select on public.b2b_usuario    to authenticated;
grant select on public.b2b_invitacion to authenticated;

-- Auditoria administrativa (mismo trigger que usa el modulo admin 0044-0070).
-- El UPDATE se audita solo si cambio algo que no sea updated_at / ultimo_acceso_at:
-- b2b_rpc_mi_cuenta bumpea ultimo_acceso_at en CADA apertura de la tienda y eso
-- convertiria admin_audit_log en un contador de visitas (y con actor_id NULL, inservible).
drop trigger if exists b2b_usuario_audit on public.b2b_usuario;
drop trigger if exists b2b_usuario_audit_upd on public.b2b_usuario;
create trigger b2b_usuario_audit after insert or delete on public.b2b_usuario
  for each row execute function public.trg_audit_log();
create trigger b2b_usuario_audit_upd after update on public.b2b_usuario
  for each row when (
    to_jsonb(old) - 'updated_at' - 'ultimo_acceso_at'
      is distinct from to_jsonb(new) - 'updated_at' - 'ultimo_acceso_at')
  execute function public.trg_audit_log();

-- ─────────────────────────────────────────────────────────────────────────
-- (I) RPCs de alta y aprobacion
-- ─────────────────────────────────────────────────────────────────────────

-- (I.1) Crear invitacion (owner/admin). Devuelve el token EN CLARO una sola vez.
create or replace function public.b2b_rpc_crear_invitacion(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare
  v_rol role_enum; v_token text; v_id uuid;
  v_cliente_id uuid; v_canal text; v_email text; v_dias integer;
  v_cuit text; v_nombre_cli text;
begin
  perform public.b2b_fn_guard();
  v_rol := public.current_user_role();
  if v_rol is null or v_rol not in ('owner','admin') then
    raise exception 'Sin permiso.' using errcode='42501';
  end if;

  v_email := lower(nullif(trim(p_payload->>'email'), ''));
  if v_email is null then
    raise exception 'Falta el email del invitado.' using errcode='22023';
  end if;
  v_canal := nullif(trim(p_payload->>'canal'), '');
  if not exists (select 1 from public.b2b_canal where codigo = v_canal and activo) then
    raise exception 'Canal invalido o inactivo (%).', coalesce(v_canal,'null') using errcode='22023';
  end if;

  v_cliente_id := nullif(p_payload->>'cliente_id','')::uuid;
  if v_cliente_id is not null
     and not exists (select 1 from public.customers_b2b where id = v_cliente_id and activo) then
    raise exception 'Cliente inexistente o inactivo.' using errcode='P0002';
  end if;
  if v_cliente_id is null and nullif(trim(p_payload->>'cliente_nombre'),'') is null then
    raise exception 'Indica un cliente existente o el nombre del cliente nuevo.' using errcode='22023';
  end if;

  -- customers_b2b exige cuit ~ '^\d{2}-\d{8}-\d$' y nombre de 1..120: se valida ACA,
  -- donde hay un humano interno que puede corregir, y no en el canje del cliente externo
  -- (que reventaria con un 23514 crudo dos transacciones despues, con el link ya mandado).
  v_nombre_cli := nullif(trim(p_payload->>'cliente_nombre'), '');
  if v_nombre_cli is not null and length(v_nombre_cli) > 120 then
    raise exception 'El nombre del cliente no puede superar 120 caracteres.' using errcode='22023';
  end if;

  v_cuit := nullif(trim(p_payload->>'cliente_cuit'), '');
  if v_cuit is not null then
    v_cuit := regexp_replace(v_cuit, '[^0-9]', '', 'g');
    if length(v_cuit) <> 11 then
      raise exception 'CUIT invalido. Usa el formato 30-12345678-9.' using errcode='22023';
    end if;
    v_cuit := substr(v_cuit,1,2) || '-' || substr(v_cuit,3,8) || '-' || substr(v_cuit,11,1);
  end if;

  v_dias  := greatest(1, least(90, coalesce((p_payload->>'dias_validez')::integer, 14)));
  -- pgcrypto vive en el schema 'extensions' en este proyecto: hay que calificarlo,
  -- porque el search_path de la funcion es solo public, pg_temp.
  v_token := encode(extensions.gen_random_bytes(24), 'hex');

  insert into public.b2b_invitacion (
    token_hash, email, cliente_id, cliente_nombre, cliente_cuit, canal, expira_at, created_by
  ) values (
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    v_email, v_cliente_id,
    v_nombre_cli,
    v_cuit,
    v_canal, now() + make_interval(days => v_dias), auth.uid()
  ) returning id into v_id;

  -- El token en claro se devuelve UNA sola vez. En la tabla queda solo el hash.
  return jsonb_build_object('ok', true, 'invitacion_id', v_id, 'token', v_token,
                            'expira_at', now() + make_interval(days => v_dias));
end $fn$;
revoke execute on function public.b2b_rpc_crear_invitacion(jsonb) from public, anon;
grant  execute on function public.b2b_rpc_crear_invitacion(jsonb) to authenticated;

-- (I.2) Ver a que invita un token, sin exponer nada mas. Pantalla de registro.
create or replace function public.b2b_rpc_ver_invitacion(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_inv public.b2b_invitacion%rowtype; v_nombre text;
begin
  perform public.b2b_fn_guard();
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

-- (I.3) Canjear la invitacion con la sesion recien creada. Deja el usuario en 'pendiente'
--       y avisa al equipo. La aprobacion es manual, como pidio el brief.
create or replace function public.b2b_rpc_canjear_invitacion(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare
  v_inv public.b2b_invitacion%rowtype;
  v_uid uuid := auth.uid();
  v_email text; v_cliente_id uuid; v_nombre text;
begin
  perform public.b2b_fn_guard();
  if v_uid is null then
    raise exception 'Necesitas iniciar sesion para aceptar la invitacion.' using errcode='42501';
  end if;
  -- Un empleado interno no puede convertirse en cliente externo.
  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'Esta cuenta es interna y no puede operar como cliente.' using errcode='0A000';
  end if;
  if exists (select 1 from public.b2b_usuario where id = v_uid) then
    raise exception 'Esta cuenta ya esta registrada.' using errcode='0A000';
  end if;

  select email into v_email from auth.users where id = v_uid;

  select * into v_inv from public.b2b_invitacion
   where token_hash = encode(extensions.digest(coalesce(p_payload->>'token',''), 'sha256'), 'hex')
   for update;
  if not found or v_inv.estado <> 'pendiente' or v_inv.expira_at < now() then
    raise exception 'La invitacion no es valida o ya vencio.' using errcode='P0002';
  end if;
  if lower(v_inv.email) is distinct from lower(v_email) then
    raise exception 'La invitacion fue emitida para otro correo.' using errcode='42501';
  end if;

  -- Cliente destino: el que trae la invitacion, o uno nuevo con el canal ya asignado.
  v_cliente_id := v_inv.cliente_id;
  if v_cliente_id is null then
    -- Degradacion suave: las invitaciones emitidas ANTES de la validacion de arriba pueden
    -- traer el CUIT mal congelado. cuit es nullable en customers_b2b, asi que el cliente entra
    -- igual y el admin lo completa despues desde Mayoristas (rpc_admin_update_customer_b2b).
    -- Abortar aca dejaria una cuenta auth sin profile y sin b2b_usuario: irrecuperable.
    insert into public.customers_b2b (nombre, cuit, email, es_mayorista, activo,
                                      b2b_canal, b2b_habilitado, created_by)
    values (left(v_inv.cliente_nombre, 120),
            case when v_inv.cliente_cuit ~ '^\d{2}-\d{8}-\d$' then v_inv.cliente_cuit else null end,
            v_inv.email, true, true,
            v_inv.canal, false, v_inv.created_by)
    returning id into v_cliente_id;
  else
    update public.customers_b2b
       set b2b_canal = coalesce(b2b_canal, v_inv.canal),
           es_mayorista = true
     where id = v_cliente_id;
  end if;

  v_nombre := coalesce(nullif(trim(p_payload->>'nombre'),''), split_part(v_email, '@', 1));

  insert into public.b2b_usuario (id, cliente_id, email, nombre, telefono, estado, es_titular)
  values (v_uid, v_cliente_id, v_email, v_nombre,
          nullif(trim(p_payload->>'telefono'),''), 'pendiente',
          not exists (select 1 from public.b2b_usuario where cliente_id = v_cliente_id));

  update public.b2b_invitacion
     set estado = 'usada', usada_at = now(), usada_por = v_uid
   where id = v_inv.id;

  perform public.b2b_fn_avisar_interno(
    'sistema',
    'Alta B2B pendiente de aprobacion',
    v_nombre || ' (' || v_email || ') pidio acceso a la tienda B2B. Revisalo en Ventas > B2B > Usuarios.',
    '/ventas?tab=b2b&sub=usuarios',
    array['owner','admin','ventas']::role_enum[]
  );

  return jsonb_build_object('ok', true, 'estado', 'pendiente');
end $fn$;
revoke execute on function public.b2b_rpc_canjear_invitacion(jsonb) from public, anon;
grant  execute on function public.b2b_rpc_canjear_invitacion(jsonb) to authenticated;

-- (I.4) Aprobar / rechazar / suspender (owner/admin)
create or replace function public.b2b_rpc_resolver_usuario(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare
  v_rol role_enum; v_estado text; v_uid uuid; v_u public.b2b_usuario%rowtype;
begin
  perform public.b2b_fn_guard();
  v_rol := public.current_user_role();
  if v_rol is null or v_rol not in ('owner','admin') then
    raise exception 'Sin permiso.' using errcode='42501';
  end if;

  v_uid    := nullif(p_payload->>'usuario_id','')::uuid;
  v_estado := nullif(trim(p_payload->>'estado'),'');
  -- El 'v_estado is null' va explicito: sin el, 'NULL not in (...)' evalua NULL, el IF no
  -- dispara y el UPDATE termina en un not-null violation 23502 crudo.
  if v_estado is null or v_estado not in ('aprobado','rechazado','suspendido','pendiente') then
    raise exception 'Estado invalido (%).', coalesce(v_estado,'null') using errcode='22023';
  end if;

  select * into v_u from public.b2b_usuario where id = v_uid for update;
  if not found then
    raise exception 'Usuario B2B no encontrado.' using errcode='P0002';
  end if;

  update public.b2b_usuario
     set estado         = v_estado,
         aprobado_por   = case when v_estado = 'aprobado' then auth.uid() else aprobado_por end,
         aprobado_at    = case when v_estado = 'aprobado' then now() else aprobado_at end,
         -- No se pisa incondicionalmente: aprobar borra el motivo viejo, y suspender sin
         -- 'motivo' en el payload no hereda el texto del rechazo anterior.
         rechazo_motivo = case when v_estado in ('rechazado','suspendido')
                               then nullif(trim(p_payload->>'motivo'),'') else null end
   where id = v_uid;

  -- Aprobar al usuario habilita a su cliente en la tienda y lo hace visible en el modulo
  -- Mayoristas del admin (rpc_mayoristas_list filtra por es_mayorista = true).
  if v_estado = 'aprobado' then
    update public.customers_b2b
       set b2b_habilitado = true, es_mayorista = true
     where id = v_u.cliente_id;
  end if;

  return jsonb_build_object('ok', true, 'usuario_id', v_uid, 'estado', v_estado);
end $fn$;
revoke execute on function public.b2b_rpc_resolver_usuario(jsonb) from public, anon;
grant  execute on function public.b2b_rpc_resolver_usuario(jsonb) to authenticated;

-- (I.5) Quien soy (lo llama la tienda al abrir). No revela coeficiente ni datos internos.
create or replace function public.b2b_rpc_mi_cuenta(p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_r jsonb;
begin
  if not public.b2b_fn_habilitado() then
    return jsonb_build_object('ok', false, 'motivo', 'b2b_deshabilitado');
  end if;
  -- Los datos comerciales del cliente solo si el usuario esta aprobado: la pantalla de espera
  -- de un 'pendiente' / 'rechazado' / 'suspendido' solo necesita el estado.
  select jsonb_build_object(
           'ok', true, 'usuario_id', u.id, 'nombre', u.nombre, 'email', u.email,
           'estado', u.estado, 'es_titular', u.es_titular,
           'cliente', case when u.estado = 'aprobado' then jsonb_build_object(
             'id', c.id, 'nombre', c.nombre, 'cuit', c.cuit,
             'habilitado', c.b2b_habilitado, 'condicion_pago', c.b2b_condicion_pago,
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
