-- 0149: CNC — cada placa del catálogo (SKU de sistema) es su PROPIA materia prima consumible.
-- Append-only. No crea códigos nuevos ni catálogo paralelo: reusa el sku/nombre/rendimiento que YA
-- existen en prod_placa (las 29 placas del catálogo). Efecto: prod_rpc_registrar_corte (0146) pasa a
-- consumir stock de placa de forma INCONDICIONAL y bloquea si no alcanza — no queda ningún camino para
-- cortar sin descontar placas. El operario/encargado sólo carga o ajusta CANTIDADES reales (mp_ajuste),
-- nunca vuelve a crear el código/nombre/tipo de la placa.
--
-- Pino: se RE-EXIGE el consumo real (mp_consumo_obligatorio=1, revierte el '0' operativo de 0148).
-- Con esto, producir patas sin receta de materia prima queda bloqueado ("Configuración incompleta");
-- cuando exista la receta (prod_pino_receta: tamaño→varilla→patas_por_unidad — dato físico de Seba),
-- registrar_pino (0146) consume la varilla y bloquea si el stock no alcanza, sin generar negativos.
-- Como toda placa queda con mp_sku propio, el flag '1' NO afecta a CNC (su chequeo de stock ya es
-- incondicional); sólo exige el consumo en Pino.

-- (1) Auto-vínculo placa ↔ su propia materia prima (mismo código). Idempotente.
do $$
declare r record;
begin
  for r in select sku, nombre from public.prod_placa loop
    insert into public.prod_materia_prima (sku, nombre, tipo, sector, unidad, activo)
      values (r.sku, coalesce(r.nombre, r.sku), 'placa', 'cnc', 'u', true)
    on conflict (sku) do nothing;
    insert into public.prod_stock_mp (mp_sku) values (r.sku)
    on conflict (mp_sku) do nothing;
  end loop;
  -- vincula cada placa a su propia MP; respeta un mp_sku ya asignado distinto, si existiera.
  update public.prod_placa set mp_sku = sku where mp_sku is null;
end $$;

-- (2) Consumo real obligatorio: sin materia prima/receta configurada, CNC y Pino NO producen.
insert into public.prod_config (clave, valor) values ('mp_consumo_obligatorio','1')
on conflict (clave) do update set valor = '1', updated_at = now();
