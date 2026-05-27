/* ══ HISTORIAL EMPLEADO ROW (S2.15)
   Subcomponente fila de la tabla de recibos en el modal histórico.
   Solo lectura. Acción única: "Ver PDF".

   Props: { recibo, companySettings, onPdf }
   ══ */

function HistorialEmpleadoRow({ recibo, companySettings, onPdf }) {
  const A = window.ADMIN_DATA;
  const tipoOpt = (A.RECIBO_TIPO_OPTIONS || []).find(o => o.value === recibo.tipo);
  const tipoLabel = tipoOpt ? tipoOpt.label : (recibo.tipo || '—');

  const periodoTxt = recibo.periodo_desde && recibo.periodo_hasta
    ? `${A.formatDate(recibo.periodo_desde)} → ${A.formatDate(recibo.periodo_hasta)}`
    : '—';

  return (
    <tr>
      <td>
        <span className={`recibo-tipo-badge recibo-tipo-${recibo.tipo}`}>{tipoLabel}</span>
      </td>
      <td>{periodoTxt}</td>
      <td>{A.formatDate(recibo.fecha_pago)}</td>
      <td style={{textAlign:'right'}}>
        {recibo.sueldo_basico != null ? A.formatMoney(recibo.sueldo_basico, 'ARS') : '—'}
      </td>
      <td style={{textAlign:'right', fontWeight:600}}>
        {A.formatMoney(recibo.total, 'ARS')}
      </td>
      <td>{recibo.notas || '—'}</td>
      <td className="cta-cte-actions">
        <button className="btn-ghost-sm" title="Ver PDF"
                onClick={() => onPdf?.(recibo)}>
          <Icon n="download" s={12}/>
        </button>
      </td>
    </tr>
  );
}

window.HistorialEmpleadoRow = HistorialEmpleadoRow;
