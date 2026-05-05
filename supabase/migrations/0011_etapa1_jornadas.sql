-- ════════════════════════════════════════════════════════════════════
-- ETAPA 1 — Jornada con estado + jornada activa para producción
-- ════════════════════════════════════════════════════════════════════
-- Fecha: 2026-05-04
-- Idempotente: usa IF NOT EXISTS / DO blocks que ignoran duplicates.
-- Reaplicable: backfill solo toca production_logs con jornada_id NULL.
--
-- Cambios:
--   1) Enum jornada_status_enum {abierta, cerrada}
--   2) jornadas: columnas status, abierta_at, is_active + UNIQUE(channel_id,fecha)
--      + partial unique para 1 jornada activa por canal
--   3) production_logs: columna jornada_id (nullable) FK
--   4) free_stock: nueva tabla (sku, source_jornada_id) + RLS placeholder
--   5) jornada_audit: nueva tabla (acciones abierta/cerrada/activada) + RLS
--   6) Backfill: crea jornadas artificiales 'cerrada' para los production_logs
--      existentes y los vincula. Idempotente.
--   7) RPCs: rpc_open_jornada, rpc_set_active_jornada (nuevos)
--      rpc_register_production v2 (con lookup de jornada activa)
--
-- Rollback documentado al final del archivo (NO ejecutar sin migrar datos).
-- ════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────
-- 1) ENUM
-- ──────────────────────────────────────────────────────────────────
DO $mig$ BEGIN
  CREATE TYPE jornada_status_enum AS ENUM ('abierta', 'cerrada');
EXCEPTION WHEN duplicate_object THEN NULL; END $mig$;

-- ──────────────────────────────────────────────────────────────────
-- 2) Columnas en jornadas
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE public.jornadas
  ADD COLUMN IF NOT EXISTS status jornada_status_enum NOT NULL DEFAULT 'cerrada',
  ADD COLUMN IF NOT EXISTS abierta_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.jornadas.status IS
  'abierta = recibe cargas; cerrada = inmutable (foto del cierre).';
COMMENT ON COLUMN public.jornadas.is_active IS
  'Solo UNA jornada por canal puede estar is_active=true. Es la que recibe cargas por default cuando el operario no elige a mano.';

-- UNIQUE (channel_id, fecha) — bloquea doble-cierre / duplicados.
DO $mig$ BEGIN
  ALTER TABLE public.jornadas
    ADD CONSTRAINT jornadas_unique_canal_fecha UNIQUE (channel_id, fecha);
EXCEPTION WHEN duplicate_object THEN NULL; END $mig$;

-- Partial unique: a lo sumo una jornada is_active=true por canal.
-- (No filtramos por status='abierta' para que cerrar una jornada activa
-- requiera explícitamente bajar el flag — el RPC de cierre lo hace.)
CREATE UNIQUE INDEX IF NOT EXISTS jornadas_one_active_per_channel
  ON public.jornadas (channel_id) WHERE is_active = true;

-- ──────────────────────────────────────────────────────────────────
-- 3) production_logs.jornada_id
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE public.production_logs
  ADD COLUMN IF NOT EXISTS jornada_id uuid REFERENCES public.jornadas(id);

CREATE INDEX IF NOT EXISTS prod_logs_jornada_idx
  ON public.production_logs(jornada_id) WHERE jornada_id IS NOT NULL;

COMMENT ON COLUMN public.production_logs.jornada_id IS
  'Jornada destino del log. Set por rpc_register_production. NULL solo en logs históricos pre-Etapa1 (backfill los completa).';

-- ──────────────────────────────────────────────────────────────────
-- 4) free_stock
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.free_stock (
  sku text NOT NULL REFERENCES public.sku_catalog(sku),
  source_jornada_id uuid REFERENCES public.jornadas(id),
  cantidad int NOT NULL CHECK (cantidad >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sku, source_jornada_id)
);

COMMENT ON TABLE public.free_stock IS
  'Unidades producidas que NO están asignadas a ningún canal. Resultado de "Mover a stock libre" en el cierre, o de stock walk-in. Reasignable a cualquier canal con rpc_assign_free_stock (Etapa 4).';

