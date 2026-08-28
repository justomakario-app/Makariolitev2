/* ══ MAIL CONFIG MODAL (0167)
   El punto 3 de lo que pidió el cliente: "mail de alerta de ingreso de nuevo
   pedido". Acá se configura de dónde sale ese mail y a quién le llega.

   Cómo funciona por abajo, porque no es obvio:
   el mail NO lo manda esta app. Lo manda la base de datos con pg_net, desde
   b2b_fn_mail_out, en el mismo momento en que b2b_rpc_enviar_pedido crea el
   pedido. Nadie tiene que tener el navegador abierto para que salga.

   ⚠ La API key NUNCA vuelve del servidor. rpc_admin_get_mail_config devuelve
   `tiene_key: true/false` y nada más: la clave vive en app_mail_config, que
   tiene RLS prendida y CERO policies, así que PostgREST no la puede leer ni
   con la sesión del owner. Por eso el campo arranca siempre vacío y dejarlo
   vacío significa "no la toques", no "borrala". Para borrarla está el botón.

   Falla en silencio a propósito: si el proveedor está caído o la clave está
   mal, el pedido del cliente se guarda igual y la campanita interna suena
   igual. Un mail que no sale no puede voltear una venta. La contra es que
   "no llegó" es silencioso, y para eso está "Ver últimos intentos", que lee
   lo que pg_net registró de verdad.

   Props: { onClose }
   ══ */

