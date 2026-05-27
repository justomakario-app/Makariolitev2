/* ══ CASH FLOW TABLE (S2.16)
   Tabla principal del dashboard con 4 categorias + total + saldo acum.

   Props: {
     filas: array de filas (reales o proyectadas o ambas, ya combinadas)
     modo: 'dia' | 'mes'
     emptyMessage: string (default "Sin movimientos en este período")
   }

   Header sticky cuando se scrollea (CSS).
   ══ */

function CashFlowTable({ filas, modo, emptyMessage }) {
  const rows = Array.isArray(filas) ? filas : [];
  return (
    <div className="card cf-table-wrap">
      <table className="data-table cf-table">
        <thead>
          <tr>
            <th>{modo === 'mes' ? 'Mes' : 'Fecha'}</th>
            <th style={{textAlign:'right'}}>Compras</th>
            <th style={{textAlign:'right'}}>Sueldos</th>
            <th style={{textAlign:'right'}}>Cheques</th>
            <th style={{textAlign:'right'}}>Otros</th>
            <th style={{textAlign:'right'}}>Total {modo === 'mes' ? 'mes' : 'día'}</th>
            <th style={{textAlign:'right'}}>Saldo acum.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((fila, idx) => (
            <window.CashFlowRow
              key={`${fila.clase || 'real'}-${fila.fecha || idx}`}
              fila={fila}
              modo={modo}/>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={7} style={{textAlign:'center', padding:'24px', color:'var(--ink-muted)'}}>
              {emptyMessage || 'Sin movimientos en este período'}
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

window.CashFlowTable = CashFlowTable;
