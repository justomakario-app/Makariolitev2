/* ══ EXPENSE MODAL (B.3)
   Alta manual de egreso. Sin OCR ni upload de comprobante (diferido a
   sprint post-Edge-Function). Reusa window.Modal de modals.jsx.
   Props: { suppliers, onClose, onSuccess }
   ══ */

function ExpenseModal({ suppliers, onClose, onSuccess }) {
  const toast = useToast();
  const today = window.todayLocalStr();

  const [form, setForm] = useState({
    fecha: today,
    supplier_id: '',
    concepto: '',
    monto_total: '',
    moneda: 'ARS',
    iva_discriminado: '',
    categoria: 'insumos',
    medio_pago: 'efectivo',
    notas: '',
  });
  const [genOverride, setGenOverride] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [supplierDropdownOpen, setSupplierDropdownOpen] = useState(false);

  /* Reset override cuando cambia supplier o medio_pago. */
  useEffect(() => { setGenOverride(null); }, [form.supplier_id, form.medio_pago]);

  const defaultGen = !(form.medio_pago === 'efectivo' || form.medio_pago === 'transferencia');
  const effectiveGen = (genOverride !== null) ? genOverride : defaultGen;
  const showCheckbox = !!form.supplier_id;

  const set = (k, v) => setForm(s => ({ ...s, [k]: v }));

  const selectedSupplier = useMemo(
    () => suppliers.find(s => s.id === form.supplier_id) || null,
    [suppliers, form.supplier_id]
  );

  const filteredSuppliers = useMemo(() => {
    const q = supplierSearch.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter(s =>
      (s.nombre || '').toLowerCase().includes(q) ||
      (s.cuit   || '').toLowerCase().includes(q)
    );
  }, [suppliers, supplierSearch]);

  const validate = () => {
    const A = window.ADMIN_DATA;
    const e = {};
    const f = A.validateFecha(form.fecha);       if (!f.ok) e.fecha = f.msg;
    const c = A.validateConcepto(form.concepto); if (!c.ok) e.concepto = c.msg;
    const m = A.validateMonto(form.monto_total); if (!m.ok) e.monto_total = m.msg;
    const i = A.validateIva(form.iva_discriminado, form.monto_total);
                                                  if (!i.ok) e.iva_discriminado = i.msg;
    const n = A.validateNotas(form.notas);       if (!n.ok) e.notas = n.msg;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSubmit = async () => {
    if (saving) return;
    if (!validate()) { toast.error('Revisa los campos en rojo'); return; }
    setSaving(true);
    try {
      const payload = {
        fecha: form.fecha,
        supplier_id: form.supplier_id || null,
        concepto: form.concepto.trim(),
        monto_total: String(Number(form.monto_total)),
        moneda: form.moneda,
        iva_discriminado: form.iva_discriminado === '' ? null : String(Number(form.iva_discriminado)),
        categoria: form.categoria,
        medio_pago: form.medio_pago,
        notas: form.notas.trim(),
        confirmed_by_human: true,
        generate_supplier_movement: form.supplier_id ? effectiveGen : null,
      };
      await window.ADMIN_DATA.createExpense(payload);
      toast.success('Egreso registrado');
      try { onSuccess?.(); } catch (_) {}
      onClose?.();
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar');
      setSaving(false);
    }
  };

  const safeClose = () => { if (!saving) onClose?.(); };
  const Cmp = window.Modal;

  const pickSupplier = (id, name) => {
    set('supplier_id', id);
    setSupplierSearch(name);
    setSupplierDropdownOpen(false);
  };

  return (
    <Cmp open={true} title="Nuevo egreso" onClose={safeClose} size="lg" footer={
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
                 value={form.fecha} onChange={e => set('fecha', e.target.value)}
                 onBlur={validate}/>
          {errors.fecha && <div className="field-error">{errors.fecha}</div>}
        </div>

        <div className="field-group">
          <label className="field-label">Categoria *</label>
          <select className="field-input" value={form.categoria}
                  onChange={e => set('categoria', e.target.value)}>
            <option value="insumos">Insumos</option>
            <option value="servicios">Servicios</option>
            <option value="sueldos">Sueldos</option>
            <option value="impuestos">Impuestos</option>
            <option value="otros">Otros</option>
          </select>
        </div>

        <div className="field-group expense-field-full">
          <label className="field-label">Proveedor</label>
          <div className="supplier-combo">
            <input className="field-input"
                   placeholder={selectedSupplier ? selectedSupplier.nombre : 'Sin proveedor del catalogo'}
                   value={supplierSearch}
                   onFocus={() => setSupplierDropdownOpen(true)}
                   onChange={e => { setSupplierSearch(e.target.value); setSupplierDropdownOpen(true); }}/>
            {supplierDropdownOpen && (
              <div className="supplier-dropdown" onMouseLeave={() => setSupplierDropdownOpen(false)}>
                <button type="button" className="supplier-option"
                        onClick={() => pickSupplier('', '')}>
                  <em>Sin proveedor del catalogo</em>
                </button>
                {filteredSuppliers.length === 0 ? (
                  <div className="supplier-empty">
                    {suppliers.length === 0
                      ? 'No hay proveedores cargados. Cargá uno desde tab Proveedores.'
                      : 'Sin resultados'}
                  </div>
                ) : (
                  filteredSuppliers.map(s => (
                    <button type="button" key={s.id} className="supplier-option"
                            onClick={() => pickSupplier(s.id, s.nombre)}>
                      <strong>{s.nombre}</strong>
                      {s.cuit && <span style={{marginLeft:6, color:'var(--ink-muted)'}}>{s.cuit}</span>}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        <div className="field-group expense-field-full">
          <label className="field-label">Concepto *</label>
          <input className={`field-input ${errors.concepto ? 'has-error' : ''}`}
                 value={form.concepto} maxLength={500}
                 onChange={e => set('concepto', e.target.value)} onBlur={validate}/>
          {errors.concepto && <div className="field-error">{errors.concepto}</div>}
        </div>

        <div className="field-group">
          <label className="field-label">Monto total *</label>
          <input type="number" step="0.01" min="0.01"
                 className={`field-input ${errors.monto_total ? 'has-error' : ''}`}
                 value={form.monto_total}
                 onChange={e => set('monto_total', e.target.value)} onBlur={validate}/>
          {errors.monto_total && <div className="field-error">{errors.monto_total}</div>}
        </div>

        <div className="field-group">
          <label className="field-label">Moneda *</label>
          <select className="field-input" value={form.moneda}
                  onChange={e => set('moneda', e.target.value)}>
            <option value="ARS">ARS</option>
            <option value="USD">USD</option>
          </select>
        </div>

        <div className="field-group">
          <label className="field-label">IVA discriminado</label>
          <input type="number" step="0.01" min="0"
                 className={`field-input ${errors.iva_discriminado ? 'has-error' : ''}`}
                 value={form.iva_discriminado}
                 onChange={e => set('iva_discriminado', e.target.value)} onBlur={validate}/>
          {errors.iva_discriminado
            ? <div className="field-error">{errors.iva_discriminado}</div>
            : <div className="field-help">Opcional</div>}
        </div>

        <div className="field-group">
          <label className="field-label">Medio de pago *</label>
          <select className="field-input" value={form.medio_pago}
                  onChange={e => set('medio_pago', e.target.value)}>
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia</option>
            <option value="cheque">Cheque</option>
            <option value="tarjeta">Tarjeta</option>
            <option value="otro">Otro</option>
          </select>
        </div>

        {showCheckbox && (
          <div className="field-group expense-field-full expense-cta-row">
            <label className="expense-cta-label">
              <input type="checkbox"
                     checked={effectiveGen}
                     onChange={e => setGenOverride(e.target.checked)}/>
              <span>Generar movimiento en cta cte del proveedor</span>
            </label>
            <div className="field-help">
              Default segun medio de pago: {defaultGen ? 'sí' : 'no'}
              {genOverride !== null && ' (override manual)'}
            </div>
          </div>
        )}

        <div className="field-group expense-field-full">
          <label className="field-label">Notas</label>
          <textarea className={`field-input ${errors.notas ? 'has-error' : ''}`}
                    value={form.notas} rows={3} maxLength={500}
                    onChange={e => set('notas', e.target.value)} onBlur={validate}/>
          {errors.notas
            ? <div className="field-error">{errors.notas}</div>
            : <div className="field-help">{form.notas.length} / 500</div>}
        </div>
      </div>
    </Cmp>
  );
}

window.ExpenseModal = ExpenseModal;
