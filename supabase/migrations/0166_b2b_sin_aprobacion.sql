-- ═══════════════════════════════════════════════════════════════════════════
-- 0166 — Sin aprobación: el que recibe el link entra y compra, siempre
-- ───────────────────────────────────────────────────────────────────────────
-- Decisión del dueño: no quiere aprobar nada. Manda un link, el comprador se
-- registra y queda adentro. Punto.
--
-- Hasta acá quedaban DOS caminos que igual pasaban por una aprobación a mano,
-- y los dos se cierran en esta migración:
--
--   1. b2b_rpc_alta_publica — registro abierto con un CUIT que YA es de un
--      cliente. Quedaba 'pendiente'.
--   2. b2b_rpc_canjear_invitacion — el que canjeaba un código quedaba
--      'pendiente' SIEMPRE, incluso siendo un código que emitió el equipo
--      para su dirección de correo.
--
-- Los dos pasan a quedar 'aprobado'.
--
-- ─── Lo que NO se toca, y por qué ─────────────────────────────────────────
-- La columna `estado` y el filtro `estado = 'aprobado'` de b2b_fn_cliente_actual
-- SIGUEN EXACTAMENTE IGUAL. Lo que se saca es la ESPERA, no el CONTROL: si el
-- estado dejara de mirarse, el dueño perdería el botón de suspender a alguien,
-- que es lo único que le queda para cortarle el acceso a un cliente que se
-- portó mal. Ahora se entra aprobado y, si hace falta, se suspende después.
--
-- Tampoco se toca b2b_habilitado cuando la empresa ya tiene compradores
-- adentro: b2b_habilitado = false es el CORTE POR DEUDA. Que se registre un
-- comprador nuevo no puede reabrirle la cuenta corriente a una empresa a la
-- que se le cortó a propósito. Es la misma regla que ya aplicaba
-- b2b_rpc_resolver_usuario con su `v_primera`, y acá se copia igual.
--
-- ─── ⚠ El costo de esto: el CUIT ajeno ────────────────────────────────────
-- Antes, registrarse con el CUIT de un cliente existente NO daba acceso a esa
-- cuenta justamente porque el CUIT de una empresa está en cualquier factura
-- suya. Ahora sí lo da. En criollo: quien consiga el CUIT de un cliente puede
-- registrarse y ver los pedidos y los precios de esa empresa.
--
-- Es una decisión de negocio del dueño, tomada sabiendo esto. Lo que queda del
-- lado del sistema para acompañarla:
--   · el aviso interno de ese caso se manda igual y dice CLARO que la persona
--     ya está adentro y qué se ve, con el link a la pantalla para suspenderla;
--   · suspender sigue siendo inmediato (b2b_rpc_resolver_usuario).
--
-- Si algún día se quiere volver atrás: alcanza con poner 'pendiente' de nuevo
-- en la rama `if found then` de b2b_rpc_alta_publica (está marcada abajo).
-- Nada más depende de eso.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────
-- (A) Registro abierto — el CUIT repetido ya no frena a nadie
-- ─────────────────────────────────────────────────────────────────────────
-- ⚠ Sigue siendo service_role y NADA más (los revoke están al final). Si se
-- le diera execute a 'authenticated', cualquier usuario logueado podría
-- fabricarse una empresa aprobada y comprar a precio mayorista.

