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

function VentasPage() {
  const TABS = [
    { id:'alta-clientes',    label:'Alta y mod. clientes' },
    { id:'cta-cte-clientes', label:'Cta cte clientes' },
    { id:'facturacion',      label:'Facturación' },
    { id:'presupuestos',     label:'Presupuestos' },
    { id:'remitos',          label:'Remitos' },
    { id:'ventas-ml',        label:'Ventas ML' },
    { id:'ventas-tienda',    label:'Ventas tienda' },
    { id:'mayoristas',       label:'Clientes mayoristas' },
    { id:'base-productos',   label:'Base de productos' },
  ];
  const [tab, setTab] = useState('alta-clientes');
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
        {tab === 'mayoristas' ? (
          <MayoristasTab/>
        ) : window.ProximamentePlaceholder ? (
          <window.ProximamentePlaceholder nombre={active.label}/>
        ) : (
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
function MayoristasTab() {
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

window.VentasPage = VentasPage;
window.MayoristasTab = MayoristasTab;
