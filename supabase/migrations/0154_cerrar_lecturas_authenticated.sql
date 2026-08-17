-- 0154 · Cierra las lecturas abiertas a "cualquier authenticated".
--
-- POR QUE EXISTE ESTA MIGRACION
-- Hasta hoy TODOS los usuarios de auth.users son empleados: hay 16 usuarios y 16 profiles,
-- cero usuarios sin profile. Con esa realidad, "authenticated" y "empleado interno" eran
-- sinonimos, y por eso nadie noto que hay lecturas abiertas sin predicado.
-- 0151 rompe esa equivalencia: crea el PRIMER principal authenticated sin profile (el cliente
-- B2B). Del otro lado de estas tres puertas quedaria toda la Linea Productiva.
--
-- LO QUE SE ENCONTRO (verificado contra el remoto el 2026-08-14, solo lectura)
--   1. 14 policies SELECT con predicado literal 'true', todas to authenticated:
--      app_flags, prod_alerta_stock, prod_capacidad_override, prod_config, prod_estado_map,
--      prod_jornada_orden, prod_materia_prima, prod_minimo, prod_orden_estado,
--      prod_pino_receta, prod_stock_ajuste, prod_stock_mov, prod_stock_mp, prod_tarea.
--      Las policies permisivas se suman con OR: una con qual=true concede lectura total.
--   2. 4 vistas sin security_invoker, dueno postgres (rolbypassrls): corren con los permisos
--      del dueno y saltean la RLS de sus tablas base.
--        · prod_v_jornadas             (authenticated, y ademas is_updatable con ACL arwdDxtm)
--        · prod_v_jornada_demanda_neta (authenticated)
--        · prod_v_stock_mp             (authenticated Y anon)
--        · prod_v_tareas               (authenticated Y anon)
--      Las dos ultimas se leen HOY con la anon key, sin iniciar sesion.
--   3. prod_pata_tamano: unica tabla de public con relrowsecurity=false y ACL arwdDxtm para
--      anon — o sea que anon puede leerla Y escribirla por PostgREST.
--
-- NO ES UNA MIGRACION B2B. Son objetos de Linea Productiva y va aparte a proposito: se aplica
-- con el flag 'b2b' apagado y arregla un problema que existe hoy, sin ningun cliente externo.
-- ⚠ REQUISITO: aplicar ANTES de poner app_flags.b2b en true y antes de dar de alta el primer
--   mayorista. Precedente en el repo: 0125_seguridad_vistas_prod_v_security_invoker.sql.
--
-- ALCANCE / NO ALCANCE
--   · No se crea ninguna valvula para el cliente B2B: nada de estas tablas le sirve a un
--     mayorista. Su acceso son las tablas b2b_* de 0151-0153 y nada mas.
--   · No cambia el comportamiento del usuario interno ACTIVO: is_active_user() ya es el
--     predicado de las 11 tablas internas que si lo usan (orders, jornadas, sku_catalog...).
--     Lo que si cambia: un usuario con profile.active = false deja de ver estas tablas.
--     Eso es la correccion, no un efecto colateral.
--   · Se usa ALTER POLICY (atomico, preserva nombre/roles/cmd), no DROP + CREATE: ninguna
--     ventana en la que la tabla quede sin policy.
--   · Unico cambio de permisos hacia adentro: prod_asignacion pasa a ser legible por
--     cualquier empleado activo (parte B0). No es una concesion nueva — es lo que la planta
--     ya ve hoy a traves de la vista definer, escrito explicito. Sin eso, esta misma
--     migracion le infla la demanda a los cuatro sectores. El detalle y la medicion A/B
--     estan en el encabezado de (B0).
--
-- ✅ APLICADA EN REMOTO el 2026-08-15. Los tres tripwires de (D) corrieron sin abortar.
--    Verificado despues, actuando como anon: prod_v_stock_mp y prod_v_tareas ahora dan
--    "permission denied" (antes devolvian filas con la anon key) y prod_pata_tamano quedo
--    con RLS. Verificado actuando como un empleado 'cnc' activo: sigue leyendo todo lo suyo.

