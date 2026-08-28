/* ══ TIENDA · SHELL ═══════════════════════════════════════════════════════
   Arranque, sesión y navegación. Decide cuál de las tres situaciones vive
   el visitante: no entró, entró pero todavía no puede comprar, o compra.

   El carrito se maneja acá y no adentro de cada pantalla: el catálogo
   necesita saber qué hay pedido para marcar las tarjetas, el header para
   el contador y el carrito para editarlo. Una sola copia, un solo lugar
   donde se recarga.
   ═══════════════════════════════════════════════════════════════════════ */

/* ⚠ Acá NO se desestructura window.TiendaAcceso / TiendaCatalogo / etc.
   Los <script type="text/babel"> son scripts clásicos: sus `const` de primer
   nivel viven todos en el MISMO scope léxico global. Escribir
   `const { PantallaAcceso } = window.TiendaAcceso` sería redeclarar el const
   que ya creó tienda-acceso.jsx, y el browser corta con "Identifier
   'PantallaAcceso' has already been declared" — no en este archivo, sino al
   evaluarlo, o sea con la tienda entera en blanco.
   Como comparten scope, los componentes de los otros archivos ya se ven por
   su nombre. Los window.Tienda* existen para el HTML y los tests, no para
   consumirse desde acá. */

/* ── Canjear una invitación estando ya logueado ────────────────────────
   Es el caso del segundo comprador de un cliente que ya tiene usuario, y
   el de alguien a quien le reemitieron el código. No hay que crear cuenta:
   solo vincular. */
