-- ════════════════════════════════════════════════════════════════════
-- PRODUCCIÓN — Fase 4.2: Realtime (🔴 sin polling)
-- ════════════════════════════════════════════════════════════════════
-- Agrega las tablas operativas prod_* a la publicación `supabase_realtime`
-- para que el frontend reciba INSERT/UPDATE/DELETE en vivo. RLS sigue
-- filtrando server-side: cada rol solo recibe los cambios que puede leer
-- (las policies de la Fase 1 ya conceden SELECT por rol).
--
-- 100% aditivo y reversible: no toca schema ni datos de ninguna tabla,
-- solo la membresía de la publicación. Idempotente (chequea antes de ADD).
-- No requiere REPLICA IDENTITY FULL: con la identidad por PK alcanza para
-- recibir el evento (el frontend re-fetchea, no usa los valores viejos).
-- ════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t text;
  tablas text[] := ARRAY[
    'prod_jornada',
    'prod_corte', 'prod_melamina', 'prod_pino', 'prod_embalaje',
    'prod_stock_pieza', 'prod_stock_melamina', 'prod_stock_patas', 'prod_stock_terminado',
    'prod_alerta', 'prod_mantenimiento'
  ];
BEGIN
  -- Si la publicación no existe (proyecto sin Realtime), no hacemos nada.
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'publicación supabase_realtime inexistente — se omite';
    RETURN;
  END IF;

  FOREACH t IN ARRAY tablas LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      RAISE NOTICE 'realtime + %', t;
    END IF;
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual): por cada tabla,
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.<tabla>;
-- ════════════════════════════════════════════════════════════════════
