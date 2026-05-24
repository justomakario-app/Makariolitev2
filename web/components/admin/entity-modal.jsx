/* ══ ENTITY MODAL (B.2)
   Modal compartido para alta de proveedor y cliente B2B. Mismo formulario,
   diferente RPC + label segun prop entityType.
   Props: { entityType: 'supplier' | 'customer_b2b', onClose, onSuccess }
   ══ */

function EntityModal({ entityType, onClose, onSuccess }) {
  const toast = useToast();
  const isSupplier = entityType === 'supplier';
  const title    = isSupplier ? 'Nuevo proveedor' : 'Nuevo cliente B2B';
  const okMsg    = isSupplier ? 'Proveedor creado' : 'Cliente creado';

  const [form, setForm] = useState({
    nombre: '', cuit: '', email: '', telefono: '', notas: '',
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(s => ({ ...s, [k]: v }));

  const validate = () => {
    const A = window.ADMIN_DATA;
    const e = {};
    const n  = A.validateNombre(form.nombre);    if (!n.ok)  e.nombre = n.msg;
    const c  = A.validateCuit(form.cuit);        if (!c.ok)  e.cuit   = c.msg;
    const m  = A.validateEmail(form.email);      if (!m.ok)  e.email  = m.msg;
    const ns = A.validateNotas(form.notas);      if (!ns.ok) e.notas  = ns.msg;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSubmit = async () => {
    if (saving) return;
    if (!validate()) { toast.error('Revisa los campos en rojo'); return; }
    setSaving(true);
    try {
      const payload = {
        nombre:   form.nombre.trim(),
        cuit:     form.cuit.trim(),
        email:    form.email.trim(),
        telefono: form.telefono.trim(),
        notas:    form.notas.trim(),
      };
      if (isSupplier) await window.ADMIN_DATA.createSupplier(payload);
      else            await window.ADMIN_DATA.createCustomerB2B(payload);
      toast.success(okMsg);
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
      <div className="field-group">
        <label className="field-label">Nombre / Razon social *</label>
        <input className={`field-input ${errors.nombre ? 'has-error' : ''}`}
               value={form.nombre} maxLength={120} autoFocus
               onChange={e => set('nombre', e.target.value)}
               onBlur={validate}/>
        {errors.nombre && <div className="field-error">{errors.nombre}</div>}
      </div>

      <div className="field-group">
        <label className="field-label">CUIT</label>
        <input className={`field-input ${errors.cuit ? 'has-error' : ''}`}
               value={form.cuit} placeholder="XX-XXXXXXXX-X"
               onChange={e => set('cuit', e.target.value)}
               onBlur={validate}/>
        {errors.cuit
          ? <div className="field-error">{errors.cuit}</div>
          : <div className="field-help">Formato XX-XXXXXXXX-X (opcional)</div>}
      </div>

      <div className="field-group">
        <label className="field-label">Email</label>
        <input className={`field-input ${errors.email ? 'has-error' : ''}`}
               type="email" value={form.email}
               onChange={e => set('email', e.target.value)}
               onBlur={validate}/>
        {errors.email && <div className="field-error">{errors.email}</div>}
      </div>

      <div className="field-group">
        <label className="field-label">Telefono</label>
        <input className="field-input" value={form.telefono}
               onChange={e => set('telefono', e.target.value)}/>
      </div>

      <div className="field-group">
        <label className="field-label">Notas</label>
        <textarea className={`field-input ${errors.notas ? 'has-error' : ''}`}
                  value={form.notas} rows={3} maxLength={500}
                  onChange={e => set('notas', e.target.value)}
                  onBlur={validate}/>
        {errors.notas
          ? <div className="field-error">{errors.notas}</div>
          : <div className="field-help">{form.notas.length} / 500</div>}
      </div>
    </Cmp>
  );
}

window.EntityModal = EntityModal;
