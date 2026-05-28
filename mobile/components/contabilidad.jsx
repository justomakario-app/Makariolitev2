/* ══ CONTABILIDAD PAGE (S2.21)
   Página standalone con 3 tabs:
   - Cash Flow (DEFAULT) — usa CashFlowBody (refactor de CashFlowPage
     sin page-header propio).
   - Egresos / Compras — usa ExpensesTab.
   - Cheques — usa ChecksTab.

   SOLO owner (admin Romina NO ve esta sección). Guard runtime en
   app.jsx + filtro ROLE_NAV.

   Header con título dinámico según tab activo.
   ══ */

function ContabilidadPage() {
  const TABS = [
    { id:'cash-flow', label:'Cash Flow' },
    { id:'egresos',   label:'Egresos / Compras' },
    { id:'cheques',   label:'Cheques' },
  ];
  const [tab, setTab] = useState('cash-flow');
  const active = TABS.find(t => t.id === tab) || TABS[0];

  const subtituloMap = {
    'cash-flow': 'Flujo de caja real y proyectado, cierres contables.',
    'egresos':   'Listado, alta y bulk import de egresos / compras.',
    'cheques':   'Cheques emitidos y recibidos.',
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Contabilidad · {active.label}</div>
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
        {tab === 'cash-flow' && window.CashFlowBody ? <window.CashFlowBody/> :
         tab === 'egresos'   && window.ExpensesTab  ? <window.ExpensesTab/> :
         tab === 'cheques'   && window.ChecksTab    ? <window.ChecksTab/> : (
          <div className="admin-empty-state">
            <Icon n="dollar" s={32} c="var(--ink-muted)"/>
            <h3>{active.label}</h3>
            <p>Próximamente</p>
          </div>
        )}
      </div>
    </div>
  );
}

window.ContabilidadPage = ContabilidadPage;
