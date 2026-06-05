/* ══ FINANZAS PAGE (S2.21b — rename de Contabilidad)
   Página standalone con 4 tabs:
   - Cash Flow (DEFAULT) — usa CashFlowBody.
   - Plan de cuentas — Próximamente.
   - Egresos / Compras — usa ExpensesTab.
   - Cheques — usa ChecksTab.

   SOLO owner. Guard runtime en app.jsx + filtro ROLE_NAV.
   Alias retro-compat: window.ContabilidadPage = FinanzasPage.
   ══ */

function FinanzasPage() {
  // S2.22: un admin con permiso 'finanzas_egresos' (y NO 'finanzas' full)
  // ve EXCLUSIVAMENTE la tab Egresos/Compras. Owner y admin con 'finanzas'
  // full ven las 4 tabs.
  const egresosOnly = window.finanzasEgresosOnly ? window.finanzasEgresosOnly() : false;
  const ALL_TABS = [
    { id:'cash-flow',      label:'Cash Flow' },
    { id:'plan-cuentas',   label:'Plan de cuentas' },
    { id:'egresos',        label:'Egresos / Compras' },
    { id:'cheques',        label:'Cheques' },
  ];
  const TABS = egresosOnly ? ALL_TABS.filter(t => t.id === 'egresos') : ALL_TABS;
  const [tab, setTab] = useState(egresosOnly ? 'egresos' : 'cash-flow');
  const active = TABS.find(t => t.id === tab) || TABS[0];

  const subtituloMap = {
    'cash-flow':    'Flujo de caja real y proyectado, cierres contables.',
    'plan-cuentas': 'Estructura de cuentas contables.',
    'egresos':      'Listado, alta y bulk import de egresos / compras.',
    'cheques':      'Cheques emitidos y recibidos.',
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Finanzas · {active.label}</div>
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
        {tab === 'cash-flow'    && window.CashFlowBody ? <window.CashFlowBody/> :
         tab === 'egresos'      && window.ExpensesTab  ? <window.ExpensesTab/> :
         tab === 'cheques'      && window.ChecksTab    ? <window.ChecksTab/> :
         tab === 'plan-cuentas' ? (
          window.ProximamentePlaceholder
            ? <window.ProximamentePlaceholder nombre="Plan de cuentas"/>
            : <div className="admin-empty-state"><Icon n="dollar" s={32} c="var(--ink-muted)"/><h3>Plan de cuentas</h3><p>Próximamente</p></div>
         ) : (
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

window.FinanzasPage = FinanzasPage;
window.ContabilidadPage = FinanzasPage;
