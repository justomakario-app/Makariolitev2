-- 0103: endurecer prod_pieza_pool (falso positivo TAP025→patas). Registro explícito de patas
-- (composición verificada en archivo: PAT001=chica, PAT002=grande) + rama 'desconocido' que NO
-- cae silenciosamente en patas. Embalaje falla con error claro si un componente no tiene pool.
-- (Aplicada en remoto vía MCP el 2026-07-20; reconstruida como archivo local — no re-ejecutar.)

create table if not exists public.prod_pata_tamano (
  pieza_sku text primary key references public.prod_pieza(sku) on delete restrict,
  tamano text not null check (tamano in ('chica','grande'))
);
comment on table public.prod_pata_tamano is 'Registro explícito de PATAS hoja y su tamaño (chica/grande) → mapea al pool prod_stock_patas. Composición verificada en archivo INSUMOS de Seba. NO define qué producto usa qué pata (eso es prod_componente + validación Seba).';
insert into public.prod_pata_tamano (pieza_sku, tamano) values ('PAT001','chica'),('PAT002','grande')
  on conflict (pieza_sku) do nothing;

create or replace function public.prod_pieza_pool(p_sku text)
returns text language sql stable
set search_path to 'public','pg_temp' as $$
  select case
    when exists (select 1 from public.prod_placa pl where pl.pieza_sku = p_sku)
      or exists (select 1 from public.prod_placa_pieza_extra e where e.pieza_sku = p_sku)
      then 'melamina'
    when exists (select 1 from public.prod_insumo i where i.sku = p_sku)      then 'insumo'
    when exists (select 1 from public.prod_pata_tamano t where t.pieza_sku = p_sku) then 'patas'
    when exists (select 1 from public.prod_componente c where c.padre_sku = p_sku) then 'otro'
    else 'desconocido'
  end
$$;
comment on function public.prod_pieza_pool(text) is
  'BUG-A/Bloque 8 v2 — pool de stock por componente. melamina=salida placa CNC; insumo=prod_insumo; patas=prod_pata_tamano (explícito); otro=compuesto; desconocido=sin metadatos (NO cae en patas). Sin prefijos.';

create or replace function public.prod_rpc_registrar_embalaje(p_payload jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public','pg_temp' as $function$
DECLARE
  v_role role_enum; v_active boolean; v_jornada uuid;
  v_prod text; v_unid int; v_canal text; v_order uuid;
  v_patas_tipo text; v_patas_cant int; v_patas_need int; v_disp_patas int; v_id uuid; v_terminado int;
  v_desconocidas text;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('embalaje','encargado','owner','admin') THEN RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;
  v_jornada := NULLIF(p_payload->>'jornada_id','')::uuid;
  IF v_jornada IS NULL THEN SELECT id INTO v_jornada FROM prod_jornada WHERE fecha = CURRENT_DATE AND estado = 'abierta'; END IF;
  IF v_jornada IS NULL THEN RAISE EXCEPTION 'No hay jornada abierta.' USING ERRCODE='P0002'; END IF;

  v_prod  := p_payload->>'producto_sku';
  v_unid  := COALESCE((p_payload->>'unidades')::int, 0);
  v_canal := NULLIF(trim(p_payload->>'canal'),'');
  v_order := NULLIF(p_payload->>'order_id','')::uuid;
  IF v_unid <= 0 THEN RAISE EXCEPTION 'unidades debe ser > 0.' USING ERRCODE='22023'; END IF;
  SELECT patas_tipo, COALESCE(patas_cant,0) INTO v_patas_tipo, v_patas_cant FROM prod_producto WHERE sku = v_prod;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto % no existe.', v_prod USING ERRCODE='22023'; END IF;

  WITH RECURSIVE bom AS (
    SELECT hijo_sku AS sku FROM prod_componente WHERE padre_sku = v_prod
    UNION ALL SELECT c.hijo_sku FROM bom b JOIN prod_componente c ON c.padre_sku = b.sku)
  SELECT string_agg(DISTINCT x.sku, ', ') INTO v_desconocidas
  FROM (SELECT DISTINCT sku FROM bom) x
  WHERE NOT EXISTS (SELECT 1 FROM prod_componente c WHERE c.padre_sku = x.sku)
    AND public.prod_pieza_pool(x.sku) = 'desconocido';
  IF v_desconocidas IS NOT NULL THEN
    RAISE EXCEPTION 'Configuracion incompleta: componentes sin pool (%).', v_desconocidas USING ERRCODE='42501'; END IF;

  IF EXISTS (
    SELECT 1 FROM prod_receta r LEFT JOIN prod_stock_melamina sm ON sm.pieza_sku = r.pieza_sku
    WHERE r.producto_sku = v_prod AND public.prod_pieza_pool(r.pieza_sku)='melamina'
      AND COALESCE(sm.disponible,0) < v_unid * r.cantidad
  ) THEN RAISE EXCEPTION 'Stock de melamina insuficiente para la receta.' USING ERRCODE='42501'; END IF;

  IF v_patas_tipo IS NOT NULL AND v_patas_cant > 0 THEN
    v_patas_need := v_unid * v_patas_cant;
    SELECT COALESCE(disponible,0) INTO v_disp_patas FROM prod_stock_patas WHERE tamano = v_patas_tipo;
    IF COALESCE(v_disp_patas,0) < v_patas_need THEN RAISE EXCEPTION 'Stock de patas insuficiente (disp %, requiere %).', COALESCE(v_disp_patas,0), v_patas_need USING ERRCODE='42501'; END IF;
  END IF;

  INSERT INTO prod_embalaje (jornada_id, producto_sku, unidades, canal, cargado_por)
  VALUES (v_jornada, v_prod, v_unid, v_canal, auth.uid()) RETURNING id INTO v_id;

  UPDATE prod_stock_melamina sm SET disponible = sm.disponible - (v_unid * r.cantidad), updated_at = now()
  FROM prod_receta r WHERE r.producto_sku = v_prod AND sm.pieza_sku = r.pieza_sku
    AND public.prod_pieza_pool(r.pieza_sku)='melamina';

  IF v_patas_tipo IS NOT NULL AND v_patas_cant > 0 THEN
    UPDATE prod_stock_patas SET disponible = disponible - (v_unid * v_patas_cant), updated_at = now() WHERE tamano = v_patas_tipo;
  END IF;

  INSERT INTO prod_stock_terminado (producto_sku, disponible) VALUES (v_prod, v_unid)
  ON CONFLICT (producto_sku) DO UPDATE SET disponible = prod_stock_terminado.disponible + v_unid, updated_at = now()
  RETURNING disponible INTO v_terminado;

  IF v_order IS NOT NULL THEN
    INSERT INTO prod_pedido_estado (order_id, estado, producto_sku, cantidad, registrado_por)
    VALUES (v_order, 'listo_despacho', v_prod, v_unid, auth.uid());
  END IF;

  RETURN jsonb_build_object('ok', true, 'embalaje_id', v_id, 'stock_terminado', v_terminado);
END $function$;
