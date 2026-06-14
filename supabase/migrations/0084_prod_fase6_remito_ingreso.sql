-- ════════════════════════════════════════════════════════════════════
-- PRODUCCIÓN — Fase 6.2/6.3: ingreso de materia prima (remito)
-- ════════════════════════════════════════════════════════════════════
-- El encargado/administración carga un remito de mercadería → suma stock
-- de cada insumo y deja la cabecera como registro de entrada (trazabilidad).
-- La tabla prod_remito ya existe (id, proveedor, nro_remito, fecha, items,
-- cargado_por, created_at); el stock de materia prima vive en
-- prod_insumo.stock_actual. NO hay tabla de movimientos aparte: el remito
-- ES el asiento de entrada.
--
-- El ingreso NO usa factores de conversión (eso es Fase 6.1 / Compras, que
-- espera el "tornillos por caja" de Seba): se carga la unidad de CONSUMO
-- (la misma que guarda prod_insumo). 100% aditivo, gate owner/admin/encargado.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.prod_rpc_ingresar_remito(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_role role_enum; v_active boolean;
  v_items jsonb; v_item jsonb;
  v_sku text; v_cant numeric;
  v_remito_id uuid;
  v_count int := 0; v_total numeric := 0;
  v_exists boolean;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth'; END IF;
  IF v_role NOT IN ('owner','admin','encargado') THEN
    RAISE EXCEPTION 'Sin permiso para cargar remitos.' USING ERRCODE='42501', HINT='not_authorized'; END IF;

  v_items := p_payload->'items';
  IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'El remito no tiene items.' USING ERRCODE='22023', HINT='empty_items'; END IF;

  -- Validación previa (todo o nada): cada item con SKU conocido y cantidad > 0.
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    v_sku  := v_item->>'sku';
    v_cant := COALESCE((v_item->>'cantidad')::numeric, 0);
    IF v_sku IS NULL OR v_sku = '' THEN
      RAISE EXCEPTION 'Hay un item sin SKU.' USING ERRCODE='22023', HINT='bad_item'; END IF;
    IF v_cant <= 0 THEN
      RAISE EXCEPTION 'Cantidad invalida para %.', v_sku USING ERRCODE='22023', HINT='bad_qty'; END IF;
    SELECT true INTO v_exists FROM prod_insumo WHERE sku = v_sku;
    IF v_exists IS NOT TRUE THEN
      RAISE EXCEPTION 'El insumo % no existe.', v_sku USING ERRCODE='23503', HINT='unknown_sku'; END IF;
  END LOOP;

  -- Cabecera del remito (registro de entrada).
  INSERT INTO prod_remito (proveedor, nro_remito, fecha, items, cargado_por)
  VALUES (
    NULLIF(trim(p_payload->>'proveedor'), ''),
    NULLIF(trim(p_payload->>'nro_remito'), ''),
    COALESCE(NULLIF(p_payload->>'fecha','')::date, CURRENT_DATE),
    v_items,
    auth.uid()
  ) RETURNING id INTO v_remito_id;

  -- Suma de stock por item.
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    v_sku  := v_item->>'sku';
    v_cant := (v_item->>'cantidad')::numeric;
    UPDATE prod_insumo
      SET stock_actual = COALESCE(stock_actual, 0) + v_cant, updated_at = now()
      WHERE sku = v_sku;
    v_count := v_count + 1;
    v_total := v_total + v_cant;
  END LOOP;

  RETURN jsonb_build_object('remito_id', v_remito_id, 'items', v_count, 'total_unidades', v_total);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.prod_rpc_ingresar_remito(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.prod_rpc_ingresar_remito(jsonb) TO authenticated;

-- ── Realtime: el stock de insumos y los remitos también en vivo ──────
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.prod_insumo;
      EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.prod_remito;
      EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $do$;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual): DROP FUNCTION IF EXISTS public.prod_rpc_ingresar_remito(jsonb);
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.prod_insumo, public.prod_remito;
-- ════════════════════════════════════════════════════════════════════
