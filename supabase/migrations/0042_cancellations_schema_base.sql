-- ════════════════════════════════════════════════════════════════════
-- FEATURE — Cancelaciones ML: schema base (sin cambio funcional)
-- ════════════════════════════════════════════════════════════════════
-- Sebastian (encargado) reporta que el Excel de Mercado Libre trae
-- cancelaciones en la columna "Estado" = "Venta cancelada. No
-- despaches." Hoy se descartan sin persistirse. Esta migration agrega
-- el schema base para persistirlas en la tabla `orders` (sin tabla
-- nueva). El comportamiento del sistema NO cambia hasta que se aplique
-- la migration 0043 (rpc_import_batch v3).
--
-- Verificacion previa de regresion:
--   - recompute_carrier_state_for filtra orders por
--     status IN ('pendiente','arrastrado') y status='archivado'. El
--     valor nuevo 'cancelado' queda automaticamente excluido.
--     Conclusion: el trigger trg_orders_recompute_state propaga
--     UPDATEs correctamente sin necesidad de modificarlo.
--   - rpc_close_jornada filtra status IN ('pendiente','arrastrado') -
--     canceladas no entran en snapshot, arrastres ni archivado.
--   - Cero modificacion de triggers/RPCs en esta migration.
--
-- Cambios:
--   1) ADD VALUE 'cancelado' al enum order_status_enum.
--   2) Columna orders.cancelled_at timestamptz (nullable).
--   3) Columna orders.cancelled_in_jornada_id uuid REFERENCES
--      jornadas(id) (nullable). Es la jornada DONDE se REGISTRO la
--      cancelacion (puede diferir de orders.jornada_id si la
--      cancelacion llega en un import posterior a la jornada original).
--   4) Indice parcial para queries "cancelaciones del dia X".
--
-- Nota tecnica: el partial index usa "WHERE cancelled_in_jornada_id IS
-- NOT NULL" en lugar de "WHERE status = 'cancelado'" para no
-- referenciar el nuevo enum value en la misma transaccion donde se
-- agrega (restriccion de PG 15 para ALTER TYPE ADD VALUE). En la
-- practica ambos predicados son equivalentes (cancelled_in_jornada_id
-- solo se setea cuando status='cancelado').
-- ════════════════════════════════════════════════════════════════════

ALTER TYPE public.order_status_enum ADD VALUE IF NOT EXISTS 'cancelado';

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cancelled_at             timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_in_jornada_id  uuid REFERENCES public.jornadas(id);

CREATE INDEX IF NOT EXISTS idx_orders_cancelled_in_jornada
  ON public.orders (cancelled_in_jornada_id, sku)
  WHERE cancelled_in_jornada_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual):
--   -- Nota: PG no permite DROP VALUE de un enum. Si se quiere
--   -- revertir, el valor 'cancelado' queda huerfano (no lo usa nadie
--   -- hasta migration 0043). Si se aplica 0043 y luego se quiere
--   -- revertir, hay que primero rollback 0043 y despues:
--   DROP INDEX IF EXISTS public.idx_orders_cancelled_in_jornada;
--   ALTER TABLE public.orders
--     DROP COLUMN IF EXISTS cancelled_in_jornada_id,
--     DROP COLUMN IF EXISTS cancelled_at;
--   -- (el valor 'cancelado' del enum queda como dead code en el catalogo)
-- ════════════════════════════════════════════════════════════════════
