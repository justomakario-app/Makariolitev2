/* ══ TIENDA · ACCESO ══════════════════════════════════════════════════════
   Todo lo que pasa ANTES de poder comprar: entrar, crear la cuenta, canjear
   una invitacion y esperar cuando todavia falta algo.

   ─── Como se entra (0163; sin aprobacion desde 0166) ───────────────────
   El dueño manda UN link. Del otro lado el comprador se registra solo — sus
   datos y los de su empresa — y queda comprando en el momento. Nadie aprueba
   nada: ni el alta con empresa nueva, ni el que pone el CUIT de una empresa
   que ya es cliente (ese entra derecho a esa cuenta), ni el que canjea una
   invitacion. Fue decision del dueño y hay que tenerla clara: el CUIT de una
   empresa esta en cualquier factura suya, asi que quien lo consiga puede
   registrarse y ver los pedidos y los precios de esa empresa. El freno dejo
   de ser previo y paso a ser posterior — al dueño le llega el aviso y lo
   suspende desde Ventas > Tienda mayorista > Accesos si no lo reconoce.

   La invitacion (modo 'codigo') sigue viva: es la via prolija para sumar un
   SEGUNDO comprador a un cliente que ya existe, con el mail elegido por el
   dueño en lugar de por quien se registra.

   El link se puede mandar apuntado:
     /tienda/            → pantalla de entrar
     /tienda/?alta=1     → directo al registro
     /tienda/?codigo=XYZ → directo a canjear, con el codigo puesto

   ─── Por que el alta pasa por una edge function ────────────────────────
   handle_new_user() decide con el metadata si el usuario nuevo es interno y
   le crea un profile. En un signup publico ese metadata lo controla quien se
   registra: cualquiera con la anon key podria pedir role='owner' y quedar
   adentro del sistema de la planta. Por eso el registro publico de Supabase
   va APAGADO y el alta la hace 'b2b_signup' con service_role, que valida y
   despues crea el usuario marcado b2b:'true' en app_metadata (que solo el
   service_role puede escribir). Sin profile, is_active_user() da false y
   todo el sistema interno le queda cerrado.
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

/* ── CUIT ──────────────────────────────────────────────────────────────
   Se muestra siempre NN-NNNNNNNN-N, que es como lo guarda la base
   (customers_b2b_cuit_check) y como funciona el indice unico: el mismo CUIT
   con guiones y sin guiones serian dos empresas distintas.

   El digito verificador se chequea aca igual que en 0163, y aca tampoco
   bloquea. Se avisa y listo: un CUIT mal tipeado lo arregla el dueño en dos
   segundos desde el panel, y rebotarle el alta a un comprador real un
   domingo a la noche lo pierde para siempre. */
const soloDigitos = (s) => String(s || '').replace(/[^0-9]/g, '').slice(0, 11);

const formatearCuit = (s) => {
  const d = soloDigitos(s);
  if (d.length <= 2) return d;
  if (d.length <= 10) return d.slice(0, 2) + '-' + d.slice(2);
  return d.slice(0, 2) + '-' + d.slice(2, 10) + '-' + d.slice(10);
};

const cuitValida = (s) => {
  const d = soloDigitos(s);
  if (d.length !== 11) return false;
  const mult = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let suma = 0;
  for (let i = 0; i < 10; i++) suma += Number(d[i]) * mult[i];
  let dv = 11 - (suma % 11);
  if (dv === 11) dv = 0; else if (dv === 10) dv = 9;
  return dv === Number(d[10]);
};

/* Las 24 jurisdicciones. Es un <select> y no texto libre para que el dueño
   no termine con "Bs As", "BSAS" y "Buenos Aires" como tres provincias. */
const PROVINCIAS = [
  'Buenos Aires', 'Ciudad Autónoma de Buenos Aires', 'Catamarca', 'Chaco', 'Chubut',
  'Córdoba', 'Corrientes', 'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja',
  'Mendoza', 'Misiones', 'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis',
  'Santa Cruz', 'Santa Fe', 'Santiago del Estero', 'Tierra del Fuego', 'Tucumán',
];

/* ── Recuperar la contraseña ───────────────────────────────────────────
   El mail de Supabase manda a esta misma pagina con los tokens en el HASH
   (#access_token=...&type=recovery). El cliente de la tienda tiene
   detectSessionInUrl:false a proposito — no usa magic links ni OAuth — asi
   que el hash no se consume solo: se lee aca, se limpia de la barra de
   direcciones (que no quede un token en el historial ni en un screenshot que
   el cliente mande por WhatsApp) y se cambia por una sesion con setSession.

   Se lee UNA sola vez, al cargar el archivo, y no adentro de un componente:
   React puede montar dos veces en desarrollo, y el segundo montaje ya no
   encontraria el hash. */
