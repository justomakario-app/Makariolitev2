/* ══ MOBILE PRODUCCIÓN — cards en vez de tabla (touch-friendly) ══ */

function ProduccionPage() {
  const M = window.useMockData();
  const toast = useToast();
  const data = M.prod.todos;
  const [tab, setTab] = useState('todos');
  const [registerOpen, setRegisterOpen] = useState(false);
  const [pendingSku, setPendingSku] = useState(null);

  const exportarExcel = () => {
    const map = Object.fromEntries(Object.entries(window.CARRIERS || {}).map(([k,v]) => [k, v.label]));
    const fuente = tab === 'todos'
      ? data.table
      : data.table.filter(r => r.canal === map[tab]);
    const filas = fuente
      .filter(r => (r.faltante || 0) > 0)
      .map(r => {
        const info = window.SKU_DB[r.sku] || {};
        const modeloFull = info.color && info.color !== '—'
          ? `${info.modelo || r.sku} ${info.color}`
          : (info.modelo || r.sku);
        return { Canal: r.canal, SKU: r.sku, Modelo: modeloFull, Cantidad: r.faltante };
      });
    if (!filas.length) { toast.info('Nada para exportar — todo al día'); return; }
    if (typeof window.XLSX === 'undefined') {
      toast.error('Librería de Excel todavía no cargó'); return;
    }
    const ws = window.brandedJsonToSheet ? window.brandedJsonToSheet(filas, 'Producción pendiente') : window.XLSX.utils.json_to_sheet(filas);
    ws['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 48 }, { wch: 12 }];
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Producción pendiente');
    const fecha = new Date().toISOString().slice(0, 10);
    const nombre = tab === 'todos' ? 'todos' : tab;
    window.XLSX.writeFile(wb, `produccion-${nombre}-${fecha}.xlsx`);
    toast.success(`Excel exportado · ${filas.length} líneas`);
  };

  const total = data.kpis.totalPedido;
  const done  = data.kpis.producido;
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0;
  const barColor = pct >= 80 ? 'var(--green)' : pct >= 50 ? '#6366f1' : pct >= 30 ? 'var(--amber)' : 'var(--red)';

  let rows = data.table;
  if (tab !== 'todos') {
    const map = Object.fromEntries(Object.entries(window.CARRIERS || {}).map(([k,v]) => [k, v.label]));
    rows = rows.filter(r => r.canal === map[tab]);
  }
  rows = [...rows].sort((a, b) => (b.faltante || 0) - (a.faltante || 0));

  return (
    <div className="m-page">
      <div className="m-page-header" style={{paddingBottom:8}}>
        <div style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:10}}>
          <div style={{minWidth:0}}>
            <div className="m-page-title">Producción</div>
            <div className="m-page-sub">{done} de {total} unidades · {data.producidoHoy} hoy</div>
          </div>
          <button
            onClick={exportarExcel}
            title="Exportar Excel"
            style={{width:36, height:36, border:'1px solid var(--border-md)', background:'var(--paper)', borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'var(--ink-soft)', flexShrink:0}}
          >
            <Icon n="download" s={15}/>
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{margin:'8px 16px 4px'}}>
        <div style={{height:6, background:'var(--paper-dim)', borderRadius:3, overflow:'hidden'}}>
          <div style={{height:'100%', width:`${pct}%`, background: barColor, transition:'width .5s'}}/>
        </div>
        <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:4, fontWeight:600}}>{pct}% completado</div>
      </div>

      {/* KPIs compactos */}
      <div className="m-kpi-row">
        <div className="m-kpi" style={{borderLeft:'3px solid var(--red)'}}>
          <div className="m-kpi-label">Faltante</div>
          <div className="m-kpi-value" style={{color:'var(--red)'}}>{data.kpis.faltante}</div>
        </div>
        <div className="m-kpi" style={{borderLeft:'3px solid var(--green)'}}>
          <div className="m-kpi-label">Producido</div>
          <div className="m-kpi-value" style={{color:'var(--green)'}}>{data.kpis.producido}</div>
        </div>
        <div className="m-kpi">
          <div className="m-kpi-label">Hoy</div>
          <div className="m-kpi-value">{data.producidoHoy}</div>
        </div>
      </div>

      {/* Tabs canales */}
      <div className="m-tabs-scroll">
        {[
          { id:'todos',            label:'Todos' },
          { id:'colecta',          label:'Colecta',     dot:'#6366f1' },
          { id:'flex',             label:'Flex',        dot:'#15803d' },
          { id:'tiendanube',       label:'Tienda Nube', dot:'#2563eb' },
          { id:'distribuidor',     label:'Distrib.',    dot:'#d97706' },
          { id:'no_flex',          label:'No Flex',     dot:'#db2777' },
          { id:'correo_argentino', label:'Correo Arg.', dot:'#0891b2' },
        ].map(t => (
          <button
            key={t.id}
            className={`m-chip ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.dot && <span style={{width:6, height:6, borderRadius:'50%', background:t.dot, display:'inline-block', marginRight:6}}/>}
            {t.label}
          </button>
        ))}
      </div>

      {/* Lista de SKUs como cards */}
      <div style={{padding:'4px 16px 100px'}}>
        {/* S2.23: pedidos mayoristas en fabricación (canal Distribuidores, owner/admin) */}
        {tab === 'distribuidor' && window.MayoristasEnProduccion && <window.MayoristasEnProduccion/>}
        {rows.length === 0 ? (
          <div className="m-empty">
            <Icon n="check-circle" s={32} c="var(--green)"/>
            <div style={{fontSize:13, fontWeight:700, marginTop:8}}>Sin producción pendiente</div>
            <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:4}}>Todo al día en este canal</div>
          </div>
        ) : rows.map((r, i) => {
          const info = window.SKU_DB[r.sku] || {};
          // Encontrar el canal que tenga ese label para tomar su color
          const _ch = Object.values(window.CARRIERS || {}).find(c => c.label === r.canal);
          const channelColor = _ch?.color || '#888';
          return (
            <div key={`${r.sku}-${i}`} className="m-prod-card">
              <div style={{display:'flex', alignItems:'flex-start', gap:10}}>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:3}}>
                    <span style={{fontFamily:'var(--mono)', fontSize:11, fontWeight:700, color:'var(--ink-muted)'}}>{r.sku}</span>
                    <span style={{
                      fontSize:9, fontWeight:700, padding:'1px 7px', borderRadius:8,
                      background:`${channelColor}1a`, color:channelColor, textTransform:'uppercase', letterSpacing:'.05em',
                    }}>{r.canal}</span>
                  </div>
                  <div style={{fontSize:13, fontWeight:600, color:'var(--ink)'}}>{info.modelo || r.sku}</div>
                  {info.color && info.color !== '—' && (
                    <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:1}}>{info.color}</div>
                  )}
                </div>
                <div style={{textAlign:'right', flexShrink:0}}>
                  <div style={{fontFamily:'var(--mono)', fontSize:18, fontWeight:800, color: r.faltante>0?'var(--red)':'var(--green)'}}>
                    {r.faltante > 0 ? r.faltante : '✓'}
                  </div>
                  <div style={{fontSize:9, color:'var(--ink-muted)', textTransform:'uppercase', letterSpacing:'.06em', fontWeight:700, marginTop:1}}>
                    {r.faltante > 0 ? 'faltan' : 'OK'}
                  </div>
                </div>
              </div>
              <div style={{display:'flex', alignItems:'center', gap:10, marginTop:10}}>
                <div style={{flex:1, fontSize:11, color:'var(--ink-soft)'}}>
                  Pedido: <strong style={{fontFamily:'var(--mono)'}}>{r.pedido}</strong> · Hecho: <strong style={{fontFamily:'var(--mono)', color:'var(--green)'}}>{r.producido}</strong>
                  {r.stock > 0 && <> · Stock: <strong style={{fontFamily:'var(--mono)', color:'#7c3aed'}}>+{r.stock}</strong></>}
                </div>
                {r.faltante > 0 && (
                  <button className="btn-primary" style={{padding:'7px 14px', fontSize:10}}
                    onClick={() => { setPendingSku(r.sku); setRegisterOpen(true); }}>
                    <Icon n="plus" s={11}/> Cargar
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* FAB registrar */}
      <button className="m-fab" onClick={() => { setPendingSku(null); setRegisterOpen(true); }} aria-label="Registrar producción">
        <Icon n="plus" s={22} c="#fff"/>
      </button>

      <ProduceModal open={registerOpen} onClose={() => setRegisterOpen(false)} defaultSku={pendingSku}/>
    </div>
  );
}

window.ProduccionPage = ProduccionPage;

/* ══ S2.23 — Pedidos mayoristas en fabricación (espejo de web) ══
   Solo owner/admin (la RPC rpc_mayoristas_list_pedidos es owner+admin).
   "Marcar como listo" solo owner. */
function MayoristasEnProduccion() {
  const toast = useToast();
  const role = (window.MOCK?.user?.role || '').toLowerCase();
  if (!['owner', 'admin'].includes(role)) return null;
  const isOwner = role === 'owner';

  const ESTADO_C = {
    cotizacion:    { label:'Cotización',    bg:'#eef0f2', fg:'#64748b' },
    confirmado:    { label:'Confirmado',    bg:'#e0ecff', fg:'#2563eb' },
    en_produccion: { label:'En producción', bg:'#fff0e0', fg:'#d97706' },
    listo:         { label:'Listo',         bg:'#e8f7ed', fg:'#16a34a' },
    entregado:     { label:'Entregado',     bg:'#dcfce7', fg:'#15803d' },
    cancelado:     { label:'Cancelado',     bg:'#fee2e2', fg:'#dc2626' },
  };

  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(null);

  const reload = async () => {
    setLoading(true);
    try {
      const data = await window.ADMIN_DATA.listPedidosMayoristas({});
      setPedidos((data || []).filter(p => p.estado === 'confirmado' || p.estado === 'en_produccion'));
    } catch (err) {
      console.error('[produccion] mayoristas en produccion:', err?.message ?? err);
      setPedidos([]);
    } finally { setLoading(false); }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  const marcarListo = async (id) => {
    setSaving(id);
    try {
      await window.ADMIN_DATA.updateEstadoPedidoMayorista({ pedido_id: id, estado: 'listo' });
      toast.success('Pedido marcado como listo');
      await reload();
    } catch (err) {
      toast.error(err?.message || 'No se pudo actualizar');
    } finally { setSaving(null); }
  };

  if (loading || pedidos.length === 0) return null;

  return (
    <div style={{marginBottom:12}}>
      <div style={{fontSize:11, fontWeight:700, letterSpacing:'.08em', textTransform:'uppercase', color:'var(--ink-muted)', margin:'4px 2px 8px'}}>
        Pedidos mayoristas en fabricación
      </div>
      {pedidos.map(p => {
        const c = ESTADO_C[p.estado] || { label:p.estado, bg:'#eef0f2', fg:'#64748b' };
        const resumen = (p.items || []).map(it => `${it.cantidad}× ${it.modelo || it.sku}`).join(' · ');
        return (
          <div key={p.id} className="m-prod-card">
            <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:8}}>
              <span className="order-num" style={{fontWeight:700}}>{p.numero_pedido}</span>
              <span style={{fontSize:9, fontWeight:700, padding:'2px 8px', borderRadius:8, background:c.bg, color:c.fg, textTransform:'uppercase', letterSpacing:'.05em'}}>{c.label}</span>
            </div>
            <div style={{fontSize:13, fontWeight:600, marginTop:4}}>{p.cliente_nombre}</div>
            <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:2}}>
              {p.fecha_entrega_estimada ? `Entrega ${String(p.fecha_entrega_estimada).slice(0,10)}` : 'Sin fecha de entrega'}
            </div>
            {resumen && <div style={{fontSize:11, color:'var(--ink-soft)', marginTop:6}}>{resumen}</div>}
            {isOwner && (
              <button className="btn-primary" style={{marginTop:10, padding:'7px 14px', fontSize:10}}
                      onClick={() => marcarListo(p.id)} disabled={saving === p.id}>
                <Icon n="check" s={11}/> Marcar como listo
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

window.MayoristasEnProduccion = MayoristasEnProduccion;