-- ─────────────────────────────────────────────────────────────────────────
-- (A) Policies SELECT con predicado literal 'true' -> is_active_user()
--
-- El filtro roles = {authenticated} es deliberado: si alguna vez aparece una policy con
-- qual=true pensada para anon, esta migracion NO la toca a ciegas — la deja para el tripwire
-- del final, que aborta y obliga a decidirla a mano.
-- ─────────────────────────────────────────────────────────────────────────

do $do$
declare r record;
begin
  for r in
    select p.tablename, p.policyname
      from pg_policies p
     where p.schemaname = 'public'
       and p.cmd = 'SELECT'
       and p.qual = 'true'
       and p.roles = '{authenticated}'::name[]
  loop
    execute format('alter policy %I on public.%I using (public.is_active_user())',
                   r.policyname, r.tablename);
    raise notice '0154: policy %.% cerrada con is_active_user()', r.tablename, r.policyname;
  end loop;
end $do$;

-- ─────────────────────────────────────────────────────────────────────────
-- (B0) prod_asignacion: la lectura se abre a cualquier empleado ACTIVO.
--
-- ESTO NO ES UN EXTRA: sin este paso, la parte (B) le rompe los numeros a la planta.
--
-- prod_v_jornada_demanda_neta resta lo ya asignado con un subquery escalar
-- 'COALESCE((select sum(cantidad) from prod_asignacion where order_id = ...), 0)'.
-- Mientras la vista es definer (dueno postgres, BYPASSRLS) ese subquery ve todo y la
-- demanda sale NETA. Al pasarla a invoker, un operario que no puede leer prod_asignacion
-- no recibe error: el subquery le devuelve 0 y la demanda le sale INFLADA — le mandan a
-- fabricar de nuevo lo que ya estaba asignado, en silencio.
--
-- Medido A/B en replay local (bootstrap + 0001..0153 vs. +0154), escenario de 1 orden de
-- 10 unidades con 4 ya asignadas:
--     rol         antes de 0154    con (B) sin (B0)
--     owner              6                6
--     encargado          6                6
--     cnc                6               10   ← su pantalla lee prod_v_resumen_dia
--     melamina           6               10   ← prod_v_prioridad_melamina
--     pino               6               10   ← prod_v_orden_sector
--     embalaje           6               10   ← prod_v_resumen_dia
-- Son 10 las vistas que dependen de prod_asignacion, y las cuatro pantallas de sector
-- (cnc-sector.jsx:65, melamina-sector.jsx:56, pino-sector.jsx:55, embalaje-sector.jsx:61)
-- entran por ahi. LP_SECTOR_ROLES en produccion-hub.jsx:322 confirma quienes son.
--
-- Abrir el SELECT a is_active_user() PRESERVA exactamente lo que la planta ve hoy, no
-- concede nada nuevo: hoy ya ven ese numero neto a traves de la vista definer. Y deja
-- afuera al cliente B2B, que no tiene profile. Las escrituras no se tocan: prod_asignacion
-- no tiene policy de INSERT/UPDATE/DELETE y se escribe solo desde RPC SECURITY DEFINER.
-- Va ANTES de (B) a proposito: psql corre cada statement en su propia transaccion, y asi
-- no existe ni un instante con la vista en invoker y la tabla todavia cerrada.
-- ─────────────────────────────────────────────────────────────────────────

alter policy prod_asignacion_sel on public.prod_asignacion
  using (public.is_active_user());

comment on table public.prod_asignacion is
  'Asignaciones de produccion contra ordenes. SELECT abierto a cualquier empleado activo (0154): las vistas de demanda neta lo restan por subquery y sin lectura la demanda sale inflada, no vacia. Escritura: solo por RPC SECURITY DEFINER.';

