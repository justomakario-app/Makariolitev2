/* ══ EMPLOYEES TAB (S2.11)
   Listado + filtros + alta/edit/delete/bulk import de empleados.
   Patron suppliers-tab + toggle activos (S2.1) + bulk import (S2.4).
   SELECT directo (decision Jefe: reutilizar RLS).

   Filtros: busqueda nombre + modalidad + categoria.
   Acciones: editar, eliminar (fisico), reactivar (si inactivo).
   ══ */

function EmployeesTab() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [modalidadFilter, setModalidadFilter] = useState('todas');
  const [categoriaFilter, setCategoriaFilter] = useState('todas');
  const [showInactive, setShowInactive] = useState(false);
  const [modalState, setModalState] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionRunning, setActionRunning] = useState(false);
  const A = window.ADMIN_DATA;

  const reload = async () => {
    setLoading(true); setError(null);
    try {
      const data = await A.loadEmployees({ includeInactive: showInactive });
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

  const categoriasDisponibles = useMemo(() => {
    const set = new Set();
    items.forEach(it => { if (it.categoria) set.add(it.categoria); });
    return Array.from(set).sort();
  }, [items]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter(it => {
      if (modalidadFilter !== 'todas' && it.modalidad !== modalidadFilter) return false;
      if (categoriaFilter !== 'todas' && it.categoria !== categoriaFilter) return false;
      if (!q) return true;
      return (it.nombre || '').toLowerCase().includes(q)
          || (it.cuil   || '').toLowerCase().includes(q)
          || (it.email  || '').toLowerCase().includes(q);
    });
  }, [items, searchQuery, modalidadFilter, categoriaFilter]);

  const counts = useMemo(() => {
    const activos = items.filter(it => it.activo).length;
    const inactivos = items.filter(it => !it.activo).length;
    return { activos, inactivos };
  }, [items]);

  const onDelete = async () => {
    if (actionRunning || !confirmDeleteId) return;
    setActionRunning(true);
    try {
      await A.deleteEmployee({ id: confirmDeleteId });
      toast.success('Empleado eliminado');
      setConfirmDeleteId(null);
      await reload();
    } catch (err) {
      toast.error(err.message || 'No se pudo eliminar');
    } finally {
      setActionRunning(false);
    }
  };

  const doReactivar = async (e) => {
    try {
      await A.updateEmployee({ id: e.id, activo: true });
      toast.success('Empleado reactivado');
      await reload();
    } catch (err) {
      toast.error(err.message || 'No se pudo reactivar');
    }
  };

  const labelModalidad = (v) => {
    const o = (A.MODALIDAD_OPTIONS || []).find(x => x.value === v);
    return o ? o.label : (v || '—');
  };

  return (
    <div>
      {!loading && !error && (
        <div className="cta-cte-totals">
          <span><strong>Activos:</strong> {counts.activos}</span>
          {counts.inactivos > 0 && <span><strong>Inactivos:</strong> {counts.inactivos}</span>}
        </div>
      )}

      <div className="admin-tab-header">
        <div className="admin-search">
          <Icon n="search" s={14} c="var(--ink-muted)"/>
          <input className="filter-input admin-search-input"
                 placeholder="Buscar nombre, CUIL, email…"
                 value={searchQuery}
                 onChange={e => setSearchQuery(e.target.value)}/>
        </div>
        <select className="filter-select" value={modalidadFilter}
                onChange={e => setModalidadFilter(e.target.value)}>
          <option value="todas">Modalidad: todas</option>
          {(A.MODALIDAD_OPTIONS || []).map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {categoriasDisponibles.length > 0 && (
          <select className="filter-select" value={categoriaFilter}
                  onChange={e => setCategoriaFilter(e.target.value)}>
            <option value="todas">Categoría: todas</option>
            {categoriasDisponibles.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <label className="admin-toggle-inactive">
          <input type="checkbox" checked={showInactive}
                 onChange={e => setShowInactive(e.target.checked)}/>
          Mostrar inactivos
        </label>
        <button className="btn-ghost" onClick={() => setBulkImportOpen(true)}>
          <Icon n="upload" s={13}/> Importar masivo
        </button>
        <button className="btn-primary" onClick={() => setModalState({ mode: 'create' })}>
          <Icon n="plus" s={13}/> Nuevo empleado
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
          <h3>Todavía no cargaste empleados</h3>
          <p>Empezá agregando el primero o importá masivo desde Excel.</p>
          <button className="btn-primary" onClick={() => setModalState({ mode: 'create' })}>
            <Icon n="plus" s={13}/> Nuevo empleado
          </button>
        </div>
      ) : (
        <React.Fragment>
          <div className="card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>CUIL</th><th>Nombre</th><th>F.Ingreso</th>
                  <th>Categoría</th><th>Modalidad</th>
                  <th style={{textAlign:'right'}}>Sueldo bruto</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(emp => {
                  const isInactive = emp.activo === false;
                  return (
                    <tr key={emp.id} className={isInactive ? 'row-inactive' : ''}>
                      <td><span className="order-num">{emp.cuil || '—'}</span></td>
                      <td style={{fontWeight:600}}>{emp.nombre}</td>
                      <td>{A.formatDate(emp.fecha_ingreso)}</td>
                      <td>{emp.categoria || '—'}</td>
                      <td>{labelModalidad(emp.modalidad)}</td>
                      <td style={{textAlign:'right'}}>
                        {emp.sueldo_bruto_base != null ? A.formatMoney(emp.sueldo_bruto_base, 'ARS') : '—'}
                      </td>
                      <td className="cta-cte-actions">
                        {isInactive ? (
                          <button className="btn-ghost-sm btn-reactivate" title="Reactivar"
                                  onClick={() => doReactivar(emp)}>
                            <Icon n="refresh" s={12}/> Reactivar
                          </button>
                        ) : (
                          <React.Fragment>
                            <button className="btn-ghost-sm" title="Editar"
                                    onClick={() => setModalState({ mode: 'edit', initial: emp })}>
                              <Icon n="edit" s={12}/>
                            </button>
                            <button className="btn-ghost-sm danger" title="Eliminar"
                                    onClick={() => setConfirmDeleteId(emp.id)}>
                              <Icon n="trash" s={12}/>
                            </button>
                          </React.Fragment>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} style={{textAlign:'center', padding:'24px', color:'var(--ink-muted)'}}>
                    Sin resultados para los filtros aplicados
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="admin-tab-footer">
            {filtered.length === items.length
              ? `${items.length} empleado${items.length === 1 ? '' : 's'}`
              : `${filtered.length} de ${items.length}`}
          </div>
        </React.Fragment>
      )}

      {modalState && (
        <window.EmployeeModal
          mode={modalState.mode}
          initial={modalState.initial}
          onClose={() => setModalState(null)}
          onSuccess={async () => { setModalState(null); await reload(); }}/>
      )}

      <window.ConfirmModal
        open={!!confirmDeleteId}
        title="Eliminar empleado"
        message="¿Eliminar este empleado? Esta acción no se puede deshacer. Cuando exista recibos asociados, el sistema sugerirá desactivar en lugar de eliminar (S2.12)."
        confirmText="Eliminar" danger
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={onDelete}/>

      {bulkImportOpen && window.BulkImportEmployeesModal && (
        <window.BulkImportEmployeesModal
          onClose={() => setBulkImportOpen(false)}
          onSuccess={async () => { await reload(); }}/>
      )}
    </div>
  );
}

window.EmployeesTab = EmployeesTab;
