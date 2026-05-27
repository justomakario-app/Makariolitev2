/* ══ EXPENSE ITEMS EDITOR (S2.3)
   Tabla editable de items de un comprobante. Add/remove rows.
   Cada row: cantidad, codigo, descripcion, precio_unit, bonificacion_pct,
              iva_pct (select), subtotal (calculado), importe (calculado).

   Subtotal = cantidad * precio_unit * (1 - bonificacion_pct/100)
   Importe  = subtotal * (1 + iva_pct/100)

   Props:
     - value: array de items (jsonb shape).
     - onChange: (newArray) => void.
     - disabled: boolean (durante save).
   ══ */

const IVA_PCT_OPTIONS = [0, 10.5, 21, 27];

function makeEmptyItem() {
  return {
    cantidad: 1,
    codigo: '',
    descripcion: '',
    precio_unit: 0,
    bonificacion_pct: 0,
    iva_pct: 21,
    subtotal: 0,
    importe: 0,
  };
}

function recalcItem(item) {
  const cant   = Number(item.cantidad) || 0;
  const punit  = Number(item.precio_unit) || 0;
  const bonif  = Number(item.bonificacion_pct) || 0;
  const ivaPct = Number(item.iva_pct) || 0;
  const subtotal = cant * punit * (1 - bonif / 100);
  const importe  = subtotal * (1 + ivaPct / 100);
  return {
    ...item,
    subtotal: Math.round(subtotal * 100) / 100,
    importe:  Math.round(importe  * 100) / 100,
  };
}

function ExpenseItemsEditor({ value, onChange, disabled }) {
  const items = Array.isArray(value) ? value : [];

  const updateItem = (idx, patch) => {
    const next = items.map((it, i) =>
      i === idx ? recalcItem({ ...it, ...patch }) : it
    );
    onChange(next);
  };

  const addItem = () => {
    onChange([...items, makeEmptyItem()]);
  };

  const removeItem = (idx) => {
    onChange(items.filter((_, i) => i !== idx));
  };

  /* Totales para footer informativo. */
  const totalSubtotal = items.reduce((acc, it) => acc + (Number(it.subtotal) || 0), 0);
  const totalImporte  = items.reduce((acc, it) => acc + (Number(it.importe)  || 0), 0);

  return (
    <div className="expense-items-editor">
      {items.length === 0 ? (
        <div className="expense-items-empty">
          Sin items cargados. Podés cargar el comprobante igual con solo el total general,
          o agregar items detalle para tu referencia.
        </div>
      ) : (
        <div className="expense-items-scroll">
          <table className="expense-items-table">
            <thead>
              <tr>
                <th style={{width:'70px'}}>Cant</th>
                <th style={{width:'110px'}}>Código</th>
                <th>Descripción</th>
                <th style={{width:'110px', textAlign:'right'}}>P.Unit</th>
                <th style={{width:'70px',  textAlign:'right'}}>Bonif%</th>
                <th style={{width:'120px', textAlign:'right'}}>Subtotal</th>
                <th style={{width:'80px'}}>IVA%</th>
                <th style={{width:'120px', textAlign:'right'}}>Importe</th>
                <th style={{width:'30px'}}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={idx}>
                  <td>
                    <input type="number" min="0" step="0.01"
                           className="expense-item-input"
                           value={it.cantidad}
                           disabled={disabled}
                           onChange={e => updateItem(idx, { cantidad: e.target.value })}/>
                  </td>
                  <td>
                    <input className="expense-item-input"
                           value={it.codigo || ''}
                           maxLength={50}
                           disabled={disabled}
                           onChange={e => updateItem(idx, { codigo: e.target.value })}/>
                  </td>
                  <td>
                    <input className="expense-item-input"
                           value={it.descripcion || ''}
                           maxLength={200}
                           disabled={disabled}
                           onChange={e => updateItem(idx, { descripcion: e.target.value })}/>
                  </td>
                  <td>
                    <input type="number" min="0" step="0.01"
                           className="expense-item-input expense-item-input-num"
                           value={it.precio_unit}
                           disabled={disabled}
                           onChange={e => updateItem(idx, { precio_unit: e.target.value })}/>
                  </td>
                  <td>
                    <input type="number" min="0" max="100" step="0.01"
                           className="expense-item-input expense-item-input-num"
                           value={it.bonificacion_pct || 0}
                           disabled={disabled}
                           onChange={e => updateItem(idx, { bonificacion_pct: e.target.value })}/>
                  </td>
                  <td style={{textAlign:'right', fontWeight:600}}>
                    {window.ADMIN_DATA.formatMoney(it.subtotal || 0, 'ARS')}
                  </td>
                  <td>
                    <select className="expense-item-input"
                            value={it.iva_pct}
                            disabled={disabled}
                            onChange={e => updateItem(idx, { iva_pct: Number(e.target.value) })}>
                      {IVA_PCT_OPTIONS.map(p => (
                        <option key={p} value={p}>{p}%</option>
                      ))}
                    </select>
                  </td>
                  <td style={{textAlign:'right', fontWeight:600}}>
                    {window.ADMIN_DATA.formatMoney(it.importe || 0, 'ARS')}
                  </td>
                  <td>
                    <button type="button"
                            className="expense-item-remove"
                            title="Eliminar item"
                            disabled={disabled}
                            onClick={() => removeItem(idx)}>
                      <Icon n="x" s={12}/>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} style={{textAlign:'right', fontSize:11, color:'var(--ink-muted)'}}>
                  Totales de items:
                </td>
                <td style={{textAlign:'right', fontWeight:700}}>
                  {window.ADMIN_DATA.formatMoney(totalSubtotal, 'ARS')}
                </td>
                <td></td>
                <td style={{textAlign:'right', fontWeight:700}}>
                  {window.ADMIN_DATA.formatMoney(totalImporte, 'ARS')}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="expense-items-actions">
        <button type="button"
                className="btn-ghost-sm"
                disabled={disabled}
                onClick={addItem}>
          <Icon n="plus" s={12}/> Agregar item
        </button>
      </div>
    </div>
  );
}

window.ExpenseItemsEditor = ExpenseItemsEditor;
window.makeEmptyExpenseItem = makeEmptyItem;
window.recalcExpenseItem    = recalcItem;
