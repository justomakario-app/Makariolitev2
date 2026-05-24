/* ══ SUPPLIERS TAB (B.2)
   Listado + búsqueda + alta de proveedores. Lazy mount: solo se monta
   cuando el tab activo en admin.jsx es 'proveedores'. Cambiar de tab
   desmonta y descarta state local. ══ */

function SuppliersTab() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = async () => {
    setLoading(true); setError(null);
    try {
      const data = await window.ADMIN_DATA.loadSuppliers();
      setItems(data);
    } catch (err) {
      const msg = err?.message || 'Error desconocido';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter(it =>
      (it.nombre   || '').toLowerCase().includes(q) ||
      (it.cuit     || '').toLowerCase().includes(q) ||
      (it.email    || '').toLowerCase().includes(q) ||
      (it.telefono || '').toLowerCase().includes(q)
    );
  }, [items, searchQuery]);

  return (
    <div>
      <div className="admin-tab-header">
        <div className="admin-search">
          <Icon n="search" s={14} c="var(--ink-muted)"/>
          <input className="filter-input admin-search-input"
                 placeholder="Buscar nombre, CUIT, email, telefono…"
                 value={searchQuery}
                 onChange={e => setSearchQuery(e.target.value)}/>
        </div>
        <button className="btn-primary" onClick={() => setModalOpen(true)}>
          <Icon n="plus" s={13}/> Nuevo proveedor
        </button>
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
      ) : items.length === 0 ? (
        <div className="admin-empty-state">
          <Icon n="users" s={32} c="var(--ink-muted)"/>
          <h3>Todavia no cargaste proveedores</h3>
          <p>Empezá agregando el primero.</p>
          <button className="btn-primary" onClick={() => setModalOpen(true)}>
            <Icon n="plus" s={13}/> Nuevo proveedor
          </button>
        </div>
      ) : (
        <React.Fragment>
          <div className="card">
            <table className="data-table">
              <thead>
                <tr><th>Nombre</th><th>CUIT</th><th>Email</th><th>Telefono</th></tr>
              </thead>
              <tbody>
                {filtered.map(s => (
                  <tr key={s.id}>
                    <td style={{fontWeight:600}}>{s.nombre}</td>
                    <td><span className="order-num">{s.cuit || '—'}</span></td>
                    <td>{s.email || '—'}</td>
                    <td>{s.telefono || '—'}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={4} style={{textAlign:'center', padding:'24px', color:'var(--ink-muted)'}}>
                    Sin resultados para "{searchQuery}"
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="admin-tab-footer">
            {filtered.length === items.length
              ? `${items.length} proveedor${items.length === 1 ? '' : 'es'}`
              : `${filtered.length} de ${items.length}`}
          </div>
        </React.Fragment>
      )}

      {modalOpen && (
        <window.EntityModal
          entityType="supplier"
          onClose={() => setModalOpen(false)}
          onSuccess={reload}
        />
      )}
    </div>
  );
}

window.SuppliersTab = SuppliersTab;
