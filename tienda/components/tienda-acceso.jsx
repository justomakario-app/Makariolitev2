/* ══ TIENDA · ACCESO ══════════════════════════════════════════════════════
   Todo lo que pasa ANTES de poder comprar: entrar, canjear la invitacion y
   esperar la aprobacion.

   La tienda es cerrada. No hay "registrate": para tener cuenta hace falta un
   codigo que emite el equipo desde Ventas > Tienda mayorista > Accesos. Y
   tener cuenta tampoco alcanza — despues de canjear, el usuario queda en
   'pendiente' hasta que alguien lo aprueba a mano. Son dos puertas distintas
   y las dos las controla el equipo.

   Por que el alta pasa por una edge function y no por supabase.auth.signUp:
   handle_new_user() lee el rol de raw_user_meta_data, que en un signup
   publico lo controla quien se registra — o sea que con el registro abierto
   cualquiera podria pedir role='owner'. Por eso el registro publico va
   APAGADO y el alta la hace 'b2b_signup' con service_role, que primero
   valida el token contra la base y recien despues crea el usuario, marcado
   b2b:'true' para que handle_new_user NO le cree profile (sin profile,
   is_active_user() da false y todo el sistema interno le queda cerrado).
   ═══════════════════════════════════════════════════════════════════════ */

/* Traduce el motivo que devuelve b2b_rpc_mi_cuenta a algo que el cliente
   entienda. Es el ÚLTIMO recurso: los motivos que tienen pantalla propia van
   en ESPERA (mas abajo) y no se repiten aca — 'b2b_deshabilitado' estaba en
   los dos lados y las dos frases decian cosas distintas. */
const MOTIVO_TEXTO = {
  sin_cuenta_b2b: 'Tu cuenta todavía no está asociada a ningún cliente.',
};

/* Saca el mensaje real de un error de edge function.
   supabase-js NO deja el body en `data` cuando la respuesta no es 2xx: tira un
   FunctionsHttpError cuyo .message es siempre el generico "Edge Function
   returned a non-2xx status code" y guarda la Response en .context. Sin esto,
   el cliente veria esa frase en ingles en vez de "ese correo ya tiene una
   cuenta", y el desvio al login no se dispararia nunca. */
const mensajeDeFuncion = async (error, data) => {
  if (data && data.error) return String(data.error);
  if (!error) return null;
  try {
    if (error.context && typeof error.context.json === 'function') {
      const body = await error.context.json();
      if (body && body.error) return String(body.error);
    }
  } catch (e) { /* el body no era JSON: seguimos con el mensaje generico */ }
  return error.message || 'No se pudo crear la cuenta.';
};

/* ── Marca ─────────────────────────────────────────────────────────────── */
const Marca = ({ chico }) => (
  <div className={'t-marca' + (chico ? ' t-marca-chico' : '')}>
    <span className="t-marca-1">JUSTO</span>
    <span className="t-marca-2">MAKARIO</span>
    <span className="t-marca-3">Home</span>
  </div>
);

/* ── Campo de contraseña con ojito ─────────────────────────────────────── */
const CampoPass = ({ value, onChange, placeholder, autoComplete, id }) => {
  const [ver, setVer] = useState(false);
  return (
    <div className="t-pass">
      <input id={id} className="t-input" type={ver ? 'text' : 'password'}
             value={value} onChange={e => onChange(e.target.value)}
             placeholder={placeholder || '••••••••'} autoComplete={autoComplete || 'current-password'}/>
      <button type="button" className="t-icon-btn" onClick={() => setVer(v => !v)}
              aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
        <Icon n={ver ? 'eye-off' : 'eye'} s={16}/>
      </button>
    </div>
  );
};

/* ══ Pantalla de acceso ═════════════════════════════════════════════════
   modo 'entrar'  → email + contraseña
   modo 'codigo'  → canjear invitación (crea la cuenta si hace falta)      */
