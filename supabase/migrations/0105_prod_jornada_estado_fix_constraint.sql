-- 0105 · Reemplazar el CHECK viejo (abierta|cerrada) por el permisivo de Bloque 4.
-- (Aplicada en remoto vía MCP el 2026-07-20; reconstruida como archivo local — no re-ejecutar.)
alter table public.prod_jornada drop constraint if exists prod_jornada_estado_check;
alter table public.prod_jornada drop constraint if exists prod_jornada_estado_chk;
alter table public.prod_jornada add constraint prod_jornada_estado_chk
  check (estado in ('preparada','abierta','en_proceso','cerrada','cancelada'));
