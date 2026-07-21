-- 0107 · Dashboard canónico dinámico (backend). Métricas separadas: órdenes / unidades / netas / excedente.
-- (Aplicada en remoto vía MCP el 2026-07-20; reconstruida como archivo local — no re-ejecutar. Nota: 0110 la reemplaza con pino_estado dinámico.)
create or replace function public.prod_rpc_dashboard(p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_role role_enum; v_active boolean; v_j uuid; v_jrow record; v_use_j boolean;
begin
  select role, active into v_role, v_active from profiles where id = auth.uid();
  if v_role is null or v_active = false then raise exception 'Tu sesion expiro.' using errcode='42501'; end if;
  if v_role not in ('owner','admin','encargado','cnc','melamina','pino','embalaje') then raise exception 'Sin permiso.' using errcode='42501'; end if;

  v_j := nullif(p_payload->>'jornada_id','')::uuid;
  if v_j is null then select id into v_j from prod_jornada where estado in ('abierta','en_proceso','preparada') order by fecha desc limit 1; end if;
  select id, fecha, estado into v_jrow from prod_jornada where id = v_j;
  v_use_j := v_j is not null and exists (select 1 from prod_jornada_orden where jornada_id = v_j);

  return jsonb_build_object(
    'generado_at', now(),
    'jornada', case when v_jrow.id is not null then jsonb_build_object('id',v_jrow.id,'fecha',v_jrow.fecha,'estado',v_jrow.estado) else null end,
    'resumen', jsonb_build_object(
      'fuente', case when v_use_j then 'jornada' else 'demanda_global_pendiente' end,
      'ordenes_vinculadas', case when v_use_j then (select count(*) from prod_jornada_orden where jornada_id=v_j)
                                 else (select count(*) from orders where status::text in ('pendiente','arrastrado')) end,
      'unidades_vendidas', case when v_use_j then (select coalesce(sum(snapshot_cantidad),0) from prod_jornada_orden where jornada_id=v_j)
                                else (select coalesce(sum(cantidad),0) from orders where status::text in ('pendiente','arrastrado')) end,
      'unidades_producidas_aplicables', (select coalesce(sum(least(cs.producido, p.ped)),0)
        from (select sku,channel_id,sum(cantidad) ped from orders where status::text in ('pendiente','arrastrado') group by 1,2) p
        join carrier_state cs on cs.sku=p.sku and cs.channel_id=p.channel_id),
      'unidades_netas_a_producir', (select coalesce(sum(greatest(p.ped-coalesce(cs.producido,0),0)),0)
        from (select sku,channel_id,sum(cantidad) ped from orders where status::text in ('pendiente','arrastrado') group by 1,2) p
        left join carrier_state cs on cs.sku=p.sku and cs.channel_id=p.channel_id),
      'excedente_producido_pendiente_conciliacion', (select coalesce(sum(greatest(cs.producido - coalesce(p.ped,0),0)),0)
        from carrier_state cs left join (select sku,channel_id,sum(cantidad) ped from orders where status::text in ('pendiente','arrastrado') group by 1,2) p
          on p.sku=cs.sku and p.channel_id=cs.channel_id where cs.producido>0)
    ),
    'necesidades_por_pieza', (select coalesce(jsonb_agg(t order by t->>'faltante_neto' desc),'[]'::jsonb) from (
        select jsonb_build_object('sku',sku,'pool',prod_pieza_pool(sku),'demanda_bruta',demanda_bruta,
          'stock_utilizable',stock_utilizable,'faltante_neto',faltante_neto) as t
        from prod_v_faltante where faltante_neto > 0 order by faltante_neto desc limit 100) x),
    'stock', jsonb_build_object(
      'canonico_pieza_cnc', (select coalesce(sum(disponible),0) from prod_stock_pieza),
      'canonico_melamina', (select coalesce(sum(disponible),0) from prod_stock_melamina),
      'canonico_patas', (select coalesce(sum(disponible),0) from prod_stock_patas),
      'canonico_terminado', (select coalesce(sum(disponible),0) from prod_stock_terminado),
      'legacy_free_stock_pendiente_conciliacion', (select coalesce(sum(cantidad),0) from free_stock),
      'carga_inicial_lotes', (select count(distinct lote_id) from prod_stock_ajuste)
    ),
    'sectores', jsonb_build_object(
      'cnc_cortes', (select count(*) from prod_corte where jornada_id = v_j),
      'melamina_registros', (select count(*) from prod_melamina where jornada_id = v_j),
      'pino_registros', (select count(*) from prod_pino where jornada_id = v_j),
      'embalaje_registros', (select count(*) from prod_embalaje where jornada_id = v_j),
      'pino_estado', 'pendiente_validacion_patas'
    ),
    'calidad_datos', jsonb_build_object(
      'recetas_completa', (select count(*) from prod_v_producto_receta_estado where receta_estado='COMPLETA'),
      'recetas_incompleta_patas', (select count(*) from prod_v_producto_receta_estado where receta_estado='INCOMPLETA_PATAS'),
      'recetas_incompleta_config', (select count(*) from prod_v_producto_receta_estado where receta_estado='INCOMPLETA_CONFIG'),
      'skus_sin_pool_desconocido', (select count(*) from (select sku from prod_pieza union select pieza_sku from prod_receta) s where prod_pieza_pool(s.sku)='desconocido')
    )
  );
end $function$;