const PantallaAcceso = ({ onEntro }) => {
  const [modo, setModo] = useState('entrar');
  return (
    <div className="t-acceso">
      <div className="t-acceso-caja">
        <Marca/>
        <p className="t-acceso-bajada">Tienda mayorista</p>
        {modo === 'entrar'
          ? <FormEntrar onEntro={onEntro} irACodigo={() => setModo('codigo')}/>
          : <FormCodigo onEntro={onEntro} volver={() => setModo('entrar')}/>}
      </div>
      <p className="t-acceso-pie">
        ¿Todavía no sos cliente? Escribinos y te mandamos una invitación.
      </p>
    </div>
  );
};

/* ── Entrar con cuenta existente ───────────────────────────────────────── */
const FormEntrar = ({ onEntro, irACodigo }) => {
  const [email, setEmail] = useState('');
  const [pass, setPass]   = useState('');
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState(null);

  const entrar = async (e) => {
    e.preventDefault();
    if (busy) return;
    setErr(null); setBusy(true);
    try {
      const { error } = await window.SUPA.auth.signInWithPassword({
        email: email.trim().toLowerCase(), password: pass,
      });
      /* El mensaje de Supabase viene en inglés y no distingue mail de clave
         (a propósito, para no filtrar qué cuentas existen). Lo traducimos
         manteniendo esa ambigüedad. */
      if (error) throw new Error(
        /invalid login/i.test(error.message)
          ? 'El correo o la contraseña no coinciden.'
          : error.message);
      await onEntro();
    } catch (e2) {
      setErr(e2.message || 'No se pudo entrar.');
    } finally { setBusy(false); }
  };

  return (
    <form className="t-form" onSubmit={entrar}>
      <label className="t-label" htmlFor="ac-email">Correo</label>
      <input id="ac-email" className="t-input" type="email" value={email} autoComplete="username"
             onChange={e => setEmail(e.target.value)} placeholder="tucorreo@empresa.com"/>

      <label className="t-label" htmlFor="ac-pass">Contraseña</label>
      <CampoPass id="ac-pass" value={pass} onChange={setPass}/>

      {err && <Aviso tipo="error">{err}</Aviso>}

      <button className="t-btn t-btn-primary t-btn-block" type="submit" disabled={busy || !email || !pass}>
        {busy ? 'Entrando…' : 'Entrar'}
      </button>

      <button className="t-link" type="button" onClick={irACodigo}>
        <Icon n="ticket" s={14}/> Tengo un código de invitación
      </button>
    </form>
  );
};

/* ── Canjear invitación ────────────────────────────────────────────────
   Tres pasos: (1) validar el código  (2) crear la cuenta o entrar con la
   que ya se tiene  (3) canjear. El paso 2 se bifurca porque el segundo
   comprador de un mismo cliente puede ya tener usuario.                  */
