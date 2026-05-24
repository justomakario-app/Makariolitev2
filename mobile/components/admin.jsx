/* ══ ADMIN PAGE — Modulo Noe (Egresos, Cheques, Proveedores, Clientes, Cuentas Ctes.)
   B.1 Esqueleto: 5 tabs vacios con placeholder "Proximamente". Sin
   fetchers, sin RPCs, sin logica. Las tablas BD existen blindadas con
   RLS pero el frontend todavia no las consume. ══ */

function AdminPage() {
  const TABS = [
    { id:'egresos',     label:'Egresos / Compras' },
    { id:'cheques',     label:'Cheques' },
    { id:'proveedores', label:'Proveedores' },
    { id:'clientes',    label:'Clientes' },
    { id:'cuentas',     label:'Cuentas Corrientes' },
  ];
  const [tab, setTab] = useState('egresos');
  const [pendingExpenseId, setPendingExpenseId] = useState(null);
  const active = TABS.find(t => t.id === tab) || TABS[0];

  /* B.5: bus de navegacion cross-tab. CtaCteRow dispara goToExpense(id)
     cuando se clickea "Ver egreso" en un movement automatico. */
  useEffect(() => {
    if (!window.ADMIN_NAV) return;
    return window.ADMIN_NAV.subscribe(({ tab: targetTab, expenseId }) => {
      if (targetTab) setTab(targetTab);
      if (expenseId) setPendingExpenseId(expenseId);
    });
  }, []);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Admin</div>
          <div className="page-sub">Egresos, compras, cheques, proveedores, clientes y cuentas corrientes.</div>
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
        {tab === 'egresos'     && window.ExpensesTab  ? <window.ExpensesTab pendingExpenseId={pendingExpenseId} clearPending={() => setPendingExpenseId(null)}/>  :
         tab === 'cuentas'     && window.CuentasCorrientesTab ? <window.CuentasCorrientesTab/> :
         tab === 'cheques'     && window.ChecksTab    ? <window.ChecksTab/> :
         tab === 'proveedores' && window.SuppliersTab ? <window.SuppliersTab/> :
         tab === 'clientes'    && window.CustomersTab ? <window.CustomersTab/> : (
          <div className="admin-empty-state">
            <Icon n="dollar" s={32} c="var(--ink-muted)"/>
            <h3>{active.label}</h3>
            <p>Proximamente</p>
          </div>
        )}
      </div>
    </div>
  );
}

window.AdminPage = AdminPage;
