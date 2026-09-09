-- 0173: cada sector prende y apaga su propia jornada. Append-only.
--
-- Pedido del dueño (Seba, verbatim): "es una jornada por sector por día. No tiene que ser la
-- misma jornada de ventas ni nada por el estilo, porque esto es la parte de producción... el
-- encargado de cada área tiene que prender su jornada y cerrarla cuando se vaya... capaz el de
-- melamina trabajó y no trabajó el de patas o el de CNC. Entonces no puede ser que se prendan
-- todas las jornadas, sino por cada sector se prende una jornada."
--
-- Qué estaba roto (verificado contra el remoto, no supuesto):
--
--   (1) Había UNA sola jornada para toda la línea. La abría prod_rpc_abrir_jornada, con permiso
--       owner/admin/encargado — el operario de CNC no podía prender la suya ni por asomo. Y el
--       encargado, según el propio brief, "no carga producción": el que sabe si el sector
--       trabajó es el del sector.
--
--   (2) Peor: prod_rpc_abrir_jornada llama a fn_resolve_active_jornada(), que ESCRIBE en
--       public.jornadas. O sea que abrir la jornada de producción abría/creaba la jornada
--       COMERCIAL. Es justo el acople que la 0150 rompió para el cierre y que seguía intacto
--       para la apertura. Las RPC nuevas de acá no tocan `jornadas` ni una sola vez.
--
--   (3) Los cuatro registrar_* resolvían la jornada con prod_fn_jornada_activa(), que lee
--       `public.jornadas` — la comercial. La carga de producción dependía de que ventas hubiera
--       abierto su día. Si nadie lo abría: "Jornada inexistente" y el operario no podía cargar
--       lo que ya había fabricado.
--
--   (4) prod_fn_liberar_jornada_reservas(jornada) no filtraba por sector. Cuando alguien cerraba,
--       cancelaba las tareas reservadas de TODOS los sectores y les devolvía el material. El de
--       melamina cerraba a las 15h y le desarmaba la reserva al de pino, que seguía trabajando.
--
--   (5) prod_rpc_get_jornada_hoy hacía `where fase='en_ejecucion' limit 1` SIN order by. Con más
--       de una fila en esa fase el resultado era arbitrario entre llamadas — la pantalla podía
--       mostrar una jornada distinta cada vez que refrescabas.
--
-- Cómo queda:
--
--   prod_jornada_sector = un TURNO de un sector. Se abre y se cierra solo. El índice único
--   parcial garantiza "una sola abierta por sector" — a propósito NO es UNIQUE(fecha,sector),
--   porque Seba describió turnos que arrancan el día anterior y cierran a las 15h: un sector
--   puede tener dos turnos en el mismo día y uno que cruza la medianoche.
--
--   La jornada de demanda (prod_jornada) NO se congela al abrir el turno: se resuelve en cada
--   carga. Un turno que cruza un cierre de jornada sigue cargando contra la que esté abierta en
--   ese momento, y si no hay ninguna abierta la carga igual entra — el stock se mueve y queda
--   atada al turno. Producir es un hecho físico; que ventas no haya abierto el día no lo borra.
--
--   Cada registro de producción gana turno_id. Con eso el resumen de cierre de un sector es
--   exacto ("hoy cortaste 14 placas") en vez de contar todo lo de la jornada entera.
--
-- Lo que esta migración NO toca: orders, jornadas, free_stock, production_logs, ni ninguna
-- función comercial. LP no maneja estados comerciales (regla de alcance del dueño, 2026-07-23).
--
-- prod_rpc_abrir_jornada / prod_rpc_cerrar_jornada quedan como están, funcionando: son la
-- jornada de DEMANDA del encargado (la que vincula pedidos), no la de los sectores. Se
-- superponen sin pisarse.

-- ══════════════════════════════════════════════════════════════════════════════════════════
-- A. El turno de sector
-- ══════════════════════════════════════════════════════════════════════════════════════════

create table if not exists public.prod_jornada_sector (
  id           uuid primary key default gen_random_uuid(),
  jornada_id   uuid references public.prod_jornada(id) on delete set null,
  sector       text not null,
  estado       text not null default 'abierta',
  abierta_at   timestamptz not null default now(),
  abierta_por  uuid,
  cerrada_at   timestamptz,
  cerrada_por  uuid,
  resumen      jsonb,
  constraint prod_jornada_sector_sector_chk check (sector in ('cnc','melamina','pino','embalaje')),
  constraint prod_jornada_sector_estado_chk check (estado in ('abierta','cerrada')),
  -- cerrada ⇔ tiene fecha de cierre. Sin esto se puede quedar una fila 'cerrada' sin cerrada_at
  -- y el resumen del sector miente sobre cuándo terminó.
  constraint prod_jornada_sector_cierre_chk check ((estado = 'cerrada') = (cerrada_at is not null))
);

comment on table public.prod_jornada_sector is
  'Turno de trabajo de un sector. Lo abre y lo cierra el propio sector. Independiente de la jornada comercial y de la jornada de demanda del encargado.';

-- "Una sola ABIERTA por sector", que es lo que pidió Seba. Parcial y no sobre (fecha,sector)
-- porque los turnos cruzan la medianoche y puede haber dos en un mismo día.
create unique index if not exists ux_prod_jornada_sector_abierta
  on public.prod_jornada_sector (sector) where estado = 'abierta';

