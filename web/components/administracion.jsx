/* ══ ADMINISTRACIÓN PAGE (S2.21)
   Reemplazo del AdminPage legacy. Reorganización:
   - Solo 3 tabs: Proveedores (default), Clientes, Cuentas Corrientes.
   - Botón ⚙️ Empresa en header (singleton company_settings).
   - Bus ADMIN_NAV sigue suscrito acá (cross-tab entre Cuentas
     Corrientes y... bueno, Egresos ahora vive en Contabilidad,
     pero el bus se mantiene por si en el futuro un tab dispara
     navegación interna de esta página).

   Owner + Admin acceden (gated por FEATURE_ADMIN igual que antes).

   Alias retro-compat al final: window.AdminPage = AdministracionPage
   para no romper el boot check del HTML web ni futuros referers.
   ══ */

function AdministracionPage() {
  const TABS = [
    { id:'proveedores', label:'Proveedores' },
    { id:'clientes',    label:'Clientes' },
    { id:'cuentas',     label:'Cuentas Corrientes' },
  ];
  const [tab, setTab] = useState('proveedores');
  const [showCompanyModal, setShowCompanyModal] = useState(false);
  const active = TABS.find(t => t.id === tab) || TABS[0];

  /* Bus ADMIN_NAV (heredado de AdminPage). Si algún tab interno
     dispara goTo*, lo escuchamos. Hoy: CuentasCorrientes → ver egreso
     ya no se puede porque Egresos está en Contabilidad, pero el bus
     queda para futuras nav internas. */
  useEffect(() => {
    if (!window.ADMIN_NAV) return;
    return window.ADMIN_NAV.subscribe(({ tab: targetTab }) => {
      if (targetTab && TABS.some(t => t.id === targetTab)) setTab(targetTab);
    });
    /* eslint-disable-next-line */
  }, []);

  const titulo = active.label;
  const subtituloMap = {
    proveedores: 'Listado, ficha ampliada y bulk import de proveedores.',
    clientes:    'Listado y alta de clientes B2B.',
    cuentas:     'Saldos y movimientos de cuentas corrientes.',
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Administración</div>
          <div className="page-sub">{subtituloMap[tab] || titulo}</div>
        </div>
        <button className="btn-ghost admin-config-btn"
                title="Configuración de la empresa (datos para PDFs)"
                onClick={() => setShowCompanyModal(true)}>
          <Icon n="settings" s={14}/>
          <span className="admin-config-btn-label">Empresa</span>
        </button>
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
        {tab === 'proveedores' && window.SuppliersTab         ? <window.SuppliersTab/> :
         tab === 'clientes'    && window.CustomersTab         ? <window.CustomersTab/> :
         tab === 'cuentas'     && window.CuentasCorrientesTab ? <window.CuentasCorrientesTab/> : (
          <div className="admin-empty-state">
            <Icon n="briefcase" s={32} c="var(--ink-muted)"/>
            <h3>{active.label}</h3>
            <p>Próximamente</p>
          </div>
        )}
      </div>

      {showCompanyModal && window.CompanySettingsModal && (
        <window.CompanySettingsModal
          onClose={() => setShowCompanyModal(false)}
          onSuccess={() => { /* sin reload de tab actual */ }}/>
      )}
    </div>
  );
}

window.AdministracionPage = AdministracionPage;
/* Alias retro-compat: el boot check del HTML web espera window.AdminPage
   y app.jsx puede tener referencias. Mantener este alias evita
   acoplamiento entre el cambio de S2.21 y el boot. */
window.AdminPage = AdministracionPage;
