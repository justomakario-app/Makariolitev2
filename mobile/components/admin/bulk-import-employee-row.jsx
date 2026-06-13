/* ══ BULK IMPORT EMPLOYEE ROW (S2.11)
   Subcomponente: una fila de la tabla preview del bulk import de
   empleados. Pill estado + datos truncados + dropdown action si dup.

   Props:
     - row: { rowNum, isValid, isDuplicate, errors, normalized,
              existingMatch? }
     - action: 'create' | 'skip' | 'update' | 'none'
     - onActionChange: (newAction) => void
   ══ */

function BulkImportEmployeeRow({ row, action, onActionChange }) {
  const isInvalid   = !row.isValid;
  const isDuplicate = row.isDuplicate;
  const n = row.normalized || {};

  let pillClass = 'bulk-pill-valid';
  let pillText  = 'Válido';
  if (isInvalid) {
    pillClass = 'bulk-pill-invalid';
    pillText  = 'Inválido';
  } else if (isDuplicate) {
    pillClass = 'bulk-pill-duplicate';
    pillText  = 'Duplicado';
  }

  const trunc = (s, m) => {
    const v = String(s || '');
    return v.length <= m ? v : v.slice(0, m - 1) + '…';
  };
  const errorText = isInvalid && row.errors && row.errors.length > 0
    ? row.errors.join(' · ')
    : null;

  return (
    <tr className={`bulk-import-row ${isInvalid ? 'is-invalid' : isDuplicate ? 'is-duplicate' : 'is-valid'}`}>
      <td className="bulk-cell-num">{row.rowNum}</td>
      <td className="bulk-cell-status">
        <span className={`bulk-pill ${pillClass}`}>{pillText}</span>
      </td>
      <td>
        <span className="order-num">{n.dni || '—'}</span>
      </td>
      <td className="bulk-cell-nombre">
        <div>{trunc(n.nombre, 30)}</div>
        {errorText && <div className="bulk-cell-error">{errorText}</div>}
        {isDuplicate && row.existingMatch && (
          <div className="bulk-cell-hint">
            ↳ Ya existe: {trunc(row.existingMatch.nombre, 26)}
            {row.existingMatch.activo === false && ' (inactivo)'}
          </div>
        )}
      </td>
      <td>{trunc(n.categoria, 16) || '—'}</td>
      <td>{trunc(n.modalidad, 12) || '—'}</td>
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

window.BulkImportEmployeeRow = BulkImportEmployeeRow;
