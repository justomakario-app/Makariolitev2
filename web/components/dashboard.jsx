/* ══ DASHBOARD — alineado al mock ══ */

function ChannelCard({ id, label, sub, count, color, icon, onClick }) {
  const isEmpty = count === 0;
  return (
    <div className="channel-card" data-channel={id} onClick={onClick}>
      <div style={{position:'absolute', top:0, left:0, right:0, height:3, background:color}}/>
      <div className="channel-card-label" style={{color}}>{label}</div>
      <div className="channel-card-num" style={{color: isEmpty ? 'var(--ink-faint)' : 'var(--ink)'}}>
        {isEmpty ? <Icon n="package" s={48} c="var(--ink-faint)"/> : count}
      </div>
      <div className="channel-card-sub">{sub}</div>
    </div>
  );
}

function DashboardPage({ onNav }) {
  const M = window.useMockData();
  const toast = useToast();
  // Reloj en vivo
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000); // refresca cada 30s
    return () => clearInterval(t);
  }, []);

  /* Exportar Excel consolidado: todos los canales en un solo archivo,
     con columna "Canal" para identificar cada fila. Solo SKUs con
     faltante > 0 (lo que hay que fabricar). */
  const exportarTodos = () => {
    const filas = [];
    const orden = ['colecta','flex','tiendanube','distribuidor'];
    for (const id of orden) {
      const carrier = M.carriers[id];
      const cInfo = window.CARRIERS[id] || { label: id };
      if (!carrier) continue;
      for (const r of carrier.table || []) {
        if ((r.faltante || 0) <= 0) continue;
        const info = window.SKU_DB[r.sku] || {};
        const modeloFull = info.color && info.color !== '—'
          ? `${info.modelo || r.sku} ${info.color}`
          : (info.modelo || r.sku);
        filas.push({
          Canal: cInfo.label,
          SKU: r.sku,
          Modelo: modeloFull,
          Cantidad: r.faltante,
        });
      }
    }
    if (!filas.length) {
      toast.info('Nada para exportar — todos los canales están al día');
      return;
    }
    if (typeof window.XLSX === 'undefined') {
      toast.error('Librería de Excel todavía no cargó · reintentá en un segundo');
      return;
    }
    const ws = window.XLSX.utils.json_to_sheet(filas);
    ws['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 48 }, { wch: 12 }];
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Producción pendiente');
    const fecha = new Date().toISOString().slice(0, 10);
    window.XLSX.writeFile(wb, `produccion-todos-${fecha}.xlsx`);
    toast.success(`Excel exportado · ${filas.length} línea${filas.length===1?'':'s'} de ${orden.filter(id => (M.carriers[id]?.table||[]).some(r => (r.faltante||0)>0)).length} canal(es)`);
  };

  // Lista de canales visibles (filtra por rol). Centralizado acá para
  // que el orden y la lista sean consistentes con el dashboard mobile.
  const canalesIds = ['colecta','flex','tiendanube','distribuidor','no_flex','correo_argentino'];
  const counts = {};
  let total = 0;
  for (const id of canalesIds) {
    const u = M.carriers[id]?.kpis?.unidades || 0;
    counts[id] = u;
    total += u;
  }
  const fechaTxt = now.toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long' });
  const horaTxt = now.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit', hour12:true });
  const today = `${fechaTxt} · ${horaTxt}`;
  const C = window.CARRIERS;

  return (
    <div className="page">
      {/* Header con reloj en vivo */}
      <div className="page-header" style={{marginBottom:18}}>
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-sub">Vista general de canales y producción</div>
        </div>
        <div style={{display:'flex', alignItems:'center', gap:10, fontFamily:'var(--font-mono)', fontSize:11, fontWeight:700, letterSpacing:'.08em', color:'var(--ink-soft)'}}>
          <button className="btn-ghost" onClick={exportarTodos} title="Exportar Excel con producción pendiente de todos los canales">
            <Icon n="download" s={13}/> Exportar todo
          </button>
          <span style={{display:'inline-flex', alignItems:'center', gap:6, padding:'5px 10px', background:'var(--green-bg)', border:'1px solid rgba(22,163,74,.25)', borderRadius:4, color:'var(--green)'}}>
            <span style={{width:6, height:6, borderRadius:'50%', background:'var(--green)', animation:'live-pulse 1.4s ease-in-out infinite'}}/>
            EN VIVO
          </span>
          <span>{horaTxt.toUpperCase()}</span>
        </div>
      </div>
      {/* Hero */}
      <div className="dash-hero">
        <div className="dash-hero-grid"/>
        <div className="dash-hero-glow"/>
        <div className="dash-hero-left">
          <div className="dash-hero-number">{total}</div>
          <div className="dash-hero-meta">
            <div className="dash-hero-label"><span className="dash-hero-dot"/>Ventas activas</div>
            <div className="dash-hero-date">{today.toUpperCase()}</div>
          </div>
        </div>
        <div className="dash-hero-right">
          <div className="dash-hero-stat">
            <span className="dash-hero-stat-label">Pendientes</span>
            <span className="dash-hero-stat-val">{M.prod.todos.kpis.faltante}</span>
          </div>
          <div className="dash-hero-stat">
            <span className="dash-hero-stat-label">Producidos hoy</span>
            <span className="dash-hero-stat-val">{M.prod.todos.producidoHoy}</span>
          </div>
        </div>
      </div>

      {/* Channels — 3 columnas (2 filas con 6 canales) — armónico en cualquier viewport.
          Stock se renderiza como un cuadrito mas solo para owner/admin/encargado. */}
      <div className="channel-grid" style={{gridTemplateColumns:'repeat(3, 1fr)'}}>
        {canalesIds.map(id => (
          <ChannelCard
            key={id}
            id={id}
            label={C[id]?.label || id}
            sub={C[id]?.sub || ''}
            count={counts[id]}
            color={C[id]?.color || '#888'}
            onClick={() => onNav(id)}
          />
        ))}
        {['owner','admin','encargado'].includes((M.user.role||'').toLowerCase()) && (
          <ChannelCard
            id="stock"
            label="Stock"
            sub="Almacén central"
            count={window.MOCK_ACTIONS.getStockTotal()}
            color="#7c3aed"
            onClick={() => onNav('stock')}
          />
        )}
      </div>
    </div>
  );
}

window.DashboardPage = DashboardPage;