const leerRecuperacionDeUrl = () => {
  try {
    const h = (window.location.hash || '').replace(/^#/, '');
    if (!h) return null;
    const p = new URLSearchParams(h);

    /* El link vencido tampoco trae tokens: viene con error_code. Hay que
       distinguirlo de "no hay nada", porque el mensaje es otro. */
    if (p.get('error') || p.get('error_code')) {
      const venc = /expired|invalid/i.test(p.get('error_code') || p.get('error') || '');
      limpiarHash();
      return { error: venc
        ? 'Ese link ya venció. Pedí uno nuevo, dura una hora.'
        : (p.get('error_description') || 'Ese link no sirve. Pedí uno nuevo.') };
    }

    if (p.get('type') !== 'recovery' || !p.get('access_token')) return null;
    const r = { access_token: p.get('access_token'), refresh_token: p.get('refresh_token') || '' };
    limpiarHash();
    return r;
  } catch (e) { return null; }
};

const RECUPERACION = leerRecuperacionDeUrl();

function limpiarHash() {
  try {
    window.history.replaceState(null, '',
      window.location.pathname + window.location.search);
  } catch (e) { /* sin history API el token queda a la vista, pero funciona */ }
}

/* A donde vuelve el mail de "olvide mi contrasena". Este SI se calcula del
   browser, a proposito, y no usa el dominio fijo de b2b-data.js: al que esta
   recuperando la clave hay que devolverlo EXACTAMENTE a donde estaba, no
   mudarlo de dominio en la mitad del tramite. El dominio fijo es para los
   links que el dueno copia y manda; este es para volver.
   Ojo: la URL resultante tiene que estar en la lista de "Redirect URLs" de
   Supabase Auth, si no el link cae en la Site URL. */
const urlDeVuelta = () => {
  try { return window.location.origin + window.location.pathname; }
  catch (e) { return undefined; }
};

/* Con que pantalla abre segun el link que le mandaron. */
const modoDesdeUrl = () => {
  try {
    const p = new URLSearchParams(window.location.search);
    if (p.get('codigo') || p.get('token')) return 'codigo';
    if (p.get('alta') === '1' || p.get('alta') === 'true') return 'registro';
    if (/^#?(alta|registro)$/i.test(window.location.hash || '')) return 'registro';
  } catch (e) { /* URL rara: abre en 'entrar', que nunca esta mal */ }
  return 'entrar';
};

const codigoDesdeUrl = () => {
  try {
    const p = new URLSearchParams(window.location.search);
    return (p.get('codigo') || p.get('token') || '').trim();
  } catch (e) { return ''; }
};

/* ── Marca ─────────────────────────────────────────────────────────────
   `claro` la invierte para el panel oscuro. */
const Marca = ({ chico, claro }) => (
  <div className={'t-marca' + (chico ? ' t-marca-chico' : '') + (claro ? ' t-marca-claro' : '')}>
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

/* Un campo con su etiqueta. Existe para que el formulario largo del registro
   se lea como una lista de preguntas y no como un muro de inputs. */
const AccCampo = ({ id, label, opcional, ayuda, children }) => (
  <div className="t-campo">
    <label className="t-label" htmlFor={id}>
      {label}{opcional && <span className="t-opt"> (opcional)</span>}
    </label>
    {children}
    {ayuda && <div className="t-help">{ayuda}</div>}
  </div>
);

/* Paso 1 de 2 / paso 2 de 2. Un formulario de nueve campos de una sola vez
   se abandona; partido al medio, con el final a la vista, no. */
const AccPasos = ({ paso, titulos }) => (
  <div className="t-pasos">
    {titulos.map((t, i) => (
      <div key={t} className={'t-paso' + (i < paso ? ' t-paso-hecho' : '') + (i === paso ? ' t-paso-on' : '')}>
        <span className="t-paso-n">{i < paso ? <Icon n="check" s={12}/> : i + 1}</span>
        <span className="t-paso-t">{t}</span>
      </div>
    ))}
  </div>
);

/* ══ Pantalla de acceso ═════════════════════════════════════════════════
   modo 'entrar'   → email + contraseña
   modo 'registro' → alta abierta, dos pasos
   modo 'codigo'   → canjear invitación (segundo comprador de un cliente)  */
const PantallaAcceso = ({ onEntro }) => {
  const [modo, setModo] = useState(modoDesdeUrl);
  const [emailPrevio, setEmailPrevio] = useState('');   // lo pasa el registro al login

  const irAEntrar = (email) => { setEmailPrevio(email || ''); setModo('entrar'); };

  const CABEZAS = {
    entrar:   ['Entrá a tu cuenta', 'Tu lista, tus pedidos y tu historial.'],
    registro: ['Creá tu cuenta', 'Dos pasos y ya estás comprando.'],
    codigo:   ['Tengo un código', 'Sumate a una empresa que ya compra acá.'],
    olvide:   ['Recuperá tu contraseña', 'Te mandamos un link al correo.'],
  };
  const cabeza = CABEZAS[modo] || CABEZAS.entrar;

  return (
    <div className="t-acceso">
      <div className="t-acceso-split">

        {/* Panel de marca. En el celular se colapsa a una franja: el cliente
            que entra desde el teléfono quiere el formulario, no el discurso. */}
        <aside className="t-acceso-brand">
          <Marca claro/>
          <div className="t-acceso-brand-cuerpo">
            <h1 className="t-acceso-h1">Tu lista mayorista,<br/>abierta las 24 horas.</h1>
            <p className="t-acceso-p">
              Entrá cuando quieras, elegí con qué catálogo comprar y armá el pedido a tu
              ritmo. Lo recibimos en el momento.
            </p>
            <ul className="t-acceso-puntos">
              <li><Icon n="check" s={15}/><span>Los precios de tu canal, siempre al día</span></li>
              <li><Icon n="check" s={15}/><span>Un carrito para mayorista y otro para distribuidor</span></li>
              <li><Icon n="check" s={15}/><span>Repetí un pedido anterior en un toque</span></li>
            </ul>
          </div>
          <p className="t-acceso-sello">Acceso para clientes mayoristas y distribuidores</p>
        </aside>

        {/* Panel del formulario */}
        <main className="t-acceso-panel">
          <div className="t-acceso-panel-marca"><Marca chico/></div>

          <header className="t-acceso-head">
            <h2 className="t-acceso-titulo">{cabeza[0]}</h2>
            <p className="t-acceso-bajada">{cabeza[1]}</p>
          </header>

          {modo === 'entrar' ? (
            <FormEntrar onEntro={onEntro} emailPrevio={emailPrevio}
                        irARegistro={() => setModo('registro')}
                        irACodigo={() => setModo('codigo')}
                        irAOlvide={(email) => { setEmailPrevio(email || ''); setModo('olvide'); }}/>
          ) : modo === 'olvide' ? (
            <FormOlvide emailPrevio={emailPrevio} volver={irAEntrar}/>
          ) : modo === 'registro' ? (
            <FormRegistro onEntro={onEntro} irAEntrar={irAEntrar}
                          irACodigo={() => setModo('codigo')}/>
          ) : (
            <FormCodigo onEntro={onEntro} volver={() => setModo('entrar')}/>
          )}
        </main>
      </div>
    </div>
  );
};

/* ── Entrar con cuenta existente ───────────────────────────────────────── */
const FormEntrar = ({ onEntro, irARegistro, irACodigo, irAOlvide, emailPrevio }) => {
  const [email, setEmail] = useState(emailPrevio || '');
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
      <AccCampo id="ac-email" label="Correo">
        <input id="ac-email" className="t-input" type="email" value={email} autoComplete="username"
               onChange={e => setEmail(e.target.value)} placeholder="tucorreo@empresa.com"/>
      </AccCampo>

      <AccCampo id="ac-pass" label="Contraseña">
        <CampoPass id="ac-pass" value={pass} onChange={setPass}/>
      </AccCampo>

      {/* Se lleva el correo ya tipeado: volver a escribirlo es justo lo que
          molesta cuando ya venís peleando con la contraseña. */}
      <button className="t-link t-link-fin" type="button" onClick={() => irAOlvide(email)}>
        Olvidé mi contraseña
      </button>

      {err && <Aviso tipo="error">{err}</Aviso>}

      <button className="t-btn t-btn-primary t-btn-block t-btn-alto" type="submit"
              disabled={busy || !email || !pass}>
        {busy ? 'Entrando…' : 'Entrar'}
      </button>

      <div className="t-sep"><span>o</span></div>

      <button className="t-btn t-btn-ghost t-btn-block" type="button" onClick={irARegistro}>
        <Icon n="user" s={15}/> Crear mi cuenta
      </button>

      <button className="t-link" type="button" onClick={irACodigo}>
        <Icon n="ticket" s={14}/> Tengo un código de invitación
      </button>
    </form>
  );
};

/* ── Alta abierta ──────────────────────────────────────────────────────
   Dos pasos: primero la empresa, después la persona. Ese orden y no el
   inverso porque la empresa es lo que decide todo lo demás — es lo que
   define si esto es un alta nueva o alguien sumándose a un cliente que ya
   existe — y porque el CUIT es el dato que hay que ir a buscar: mejor
   pedirlo con la pantalla recién abierta que sobre el final.

   Las validaciones de acá están duplicadas de la edge function a propósito:
   las de allá son las que mandan (el navegador no valida nada de verdad),
   las de acá son para que el cliente no se entere de que le falta algo
   después de completar nueve campos.

   Lo que NO se pregunta acá: con qué catálogo va a comprar. Eso se elige en
   la pantalla siguiente, ya adentro, y se puede cambiar cuando quiera. Es la
   primera decisión de la compra, no un campo más del formulario de alta.  */
const FormRegistro = ({ onEntro, irAEntrar, irACodigo }) => {
  const [paso, setPaso] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState(null);
  const [sumado, setSumado] = useState(null);   // alta sobre una empresa que ya existía

  const [empresa, setEmpresa]     = useState('');
  const [cuit, setCuit]           = useState('');
  const [localidad, setLocalidad] = useState('');
  const [provincia, setProvincia] = useState('');

  const [nombre, setNombre]     = useState('');
  const [email, setEmail]       = useState('');
  const [telefono, setTelefono] = useState('');
  const [pass, setPass]   = useState('');
  const [pass2, setPass2] = useState('');

  const cuitD   = soloDigitos(cuit);
  const cuitOk  = cuitValida(cuitD);
  const paso1Ok = empresa.trim().length >= 2 && cuitD.length === 11;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

  const seguir = (e) => {
    e.preventDefault();
    setErr(null);
    if (empresa.trim().length < 2) { setErr('Poné el nombre de tu empresa o comercio.'); return; }
    if (cuitD.length !== 11)       { setErr('El CUIT tiene que tener 11 números.'); return; }
    setPaso(1);
  };

  const crear = async (e) => {
    e.preventDefault();
    if (busy) return;
    setErr(null);

    if (nombre.trim().length < 2) { setErr('Poné tu nombre y apellido.'); return; }
    if (!emailOk)        { setErr('Revisá el correo: no parece una dirección válida.'); return; }
    if (pass.length < 8) { setErr('La contraseña tiene que tener al menos 8 caracteres.'); return; }
    if (pass !== pass2)  { setErr('Las dos contraseñas no coinciden.'); return; }

    setBusy(true);
    try {
      /* Alta con service_role: crea la credencial y, en la misma llamada, la
         empresa y el comprador. Si lo segundo falla, allá se borra la
         credencial — si no, el comprador queda con un usuario que no abre
         nada y que además le bloquea reintentar con su propio mail.
         Ver supabase/functions/b2b_signup y la migración 0163. */
      const { data, error } = await window.SUPA.functions.invoke('b2b_signup', {
        body: {
          email: email.trim().toLowerCase(),
          password: pass,
          nombre: nombre.trim(),
          telefono: telefono.trim(),
          empresa: empresa.trim(),
          cuit: cuitD,
          localidad: localidad.trim(),
          provincia: provincia.trim(),
        },
      });

      if (error || (data && data.error)) {
        const msg = await mensajeDeFuncion(error, data);
        /* Ese correo ya existe: no es un error del alta, es alguien que ya
           tiene cuenta. Se lo manda al login con el mail puesto en vez de
           dejarlo peleando con un formulario que nunca va a pasar. */
        if (/ya (existe|tiene)/i.test(msg || '')) throw new Error('__YA_EXISTE__');
        throw new Error(msg || 'No se pudo crear la cuenta.');
      }

      /* Se entra con la credencial recién creada. Es lo que hace que "entrá
         y comprá directo" sea directo de verdad. */
      const { error: eIn } = await window.SUPA.auth.signInWithPassword({
        email: email.trim().toLowerCase(), password: pass,
      });
      if (eIn) throw new Error('Tu cuenta quedó creada. Entrá con tu correo y contraseña.');

      /* Ese CUIT ya era de un cliente, así que en vez de abrir una empresa
         nueva lo sumamos a la que ya existe. Entra igual y en el momento
         (0166), pero se lo decimos: si se equivocó de CUIT, este es el único
         momento en que se puede dar cuenta antes de estar mirando los pedidos
         de otra empresa. No es una espera — es un toque y sigue. */
      if (data && data.empresa_nueva === false) {
        setSumado(data);
        return;                      // el botón de esa pantalla llama a onEntro
      }
      await onEntro();
    } catch (e2) {
      if (e2.message === '__YA_EXISTE__') {
        setErr(null);
        irAEntrar(email.trim().toLowerCase());
        return;
      }
      setErr(e2.message || 'No se pudo crear la cuenta.');
    } finally { setBusy(false); }
  };

  /* Se sumó a una empresa que ya era cliente. Ojo: NO es una pantalla de
     espera, ya está adentro. Está para que vea a qué cuenta entró. */
  if (sumado) {
    return (
      <div className="t-form t-form-centro">
        <div className="t-espera t-espera-ok"><Icon n="check" s={26}/></div>
        <h3 className="t-espera-titulo">Listo, ya podés comprar</h3>
        <p className="t-espera-texto">
          Ese CUIT ya es de un cliente nuestro{sumado.cliente ? <> (<b>{sumado.cliente}</b>)</> : null},
          así que te sumamos a esa cuenta: vas a ver sus precios y sus pedidos.
        </p>
        <Aviso tipo="info" titulo="¿No es tu empresa?">
          Fijate el CUIT que cargaste. Si te equivocaste, escribinos antes de usar la
          cuenta y la damos de baja.
        </Aviso>
        <button className="t-btn t-btn-primary t-btn-block t-btn-alto" type="button" onClick={onEntro}>
          Entrar a la tienda
        </button>
      </div>
    );
  }

  if (paso === 0) {
    return (
      <form className="t-form" onSubmit={seguir}>
        <AccPasos paso={0} titulos={['Tu empresa', 'Tu acceso']}/>

        <AccCampo id="rg-empresa" label="Empresa o comercio">
          <input id="rg-empresa" className="t-input" value={empresa} maxLength={120}
                 onChange={e => setEmpresa(e.target.value)}
                 placeholder="Como te facturamos" autoComplete="organization"/>
        </AccCampo>

        <AccCampo id="rg-cuit" label="CUIT"
                  ayuda={cuitD.length === 11 && !cuitOk
                    ? 'Ese CUIT no valida. Igual podés seguir: lo revisamos antes de facturarte.'
                    : 'Sin puntos ni espacios. Se completa solo.'}>
          <div className="t-input-icono">
            <input id="rg-cuit" className="t-input t-mono" value={formatearCuit(cuit)}
                   onChange={e => setCuit(e.target.value)} inputMode="numeric"
                   placeholder="30-12345678-9" autoComplete="off" spellCheck="false"/>
            {cuitD.length === 11 && (
              <span className={'t-vfy ' + (cuitOk ? 't-vfy-ok' : 't-vfy-warn')}>
                <Icon n={cuitOk ? 'check' : 'alert'} s={15}/>
              </span>
            )}
          </div>
        </AccCampo>

        <div className="t-fila">
          <AccCampo id="rg-loc" label="Localidad" opcional>
            <input id="rg-loc" className="t-input" value={localidad} maxLength={80}
                   onChange={e => setLocalidad(e.target.value)} placeholder="Dónde estás"/>
          </AccCampo>
          <AccCampo id="rg-prov" label="Provincia" opcional>
            <select id="rg-prov" className="t-input" value={provincia}
                    onChange={e => setProvincia(e.target.value)}>
              <option value="">Elegí…</option>
              {PROVINCIAS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </AccCampo>
        </div>

        {err && <Aviso tipo="error">{err}</Aviso>}

        <button className="t-btn t-btn-primary t-btn-block t-btn-alto" type="submit" disabled={!paso1Ok}>
          Continuar <Icon n="chev-right" s={15}/>
        </button>

        <button className="t-link" type="button" onClick={() => irAEntrar('')}>
          <Icon n="arrow-left" s={14}/> Ya tengo cuenta
        </button>
      </form>
    );
  }

  return (
    <form className="t-form" onSubmit={crear}>
      <AccPasos paso={1} titulos={['Tu empresa', 'Tu acceso']}/>

      <div className="t-repaso">
        <div className="t-repaso-txt">
          <b>{empresa.trim()}</b>
          <span className="t-mono">{formatearCuit(cuit)}</span>
        </div>
        <button className="t-link t-link-inline" type="button" disabled={busy}
                onClick={() => { setPaso(0); setErr(null); }}>Cambiar</button>
      </div>

      <AccCampo id="rg-nombre" label="Tu nombre">
        <input id="rg-nombre" className="t-input" value={nombre} maxLength={120}
               onChange={e => setNombre(e.target.value)}
               placeholder="Nombre y apellido" autoComplete="name"/>
      </AccCampo>

      <AccCampo id="rg-email" label="Correo" ayuda="Con este correo vas a entrar.">
        <input id="rg-email" className="t-input" type="email" value={email} maxLength={200}
               onChange={e => setEmail(e.target.value)}
               placeholder="tucorreo@empresa.com" autoComplete="username"/>
      </AccCampo>

      <AccCampo id="rg-tel" label="Teléfono" opcional ayuda="Para avisarte por el pedido.">
        <input id="rg-tel" className="t-input" value={telefono} maxLength={40}
               onChange={e => setTelefono(e.target.value)}
               placeholder="11 5555-5555" autoComplete="tel" inputMode="tel"/>
      </AccCampo>

      <AccCampo id="rg-p1" label="Contraseña" ayuda="Mínimo 8 caracteres.">
        <CampoPass id="rg-p1" value={pass} onChange={setPass} autoComplete="new-password"/>
      </AccCampo>

      <AccCampo id="rg-p2" label="Repetir contraseña">
        <CampoPass id="rg-p2" value={pass2} onChange={setPass2} autoComplete="new-password"/>
      </AccCampo>

      {err && <Aviso tipo="error">{err}</Aviso>}

      <button className="t-btn t-btn-primary t-btn-block t-btn-alto" type="submit" disabled={busy}>
        {busy ? 'Creando tu cuenta…' : 'Crear mi cuenta y entrar'}
      </button>

      <button className="t-link" type="button" disabled={busy} onClick={irACodigo}>
        <Icon n="ticket" s={14}/> Me pasaron un código de invitación
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
  const [token, setToken] = useState(codigoDesdeUrl);
  const [inv, setInv]     = useState(null);      // { email, cliente }
  const [nombre, setNombre]     = useState('');
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
        <AccCampo id="ac-token" label="Código de invitación"
                  ayuda="Te lo manda el equipo de Justo Makario, o quien ya compra en tu empresa. Vence a los pocos días.">
          <input id="ac-token" className="t-input t-mono" value={token}
                 onChange={e => setToken(e.target.value)} placeholder="Pegá acá el código que te pasaron"
                 autoComplete="off" spellCheck="false"/>
        </AccCampo>

        {err && <Aviso tipo="error">{err}</Aviso>}

        <button className="t-btn t-btn-primary t-btn-block t-btn-alto" type="submit" disabled={busy || !token.trim()}>
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
          <AccCampo id="ac-nombre" label="Tu nombre">
            <input id="ac-nombre" className="t-input" value={nombre}
                   onChange={e => setNombre(e.target.value)} placeholder="Nombre y apellido"/>
          </AccCampo>

          <AccCampo id="ac-tel" label="Teléfono" opcional>
            <input id="ac-tel" className="t-input" value={telefono}
                   onChange={e => setTelefono(e.target.value)} placeholder="Para avisarte por el pedido"/>
          </AccCampo>

          <AccCampo id="ac-p1" label="Contraseña" ayuda="Mínimo 8 caracteres.">
            <CampoPass id="ac-p1" value={pass} onChange={setPass} autoComplete="new-password"/>
          </AccCampo>

          <AccCampo id="ac-p2" label="Repetir contraseña">
            <CampoPass id="ac-p2" value={pass2} onChange={setPass2} autoComplete="new-password"/>
          </AccCampo>
        </>
      )}

      {yaTengo && (
        <AccCampo id="ac-pex" label="Contraseña de tu cuenta">
          <CampoPass id="ac-pex" value={pass} onChange={setPass}/>
        </AccCampo>
      )}

      {err && <Aviso tipo="error">{err}</Aviso>}

      <button className="t-btn t-btn-primary t-btn-block t-btn-alto" type="submit" disabled={busy}>
        {busy ? 'Creando…' : 'Crear mi acceso'}
      </button>
      <button className="t-link" type="button" onClick={() => { setPaso('token'); setErr(null); }}>
        <Icon n="arrow-left" s={14}/> Usar otro código
      </button>
    </form>
  );
};

/* ── Pedir el link de recuperación ─────────────────────────────────────
   La respuesta es SIEMPRE la misma, exista o no la cuenta. Decir "ese correo
   no está registrado" convierte esta pantalla en un detector de clientes:
   cualquiera prueba correos hasta encontrar cuáles compran acá. Por eso el
   texto habla en condicional, y por eso tampoco se muestra el error de
   Supabase tal cual.                                                      */
const FormOlvide = ({ emailPrevio, volver }) => {
  const [email, setEmail] = useState(emailPrevio || '');
  const [busy, setBusy]   = useState(false);
  const [listo, setListo] = useState(false);
  const [err, setErr]     = useState(null);

  const pedir = async (e) => {
    e.preventDefault();
    if (busy) return;
    setErr(null); setBusy(true);
    try {
      const { error } = await window.SUPA.auth.resetPasswordForEmail(
        email.trim().toLowerCase(), { redirectTo: urlDeVuelta() });
      /* El único error que sí se muestra es el del límite de envíos: ahí el
         cliente tiene que saber que la solución es esperar, no reintentar. */
      if (error && /rate|limit|seconds|too many/i.test(error.message || '')) {
        throw new Error('Ya pedimos varios links seguidos. Esperá unos minutos y probá de nuevo.');
      }
      setListo(true);
    } catch (e2) {
      setErr(e2.message || 'No pudimos mandar el correo. Probá de nuevo en un rato.');
    } finally { setBusy(false); }
  };

  if (listo) {
    return (
      <div className="t-form">
        <div className="t-listo">
          <div className="t-listo-icono"><Icon n="mail" s={24}/></div>
          <h3 className="t-listo-titulo">Mirá tu correo</h3>
          <p className="t-listo-texto">
            Si <b>{email.trim().toLowerCase()}</b> tiene una cuenta acá, te llegó un link
            para poner una contraseña nueva. Dura <b>una hora</b>.
          </p>
          <p className="t-help">
            ¿No lo ves? Fijate en correo no deseado. El remitente puede figurar como Supabase.
          </p>
        </div>
        <button className="t-btn t-btn-primary t-btn-block" type="button" onClick={() => volver(email)}>
          Volver a entrar
        </button>
      </div>
    );
  }

  return (
    <form className="t-form" onSubmit={pedir}>
      <AccCampo id="ol-email" label="Tu correo"
                ayuda="El mismo con el que entrás a la tienda.">
        <input id="ol-email" className="t-input" type="email" value={email} autoComplete="username"
               onChange={e => setEmail(e.target.value)} placeholder="tucorreo@empresa.com"/>
      </AccCampo>

      {err && <Aviso tipo="error">{err}</Aviso>}

      <button className="t-btn t-btn-primary t-btn-block t-btn-alto" type="submit"
              disabled={busy || !email.trim()}>
        {busy ? 'Mandando…' : 'Mandame el link'}
      </button>

      <button className="t-link" type="button" onClick={() => volver(email)}>
        <Icon n="arrow-left" s={14}/> Volver
      </button>
    </form>
  );
};

/* ── Poner la contraseña nueva ─────────────────────────────────────────
   Es lo que se ve al abrir el link del mail. No pide la contraseña vieja: el
   token del link ES la prueba de que la persona tiene el correo. Se monta
   ANTES que cualquier otra pantalla, aunque ya hubiera una sesión abierta en
   ese browser — si alguien está entrando por un link de recuperación, lo que
   quiere es cambiar la clave, no seguir comprando.                        */
const PantallaNuevaPass = ({ datos, onListo, onCancelar }) => {
  const [p1, setP1]     = useState('');
  const [p2, setP2]     = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState(datos && datos.error ? datos.error : null);
  const [fase, setFase] = useState(datos && datos.error ? 'roto' : 'abriendo');

  /* Canjear el token por una sesión. Sin esto, updateUser no tiene con qué
     autenticar el cambio. */
  useEffect(() => {
    if (fase !== 'abriendo') return;
    let vivo = true;
    (async () => {
      try {
        const { error } = await window.SUPA.auth.setSession({
          access_token: datos.access_token, refresh_token: datos.refresh_token,
        });
        if (error) throw new Error(error.message);
        if (vivo) setFase('lista');
      } catch (e) {
        if (!vivo) return;
        setErr('Ese link ya venció o se usó. Pedí uno nuevo, dura una hora.');
        setFase('roto');
      }
    })();
    return () => { vivo = false; };
  }, [fase, datos]);

  const corta   = p1.length > 0 && p1.length < 8;
  const difiere = p2.length > 0 && p1 !== p2;
  const puede   = fase === 'lista' && p1.length >= 8 && p1 === p2 && !busy;

  const guardar = async (e) => {
    e.preventDefault();
    if (!puede) return;
    setErr(null); setBusy(true);
    try {
      const { error } = await window.SUPA.auth.updateUser({ password: p1 });
      if (error) throw new Error(
        /should be different|same as/i.test(error.message)
          ? 'Esa ya es tu contraseña actual. Poné una distinta.'
          : /weak|pwned|leaked|compromis/i.test(error.message)
            ? 'Esa contraseña aparece en filtraciones conocidas. Elegí otra.'
            : error.message);
      await onListo();
    } catch (e2) {
      setErr(e2.message || 'No se pudo cambiar la contraseña.');
    } finally { setBusy(false); }
  };

  return (
    <div className="t-acceso">
      <div className="t-acceso-caja">
        <Marca chico/>

        {fase === 'roto' ? (
          <>
            <div className="t-espera t-espera-warn"><Icon n="key" s={26}/></div>
            <h2 className="t-espera-titulo">El link no sirve más</h2>
            <p className="t-espera-texto">{err}</p>
            <div className="t-espera-acciones">
              <button className="t-btn t-btn-primary" onClick={onCancelar}>
                Pedir uno nuevo
              </button>
            </div>
          </>
        ) : (
          <form className="t-form" onSubmit={guardar}>
            <div className="t-espera t-espera-info"><Icon n="key" s={26}/></div>
            <h2 className="t-espera-titulo">Poné tu contraseña nueva</h2>
            <p className="t-espera-texto">
              Con esta vas a entrar de acá en adelante. Mínimo 8 caracteres.
            </p>

            <AccCampo id="np-p1" label="Contraseña nueva">
              <CampoPass id="np-p1" value={p1} onChange={setP1} autoComplete="new-password"/>
            </AccCampo>
            <AccCampo id="np-p2" label="Repetila">
              <CampoPass id="np-p2" value={p2} onChange={setP2} autoComplete="new-password"/>
            </AccCampo>

            {corta   && <Aviso tipo="warn">Tiene que tener al menos 8 caracteres.</Aviso>}
            {difiere && <Aviso tipo="warn">Las dos contraseñas no coinciden.</Aviso>}
            {err     && <Aviso tipo="error">{err}</Aviso>}

            <button className="t-btn t-btn-primary t-btn-block t-btn-alto" type="submit"
                    disabled={!puede}>
              {busy ? 'Guardando…' : fase === 'abriendo' ? 'Abriendo el link…' : 'Guardar y entrar'}
            </button>

            <button className="t-link" type="button" onClick={onCancelar}>
              Cancelar
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

/* ══ Pantalla de espera ═════════════════════════════════════════════════
   El usuario ya tiene cuenta pero todavia no puede comprar. Son cinco
   situaciones distintas y cada una necesita que le digan algo distinto:
   inventarse un "no tenes permiso" generico para las cinco obliga al
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
  /* Desde 0166 nadie queda 'pendiente' al registrarse: el alta entra derecho.
     La pantalla se deja porque el estado sigue existiendo y alguien del equipo
     se lo puede poner a mano desde el panel. Es raro — pero si pasa, el
     comprador tiene que leer algo que se entienda. */
  pendiente: {
    icono: 'clock', tono: 'info',
    titulo: 'Tu acceso está en revisión',
    texto: 'Tu cuenta existe, pero quedó frenada para revisarla. Escribinos y la destrabamos.',
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
  /* Tu usuario está bien; la que está frenada es la EMPRESA (b2b_habilitado
     en false). En la práctica es el corte por deuda, y no se dice con esas
     palabras en una pantalla que puede ver cualquier empleado del cliente. */
  sin_habilitar: {
    icono: 'clock', tono: 'info',
    titulo: 'Falta habilitar tu cuenta para comprar',
    texto: 'Tu usuario está listo, pero la cuenta de tu empresa está frenada para hacer pedidos. Escribinos y lo vemos.',
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

window.TiendaAcceso = {
  PantallaAcceso, PantallaEspera, PantallaNuevaPass, Marca, MOTIVO_TEXTO,
  formatearCuit, cuitValida, PROVINCIAS, RECUPERACION, leerRecuperacionDeUrl,
};
