/* ══ PRODUCCIÓN HUB PAGE (S2.21b)
   Wrapper con 4 tabs que agrupa el sistema productivo:
   - Producción (DEFAULT) — renderea window.ProduccionPage sin tocarla.
   - Stock — renderea window.StockPage sin tocarla.
     SOLO visible para owner/admin/encargado (guard de rol en cliente).
   - Fe fábrica — Próximamente.
   - Línea productiva — router por rol (guard FASE 1): cada sector ve su pantalla.
   ══ */

/* ── FASE 1 · guard de rol: router de "Línea productiva" por sector ──
   Cada rol de producción ve la identidad de SU sector (paleta oficial de la
   brief). El backend (RPCs + cadena de stock) ya está; la UI por sector es
   Fase 3. Un rol sin producción ve el placeholder genérico, sin cambios. */
const SECTOR_THEME = {
  cnc:       { label:'Sector CNC',          color:'#2563EB', icon:'layers',  desc:'Corte de placas' },
  melamina:  { label:'Sector Melamina',     color:'#534AB7', icon:'flame',   desc:'Terminado de tapas' },
  pino:      { label:'Sector Pino',         color:'#0F6E56', icon:'tools',   desc:'Patas de madera' },
  embalaje:  { label:'Sector Embalaje',     color:'#993C1D', icon:'package', desc:'Armado y despacho' },
  encargado: { label:'Panel del Encargado', color:'#2E4057', icon:'shield',  desc:'Centro de control' },
  owner:     { label:'Supervisión',         color:'#2E4057', icon:'eye',     desc:'Vista de dirección' },
  admin:     { label:'Supervisión',         color:'#2E4057', icon:'eye',     desc:'Vista de dirección' },
};

function LineaProductivaGuard({ role }) {
  const t = SECTOR_THEME[role];
  // Pantallas de sector ya construidas (Fase 3); el resto, placeholder por sector.
  if (role === 'cnc' && window.CncSector) return <window.CncSector/>;
  if (role === 'melamina' && window.MelaminaSector) return <window.MelaminaSector/>;
  if (role === 'pino' && window.PinoSector) return <window.PinoSector/>;
  if (role === 'embalaje' && window.EmbalajeSector) return <window.EmbalajeSector/>;
  if (!t) {
    return window.ProximamentePlaceholder
      ? <window.ProximamentePlaceholder nombre="Línea productiva"/>
      : <div className="admin-empty-state"><Icon n="tools" s={32} c="var(--ink-muted)"/><h3>Línea productiva</h3><p>Próximamente</p></div>;
  }
  return (
    <div style={{display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', textAlign:'center', padding:'48px 24px', minHeight:320}}>
      <div style={{width:72, height:72, borderRadius:20, background:t.color+'14', border:'1px solid '+t.color+'29', display:'flex', alignItems:'center', justifyContent:'center', marginBottom:18}}>
        <Icon n={t.icon} s={32} c={t.color}/>
      </div>
      <div style={{fontSize:11, fontWeight:800, letterSpacing:'.12em', textTransform:'uppercase', color:t.color, marginBottom:8}}>{t.desc}</div>
      <h3 style={{fontSize:22, fontWeight:800, color:'var(--ink)', margin:'0 0 6px'}}>{t.label}</h3>
      <p style={{fontSize:13, color:'var(--ink-muted)', margin:'0 0 20px', maxWidth:340, lineHeight:1.6}}>
        Tu pantalla de sector está en construcción. El backend ya está listo (carga, stock y cadena productiva); la interfaz de este sector llega en la próxima entrega.
      </p>
      <span style={{display:'inline-flex', alignItems:'center', gap:6, fontSize:11, fontWeight:700, padding:'6px 12px', borderRadius:999, background:t.color+'14', color:t.color}}>
        <Icon n="tools" s={12} c={t.color}/> En construcción · Fase 3
      </span>
    </div>
  );
}

function ProduccionHubPage() {
  const M = window.useMockData();
  const role = (M.user.role || '').toLowerCase();
  const canSeeStock = ['owner', 'admin', 'encargado'].includes(role);

  const ALL_TABS = [
    { id:'produccion', label:'Producción',      stockOnly: false },
    { id:'stock',      label:'Stock',           stockOnly: true  },
    { id:'fe-fabrica', label:'De fábrica',      stockOnly: false },
    { id:'linea-prod', label:'Línea productiva', stockOnly: false },
  ];

  const TABS = ALL_TABS.filter(t => !t.stockOnly || canSeeStock);

  const [tab, setTab] = useState('produccion');
  const active = TABS.find(t => t.id === tab) || TABS[0];

  return (
    <div>
      <div style={{padding:'0 16px 0'}}>
        <div className="tabs" role="tablist" style={{marginBottom:0}}>
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
      </div>

      <div role="tabpanel">
        {tab === 'produccion' ? (
          window.ProduccionPage ? <window.ProduccionPage/> : null
        ) : tab === 'stock' && canSeeStock ? (
          window.StockPage ? <window.StockPage/> : null
        ) : tab === 'linea-prod' ? (
          <LineaProductivaGuard role={role}/>
        ) : (
          window.ProximamentePlaceholder
            ? <window.ProximamentePlaceholder nombre={active.label}/>
            : (
              <div className="admin-empty-state">
                <Icon n="tools" s={32} c="var(--ink-muted)"/>
                <h3>{active.label}</h3>
                <p>Próximamente</p>
              </div>
            )
        )}
      </div>
    </div>
  );
}

window.ProduccionHubPage = ProduccionHubPage;
