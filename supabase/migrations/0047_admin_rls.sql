-- ════════════════════════════════════════════════════════════════════
-- ADMIN MODULE — RLS policies para las 9 tablas admin
-- ════════════════════════════════════════════════════════════════════
-- Patron: 1 policy por (tabla, accion) → evita lint multiple_permissive
-- (Bloque 4). SELECT/UPDATE/DELETE gated por is_owner_or_admin().
-- INSERT permitido via RLS al admin desde Studio; en la app los INSERTs
-- pasan por RPCs SECURITY DEFINER (que bypassean RLS), pero la policy
-- INSERT existe por consistencia y para ABM directo de Noe.
--
-- agent_conversations especial: cada usuario ve su propio historial
-- (user_id = auth.uid()) ademas del acceso admin.
--
-- auth.uid() envuelto en (select ...) — best practice Bloque 4.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.suppliers                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checks_issued                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers_b2b                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers_credit             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers_credit_movements   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers_credit             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers_credit_movements   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_conversations          ENABLE ROW LEVEL SECURITY;

-- ── Macro: policies estandar admin ──────────────────────────────────
-- Para tablas admin "puras" (sin user_id), aplicamos el mismo patron 4x:
--   SELECT  USING is_owner_or_admin()
--   INSERT  WITH CHECK is_owner_or_admin()
--   UPDATE  USING is_owner_or_admin() WITH CHECK is_owner_or_admin()
--   DELETE  USING is_owner_or_admin()

-- suppliers
DROP POLICY IF EXISTS "suppliers: admin select" ON public.suppliers;
CREATE POLICY "suppliers: admin select" ON public.suppliers
  FOR SELECT TO authenticated USING (is_owner_or_admin());
DROP POLICY IF EXISTS "suppliers: admin insert" ON public.suppliers;
CREATE POLICY "suppliers: admin insert" ON public.suppliers
  FOR INSERT TO authenticated WITH CHECK (is_owner_or_admin());
DROP POLICY IF EXISTS "suppliers: admin update" ON public.suppliers;
CREATE POLICY "suppliers: admin update" ON public.suppliers
  FOR UPDATE TO authenticated
  USING (is_owner_or_admin()) WITH CHECK (is_owner_or_admin());
DROP POLICY IF EXISTS "suppliers: admin delete" ON public.suppliers;
CREATE POLICY "suppliers: admin delete" ON public.suppliers
  FOR DELETE TO authenticated USING (is_owner_or_admin());

-- expenses
DROP POLICY IF EXISTS "expenses: admin select" ON public.expenses;
CREATE POLICY "expenses: admin select" ON public.expenses
  FOR SELECT TO authenticated USING (is_owner_or_admin());
DROP POLICY IF EXISTS "expenses: admin insert" ON public.expenses;
CREATE POLICY "expenses: admin insert" ON public.expenses
  FOR INSERT TO authenticated WITH CHECK (is_owner_or_admin());
DROP POLICY IF EXISTS "expenses: admin update" ON public.expenses;
CREATE POLICY "expenses: admin update" ON public.expenses
  FOR UPDATE TO authenticated
  USING (is_owner_or_admin()) WITH CHECK (is_owner_or_admin());
DROP POLICY IF EXISTS "expenses: admin delete" ON public.expenses;
CREATE POLICY "expenses: admin delete" ON public.expenses
  FOR DELETE TO authenticated USING (is_owner_or_admin());

-- checks_issued
DROP POLICY IF EXISTS "checks_issued: admin select" ON public.checks_issued;
CREATE POLICY "checks_issued: admin select" ON public.checks_issued
  FOR SELECT TO authenticated USING (is_owner_or_admin());
DROP POLICY IF EXISTS "checks_issued: admin insert" ON public.checks_issued;
CREATE POLICY "checks_issued: admin insert" ON public.checks_issued
  FOR INSERT TO authenticated WITH CHECK (is_owner_or_admin());
DROP POLICY IF EXISTS "checks_issued: admin update" ON public.checks_issued;
CREATE POLICY "checks_issued: admin update" ON public.checks_issued
  FOR UPDATE TO authenticated
  USING (is_owner_or_admin()) WITH CHECK (is_owner_or_admin());
DROP POLICY IF EXISTS "checks_issued: admin delete" ON public.checks_issued;
CREATE POLICY "checks_issued: admin delete" ON public.checks_issued
  FOR DELETE TO authenticated USING (is_owner_or_admin());

-- customers_b2b
DROP POLICY IF EXISTS "customers_b2b: admin select" ON public.customers_b2b;
CREATE POLICY "customers_b2b: admin select" ON public.customers_b2b
  FOR SELECT TO authenticated USING (is_owner_or_admin());
DROP POLICY IF EXISTS "customers_b2b: admin insert" ON public.customers_b2b;
CREATE POLICY "customers_b2b: admin insert" ON public.customers_b2b
  FOR INSERT TO authenticated WITH CHECK (is_owner_or_admin());
DROP POLICY IF EXISTS "customers_b2b: admin update" ON public.customers_b2b;
CREATE POLICY "customers_b2b: admin update" ON public.customers_b2b
  FOR UPDATE TO authenticated
  USING (is_owner_or_admin()) WITH CHECK (is_owner_or_admin());
DROP POLICY IF EXISTS "customers_b2b: admin delete" ON public.customers_b2b;
CREATE POLICY "customers_b2b: admin delete" ON public.customers_b2b
  FOR DELETE TO authenticated USING (is_owner_or_admin());

-- customers_credit
DROP POLICY IF EXISTS "customers_credit: admin select" ON public.customers_credit;
CREATE POLICY "customers_credit: admin select" ON public.customers_credit
  FOR SELECT TO authenticated USING (is_owner_or_admin());
