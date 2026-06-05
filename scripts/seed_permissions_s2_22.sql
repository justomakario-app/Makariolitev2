-- ════════════════════════════════════════════════════════════════════
-- S2.22 — Seed de permisos por módulo (alternativa / verificación)
-- ════════════════════════════════════════════════════════════════════
-- create_users_s2_22.js YA siembra los permisos. Este .sql es un camino
-- ALTERNATIVO/idempotente para correr a mano (SQL editor con rol
-- service_role / postgres) DESPUÉS de que las 5 cuentas existan en
-- auth.users. Resuelve los user_id por email (no hay que hardcodearlos).
--
-- Reemplazo total: borra los permisos previos de esos 5 usuarios y
-- reinserta el set canónico. owner (Noelia) queda SIN filas a propósito.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- Set canónico (email → module). Noelia/owner no aparece: ve todo por rol.
WITH desired(email, module) AS (
  VALUES
    ('esteban.fernandez@justomakario.app', 'administracion'),
    ('esteban.fernandez@justomakario.app', 'ventas'),
    ('esteban.fernandez@justomakario.app', 'produccion'),

    ('romina.puscama@justomakario.app',    'administracion'),
    ('romina.puscama@justomakario.app',    'ventas'),
    ('romina.puscama@justomakario.app',    'produccion'),
    ('romina.puscama@justomakario.app',    'finanzas_egresos'),

    ('mikeas.romero@justomakario.app',     'produccion'),

    ('dobleclick@justomakario.app',        'marketing')
),
emails AS (
  SELECT DISTINCT email FROM desired
)
-- 1) Limpiar permisos previos SOLO de estos usuarios.
DELETE FROM public.user_module_permissions ump
USING auth.users u, emails e
WHERE ump.user_id = u.id
  AND u.email = e.email;

-- 2) Insertar el set canónico (resolviendo user_id por email).
INSERT INTO public.user_module_permissions (user_id, module, can_access)
SELECT u.id, d.module, true
FROM (
  VALUES
    ('esteban.fernandez@justomakario.app', 'administracion'),
    ('esteban.fernandez@justomakario.app', 'ventas'),
    ('esteban.fernandez@justomakario.app', 'produccion'),

    ('romina.puscama@justomakario.app',    'administracion'),
    ('romina.puscama@justomakario.app',    'ventas'),
    ('romina.puscama@justomakario.app',    'produccion'),
    ('romina.puscama@justomakario.app',    'finanzas_egresos'),

    ('mikeas.romero@justomakario.app',     'produccion'),

    ('dobleclick@justomakario.app',        'marketing')
) AS d(email, module)
JOIN auth.users u ON u.email = d.email
ON CONFLICT (user_id, module) DO UPDATE SET can_access = EXCLUDED.can_access;

COMMIT;

-- Verificación rápida:
--   SELECT u.email, ump.module, ump.can_access
--   FROM public.user_module_permissions ump
--   JOIN auth.users u ON u.id = ump.user_id
--   ORDER BY u.email, ump.module;