create index if not exists ix_prod_jornada_sector_jornada
  on public.prod_jornada_sector (jornada_id, sector);
create index if not exists ix_prod_jornada_sector_hist
  on public.prod_jornada_sector (sector, abierta_at desc);

alter table public.prod_jornada_sector enable row level security;

drop policy if exists prod_jornada_sector_sel on public.prod_jornada_sector;
create policy prod_jornada_sector_sel on public.prod_jornada_sector
  for select to authenticated using (public.current_user_role() is not null);

-- Escritura sólo por las RPC (SECURITY DEFINER). Sin policy de insert/update a propósito.
revoke all on table public.prod_jornada_sector from public, anon;
grant select on table public.prod_jornada_sector to authenticated;

-- De qué turno salió cada registro. Nullable: todo lo cargado antes de esta migración no tiene
-- turno, y eso está bien — no se inventa uno retroactivo.
alter table public.prod_corte     add column if not exists turno_id uuid references public.prod_jornada_sector(id) on delete set null;
alter table public.prod_melamina  add column if not exists turno_id uuid references public.prod_jornada_sector(id) on delete set null;
alter table public.prod_pino      add column if not exists turno_id uuid references public.prod_jornada_sector(id) on delete set null;
alter table public.prod_embalaje  add column if not exists turno_id uuid references public.prod_jornada_sector(id) on delete set null;

create index if not exists ix_prod_corte_turno    on public.prod_corte (turno_id);
create index if not exists ix_prod_melamina_turno on public.prod_melamina (turno_id);
create index if not exists ix_prod_pino_turno     on public.prod_pino (turno_id);
create index if not exists ix_prod_embalaje_turno on public.prod_embalaje (turno_id);

-- ══════════════════════════════════════════════════════════════════════════════════════════
-- B. Helpers
-- ══════════════════════════════════════════════════════════════════════════════════════════

-- El sector que le corresponde a un rol. Devuelve null para encargado/owner/admin: ellos NO
-- tienen sector propio, supervisan. Que puedan abrir el de otro es una decisión explícita del
-- gate, no un efecto colateral de este mapeo.
create or replace function public.prod_fn_sector_de_rol(p_role role_enum)
returns text language sql immutable set search_path to 'public','pg_temp' as $fn$
  select case p_role::text
    when 'cnc'      then 'cnc'
    when 'melamina' then 'melamina'
    when 'pino'     then 'pino'
    when 'embalaje' then 'embalaje'
    else null end
$fn$;

-- La jornada de demanda ABIERTA, si hay alguna. Null es una respuesta válida: significa "hoy
-- nadie vinculó pedidos", no un error.
create or replace function public.prod_fn_jornada_lp_abierta()
returns uuid language sql stable security definer set search_path to 'public','pg_temp' as $fn$
  select id from public.prod_jornada
   where fase = 'en_ejecucion' and estado = 'abierta'
   order by fecha desc, id
   limit 1
$fn$;

create or replace function public.prod_fn_sector_turno(p_sector text)
returns public.prod_jornada_sector
language sql stable security definer set search_path to 'public','pg_temp' as $fn$
  select * from public.prod_jornada_sector
   where sector = p_sector and estado = 'abierta'
   limit 1
$fn$;

-- Puerta de entrada de las cuatro RPC de carga. Si el sector no prendió su jornada, no se carga
-- nada — y el mensaje dice exactamente qué hacer, no "Jornada inexistente".
create or replace function public.prod_fn_exigir_turno(p_sector text)
returns public.prod_jornada_sector
language plpgsql stable security definer set search_path to 'public','pg_temp' as $fn$
declare t public.prod_jornada_sector;
begin
  t := public.prod_fn_sector_turno(p_sector);
  if t.id is null then
    raise exception 'La jornada de % todavia no esta abierta. Abrila con el boton de arriba para poder cargar.', p_sector
      using errcode = '42501';
  end if;
  return t;
end $fn$;

revoke execute on function public.prod_fn_exigir_turno(text) from public, anon, authenticated;
revoke execute on function public.prod_fn_sector_turno(text) from public, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════════════
-- C. Liberar reservas por sector
-- ══════════════════════════════════════════════════════════════════════════════════════════
--
-- Se reemplaza la de 1 argumento por una con p_sector opcional. Los llamadores existentes
-- (prod_rpc_cerrar_jornada, prod_fn_sync_jornada) siguen invocándola con un solo argumento y
-- caen en el default null = todos los sectores, que es el comportamiento que ya tenían.

drop function if exists public.prod_fn_liberar_jornada_reservas(uuid);

