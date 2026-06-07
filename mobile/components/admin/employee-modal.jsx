/* ══ EMPLOYEE MODAL (S2.11)
   Modal de alta/edicion de empleado con ficha en 4 secciones colapsables
   + bloque 5 (Historial — solo edit, lazy, datos reales S2.15).

   1) Datos personales (default open): CUIL, nombre, fecha_nacimiento,
      email, telefono, direccion, ciudad, provincia, codigo_postal.
   2) Datos laborales: fecha_ingreso, categoria, modalidad,
      tipo_contratacion, lugar_trabajo, convenio.
   3) Liquidacion base: sueldo_bruto_base, dias_vacaciones_anuales.
   4) Datos de pago: banco, cbu (22 digitos), alias_cbu, forma_cobro.
   5) Historial (solo edit): lazy mount con datos reales S2.15
      (stat cards + botón "Ver histórico completo").

   CUIL readOnly en mode='edit' con tooltip (decision S2.11 paralelo a
   cuit_immutable de S2.2).

   Props: { mode: 'create'|'edit', initial?, onClose, onSuccess }
   ══ */

function EmployeeModal({ mode, initial, onClose, onSuccess }) {
  const toast = useToast();
  const isEdit = mode === 'edit';
  const title = isEdit ? 'Editar empleado' : 'Nuevo empleado';
  const okMsg = isEdit ? 'Empleado actualizado' : 'Empleado creado';
  const A = window.ADMIN_DATA;

  const [form, setForm] = useState({
    // bloque 1 — personales
    nombre:           (initial && initial.nombre)           || '',
    cuil:             (initial && initial.cuil)             || '',
    fecha_nacimiento: (initial && initial.fecha_nacimiento)
                        ? String(initial.fecha_nacimiento).slice(0,10) : '',
    email:            (initial && initial.email)            || '',
    telefono:         (initial && initial.telefono)         || '',
    direccion:        (initial && initial.direccion)        || '',
    ciudad:           (initial && initial.ciudad)           || '',
    provincia:        (initial && initial.provincia)        || '',
    codigo_postal:    (initial && initial.codigo_postal)    || '',
    // bloque 2 — laborales
    fecha_ingreso:    (initial && initial.fecha_ingreso)
                        ? String(initial.fecha_ingreso).slice(0,10) : '',
    categoria:        (initial && initial.categoria)        || '',
    modalidad:        (initial && initial.modalidad)        || '',
    tipo_contratacion:(initial && initial.tipo_contratacion)|| '',
    lugar_trabajo:    (initial && initial.lugar_trabajo)    || '',
    convenio:         (initial && initial.convenio)         || '',
    // bloque 3 — liquidacion
    sueldo_bruto_base:      (initial && initial.sueldo_bruto_base != null)
                              ? String(initial.sueldo_bruto_base) : '',
    dias_vacaciones_anuales:(initial && initial.dias_vacaciones_anuales != null)
                              ? String(initial.dias_vacaciones_anuales) : '',
    valor_hora_extra:       (initial && initial.valor_hora_extra != null)
                              ? String(initial.valor_hora_extra) : '',
    // bloque 4 — pago
    banco:        (initial && initial.banco)        || '',
    cbu:          (initial && initial.cbu)          || '',
    alias_cbu:    (initial && initial.alias_cbu)    || '',
    forma_cobro:  (initial && initial.forma_cobro)  || '',
    notas:        (initial && initial.notas)        || '',
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [openSections, setOpenSections] = useState({
    personales: true,
    laborales:  false,
    liquidacion:false,
    pago:       false,
    historial:  false,
  });
  const [historyMounted, setHistoryMounted] = useState(false);

  const set = (k, v) => setForm(s => ({ ...s, [k]: v }));
  const toggle = (k) => setOpenSections(s => {
    const next = { ...s, [k]: !s[k] };
    if (k === 'historial' && !s.historial) setHistoryMounted(true);
    return next;
  });

  const validate = () => {
    const e = {};
    const nombre = form.nombre.trim();
    if (!nombre) e.nombre = 'Nombre requerido';
    else if (nombre.length > 120) e.nombre = 'Máximo 120 caracteres';

    const cuilNorm = A.normalizeCuil(form.cuil);
    if (form.cuil && !cuilNorm) e.cuil = 'Formato XX-XXXXXXXX-X o 11 dígitos';

    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      e.email = 'Email inválido';
    }
    const cbu = form.cbu.trim().replace(/\s+/g,'');
    if (cbu && !/^\d{22}$/.test(cbu)) e.cbu = 'CBU debe tener 22 dígitos';

    const sueldo = String(form.sueldo_bruto_base).trim();
    if (sueldo && (isNaN(Number(sueldo)) || Number(sueldo) < 0)) {
      e.sueldo_bruto_base = 'Debe ser numérico >= 0';
    }

    const vhe = String(form.valor_hora_extra).trim();
    if (vhe && (isNaN(Number(vhe)) || Number(vhe) < 0)) {
      e.valor_hora_extra = 'Debe ser numérico >= 0';
    }

    if (form.notas.length > 500) e.notas = 'Máximo 500 caracteres';

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSubmit = async () => {
    if (saving) return;
    if (!validate()) {
      toast.error('Revisá los campos en rojo');
      // abrir secciones con errores
      const eKeys = Object.keys(errors);
      setOpenSections(s => ({
        ...s,
        personales: s.personales || eKeys.some(k => ['nombre','cuil','email'].includes(k)),
        pago:       s.pago       || eKeys.includes('cbu'),
        liquidacion:s.liquidacion|| eKeys.includes('sueldo_bruto_base'),
      }));
      return;
    }
    setSaving(true);
    try {
      const cuilNorm = A.normalizeCuil(form.cuil);
      const payload = {
        nombre: form.nombre.trim(),
        cuil: cuilNorm || '',
        fecha_nacimiento: form.fecha_nacimiento || '',
        email: form.email.trim(),
        telefono: form.telefono.trim(),
        direccion: form.direccion.trim(),
        ciudad: form.ciudad.trim(),
        provincia: form.provincia.trim(),
        codigo_postal: form.codigo_postal.trim(),
        fecha_ingreso: form.fecha_ingreso || '',
        categoria: form.categoria.trim(),
        modalidad: form.modalidad,
        tipo_contratacion: form.tipo_contratacion,
        lugar_trabajo: form.lugar_trabajo.trim(),
        convenio: form.convenio.trim(),
        sueldo_bruto_base: form.sueldo_bruto_base !== '' ? String(Number(form.sueldo_bruto_base)) : '',
        dias_vacaciones_anuales: form.dias_vacaciones_anuales !== '' ? String(parseInt(form.dias_vacaciones_anuales, 10)) : '',
        valor_hora_extra: form.valor_hora_extra !== '' ? String(Number(form.valor_hora_extra)) : '0',
        banco: form.banco.trim(),
        cbu: form.cbu.trim().replace(/\s+/g, ''),
        alias_cbu: form.alias_cbu.trim(),
        forma_cobro: form.forma_cobro,
        notas: form.notas.trim(),
      };
      if (isEdit) {
        payload.id = initial.id;
        // CUIL no editable; se manda igual al actual para evitar HINT='cuil_immutable'
        payload.cuil = initial.cuil || '';
        await A.updateEmployee(payload);
      } else {
        await A.createEmployee(payload);
      }
      toast.success(okMsg);
      try { onSuccess?.(); } catch (_) {}
      onClose?.();
    } catch (err) {
      if (err && err.hint === 'duplicate_cuil') {
        toast.error('Ya existe otro empleado con ese CUIL');
        setOpenSections(s => ({ ...s, personales: true }));
      } else if (err && err.hint === 'cuil_immutable') {
        toast.error('El CUIL no se puede modificar');
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
      {/* SECCIÓN 1 — Datos personales */}
      <EmpSection open={openSections.personales} onToggle={() => toggle('personales')} title="Datos personales">
        <div className="field-group">
          <label className="field-label">Nombre *</label>
          <input className={`field-input ${errors.nombre ? 'has-error' : ''}`}
                 value={form.nombre} maxLength={120} autoFocus
                 onChange={e => set('nombre', e.target.value)}
                 onBlur={validate}/>
          {errors.nombre && <div className="field-error">{errors.nombre}</div>}
        </div>

        <div className="field-group">
          <label className="field-label">CUIL</label>
          <input className={`field-input ${errors.cuil ? 'has-error' : ''} ${isEdit ? 'is-readonly' : ''}`}
                 value={form.cuil} placeholder="XX-XXXXXXXX-X"
                 readOnly={isEdit}
                 title={isEdit ? 'El CUIL no se puede modificar. Para corregir, dá de baja este empleado y creá uno nuevo.' : ''}
                 onChange={e => set('cuil', e.target.value)}
                 onBlur={validate}/>
          {errors.cuil
            ? <div className="field-error">{errors.cuil}</div>
            : isEdit
              ? <div className="field-help">El CUIL es inmutable en edición (S2.11)</div>
              : <div className="field-help">Formato XX-XXXXXXXX-X o 11 dígitos sin guiones</div>}
        </div>

        <div className="supplier-modal-grid">
          <div className="field-group">
            <label className="field-label">Fecha nacimiento</label>
            <input type="date" className="field-input"
                   value={form.fecha_nacimiento}
                   onChange={e => set('fecha_nacimiento', e.target.value)}/>
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

        <div className="field-group">
          <label className="field-label">Teléfono</label>
          <input className="field-input" value={form.telefono}
                 onChange={e => set('telefono', e.target.value)}/>
        </div>

        <div className="field-group">
          <label className="field-label">Dirección</label>
          <input className="field-input" value={form.direccion}
                 onChange={e => set('direccion', e.target.value)}/>
        </div>

        <div className="supplier-modal-grid">
          <div className="field-group">
            <label className="field-label">Ciudad</label>
            <input className="field-input" value={form.ciudad}
                   onChange={e => set('ciudad', e.target.value)}/>
          </div>
          <div className="field-group">
            <label className="field-label">Provincia</label>
            <select className="field-input" value={form.provincia}
                    onChange={e => set('provincia', e.target.value)}>
              <option value="">— Sin especificar —</option>
              {provincias.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>

        <div className="field-group">
          <label className="field-label">Código postal</label>
          <input className="field-input" value={form.codigo_postal}
                 onChange={e => set('codigo_postal', e.target.value)}/>
        </div>
      </EmpSection>

      {/* SECCIÓN 2 — Datos laborales */}
      <EmpSection open={openSections.laborales} onToggle={() => toggle('laborales')} title="Datos laborales">
        <div className="supplier-modal-grid">
          <div className="field-group">
            <label className="field-label">Fecha ingreso</label>
            <input type="date" className="field-input"
                   value={form.fecha_ingreso}
                   onChange={e => set('fecha_ingreso', e.target.value)}/>
          </div>
          <div className="field-group">
            <label className="field-label">Categoría</label>
            <input className="field-input" value={form.categoria}
                   placeholder="Ej: Operario, Administrativo, Depósito"
                   onChange={e => set('categoria', e.target.value)}/>
          </div>
        </div>

        <div className="supplier-modal-grid">
          <div className="field-group">
            <label className="field-label">Modalidad</label>
            <select className="field-input" value={form.modalidad}
                    onChange={e => set('modalidad', e.target.value)}>
              <option value="">— Sin especificar —</option>
              {A.MODALIDAD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="field-group">
            <label className="field-label">Tipo contratación</label>
            <select className="field-input" value={form.tipo_contratacion}
                    onChange={e => set('tipo_contratacion', e.target.value)}>
              <option value="">— Sin especificar —</option>
              {A.TIPO_CONTRATACION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        <div className="supplier-modal-grid">
          <div className="field-group">
            <label className="field-label">Lugar de trabajo</label>
            <input className="field-input" value={form.lugar_trabajo}
                   placeholder="Ej: Taller, Local, Home"
                   onChange={e => set('lugar_trabajo', e.target.value)}/>
          </div>
          <div className="field-group">
            <label className="field-label">Convenio</label>
            <input className="field-input" value={form.convenio}
                   placeholder="Ej: UOM, UTA, fuera de convenio"
                   onChange={e => set('convenio', e.target.value)}/>
          </div>
        </div>
      </EmpSection>

      {/* SECCIÓN 3 — Liquidación base */}
      <EmpSection open={openSections.liquidacion} onToggle={() => toggle('liquidacion')} title="Liquidación base">
        <div className="supplier-modal-grid">
          <div className="field-group">
            <label className="field-label">Sueldo bruto base</label>
            <input type="number" step="0.01" min="0"
                   className={`field-input ${errors.sueldo_bruto_base ? 'has-error' : ''}`}
                   value={form.sueldo_bruto_base}
                   onChange={e => set('sueldo_bruto_base', e.target.value)}
                   onBlur={validate}/>
            {errors.sueldo_bruto_base
              ? <div className="field-error">{errors.sueldo_bruto_base}</div>
              : <div className="field-help">Sueldo de referencia (no se actualiza mes a mes).</div>}
          </div>
          <div className="field-group">
            <label className="field-label">Días vacaciones anuales</label>
            <input type="number" min="0" step="1"
                   className="field-input"
                   value={form.dias_vacaciones_anuales}
                   onChange={e => set('dias_vacaciones_anuales', e.target.value)}/>
          </div>
        </div>

        <div className="field-group">
          <label className="field-label">Valor hora extra ($)</label>
          <input type="number" step="0.01" min="0"
                 className={`field-input ${errors.valor_hora_extra ? 'has-error' : ''}`}
                 value={form.valor_hora_extra}
                 onChange={e => set('valor_hora_extra', e.target.value)}
                 onBlur={validate}/>
          {errors.valor_hora_extra
            ? <div className="field-error">{errors.valor_hora_extra}</div>
            : <div className="field-help">Valor por hora extra (S2.24). Editable también por registro al cargar horas.</div>}
        </div>
      </EmpSection>

      {/* SECCIÓN 4 — Datos de pago */}
      <EmpSection open={openSections.pago} onToggle={() => toggle('pago')} title="Datos de pago">
        <div className="supplier-modal-grid">
          <div className="field-group">
            <label className="field-label">Banco</label>
            <input className="field-input" value={form.banco}
                   onChange={e => set('banco', e.target.value)}/>
          </div>
          <div className="field-group">
            <label className="field-label">Forma de cobro</label>
            <select className="field-input" value={form.forma_cobro}
                    onChange={e => set('forma_cobro', e.target.value)}>
              <option value="">— Sin especificar —</option>
              {A.FORMA_COBRO_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        <div className="field-group">
          <label className="field-label">CBU</label>
          <input className={`field-input ${errors.cbu ? 'has-error' : ''}`}
                 value={form.cbu} maxLength={22}
                 placeholder="22 dígitos"
                 onChange={e => set('cbu', e.target.value.replace(/\s+/g, ''))}
                 onBlur={validate}/>
          {errors.cbu
            ? <div className="field-error">{errors.cbu}</div>
            : <div className="field-help">22 dígitos exactos (sin espacios).</div>}
        </div>

        <div className="field-group">
          <label className="field-label">Alias CBU</label>
          <input className="field-input" value={form.alias_cbu}
                 maxLength={20}
                 placeholder="ej: juan.perez.gal"
                 onChange={e => set('alias_cbu', e.target.value)}/>
        </div>

        <div className="field-group">
          <label className="field-label">Notas</label>
          <textarea className={`field-input ${errors.notas ? 'has-error' : ''}`}
                    value={form.notas} rows={3} maxLength={500}
                    onChange={e => set('notas', e.target.value)}
                    onBlur={validate}/>
          {errors.notas
            ? <div className="field-error">{errors.notas}</div>
            : <div className="field-help">{form.notas.length} / 500 · Visible solo para owner/admin</div>}
        </div>
      </EmpSection>

      {/* SECCIÓN 5 — Historial (solo edit) */}
      {isEdit && (
        <EmpSection open={openSections.historial} onToggle={() => toggle('historial')} title="Historial">
          {historyMounted
            ? <EmployeeHistorialView employeeId={initial.id}/>
            : <div style={{padding:'12px', color:'var(--ink-muted)', fontSize:12}}>
                Expande para cargar el historial…
              </div>}
        </EmpSection>
      )}
    </Cmp>
  );
}

/* Sección colapsable (reusa clases supplier-modal-section* de S2.2). */
function EmpSection({ open, onToggle, title, children }) {
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

/* Historial — S2.15: datos reales del RPC actualizado + botón "Ver
   histórico completo" que abre el HistorialEmpleadoModal. */
function EmployeeHistorialView({ employeeId }) {
  const A = window.ADMIN_DATA;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showFullHistorial, setShowFullHistorial] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    A.getEmployeeHistorial(employeeId)
      .then(d => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(e => { if (!cancelled) { setError(e.message || 'Error'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [employeeId]);

  if (loading) return <div className="supplier-historial-state"><span className="loader" style={{width:18,height:18}}/><span>Cargando…</span></div>;
  if (error) return <div className="supplier-historial-state error"><Icon n="alert" s={14} c="var(--red)"/><span>{error}</span></div>;
  if (!data) return null;

  const ultimo = data.ultimo_recibo;
  const ultimoTxt = ultimo
    ? `${ultimo.tipo} · ${A.formatDate(ultimo.fecha_pago)} · ${A.formatMoney(ultimo.total || 0, 'ARS')}`
    : '—';

  return (
    <div className="supplier-historial">
      <div className="supplier-historial-summary">
        <div className="supplier-historial-stat">
          <div className="supplier-historial-stat-label">Total recibos</div>
          <div className="supplier-historial-stat-value">{data.total_recibos || 0}</div>
        </div>
        <div className="supplier-historial-stat">
          <div className="supplier-historial-stat-label">Suma año {data.anio}</div>
          <div className="supplier-historial-stat-value">
            {A.formatMoney(data.suma_anio || 0, 'ARS')}
          </div>
        </div>
        <div className="supplier-historial-stat">
          <div className="supplier-historial-stat-label">Último recibo</div>
          <div className="supplier-historial-stat-value" style={{fontSize:12}}>
            {ultimoTxt}
          </div>
        </div>
      </div>

      <div style={{marginTop:12, textAlign:'right'}}>
        <button className="btn-ghost"
                onClick={() => setShowFullHistorial(true)}
                disabled={(data.total_recibos || 0) === 0}>
          Ver histórico completo <Icon n="arrow-right" s={12}/>
        </button>
      </div>

      {showFullHistorial && window.HistorialEmpleadoModal && (
        <window.HistorialEmpleadoModal
          employeeId={employeeId}
          onClose={() => setShowFullHistorial(false)}/>
      )}
    </div>
  );
}

window.EmployeeModal = EmployeeModal;