create or replace function public.b2b_rpc_alta_publica(p_payload jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid; v_email text; v_nombre text; v_tel text;
  v_empresa text; v_cuit_d text; v_cuit text; v_loc text; v_prov text;
  v_canal text; v_canales text[];
  v_cli uuid; v_cli_nombre text; v_estado text; v_nuevo boolean := false;
  v_ya text; v_primera boolean := false;
  v_sum int := 0; v_i int; v_dv int; v_cuit_ok boolean := false;
  v_mult int[] := array[5,4,3,2,7,6,5,4,3,2];
begin
  perform public.b2b_fn_guard();

  v_uid     := nullif(p_payload->>'auth_uid','')::uuid;
  v_email   := lower(nullif(trim(p_payload->>'email'),''));
  v_nombre  := nullif(trim(p_payload->>'nombre'),'');
  v_tel     := nullif(trim(p_payload->>'telefono'),'');
  v_empresa := nullif(trim(p_payload->>'empresa'),'');
  v_loc     := nullif(trim(p_payload->>'localidad'),'');
  v_prov    := nullif(trim(p_payload->>'provincia'),'');
  v_canal   := nullif(trim(p_payload->>'canal'),'');

  if v_uid is null or v_email is null then
    raise exception 'Faltan datos de la cuenta.' using errcode='22023';
  end if;
  if v_nombre is null then
    raise exception 'Poné tu nombre y apellido.' using errcode='22023';
  end if;
  if v_empresa is null or length(v_empresa) < 2 then
    raise exception 'Poné el nombre de tu empresa o comercio.' using errcode='22023';
  end if;
  if length(v_empresa) > 120 then
    v_empresa := left(v_empresa, 120);   -- el CHECK de customers_b2b corta en 120
  end if;

  -- ── CUIT ───────────────────────────────────────────────────────────────
  -- Se guarda SIEMPRE como NN-NNNNNNNN-N: es el formato que exige
  -- customers_b2b_cuit_check y el que hace funcionar el índice único (si un
  -- mismo CUIT entrara con guiones y sin guiones serían dos empresas).
  v_cuit_d := regexp_replace(coalesce(p_payload->>'cuit',''), '[^0-9]', '', 'g');
  if length(v_cuit_d) <> 11 then
    raise exception 'El CUIT tiene que tener 11 números.' using errcode='22023';
  end if;
  v_cuit := substr(v_cuit_d,1,2) || '-' || substr(v_cuit_d,3,8) || '-' || substr(v_cuit_d,11,1);

  -- El dígito verificador se calcula pero NO bloquea el alta: un CUIT mal
  -- tipeado lo arregla el dueño en dos segundos desde el panel, mientras que
  -- rebotar a un comprador real un domingo a la noche lo pierde para siempre.
  for v_i in 1..10 loop
    v_sum := v_sum + (substr(v_cuit_d, v_i, 1))::int * v_mult[v_i];
  end loop;
  v_dv := 11 - (v_sum % 11);
  if v_dv = 11 then v_dv := 0; elsif v_dv = 10 then v_dv := 9; end if;
  v_cuit_ok := (v_dv = (substr(v_cuit_d, 11, 1))::int);

  -- ── Canal de arranque ──────────────────────────────────────────────────
  -- Se le habilitan los DOS catálogos: desde 0162 elige en cada ingreso. El
  -- que marcó en el registro es solo el que se le abre primero.
  select array_agg(codigo order by orden) into v_canales
    from public.b2b_canal where activo and codigo in ('mayorista','distribuidor');
  if v_canales is null or array_length(v_canales,1) = 0 then
    raise exception 'No hay catalogos habilitados en este momento.' using errcode='42501';
  end if;
  if v_canal is null or not (v_canal = any(v_canales)) then
    v_canal := v_canales[1];
  end if;

  -- ── ¿Ya se registró antes con este mismo usuario? ──────────────────────
  -- Reintento del alta (se cortó el wifi entre crear el auth user y esto).
  -- No es error: se le devuelve su estado y sigue.
  select u.estado, c.nombre, u.cliente_id into v_estado, v_cli_nombre, v_cli
    from public.b2b_usuario u join public.customers_b2b c on c.id = u.cliente_id
   where u.id = v_uid;
  if found then
    return jsonb_build_object('ok', true, 'ya_estaba', true, 'estado', v_estado,
                              'cliente', v_cli_nombre, 'cliente_id', v_cli,
                              'canal', v_canal);
  end if;

  -- ── ¿La empresa ya existe? ─────────────────────────────────────────────
  -- El cerrojo es por el CUIT: dos socios de la misma empresa registrándose
  -- al mismo tiempo pasarían los dos por el "no existe" y el segundo chocaría
  -- contra customers_b2b_cuit_unique_idx con un 23505 crudo en la cara.
  perform pg_advisory_xact_lock(hashtextextended('b2b_alta|' || v_cuit, 0));

  select id, nombre into v_cli, v_cli_nombre
    from public.customers_b2b where cuit = v_cuit;

  if found then
    -- ⚠ ACÁ ESTÁ EL CAMBIO DE 0166. Antes: v_estado := 'pendiente'.
    -- Empresa conocida: se suma a esa cuenta y entra derecho. Ver el aviso
    -- del final y el encabezado del archivo — con esto, el CUIT alcanza para
    -- ver los pedidos y los precios de esa empresa.
    v_estado := 'aprobado';
    select count(*)::text into v_ya from public.b2b_usuario where cliente_id = v_cli;

    -- Si la empresa está cargada pero todavía no tiene NINGÚN comprador
    -- aprobado, es una ficha que alguien cargó a mano y nunca se usó: se
    -- habilita, que es lo que hacía la aprobación. Si ya tiene compradores no
    -- se toca: b2b_habilitado = false ahí es el corte por deuda y un alta
    -- nueva no puede reabrir una cuenta corriente. Misma regla que el
    -- `v_primera` de b2b_rpc_resolver_usuario.
    v_primera := not exists (select 1 from public.b2b_usuario
                              where cliente_id = v_cli and estado = 'aprobado');
    if v_primera then
      update public.customers_b2b
         set es_mayorista = true, b2b_habilitado = true
       where id = v_cli;
    end if;
  else
    v_nuevo := true;
    v_estado := 'aprobado';
    insert into public.customers_b2b (
      nombre, cuit, email, telefono, localidad, provincia,
      activo, es_mayorista, b2b_canal, b2b_canales, b2b_habilitado, b2b_notas_internas
    ) values (
      v_empresa, v_cuit, v_email, v_tel, v_loc, v_prov,
      true, true, v_canal, v_canales, true,
      'Alta automática desde la tienda el ' || to_char(now(), 'DD/MM/YYYY') || '.' ||
      case when v_cuit_ok then '' else ' ⚠ El CUIT no valida: confirmalo antes de facturar.' end
    ) returning id, nombre into v_cli, v_cli_nombre;
  end if;

  insert into public.b2b_usuario (
    id, cliente_id, email, nombre, telefono, estado, es_titular,
    canal_activo, aprobado_at
  ) values (
    v_uid, v_cli, v_email, v_nombre, v_tel, v_estado, v_nuevo,
    -- canal_activo se deja NULL a propósito aunque ya haya elegido en el
    -- registro: así b2b_rpc_mi_cuenta devuelve canal_elegido=false y la
    -- tienda le muestra igual la pantalla de "¿qué catálogo querés ver?".
    -- Elegir el catálogo es la primera decisión de la compra, no un campo
    -- más del formulario de alta.
    null,
    now()
  );

  -- ── Aviso al equipo ────────────────────────────────────────────────────
  if v_nuevo then
    perform public.b2b_fn_avisar_interno(
      'sistema'::notif_type_enum,
      'Cliente nuevo en la tienda: ' || v_cli_nombre,
      v_nombre || ' (' || v_email || coalesce(' · ' || v_tel, '') || ') se registro solo y ' ||
      'ya puede comprar. Empresa: ' || v_cli_nombre || ' · CUIT ' || v_cuit ||
      coalesce(' · ' || v_loc, '') || coalesce(', ' || v_prov, '') || '.' ||
      case when v_cuit_ok then '' else ' ATENCION: el CUIT no valida, confirmalo antes de facturar.' end ||
      ' Revisalo en Ventas > Tienda mayorista > Clientes.',
      '/ventas?tab=mayoristas',
      array['owner','admin','ventas']::role_enum[]);
  else
    -- Este es el aviso importante desde 0166: no es un pedido de permiso, es
    -- un "ya entro". Tiene que decir qué ve y cómo sacarlo, porque nadie va a
    -- venir a preguntar.
    perform public.b2b_fn_avisar_interno(
      'sistema'::notif_type_enum,
      'Se sumo un comprador a ' || v_cli_nombre,
      v_nombre || ' (' || v_email || coalesce(' · ' || v_tel, '') || ') se registro con el CUIT ' ||
      v_cuit || ', que ya es de ' || v_cli_nombre || ' (' || coalesce(v_ya,'0') ||
      ' usuario/s de antes). YA ESTA ADENTRO: ve los pedidos y los precios de ese cliente. ' ||
      'Si no sabes quien es, suspendelo en Ventas > Tienda mayorista > Accesos.',
      '/ventas?tab=mayoristas',
      array['owner','admin','ventas']::role_enum[]);
  end if;

  return jsonb_build_object('ok', true, 'ya_estaba', false, 'estado', v_estado,
                            'cliente', v_cli_nombre, 'cliente_id', v_cli,
                            'empresa_nueva', v_nuevo, 'canal', v_canal,
                            'cuit_valida', v_cuit_ok);
end $function$;

-- ⚠ Solo service_role. La edge function b2b_signup es la única puerta.
revoke all on function public.b2b_rpc_alta_publica(jsonb) from public;
revoke all on function public.b2b_rpc_alta_publica(jsonb) from anon;
revoke all on function public.b2b_rpc_alta_publica(jsonb) from authenticated;
grant execute on function public.b2b_rpc_alta_publica(jsonb) to service_role;


-- ─────────────────────────────────────────────────────────────────────────
-- (B) Invitación — el que canjea un código entra en el momento
-- ─────────────────────────────────────────────────────────────────────────
-- Acá dejarlo en 'pendiente' nunca tuvo mucho sentido y ahora menos: el
-- código lo emitió alguien del equipo para UNA dirección de correo puntual, y
-- la función chequea abajo que la sesión sea la de ese correo. O sea que la
-- decisión ya la tomó el equipo cuando emitió la invitación; volver a pedirle
-- que apruebe es hacerle confirmar dos veces lo mismo.

create or replace function public.b2b_rpc_canjear_invitacion(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare
  v_inv public.b2b_invitacion%rowtype;
  v_uid uuid := auth.uid();
  v_email text; v_cliente_id uuid; v_nombre text;
  v_cli_nombre text; v_primera boolean;
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
  -- Esta es la validación que hace que aprobar a mano sobre esto sea redundante.
  if lower(v_inv.email) is distinct from lower(v_email) then
    raise exception 'La invitacion fue emitida para otro correo.' using errcode='42501';
  end if;

  v_cliente_id := v_inv.cliente_id;
  if v_cliente_id is null then
    -- Degradacion suave: si el CUIT congelado esta mal, el cliente entra igual (cuit es
    -- nullable) y el admin lo completa despues. Abortar aca dejaria una cuenta auth sin
    -- profile y sin b2b_usuario: irrecuperable.
    -- b2b_habilitado va TRUE (antes false): es una empresa que se crea en este
    -- mismo momento a partir de una invitación que emitió el equipo, no puede
    -- tener deuda. Dejarla en false era mandar al comprador a la pantalla de
    -- "falta habilitar tu cuenta" apenas terminaba de registrarse.
    insert into public.customers_b2b (nombre, cuit, email, es_mayorista, activo,
                                      b2b_canal, b2b_habilitado, created_by)
    values (left(v_inv.cliente_nombre, 120),
            case when v_inv.cliente_cuit ~ '^\d{2}-\d{8}-\d$' then v_inv.cliente_cuit else null end,
            v_inv.email, true, true,
            v_inv.canal, true, v_inv.created_by)
    returning id, nombre into v_cliente_id, v_cli_nombre;
  else
    -- Empresa que ya existe. Igual que en (A): se habilita solo si todavía no
    -- tiene ningún comprador aprobado. Si lo tiene y está en false, es el
    -- corte por deuda y no se toca.
    v_primera := not exists (select 1 from public.b2b_usuario
                              where cliente_id = v_cliente_id and estado = 'aprobado');
    update public.customers_b2b
       set b2b_canal      = coalesce(b2b_canal, v_inv.canal),
           es_mayorista   = true,
           b2b_habilitado = case when v_primera then true else b2b_habilitado end
     where id = v_cliente_id
    returning nombre into v_cli_nombre;
  end if;

  v_nombre := coalesce(nullif(trim(p_payload->>'nombre'),''), split_part(v_email, '@', 1));

  insert into public.b2b_usuario (id, cliente_id, email, nombre, telefono, estado,
                                  es_titular, aprobado_at)
  values (v_uid, v_cliente_id, v_email, v_nombre,
          nullif(trim(p_payload->>'telefono'),''), 'aprobado',
          not exists (select 1 from public.b2b_usuario where cliente_id = v_cliente_id),
          now());

  update public.b2b_invitacion
     set estado = 'usada', usada_at = now(), usada_por = v_uid
   where id = v_inv.id;

  -- Ya no es "aprobame esto": es "avisá que entró".
  perform public.b2b_fn_avisar_interno(
    'sistema'::notif_type_enum,
    'Canjearon la invitacion: ' || coalesce(v_cli_nombre, v_nombre),
    v_nombre || ' (' || v_email || ') canjeo su codigo y ya esta comprando' ||
    coalesce(' en ' || v_cli_nombre, '') || '. Si hace falta sacarle el acceso, ' ||
    'suspendelo en Ventas > Tienda mayorista > Accesos.',
    '/ventas?tab=mayoristas',
    array['owner','admin','ventas']::role_enum[]
  );

  return jsonb_build_object('ok', true, 'estado', 'aprobado',
                            'cliente', v_cli_nombre);
end $fn$;
revoke execute on function public.b2b_rpc_canjear_invitacion(jsonb) from public, anon;
grant  execute on function public.b2b_rpc_canjear_invitacion(jsonb) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- (C) Los que ya estaban esperando
-- ─────────────────────────────────────────────────────────────────────────
-- Si quedó alguien en 'pendiente' de antes, se lo aprueba: sería raro sacar
-- la aprobación y dejar a los que ya habían pedido acceso mirando la pantalla
-- de espera para siempre. 'rechazado' y 'suspendido' NO se tocan — esos son
-- decisiones que alguien tomó a propósito.
do $$
declare v_n int;
begin
  -- El orden importa: las empresas se miran MIENTRAS sus usuarios todavía
  -- figuran 'pendiente'. Al revés habría que adivinar después cuáles eran.
  update public.customers_b2b c
     set es_mayorista = true, b2b_habilitado = true
   where c.b2b_habilitado = false
     and exists (select 1 from public.b2b_usuario u
                  where u.cliente_id = c.id and u.estado = 'pendiente')
     -- Si ya tiene un comprador aprobado y aun así está en false, es el corte
     -- por deuda: se respeta.
     and not exists (select 1 from public.b2b_usuario u2
                      where u2.cliente_id = c.id and u2.estado = 'aprobado');

  update public.b2b_usuario
     set estado = 'aprobado', aprobado_at = coalesce(aprobado_at, now())
   where estado = 'pendiente';
  get diagnostics v_n = row_count;

  raise notice '0166: % usuario(s) pendientes quedaron aprobados.', v_n;
end $$;