create or replace function public.prod_fn_liberar_jornada_reservas(p_jornada uuid, p_sector text default null)
returns void
language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare tr record; v_motivo text;
begin
  if p_jornada is null then return; end if;
  v_motivo := case when p_sector is null then 'cierre de jornada libera ' else 'cierre de '||p_sector||' libera ' end;
  for tr in select * from public.prod_tarea
             where jornada_id = p_jornada
               and estado in ('reservada','en_proceso')
               and (p_sector is null or sector = p_sector)
             for update loop
    if tr.reservado > 0 then
      perform public.prod_fn_stock_apply(tr.input_pool, tr.input_sku, tr.reservado, -tr.reservado, 0);
      insert into public.prod_stock_mov(jornada_id,tarea_id,pool,sku,tipo,cantidad,motivo,usuario)
        values(p_jornada, tr.id, tr.input_pool, tr.input_sku, 'devolver', tr.reservado, v_motivo||'reserva', auth.uid());
    end if;
    if tr.en_proceso > 0 then
      perform public.prod_fn_stock_apply(tr.input_pool, tr.input_sku, tr.en_proceso, 0, -tr.en_proceso);
      insert into public.prod_stock_mov(jornada_id,tarea_id,pool,sku,tipo,cantidad,motivo,usuario)
        values(p_jornada, tr.id, tr.input_pool, tr.input_sku, 'devolver', tr.en_proceso, v_motivo||'en_proceso', auth.uid());
    end if;
    update public.prod_tarea set estado='cancelada', reservado=0, en_proceso=0,
      nota = coalesce(nota,'') || ' [liberada por cierre'||coalesce(' de '||p_sector,'')||']'
     where id = tr.id;
  end loop;
end $fn$;

-- Igual que la firma de 1 argumento que reemplaza (0147): NO es invocable desde el cliente.
-- Sólo la llaman prod_rpc_cerrar_jornada, prod_rpc_sector_cerrar y prod_fn_sync_jornada, que
-- son SECURITY DEFINER. Sin este revoke cualquier logueado podria liberar reservas ajenas.
revoke execute on function public.prod_fn_liberar_jornada_reservas(uuid, text) from public, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════════════
-- D. Abrir / cerrar el turno de un sector
-- ══════════════════════════════════════════════════════════════════════════════════════════

