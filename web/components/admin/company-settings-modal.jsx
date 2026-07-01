/* ══ COMPANY SETTINGS MODAL (S2.12)
   Modal singleton para editar datos del empleador (razon_social,
   cuit, domicilio, ciudad, provincia, codigo_postal, telefono,
   email, notas). Usados como header en los PDFs de recibos.

   Carga inicial: rpc_admin_get_company_settings.
   Guardar: rpc_admin_update_company_settings (MERGE pattern).

   Props: { onClose, onSuccess }
   ══ */

function CompanySettingsModal({ onClose, onSuccess }) {
  const toast = useToast();
  const A = window.ADMIN_DATA;

  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [form, setForm]         = useState({
    razon_social:  window.MAKARIO_BRAND_NAME || 'Justo Makario',
    cuit:          '',
    domicilio:     '',
    ciudad:        '',
    provincia:     '',
    codigo_postal: '',
    telefono:      '',
    email:         '',
    notas:         '',
  });
  const [errors, setErrors] = useState({});

  useEffect(() => {
    let cancelled = false;
    A.getCompanySettings()
      .then(data => {
        if (cancelled || !data) return;
        const cs = window.normalizeCompanySettings ? window.normalizeCompanySettings(data) : data;
        setForm({
          razon_social:  cs.razon_social  || (window.MAKARIO_BRAND_NAME || 'Justo Makario'),
          cuit:          cs.cuit          || '',
          domicilio:     cs.domicilio     || '',
          ciudad:        cs.ciudad        || '',
          provincia:     cs.provincia     || '',
          codigo_postal: cs.codigo_postal || '',
          telefono:      cs.telefono      || '',
          email:         cs.email         || '',
          notas:         cs.notas         || '',
        });
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setLoadError(err.message || 'No se pudo cargar configuración');
        setLoading(false);
      });
    return () => { cancelled = true; };
    /* eslint-disable-next-line */
  }, []);

  const set = (k, v) => setForm(s => ({ ...s, [k]: v }));

  const validate = () => {
    const e = {};
    if (!form.razon_social.trim()) e.razon_social = 'Razón social requerida';
    else if (form.razon_social.length > 120) e.razon_social = 'Máximo 120 caracteres';
    if (form.cuit && !/^\d{2}-\d{8}-\d$/.test(form.cuit.trim())) {
      e.cuit = 'Formato XX-XXXXXXXX-X';
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      e.email = 'Email inválido';
    }
    if (form.notas.length > 500) e.notas = 'Máximo 500 caracteres';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSubmit = async () => {
    if (saving) return;
    if (!validate()) { toast.error('Revisá los campos en rojo'); return; }
    setSaving(true);
    try {
      const payload = {
        razon_social:  form.razon_social.trim(),
        cuit:          form.cuit.trim(),
        domicilio:     form.domicilio.trim(),
        ciudad:        form.ciudad.trim(),
        provincia:     form.provincia.trim(),
        codigo_postal: form.codigo_postal.trim(),
        telefono:      form.telefono.trim(),
        email:         form.email.trim(),
        notas:         form.notas.trim(),
      };
      await A.updateCompanySettings(payload);
      toast.success('Configuración de empresa guardada');
      try { onSuccess?.(); } catch (_) {}
      onClose?.();
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar');
      setSaving(false);
    }
  };

  const safeClose = () => { if (!saving) onClose?.(); };
  const Cmp = window.Modal;
  const provincias = (window.ADMIN_DATA && window.ADMIN_DATA.ARG_PROVINCIAS) || [];

  return (
    <Cmp open={true} title="Configuración de la empresa" onClose={safeClose} footer={
      <>
        <button className="btn-ghost" onClick={safeClose} disabled={saving}>Cancelar</button>
        <button className="btn-primary" onClick={onSubmit} disabled={saving || loading || !!loadError}>
          {saving ? 'Guardando…' : (<><Icon n="check" s={14}/> Guardar</>)}
        </button>
      </>
    }>
      {loading ? (
        <div className="admin-empty-state">
          <span className="loader" style={{width:24, height:24}}/>
        </div>
      ) : loadError ? (
        <div className="admin-empty-state">
          <Icon n="alert" s={28} c="var(--red)"/>
          <h3>Error al cargar</h3>
          <p>{loadError}</p>
        </div>
      ) : (
        <>
          <div className="field-help" style={{marginBottom:12}}>
            Estos datos aparecen como encabezado en los PDFs y documentos
            exportados de la app.
          </div>

          <div className="field-group">
            <label className="field-label">Razón social *</label>
            <input className={`field-input ${errors.razon_social ? 'has-error' : ''}`}
                   value={form.razon_social} maxLength={120} autoFocus
                   onChange={e => set('razon_social', e.target.value)}
                   onBlur={validate}/>
            {errors.razon_social && <div className="field-error">{errors.razon_social}</div>}
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
            <label className="field-label">Domicilio</label>
            <input className="field-input" value={form.domicilio}
                   placeholder="Ej: Av. Maipú 1234"
                   onChange={e => set('domicilio', e.target.value)}/>
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

          <div className="supplier-modal-grid">
            <div className="field-group">
              <label className="field-label">Código postal</label>
              <input className="field-input" value={form.codigo_postal}
                     onChange={e => set('codigo_postal', e.target.value)}/>
            </div>
            <div className="field-group">
              <label className="field-label">Teléfono</label>
              <input className="field-input" value={form.telefono}
                     onChange={e => set('telefono', e.target.value)}/>
            </div>
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
            <label className="field-label">Notas internas</label>
            <textarea className={`field-input ${errors.notas ? 'has-error' : ''}`}
                      value={form.notas} rows={3} maxLength={500}
                      onChange={e => set('notas', e.target.value)}
                      onBlur={validate}/>
            {errors.notas
              ? <div className="field-error">{errors.notas}</div>
              : <div className="field-help">{form.notas.length} / 500 · No aparece en el PDF</div>}
          </div>
        </>
      )}
    </Cmp>
  );
}

window.CompanySettingsModal = CompanySettingsModal;
