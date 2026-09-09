-- ══════════════════════════════════════════════════════════════════════════════════════════
-- 0174 · Las placas avisan en vez de bloquear · y las combinadas dejan de tirar piezas
-- ══════════════════════════════════════════════════════════════════════════════════════════
--
-- Tres problemas, uno de ellos deja la linea entera inutilizable hoy mismo.
--
-- ── 1. La linea esta trabada de punta a punta ──────────────────────────────────────────────
--
-- Estado real de la base al escribir esto:
--
--     select count(*) from prod_stock_mp where disponible > 0;   -- 0  (las 29 placas en cero)
--     select count(*) from prod_pino_receta;                     -- 0  (sin receta de pino)
--     select count(*) from prod_corte;                           -- 0  (jamas se cargo un corte)
--
-- Con `mp_consumo_obligatorio = 1`, prod_rpc_registrar_corte hacia:
--
--     if v_mpdisp < v_hojas then raise exception 'Stock de placas insuficiente ...'
--
-- Como v_mpdisp es 0 para TODAS las placas, cualquier corte revienta. Y prod_rpc_registrar_pino
-- hacia lo mismo por el lado de la receta: sin fila en prod_pino_receta salta
-- 'Configuracion incompleta'. O sea: dos de los cuatro sectores no pueden cargar nada, nunca.
--
-- Salida hay una sola, y esta escondida: Configuracion -> Materia prima (lp-config.jsx, RPC
-- prod_rpc_mp_ajuste de la 0139). El operario de CNC no la ve ni puede usarla, y la pantalla de
-- carga de stock -- la que el encargado usa todos los dias -- solo aceptaba los buckets
-- pieza/melamina/patas/insumo/terminado: 'mp' no estaba. Asi que el sector que se traba no
-- tiene como destrabarse, y el que puede destrabarlo tiene que acordarse de una pantalla aparte.
--
-- Decision de Seba: las placas SE DESCUENTAN, pero si no alcanzan se AVISA, no se bloquea. La
-- produccion fisica ya ocurrio — rechazar la carga no deshace el corte, solo lo borra del
-- sistema. Se corta con lo que hay, se descuenta lo que se puede y el resto queda anotado como
-- faltante a reponer, visible para el encargado.
--
-- El unico bloqueo duro que se mantiene es el de melamina (no puede terminar mas piezas de las
-- que CNC corto): ese si es un limite fisico, no un problema de carga de datos.
--
-- ── 2. Las placas combinadas tiraban la mitad de la produccion ─────────────────────────────
--
-- COM001..COM004 rinden dos medidas en un mismo corte:
--
--     COM001 → 8 × TAP003 (primaria, prod_placa.pieza_sku) + 15 × TAP005 (prod_placa_pieza_extra)
--
-- registrar_corte solo acreditaba prod_placa.pieza_sku. Las 15 piezas secundarias se cortaban,
-- existian en el galpon y no existian en el sistema. Sobre 23 piezas por hoja se perdian 15:
-- el 65%. Y el plan de corte (prod_rpc_plan_corte) recomienda justamente las combinadas porque
-- ahorran placas — o sea que el sistema empujaba al operario hacia el corte que peor registraba.
--
-- ── 3. Editar un corte combinado corrompia el stock ────────────────────────────────────────
--
-- prod_rpc_editar_corte revertia la pieza primaria y nada mas. Con las extras ya acreditadas
-- (punto 2), editar dejaba las secundarias colgadas para siempre. Se arregla junto.
--
-- Limitacion conocida y deliberada: editar un corte NO recalcula el consumo de placas. Cambiar
-- 1 hoja por 5 acredita las piezas nuevas pero no descuenta 4 placas mas. Revertir consumo de
-- MP cuando parte de ese consumo fue faltante no tiene una respuesta unica, y la ventana de
-- edicion es de 24 h sobre un pool que se re-sincroniza por conteo fisico. Queda anotado aca
-- en vez de resuelto a medias y en silencio.

begin;

-- ══════════════════════════════════════════════════════════════════════════════════════════
-- A. El bucket 'mp' entra al circuito de carga de stock
-- ══════════════════════════════════════════════════════════════════════════════════════════

alter table public.prod_stock_ajuste drop constraint if exists prod_stock_ajuste_bucket_check;
alter table public.prod_stock_ajuste add constraint prod_stock_ajuste_bucket_check
  check (bucket = any (array['pieza','melamina','patas','insumo','terminado','mp']));

