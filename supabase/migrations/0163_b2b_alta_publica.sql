-- ═══════════════════════════════════════════════════════════════════════════
-- 0163 — Alta por link: el cliente se crea su propio acceso
-- ───────────────────────────────────────────────────────────────────────────
-- Hasta acá había que emitir un código de invitación por cada comprador. El
-- dueño quiere mandar UN link y que del otro lado se registren solos y compren
-- en el momento, sin aprobación de por medio.
--
-- Esta RPC es la segunda mitad del alta. La primera la hace la edge function
-- 'b2b_signup' con service_role (crear el usuario de auth); acá se crea la
-- empresa y el comprador, ya aprobados.
--
-- ⚠ Es service_role y NADA más. Se revoca de public/anon/authenticated abajo.
-- Si alguna vez se le diera execute a 'authenticated', cualquier usuario
-- logueado podría fabricarse una empresa aprobada y comprar a precio
-- mayorista. La edge function es la única puerta.
--
-- LO QUE ESTA RPC NO HACE, A PROPÓSITO: si el CUIT ya existe, NO engancha al
-- que se registra a esa empresa con acceso directo. Lo deja 'pendiente'. Sin
-- eso, cualquiera que sepa el CUIT de un cliente (está en cualquier factura)
-- se registra, entra a esa cuenta y ve el historial de pedidos y los precios
-- de otra empresa. El alta directa vale para empresas nuevas; sumarse a una
-- que ya existe lo tiene que confirmar alguien.
-- ═══════════════════════════════════════════════════════════════════════════

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
  v_ya text;
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
  -- Si no cierra, se lo avisamos al equipo en la notificación y listo.
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
  -- contra customers_b2b_cuit_unique_idx con un 23505 crudo en la cara. Con
  -- esto, el segundo espera, ve la empresa que creó el primero y entra por la
  -- rama de 'pendiente', que es lo correcto.
  perform pg_advisory_xact_lock(hashtextextended('b2b_alta|' || v_cuit, 0));

  select id, nombre into v_cli, v_cli_nombre
    from public.customers_b2b where cuit = v_cuit;

  if found then
    -- Empresa conocida: entra como PENDIENTE (ver el encabezado del archivo).
    v_estado := 'pendiente';
    select count(*)::text into v_ya from public.b2b_usuario where cliente_id = v_cli;
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
    case when v_estado = 'aprobado' then now() else null end
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
    perform public.b2b_fn_avisar_interno(
      'sistema'::notif_type_enum,
      'Alguien quiere sumarse a ' || v_cli_nombre,
      v_nombre || ' (' || v_email || coalesce(' · ' || v_tel, '') || ') se registro con el CUIT ' ||
      v_cuit || ', que ya es de ' || v_cli_nombre || ' (' || coalesce(v_ya,'0') ||
      ' usuario/s). Queda PENDIENTE hasta que alguien confirme que trabaja ahi: ' ||
      'si lo aprobas va a ver los pedidos y los precios de ese cliente. ' ||
      'Ventas > Tienda mayorista > Accesos.',
      '/ventas?tab=mayoristas',
      array['owner','admin','ventas']::role_enum[]);
  end if;

  return jsonb_build_object('ok', true, 'ya_estaba', false, 'estado', v_estado,
                            'cliente', v_cli_nombre, 'cliente_id', v_cli,
                            'empresa_nueva', v_nuevo, 'canal', v_canal,
                            'cuit_valida', v_cuit_ok);
end $function$;

-- ⚠ Solo service_role. Ver el encabezado.
revoke all on function public.b2b_rpc_alta_publica(jsonb) from public;
revoke all on function public.b2b_rpc_alta_publica(jsonb) from anon;
revoke all on function public.b2b_rpc_alta_publica(jsonb) from authenticated;
grant execute on function public.b2b_rpc_alta_publica(jsonb) to service_role;
