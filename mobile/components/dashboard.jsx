/* ══ MOBILE DASHBOARD ══ */

function DashboardPage({ onNav }) {
  const M = window.useMockData();
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

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
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
          <div>
            <div className="m-page-title">Hola, {(M.user.name || '').split(' ')[0]}</div>
            <div className="m-page-sub" style={{textTransform:'capitalize'}}>{fechaTxt}</div>
          </div>
          <span style={{display:'inline-flex', alignItems:'center', gap:5, padding:'4px 9px', background:'var(--green-bg)', border:'1px solid rgba(22,163,74,.25)', borderRadius:4, fontSize:9, fontWeight:700, letterSpacing:'.08em', color:'var(--green)'}}>
            <span style={{width:5, height:5, borderRadius:'50%', background:'var(--green)', animation:'live-pulse 1.4s ease-in-out infinite'}}/>
            EN VIVO
          </span>
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