create or replace function public.prod_rpc_sector_abrir(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_sector text; v_mio text;
        v_t public.prod_jornada_sector; v_j uuid; v_fecha date;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;

  v_mio    := public.prod_fn_sector_de_rol(v_role);
  v_sector := coalesce(nullif(trim(p_payload->>'sector'),''), v_mio);
  if v_sector is null then
    raise exception 'Falta indicar el sector.' using errcode='22023';
  end if;
  if v_sector not in ('cnc','melamina','pino','embalaje') then
    raise exception 'Sector invalido (cnc|melamina|pino|embalaje).' using errcode='22023';
  end if;
  -- El del sector abre el suyo. Encargado/owner/admin pueden abrir cualquiera, porque alguien
  -- tiene que poder destrabar el turno si el operario se fue sin abrirlo.
  if v_role not in ('owner','admin','encargado') and v_sector is distinct from v_mio then
    raise exception 'Solo podes abrir la jornada de tu sector.' using errcode='42501';
  end if;

  -- Serializa dos personas del mismo sector apretando el botón a la vez. Sin esto una de las
  -- dos se come el error feo del índice único en vez de recibir "ya estaba abierta".
  perform pg_advisory_xact_lock(hashtext('prod_turno:'||v_sector));

  v_t := public.prod_fn_sector_turno(v_sector);
  if v_t.id is not null then
    select fecha into v_fecha from public.prod_jornada where id = v_t.jornada_id;
    return jsonb_build_object('ok',true,'sector',v_sector,'turno_id',v_t.id,
      'jornada_id',v_t.jornada_id,'fecha',v_fecha,'abierta_at',v_t.abierta_at,
      'retomada',true,'mensaje','La jornada de este sector ya estaba abierta.');
  end if;

  v_j := public.prod_fn_jornada_lp_abierta();
  insert into public.prod_jornada_sector(jornada_id, sector, abierta_por)
    values (v_j, v_sector, auth.uid())
  returning * into v_t;
  select fecha into v_fecha from public.prod_jornada where id = v_j;

  return jsonb_build_object('ok',true,'sector',v_sector,'turno_id',v_t.id,
    'jornada_id',v_j,'fecha',v_fecha,'abierta_at',v_t.abierta_at,
    'retomada',false,
    -- Que no haya jornada de demanda no impide trabajar, pero el sector merece saberlo: sin
    -- ella no va a ver pedidos vinculados, sólo su carga libre.
    'sin_jornada_demanda', (v_j is null));
end $fn$;

revoke all on function public.prod_rpc_sector_abrir(jsonb) from public, anon;
grant execute on function public.prod_rpc_sector_abrir(jsonb) to authenticated;


create or replace function public.prod_rpc_sector_cerrar(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_sector text; v_mio text;
        v_t public.prod_jornada_sector; v_res jsonb; v_jl uuid; v_hs numeric;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;

  v_mio    := public.prod_fn_sector_de_rol(v_role);
  v_sector := coalesce(nullif(trim(p_payload->>'sector'),''), v_mio);
  if v_sector is null then raise exception 'Falta indicar el sector.' using errcode='22023'; end if;
  if v_role not in ('owner','admin','encargado') and v_sector is distinct from v_mio then
    raise exception 'Solo podes cerrar la jornada de tu sector.' using errcode='42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('prod_turno:'||v_sector));

  select * into v_t from public.prod_jornada_sector
   where sector = v_sector and estado = 'abierta' for update;
  if not found then
    raise exception 'La jornada de % no esta abierta.', v_sector using errcode='42501';
  end if;

  -- Lo que hizo ESTE turno, no lo que hizo la jornada entera.
  v_res := case v_sector
    when 'cnc' then (select jsonb_build_object(
        'cargas', count(*), 'hojas', coalesce(sum(hojas),0), 'desperdicio', coalesce(sum(desperdicio),0))
      from public.prod_corte where turno_id = v_t.id)
    when 'melamina' then (select jsonb_build_object(
        'cargas', count(*), 'terminadas', coalesce(sum(terminadas),0), 'fallas', coalesce(sum(fallas),0))
      from public.prod_melamina where turno_id = v_t.id)
    when 'pino' then (select jsonb_build_object(
        'cargas', count(*), 'terminadas', coalesce(sum(terminadas),0), 'masilladas', coalesce(sum(masilladas),0))
      from public.prod_pino where turno_id = v_t.id)
    when 'embalaje' then (select jsonb_build_object(
        'cargas', count(*), 'unidades', coalesce(sum(unidades),0))
      from public.prod_embalaje where turno_id = v_t.id)
  end;

  update public.prod_jornada_sector
     set estado='cerrada', cerrada_at=now(), cerrada_por=auth.uid(), resumen=v_res
   where id = v_t.id;

  -- Sólo las tareas de ESTE sector. Antes el cierre de melamina le desarmaba la reserva a pino.
  perform public.prod_fn_liberar_jornada_reservas(v_t.jornada_id, v_sector);
  v_jl := public.prod_fn_jornada_lp_abierta();
  if v_jl is not null and v_jl is distinct from v_t.jornada_id then
    -- El turno cruzó un cambio de jornada: las tareas que dejó reservadas están en la nueva.
    perform public.prod_fn_liberar_jornada_reservas(v_jl, v_sector);
  end if;

  v_hs := round(extract(epoch from (now() - v_t.abierta_at)) / 3600.0, 1);

  return jsonb_build_object('ok',true,'sector',v_sector,'turno_id',v_t.id,
    'abierta_at',v_t.abierta_at,'cerrada_at',now(),'horas',v_hs,'resumen',v_res);
end $fn$;

revoke all on function public.prod_rpc_sector_cerrar(jsonb) from public, anon;
grant execute on function public.prod_rpc_sector_cerrar(jsonb) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════════════
-- E. Estado de los sectores (lo que pinta la pantalla)
-- ══════════════════════════════════════════════════════════════════════════════════════════

create or replace function public.prod_rpc_sector_estado(p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_mio text; v_j uuid; v_fecha date; v_out jsonb;
begin
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('cnc','melamina','pino','embalaje','encargado','owner','admin') then
    raise exception 'Sin permiso.' using errcode='42501';
  end if;

  v_mio := public.prod_fn_sector_de_rol(v_role);
  v_j   := public.prod_fn_jornada_lp_abierta();
  select fecha into v_fecha from public.prod_jornada where id = v_j;

  select coalesce(jsonb_agg(x order by x->>'sector'), '[]'::jsonb) into v_out from (
    select jsonb_build_object(
      'sector', s.sector,
      'abierta', (t.id is not null),
      'turno_id', t.id,
      'abierta_at', t.abierta_at,
      'abierta_por', t.abierta_por,
      'abierta_por_nombre', p.name,
      'jornada_id', t.jornada_id,
      -- El último cierre sirve para el cartel "cerró hace 3 h" del panel del encargado.
      'ultimo_cierre', (select max(z.cerrada_at) from public.prod_jornada_sector z
                         where z.sector = s.sector and z.estado='cerrada')
    ) as x
    from (values ('cnc'),('melamina'),('pino'),('embalaje')) as s(sector)
    left join public.prod_jornada_sector t
           on t.sector = s.sector and t.estado = 'abierta'
    left join public.profiles p on p.id = t.abierta_por
  ) q;

  return jsonb_build_object(
    'mi_sector', v_mio,
    'jornada_id', v_j,
    'fecha', v_fecha,
    'hay_jornada_demanda', (v_j is not null),
    'sectores', v_out);
end $fn$;

revoke all on function public.prod_rpc_sector_estado(jsonb) from public, anon;
grant execute on function public.prod_rpc_sector_estado(jsonb) to authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════════════
-- F. get_jornada_hoy determinista
-- ══════════════════════════════════════════════════════════════════════════════════════════
--
-- `limit 1` sin order by sobre varias filas en fase='en_ejecucion' devolvía cualquiera. Ahora
-- prefiere la abierta y, entre iguales, la más reciente. Se sigue devolviendo la cerrada cuando
-- es la única, para que la pantalla pueda decir "jornada cerrada" en vez de quedarse muda.

create or replace function public.prod_rpc_get_jornada_hoy(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_j record;
begin
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('cnc','melamina','pino','embalaje','encargado','owner','admin') then
    raise exception 'Sin permiso.' using errcode='42501';
  end if;
  select id, fecha, estado into v_j
    from public.prod_jornada
   where fase = 'en_ejecucion'
   order by (estado = 'abierta') desc, fecha desc, id
   limit 1;
  if not found then return 'null'::jsonb; end if;
  return jsonb_build_object('jornada_id', v_j.id, 'fecha', v_j.fecha, 'estado', v_j.estado);
end $fn$;

-- ══════════════════════════════════════════════════════════════════════════════════════════
-- G. Las cuatro cargas dejan de depender de la jornada comercial
-- ══════════════════════════════════════════════════════════════════════════════════════════
--
-- El cambio es el mismo en las cuatro y sólo toca el bloque de resolución de jornada:
--
--   ANTES: jornada = payload.jornada_id ?? prod_fn_jornada_activa()   ← la COMERCIAL
--          si no existe o no está abierta ⇒ error, no se carga nada.
--
--   AHORA: se exige el turno del sector (si no lo abriste, no cargás).
--          jornada = payload.jornada_id ?? prod_fn_jornada_lp_abierta()   ← la de DEMANDA, o null
--          null es válido: la carga entra igual, atada al turno.
--
-- El payload explícito se sigue respetando: es lo que arreglaron 1311b7d y d65ad46 ("la carga
-- va a la jornada que estás viendo, no a la activa"). Si esa jornada está cerrada, se avisa.
-- El resto del cuerpo de cada función queda idéntico.

create or replace function public.prod_rpc_registrar_corte(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_jornada uuid; v_est text;
  v_placa text; v_hojas int; v_desp int; v_rend int; v_pieza text; v_gen int; v_id uuid;
  v_mp text; v_oblig boolean; v_mpdisp int; v_turno public.prod_jornada_sector;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('cnc','encargado','owner','admin') then raise exception 'Sin permiso.' using errcode='42501'; end if;

  v_turno := public.prod_fn_exigir_turno('cnc');
  v_jornada := coalesce(nullif(p_payload->>'jornada_id','')::uuid, public.prod_fn_jornada_lp_abierta());
  if v_jornada is not null then
    select estado into v_est from prod_jornada where id = v_jornada;
    if v_est is null then raise exception 'Jornada inexistente.' using errcode='P0002'; end if;
    if v_est <> 'abierta' then raise exception 'Esa jornada ya esta cerrada (%). Elegi una abierta o carga sin jornada.', v_est using errcode='42501'; end if;
  end if;

  v_placa := p_payload->>'placa_sku';
  v_hojas := public.prod_fn_int_arg(p_payload,'hojas',1,true);
  v_desp  := public.prod_fn_int_arg(p_payload,'desperdicio',0,false,0);
  select rendimiento, pieza_sku, mp_sku into v_rend, v_pieza, v_mp from prod_placa where sku = v_placa;
  if not found then raise exception 'Placa % no existe.', v_placa using errcode='22023'; end if;
  if v_pieza is null then raise exception 'La placa % no tiene pieza asociada.', v_placa using errcode='22023'; end if;
  perform public.prod_fn_liberar_tareas_output(v_jornada, 'cnc', v_pieza);  -- coordinación reserva↔directa
  v_oblig := public.prod_cfg_int('mp_consumo_obligatorio',1) = 1;
  if v_mp is not null then
    perform 1 from prod_stock_mp where mp_sku=v_mp for update;
    v_mpdisp := public.prod_fn_stock_disp('mp', v_mp);
    if v_mpdisp < v_hojas then raise exception 'Stock de placas insuficiente (disp %, requiere % hojas de %).', v_mpdisp, v_hojas, v_mp using errcode='42501'; end if;
    perform public.prod_fn_stock_apply('mp', v_mp, -v_hojas, 0, 0);
    insert into prod_stock_mov(jornada_id,pool,sku,tipo,cantidad,usuario) values (v_jornada,'mp',v_mp,'consumir',v_hojas,auth.uid());
  elsif v_oblig then
    raise exception 'Configuracion incompleta: la placa % no tiene materia prima configurada.', v_placa using errcode='42501';
  end if;
  v_gen := greatest(v_hojas * coalesce(v_rend,0) - v_desp, 0);
  insert into prod_corte (jornada_id, turno_id, placa_sku, hojas, desperdicio, cargado_por, editable_hasta)
  values (v_jornada, v_turno.id, v_placa, v_hojas, v_desp, auth.uid(), now() + interval '24 hours') returning id into v_id;
  insert into prod_stock_pieza (pieza_sku, disponible) values (v_pieza, v_gen)
  on conflict (pieza_sku) do update set disponible = prod_stock_pieza.disponible + v_gen, updated_at = now();
  return jsonb_build_object('ok', true, 'corte_id', v_id, 'piezas_generadas', v_gen,
    'turno_id', v_turno.id, 'jornada_id', v_jornada, 'sin_jornada_demanda', (v_jornada is null));
end $fn$;


create or replace function public.prod_rpc_registrar_melamina(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_jornada uuid; v_est text;
  v_pieza text; v_term int; v_fallas int; v_consumo int; v_disp int; v_id uuid; v_rest int;
  v_turno public.prod_jornada_sector;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('melamina','encargado','owner','admin') then raise exception 'Sin permiso.' using errcode='42501'; end if;

  v_turno := public.prod_fn_exigir_turno('melamina');
  v_jornada := coalesce(nullif(p_payload->>'jornada_id','')::uuid, public.prod_fn_jornada_lp_abierta());
  if v_jornada is not null then
    select estado into v_est from prod_jornada where id = v_jornada;
    if v_est is null then raise exception 'Jornada inexistente.' using errcode='P0002'; end if;
    if v_est <> 'abierta' then raise exception 'Esa jornada ya esta cerrada (%). Elegi una abierta o carga sin jornada.', v_est using errcode='42501'; end if;
  end if;

  v_pieza := p_payload->>'pieza_sku';
  v_term  := public.prod_fn_int_arg(p_payload,'terminadas',0,false,0);
  v_fallas:= public.prod_fn_int_arg(p_payload,'fallas',0,false,0);
  v_consumo := v_term + v_fallas;
  if v_consumo <= 0 then raise exception 'Debe registrar al menos una pieza (terminadas o fallas).' using errcode='22023'; end if;
  select coalesce(disponible,0) into v_disp from prod_stock_pieza where pieza_sku = v_pieza;
  v_disp := coalesce(v_disp, 0);
  -- Este bloqueo se mantiene a propósito: melamina no puede terminar más piezas de las que CNC
  -- cortó. Es el único límite físico duro de la línea (brief de Seba).
  if v_disp < v_consumo then raise exception 'Stock de piezas crudas insuficiente (disp %, requiere %).', v_disp, v_consumo using errcode='42501'; end if;

  insert into prod_melamina (jornada_id, turno_id, pieza_sku, terminadas, fallas, cargado_por, editable_hasta)
  values (v_jornada, v_turno.id, v_pieza, v_term, v_fallas, auth.uid(), now() + interval '24 hours') returning id into v_id;
  update prod_stock_pieza set disponible = disponible - v_consumo, updated_at = now() where pieza_sku = v_pieza returning disponible into v_rest;
  insert into prod_stock_melamina (pieza_sku, disponible) values (v_pieza, v_term)
  on conflict (pieza_sku) do update set disponible = prod_stock_melamina.disponible + v_term, updated_at = now();

  return jsonb_build_object('ok', true, 'melamina_id', v_id, 'stock_pieza_restante', v_rest,
    'turno_id', v_turno.id, 'jornada_id', v_jornada, 'sin_jornada_demanda', (v_jornada is null));
end $fn$;


create or replace function public.prod_rpc_registrar_pino(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_jornada uuid; v_est text;
  v_tamano text; v_term int; v_mas int; v_id uuid; v_disp int; v_masT int;
  v_pr record; v_oblig boolean; v_units int; v_mpdisp int; v_turno public.prod_jornada_sector;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('pino','encargado','owner','admin') then raise exception 'Sin permiso.' using errcode='42501'; end if;

  v_turno := public.prod_fn_exigir_turno('pino');
  v_jornada := coalesce(nullif(p_payload->>'jornada_id','')::uuid, public.prod_fn_jornada_lp_abierta());
  if v_jornada is not null then
    select estado into v_est from prod_jornada where id = v_jornada;
    if v_est is null then raise exception 'Jornada inexistente.' using errcode='P0002'; end if;
    if v_est <> 'abierta' then raise exception 'Esa jornada ya esta cerrada (%). Elegi una abierta o carga sin jornada.', v_est using errcode='42501'; end if;
  end if;

  v_tamano := p_payload->>'tamano';
  if v_tamano not in ('chica','grande') then raise exception 'tamano invalido (chica|grande).' using errcode='22023'; end if;
  v_term := public.prod_fn_int_arg(p_payload,'terminadas',0,false,0);
  v_mas  := public.prod_fn_int_arg(p_payload,'masilladas',0,false,0);
  if (v_term + v_mas) <= 0 then raise exception 'Debe registrar al menos una pata (terminadas o masilladas).' using errcode='22023'; end if;
  perform public.prod_fn_liberar_tareas_output(v_jornada, 'pino', v_tamano);  -- coordinación reserva↔directa
  v_oblig := public.prod_cfg_int('mp_consumo_obligatorio',1) = 1;
  select * into v_pr from prod_pino_receta where tamano=v_tamano;
  if found then
    v_units := ceil((v_term + v_mas)::numeric / v_pr.patas_por_unidad)::int;
    perform 1 from prod_stock_mp where mp_sku=v_pr.mp_sku for update;
    v_mpdisp := public.prod_fn_stock_disp('mp', v_pr.mp_sku);
    if v_mpdisp < v_units then raise exception 'Stock de materia prima de pino insuficiente (disp %, requiere %).', v_mpdisp, v_units using errcode='42501'; end if;
    perform public.prod_fn_stock_apply('mp', v_pr.mp_sku, -v_units, 0, 0);
    insert into prod_stock_mov(jornada_id,pool,sku,tipo,cantidad,usuario) values (v_jornada,'mp',v_pr.mp_sku,'consumir',v_units,auth.uid());
  elsif v_oblig then
    raise exception 'Configuracion incompleta: no hay receta de materia prima para patas %.', v_tamano using errcode='42501';
  end if;
  insert into prod_pino (jornada_id, turno_id, tamano, terminadas, masilladas, cargado_por, editable_hasta)
  values (v_jornada, v_turno.id, v_tamano, v_term, v_mas, auth.uid(), now() + interval '24 hours') returning id into v_id;
  insert into prod_stock_patas (tamano, disponible, masilladas) values (v_tamano, v_term, v_mas)
  on conflict (tamano) do update set disponible = prod_stock_patas.disponible + v_term,
    masilladas = prod_stock_patas.masilladas + v_mas, updated_at = now()
  returning disponible, masilladas into v_disp, v_masT;
  return jsonb_build_object('ok', true, 'pino_id', v_id,
    'stock_patas', jsonb_build_object('tamano', v_tamano, 'disponible', v_disp, 'masilladas', v_masT),
    'turno_id', v_turno.id, 'jornada_id', v_jornada, 'sin_jornada_demanda', (v_jornada is null));
end $fn$;


create or replace function public.prod_rpc_registrar_embalaje(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_jornada uuid; v_est text; v_prod text; v_unid int; v_canal text;
  v_desconocidas text; v_id uuid; v_reqid text; v_hash text; v_ins int; v_prev jsonb; v_prev_hash text;
  v_rest int; v_take int; v_libre int; v_o record; v_falta text; res jsonb;
  v_turno public.prod_jornada_sector;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('embalaje','encargado','owner','admin') then raise exception 'Sin permiso.' using errcode='42501'; end if;

  v_turno := public.prod_fn_exigir_turno('embalaje');
  v_jornada := coalesce(nullif(p_payload->>'jornada_id','')::uuid, public.prod_fn_jornada_lp_abierta());
  if v_jornada is not null then
    select estado into v_est from prod_jornada where id = v_jornada;
    if v_est is null then raise exception 'Jornada inexistente.' using errcode='P0002'; end if;
    if v_est <> 'abierta' then raise exception 'Esa jornada ya esta cerrada (%). Elegi una abierta o carga sin jornada.', v_est using errcode='42501'; end if;
  end if;

  v_prod := p_payload->>'producto_sku';
  v_unid := coalesce((p_payload->>'unidades')::int, 0);
  v_canal := nullif(trim(p_payload->>'canal'),'');
  if v_unid <= 0 then raise exception 'unidades debe ser > 0.' using errcode='22023'; end if;
  if not exists (select 1 from prod_producto where sku=v_prod) then raise exception 'Producto % no existe.', v_prod using errcode='22023'; end if;
  if not exists (select 1 from prod_receta where producto_sku=v_prod)
     and not exists (select 1 from prod_componente where padre_sku=v_prod) then
    raise exception 'Configuracion incompleta: el producto % no tiene receta ni componentes (BOM).', v_prod using errcode='42501';
  end if;
  v_reqid := nullif(p_payload->>'request_id','');
  if v_reqid is not null then
    v_hash := md5('registrar_embalaje|'||v_prod||'|'||v_unid::text||'|'||coalesce(v_jornada::text,''));
    insert into prod_idempotencia(request_id, rpc, op_hash) values (v_reqid,'registrar_embalaje',v_hash)
      on conflict (request_id) do nothing;
    get diagnostics v_ins = row_count;
    if v_ins = 0 then
      select op_hash, resultado into v_prev_hash, v_prev from prod_idempotencia where request_id=v_reqid for update;
      if v_prev_hash is distinct from v_hash then
        raise exception 'request_id reutilizado con un payload distinto.' using errcode='23505';
      end if;
      return v_prev;
    end if;
  end if;
  with recursive bom as (select hijo_sku sku, 1 lvl from prod_componente where padre_sku=v_prod
    union all select c.hijo_sku, b.lvl+1 from bom b join prod_componente c on c.padre_sku=b.sku where b.lvl<20)
  select string_agg(distinct x.sku, ', ') into v_desconocidas from (select distinct sku from bom) x
  where not exists (select 1 from prod_componente c where c.padre_sku=x.sku) and public.prod_pieza_pool(x.sku)='desconocido';
  if v_desconocidas is not null then raise exception 'Configuracion incompleta: componentes sin pool (%).', v_desconocidas using errcode='42501'; end if;
  drop table if exists _patas_req;
  create temp table _patas_req on commit drop as
    with recursive bom as (select hijo_sku sku, cantidad::numeric qty, 1 lvl from prod_componente where padre_sku=v_prod
      union all select c.hijo_sku, b.qty*c.cantidad, b.lvl+1 from bom b join prod_componente c on c.padre_sku=b.sku where b.lvl<20)
    select t.tamano, (sum(b.qty)*v_unid)::int need from bom b join prod_pata_tamano t on t.pieza_sku=b.sku group by t.tamano;
  drop table if exists _ins_req;
  create temp table _ins_req on commit drop as
    with recursive bom as (select hijo_sku sku, cantidad::numeric qty, 1 lvl from prod_componente where padre_sku=v_prod
      union all select c.hijo_sku, b.qty*c.cantidad, b.lvl+1 from bom b join prod_componente c on c.padre_sku=b.sku where b.lvl<20),
    hojas as (select sku, sum(qty) qty from bom b where not exists(select 1 from prod_componente c where c.padre_sku=b.sku) group by sku)
    select i.sku, (h.qty*v_unid)::int need from hojas h join prod_insumo i on i.sku=h.sku;
  perform 1 from prod_stock_melamina where pieza_sku in
    (select r.pieza_sku from prod_receta r where r.producto_sku=v_prod and public.prod_pieza_pool(r.pieza_sku)='melamina')
    order by pieza_sku for update;
  perform 1 from prod_stock_patas where tamano in (select tamano from _patas_req) order by tamano for update;
  perform 1 from prod_insumo where sku in (select sku from _ins_req) order by sku for update;
  select string_agg(r.pieza_sku,',') into v_falta from prod_receta r left join prod_stock_melamina sm on sm.pieza_sku=r.pieza_sku
    where r.producto_sku=v_prod and public.prod_pieza_pool(r.pieza_sku)='melamina' and coalesce(sm.disponible,0) < v_unid*r.cantidad;
  if v_falta is not null then raise exception 'Stock de melamina insuficiente (%).', v_falta using errcode='42501'; end if;
  select string_agg(pr.tamano,',') into v_falta from _patas_req pr left join prod_stock_patas sp on sp.tamano=pr.tamano where coalesce(sp.disponible,0) < pr.need;
  if v_falta is not null then raise exception 'Stock de patas insuficiente (%).', v_falta using errcode='42501'; end if;
  select string_agg(ir.sku,',') into v_falta from _ins_req ir join prod_insumo i on i.sku=ir.sku where coalesce(i.stock_actual,0) < ir.need;
  if v_falta is not null then raise exception 'Stock de insumo insuficiente (%).', v_falta using errcode='42501'; end if;
  update prod_stock_melamina sm set disponible = sm.disponible - (v_unid*r.cantidad), updated_at=now()
    from prod_receta r where r.producto_sku=v_prod and sm.pieza_sku=r.pieza_sku and public.prod_pieza_pool(r.pieza_sku)='melamina';
  update prod_stock_patas sp set disponible = sp.disponible - pr.need, updated_at=now() from _patas_req pr where sp.tamano=pr.tamano;
  insert into prod_embalaje (jornada_id, turno_id, producto_sku, unidades, canal, cargado_por)
    values (v_jornada, v_turno.id, v_prod, v_unid, v_canal, auth.uid()) returning id into v_id;
  perform pg_advisory_xact_lock(hashtext('prod_term:'||v_prod));
  v_rest := v_unid;
  -- Sin jornada de demanda no hay pedidos vinculados: todo va a stock libre. El bucle se saltea
  -- solo (jo.jornada_id = null no matchea), pero se explicita para que se lea la intención.
  if v_jornada is not null then
    for v_o in (select jo.order_id, jo.snapshot_cantidad,
                  greatest(jo.snapshot_cantidad - public.prod_fn_asignado(jo.order_id, jo.snapshot_sku),0) as pendiente
                from prod_jornada_orden jo join orders ord on ord.id=jo.order_id
                where jo.jornada_id=v_jornada and jo.snapshot_sku=v_prod
                  and coalesce(jo.snapshot_status,'') not in ('cancelada','cumplida')
                  and ord.cancelled_at is null and ord.status::text in ('pendiente','arrastrado')
                  and not public.prod_fn_orden_excluida(jo.order_id)
                order by ord.created_at asc, public.prod_fn_natkey(ord.order_number) asc, jo.order_id) loop
      exit when v_rest <= 0;
      v_take := least(v_o.pendiente, v_rest);
      if v_take > 0 then
        insert into prod_asignacion(order_id,producto_sku,jornada_id,cantidad,tipo,origen,request_id,usuario)
          values (v_o.order_id, v_prod, v_jornada, v_take, 'asignada', 'embalaje', v_reqid, auth.uid());
        v_rest := v_rest - v_take;
      end if;
    end loop;
  end if;
  if v_rest > 0 then
    insert into prod_stock_terminado(producto_sku, disponible) values (v_prod, v_rest)
      on conflict (producto_sku) do update set disponible = prod_stock_terminado.disponible + v_rest, updated_at=now();
  end if;
  select coalesce(disponible,0) into v_libre from prod_stock_terminado where producto_sku=v_prod;
  res := jsonb_build_object('ok',true,'embalaje_id',v_id,'unidades',v_unid,
    'asignadas_a_pedidos', v_unid - v_rest, 'a_stock_libre', v_rest, 'stock_terminado_libre', v_libre,
    'turno_id', v_turno.id, 'jornada_id', v_jornada, 'sin_jornada_demanda', (v_jornada is null));
  if v_reqid is not null then update prod_idempotencia set resultado=res where request_id=v_reqid; end if;
  return res;
end $fn$;

-- ══════════════════════════════════════════════════════════════════════════════════════════
-- H. Historial de turnos (lo consume el panel del encargado)
-- ══════════════════════════════════════════════════════════════════════════════════════════

-- security_invoker=on por 0125: todas las prod_v_* respetan la RLS del que consulta. Una
-- vista nueva sin esa marca reabriria el agujero que 0125 cerro.
create or replace view public.prod_v_turnos with (security_invoker = true) as
select t.id, t.sector, t.estado, t.jornada_id, j.fecha as jornada_fecha,
       t.abierta_at, t.cerrada_at,
       round(extract(epoch from (coalesce(t.cerrada_at, now()) - t.abierta_at)) / 3600.0, 1) as horas,
       t.abierta_por, pa.name as abierta_por_nombre,
       t.cerrada_por, pc.name as cerrada_por_nombre,
       t.resumen
from public.prod_jornada_sector t
left join public.prod_jornada j on j.id = t.jornada_id
left join public.profiles pa on pa.id = t.abierta_por
left join public.profiles pc on pc.id = t.cerrada_por;

revoke all on public.prod_v_turnos from public, anon;
grant select on public.prod_v_turnos to authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════════════
-- I. Realtime
-- ══════════════════════════════════════════════════════════════════════════════════════════
--
-- Las cuatro pantallas de sector escuchan `prod_jornada_sector` para que el chip del turno y el
-- boton se actualicen solos. Sin esto el operario abre la jornada en el celular y la pantalla
-- del taller sigue diciendo "cerrada" hasta que alguien recargue: exactamente la clase de
-- desincronizacion que hace que se cargue produccion en el turno equivocado.
--
-- Idempotente y silencioso, igual que 0077/0078: si la publicacion no existe, no se rompe nada.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'publicacion supabase_realtime inexistente - se omite';
  elsif not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'prod_jornada_sector'
  ) then
    alter publication supabase_realtime add table public.prod_jornada_sector;
  end if;
end $$;

-- Rollback:
--   alter publication supabase_realtime drop table public.prod_jornada_sector;
