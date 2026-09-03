/* ══ SUPPLIERS TAB (B.2 + S2.1)
   Listado + búsqueda + alta/edit/delete de proveedores. Lazy mount.
   S2.1: botones editar/borrar/reactivar + toggle "Mostrar inactivos"
   + flujo de borrado bloqueado con opcion de desactivar. ══ */

function SuppliersTab() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [modalState, setModalState] = useState(null);  // null | {mode, initial?}
  const [deleteState, setDeleteState] = useState(null); // null | {target, blocked?, msg?, counts?}
  const [bulkImportOpen, setBulkImportOpen] = useState(false);  // S2.4
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionRunning, setActionRunning] = useState(false);

  const reload = async () => {
    setLoading(true); setError(null);
    try {
      const data = await window.ADMIN_DATA.loadSuppliers({ includeInactive: showInactive });
      setItems(data);
    } catch (err) {
      const msg = err?.message || 'Error desconocido';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [showInactive]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter(it =>
      window.buscaEn(q, it.nombre, it.cuit, it.email, it.telefono));
  }, [items, searchQuery]);

  const onDeleteClick = (s) => setDeleteState({ target: s });

  const doDelete = async () => {
    if (actionRunning || !deleteState) return;
    setActionRunning(true);
    try {
      await window.ADMIN_DATA.deleteSupplier({ id: deleteState.target.id });
      toast.success('Proveedor eliminado');
      setDeleteState(null);
      await reload();
    } catch (err) {
      if (err && err.hint === 'has_relations') {
        // Bloqueado → mostrar modal alternativo con conteos
        const parsed = window.ADMIN_DATA.parseHasRelationsMessage(err.message);
        setDeleteState({
          target: deleteState.target,
          blocked: true,
          msg: err.message,
          counts: parsed && parsed.counts,
        });
      } else {
        toast.error(err.message || 'No se pudo eliminar');
        setDeleteState(null);
      }
    } finally {
      setActionRunning(false);
    }
  };

  const doDesactivar = async () => {
    if (actionRunning || !deleteState) return;
    setActionRunning(true);
    try {
      await window.ADMIN_DATA.updateSupplier({
        id: deleteState.target.id,
        nombre: deleteState.target.nombre,
        cuit: deleteState.target.cuit,
        email: deleteState.target.email,
        telefono: deleteState.target.telefono,
        notas: deleteState.target.notas,
        activo: false,
      });
      toast.success('Proveedor desactivado');
      setDeleteState(null);
      await reload();
    } catch (err) {
      toast.error(err.message || 'No se pudo desactivar');
    } finally {
      setActionRunning(false);
    }
  };

  const doReactivar = async (s) => {
    try {
      await window.ADMIN_DATA.updateSupplier({
        id: s.id, nombre: s.nombre, cuit: s.cuit, email: s.email,
        telefono: s.telefono, notas: s.notas, activo: true,
      });
      toast.success('Proveedor reactivado');
      await reload();
    } catch (err) {
      toast.error(err.message || 'No se pudo reactivar');
    }
  };

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
        <label className="admin-toggle-inactive">
          <input type="checkbox" checked={showInactive}
                 onChange={e => setShowInactive(e.target.checked)}/>
          Mostrar inactivos
        </label>
        <button className="btn-ghost" onClick={() => setBulkImportOpen(true)}>
          <Icon n="upload" s={13}/> Importar masivo
        </button>
        <button className="btn-primary" onClick={() => setModalState({ mode: 'create' })}>
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
          <button className="btn-primary" onClick={() => setModalState({ mode: 'create' })}>
            <Icon n="plus" s={13}/> Nuevo proveedor
          </button>
        </div>
      ) : (
        <React.Fragment>
          <div className="card">
            <table className="data-table">
              <thead>
                <tr><th>Nombre</th><th>CUIT</th><th>Email</th><th>Telefono</th><th></th></tr>
              </thead>
              <tbody>
                {filtered.map(s => {
                  const isInactive = s.activo === false;
                  return (
                    <tr key={s.id} className={isInactive ? 'row-inactive' : ''}>
                      <td style={{fontWeight:600}}>{s.nombre}</td>
                      <td><span className="order-num">{s.cuit || '—'}</span></td>
                      <td>{s.email || '—'}</td>
                      <td>{s.telefono || '—'}</td>
                      <td className="cta-cte-actions">
                        {isInactive ? (
                          <button className="btn-ghost-sm btn-reactivate" title="Reactivar"
                                  onClick={() => doReactivar(s)}>
                            <Icon n="refresh" s={12}/> Reactivar
                          </button>
                        ) : (
                          <React.Fragment>
                            <button className="btn-ghost-sm" title="Editar"
                                    onClick={() => setModalState({ mode: 'edit', initial: s })}>
                              <Icon n="edit" s={12}/>
                            </button>
                            <button className="btn-ghost-sm danger" title="Eliminar"
                                    onClick={() => onDeleteClick(s)}>
                              <Icon n="trash" s={12}/>
                            </button>
                          </React.Fragment>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={5} style={{textAlign:'center', padding:'24px', color:'var(--ink-muted)'}}>
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

      {modalState && (
        <window.SupplierModal
          mode={modalState.mode}
          initial={modalState.initial}
          onClose={() => setModalState(null)}
          onSuccess={async () => { setModalState(null); await reload(); }}
        />
      )}

      {/* Confirm de borrado: estandar O alternativo si bloqueado */}
      {deleteState && !deleteState.blocked && (
        <window.ConfirmModal
          open={true}
          title="Eliminar proveedor"
          message={`¿Eliminar a "${deleteState.target.nombre}"? Esta acción no se puede deshacer.`}
          confirmText="Eliminar" danger
          onClose={() => setDeleteState(null)}
          onConfirm={doDelete}/>
      )}
      {deleteState && deleteState.blocked && (
        <window.DesactivarFallbackModal
          entityLabel="proveedor"
          target={deleteState.target}
          msg={deleteState.msg}
          onClose={() => setDeleteState(null)}
          onDesactivar={doDesactivar}
          running={actionRunning}/>
      )}

      {bulkImportOpen && window.BulkImportSuppliersModal && (
        <window.BulkImportSuppliersModal
          onClose={() => setBulkImportOpen(false)}
          onSuccess={async () => { await reload(); }}/>
      )}
    </div>
  );
}

window.SuppliersTab = SuppliersTab;
