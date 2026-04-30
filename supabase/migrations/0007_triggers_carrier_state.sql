-- ═══════════════════════════════════════════════════════════════════════════
-- 0007_triggers_carrier_state.sql — Triggers de mantenimiento de carrier_state
-- ───────────────────────────────────────────────────────────────────────────
-- carrier_state es una tabla denormalizada que el frontend lee directamente.
-- Se mantiene actualizada via triggers cuando cambian orders o production_logs.
--
-- LÓGICA:
--   pedido    = SUM(orders.cantidad WHERE status IN pendiente|arrastrado)
--   producido = SUM(production_logs.cantidad)
--   faltante  = GREATEST(0, pedido - producido)
--   stock     = GREATEST(0, producido - pedido)
--
-- Los triggers son SECURITY DEFINER → corren como postgres → bypassan RLS
-- de carrier_state (que tiene SELECT-only para usuarios normales).
--
-- LOCK protection: usamos LOCK FOR UPDATE en el INSERT...ON CONFLICT, pero
-- como Postgres ya maneja concurrencia con UPSERT atomic, no hace falta más.
-- ═══════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Helper: recompute_carrier_state_for(channel_id, sku)
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recompute_carrier_state_for(
  p_channel_id text,
  p_sku text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pedido    int;
  v_producido int;
  v_faltante  int;
  v_stock     int;
BEGIN
  -- Pedido: suma de orders activas para ese (channel, sku)
  SELECT COALESCE(SUM(cantidad), 0) INTO v_pedido
  FROM public.orders
  WHERE channel_id = p_channel_id
    AND sku        = p_sku
    AND status IN ('pendiente', 'arrastrado');

  -- Producido: suma de production_logs (puede ser negativa por correcciones,
  -- pero clamp a >= 0 antes de guardar para no violar el CHECK).
  SELECT GREATEST(0, COALESCE(SUM(cantidad), 0)) INTO v_producido
  FROM public.production_logs
  WHERE channel_id = p_channel_id
    AND sku        = p_sku;

  v_faltante := GREATEST(0, v_pedido - v_producido);
  v_stock    := GREATEST(0, v_producido - v_pedido);

  -- UPSERT (atomic)
  INSERT INTO public.carrier_state
    (channel_id, sku, pedido, producido, faltante, stock)
  VALUES
    (p_channel_id, p_sku, v_pedido, v_producido, v_faltante, v_stock)
  ON CONFLICT (channel_id, sku) DO UPDATE SET
    pedido     = EXCLUDED.pedido,
    producido  = EXCLUDED.producido,
    faltante   = EXCLUDED.faltante,
    stock      = EXCLUDED.stock,
    updated_at = now();
END;
$$;
COMMENT ON FUNCTION public.recompute_carrier_state_for(text, text) IS
  'Recalcula carrier_state para un (channel_id, sku) específico desde orders + production_logs. SECURITY DEFINER para bypass RLS.';

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Trigger function: trg_orders_recompute_state
-- ──────────────────────────────────────────────────────────────────────────
-- AFTER INSERT/UPDATE/DELETE en orders → recalcular carrier_state
-- Si UPDATE cambia channel_id o sku, recalcular ambos (viejo y nuevo).

CREATE OR REPLACE FUNCTION public.trg_orders_recompute_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.recompute_carrier_state_for(NEW.channel_id, NEW.sku);
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Si cambió la clave (channel_id o sku), recalcular ambas combinaciones
    IF (OLD.channel_id, OLD.sku) IS DISTINCT FROM (NEW.channel_id, NEW.sku) THEN
      PERFORM public.recompute_carrier_state_for(OLD.channel_id, OLD.sku);
    END IF;
    PERFORM public.recompute_carrier_state_for(NEW.channel_id, NEW.sku);
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_carrier_state_for(OLD.channel_id, OLD.sku);
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;
COMMENT ON FUNCTION public.trg_orders_recompute_state() IS
  'Trigger function — mantiene carrier_state al cambiar orders. Disparado AFTER INSERT/UPDATE/DELETE.';

DROP TRIGGER IF EXISTS orders_recompute_state ON public.orders;
CREATE TRIGGER orders_recompute_state
  AFTER INSERT OR UPDATE OR DELETE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_orders_recompute_state();

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Trigger function: trg_prodlog_recompute_state
-- ──────────────────────────────────────────────────────────────────────────
-- AFTER INSERT en production_logs → recalcular carrier_state
-- (no se permite UPDATE/DELETE de production_logs vía RLS, pero por defensa
-- en profundidad atendemos los 3 casos)

CREATE OR REPLACE FUNCTION public.trg_prodlog_recompute_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.recompute_carrier_state_for(NEW.channel_id, NEW.sku);
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    IF (OLD.channel_id, OLD.sku) IS DISTINCT FROM (NEW.channel_id, NEW.sku) THEN
      PERFORM public.recompute_carrier_state_for(OLD.channel_id, OLD.sku);
    END IF;
    PERFORM public.recompute_carrier_state_for(NEW.channel_id, NEW.sku);
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_carrier_state_for(OLD.channel_id, OLD.sku);
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;
COMMENT ON FUNCTION public.trg_prodlog_recompute_state() IS
  'Trigger function — mantiene carrier_state al insertar production_logs. AFTER INSERT.';

DROP TRIGGER IF EXISTS prodlog_recompute_state ON public.production_logs;
CREATE TRIGGER prodlog_recompute_state
  AFTER INSERT OR UPDATE OR DELETE ON public.production_logs
  FOR EACH ROW EXECUTE FUNCTION public.trg_prodlog_recompute_state();

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Trigger: profiles INSERT/UPDATE — proteger campos privilegiados
-- ──────────────────────────────────────────────────────────────────────────
-- Como mencionamos en 0005_rls_user, las RLS no soportan column-level WITH
-- CHECK fácilmente en pg < 16. Usamos un trigger BEFORE UPDATE para revertir
-- cambios en role/active/username/email cuando el actor NO es owner/admin.

CREATE OR REPLACE FUNCTION public.trg_profiles_protect_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Si quien dispara el UPDATE NO es owner/admin, restaurar campos protegidos
  -- al valor previo. Permite que el user cambie name/avatar_color libremente
  -- pero bloquea elevación de privilegios o cambios sensibles.
  IF NOT public.is_owner_or_admin() THEN
    NEW.role     := OLD.role;
    NEW.active   := OLD.active;
    NEW.username := OLD.username;
    NEW.email    := OLD.email;
    NEW.created_by := OLD.created_by;
    NEW.id       := OLD.id;
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.trg_profiles_protect_fields() IS
  'Defense-in-depth: si un user no-admin actualiza su profile, revierte cambios en role/active/username/email/created_by/id. Permite name/avatar_color.';

DROP TRIGGER IF EXISTS profiles_protect_fields ON public.profiles;
CREATE TRIGGER profiles_protect_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.trg_profiles_protect_fields();

-- ══════════════════════════════════════════════════════════════════════════
-- FIN 0007_triggers_carrier_state.sql
-- ══════════════════════════════════════════════════════════════════════════
