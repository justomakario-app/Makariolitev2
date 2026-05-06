-- ════════════════════════════════════════════════════════════════════
-- ETAPA — Schema para CARGA MANUAL DE PEDIDOS + EDICIÓN DE PEDIDOS
-- ════════════════════════════════════════════════════════════════════
-- Sub-etapa 2.1 del plan aprobado.
--
-- Cambios:
--   1) sku_catalog.incompleto bool — flag para SKUs creados al vuelo
--   2) order_origen_enum + orders.origen — distingue 'excel' vs 'manual'
--   3) orders.version int — optimistic locking en edición
--   4) orders.created_by uuid — trazabilidad de quién creó manuales
--   5) order_edit_log + index + RLS — auditoría obligatoria de ediciones
--
-- Idempotente. Reaplicable. Backfill por defaults (sin UPDATEs explícitos).
--
-- IMPORTANTE: rpc_import_batch NO se toca (decisión Q9 - Opción A).
-- Las orders importadas siguen entrando con origen='excel' (default),
-- jornada_id=NULL (se asigna retroactivo en cierre), version=1.
--
-- TODO Q9 — cuando se retome la tarea de "tabs por fecha de entrega":
--   modificar rpc_import_batch para retornar `skipped_edited_orders`
--   cuando un re-import detecta orders con entries en order_edit_log.
--   Por ahora el re-import saltea silenciosamente vía UNIQUE
--   (channel_id, order_number, sku).
--
-- Rollback documentado al final del archivo.
-- ════════════════════════════════════════════════════════════════════

-- ── 1) sku_catalog.incompleto ──────────────────────────────────────
ALTER TABLE public.sku_catalog
  ADD COLUMN IF NOT EXISTS incompleto boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.sku_catalog.incompleto IS
  'true si el SKU fue creado al vuelo desde carga manual con datos minimos. Permite que admin despues complete categoria, color_hex, foto, etc. El SKU funciona normalmente para produccion y dashboards mientras esta incompleto.';

-- ── 2) order_origen_enum + orders.origen ────────────────────────────
DO $mig$ BEGIN
  CREATE TYPE order_origen_enum AS ENUM ('excel', 'manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $mig$;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS origen order_origen_enum NOT NULL DEFAULT 'excel';

COMMENT ON COLUMN public.orders.origen IS
  'excel = importado por rpc_import_batch. manual = creado por rpc_create_manual_order. Backfill: orders pre-feature todas excel via default.';

-- ── 3) orders.version (optimistic locking) ──────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.orders.version IS
  'Optimistic locking. Se incrementa en cada UPDATE via rpc_edit_order. El RPC valida match antes de aplicar el cambio - si difiere, rechaza con concurrent_edit.';

-- ── 4) orders.created_by ────────────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.orders.created_by IS
  'Usuario que creo el row. NULL para orders importadas de Excel pre-feature. Set por rpc_create_manual_order al insertar manuales.';

-- ── 5) order_edit_log ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.order_edit_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  channel_id text NOT NULL,
  order_number text NOT NULL,
  sku text,                      -- item afectado; NULL si meta-cambio (no aplica V1)
  evento text NOT NULL CHECK (evento IN ('cantidad_changed', 'item_added', 'item_removed')),
  cantidad_anterior int,         -- valor previo (NULL si item_added)
  cantidad_nueva int,            -- valor nuevo (NULL si item_removed)
  motivo text,                   -- libre, opcional
  by_user uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_edit_log_lookup_idx
  ON public.order_edit_log (channel_id, order_number, at DESC);

CREATE INDEX IF NOT EXISTS order_edit_log_user_idx
  ON public.order_edit_log (by_user, at DESC);

COMMENT ON TABLE public.order_edit_log IS
  'Auditoria de ediciones sobre orders. Atomic con cada cambio (rpc_edit_order). Sin rows aca - pedido no editado. NUNCA UPDATE/DELETE.';

ALTER TABLE public.order_edit_log ENABLE ROW LEVEL SECURITY;

-- Lectura: cualquier authenticated activo. INSERT solo via SECURITY DEFINER del RPC
-- (sin policy de INSERT directo - bloqueado por defecto con RLS habilitada).
DROP POLICY IF EXISTS order_edit_log_select_authenticated ON public.order_edit_log;
CREATE POLICY order_edit_log_select_authenticated ON public.order_edit_log
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.active = true
  ));

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual, NO ejecutar sin verificar que no hay manuales en BD):
--
-- DROP TABLE IF EXISTS public.order_edit_log;
-- ALTER TABLE public.orders DROP COLUMN IF EXISTS created_by;
-- ALTER TABLE public.orders DROP COLUMN IF EXISTS version;
-- ALTER TABLE public.orders DROP COLUMN IF EXISTS origen;
-- DROP TYPE IF EXISTS order_origen_enum;
-- ALTER TABLE public.sku_catalog DROP COLUMN IF EXISTS incompleto;
-- ════════════════════════════════════════════════════════════════════
