-- ════════════════════════════════════════════════════════════════════
-- CAMBIO 2A — Schema "jornada por día completo"
-- ════════════════════════════════════════════════════════════════════
-- Cambios:
--   1) DROP UNIQUE(channel_id, fecha)
--   2) DROP FK channel_id → channels
--   3) DROP COLUMN channel_id (BD virgen → safe sin migración de data)
--   4) ADD UNIQUE(fecha)
--   5) Singleton partial unique index para is_active=true global
--   6) Comentario actualizado del snapshot (nuevo shape v2)
--
-- BD operativa 100% vacía cuando se aplicó (validado).
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.jornadas DROP CONSTRAINT jornadas_unique_per_channel_fecha;
ALTER TABLE public.jornadas DROP CONSTRAINT jornadas_channel_id_fkey;
ALTER TABLE public.jornadas DROP COLUMN channel_id;
ALTER TABLE public.jornadas ADD CONSTRAINT jornadas_unique_fecha UNIQUE (fecha);

CREATE UNIQUE INDEX jornadas_singleton_active_idx
  ON public.jornadas ((TRUE))
  WHERE is_active = TRUE;

COMMENT ON COLUMN public.jornadas.snapshot IS
  'Snapshot inmutable al cerrar. Array jsonb con elementos:
   {channel_id, sku, modelo, color, pedido, producido, faltante, stock}.
   Cubre TODOS los canales de la jornada del día (Cambio 2A — 2026-05-14).';

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual, requiere BD vacía para evitar pérdida de data):
-- ALTER TABLE public.jornadas DROP CONSTRAINT jornadas_unique_fecha;
-- DROP INDEX public.jornadas_singleton_active_idx;
-- ALTER TABLE public.jornadas ADD COLUMN channel_id text NOT NULL DEFAULT 'colecta';
-- ALTER TABLE public.jornadas ALTER COLUMN channel_id DROP DEFAULT;
-- ALTER TABLE public.jornadas ADD CONSTRAINT jornadas_channel_id_fkey
--   FOREIGN KEY (channel_id) REFERENCES channels(id) ON UPDATE CASCADE ON DELETE RESTRICT;
-- ALTER TABLE public.jornadas ADD CONSTRAINT jornadas_unique_per_channel_fecha
--   UNIQUE (channel_id, fecha);
-- ════════════════════════════════════════════════════════════════════
