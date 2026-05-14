-- ════════════════════════════════════════════════════════════════════
-- HOUSEKEEPING — Fix RLS policy de INSERT en jornadas
-- ════════════════════════════════════════════════════════════════════
-- La policy "jornadas: admin and encargado can insert" tenía:
--
--   WITH CHECK ((is_owner_or_admin() OR current_user_role()='encargado')
--               AND closed_by = auth.uid())
--
-- El check `closed_by = auth.uid()` es semánticamente incorrecto: una
-- jornada recién ABIERTA tiene closed_by=NULL (no está cerrada por
-- nadie), así que la policy bloqueaba la apertura por INSERT directo.
--
-- Además es efectivamente inalcanzable en operación normal: los 4
-- callers de INSERT en jornadas (fn_resolve_active_jornada,
-- rpc_open_jornada, rpc_close_jornada, rpc_correct_log) son TODOS
-- SECURITY DEFINER → bypasean RLS. El frontend solo hace
-- supa.from('jornadas').select(...), nunca INSERT directo.
--
-- Simulaciones BEGIN/ROLLBACK confirmaron:
--   - INSERT directo owner con closed_by=NULL → BLOQUEABA (incorrecto).
--   - INSERT directo sin auth → BLOQUEABA (correcto, se mantiene).
--
-- Cambio: eliminar el check `closed_by = auth.uid()`. La protección por
-- rol (is_owner_or_admin OR encargado) queda intacta — un INSERT
-- directo sin permisos sigue bloqueado.
--
-- NO se tocan otras policies (jornadas SELECT, orders, production_logs).
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "jornadas: admin and encargado can insert" ON public.jornadas;

CREATE POLICY "jornadas: admin and encargado can insert"
  ON public.jornadas
  FOR INSERT
  TO authenticated
  WITH CHECK (is_owner_or_admin() OR current_user_role() = 'encargado'::role_enum);

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual, si se necesita restaurar la policy original):
--   DROP POLICY IF EXISTS "jornadas: admin and encargado can insert" ON public.jornadas;
--   CREATE POLICY "jornadas: admin and encargado can insert"
--     ON public.jornadas FOR INSERT TO authenticated
--     WITH CHECK ((is_owner_or_admin() OR current_user_role() = 'encargado'::role_enum)
--                 AND closed_by = auth.uid());
-- ════════════════════════════════════════════════════════════════════