-- Rollback:
--   alter table public.prod_stock_ajuste drop constraint prod_stock_ajuste_bucket_check;
--   alter table public.prod_stock_ajuste add constraint prod_stock_ajuste_bucket_check
--     check (bucket = any (array['pieza','melamina','patas','insumo','terminado']));


-- El pool de un SKU. El caso 'mp' va DELIBERADAMENTE ULTIMO, despues de todos los existentes:
-- asi un SKU que hoy resuelve a melamina/insumo/patas/otro sigue resolviendo exactamente igual,
-- y lo unico que puede cambiar es lo que antes caia en 'desconocido'. Cero regresion posible.
--
-- Un SKU es materia prima si esta en el catalogo prod_materia_prima (0139) o si alguien lo
-- referencia como tal: prod_placa.mp_sku, prod_pino_receta.mp_sku o prod_stock_mp.mp_sku. Se
-- miran los cuatro porque el catalogo se puede desincronizar y el faltante tiene que poder
-- saldarse igual.
create or replace function public.prod_pieza_pool(p_sku text)
returns text language sql stable set search_path to 'public','pg_temp' as $fn$
  select case
    when exists (select 1 from public.prod_placa pl where pl.pieza_sku = p_sku)
      or exists (select 1 from public.prod_placa_pieza_extra e where e.pieza_sku = p_sku)
      then 'melamina'
    when exists (select 1 from public.prod_insumo i where i.sku = p_sku)      then 'insumo'
    when exists (select 1 from public.prod_pata_tamano t where t.pieza_sku = p_sku) then 'patas'
    when exists (select 1 from public.prod_componente c where c.padre_sku = p_sku) then 'otro'  -- compuesto/kit/set/producto
    when exists (select 1 from public.prod_materia_prima mp where mp.sku = p_sku and mp.activo)
      or exists (select 1 from public.prod_placa pl2 where pl2.mp_sku = p_sku)
      or exists (select 1 from public.prod_pino_receta pr where pr.mp_sku = p_sku)
      or exists (select 1 from public.prod_stock_mp m where m.mp_sku = p_sku)
      then 'mp'
    else 'desconocido'
  end
$fn$;


-- Validacion de fila de carga de stock.
--
-- Cambio de orden importante: antes v_existe se calculaba primero y solo miraba
-- prod_pieza/prod_producto/prod_insumo. Un SKU de placa no esta en ninguna de las tres, asi que
-- salia 'sku_inexistente' antes siquiera de llegar al bucket. Ahora el pool se resuelve primero
-- y un SKU con pool 'mp' cuenta como existente.
create or replace function public.prod_stock_validar_fila(p_sku text, p_bucket text, p_cant integer, p_motivo text)
returns jsonb language plpgsql stable set search_path to 'public','pg_temp' as $fn$
declare v_pool text; v_existe boolean; v_stock int; v_compat boolean; v_estado text; v_detalle text;
begin
  v_pool := prod_pieza_pool(p_sku);
  v_existe := exists(select 1 from prod_pieza where sku=p_sku)
           or exists(select 1 from prod_producto where sku=p_sku)
           or exists(select 1 from prod_insumo where sku=p_sku)
           or v_pool = 'mp';
  v_compat := case p_bucket
    when 'pieza' then v_pool='melamina'
    when 'melamina' then v_pool='melamina'
    when 'patas' then v_pool='patas'
    when 'insumo' then v_pool='insumo'
    when 'mp' then v_pool='mp'
    when 'terminado' then exists(select 1 from prod_producto where sku=p_sku)
    else false end;
  v_stock := case p_bucket
    when 'pieza' then coalesce((select disponible from prod_stock_pieza where pieza_sku=p_sku),0)
    when 'melamina' then coalesce((select disponible from prod_stock_melamina where pieza_sku=p_sku),0)
    when 'patas' then coalesce((select disponible from prod_stock_patas where tamano=(select tamano from prod_pata_tamano where pieza_sku=p_sku)),0)
    when 'insumo' then coalesce((select stock_actual::int from prod_insumo where sku=p_sku),0)
    when 'mp' then coalesce((select disponible from prod_stock_mp where mp_sku=p_sku),0)
    when 'terminado' then coalesce((select disponible from prod_stock_terminado where producto_sku=p_sku),0)
    else 0 end;
  if p_bucket not in ('pieza','melamina','patas','insumo','terminado','mp') then v_estado:='bloqueada'; v_detalle:='bucket_invalido';
  elsif not v_existe then v_estado:='bloqueada'; v_detalle:='sku_inexistente';
  elsif v_pool='desconocido' then v_estado:='bloqueada'; v_detalle:='sku_sin_pool';
  elsif not v_compat then v_estado:='bloqueada'; v_detalle:='sector_incompatible(pool='||v_pool||')';
  elsif p_cant is null or p_cant<=0 then v_estado:='bloqueada'; v_detalle:='cantidad_invalida';
  elsif coalesce(trim(p_motivo),'')='' then v_estado:='bloqueada'; v_detalle:='motivo_requerido';
  else v_estado:='valida'; v_detalle:='ok'; end if;
  return jsonb_build_object('sku',p_sku,'bucket',p_bucket,'pool',v_pool,'cantidad',p_cant,
    'stock_actual',v_stock,'stock_proyectado',v_stock+coalesce(p_cant,0),'estado',v_estado,'detalle',v_detalle);
