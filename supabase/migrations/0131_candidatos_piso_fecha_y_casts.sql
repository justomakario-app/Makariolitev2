-- 0131 · M11 (+B08 parcial) — piso seguro para 'fecha_desde' y casts protegidos en prod_fn_candidatos.
-- Evita que un typo de año (2025 por 2026) vincule de una vez las ~506 ventas legacy: el scope por
-- fecha admite como máximo 90 días hacia atrás; para ventas más viejas queda la selección explícita
-- ('order_ids' / 'import_batch'), que es consciente y acotada. Casts de fecha/uuid con error claro.
-- LOCAL: NO aplicada en remoto (se aplica primero en el entorno aislado).
-- Contrato intacto: misma firma, mismas columnas de retorno, misma semántica para los scopes válidos.

create or replace function public.prod_fn_candidatos(p_origen jsonb, p_jornada uuid)
returns table(order_id uuid, sku text, channel text, cantidad integer, estado text)
language plpgsql stable security definer set search_path to 'public','pg_temp' as $function$
declare
  v_tipo text := coalesce(p_origen->>'tipo','');
  v_fecha date; v_piso date := current_date - 90;
  v_ids uuid[];
  v_batch uuid;
begin
  if v_tipo = 'fecha_desde' then
    begin
      v_fecha := (p_origen->>'fecha')::date;
    exception when others then
      raise exception 'fecha invalida: use AAAA-MM-DD (recibido: %).', coalesce(p_origen->>'fecha','(vacia)') using errcode='22023';
    end;
    if v_fecha is null then
      raise exception 'fecha requerida para el scope fecha_desde.' using errcode='22023';
    end if;
    if v_fecha < v_piso then
      raise exception 'La fecha % supera el piso de 90 dias (%). Para incorporar ventas anteriores usa la seleccion explicita por pedido o por lote de importacion.', v_fecha, v_piso using errcode='22023';
    end if;
  elsif v_tipo = 'order_ids' then
    begin
      select array_agg(v::uuid) into v_ids from jsonb_array_elements_text(coalesce(p_origen->'ids','[]'::jsonb)) v;
    exception when others then
      raise exception 'ids invalidos: se espera un array de UUID.' using errcode='22023';
    end;
  elsif v_tipo = 'import_batch' then
    begin
      v_batch := (p_origen->>'import_batch_id')::uuid;
    exception when others then
      raise exception 'import_batch_id invalido (UUID requerido).' using errcode='22023';
    end;
  end if;

  return query
  select o.id, o.sku, o.channel_id::text, o.cantidad, o.status::text
  from public.orders o
  where o.status::text in ('pendiente','arrastrado') and o.cancelled_at is null
    and (o.cantidad - public.prod_fn_asignado(o.id)) > 0
    and case v_tipo
          when 'import_batch' then o.import_batch_id = v_batch
          when 'fecha_desde'  then o.created_at::date >= v_fecha
          when 'order_ids'    then o.id = any(coalesce(v_ids, '{}'::uuid[]))
          when 'arrastre'     then exists (select 1 from public.prod_jornada_orden jo join public.prod_jornada j on j.id=jo.jornada_id where jo.order_id=o.id and j.estado='cerrada')
          else false end
    and not exists (select 1 from public.prod_jornada_orden jo join public.prod_jornada j on j.id=jo.jornada_id
      where jo.order_id=o.id and j.estado='abierta' and jo.jornada_id <> coalesce(p_jornada,'00000000-0000-0000-0000-000000000000'::uuid));
end $function$;
revoke execute on function public.prod_fn_candidatos(jsonb, uuid) from public, anon, authenticated;
