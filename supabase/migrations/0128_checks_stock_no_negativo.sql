-- 0128 · M08 — defensa en profundidad: CHECKs contra stock/cantidades inválidas en las tablas LP.
-- LOCAL: NO aplicada en remoto. Se aplica primero en el entorno aislado; el remoto la recibe recién
-- en el deploy controlado autorizado.
-- Preflight remoto (read-only, 2026-07-21): 0 filas negativas/cero-anómalas en TODAS las tablas
-- alcanzadas (stocks, corte, melamina, pino, embalaje) → los constraints no chocan con el histórico.
-- Igual se usan NOT VALID: validan solo escrituras NUEVAS (cero lock/scan sobre datos compartidos);
-- VALIDATE CONSTRAINT queda documentado como paso posterior opcional.

do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('prod_stock_pieza',     'ck_prod_stock_pieza_no_neg',     'disponible >= 0'),
      ('prod_stock_melamina',  'ck_prod_stock_melamina_no_neg',  'disponible >= 0'),
      ('prod_stock_patas',     'ck_prod_stock_patas_no_neg',     'disponible >= 0 and masilladas >= 0'),
      ('prod_stock_terminado', 'ck_prod_stock_terminado_no_neg', 'disponible >= 0'),
      ('prod_insumo',          'ck_prod_insumo_no_neg',          'stock_actual >= 0'),
      ('prod_corte',           'ck_prod_corte_cantidades',       'hojas > 0 and desperdicio >= 0'),
      ('prod_melamina',        'ck_prod_melamina_cantidades',    'terminadas >= 0 and fallas >= 0'),
      ('prod_pino',            'ck_prod_pino_cantidades',        'terminadas >= 0 and masilladas >= 0'),
      ('prod_embalaje',        'ck_prod_embalaje_unidades',      'unidades > 0')
    ) as t(tabla, con, expr)
  loop
    if not exists (select 1 from pg_constraint where conname = c.con) then
      execute format('alter table public.%I add constraint %I check (%s) not valid', c.tabla, c.con, c.expr);
    end if;
  end loop;
end $$;
