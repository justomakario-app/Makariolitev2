-- 0125 · FIX auditoría — cierre de seguridad de las vistas prod_v_*.
-- Antes: las 20 vistas corrían como owner (sin security_invoker) y tenían SELECT concedido a anon
--   => un cliente NO autenticado podía leer pedidos/demanda/stock de producción (fuga de datos).
-- Ahora: (a) security_invoker=on => la vista respeta la RLS del invocador sobre las tablas base;
--        (b) se revoca todo acceso a anon/public (anon rechazado);
--        (c) authenticated queda SOLO con SELECT (las vistas son de lectura, no de escritura).
-- Verificado: ninguna vista prod_v_* invoca helpers SECURITY DEFINER revocados, por lo que
--   security_invoker no rompe llamadas a funciones internas; owner/encargado/cnc/melamina/pino/embalaje
--   leen las 20 vistas sin error de permiso; anon queda sin SELECT en ninguna.
-- (Aplicada en remoto vía MCP el 2026-07-21 durante la corrección integral pre-push. SIN commitear aún.)
do $$
declare v text;
begin
  for v in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relkind='v' and c.relname like 'prod_v_%' loop
    execute format('alter view public.%I set (security_invoker = on)', v);
    execute format('revoke all on public.%I from anon, public', v);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end $$;

-- Helper clasificador: lo usan vistas (bajo security_invoker) => authenticated conserva EXECUTE; anon/public fuera.
revoke execute on function public.prod_pieza_pool(text) from anon, public;

-- Refuerzo idempotente: helpers internos SECURITY DEFINER sin acceso directo por PostgREST.
revoke execute on function public.prod_fn_asignado(uuid) from anon, authenticated, public;
revoke execute on function public.prod_fn_candidatos(jsonb, uuid) from anon, authenticated, public;
revoke execute on function public.prod_fn_autoasignar_jornada(uuid, text) from anon, authenticated, public;
