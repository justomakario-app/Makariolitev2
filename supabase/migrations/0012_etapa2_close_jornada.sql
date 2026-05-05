-- ════════════════════════════════════════════════════════════════════
-- ETAPA 2 — rpc_close_jornada v2
-- ════════════════════════════════════════════════════════════════════
-- Cambios respecto de la versión original (en 0008_rpcs.sql):
--   1) Acepta canales flexibles (TN, Distribuidor, No Flex, Correo Arg.) —
--      ya no requiere tipo_cierre='horario'. El cierre lo decide la persona.
--   2) Trabaja sobre la jornada existente (creada por rpc_open_jornada o
--      auto-creada por rpc_register_production). Si no existe, error claro.
--   3) Snapshot SE FILTRA POR jornada_id en production_logs — solo cuenta
--      la producción específicamente vinculada a esta jornada, no logs de
--      otras jornadas en rolling.
--   4) UPDATE de la jornada existente (no INSERT nuevo) — la fila ya estaba.
--   5) Marca status='cerrada' + is_active=false. Audit trail.
--   6) Mensajes humanos + HINTs.
--
-- Rollback documentado al final.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rpc_close_jornada(
  p_channel_id text,
  p_fecha date DEFAULT NULL
) RETURNS public.jornadas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $func$
DECLARE
  v_role        role_enum;
  v_active_user boolean;
  v_fecha       date;
  v_jornada     public.jornadas;
  v_snapshot    jsonb;
  v_pedidos     int;
  v_unidades_p  int;
  v_unidades_d  int;
  v_faltante    int;
  v_order       record;
  v_next_fecha  date;
