-- 0129 · M09 — eliminar prod_rpc_set_jornada_estado (0104): permitía cerrar la jornada SIN la guarda
-- de prod_rpc_cerrar_jornada (mesas pendientes/faltantes) y crear estados ('en_proceso','preparada')
-- que el puente 0117+ no contempla (ninguna vista los considera activos).
-- LOCAL: NO aplicada en remoto (se aplica primero en el entorno aislado).
-- Preflight (2026-07-21): 0 consumidores en frontend (working tree Y toda la historia git -S);
-- el único flujo de apertura/cierre es prod_rpc_abrir_jornada / prod_rpc_cerrar_jornada.
drop function if exists public.prod_rpc_set_jornada_estado(jsonb);
