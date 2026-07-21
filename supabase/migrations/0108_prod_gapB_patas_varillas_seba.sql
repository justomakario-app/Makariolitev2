-- 0108 · GAP-B — Reglas confirmadas por Seba (fuente de verdad). BOM canónico.
-- Precedencia: YORI/HIKARI → rectangulares → sets → mesas individuales. Mapeo EXPLÍCITO por SKU (no LIKE).
-- (Aplicada en remoto vía MCP el 2026-07-20; reconstruida como archivo local — no re-ejecutar.
--  NOTA: la regla de MESA se corrigió en 0109 a 3 GRANDES; este archivo deja el estado tal como se aplicó.)

-- (1) Varillas por LONGITUD (aditivo; VAR001/002 eran por diámetro). No migra stock de VAR002.
insert into public.prod_pieza (sku, nombre, naturaleza, vendible, largo) values
  ('VAR003','VARILLA 85CM','insumo',false,85),
  ('VAR004','VARILLA 45CM','insumo',false,45)
on conflict (sku) do nothing;
insert into public.prod_insumo (sku, nombre, categoria, sector, stock_actual, stock_minimo, unidad) values
  ('VAR003','VARILLA 85CM','Varilla','pino',0,0,'unidad'),
  ('VAR004','VARILLA 45CM','Varilla','pino',0,0,'unidad')
on conflict (sku) do nothing;

-- (2) BOM patas — SETS que estaban en 6 chicas → 3 chicas + 3 grandes (1×PAT005)
delete from public.prod_componente where padre_sku in ('MAD061','MAD062','MAD303','MAD304','MAD350','MAD351') and hijo_sku like 'PAT%';
insert into public.prod_componente (padre_sku, hijo_sku, cantidad)
  select unnest(array['MAD061','MAD062','MAD303','MAD304','MAD350','MAD351']), 'PAT005', 1;

-- (3) BOM patas — MESAS individuales que estaban en 3 grandes → (0108 puso 3 chicas; 0109 lo corrige a 3 grandes)
delete from public.prod_componente where padre_sku in ('MAD010','MAD011','MAD051','MAD052') and hijo_sku like 'PAT%';
insert into public.prod_componente (padre_sku, hijo_sku, cantidad)
  select unnest(array['MAD010','MAD011','MAD051','MAD052']), 'PAT003', 1;

-- (4) BOM varillas — YORI 4×85cm, HIKARI 4×45cm (cantidad y longitud corregidas)
delete from public.prod_componente where padre_sku='MAD300' and hijo_sku like 'VAR%';
insert into public.prod_componente (padre_sku, hijo_sku, cantidad) values ('MAD300','VAR003',4);
delete from public.prod_componente where padre_sku='MAD401' and hijo_sku like 'VAR%';
insert into public.prod_componente (padre_sku, hijo_sku, cantidad) values ('MAD401','VAR004',4);

-- (5) patas_confirmadas=true (Seba confirmó todo) + sincronizar patas_cant/tipo desde BOM (compat display)
update public.prod_producto set patas_confirmadas = true where vendible;
update public.prod_producto set patas_tipo='chica', patas_cant=3
  where sku in ('MAD010','MAD011','MAD020','MAD021','MAD030','MAD031','MAD040','MAD041','MAD051','MAD052');
update public.prod_producto set patas_tipo='grande', patas_cant=4 where sku in ('MAD200','MAD201');
update public.prod_producto set patas_tipo=null, patas_cant=0
  where sku in ('MAD061','MAD062','MAD095','MAD096','MAD190','MAD191','MAD301','MAD302','MAD303','MAD304','MAD350','MAD351','MAD300','MAD401');

