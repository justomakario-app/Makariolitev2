/* ══ CASH FLOW MANUAL MODAL (S2.16)
   Modal de alta/edicion de movimiento manual.

   Campos: fecha*, tipo* (ingreso/egreso radio), concepto* (1-200),
           monto* (>0), categoria (datalist con sugerencias), notas.
   Categoria normaliza a lowercase antes de enviar (evita duplicados
   "Otros" vs "otros").

   Mode 'edit': precarga datos. NO permite cambiar fecha (snapshot
   contable). Permite cambiar concepto, monto, categoria, notas y tipo.

   Props: { mode: 'create'|'edit', initial?, onClose, onSuccess }
   ══ */

function CashFlowManualModal({ mode, initial, onClose, onSuccess }) {
  const toast = useToast();
  const A = window.ADMIN_DATA;
  const Cmp = window.Modal;
  const isEdit = mode === 'edit';
  const title = isEdit ? 'Editar movimiento' : 'Nuevo movimiento manual';
  const okMsg = isEdit ? 'Movimiento actualizado' : 'Movimiento creado';

  const [fecha, setFecha] = useState(
    (initial && initial.fecha)
      ? String(initial.fecha).slice(0, 10)
      : new Date().toISOString().slice(0, 10)
  );
  const [tipo, setTipo]           = useState((initial && initial.tipo) || 'ingreso');
  const [concepto, setConcepto]   = useState((initial && initial.concepto) || '');
  const [monto, setMonto]         = useState(initial && initial.monto != null ? String(initial.monto) : '');
  const [categoria, setCategoria] = useState((initial && initial.categoria) || 'otros');
  const [notas, setNotas]         = useState((initial && initial.notas) || '');

  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const validate = () => {
    const e = {};
    if (!fecha) e.fecha = 'Fecha requerida';
    const c = concepto.trim();
    if (!c) e.concepto = 'Concepto requerido';
    else if (c.length > 200) e.concepto = 'Máximo 200 caracteres';
    const m = Number(monto);
    if (!Number.isFinite(m) || m <= 0) e.monto = 'Monto debe ser > 0';
    if (!['ingreso','egreso'].includes(tipo)) e.tipo = 'Tipo inválido';
    if (notas.length > 500) e.notas = 'Máximo 500 caracteres';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSubmit = async () => {
    if (saving) return;
    if (!validate()) { toast.error('Revisá los campos en rojo'); return; }
    setSaving(true);
    try {
      const payload = {
        fecha,
        tipo,
        concepto: concepto.trim(),
        monto: String(Number(monto)),
        categoria: (categoria || 'otros').trim().toLowerCase(),
        notas: notas.trim(),
      };
      if (isEdit) {
        payload.id = initial.id;
        /* En edit NO mandamos fecha — snapshot contable inmutable. */
        delete payload.fecha;
        await A.updateCashFlowManual(payload);
      } else {
        await A.createCashFlowManual(payload);
      }
      toast.success(okMsg);
      try { onSuccess?.(); } catch (_) {}
      onClose?.();
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar');
      setSaving(false);
    }
  };

  const safeClose = () => { if (!saving) onClose?.(); };
  const sugerencias = A.CASH_FLOW_CATEGORIAS_SUGERIDAS || [];

  return (
    <Cmp open={true} title={title} onClose={safeClose} footer={
      <>
        <button className="btn-ghost" onClick={safeClose} disabled={saving}>Cancelar</button>
        <button className="btn-primary" onClick={onSubmit} disabled={saving}>
          {saving ? 'Guardando…' : (<><Icon n="check" s={14}/> Guardar</>)}
        </button>
      </>
    }>
      <div className="field-group">
        <label className="field-label">Fecha *</label>
        <input type="date"
               className={`field-input ${errors.fecha ? 'has-error' : ''} ${isEdit ? 'is-readonly' : ''}`}
               value={fecha}
               readOnly={isEdit}
               title={isEdit ? 'Snapshot contable inmutable post-alta' : ''}
               onChange={e => setFecha(e.target.value)}/>
        {errors.fecha
          ? <div className="field-error">{errors.fecha}</div>
          : isEdit
            ? <div className="field-help">La fecha no se puede modificar (snapshot contable).</div>
            : null}
      </div>

      <div className="field-group">
        <label className="field-label">Tipo *</label>
        <div className="recibo-tipo-radio-row">
          <label className="recibo-tipo-radio">
            <input type="radio" name="cf-tipo" value="ingreso"
                   checked={tipo === 'ingreso'}
                   onChange={() => setTipo('ingreso')}/>
            Ingreso
          </label>
          <label className="recibo-tipo-radio">
            <input type="radio" name="cf-tipo" value="egreso"
                   checked={tipo === 'egreso'}
                   onChange={() => setTipo('egreso')}/>
            Egreso
          </label>
        </div>
        {errors.tipo && <div className="field-error">{errors.tipo}</div>}
      </div>

      <div className="field-group">
        <label className="field-label">Concepto *</label>
        <input className={`field-input ${errors.concepto ? 'has-error' : ''}`}
               value={concepto} maxLength={200}
               placeholder="Ej: Aporte de capital, cobranza directa, gasto bancario"
               onChange={e => setConcepto(e.target.value)}/>
        {errors.concepto
          ? <div className="field-error">{errors.concepto}</div>
          : <div className="field-help">{concepto.length} / 200</div>}
      </div>

      <div className="supplier-modal-grid">
        <div className="field-group">
          <label className="field-label">Monto *</label>
          <input type="number" step="0.01" min="0"
                 className={`field-input ${errors.monto ? 'has-error' : ''}`}
                 value={monto}
                 onChange={e => setMonto(e.target.value)}/>
          {errors.monto && <div className="field-error">{errors.monto}</div>}
        </div>
        <div className="field-group">
          <label className="field-label">Categoría</label>
          <input className="field-input"
                 list="cf-categorias-list"
                 value={categoria}
                 placeholder="otros"
                 onChange={e => setCategoria(e.target.value)}/>
          <datalist id="cf-categorias-list">
            {sugerencias.map(s => <option key={s} value={s}/>)}
          </datalist>
          <div className="field-help">Sugerencias o texto libre. Se normaliza a minúsculas.</div>
        </div>
      </div>

      <div className="field-group">
        <label className="field-label">Notas (opcional)</label>
        <textarea className={`field-input ${errors.notas ? 'has-error' : ''}`}
                  value={notas} rows={2} maxLength={500}
                  onChange={e => setNotas(e.target.value)}/>
        {errors.notas
          ? <div className="field-error">{errors.notas}</div>
          : <div className="field-help">{notas.length} / 500</div>}
      </div>
    </Cmp>
  );
}

window.CashFlowManualModal = CashFlowManualModal;
