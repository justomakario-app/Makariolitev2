/* ══ MARKETING — data layer (window.MKT_DATA) ═════════════════════════
   Capa de acceso al módulo de Marketing. Usa window.SUPA. Las RPC reciben
   { p_payload }. Las vistas mkt_v_* son security_invoker → el RLS deja leer
   solo a owner/admin/marketing. Debe cargarse ANTES que marketing.jsx.
   ═══════════════════════════════════════════════════════════════════════ */
window.MKT_DATA = window.MKT_DATA || (function () {
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
    // ── Ángulos de venta ──
    angulos: () => sel('mkt_v_angulo_resumen',
      'id, nombre, descripcion, color, orden, activo, n_videos, alcance_total, reproducciones_total, er_promedio, hook_promedio',
      q => q.order('orden', { ascending: true }).order('nombre', { ascending: true })),
    upsertAngulo: (p) => rpc('mkt_rpc_upsert_angulo', p),
    deleteAngulo: (id) => rpc('mkt_rpc_delete_angulo', { id: id }),

    // ── Videos (por ángulo) — la vista trae la última métrica + ER%/hook ──
    videos: (anguloId) => sel('mkt_v_video_resumen', '*',
      q => q.eq('angulo_id', anguloId).order('fecha_publicacion', { ascending: false, nullsFirst: false })),
    videoResumen: (videoId) => sel('mkt_v_video_resumen', '*', q => q.eq('id', videoId)),
    upsertVideo: (p) => rpc('mkt_rpc_upsert_video', p),
    deleteVideo: (id) => rpc('mkt_rpc_delete_video', { id: id }),

    // ── Métricas (snapshots en el tiempo) ──
    metricas: (videoId) => sel('mkt_video_metrica',
      'id, fecha, fuente, alcance, impresiones, reproducciones, likes, comentarios, compartidos, guardados, vistas_3s, retencion_pct, seguidores',
      q => q.eq('video_id', videoId).order('fecha', { ascending: true })),
    cargarMetrica: (p) => rpc('mkt_rpc_cargar_metrica', p),

    // ── Calendario (eventos) ──
    eventos: (desde, hasta) => sel('mkt_evento',
      'id, fecha, titulo, plataforma, formato, objetivo, angulo_id, material_url, audio, copy, arte_url, notas_diseno, notas_cm, estado, responsable',
      q => { let qq = q.order('fecha', { ascending: true }); if (desde) qq = qq.gte('fecha', desde); if (hasta) qq = qq.lte('fecha', hasta); return qq; }),
    upsertEvento: (p) => rpc('mkt_rpc_upsert_evento', p),
    deleteEvento: (id) => rpc('mkt_rpc_delete_evento', { id: id }),

    // ── Publicidad (campañas) ──
    campanias: () => sel('mkt_v_campania_resumen', '*', q => q.order('metrica_fecha', { ascending: false, nullsFirst: false })),
    upsertCampania: (p) => rpc('mkt_rpc_upsert_campania', p),
    deleteCampania: (id) => rpc('mkt_rpc_delete_campania', { id: id }),
    cargarCampaniaMetrica: (p) => rpc('mkt_rpc_cargar_campania_metrica', p),

    // ── Prioridades ──
    prioridades: () => sel('mkt_prioridad', 'id, titulo, descripcion, urgencia, area, estado, solicitado_por, asignado_a, created_at',
      q => q.order('created_at', { ascending: false })),
    crearPrioridad: (p) => rpc('mkt_rpc_crear_prioridad', p),
    gestionarPrioridad: (p) => rpc('mkt_rpc_gestionar_prioridad', p),
    deletePrioridad: (id) => rpc('mkt_rpc_delete_prioridad', { id: id }),

    // ── Dashboard general ──
    dashboard: () => rpc('mkt_rpc_dashboard'),
  };
})();
