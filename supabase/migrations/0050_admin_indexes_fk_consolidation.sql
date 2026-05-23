-- ════════════════════════════════════════════════════════════════════
-- ADMIN MODULE — Consolidación de índices de cobertura FK
-- ════════════════════════════════════════════════════════════════════
-- Cierra los 6 warnings `unindexed_foreign_keys` acumulados durante
-- las migrations 0044-0048. Todos los FK created_by → profiles(id) de
-- las tablas admin necesitan índice de cobertura para evitar seq scans
-- en queries que filtren por "movimientos creados por usuario X" o
-- en cascada ante DELETE de profiles.
--
-- Patrón: btree simple sobre la columna FK. No UNIQUE, no partial,
-- no compuesto (no hay queries actuales que justifiquen variantes).
-- ADITIVA: solo CREATE INDEX IF NOT EXISTS, sin DROP, sin ALTER.
-- ════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS suppliers_created_by_idx
  ON public.suppliers (created_by);

CREATE INDEX IF NOT EXISTS expenses_created_by_idx
  ON public.expenses (created_by);

CREATE INDEX IF NOT EXISTS checks_issued_created_by_idx
  ON public.checks_issued (created_by);

CREATE INDEX IF NOT EXISTS customers_b2b_created_by_idx
  ON public.customers_b2b (created_by);

CREATE INDEX IF NOT EXISTS customers_credit_movements_created_by_idx
  ON public.customers_credit_movements (created_by);

CREATE INDEX IF NOT EXISTS suppliers_credit_movements_created_by_idx
  ON public.suppliers_credit_movements (created_by);

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual):
--   DROP INDEX IF EXISTS public.suppliers_created_by_idx;
--   DROP INDEX IF EXISTS public.expenses_created_by_idx;
--   DROP INDEX IF EXISTS public.checks_issued_created_by_idx;
--   DROP INDEX IF EXISTS public.customers_b2b_created_by_idx;
--   DROP INDEX IF EXISTS public.customers_credit_movements_created_by_idx;
--   DROP INDEX IF EXISTS public.suppliers_credit_movements_created_by_idx;
-- ════════════════════════════════════════════════════════════════════
