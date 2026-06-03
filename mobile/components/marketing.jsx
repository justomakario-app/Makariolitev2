/* ══ MARKETING PAGE (S2.21b)
   Módulo de calendario y reportes de actividades — 2 tabs, Próximamente.
   SOLO owner por ahora. Guard runtime en app.jsx + filtro ROLE_NAV.
   ══ */

function MarketingPage() {
  const TABS = [
    { id:'calendario',  label:'Calendario de actividades' },
    { id:'reportes',    label:'Reportes' },
  ];
  const [tab, setTab] = useState('calendario');
  const active = TABS.find(t => t.id === tab) || TABS[0];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Marketing</div>
          <div className="page-sub">Calendario y reportes de actividades.</div>
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
        {window.ProximamentePlaceholder
          ? <window.ProximamentePlaceholder nombre={active.label}/>
          : (
            <div className="admin-empty-state">
              <Icon n="megaphone" s={32} c="var(--ink-muted)"/>
              <h3>{active.label}</h3>
              <p>Próximamente</p>
            </div>
          )
        }
      </div>
    </div>
  );
}

window.MarketingPage = MarketingPage;
