-- ═══════════════════════════════════════════════════════════════════════════
-- 0165 — La tienda queda con dos canales: mayorista y distribuidor
-- ───────────────────────────────────────────────────────────────────────────
-- Decision del dueno (2026-08-18): "solo mayoristas y distribuidor". El canal
-- 'minorista' se apaga.
--
-- Se APAGA, no se borra. Tres razones:
--
--   1. b2b_producto.precio_base ES el precio minorista — es el neto sin IVA
--      con coeficiente 1,00, y es la referencia sobre la que se calculan los
--      otros dos (mayorista 0,70 / distribuidor 0,55). Borrar la fila del
--      canal no cambiaria un solo precio, pero dejaria el sistema sin la
--      unica definicion escrita de que representa ese numero.
--   2. Volver a prenderlo es un update de una linea. Recrearlo desde cero es
--      acordarse del coeficiente y del orden.
--   3. Un delete sobre un canal que manana alguien referencie deja huerfanos.
--      El flag no.
--
-- Verificado ANTES de aplicar, contra el remoto: el canal minorista tiene
--   0 clientes con canal_activo · 0 clientes habilitados · 0 pedidos ·
--   0 precios de lista propios.
-- O sea: no hay nadie adentro. Apagarlo no le saca la tienda a ningun
-- cliente ni toca ningun pedido existente.
--
-- No hace falta tocar NADA del frontend: las cinco pantallas del panel que
-- listan canales (clientes y solicitudes en web y mobile, catalogo en las
-- dos) ya filtran con `.filter(c => c.activo !== false)`, y las RPC que
-- asignan canal ya exigen `and activo`. El alta abierta de la tienda (0163)
-- ademas ya estaba restringida a ('mayorista','distribuidor') por codigo.
--
-- Que cambia, en concreto:
--   · Desaparece del selector de canal al aprobar un acceso.
--   · Desaparece de la columna de precios del catalogo del admin.
--   · Nadie puede quedar asignado a el (b2b_rpc_admin_cliente lo rechaza).
--   · Un cliente sin canal NO ve precios minoristas: no ve precios. La RPC
--     del catalogo corta con "Tu cuenta todavia no esta habilitada para
--     comprar" (b2b_fn_coeficiente_actual devuelve null). Esto ya era asi.
--
-- Para volver atras:
--   update public.b2b_canal set activo = true where codigo = 'minorista';
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- Red de seguridad: si alguien quedo colgado del canal, esto aborta la
-- migracion en vez de dejarlo sin poder comprar de un dia para el otro.
do $$
declare v_n integer;
begin
  select count(*) into v_n
    from public.customers_b2b
   where b2b_canal = 'minorista' or 'minorista' = any(coalesce(b2b_canales, '{}'));
  if v_n > 0 then
    raise exception
      'Hay % cliente(s) en el canal minorista. Reasignalos a mayorista o distribuidor antes de apagarlo.', v_n
      using errcode = '22023';
  end if;
end $$;

update public.b2b_canal
   set activo = false
 where codigo = 'minorista';

comment on table public.b2b_canal is
  'Segmento comercial del cliente B2B. El precio final = b2b_producto.precio_base * coeficiente. '
  'Distinto de public.channels (canales logisticos ML/TN). '
  'Desde 0165 la tienda opera con DOS canales activos: mayorista (0,70) y distribuidor (0,55). '
  'minorista (1,00) queda inactivo a proposito: es la referencia de precio_base, no un canal de venta.';

commit;
