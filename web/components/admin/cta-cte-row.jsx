/* ══ CTA CTE ROW (B.5)
   Fila de cuenta corriente + historial expandible inline.
   Movements automaticos (expense_id NOT NULL) → badge Auto + boton
   "Ver egreso" (navegacion cross-tab via ADMIN_NAV). NO editables.
   Movements manuales → botones Editar / Borrar.
   Props: { account, entityType, isExpanded, onToggle, onChanged }
   ══ */

function CtaCteRow({ account, entityType, isExpanded, onToggle, onChanged }) {
  const toast = useToast();
  const isSupplier = entityType === 'supplier';
  const entity = isSupplier ? account.suppliers : account.customers_b2b;
  const saldo = Number(account.saldo) || 0;
  const saldoColor = saldo > 0 ? 'var(--red)' : (saldo < 0 ? 'var(--green)' : 'var(--ink-muted)');

  const [movements, setMovements] = useState([]);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [modalState, setModalState] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const reloadMovements = async () => {
    setMovementsLoading(true);
    try {
      const data = isSupplier
        ? await window.ADMIN_DATA.loadSupplierMovements(account.id)
        : await window.ADMIN_DATA.loadCustomerMovements(account.id);
      setMovements(data);
    } catch (err) {
      toast.error(err.message || 'No se pudo cargar el historial');
    } finally {
      setMovementsLoading(false);
    }
  };

  useEffect(() => {
    if (!isExpanded) return;
    let cancelled = false;
    (async () => {
      setMovementsLoading(true);
      try {
        const data = isSupplier
          ? await window.ADMIN_DATA.loadSupplierMovements(account.id)
          : await window.ADMIN_DATA.loadCustomerMovements(account.id);
        if (!cancelled) setMovements(data);
      } catch (err) {
        if (!cancelled) toast.error(err.message || 'No se pudo cargar el historial');
      } finally {
        if (!cancelled) setMovementsLoading(false);
      }
    })();
    return () => { cancelled = true; };
    /* eslint-disable-next-line */
  }, [isExpanded, account.id]);

  const onMovementSuccess = async () => {
    setModalState(null);
    await reloadMovements();
    try { onChanged?.(); } catch (_) {}
  };

  const doDelete = async () => {
    if (deleting || !confirmDeleteId) return;
    setDeleting(true);
    try {
      const payload = { movement_id: confirmDeleteId };
      if (isSupplier) await window.ADMIN_DATA.deleteSupplierMovement(payload);
      else            await window.ADMIN_DATA.deleteCustomerMovement(payload);
      toast.success('Movimiento eliminado');
      setConfirmDeleteId(null);
      await reloadMovements();
      try { onChanged?.(); } catch (_) {}
    } catch (err) {
      toast.error(err.message || 'No se pudo eliminar');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <React.Fragment>
      <tr className="expense-row" onClick={onToggle}>
        <td style={{fontWeight:600}}>{entity?.nombre || '—'}</td>
        <td><span className="order-num">{entity?.cuit || '—'}</span></td>
        <td style={{textAlign:'right', fontWeight:700, color: saldoColor}}>
          {window.ADMIN_DATA.formatMoney(saldo, 'ARS')}
        </td>
      </tr>

      {isExpanded && (
        <tr className="expense-row-expanded">
          <td colSpan={3}>
            <div className="cta-cte-history">
              <div className="cta-cte-history-header">
                <strong>Movimientos</strong>
                <button className="btn-primary"
                        onClick={(e) => { e.stopPropagation(); setModalState({ mode: 'create' }); }}>
                  <Icon n="plus" s={13}/> Nuevo movimiento
                </button>
              </div>

              {movementsLoading ? (
                <div className="admin-empty-state"><span className="loader" style={{width:20, height:20}}/></div>
              ) : movements.length === 0 ? (
                <div className="cta-cte-empty">Sin movimientos todavia.</div>
              ) : (
                <table className="data-table cta-cte-movements-table">
                  <thead>
                    <tr>
                      <th>Fecha</th><th>Tipo</th><th>Concepto</th>
                      <th style={{textAlign:'right'}}>Monto</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map(m => {
                      const isAuto = isSupplier && (m.expense_id || m.check_id);
                      const isPositive = (isSupplier && (m.tipo === 'compra' || m.tipo === 'ajuste'))
                                      || (!isSupplier && (m.tipo === 'cargo'  || m.tipo === 'ajuste'));
                      return (
                        <tr key={m.id}>
                          <td>{window.ADMIN_DATA.formatDate(m.fecha)}</td>
                          <td>
                            <span className="expense-tag">{m.tipo}</span>
                            {isAuto && <span className="cta-cte-badge-auto" title="Generado automaticamente">Auto</span>}
                          </td>
                          <td title={m.concepto}>{m.concepto}</td>
                          <td style={{textAlign:'right', fontWeight:600, color: isPositive ? 'var(--red)' : 'var(--green)'}}>
                            {isPositive ? '+' : '−'}{window.ADMIN_DATA.formatMoney(Math.abs(Number(m.monto)), 'ARS')}
                          </td>
                          <td className="cta-cte-actions" onClick={(e) => e.stopPropagation()}>
                            {isAuto ? (
                              m.expense_id ? (
                                <button className="btn-ghost-sm"
                                        title="Ver egreso original"
                                        onClick={() => window.ADMIN_NAV.goToExpense(m.expense_id)}>
                                  <Icon n="arrow-right" s={12}/> Ver egreso
                                </button>
                              ) : null
                            ) : (
                              <React.Fragment>
                                <button className="btn-ghost-sm" title="Editar"
                                        onClick={() => setModalState({ mode: 'edit', initial: m })}>
                                  <Icon n="edit" s={12}/>
                                </button>
                                <button className="btn-ghost-sm danger" title="Eliminar"
                                        onClick={() => setConfirmDeleteId(m.id)}>
                                  <Icon n="trash" s={12}/>
                                </button>
                              </React.Fragment>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </td>
        </tr>
      )}

      {modalState && (
        <window.CtaCteMovementModal
          entityType={entityType}
          mode={modalState.mode}
          accountId={account.id}
          initial={modalState.initial}
          onClose={() => setModalState(null)}
          onSuccess={onMovementSuccess}/>
      )}

      <window.ConfirmModal
        open={!!confirmDeleteId}
        title="Eliminar movimiento"
        message="¿Seguro que querés eliminar este movimiento? El saldo se ajustará automáticamente."
        confirmText="Eliminar" danger
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={doDelete}/>
    </React.Fragment>
  );
}

window.CtaCteRow = CtaCteRow;