function MailConfigModal({ onClose }) {
  const toast = useToast();
  const A = window.ADMIN_DATA;

  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [probando, setProbando]   = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [tieneKey, setTieneKey]   = useState(false);
  const [intentos, setIntentos]   = useState(null);
  const [errors, setErrors]       = useState({});
  const [form, setForm] = useState({
    proveedor:     'resend',
    api_key:       '',
    from_email:    '',
    from_nombre:   'Justo Makario Home',
    destinatarios: '',
    base_url:      'https://justomakario.lat',
    activo:        false,
  });

  const aplicar = (cfg) => {
    if (!cfg || cfg.ok === false) return;
    setTieneKey(!!cfg.tiene_key);
    setForm({
      proveedor:     cfg.proveedor     || 'resend',
      api_key:       '',
      from_email:    cfg.from_email    || '',
      from_nombre:   cfg.from_nombre   || 'Justo Makario Home',
      destinatarios: cfg.destinatarios || '',
      base_url:      cfg.base_url      || 'https://justomakario.lat',
      activo:        !!cfg.activo,
    });
  };

  useEffect(() => {
    let cancelled = false;
    A.getMailConfig()
      .then(cfg => { if (!cancelled) { aplicar(cfg); setLoading(false); } })
      .catch(err => {
        if (cancelled) return;
        setLoadError(err.message || 'No se pudo cargar la configuración de avisos');
        setLoading(false);
      });
    return () => { cancelled = true; };
    /* eslint-disable-next-line */
  }, []);

  const set = (k, v) => setForm(s => ({ ...s, [k]: v }));

  /* Los destinatarios se escriben separados por coma. Se valida acá porque un
     mail mal tipeado no da error: el proveedor lo acepta, cobra el envío y el
     mail simplemente no llega a nadie. */
  const mails = () => form.destinatarios.split(',').map(x => x.trim()).filter(Boolean);

  const validate = () => {
    const e = {};
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (form.from_email && !re.test(form.from_email.trim())) e.from_email = 'Email inválido';
    const malos = mails().filter(m => !re.test(m));
    if (malos.length) e.destinatarios = 'Revisá: ' + malos.join(', ');
    if (form.activo) {
      if (!form.from_email.trim()) e.from_email = 'Con los avisos prendidos hace falta el remitente';
      if (!mails().length) e.destinatarios = 'Con los avisos prendidos hace falta al menos un destinatario';
      if (!tieneKey && !form.api_key.trim()) e.api_key = 'Falta la clave del proveedor';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const armarPayload = (extra) => Object.assign({
    proveedor:     form.proveedor,
    from_email:    form.from_email.trim(),
    from_nombre:   form.from_nombre.trim(),
    destinatarios: mails().join(', '),
    base_url:      form.base_url.trim(),
    activo:        form.activo,
  }, extra || {});

  const guardar = async () => {
    if (saving) return;
    if (!validate()) { toast.error('Revisá los campos en rojo'); return; }
    setSaving(true);
    try {
      /* La clave solo viaja si el owner escribió una nueva. Vacío = dejala
         como está; el backend hace exactamente eso. */
      const payload = armarPayload(form.api_key.trim() ? { api_key: form.api_key.trim() } : null);
      const cfg = await A.setMailConfig(payload);
      aplicar(cfg);
      toast.success('Avisos por mail guardados');
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar');
    } finally { setSaving(false); }
  };

  /* Borrar la clave es explícito y aparte: si "guardar con el campo vacío" la
     borrara, cualquier retoque de los destinatarios dejaría los avisos mudos
     sin que nadie se entere hasta el próximo pedido. */
  const borrarKey = async () => {
    if (!window.confirm('¿Sacamos la clave guardada? Los avisos dejan de salir hasta que cargues otra.')) return;
    setSaving(true);
    try {
      const cfg = await A.setMailConfig(armarPayload({ api_key: null, activo: false }));
      aplicar(cfg);
      toast.success('Clave borrada. Los avisos quedaron apagados.');
    } catch (err) {
      toast.error(err.message || 'No se pudo borrar la clave');
    } finally { setSaving(false); }
  };

  /* Probar guarda primero. Sin eso, el owner pega la clave, aprieta "Probar",
     no le llega nada y no hay forma de saber si falló la clave o si nunca se
     había guardado. */
  const probar = async () => {
    if (probando) return;
    if (!validate()) { toast.error('Revisá los campos en rojo'); return; }
    setProbando(true);
    setIntentos(null);
    try {
      const payload = armarPayload(form.api_key.trim()
        ? { api_key: form.api_key.trim(), activo: true }
        : { activo: true });
      const cfg = await A.setMailConfig(payload);
      aplicar(cfg);
      const r = await A.probarMail({ destinatarios: mails().join(', ') });
      if (r && r.ok) {
        toast.success('Salió a ' + r.enviados + (r.enviados === 1 ? ' dirección' : ' direcciones') +
                      '. Fijate en la casilla (y en spam).');
      } else {
        toast.error('No salió. Mirá los últimos intentos para ver qué contestó el proveedor.');
        await verIntentos();
      }
    } catch (err) {
      toast.error(err.message || 'No se pudo mandar la prueba');
    } finally { setProbando(false); }
  };

  const verIntentos = async () => {
    try {
      const r = await A.mailEstado({});
      setIntentos((r && r.intentos) || []);
    } catch (err) {
      toast.error(err.message || 'No se pudo leer el estado');
    }
  };

  const safeClose = () => { if (!saving && !probando) onClose?.(); };
  const Cmp = window.Modal;
  const ocupado = saving || probando;

  return (
    <Cmp open={true} title="Avisos por mail" onClose={safeClose} footer={
      <>
        <button className="btn-ghost" onClick={safeClose} disabled={ocupado}>Cerrar</button>
        <button className="btn-ghost" onClick={probar} disabled={ocupado || loading || !!loadError}>
          {probando ? 'Mandando…' : (<><Icon n="send" s={14}/> Guardar y probar</>)}
        </button>
        <button className="btn-primary" onClick={guardar} disabled={ocupado || loading || !!loadError}>
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
            Cuando entra un pedido nuevo de la tienda mayorista, sale un mail
            a las direcciones de acá abajo. Lo manda la base de datos sola:
            no hace falta tener la app abierta.
          </div>

          <label className="admin-toggle-inactive" style={{marginBottom:14}}>
            <input type="checkbox" checked={form.activo}
                   onChange={e => set('activo', e.target.checked)}/>
            Mandar los avisos
          </label>

          <div className="supplier-modal-grid">
            <div className="field-group">
              <label className="field-label">Proveedor</label>
              <select className="field-input" value={form.proveedor}
                      onChange={e => set('proveedor', e.target.value)}>
                <option value="resend">Resend</option>
                <option value="brevo">Brevo</option>
              </select>
            </div>
            <div className="field-group">
              <label className="field-label">Nombre del remitente</label>
              <input className="field-input" value={form.from_nombre} maxLength={80}
                     onChange={e => set('from_nombre', e.target.value)}/>
            </div>
          </div>

          <div className="field-group">
            <label className="field-label">API key</label>
            <input className={`field-input ${errors.api_key ? 'has-error' : ''}`}
                   type="password" value={form.api_key} autoComplete="off"
                   placeholder={tieneKey ? '•••••••• (hay una guardada)' : 'Pegá la clave del proveedor'}
                   onChange={e => set('api_key', e.target.value)}/>
            {errors.api_key
              ? <div className="field-error">{errors.api_key}</div>
              : <div className="field-help">
                  {tieneKey
                    ? 'Ya hay una clave guardada. Dejalo vacío para no tocarla.'
                    : 'La sacás del panel del proveedor. No se puede volver a leer desde acá.'}
                  {tieneKey && (
                    <>
                      {' · '}
                      <button className="btn-link" type="button" onClick={borrarKey} disabled={ocupado}>
                        Borrar la guardada
                      </button>
                    </>
                  )}
                </div>}
          </div>

          <div className="field-group">
            <label className="field-label">Remitente</label>
            <input className={`field-input ${errors.from_email ? 'has-error' : ''}`}
                   type="email" value={form.from_email} autoComplete="off"
                   placeholder="pedidos@justomakario.lat"
                   onChange={e => set('from_email', e.target.value)}
                   onBlur={validate}/>
            {errors.from_email
              ? <div className="field-error">{errors.from_email}</div>
              : <div className="field-help">
                  Tiene que ser de un dominio verificado en el proveedor, o los
                  mails se van a rechazar.
                </div>}
          </div>

          <div className="field-group">
            <label className="field-label">Destinatarios</label>
            <input className={`field-input ${errors.destinatarios ? 'has-error' : ''}`}
                   value={form.destinatarios} autoComplete="off"
                   placeholder="ventas@… , produccion@…"
                   onChange={e => set('destinatarios', e.target.value)}
                   onBlur={validate}/>
            {errors.destinatarios
              ? <div className="field-error">{errors.destinatarios}</div>
              : <div className="field-help">Separados por coma.</div>}
          </div>

          <div className="field-group">
            <label className="field-label">Dirección del sistema</label>
            <input className="field-input" value={form.base_url} autoComplete="off"
                   onChange={e => set('base_url', e.target.value)}/>
            <div className="field-help">
              Con esto se arma el link del mail para abrir el pedido. Sin la
              barra final.
            </div>
          </div>

          {/* Diagnóstico. Lee lo que pg_net registró: si el proveedor contestó
              401, acá se ve el 401 y no un genérico "no llegó". */}
          <div className="field-sep">
            <h4>¿No llega?</h4>
            <p>
              Estos son los últimos intentos que hizo la base, con lo que
              contestó el proveedor.
            </p>
          </div>
          <button className="btn-ghost" type="button" onClick={verIntentos} disabled={ocupado}>
            <Icon n="refresh" s={13}/> Ver últimos intentos
          </button>

          {intentos && (
            intentos.length === 0 ? (
              <div className="field-help" style={{marginTop:10}}>
                No hay ningún intento registrado todavía.
              </div>
            ) : (
              <ul className="mail-intentos">
                {intentos.map(t => {
                  const ok = t.status >= 200 && t.status < 300;
                  return (
                    <li key={t.id} className={ok ? 'es-ok' : 'es-mal'}>
                      <b>{t.status || 'sin respuesta'}</b>
                      <span className="mail-intento-cuando">
                        {window.B2B_DATA ? window.B2B_DATA.fechaHora(t.cuando) : t.cuando}
                      </span>
                      {(t.error || (!ok && t.respuesta)) && (
                        <span className="mail-intento-msg">{t.error || t.respuesta}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )
          )}
        </>
      )}
    </Cmp>
  );
}

window.MailConfigModal = MailConfigModal;
