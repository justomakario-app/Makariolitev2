/* ══ BULK IMPORT ROW (S2.4)
   Subcomponente: una fila de la tabla preview del bulk import de
   proveedores. Renderiza pill de estado + datos truncados + dropdown
   de accion (solo si es duplicado).

   Props:
     - row: { rowNum, isValid, isDuplicate, errors, normalized,
              existingMatch?: {id, nombre, activo} }
     - action: 'create' | 'skip' | 'update' | 'none'  // 'none' para invalidas
     - onActionChange: (newAction) => void
   ══ */

function BulkImportRow({ row, action, onActionChange }) {
  const isInvalid   = !row.isValid;
  const isDuplicate = row.isDuplicate;

  /* Determinar pill de estado */
  let pillClass = 'bulk-pill-valid';
  let pillText  = 'Válido';
  if (isInvalid) {
    pillClass = 'bulk-pill-invalid';
    pillText  = 'Inválido';
  } else if (isDuplicate) {
    pillClass = 'bulk-pill-duplicate';
    pillText  = 'Duplicado';
  }

  /* Truncar campos largos para vista compacta */
  const trunc = (s, n) => {
    const v = String(s || '');
    if (v.length <= n) return v;
    return v.slice(0, n - 1) + '…';
  };

  const n = row.normalized || {};
  const errorText = isInvalid && row.errors && row.errors.length > 0
    ? row.errors.join(' · ')
    : null;

  return (
    <tr className={`bulk-import-row ${isInvalid ? 'is-invalid' : isDuplicate ? 'is-duplicate' : 'is-valid'}`}>
      <td className="bulk-cell-num">{row.rowNum}</td>
      <td className="bulk-cell-status">
        <span className={`bulk-pill ${pillClass}`}>{pillText}</span>
      </td>
      <td className="bulk-cell-nombre">
        <div>{trunc(n.nombre, 30)}</div>
        {errorText && <div className="bulk-cell-error">{errorText}</div>}
        {isDuplicate && row.existingMatch && (
          <div className="bulk-cell-hint">
            ↳ Ya existe: {trunc(row.existingMatch.nombre, 28)}
            {row.existingMatch.activo === false && ' (inactivo)'}
          </div>
        )}
      </td>
      <td className="bulk-cell-cuit">
        <span className="order-num">{n.cuit || '—'}</span>
      </td>
      <td className="bulk-cell-email">{trunc(n.email, 24) || '—'}</td>
      <td className="bulk-cell-action">
        {isInvalid ? (
          <span className="bulk-action-none">—</span>
        ) : isDuplicate ? (
          <select className="bulk-action-select"
                  value={action || 'skip'}
                  onChange={e => onActionChange(e.target.value)}>
            <option value="skip">Saltar</option>
            <option value="update">Actualizar</option>
          </select>
        ) : (
          <span className="bulk-action-create"><Icon n="plus" s={10}/> Crear</span>
        )}
      </td>
    </tr>
  );
}

window.BulkImportRow = BulkImportRow;
