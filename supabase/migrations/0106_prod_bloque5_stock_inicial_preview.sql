-- 0106 · BLOQUE 5 — Carga inicial de stock: PREVIEW (sin escribir) + CONFIRM idempotente + ledger + free_stock preview
-- (Aplicada en remoto vía MCP el 2026-07-20; reconstruida como archivo local — no re-ejecutar.)

create table if not exists public.prod_stock_ajuste (
  id uuid primary key default gen_random_uuid(),
  lote_id text not null,
  sku text not null,
  bucket text not null check (bucket in ('pieza','melamina','patas','insumo','terminado')),
  cantidad integer not null,
  origen text not null,
  motivo text not null,
  usuario uuid,
  created_at timestamptz not null default now(),
  unique (lote_id, sku, bucket)
);
comment on table public.prod_stock_ajuste is 'Bloque 5 — ledger de carga inicial/ajustes de stock. UNIQUE(lote,sku,bucket) => reaplicar un lote no duplica.';
alter table public.prod_stock_ajuste enable row level security;
do $$ begin
  create policy prod_stock_ajuste_sel on public.prod_stock_ajuste for select to authenticated using (true);
exception when duplicate_object then null; end $$;

create or replace function public.prod_stock_validar_fila(p_sku text, p_bucket text, p_cant integer, p_motivo text)
returns jsonb language plpgsql stable set search_path to 'public','pg_temp' as $function$
declare v_pool text; v_existe boolean; v_stock int; v_compat boolean; v_estado text; v_detalle text;
begin
  v_existe := exists(select 1 from prod_pieza where sku=p_sku) or exists(select 1 from prod_producto where sku=p_sku) or exists(select 1 from prod_insumo where sku=p_sku);
  v_pool := prod_pieza_pool(p_sku);
  v_compat := case p_bucket
    when 'pieza' then v_pool='melamina'
    when 'melamina' then v_pool='melamina'
    when 'patas' then v_pool='patas'
    when 'insumo' then v_pool='insumo'
    when 'terminado' then exists(select 1 from prod_producto where sku=p_sku)
    else false end;
  v_stock := case p_bucket
    when 'pieza' then coalesce((select disponible from prod_stock_pieza where pieza_sku=p_sku),0)
    when 'melamina' then coalesce((select disponible from prod_stock_melamina where pieza_sku=p_sku),0)
    when 'patas' then coalesce((select disponible from prod_stock_patas where tamano=(select tamano from prod_pata_tamano where pieza_sku=p_sku)),0)
    when 'insumo' then coalesce((select stock_actual::int from prod_insumo where sku=p_sku),0)
    when 'terminado' then coalesce((select disponible from prod_stock_terminado where producto_sku=p_sku),0)
    else 0 end;
  if p_bucket not in ('pieza','melamina','patas','insumo','terminado') then v_estado:='bloqueada'; v_detalle:='bucket_invalido';
  elsif not v_existe then v_estado:='bloqueada'; v_detalle:='sku_inexistente';
  elsif v_pool='desconocido' then v_estado:='bloqueada'; v_detalle:='sku_sin_pool';
  elsif not v_compat then v_estado:='bloqueada'; v_detalle:='sector_incompatible(pool='||v_pool||')';
  elsif p_cant is null or p_cant<=0 then v_estado:='bloqueada'; v_detalle:='cantidad_invalida';
  elsif coalesce(trim(p_motivo),'')='' then v_estado:='bloqueada'; v_detalle:='motivo_requerido';
  else v_estado:='valida'; v_detalle:='ok'; end if;
  return jsonb_build_object('sku',p_sku,'bucket',p_bucket,'pool',v_pool,'cantidad',p_cant,
    'stock_actual',v_stock,'stock_proyectado',v_stock+coalesce(p_cant,0),'estado',v_estado,'detalle',v_detalle);
end $function$;

create or replace function public.prod_rpc_stock_preview(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_role role_enum; v_active boolean; f jsonb; res jsonb := '[]'::jsonb; v jsonb;
  v_key text; v_seen text[] := '{}'; v_val int:=0; v_adv int:=0; v_blo int:=0;
begin
  select role, active into v_role, v_active from profiles where id=auth.uid();
  if v_role is null or v_active=false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado') then raise exception 'Sin permiso.' using errcode='42501'; end if;
  for f in select * from jsonb_array_elements(coalesce(p_payload->'filas','[]'::jsonb)) loop
    v := prod_stock_validar_fila(f->>'sku', f->>'bucket', (f->>'cantidad')::int, f->>'motivo');
    v_key := (f->>'sku')||'|'||(f->>'bucket');
    if v_key = any(v_seen) then v := v || jsonb_build_object('estado','advertencia','detalle','duplicado_en_lote'); end if;
    v_seen := v_seen || v_key;
    if v->>'estado'='valida' then v_val:=v_val+1; elsif v->>'estado'='advertencia' then v_adv:=v_adv+1; else v_blo:=v_blo+1; end if;
    res := res || v;
  end loop;
  return jsonb_build_object('lote_id', coalesce(p_payload->>'lote_id','(sin lote)'),
    'resumen', jsonb_build_object('validas',v_val,'advertencias',v_adv,'bloqueadas',v_blo,'total',jsonb_array_length(res)),
    'filas', res, 'aplicado', false);
end $function$;

create or replace function public.prod_rpc_stock_confirmar(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_role role_enum; v_active boolean; v_lote text; f jsonb; v jsonb; v_aplicadas int:=0; v_ya int:=0; v_tam text;
begin
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
    end case;
  end loop;
  return jsonb_build_object('ok',true,'lote_id',v_lote,'aplicadas_nuevas',v_aplicadas,'ya_aplicadas_idempotente',v_ya);
end $function$;

create or replace view public.prod_v_free_stock_conciliacion as
select fs.sku as legacy_sku,
  sc.modelo as nombre,
  sum(fs.cantidad) as cantidad_legacy,
  exists(select 1 from prod_producto p where p.sku=fs.sku) as mapea_a_producto,
  coalesce((select disponible from prod_stock_terminado t where t.producto_sku=fs.sku),0) as terminado_actual,
  case when exists(select 1 from prod_producto p where p.sku=fs.sku) then 'inequivoco'
       else 'sin_mapping' end as estado,
  'revisar/contar fisico antes de migrar' as accion_propuesta
from free_stock fs
left join sku_catalog sc on sc.sku=fs.sku
group by fs.sku, sc.modelo;
comment on view public.prod_v_free_stock_conciliacion is 'Bloque 5 — preview de conciliacion free_stock (legacy) -> prod_stock_terminado. NO migra. Estado inequivoco/sin_mapping.';
