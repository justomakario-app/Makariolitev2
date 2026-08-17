-- ═══════════════════════════════════════════════════════════════════════════
-- 0155 — Cerrar el alta publica de usuarios + completar la ficha B2B del cliente
--
-- ✅ APLICADA EN REMOTO el 2026-08-15, junto con el despliegue de invite_user v3
--    (que agrega app_metadata.interno) y de b2b_signup v1.
--
-- ─── (A) EL AGUJERO ────────────────────────────────────────────────────────
-- Verificado en el remoto el 2026-08-15 con una sonda que no crea nada:
--
--   POST /auth/v1/signup  {"email":"...","password":"x"}   con la anon key
--   → 422 {"error_code":"weak_password","msg":"Password should be at least 6..."}
--
-- Ese error es la prueba de que el alta publica esta ABIERTA: si estuviera
-- apagada, GoTrue cortaria antes con "Signups not allowed for this instance".
-- La anon key esta publicada en el HTML — es publica por diseno — asi que
-- cualquiera podia hacer:
--
--   POST /auth/v1/signup  {"email":"x@x.com","password":"12345678",
--                          "data":{"role":"owner","name":"quien sea"}}
--
-- y handle_new_user le creaba un public.profiles con ESE rol y active=true
-- (los dos defaults de la tabla). O sea: owner del sistema de la planta, con
-- una sola llamada HTTP y sin invitacion. Y aunque no eligiera rol, el default
-- 'embalaje' ya alcanza para leer media planta.
--
-- ─── LA DECISION ───────────────────────────────────────────────────────────
-- Se arregla en la BASE y no solo en el switch del Dashboard. El switch
-- ("Allow new users to sign up") hay que apagarlo igual — es la puerta de
-- calle, y esta migracion NO puede tocarlo — pero no puede ser lo unico:
-- vive fuera del repo, no deja rastro cuando alguien lo cambia, y se vuelve a
-- prender solo con un click. Con el arreglo de aca abajo, si manana alguien lo
-- prende de nuevo, lo peor que consigue un desconocido es una credencial que
-- no ve absolutamente nada.
--
-- COMO: el profile se crea solo si el alta trae raw_app_meta_data.interno='true'.
-- La eleccion de app_metadata (y no user_metadata) es TODO el arreglo:
--   · user_metadata  ← lo escribe quien se registra (es el campo 'data' del
--                      signup publico). Ahi es donde viaja 'role'. No sirve.
--   · app_metadata   ← solo lo escribe el service_role via Admin API. GoTrue
--                      descarta cualquier app_metadata que llegue en el body
--                      de /auth/v1/signup. Por eso es una marca confiable.
--
-- Lo pone invite_user (edge function, ya desplegada), que es la pantalla de
-- Usuarios de la app. Alta desde el Dashboard de Supabase: ya NO crea profile,
-- porque el formulario del Dashboard no permite escribir app_metadata. Es a
-- proposito — los empleados se dan de alta desde la app, que ademas valida el
-- username y deja auditoria. Si algun dia hace falta el camino manual, esta
-- rpc_admin_alta_interna() mas abajo.
--
-- Lo que NO cambia: los 16 usuarios que ya existen. El trigger corre solo en
-- el INSERT de auth.users; sus profiles ya estan creados y no se tocan.
--
-- ─── (B) LA FICHA B2B DEL CLIENTE ──────────────────────────────────────────
-- 0151 le agrego a customers_b2b cuatro columnas (b2b_canal, b2b_habilitado,
-- b2b_condicion_pago, b2b_notas_internas) pero ninguna RPC las escribia:
-- rpc_admin_update_customer_b2b (que es de antes) ignora las cuatro. En la
-- practica el canal quedaba clavado en el que se eligio al emitir la
-- invitacion y no habia forma, desde la app, de:
--   · pasar un cliente de mayorista a distribuidor,
--   · cortarle el acceso a la tienda sin borrarlo,
--   · anotarle la condicion de pago que despues viaja al pedido.
-- Se agrega b2b_rpc_admin_set_cliente en vez de tocar la RPC vieja: esa la
-- comparten varias pantallas de Ventas y no hace falta moverla.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- (A.1) Bitacora de altas bloqueadas
--       Sin esto el bloqueo es invisible: alguien se registra, no ve nada, y
--       nadie se entera de que lo intento. Con esto queda el rastro y ademas
--       avisa a la campanita (como maximo una vez por hora, para que un bot
--       no pueda inundar las notificaciones del equipo).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.auth_alta_bloqueada (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  email       text,
  motivo      text not null,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_auth_alta_bloqueada_fecha
  on public.auth_alta_bloqueada (created_at desc);

alter table public.auth_alta_bloqueada enable row level security;

drop policy if exists auth_alta_bloqueada_sel on public.auth_alta_bloqueada;
create policy auth_alta_bloqueada_sel on public.auth_alta_bloqueada
  for select to authenticated using (public.is_owner_or_admin());

-- El default ACL de Supabase le da arwdDxtm a anon y authenticated en cada
-- objeto nuevo del schema public. Se revoca todo y se devuelve solo el select.
revoke all on public.auth_alta_bloqueada from anon, public, authenticated;
grant select on public.auth_alta_bloqueada to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- (A.2) handle_new_user endurecido
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
DECLARE
  v_username   text;
  v_name       text;
  v_role       role_enum;
  v_area       text;
  v_created_by uuid;
  v_hubo       boolean;
BEGIN
  -- ── B2B (0151): el cliente externo NO es empleado. Sin profile,
  -- is_active_user() es false y quedan cerradas las tablas cuya policy la llama.
  IF COALESCE(NEW.raw_user_meta_data->>'b2b', NEW.raw_app_meta_data->>'b2b') = 'true' THEN
    RETURN NEW;
  END IF;

  -- ── (0155) Sin marca interna no hay empleado.
  -- raw_app_meta_data solo lo puede escribir el service_role: el signup publico
  -- no llega hasta aca. Ver la cabecera de la migracion.
  IF COALESCE(NEW.raw_app_meta_data->>'interno', '') <> 'true' THEN
    INSERT INTO public.auth_alta_bloqueada (user_id, email, motivo, metadata)
    VALUES (NEW.id, NEW.email, 'alta sin app_metadata.interno: no se creo profile',
            NEW.raw_user_meta_data);

    -- Aviso al equipo, como maximo uno por hora. Se mira la bitacora y no un
    -- contador aparte: si el INSERT de arriba se revirtiera, el aviso tampoco
    -- se manda, que es lo correcto.
    SELECT EXISTS (
      SELECT 1 FROM public.auth_alta_bloqueada
       WHERE created_at > now() - interval '1 hour' AND user_id <> NEW.id
    ) INTO v_hubo;

    IF NOT v_hubo THEN
      INSERT INTO public.notifications (user_id, tipo, titulo, mensaje, link)
      SELECT pr.id, 'sistema',
             'Alguien intento registrarse solo',
             'Se creo una credencial sin invitacion (' || COALESCE(NEW.email, 's/d') ||
             ') y quedo SIN acceso, que es lo esperado. Si no lo hizo nadie del equipo, ' ||
             'conviene revisar que "Allow new users to sign up" siga apagado en Supabase.',
             NULL
        FROM public.profiles pr
       WHERE pr.active = true AND pr.role IN ('owner','admin');
    END IF;

    RETURN NEW;
  END IF;

  v_username := COALESCE(
    NEW.raw_user_meta_data->>'username',
    regexp_replace(lower(split_part(NEW.email, '@', 1)), '[^a-z0-9_]', '_', 'g')
  );

  v_name := COALESCE(NEW.raw_user_meta_data->>'name', v_username);

  -- Se sigue leyendo de user_metadata, y ahora es seguro: para llegar hasta
  -- esta linea el alta ya demostro venir del service_role.
  v_role := COALESCE(
    (NEW.raw_user_meta_data->>'role')::role_enum,
    'embalaje'::role_enum
  );

  v_area := NEW.raw_user_meta_data->>'area';

  v_created_by := NULLIF(NEW.raw_user_meta_data->>'created_by', '')::uuid;

  INSERT INTO public.profiles (id, username, name, email, role, area, created_by)
  VALUES (NEW.id, v_username, v_name, NEW.email, v_role, v_area, v_created_by);

  RETURN NEW;
EXCEPTION
  WHEN unique_violation THEN
    v_username := v_username || '_' || (floor(random() * 10000))::text;
    INSERT INTO public.profiles (id, username, name, email, role, area, created_by)
    VALUES (NEW.id, v_username, v_name, NEW.email, v_role, v_area, v_created_by);
    RETURN NEW;
END;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────
-- (A.3) Salida de emergencia: convertir en empleado una credencial que ya existe
--       Para el caso "lo cree desde el Dashboard y quedo sin profile". Owner-only.
--       No crea credenciales: solo le pone profile a una que ya esta en auth.users
--       y que no sea un cliente de la tienda.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.rpc_admin_alta_interna(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare
  v_rol role_enum; v_uid uuid; v_email text; v_username text; v_role role_enum;
begin
  v_rol := public.current_user_role();
  if v_rol is null or v_rol <> 'owner' then
    raise exception 'Solo el dueno puede dar de alta un empleado a mano.' using errcode='42501';
  end if;

  v_uid := nullif(p_payload->>'user_id','')::uuid;
  if v_uid is null then
    raise exception 'Falta user_id.' using errcode='22023';
  end if;

  select email into v_email from auth.users where id = v_uid;
  if v_email is null then
    raise exception 'Esa credencial no existe.' using errcode='P0002';
  end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'Ese usuario ya es empleado.' using errcode='0A000';
  end if;
  if exists (select 1 from public.b2b_usuario where id = v_uid) then
    raise exception 'Esa cuenta es de un cliente de la tienda.' using errcode='0A000';
  end if;

  v_username := coalesce(
    nullif(trim(p_payload->>'username'),''),
    regexp_replace(lower(split_part(v_email, '@', 1)), '[^a-z0-9_]', '_', 'g'));
  v_role := coalesce(nullif(trim(p_payload->>'role'),'')::role_enum, 'embalaje'::role_enum);

  insert into public.profiles (id, username, name, email, role, area, created_by)
  values (v_uid, v_username,
          coalesce(nullif(trim(p_payload->>'name'),''), v_username),
          v_email, v_role, nullif(trim(p_payload->>'area'),''), auth.uid());

  -- Deja de ser un alta bloqueada: ya se resolvio a mano.
  delete from public.auth_alta_bloqueada where user_id = v_uid;

  return jsonb_build_object('ok', true, 'user_id', v_uid, 'username', v_username, 'role', v_role);
end $fn$;
revoke execute on function public.rpc_admin_alta_interna(jsonb) from public, anon;
grant  execute on function public.rpc_admin_alta_interna(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- (B) Ficha B2B del cliente: canal, habilitacion, condicion de pago
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.b2b_rpc_admin_set_cliente(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare
  v_rol role_enum; v_id uuid; v_canal text; v_hab boolean; v_c public.customers_b2b%rowtype;
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

  -- Cambiar de canal cambia TODOS los precios que ese cliente ve de aca en
  -- adelante. Los pedidos ya enviados no se tocan: su precio quedo congelado
  -- en b2b_pedido_item.precio_unitario cuando se enviaron.
  if p_payload ? 'canal' then
    v_canal := nullif(trim(p_payload->>'canal'), '');
    if v_canal is null or not exists (select 1 from public.b2b_canal where codigo = v_canal and activo) then
      raise exception 'Canal invalido o inactivo (%).', coalesce(v_canal,'null') using errcode='22023';
    end if;
  end if;

  -- Apagar b2b_habilitado es el corte limpio: el cliente sigue existiendo, sus
  -- pedidos siguen ahi, pero b2b_fn_cliente_actual() deja de resolverlo y la
  -- tienda le muestra la pantalla de espera en vez de dejarlo pedir.
  if p_payload ? 'habilitado' then
    v_hab := (p_payload->>'habilitado')::boolean;
  end if;

  update public.customers_b2b set
    b2b_canal          = case when p_payload ? 'canal' then v_canal else b2b_canal end,
    b2b_habilitado     = case when p_payload ? 'habilitado' then coalesce(v_hab, b2b_habilitado) else b2b_habilitado end,
    b2b_condicion_pago = case when p_payload ? 'condicion_pago'
                              then nullif(trim(p_payload->>'condicion_pago'),'') else b2b_condicion_pago end,
    b2b_notas_internas = case when p_payload ? 'notas_internas'
                              then nullif(trim(p_payload->>'notas_internas'),'') else b2b_notas_internas end,
    es_mayorista       = case when p_payload ? 'habilitado' and coalesce(v_hab,false) then true else es_mayorista end
  where id = v_id;

  select * into v_c from public.customers_b2b where id = v_id;
  return jsonb_build_object(
    'ok', true, 'cliente_id', v_id, 'canal', v_c.b2b_canal,
    'habilitado', v_c.b2b_habilitado, 'condicion_pago', v_c.b2b_condicion_pago);
end $fn$;
revoke execute on function public.b2b_rpc_admin_set_cliente(jsonb) from public, anon;
grant  execute on function public.b2b_rpc_admin_set_cliente(jsonb) to authenticated;

-- Lista de clientes de la tienda para el panel: quienes son, en que canal
-- estan, cuantos compradores tienen y cuanto pidieron. Sin esto el admin ve
-- los usuarios pero no tiene una vista por CLIENTE, que es como se factura.
create or replace function public.b2b_rpc_admin_clientes(p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
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
      'canal', c.b2b_canal, 'habilitado', c.b2b_habilitado, 'activo', c.activo,
      'condicion_pago', c.b2b_condicion_pago, 'notas_internas', c.b2b_notas_internas,
      'coeficiente', ca.coeficiente,
      'usuarios', (select count(*) from public.b2b_usuario u where u.cliente_id = c.id),
      'usuarios_pendientes', (select count(*) from public.b2b_usuario u
                               where u.cliente_id = c.id and u.estado = 'pendiente'),
      'pedidos', (select count(*) from public.b2b_pedido p
                   where p.cliente_id = c.id and p.estado <> 'borrador'),
      'ultimo_pedido', (select max(p.enviado_at) from public.b2b_pedido p
                         where p.cliente_id = c.id and p.enviado_at is not null),
      -- b2b_pedido no guarda total: se suma de los items, donde subtotal es una
      -- columna generada (cantidad * precio_unitario congelado).
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
end $fn$;
revoke execute on function public.b2b_rpc_admin_clientes(jsonb) from public, anon;
grant  execute on function public.b2b_rpc_admin_clientes(jsonb) to authenticated;