end $fn$;


-- ══════════════════════════════════════════════════════════════════════════════════════════
-- B. El faltante de placas: lo que se corto sin que el sistema tuviera la placa cargada
-- ══════════════════════════════════════════════════════════════════════════════════════════
--
-- No es un castigo ni una multa: es la lista de "esto hay que cargarlo". Sin esta tabla, avisar
-- en vez de bloquear seria simplemente perder el dato — el corte entraria, la placa nunca se
-- descontaria y nadie se enteraria. Con ella, el encargado ve exactamente cuantas hojas de cada
-- placa se usaron sin respaldo en el sistema.

create table if not exists public.prod_mp_faltante (
  id           uuid primary key default gen_random_uuid(),
  mp_sku       text not null,
  sector       text not null check (sector in ('cnc','pino')),
  cantidad     int  not null check (cantidad > 0),
  turno_id     uuid references public.prod_jornada_sector(id) on delete set null,
  jornada_id   uuid references public.prod_jornada(id) on delete set null,
  usuario      uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  saldado_at   timestamptz,
  saldado_por  uuid references auth.users(id) on delete set null,
  saldado_lote text
);

comment on table public.prod_mp_faltante is
  'Hojas de placa/pino que se consumieron sin stock cargado. Se saldan solas cuando alguien '
  'carga stock de esa MP en la pantalla de carga (bucket mp). Ver 0174.';

create index if not exists ix_prod_mp_faltante_pendiente
  on public.prod_mp_faltante (mp_sku) where saldado_at is null;
create index if not exists ix_prod_mp_faltante_fecha
  on public.prod_mp_faltante (created_at desc);

alter table public.prod_mp_faltante enable row level security;

drop policy if exists prod_mp_faltante_sel on public.prod_mp_faltante;
create policy prod_mp_faltante_sel on public.prod_mp_faltante
  for select to authenticated using (public.is_active_user());

-- Sin policies de escritura a proposito: las filas las escriben las RPC (security definer).
revoke all on table public.prod_mp_faltante from public, anon;
grant select on table public.prod_mp_faltante to authenticated;


-- Lo pendiente, agrupado por placa. Es lo que mira el encargado.
create or replace view public.prod_v_mp_faltante with (security_invoker = true) as
select f.mp_sku,
       coalesce((select mp.nombre from public.prod_materia_prima mp where mp.sku = f.mp_sku),
                (select pl.nombre from public.prod_placa pl where pl.mp_sku = f.mp_sku order by pl.sku limit 1),
                f.mp_sku) as nombre,
       sum(f.cantidad)::int as faltan,
       count(*)::int        as veces,
       min(f.created_at)    as desde,
       max(f.created_at)    as ultima_vez,
       coalesce((select m.disponible from public.prod_stock_mp m where m.mp_sku = f.mp_sku), 0) as stock_actual
from public.prod_mp_faltante f
where f.saldado_at is null
group by f.mp_sku;

revoke all on public.prod_v_mp_faltante from public, anon;
grant select on public.prod_v_mp_faltante to authenticated;


