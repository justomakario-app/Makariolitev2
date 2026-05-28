/* ══ CIERRES HISTORIAL ROW (Fase 8)
   Fila individual de la sección "Historial de cierres" en cash-flow.jsx.
   Renderiza: tipo + período + saldo cierre + saldo acumulado + estado
   + acciones (ver reporte placeholder Etapa 3 / reabrir solo owner).

   Props: {
     cierre,              // objeto del backend
     userRole,            // 'owner' | 'admin' (para gating de Reabrir)
     hasPosterior,        // boolean — si tiene cierres posteriores cerrados
     onVerReporte,        // callback (placeholder Etapa 3)
     onReabrir,           // callback que abre modal de reapertura
   }
   ══ */

function CierresHistorialRow({ cierre, userRole, hasPosterior, onVerReporte, onReabrir }) {
  const A = window.ADMIN_DATA;
  const isCerrado    = cierre.estado === 'cerrado';
  const isReabierto  = cierre.estado === 'reabierto';
  const saldoNeg     = Number(cierre.saldo_cierre) < 0;
  const acumNeg      = Number(cierre.saldo_acumulado_historico) < 0;

  const tipoLabel = cierre.tipo === 'anual' ? 'Anual' : 'Mensual';
  const periodoLabel = `${A.formatDate(cierre.periodo_desde)} → ${A.formatDate(cierre.periodo_hasta)}`;

  /* Reabrir solo si owner + cerrado + sin posteriores */
  const puedeReabrir = userRole === 'owner' && isCerrado;
  const reabrirDisabled = puedeReabrir && hasPosterior;
  const reabrirTitle = !puedeReabrir
    ? (isReabierto ? 'Ya reabierto' : 'Solo owner puede reabrir')
    : (reabrirDisabled
        ? 'Reabrí primero los cierres posteriores'
        : 'Reabrir este cierre');

  return (
    <tr className={isReabierto ? 'row-inactive' : ''}>
      <td>
        <span className={`cierre-tipo-badge cierre-tipo-${cierre.tipo}`}>{tipoLabel}</span>
      </td>
      <td>{periodoLabel}</td>
      <td style={{textAlign:'right', fontWeight:600, color: saldoNeg ? 'var(--red, #dc2626)' : undefined}}>
        {A.formatMoneyES(cierre.saldo_cierre || 0)}
      </td>
      <td style={{textAlign:'right', fontWeight:600, color: acumNeg ? 'var(--red, #dc2626)' : undefined}}>
        {A.formatMoneyES(cierre.saldo_acumulado_historico || 0)}
      </td>
      <td>
        {isCerrado
          ? <span className="cierre-estado-cerrado">🔒 Cerrado</span>
          : <span className="cierre-estado-reabierto">🔓 Reabierto</span>}
      </td>
      <td className="cta-cte-actions">
        <button className="btn-ghost-sm"
                title="Ver reporte"
                onClick={() => onVerReporte?.(cierre)}>
          <Icon n="download" s={12}/>
        </button>
        {puedeReabrir && (
          <button className="btn-ghost-sm"
                  title={reabrirTitle}
                  disabled={reabrirDisabled}
                  onClick={() => onReabrir?.(cierre)}>
            🔓 Reabrir
          </button>
        )}
      </td>
    </tr>
  );
}

window.CierresHistorialRow = CierresHistorialRow;
