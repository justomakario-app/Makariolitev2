/* ══ SUPPLIER MODAL (S2.2)
   Modal de alta/edicion de proveedor con ficha ampliada.
   4 secciones colapsables:
     1) Datos fiscales (default abierto): razon social, CUIT,
        condicion fiscal, condicion IVA, estado ARCA, razon social ARCA,
        ultima validacion ARCA. CUIT readOnly en mode='edit'.
        Boton "Validar con ARCA" presente pero disabled (S2.9).
     2) Datos de contacto: telefono, email, provincia (select),
        ciudad, direccion, codigo postal.
     3) Notas internas: rubro, productos habituales, notas.
     4) Historial (solo mode='edit'): lazy mount de <SupplierHistorial>
        cuando se expande por primera vez.

   Props: { mode: 'create' | 'edit' (default 'create'),
            initial?: {...}, onClose, onSuccess }
   ══ */

const FISCAL_OPTIONS = ['RI','Monotributo','Consumidor','Exento'];
const ARCA_OPTIONS   = ['activo','inactivo','dado_baja'];

function SupplierModal({ mode, initial, onClose, onSuccess }) {
  const toast = useToast();
  const isEdit = mode === 'edit';
  const title = isEdit ? 'Editar proveedor' : 'Nuevo proveedor';
  const okMsg = isEdit ? 'Proveedor actualizado' : 'Proveedor creado';

  const [form, setForm] = useState({
    // bloque 1 — fiscales
    nombre:                 (initial && initial.nombre)                 || '',
    cuit:                   (initial && initial.cuit)                   || '',
    condicion_fiscal:       (initial && initial.condicion_fiscal)       || '',
    condicion_iva:          (initial && initial.condicion_iva)          || '',
    estado_arca:            (initial && initial.estado_arca)            || '',
    razon_social_arca:      (initial && initial.razon_social_arca)      || '',
    ultima_validacion_arca: (initial && initial.ultima_validacion_arca) || '',
    // bloque 2 — contacto
    telefono:      (initial && initial.telefono)      || '',
    email:         (initial && initial.email)         || '',
    provincia:     (initial && initial.provincia)     || '',
    ciudad:        (initial && initial.ciudad)        || '',
    direccion:     (initial && initial.direccion)     || '',
    codigo_postal: (initial && initial.codigo_postal) || '',
    // bloque 3 — notas
    rubro:                (initial && initial.rubro)                || '',
    productos_habituales: (initial && initial.productos_habituales) || '',
    notas:                (initial && initial.notas)                || '',
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [openSections, setOpenSections] = useState({
    fiscal:  true,
    contact: false,
    notes:   false,
    history: false,
  });
  const [historyMounted, setHistoryMounted] = useState(false);

  const set = (k, v) => setForm(s => ({ ...s, [k]: v }));
  const toggle = (k) => setOpenSections(s => {
    const next = { ...s, [k]: !s[k] };
    if (k === 'history' && !s.history) setHistoryMounted(true);
    return next;
  });

  const validate = () => {
    const A = window.ADMIN_DATA;
    const e = {};
    const n  = A.validateNombre(form.nombre);    if (!n.ok)  e.nombre = n.msg;
    const c  = A.validateCuit(form.cuit);        if (!c.ok)  e.cuit   = c.msg;
    const m  = A.validateEmail(form.email);      if (!m.ok)  e.email  = m.msg;
    const ns = A.validateNotas(form.notas);      if (!ns.ok) e.notas  = ns.msg;
    if (form.condicion_fiscal && !FISCAL_OPTIONS.includes(form.condicion_fiscal)) {
      e.condicion_fiscal = 'Valor invalido';
    }
    if (form.estado_arca && !ARCA_OPTIONS.includes(form.estado_arca)) {
      e.estado_arca = 'Valor invalido';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSubmit = async () => {
    if (saving) return;
    if (!validate()) {
      toast.error('Revisa los campos en rojo');
      // abrir bloques con errores para que el user los vea
      const errKeys = Object.keys(errors);
      const inFiscal  = ['nombre','cuit','condicion_fiscal','estado_arca'].some(k => errKeys.includes(k));
      const inContact = ['email'].some(k => errKeys.includes(k));
      const inNotes   = ['notas'].some(k => errKeys.includes(k));
      setOpenSections(s => ({
        ...s,
        fiscal:  s.fiscal  || inFiscal,
        contact: s.contact || inContact,
        notes:   s.notes   || inNotes,
      }));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        nombre:                 form.nombre.trim(),
        cuit:                   form.cuit.trim(),
        email:                  form.email.trim(),
        telefono:               form.telefono.trim(),
        notas:                  form.notas.trim(),
        condicion_fiscal:       form.condicion_fiscal.trim(),
        condicion_iva:          form.condicion_iva.trim(),
        estado_arca:            form.estado_arca.trim(),
        razon_social_arca:      form.razon_social_arca.trim(),
        ultima_validacion_arca: form.ultima_validacion_arca,
        provincia:              form.provincia.trim(),
        ciudad:                 form.ciudad.trim(),
        direccion:              form.direccion.trim(),
        codigo_postal:          form.codigo_postal.trim(),
        rubro:                  form.rubro.trim(),
        productos_habituales:   form.productos_habituales.trim(),
      };
      if (isEdit) {
        payload.id = initial.id;
        // CUIT no se envia para evitar HINT='cuit_immutable' del RPC;
        // lo mandamos identico al actual.
        payload.cuit = (initial.cuit || '');
        await window.ADMIN_DATA.updateSupplier(payload);
      } else {
        await window.ADMIN_DATA.createSupplier(payload);
      }
      toast.success(okMsg);
      try { onSuccess?.(); } catch (_) {}
      onClose?.();
    } catch (err) {
      if (err && err.hint === 'duplicate_cuit') {
        toast.error('Ya existe otro proveedor con ese CUIT');
        setOpenSections(s => ({ ...s, fiscal: true }));
      } else if (err && err.hint === 'cuit_immutable') {
        toast.error('El CUIT no se puede modificar.');
        setOpenSections(s => ({ ...s, fiscal: true }));
      } else {
        toast.error(err.message || 'No se pudo guardar');
      }
      setSaving(false);
    }
  };

  const safeClose = () => { if (!saving) onClose?.(); };
  const Cmp = window.Modal;
  const provincias = (window.ADMIN_DATA && window.ADMIN_DATA.ARG_PROVINCIAS) || [];

  return (
    <Cmp open={true} title={title} onClose={safeClose} footer={
      <>
        <button className="btn-ghost" onClick={safeClose} disabled={saving}>Cancelar</button>
        <button className="btn-primary" onClick={onSubmit} disabled={saving}>
          {saving ? 'Guardando…' : (<><Icon n="check" s={14}/> Guardar</>)}
        </button>
      </>
    }>
      {/* ── SECCION 1: Datos fiscales (default open) ── */}
      <Section open={openSections.fiscal} onToggle={() => toggle('fiscal')} title="Datos fiscales">
        <div className="field-group">
          <label className="field-label">Razon social *</label>
          <input className={`field-input ${errors.nombre ? 'has-error' : ''}`}
                 value={form.nombre} maxLength={120} autoFocus
                 onChange={e => set('nombre', e.target.value)}
                 onBlur={validate}/>
          {errors.nombre && <div className="field-error">{errors.nombre}</div>}
        </div>

        <div className="field-group">
          <label className="field-label">CUIT</label>
          <input className={`field-input ${errors.cuit ? 'has-error' : ''} ${isEdit ? 'is-readonly' : ''}`}
                 value={form.cuit} placeholder="XX-XXXXXXXX-X"
                 readOnly={isEdit}
                 title={isEdit ? 'El CUIT no se puede modificar. Para corregir, dá de baja este proveedor y creá uno nuevo.' : ''}
                 onChange={e => set('cuit', e.target.value)}
                 onBlur={validate}/>
          {errors.cuit
            ? <div className="field-error">{errors.cuit}</div>
            : isEdit
              ? <div className="field-help">El CUIT es inmutable en edicion (S2.2)</div>
              : <div className="field-help">Formato XX-XXXXXXXX-X (opcional)</div>}
        </div>

        <div className="supplier-modal-grid">
          <div className="field-group">
            <label className="field-label">Condicion fiscal</label>
            <select className={`field-input ${errors.condicion_fiscal ? 'has-error' : ''}`}
                    value={form.condicion_fiscal}
                    onChange={e => set('condicion_fiscal', e.target.value)}>
              <option value="">— Sin especificar —</option>
              {FISCAL_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            {errors.condicion_fiscal && <div className="field-error">{errors.condicion_fiscal}</div>}
          </div>
          <div className="field-group">
            <label className="field-label">Condicion IVA</label>
            <input className="field-input" value={form.condicion_iva}
                   placeholder="Ej: Responsable Inscripto"
                   onChange={e => set('condicion_iva', e.target.value)}/>
          </div>
        </div>

        <div className="supplier-modal-grid">
          <div className="field-group">
            <label className="field-label">Estado ARCA</label>
            <select className={`field-input ${errors.estado_arca ? 'has-error' : ''}`}
                    value={form.estado_arca}
                    onChange={e => set('estado_arca', e.target.value)}>
              <option value="">— Sin especificar —</option>
              {ARCA_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            {errors.estado_arca && <div className="field-error">{errors.estado_arca}</div>}
          </div>
          <div className="field-group">
            <label className="field-label">&nbsp;</label>
            <button type="button"
                    className="field-input btn-arca-validate"
                    disabled
                    title="Disponible en S2.9 (Validacion ARCA)">
              <Icon n="check" s={12}/> Validar con ARCA
            </button>
          </div>
        </div>

        <div className="field-group">
          <label className="field-label">Razon social segun ARCA</label>
          <input className="field-input" value={form.razon_social_arca}
                 placeholder="Se autocompleta tras validar (S2.9)"
                 onChange={e => set('razon_social_arca', e.target.value)}/>
        </div>

        <div className="field-group">
          <label className="field-label">Ultima validacion ARCA</label>
          <input className="field-input" type="datetime-local"
                 value={form.ultima_validacion_arca ? String(form.ultima_validacion_arca).slice(0,16) : ''}
                 onChange={e => set('ultima_validacion_arca', e.target.value)}/>
        </div>
      </Section>

      {/* ── SECCION 2: Datos de contacto ── */}
      <Section open={openSections.contact} onToggle={() => toggle('contact')} title="Datos de contacto">
        <div className="supplier-modal-grid">
          <div className="field-group">
            <label className="field-label">Telefono</label>
            <input className="field-input" value={form.telefono}
                   onChange={e => set('telefono', e.target.value)}/>
          </div>
          <div className="field-group">
            <label className="field-label">Email</label>
            <input className={`field-input ${errors.email ? 'has-error' : ''}`}
                   type="email" value={form.email}
                   onChange={e => set('email', e.target.value)}
                   onBlur={validate}/>
            {errors.email && <div className="field-error">{errors.email}</div>}
          </div>
        </div>

        <div className="supplier-modal-grid">
          <div className="field-group">
            <label className="field-label">Provincia</label>
            <select className="field-input" value={form.provincia}
                    onChange={e => set('provincia', e.target.value)}>
              <option value="">— Sin especificar —</option>
              {provincias.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="field-group">
            <label className="field-label">Ciudad</label>
            <input className="field-input" value={form.ciudad}
                   onChange={e => set('ciudad', e.target.value)}/>
          </div>
        </div>

        <div className="supplier-modal-grid">
          <div className="field-group">
            <label className="field-label">Direccion</label>
            <input className="field-input" value={form.direccion}
                   onChange={e => set('direccion', e.target.value)}/>
          </div>
          <div className="field-group">
            <label className="field-label">Codigo postal</label>
            <input className="field-input" value={form.codigo_postal}
                   onChange={e => set('codigo_postal', e.target.value)}/>
          </div>
        </div>
      </Section>

      {/* ── SECCION 3: Notas internas ── */}
      <Section open={openSections.notes} onToggle={() => toggle('notes')} title="Notas internas">
        <div className="field-group">
          <label className="field-label">Rubro</label>
          <input className="field-input" value={form.rubro}
                 placeholder="Ej: Madera, Ferreteria, Servicios"
                 onChange={e => set('rubro', e.target.value)}/>
        </div>
        <div className="field-group">
          <label className="field-label">Productos habituales</label>
          <textarea className="field-input" value={form.productos_habituales} rows={2}
                    placeholder="Ej: Melamina 18mm, herrajes, tornilleria"
                    onChange={e => set('productos_habituales', e.target.value)}/>
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
      </Section>

      {/* ── SECCION 4: Historial (solo edit, lazy) ── */}
      {isEdit && (
        <Section open={openSections.history} onToggle={() => toggle('history')} title="Historial">
          {historyMounted && window.SupplierHistorial
            ? <window.SupplierHistorial supplierId={initial.id}/>
            : <div style={{padding:'12px', color:'var(--ink-muted)', fontSize:12}}>
                Expande para cargar el historial…
              </div>}
        </Section>
      )}
    </Cmp>
  );
}

/* Subcomponente: seccion colapsable. */
function Section({ open, onToggle, title, children }) {
  return (
    <div className={`supplier-modal-section ${open ? 'is-open' : ''}`}>
      <button type="button" className="supplier-modal-section-header" onClick={onToggle}>
        <Icon n={open ? 'chev-down' : 'chev-right'} s={14}/>
        <span>{title}</span>
      </button>
      {open && <div className="supplier-modal-section-body">{children}</div>}
    </div>
  );
}

window.SupplierModal = SupplierModal;