BEGIN
  -- Auth
  SELECT role, active INTO v_role, v_active_user
    FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_active_user = false THEN
    RAISE EXCEPTION 'Tu sesion expiro o tu cuenta esta desactivada.'
      USING ERRCODE = '42501', HINT = 'auth';
  END IF;
  IF v_role NOT IN ('owner','admin','encargado') THEN
    RAISE EXCEPTION 'Solo owner, admin o encargado pueden cerrar jornadas.'
      USING ERRCODE = '42501', HINT = 'not_authorized';
  END IF;

  v_fecha := COALESCE(p_fecha, current_date);

  -- Validar canal (todos los canales pueden cerrar — Etapa 2 elimina el
  -- requisito de tipo_cierre='horario').
  IF NOT EXISTS (SELECT 1 FROM public.channels WHERE id = p_channel_id) THEN
    RAISE EXCEPTION 'El canal % no existe.', p_channel_id
      USING ERRCODE = '23503', HINT = 'channel_not_found';
  END IF;

  -- Lock + buscar jornada (FOR UPDATE bloquea solo esta fila, no otras
  -- jornadas/canales en paralelo).
  SELECT * INTO v_jornada FROM public.jornadas
   WHERE channel_id = p_channel_id AND fecha = v_fecha
   FOR UPDATE;

  IF v_jornada.id IS NULL THEN
    RAISE EXCEPTION 'No existe jornada para % del %. Tenes que abrirla antes de cerrarla.',
      p_channel_id, to_char(v_fecha, 'DD/MM/YYYY')
      USING ERRCODE = '22023', HINT = 'jornada_not_found';
  END IF;

  IF v_jornada.status = 'cerrada' THEN
    RAISE EXCEPTION 'La jornada de % del % ya esta cerrada.',
      p_channel_id, to_char(v_fecha, 'DD/MM/YYYY')
      USING ERRCODE = '22023', HINT = 'already_closed';
  END IF;

  -- Snapshot por SKU. Pedido = orders activas del canal. Producido = SOLO
  -- production_logs vinculados a esta jornada (filtro nuevo, evita contar
  -- rolling).
  WITH skus_canal AS (
    SELECT sku FROM public.orders
     WHERE channel_id = p_channel_id AND status IN ('pendiente','arrastrado')
    UNION
    SELECT sku FROM public.production_logs
     WHERE jornada_id = v_jornada.id
  ),
  pedidos_por_sku AS (
    SELECT sku, COALESCE(SUM(cantidad), 0)::int AS pedido
      FROM public.orders
      WHERE channel_id = p_channel_id AND status IN ('pendiente','arrastrado')
      GROUP BY sku
  ),
  producido_por_sku AS (
    SELECT sku, COALESCE(SUM(cantidad), 0)::int AS producido
      FROM public.production_logs
      WHERE jornada_id = v_jornada.id
      GROUP BY sku
  ),
  rows AS (
    SELECT
      s.sku,
      sc.modelo,
      sc.color,
      COALESCE(p.pedido, 0)    AS pedido,
      COALESCE(pr.producido, 0) AS producido,
      GREATEST(0, COALESCE(p.pedido, 0) - COALESCE(pr.producido, 0)) AS faltante,
      GREATEST(0, COALESCE(pr.producido, 0) - COALESCE(p.pedido, 0)) AS stock
    FROM skus_canal s
      LEFT JOIN public.sku_catalog sc ON sc.sku = s.sku
      LEFT JOIN pedidos_por_sku p ON p.sku = s.sku
      LEFT JOIN producido_por_sku pr ON pr.sku = s.sku
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'sku',       sku,
      'modelo',    modelo,
      'color',     color,
      'pedido',    pedido,
      'producido', producido,
      'faltante',  faltante,
      'stock',     stock
    ) ORDER BY sku), '[]'::jsonb),
    COALESCE(SUM(pedido), 0)::int,
    COALESCE(SUM(producido), 0)::int,
    COALESCE(SUM(faltante), 0)::int
  INTO v_snapshot, v_unidades_p, v_unidades_d, v_faltante
  FROM rows;

  -- Contar pedidos activos del canal
  SELECT count(*) INTO v_pedidos
  FROM public.orders
  WHERE channel_id = p_channel_id AND status IN ('pendiente','arrastrado');

  -- Cerrar la jornada existente (UPDATE, no INSERT)
  UPDATE public.jornadas
  SET
    status              = 'cerrada',
    is_active           = false,
    pedidos_count       = v_pedidos,
    unidades_pedidas    = v_unidades_p,
    unidades_producidas = v_unidades_d,
    faltante_arrastrado = v_faltante,
    snapshot            = v_snapshot,
    closed_by           = auth.uid(),
    closed_at           = now()
  WHERE id = v_jornada.id
  RETURNING * INTO v_jornada;

  -- Próxima jornada para arrastres
  v_next_fecha := v_fecha + 1;

  -- Archivar y arrastrar orders pendientes
  FOR v_order IN
    SELECT o.id, o.channel_id, o.order_number, o.cliente, o.sku, o.cantidad
    FROM public.orders o
    WHERE o.channel_id = p_channel_id
      AND o.status IN ('pendiente','arrastrado')
  LOOP
    -- Si el SKU tenía faltante en la jornada cerrada, arrastrar la order al día siguiente.
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_snapshot) AS e
      WHERE e->>'sku' = v_order.sku
        AND COALESCE((e->>'faltante')::int, 0) > 0
    ) THEN
      INSERT INTO public.orders
        (channel_id, order_number, cliente, sku, cantidad,
         fecha_pedido, status)
      VALUES (
        v_order.channel_id,
        v_order.order_number || '-A' || to_char(v_fecha, 'YYYYMMDD'),
        v_order.cliente,
        v_order.sku,
        v_order.cantidad,
        v_next_fecha,
        'arrastrado'
      )
      ON CONFLICT (channel_id, order_number, sku) DO NOTHING;
    END IF;

    UPDATE public.orders
       SET status = 'archivado',
           jornada_id = v_jornada.id
     WHERE id = v_order.id;
  END LOOP;

  -- Audit
  INSERT INTO public.jornada_audit (jornada_id, accion, by_user)
  VALUES (v_jornada.id, 'cerrada', auth.uid());

  RETURN v_jornada;
END;
$func$;

REVOKE ALL ON FUNCTION public.rpc_close_jornada(text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_close_jornada(text, date) TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK: restaurar la versión original desde 0008_rpcs.sql.
-- ════════════════════════════════════════════════════════════════════
