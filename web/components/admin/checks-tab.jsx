/* ══ CHECKS TAB (B.4)
   Shell con sub-tabs Emitidos | Recibidos. Listado con filtros
   (search + estado) + alta + edit + cambio estado + delete.
   Totales arriba: contadores por estado. ARS implicito.
   Reset al cambiar sub-tab. ══ */

function ChecksTab() {
  const toast = useToast();
  const [subTab, setSubTab] = useState('emitidos');  // 'emitidos' | 'recibidos'
  const [items, setItems] = useState([]);
  const [parties, setParties] = useState({ suppliers: [], customers: [] });
  const [filters, setFilters] = useState({ search: '', estado: 'todos' });
  const [modalState, setModalState] = useState(null);          // null | {mode:'create'|'edit', initial?}
  const [statusModal, setStatusModal] = useState(null);        // null | check
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(false);

  /* Reset filtros + modal al cambiar sub-tab. */
  useEffect(() => {
    setFilters({ search: '', estado: 'todos' });
    setModalState(null);
    setStatusModal(null);
    setConfirmDeleteId(null);
  }, [subTab]);

  const reload = async () => {
    setLoading(true); setError(null);
    try {
      const [checks, sups, custs] = await Promise.all([
        subTab === 'emitidos'
          ? window.ADMIN_DATA.loadChecksIssued()
          : window.ADMIN_DATA.loadChecksReceived(),
        window.ADMIN_DATA.loadSuppliers(),
        window.ADMIN_DATA.loadCustomersB2B(),
      ]);
      setItems(checks);
      setParties({ suppliers: sups, customers: custs });
    } catch (err) {
      const msg = err?.message || 'Error desconocido';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [subTab]);

  const isIssued = subTab === 'emitidos';

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return items.filter(c => {
      if (filters.estado !== 'todos' && c.estado !== filters.estado) return false;
      if (!q) return true;
      const entity = isIssued ? c.suppliers : c.customers_b2b;
      const partyTexto = isIssued ? c.beneficiario_texto : c.emisor_texto;
      const partyName = (entity && entity.nombre) || partyTexto || '';
      return (c.numero || '').toLowerCase().includes(q)
          || (c.banco || '').toLowerCase().includes(q)
          || partyName.toLowerCase().includes(q)
          || (c.notas || '').toLowerCase().includes(q);
    });
  }, [items, filters, isIssued]);

  const counts = useMemo(() => {
    const acc = { emitido: 0, cobrado: 0, anulado: 0, devuelto: 0, pendienteMonto: 0 };
    items.forEach(c => {
      acc[c.estado] = (acc[c.estado] || 0) + 1;
      if (c.estado === 'emitido') acc.pendienteMonto += Number(c.monto) || 0;
    });
    return acc;
  }, [items]);

  const onDelete = async () => {
    if (deleting || !confirmDeleteId) return;
    setDeleting(true);
    try {
      const payload = { check_id: confirmDeleteId };
      if (isIssued) await window.ADMIN_DATA.deleteCheckIssued(payload);
      else          await window.ADMIN_DATA.deleteCheckReceived(payload);
      toast.success('Cheque eliminado');
      setConfirmDeleteId(null);
      await reload();
    } catch (err) {
      toast.error(err.message || 'No se pudo eliminar');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <div className="admin-subtabs">
        <button className={`admin-subtab ${subTab === 'emitidos' ? 'active' : ''}`}
                onClick={() => setSubTab('emitidos')}>Emitidos</button>
        <button className={`admin-subtab ${subTab === 'recibidos' ? 'active' : ''}`}
                onClick={() => setSubTab('recibidos')}>Recibidos</button>
      </div>

      {!loading && !error && (
        <div className="cta-cte-totals">
          <span><strong>Emitido:</strong> {counts.emitido}
            {counts.pendienteMonto > 0 && <> · Pendiente {window.ADMIN_DATA.formatMoney(counts.pendienteMonto, 'ARS')}</>}
          </span>
          <span><strong>Cobrado:</strong> {counts.cobrado}</span>
          <span><strong>Anulado:</strong> {counts.anulado}</span>
          <span><strong>Devuelto:</strong> {counts.devuelto}</span>
        </div>
      )}

      <div className="admin-tab-header">
        <div className="admin-search">
          <Icon n="search" s={14} c="var(--ink-muted)"/>
          <input className="filter-input admin-search-input"
                 placeholder="Buscar numero, banco, beneficiario, notas…"
                 value={filters.search}
                 onChange={e => setFilters(f => ({...f, search: e.target.value}))}/>
        </div>
        <select className="filter-select" value={filters.estado}
                onChange={e => setFilters(f => ({...f, estado: e.target.value}))}>
          <option value="todos">Todos los estados</option>
          <option value="emitido">Emitido</option>
          <option value="cobrado">Cobrado</option>
          <option value="anulado">Anulado</option>
          <option value="devuelto">Devuelto</option>
        </select>
        <button className="btn-primary" onClick={() => setModalState({ mode: 'create' })}>
          <Icon n="plus" s={13}/> Nuevo cheque
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
          <Icon n="dollar" s={32} c="var(--ink-muted)"/>
          <h3>{isIssued ? 'Sin cheques emitidos' : 'Sin cheques recibidos'}</h3>
          <p>Cargá el primero.</p>
          <button className="btn-primary" onClick={() => setModalState({ mode: 'create' })}>
            <Icon n="plus" s={13}/> Nuevo cheque
          </button>
        </div>
      ) : (
        <React.Fragment>
          <div className="card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Fecha emision</th>
                  <th>Numero</th>
                  <th>Banco</th>
                  <th>{isIssued ? 'Beneficiario' : 'Emisor'}</th>
                  <th>Vence</th>
                  <th style={{textAlign:'right'}}>Monto</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <window.CheckRow
                    key={c.id}
                    check={c}
                    checkType={isIssued ? 'issued' : 'received'}
                    onEdit={(check) => setModalState({ mode: 'edit', initial: check })}
                    onChangeStatus={(check) => setStatusModal(check)}
                    onDelete={(check) => setConfirmDeleteId(check.id)}/>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} style={{textAlign:'center', padding:'24px', color:'var(--ink-muted)'}}>
                    Sin resultados para los filtros aplicados
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="admin-tab-footer">
            {filtered.length} de {items.length} cheque{items.length === 1 ? '' : 's'}
          </div>
        </React.Fragment>
      )}

      {modalState && (
        <window.CheckModal
          checkType={isIssued ? 'issued' : 'received'}
          mode={modalState.mode}
          parties={parties}
          initial={modalState.initial}
          onClose={() => setModalState(null)}
          onSuccess={async () => { setModalState(null); await reload(); }}/>
      )}

      {statusModal && (
        <window.CheckStatusModal
          check={statusModal}
          checkType={isIssued ? 'issued' : 'received'}
          onClose={() => setStatusModal(null)}
          onSuccess={async () => { setStatusModal(null); await reload(); }}/>
      )}

      <window.ConfirmModal
        open={!!confirmDeleteId}
        title="Eliminar cheque"
        message="¿Seguro que querés eliminar este cheque? Solo se pueden eliminar cheques en estado emitido sin movimientos asociados."
        confirmText="Eliminar" danger
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={onDelete}/>
    </div>
  );
}

window.ChecksTab = ChecksTab;
