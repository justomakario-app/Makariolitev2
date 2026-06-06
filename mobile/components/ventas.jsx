/* ══ VENTAS PAGE (S2.21b · S2.23 Mayoristas)
   Módulo comercial y de clientes — 9 tabs.
   La tab "Clientes mayoristas" está implementada (S2.23): MayoristasTab.
   El resto, Próximamente.
   SOLO owner por rol + admins con permiso 'ventas' (S2.22).
   ══ */

/* ── Config de estados de pedido mayorista (colores del brief) ── */
const MAY_ESTADOS = {
  cotizacion:    { label: 'Cotización',    bg: '#eef0f2', fg: '#64748b' },
  confirmado:    { label: 'Confirmado',    bg: '#e0ecff', fg: '#2563eb' },
  en_produccion: { label: 'En producción', bg: '#fff0e0', fg: '#d97706' },
  listo:         { label: 'Listo',         bg: '#e8f7ed', fg: '#16a34a' },
  entregado:     { label: 'Entregado',     bg: '#dcfce7', fg: '#15803d' },
  cancelado:     { label: 'Cancelado',     bg: '#fee2e2', fg: '#dc2626' },
};
const MAY_ESTADO_ORDER = ['cotizacion','confirmado','en_produccion','listo','entregado','cancelado'];