ALTER TABLE public.free_stock ENABLE ROW LEVEL SECURITY;
-- Policies se agregan en Etapa 4 cuando se introduzca el RPC de uso.

-- ──────────────────────────────────────────────────────────────────
-- 5) jornada_audit
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.jornada_audit (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  jornada_id uuid REFERENCES public.jornadas(id),
  accion text NOT NULL CHECK (accion IN ('abierta','cerrada','activada')),
  motivo text,
  by_user uuid REFERENCES public.profiles(id),
  at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jornada_audit_jornada_idx
  ON public.jornada_audit(jornada_id, at DESC);

COMMENT ON TABLE public.jornada_audit IS
  'Auditoría de eventos sobre jornadas (apertura, cierre, cambio de jornada activa). En V1 solo tres acciones — reapertura no soportada.';

ALTER TABLE public.jornada_audit ENABLE ROW LEVEL SECURITY;
-- Lectura para owner/admin/encargado, INSERT solo desde RPCs (SECURITY DEFINER).
DROP POLICY IF EXISTS jornada_audit_select_admins ON public.jornada_audit;
CREATE POLICY jornada_audit_select_admins ON public.jornada_audit
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.active = true
      AND p.role IN ('owner','admin','encargado')
  ));

-- ──────────────────────────────────────────────────────────────────
-- 6) BACKFILL — production_logs históricos
-- ──────────────────────────────────────────────────────────────────
-- Las jornadas artificiales del backfill no tienen autor del cierre
-- (no es un cierre real). Hacemos closed_by nullable. El RPC de cierre
-- (rpc_close_jornada) siempre setea closed_by = auth.uid() en cierres
-- reales, así que la integridad operativa se mantiene.
ALTER TABLE public.jornadas ALTER COLUMN closed_by DROP NOT NULL;

-- Para cada (channel_id, fecha) único de logs sin jornada, creamos una
-- jornada artificial 'cerrada' (no afecta UX porque no se ve abierta) con
-- abierta_at = fecha::timestamptz y la vinculamos a los logs.
DO $mig$
DECLARE
  v_grupo record;
  v_jornada_id uuid;
BEGIN
  FOR v_grupo IN
    SELECT channel_id, fecha
    FROM public.production_logs
    WHERE jornada_id IS NULL
    GROUP BY channel_id, fecha
  LOOP
    -- Reuso si ya existe la jornada (por idempotencia) — sino la creo.
    SELECT id INTO v_jornada_id
    FROM public.jornadas
    WHERE channel_id = v_grupo.channel_id AND fecha = v_grupo.fecha;

    IF v_jornada_id IS NULL THEN
      INSERT INTO public.jornadas
        (channel_id, fecha, status, abierta_at, is_active, snapshot, closed_at, closed_by)
      VALUES
        (v_grupo.channel_id, v_grupo.fecha, 'cerrada', v_grupo.fecha::timestamptz, false,
         '[]'::jsonb, v_grupo.fecha::timestamptz, NULL)
      RETURNING id INTO v_jornada_id;
    END IF;

    UPDATE public.production_logs
    SET jornada_id = v_jornada_id
    WHERE jornada_id IS NULL
      AND channel_id = v_grupo.channel_id
      AND fecha = v_grupo.fecha;
  END LOOP;
END $mig$;

-- ════════════════════════════════════════════════════════════════════
-- 7) RPCs
-- ════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────
-- rpc_open_jornada — abre (o reactiva si ya estaba abierta) una
-- jornada para un canal+fecha. La marca como is_active=true
-- automáticamente, desactivando la anterior del mismo canal.
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_open_jornada(
  p_channel_id text,
  p_fecha date DEFAULT NULL
) RETURNS public.jornadas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $func$
DECLARE
  v_role        role_enum;
  v_active_user boolean;
  v_fecha       date;
  v_existing    public.jornadas;
  v_jornada     public.jornadas;
