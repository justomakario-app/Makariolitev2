/* ══ CHECK ROW (B.4)
   Fila de cheque con badge de vencimiento + acciones segun estado.
   Solo cheques en estado='emitido' tienen botones editar/eliminar/
   cambiar estado. Resto solo lectura.
   Props: { check, checkType, onEdit, onChangeStatus, onDelete }
   ══ */

function CheckRow({ check, checkType, onEdit, onChangeStatus, onDelete }) {
  const isIssued = checkType === 'issued';
  const venceProximo = window.ADMIN_DATA.isVenceProximo(check);
  const isEmitido = check.estado === 'emitido';

  const entity = isIssued ? check.suppliers : check.customers_b2b;
  const partyTexto = isIssued ? check.beneficiario_texto : check.emisor_texto;
  const partyDisplay = (entity && entity.nombre) || partyTexto || '—';

  return (
    <tr className="check-row">
      <td>{window.ADMIN_DATA.formatDate(check.fecha_emision)}</td>
      <td><span className="order-num">{check.numero}</span></td>
      <td>{check.banco}</td>
      <td style={{fontWeight: 600}}>{partyDisplay}</td>
      <td>
        {check.fecha_cobro_estimada
          ? window.ADMIN_DATA.formatDate(check.fecha_cobro_estimada)
          : <span style={{color:'var(--ink-faint)'}}>—</span>}
        {' '}
        {venceProximo === 'vencido'   && <span className="badge-vencido">Vencido</span>}
        {venceProximo === 'por_vencer' && <span className="badge-por-vencer">Por vencer</span>}
      </td>
      <td style={{textAlign:'right', fontWeight:600}}>
        {window.ADMIN_DATA.formatMoney(check.monto, 'ARS')}
      </td>
      <td>
        <span className={`check-status-pill estado-${check.estado}`}>{check.estado}</span>
      </td>
      <td className="cta-cte-actions">
        {isEmitido ? (
          <React.Fragment>
            <button className="btn-ghost-sm" title="Editar"
                    onClick={() => onEdit(check)}>
              <Icon n="edit" s={12}/>
            </button>
            <button className="btn-ghost-sm" title="Cambiar estado"
                    onClick={() => onChangeStatus(check)}>
              <Icon n="refresh" s={12}/>
            </button>
            <button className="btn-ghost-sm danger" title="Eliminar"
                    onClick={() => onDelete(check)}>
              <Icon n="trash" s={12}/>
            </button>
          </React.Fragment>
        ) : (
          <span className="check-locked-hint" title="Solo cheques emitidos son editables">
            <Icon n="lock" s={12}/>
          </span>
        )}
      </td>
    </tr>
  );
}

window.CheckRow = CheckRow;
