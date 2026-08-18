/* ══ TIENDA · ELEGIR CATÁLOGO ══════════════════════════════════════════════
   Un mismo comprador puede tener habilitados los dos catálogos: mayorista y
   distribuidor. No son dos usuarios — es el mismo, que elige con cuál compra
   cada vez que entra.

   Qué cambia al elegir (todo, no es un filtro de vista):
     · el PRECIO de todo el catálogo — cada canal tiene su lista;
     · el MÍNIMO de compra, que es propio de cada canal;
     · el CARRITO. Desde 0162 hay un borrador por canal, así que el pedido
       que armó como mayorista lo sigue esperando intacto cuando vuelva a ese
       catálogo. Cambiar de canal no le tira el carrito.

   Por eso esto es una pantalla y no un desplegable escondido: es la primera
   decisión de la compra. Después se cambia cuando quiera, desde el header.

   La elección es pegajosa (queda en b2b_usuario.canal_activo), pero la
   pantalla vuelve a aparecer cuando b2b_rpc_mi_cuenta devuelve
   canal_elegido=false: alta nueva, o canal que el dueño le dio de baja.
   ═══════════════════════════════════════════════════════════════════════ */

/* Qué es cada canal, en criollo. La clave es el `codigo` de b2b_canal; el
   NOMBRE sale siempre de la base (el dueño puede renombrarlos), acá va solo
   la explicación. Un canal que el dueño invente mañana cae en el texto
   genérico y la pantalla sigue funcionando. */
const CANAL_TXT = {
  mayorista: {
    icono: 'box',
    bajada: 'Para revender en tu local o tu tienda.',
    detalle: 'Precios de la lista mayorista, con las cantidades mínimas por producto.',
  },
  distribuidor: {
    icono: 'package',
    bajada: 'Para revender a otros comercios.',
    detalle: 'La lista de distribuidor: mejores precios, pensada para compras por volumen.',
  },
};

const canalInfo = (codigo) => CANAL_TXT[codigo] || {
  icono: 'box',
  bajada: 'Catálogo habilitado para tu cuenta.',
  detalle: 'Tiene su propia lista de precios y su propio mínimo de compra.',
};

/* El mínimo, dicho como lo entiende el que compra. Los dos vienen del canal
   y cualquiera de los dos puede estar en cero, que es como está hoy:
   0 = desactivado, no "mínimo de $0". */
const textoMinimo = (c) => {
  const m = Number(c && c.minimo_pedido) || 0;
  const u = Number(c && c.minimo_unidades) || 0;
  if (!m && !u) return 'Sin mínimo de compra';
  const partes = [];
  if (m) partes.push(money(m) + ' + IVA');
  if (u) partes.push(num(u) + (u === 1 ? ' unidad' : ' unidades'));
  return 'Mínimo por pedido: ' + partes.join(' y ');
};

/* ── Una tarjeta por catálogo ──────────────────────────────────────────── */
const TarjetaCanal = ({ canal, actual, ocupado, eligiendo, onElegir }) => {
  const info = canalInfo(canal.codigo);
  const esActual = actual === canal.codigo;
  return (
    <button type="button"
            className={'t-canal' + (esActual ? ' t-canal-on' : '')}
            disabled={ocupado}
            onClick={() => onElegir(canal.codigo)}>
      {esActual && <span className="t-canal-actual">Estás acá</span>}

      <span className="t-canal-icono"><Icon n={info.icono} s={22}/></span>

      <span className="t-canal-cuerpo">
        <b className="t-canal-nombre">{canal.nombre || canal.codigo}</b>
        <span className="t-canal-bajada">{info.bajada}</span>
        <span className="t-canal-detalle">{info.detalle}</span>
        <span className="t-canal-min"><Icon n="info" s={13}/> {textoMinimo(canal)}</span>
      </span>

      <span className="t-canal-ir">
        {eligiendo === canal.codigo
          ? <span className="t-canal-cargando">Abriendo…</span>
          : <><span>{esActual ? 'Seguir acá' : 'Comprar así'}</span><Icon n="chev-right" s={16}/></>}
      </span>
    </button>
  );
};

/* ── La lista de tarjetas ──────────────────────────────────────────────
   Se usa igual en la pantalla de bienvenida y adentro del modal del header,
   así que la elección se ve idéntica en los dos lados. */
const ListaCanales = ({ canales, actual, onElegido, onError }) => {
  const [eligiendo, setEligiendo] = useState(null);

  const elegir = async (codigo) => {
    if (eligiendo) return;
    setEligiendo(codigo);
    try {
      await window.B2B_DATA.setCanal({ canal: codigo });
      /* onElegido recarga cuenta Y carrito. El carrito NO se puede dar por
         bueno después de esto: hay un borrador por canal, así que el que
         estaba en pantalla es el del catálogo anterior. */
      await onElegido(codigo);
    } catch (e) {
      setEligiendo(null);
      if (onError) onError(e.message || 'No se pudo abrir ese catálogo.');
    }
  };

  return (
    <div className="t-canales">
      {canales.map(c => (
        <TarjetaCanal key={c.codigo} canal={c} actual={actual}
                      ocupado={!!eligiendo} eligiendo={eligiendo} onElegir={elegir}/>
      ))}
    </div>
  );
};

