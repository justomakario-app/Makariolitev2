/* ══ VENTAS PAGE (S2.21b · S2.23 Mayoristas · S2.23-patch1 rediseño UI)
   Módulo comercial y de clientes — 9 tabs.
   Tab "Clientes mayoristas" implementada: MayoristasTab (lista → ficha).
   El resto, Próximamente. owner por rol + admins con permiso 'ventas'.
   ══ */

/* ── Tokens de diseño (premium, inline para mantener bit-perfect) ── */
const MAY_UI = {
  pageBg:   '#F9FAFB',
  cardBg:   '#FFFFFF',
  border:   '#E5E7EB',
  borderSoft:'#F0F1F3',
  ink:      '#111827',
  inkSoft:  '#374151',
  inkMuted: '#6B7280',
  inkFaint: '#9CA3AF',
  radius:   12,
  shadowHover: '0 2px 8px rgba(0,0,0,0.08)',
  trans:    'box-shadow .15s ease, transform .15s ease, opacity .15s ease',
};

/* ── Estados de pedido (colores S2.23-patch1) ── */
const MAY_ESTADOS = {
  cotizacion:    { label: 'Cotización',    bg: '#F3F4F6', fg: '#6B7280' },
  confirmado:    { label: 'Confirmado',    bg: '#EFF6FF', fg: '#3B82F6' },
  en_produccion: { label: 'En producción', bg: '#FEF3C7', fg: '#B45309' },
  listo:         { label: 'Listo',         bg: '#D1FAE5', fg: '#059669' },
  entregado:     { label: 'Entregado',     bg: '#065F46', fg: '#FFFFFF' },
  cancelado:     { label: 'Cancelado',     bg: '#FEE2E2', fg: '#DC2626' },
};
const MAY_ESTADO_ORDER = ['cotizacion','confirmado','en_produccion','listo','entregado','cancelado'];

function MayEstadoBadge({ estado, size = 'md' }) {
  const c = MAY_ESTADOS[estado] || { label: estado, bg: '#F3F4F6', fg: '#6B7280' };
  const pad = size === 'sm' ? '2px 8px' : '3px 10px';
  const fs  = size === 'sm' ? 10 : 11;
  return (
    <span style={{
      display:'inline-block', fontSize:fs, fontWeight:700, padding:pad,
      borderRadius:999, background:c.bg, color:c.fg, textTransform:'uppercase', letterSpacing:'.04em',
    }}>{c.label}</span>
  );
}

