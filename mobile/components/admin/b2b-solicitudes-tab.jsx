/* ══ TIENDA MAYORISTA — ACCESOS (invitaciones + aprobación de usuarios)
   Dos listas, porque son dos momentos distintos del mismo camino:

     1. INVITACIONES: el admin emite un link para un email concreto. Nadie
        puede registrarse sin uno — la tienda es cerrada.
     2. USUARIOS: quien ya canjeó su invitación queda en 'pendiente' y no ve
        precios ni puede pedir hasta que alguien lo apruebe a mano.

   Aprobar no es solo un cambio de estado: b2b_rpc_resolver_usuario marca al
   cliente como es_mayorista + b2b_habilitado, o sea que recién ahí el
   cliente aparece en la ficha de "Clientes mayoristas". Por eso conviene
   aprobar desde acá y no tocar customers_b2b a mano.
   ══ */

function B2BSolicitudesTab({ onCambio } = {}) {
  const toast = useToast();

  const [usuarios, setUsuarios]   = useState([]);
  const [invits,   setInvits]     = useState([]);
  const [loading,  setLoading]    = useState(true);
  const [error,    setError]      = useState(null);
  const [verTodos, setVerTodos]   = useState(false);   // false = solo pendientes
  const [corriendo, setCorriendo] = useState(null);    // usuario_id en curso
  const [rechazo,  setRechazo]    = useState(null);    // { usuario } → modal motivo
  const [nuevaInv, setNuevaInv]   = useState(false);
  const [tokenNuevo, setTokenNuevo] = useState(null);  // { token, email, expira_at }
  const [aRevocar, setARevocar]   = useState(null);    // invitación a dar de baja
  const [revocando, setRevocando] = useState(false);

  const reload = async () => {
    setLoading(true); setError(null);
    try {
      const [us, iv] = await Promise.all([
        window.B2B_DATA.usuarios(verTodos ? {} : { estado: 'pendiente' }),
        window.B2B_DATA.invitaciones({}),
      ]);
      setUsuarios(us || []);
      setInvits(iv || []);
    } catch (err) {
      const msg = err?.message || 'Error desconocido';
      setError(msg); toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [verTodos]);

  const resolver = async (usuario, estado, motivo) => {
    if (corriendo) return;
    setCorriendo(usuario.id);
    try {
      await window.B2B_DATA.resolverUsuario({ usuario_id: usuario.id, estado, motivo: motivo || null });
      toast.success(
        estado === 'aprobado'   ? `${usuario.nombre} ya puede comprar` :
        estado === 'rechazado'  ? 'Solicitud rechazada' :
                                  'Usuario suspendido'
      );
      setRechazo(null);
      await reload();
      onCambio?.();
    } catch (err) {
      toast.error(err?.message || 'No se pudo aplicar el cambio');
    } finally {
      setCorriendo(null);
    }
  };

  /* Revocar corta el código antes de que alguien lo canjee. Es lo único que
     sirve cuando el token en claro se mandó al WhatsApp equivocado: el token
     no se puede "ver" de nuevo ni rotar, solo matar y emitir otro. Sobre una
     ya usada el backend devuelve 0A000 — al que ya entró se lo suspende como
     usuario, que es otra fila y otro botón. */
  const revocar = async () => {
    if (!aRevocar || revocando) return;
    setRevocando(true);
    try {
      await window.B2B_DATA.revocarInvitacion({ invitacion_id: aRevocar.id });
      toast.success(`Invitación de ${aRevocar.email} dada de baja`);
      setARevocar(null);
      await reload();
    } catch (err) {
      const msg = err?.code === '0A000'
        ? 'Esa invitación ya se usó. Para sacarle el acceso, suspendé al usuario.'
        : (err?.message || 'No se pudo revocar la invitación');
      toast.error(msg);
      setARevocar(null);
      await reload();
    } finally {
      setRevocando(false);
    }
  };

  const copiar = async (texto) => {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success('Copiado');
    } catch (e) {
      /* clipboard falla en http:// sin permiso; que el admin lo copie a mano */
      toast.info('No se pudo copiar solo — seleccionalo y copialo a mano');
    }
  };

  const badgeEstado = (estado) => {
    const map = {
      pendiente:  { bg:'#fef3c7', fg:'#92400e', txt:'Pendiente' },
      aprobado:   { bg:'#e6f7ec', fg:'#15803d', txt:'Aprobado' },
      rechazado:  { bg:'#fee2e2', fg:'#b91c1c', txt:'Rechazado' },
      suspendido: { bg:'#e5e7eb', fg:'#374151', txt:'Suspendido' },
      usada:      { bg:'#e6f7ec', fg:'#15803d', txt:'Usada' },
      revocada:   { bg:'#e5e7eb', fg:'#374151', txt:'Revocada' },
      /* Vencida NO es un estado de la tabla: en la base sigue siendo
         'pendiente' y la vigencia se calcula al canjear. Pero mostrarla como
         "Revocada" era mentir — nadie la dio de baja, se le pasó la fecha — y
         cambia lo que hay que hacer: una vencida se reemplaza emitiendo otra,
         una revocada ya se decidió que no va. */
      vencida:    { bg:'#fee2e2', fg:'#b91c1c', txt:'Vencida' },
    };
    const s = map[estado] || { bg:'#e5e7eb', fg:'#374151', txt: estado || '—' };
    return (
      <span style={{fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:6,
                    background:s.bg, color:s.fg, textTransform:'uppercase', letterSpacing:'.05em'}}>
        {s.txt}
      </span>
    );
  };

  const vencida = (inv) => inv.estado === 'pendiente' && new Date(inv.expira_at) < new Date();

  if (loading) {
    return <div className="admin-empty-state"><span className="loader" style={{width:24, height:24}}/></div>;
  }
  if (error) {
    return (
      <div className="admin-empty-state">
        <Icon n="alert" s={28} c="var(--red)"/>
        <h3>Error al cargar</h3>
        <p>{error}</p>
        <button className="btn-ghost" onClick={reload}><Icon n="refresh" s={13}/> Reintentar</button>
      </div>
    );
  }

  return (
    <div>
      <div className="admin-tab-header">
        <label className="admin-toggle-inactive">
          <input type="checkbox" checked={verTodos} onChange={e => setVerTodos(e.target.checked)}/>
          Ver todos los usuarios (no solo los pendientes)
        </label>
        <button className="btn-ghost" onClick={reload}><Icon n="refresh" s={13}/> Actualizar</button>
        <button className="btn-primary" onClick={() => setNuevaInv(true)}>
          <Icon n="plus" s={13}/> Invitar mayorista
        </button>
      </div>

      {/* ── Usuarios ── */}
      <div className="card">
        <div style={{padding:'12px 14px 0', fontWeight:700, fontSize:13}}>
          {verTodos ? 'Usuarios de la tienda' : 'Esperando aprobación'}
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Persona</th><th>Cliente</th><th>Canal</th>
              <th>Pidió acceso</th><th>Estado</th><th></th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map(u => (
              <tr key={u.id}>
                <td>
                  <div style={{fontWeight:600}}>{u.nombre}</div>
                  <div style={{fontSize:11, color:'var(--ink-muted)'}}>{u.email}</div>
                  {u.telefono && <div style={{fontSize:11, color:'var(--ink-muted)'}}>{u.telefono}</div>}
                </td>
                <td>
                  {u.cliente?.nombre || '—'}
                  {u.cliente?.cuit && (
                    <div><span className="order-num" style={{fontSize:10}}>{u.cliente.cuit}</span></div>
                  )}
                </td>
                <td style={{textTransform:'capitalize'}}>{u.cliente?.b2b_canal || '—'}</td>
                <td>{window.B2B_DATA.fechaHora(u.created_at)}</td>
                <td>
                  {badgeEstado(u.estado)}
                  {u.rechazo_motivo && (
                    <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:3}}>{u.rechazo_motivo}</div>
                  )}
                </td>
                <td className="cta-cte-actions">
                  {u.estado === 'pendiente' && (
                    <React.Fragment>
                      <button className="btn-primary" style={{padding:'4px 10px', fontSize:12}}
                              disabled={corriendo === u.id}
                              onClick={() => resolver(u, 'aprobado')}>
                        <Icon n="check" s={12}/> Aprobar
                      </button>
                      <button className="btn-ghost-sm danger" title="Rechazar"
                              disabled={corriendo === u.id}
                              onClick={() => setRechazo({ usuario: u, estado: 'rechazado' })}>
                        <Icon n="x" s={12}/>
                      </button>
                    </React.Fragment>
                  )}
                  {u.estado === 'aprobado' && (
                    <button className="btn-ghost-sm danger" title="Suspender el acceso"
                            disabled={corriendo === u.id}
                            onClick={() => setRechazo({ usuario: u, estado: 'suspendido' })}>
                      <Icon n="lock" s={12}/> Suspender
                    </button>
                  )}
                  {(u.estado === 'rechazado' || u.estado === 'suspendido') && (
                    <button className="btn-ghost-sm" title="Volver a habilitarlo"
                            disabled={corriendo === u.id}
                            onClick={() => resolver(u, 'aprobado')}>
                      <Icon n="refresh" s={12}/> Rehabilitar
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {usuarios.length === 0 && (
              <tr><td colSpan={6} style={{textAlign:'center', padding:'24px', color:'var(--ink-muted)'}}>
                {verTodos ? 'Todavía no hay nadie registrado en la tienda.'
                          : 'No hay solicitudes esperando. '}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Invitaciones ── */}
      <div className="card" style={{marginTop:16}}>
        <div style={{padding:'12px 14px 0', fontWeight:700, fontSize:13}}>Invitaciones emitidas</div>
        <table className="data-table">
          <thead>
            <tr><th>Email invitado</th><th>Cliente</th><th>Canal</th><th>Emitida</th><th>Vence</th><th>Estado</th></tr>
          </thead>
          <tbody>
            {invits.map(i => (
              <tr key={i.id}>
                <td style={{fontWeight:600}}>{i.email}</td>
                <td>
                  {i.cliente_nombre || '—'}
                  {i.cliente_cuit && (
                    <div><span className="order-num" style={{fontSize:10}}>{i.cliente_cuit}</span></div>
                  )}
                </td>
                <td style={{textTransform:'capitalize'}}>{i.canal}</td>
                <td>{window.B2B_DATA.fecha(i.created_at)}</td>
                <td style={vencida(i) ? {color:'var(--red)', fontWeight:600} : undefined}>
                  {window.B2B_DATA.fecha(i.expira_at)}
                </td>
                {/* Mobile: el botón de revocar va ADENTRO de la celda de
                    estado, no en una columna nueva. La tabla ya se va de
                    ancho en un celular y una séptima columna la empuja fuera
                    de la pantalla; acá abajo del badge se ve sin scrollear. */}
                <td>
                  {vencida(i) ? badgeEstado('vencida') : badgeEstado(i.estado)}
                  {i.estado === 'pendiente' && (
                    <div>
                      <button className="btn-ghost-sm danger" disabled={revocando}
                              style={{marginLeft:0, marginTop:4}}
                              onClick={() => setARevocar(i)}>
                        <Icon n="x" s={12}/> Revocar
                      </button>
                    </div>
                  )}
                  {i.estado === 'revocada' && i.revocada_at && (
                    <div style={{fontSize:10, color:'var(--ink-muted)', marginTop:3}}>
                      {window.B2B_DATA.fecha(i.revocada_at)}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {invits.length === 0 && (
              <tr><td colSpan={6} style={{textAlign:'center', padding:'24px', color:'var(--ink-muted)'}}>
                Todavía no invitaste a nadie.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {aRevocar && (
        <window.Modal open={true} title="Dar de baja la invitación"
                      onClose={() => !revocando && setARevocar(null)}
                      footer={
                        <>
                          <button className="btn-ghost" disabled={revocando}
                                  onClick={() => setARevocar(null)}>No, dejarla</button>
                          <button className="btn-danger" disabled={revocando} onClick={revocar}>
                            {revocando ? 'Revocando…' : (<><Icon n="x" s={13}/> Sí, revocar</>)}
                          </button>
                        </>
                      }>
          <div style={{fontSize:13, color:'var(--ink-soft)', lineHeight:1.6}}>
            El código que se le mandó a <b style={{color:'var(--ink)'}}>{aRevocar.email}</b> deja
            de funcionar en el momento. No se puede volver atrás: si igual lo querés adentro,
            hay que emitir una invitación nueva.
          </div>
        </window.Modal>
      )}

      {nuevaInv && (
        <B2BInvitacionModal
          onClose={() => setNuevaInv(false)}
          onCreada={async (res, email) => {
            setNuevaInv(false);
            setTokenNuevo({ token: res.token, email, expira_at: res.expira_at });
            await reload();
          }}/>
      )}

      {tokenNuevo && (
        <window.Modal open={true} title="Invitación creada"
                      onClose={() => setTokenNuevo(null)}
                      footer={<button className="btn-primary" onClick={() => setTokenNuevo(null)}>Listo</button>}>
          <div className="field-group">
            <div style={{display:'flex', gap:8, alignItems:'flex-start', padding:'10px 12px', borderRadius:8,
                         background:'#fef3c7', color:'#92400e', fontSize:12, lineHeight:1.5}}>
              <Icon n="alert" s={16} c="#92400e"/>
              <div>
                <b>Este link se muestra una sola vez.</b> En la base queda guardado
                solo el hash del código, así que no hay forma de volver a verlo: si
                se pierde, hay que emitir una invitación nueva. Copialo y mandáselo
                a <b>{tokenNuevo.email}</b> antes de cerrar.
              </div>
            </div>
          </div>

          {/* /tienda/?codigo=XYZ abre directo en "Canjear invitación" con el
              código ya puesto — ver tienda-acceso.jsx (modoDesdeUrl/codigoDesdeUrl).
              window.location.origin porque el panel y la tienda viven en el
              mismo dominio (nginx: / → panel, /tienda/ → tienda mayorista). */}
          <div className="field-group">
            <label className="field-label">Link para mandarle</label>
            <div style={{display:'flex', gap:8}}>
              <input className="field-input" readOnly
                     value={`${window.location.origin}/tienda/?codigo=${encodeURIComponent(tokenNuevo.token)}`}
                     onFocus={e => e.target.select()}
                     style={{fontFamily:'ui-monospace, monospace', fontSize:12}}/>
              <button className="btn-ghost"
                      onClick={() => copiar(`${window.location.origin}/tienda/?codigo=${encodeURIComponent(tokenNuevo.token)}`)}>
                <Icon n="copy" s={14}/> Copiar
              </button>
            </div>
            <div className="field-help">
              Vence el {window.B2B_DATA.fecha(tokenNuevo.expira_at)}. Al abrirlo le
              aparece el código ya puesto — solo tiene que crear su acceso.
            </div>
          </div>

          <div className="field-group">
            <label className="field-label">Código, por si se lo pasás así</label>
            <div style={{display:'flex', gap:8}}>
              <input className="field-input" readOnly value={tokenNuevo.token}
                     onFocus={e => e.target.select()}
                     style={{fontFamily:'ui-monospace, monospace', fontSize:12}}/>
              <button className="btn-ghost" onClick={() => copiar(tokenNuevo.token)}>
                <Icon n="copy" s={14}/> Copiar
              </button>
            </div>
            <div className="field-help">
              Lo pega en "Tengo un código de invitación" desde {window.location.origin}/tienda/
            </div>
          </div>
        </window.Modal>
      )}

      {rechazo && (
        <B2BMotivoModal
          usuario={rechazo.usuario}
          estado={rechazo.estado}
          corriendo={corriendo === rechazo.usuario.id}
          onClose={() => setRechazo(null)}
          onConfirmar={(motivo) => resolver(rechazo.usuario, rechazo.estado, motivo)}/>
      )}
    </div>
  );
}

/* ── Modal: emitir invitación ─────────────────────────────────────────
   El canal se elige acá y no después, porque es lo que fija el precio que
   va a ver esa persona apenas entre. Se puede invitar a un cliente que ya
   existe (lo normal: ya le vendemos) o crear uno nuevo por nombre. ── */
function B2BInvitacionModal({ onClose, onCreada }) {
  const toast = useToast();
  const [canales,  setCanales]  = useState([]);
  const [clientes, setClientes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [modo, setModo] = useState('existente');   // 'existente' | 'nuevo'
  const [form, setForm] = useState({
    email:'', canal:'', cliente_id:'', cliente_nombre:'', cliente_cuit:'', dias_validez:14,
  });
  const [errores, setErrores] = useState({});

  useEffect(() => {
    (async () => {
      try {
        const [cs, cls] = await Promise.all([
          window.B2B_DATA.canales(),
          window.ADMIN_DATA.loadCustomersB2B({}),
        ]);
        const activos = (cs || []).filter(c => c.activo !== false);
        setCanales(activos);
        setClientes(cls || []);
        setForm(f => ({ ...f, canal: f.canal || (activos[0]?.codigo || '') }));
      } catch (err) {
        toast.error(err?.message || 'No se pudieron cargar canales y clientes');
      } finally {
        setCargando(false);
      }
    })();
    /* eslint-disable-next-line */
  }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const validar = () => {
    const e = {};
    const email = (form.email || '').trim();
    if (!email) e.email = 'Hace falta el email de quien va a entrar';
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) e.email = 'Email inválido';
    if (!form.canal) e.canal = 'Elegí el canal';
    if (modo === 'existente' && !form.cliente_id) e.cliente_id = 'Elegí el cliente';
    if (modo === 'nuevo' && !(form.cliente_nombre || '').trim()) e.cliente_nombre = 'Poné la razón social';
    setErrores(e);
    return Object.keys(e).length === 0;
  };

  const enviar = async () => {
    if (guardando || !validar()) return;
    setGuardando(true);
    const email = form.email.trim().toLowerCase();
    try {
      const payload = {
        email,
        canal: form.canal,
        dias_validez: Number(form.dias_validez) || 14,
      };
      if (modo === 'existente') payload.cliente_id = form.cliente_id;
      else {
        payload.cliente_nombre = form.cliente_nombre.trim();
        if ((form.cliente_cuit || '').trim()) payload.cliente_cuit = form.cliente_cuit.trim();
      }
      const res = await window.B2B_DATA.crearInvitacion(payload);
      onCreada?.(res, email);
    } catch (err) {
      toast.error(err?.message || 'No se pudo crear la invitación');
      setGuardando(false);
    }
  };

  const cerrar = () => { if (!guardando) onClose?.(); };
  const Cmp = window.Modal;

  return (
    <Cmp open={true} title="Invitar a un mayorista" onClose={cerrar} footer={
      <>
        <button className="btn-ghost" onClick={cerrar} disabled={guardando}>Cancelar</button>
        <button className="btn-primary" onClick={enviar} disabled={guardando || cargando}>
          {guardando ? 'Creando…' : (<><Icon n="send" s={14}/> Crear invitación</>)}
        </button>
      </>
    }>
      {cargando ? (
        <div style={{padding:'20px', textAlign:'center'}}><span className="loader" style={{width:22, height:22}}/></div>
      ) : (
        <React.Fragment>
          <div className="field-group">
            <label className="field-label">Email de la persona *</label>
            <input className={`field-input ${errores.email ? 'has-error' : ''}`}
                   type="email" value={form.email} autoFocus
                   onChange={e => set('email', e.target.value)}/>
            {errores.email
              ? <div className="field-error">{errores.email}</div>
              : <div className="field-help">Solo esa dirección va a poder canjear el código.</div>}
          </div>

          <div className="field-group">
            <label className="field-label">Canal *</label>
            <select className={`field-input ${errores.canal ? 'has-error' : ''}`}
                    value={form.canal} onChange={e => set('canal', e.target.value)}>
              {canales.map(c => (
                <option key={c.codigo} value={c.codigo}>
                  {c.nombre} — paga el {Math.round(Number(c.coeficiente) * 100)}% de la lista
                </option>
              ))}
            </select>
            {errores.canal
              ? <div className="field-error">{errores.canal}</div>
              : <div className="field-help">Define el precio que va a ver. Nadie ve el de otro canal.</div>}
          </div>

          <div className="field-group">
            <label className="field-label">Cliente</label>
            <div style={{display:'flex', gap:14, marginBottom:8, fontSize:13}}>
              <label style={{display:'flex', alignItems:'center', gap:6, cursor:'pointer'}}>
                <input type="radio" checked={modo === 'existente'} onChange={() => setModo('existente')}/>
                Ya es cliente
              </label>
              <label style={{display:'flex', alignItems:'center', gap:6, cursor:'pointer'}}>
                <input type="radio" checked={modo === 'nuevo'} onChange={() => setModo('nuevo')}/>
                Es nuevo
              </label>
            </div>

            {modo === 'existente' ? (
              <React.Fragment>
                <select className={`field-input ${errores.cliente_id ? 'has-error' : ''}`}
                        value={form.cliente_id} onChange={e => set('cliente_id', e.target.value)}>
                  <option value="">Elegí un cliente…</option>
                  {clientes.map(c => (
                    <option key={c.id} value={c.id}>{c.nombre}{c.cuit ? ` · ${c.cuit}` : ''}</option>
                  ))}
                </select>
                {errores.cliente_id && <div className="field-error">{errores.cliente_id}</div>}
              </React.Fragment>
            ) : (
              <React.Fragment>
                <input className={`field-input ${errores.cliente_nombre ? 'has-error' : ''}`}
                       placeholder="Razón social"
                       value={form.cliente_nombre}
                       onChange={e => set('cliente_nombre', e.target.value)}/>
                {errores.cliente_nombre && <div className="field-error">{errores.cliente_nombre}</div>}
                <input className="field-input" style={{marginTop:8}}
                       placeholder="CUIT (opcional)"
                       value={form.cliente_cuit}
                       onChange={e => set('cliente_cuit', e.target.value)}/>
                <div className="field-help">Se crea al canjearse el código, no ahora.</div>
              </React.Fragment>
            )}
          </div>

          <div className="field-group">
            <label className="field-label">Días de validez</label>
            <input className="field-input" type="number" min={1} max={90}
                   value={form.dias_validez}
                   onChange={e => set('dias_validez', e.target.value)}/>
            <div className="field-help">Entre 1 y 90. Por defecto 14.</div>
          </div>
        </React.Fragment>
      )}
    </Cmp>
  );
}

/* ── Modal: motivo de rechazo / suspensión ── */
function B2BMotivoModal({ usuario, estado, corriendo, onClose, onConfirmar }) {
  const [motivo, setMotivo] = useState('');
  const esRechazo = estado === 'rechazado';
  const Cmp = window.Modal;

  return (
    <Cmp open={true}
         title={esRechazo ? 'Rechazar solicitud' : 'Suspender acceso'}
         onClose={() => { if (!corriendo) onClose?.(); }}
         footer={
           <>
             <button className="btn-ghost" onClick={onClose} disabled={corriendo}>Cancelar</button>
             <button className="btn-primary" style={{background:'var(--red)'}}
                     disabled={corriendo}
                     onClick={() => onConfirmar?.(motivo)}>
               {corriendo ? 'Aplicando…' : (esRechazo ? 'Rechazar' : 'Suspender')}
             </button>
           </>
         }>
      <div className="field-group">
        <p style={{fontSize:13, lineHeight:1.55, margin:'0 0 12px'}}>
          {esRechazo
            ? <>No vas a dejar entrar a <b>{usuario.nombre}</b> ({usuario.email}).</>
            : <><b>{usuario.nombre}</b> deja de ver precios y de poder pedir. Los pedidos que ya mandó no se tocan.</>}
        </p>
        <label className="field-label">Motivo (opcional)</label>
        <input className="field-input" value={motivo} autoFocus maxLength={200}
               onChange={e => setMotivo(e.target.value)}
               placeholder={esRechazo ? 'No es del rubro…' : 'Cuenta con deuda…'}/>
        <div className="field-help">Queda guardado para saber por qué se decidió.</div>
      </div>
    </Cmp>
  );
}

window.B2BSolicitudesTab = B2BSolicitudesTab;