-- Saldar el faltante cuando entra stock de esa MP.
--
-- Salda filas enteras, de la mas vieja a la mas nueva, mientras entren en lo que se cargo. Si
-- la siguiente no entra completa, se corta: preferimos quedarnos cortos (el faltante sigue
-- visible) antes que dar por saldado algo que no lo esta.
--
-- NO descuenta stock. El faltante significa "se corto con placas que el sistema no tenia
-- cargadas", y en esta base eso es literal: prod_stock_mp arranca en cero para las 29 placas.
-- Cuando alguien finalmente carga el conteo real, ese numero ES la realidad del galpon — volver
-- a restarle el faltante lo dejaria mal por segunda vez. Si algun dia se carga stock por compra
-- sin haber contado nunca, ahi si convendria restar; queda anotado, no adivinado.
create or replace function public.prod_fn_mp_faltante_saldar(p_mp_sku text, p_cant int, p_lote text)
returns int language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_resta int; v_salda int := 0; r record;
begin
  if p_mp_sku is null or coalesce(p_cant,0) <= 0 then return 0; end if;
  v_resta := p_cant;
  for r in select id, cantidad from public.prod_mp_faltante
            where mp_sku = p_mp_sku and saldado_at is null
            order by created_at, id for update loop
    exit when r.cantidad > v_resta;
    update public.prod_mp_faltante
       set saldado_at = now(), saldado_por = auth.uid(), saldado_lote = p_lote
     where id = r.id;
    v_resta := v_resta - r.cantidad;
    v_salda := v_salda + r.cantidad;
  end loop;
  return v_salda;
end $fn$;

revoke execute on function public.prod_fn_mp_faltante_saldar(text,int,text) from public, anon, authenticated;


-- ══════════════════════════════════════════════════════════════════════════════════════════
-- C. La carga de stock aplica el bucket 'mp' y salda faltantes
-- ══════════════════════════════════════════════════════════════════════════════════════════