function mayMoney(n) {
  if (window.ADMIN_DATA && window.ADMIN_DATA.formatMoneyES) return window.ADMIN_DATA.formatMoneyES(n);
  const v = Number(n) || 0;
  return '$' + v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function venCompanyForExport(company) {
  if (window.normalizeCompanySettings) return window.normalizeCompanySettings(company);
  return Object.assign({ razon_social: 'Justo Makario' }, company || {});
}

function venDrawCompanyHeader(doc, company, x, y) {
  const c = venCompanyForExport(company);
  const logo = window.drawJsPdfMakarioLogo
    ? window.drawJsPdfMakarioLogo(doc, x, y, { width: 38, mainSize: 11, subSize: 7 })
    : null;
  const detailX = logo ? x + 46 : x;
  let detailY = logo ? y + 1 : y;
  doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(40,40,40);
  if (!logo) { doc.text(c.razon_social || 'Justo Makario', detailX, detailY); detailY += 4; }
  doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(80,80,80);
  if (c.cuit) { doc.text(`CUIT ${c.cuit}`, detailX, detailY); detailY += 4; }
  const dom = [c.domicilio, c.ciudad, c.provincia].filter(Boolean).join(', ');
  if (dom) { doc.text(dom, detailX, detailY); detailY += 4; }
  const cont = [c.telefono, c.email].filter(Boolean).join('  ·  ');
  if (cont) { doc.text(cont, detailX, detailY); detailY += 4; }
  return logo ? Math.max(detailY, logo.bottom) : detailY;
}

function VentasPage() {
  /* El rol 'ventas' entra a esta sección SOLO por la tienda mayorista: es lo
     único que la base le autoriza (b2b_rpc_admin_pedidos y b2b_rpc_admin_clientes
     aceptan owner/admin/ventas; el resto de las RPC le devuelve 42501). Cta cte,
     Facturación, Presupuestos, Remitos y Base de productos no se listan, en vez
     de mostrarlas y que fallen al abrirse. */
  const role = (window.MOCK?.user?.role || '').toLowerCase();
  const TABS = role === 'ventas'
    ? [{ id:'tienda-b2b', label:'Tienda mayorista' }]
    : [
        { id:'alta-clientes',    label:'Alta y mod. clientes' },
        { id:'cta-cte-clientes', label:'Cta cte clientes' },
        { id:'facturacion',      label:'Facturación' },
        { id:'presupuestos',     label:'Presupuestos' },
        { id:'remitos',          label:'Remitos' },
        { id:'ventas-ml',        label:'Ventas ML' },
        { id:'ventas-tienda',    label:'Ventas tienda' },
        { id:'mayoristas',       label:'Clientes mayoristas' },
        { id:'tienda-b2b',       label:'Tienda mayorista' },
        { id:'base-productos',   label:'Base de productos' },
      ];
  /* Deep-link desde la campanita (window.NAV_INTENT, ver app.jsx y pages.jsx).
     Se lee UNA sola vez, al construir el estado, y se limpia en un efecto —no
     durante el render— porque B2BTiendaTab también lo lee y los hijos se
     renderizan antes de que corra ningún efecto. Si no se limpiara, la próxima
     vez que alguien entrara a Ventas caería en la misma pestaña sin pedirlo. */
  const intent = window.NAV_INTENT || null;
  const [tab, setTab] = useState(
    intent && TABS.some(t => t.id === intent.ventasTab) ? intent.ventasTab : TABS[0].id
  );
  useEffect(() => { window.NAV_INTENT = null; }, []);
  const [ctaCteFocus, setCtaCteFocus] = useState(null);     // S2.25: cliente_id para abrir su cta cte
  const [mayoristasFocus, setMayoristasFocus] = useState(null); // S2.26: cliente_id del pedido generado
  const active = TABS.find(t => t.id === tab) || TABS[0];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Ventas</div>
          <div className="page-sub">Gestión comercial y clientes.</div>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'mayoristas'       ? <MayoristasTab focusClienteId={mayoristasFocus} onClearFocus={() => setMayoristasFocus(null)}/> :
         /* Tienda mayorista (B2B, migraciones 0151-0154). El componente se
            auto-protege: chequea el flag app_flags.b2b y el rol antes de
            mostrar nada. Si todavía no cargó, cae al placeholder de abajo. */
         tab === 'tienda-b2b' && window.B2BTiendaTab ? <window.B2BTiendaTab/> :
         tab === 'alta-clientes'    ? <ClientesB2BTab onVerCtaCte={(id) => { setCtaCteFocus(id); setTab('cta-cte-clientes'); }}/> :
         tab === 'cta-cte-clientes' ? <CtaCteClientesTab focusClienteId={ctaCteFocus} onClearFocus={() => setCtaCteFocus(null)}/> :
         tab === 'presupuestos'     ? <PresupuestosTab onVerPedido={(clienteId) => { setMayoristasFocus(clienteId); setTab('mayoristas'); }}/> :
         tab === 'remitos'          ? <RemitosTab onVerPedido={(clienteId) => { setMayoristasFocus(clienteId); setTab('mayoristas'); }}/> :
         tab === 'base-productos'   ? <BaseProductosTab/> :
         window.ProximamentePlaceholder ? <window.ProximamentePlaceholder nombre={active.label}/> :
         (
          <div className="admin-empty-state">
            <Icon n="store" s={32} c="var(--ink-muted)"/>
            <h3>{active.label}</h3>
            <p>Próximamente</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ══ MAYORISTAS TAB — lista (grilla de cards) → ficha del mayorista ══ */
function MayoristasTab({ focusClienteId, onClearFocus } = {}) {
  const toast = useToast();
  const role = (window.MOCK?.user?.role || '').toLowerCase();
  const isOwner = role === 'owner';

  const [view, setView]         = useState('list');
  const [selected, setSelected] = useState(null);
  const [items, setItems]       = useState([]);
  const [pedCount, setPedCount] = useState({});   // { cliente_id: nº pedidos }
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [search, setSearch]     = useState('');
  const [custModal, setCustModal] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [removingId, setRemovingId]     = useState(null);
  const [deleting, setDeleting]         = useState(false);
  const [hoverId, setHoverId]           = useState(null);

  const reload = async () => {
    setLoading(true); setError(null);
    try {
      const [mayoristas, pedidos] = await Promise.all([
        window.ADMIN_DATA.loadMayoristas(),
        window.ADMIN_DATA.listPedidosMayoristas({}),
      ]);
      setItems(mayoristas || []);
      const counts = {};
      for (const p of (pedidos || [])) {
        if (p.cliente_id) counts[p.cliente_id] = (counts[p.cliente_id] || 0) + 1;
      }
      setPedCount(counts);
      setSelected(prev => prev ? (mayoristas || []).find(m => m.id === prev.id) || prev : prev);
    } catch (err) {
      const msg = err?.message || 'Error desconocido';
      setError(msg); toast.error(msg);
    } finally { setLoading(false); }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  // S2.26: foco desde "Ver pedido generado" → abrir la ficha del cliente
  // (solo si es mayorista; un pedido de un cliente no-mayorista no aparece acá).
  useEffect(() => {
    if (!focusClienteId || !items.length) return;
    const m = items.find(x => x.id === focusClienteId);
    if (m) { setSelected(m); setView('ficha'); }
    else toast.info('El pedido es de un cliente no mayorista — vélo desde el listado de pedidos.');
    onClearFocus && onClearFocus();
    /* eslint-disable-next-line */
  }, [focusClienteId, items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(m =>
      (m.nombre || '').toLowerCase().includes(q) ||
      (m.localidad || '').toLowerCase().includes(q) ||
      (m.provincia || '').toLowerCase().includes(q) ||
      (m.email || '').toLowerCase().includes(q) ||
      (m.telefono || '').toLowerCase().includes(q)
    );
  }, [items, search]);

  const doDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await window.ADMIN_DATA.deleteMayorista({ id: deleteTarget.id });
      const id = deleteTarget.id;
      setDeleteTarget(null);
      setRemovingId(id);            // dispara el fade-out
      toast.success('Mayorista eliminado');
      setTimeout(() => {
        setItems(prev => prev.filter(x => x.id !== id));
        setRemovingId(null);
      }, 180);
    } catch (err) {
      toast.error(err?.message || 'No se pudo eliminar');
    } finally { setDeleting(false); }
  };

  /* ── VISTA 2 — Ficha ── */
  if (view === 'ficha' && selected) {
    const chips = [
      (selected.provincia || selected.localidad) && { ic: '📍', txt: [selected.provincia, selected.localidad].filter(Boolean).join(' · ') },
      selected.telefono && { ic: '📞', txt: selected.telefono },
      selected.email && { ic: '✉️', txt: selected.email },
      selected.cuit && { ic: '🪪', txt: selected.cuit },
    ].filter(Boolean);

    return (
      <div style={{background:MAY_UI.pageBg, borderRadius:MAY_UI.radius, padding:16}}>
        <div style={{
          background:MAY_UI.cardBg, border:`1px solid ${MAY_UI.border}`, borderRadius:MAY_UI.radius,
          padding:24, marginBottom:16,
        }}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap'}}>
            <div style={{display:'flex', alignItems:'center', gap:14}}>
              <button className="btn-ghost" onClick={() => { setView('list'); setSelected(null); }}>← Volver</button>
              <div style={{fontSize:24, fontWeight:700, letterSpacing:'-.02em', color:MAY_UI.ink}}>{selected.nombre}</div>
            </div>
            {isOwner && (
              <button className="btn-primary" onClick={() => setCustModal({ mode:'edit', initial: selected })}>
                <Icon n="edit" s={13}/> Editar
              </button>
            )}
          </div>

          {chips.length > 0 && (
            <div style={{display:'flex', flexWrap:'wrap', gap:8, marginTop:16}}>
              {chips.map((c, i) => (
                <span key={i} style={{
                  display:'inline-flex', alignItems:'center', gap:6, padding:'5px 11px',
                  background:'#F3F4F6', borderRadius:8, fontSize:12, fontWeight:600, color:MAY_UI.inkSoft,
                }}>
                  <span style={{fontSize:13}}>{c.ic}</span> {c.txt}
                </span>
              ))}
            </div>
          )}
        </div>

        <MayoristaPedidos clienteId={selected.id} clienteNombre={selected.nombre} isOwner={isOwner}/>

        {custModal && window.CustomerModal && (
          <window.CustomerModal
            mode={custModal.mode}
            initial={custModal.initial}
            defaultMayorista={custModal.defaultMayorista}
            onClose={() => setCustModal(null)}
            onSuccess={async () => { setCustModal(null); await reload(); }}
          />
        )}
      </div>
    );
  }

  /* ── VISTA 1 — Lista (grilla de cards) ── */
  return (
    <div style={{background:MAY_UI.pageBg, borderRadius:MAY_UI.radius, padding:16}}>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, marginBottom:16, flexWrap:'wrap'}}>
        <div style={{position:'relative', flex:'1 1 240px', maxWidth:360}}>
          <span style={{position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', display:'flex'}}>
            <Icon n="search" s={14} c={MAY_UI.inkFaint}/>
          </span>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar mayorista…"
            style={{
              width:'100%', padding:'9px 12px 9px 34px', borderRadius:10,
              border:`1px solid ${MAY_UI.border}`, background:'#fff', fontSize:13, color:MAY_UI.ink, outline:'none',
            }}/>
        </div>
        {isOwner && (
          <button className="btn-primary" onClick={() => setCustModal({ mode:'create', defaultMayorista:true })}>
            <Icon n="plus" s={13}/> Nuevo mayorista
          </button>
        )}
      </div>

      {loading ? (
        <div style={{display:'flex', justifyContent:'center', padding:'48px 0'}}><span className="loader" style={{width:26, height:26}}/></div>
      ) : error ? (
        <div style={emptyBoxStyle()}>
          <Icon n="alert" s={28} c="var(--red)"/>
          <div style={{fontWeight:700, marginTop:8}}>Error al cargar</div>
          <div style={{fontSize:12, color:MAY_UI.inkMuted, marginTop:2}}>{error}</div>
          <button className="btn-ghost" style={{marginTop:12}} onClick={reload}><Icon n="refresh" s={13}/> Reintentar</button>
        </div>
      ) : items.length === 0 ? (
        <div style={emptyBoxStyle()}>
          <Icon n="store" s={34} c={MAY_UI.inkFaint}/>
          <div style={{fontWeight:700, fontSize:15, marginTop:10, color:MAY_UI.ink}}>Todavía no hay mayoristas</div>
          <div style={{fontSize:13, color:MAY_UI.inkMuted, marginTop:4}}>Agregá el primero.</div>
          {isOwner && (
            <button className="btn-primary" style={{marginTop:16}} onClick={() => setCustModal({ mode:'create', defaultMayorista:true })}>
              <Icon n="plus" s={13}/> Nuevo mayorista
            </button>
          )}
        </div>
      ) : (
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(320px, 1fr))', gap:16}}>
          {filtered.map(m => {
            const hovered = hoverId === m.id;
            const removing = removingId === m.id;
            const n = pedCount[m.id] || 0;
            return (
              <div key={m.id}
                onMouseEnter={() => setHoverId(m.id)} onMouseLeave={() => setHoverId(null)}
                style={{
                  background:MAY_UI.cardBg, border:`1px solid ${MAY_UI.border}`, borderRadius:MAY_UI.radius,
                  padding:20, display:'flex', flexDirection:'column', gap:12,
                  boxShadow: hovered ? MAY_UI.shadowHover : 'none',
                  transform: removing ? 'scale(0.98)' : 'none',
                  opacity: removing ? 0 : 1,
                  transition: MAY_UI.trans,
                }}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10}}>
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:16, fontWeight:600, color:MAY_UI.ink, lineHeight:1.25}}>{m.nombre}</div>
                    <div style={{fontSize:12, color:MAY_UI.inkMuted, marginTop:3, fontWeight:600}}>
                      {[m.provincia, m.localidad].filter(Boolean).join(' · ') || 'Sin ubicación'}
                    </div>
                  </div>
                  <span style={{
                    flexShrink:0, fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:999,
                    background:'#EEF2FF', color:'#4F46E5', whiteSpace:'nowrap',
                  }}>{n} pedido{n === 1 ? '' : 's'}</span>
                </div>

                <div style={{display:'flex', flexDirection:'column', gap:4, fontSize:12.5, color:MAY_UI.inkSoft}}>
                  {m.telefono && <span style={{display:'flex', alignItems:'center', gap:7}}><span style={{opacity:.7}}>📞</span> {m.telefono}</span>}
                  {m.email && <span style={{display:'flex', alignItems:'center', gap:7, minWidth:0}}><span style={{opacity:.7}}>✉️</span> <span style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{m.email}</span></span>}
                  {!m.telefono && !m.email && <span style={{color:MAY_UI.inkFaint}}>Sin datos de contacto</span>}
                </div>

                <div style={{display:'flex', gap:8, marginTop:'auto', paddingTop:4}}>
                  <button className="btn-primary" style={{flex:1, justifyContent:'center'}}
                          onClick={() => { setSelected(m); setView('ficha'); }}>
                    Ver ficha
                  </button>
                  {isOwner && (
                    <button onClick={() => setDeleteTarget(m)}
                            style={{
                              display:'inline-flex', alignItems:'center', gap:6, padding:'8px 12px', borderRadius:8,
                              border:'1px solid #FCA5A5', background:'#FEF2F2', color:'#DC2626',
                              fontSize:12, fontWeight:600, cursor:'pointer', transition:'background .15s',
                            }}>
                      <Icon n="trash" s={12}/> Eliminar
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div style={{gridColumn:'1/-1', textAlign:'center', padding:'24px', color:MAY_UI.inkMuted}}>
              Sin resultados para "{search}"
            </div>
          )}
        </div>
      )}

      {custModal && window.CustomerModal && (
        <window.CustomerModal
          mode={custModal.mode}
          initial={custModal.initial}
          defaultMayorista={custModal.defaultMayorista}
          onClose={() => setCustModal(null)}
          onSuccess={async () => { setCustModal(null); await reload(); }}
        />
      )}

      {deleteTarget && window.ConfirmModal && (
        <window.ConfirmModal
          open={true}
          title="Eliminar mayorista"
          message={`¿Eliminar a "${deleteTarget.nombre}"? Esta acción no se puede deshacer.`}
          confirmText="Eliminar"
          danger
          onClose={() => { if (!deleting) setDeleteTarget(null); }}
          onConfirm={doDelete}
        />
      )}
    </div>
  );
}

function emptyBoxStyle() {
  return {
    background:MAY_UI.cardBg, border:`1px solid ${MAY_UI.border}`, borderRadius:MAY_UI.radius,
    padding:'48px 24px', textAlign:'center', display:'flex', flexDirection:'column', alignItems:'center',
  };
}

/* ── Lista de pedidos de un mayorista (dentro de la ficha) ── */
function MayoristaPedidos({ clienteId, clienteNombre, isOwner }) {
  const toast = useToast();
  const [pedidos, setPedidos]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [pedidoModal, setPedidoModal] = useState(false);
  const [estadoSaving, setEstadoSaving] = useState(null);

  const reload = async () => {
    setLoading(true);
    try {
      const data = await window.ADMIN_DATA.listPedidosMayoristas({ cliente_id: clienteId });
      setPedidos(data || []);
    } catch (err) {
      toast.error(err?.message || 'No se pudieron cargar los pedidos');
    } finally { setLoading(false); }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [clienteId]);

  const pedidoTotal = (p) => (p.items || []).reduce((s, it) => s + (Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0), 0);

  const cambiarEstado = async (pedidoId, estado) => {
    setEstadoSaving(pedidoId);
    try {
      await window.ADMIN_DATA.updateEstadoPedidoMayorista({ pedido_id: pedidoId, estado });
      toast.success('Estado actualizado');
      await reload();
    } catch (err) {
      toast.error(err?.message || 'No se pudo cambiar el estado');
    } finally { setEstadoSaving(null); }
  };

  const headerRow = (
    <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, marginBottom:14, flexWrap:'wrap'}}>
      <div style={{display:'flex', alignItems:'center', gap:10}}>
        <div style={{fontSize:15, fontWeight:700, color:MAY_UI.ink}}>Pedidos de {clienteNombre}</div>
        <span style={{fontSize:11, fontWeight:700, padding:'2px 9px', borderRadius:999, background:'#EEF2FF', color:'#4F46E5'}}>
          {pedidos.length}
        </span>
      </div>
      {isOwner && (
        <button className="btn-primary" onClick={() => setPedidoModal(true)}>
          <Icon n="plus" s={13}/> Nuevo pedido
        </button>
      )}
    </div>
  );

  return (
    <div>
      {headerRow}

      {loading ? (
        <div style={{display:'flex', justifyContent:'center', padding:'32px 0'}}><span className="loader" style={{width:22, height:22}}/></div>
      ) : pedidos.length === 0 ? (
        <div style={emptyBoxStyle()}>
          <Icon n="package" s={30} c={MAY_UI.inkFaint}/>
          <div style={{fontWeight:700, marginTop:10, color:MAY_UI.ink}}>Sin pedidos todavía</div>
          {isOwner && (
            <button className="btn-primary" style={{marginTop:14}} onClick={() => setPedidoModal(true)}>
              <Icon n="plus" s={13}/> Nuevo pedido
            </button>
          )}
        </div>
      ) : (
        <div style={{display:'flex', flexDirection:'column', gap:12}}>
          {pedidos.map(p => {
            const open = expanded === p.id;
            const total = pedidoTotal(p);
            const resumen = (p.items || []).map(it => `${it.cantidad}× ${it.modelo || it.sku}`).join(', ');
            return (
              <div key={p.id} style={{
                background:MAY_UI.cardBg, border:`1px solid ${MAY_UI.border}`, borderRadius:MAY_UI.radius, padding:18,
                transition:MAY_UI.trans,
              }}>
                <div style={{display:'flex', alignItems:'center', gap:10, flexWrap:'wrap'}}>
                  <span style={{fontFamily:'var(--mono)', fontWeight:700, fontSize:14, color:MAY_UI.ink}}>{p.numero_pedido}</span>
                  <MayEstadoBadge estado={p.estado}/>
                  <span style={{marginLeft:'auto', fontSize:12, color:MAY_UI.inkMuted}}>
                    {(p.fecha_pedido || '').slice(0,10)}
                    {p.fecha_entrega_estimada ? ` · entrega ${String(p.fecha_entrega_estimada).slice(0,10)}` : ''}
                  </span>
                </div>

                {resumen && <div style={{fontSize:13, color:MAY_UI.inkSoft, marginTop:10}}>{resumen}</div>}

                <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, marginTop:12}}>
                  <div>
                    <div style={{fontSize:10, fontWeight:700, letterSpacing:'.08em', textTransform:'uppercase', color:MAY_UI.inkFaint}}>Total</div>
                    <div style={{fontFamily:'var(--mono)', fontWeight:800, fontSize:20, color:MAY_UI.ink, lineHeight:1.1}}>{mayMoney(total)}</div>
                  </div>
                  <button className="btn-ghost" onClick={() => setExpanded(open ? null : p.id)}>
                    {open ? 'Ocultar detalle' : 'Ver detalle'} <Icon n={open ? 'chev-down' : 'chev-right'} s={13}/>
                  </button>
                </div>

                {open && (
                  <div style={{marginTop:14, paddingTop:14, borderTop:`1px solid ${MAY_UI.borderSoft}`}}>
                    <table className="data-table">
                      <thead>
                        <tr><th>SKU</th><th>Producto</th><th style={{textAlign:'right'}}>Cant.</th><th style={{textAlign:'right'}}>P. unit.</th><th style={{textAlign:'right'}}>Subtotal</th></tr>
                      </thead>
                      <tbody>
                        {(p.items || []).map((it, i) => (
                          <tr key={`${it.sku}-${i}`}>
                            <td><span className="order-num">{it.sku}</span></td>
                            <td>{it.modelo || it.sku}{it.color && it.color !== '—' ? ` · ${it.color}` : ''}</td>
                            <td style={{textAlign:'right'}}><span className="cell-color-num">{it.cantidad}</span></td>
                            <td style={{textAlign:'right'}}>{mayMoney(it.precio_unitario)}</td>
                            <td style={{textAlign:'right', fontWeight:600}}>{mayMoney((Number(it.cantidad)||0)*(Number(it.precio_unitario)||0))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {p.condicion_pago && <div style={{fontSize:12, color:MAY_UI.inkSoft, marginTop:10}}><strong>Condición de pago:</strong> {p.condicion_pago}</div>}
                    {p.notas && <div style={{fontSize:12, color:MAY_UI.inkSoft, marginTop:4}}><strong>Notas:</strong> {p.notas}</div>}

                    {isOwner && (
                      <div style={{display:'flex', alignItems:'center', gap:8, marginTop:14}}>
                        <span style={{fontSize:12, color:MAY_UI.inkMuted, fontWeight:600}}>Cambiar estado:</span>
                        <select className="field-input" style={{maxWidth:200, padding:'7px 10px'}}
                                value={p.estado} disabled={estadoSaving === p.id}
                                onChange={e => cambiarEstado(p.id, e.target.value)}>
                          {MAY_ESTADO_ORDER.map(es => <option key={es} value={es}>{MAY_ESTADOS[es].label}</option>)}
                        </select>
                        {estadoSaving === p.id && <span className="loader" style={{width:16, height:16}}/>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {pedidoModal && (
        <PedidoMayoristaModal
          clienteId={clienteId} clienteNombre={clienteNombre}
          onClose={() => setPedidoModal(false)}
          onCreated={async () => { setPedidoModal(false); await reload(); }}
        />
      )}
    </div>
  );
}

/* ── Modal de creación de pedido mayorista ── */
function PedidoMayoristaModal({ clienteId, clienteNombre, onClose, onCreated }) {
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ fecha_pedido: today, fecha_entrega_estimada: '', condicion_pago: '', notas: '' });
  const [lineas, setLineas] = useState([{ sku:'', cantidad:'', precio_unitario:'' }]);
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(s => ({ ...s, [k]: v }));
  const setLinea = (i, k, v) => setLineas(arr => arr.map((l, idx) => idx === i ? { ...l, [k]: v } : l));
  const addLinea = () => setLineas(arr => [...arr, { sku:'', cantidad:'', precio_unitario:'' }]);
  const delLinea = (i) => setLineas(arr => arr.length > 1 ? arr.filter((_, idx) => idx !== i) : arr);

  const skuOptions = useMemo(() => {
    const db = window.SKU_DB || {};
    return Object.keys(db)
      .filter(sku => db[sku] && db[sku].activo !== false)
      .sort()
      .map(sku => {
        const s = db[sku];
        const label = s.color && s.color !== '—' ? `${sku} — ${s.modelo} ${s.color}` : `${sku} — ${s.modelo || ''}`;
        return { sku, label };
      });
  }, []);

  const total = lineas.reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.precio_unitario) || 0), 0);

  const onSubmit = async () => {
    if (saving) return;
    const itemsValid = lineas
      .map(l => ({ sku: (l.sku || '').trim(), cantidad: parseInt(l.cantidad, 10), precio_unitario: Number(l.precio_unitario) }))
      .filter(l => l.sku && l.cantidad > 0 && l.precio_unitario >= 0 && Number.isFinite(l.precio_unitario));
    if (itemsValid.length === 0) { toast.error('Agregá al menos un ítem válido (SKU, cantidad > 0, precio ≥ 0)'); return; }
    setSaving(true);
    try {
      const res = await window.ADMIN_DATA.createPedidoMayorista({
        cliente_id: clienteId,
        fecha_pedido: form.fecha_pedido || today,
        fecha_entrega_estimada: form.fecha_entrega_estimada || null,
        condicion_pago: form.condicion_pago.trim(),
        notas: form.notas.trim(),
        items: itemsValid,
      });
      toast.success(`Pedido ${res?.numero_pedido || ''} creado`);
      onCreated?.();
    } catch (err) {
      if (err && /periodo_cerrado/i.test(err.message || '')) toast.error('No se puede crear: período contable cerrado.');
      else toast.error(err?.message || 'No se pudo crear el pedido');
      setSaving(false);
    }
  };

  const Cmp = window.Modal;
  return (
    <Cmp open={true} title={`Nuevo pedido · ${clienteNombre}`} onClose={() => { if (!saving) onClose?.(); }} footer={
      <>
        <button className="btn-ghost" onClick={() => { if (!saving) onClose?.(); }} disabled={saving}>Cancelar</button>
        <button className="btn-primary" onClick={onSubmit} disabled={saving}>
          {saving ? 'Creando…' : (<><Icon n="check" s={14}/> Crear pedido</>)}
        </button>
      </>
    }>
      <div style={{display:'flex', gap:12}}>
        <div className="field-group" style={{flex:1}}>
          <label className="field-label">Fecha pedido</label>
          <input className="field-input" type="date" value={form.fecha_pedido} onChange={e => set('fecha_pedido', e.target.value)}/>
        </div>
        <div className="field-group" style={{flex:1}}>
          <label className="field-label">Entrega estimada</label>
          <input className="field-input" type="date" value={form.fecha_entrega_estimada} onChange={e => set('fecha_entrega_estimada', e.target.value)}/>
        </div>
      </div>

      <div className="field-group">
        <label className="field-label">Condición de pago</label>
        <input className="field-input" value={form.condicion_pago} placeholder="Ej: 30 días, contado, 50% anticipo…"
               onChange={e => set('condicion_pago', e.target.value)}/>
      </div>

      <div className="field-group">
        <label className="field-label">Ítems</label>
        <table className="data-table">
          <thead>
            <tr><th style={{width:'45%'}}>SKU</th><th style={{width:'18%', textAlign:'right'}}>Cant.</th><th style={{width:'27%', textAlign:'right'}}>P. unit.</th><th></th></tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={i}>
                <td>
                  <select className="field-input" style={{padding:'6px 8px'}} value={l.sku} onChange={e => setLinea(i, 'sku', e.target.value)}>
                    <option value="">— elegir SKU —</option>
                    {skuOptions.map(o => <option key={o.sku} value={o.sku}>{o.label}</option>)}
                  </select>
                </td>
                <td><input className="field-input" style={{padding:'6px 8px', textAlign:'right'}} type="number" min="1" value={l.cantidad} onChange={e => setLinea(i, 'cantidad', e.target.value)}/></td>
                <td><input className="field-input" style={{padding:'6px 8px', textAlign:'right'}} type="number" min="0" step="0.01" value={l.precio_unitario} onChange={e => setLinea(i, 'precio_unitario', e.target.value)}/></td>
                <td style={{textAlign:'right', width:1}}>
                  <button className="btn-ghost" style={{padding:'5px 8px'}} title="Quitar ítem" onClick={() => delLinea(i)} disabled={lineas.length <= 1}>
                    <Icon n="trash" s={12}/>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn-ghost" style={{marginTop:8}} onClick={addLinea}><Icon n="plus" s={12}/> Agregar ítem</button>
      </div>

      <div style={{display:'flex', justifyContent:'flex-end', alignItems:'center', gap:10, marginTop:8, paddingTop:8, borderTop:`1px solid ${MAY_UI.borderSoft}`}}>
        <span style={{fontSize:12, color:MAY_UI.inkMuted, fontWeight:600, textTransform:'uppercase', letterSpacing:'.05em'}}>Total</span>
        <span style={{fontFamily:'var(--mono)', fontSize:18, fontWeight:800}}>{mayMoney(total)}</span>
      </div>

      <div className="field-group" style={{marginTop:12}}>
        <label className="field-label">Notas</label>
        <textarea className="field-input" rows={2} value={form.notas} onChange={e => set('notas', e.target.value)}/>
      </div>
    </Cmp>
  );
}

/* ══════════════════════════════════════════════════════════════════
   S2.25 — Tabs reales: Alta clientes · Cta cte · Base de productos
   Estilo premium MAY_UI (igual que Mayoristas). Reusan la capa de datos
   (window.ADMIN_DATA / window.SUPA / window.MOCK_ACTIONS) y los modales
   existentes (CustomerModal, CtaCteMovementModal, ProductoEditModal)
   SIN modificarlos.
   ══════════════════════════════════════════════════════════════════ */

function venFecha(d) {
  if (!d) return '—';
  const s = String(d).slice(0, 10);
  const [y, m, dd] = s.split('-');
  return (y && m && dd) ? `${dd}/${m}/${y}` : s;
}

/* KPI card reutilizable (estilo premium). */
function VenKpi({ label, value, accent, hint }) {
  return (
    <div style={{ background:MAY_UI.cardBg, border:`1px solid ${MAY_UI.border}`, borderRadius:MAY_UI.radius, padding:'14px 16px', flex:1, minWidth:140 }}>
      <div style={{ fontSize:10, fontWeight:700, letterSpacing:'.1em', textTransform:'uppercase', color:MAY_UI.inkFaint }}>{label}</div>
      <div style={{ fontFamily:'var(--mono)', fontSize:26, fontWeight:800, color: accent || MAY_UI.ink, lineHeight:1.1, marginTop:4 }}>{value}</div>
      {hint && <div style={{ fontSize:11, color:MAY_UI.inkMuted, marginTop:2 }}>{hint}</div>}
    </div>
  );
}

function venEmptyBox() {
  return { background:MAY_UI.cardBg, border:`1px solid ${MAY_UI.border}`, borderRadius:MAY_UI.radius, padding:'48px 24px', textAlign:'center', display:'flex', flexDirection:'column', alignItems:'center' };
}

/* ══ TAB 1 — Alta y mod. clientes (Clientes B2B) ══ */
function ClientesB2BTab({ onVerCtaCte }) {
  const toast = useToast();
  const role = (window.MOCK?.user?.role || '').toLowerCase();
  const canEdit = ['owner', 'admin'].includes(role);

  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [search, setSearch]   = useState('');
  const [prov, setProv]       = useState('');
  const [soloMay, setSoloMay] = useState(false);
  const [showInact, setShowInact] = useState(false);
  const [modal, setModal]     = useState(null);   // {mode, initial?}
  const [delTarget, setDelTarget] = useState(null);
  const [deleting, setDeleting]   = useState(false);

  const provincias = (window.ADMIN_DATA && window.ADMIN_DATA.ARG_PROVINCIAS) || [];

  const reload = async () => {
    setLoading(true); setError(null);
    try { setItems(await window.ADMIN_DATA.loadCustomersB2B({ includeInactive: showInact })); }
    catch (err) { const m = err?.message || 'Error'; setError(m); toast.error(m); }
    finally { setLoading(false); }
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [showInact]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(c => {
      if (prov && c.provincia !== prov) return false;
      if (soloMay && !c.es_mayorista) return false;
      if (!q) return true;
      return [c.nombre, c.cuit, c.email, c.telefono, c.localidad]
        .some(v => (v || '').toLowerCase().includes(q));
    });
  }, [items, search, prov, soloMay]);

  const now = new Date();
  const kActivos = items.filter(c => c.activo !== false).length;
  const kMay = items.filter(c => c.es_mayorista && c.activo !== false).length;
  const kNuevos = items.filter(c => {
    const d = c.created_at ? new Date(c.created_at) : null;
    return d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  const doDelete = async () => {
    if (!delTarget || deleting) return;
    setDeleting(true);
    try {
      // Pasar los campos completos: el RPC update setea email/telefono/notas
      // de forma incondicional (si no se mandan, los borraría).
      await window.ADMIN_DATA.updateCustomerB2B({
        id: delTarget.id, nombre: delTarget.nombre, cuit: delTarget.cuit,
        email: delTarget.email, telefono: delTarget.telefono, notas: delTarget.notas,
        activo: false,
      });
      toast.success('Cliente desactivado');
      setDelTarget(null);
      await reload();
    } catch (err) { toast.error(err?.message || 'No se pudo desactivar'); }
    finally { setDeleting(false); }
  };

  return (
    <div style={{ background:MAY_UI.pageBg, borderRadius:MAY_UI.radius, padding:16 }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, marginBottom:14, flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ fontSize:16, fontWeight:700, color:MAY_UI.ink }}>Clientes B2B</div>
          <span style={{ fontSize:11, fontWeight:700, padding:'2px 9px', borderRadius:999, background:'#EEF2FF', color:'#4F46E5' }}>{kActivos} activos</span>
        </div>
        {canEdit && (
          <button className="btn-primary" onClick={() => setModal({ mode:'create' })}>
            <Icon n="plus" s={13}/> Nuevo cliente
          </button>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display:'flex', gap:12, marginBottom:14, flexWrap:'wrap' }}>
        <VenKpi label="Clientes activos" value={kActivos}/>
        <VenKpi label="Mayoristas" value={kMay} accent="#15803d"/>
        <VenKpi label="Nuevos este mes" value={kNuevos} accent="#4F46E5"/>
      </div>

      {/* Filtros */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:14 }}>
        <div style={{ position:'relative', flex:'1 1 240px', maxWidth:360 }}>
          <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', display:'flex' }}><Icon n="search" s={14} c={MAY_UI.inkFaint}/></span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar nombre, CUIT, email, teléfono, localidad…"
                 style={{ width:'100%', padding:'9px 12px 9px 34px', borderRadius:10, border:`1px solid ${MAY_UI.border}`, background:'#fff', fontSize:13, outline:'none' }}/>
        </div>
        <select className="field-input" style={{ width:170, padding:'8px 10px' }} value={prov} onChange={e => setProv(e.target.value)}>
          <option value="">Todas las provincias</option>
          {provincias.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:MAY_UI.inkSoft, fontWeight:600 }}>
          <input type="checkbox" checked={soloMay} onChange={e => setSoloMay(e.target.checked)}/> Solo mayoristas
        </label>
        <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:MAY_UI.inkSoft, fontWeight:600 }}>
          <input type="checkbox" checked={showInact} onChange={e => setShowInact(e.target.checked)}/> Mostrar inactivos
        </label>
      </div>

      {/* Listado */}
      {loading ? (
        <div style={{ display:'flex', justifyContent:'center', padding:'48px 0' }}><span className="loader" style={{ width:26, height:26 }}/></div>
      ) : error ? (
        <div style={venEmptyBox()}>
          <Icon n="alert" s={28} c="var(--red)"/>
          <div style={{ fontWeight:700, marginTop:8 }}>Error al cargar</div>
          <div style={{ fontSize:12, color:MAY_UI.inkMuted, marginTop:2 }}>{error}</div>
          <button className="btn-ghost" style={{ marginTop:12 }} onClick={reload}><Icon n="refresh" s={13}/> Reintentar</button>
        </div>
      ) : items.length === 0 ? (
        <div style={venEmptyBox()}>
          <Icon n="users" s={34} c={MAY_UI.inkFaint}/>
          <div style={{ fontWeight:700, fontSize:15, marginTop:10 }}>Todavía no hay clientes</div>
          <div style={{ fontSize:13, color:MAY_UI.inkMuted, marginTop:4 }}>Agregá el primero.</div>
          {canEdit && <button className="btn-primary" style={{ marginTop:16 }} onClick={() => setModal({ mode:'create' })}><Icon n="plus" s={13}/> Nuevo cliente</button>}
        </div>
      ) : (
        <div style={{ background:MAY_UI.cardBg, border:`1px solid ${MAY_UI.border}`, borderRadius:MAY_UI.radius, overflow:'hidden' }}>
          <table className="data-table">
            <thead>
              <tr><th>Nombre</th><th>CUIT</th><th>Ubicación</th><th>Teléfono</th><th>Email</th><th>Tipo</th><th>Estado</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const inactivo = c.activo === false;
                return (
                  <tr key={c.id} style={inactivo ? { opacity:.55 } : undefined}>
                    <td style={{ fontWeight:600 }}>{c.nombre}</td>
                    <td><span className="order-num">{c.cuit || '—'}</span></td>
                    <td style={{ fontSize:12, color:MAY_UI.inkSoft }}>{[c.localidad, c.provincia].filter(Boolean).join(', ') || '—'}</td>
                    <td style={{ fontSize:12 }}>{c.telefono || '—'}</td>
                    <td style={{ fontSize:12 }}>{c.email || '—'}</td>
                    <td>
                      {c.es_mayorista
                        ? <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:6, background:'#e6f7ec', color:'#15803d', textTransform:'uppercase' }}>Mayorista</span>
                        : <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:6, background:'#F3F4F6', color:'#6B7280', textTransform:'uppercase' }}>Cliente</span>}
                    </td>
                    <td>
                      {inactivo
                        ? <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:6, background:'#F3F4F6', color:'#9CA3AF', textTransform:'uppercase' }}>Inactivo</span>
                        : <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:6, background:'#D1FAE5', color:'#059669', textTransform:'uppercase' }}>Activo</span>}
                    </td>
                    <td style={{ textAlign:'right', width:1, whiteSpace:'nowrap' }}>
                      <button className="btn-ghost" style={{ padding:'5px 8px' }} title="Ver cuenta corriente" onClick={() => onVerCtaCte && onVerCtaCte(c.id)}>
                        <Icon n="dollar" s={12}/>
                      </button>
                      {canEdit && (
                        <button className="btn-ghost" style={{ padding:'5px 8px', marginLeft:4 }} title="Editar" onClick={() => setModal({ mode:'edit', initial:c })}>
                          <Icon n="edit" s={12}/>
                        </button>
                      )}
                      {canEdit && !inactivo && (
                        <button className="btn-ghost" style={{ padding:'5px 8px', marginLeft:4, color:'#DC2626', borderColor:'#FCA5A5', background:'#FEF2F2' }} title="Desactivar" onClick={() => setDelTarget(c)}>
                          <Icon n="trash" s={12}/>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign:'center', padding:'24px', color:MAY_UI.inkMuted }}>Sin resultados</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {modal && window.CustomerModal && (
        <window.CustomerModal mode={modal.mode} initial={modal.initial}
          onClose={() => setModal(null)} onSuccess={async () => { setModal(null); await reload(); }}/>
      )}
      {delTarget && window.ConfirmModal && (
        <window.ConfirmModal open={true} title="Desactivar cliente"
          message={`¿Desactivar a "${delTarget.nombre}"? Podés reactivarlo después con "Mostrar inactivos".`}
          confirmText="Desactivar" danger
          onClose={() => { if (!deleting) setDelTarget(null); }} onConfirm={doDelete}/>
      )}
    </div>
  );
}

