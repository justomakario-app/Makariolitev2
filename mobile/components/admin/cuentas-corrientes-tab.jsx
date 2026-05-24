/* ══ CUENTAS CORRIENTES TAB (B.5)
   Shell con sub-tabs Proveedores | Clientes B2B. Listado con saldo
   por cuenta + totales arriba. Cada fila delega a CtaCteRow para
   expansion + historial. Resetea expansion + search al cambiar sub-tab.
   ARS implicito (bloqueador 1.a en Fase 0). ══ */

function CuentasCorrientesTab() {
  const toast = useToast();
  const [subTab, setSubTab] = useState('proveedores');
  const [accounts, setAccounts] = useState({ suppliers: [], customers: [] });
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /* Reset al cambiar sub-tab (decision 5: estado limpio). */
  useEffect(() => { setExpandedId(null); setSearch(''); }, [subTab]);

  const reload = async () => {
    setLoading(true); setError(null);
    try {
      const [sups, custs] = await Promise.all([
        window.ADMIN_DATA.loadSuppliersWithCredit(),
        window.ADMIN_DATA.loadCustomersWithCredit(),
      ]);
      setAccounts({ suppliers: sups, customers: custs });
    } catch (err) {
      const msg = err?.message || 'Error desconocido';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  const list = subTab === 'proveedores' ? accounts.suppliers : accounts.customers;
  const isSupplier = subTab === 'proveedores';

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(acc => {
      const entity = isSupplier ? acc.suppliers : acc.customers_b2b;
      if (!entity) return false;
      const nombre = (entity.nombre || '').toLowerCase();
      const cuit = (entity.cuit || '').toLowerCase();
      const email = (entity.email || '').toLowerCase();
      return nombre.includes(q) || cuit.includes(q) || email.includes(q);
    });
  }, [list, search, isSupplier]);

  const totales = useMemo(() => {
    let positivo = 0, negativo = 0;
    filtered.forEach(a => {
      const s = Number(a.saldo) || 0;
      if (s > 0) positivo += s;
      else if (s < 0) negativo += -s;
    });
    return { positivo, negativo };
  }, [filtered]);

  const labels = isSupplier
    ? { positivo: 'Le debemos', negativo: 'Tienen a favor' }
    : { positivo: 'Nos deben', negativo: 'Tienen saldo a favor' };

  return (
    <div>
      <div className="admin-subtabs">
        <button className={`admin-subtab ${subTab === 'proveedores' ? 'active' : ''}`}
                onClick={() => setSubTab('proveedores')}>
          Proveedores
        </button>
        <button className={`admin-subtab ${subTab === 'clientes' ? 'active' : ''}`}
                onClick={() => setSubTab('clientes')}>
          Clientes B2B
        </button>
      </div>

      {!loading && !error && (
        <div className="cta-cte-totals">
          {totales.positivo > 0 && (
            <span><strong>{labels.positivo}:</strong> {window.ADMIN_DATA.formatMoney(totales.positivo, 'ARS')}</span>
          )}
          {totales.negativo > 0 && (
            <span><strong>{labels.negativo}:</strong> {window.ADMIN_DATA.formatMoney(totales.negativo, 'ARS')}</span>
          )}
          {totales.positivo === 0 && totales.negativo === 0 && (
            <span style={{color:'var(--ink-muted)'}}>Sin saldos pendientes</span>
          )}
        </div>
      )}

      <div className="admin-tab-header">
        <div className="admin-search">
          <Icon n="search" s={14} c="var(--ink-muted)"/>
          <input className="filter-input admin-search-input"
                 placeholder="Buscar nombre, CUIT, email…"
                 value={search} onChange={e => setSearch(e.target.value)}/>
        </div>
      </div>

      {loading ? (
        <div className="admin-empty-state"><span className="loader" style={{width:24, height:24}}/></div>
      ) : error ? (
        <div className="admin-empty-state">
          <Icon n="alert" s={28} c="var(--red)"/>
          <h3>Error al cargar</h3>
          <p>{error}</p>
          <button className="btn-ghost" onClick={reload}>
            <Icon n="refresh" s={13}/> Reintentar
          </button>
        </div>
      ) : list.length === 0 ? (
        <div className="admin-empty-state">
          <Icon n="users" s={32} c="var(--ink-muted)"/>
          <h3>{isSupplier ? 'Sin proveedores cargados' : 'Sin clientes B2B cargados'}</h3>
          <p>Cargá uno desde su tab respectivo para poder ver su cuenta corriente.</p>
        </div>
      ) : (
        <div className="card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nombre</th><th>CUIT</th>
                <th style={{textAlign:'right'}}>Saldo</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(acc => (
                <window.CtaCteRow
                  key={acc.id}
                  account={acc}
                  entityType={isSupplier ? 'supplier' : 'customer'}
                  isExpanded={expandedId === acc.id}
                  onToggle={() => setExpandedId(expandedId === acc.id ? null : acc.id)}
                  onChanged={reload}/>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={3} style={{textAlign:'center', padding:'24px', color:'var(--ink-muted)'}}>
                  Sin resultados para "{search}"
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

window.CuentasCorrientesTab = CuentasCorrientesTab;
