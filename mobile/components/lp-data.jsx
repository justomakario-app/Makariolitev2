/* ══ LÍNEA PRODUCTIVA — data layer compartida (window.LP_DATA) ══════════
   Capa de acceso a datos del módulo Producción en Línea, reutilizada por
   TODAS las pantallas de sector (CNC, Melamina, Pino, Embalaje, Encargado).
   Debe cargarse ANTES que los *-sector.jsx.

   Usa window.SUPA (cliente Supabase que expone data.js). El JWT de sesión
   resuelve auth.uid() server-side. NO toca data.js ni el store de la app.
   Todas las RPC del backend (migration 0073) reciben { p_payload }.
   ═══════════════════════════════════════════════════════════════════════ */

window.LP_DATA = window.LP_DATA || (function () {
  const sb = () => window.SUPA;
  const rpc = async (name, payload) => {
    const { data, error } = await sb().rpc(name, { p_payload: payload || {} });
    if (error) throw new Error(error.message);
    return data;
  };
  const sel = async (tabla, cols, build) => {
    let q = sb().from(tabla).select(cols);
    if (build) q = build(q);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data || [];
  };

  return {
    // ── Jornada ──
    jornadaHoy: () => rpc('prod_rpc_get_jornada_hoy'),

    // ── Maestros ──
    placas:    () => sel('prod_placa', 'sku, nombre, material, rendimiento, pieza_sku, combinada', q => q.order('sku')),
    piezas:    () => sel('prod_pieza', 'sku, nombre', q => q.order('sku')),
    productos: () => sel('prod_producto', 'sku, nombre, color, patas_tipo, patas_cant, kit_embalaje, activo', q => q.eq('activo', true).order('sku')),
    recetaProducto: (sku) => sel('prod_receta', 'pieza_sku, cantidad', q => q.eq('producto_sku', sku)),

    // ── Stock y vistas de cálculo ──
    stock:             () => rpc('prod_rpc_get_stock'),                 // {stock_pieza, stock_melamina, stock_patas, stock_terminado}
    armables:          () => sel('prod_v_armables', 'producto_sku, nombre, armables', q => q.order('armables', { ascending: true })),
    resumenDia:        () => sel('prod_v_resumen_dia', 'producto_sku, nombre, color, pendiente', q => q.order('pendiente', { ascending: false })),
    prioridadMelamina: () => sel('prod_v_prioridad_melamina', 'pieza_sku, demanda, stock_propio, falta, crudo_cnc', q => q.order('falta', { ascending: false })),
    demandaTap:        () => sel('prod_v_demanda_tap', 'pieza_sku, demanda', q => q.order('demanda', { ascending: false })),

    // ── CNC ──
    registrarCorte: (p) => rpc('prod_rpc_registrar_corte', p),
    editarCorte: (p) => rpc('prod_rpc_editar_corte', p),
    cortesDia: (j) => sel('prod_corte', 'id, placa_sku, hojas, desperdicio, created_at, editable_hasta', q => q.eq('jornada_id', j).order('created_at', { ascending: false })),

    // ── Melamina ──
    registrarMelamina: (p) => rpc('prod_rpc_registrar_melamina', p),
    editarMelamina: (p) => rpc('prod_rpc_editar_melamina', p),
    melaminaDia: (j) => sel('prod_melamina', 'id, pieza_sku, terminadas, fallas, created_at, editable_hasta', q => q.eq('jornada_id', j).order('created_at', { ascending: false })),

    // ── Pino ──
    registrarPino: (p) => rpc('prod_rpc_registrar_pino', p),
    editarPino: (p) => rpc('prod_rpc_editar_pino', p),
    pinoDia: (j) => sel('prod_pino', 'id, tamano, terminadas, masilladas, created_at, editable_hasta', q => q.eq('jornada_id', j).order('created_at', { ascending: false })),

    // ── Embalaje ──
    registrarEmbalaje: (p) => rpc('prod_rpc_registrar_embalaje', p),
    editarEmbalaje: (p) => rpc('prod_rpc_editar_embalaje', p),
    embalajeDia: (j) => sel('prod_embalaje', 'id, producto_sku, unidades, canal, created_at', q => q.eq('jornada_id', j).order('created_at', { ascending: false })),

    // ── Encargado (panel de control) ──
    alertas: () => sel('prod_alerta', 'id, insumo_sku, nivel, stock_actual, stock_minimo, vista, created_at', q => q.eq('vista', false).order('created_at', { ascending: false })),
    mantenimientos: () => sel('prod_mantenimiento', 'id, sector, tipo, urgencia, maquina, estado, created_at', q => q.order('created_at', { ascending: false })),
    insumos: () => sel('prod_insumo', 'sku, nombre, categoria, sector, stock_actual, stock_minimo, unidad', q => q.order('nombre')),

    // ── Soporte (todas las pantallas) ──
    crearSolicitud:        (p) => rpc('prod_rpc_crear_solicitud', p),
    reportarMantenimiento: (p) => rpc('prod_rpc_reportar_mantenimiento', p),
  };
})();
