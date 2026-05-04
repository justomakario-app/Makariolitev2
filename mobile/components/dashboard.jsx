/* ══ MOBILE DASHBOARD ══ */

function DashboardPage({ onNav }) {
  const M = window.useMockData();
  const toast = useToast();
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  /* Exportar Excel consolidado: todos los canales con columna Canal,
     SKU, Modelo, Cantidad. Solo SKUs con faltante > 0. */
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
        filas.push({ Canal: cInfo.label, SKU: r.sku, Modelo: modeloFull, Cantidad: r.faltante });
      }
    }
    if (!filas.length) { toast.info('Nada para exportar — todo al día'); return; }
    if (typeof window.XLSX === 'undefined') {
      toast.error('Librería de Excel todavía no cargó · reintentá');
      return;
    }
    const ws = window.XLSX.utils.json_to_sheet(filas);
    ws['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 48 }, { wch: 12 }];
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Producción pendiente');
    const fecha = new Date().toISOString().slice(0, 10);
    window.XLSX.writeFile(wb, `produccion-todos-${fecha}.xlsx`);
    toast.success(`Excel exportado · ${filas.length} líneas`);
  };

  const counts = {
    colecta:      M.carriers.colecta.kpis.unidades      || 0,
    flex:         M.carriers.flex.kpis.unidades         || 0,
    tiendanube:   M.carriers.tiendanube.kpis.unidades   || 0,
    distribuidor: M.carriers.distribuidor.kpis.unidades || 0,
  };
  const total = counts.colecta + counts.flex + counts.tiendanube + counts.distribuidor;
  const fechaTxt = now.toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long' });
  const horaTxt = now.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' });
  const C = window.CARRIERS;

  return (
    <div className="m-page">
      <div className="m-page-header">
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:8}}>
          <div style={{minWidth:0}}>
            <div className="m-page-title">Hola, {(M.user.name || '').split(' ')[0]}</div>
            <div className="m-page-sub" style={{textTransform:'capitalize'}}>{fechaTxt}</div>
          </div>
          <div style={{display:'flex', alignItems:'center', gap:6, flexShrink:0}}>
            <button
              onClick={exportarTodos}
              title="Exportar Excel"
              style={{width:36, height:36, border:'1px solid var(--border-md)', background:'var(--paper)', borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'var(--ink-soft)'}}
            >
              <Icon n="download" s={15}/>
            </button>
            <span style={{display:'inline-flex', alignItems:'center', gap:5, padding:'4px 9px', background:'var(--green-bg)', border:'1px solid rgba(22,163,74,.25)', borderRadius:4, fontSize:9, fontWeight:700, letterSpacing:'.08em', color:'var(--green)'}}>
              <span style={{width:5, height:5, borderRadius:'50%', background:'var(--green)', animation:'live-pulse 1.4s ease-in-out infinite'}}/>
              EN VIVO
            </span>
          </div>
        </div>
      </div>

      {/* Hero */}
      <div className="m-hero">
        <div className="m-hero-grid"/>
        <div className="m-hero-glow"/>
        <div style={{position:'relative', zIndex:2}}>
          <div className="m-hero-label"><span className="m-hero-dot"/>Ventas activas</div>
          <div className="m-hero-number">{total}</div>
          <div style={{display:'flex', gap:18, marginTop:10}}>
            <div>
              <div className="m-hero-stat-label">Pendientes</div>
              <div className="m-hero-stat-val">{M.prod.todos.kpis.faltante}</div>
            </div>
            <div>
              <div className="m-hero-stat-label">Hoy</div>
              <div className="m-hero-stat-val">{M.prod.todos.producidoHoy}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Canales 2x2 */}
      <div className="m-channel-grid">
        {['colecta','flex','tiendanube','distribuidor'].map(id => {
          const c = C[id]; const count = counts[id]; const empty = count === 0;
          return (
            <div key={id} className="channel-card" data-channel={id} onClick={() => onNav(id)}>
              <div style={{position:'absolute', top:0, left:0, right:0, height:3, background:c.color}}/>
              <div className="channel-card-label" style={{color:c.color}}>{c.label}</div>
              <div className="channel-card-num" style={{color: empty?'var(--ink-faint)':'var(--ink)', fontSize:32}}>
                {empty ? <Icon n="package" s={32} c="var(--ink-faint)"/> : count}
              </div>
              <div className="channel-card-sub" style={{fontSize:10}}>{c.sub}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

window.DashboardPage = DashboardPage;