BEGIN
  -- Auth
  SELECT role, active INTO v_role, v_active_user
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active_user = false THEN
    RAISE EXCEPTION 'Tu sesion expiro o tu cuenta esta desactivada.'
      USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin','encargado') THEN
    RAISE EXCEPTION 'Solo owner, admin o encargado pueden abrir jornadas.'
      USING ERRCODE='42501', HINT='not_authorized';
  END IF;

  -- Canal existe?
  IF NOT EXISTS (SELECT 1 FROM public.channels WHERE id = p_channel_id) THEN
    RAISE EXCEPTION 'El canal % no existe.', p_channel_id
      USING ERRCODE='23503', HINT='channel_not_found';
  END IF;

  v_fecha := COALESCE(p_fecha, current_date);

  -- ¿Ya existe una jornada para (canal, fecha)?
  SELECT * INTO v_existing
    FROM public.jornadas
    WHERE channel_id = p_channel_id AND fecha = v_fecha
    -- LOCK por canal — bloquea otros opens/registros del mismo canal
    -- mientras este RPC corre, sin afectar inserts a otros canales.
    FOR UPDATE;

  IF v_existing.id IS NOT NULL AND v_existing.status = 'cerrada' THEN
    RAISE EXCEPTION 'Ya existe una jornada cerrada para % del %. No se puede reabrir desde aca.',
      p_channel_id, to_char(v_fecha, 'DD/MM/YYYY')
      USING ERRCODE='22023', HINT='already_closed';
  END IF;

  -- Desactivar la activa actual del canal (si la hay y no es esta misma)
  UPDATE public.jornadas SET is_active = false
   WHERE channel_id = p_channel_id
     AND is_active = true
     AND (v_existing.id IS NULL OR id <> v_existing.id);

  IF v_existing.id IS NOT NULL THEN
    -- Reactivar la abierta existente
    UPDATE public.jornadas
       SET is_active = true,
           abierta_at = COALESCE(abierta_at, now())
     WHERE id = v_existing.id
    RETURNING * INTO v_jornada;
  ELSE
    INSERT INTO public.jornadas
      (channel_id, fecha, status, abierta_at, is_active, snapshot)
    VALUES
      (p_channel_id, v_fecha, 'abierta', now(), true, '[]'::jsonb)
    RETURNING * INTO v_jornada;
  END IF;

  -- Audit
  INSERT INTO public.jornada_audit (jornada_id, accion, by_user)
  VALUES (v_jornada.id, 'abierta', auth.uid());

  RETURN v_jornada;
END;
$func$;

