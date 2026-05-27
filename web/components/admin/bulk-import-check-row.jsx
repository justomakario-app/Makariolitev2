/* ══ BULK IMPORT CHECK ROW (S2.5)
   Subcomponente: una fila de la tabla preview del bulk import de
   cheques. Renderiza pill de estado + datos + dropdown action +
   checkbox "Cta cte" para generar movement.

   Props:
     - row: { rowNum, isValid, isDuplicate, errors, normalized,
              existingMatch?, entityMatch? }
     - kind: 'issued' | 'received'
     - action: 'create' | 'skip' | 'update' | 'none'
     - generarMovement: boolean
     - onActionChange: (newAction) => void
     - onMovementChange: (boolean) => void
   ══ */

function BulkImportCheckRow({ row, kind, action, generarMovement, onActionChange, onMovementChange }) {
  const isInvalid   = !row.isValid;
  const isDuplicate = row.isDuplicate;
  const isReceived  = kind === 'received';

  const cuitField   = isReceived ? 'emisor_cuit'   : 'beneficiario_cuit';
  const nombreField = isReceived ? 'emisor_nombre' : 'beneficiario_nombre';
  const n = row.normalized || {};

  /* Status pill */
  let pillClass = 'bulk-pill-valid';
  let pillText  = 'Válido';
  if (isInvalid) {
    pillClass = 'bulk-pill-invalid';
    pillText  = 'Inválido';
  } else if (isDuplicate) {
    pillClass = 'bulk-pill-duplicate';
    pillText  = 'Duplicado';
  }

  const trunc = (s, n) => {
    const v = String(s || '');
    if (v.length <= n) return v;
    return v.slice(0, n - 1) + '…';
  };

  const A = window.ADMIN_DATA;

  /* ¿Esta fila tiene entity matched? Determina si el checkbox de movement
     está activo. entityMatch viene seteado desde el modal cuando se
     ejecuto resolveEntitiesByCuit y hubo match. */
  const hasEntityMatch = !!row.entityMatch;
  const movementDisabled = isInvalid || !hasEntityMatch;

  const errorText = isInvalid && row.errors && row.errors.length > 0
    ? row.errors.join(' · ')
    : null;

  /* Texto entidad: si hay match → nombre del match, sino el texto del archivo */
  const entityNombre = hasEntityMatch
    ? row.entityMatch.nombre
    : (n[nombreField] || '');
  const entityHint = isValid_(row) && (n[cuitField] && !hasEntityMatch)
    ? `↳ ${isReceived ? 'Customer' : 'Proveedor'} no encontrado por CUIT`
    : null;

  function isValid_(r) { return r.isValid; }

  return (
    <tr className={`bulk-import-row ${isInvalid ? 'is-invalid' : isDuplicate ? 'is-duplicate' : 'is-valid'}`}>
      <td className="bulk-cell-num">{row.rowNum}</td>
      <td className="bulk-cell-status">
        <span className={`bulk-pill ${pillClass}`}>{pillText}</span>
      </td>
      <td><span className="order-num">{n.numero || '—'}</span></td>
      <td>{trunc(n.banco, 16) || '—'}</td>
      <td style={{textAlign:'right'}}>
        {n.monto ? A.formatMoney(n.monto, 'ARS') : '—'}
      </td>
      <td className="bulk-cell-nombre">
        <div>{trunc(entityNombre, 26) || '—'}</div>
        {entityHint && <div className="bulk-cell-hint">{entityHint}</div>}
        {errorText && <div className="bulk-cell-error">{errorText}</div>}
        {isDuplicate && row.existingMatch && (
          <div className="bulk-cell-hint">
            ↳ Ya existe (#{row.existingMatch.numero}, {trunc(row.existingMatch.banco, 14)})
          </div>
        )}
      </td>
      <td>
        {n.estado && <span className={`check-status-pill estado-${n.estado}`}>{n.estado}</span>}
      </td>
      <td className="bulk-cell-movement">
        <label className="bulk-movement-label" title={
          movementDisabled
            ? 'Solo aplicable con entidad asignada por CUIT'
            : `Generar movement de ${isReceived ? 'cobro' : 'pago'} en cta cte`
        }>
          <input type="checkbox"
                 checked={!!generarMovement && !movementDisabled}
                 disabled={movementDisabled}
                 onChange={e => onMovementChange(e.target.checked)}/>
        </label>
      </td>
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

window.BulkImportCheckRow = BulkImportCheckRow;
