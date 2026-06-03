/* ══ VENTAS PAGE (S2.21b)
   Módulo comercial y de clientes — 9 tabs, todos Próximamente.
   SOLO owner por ahora. Guard runtime en app.jsx + filtro ROLE_NAV.
   ══ */

function VentasPage() {
  const TABS = [
    { id:'alta-clientes',    label:'Alta y mod. clientes' },
    { id:'cta-cte-clientes', label:'Cta cte clientes' },
    { id:'facturacion',      label:'Facturación' },
    { id:'presupuestos',     label:'Presupuestos' },
    { id:'remitos',          label:'Remitos' },
    { id:'ventas-ml',        label:'Ventas ML' },
    { id:'ventas-tienda',    label:'Ventas tienda' },
    { id:'mayoristas',       label:'Clientes mayoristas' },
    { id:'base-productos',   label:'Base de productos' },
  ];
  const [tab, setTab] = useState('alta-clientes');
  const active = TABS.find(t => t.id === tab) || TABS[0];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Ventas</div>
          <div className="page-sub">Gestión comercial y clientes.</div>
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
              <Icon n="store" s={32} c="var(--ink-muted)"/>
              <h3>{active.label}</h3>
              <p>Próximamente</p>
            </div>
          )
        }
      </div>
    </div>
  );
}

window.VentasPage = VentasPage;
