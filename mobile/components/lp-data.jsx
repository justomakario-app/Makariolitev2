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
    abrirJornada:  () => rpc('prod_rpc_abrir_jornada'),   // owner/admin/encargado; abre la de HOY
    cerrarJornada: () => rpc('prod_rpc_cerrar_jornada'),  // cierra la abierta de hoy; devuelve resumen por sector

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
    // Fase 5.5: lista de compras (materia prima con falta, en unidades) y orden por sector (cola de cada sector).
    compras:           () => sel('prod_v_compras', 'sku, nombre, categoria, unidad, necesita, stock, falta', q => q.order('falta', { ascending: false })),
    ordenSector:       () => sel('prod_v_orden_sector', 'sector, sku, nombre, cantidad', q => q.order('cantidad', { ascending: false })),

    // ── CNC ──
    // Plan de corte óptimo (Fase 5b): minimiza cantidad de placas (y a igualdad,
    // merma) aprovechando placas combinadas. Solo lectura; gate cnc/encargado/owner/admin.
    planCorte: () => rpc('prod_rpc_plan_corte'), // → { total_placas, total_merma, plan:[{placa,material,tipo,cantidad,produce}] }
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
    embalajePrecheck: (p) => rpc('prod_rpc_embalaje_precheck', p), // {producto_sku,unidades} → componentes canónicos (BOM)
    stockPreview:   (p) => rpc('prod_rpc_stock_preview', p),   // read-only
    stockConfirmar: (p) => rpc('prod_rpc_stock_confirmar', p), // write explícito idempotente
    editarEmbalaje: (p) => rpc('prod_rpc_editar_embalaje', p),
    embalajeDia: (j) => sel('prod_embalaje', 'id, producto_sku, unidades, canal, created_at', q => q.eq('jornada_id', j).order('created_at', { ascending: false })),

    // ── Encargado (panel de control) ──
    alertas: () => sel('prod_alerta', 'id, insumo_sku, nivel, stock_actual, stock_minimo, vista, created_at', q => q.eq('vista', false).order('created_at', { ascending: false })),
    mantenimientos: () => sel('prod_mantenimiento', 'id, sector, tipo, urgencia, maquina, descripcion, estado, reportado_por, created_at', q => q.order('created_at', { ascending: false })),
    solicitudes: () => sel('prod_solicitud', 'id, jornada_id, sector, items, estado, solicitado_por, created_at', q => q.order('created_at', { ascending: false })),
    insumos: () => sel('prod_insumo', 'sku, nombre, categoria, sector, stock_actual, stock_minimo, unidad', q => q.order('nombre')),

    // ── Materia prima / Remitos (Fase 6) ── ingreso suma stock; el historial
    // se lee directo (RLS encargado/owner/admin). Gate del RPC: owner/admin/encargado.
    remitos: () => sel('prod_remito', 'id, proveedor, nro_remito, fecha, items, created_at', q => q.order('created_at', { ascending: false })),
    ingresarRemito: (p) => rpc('prod_rpc_ingresar_remito', p), // { proveedor, nro_remito, fecha, items:[{sku,cantidad}] }

    // ── Soporte (todas las pantallas) ──
    crearSolicitud:        (p) => rpc('prod_rpc_crear_solicitud', p),
    reportarMantenimiento: (p) => rpc('prod_rpc_reportar_mantenimiento', p),

    // ── Aprobaciones (Fase 8) ── el encargado aprueba (coord); admin recepciona insumos; owner/admin (director) recibe mantenimiento.
    gestionarSolicitud:     (p) => rpc('prod_rpc_gestionar_solicitud', p),     // { id, estado: 'aprobada_coord' | 'recepcionada_admin' }
    gestionarMantenimiento: (p) => rpc('prod_rpc_gestionar_mantenimiento', p), // { id, estado: 'aprobado_coord' | 'recibido_director' }

    // ── Histórico / Dashboard del director (Fase 9) ── solo owner/admin.
    directorHistorico: (p) => rpc('prod_rpc_director_historico', p), // { desde, hasta } → { kpis, comparativa, por_dia, top_productos, mantenimientos }

    // ── Realtime (Fase 4.2) ──
    // Suscribe a INSERT/UPDATE/DELETE de las `tables` indicadas y llama a
    // onChange (debounced 250ms) ante cualquier cambio. RLS filtra server-side:
    // cada rol solo recibe lo que puede leer. Devuelve una función de baja para
    // usar en el cleanup del useEffect. Si Realtime no está disponible, es no-op
    // (la pantalla sigue refrescando al montar/editar, sin romperse).
    subscribe: function (tables, onChange) {
      const client = sb();
      const noop = function () {};
      if (!client || typeof client.channel !== 'function') return noop;
      const list = Array.isArray(tables) ? tables : [tables];
      let timer = null;
      const fire = function () {
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () {
          try { onChange(); } catch (e) { /* noop */ }
        }, 250);
      };
      let ch;
      try {
        ch = client.channel('lp-rt-' + Date.now() + '-' + Math.floor(Math.random() * 1e6));
        for (let i = 0; i < list.length; i++) {
          ch.on('postgres_changes', { event: '*', schema: 'public', table: list[i] }, fire);
        }
        ch.subscribe();
      } catch (e) {
        return noop;
      }
      return function () {
        if (timer) clearTimeout(timer);
        try { client.removeChannel(ch); } catch (e) { /* noop */ }
      };
    },
  };
})();