const FormCodigo = ({ onEntro, volver }) => {
  const [paso, setPaso]   = useState('token');   // token | datos
  const [token, setToken] = useState('');
  const [inv, setInv]     = useState(null);      // { email, cliente }
  const [nombre, setNombre]   = useState('');
  const [telefono, setTelefono] = useState('');
  const [pass, setPass]   = useState('');
  const [pass2, setPass2] = useState('');
  const [yaTengo, setYaTengo] = useState(false); // usa una cuenta existente
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState(null);

  const validar = async (e) => {
    e.preventDefault();
    if (busy) return;
    setErr(null); setBusy(true);
    try {
      const r = await window.B2B_DATA.verInvitacion({ token: token.trim() });
      /* ver_invitacion no tira excepción con un código inválido: devuelve
         ok:false. Es a propósito — así no sirve para adivinar códigos.
         El motivo 'b2b_deshabilitado' es otra cosa y existe desde 0158
         justamente para no mandarle al mayorista a pedir un código nuevo
         cuando su código está perfecto y lo que está apagado es la tienda. */
      if (r && r.motivo === 'b2b_deshabilitado') {
        throw new Error('La tienda mayorista está cerrada en este momento. Tu código sigue valiendo: probá de nuevo más tarde o escribinos.');
      }
      if (!r || !r.ok) throw new Error('Ese código no existe, ya se usó o venció. Pedile uno nuevo al equipo.');
      setInv(r); setPaso('datos');
    } catch (e2) {
      setErr(e2.message || 'No se pudo validar el código.');
    } finally { setBusy(false); }
  };

  const confirmar = async (e) => {
    e.preventDefault();
    if (busy) return;
    setErr(null);

    if (!yaTengo) {
      if (pass.length < 8) { setErr('La contraseña tiene que tener al menos 8 caracteres.'); return; }
      if (pass !== pass2)  { setErr('Las dos contraseñas no coinciden.'); return; }
    } else if (!pass) {
      setErr('Poné la contraseña de tu cuenta.'); return;
    }

    setBusy(true);
    try {
      if (!yaTengo) {
        /* Alta con service_role: valida el token del lado del servidor y
           crea el usuario marcado como B2B. Ver supabase/functions/b2b_signup. */
        const { data, error } = await window.SUPA.functions.invoke('b2b_signup', {
          body: { token: token.trim(), password: pass, nombre: nombre.trim(), telefono: telefono.trim() },
        });
        if (error || (data && data.error)) {
          const msg = await mensajeDeFuncion(error, data);
          /* Si el correo ya tiene cuenta, no es un error: es el segundo
             comprador del mismo cliente. Se le ofrece entrar con la suya. */
          if (/ya (existe|tiene cuenta)/i.test(msg || '')) {
            setYaTengo(true); setPass(''); setPass2('');
            throw new Error('Ese correo ya tiene una cuenta. Poné tu contraseña para vincular la invitación.');
          }
          throw new Error(msg || 'No se pudo crear la cuenta.');
        }
      }

      const { error: eIn } = await window.SUPA.auth.signInWithPassword({
        email: inv.email, password: pass,
      });
      if (eIn) throw new Error(
        /invalid login/i.test(eIn.message)
          ? 'La contraseña no coincide con la de esa cuenta.'
          : eIn.message);

      await window.B2B_DATA.canjearInvitacion({
        token: token.trim(), nombre: nombre.trim(), telefono: telefono.trim(),
      });
      await onEntro();
    } catch (e2) {
      setErr(e2.message || 'No se pudo completar el alta.');
    } finally { setBusy(false); }
  };

  if (paso === 'token') {
    return (
      <form className="t-form" onSubmit={validar}>
        <label className="t-label" htmlFor="ac-token">Código de invitación</label>
        <input id="ac-token" className="t-input t-mono" value={token}
               onChange={e => setToken(e.target.value)} placeholder="Pegá acá el código que te pasaron"
               autoComplete="off" spellCheck="false"/>
        <div className="t-help">Te lo manda el equipo de Justo Makario. Vence a los pocos días.</div>

        {err && <Aviso tipo="error">{err}</Aviso>}

        <button className="t-btn t-btn-primary t-btn-block" type="submit" disabled={busy || !token.trim()}>
          {busy ? 'Validando…' : 'Continuar'}
        </button>
        <button className="t-link" type="button" onClick={volver}>
          <Icon n="arrow-left" s={14}/> Volver
        </button>
      </form>
    );
  }

  return (
    <form className="t-form" onSubmit={confirmar}>
      <Aviso tipo="ok" titulo="Invitación válida">
        Es para <b>{inv.email}</b>{inv.cliente ? <> · <b>{inv.cliente}</b></> : null}
      </Aviso>

      {!yaTengo && (
        <>
          <label className="t-label" htmlFor="ac-nombre">Tu nombre</label>
          <input id="ac-nombre" className="t-input" value={nombre}
                 onChange={e => setNombre(e.target.value)} placeholder="Nombre y apellido"/>

          <label className="t-label" htmlFor="ac-tel">Teléfono <span className="t-opt">(opcional)</span></label>
          <input id="ac-tel" className="t-input" value={telefono}
                 onChange={e => setTelefono(e.target.value)} placeholder="Para avisarte por el pedido"/>

          <label className="t-label" htmlFor="ac-p1">Contraseña</label>
          <CampoPass id="ac-p1" value={pass} onChange={setPass} autoComplete="new-password"/>
          <div className="t-help">Mínimo 8 caracteres.</div>

          <label className="t-label" htmlFor="ac-p2">Repetir contraseña</label>
          <CampoPass id="ac-p2" value={pass2} onChange={setPass2} autoComplete="new-password"/>
        </>
      )}

      {yaTengo && (
        <>
          <label className="t-label" htmlFor="ac-pex">Contraseña de tu cuenta</label>
          <CampoPass id="ac-pex" value={pass} onChange={setPass}/>
        </>
      )}

      {err && <Aviso tipo="error">{err}</Aviso>}

      <button className="t-btn t-btn-primary t-btn-block" type="submit" disabled={busy}>
        {busy ? 'Creando…' : 'Crear mi acceso'}
      </button>
      <button className="t-link" type="button" onClick={() => { setPaso('token'); setErr(null); }}>
        <Icon n="arrow-left" s={14}/> Usar otro código
      </button>
    </form>
  );
};

