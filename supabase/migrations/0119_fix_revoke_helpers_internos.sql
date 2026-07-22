-- 0119 · FIX de auditoría (corrección mínima acotada de Línea Productiva).
-- (Aplicada en remoto vía MCP el 2026-07-21 durante la auditoría pre-push. SIN commitear aún.)
-- Los helpers SECURITY DEFINER de 0117/0118 conservaban EXECUTE a PUBLIC por default de Postgres,
-- quedando invocables por anon/authenticated vía PostgREST SIN validación de rol:
--   - prod_fn_autoasignar_jornada: MUTA stock+ledger (CRÍTICO: anon podía disparar autoasignación).
--   - prod_fn_candidatos: lee public.orders saltándose RLS (fuga de datos de pedidos).
--   - prod_fn_asignado: expone cantidades asignadas por pedido.
-- Son helpers internos: las RPC (SECURITY DEFINER) los llaman como definer → siguen funcionando.
-- El frontend nunca los invoca directo (solo prod_rpc_*). Cerramos el acceso directo por PostgREST.
revoke execute on function public.prod_fn_autoasignar_jornada(uuid, text) from public, anon, authenticated;
revoke execute on function public.prod_fn_candidatos(jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.prod_fn_asignado(uuid) from public, anon, authenticated;