-- (6) GAP-B — Embalaje consume patas desde el BOM (canónico), atómico, sin doble conteo.
create or replace function public.prod_rpc_registrar_embalaje(p_payload jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public','pg_temp' as $function$
DECLARE
  v_role role_enum; v_active boolean; v_jornada uuid;
  v_prod text; v_unid int; v_canal text; v_order uuid; v_id uuid; v_terminado int; v_desconocidas text;
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
  IF NOT EXISTS (SELECT 1 FROM prod_producto WHERE sku=v_prod) THEN RAISE EXCEPTION 'Producto % no existe.', v_prod USING ERRCODE='22023'; END IF;

  WITH RECURSIVE bom AS (
    SELECT hijo_sku AS sku FROM prod_componente WHERE padre_sku = v_prod
    UNION ALL SELECT c.hijo_sku FROM bom b JOIN prod_componente c ON c.padre_sku = b.sku)
  SELECT string_agg(DISTINCT x.sku, ', ') INTO v_desconocidas
  FROM (SELECT DISTINCT sku FROM bom) x
  WHERE NOT EXISTS (SELECT 1 FROM prod_componente c WHERE c.padre_sku = x.sku)
    AND public.prod_pieza_pool(x.sku) = 'desconocido';
  IF v_desconocidas IS NOT NULL THEN
    RAISE EXCEPTION 'Configuracion incompleta: componentes sin pool (%).', v_desconocidas USING ERRCODE='42501'; END IF;

  DROP TABLE IF EXISTS _patas_req;
  CREATE TEMP TABLE _patas_req ON COMMIT DROP AS
    WITH RECURSIVE bom AS (
      SELECT hijo_sku AS sku, cantidad::numeric AS qty FROM prod_componente WHERE padre_sku = v_prod
      UNION ALL SELECT c.hijo_sku, b.qty*c.cantidad FROM bom b JOIN prod_componente c ON c.padre_sku = b.sku)
    SELECT t.tamano, (sum(b.qty)*v_unid)::int AS need
    FROM bom b JOIN prod_pata_tamano t ON t.pieza_sku = b.sku GROUP BY t.tamano;

  IF EXISTS (
    SELECT 1 FROM prod_receta r LEFT JOIN prod_stock_melamina sm ON sm.pieza_sku = r.pieza_sku
    WHERE r.producto_sku = v_prod AND public.prod_pieza_pool(r.pieza_sku)='melamina'
      AND COALESCE(sm.disponible,0) < v_unid * r.cantidad
  ) THEN RAISE EXCEPTION 'Stock de melamina insuficiente para la receta.' USING ERRCODE='42501'; END IF;
  IF EXISTS (
    SELECT 1 FROM _patas_req r LEFT JOIN prod_stock_patas sp ON sp.tamano = r.tamano
    WHERE COALESCE(sp.disponible,0) < r.need
  ) THEN RAISE EXCEPTION 'Stock de patas insuficiente para la receta.' USING ERRCODE='42501'; END IF;

  INSERT INTO prod_embalaje (jornada_id, producto_sku, unidades, canal, cargado_por)
  VALUES (v_jornada, v_prod, v_unid, v_canal, auth.uid()) RETURNING id INTO v_id;

  UPDATE prod_stock_melamina sm SET disponible = sm.disponible - (v_unid * r.cantidad), updated_at = now()
  FROM prod_receta r WHERE r.producto_sku = v_prod AND sm.pieza_sku = r.pieza_sku
    AND public.prod_pieza_pool(r.pieza_sku)='melamina';

  UPDATE prod_stock_patas sp SET disponible = sp.disponible - r.need, updated_at = now()
  FROM _patas_req r WHERE sp.tamano = r.tamano;

  INSERT INTO prod_stock_terminado (producto_sku, disponible) VALUES (v_prod, v_unid)
  ON CONFLICT (producto_sku) DO UPDATE SET disponible = prod_stock_terminado.disponible + v_unid, updated_at = now()
  RETURNING disponible INTO v_terminado;

  IF v_order IS NOT NULL THEN
    INSERT INTO prod_pedido_estado (order_id, estado, producto_sku, cantidad, registrado_por)
    VALUES (v_order, 'listo_despacho', v_prod, v_unid, auth.uid());
  END IF;

  RETURN jsonb_build_object('ok', true, 'embalaje_id', v_id, 'stock_terminado', v_terminado);
END $function$;