const CanjearLogueado = ({ onListo, onSalir }) => {
  const [token, setToken] = useState('');
  const [inv, setInv]     = useState(null);   // { email, cliente } ya validado
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState(null);

  /* Dos pasos, igual que el alta con código: primero se valida y se muestra
     A QUÉ CLIENTE va a quedar pegada la cuenta, después se vincula. Vincular
     a ciegas es la clase de error que no se puede deshacer desde la tienda —
     el comprador queda comprando con el canal y los precios de otra empresa,
     y hay que ir a la base a despegarlo. El nombre lo devuelve la misma RPC
     que ya se llamaba (0158): antes se pedía y se tiraba a la basura. */
  const validar = async (e) => {
    e.preventDefault();
    if (busy) return;
    setErr(null); setBusy(true);
    try {
      const v = await window.B2B_DATA.verInvitacion({ token: token.trim() });
      if (v && v.motivo === 'b2b_deshabilitado') {
        throw new Error('La tienda mayorista está cerrada en este momento. Tu código sigue valiendo: probá de nuevo más tarde o escribinos.');
      }
      if (!v || !v.ok) throw new Error('Ese código no existe, ya se usó o venció.');
      setInv(v);
    } catch (e2) {
      setErr(e2.message || 'No se pudo validar el código.');
    } finally { setBusy(false); }
  };

  const canjear = async () => {
    if (busy) return;
    setErr(null); setBusy(true);
    try {
      await window.B2B_DATA.canjearInvitacion({ token: token.trim() });
      await onListo();
    } catch (e2) {
      setErr(e2.message || 'No se pudo canjear el código.');
    } finally { setBusy(false); }
  };

  return (
    <div className="t-acceso">
      <div className="t-acceso-caja">
        <Marca chico/>
        <h2 className="t-espera-titulo">Tu cuenta todavía no está vinculada</h2>
        <p className="t-espera-texto">
          Si tenés un código de invitación, pegalo acá y la vinculamos con tu cliente.
        </p>

        {inv ? (
          <div className="t-form">
            <Aviso tipo="ok" titulo="Invitación válida">
              Vas a quedar vinculado a <b>{inv.cliente || 'tu cliente'}</b>
              {inv.email ? <> · <b>{inv.email}</b></> : null}.
              Vas a comprar con el canal y los precios de ese cliente.
            </Aviso>
            {err && <Aviso tipo="error">{err}</Aviso>}
            <button className="t-btn t-btn-primary t-btn-block" type="button"
                    onClick={canjear} disabled={busy}>
              {busy ? 'Vinculando…' : 'Sí, vincular mi cuenta'}
            </button>
            <button className="t-link" type="button" disabled={busy}
                    onClick={() => { setInv(null); setErr(null); }}>
              <Icon n="arrow-left" s={14}/> No es este — probar otro código
            </button>
          </div>
        ) : (
          <form className="t-form" onSubmit={validar}>
            <input className="t-input t-mono" value={token} onChange={e => setToken(e.target.value)}
                   placeholder="Código de invitación" aria-label="Código de invitación"
                   autoComplete="off" spellCheck="false"/>
            {err && <Aviso tipo="error">{err}</Aviso>}
            <button className="t-btn t-btn-primary t-btn-block" type="submit" disabled={busy || !token.trim()}>
              {busy ? 'Validando…' : 'Continuar'}
            </button>
            <button className="t-link" type="button" onClick={onSalir}>
              <Icon n="logout" s={14}/> Salir
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

/* Primer nombre, para saludar. `cuenta.nombre` es el de la PERSONA que
   compra (b2b_usuario.nombre); `cuenta.cliente.nombre` es el de la empresa.
   Se confundían fácil y hasta ahora el header mostraba siempre la empresa:
   del otro lado hay alguien, no una razón social. */
const primerNombre = (n) => String(n || '').trim().split(/\s+/)[0] || '';

/* ── Mi cuenta ─────────────────────────────────────────────────────────
   Lo que el cliente tenía que preguntar por teléfono: con qué CUIT quedó
   registrado, en qué condición de pago está, cuál es el mínimo de SU canal.
   Todo esto ya venía en b2b_rpc_mi_cuenta desde el principio y no se
   mostraba en ningún lado — el CUIT sólo asomaba en el pie de página, en
   gris, a 12px. */
const FilaCuenta = ({ icono, rotulo, valor }) => {
  /* Dato vacío: la fila directamente no existe. Una lista llena de "—" se
     lee como un sistema al que le falta información sobre vos. */
  if (!valor) return null;
  return (
    <div className="t-cuenta-fila">
      <span className="t-cuenta-icono"><Icon n={icono} s={15}/></span>
      <div className="t-cuenta-txt">
        <span>{rotulo}</span>
        <b>{valor}</b>
      </div>
    </div>
  );
};

const ModalCuenta = ({ cuenta, onCerrar, onSalir }) => {
  const cli = cuenta.cliente || {};

  /* El mínimo del canal en el que está parado, no el del cliente en general:
     mayorista y distribuidor tienen mínimos distintos y mostrar el que no es
     lo manda a cargar de más (o de menos, y no puede enviar). Misma fuente
     que la barra del catálogo. */
  const canalActual = ((cli.canales || []).find(c => c.codigo === cuenta.canal)) || null;
  const minMonto = Number((canalActual ? canalActual.minimo_pedido   : cli.minimo_pedido))   || 0;
  const minUnid  = Number((canalActual ? canalActual.minimo_unidades : cli.minimo_unidades)) || 0;
  const minimo = [
    minMonto > 0 ? money(minMonto) + ' + IVA' : null,
    minUnid  > 0 ? num(minUnid) + (minUnid === 1 ? ' unidad' : ' unidades') : null,
  ].filter(Boolean).join(' y ');

  return (
    <Modal open={true} title="Mi cuenta" onClose={onCerrar}
           footer={
             <button className="t-btn t-btn-ghost" onClick={onSalir}>
               <Icon n="logout" s={14}/> Cerrar sesión
             </button>
           }>
      <div className="t-cuenta">
        <div className="t-cuenta-grupo">Quién compra</div>
        <FilaCuenta icono="user" rotulo="Tu nombre" valor={cuenta.nombre}/>
        <FilaCuenta icono="mail" rotulo="Tu correo" valor={cuenta.email}/>

        <div className="t-cuenta-grupo">Tu empresa</div>
        <FilaCuenta icono="briefcase" rotulo="Razón social" valor={cli.nombre}/>
        <FilaCuenta icono="ticket" rotulo="CUIT" valor={cli.cuit}/>
        <FilaCuenta icono="card" rotulo="Condición de pago" valor={cli.condicion_pago}/>

        <div className="t-cuenta-grupo">Cómo comprás</div>
        <FilaCuenta icono="box" rotulo="Catálogo actual"
                    valor={(canalActual && canalActual.nombre) || cuenta.canal}/>
        <FilaCuenta icono="cart" rotulo="Mínimo de compra" valor={minimo}/>
      </div>

      <p className="t-cuenta-pie">
        ¿Algo de esto está mal? Escribinos y lo corregimos — desde acá no se
        edita para que nadie cambie los datos fiscales de la empresa sin que
        quede registro.
      </p>
    </Modal>
  );
};

/* ── Cabecera ──────────────────────────────────────────────────────────── */
const Header = ({ cuenta, tab, setTab, unidades, onSalir, onCambiarCanal, onVerCuenta }) => (
  <header className="t-header">
    <div className="t-header-in">
      <Marca chico/>

      <nav className="t-nav">
        <button className={'t-tab' + (tab === 'catalogo' ? ' t-tab-on' : '')}
                onClick={() => setTab('catalogo')}>
          <Icon n="box" s={15}/> <span>Catálogo</span>
        </button>
        <button className={'t-tab' + (tab === 'carrito' ? ' t-tab-on' : '')}
                onClick={() => setTab('carrito')}>
          <Icon n="cart" s={15}/> <span>Mi pedido</span>
          {unidades > 0 && <i className="t-badge">{num(unidades)}</i>}
        </button>
        <button className={'t-tab' + (tab === 'pedidos' ? ' t-tab-on' : '')}
                onClick={() => setTab('pedidos')}>
          <Icon n="history" s={15}/> <span>Mis pedidos</span>
        </button>
        {/* El resumen va último a propósito: el que entra viene a comprar, no
            a mirar estadísticas. Queda a un toque, no en el camino. */}
        <button className={'t-tab' + (tab === 'resumen' ? ' t-tab-on' : '')}
                onClick={() => setTab('resumen')}>
          <Icon n="chart" s={15}/> <span>Mi resumen</span>
        </button>
      </nav>

      <div className="t-header-user">
        {/* En qué catálogo está parado. Es lo primero que hay que poder
            contestar mirando un precio: la misma pieza vale distinto en
            mayorista que en distribuidor. */}
        <SelectorCanal cuenta={cuenta} onElegido={onCambiarCanal}/>

        {/* Saluda a la PERSONA y abajo dice para qué empresa está comprando.
            Antes decía la empresa arriba y el mail abajo: información
            correcta y de nadie. Es un botón porque además es la puerta a
            "Mi cuenta" — el mail, el CUIT y la condición de pago se fueron
            ahí adentro, que es donde se los va a buscar cuando hacen falta. */}
        <button className="t-header-cli" onClick={onVerCuenta}
                title="Ver los datos de mi cuenta">
          <span className="t-header-cli-txt">
            <b>Hola{primerNombre(cuenta.nombre) ? ', ' + primerNombre(cuenta.nombre) : ''}</b>
            <span>{(cuenta.cliente && cuenta.cliente.nombre) || cuenta.email}</span>
          </span>
          <Icon n="chev-down" s={14}/>
        </button>

        <button className="t-icon-btn" onClick={onSalir} aria-label="Salir" title="Salir">
          <Icon n="logout" s={17}/>
        </button>
      </div>
    </div>
  </header>
);

/* ══ App ════════════════════════════════════════════════════════════════ */
const TiendaApp = () => {
  const [sesion, setSesion]   = useState(undefined); // undefined = averiguando
  const [cuenta, setCuenta]   = useState(null);
  const [carrito, setCarrito] = useState(null);
  const [tab, setTab]         = useState('catalogo');
  const [ocupado, setOcupado] = useState(false);
  const [enviado, setEnviado] = useState(null);      // resultado de enviarPedido
  const [senalPedidos, setSenalPedidos] = useState(0);
  const [fatal, setFatal]     = useState(null);
  const [verCuenta, setVerCuenta] = useState(false);

  /* Alguien que llega por el link del mail. Se decide UNA vez, con lo que el
     archivo de acceso leyó del hash al cargar; 'null' es el caso normal.
     Cancelar lo apaga y cae en la pantalla de acceso de siempre. */
  const [recuperar, setRecuperar] = useState(() => window.TiendaAcceso.RECUPERACION);

  /* ── Sesión ──────────────────────────────────────────────────────────── */
  useEffect(() => {
    let vivo = true;
    window.SUPA.auth.getSession().then(({ data }) => {
      if (vivo) setSesion((data && data.session) || null);
    });
    const { data: sub } = window.SUPA.auth.onAuthStateChange((_ev, s) => {
      if (!vivo) return;
      setSesion(s || null);
      if (!s) { setCuenta(null); setCarrito(null); setTab('catalogo'); }
    });
    return () => { vivo = false; sub && sub.subscription && sub.subscription.unsubscribe(); };
  }, []);

  /* ── Cuenta ──────────────────────────────────────────────────────────── */
  const cargarCuenta = useCallback(async () => {
    try {
      const c = await window.B2B_DATA.miCuenta({});
      setCuenta(c); setFatal(null);
      return c;
    } catch (e) {
      setFatal(e.message || 'No pudimos conectarnos. Probá de nuevo en un rato.');
      setCuenta(null);
      return null;
    }
  }, []);

  useEffect(() => { if (sesion) cargarCuenta(); }, [sesion, cargarCuenta]);

  /* ── Carrito ─────────────────────────────────────────────────────────── */
  const puedeComprar = !!(cuenta && cuenta.ok && cuenta.estado === 'aprobado'
                          && cuenta.cliente && cuenta.cliente.habilitado);

  const recargarCarrito = useCallback(async () => {
    const c = await window.B2B_DATA.carrito({});
    setCarrito(c);
    return c;
  }, []);

  useEffect(() => {
    if (!puedeComprar) return;
    recargarCarrito().catch(e => setFatal(e.message || 'No pudimos cargar tu pedido.'));
  }, [puedeComprar, recargarCarrito]);

  /* Las mutaciones del carrito son secuenciales a propósito: 'ocupado'
     bloquea los botones mientras hay una en vuelo. Con clicks rápidos en
     "+", dos requests concurrentes sobre la misma línea pueden llegar
     desordenados y dejar en pantalla una cantidad que no es la de la base. */
  const setCantidad = useCallback(async (sku, cantidad) => {
    setOcupado(true);
    try {
      await window.B2B_DATA.carritoSetItem({ sku, cantidad });
      await recargarCarrito();
    } finally { setOcupado(false); }
  }, [recargarCarrito]);

  const guardarDatos = useCallback(async (datos) => {
    setOcupado(true);
    try {
      await window.B2B_DATA.carritoSetDatos(datos);
      await recargarCarrito();
    } finally { setOcupado(false); }
  }, [recargarCarrito]);

  const enviar = useCallback(async () => {
    setOcupado(true);
    try {
      const r = await window.B2B_DATA.enviarPedido({});
      setEnviado(r);
      await recargarCarrito();          // el borrador quedó vacío
      setSenalPedidos(n => n + 1);      // que "Mis pedidos" se entere
    } finally { setOcupado(false); }
  }, [recargarCarrito]);

  /* ── Cambiar de catálogo ─────────────────────────────────────────────
     Hay que releer las DOS cosas. La cuenta, porque cambia el canal vigente
     y con él el mínimo de compra; y el carrito, porque desde 0162 hay un
     borrador por canal: el que está en pantalla es el del catálogo anterior.
     El catálogo se recarga solo, por el key={cuenta.canal} de más abajo. */
  const cambiarCanal = useCallback(async () => {
    setEnviado(null);
    setTab('catalogo');
    const c = await cargarCuenta();
    if (c && c.ok && c.estado === 'aprobado' && c.cliente && c.cliente.habilitado) {
      await recargarCarrito();
    }
    return c;
  }, [cargarCuenta, recargarCarrito]);

  const salir = async () => {
    await window.SUPA.auth.signOut();
    setCuenta(null); setCarrito(null); setEnviado(null);
  };

  /* ── Render ──────────────────────────────────────────────────────────── */

  /* Va PRIMERO, incluso antes de mirar la sesión: el que abre un link de
     recuperación viene a cambiar la clave. Si en ese browser había una sesión
     vieja abierta, mandarlo directo al catálogo le haría creer que el link no
     funcionó. */
  if (recuperar) {
    return (
      <PantallaNuevaPass
        datos={recuperar}
        onListo={async () => { setRecuperar(null); await cargarCuenta(); }}
        onCancelar={async () => {
          /* La sesión que abrió el link de recuperación no sirve para nada más
             que cambiar la clave: si se arrepiente, se cierra. */
          try { await window.SUPA.auth.signOut(); } catch (e) { /* ya estaba afuera */ }
          setRecuperar(null);
        }}/>
    );
  }

  if (sesion === undefined) return <Spinner texto="Entrando…"/>;

  if (!sesion) return <PantallaAcceso onEntro={cargarCuenta}/>;

  if (fatal) {
    return (
      <div className="t-acceso">
        <div className="t-acceso-caja">
          <Marca chico/>
          <Aviso tipo="error" titulo="No pudimos conectarnos">{fatal}</Aviso>
          <div className="t-espera-acciones">
            <button className="t-btn t-btn-ghost" onClick={cargarCuenta}>
              <Icon n="refresh" s={14}/> Reintentar
            </button>
            <button className="t-btn t-btn-ghost" onClick={salir}>
              <Icon n="logout" s={14}/> Salir
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!cuenta) return <Spinner texto="Cargando tu cuenta…"/>;

  /* Tiene sesión pero todavía no puede comprar. Cada rama dice algo distinto
     a propósito — ver el comentario de ESPERA en tienda-acceso.jsx. */
  if (!cuenta.ok) {
    if (cuenta.motivo === 'sin_cuenta_b2b') {
      return <CanjearLogueado onListo={cargarCuenta} onSalir={salir}/>;
    }
    return <PantallaEspera motivo={cuenta.motivo} onSalir={salir} onReintentar={cargarCuenta}/>;
  }
  if (cuenta.estado !== 'aprobado') {
    return <PantallaEspera cuenta={cuenta} onSalir={salir} onReintentar={cargarCuenta}/>;
  }
  if (!cuenta.cliente || !cuenta.cliente.habilitado) {
    return <PantallaEspera cuenta={cuenta} motivo="sin_habilitar" onSalir={salir} onReintentar={cargarCuenta}/>;
  }

  /* Todavía no eligió catálogo (alta nueva, o le dieron de baja el que tenía
     elegido). Va DESPUÉS de aprobado y habilitado a propósito: cliente.canales
     sólo viene cuando la cuenta está aprobada, y sin eso no hay nada que
     mostrar. Si el cliente se quedó sin ningún canal activo no se lo traba
     acá — b2b_fn_canal_actual() ya cae sola al canal por defecto. */
  const canalesHab = (cuenta.cliente && cuenta.cliente.canales) || [];
  if (cuenta.canal_elegido === false && canalesHab.length > 0) {
    return <PantallaCanal cuenta={cuenta} onElegido={cambiarCanal} onSalir={salir}/>;
  }

  const unidades = ((carrito && carrito.items) || []).reduce((a, i) => a + (Number(i.cantidad) || 0), 0);

  return (
    <div className="t-app">
      <Header cuenta={cuenta} tab={tab} setTab={t => { setTab(t); setEnviado(null); }}
              unidades={unidades} onSalir={salir} onCambiarCanal={cambiarCanal}
              onVerCuenta={() => setVerCuenta(true)}/>

      {verCuenta && (
        <ModalCuenta cuenta={cuenta} onCerrar={() => setVerCuenta(false)}
                     onSalir={() => { setVerCuenta(false); salir(); }}/>
      )}

      <main className="t-main">
        {enviado ? (
          <PedidoEnviado resultado={enviado}
                         emisor={cuenta.emisor} cliente={cuenta.cliente}
                         onVerPedidos={() => { setEnviado(null); setTab('pedidos'); }}
                         onSeguirComprando={() => { setEnviado(null); setTab('catalogo'); }}/>
        ) : tab === 'catalogo' ? (
          <PantallaCatalogo key={cuenta.canal} carrito={carrito}
                            onSetCantidad={setCantidad} ocupado={ocupado}
                            onIrCarrito={() => setTab('carrito')}/>
        ) : tab === 'carrito' ? (
          <PantallaCarrito carrito={carrito} onSetCantidad={setCantidad}
                           onGuardarDatos={guardarDatos} onEnviar={enviar}
                           onSeguirComprando={() => setTab('catalogo')} ocupado={ocupado}/>
        ) : tab === 'resumen' ? (
          <PantallaResumen cuenta={cuenta} recargarSenal={senalPedidos}
                           onIrCatalogo={() => setTab('catalogo')}
                           onVerPedidos={() => setTab('pedidos')}/>
        ) : (
          <PantallaPedidos recargarSenal={senalPedidos}
                           cuenta={cuenta}
                           onIrCatalogo={() => setTab('catalogo')}
                           onIrCarrito={() => setTab('carrito')}
                           carritoUnidades={unidades}
                           onRepetido={recargarCarrito}/>
        )}
      </main>

      <footer className="t-footer">
        Justo Makario Home · Tienda mayorista
        {cuenta.cliente && cuenta.cliente.cuit ? ' · CUIT ' + cuenta.cliente.cuit : ''}
      </footer>
    </div>
  );
};

/* La raíz envuelve todo en el proveedor de avisos: cualquier pantalla puede
   llamar useToast() sin recibirlo por props. */
const TiendaRoot = () => (
  <ToastProvider>
    <TiendaApp/>
  </ToastProvider>
);

window.TiendaRoot = TiendaRoot;
window.TiendaApp = TiendaApp;