/* ══ TAB 2 — Cuentas corrientes (Clientes B2B) ══ */
const CTA_TIPO_BADGE = {
  cargo:      { bg:'#FEE2E2', fg:'#DC2626' },
  pago:       { bg:'#D1FAE5', fg:'#059669' },
  devolucion: { bg:'#EFF6FF', fg:'#2563EB' },
  ajuste:     { bg:'#F3F4F6', fg:'#6B7280' },
};
function CtaTipoBadge({ tipo }) {
  const c = CTA_TIPO_BADGE[tipo] || { bg:'#F3F4F6', fg:'#6B7280' };
  return <span style={{ fontSize:9, fontWeight:700, padding:'2px 8px', borderRadius:999, background:c.bg, color:c.fg, textTransform:'uppercase', letterSpacing:'.04em' }}>{tipo}</span>;
}

function CtaCteClientesTab({ focusClienteId, onClearFocus }) {
  const toast = useToast();
  const role = (window.MOCK?.user?.role || '').toLowerCase();
  const canEdit = ['owner', 'admin'].includes(role);

  const [accounts, setAccounts] = useState([]);
  const [locMap, setLocMap]     = useState({});  // cliente_b2b_id → "localidad, prov"
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [search, setSearch]     = useState('');
  const [expanded, setExpanded] = useState(null);  // credit id
  const [movs, setMovs]         = useState({});     // creditId → movimientos[]
  const [movLoading, setMovLoading] = useState(null);
  const [movModal, setMovModal] = useState(null);   // {accountId, mode, initial?}
  const [hoverId, setHoverId]   = useState(null);

  const reload = async () => {
    setLoading(true); setError(null);
    try {
      const [accs, clientes] = await Promise.all([
        window.ADMIN_DATA.loadCustomersWithCredit(),
        window.ADMIN_DATA.loadCustomersB2B({ includeInactive: true }),
      ]);
      setAccounts(accs || []);
      const lm = {};
      for (const cl of (clientes || [])) lm[cl.id] = [cl.localidad, cl.provincia].filter(Boolean).join(', ');
      setLocMap(lm);
    } catch (err) { const m = err?.message || 'Error'; setError(m); toast.error(m); }
    finally { setLoading(false); }
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  // Si llegamos con un cliente enfocado (desde "Ver cta cte"), expandir su cuenta.
  useEffect(() => {
    if (!focusClienteId || !accounts.length) return;
    const acc = accounts.find(a => a.customers_b2b && a.customers_b2b.id === focusClienteId);
    if (acc) { setExpanded(acc.id); loadMovs(acc.id); }
    onClearFocus && onClearFocus();
    /* eslint-disable-next-line */
  }, [focusClienteId, accounts]);

  const loadMovs = async (creditId) => {
    setMovLoading(creditId);
    try {
      const data = await window.ADMIN_DATA.loadCustomerMovements(creditId);
      setMovs(m => ({ ...m, [creditId]: data }));
    }
    catch (err) { toast.error(err?.message || 'No se pudieron cargar movimientos'); }
    finally { setMovLoading(null); }
  };
  const toggleExpand = (creditId) => {
    if (expanded === creditId) { setExpanded(null); return; }
    setExpanded(creditId);
    if (!movs[creditId]) loadMovs(creditId);
  };

  const accNombre = (a) => (a.customers_b2b && a.customers_b2b.nombre) || '—';
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(a => accNombre(a).toLowerCase().includes(q));
  }, [accounts, search]);

  const kCuentas = accounts.length;
  const kFavor = accounts.reduce((s, a) => s + (Number(a.saldo) > 0 ? Number(a.saldo) : 0), 0);
  const kContra = accounts.reduce((s, a) => s + (Number(a.saldo) < 0 ? -Number(a.saldo) : 0), 0);

  const delMov = async (mov) => {
    try {
      await window.ADMIN_DATA.deleteCustomerMovement({ movement_id: mov.id });
      toast.success('Movimiento eliminado');
      await loadMovs(expanded); await reload();
    } catch (err) { toast.error(err?.message || 'No se pudo eliminar'); }
  };

  return (
    <div style={{ background:MAY_UI.pageBg, borderRadius:MAY_UI.radius, padding:16 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, marginBottom:14, flexWrap:'wrap' }}>
        <div style={{ fontSize:16, fontWeight:700, color:MAY_UI.ink }}>Cuentas corrientes — Clientes B2B</div>
      </div>

      <div style={{ display:'flex', gap:12, marginBottom:14, flexWrap:'wrap' }}>
        <VenKpi label="Cuentas" value={kCuentas}/>
        <VenKpi label="Nos deben (a favor)" value={mayMoney(kFavor)} accent="#15803d"/>
        <VenKpi label="Saldo a favor del cliente" value={mayMoney(kContra)} accent="#DC2626"/>
      </div>

      <div style={{ position:'relative', maxWidth:360, marginBottom:14 }}>
        <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', display:'flex' }}><Icon n="search" s={14} c={MAY_UI.inkFaint}/></span>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar cliente…"
               style={{ width:'100%', padding:'9px 12px 9px 34px', borderRadius:10, border:`1px solid ${MAY_UI.border}`, background:'#fff', fontSize:13, outline:'none' }}/>
      </div>

      {loading ? (
        <div style={{ display:'flex', justifyContent:'center', padding:'48px 0' }}><span className="loader" style={{ width:26, height:26 }}/></div>
      ) : error ? (
        <div style={venEmptyBox()}><Icon n="alert" s={28} c="var(--red)"/><div style={{ fontWeight:700, marginTop:8 }}>{error}</div><button className="btn-ghost" style={{ marginTop:12 }} onClick={reload}>Reintentar</button></div>
      ) : accounts.length === 0 ? (
        <div style={venEmptyBox()}>
          <Icon n="dollar" s={32} c={MAY_UI.inkFaint}/>
          <div style={{ fontWeight:700, marginTop:10 }}>Sin cuentas corrientes</div>
          <div style={{ fontSize:13, color:MAY_UI.inkMuted, marginTop:4 }}>Las cuentas se crean automáticamente al dar de alta un cliente B2B.</div>
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {filtered.map(a => {
            const open = expanded === a.id;
            const saldo = Number(a.saldo) || 0;
            const loc = (a.customers_b2b && locMap[a.customers_b2b.id]) || '';
            const list = movs[a.id] || [];
            const hovered = hoverId === a.id;
            return (
              <div key={a.id}
                onMouseEnter={() => setHoverId(a.id)} onMouseLeave={() => setHoverId(null)}
                style={{ background:MAY_UI.cardBg, border:`1px solid ${MAY_UI.border}`, borderRadius:MAY_UI.radius, padding:16, boxShadow: hovered && !open ? MAY_UI.shadowHover : 'none', transition:MAY_UI.trans }}>
                <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight:700, fontSize:15, color:MAY_UI.ink }}>{accNombre(a)}</div>
                    <div style={{ fontSize:12, color:MAY_UI.inkMuted, marginTop:2 }}>{loc || (a.customers_b2b && a.customers_b2b.cuit) || '—'}{a.updated_at ? ` · actualizado ${venFecha(a.updated_at)}` : ''}</div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:10, fontWeight:700, letterSpacing:'.06em', textTransform:'uppercase', color:MAY_UI.inkFaint }}>Saldo</div>
                    <div style={{ fontFamily:'var(--mono)', fontWeight:800, fontSize:18, color: saldo > 0 ? '#15803d' : saldo < 0 ? '#DC2626' : MAY_UI.ink }}>{mayMoney(saldo)}</div>
                  </div>
                  <div style={{ display:'flex', gap:8 }}>
                    <button className="btn-ghost" onClick={() => toggleExpand(a.id)}>
                      {open ? 'Ocultar' : 'Ver movimientos'} <Icon n={open ? 'chev-down' : 'chev-right'} s={12}/>
                    </button>
                    {canEdit && (
                      <button className="btn-primary" onClick={() => setMovModal({ accountId:a.id, mode:'create' })}>
                        <Icon n="plus" s={12}/> Movimiento
                      </button>
                    )}
                  </div>
                </div>

                {open && (
                  <div style={{ marginTop:14, paddingTop:14, borderTop:`1px solid ${MAY_UI.borderSoft}` }}>
                    {movLoading === a.id ? (
                      <div style={{ display:'flex', justifyContent:'center', padding:'16px 0' }}><span className="loader" style={{ width:18, height:18 }}/></div>
                    ) : list.length === 0 ? (
                      <div style={{ textAlign:'center', padding:'16px', color:MAY_UI.inkMuted, fontSize:12 }}>Sin movimientos.</div>
                    ) : (
                      <table className="data-table">
                        <thead><tr><th>Fecha</th><th>Tipo</th><th>Concepto</th><th style={{ textAlign:'right' }}>Monto</th><th>Referencia</th><th></th></tr></thead>
                        <tbody>
                          {list.map(mv => (
                            <tr key={mv.id}>
                              <td style={{ fontSize:12 }}>{venFecha(mv.fecha)}</td>
                              <td><CtaTipoBadge tipo={mv.tipo}/></td>
                              <td style={{ fontSize:12 }}>{mv.concepto || '—'}</td>
                              <td style={{ textAlign:'right', fontWeight:600 }}>{mayMoney(mv.monto)}</td>
                              <td style={{ fontSize:11, color:MAY_UI.inkMuted }}>{mv.referencia_externa || '—'}</td>
                              <td style={{ textAlign:'right', width:1, whiteSpace:'nowrap' }}>
                                {canEdit && (
                                  <>
                                    <button className="btn-ghost" style={{ padding:'4px 7px' }} title="Editar" onClick={() => setMovModal({ accountId:a.id, mode:'edit', initial:mv })}><Icon n="edit" s={11}/></button>
                                    <button className="btn-ghost" style={{ padding:'4px 7px', marginLeft:3, color:'#DC2626' }} title="Eliminar" onClick={() => delMov(mv)}><Icon n="trash" s={11}/></button>
                                  </>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && <div style={{ textAlign:'center', padding:'24px', color:MAY_UI.inkMuted }}>Sin resultados</div>}
        </div>
      )}

      {movModal && window.CtaCteMovementModal && (
        <window.CtaCteMovementModal
          entityType="customer" mode={movModal.mode} accountId={movModal.accountId} initial={movModal.initial}
          onClose={() => setMovModal(null)}
          onSuccess={async () => { setMovModal(null); await loadMovs(movModal.accountId); await reload(); }}/>
      )}
    </div>
  );
}

/* ══ TAB 3 — Base de productos (catálogo de SKUs) ══ */
function BaseProductosTab() {
  const toast = useToast();
  const role = (window.MOCK?.user?.role || '').toLowerCase();
  const canEdit = ['owner', 'admin'].includes(role);

  const [rows, setRows]       = useState([]);   // filas frescas de sku_catalog (incluye incompleto + oficiales)
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [search, setSearch]   = useState('');
  const [cat, setCat]         = useState('');
  const [soloAct, setSoloAct] = useState(true);
  const [showInc, setShowInc] = useState(false);
  const [verInternos, setVerInternos] = useState(false);  // Punto 3 — insumos internos separados del catálogo de venta
  const [vista, setVista]     = useState('tabla');  // 'tabla' | 'galeria'
  const [skuModal, setSkuModal] = useState(null);    // {sku, isNew, incompleto}
  const [tglTarget, setTglTarget] = useState(null);  // fila a togglear activo

  const cats = (window.MOCK && window.MOCK.categories) || [];

  const reload = async () => {
    setLoading(true); setError(null);
    try {
      const { data, error: e } = await window.SUPA.from('sku_catalog').select('*').order('sku', { ascending: true });
      if (e) throw new Error(e.message);
      setRows(data || []);
    } catch (err) { const m = err?.message || 'Error'; setError(m); toast.error(m); }
    finally { setLoading(false); }
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      // Punto 3 — separación venta/producción: por defecto ocultar insumos internos;
      // "Ver insumos internos" los muestra en exclusiva (transparencia, no se desactivan).
      if (verInternos) { if (!r.es_insumo_interno) return false; }
      else { if (r.es_insumo_interno) return false; }
      if (cat && r.categoria !== cat) return false;
      if (soloAct && r.activo === false) return false;
      if (showInc && !r.incompleto) return false;
      if (!q) return true;
      return [r.sku, r.modelo, r.color, r.categoria].some(v => (v || '').toLowerCase().includes(q));
    });
  }, [rows, search, cat, soloAct, showInc, verInternos]);
  const kInternos = rows.filter(r => r.es_insumo_interno).length;

  const activos = rows.filter(r => r.activo !== false);
  const kActivos = activos.length;
  const kInc = rows.filter(r => r.incompleto).length;
  const kFab = activos.filter(r => r.es_fabricado).length;
  const kComp = activos.length - kFab;
  const porCat = useMemo(() => {
    const m = {};
    for (const r of activos) m[r.categoria || '—'] = (m[r.categoria || '—'] || 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const onSaveSku = async (sku, data, isNew) => {
    if (isNew && rows.some(r => r.sku === sku)) { toast.error(`SKU ${sku} ya existe`); return false; }
    try {
      await window.MOCK_ACTIONS.crearOActualizarSku(sku, {
        modelo: data.modelo, color: data.color === '—' ? null : data.color,
        color_hex: data.colorHex || null, categoria: data.categoria,
        es_fabricado: data.es_fabricado, activo: data.activo, incompleto: data.incompleto || false,
      }, isNew);
      toast.success(`SKU ${sku} ${isNew ? 'creado' : 'actualizado'}`);
      setSkuModal(null); await reload();
      return true;
    } catch (err) { toast.error(err?.message || 'No se pudo guardar'); return false; }
  };

  const doToggle = async () => {
    const r = tglTarget; if (!r) return;
    try {
      // Usar los valores OFICIALES de la fila fresca (no los de display) para
      // no corromper modelo/color al hacer el upsert completo.
      await window.MOCK_ACTIONS.crearOActualizarSku(r.sku, {
        modelo: r.modelo, color: r.color, color_hex: r.color_hex, categoria: r.categoria,
        es_fabricado: r.es_fabricado, activo: !r.activo, incompleto: r.incompleto || false,
      }, false);
      toast.success(r.activo ? 'SKU desactivado' : 'SKU activado');
      setTglTarget(null); await reload();
    } catch (err) { toast.error(err?.message || 'No se pudo actualizar'); }
  };

  const colorChip = (hex) => (
    <span style={{ display:'inline-block', width:14, height:14, borderRadius:4, border:'1px solid #d4cdc1', background: hex || '#fff', verticalAlign:'middle' }}/>
  );

  return (
    <div style={{ background:MAY_UI.pageBg, borderRadius:MAY_UI.radius, padding:16 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, marginBottom:14, flexWrap:'wrap' }}>
        <div style={{ fontSize:16, fontWeight:700, color:MAY_UI.ink }}>Base de productos</div>
        <div style={{ display:'flex', gap:8 }}>
          <div style={{ display:'inline-flex', border:`1px solid ${MAY_UI.border}`, borderRadius:8, overflow:'hidden' }}>
            <button onClick={() => setVista('tabla')} style={{ padding:'7px 12px', fontSize:12, fontWeight:600, border:'none', cursor:'pointer', background: vista==='tabla' ? MAY_UI.ink : '#fff', color: vista==='tabla' ? '#fff' : MAY_UI.inkSoft }}>Tabla</button>
            <button onClick={() => setVista('galeria')} style={{ padding:'7px 12px', fontSize:12, fontWeight:600, border:'none', cursor:'pointer', background: vista==='galeria' ? MAY_UI.ink : '#fff', color: vista==='galeria' ? '#fff' : MAY_UI.inkSoft }}>Galería</button>
          </div>
          {canEdit && <button className="btn-primary" onClick={() => setSkuModal({ sku:'', isNew:true })}><Icon n="plus" s={13}/> Nuevo SKU</button>}
        </div>
      </div>

      <div style={{ display:'flex', gap:12, marginBottom:14, flexWrap:'wrap' }}>
        <VenKpi label="SKUs activos" value={kActivos}/>
        <VenKpi label="Incompletos" value={kInc} accent={kInc > 0 ? '#B45309' : MAY_UI.ink} hint={kInc > 0 ? 'requieren completar' : 'todo OK'}/>
        <VenKpi label="Fabricados" value={kFab} accent="#15803d"/>
        <VenKpi label="Comprados" value={kComp} accent="#4F46E5"/>
      </div>

      {porCat.length > 0 && (
        <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:14 }}>
          {porCat.map(([c, n]) => (
            <span key={c} style={{ fontSize:11, fontWeight:600, padding:'4px 10px', borderRadius:999, background:MAY_UI.cardBg, border:`1px solid ${MAY_UI.border}`, color:MAY_UI.inkSoft }}>
              {c} <strong style={{ color:MAY_UI.ink }}>{n}</strong>
            </span>
          ))}
        </div>
      )}

      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:14 }}>
        <div style={{ position:'relative', flex:'1 1 220px', maxWidth:340 }}>
          <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', display:'flex' }}><Icon n="search" s={14} c={MAY_UI.inkFaint}/></span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar SKU, modelo, color, categoría…"
                 style={{ width:'100%', padding:'9px 12px 9px 34px', borderRadius:10, border:`1px solid ${MAY_UI.border}`, background:'#fff', fontSize:13, outline:'none' }}/>
        </div>
        <select className="field-input" style={{ width:160, padding:'8px 10px' }} value={cat} onChange={e => setCat(e.target.value)}>
          <option value="">Todas las categorías</option>
          {cats.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:MAY_UI.inkSoft, fontWeight:600 }}>
          <input type="checkbox" checked={soloAct} onChange={e => setSoloAct(e.target.checked)}/> Solo activos
        </label>
        <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:MAY_UI.inkSoft, fontWeight:600 }}>
          <input type="checkbox" checked={showInc} onChange={e => setShowInc(e.target.checked)}/> Mostrar incompletos
        </label>
        <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:MAY_UI.inkSoft, fontWeight:600 }}
               title="Insumos y piezas internas de producción, separados del catálogo de venta">
          <input type="checkbox" checked={verInternos} onChange={e => setVerInternos(e.target.checked)}/> Ver insumos internos {kInternos > 0 && <span style={{ fontWeight:700, color:MAY_UI.inkFaint }}>({kInternos})</span>}
        </label>
      </div>

      {verInternos && (
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12, padding:'9px 12px', borderRadius:10,
                      background:'#FEF3C7', border:'1px solid #FDE68A', color:'#92400E', fontSize:12, fontWeight:600 }}>
          <Icon n="alert" s={15} c="#92400E"/>
          Insumos internos de producción — NO son productos vendibles. Se muestran solo para consulta; permanecen activos para la Línea Productiva.
        </div>
      )}

      {loading ? (
        <div style={{ display:'flex', justifyContent:'center', padding:'48px 0' }}><span className="loader" style={{ width:26, height:26 }}/></div>
      ) : error ? (
        <div style={venEmptyBox()}><Icon n="alert" s={28} c="var(--red)"/><div style={{ fontWeight:700, marginTop:8 }}>{error}</div><button className="btn-ghost" style={{ marginTop:12 }} onClick={reload}>Reintentar</button></div>
      ) : filtered.length === 0 ? (
        <div style={venEmptyBox()}><Icon n="tag" s={32} c={MAY_UI.inkFaint}/><div style={{ fontWeight:700, marginTop:10 }}>Sin productos</div></div>
      ) : vista === 'tabla' ? (
        <div style={{ background:MAY_UI.cardBg, border:`1px solid ${MAY_UI.border}`, borderRadius:MAY_UI.radius, overflow:'hidden' }}>
          <table className="data-table">
            <thead><tr><th>SKU</th><th>Modelo</th><th>Color</th><th>Categoría</th><th>Fabricado</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.sku} style={r.activo === false ? { opacity:.55 } : undefined}>
                  <td><span className="order-num">{r.sku}</span>{r.incompleto && <span style={{ marginLeft:6, fontSize:8, fontWeight:700, padding:'1px 5px', borderRadius:5, background:'#FEF3C7', color:'#B45309', textTransform:'uppercase' }}>Inc</span>}</td>
                  <td style={{ fontWeight:600 }}>{r.modelo || '—'}</td>
                  <td>{r.color && r.color !== '—' ? <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>{colorChip(r.color_hex)} {r.color}</span> : '—'}</td>
                  <td style={{ fontSize:12, color:MAY_UI.inkSoft }}>{r.categoria || '—'}</td>
                  <td style={{ fontSize:12 }}>{r.es_fabricado ? 'Sí' : 'No'}</td>
                  <td>{r.activo === false
                    ? <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:6, background:'#F3F4F6', color:'#9CA3AF', textTransform:'uppercase' }}>Inactivo</span>
                    : <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:6, background:'#D1FAE5', color:'#059669', textTransform:'uppercase' }}>Activo</span>}</td>
                  <td style={{ textAlign:'right', width:1, whiteSpace:'nowrap' }}>
                    {canEdit && <button className="btn-ghost" style={{ padding:'5px 8px' }} title="Editar" onClick={() => setSkuModal({ sku:r.sku, isNew:false, incompleto:r.incompleto })}><Icon n="edit" s={12}/></button>}
                    {canEdit && <button className="btn-ghost" style={{ padding:'5px 8px', marginLeft:4 }} title={r.activo === false ? 'Activar' : 'Desactivar'} onClick={() => setTglTarget(r)}><Icon n={r.activo === false ? 'check' : 'trash'} s={12}/></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(180px, 1fr))', gap:12 }}>
          {filtered.map(r => (
            <button key={r.sku} className="card" onClick={() => canEdit && setSkuModal({ sku:r.sku, isNew:false, incompleto:r.incompleto })}
              style={{ textAlign:'left', cursor: canEdit ? 'pointer' : 'default', background:MAY_UI.cardBg, border:`1px solid ${MAY_UI.border}`, borderRadius:MAY_UI.radius, padding:14, opacity: r.activo === false ? .6 : 1 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                {colorChip(r.color_hex)}
                <span className="order-num" style={{ fontWeight:700 }}>{r.sku}</span>
              </div>
              <div style={{ fontSize:13, fontWeight:600, color:MAY_UI.ink }}>{r.modelo || r.sku}</div>
              <div style={{ fontSize:11, color:MAY_UI.inkMuted, marginTop:2 }}>{r.categoria || '—'}{r.color && r.color !== '—' ? ` · ${r.color}` : ''}</div>
              <div style={{ display:'flex', gap:5, marginTop:8 }}>
                {r.incompleto && <span style={{ fontSize:8, fontWeight:700, padding:'1px 6px', borderRadius:5, background:'#FEF3C7', color:'#B45309', textTransform:'uppercase' }}>Incompleto</span>}
                {r.activo === false && <span style={{ fontSize:8, fontWeight:700, padding:'1px 6px', borderRadius:5, background:'#F3F4F6', color:'#9CA3AF', textTransform:'uppercase' }}>Inactivo</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      {skuModal && window.ProductoEditModal && (
        <window.ProductoEditModal editing={skuModal} cats={cats.length ? cats : ['Mesas']}
          onClose={() => setSkuModal(null)} onSave={onSaveSku}/>
      )}
      {tglTarget && window.ConfirmModal && (
        <window.ConfirmModal open={true}
          title={tglTarget.activo === false ? 'Activar SKU' : 'Desactivar SKU'}
          message={`¿${tglTarget.activo === false ? 'Activar' : 'Desactivar'} el SKU ${tglTarget.sku} (${tglTarget.modelo || ''})?`}
          confirmText={tglTarget.activo === false ? 'Activar' : 'Desactivar'} danger={tglTarget.activo !== false}
          onClose={() => setTglTarget(null)} onConfirm={doToggle}/>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   S2.26 — Presupuestos B2B (tab Presupuestos)
   Backend: migration 0069 (presupuestos + items, 5 RPCs). Llamadas vía
   window.SUPA.rpc (no toca admin-data.js). Estilo premium MAY_UI.
   ══════════════════════════════════════════════════════════════════ */

const PRES_ESTADOS = {
  borrador:  { label:'Borrador',  bg:'#F3F4F6', fg:'#6B7280' },
  enviado:   { label:'Enviado',   bg:'#EFF6FF', fg:'#2563EB' },
  aceptado:  { label:'Aceptado',  bg:'#D1FAE5', fg:'#059669' },
  rechazado: { label:'Rechazado', bg:'#FEE2E2', fg:'#DC2626' },
  vencido:   { label:'Vencido',   bg:'#FEF3C7', fg:'#B45309' },
};
function PresEstadoBadge({ estado }) {
  const c = PRES_ESTADOS[estado] || { label:estado, bg:'#F3F4F6', fg:'#6B7280' };
  return <span style={{ fontSize:10, fontWeight:700, padding:'3px 10px', borderRadius:999, background:c.bg, color:c.fg, textTransform:'uppercase', letterSpacing:'.04em' }}>{c.label}</span>;
}

async function presRpc(name, payload) {
  const { data, error } = await window.SUPA.rpc(name, { p_payload: payload || {} });
  if (error) throw new Error(error.message);
  return data;
}
function presAddDays(dateStr, n) {
  const [y, m, d] = (dateStr || '').split('-').map(Number);
  if (!y) return '';
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + (Number(n) || 0));
  return dt.toISOString().slice(0, 10);
}

function PresupuestosTab({ onVerPedido }) {
  const toast = useToast();
  const role = (window.MOCK?.user?.role || '').toLowerCase();
  const canEdit = ['owner', 'admin'].includes(role);

  const [view, setView]       = useState('lista');   // 'lista' | 'detalle'
  const [selected, setSelected] = useState(null);
  const [list, setList]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [search, setSearch]   = useState('');
  const [estadoF, setEstadoF] = useState('');
  const [desde, setDesde]     = useState('');
  const [hasta, setHasta]     = useState('');
  const [clientes, setClientes] = useState([]);
  const [company, setCompany]   = useState(null);
  const [modal, setModal]     = useState(null);       // {mode, initial?}
  const [delTarget, setDelTarget] = useState(null);
  const [busy, setBusy]       = useState(false);

  const reload = async () => {
    setLoading(true); setError(null);
    try {
      const payload = {};
      if (estadoF) payload.estado = estadoF;
      if (desde) payload.desde = desde;
      if (hasta) payload.hasta = hasta;
      const data = await presRpc('rpc_presupuestos_list', payload);
      const arr = data || [];
      setList(arr);
      setSelected(prev => prev ? arr.find(p => p.id === prev.id) || null : null);
    } catch (err) { const m = err?.message || 'Error'; setError(m); toast.error(m); }
    finally { setLoading(false); }
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [estadoF, desde, hasta]);
  useEffect(() => {
    window.ADMIN_DATA.loadCustomersB2B({ includeInactive: false }).then(setClientes).catch(() => {});
    if (window.ADMIN_DATA.getCompanySettings) window.ADMIN_DATA.getCompanySettings().then(setCompany).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(p => (p.numero || '').toLowerCase().includes(q) || (p.cliente_nombre || '').toLowerCase().includes(q));
  }, [list, search]);

  const now = new Date();
  const kTotal = list.length;
  const kPend = list.filter(p => p.estado === 'borrador' || p.estado === 'enviado').length;
  const kAcMes = list.filter(p => p.estado === 'aceptado' && p.fecha_emision && new Date(p.fecha_emision + 'T00:00').getMonth() === now.getMonth() && new Date(p.fecha_emision + 'T00:00').getFullYear() === now.getFullYear()).length;
  const kMonto = list.filter(p => p.estado === 'aceptado').reduce((s, p) => s + (Number(p.total) || 0), 0);

  const cambiarEstado = async (pres, estado) => {
    if (!estado || busy) return;
    if (estado === 'aceptado' && !window.confirm(`Aceptar ${pres.numero} generará un pedido mayorista. ¿Confirmás?`)) return;
    setBusy(true);
    try {
      const res = await presRpc('rpc_presupuestos_update_estado', { id: pres.id, estado });
      toast.success(estado === 'aceptado' ? `Aceptado · pedido ${res?.pedido_numero || ''} generado` : 'Estado actualizado');
      await reload();
    } catch (err) {
      if (err && /periodo_cerrado/i.test(err.message || '')) toast.error('No se puede: período contable cerrado.');
      else toast.error(err?.message || 'No se pudo cambiar el estado');
    } finally { setBusy(false); }
  };

  const doDelete = async () => {
    if (!delTarget || busy) return;
    setBusy(true);
    try { await presRpc('rpc_presupuestos_soft_delete', { id: delTarget.id }); toast.success('Presupuesto eliminado'); setDelTarget(null); await reload(); }
    catch (err) { toast.error(err?.message || 'No se pudo eliminar'); }
    finally { setBusy(false); }
  };

  /* ── VISTA DETALLE ── */
  if (view === 'detalle' && selected) {
    const p = selected;
    return (
      <div style={{ background:MAY_UI.pageBg, borderRadius:MAY_UI.radius, padding:16 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, marginBottom:14, flexWrap:'wrap' }}>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <button className="btn-ghost" onClick={() => { setView('lista'); }}>← Volver</button>
            <span style={{ fontFamily:'var(--mono)', fontWeight:800, fontSize:18, color:MAY_UI.ink }}>{p.numero}</span>
            <PresEstadoBadge estado={p.estado}/>
          </div>
          <button className="btn-ghost" onClick={() => presupuestoPDF(p, company)}><Icon n="download" s={13}/> Descargar PDF</button>
        </div>

        <div style={{ background:MAY_UI.cardBg, border:`1px solid ${MAY_UI.border}`, borderRadius:MAY_UI.radius, padding:20, marginBottom:14 }}>
          <div style={{ display:'flex', gap:24, flexWrap:'wrap' }}>
            <div>
              <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.08em', color:MAY_UI.inkFaint }}>Cliente</div>
              <div style={{ fontWeight:700, fontSize:15, marginTop:2 }}>{p.cliente_nombre}</div>
              <div style={{ fontSize:12, color:MAY_UI.inkMuted }}>{[p.cliente_cuit, p.cliente_localidad, p.cliente_provincia].filter(Boolean).join(' · ') || '—'}</div>
            </div>
            <div>
              <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.08em', color:MAY_UI.inkFaint }}>Emisión</div>
              <div style={{ fontSize:13, marginTop:2 }}>{venFecha(p.fecha_emision)}</div>
            </div>
            <div>
              <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.08em', color:MAY_UI.inkFaint }}>Validez</div>
              <div style={{ fontSize:13, marginTop:2 }}>{venFecha(p.fecha_validez)}</div>
            </div>
          </div>
        </div>

        <div style={{ background:MAY_UI.cardBg, border:`1px solid ${MAY_UI.border}`, borderRadius:MAY_UI.radius, overflow:'hidden' }}>
          <table className="data-table">
            <thead><tr><th>SKU</th><th>Producto</th><th style={{ textAlign:'right' }}>Cant.</th><th style={{ textAlign:'right' }}>Precio</th><th style={{ textAlign:'right' }}>Dto%</th><th style={{ textAlign:'right' }}>Subtotal</th></tr></thead>
            <tbody>
              {(p.items || []).map((it, i) => (
                <tr key={it.id || i}>
                  <td><span className="order-num">{it.sku}</span></td>
                  <td>{it.modelo || it.sku}{it.color && it.color !== '—' ? ` · ${it.color}` : ''}</td>
                  <td style={{ textAlign:'right' }}>{it.cantidad}</td>
                  <td style={{ textAlign:'right' }}>{mayMoney(it.precio_unitario)}</td>
                  <td style={{ textAlign:'right' }}>{Number(it.descuento_pct) || 0}%</td>
                  <td style={{ textAlign:'right', fontWeight:600 }}>{mayMoney(it.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding:'12px 16px', borderTop:`1px solid ${MAY_UI.borderSoft}`, display:'flex', flexDirection:'column', alignItems:'flex-end', gap:3 }}>
            <div style={{ fontSize:12, color:MAY_UI.inkMuted }}>Subtotal: <strong>{mayMoney(p.subtotal_items)}</strong></div>
            <div style={{ fontSize:12, color:MAY_UI.inkMuted }}>Descuento global: <strong>{Number(p.descuento_global) || 0}%</strong></div>
            <div style={{ fontSize:18, fontWeight:800, fontFamily:'var(--mono)', color:MAY_UI.ink }}>TOTAL {mayMoney(p.total)}</div>
          </div>
        </div>

        {(p.condicion_pago || p.notas) && (
          <div style={{ fontSize:12, color:MAY_UI.inkSoft, marginTop:12 }}>
            {p.condicion_pago && <div><strong>Condición de pago:</strong> {p.condicion_pago}</div>}
            {p.notas && <div><strong>Notas:</strong> {p.notas}</div>}
          </div>
        )}

        {canEdit && (
          <div style={{ display:'flex', gap:8, marginTop:16, flexWrap:'wrap' }}>
            {p.estado === 'borrador' && <>
              <button className="btn-primary" onClick={() => cambiarEstado(p, 'enviado')} disabled={busy}>Marcar como enviado</button>
              <button className="btn-ghost" onClick={() => setModal({ mode:'edit', initial:p })}><Icon n="edit" s={13}/> Editar</button>
              <button className="btn-ghost" style={{ color:'#DC2626', borderColor:'#FCA5A5' }} onClick={() => setDelTarget(p)}><Icon n="trash" s={13}/> Eliminar</button>
            </>}
            {p.estado === 'enviado' && <>
              <button className="btn-primary" onClick={() => cambiarEstado(p, 'aceptado')} disabled={busy}>Marcar como aceptado</button>
              <button className="btn-ghost" style={{ color:'#DC2626', borderColor:'#FCA5A5' }} onClick={() => cambiarEstado(p, 'rechazado')} disabled={busy}>Marcar como rechazado</button>
            </>}
            {p.estado === 'aceptado' && p.cliente_id && (
              <button className="btn-primary" onClick={() => onVerPedido && onVerPedido(p.cliente_id)}>
                Ver pedido generado{p.pedido_numero ? ` (${p.pedido_numero})` : ''}
              </button>
            )}
          </div>
        )}

        {modal && <PresupuestoModal mode={modal.mode} initial={modal.initial} clientes={clientes}
          onClose={() => setModal(null)} onSaved={async () => { setModal(null); await reload(); }}/>}
        {delTarget && window.ConfirmModal && (
          <window.ConfirmModal open={true} title="Eliminar presupuesto"
            message={`¿Eliminar ${delTarget.numero}? Esta acción no se puede deshacer.`}
            confirmText="Eliminar" danger onClose={() => { if (!busy) setDelTarget(null); }} onConfirm={doDelete}/>
        )}
      </div>
    );
  }

  /* ── VISTA LISTA ── */
  return (
    <div style={{ background:MAY_UI.pageBg, borderRadius:MAY_UI.radius, padding:16 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, marginBottom:14, flexWrap:'wrap' }}>
        <div style={{ fontSize:16, fontWeight:700, color:MAY_UI.ink }}>Presupuestos</div>
        {canEdit && <button className="btn-primary" onClick={() => setModal({ mode:'create' })}><Icon n="plus" s={13}/> Nuevo presupuesto</button>}
      </div>

      <div style={{ display:'flex', gap:12, marginBottom:14, flexWrap:'wrap' }}>
        <VenKpi label="Total" value={kTotal}/>
        <VenKpi label="Pendientes de respuesta" value={kPend} accent="#2563EB"/>
        <VenKpi label="Aceptados este mes" value={kAcMes} accent="#15803d"/>
        <VenKpi label="Monto aceptado" value={mayMoney(kMonto)} accent="#15803d"/>
      </div>

      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:14 }}>
        <div style={{ position:'relative', flex:'1 1 220px', maxWidth:320 }}>
          <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', display:'flex' }}><Icon n="search" s={14} c={MAY_UI.inkFaint}/></span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar cliente o número…"
                 style={{ width:'100%', padding:'9px 12px 9px 34px', borderRadius:10, border:`1px solid ${MAY_UI.border}`, background:'#fff', fontSize:13, outline:'none' }}/>
        </div>
        <select className="field-input" style={{ width:150, padding:'8px 10px' }} value={estadoF} onChange={e => setEstadoF(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.keys(PRES_ESTADOS).map(e => <option key={e} value={e}>{PRES_ESTADOS[e].label}</option>)}
        </select>
        <input type="date" className="field-input" style={{ padding:'8px 10px' }} value={desde} onChange={e => setDesde(e.target.value)} title="Desde"/>
        <input type="date" className="field-input" style={{ padding:'8px 10px' }} value={hasta} onChange={e => setHasta(e.target.value)} title="Hasta"/>
      </div>

      {loading ? (
        <div style={{ display:'flex', justifyContent:'center', padding:'48px 0' }}><span className="loader" style={{ width:26, height:26 }}/></div>
      ) : error ? (
        <div style={venEmptyBox()}><Icon n="alert" s={28} c="var(--red)"/><div style={{ fontWeight:700, marginTop:8 }}>{error}</div><button className="btn-ghost" style={{ marginTop:12 }} onClick={reload}>Reintentar</button></div>
      ) : list.length === 0 ? (
        <div style={venEmptyBox()}>
          <Icon n="tag" s={32} c={MAY_UI.inkFaint}/>
          <div style={{ fontWeight:700, fontSize:15, marginTop:10 }}>Sin presupuestos</div>
          {canEdit && <button className="btn-primary" style={{ marginTop:16 }} onClick={() => setModal({ mode:'create' })}><Icon n="plus" s={13}/> Nuevo presupuesto</button>}
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {filtered.map(p => (
            <div key={p.id} style={{ background:MAY_UI.cardBg, border:`1px solid ${MAY_UI.border}`, borderRadius:MAY_UI.radius, padding:16 }}>
              <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                <span style={{ fontFamily:'var(--mono)', fontWeight:700, fontSize:14 }}>{p.numero}</span>
                <PresEstadoBadge estado={p.estado}/>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:600, fontSize:14 }}>{p.cliente_nombre}</div>
                  <div style={{ fontSize:11, color:MAY_UI.inkMuted }}>Emisión {venFecha(p.fecha_emision)} · Validez {venFecha(p.fecha_validez)}</div>
                </div>
                <div style={{ textAlign:'right' }}>
                  <div style={{ fontFamily:'var(--mono)', fontWeight:800, fontSize:18, color:MAY_UI.ink }}>{mayMoney(p.total)}</div>
                  <div style={{ fontSize:10, color:MAY_UI.inkFaint }}>{(p.items || []).length} ítem{(p.items||[]).length===1?'':'s'}</div>
                </div>
              </div>
              <div style={{ display:'flex', gap:8, marginTop:12, flexWrap:'wrap', alignItems:'center' }}>
                <button className="btn-primary" onClick={() => { setSelected(p); setView('detalle'); }}>Ver detalle</button>
                {canEdit && (p.estado === 'borrador' || p.estado === 'enviado') && (
                  <select className="field-input" style={{ maxWidth:170, padding:'7px 10px' }} value="" disabled={busy}
                          onChange={e => { if (e.target.value) cambiarEstado(p, e.target.value); }}>
                    <option value="">Cambiar estado…</option>
                    {p.estado === 'borrador' && <option value="enviado">Enviado</option>}
                    {p.estado === 'enviado' && <option value="aceptado">Aceptado (genera pedido)</option>}
                    {p.estado === 'enviado' && <option value="rechazado">Rechazado</option>}
                  </select>
                )}
                {canEdit && p.estado === 'borrador' && (
                  <button className="btn-ghost" style={{ color:'#DC2626', borderColor:'#FCA5A5' }} onClick={() => setDelTarget(p)}><Icon n="trash" s={12}/> Eliminar</button>
                )}
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div style={{ textAlign:'center', padding:'24px', color:MAY_UI.inkMuted }}>Sin resultados</div>}
        </div>
      )}

      {modal && <PresupuestoModal mode={modal.mode} initial={modal.initial} clientes={clientes}
        onClose={() => setModal(null)} onSaved={async () => { setModal(null); await reload(); }}/>}
      {delTarget && window.ConfirmModal && (
        <window.ConfirmModal open={true} title="Eliminar presupuesto"
          message={`¿Eliminar ${delTarget.numero}? Esta acción no se puede deshacer.`}
          confirmText="Eliminar" danger onClose={() => { if (!busy) setDelTarget(null); }} onConfirm={doDelete}/>
      )}
    </div>
  );
}

/* Modal de alta/edición de presupuesto. */
function PresupuestoModal({ mode, initial, clientes, onClose, onSaved }) {
  const toast = useToast();
  const isEdit = mode === 'edit';
  const today = new Date().toISOString().slice(0, 10);

  const [form, setForm] = useState({
    cliente_id:    (initial && initial.cliente_id) || '',
    fecha_emision: (initial && initial.fecha_emision ? String(initial.fecha_emision).slice(0,10) : today),
    dias_validez:  (initial && initial.dias_validez != null) ? String(initial.dias_validez) : '15',
    condicion_pago:(initial && initial.condicion_pago) || '',
    notas:         (initial && initial.notas) || '',
    descuento_global: (initial && initial.descuento_global != null) ? String(initial.descuento_global) : '0',
  });
  const [lineas, setLineas] = useState(
    (initial && initial.items && initial.items.length)
      ? initial.items.map(it => ({ sku:it.sku, cantidad:String(it.cantidad), precio_unitario:String(it.precio_unitario), descuento_pct:String(it.descuento_pct || 0) }))
      : [{ sku:'', cantidad:'', precio_unitario:'', descuento_pct:'0' }]
  );
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(s => ({ ...s, [k]: v }));
  const setLinea = (i, k, v) => setLineas(arr => arr.map((l, idx) => idx === i ? { ...l, [k]: v } : l));
  const addLinea = () => setLineas(arr => [...arr, { sku:'', cantidad:'', precio_unitario:'', descuento_pct:'0' }]);
  const delLinea = (i) => setLineas(arr => arr.length > 1 ? arr.filter((_, idx) => idx !== i) : arr);

  const skuOptions = useMemo(() => {
    const db = window.SKU_DB || {};
    return Object.keys(db).filter(s => db[s] && db[s].activo !== false).sort().map(s => {
      const x = db[s]; const label = x.color && x.color !== '—' ? `${s} — ${x.modelo} ${x.color}` : `${s} — ${x.modelo || ''}`;
      return { sku:s, label };
    });
  }, []);

  const lineSub = (l) => (Number(l.cantidad) || 0) * (Number(l.precio_unitario) || 0) * (1 - (Number(l.descuento_pct) || 0) / 100);
  const subtotal = lineas.reduce((s, l) => s + lineSub(l), 0);
  const total = subtotal * (1 - (Number(form.descuento_global) || 0) / 100);
  const fechaVenc = presAddDays(form.fecha_emision, form.dias_validez);

  const guardar = async (estadoFinal) => {
    if (saving) return;
    if (!form.cliente_id) { toast.error('Elegí un cliente'); return; }
    const items = lineas
      .map(l => ({ sku:(l.sku || '').trim(), cantidad:parseInt(l.cantidad, 10), precio_unitario:Number(l.precio_unitario), descuento_pct:Number(l.descuento_pct) || 0 }))
      .filter(l => l.sku && l.cantidad > 0 && l.precio_unitario >= 0 && Number.isFinite(l.precio_unitario) && l.descuento_pct >= 0 && l.descuento_pct <= 100);
    if (items.length === 0) { toast.error('Agregá al menos un ítem válido'); return; }
    setSaving(true);
    try {
      const payload = {
        cliente_id: form.cliente_id, fecha_emision: form.fecha_emision,
        dias_validez: parseInt(form.dias_validez, 10) || 15,
        condicion_pago: form.condicion_pago.trim(), notas: form.notas.trim(),
        descuento_global: Number(form.descuento_global) || 0, items,
      };
      if (isEdit) {
        payload.id = initial.id;
        await presRpc('rpc_presupuestos_update', payload);
        if (estadoFinal === 'enviado') await presRpc('rpc_presupuestos_update_estado', { id: initial.id, estado: 'enviado' });
        toast.success('Presupuesto actualizado');
      } else {
        payload.estado = estadoFinal;
        const res = await presRpc('rpc_presupuestos_create', payload);
        toast.success(`Presupuesto ${res?.numero || ''} creado`);
      }
      onSaved && onSaved();
    } catch (err) {
      if (err && /periodo_cerrado/i.test(err.message || '')) toast.error('No se puede: período contable cerrado.');
      else toast.error(err?.message || 'No se pudo guardar');
      setSaving(false);
    }
  };

  const Cmp = window.Modal;
  return (
    <Cmp open={true} title={isEdit ? `Editar ${initial.numero}` : 'Nuevo presupuesto'} size="lg" onClose={() => { if (!saving) onClose?.(); }} footer={
      <>
        <button className="btn-ghost" onClick={() => { if (!saving) onClose?.(); }} disabled={saving}>Cancelar</button>
        <button className="btn-ghost" onClick={() => guardar('borrador')} disabled={saving}>Guardar borrador</button>
        <button className="btn-primary" onClick={() => guardar('enviado')} disabled={saving}>{saving ? 'Guardando…' : 'Guardar y enviar'}</button>
      </>
    }>
      <div className="field-group">
        <label className="field-label">Cliente B2B *</label>
        <select className="field-input" value={form.cliente_id} onChange={e => set('cliente_id', e.target.value)}>
          <option value="">— Elegí cliente —</option>
          {(clientes || []).map(c => <option key={c.id} value={c.id}>{c.nombre}{c.cuit ? ` · ${c.cuit}` : ''}</option>)}
        </select>
      </div>

      <div style={{ display:'flex', gap:12 }}>
        <div className="field-group" style={{ flex:1 }}>
          <label className="field-label">Fecha emisión</label>
          <input type="date" className="field-input" value={form.fecha_emision} onChange={e => set('fecha_emision', e.target.value)}/>
        </div>
        <div className="field-group" style={{ flex:1 }}>
          <label className="field-label">Días de validez</label>
          <input type="number" min="0" className="field-input" value={form.dias_validez} onChange={e => set('dias_validez', e.target.value)}/>
          <div className="field-help">Vence: {fechaVenc ? venFecha(fechaVenc) : '—'}</div>
        </div>
      </div>

      <div className="field-group">
        <label className="field-label">Condición de pago</label>
        <input className="field-input" value={form.condicion_pago} placeholder="Ej: 30 días, contado…" onChange={e => set('condicion_pago', e.target.value)}/>
      </div>

      <div className="field-group">
        <label className="field-label">Ítems</label>
        <table className="data-table">
          <thead><tr><th style={{ width:'38%' }}>SKU</th><th style={{ width:'13%', textAlign:'right' }}>Cant.</th><th style={{ width:'20%', textAlign:'right' }}>Precio</th><th style={{ width:'12%', textAlign:'right' }}>Dto%</th><th style={{ textAlign:'right' }}>Subtotal</th><th></th></tr></thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={i}>
                <td>
                  <select className="field-input" style={{ padding:'6px 8px' }} value={l.sku} onChange={e => setLinea(i, 'sku', e.target.value)}>
                    <option value="">— SKU —</option>
                    {skuOptions.map(o => <option key={o.sku} value={o.sku}>{o.label}</option>)}
                  </select>
                </td>
                <td><input className="field-input" style={{ padding:'6px 8px', textAlign:'right' }} type="number" min="1" value={l.cantidad} onChange={e => setLinea(i, 'cantidad', e.target.value)}/></td>
                <td><input className="field-input" style={{ padding:'6px 8px', textAlign:'right' }} type="number" min="0" step="0.01" value={l.precio_unitario} onChange={e => setLinea(i, 'precio_unitario', e.target.value)}/></td>
                <td><input className="field-input" style={{ padding:'6px 8px', textAlign:'right' }} type="number" min="0" max="100" step="0.5" value={l.descuento_pct} onChange={e => setLinea(i, 'descuento_pct', e.target.value)}/></td>
                <td style={{ textAlign:'right', fontWeight:600 }}>{mayMoney(lineSub(l))}</td>
                <td style={{ textAlign:'right', width:1 }}><button className="btn-ghost" style={{ padding:'5px 8px' }} onClick={() => delLinea(i)} disabled={lineas.length <= 1}><Icon n="trash" s={12}/></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn-ghost" style={{ marginTop:8 }} onClick={addLinea}><Icon n="plus" s={12}/> Agregar ítem</button>
      </div>

      <div style={{ display:'flex', justifyContent:'flex-end', alignItems:'center', gap:14, marginTop:8, paddingTop:10, borderTop:`1px solid ${MAY_UI.borderSoft}` }}>
        <div style={{ fontSize:12, color:MAY_UI.inkMuted }}>Subtotal <strong>{mayMoney(subtotal)}</strong></div>
        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:MAY_UI.inkMuted }}>
          Dto global
          <input type="number" min="0" max="100" step="0.5" className="field-input" style={{ width:70, padding:'5px 8px', textAlign:'right' }} value={form.descuento_global} onChange={e => set('descuento_global', e.target.value)}/>%
        </div>
        <div style={{ fontFamily:'var(--mono)', fontSize:20, fontWeight:800, color:'#16A34A' }}>{mayMoney(total)}</div>
      </div>

      <div className="field-group" style={{ marginTop:12 }}>
        <label className="field-label">Notas</label>
        <textarea className="field-input" rows={2} value={form.notas} onChange={e => set('notas', e.target.value)}/>
      </div>
    </Cmp>
  );
}

/* Genera el PDF del presupuesto (jsPDF, patrón de los reportes existentes). */
function presupuestoPDF(p, company) {
  if (!window.jspdf || !window.jspdf.jsPDF) { try { window.MOCK_BUS; } catch (_) {} alert('Librería PDF no cargada — refrescá la página'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'mm', format:'a4' });
  const M = 14; let y = 14;
  y = venDrawCompanyHeader(doc, company, M, y) + 3;
  doc.setFont('helvetica','bold'); doc.setFontSize(16);
  doc.text(`PRESUPUESTO ${p.numero}`, M, y); y += 7;
  doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(80,80,80);
  doc.setTextColor(0,0,0);
  y += 2;
  doc.text(`Emisión: ${venFecha(p.fecha_emision)}     Validez: ${venFecha(p.fecha_validez)}`, M, y); y += 7;

  doc.setFont('helvetica','bold'); doc.setFontSize(10);
  doc.text('Cliente', M, y); y += 5;
  doc.setFont('helvetica','normal'); doc.setFontSize(9);
  doc.text(`${p.cliente_nombre || ''}${p.cliente_cuit ? '  ·  ' + p.cliente_cuit : ''}`, M, y); y += 4;
  if (p.cliente_localidad || p.cliente_provincia) { doc.text([p.cliente_localidad, p.cliente_provincia].filter(Boolean).join(', '), M, y); y += 4; }
  y += 3;

  // Tabla
  const cols = [M, M+24, M+92, M+112, M+134, M+154];
  doc.setFillColor(240,240,240); doc.rect(M, y-4, 182, 6, 'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(8);
  ['SKU','Producto','Cant','Precio','Dto%','Subtotal'].forEach((h, i) => doc.text(h, cols[i], y));
  y += 5; doc.setFont('helvetica','normal');
  for (const it of (p.items || [])) {
    if (y > 270) { doc.addPage(); y = 18; }
    const prod = `${(it.modelo || it.sku)}${it.color && it.color !== '—' ? ' ' + it.color : ''}`.slice(0, 38);
    doc.text(String(it.sku || ''), cols[0], y);
    doc.text(prod, cols[1], y);
    doc.text(String(it.cantidad || 0), cols[2], y, { align:'left' });
    doc.text(mayMoney(it.precio_unitario), cols[3], y);
    doc.text(`${Number(it.descuento_pct) || 0}%`, cols[4], y);
    doc.text(mayMoney(it.subtotal), cols[5], y);
    y += 5;
  }
  y += 3; doc.setFont('helvetica','normal'); doc.setFontSize(9);
  doc.text(`Subtotal: ${mayMoney(p.subtotal_items)}`, cols[4] - 10, y); y += 4;
  doc.text(`Descuento global: ${Number(p.descuento_global) || 0}%`, cols[4] - 10, y); y += 5;
  doc.setFont('helvetica','bold'); doc.setFontSize(12);
  doc.text(`TOTAL: ${mayMoney(p.total)}`, cols[4] - 10, y); y += 9;

  doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(80,80,80);
  if (p.condicion_pago) { doc.text(`Condición de pago: ${p.condicion_pago}`, M, y); y += 4; }
  if (p.notas) { doc.text(`Notas: ${String(p.notas).slice(0,120)}`, M, y); y += 4; }
  doc.text(`Presupuesto válido hasta ${venFecha(p.fecha_validez)}.`, M, y);

  doc.save(`presupuesto-${p.numero}.pdf`);
}

/* ══════════════════════════════════════════════════════════════════
   S2.27 — Remitos B2B (tab Remitos)
   Backend: migration 0070 (remitos + items, 5 RPCs). Llamadas vía
   presRpc (window.SUPA.rpc). Estilo premium MAY_UI.
   ══════════════════════════════════════════════════════════════════ */

const REM_ESTADOS = {
  borrador:   { label:'Borrador',   bg:'#F3F4F6', fg:'#6B7280' },
  confirmado: { label:'Confirmado', bg:'#D1FAE5', fg:'#059669' },
  anulado:    { label:'Anulado',    bg:'#FEE2E2', fg:'#DC2626' },
};
function RemEstadoBadge({ estado }) {
  const c = REM_ESTADOS[estado] || { label:estado, bg:'#F3F4F6', fg:'#6B7280' };
  return <span style={{ fontSize:10, fontWeight:700, padding:'3px 10px', borderRadius:999, background:c.bg, color:c.fg, textTransform:'uppercase', letterSpacing:'.04em' }}>{c.label}</span>;
}
function remInMonth(dateStr) {
  if (!dateStr) return false;
  const d = new Date(String(dateStr).slice(0,10) + 'T00:00'); const n = new Date();
  return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
}

function RemitosTab({ onVerPedido }) {
  const toast = useToast();
  const role = (window.MOCK?.user?.role || '').toLowerCase();
  const canEdit = ['owner', 'admin'].includes(role);

  const [view, setView]       = useState('lista');
  const [selected, setSelected] = useState(null);
  const [list, setList]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [search, setSearch]   = useState('');
  const [estadoF, setEstadoF] = useState('');
  const [desde, setDesde]     = useState('');
  const [hasta, setHasta]     = useState('');
  const [soloPed, setSoloPed] = useState(false);
  const [clientes, setClientes] = useState([]);
  const [company, setCompany]   = useState(null);
  const [modal, setModal]     = useState(null);
  const [delTarget, setDelTarget] = useState(null);
  const [busy, setBusy]       = useState(false);

  const reload = async () => {
    setLoading(true); setError(null);
    try {
      const payload = {};
      if (estadoF) payload.estado = estadoF;
      if (desde) payload.desde = desde;
      if (hasta) payload.hasta = hasta;
      const data = await presRpc('rpc_remitos_list', payload);
      const arr = data || [];
      setList(arr);
      setSelected(prev => prev ? arr.find(r => r.id === prev.id) || null : null);
    } catch (err) { const m = err?.message || 'Error'; setError(m); toast.error(m); }
    finally { setLoading(false); }
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [estadoF, desde, hasta]);
  useEffect(() => {
    window.ADMIN_DATA.loadCustomersB2B({ includeInactive: false }).then(setClientes).catch(() => {});
    if (window.ADMIN_DATA.getCompanySettings) window.ADMIN_DATA.getCompanySettings().then(setCompany).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.filter(r => {
      if (soloPed && !r.pedido_id) return false;
      if (!q) return true;
      return (r.numero || '').toLowerCase().includes(q) || (r.cliente_nombre || '').toLowerCase().includes(q);
    });
  }, [list, search, soloPed]);

  const kTotalMes = list.filter(r => remInMonth(r.fecha_emision)).length;
  const kConfMes = list.filter(r => r.estado === 'confirmado' && remInMonth(r.fecha_emision)).length;
  const kCerrados = new Set(list.filter(r => r.pedido_estado === 'entregado' && r.pedido_id).map(r => r.pedido_id)).size;
  const kBorr = list.filter(r => r.estado === 'borrador').length;

  const confirmar = async (rm) => {
    if (busy) return; setBusy(true);
    try {
      const res = await presRpc('rpc_remitos_confirmar', { id: rm.id });
      toast.success(res?.pedido_cerrado ? 'Confirmado · pedido entregado al 100%' : 'Remito confirmado');
      await reload();
    } catch (err) {
      if (err && /periodo_cerrado/i.test(err.message || '')) toast.error('No se puede: período contable cerrado.');
      else toast.error(err?.message || 'No se pudo confirmar');
    } finally { setBusy(false); }
  };
  const anular = async (rm) => {
    if (busy) return;
    if (!window.confirm(`¿Anular ${rm.numero}?`)) return;
    setBusy(true);
    try {
      const res = await presRpc('rpc_remitos_anular', { id: rm.id });
      toast.success(res?.pedido_revertido ? 'Anulado · pedido vuelto a "listo"' : 'Remito anulado');
      await reload();
    } catch (err) { toast.error(err?.message || 'No se pudo anular'); }
    finally { setBusy(false); }
  };
  const doDelete = async () => {
    if (!delTarget || busy) return; setBusy(true);
    try { await presRpc('rpc_remitos_soft_delete', { id: delTarget.id }); toast.success('Remito eliminado'); setDelTarget(null); await reload(); }
    catch (err) { toast.error(err?.message || 'No se pudo eliminar'); }
    finally { setBusy(false); }
  };

  /* ── VISTA DETALLE ── */
  if (view === 'detalle' && selected) {
    const r = selected;
    const Y = Number(r.pedido_unidades) || 0;
    const X = Number(r.remitido_unidades) || 0;
    const pct = Y > 0 ? Math.min(100, Math.round((X / Y) * 100)) : 0;
    return (
      <div style={{ background:MAY_UI.pageBg, borderRadius:MAY_UI.radius, padding:16 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, marginBottom:14, flexWrap:'wrap' }}>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <button className="btn-ghost" onClick={() => setView('lista')}>← Volver</button>
            <span style={{ fontFamily:'var(--mono)', fontWeight:800, fontSize:18 }}>{r.numero}</span>
            <RemEstadoBadge estado={r.estado}/>
          </div>
          {r.estado === 'confirmado' && <button className="btn-ghost" onClick={() => remitoPDF(r, company)}><Icon n="download" s={13}/> Descargar PDF</button>}
        </div>

        <div style={{ background:MAY_UI.cardBg, border:`1px solid ${MAY_UI.border}`, borderRadius:MAY_UI.radius, padding:20, marginBottom:14 }}>
          <div style={{ display:'flex', gap:24, flexWrap:'wrap' }}>
            <div>
              <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.08em', color:MAY_UI.inkFaint }}>Cliente</div>
              <div style={{ fontWeight:700, fontSize:15, marginTop:2 }}>{r.cliente_nombre}</div>
              <div style={{ fontSize:12, color:MAY_UI.inkMuted }}>{[r.cliente_cuit, r.cliente_localidad].filter(Boolean).join(' · ') || '—'}</div>
            </div>
            <div><div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.08em', color:MAY_UI.inkFaint }}>Emisión</div><div style={{ fontSize:13, marginTop:2 }}>{venFecha(r.fecha_emision)}</div></div>
            <div><div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.08em', color:MAY_UI.inkFaint }}>Entrega</div><div style={{ fontSize:13, marginTop:2 }}>{venFecha(r.fecha_entrega)}</div></div>
            {r.transportista && <div><div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.08em', color:MAY_UI.inkFaint }}>Transportista</div><div style={{ fontSize:13, marginTop:2 }}>{r.transportista}</div></div>}
          </div>
        </div>

        {r.pedido_id && (
          <div style={{ background:MAY_UI.cardBg, border:`1px solid ${MAY_UI.border}`, borderRadius:MAY_UI.radius, padding:16, marginBottom:14 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, flexWrap:'wrap' }}>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <span style={{ fontSize:12, color:MAY_UI.inkMuted }}>Pedido vinculado</span>
                <button className="btn-ghost" style={{ padding:'4px 10px' }} onClick={() => onVerPedido && onVerPedido(r.cliente_id)}>{r.pedido_numero || 'pedido'} →</button>
                {r.pedido_estado && <span style={{ fontSize:10, color:MAY_UI.inkMuted }}>{r.pedido_estado}</span>}
              </div>
              <div style={{ fontSize:12, fontWeight:700, color: pct >= 100 ? '#15803d' : MAY_UI.inkSoft }}>{X} de {Y} uds ({pct}%)</div>
            </div>
            <div style={{ height:8, background:'var(--paper-dim, #eee)', borderRadius:4, overflow:'hidden', marginTop:8 }}>
              <div style={{ height:'100%', width:`${pct}%`, background: pct >= 100 ? '#16A34A' : '#6366f1', transition:'width .4s' }}/>
            </div>
          </div>
        )}

        <div style={{ background:MAY_UI.cardBg, border:`1px solid ${MAY_UI.border}`, borderRadius:MAY_UI.radius, overflow:'hidden' }}>
          <table className="data-table">
            <thead><tr><th>SKU</th><th>Producto</th><th style={{ textAlign:'right' }}>Cant.</th><th style={{ textAlign:'right' }}>Precio ref</th><th style={{ textAlign:'right' }}>Subtotal</th></tr></thead>
            <tbody>
              {(r.items || []).map((it, i) => (
                <tr key={it.id || i}>
                  <td><span className="order-num">{it.sku}</span></td>
                  <td>{it.modelo || it.sku}{it.color && it.color !== '—' ? ` · ${it.color}` : ''}</td>
                  <td style={{ textAlign:'right' }}>{it.cantidad_remitida}</td>
                  <td style={{ textAlign:'right' }}>{mayMoney(it.precio_unitario)}</td>
                  <td style={{ textAlign:'right', fontWeight:600 }}>{mayMoney(it.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding:'12px 16px', borderTop:`1px solid ${MAY_UI.borderSoft}`, display:'flex', justifyContent:'flex-end', gap:8, alignItems:'baseline' }}>
            <span style={{ fontSize:11, color:MAY_UI.inkFaint, textTransform:'uppercase', letterSpacing:'.05em' }}>Total ref.</span>
            <span style={{ fontFamily:'var(--mono)', fontWeight:800, fontSize:18 }}>{mayMoney(r.total_ref)}</span>
          </div>
        </div>

        {(r.condicion_entrega || r.notas) && (
          <div style={{ fontSize:12, color:MAY_UI.inkSoft, marginTop:12 }}>
            {r.condicion_entrega && <div><strong>Condición de entrega:</strong> {r.condicion_entrega}</div>}
            {r.notas && <div><strong>Notas:</strong> {r.notas}</div>}
          </div>
        )}

        {canEdit && (
          <div style={{ display:'flex', gap:8, marginTop:16, flexWrap:'wrap' }}>
            {r.estado === 'borrador' && <>
              <button className="btn-primary" onClick={() => confirmar(r)} disabled={busy}>Confirmar</button>
              <button className="btn-ghost" onClick={() => setModal({ mode:'edit', initial:r })}><Icon n="edit" s={13}/> Editar</button>
              <button className="btn-ghost" style={{ color:'#DC2626', borderColor:'#FCA5A5' }} onClick={() => setDelTarget(r)}><Icon n="trash" s={13}/> Eliminar</button>
            </>}
            {r.estado === 'confirmado' && (
              <button className="btn-ghost" style={{ color:'#DC2626', borderColor:'#FCA5A5' }} onClick={() => anular(r)} disabled={busy}>Anular</button>
            )}
          </div>
        )}

        {modal && <RemitoModal mode={modal.mode} initial={modal.initial} clientes={clientes} onClose={() => setModal(null)} onSaved={async () => { setModal(null); await reload(); }}/>}
        {delTarget && window.ConfirmModal && (
          <window.ConfirmModal open={true} title="Eliminar remito" message={`¿Eliminar ${delTarget.numero}?`}
            confirmText="Eliminar" danger onClose={() => { if (!busy) setDelTarget(null); }} onConfirm={doDelete}/>
        )}
      </div>
    );
  }

  /* ── VISTA LISTA ── */
  return (
    <div style={{ background:MAY_UI.pageBg, borderRadius:MAY_UI.radius, padding:16 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, marginBottom:14, flexWrap:'wrap' }}>
        <div style={{ fontSize:16, fontWeight:700 }}>Remitos</div>
        {canEdit && <button className="btn-primary" onClick={() => setModal({ mode:'create' })}><Icon n="plus" s={13}/> Nuevo remito</button>}
      </div>

      <div style={{ display:'flex', gap:12, marginBottom:14, flexWrap:'wrap' }}>
        <VenKpi label="Remitos del mes" value={kTotalMes}/>
        <VenKpi label="Confirmados del mes" value={kConfMes} accent="#15803d"/>
        <VenKpi label="Pedidos cerrados (mes)" value={kCerrados} accent="#15803d"/>
        <VenKpi label="Pendientes de confirmar" value={kBorr} accent="#B45309"/>
      </div>

      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:14 }}>
        <div style={{ position:'relative', flex:'1 1 200px', maxWidth:300 }}>
          <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', display:'flex' }}><Icon n="search" s={14} c={MAY_UI.inkFaint}/></span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar número o cliente…"
                 style={{ width:'100%', padding:'9px 12px 9px 34px', borderRadius:10, border:`1px solid ${MAY_UI.border}`, background:'#fff', fontSize:13, outline:'none' }}/>
        </div>
        <select className="field-input" style={{ width:140, padding:'8px 10px' }} value={estadoF} onChange={e => setEstadoF(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.keys(REM_ESTADOS).map(e => <option key={e} value={e}>{REM_ESTADOS[e].label}</option>)}
        </select>
        <input type="date" className="field-input" style={{ padding:'8px 10px' }} value={desde} onChange={e => setDesde(e.target.value)} title="Desde"/>
        <input type="date" className="field-input" style={{ padding:'8px 10px' }} value={hasta} onChange={e => setHasta(e.target.value)} title="Hasta"/>
        <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:MAY_UI.inkSoft, fontWeight:600 }}>
          <input type="checkbox" checked={soloPed} onChange={e => setSoloPed(e.target.checked)}/> Con pedido
        </label>
      </div>

      {loading ? (
        <div style={{ display:'flex', justifyContent:'center', padding:'48px 0' }}><span className="loader" style={{ width:26, height:26 }}/></div>
      ) : error ? (
        <div style={venEmptyBox()}><Icon n="alert" s={28} c="var(--red)"/><div style={{ fontWeight:700, marginTop:8 }}>{error}</div><button className="btn-ghost" style={{ marginTop:12 }} onClick={reload}>Reintentar</button></div>
      ) : list.length === 0 ? (
        <div style={venEmptyBox()}>
          <Icon n="truck" s={32} c={MAY_UI.inkFaint}/>
          <div style={{ fontWeight:700, fontSize:15, marginTop:10 }}>Sin remitos</div>
          {canEdit && <button className="btn-primary" style={{ marginTop:16 }} onClick={() => setModal({ mode:'create' })}><Icon n="plus" s={13}/> Nuevo remito</button>}
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {filtered.map(r => {
            const resumen = (r.items || []).slice(0, 2).map(it => `${it.cantidad_remitida}× ${it.modelo || it.sku}`).join(', ');
            const extra = (r.items || []).length - 2;
            return (
              <div key={r.id} style={{ background:MAY_UI.cardBg, border:`1px solid ${MAY_UI.border}`, borderRadius:MAY_UI.radius, padding:16 }}>
                <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                  <span style={{ fontFamily:'var(--mono)', fontWeight:700, fontSize:14 }}>{r.numero}</span>
                  <RemEstadoBadge estado={r.estado}/>
                  {r.pedido_id && (
                    <button className="btn-ghost" style={{ padding:'2px 9px', fontSize:11 }} onClick={() => onVerPedido && onVerPedido(r.cliente_id)}>Pedido {r.pedido_numero || ''}</button>
                  )}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight:600, fontSize:14 }}>{r.cliente_nombre}</div>
                    <div style={{ fontSize:11, color:MAY_UI.inkMuted }}>Entrega {venFecha(r.fecha_entrega)}{resumen ? ` · ${resumen}${extra > 0 ? ` y ${extra} más` : ''}` : ''}</div>
                  </div>
                </div>
                <div style={{ display:'flex', gap:8, marginTop:12, flexWrap:'wrap' }}>
                  <button className="btn-primary" onClick={() => { setSelected(r); setView('detalle'); }}>Ver detalle</button>
                  {canEdit && r.estado === 'borrador' && <button className="btn-ghost" onClick={() => confirmar(r)} disabled={busy}><Icon n="check" s={12}/> Confirmar</button>}
                  {canEdit && r.estado === 'borrador' && <button className="btn-ghost" onClick={() => setModal({ mode:'edit', initial:r })}><Icon n="edit" s={12}/> Editar</button>}
                  {canEdit && r.estado === 'confirmado' && <button className="btn-ghost" style={{ color:'#DC2626', borderColor:'#FCA5A5' }} onClick={() => anular(r)} disabled={busy}>Anular</button>}
                  {canEdit && r.estado === 'borrador' && <button className="btn-ghost" style={{ color:'#DC2626', borderColor:'#FCA5A5' }} onClick={() => setDelTarget(r)}><Icon n="trash" s={12}/> Eliminar</button>}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && <div style={{ textAlign:'center', padding:'24px', color:MAY_UI.inkMuted }}>Sin resultados</div>}
        </div>
      )}

      {modal && <RemitoModal mode={modal.mode} initial={modal.initial} clientes={clientes} onClose={() => setModal(null)} onSaved={async () => { setModal(null); await reload(); }}/>}
      {delTarget && window.ConfirmModal && (
        <window.ConfirmModal open={true} title="Eliminar remito" message={`¿Eliminar ${delTarget.numero}?`}
          confirmText="Eliminar" danger onClose={() => { if (!busy) setDelTarget(null); }} onConfirm={doDelete}/>
      )}
    </div>
  );
}

/* Modal de alta de remito (vinculado a pedido o standalone). */
function RemitoModal({ mode, initial, clientes, onClose, onSaved }) {
  const toast = useToast();
  const isEdit = mode === 'edit';
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    cliente_id:        (initial && initial.cliente_id) || '',
    fecha_emision:     (initial && initial.fecha_emision) ? String(initial.fecha_emision).slice(0,10) : today,
    fecha_entrega:     (initial && initial.fecha_entrega) ? String(initial.fecha_entrega).slice(0,10) : today,
    condicion_entrega: (initial && initial.condicion_entrega) || '',
    transportista:     (initial && initial.transportista) || '',
    notas:             (initial && initial.notas) || '',
  });
  const [vincular, setVincular] = useState(!!(initial && initial.pedido_id));
  const [pedidos, setPedidos]   = useState([]);
  const [pedidoId, setPedidoId] = useState((initial && initial.pedido_id) || '');
  const [lineas, setLineas]     = useState(
    (initial && initial.items && initial.items.length)
      ? initial.items.map(it => ({ sku:it.sku, cantidad_remitida:String(it.cantidad_remitida), precio_unitario:String(it.precio_unitario || 0), max:null, modelo:`${it.modelo || it.sku}${it.color && it.color !== '—' ? ' ' + it.color : ''}` }))
      : [{ sku:'', cantidad_remitida:'', precio_unitario:'', max:null, modelo:'' }]
  );
  const [saving, setSaving]     = useState(false);

  const set = (k, v) => setForm(s => ({ ...s, [k]: v }));
  const setLinea = (i, k, v) => setLineas(arr => arr.map((l, idx) => idx === i ? { ...l, [k]: v } : l));
  const addLinea = () => setLineas(arr => [...arr, { sku:'', cantidad_remitida:'', precio_unitario:'', max:null, modelo:'' }]);
  const delLinea = (i) => setLineas(arr => arr.length > 1 ? arr.filter((_, idx) => idx !== i) : arr);

  const skuOptions = useMemo(() => {
    const db = window.SKU_DB || {};
    return Object.keys(db).filter(s => db[s] && db[s].activo !== false).sort().map(s => {
      const x = db[s]; const label = x.color && x.color !== '—' ? `${s} — ${x.modelo} ${x.color}` : `${s} — ${x.modelo || ''}`;
      return { sku:s, label };
    });
  }, []);

  // Cargar pedidos del cliente al activar "vincular".
  useEffect(() => {
    if (!vincular || !form.cliente_id) { setPedidos([]); setPedidoId(''); return; }
    presRpc('rpc_mayoristas_list_pedidos', { cliente_id: form.cliente_id })
      .then(data => setPedidos((data || []).filter(p => ['confirmado','en_produccion','listo'].includes(p.estado))))
      .catch(() => setPedidos([]));
    /* eslint-disable-next-line */
  }, [vincular, form.cliente_id]);

  const onSelectPedido = async (pid) => {
    setPedidoId(pid);
    const ped = pedidos.find(p => p.id === pid);
    if (!ped) { setLineas([{ sku:'', cantidad_remitida:'', precio_unitario:'', max:null, modelo:'' }]); return; }
    const remMap = {};
    try {
      const rems = await presRpc('rpc_remitos_list', { pedido_id: pid });
      for (const rm of (rems || [])) {
        if (rm.estado !== 'confirmado') continue;
        for (const it of (rm.items || [])) remMap[it.sku] = (remMap[it.sku] || 0) + (Number(it.cantidad_remitida) || 0);
      }
    } catch (_) {}
    const nuevas = (ped.items || []).map(it => {
      const pend = Math.max(0, (Number(it.cantidad) || 0) - (remMap[it.sku] || 0));
      return { sku:it.sku, modelo:`${it.modelo || it.sku}${it.color && it.color !== '—' ? ' ' + it.color : ''}`, cantidad_remitida:String(pend), precio_unitario:String(it.precio_unitario || 0), max:pend };
    }).filter(l => l.max > 0);
    setLineas(nuevas.length ? nuevas : [{ sku:'', cantidad_remitida:'', precio_unitario:'', max:null, modelo:'' }]);
  };

  const lineSub = (l) => (Number(l.cantidad_remitida) || 0) * (Number(l.precio_unitario) || 0);
  const totalRef = lineas.reduce((s, l) => s + lineSub(l), 0);

  const guardar = async (confirmar) => {
    if (saving) return;
    if (!form.cliente_id) { toast.error('Elegí un cliente'); return; }
    const items = lineas
      .map(l => ({ sku:(l.sku || '').trim(), cantidad_remitida:parseInt(l.cantidad_remitida, 10), precio_unitario:Number(l.precio_unitario) || 0, _max:l.max }))
      .filter(l => l.sku && l.cantidad_remitida > 0);
    if (items.length === 0) { toast.error('Agregá al menos un ítem con cantidad'); return; }
    const over = items.find(l => l._max != null && l.cantidad_remitida > l._max);
    if (over) { toast.error(`La cantidad de ${over.sku} supera lo pendiente del pedido (${over._max}).`); return; }
    setSaving(true);
    try {
      const payload = {
        cliente_id: form.cliente_id, pedido_id: (vincular && pedidoId) ? pedidoId : null,
        fecha_emision: form.fecha_emision, fecha_entrega: form.fecha_entrega || null,
        condicion_entrega: form.condicion_entrega.trim(), transportista: form.transportista.trim(), notas: form.notas.trim(),
        items: items.map(l => ({ sku:l.sku, cantidad_remitida:l.cantidad_remitida, precio_unitario:l.precio_unitario })),
      };
      if (isEdit) {
        payload.id = initial.id;
        await presRpc('rpc_remitos_update', payload);
        if (confirmar) await presRpc('rpc_remitos_confirmar', { id: initial.id });
        toast.success(`Remito ${initial.numero} ${confirmar ? 'confirmado' : 'actualizado'}`);
      } else {
        const res = await presRpc('rpc_remitos_create', payload);
        if (confirmar) await presRpc('rpc_remitos_confirmar', { id: res.id });
        toast.success(`Remito ${res?.numero || ''} ${confirmar ? 'confirmado' : 'guardado'}`);
      }
      onSaved && onSaved();
    } catch (err) {
      if (err && /periodo_cerrado/i.test(err.message || '')) toast.error('No se puede: período contable cerrado.');
      else toast.error(err?.message || 'No se pudo guardar');
      setSaving(false);
    }
  };

  const Cmp = window.Modal;
  return (
    <Cmp open={true} title={isEdit ? `Editar ${initial.numero}` : 'Nuevo remito'} size="lg" onClose={() => { if (!saving) onClose?.(); }} footer={
      <>
        <button className="btn-ghost" onClick={() => { if (!saving) onClose?.(); }} disabled={saving}>Cancelar</button>
        <button className="btn-ghost" onClick={() => guardar(false)} disabled={saving}>Guardar borrador</button>
        <button className="btn-primary" onClick={() => guardar(true)} disabled={saving}>{saving ? 'Guardando…' : 'Guardar y confirmar'}</button>
      </>
    }>
      <div className="field-group">
        <label className="field-label">Cliente B2B *</label>
        <select className="field-input" value={form.cliente_id} onChange={e => { set('cliente_id', e.target.value); setPedidoId(''); }}>
          <option value="">— Elegí cliente —</option>
          {(clientes || []).map(c => <option key={c.id} value={c.id}>{c.nombre}{c.cuit ? ` · ${c.cuit}` : ''}</option>)}
        </select>
      </div>

      <div className="field-group">
        <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, fontWeight:600 }}>
          <input type="checkbox" checked={vincular} onChange={e => { setVincular(e.target.checked); if (!e.target.checked) { setPedidoId(''); setLineas([{ sku:'', cantidad_remitida:'', precio_unitario:'', max:null, modelo:'' }]); } }} disabled={!form.cliente_id}/>
          Vincular a un pedido
        </label>
        {vincular && (
          <select className="field-input" style={{ marginTop:6 }} value={pedidoId} onChange={e => onSelectPedido(e.target.value)}>
            <option value="">— Elegí pedido (listo / en producción / confirmado) —</option>
            {pedidos.map(p => <option key={p.id} value={p.id}>{p.numero_pedido} · {p.estado} · {(p.items || []).length} ítems</option>)}
          </select>
        )}
      </div>

      <div style={{ display:'flex', gap:12 }}>
        <div className="field-group" style={{ flex:1 }}><label className="field-label">Fecha emisión</label><input type="date" className="field-input" value={form.fecha_emision} onChange={e => set('fecha_emision', e.target.value)}/></div>
        <div className="field-group" style={{ flex:1 }}><label className="field-label">Fecha entrega</label><input type="date" className="field-input" value={form.fecha_entrega} onChange={e => set('fecha_entrega', e.target.value)}/></div>
      </div>
      <div style={{ display:'flex', gap:12 }}>
        <div className="field-group" style={{ flex:1 }}><label className="field-label">Condición de entrega</label><input className="field-input" value={form.condicion_entrega} placeholder="Ej: retira en fábrica, envío a domicilio" onChange={e => set('condicion_entrega', e.target.value)}/></div>
        <div className="field-group" style={{ flex:1 }}><label className="field-label">Transportista</label><input className="field-input" value={form.transportista} onChange={e => set('transportista', e.target.value)}/></div>
      </div>

      <div className="field-group">
        <label className="field-label">Ítems</label>
        <table className="data-table">
          <thead><tr><th style={{ width:'42%' }}>SKU / Producto</th><th style={{ width:'18%', textAlign:'right' }}>Cant.{vincular && pedidoId ? ' (máx)' : ''}</th><th style={{ width:'22%', textAlign:'right' }}>Precio ref</th><th style={{ textAlign:'right' }}>Subtotal</th><th></th></tr></thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={i}>
                <td>
                  {l.max != null
                    ? <span style={{ fontSize:12 }}><span className="order-num">{l.sku}</span> {l.modelo}</span>
                    : <select className="field-input" style={{ padding:'6px 8px' }} value={l.sku} onChange={e => setLinea(i, 'sku', e.target.value)}>
                        <option value="">— SKU —</option>
                        {skuOptions.map(o => <option key={o.sku} value={o.sku}>{o.label}</option>)}
                      </select>}
                </td>
                <td><input className="field-input" style={{ padding:'6px 8px', textAlign:'right' }} type="number" min="1" max={l.max != null ? l.max : undefined} value={l.cantidad_remitida} onChange={e => setLinea(i, 'cantidad_remitida', e.target.value)}/>{l.max != null && <div style={{ fontSize:9, color:MAY_UI.inkFaint, textAlign:'right' }}>máx {l.max}</div>}</td>
                <td><input className="field-input" style={{ padding:'6px 8px', textAlign:'right' }} type="number" min="0" step="0.01" value={l.precio_unitario} onChange={e => setLinea(i, 'precio_unitario', e.target.value)}/></td>
                <td style={{ textAlign:'right', fontWeight:600 }}>{mayMoney(lineSub(l))}</td>
                <td style={{ textAlign:'right', width:1 }}>{l.max == null && <button className="btn-ghost" style={{ padding:'5px 8px' }} onClick={() => delLinea(i)} disabled={lineas.length <= 1}><Icon n="trash" s={12}/></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!(vincular && pedidoId) && <button className="btn-ghost" style={{ marginTop:8 }} onClick={addLinea}><Icon n="plus" s={12}/> Agregar ítem</button>}
      </div>

      <div style={{ display:'flex', justifyContent:'flex-end', alignItems:'baseline', gap:10, marginTop:8, paddingTop:10, borderTop:`1px solid ${MAY_UI.borderSoft}` }}>
        <span style={{ fontSize:11, color:MAY_UI.inkFaint, textTransform:'uppercase', letterSpacing:'.05em' }}>Total ref.</span>
        <span style={{ fontFamily:'var(--mono)', fontSize:18, fontWeight:800 }}>{mayMoney(totalRef)}</span>
      </div>

      <div className="field-group" style={{ marginTop:12 }}>
        <label className="field-label">Notas</label>
        <textarea className="field-input" rows={2} value={form.notas} onChange={e => set('notas', e.target.value)}/>
      </div>
    </Cmp>
  );
}

/* PDF del remito (jsPDF, patrón de presupuestos). */
function remitoPDF(r, company) {
  if (!window.jspdf || !window.jspdf.jsPDF) { alert('Librería PDF no cargada — refrescá la página'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'mm', format:'a4' });
  const M = 14; let y = 14;
  y = venDrawCompanyHeader(doc, company, M, y) + 3;
  doc.setFont('helvetica','bold'); doc.setFontSize(16);
  doc.text(`REMITO ${r.numero}`, M, y); y += 7;
  doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(80,80,80);
  doc.setTextColor(0,0,0); y += 2;
  doc.text(`Emisión: ${venFecha(r.fecha_emision)}     Entrega: ${venFecha(r.fecha_entrega)}${r.transportista ? '     Transportista: ' + r.transportista : ''}`, M, y); y += 6;
  if (r.pedido_numero) { doc.text(`Pedido: ${r.pedido_numero}`, M, y); y += 6; }

  doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.text('Cliente', M, y); y += 5;
  doc.setFont('helvetica','normal'); doc.setFontSize(9);
  doc.text(`${r.cliente_nombre || ''}${r.cliente_cuit ? '  ·  ' + r.cliente_cuit : ''}`, M, y); y += 4;
  if (r.cliente_localidad) { doc.text(String(r.cliente_localidad), M, y); y += 4; }
  y += 3;

  const cols = [M, M+24, M+96, M+120, M+150];
  doc.setFillColor(240,240,240); doc.rect(M, y-4, 182, 6, 'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(8);
  ['SKU','Producto','Cant','Precio ref','Subtotal'].forEach((h, i) => doc.text(h, cols[i], y));
  y += 5; doc.setFont('helvetica','normal');
  for (const it of (r.items || [])) {
    if (y > 255) { doc.addPage(); y = 18; }
    doc.text(String(it.sku || ''), cols[0], y);
    doc.text(`${(it.modelo || it.sku)}${it.color && it.color !== '—' ? ' ' + it.color : ''}`.slice(0, 40), cols[1], y);
    doc.text(String(it.cantidad_remitida || 0), cols[2], y);
    doc.text(mayMoney(it.precio_unitario), cols[3], y);
    doc.text(mayMoney(it.subtotal), cols[4], y);
    y += 5;
  }
  y += 2; doc.setFont('helvetica','bold'); doc.setFontSize(10);
  doc.text(`Total ref.: ${mayMoney(r.total_ref)}`, cols[3] - 6, y); y += 8;

  doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(80,80,80);
  if (r.condicion_entrega) { doc.text(`Condición de entrega: ${r.condicion_entrega}`, M, y); y += 4; }
  if (r.notas) { doc.text(`Notas: ${String(r.notas).slice(0,120)}`, M, y); y += 4; }
  y += 10;
  doc.setTextColor(0,0,0);
  doc.text('Recibí conforme: _______________________________', M, y);

  doc.save(`remito-${r.numero}.pdf`);
}

window.VentasPage = VentasPage;
window.MayoristasTab = MayoristasTab;
window.ClientesB2BTab = ClientesB2BTab;
window.CtaCteClientesTab = CtaCteClientesTab;
window.BaseProductosTab = BaseProductosTab;
window.PresupuestosTab = PresupuestosTab;
window.RemitosTab = RemitosTab;
