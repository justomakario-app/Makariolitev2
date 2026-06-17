-- ════════════════════════════════════════════════════════════════════
-- PRODUCCIÓN — Fase 6.2: consumo de insumos al embalar (cierra el loop)
-- ════════════════════════════════════════════════════════════════════
-- Hoy `prod_rpc_registrar_embalaje` descuenta melamina/patas/terminado pero
-- NO los insumos de materia prima (cajas, soportes, tornillos, tapatornillos).
-- Cuando se arma+embala un producto (flat-pack), su ferretería va en la caja
-- → ahí se consumen.
--
-- Diseño: TRIGGER AFTER INSERT en prod_embalaje (aditivo, NO toca la RPC core
-- ni su lógica de validación). Explota el BOM del producto a sus HOJAS atómicas
-- y descuenta de prod_insumo (× unidades embaladas). El join a prod_insumo deja
-- afuera tapas/patas (que viven en prod_stock_*), así NO hay doble descuento.
-- El trigger prod_insumo_alerta ya existente dispara las alertas solo.
--
-- Permite stock negativo (= déficit honesto: producir sin haber cargado el
-- remito); la vista de compras/materia prima lo refleja. Solo INSERT (las
-- correcciones por edición de unidades son raras y se concilian aparte).
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.prod_tg_embalaje_consumo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
BEGIN
  IF NEW.producto_sku IS NULL OR COALESCE(NEW.unidades, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  WITH RECURSIVE bom AS (
    SELECT hijo_sku AS sku, cantidad::numeric AS qty, 1 AS lvl
      FROM prod_componente WHERE padre_sku = NEW.producto_sku
    UNION ALL
    SELECT c.hijo_sku, b.qty * c.cantidad, b.lvl + 1
      FROM bom b JOIN prod_componente c ON c.padre_sku = b.sku
     WHERE b.lvl < 20
  ),
  hojas AS (
    SELECT b.sku, sum(b.qty) AS qty
      FROM bom b
     WHERE NOT EXISTS (SELECT 1 FROM prod_componente c WHERE c.padre_sku = b.sku)
     GROUP BY b.sku
  )
  UPDATE public.prod_insumo i
     SET stock_actual = COALESCE(i.stock_actual, 0) - (h.qty * NEW.unidades),
         updated_at = now()
    FROM hojas h
   WHERE h.sku = i.sku;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS prod_embalaje_consumo ON public.prod_embalaje;
CREATE TRIGGER prod_embalaje_consumo
  AFTER INSERT ON public.prod_embalaje
  FOR EACH ROW EXECUTE FUNCTION public.prod_tg_embalaje_consumo();

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual):
--   DROP TRIGGER IF EXISTS prod_embalaje_consumo ON public.prod_embalaje;
--   DROP FUNCTION IF EXISTS public.prod_tg_embalaje_consumo();
-- ════════════════════════════════════════════════════════════════════
