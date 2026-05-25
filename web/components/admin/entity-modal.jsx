/* ══ ENTITY MODAL (B.2 + S2.1)
   Modal compartido para alta/edicion de proveedor y cliente B2B.
   Props: { entityType: 'supplier' | 'customer_b2b',
            mode: 'create' | 'edit' (default 'create'),
            initial?: {id, nombre, cuit, email, telefono, notas},
            onClose, onSuccess }
   ══ */

function EntityModal({ entityType, mode, initial, onClose, onSuccess }) {
  const toast = useToast();
  const isSupplier = entityType === 'supplier';
  const isEdit = mode === 'edit';
  const entityLabel = isSupplier ? 'proveedor' : 'cliente B2B';
  const title    = isEdit
    ? (isSupplier ? 'Editar proveedor' : 'Editar cliente B2B')
    : (isSupplier ? 'Nuevo proveedor'  : 'Nuevo cliente B2B');
  const okMsg    = isEdit
    ? (isSupplier ? 'Proveedor actualizado' : 'Cliente actualizado')
    : (isSupplier ? 'Proveedor creado'      : 'Cliente creado');

  const [form, setForm] = useState({
    nombre:   (initial && initial.nombre)   || '',
    cuit:     (initial && initial.cuit)     || '',
    email:    (initial && initial.email)    || '',
    telefono: (initial && initial.telefono) || '',
    notas:    (initial && initial.notas)    || '',
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
      if (isEdit) {
        payload.id = initial.id;
        if (isSupplier) await window.ADMIN_DATA.updateSupplier(payload);
        else            await window.ADMIN_DATA.updateCustomerB2B(payload);
      } else {
        if (isSupplier) await window.ADMIN_DATA.createSupplier(payload);
        else            await window.ADMIN_DATA.createCustomerB2B(payload);
      }
      toast.success(okMsg);
      try { onSuccess?.(); } catch (_) {}
      onClose?.();
    } catch (err) {
      if (err && err.hint === 'duplicate_cuit') {
        toast.error(`Ya existe otro ${entityLabel} con ese CUIT`);
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

/* ══ DESACTIVAR FALLBACK MODAL (S2.1)
   Modal alternativo cuando un delete falla con hint='has_relations'.
   Muestra el mensaje del RPC + checkbox para desactivar en su lugar.
   Reusa window.Modal (no toca modals.jsx).
   Props: { entityLabel, target, msg, onClose, onDesactivar, running }
   ══ */
function DesactivarFallbackModal({ entityLabel, target, msg, onClose, onDesactivar, running }) {
  const [checked, setChecked] = useState(false);
  const Cmp = window.Modal;
  const safeClose = () => { if (!running) onClose?.(); };

  return (
    <Cmp open={true} title={`Eliminar ${entityLabel}`} onClose={safeClose} footer={
      <>
        <button className="btn-ghost" onClick={safeClose} disabled={running}>Cerrar</button>
        {checked && (
          <button className="btn-primary" onClick={onDesactivar} disabled={running}>
            {running ? 'Desactivando…' : (<><Icon n="check" s={14}/> Desactivar {entityLabel}</>)}
          </button>
        )}
      </>
    }>
      <div style={{display:'flex', alignItems:'flex-start', gap:10, marginBottom:14}}>
        <Icon n="alert" s={24} c="var(--red)"/>
        <div style={{flex:1, fontSize:13, color:'var(--ink)'}}>
          <strong>No se puede eliminar este {entityLabel}.</strong>
          <div style={{marginTop:8, fontSize:12, color:'var(--ink-soft)', whiteSpace:'pre-wrap'}}>
            {msg || `Tiene relaciones asociadas.`}
          </div>
          <div style={{marginTop:10, fontSize:12, color:'var(--ink-muted)'}}>
            Para borrarlo, primero eliminá las relaciones. Alternativa: desactivarlo (queda
            oculto de los listados pero sus datos históricos se preservan).
          </div>
        </div>
      </div>
      <label className="expense-cta-label" style={{padding:'10px 12px', background:'var(--paper-dim)', borderRadius:6, cursor:'pointer'}}>
        <input type="checkbox" checked={checked}
               onChange={e => setChecked(e.target.checked)}/>
        <span>Desactivar el {entityLabel} en su lugar</span>
      </label>
    </Cmp>
  );
}

window.DesactivarFallbackModal = DesactivarFallbackModal;
