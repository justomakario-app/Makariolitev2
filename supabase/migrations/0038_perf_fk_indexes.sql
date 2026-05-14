-- ════════════════════════════════════════════════════════════════════
-- PERFORMANCE — Índices de cobertura para 9 foreign keys
-- ════════════════════════════════════════════════════════════════════
-- Lint de Supabase (unindexed_foreign_keys, nivel INFO) × 9:
--   FKs sin índice de cobertura. Sin índice, cada chequeo de integridad
--   referencial cuando se borra/actualiza la fila PADRE hace un seq scan
--   de la tabla hija, y los JOINs por esa columna no tienen soporte.
--
-- Estado al aplicar: todas las tablas afectadas están en 0 filas
-- (profiles = 9). Crear estos índices es instantáneo y ~16 kB c/u.
-- El valor real aparece cuando orders / production_logs / qr_scans /
-- carrier_state acumulen datos en producción.
--
-- Nota — 2 de las FKs aparecen como 2da columna de un índice compuesto
-- existente, lo que NO cubre el lookup por la FK sola:
--   - free_stock.source_jornada_id → 2da col de free_stock_pkey(sku, source_jornada_id)
--   - production_logs.channel_id   → 2da col de idx_prodlog_sku_channel(sku, channel_id)
-- Por eso ambas necesitan su propio índice.
--
-- Las 4 FKs que apuntan a profiles (imported_by, by_user, closed_by,
-- created_by) son de bajo valor de consulta pero el índice acelera el
-- chequeo de integridad al desactivar/borrar un profile.
--
-- Se usa CREATE INDEX IF NOT EXISTS — idempotente.
-- ════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_prodlog_channel              ON public.production_logs (channel_id);
CREATE INDEX IF NOT EXISTS idx_carrier_state_sku            ON public.carrier_state   (sku);
CREATE INDEX IF NOT EXISTS idx_qrscans_order                ON public.qr_scans        (order_id);
CREATE INDEX IF NOT EXISTS idx_free_stock_source_jornada    ON public.free_stock      (source_jornada_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_by            ON public.orders          (created_by);
CREATE INDEX IF NOT EXISTS idx_import_batches_imported_by   ON public.import_batches  (imported_by);
CREATE INDEX IF NOT EXISTS idx_jornada_audit_by_user        ON public.jornada_audit   (by_user);
CREATE INDEX IF NOT EXISTS idx_jornadas_closed_by           ON public.jornadas        (closed_by);
CREATE INDEX IF NOT EXISTS idx_profiles_created_by          ON public.profiles        (created_by);

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual, si se necesita revertir):
--   DROP INDEX IF EXISTS public.idx_prodlog_channel;
--   DROP INDEX IF EXISTS public.idx_carrier_state_sku;
--   DROP INDEX IF EXISTS public.idx_qrscans_order;
--   DROP INDEX IF EXISTS public.idx_free_stock_source_jornada;
--   DROP INDEX IF EXISTS public.idx_orders_created_by;
--   DROP INDEX IF EXISTS public.idx_import_batches_imported_by;
--   DROP INDEX IF EXISTS public.idx_jornada_audit_by_user;
--   DROP INDEX IF EXISTS public.idx_jornadas_closed_by;
--   DROP INDEX IF EXISTS public.idx_profiles_created_by;
-- ════════════════════════════════════════════════════════════════════
