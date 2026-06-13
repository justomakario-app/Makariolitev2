/* ══ RECIBO ROW (S2.12)
   Subcomponente fila de un recibo en recibos-tab. Renderiza:
   nombre empleado · DNI · badge tipo · período · fecha pago ·
   total (en rojo si negativo) · estado (badge anulado si aplica) ·
   acciones (PDF, editar, anular, eliminar).

   Props: { recibo, companySettings, onEdit, onAnular, onDelete, onPdf }
   ══ */

function ReciboRow({ recibo, companySettings, onEdit, onAnular, onDelete, onPdf }) {
  const A = window.ADMIN_DATA;
  const isAnulado = recibo.estado === 'anulado';
  const isTotalNegativo = Number(recibo.total) < 0;
  const tipoOpt = (A.RECIBO_TIPO_OPTIONS || []).find(o => o.value === recibo.tipo);
  const tipoLabel = tipoOpt ? tipoOpt.label : (recibo.tipo || '—');

  const periodoTxt = recibo.periodo_desde && recibo.periodo_hasta
    ? `${A.formatDate(recibo.periodo_desde)} → ${A.formatDate(recibo.periodo_hasta)}`
    : '—';

  return (
    <tr className={isAnulado ? 'row-inactive' : ''}>
      <td style={{fontWeight:600}}>
        {recibo.empleado_nombre || '—'}
        {!recibo.employee_id && (
          <span className="badge-vencido" title="Empleado eliminado (snapshot histórico)">huérfano</span>
        )}
      </td>
      <td><span className="order-num">{recibo.empleado_dni || '—'}</span></td>
      <td>
        <span className={`recibo-tipo-badge recibo-tipo-${recibo.tipo}`}>{tipoLabel}</span>
        {isAnulado && <span className="badge-vencido" style={{marginLeft:6}}>anulado</span>}
      </td>
      <td>{periodoTxt}</td>
      <td>{A.formatDate(recibo.fecha_pago)}</td>
      <td style={{textAlign:'right', fontWeight:600, color: isTotalNegativo ? 'var(--red, #dc2626)' : undefined}}>
        {A.formatMoney(recibo.total, 'ARS')}
      </td>
      <td className="cta-cte-actions">
        <button className="btn-ghost-sm" title="Generar PDF"
                onClick={() => onPdf?.(recibo)}>
          <Icon n="download" s={12}/>
        </button>
        {!isAnulado && (
          <button className="btn-ghost-sm" title="Editar"
                  onClick={() => onEdit?.(recibo)}>
            <Icon n="edit" s={12}/>
          </button>
        )}
        {!isAnulado && (
          <button className="btn-ghost-sm danger" title="Anular"
                  onClick={() => onAnular?.(recibo)}>
            <Icon n="x" s={12}/>
          </button>
        )}
        <button className="btn-ghost-sm danger" title="Eliminar (físico)"
                onClick={() => onDelete?.(recibo)}>
          <Icon n="trash" s={12}/>
        </button>
      </td>
    </tr>
  );
}

window.ReciboRow = ReciboRow;
