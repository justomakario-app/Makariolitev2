-- 0121 · FIX auditoría — eliminar la función vieja 0104 que vinculaba TODAS las ventas pendientes
-- (incluidas las 506 legacy) sin preview/scope/confirmación, saltándose el puente 0117.
-- Verificado: 0 consumidores en frontend (solo la definía 0104). Firma exacta: (jsonb).
-- (Aplicada en remoto vía MCP el 2026-07-21 durante la corrección integral pre-push. SIN commitear aún.)
drop function if exists public.prod_rpc_vincular_jornada(jsonb);
