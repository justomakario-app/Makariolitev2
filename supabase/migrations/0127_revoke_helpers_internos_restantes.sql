-- 0127 · FIX auditoría — cerrar EXECUTE a anon en los 2 helpers internos restantes.
-- prod_stock_validar_fila: helper de validación usado por stock_preview/confirmar (SECURITY DEFINER, lo llaman
--   como owner); expone stock_actual de un SKU a quien lo invoque directo => fuera de anon/authenticated/public.
-- prod_tg_embalaje_consumo: función de trigger (no invocable por PostgREST); se revoca por prolijidad.
-- Tras esto, las únicas funciones prod_ ejecutables por anon son las 9 RPC de API, todas con guard de rol
-- (auth.uid()/profiles) que rechaza a anon en runtime (cero fuga / cero mutación).
-- (Aplicada en remoto vía MCP el 2026-07-21 durante la corrección integral pre-push. SIN commitear aún.)
revoke execute on function public.prod_stock_validar_fila(text, text, int, text) from anon, authenticated, public;
revoke execute on function public.prod_tg_embalaje_consumo() from anon, authenticated, public;