-- ─────────────────────────────────────────────────────────────────────────
-- (B) Vistas sin security_invoker
--
-- Son 4, todas creadas DESPUES de 0125 (que arreglo las 20 anteriores):
-- prod_v_jornada_demanda_neta, prod_v_jornadas, prod_v_stock_mp, prod_v_tareas.
--
-- Impacto verificado antes de tocarlas:
--   · prod_v_jornadas  (base: jornadas, orders — ambas is_active_user()) y prod_v_tareas
--     (base: prod_jornada 'current_user_role() is not null' + prod_tarea) y prod_v_stock_mp
--     (base: prod_materia_prima, prod_stock_mp) las lee el frontend por PostgREST
--     (lp-data.jsx:125,132,137). Un empleado ACTIVO pasa todos esos predicados: no cambia nada.
--   · prod_v_jornada_demanda_neta NO se lee directo desde el frontend, pero SI la consumen
--     otras 9 vistas encadenadas que la planta lee todo el dia (prod_v_demanda_tap ->
--     prod_v_prioridad_melamina, prod_v_resumen_dia, prod_v_orden_sector...). Por eso hace
--     falta (B0). Mientras la vista intermedia era definer, la cadena entera salteaba la RLS
--     de prod_asignacion sin que nadie lo notara.
-- Se excluye b2b_v_pedidos_admin: es definer A PROPOSITO y esta revocada a authenticated en
-- 0153. Esa exclusion hay que mantenerla consciente, no por inercia — si alguna vez se le
-- concede SELECT a authenticated, cada cliente B2B ve los pedidos de todos los demas.
-- ─────────────────────────────────────────────────────────────────────────

do $do$
declare r record;
begin
  for r in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v'
       and (c.reloptions is null or c.reloptions::text not like '%security_invoker%')
       and c.relname <> 'b2b_v_pedidos_admin'
  loop
    execute format('alter view public.%I set (security_invoker = on)', r.relname);
    -- El revoke incluye authenticated: el default ACL de public le concede arwdDxtm sobre
    -- cada objeto nuevo, y prod_v_jornadas es una vista actualizable.
    execute format('revoke all on public.%I from anon, public, authenticated', r.relname);
    execute format('grant select on public.%I to authenticated', r.relname);
    raise notice '0154: vista % pasada a security_invoker y cerrada a anon', r.relname;
  end loop;
end $do$;

-- ─────────────────────────────────────────────────────────────────────────
-- (C) prod_pata_tamano — RLS + ACL
--
-- Tabla de referencia de 2 filas (PAT001 chica / PAT002 grande) que usa el clasificador
-- prod_pieza_pool(text). OJO: prod_pieza_pool es SECURITY INVOKER y esta concedida a
-- authenticated, asi que con RLS prendida el llamador tiene que pasar la policy. Un empleado
-- activo la pasa; llamada desde adentro de una RPC SECURITY DEFINER, el invoker es postgres
-- (BYPASSRLS) y tampoco se ve afectada.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.prod_pata_tamano enable row level security;

drop policy if exists prod_pata_tamano_sel on public.prod_pata_tamano;
create policy prod_pata_tamano_sel on public.prod_pata_tamano for select to authenticated
  using (public.is_active_user());

revoke all on public.prod_pata_tamano from anon, public, authenticated;
grant select on public.prod_pata_tamano to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- (D) Tripwire — si el perimetro vuelve a abrirse, esto falla
--
-- 'create view' sin security_invoker es el DEFAULT de Postgres: asi se colo prod_v_jornadas
-- en 0147, tres migraciones despues de que 0125 arreglara las 20 anteriores. Este bloque es
-- el unico control permanente que existe. Las tres consultas van tambien al smoke de deploy.
-- ─────────────────────────────────────────────────────────────────────────

do $do$
declare v_n integer; v_d text;
begin
  select count(*), coalesce(string_agg(tablename || '.' || policyname, ', '), '') into v_n, v_d
    from pg_policies
   where schemaname = 'public' and cmd = 'SELECT' and qual = 'true';
  if v_n > 0 then
    raise exception 'Quedan % policies SELECT con qual=true en public: %', v_n, v_d
      using errcode='0A000';
  end if;

  select count(*), coalesce(string_agg(c.relname, ', '), '') into v_n, v_d
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and (c.reloptions is null or c.reloptions::text not like '%security_invoker%')
     and c.relname <> 'b2b_v_pedidos_admin';
  if v_n > 0 then
    raise exception 'Quedan % vistas sin security_invoker en public: %', v_n, v_d
      using errcode='0A000';
  end if;

  select count(*), coalesce(string_agg(c.relname, ', '), '') into v_n, v_d
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false
     and has_table_privilege('authenticated', c.oid, 'SELECT');
  if v_n > 0 then
    raise exception 'Quedan % tablas sin RLS legibles por authenticated: %', v_n, v_d
      using errcode='0A000';
  end if;

  raise notice '0154: perimetro cerrado — 0 policies con qual=true, 0 vistas definer, 0 tablas sin RLS.';
end $do$;
