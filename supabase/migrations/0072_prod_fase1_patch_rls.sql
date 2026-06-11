-- ════════════════════════════════════════════════════════════════════
-- PRODUCCIÓN EN LÍNEA — Fase 1, patch RLS (sobre tablas de 0071)
-- ════════════════════════════════════════════════════════════════════
-- Solo agrega policies nuevas (permisivas, se combinan con las de 0071).
-- No modifica datos ni tablas. Patrón profiles.role (current_user_role()).
--
--  1. prod_solicitud: owner/admin pueden UPDATE (aprobar/gestionar)
--     cualquier solicitud. (Antes solo tenían SELECT.)
--  2. prod_embalaje: el coordinador 'embalaje' puede UPDATE y DELETE
--     sus PROPIOS registros (cargado_por = auth.uid()), sin tope de 24h.
-- ════════════════════════════════════════════════════════════════════

-- ── CORRECCIÓN 1 — prod_solicitud: UPDATE owner/admin ────────────────
DROP POLICY IF EXISTS "prod_solicitud_upd_admin" ON public.prod_solicitud;
CREATE POLICY "prod_solicitud_upd_admin" ON public.prod_solicitud
  FOR UPDATE TO authenticated
  USING (public.current_user_role() IN ('owner','admin'))
  WITH CHECK (public.current_user_role() IN ('owner','admin'));

-- ── CORRECCIÓN 2 — prod_embalaje: coordinador edita/borra lo propio ──
-- UPDATE de los registros propios (sin límite editable_hasta).
DROP POLICY IF EXISTS "prod_embalaje_upd_coord" ON public.prod_embalaje;
CREATE POLICY "prod_embalaje_upd_coord" ON public.prod_embalaje
  FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'embalaje' AND cargado_por = auth.uid())
  WITH CHECK (public.current_user_role() = 'embalaje' AND cargado_por = auth.uid());

-- DELETE de los registros propios.
DROP POLICY IF EXISTS "prod_embalaje_del_coord" ON public.prod_embalaje;
CREATE POLICY "prod_embalaje_del_coord" ON public.prod_embalaje
  FOR DELETE TO authenticated
  USING (public.current_user_role() = 'embalaje' AND cargado_por = auth.uid());

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual):
--   DROP POLICY IF EXISTS "prod_solicitud_upd_admin" ON public.prod_solicitud;
--   DROP POLICY IF EXISTS "prod_embalaje_upd_coord"  ON public.prod_embalaje;
--   DROP POLICY IF EXISTS "prod_embalaje_del_coord"  ON public.prod_embalaje;
-- ════════════════════════════════════════════════════════════════════
