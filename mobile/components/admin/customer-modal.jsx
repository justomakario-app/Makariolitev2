/* ══ CUSTOMER MODAL (B.2 + S2.1 → renombrado en S2.2)
   Modal de alta/edicion de cliente B2B.
   Rename funcional de entity-modal.jsx (variante customer-only), sin
   cambios funcionales. Convive con SupplierModal (archivo aparte que
   suma ficha ampliada en S2.2).

   DesactivarFallbackModal (que originalmente vivia con entity-modal)
   se movio a su propio archivo desactivar-fallback-modal.jsx porque
   lo comparten suppliers-tab, customers-tab, expenses-tab y futuros
   tabs (empleados, recibos, cash-flow).

   Props: { mode: 'create' | 'edit' (default 'create'),
            initial?: {id, nombre, cuit, email, telefono, notas},
            onClose, onSuccess }
   ══ */

function CustomerModal({ mode, initial, onClose, onSuccess, defaultMayorista }) {
  const toast = useToast();
  const isEdit = mode === 'edit';
  const title = isEdit ? 'Editar cliente B2B' : 'Nuevo cliente B2B';
  const okMsg = isEdit ? 'Cliente actualizado' : 'Cliente creado';

  // S2.23: provincias argentinas reutilizadas del data layer admin.
  const PROVINCIAS = (window.ADMIN_DATA && window.ADMIN_DATA.ARG_PROVINCIAS) || [];

  const [form, setForm] = useState({
    nombre:   (initial && initial.nombre)   || '',
    cuit:     (initial && initial.cuit)     || '',
    email:    (initial && initial.email)    || '',
    telefono: (initial && initial.telefono) || '',
    notas:    (initial && initial.notas)    || '',
    // S2.23 mayoristas
    es_mayorista: (initial && initial.es_mayorista) || !!defaultMayorista || false,
    localidad:    (initial && initial.localidad) || '',
    provincia:    (initial && initial.provincia) || '',
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
        // S2.23 mayoristas
        es_mayorista: !!form.es_mayorista,
        localidad:    form.localidad.trim(),
        provincia:    form.provincia,
      };
      if (isEdit) {
        payload.id = initial.id;
        await window.ADMIN_DATA.updateCustomerB2B(payload);
      } else {
        await window.ADMIN_DATA.createCustomerB2B(payload);
      }
      toast.success(okMsg);
      try { onSuccess?.(); } catch (_) {}
      onClose?.();
    } catch (err) {
      if (err && err.hint === 'duplicate_cuit') {
        toast.error('Ya existe otro cliente B2B con ese CUIT');
      } else {
        toast.error(err.message || 'No se pudo guardar');
      }
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

      {/* S2.23 mayoristas: toggle + ubicación */}
      <div className="field-group">
        <label style={{display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, fontWeight:600, color:'var(--ink)'}}>
          <input type="checkbox" checked={!!form.es_mayorista}
                 onChange={e => set('es_mayorista', e.target.checked)}/>
          Es mayorista
        </label>
        <div className="field-help">Habilita al cliente en el módulo Ventas → Clientes mayoristas.</div>
      </div>

      <div style={{display:'flex', gap:12}}>
        <div className="field-group" style={{flex:1}}>
          <label className="field-label">Localidad</label>
          <input className="field-input" value={form.localidad}
                 onChange={e => set('localidad', e.target.value)}/>
        </div>
        <div className="field-group" style={{flex:1}}>
          <label className="field-label">Provincia</label>
          <select className="field-input" value={form.provincia}
                  onChange={e => set('provincia', e.target.value)}>
            <option value="">—</option>
            {PROVINCIAS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
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

window.CustomerModal = CustomerModal;
