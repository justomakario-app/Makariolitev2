/* ══ EXPENSES TAB (B.3)
   Listado de egresos con filtros (fecha preset, categoría, medio,
   búsqueda) + alta. Server-side filter por rango de fecha;
   client-side filter para search/categoría/medio. Fila expandible
   inline con notas, IVA, fecha de creación. Lazy mount. ══ */

function ExpensesTab({ pendingExpenseId, clearPending }) {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [filters, setFilters] = useState({
    search: '',
    dateRange: 'ultimos_90',  // si vino con pendingExpenseId, mas amplio = mas chance de encontrarlo
    customFrom: '',
    customTo: '',
    categoria: 'todas',
    medio_pago: 'todos',
  });
  const [expandedRowId, setExpandedRowId] = useState(null);
  const [modalState, setModalState] = useState(null);  // S2.1: null | {mode, initial?}
  const [deleteState, setDeleteState] = useState(null); // S2.1: null | {target, blocked?, msg?}
  const [showInactive, setShowInactive] = useState(false);
  const [actionRunning, setActionRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /* B.5: si llega pendingExpenseId del bus ADMIN_NAV (boton "Ver egreso"
     en cta cte), abrir esa fila + scrollear. Cuando los items cargan y el
     id matchea, expandir + clear pending. */
  useEffect(() => {
    if (!pendingExpenseId || items.length === 0) return;
    if (items.some(it => it.id === pendingExpenseId)) {
      setExpandedRowId(pendingExpenseId);
      // Scroll suave si el row existe en el DOM
      setTimeout(() => {
        const el = document.querySelector(`[data-expense-id="${pendingExpenseId}"]`);
        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
      try { clearPending?.(); } catch (_) {}
    }
    /* eslint-disable-next-line */
  }, [pendingExpenseId, items]);

  const reload = async () => {
    setLoading(true); setError(null);
    try {
      const { from, to } = window.ADMIN_DATA.dateRangeForPreset(
        filters.dateRange, filters.customFrom, filters.customTo);
      const [exp, sups] = await Promise.all([
        window.ADMIN_DATA.loadExpenses({ dateFrom: from, dateTo: to, includeInactive: showInactive }),
        window.ADMIN_DATA.loadSuppliers(),
      ]);
      setItems(exp);
      setSuppliers(sups);
    } catch (err) {
      const msg = err?.message || 'Error desconocido';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  /* Re-fetch al cambiar rango de fecha (server-side) o toggle inactivos. */
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [
    filters.dateRange, filters.customFrom, filters.customTo, showInactive,
  ]);

  /* S2.1: handlers de edit/delete/desactivar/reactivar */
  const onDeleteClick = (e) => setDeleteState({ target: e });

  const doDelete = async () => {
    if (actionRunning || !deleteState) return;
    setActionRunning(true);
    try {
      await window.ADMIN_DATA.deleteExpense({ id: deleteState.target.id });
      toast.success('Egreso eliminado');
      setDeleteState(null);
      await reload();
    } catch (err) {
      if (err && err.hint === 'has_relations') {
        setDeleteState({
          target: deleteState.target,
          blocked: true,
          msg: err.message,
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
      const t = deleteState.target;
      await window.ADMIN_DATA.updateExpense({
        id: t.id,
        fecha: String(t.fecha).slice(0,10),
        supplier_id: t.supplier_id || null,
        concepto: t.concepto,
        monto_total: String(t.monto_total),
        moneda: t.moneda,
        iva_discriminado: t.iva_discriminado != null ? String(t.iva_discriminado) : null,
        categoria: t.categoria,
        medio_pago: t.medio_pago,
        notas: t.notas,
        activo: false,
      });
      toast.success('Egreso desactivado');
      setDeleteState(null);
      await reload();
    } catch (err) {
      toast.error(err.message || 'No se pudo desactivar');
    } finally {
      setActionRunning(false);
    }
  };

  const doReactivar = async (e) => {
    try {
      await window.ADMIN_DATA.updateExpense({
        id: e.id,
        fecha: String(e.fecha).slice(0,10),
        supplier_id: e.supplier_id || null,
        concepto: e.concepto,
        monto_total: String(e.monto_total),
        moneda: e.moneda,
        iva_discriminado: e.iva_discriminado != null ? String(e.iva_discriminado) : null,
        categoria: e.categoria,
        medio_pago: e.medio_pago,
        notas: e.notas,
        activo: true,
      });
      toast.success('Egreso reactivado');
      await reload();
    } catch (err) {
      toast.error(err.message || 'No se pudo reactivar');
    }
  };

  /* Client-side filter sobre el subconjunto cargado. */
  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return items.filter(it => {
      if (filters.categoria !== 'todas' && it.categoria !== filters.categoria) return false;
      if (filters.medio_pago !== 'todos' && it.medio_pago !== filters.medio_pago) return false;
      if (q) {
        const suppName = (it.suppliers?.nombre || '').toLowerCase();
        const c = (it.concepto || '').toLowerCase();
        const n = (it.notas || '').toLowerCase();
        if (!c.includes(q) && !n.includes(q) && !suppName.includes(q)) return false;
      }
      return true;
    });
  }, [items, filters]);

  /* Totales por moneda sobre el filtrado. */
  const totales = useMemo(() => {
    const acc = { ARS: 0, USD: 0 };
    filtered.forEach(it => { acc[it.moneda || 'ARS'] += Number(it.monto_total) || 0; });
    return acc;
  }, [filtered]);

  return (
    <div>
      <div className="admin-tab-header expense-filters">
        <div className="admin-search">
          <Icon n="search" s={14} c="var(--ink-muted)"/>
          <input className="filter-input admin-search-input"
                 placeholder="Buscar concepto, notas, proveedor…"
                 value={filters.search}
                 onChange={e => setFilters(f => ({...f, search: e.target.value}))}/>
        </div>
        <select className="filter-select" value={filters.dateRange}
                onChange={e => setFilters(f => ({...f, dateRange: e.target.value}))}>
          <option value="mes_actual">Mes actual</option>
          <option value="mes_pasado">Mes pasado</option>
          <option value="ultimos_90">Últimos 90 días</option>
          <option value="personalizado">Personalizado</option>
        </select>
        {filters.dateRange === 'personalizado' && (
          <React.Fragment>
            <input type="date" className="filter-input" value={filters.customFrom}
                   onChange={e => setFilters(f => ({...f, customFrom: e.target.value}))}/>
            <input type="date" className="filter-input" value={filters.customTo}
                   onChange={e => setFilters(f => ({...f, customTo: e.target.value}))}/>
          </React.Fragment>
        )}
        <select className="filter-select" value={filters.categoria}
                onChange={e => setFilters(f => ({...f, categoria: e.target.value}))}>
          <option value="todas">Todas las categorías</option>
          <option value="insumos">Insumos</option>
          <option value="servicios">Servicios</option>
          <option value="sueldos">Sueldos</option>
          <option value="impuestos">Impuestos</option>
          <option value="otros">Otros</option>
        </select>
        <select className="filter-select" value={filters.medio_pago}
                onChange={e => setFilters(f => ({...f, medio_pago: e.target.value}))}>
          <option value="todos">Todos los medios</option>
          <option value="efectivo">Efectivo</option>
          <option value="transferencia">Transferencia</option>
          <option value="cheque">Cheque</option>
          <option value="tarjeta">Tarjeta</option>
          <option value="otro">Otro</option>
        </select>
        <label className="admin-toggle-inactive">
          <input type="checkbox" checked={showInactive}
                 onChange={e => setShowInactive(e.target.checked)}/>
          Mostrar inactivos
        </label>
        <button className="btn-primary" onClick={() => setModalState({ mode: 'create' })}>
          <Icon n="plus" s={13}/> Nuevo egreso
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
          <h3>Todavia no cargaste egresos</h3>
          <p>Empezá agregando el primero.</p>
          <button className="btn-primary" onClick={() => setModalState({ mode: 'create' })}>
            <Icon n="plus" s={13}/> Nuevo egreso
          </button>
        </div>
      ) : (
        <React.Fragment>
          <div className="card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Fecha</th><th>Proveedor</th><th>Concepto</th>
                  <th>Categoría</th><th>Medio</th>
                  <th style={{textAlign:'right'}}>Monto</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(it => {
                  const isExpanded = expandedRowId === it.id;
                  const isInactive = it.activo === false;
                  const txt = it.concepto || '';
                  const truncated = txt.length > 40 ? txt.slice(0, 40) + '…' : txt;
                  return (
                    <React.Fragment key={it.id}>
                      <tr className={`expense-row ${isInactive ? 'row-inactive' : ''}`}
                          data-expense-id={it.id}
                          onClick={() => setExpandedRowId(isExpanded ? null : it.id)}>
                        <td>{window.ADMIN_DATA.formatDate(it.fecha)}</td>
                        <td>{it.suppliers?.nombre
                          || <span style={{color:'var(--ink-faint)'}}>—</span>}</td>
                        <td title={txt}>{truncated}</td>
                        <td><span className="expense-tag">{it.categoria}</span></td>
                        <td><span className="expense-tag">{it.medio_pago}</span></td>
                        <td style={{textAlign:'right', fontWeight:600}}>
                          {window.ADMIN_DATA.formatMoney(it.monto_total, it.moneda)}
                        </td>
                        <td className="cta-cte-actions" onClick={(e) => e.stopPropagation()}>
                          {isInactive ? (
                            <button className="btn-ghost-sm btn-reactivate" title="Reactivar"
                                    onClick={() => doReactivar(it)}>
                              <Icon n="refresh" s={12}/> Reactivar
                            </button>
                          ) : (
                            <React.Fragment>
                              <button className="btn-ghost-sm" title="Editar"
                                      onClick={() => setModalState({ mode: 'edit', initial: it })}>
                                <Icon n="edit" s={12}/>
                              </button>
                              <button className="btn-ghost-sm danger" title="Eliminar"
                                      onClick={() => onDeleteClick(it)}>
                                <Icon n="trash" s={12}/>
                              </button>
                            </React.Fragment>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="expense-row-expanded">
                          <td colSpan={7}>
                            <div className="expense-detail">
                              <div><strong>Notas:</strong> {it.notas || '—'}</div>
                              <div><strong>IVA discriminado:</strong> {it.iva_discriminado != null
                                ? window.ADMIN_DATA.formatMoney(it.iva_discriminado, it.moneda)
                                : '—'}</div>
                              <div><strong>Creado:</strong> {new Date(it.created_at).toLocaleString('es-AR')}</div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
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
            <span>{filtered.length} egreso{filtered.length === 1 ? '' : 's'}</span>
            <span style={{marginLeft:16}}>
              Total: {window.ADMIN_DATA.formatMoney(totales.ARS, 'ARS')}
              {totales.USD > 0 && <> · {window.ADMIN_DATA.formatMoney(totales.USD, 'USD')}</>}
            </span>
          </div>
        </React.Fragment>
      )}

      {modalState && (
        <window.ExpenseModal
          suppliers={suppliers}
          mode={modalState.mode}
          initial={modalState.initial}
          onClose={() => setModalState(null)}
          onSuccess={async () => { setModalState(null); await reload(); }}
        />
      )}

      {deleteState && !deleteState.blocked && (
        <window.ConfirmModal
          open={true}
          title="Eliminar egreso"
          message={`¿Eliminar el egreso "${deleteState.target.concepto}"? Esta acción no se puede deshacer.`}
          confirmText="Eliminar" danger
          onClose={() => setDeleteState(null)}
          onConfirm={doDelete}/>
      )}
      {deleteState && deleteState.blocked && (
        <window.DesactivarFallbackModal
          entityLabel="egreso"
          target={deleteState.target}
          msg={deleteState.msg}
          onClose={() => setDeleteState(null)}
          onDesactivar={doDesactivar}
          running={actionRunning}/>
      )}
    </div>
  );
}

window.ExpensesTab = ExpensesTab;
