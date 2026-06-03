/* ══ PRODUCCIÓN HUB PAGE (S2.21b)
   Wrapper con 4 tabs que agrupa el sistema productivo:
   - Producción (DEFAULT) — renderea window.ProduccionPage sin tocarla.
   - Stock — renderea window.StockPage sin tocarla.
     SOLO visible para owner/admin/encargado (guard de rol en cliente).
   - Fe fábrica — Próximamente.
   - Línea productiva — Próximamente.
   ══ */

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