/* ══ Pantalla de bienvenida ═════════════════════════════════════════════
   Se muestra cuando cuenta.canal_elegido === false. Ocupa la pantalla
   entera: no hay header ni catálogo detrás, porque todavía no se sabe qué
   precios corresponden.                                                   */
const PantallaCanal = ({ cuenta, onElegido, onSalir }) => {
  const [err, setErr] = useState(null);
  const canales = (cuenta.cliente && cuenta.cliente.canales) || [];
  const uno = canales.length === 1 ? canales[0].codigo : null;

  /* Un solo catálogo habilitado: no hay nada que elegir. Se fija solo y se
     entra derecho — hacerlo apretar el único botón que hay es hacerle perder
     un click todos los días. */
  useEffect(() => {
    if (!uno) return;
    let vivo = true;
    (async () => {
      try {
        await window.B2B_DATA.setCanal({ canal: uno });
        if (vivo) await onElegido(uno);
      } catch (e) {
        if (vivo) setErr(e.message || 'No se pudo abrir tu catálogo.');
      }
    })();
    return () => { vivo = false; };
  }, [uno, onElegido]);

  if (uno && !err) return <Spinner texto="Abriendo tu catálogo…"/>;

  const nombre = (cuenta.cliente && cuenta.cliente.nombre) || cuenta.nombre;

  return (
    <div className="t-elegir">
      <div className="t-elegir-caja">
        <Marca chico/>

        <header className="t-elegir-head">
          <p className="t-elegir-hola">Hola{cuenta.nombre ? ', ' + String(cuenta.nombre).split(' ')[0] : ''} 👋</p>
          <h1 className="t-elegir-titulo">¿Con qué catálogo querés comprar?</h1>
          <p className="t-elegir-bajada">
            {nombre} tiene habilitados los dos. Cada uno tiene su lista de precios y su
            propio pedido en curso — podés cambiar cuando quieras.
          </p>
        </header>

        {err && <Aviso tipo="error">{err}</Aviso>}

        <ListaCanales canales={canales} actual={cuenta.canal}
                      onElegido={onElegido} onError={setErr}/>

        <p className="t-elegir-pie">
          Lo cambiás cuando quieras desde arriba, sin perder lo que tengas armado.
        </p>

        {onSalir && (
          <button className="t-link" type="button" onClick={onSalir}>
            <Icon n="logout" s={14}/> Salir
          </button>
        )}
      </div>
    </div>
  );
};

/* ══ Cambiador del header ═══════════════════════════════════════════════
   Un botón que dice en qué catálogo está parado — que es lo primero que hay
   que poder contestar cuando uno mira un precio — y que abre las mismas
   tarjetas para cambiarlo. Con un solo catálogo habilitado no es un botón:
   es un cartel, porque no hay nada para elegir.                           */
const SelectorCanal = ({ cuenta, onElegido }) => {
  const [abierto, setAbierto] = useState(false);
  const [err, setErr] = useState(null);
  const canales = (cuenta.cliente && cuenta.cliente.canales) || [];
  const actual = canales.find(c => c.codigo === cuenta.canal);
  const nombre = (actual && actual.nombre) || cuenta.canal || '—';

  if (canales.length <= 1) {
    return <span className="t-canal-chip t-canal-chip-fijo" title="Tu lista de precios">
      <Icon n={canalInfo(cuenta.canal).icono} s={14}/> {nombre}
    </span>;
  }

  const elegido = async (codigo) => {
    setAbierto(false);
    setErr(null);
    await onElegido(codigo);
  };

  return (
    <>
      <button type="button" className="t-canal-chip" onClick={() => { setErr(null); setAbierto(true); }}
              title="Cambiar de catálogo">
        <Icon n={canalInfo(cuenta.canal).icono} s={14}/>
        <span>{nombre}</span>
        <Icon n="chev-down" s={13}/>
      </button>

      <Modal open={abierto} title="¿Con qué catálogo querés comprar?"
             onClose={() => setAbierto(false)} ancho={620}>
        <p className="t-elegir-bajada t-elegir-bajada-modal">
          Cambia la lista de precios de todo el catálogo. Lo que tengas armado en el otro
          te espera intacto: hay un pedido en curso por catálogo.
        </p>
        {err && <Aviso tipo="error">{err}</Aviso>}
        <ListaCanales canales={canales} actual={cuenta.canal}
                      onElegido={elegido} onError={setErr}/>
      </Modal>
    </>
  );
};

window.TiendaCanal = { PantallaCanal, SelectorCanal, ListaCanales, TarjetaCanal, CANAL_TXT, textoMinimo };