create or replace function public.prod_rpc_stock_confirmar(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_lote text; f jsonb; v jsonb;
  v_aplicadas int:=0; v_ya int:=0; v_tam text; v_sal int; v_saldados jsonb := '[]'::jsonb;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id=auth.uid();
  if v_role is null or v_active=false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  v_lote := nullif(p_payload->>'lote_id','');
  if v_lote is null then raise exception 'lote_id requerido.' using errcode='22023'; end if;
  for f in select * from jsonb_array_elements(coalesce(p_payload->'filas','[]'::jsonb)) loop
    v := prod_stock_validar_fila(f->>'sku', f->>'bucket', (f->>'cantidad')::int, f->>'motivo');
    if v->>'estado'='bloqueada' then raise exception 'Fila bloqueada (% / %): %', f->>'sku', f->>'bucket', v->>'detalle' using errcode='42501'; end if;
  end loop;
  for f in select * from jsonb_array_elements(coalesce(p_payload->'filas','[]'::jsonb)) loop
    insert into prod_stock_ajuste(lote_id, sku, bucket, cantidad, origen, motivo, usuario)
    values (v_lote, f->>'sku', f->>'bucket', (f->>'cantidad')::int, coalesce(f->>'origen','carga_inicial'), f->>'motivo', auth.uid())
    on conflict (lote_id, sku, bucket) do nothing;
    if not found then v_ya:=v_ya+1; continue; end if;
    v_aplicadas := v_aplicadas+1;
    case f->>'bucket'
      when 'pieza' then insert into prod_stock_pieza(pieza_sku,disponible) values(f->>'sku',(f->>'cantidad')::int)
        on conflict(pieza_sku) do update set disponible=prod_stock_pieza.disponible+(f->>'cantidad')::int, updated_at=now();
      when 'melamina' then insert into prod_stock_melamina(pieza_sku,disponible) values(f->>'sku',(f->>'cantidad')::int)
        on conflict(pieza_sku) do update set disponible=prod_stock_melamina.disponible+(f->>'cantidad')::int, updated_at=now();
      when 'terminado' then insert into prod_stock_terminado(producto_sku,disponible) values(f->>'sku',(f->>'cantidad')::int)
        on conflict(producto_sku) do update set disponible=prod_stock_terminado.disponible+(f->>'cantidad')::int, updated_at=now();
      when 'patas' then
        select tamano into v_tam from prod_pata_tamano where pieza_sku=f->>'sku';
        insert into prod_stock_patas(tamano,disponible) values(v_tam,(f->>'cantidad')::int)
        on conflict(tamano) do update set disponible=prod_stock_patas.disponible+(f->>'cantidad')::int, updated_at=now();
      when 'insumo' then update prod_insumo set stock_actual=coalesce(stock_actual,0)+(f->>'cantidad')::int, updated_at=now() where sku=f->>'sku';
      when 'mp' then
        -- La puerta que faltaba en la pantalla de todos los dias. Existir ya existia (0139,
        -- Configuracion -> Materia prima), pero escondida en otra pantalla y con otro flujo.
        -- Aca entra por el mismo camino que el resto del stock: preview, lote y idempotencia.
        insert into prod_stock_mp(mp_sku,disponible) values(f->>'sku',(f->>'cantidad')::int)
        on conflict(mp_sku) do update set disponible=prod_stock_mp.disponible+(f->>'cantidad')::int, updated_at=now();
        insert into prod_stock_mov(pool,sku,tipo,cantidad,motivo,usuario)
          values('mp', f->>'sku', 'ajuste', (f->>'cantidad')::int,
                 coalesce(f->>'motivo','carga de stock')||' [lote '||v_lote||']', auth.uid());
        v_sal := public.prod_fn_mp_faltante_saldar(f->>'sku', (f->>'cantidad')::int, v_lote);
        if v_sal > 0 then
          v_saldados := v_saldados || jsonb_build_object('mp_sku', f->>'sku', 'hojas', v_sal);
        end if;
    end case;
  end loop;
  return jsonb_build_object('ok',true,'lote_id',v_lote,'aplicadas_nuevas',v_aplicadas,
    'ya_aplicadas_idempotente',v_ya,'faltantes_saldados',v_saldados);
end $fn$;

revoke all on function public.prod_rpc_stock_confirmar(jsonb) from public, anon;
grant execute on function public.prod_rpc_stock_confirmar(jsonb) to authenticated;


-- ══════════════════════════════════════════════════════════════════════════════════════════
-- D. El corte: avisa en vez de bloquear, y acredita TODAS las piezas de la placa
-- ══════════════════════════════════════════════════════════════════════════════════════════
--
-- Sobre el desperdicio en placas combinadas: la pantalla pide un solo numero de desperdicio y
-- no pregunta de que medida fue. Se descuenta de la pieza primaria (que es de la que menos
-- rinde la placa) y las secundarias se acreditan completas. Es una eleccion determinista y
-- conservadora — nunca infla el stock — y queda escrita aca para que no parezca un olvido.

create or replace function public.prod_rpc_registrar_corte(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_jornada uuid; v_est text;
  v_placa text; v_hojas int; v_desp int; v_rend int; v_pieza text; v_gen int; v_id uuid;
  v_mp text; v_oblig boolean; v_mpdisp int; v_turno public.prod_jornada_sector;
  v_usa int; v_falta int; v_avisos jsonb := '[]'::jsonb;
  v_piezas jsonb; v_total int; v_gen_e int; e record;
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

  -- ── Placas: se descuenta lo que hay, se avisa lo que falto ──
  v_oblig := public.prod_cfg_int('mp_consumo_obligatorio',1) = 1;
  if v_mp is not null then
    perform 1 from prod_stock_mp where mp_sku=v_mp for update;
    v_mpdisp := greatest(public.prod_fn_stock_disp('mp', v_mp), 0);
    -- least() no es cosmetico: prod_stock_mp tiene check (disponible >= 0) y prod_fn_stock_apply
    -- solo aplica greatest(d,0) en el INSERT, no en el do update. Pasarse rompe la transaccion.
    v_usa   := least(v_mpdisp, v_hojas);
    v_falta := v_hojas - v_usa;
    if v_usa > 0 then
      perform public.prod_fn_stock_apply('mp', v_mp, -v_usa, 0, 0);
      insert into prod_stock_mov(jornada_id,pool,sku,tipo,cantidad,usuario)
        values (v_jornada,'mp',v_mp,'consumir',v_usa,auth.uid());
    end if;
    if v_falta > 0 then
      insert into public.prod_mp_faltante(mp_sku, sector, cantidad, turno_id, jornada_id, usuario)
        values (v_mp, 'cnc', v_falta, v_turno.id, v_jornada, auth.uid());
      v_avisos := v_avisos || to_jsonb(format(
        'Se cortaron %s hojas de %s que el sistema no tenia cargadas. Quedan anotadas como faltante a reponer.',
        v_falta, v_mp));
    end if;
  elsif v_oblig then
    v_avisos := v_avisos || to_jsonb(format(
      'La placa %s no tiene materia prima configurada: el corte se registro, pero no se descontaron placas.',
      v_placa));
  end if;

  insert into prod_corte (jornada_id, turno_id, placa_sku, hojas, desperdicio, cargado_por, editable_hasta)
  values (v_jornada, v_turno.id, v_placa, v_hojas, v_desp, auth.uid(), now() + interval '24 hours') returning id into v_id;

  -- ── Pieza primaria: el desperdicio se descuenta aca ──
  v_gen := greatest(v_hojas * coalesce(v_rend,0) - v_desp, 0);
  insert into prod_stock_pieza (pieza_sku, disponible) values (v_pieza, v_gen)
  on conflict (pieza_sku) do update set disponible = prod_stock_pieza.disponible + v_gen, updated_at = now();
  v_piezas := jsonb_build_array(jsonb_build_object('pieza_sku', v_pieza, 'cantidad', v_gen, 'principal', true));
  v_total  := v_gen;

  -- ── Piezas secundarias de una placa combinada: antes se cortaban y se tiraban ──
  for e in select pieza_sku, rendimiento from prod_placa_pieza_extra
            where placa_sku = v_placa order by pieza_sku loop
    v_gen_e := greatest(v_hojas * coalesce(e.rendimiento,0), 0);
    if v_gen_e > 0 then
      perform public.prod_fn_liberar_tareas_output(v_jornada, 'cnc', e.pieza_sku);
      insert into prod_stock_pieza (pieza_sku, disponible) values (e.pieza_sku, v_gen_e)
      on conflict (pieza_sku) do update set disponible = prod_stock_pieza.disponible + v_gen_e, updated_at = now();
      v_piezas := v_piezas || jsonb_build_object('pieza_sku', e.pieza_sku, 'cantidad', v_gen_e, 'principal', false);
      v_total  := v_total + v_gen_e;
    end if;
  end loop;

  -- piezas_generadas pasa a ser el TOTAL de la placa (antes era solo la primaria). El cartel del
  -- operario decia "+8 piezas" cuando en la mesa habia 23.
  return jsonb_build_object('ok', true, 'corte_id', v_id,
    'piezas_generadas', v_total, 'piezas_primarias', v_gen, 'piezas', v_piezas,
    'avisos', v_avisos,
    'turno_id', v_turno.id, 'jornada_id', v_jornada, 'sin_jornada_demanda', (v_jornada is null));
end $fn$;

revoke all on function public.prod_rpc_registrar_corte(jsonb) from public, anon;
grant execute on function public.prod_rpc_registrar_corte(jsonb) to authenticated;


-- ══════════════════════════════════════════════════════════════════════════════════════════
-- E. Editar un corte tambien tiene que saber de las piezas extra
-- ══════════════════════════════════════════════════════════════════════════════════════════
--
-- Sin esto, editar un corte de COM001 revertia 8 TAP003 y dejaba 15 TAP005 acreditadas para
-- siempre. La guarda de no-negativo se aplica ahora a cada pieza, no solo a la primaria.

create or replace function public.prod_rpc_editar_corte(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_c prod_corte%rowtype;
  v_new_placa text; v_hojas int; v_desp int;
  v_old_rend int; v_old_pieza text; v_new_rend int; v_new_pieza text;
  v_old_gen int; v_new_gen int; v_disp int;
  v_old_tot int; v_new_tot int; e record; v_q int;
begin
  perform public.prod_fn_guard_lp();
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  select * into v_c from prod_corte where id = (p_payload->>'id')::uuid;
  if not found then raise exception 'Corte no encontrado.' using errcode='P0002'; end if;
  if v_role = 'cnc' then
    if v_c.editable_hasta <= now() then raise exception 'Fuera de la ventana de 24h.' using errcode='42501'; end if;
  elsif v_role not in ('encargado','owner','admin') then raise exception 'Sin permiso.' using errcode='42501'; end if;

  v_new_placa := coalesce(nullif(p_payload->>'placa_sku',''), v_c.placa_sku);
  v_hojas := public.prod_fn_int_arg(p_payload,'hojas',1,false,v_c.hojas);
  v_desp  := public.prod_fn_int_arg(p_payload,'desperdicio',0,false,v_c.desperdicio);
  select rendimiento, pieza_sku into v_old_rend, v_old_pieza from prod_placa where sku = v_c.placa_sku;
  select rendimiento, pieza_sku into v_new_rend, v_new_pieza from prod_placa where sku = v_new_placa;
  if v_new_pieza is null then raise exception 'La placa % no existe o no tiene pieza.', v_new_placa using errcode='22023'; end if;
  v_old_gen := greatest(v_c.hojas * coalesce(v_old_rend,0) - v_c.desperdicio, 0);
  v_new_gen := greatest(v_hojas * coalesce(v_new_rend,0) - v_desp, 0);
  v_old_tot := v_old_gen;
  v_new_tot := v_new_gen;

  -- Guarda no-negativo: no permitir revertir piezas que ya se consumieron aguas abajo.
  -- Se chequea ANTES de tocar nada, para la primaria y para cada extra de la placa vieja.
  if v_old_pieza is not null and v_old_gen > 0 then
    select coalesce(disponible,0) into v_disp from prod_stock_pieza where pieza_sku = v_old_pieza;
    if coalesce(v_disp,0) - v_old_gen < 0 then
      raise exception 'No se puede editar: % piezas de % ya fueron consumidas (stock % < % a revertir).',
        v_old_gen, v_old_pieza, coalesce(v_disp,0), v_old_gen using errcode='42501';
    end if;
  end if;
  for e in select pieza_sku, rendimiento from prod_placa_pieza_extra where placa_sku = v_c.placa_sku loop
    v_q := greatest(v_c.hojas * coalesce(e.rendimiento,0), 0);
    if v_q > 0 then
      select coalesce(disponible,0) into v_disp from prod_stock_pieza where pieza_sku = e.pieza_sku;
      if coalesce(v_disp,0) - v_q < 0 then
        raise exception 'No se puede editar: % piezas de % ya fueron consumidas (stock % < % a revertir).',
          v_q, e.pieza_sku, coalesce(v_disp,0), v_q using errcode='42501';
      end if;
    end if;
  end loop;

  perform set_config('prod.audit_motivo', nullif(p_payload->>'motivo',''), true);
  perform set_config('prod.audit_sector', 'cnc', true);
  update prod_corte set placa_sku = v_new_placa, hojas = v_hojas, desperdicio = v_desp where id = v_c.id;

  -- Revertir la placa vieja completa (primaria + extras)
  if v_old_pieza is not null and v_old_gen > 0 then
    update prod_stock_pieza set disponible = disponible - v_old_gen, updated_at = now() where pieza_sku = v_old_pieza;
  end if;
  for e in select pieza_sku, rendimiento from prod_placa_pieza_extra where placa_sku = v_c.placa_sku loop
    v_q := greatest(v_c.hojas * coalesce(e.rendimiento,0), 0);
    if v_q > 0 then
      update prod_stock_pieza set disponible = disponible - v_q, updated_at = now() where pieza_sku = e.pieza_sku;
      v_old_tot := v_old_tot + v_q;
    end if;
  end loop;

  -- Acreditar la placa nueva completa (primaria + extras)
  if v_new_gen > 0 then
    insert into prod_stock_pieza (pieza_sku, disponible) values (v_new_pieza, v_new_gen)
    on conflict (pieza_sku) do update set disponible = prod_stock_pieza.disponible + v_new_gen, updated_at = now();
  end if;
  for e in select pieza_sku, rendimiento from prod_placa_pieza_extra where placa_sku = v_new_placa loop
    v_q := greatest(v_hojas * coalesce(e.rendimiento,0), 0);
    if v_q > 0 then
      insert into prod_stock_pieza (pieza_sku, disponible) values (e.pieza_sku, v_q)
      on conflict (pieza_sku) do update set disponible = prod_stock_pieza.disponible + v_q, updated_at = now();
      v_new_tot := v_new_tot + v_q;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'delta_stock', v_new_tot - v_old_tot,
    'old_generadas', v_old_tot, 'new_generadas', v_new_tot);
end $fn$;

revoke all on function public.prod_rpc_editar_corte(jsonb) from public, anon;
grant execute on function public.prod_rpc_editar_corte(jsonb) to authenticated;


-- ══════════════════════════════════════════════════════════════════════════════════════════
-- F. Pino: mismo criterio. Sin receta cargada no se puede seguir rechazando la produccion
-- ══════════════════════════════════════════════════════════════════════════════════════════
--
-- prod_pino_receta esta vacia hoy. Antes eso significaba que el sector Pino no podia registrar
-- absolutamente nada. Ahora registra, no descuenta materia prima, y lo dice.

create or replace function public.prod_rpc_registrar_pino(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $fn$
declare v_role role_enum; v_active boolean; v_jornada uuid; v_est text;
  v_tamano text; v_term int; v_mas int; v_id uuid; v_disp int; v_masT int;
  v_pr record; v_oblig boolean; v_units int; v_mpdisp int; v_turno public.prod_jornada_sector;
  v_usa int; v_falta int; v_avisos jsonb := '[]'::jsonb;
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
  if found and coalesce(v_pr.patas_por_unidad,0) > 0 and v_pr.mp_sku is not null then
    v_units := ceil((v_term + v_mas)::numeric / v_pr.patas_por_unidad)::int;
    perform 1 from prod_stock_mp where mp_sku=v_pr.mp_sku for update;
    v_mpdisp := greatest(public.prod_fn_stock_disp('mp', v_pr.mp_sku), 0);
    v_usa   := least(v_mpdisp, v_units);
    v_falta := v_units - v_usa;
    if v_usa > 0 then
      perform public.prod_fn_stock_apply('mp', v_pr.mp_sku, -v_usa, 0, 0);
      insert into prod_stock_mov(jornada_id,pool,sku,tipo,cantidad,usuario)
        values (v_jornada,'mp',v_pr.mp_sku,'consumir',v_usa,auth.uid());
    end if;
    if v_falta > 0 then
      insert into public.prod_mp_faltante(mp_sku, sector, cantidad, turno_id, jornada_id, usuario)
        values (v_pr.mp_sku, 'pino', v_falta, v_turno.id, v_jornada, auth.uid());
      v_avisos := v_avisos || to_jsonb(format(
        'Se usaron %s unidades de %s que el sistema no tenia cargadas. Quedan anotadas como faltante a reponer.',
        v_falta, v_pr.mp_sku));
    end if;
  elsif v_oblig then
    v_avisos := v_avisos || to_jsonb(format(
      'No hay receta de materia prima para patas %s: se registro la produccion, pero no se desconto pino.',
      v_tamano));
  end if;

  insert into prod_pino (jornada_id, turno_id, tamano, terminadas, masilladas, cargado_por, editable_hasta)
  values (v_jornada, v_turno.id, v_tamano, v_term, v_mas, auth.uid(), now() + interval '24 hours') returning id into v_id;
  insert into prod_stock_patas (tamano, disponible, masilladas) values (v_tamano, v_term, v_mas)
  on conflict (tamano) do update set disponible = prod_stock_patas.disponible + v_term,
    masilladas = prod_stock_patas.masilladas + v_mas, updated_at = now()
  returning disponible, masilladas into v_disp, v_masT;

  return jsonb_build_object('ok', true, 'pino_id', v_id,
    'stock_patas', jsonb_build_object('tamano', v_tamano, 'disponible', v_disp, 'masilladas', v_masT),
    'avisos', v_avisos,
    'turno_id', v_turno.id, 'jornada_id', v_jornada, 'sin_jornada_demanda', (v_jornada is null));
end $fn$;

revoke all on function public.prod_rpc_registrar_pino(jsonb) from public, anon;
grant execute on function public.prod_rpc_registrar_pino(jsonb) to authenticated;


-- ══════════════════════════════════════════════════════════════════════════════════════════
-- G. La placa, con todo lo que rinde
-- ══════════════════════════════════════════════════════════════════════════════════════════
--
-- La pantalla de CNC calculaba el preview como hojas × rendimiento, que para una combinada
-- mostraba 8 cuando iban a salir 23. Con esta vista la pantalla puede mostrar las dos medidas
-- sin pedir una segunda consulta ni saber que existe prod_placa_pieza_extra.

create or replace view public.prod_v_placa with (security_invoker = true) as
select pl.sku, pl.nombre, pl.material, pl.rendimiento, pl.pieza_sku, pl.combinada, pl.mp_sku,
       coalesce((select sum(e.rendimiento)::int from public.prod_placa_pieza_extra e where e.placa_sku = pl.sku), 0)
         as rendimiento_extra,
       coalesce(pl.rendimiento,0)
         + coalesce((select sum(e.rendimiento)::int from public.prod_placa_pieza_extra e where e.placa_sku = pl.sku), 0)
         as rendimiento_total,
       coalesce((select jsonb_agg(jsonb_build_object('pieza_sku', e.pieza_sku, 'rendimiento', e.rendimiento) order by e.pieza_sku)
                   from public.prod_placa_pieza_extra e where e.placa_sku = pl.sku), '[]'::jsonb)
         as extras
from public.prod_placa pl;

revoke all on public.prod_v_placa from public, anon;
grant select on public.prod_v_placa to authenticated;

commit;

-- ══════════════════════════════════════════════════════════════════════════════════════════
-- Rollback completo (orden inverso)
-- ══════════════════════════════════════════════════════════════════════════════════════════
--   drop view if exists public.prod_v_placa;
--   drop view if exists public.prod_v_mp_faltante;
--   drop function if exists public.prod_fn_mp_faltante_saldar(text,int,text);
--   drop table if exists public.prod_mp_faltante;
--   -- y restaurar desde 0139/0173 las versiones previas de:
--   --   prod_pieza_pool, prod_stock_validar_fila, prod_rpc_stock_confirmar,
--   --   prod_rpc_registrar_corte, prod_rpc_editar_corte, prod_rpc_registrar_pino