DROP POLICY IF EXISTS "customers_credit: admin insert" ON public.customers_credit;
CREATE POLICY "customers_credit: admin insert" ON public.customers_credit
  FOR INSERT TO authenticated WITH CHECK (is_owner_or_admin());
DROP POLICY IF EXISTS "customers_credit: admin update" ON public.customers_credit;
CREATE POLICY "customers_credit: admin update" ON public.customers_credit
  FOR UPDATE TO authenticated
  USING (is_owner_or_admin()) WITH CHECK (is_owner_or_admin());
DROP POLICY IF EXISTS "customers_credit: admin delete" ON public.customers_credit;
CREATE POLICY "customers_credit: admin delete" ON public.customers_credit
  FOR DELETE TO authenticated USING (is_owner_or_admin());

-- customers_credit_movements
DROP POLICY IF EXISTS "customers_credit_movements: admin select" ON public.customers_credit_movements;
CREATE POLICY "customers_credit_movements: admin select" ON public.customers_credit_movements
  FOR SELECT TO authenticated USING (is_owner_or_admin());
DROP POLICY IF EXISTS "customers_credit_movements: admin insert" ON public.customers_credit_movements;
CREATE POLICY "customers_credit_movements: admin insert" ON public.customers_credit_movements
  FOR INSERT TO authenticated WITH CHECK (is_owner_or_admin());
DROP POLICY IF EXISTS "customers_credit_movements: admin update" ON public.customers_credit_movements;
CREATE POLICY "customers_credit_movements: admin update" ON public.customers_credit_movements
  FOR UPDATE TO authenticated
  USING (is_owner_or_admin()) WITH CHECK (is_owner_or_admin());
DROP POLICY IF EXISTS "customers_credit_movements: admin delete" ON public.customers_credit_movements;
CREATE POLICY "customers_credit_movements: admin delete" ON public.customers_credit_movements
  FOR DELETE TO authenticated USING (is_owner_or_admin());

-- suppliers_credit
DROP POLICY IF EXISTS "suppliers_credit: admin select" ON public.suppliers_credit;
CREATE POLICY "suppliers_credit: admin select" ON public.suppliers_credit
  FOR SELECT TO authenticated USING (is_owner_or_admin());
DROP POLICY IF EXISTS "suppliers_credit: admin insert" ON public.suppliers_credit;
CREATE POLICY "suppliers_credit: admin insert" ON public.suppliers_credit
  FOR INSERT TO authenticated WITH CHECK (is_owner_or_admin());
DROP POLICY IF EXISTS "suppliers_credit: admin update" ON public.suppliers_credit;
CREATE POLICY "suppliers_credit: admin update" ON public.suppliers_credit
  FOR UPDATE TO authenticated
  USING (is_owner_or_admin()) WITH CHECK (is_owner_or_admin());
DROP POLICY IF EXISTS "suppliers_credit: admin delete" ON public.suppliers_credit;
CREATE POLICY "suppliers_credit: admin delete" ON public.suppliers_credit
  FOR DELETE TO authenticated USING (is_owner_or_admin());

-- suppliers_credit_movements
DROP POLICY IF EXISTS "suppliers_credit_movements: admin select" ON public.suppliers_credit_movements;
CREATE POLICY "suppliers_credit_movements: admin select" ON public.suppliers_credit_movements
  FOR SELECT TO authenticated USING (is_owner_or_admin());
DROP POLICY IF EXISTS "suppliers_credit_movements: admin insert" ON public.suppliers_credit_movements;
CREATE POLICY "suppliers_credit_movements: admin insert" ON public.suppliers_credit_movements
  FOR INSERT TO authenticated WITH CHECK (is_owner_or_admin());
DROP POLICY IF EXISTS "suppliers_credit_movements: admin update" ON public.suppliers_credit_movements;
CREATE POLICY "suppliers_credit_movements: admin update" ON public.suppliers_credit_movements
  FOR UPDATE TO authenticated
  USING (is_owner_or_admin()) WITH CHECK (is_owner_or_admin());
DROP POLICY IF EXISTS "suppliers_credit_movements: admin delete" ON public.suppliers_credit_movements;
CREATE POLICY "suppliers_credit_movements: admin delete" ON public.suppliers_credit_movements
  FOR DELETE TO authenticated USING (is_owner_or_admin());

-- agent_conversations — usuario propio O admin
DROP POLICY IF EXISTS "agent_conversations: select own or admin" ON public.agent_conversations;
CREATE POLICY "agent_conversations: select own or admin" ON public.agent_conversations
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()) OR is_owner_or_admin());
DROP POLICY IF EXISTS "agent_conversations: insert own or admin" ON public.agent_conversations;
CREATE POLICY "agent_conversations: insert own or admin" ON public.agent_conversations
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()) OR is_owner_or_admin());
DROP POLICY IF EXISTS "agent_conversations: update own or admin" ON public.agent_conversations;
CREATE POLICY "agent_conversations: update own or admin" ON public.agent_conversations
  FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid()) OR is_owner_or_admin())
  WITH CHECK (user_id = (select auth.uid()) OR is_owner_or_admin());
DROP POLICY IF EXISTS "agent_conversations: delete own or admin" ON public.agent_conversations;
CREATE POLICY "agent_conversations: delete own or admin" ON public.agent_conversations
  FOR DELETE TO authenticated
  USING (user_id = (select auth.uid()) OR is_owner_or_admin());

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual): DROP POLICY ... ON public.<tabla>; por cada uno.
-- Para des-habilitar RLS (no recomendado):
--   ALTER TABLE public.<tabla> DISABLE ROW LEVEL SECURITY;
-- ════════════════════════════════════════════════════════════════════
