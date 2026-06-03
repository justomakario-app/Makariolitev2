/* ══ RRHH PAGE (S2.21b)
   Página standalone con 4 tabs:
   - Empleados (DEFAULT) — usa EmployeesTab.
   - Recibos — usa RecibosTab.
   - Gestión hs extras — Próximamente.
   - Reportes salariales — usa ReportesTab.

   SOLO owner. Guard runtime en app.jsx + filtro ROLE_NAV.
   ══ */

function RrhhPage() {
  const TABS = [
    { id:'empleados',  label:'Empleados' },
    { id:'recibos',    label:'Recibos' },
    { id:'hs-extras',  label:'Gestión hs extras' },
    { id:'reportes',   label:'Reportes salariales' },
  ];
  const [tab, setTab] = useState('empleados');
  const active = TABS.find(t => t.id === tab) || TABS[0];

  const subtituloMap = {
    empleados:  'Plantilla de empleados, ficha ampliada y bulk import.',
    recibos:    'Recibos de sueldo (adelanto, quincena, sueldo) y PDFs.',
    'hs-extras':'Gestión de horas extras por empleado.',
    reportes:   'Histórico salarial y reportes comparativos.',
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Recursos Humanos · {active.label}</div>
          <div className="page-sub">{subtituloMap[tab] || ''}</div>
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
        {tab === 'empleados' && window.EmployeesTab ? <window.EmployeesTab/> :
         tab === 'recibos'   && window.RecibosTab   ? <window.RecibosTab/> :
         tab === 'reportes'  && window.ReportesTab  ? <window.ReportesTab/> :
         tab === 'hs-extras' ? (
          window.ProximamentePlaceholder
            ? <window.ProximamentePlaceholder nombre="Gestión hs extras"/>
            : <div className="admin-empty-state"><Icon n="clock" s={32} c="var(--ink-muted)"/><h3>Gestión hs extras</h3><p>Próximamente</p></div>
         ) : (
          <div className="admin-empty-state">
            <Icon n="users" s={32} c="var(--ink-muted)"/>
            <h3>{active.label}</h3>
            <p>Próximamente</p>
          </div>
        )}
      </div>
    </div>
  );
}

window.RrhhPage = RrhhPage;