function MayEstadoBadge({ estado }) {
  const c = MAY_ESTADOS[estado] || { label: estado, bg: '#eef0f2', fg: '#64748b' };
  return (
    <span style={{
      display:'inline-block', fontSize:10, fontWeight:700, padding:'2px 9px',
      borderRadius:10, background:c.bg, color:c.fg, textTransform:'uppercase', letterSpacing:'.05em',
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

/* ══ MAYORISTAS TAB — 2 vistas: lista de mayoristas → ficha del mayorista ══ */
function MayoristasTab() {
  const toast = useToast();
  const role = (window.MOCK?.user?.role || '').toLowerCase();
  const isOwner = role === 'owner';

  const [view, setView]         = useState('list');   // 'list' | 'ficha'
  const [selected, setSelected] = useState(null);     // mayorista seleccionado
  const [items, setItems]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [search, setSearch]     = useState('');
  const [custModal, setCustModal] = useState(null);   // {mode, initial?, defaultMayorista?}

  const reload = async () => {
    setLoading(true); setError(null);
    try {
      const data = await window.ADMIN_DATA.loadMayoristas();
      setItems(data || []);
      // Si estamos en ficha, refrescar el seleccionado con data fresca.
      setSelected(prev => prev ? (data || []).find(m => m.id === prev.id) || prev : prev);
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

  /* ── VISTA 2 — Ficha ── */
  if (view === 'ficha' && selected) {
    return (
      <div>
        <button className="btn-ghost" style={{marginBottom:14}} onClick={() => { setView('list'); setSelected(null); }}>
          ← Volver
        </button>

        <div className="card" style={{marginBottom:16}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, padding:'4px 2px'}}>
            <div>
              <div style={{fontSize:18, fontWeight:800, letterSpacing:'-.02em'}}>{selected.nombre}</div>
              <div style={{fontSize:12, color:'var(--ink-muted)', marginTop:4, fontWeight:600}}>
                {[selected.localidad, selected.provincia].filter(Boolean).join(', ') || 'Sin ubicación'}
              </div>
              <div style={{fontSize:12, color:'var(--ink-soft)', marginTop:6, display:'flex', gap:16, flexWrap:'wrap'}}>
                {selected.telefono && <span>Tel: {selected.telefono}</span>}
                {selected.email && <span>{selected.email}</span>}
                {selected.cuit && <span className="order-num">{selected.cuit}</span>}
              </div>
            </div>
            {isOwner && (
              <button className="btn-primary" onClick={() => setCustModal({ mode:'edit', initial: selected })}>
                <Icon n="edit" s={13}/> Editar
              </button>
            )}
          </div>
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

  /* ── VISTA 1 — Lista de mayoristas ── */
  return (
    <div>
      <div className="admin-tab-header">
        <div className="admin-search">
          <Icon n="search" s={14} c="var(--ink-muted)"/>
          <input className="filter-input admin-search-input"
                 placeholder="Buscar nombre, localidad, provincia, email…"
                 value={search}
                 onChange={e => setSearch(e.target.value)}/>
        </div>
        {isOwner && (
          <button className="btn-primary" onClick={() => setCustModal({ mode:'create', defaultMayorista:true })}>
            <Icon n="plus" s={13}/> Nuevo mayorista
          </button>
        )}
      </div>

      {loading ? (
        <div className="admin-empty-state"><span className="loader" style={{width:24, height:24}}/></div>
      ) : error ? (
        <div className="admin-empty-state">
          <Icon n="alert" s={28} c="var(--red)"/>
          <h3>Error al cargar</h3>
          <p>{error}</p>
          <button className="btn-ghost" onClick={reload}><Icon n="refresh" s={13}/> Reintentar</button>
        </div>
      ) : items.length === 0 ? (
        <div className="admin-empty-state">
          <Icon n="store" s={32} c="var(--ink-muted)"/>
          <h3>Todavía no hay mayoristas</h3>
          <p>Marcá un cliente B2B como "mayorista" o creá uno nuevo.</p>
          {isOwner && (
            <button className="btn-primary" onClick={() => setCustModal({ mode:'create', defaultMayorista:true })}>
              <Icon n="plus" s={13}/> Nuevo mayorista
            </button>
          )}
        </div>
      ) : (
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:12}}>
          {filtered.map(m => (
            <button key={m.id} className="card" style={{textAlign:'left', cursor:'pointer', border:'1px solid var(--border-md)', background:'var(--paper)'}}
                    onClick={() => { setSelected(m); setView('ficha'); }}>
              <div style={{fontWeight:700, fontSize:15, color:'var(--ink)'}}>{m.nombre}</div>
              <div style={{fontSize:12, color:'var(--ink-muted)', marginTop:3, fontWeight:600}}>
                {[m.localidad, m.provincia].filter(Boolean).join(', ') || 'Sin ubicación'}
              </div>
              <div style={{fontSize:11, color:'var(--ink-soft)', marginTop:8, display:'flex', flexDirection:'column', gap:2}}>
                {m.telefono && <span>Tel: {m.telefono}</span>}
                {m.email && <span>{m.email}</span>}
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div style={{gridColumn:'1/-1', textAlign:'center', padding:'24px', color:'var(--ink-muted)'}}>
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
    </div>
  );
}

/* ── Lista de pedidos de un mayorista (dentro de la ficha) ── */
function MayoristaPedidos({ clienteId, clienteNombre, isOwner }) {
  const toast = useToast();
  const [pedidos, setPedidos]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [expanded, setExpanded] = useState(null);   // pedido_id expandido
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

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">Pedidos de {clienteNombre}</div>
        {isOwner && (
          <button className="btn-primary" onClick={() => setPedidoModal(true)}>
            <Icon n="plus" s={13}/> Nuevo pedido
          </button>
        )}
      </div>

      {loading ? (
        <div className="empty"><span className="loader" style={{width:22, height:22}}/></div>
      ) : pedidos.length === 0 ? (
        <div className="empty">
          <Icon n="package" s={26} c="var(--ink-faint)"/>
          <div style={{fontSize:12, color:'var(--ink-muted)'}}>Sin pedidos todavía.</div>
        </div>
      ) : (
        <div style={{display:'flex', flexDirection:'column', gap:10, padding:'4px 2px'}}>
          {pedidos.map(p => {
            const open = expanded === p.id;
            const total = pedidoTotal(p);
            const resumen = (p.items || []).map(it => `${it.cantidad}× ${it.modelo || it.sku}`).join(' · ');
            return (
              <div key={p.id} style={{border:'1px solid var(--border-md)', borderRadius:8, overflow:'hidden'}}>
                <div style={{display:'flex', alignItems:'center', gap:12, padding:'12px 14px', cursor:'pointer', background:'var(--paper)'}}
                     onClick={() => setExpanded(open ? null : p.id)}>
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{display:'flex', alignItems:'center', gap:10}}>
                      <span className="order-num" style={{fontWeight:700}}>{p.numero_pedido}</span>
                      <MayEstadoBadge estado={p.estado}/>
                    </div>
                    <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:4}}>
                      {(p.fecha_pedido || '').slice(0,10)}
                      {p.fecha_entrega_estimada ? ` · entrega ${String(p.fecha_entrega_estimada).slice(0,10)}` : ''}
                    </div>
                    {!open && resumen && <div style={{fontSize:11, color:'var(--ink-soft)', marginTop:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{resumen}</div>}
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontFamily:'var(--mono)', fontWeight:700, fontSize:14}}>{mayMoney(total)}</div>
                    <div style={{fontSize:10, color:'var(--ink-faint)'}}>{(p.items || []).length} ítem{(p.items||[]).length===1?'':'s'}</div>
                  </div>
                  <Icon n={open ? 'chev-down' : 'chev-right'} s={14} c="var(--ink-muted)"/>
                </div>

                {open && (
                  <div style={{padding:'4px 14px 14px', borderTop:'1px solid var(--border-soft)'}}>
                    <table className="data-table" style={{marginTop:8}}>
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
                    {p.condicion_pago && <div style={{fontSize:11, color:'var(--ink-soft)', marginTop:8}}><strong>Condición de pago:</strong> {p.condicion_pago}</div>}
                    {p.notas && <div style={{fontSize:11, color:'var(--ink-soft)', marginTop:4}}><strong>Notas:</strong> {p.notas}</div>}

                    {isOwner && (
                      <div style={{display:'flex', alignItems:'center', gap:8, marginTop:12}}>
                        <span style={{fontSize:11, color:'var(--ink-muted)', fontWeight:600}}>Cambiar estado:</span>
                        <select className="field-input" style={{maxWidth:200, padding:'6px 8px'}}
                                value={p.estado}
                                disabled={estadoSaving === p.id}
                                onChange={e => cambiarEstado(p.id, e.target.value)}>
                          {MAY_ESTADO_ORDER.map(es => (
                            <option key={es} value={es}>{MAY_ESTADOS[es].label}</option>
                          ))}
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
          clienteId={clienteId}
          clienteNombre={clienteNombre}
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
  const [form, setForm] = useState({
    fecha_pedido: today,
    fecha_entrega_estimada: '',
    condicion_pago: '',
    notas: '',
  });
  const [lineas, setLineas] = useState([{ sku:'', cantidad:'', precio_unitario:'' }]);
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(s => ({ ...s, [k]: v }));
  const setLinea = (i, k, v) => setLineas(arr => arr.map((l, idx) => idx === i ? { ...l, [k]: v } : l));
  const addLinea = () => setLineas(arr => [...arr, { sku:'', cantidad:'', precio_unitario:'' }]);
  const delLinea = (i) => setLineas(arr => arr.length > 1 ? arr.filter((_, idx) => idx !== i) : arr);

  // Opciones de SKU activos desde el catálogo cargado.
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
    if (itemsValid.length === 0) {
      toast.error('Agregá al menos un ítem válido (SKU, cantidad > 0, precio ≥ 0)');
      return;
    }
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
      if (err && /periodo_cerrado/i.test(err.message || '')) {
        toast.error('No se puede crear: período contable cerrado.');
      } else {
        toast.error(err?.message || 'No se pudo crear el pedido');
      }
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
          <input className="field-input" type="date" value={form.fecha_pedido}
                 onChange={e => set('fecha_pedido', e.target.value)}/>
        </div>
        <div className="field-group" style={{flex:1}}>
          <label className="field-label">Entrega estimada</label>
          <input className="field-input" type="date" value={form.fecha_entrega_estimada}
                 onChange={e => set('fecha_entrega_estimada', e.target.value)}/>
        </div>
      </div>

      <div className="field-group">
        <label className="field-label">Condición de pago</label>
        <input className="field-input" value={form.condicion_pago}
               placeholder="Ej: 30 días, contado, 50% anticipo…"
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
                  <select className="field-input" style={{padding:'6px 8px'}} value={l.sku}
                          onChange={e => setLinea(i, 'sku', e.target.value)}>
                    <option value="">— elegir SKU —</option>
                    {skuOptions.map(o => <option key={o.sku} value={o.sku}>{o.label}</option>)}
                  </select>
                </td>
                <td>
                  <input className="field-input" style={{padding:'6px 8px', textAlign:'right'}} type="number" min="1"
                         value={l.cantidad} onChange={e => setLinea(i, 'cantidad', e.target.value)}/>
                </td>
                <td>
                  <input className="field-input" style={{padding:'6px 8px', textAlign:'right'}} type="number" min="0" step="0.01"
                         value={l.precio_unitario} onChange={e => setLinea(i, 'precio_unitario', e.target.value)}/>
                </td>
                <td style={{textAlign:'right', width:1}}>
                  <button className="btn-ghost" style={{padding:'5px 8px'}} title="Quitar ítem"
                          onClick={() => delLinea(i)} disabled={lineas.length <= 1}>
                    <Icon n="trash" s={12}/>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn-ghost" style={{marginTop:8}} onClick={addLinea}>
          <Icon n="plus" s={12}/> Agregar ítem
        </button>
      </div>

      <div style={{display:'flex', justifyContent:'flex-end', alignItems:'center', gap:10, marginTop:8, paddingTop:8, borderTop:'1px solid var(--border-soft)'}}>
        <span style={{fontSize:12, color:'var(--ink-muted)', fontWeight:600, textTransform:'uppercase', letterSpacing:'.05em'}}>Total</span>
        <span style={{fontFamily:'var(--mono)', fontSize:18, fontWeight:800}}>{mayMoney(total)}</span>
      </div>

      <div className="field-group" style={{marginTop:12}}>
        <label className="field-label">Notas</label>
        <textarea className="field-input" rows={2} value={form.notas}
                  onChange={e => set('notas', e.target.value)}/>
      </div>
    </Cmp>
  );
}

window.VentasPage = VentasPage;
window.MayoristasTab = MayoristasTab;
