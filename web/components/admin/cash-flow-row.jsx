/* ══ CASH FLOW ROW (S2.16)
   Fila individual de la tabla cash flow. Renderiza 4 categorias +
   total dia + saldo acumulado + badge real/proyectado.

   Las filas vienen agregadas por fecha desde el RPC (no son items
   individuales sino totales del dia), por lo que NO hay acciones
   inline (edit/delete). Para editar un movimiento manual especifico
   se accede via la seccion "Movimientos manuales" del dashboard
   (lista filtrable).

   Props: { fila, modo: 'dia'|'mes' }
   ══ */

function CashFlowRow({ fila, modo }) {
  const A = window.ADMIN_DATA;
  const esProy = fila.clase === 'proyectado';
  const totalNeg = Number(fila.total_dia) < 0;
  const saldoNeg = Number(fila.saldo_acumulado) < 0;

  const fechaLabel = modo === 'mes'
    ? formatMonthYear(fila.fecha || fila.ym)
    : A.formatDate(fila.fecha);

  return (
    <tr className={esProy ? 'cf-row-proyectado' : ''}>
      <td>
        {fechaLabel}
        {esProy && <span className="cf-badge-proyectado" title="Cheques pendientes de cobro">proyectado</span>}
      </td>
      <td style={{textAlign:'right'}}>{fmtCell(fila.compras, A)}</td>
      <td style={{textAlign:'right'}}>{fmtCell(fila.sueldos, A)}</td>
      <td style={{textAlign:'right'}}>{fmtCell(fila.cheques, A)}</td>
      <td style={{textAlign:'right'}}>{fmtCell(fila.otros, A)}</td>
      <td style={{textAlign:'right', fontWeight:600, color: totalNeg ? 'var(--red, #dc2626)' : undefined}}>
        {A.formatMoneyES(fila.total_dia || 0)}
      </td>
      <td style={{textAlign:'right', fontWeight:600, color: saldoNeg ? 'var(--red, #dc2626)' : undefined}}>
        {A.formatMoneyES(fila.saldo_acumulado || 0)}
      </td>
    </tr>
  );
}

function fmtCell(v, A) {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return <span style={{color:'var(--ink-muted)'}}>—</span>;
  const negativo = n < 0;
  return (
    <span style={{color: negativo ? 'var(--red, #dc2626)' : undefined}}>
      {A.formatMoneyES(n)}
    </span>
  );
}

function formatMonthYear(s) {
  if (!s) return '—';
  const m = String(s).match(/^(\d{4})-(\d{2})/);
  if (!m) return s;
  const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${meses[Number(m[2]) - 1]} ${m[1]}`;
}

window.CashFlowRow = CashFlowRow;
