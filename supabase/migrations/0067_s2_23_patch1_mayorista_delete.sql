-- ════════════════════════════════════════════════════════════════════
-- S2.23 patch 1 — Soft delete de mayorista
-- ════════════════════════════════════════════════════════════════════
-- rpc_mayoristas_delete: owner-only. Marca activo=false en customers_b2b
-- (solo si es_mayorista). No borra físico (preserva pedidos/cta cte).
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rpc_mayoristas_delete(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role role_enum;
  v_active boolean;
BEGIN
  SELECT role, active INTO v_role, v_active FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active = false THEN
    RAISE EXCEPTION 'Tu sesion expiro.' USING ERRCODE='42501'; END IF;
  IF v_role NOT IN ('owner') THEN
    RAISE EXCEPTION 'Sin permiso.' USING ERRCODE='42501'; END IF;

  UPDATE public.customers_b2b
  SET activo = false
  WHERE id = (p_payload->>'id')::uuid
    AND es_mayorista = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mayorista no encontrado.' USING ERRCODE='P0002'; END IF;

  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE EXECUTE ON FUNCTION public.rpc_mayoristas_delete(jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.rpc_mayoristas_delete(jsonb) TO authenticated;

COMMENT ON FUNCTION public.rpc_mayoristas_delete(jsonb) IS
  'S2.23 patch1: owner-only. Soft delete (activo=false) de un mayorista. payload={id}.';

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual): DROP FUNCTION IF EXISTS public.rpc_mayoristas_delete(jsonb);
-- ════════════════════════════════════════════════════════════════════
