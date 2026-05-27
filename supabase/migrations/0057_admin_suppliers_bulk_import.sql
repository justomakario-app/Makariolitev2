-- ════════════════════════════════════════════════════════════════════
-- ADMIN MODULE — Suppliers Bulk Import (S2.4)
-- ════════════════════════════════════════════════════════════════════
-- 3 RPCs nuevos:
--   1) rpc_admin_check_cuits_exist(text[])
--      → jsonb { existing: [{cuit, id, nombre, activo}], not_existing: [text] }
--   2) rpc_admin_bulk_create_suppliers(jsonb)
--      → jsonb { created: int, errors: [{index, reason, ...}] }
--   3) rpc_admin_bulk_update_suppliers(jsonb)
--      → jsonb { updated: int, errors: [{index, reason, ...}] }
--
-- Patron comun:
--   - SECURITY DEFINER + search_path explicito.
--   - Auth gate (sesion + role IN ('owner','admin')).
--   - No-atomico: cada item en un BEGIN/EXCEPTION block para que un
--     error individual NO frene el resto del batch.
--   - bulk_update preserva regla S2.2 (CUIT inmutable).
--   - Cero ALTER de tablas.
-- ════════════════════════════════════════════════════════════════════

-- ── (1) rpc_admin_check_cuits_exist ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_check_cuits_exist(p_cuits text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_existing jsonb;
  v_not_existing jsonb;
BEGIN
  SELECT role, active INTO v_role, v_active
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized';
  END IF;

  -- existing: cuits del array que matchean en suppliers (activos O inactivos)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'cuit', s.cuit, 'id', s.id, 'nombre', s.nombre, 'activo', s.activo
  )), '[]'::jsonb) INTO v_existing
  FROM public.suppliers s
  WHERE s.cuit = ANY(p_cuits);

  -- not_existing: cuits del array que NO matchean (set diff)
  SELECT COALESCE(jsonb_agg(c), '[]'::jsonb) INTO v_not_existing
  FROM (
    SELECT unnest(p_cuits) AS c
    EXCEPT
    SELECT cuit FROM public.suppliers WHERE cuit IS NOT NULL
  ) sub;

  RETURN jsonb_build_object('existing', v_existing, 'not_existing', v_not_existing);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_check_cuits_exist(text[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_check_cuits_exist(text[]) TO authenticated;

-- ── (2) rpc_admin_bulk_create_suppliers ─────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_bulk_create_suppliers(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_items jsonb := COALESCE(p_payload->'items', '[]'::jsonb);
  v_count_created int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_supplier_id uuid;
  v_credit_id uuid;
  v_item jsonb;
  v_index int := 0;
BEGIN
  SELECT role, active INTO v_role, v_active
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized';
  END IF;

  IF jsonb_typeof(v_items) <> 'array' THEN
    RAISE EXCEPTION 'items debe ser array' USING ERRCODE='22023';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
    BEGIN
      INSERT INTO public.suppliers (
        nombre, cuit, email, telefono, notas, created_by,
        condicion_fiscal, condicion_iva,
        provincia, ciudad, direccion, codigo_postal,
        rubro, productos_habituales
      ) VALUES (
        NULLIF(trim(v_item->>'nombre'), ''),
        NULLIF(trim(v_item->>'cuit'), ''),
        NULLIF(trim(v_item->>'email'), ''),
        NULLIF(trim(v_item->>'telefono'), ''),
        NULLIF(trim(v_item->>'notas'), ''),
        auth.uid(),
        NULLIF(trim(v_item->>'condicion_fiscal'), ''),
        NULLIF(trim(v_item->>'condicion_iva'), ''),
        NULLIF(trim(v_item->>'provincia'), ''),
        NULLIF(trim(v_item->>'ciudad'), ''),
        NULLIF(trim(v_item->>'direccion'), ''),
        NULLIF(trim(v_item->>'codigo_postal'), ''),
        NULLIF(trim(v_item->>'rubro'), ''),
        NULLIF(trim(v_item->>'productos_habituales'), '')
      ) RETURNING id INTO v_supplier_id;

      INSERT INTO public.suppliers_credit (supplier_id)
      VALUES (v_supplier_id)
      RETURNING id INTO v_credit_id;

      v_count_created := v_count_created + 1;
    EXCEPTION
      WHEN unique_violation THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'index', v_index, 'reason', 'duplicate_cuit',
          'cuit', v_item->>'cuit'
        ));
      WHEN check_violation THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'index', v_index, 'reason', 'check_violation',
          'detail', SQLERRM
        ));
      WHEN OTHERS THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'index', v_index, 'reason', 'other',
          'sqlstate', SQLSTATE, 'detail', SQLERRM
        ));
    END;
    v_index := v_index + 1;
  END LOOP;

  RETURN jsonb_build_object('created', v_count_created, 'errors', v_errors);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_bulk_create_suppliers(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_bulk_create_suppliers(jsonb) TO authenticated;

-- ── (3) rpc_admin_bulk_update_suppliers ─────────────────────────────
--   Preserva regla S2.2: CUIT inmutable post-alta.
--   Patron MERGE con operador ? para presence-of-key.
CREATE OR REPLACE FUNCTION public.rpc_admin_bulk_update_suppliers(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role role_enum;
  v_active boolean;
  v_items jsonb := COALESCE(p_payload->'items', '[]'::jsonb);
  v_count_updated int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_item jsonb;
  v_index int := 0;
  v_id uuid;
  v_current_cuit text;
  v_new_cuit text;
BEGIN
  SELECT role, active INTO v_role, v_active
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Solo owner/admin.' USING ERRCODE='42501', HINT='not_authorized';
  END IF;

  IF jsonb_typeof(v_items) <> 'array' THEN
    RAISE EXCEPTION 'items debe ser array' USING ERRCODE='22023';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
    BEGIN
      v_id := NULLIF(v_item->>'id', '')::uuid;
      IF v_id IS NULL THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'index', v_index, 'reason', 'missing_id'
        ));
      ELSE
        -- Lock + leer cuit actual
        SELECT cuit INTO v_current_cuit
          FROM public.suppliers WHERE id = v_id FOR UPDATE;
        IF NOT FOUND THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object(
            'index', v_index, 'reason', 'not_found',
            'id', v_id::text
          ));
        ELSE
          -- Preservar regla S2.2: rechazar cambio de CUIT
          v_new_cuit := NULLIF(trim(v_item->>'cuit'), '');
          IF v_new_cuit IS NOT NULL AND v_new_cuit IS DISTINCT FROM v_current_cuit THEN
            v_errors := v_errors || jsonb_build_array(jsonb_build_object(
              'index', v_index, 'reason', 'cuit_immutable',
              'detail', 'El CUIT no se puede modificar via bulk import',
              'current_cuit', v_current_cuit,
              'new_cuit', v_new_cuit
            ));
          ELSE
            -- MERGE pattern (operador ? para presence-of-key)
            UPDATE public.suppliers SET
              nombre = CASE WHEN v_item ? 'nombre'
                            THEN COALESCE(NULLIF(trim(v_item->>'nombre'),''), nombre)
                            ELSE nombre END,
              email = CASE WHEN v_item ? 'email'
                           THEN NULLIF(trim(v_item->>'email'),'')
                           ELSE email END,
              telefono = CASE WHEN v_item ? 'telefono'
                              THEN NULLIF(trim(v_item->>'telefono'),'')
                              ELSE telefono END,
              notas = CASE WHEN v_item ? 'notas'
                           THEN NULLIF(trim(v_item->>'notas'),'')
                           ELSE notas END,
              condicion_fiscal = CASE WHEN v_item ? 'condicion_fiscal'
                                      THEN NULLIF(trim(v_item->>'condicion_fiscal'),'')
                                      ELSE condicion_fiscal END,
              condicion_iva = CASE WHEN v_item ? 'condicion_iva'
                                   THEN NULLIF(trim(v_item->>'condicion_iva'),'')
                                   ELSE condicion_iva END,
              provincia = CASE WHEN v_item ? 'provincia'
                               THEN NULLIF(trim(v_item->>'provincia'),'')
                               ELSE provincia END,
              ciudad = CASE WHEN v_item ? 'ciudad'
                            THEN NULLIF(trim(v_item->>'ciudad'),'')
                            ELSE ciudad END,
              direccion = CASE WHEN v_item ? 'direccion'
                               THEN NULLIF(trim(v_item->>'direccion'),'')
                               ELSE direccion END,
              codigo_postal = CASE WHEN v_item ? 'codigo_postal'
                                   THEN NULLIF(trim(v_item->>'codigo_postal'),'')
                                   ELSE codigo_postal END,
              rubro = CASE WHEN v_item ? 'rubro'
                           THEN NULLIF(trim(v_item->>'rubro'),'')
                           ELSE rubro END,
              productos_habituales = CASE WHEN v_item ? 'productos_habituales'
                                          THEN NULLIF(trim(v_item->>'productos_habituales'),'')
                                          ELSE productos_habituales END
            WHERE id = v_id;
            v_count_updated := v_count_updated + 1;
          END IF;
        END IF;
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'index', v_index, 'reason', 'other',
          'sqlstate', SQLSTATE, 'detail', SQLERRM
        ));
    END;
    v_index := v_index + 1;
  END LOOP;

  RETURN jsonb_build_object('updated', v_count_updated, 'errors', v_errors);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_admin_bulk_update_suppliers(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_admin_bulk_update_suppliers(jsonb) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual):
--   DROP FUNCTION IF EXISTS public.rpc_admin_bulk_update_suppliers(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_admin_bulk_create_suppliers(jsonb);
--   DROP FUNCTION IF EXISTS public.rpc_admin_check_cuits_exist(text[]);
-- ════════════════════════════════════════════════════════════════════