REVOKE ALL ON FUNCTION public.rpc_open_jornada(text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_open_jornada(text, date) TO authenticated;

-- ──────────────────────────────────────────────────────────────────
-- rpc_set_active_jornada — cambia manualmente cuál jornada del canal
-- está marcada como activa para producción.
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_set_active_jornada(
  p_jornada_id uuid
) RETURNS public.jornadas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $func$
DECLARE
  v_role        role_enum;
  v_active_user boolean;
  v_jornada     public.jornadas;
BEGIN
  SELECT role, active INTO v_role, v_active_user
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active_user = false THEN
    RAISE EXCEPTION 'Tu sesion expiro o tu cuenta esta desactivada.'
      USING ERRCODE='42501', HINT='auth';
  END IF;
  IF v_role NOT IN ('owner','admin','encargado') THEN
    RAISE EXCEPTION 'No tenes permiso para cambiar la jornada activa.'
      USING ERRCODE='42501', HINT='not_authorized';
  END IF;

  SELECT * INTO v_jornada FROM public.jornadas
   WHERE id = p_jornada_id FOR UPDATE;
  IF v_jornada.id IS NULL THEN
    RAISE EXCEPTION 'La jornada solicitada no existe.'
      USING ERRCODE='23503', HINT='not_found';
  END IF;
  IF v_jornada.status = 'cerrada' THEN
    RAISE EXCEPTION 'No podes activar una jornada cerrada (% del %).',
      v_jornada.channel_id, to_char(v_jornada.fecha, 'DD/MM')
      USING ERRCODE='22023', HINT='cerrada';
  END IF;

  -- Si ya está activa, no-op idempotente
  IF v_jornada.is_active THEN
    RETURN v_jornada;
  END IF;

  -- Desactivar la otra activa del mismo canal
  UPDATE public.jornadas SET is_active = false
   WHERE channel_id = v_jornada.channel_id AND is_active = true AND id <> p_jornada_id;

  UPDATE public.jornadas SET is_active = true
   WHERE id = p_jornada_id
  RETURNING * INTO v_jornada;

  INSERT INTO public.jornada_audit (jornada_id, accion, by_user)
  VALUES (p_jornada_id, 'activada', auth.uid());

  RETURN v_jornada;
END;
$func$;

REVOKE ALL ON FUNCTION public.rpc_set_active_jornada(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_set_active_jornada(uuid) TO authenticated;

-- ──────────────────────────────────────────────────────────────────
-- rpc_register_production v2 — agrega lookup de jornada activa.
-- Compatible con el call-site existente (p_jornada_id es opcional).
-- IMPORTANTE: Postgres permite overloading. La firma vieja (4 args)
-- queda colgada después de CREATE OR REPLACE de la nueva (5 args), lo
-- que produce ambigüedad cuando PostgREST resuelve el RPC por named
-- params. Hay que dropearla explícitamente.
-- ──────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.rpc_register_production(text, text, integer, text);

CREATE OR REPLACE FUNCTION public.rpc_register_production(
  p_sku text,
  p_channel_id text,
  p_cantidad integer,
  p_notas text DEFAULT NULL,
  p_jornada_id uuid DEFAULT NULL
) RETURNS public.production_logs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $func$
DECLARE
  v_role         role_enum;
  v_active_user  boolean;
  v_sector       text;
  v_log          public.production_logs;
  v_jornada_id   uuid;
  v_open_count   int;
  v_jornada_row  public.jornadas;
BEGIN
  -- Auth
  SELECT role, active INTO v_role, v_active_user
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado o sin profile' USING ERRCODE='42501';
  END IF;
  IF v_active_user = false THEN
    RAISE EXCEPTION 'Usuario desactivado' USING ERRCODE='42501';
  END IF;

  -- Validaciones
  IF p_cantidad = 0 THEN
    RAISE EXCEPTION 'cantidad no puede ser 0' USING ERRCODE='22023';
  END IF;
  IF p_sku IS NULL OR p_channel_id IS NULL THEN
    RAISE EXCEPTION 'sku y channel_id son obligatorios' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sku_catalog WHERE sku = p_sku AND activo = true) THEN
    RAISE EXCEPTION 'SKU % no existe o esta inactivo', p_sku USING ERRCODE='23503';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.channels WHERE id = p_channel_id) THEN
    RAISE EXCEPTION 'channel_id % no existe', p_channel_id USING ERRCODE='23503';
  END IF;

  -- ── Lookup de jornada destino ──
  IF p_jornada_id IS NOT NULL THEN
    -- Override manual: validar
    SELECT * INTO v_jornada_row FROM public.jornadas
     WHERE id = p_jornada_id FOR SHARE;
    IF v_jornada_row.id IS NULL THEN
      RAISE EXCEPTION 'La jornada elegida no existe.'
        USING ERRCODE='23503', HINT='jornada_invalid';
    END IF;
    IF v_jornada_row.channel_id <> p_channel_id THEN
      RAISE EXCEPTION 'La jornada elegida es del canal %, no de %.',
        v_jornada_row.channel_id, p_channel_id
        USING ERRCODE='22023', HINT='jornada_wrong_channel';
    END IF;
    IF v_jornada_row.status = 'cerrada' THEN
      RAISE EXCEPTION 'No podes cargar a una jornada cerrada (% del %).',
        v_jornada_row.channel_id, to_char(v_jornada_row.fecha, 'DD/MM')
        USING ERRCODE='22023', HINT='jornada_cerrada';
    END IF;
    v_jornada_id := p_jornada_id;
  ELSE
    -- Auto-resolver: jornada activa del canal
    SELECT id INTO v_jornada_id
      FROM public.jornadas
      WHERE channel_id = p_channel_id AND status = 'abierta' AND is_active = true
      LIMIT 1;

    IF v_jornada_id IS NULL THEN
      -- Contar abiertas del canal
      SELECT count(*) INTO v_open_count
        FROM public.jornadas
        WHERE channel_id = p_channel_id AND status = 'abierta';

      IF v_open_count = 0 THEN
        -- Auto-apertura: crear jornada de hoy + marcarla activa
        INSERT INTO public.jornadas
          (channel_id, fecha, status, abierta_at, is_active, snapshot)
        VALUES
          (p_channel_id, current_date, 'abierta', now(), true, '[]'::jsonb)
        ON CONFLICT (channel_id, fecha) DO UPDATE
          SET status = EXCLUDED.status,
              abierta_at = COALESCE(public.jornadas.abierta_at, EXCLUDED.abierta_at),
              is_active = true
        RETURNING id INTO v_jornada_id;

        INSERT INTO public.jornada_audit (jornada_id, accion, motivo, by_user)
        VALUES (v_jornada_id, 'abierta',
                'Auto-apertura por carga sin jornada activa', auth.uid());
      ELSIF v_open_count = 1 THEN
        -- Hay 1 abierta sin marcar activa → marcarla activa
        UPDATE public.jornadas SET is_active = true
         WHERE channel_id = p_channel_id AND status = 'abierta'
        RETURNING id INTO v_jornada_id;

        INSERT INTO public.jornada_audit (jornada_id, accion, motivo, by_user)
        VALUES (v_jornada_id, 'activada',
                'Auto-activación (única abierta del canal)', auth.uid());
      ELSE
        RAISE EXCEPTION
          'Hay % jornadas abiertas en %, ninguna marcada como activa. Pedi al encargado que defina cual es la jornada activa.',
          v_open_count, p_channel_id
          USING ERRCODE='22023', HINT='no_active_jornada';
      END IF;
    END IF;
  END IF;

  -- Sector
  v_sector := public.role_to_sector(v_role);

  -- Insertar log con jornada_id
  INSERT INTO public.production_logs
    (sku, channel_id, cantidad, operario_id, sector, fecha, hora, notas, jornada_id)
  VALUES
    (p_sku, p_channel_id, p_cantidad, auth.uid(), v_sector,
     current_date, current_time,
     NULLIF(trim(coalesce(p_notas, '')), ''),
     v_jornada_id)
  RETURNING * INTO v_log;

  -- Notificación si faltante=0 (lógica existente)
  IF EXISTS (
    SELECT 1 FROM public.carrier_state
    WHERE channel_id = p_channel_id AND sku = p_sku AND faltante = 0 AND pedido > 0
  ) THEN
    INSERT INTO public.notifications (user_id, tipo, titulo, mensaje, link)
    SELECT p.id, 'produccion',
      'Producción completada',
      format('Se completó el faltante para %s en %s.', p_sku, p_channel_id),
      format('/canal/%s', p_channel_id)
    FROM public.profiles p
    WHERE p.role IN ('owner','encargado') AND p.active = true;
  END IF;

  RETURN v_log;
