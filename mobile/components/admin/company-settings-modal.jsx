/* ══ COMPANY SETTINGS MODAL (S2.12 · ampliado en 0167)
   Modal singleton para editar datos del empleador (razon_social,
   cuit, domicilio, ciudad, provincia, codigo_postal, telefono,
   email, notas). Usados como header en los PDFs de recibos.

   0167 le suma los datos de cobro (banco, cbu, alias, titular, cuit de la
   cuenta y notas de pago). ⚠ Ojo con esos seis: NO son internos. Salen por
   b2b_rpc_mi_cuenta y se le muestran al mayorista en la tienda y en el PDF
   del presupuesto. Lo interno sigue siendo un solo campo, "notas".

   Mientras el CBU y el alias estén los dos vacíos, la tienda directamente
   no dibuja la caja de "datos para transferir": una caja con lugares en
   blanco es peor que ninguna.

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
    banco:          '',
    cbu:            '',
    alias_cbu:      '',
    titular_cuenta: '',
    cuit_cuenta:    '',
    notas_pago:     '',
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
          banco:          cs.banco          || '',
          cbu:            cs.cbu            || '',
          alias_cbu:      cs.alias_cbu      || '',
          titular_cuenta: cs.titular_cuenta || '',
          cuit_cuenta:    cs.cuit_cuenta    || '',
          notas_pago:     cs.notas_pago     || '',
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
    /* El CBU son 22 dígitos exactos. Uno de más o de menos manda la plata a
       cualquier lado, así que no se guarda a medias: o está bien o no está.
       Se limpian espacios y guiones porque es lo que sale al copiar del
       homebanking. */
    const cbu = form.cbu.replace(/[\s-]/g, '');
    if (cbu && !/^\d{22}$/.test(cbu)) e.cbu = 'El CBU/CVU son 22 dígitos';
    if (form.cuit_cuenta && !/^\d{2}-\d{8}-\d$/.test(form.cuit_cuenta.trim())) {
      e.cuit_cuenta = 'Formato XX-XXXXXXXX-X';
    }
    if (form.notas_pago.length > 300) e.notas_pago = 'Máximo 300 caracteres';
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
        banco:          form.banco.trim(),
        /* Se guarda sin espacios ni guiones: es lo que el cliente va a
           copiar de un toque y pegar en el homebanking. */
        cbu:            form.cbu.replace(/[\s-]/g, ''),
        alias_cbu:      form.alias_cbu.trim(),
        titular_cuenta: form.titular_cuenta.trim(),
        cuit_cuenta:    form.cuit_cuenta.trim(),
        notas_pago:     form.notas_pago.trim(),
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

          {/* ── Cobro ──────────────────────────────────────────────────
              Esto lo VE EL CLIENTE. Va separado y avisado para que nadie
              escriba acá una nota para el contador. */}
          <div className="field-sep">
            <h4>Datos para que te transfieran</h4>
            <p>
              Se los mostramos al mayorista apenas manda el pedido y también
              van impresos en el PDF del presupuesto. Si dejás el CBU y el
              alias vacíos, no se muestra nada.
            </p>
          </div>

          <div className="supplier-modal-grid">
            <div className="field-group">
              <label className="field-label">Banco</label>
              <input className="field-input" value={form.banco} maxLength={80}
                     placeholder="Ej: Banco Galicia"
                     onChange={e => set('banco', e.target.value)}/>
            </div>
            <div className="field-group">
              <label className="field-label">Titular de la cuenta</label>
              <input className="field-input" value={form.titular_cuenta} maxLength={120}
                     placeholder="Si es distinto de la razón social"
                     onChange={e => set('titular_cuenta', e.target.value)}/>
            </div>
          </div>

          <div className="field-group">
            <label className="field-label">CBU / CVU</label>
            <input className={`field-input ${errors.cbu ? 'has-error' : ''}`}
                   value={form.cbu} inputMode="numeric" maxLength={30}
                   placeholder="22 dígitos"
                   onChange={e => set('cbu', e.target.value)}
                   onBlur={validate}/>
            {errors.cbu
              ? <div className="field-error">{errors.cbu}</div>
              : <div className="field-help">Podés pegarlo con espacios o guiones: los sacamos al guardar.</div>}
          </div>

          <div className="supplier-modal-grid">
            <div className="field-group">
              <label className="field-label">Alias</label>
              <input className="field-input" value={form.alias_cbu} maxLength={40}
                     placeholder="mi.alias.cbu"
                     onChange={e => set('alias_cbu', e.target.value)}/>
            </div>
            <div className="field-group">
              <label className="field-label">CUIT de la cuenta</label>
              <input className={`field-input ${errors.cuit_cuenta ? 'has-error' : ''}`}
                     value={form.cuit_cuenta} placeholder="Si es distinto del de arriba"
                     onChange={e => set('cuit_cuenta', e.target.value)}
                     onBlur={validate}/>
              {errors.cuit_cuenta && <div className="field-error">{errors.cuit_cuenta}</div>}
            </div>
          </div>

          <div className="field-group">
            <label className="field-label">Aclaración de pago</label>
            <textarea className={`field-input ${errors.notas_pago ? 'has-error' : ''}`}
                      value={form.notas_pago} rows={2} maxLength={300}
                      placeholder="Ej: Mandanos el comprobante por acá mismo. Anticipo del 50%."
                      onChange={e => set('notas_pago', e.target.value)}
                      onBlur={validate}/>
            {errors.notas_pago
              ? <div className="field-error">{errors.notas_pago}</div>
              : <div className="field-help">{form.notas_pago.length} / 300 · La lee el cliente</div>}
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
