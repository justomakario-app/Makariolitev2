-- ════════════════════════════════════════════════════════════════════
-- FIX bug FK sku_catalog_categoria_fkey
-- ════════════════════════════════════════════════════════════════════
-- Bug reportado por cliente: el flow "+ Nueva categoría" del modal de
-- SKU permite escribir una categoría custom (ej: "ACCESORIOS") pero
-- NO la inserta en sku_categories antes del INSERT en sku_catalog.
-- La FK rechaza con violación de constraint.
--
-- Fix estructural: nuevo RPC rpc_upsert_sku que encapsula ambos
-- INSERTs en una sola transacción atómica:
--   1. INSERT idempotente en sku_categories (ON CONFLICT DO NOTHING).
--      sort_order = MAX(sort_order) + 1 (fallback 1 si tabla vacía).
--   2. INSERT/UPDATE en sku_catalog.
-- Si el INSERT del SKU falla, el plpgsql ya hace rollback automático
-- del transaction → la categoría tampoco queda creada (cero huérfanas).
--
-- También se incluye un INSERT inicial de "ACCESORIOS" para resolver
-- el caso inmediato del cliente que reportó el bug (necesita crear
-- SKUs de repuestos en esa categoría).
--
-- Idempotente: CREATE OR REPLACE FUNCTION + ON CONFLICT en INSERTs.
-- ════════════════════════════════════════════════════════════════════

-- 1) Caso inmediato: agregar "ACCESORIOS" a la tabla maestra
INSERT INTO public.sku_categories (name, sort_order)
VALUES ('ACCESORIOS', COALESCE((SELECT MAX(sort_order) + 1 FROM public.sku_categories), 1))
ON CONFLICT (name) DO NOTHING;

-- 2) RPC nuevo: upsert atómico de SKU + auto-creación de categoría
CREATE OR REPLACE FUNCTION public.rpc_upsert_sku(
  p_sku           text,
  p_modelo        text,
  p_color         text DEFAULT NULL,
  p_color_hex     text DEFAULT NULL,
  p_categoria     text DEFAULT NULL,
  p_es_fabricado  boolean DEFAULT true,
  p_activo        boolean DEFAULT true,
  p_incompleto    boolean DEFAULT false,
  p_is_new        boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $func$
DECLARE
  v_role         role_enum;
  v_active_user  boolean;
  v_cat_created  boolean := false;
BEGIN
  -- Auth check
  SELECT role, active INTO v_role, v_active_user
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active_user = false THEN
    RAISE EXCEPTION 'Tu sesion expiro o tu cuenta esta desactivada.'
      USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin','encargado') THEN
    RAISE EXCEPTION 'No tenes permiso para modificar el catalogo.'
      USING ERRCODE='42501', HINT='not_authorized';
  END IF;

  -- Auto-crear categoría si no existe (idempotente).
  -- La transacción implícita del plpgsql garantiza atomicidad: si
  -- después el INSERT en sku_catalog falla, este INSERT también se
  -- revierte → cero categorías huérfanas sin SKU.
  IF p_categoria IS NOT NULL AND trim(p_categoria) <> '' THEN
    INSERT INTO public.sku_categories (name, sort_order)
    VALUES (
      p_categoria,
      COALESCE((SELECT MAX(sort_order) + 1 FROM public.sku_categories), 1)
    )
    ON CONFLICT (name) DO NOTHING;
    v_cat_created := FOUND;
  END IF;

  -- INSERT o UPDATE del SKU
  IF p_is_new THEN
    INSERT INTO public.sku_catalog
      (sku, modelo, color, color_hex, categoria, es_fabricado, activo, incompleto)
    VALUES
      (p_sku, p_modelo, p_color, p_color_hex, p_categoria, p_es_fabricado, p_activo, p_incompleto);
  ELSE
    UPDATE public.sku_catalog
       SET modelo       = p_modelo,
           color        = p_color,
           color_hex    = p_color_hex,
           categoria    = p_categoria,
           es_fabricado = p_es_fabricado,
           activo       = p_activo,
           incompleto   = p_incompleto,
           updated_at   = now()
     WHERE sku = p_sku;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SKU % no existe.', p_sku
        USING ERRCODE='23503', HINT='sku_not_found';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'sku', p_sku,
    'category_created', v_cat_created,
    'category', p_categoria
  );
END;
$func$;

REVOKE ALL ON FUNCTION public.rpc_upsert_sku(text,text,text,text,text,boolean,boolean,boolean,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_upsert_sku(text,text,text,text,text,boolean,boolean,boolean,boolean) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual, NO ejecutar sin entender la regresión):
--
-- DROP FUNCTION IF EXISTS public.rpc_upsert_sku(text,text,text,text,text,boolean,boolean,boolean,boolean);
--
-- DELETE FROM public.sku_categories WHERE name='ACCESORIOS'
--   AND NOT EXISTS (SELECT 1 FROM sku_catalog WHERE categoria='ACCESORIOS');
--
-- Frontend: revertir crearOActualizarSku al INSERT/UPDATE directo en
-- sku_catalog (ver commit b5ee82d~ anterior). El bug del FK vuelve.
-- ════════════════════════════════════════════════════════════════════
