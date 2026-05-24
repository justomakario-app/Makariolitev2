/* ══ CTA CTE MOVEMENT MODAL (B.5)
   Modal compartido para alta y edicion de movements manuales.
   Props: { entityType: 'supplier'|'customer', mode: 'create'|'edit',
            accountId, initial?, onClose, onSuccess }
   Campos: fecha, tipo, monto, concepto.
   Tipos:
     supplier → compra/pago/ajuste/devolucion
     customer → cargo/pago/ajuste/devolucion
   ══ */

const CTA_CTE_TIPOS = {
  supplier: ['compra', 'pago', 'ajuste', 'devolucion'],
  customer: ['cargo', 'pago', 'ajuste', 'devolucion'],
};

function CtaCteMovementModal({ entityType, mode, accountId, initial, onClose, onSuccess }) {
  const toast = useToast();
  const isSupplier = entityType === 'supplier';
  const TIPOS = CTA_CTE_TIPOS[entityType] || CTA_CTE_TIPOS.supplier;

  const title = (mode === 'edit')
    ? (isSupplier ? 'Editar movimiento de proveedor' : 'Editar movimiento de cliente')
    : (isSupplier ? 'Nuevo movimiento de proveedor' : 'Nuevo movimiento de cliente');

  const [form, setForm] = useState({
    fecha:    (initial && initial.fecha) ? String(initial.fecha).slice(0, 10) : window.todayLocalStr(),
    tipo:     (initial && initial.tipo) || TIPOS[0],
    monto:    (initial && initial.monto != null) ? String(initial.monto) : '',
    concepto: (initial && initial.concepto) || '',
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(s => ({ ...s, [k]: v }));

  const validate = () => {
    const A = window.ADMIN_DATA;
    const e = {};
    const f = A.validateFecha(form.fecha);                       if (!f.ok) e.fecha = f.msg;
    const c = A.validateConcepto(form.concepto);                  if (!c.ok) e.concepto = c.msg;
    const m = A.validateMovementMonto(form.monto, form.tipo);     if (!m.ok) e.monto = m.msg;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSubmit = async () => {
    if (saving) return;
    if (!validate()) { toast.error('Revisa los campos en rojo'); return; }
    setSaving(true);
    try {
      const concepto = form.concepto.trim();
      const monto = String(Number(form.monto));
      const fecha = form.fecha;
      const tipo = form.tipo;
      if (mode === 'edit') {
        const payload = { movement_id: initial.id, fecha, tipo, monto, concepto };
        if (isSupplier) await window.ADMIN_DATA.updateSupplierMovement(payload);
        else            await window.ADMIN_DATA.updateCustomerMovement(payload);
        toast.success('Movimiento actualizado');
      } else {
        const payload = isSupplier
          ? { supplier_credit_id: accountId, fecha, tipo, monto, concepto }
          : { customer_credit_id: accountId, fecha, tipo, monto, concepto };
        if (isSupplier) await window.ADMIN_DATA.createSupplierMovement(payload);
        else            await window.ADMIN_DATA.createCustomerMovement(payload);
        toast.success('Movimiento creado');
      }
      try { onSuccess?.(); } catch (_) {}
      onClose?.();
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar');
      setSaving(false);
    }
  };

  const safeClose = () => { if (!saving) onClose?.(); };
  const Cmp = window.Modal;

  return (
    <Cmp open={true} title={title} onClose={safeClose} footer={
      <>
        <button className="btn-ghost" onClick={safeClose} disabled={saving}>Cancelar</button>
        <button className="btn-primary" onClick={onSubmit} disabled={saving}>
          {saving ? 'Guardando…' : (<><Icon n="check" s={14}/> Guardar</>)}
        </button>
      </>
    }>
      <div className="expense-form-grid">
        <div className="field-group">
          <label className="field-label">Fecha *</label>
          <input type="date" className={`field-input ${errors.fecha ? 'has-error' : ''}`}
                 value={form.fecha}
                 onChange={e => set('fecha', e.target.value)}
                 onBlur={validate}/>
          {errors.fecha && <div className="field-error">{errors.fecha}</div>}
        </div>

        <div className="field-group">
          <label className="field-label">Tipo *</label>
          <select className="field-input" value={form.tipo}
                  onChange={e => set('tipo', e.target.value)}>
            {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div className="field-group expense-field-full">
          <label className="field-label">Monto *</label>
          <input type="number" step="0.01"
                 className={`field-input ${errors.monto ? 'has-error' : ''}`}
                 value={form.monto}
                 onChange={e => set('monto', e.target.value)}
                 onBlur={validate}/>
          {errors.monto
            ? <div className="field-error">{errors.monto}</div>
            : <div className="field-help">{form.tipo === 'ajuste' ? 'Permite negativo' : 'Mayor a 0'}</div>}
        </div>

        <div className="field-group expense-field-full">
          <label className="field-label">Concepto *</label>
          <input className={`field-input ${errors.concepto ? 'has-error' : ''}`}
                 value={form.concepto} maxLength={500}
                 onChange={e => set('concepto', e.target.value)}
                 onBlur={validate}/>
          {errors.concepto && <div className="field-error">{errors.concepto}</div>}
        </div>
      </div>
    </Cmp>
  );
}

window.CtaCteMovementModal = CtaCteMovementModal;