END;
$func$;

-- Asegurar grants (la firma cambió: 5 args en vez de 4)
REVOKE ALL ON FUNCTION public.rpc_register_production(text, text, integer, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_register_production(text, text, integer, text, uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual, NO ejecutar sin antes migrar/copiar datos):
--
-- DROP FUNCTION IF EXISTS public.rpc_register_production(text, text, integer, text, uuid);
-- -- (restaurar la versión 4-args desde 0008_rpcs.sql)
-- DROP FUNCTION IF EXISTS public.rpc_set_active_jornada(uuid);
-- DROP FUNCTION IF EXISTS public.rpc_open_jornada(text, date);
-- DROP TABLE IF EXISTS public.jornada_audit;
-- DROP TABLE IF EXISTS public.free_stock;
-- ALTER TABLE public.production_logs DROP COLUMN IF EXISTS jornada_id;
-- DROP INDEX IF EXISTS public.jornadas_one_active_per_channel;
-- ALTER TABLE public.jornadas DROP CONSTRAINT IF EXISTS jornadas_unique_canal_fecha;
-- ALTER TABLE public.jornadas DROP COLUMN IF EXISTS is_active;
-- ALTER TABLE public.jornadas DROP COLUMN IF EXISTS abierta_at;
-- ALTER TABLE public.jornadas DROP COLUMN IF EXISTS status;
-- DROP TYPE IF EXISTS jornada_status_enum;
-- ════════════════════════════════════════════════════════════════════
