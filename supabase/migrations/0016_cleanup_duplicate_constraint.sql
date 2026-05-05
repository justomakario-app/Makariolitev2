-- ════════════════════════════════════════════════════════════════════
-- CLEANUP — drop de constraint UNIQUE duplicada sobre jornadas
-- ════════════════════════════════════════════════════════════════════
-- La migration 0011 (Etapa 1) agregó `jornadas_unique_canal_fecha`
-- pero ya existía `jornadas_unique_per_channel_fecha` desde el schema
-- inicial (0001). Tener dos constraints UNIQUE sobre las mismas
-- columnas (channel_id, fecha) genera dos índices que escriben en
-- paralelo en cada INSERT/UPDATE — overhead innecesario.
--
-- El ON CONFLICT (channel_id, fecha) en los RPCs no referencia el
-- nombre del constraint, solo necesita que exista UNA unique sobre
-- esas columnas. Dropear la duplicada es seguro.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.jornadas DROP CONSTRAINT IF EXISTS jornadas_unique_canal_fecha;