/* ══ Pantalla de espera ═════════════════════════════════════════════════
   El usuario ya tiene cuenta pero todavia no puede comprar. Son cuatro
   situaciones distintas y cada una necesita que le digan algo distinto:
   inventarse un "no tenes permiso" generico para las cuatro obliga al
   cliente a llamar por telefono para entender que le pasa.               */
const ESPERA = {
  /* La tienda apagada NO es un problema de la cuenta del mayorista, y por eso
     no puede caer en el texto genérico ("Todavía no podés comprar"), que se
     lee como si le hubieran cortado el acceso a él. Su cuenta está perfecta:
     lo que está cerrado es el negocio. */
  b2b_deshabilitado: {
    icono: 'lock', tono: 'warn',
    titulo: 'La tienda mayorista está cerrada',
    texto: 'La cerramos por un rato — no es nada de tu cuenta, que sigue habilitada igual que siempre. Volvé a probar más tarde; si necesitás algo urgente, escribinos.',
  },
  pendiente: {
    icono: 'clock', tono: 'info',
    titulo: 'Tu acceso está en revisión',
    texto: 'Ya recibimos tu solicitud. Te habilitamos la cuenta apenas la revise alguien del equipo — te va a llegar un aviso al correo.',
  },
  rechazado: {
    icono: 'x', tono: 'error',
    titulo: 'Tu solicitud fue rechazada',
    texto: 'Si creés que es un error, escribinos y lo revisamos.',
  },
  suspendido: {
    icono: 'lock', tono: 'warn',
    titulo: 'Tu cuenta está suspendida',
    texto: 'Por ahora no podés hacer pedidos. Escribinos para reactivarla — tus pedidos anteriores siguen guardados.',
  },
  sin_habilitar: {
    icono: 'clock', tono: 'info',
    titulo: 'Falta habilitar tu cuenta para comprar',
    texto: 'Tu usuario ya está aprobado, pero el cliente todavía no quedó habilitado para operar. Es un último paso que hace el equipo.',
  },
};

const PantallaEspera = ({ cuenta, motivo, onSalir, onReintentar }) => {
  const clave = motivo || (cuenta && cuenta.estado) || 'pendiente';
  const info = ESPERA[clave] || {
    icono: 'info', tono: 'info',
    titulo: 'Todavía no podés comprar',
    texto: MOTIVO_TEXTO[clave] || 'Escribinos así lo revisamos.',
  };

  return (
    <div className="t-acceso">
      <div className="t-acceso-caja">
        <Marca chico/>
        <div className={'t-espera t-espera-' + info.tono}>
          <Icon n={info.icono} s={26}/>
        </div>
        <h2 className="t-espera-titulo">{info.titulo}</h2>
        <p className="t-espera-texto">{info.texto}</p>

        {cuenta && cuenta.rechazo_motivo && (
          <Aviso tipo="warn" titulo="Motivo">{cuenta.rechazo_motivo}</Aviso>
        )}

        <div className="t-espera-acciones">
          <button className="t-btn t-btn-ghost" onClick={onReintentar}>
            <Icon n="refresh" s={14}/> Volver a chequear
          </button>
          <button className="t-btn t-btn-ghost" onClick={onSalir}>
            <Icon n="logout" s={14}/> Salir
          </button>
        </div>
      </div>
    </div>
  );
};

window.TiendaAcceso = { PantallaAcceso, PantallaEspera, Marca, MOTIVO_TEXTO };
