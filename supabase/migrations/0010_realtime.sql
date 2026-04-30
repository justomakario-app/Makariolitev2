-- ═══════════════════════════════════════════════════════════════════════════
-- 0010_realtime.sql — Habilitar Realtime en tablas marcadas en INFORME §11
-- ───────────────────────────────────────────────────────────────────────────
-- Tablas:
--   - carrier_state    → tabla más crítica (la UI del Carrier/Producción depende)
--   - orders           → ver nuevos pedidos al instante tras importar
--   - production_logs  → feed en vivo "Producción registrada hoy"
--   - notifications    → badge del sidebar + pantalla de notificaciones
--
-- Mecanismo Supabase Realtime: agregar las tablas a la publication
-- "supabase_realtime" que ya existe por default.
--
-- Nota de costos (decisión T): canal por tabla con filtros client-side.
-- Frontend en Fase 7 va a abrir 4 channels separados con filter por
-- channel_id donde aplique para minimizar broadcast.
-- ═══════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────
-- Crear publication si no existe (Supabase la crea por default, pero
-- somos defensivos)
-- ──────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────
-- Agregar tablas a la publication (idempotente — solo agrega si no estaba)
-- ──────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'carrier_state'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.carrier_state;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'production_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.production_logs;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════════════════
-- FIN 0010_realtime.sql
-- ══════════════════════════════════════════════════════════════════════════
