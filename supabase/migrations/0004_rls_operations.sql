-- ═══════════════════════════════════════════════════════════════════════════
-- 0004_rls_operations.sql — RLS para tablas de operación
-- ───────────────────────────────────────────────────────────────────────────
-- Tablas:
--   orders, import_batches, production_logs, carrier_state, jornadas, qr_scans
--
-- Patrón:
--   - production_logs / qr_scans: INSERT solo con operario_id = auth.uid()
--     UPDATE/DELETE prohibido (ledger inmutable)
--   - carrier_state: SELECT autenticados; INSERT/UPDATE/DELETE bloqueado
--     (solo via triggers SECURITY DEFINER en Fase 5)
--   - jornadas: snapshot inmutable, solo INSERT
--   - orders / import_batches: lectura general, escritura admin
-- ═══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════
-- 1. orders
-- ══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "orders: select for authenticated" ON public.orders;
CREATE POLICY "orders: select for authenticated"
  ON public.orders FOR SELECT
  TO authenticated
  USING (public.is_active_user());

DROP POLICY IF EXISTS "orders: admin can insert" ON public.orders;
CREATE POLICY "orders: admin can insert"
  ON public.orders FOR INSERT
  TO authenticated
  WITH CHECK (public.is_owner_or_admin());

-- UPDATE: owner, admin o encargado pueden cambiar status (ej. al cerrar jornada)
DROP POLICY IF EXISTS "orders: admin and encargado can update" ON public.orders;
CREATE POLICY "orders: admin and encargado can update"
  ON public.orders FOR UPDATE
  TO authenticated
  USING (
    public.is_owner_or_admin()
    OR public.current_user_role() = 'encargado'
  )
  WITH CHECK (
    public.is_owner_or_admin()
    OR public.current_user_role() = 'encargado'
  );

-- DELETE: solo owner (caso muy excepcional — el flujo normal es archivar via status)
DROP POLICY IF EXISTS "orders: owner can delete" ON public.orders;
CREATE POLICY "orders: owner can delete"
  ON public.orders FOR DELETE
  TO authenticated
  USING (public.is_owner());

-- ══════════════════════════════════════════════════════════════════════════
-- 2. import_batches
-- ══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "import_batches: select for authenticated" ON public.import_batches;
CREATE POLICY "import_batches: select for authenticated"
  ON public.import_batches FOR SELECT
  TO authenticated
  USING (public.is_active_user());

-- INSERT: owner, admin, encargado (los tres pueden importar Excel)
DROP POLICY IF EXISTS "import_batches: admin and encargado can insert" ON public.import_batches;
CREATE POLICY "import_batches: admin and encargado can insert"
  ON public.import_batches FOR INSERT
  TO authenticated
  WITH CHECK (
    (public.is_owner_or_admin() OR public.current_user_role() = 'encargado')
    AND imported_by = auth.uid()
  );

-- UPDATE/DELETE: solo owner (auditoría — no se debería modificar un lote ya importado)
DROP POLICY IF EXISTS "import_batches: owner can update" ON public.import_batches;
CREATE POLICY "import_batches: owner can update"
  ON public.import_batches FOR UPDATE
  TO authenticated
  USING (public.is_owner())
  WITH CHECK (public.is_owner());

DROP POLICY IF EXISTS "import_batches: owner can delete" ON public.import_batches;
CREATE POLICY "import_batches: owner can delete"
  ON public.import_batches FOR DELETE
  TO authenticated
  USING (public.is_owner());

-- ══════════════════════════════════════════════════════════════════════════
-- 3. production_logs (LEDGER INMUTABLE)
-- ══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "production_logs: select for authenticated" ON public.production_logs;
CREATE POLICY "production_logs: select for authenticated"
  ON public.production_logs FOR SELECT
  TO authenticated
  USING (public.is_active_user());

-- INSERT: cualquier autenticado activo, SOLO si operario_id = auth.uid()
-- (el RPC rpc_register_production de Fase 5 lo enforca server-side igual)
DROP POLICY IF EXISTS "production_logs: insert own logs only" ON public.production_logs;
CREATE POLICY "production_logs: insert own logs only"
  ON public.production_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_active_user()
    AND operario_id = auth.uid()
  );

-- UPDATE/DELETE: PROHIBIDO. Ledger inmutable. Para corregir, insertar log con
-- cantidad negativa.
-- (No CREATE POLICY for UPDATE/DELETE → bloqueado por defecto cuando RLS activo)

-- ══════════════════════════════════════════════════════════════════════════
-- 4. carrier_state (DENORMALIZACIÓN — escritura solo via triggers)
-- ══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "carrier_state: select for authenticated" ON public.carrier_state;
CREATE POLICY "carrier_state: select for authenticated"
  ON public.carrier_state FOR SELECT
  TO authenticated
  USING (public.is_active_user());

-- INSERT/UPDATE/DELETE: NO POLICIES → bloqueado para todos los authenticated.
-- Los triggers en Fase 5 son SECURITY DEFINER → corren como postgres → bypass RLS.

-- ══════════════════════════════════════════════════════════════════════════
-- 5. jornadas (SNAPSHOTS INMUTABLES)
-- ══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "jornadas: select for authenticated" ON public.jornadas;
CREATE POLICY "jornadas: select for authenticated"
  ON public.jornadas FOR SELECT
  TO authenticated
  USING (public.is_active_user());

-- INSERT: owner, admin, encargado (los que pueden cerrar jornada)
DROP POLICY IF EXISTS "jornadas: admin and encargado can insert" ON public.jornadas;
CREATE POLICY "jornadas: admin and encargado can insert"
  ON public.jornadas FOR INSERT
  TO authenticated
  WITH CHECK (
    (public.is_owner_or_admin() OR public.current_user_role() = 'encargado')
    AND closed_by = auth.uid()
  );

-- UPDATE/DELETE: PROHIBIDO. Snapshots inmutables.

-- ══════════════════════════════════════════════════════════════════════════
-- 6. qr_scans (AUDIT TRAIL)
-- ══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "qr_scans: select for authenticated" ON public.qr_scans;
CREATE POLICY "qr_scans: select for authenticated"
  ON public.qr_scans FOR SELECT
  TO authenticated
  USING (public.is_active_user());

-- INSERT: cualquier autenticado activo, SOLO si operario_id = auth.uid()
DROP POLICY IF EXISTS "qr_scans: insert own scans only" ON public.qr_scans;
CREATE POLICY "qr_scans: insert own scans only"
  ON public.qr_scans FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_active_user()
    AND operario_id = auth.uid()
  );

-- UPDATE/DELETE: PROHIBIDO. Audit trail inmutable.

-- ══════════════════════════════════════════════════════════════════════════
-- FIN 0004_rls_operations.sql
-- ══════════════════════════════════════════════════════════════════════════
