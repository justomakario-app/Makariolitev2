/* ══ TIENDA · PEDIDO EN PREPARACIÓN ══════════════════════════════════════
   El carrito NO vive en localStorage: es una fila real en b2b_pedido con
   estado 'borrador'. El cliente arma el pedido en la notebook del depósito,
   lo sigue en el celular y no pierde nada. Cada cambio de cantidad es una
   llamada al servidor (b2b_rpc_carrito_set_item).

   Los mínimos del canal se chequean acá ANTES de mandar, con los mismos
   números que devuelve b2b_rpc_carrito (minimo_pedido, minimo_unidades).
   No es para reemplazar la validación del backend — que igual va a rebotar
   con 22023 — sino para que el cliente vea cuánto le falta mientras carga,
   en vez de enterarse al final.

   ⚠ Los datos de entrega se guardan con coalesce(nullif(trim(...))): mandar
   un campo vacío NO lo borra, deja el valor anterior. Por eso la pantalla
   no ofrece "borrar" un dato ya guardado — ofrecerlo sería mentir.

   El tilde "con IVA" es la excepción y por eso viaja distinto: false es una
   respuesta, no un campo vacío. b2b_rpc_carrito_set_datos pregunta si la
   CLAVE vino en el payload, no si el valor está lleno (0170).
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Fila de un ítem ───────────────────────────────────────────────────
   `disponible` viene calculado por b2b_rpc_carrito (0158): es false cuando
   el producto se despublicó, se quedó sin precio o se dio de baja el SKU
   MIENTRAS estaba en el carrito. El precio que se muestra ahí es el último
   conocido, no uno vigente, así que la línea se marca y no se suma a los
   totales: mostrarla igual que las demás sería cobrar un precio que ya no
   existe. Enviar con una de estas rebota en el backend con P0002, y esa es
   la razón por la que la línea se marca acá y no allá.

   La cantidad tampoco se puede editar: b2b_rpc_carrito_set_item valida
   disponibilidad para cualquier cantidad > 0. Lo único que el backend sí
   acepta es cantidad = 0 (borra antes de validar), o sea sacarla — que es
   justamente lo que se ofrece. */
const FilaCarrito = ({ item, onSetCantidad, ocupado }) => {
  const regla = textoRegla(item);
  const baja  = item.disponible === false;
  return (
    <div className={'t-item' + (baja ? ' t-item-baja' : '')}>
      <div className="t-item-datos">
        <div className="t-item-nombre">{item.modelo || item.sku}</div>
        <div className="t-item-meta">
          {item.color && <span>{item.color}</span>}
          <span className="t-item-sku">{item.sku}</span>
        </div>
        {baja
          ? <div className="t-item-baja-txt">
              <Icon n="alert" s={13}/> Ya no está disponible — sacalo para poder enviar el pedido
            </div>
          : regla && <div className="t-item-regla">{regla}</div>}
        {item.notas_item && <div className="t-item-nota">“{item.notas_item}”</div>}
      </div>

      <div className="t-item-unit">
        <span className="t-item-lbl">Unitario</span>
        {baja ? <span className="t-item-tachado">{money(item.precio_unitario)}</span> : money(item.precio_unitario)}
      </div>

      <div className="t-item-cant">
        {baja
          ? <span className="t-item-cant-fija">{num(item.cantidad)}</span>
          : <Cantidad prod={item} valor={item.cantidad} chico
                      onChange={q => onSetCantidad(item.sku, q)}/>}
      </div>

      <div className="t-item-sub">
        <span className="t-item-lbl">Subtotal</span>
        {baja ? <span className="t-item-tachado">{money(item.subtotal)}</span> : <b>{money(item.subtotal)}</b>}
      </div>

      <button className={'t-icon-btn t-item-quitar' + (baja ? ' t-item-quitar-urge' : '')}
              disabled={ocupado}
              onClick={() => onSetCantidad(item.sku, 0)}
              aria-label={'Quitar ' + (item.modelo || item.sku)}>
        <Icon n="trash" s={16}/>
      </button>
    </div>
  );
};

/* ── Facturar o presupuesto ────────────────────────────────────────────
   Unos mayoristas necesitan la factura y otros trabajan con presupuesto.
   Eso se venía arreglando por WhatsApp y el pedido llegaba al equipo sin
   decir cuál de las dos era. Ahora lo elige el comprador acá y queda
   pegado al pedido (b2b_pedido.con_iva, 0170): la nota interna, los mails
   y el presupuesto dicen todos lo mismo.

   El tilde se lee en términos del COMPROBANTE, no del impuesto: lo que el
   comprador decide es qué papel recibe. Cada leyenda describe el documento
   que va a salir y nada más — nunca lo que no se emite. Esta pantalla se
   saca de captura y se reenvía, así que lo que dice tiene que poder leerse
   suelto, fuera de contexto, sin que signifique otra cosa. */
const IvaTilde = ({ valor, onCambiar, ocupado, cuit, alicuota }) => (
  <div className={'t-iva' + (valor ? ' t-iva-on' : '')}>
    <label className="t-iva-check">
      <input type="checkbox" checked={valor} disabled={ocupado}
             onChange={e => onCambiar(e.target.checked)}/>
      <span className="t-iva-box" aria-hidden="true"><Icon n="check" s={12}/></span>
      <span className="t-iva-lbl">Quiero <b>facturar</b> este pedido</span>
    </label>
    <p className="t-iva-leyenda">
      {valor
        ? <>Se generará una factura con el <b>{alicuota ? alicuota + '% de IVA' : 'IVA'}</b>
           {cuit ? <> al CUIT <b>{cuit}</b></> : ' a tu CUIT'}.</>
        : <><b>Presupuesto</b> sin impuestos ni percepciones.</>}
    </p>
  </div>
);

/* ── Barra de progreso hacia el mínimo ─────────────────────────────────── */
const Minimo = ({ etiqueta, actual, requerido, formato }) => {
  if (!requerido || requerido <= 0) return null;
  const ok = actual >= requerido;
  const pct = Math.min(100, Math.round((actual / requerido) * 100));
  const f = formato || (v => num(v));
  return (
    <div className={'t-minimo' + (ok ? ' t-minimo-ok' : '')}>
      <div className="t-minimo-txt">
        {ok
          ? <><Icon n="check" s={13}/> {etiqueta}: llegaste al mínimo</>
          : <>{etiqueta}: te falta <b>{f(requerido - actual)}</b> para el mínimo de {f(requerido)}</>}
      </div>
      <div className="t-minimo-barra"><i style={{ width: pct + '%' }}/></div>
    </div>
  );
};

/* ══ Pantalla del pedido en preparación ═════════════════════════════════ */
const PantallaCarrito = ({ carrito, cliente, onSetCantidad, onGuardarDatos, onEnviar, onSeguirComprando, ocupado }) => {
  const [dir, setDir]       = useState('');
  const [notas, setNotas]   = useState('');
  const [conIva, setConIva] = useState(true);
  const [tocandoIva, setTocandoIva] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [enviando, setEnviando]   = useState(false);
  const toast = useToast();
  const cuit = (cliente && cliente.cuit) || '';

  /* Los datos guardados mandan; el estado local es solo el borrador de la
     edición en curso. Cuando el servidor devuelve otra cosa, gana el servidor. */
  useEffect(() => {
    if (!carrito) return;
    setDir(carrito.direccion_entrega || '');
    setNotas(carrito.notas || '');
  }, [carrito && carrito.direccion_entrega, carrito && carrito.notas]);

  /* El tilde también vive en el borrador, así que vuelve del servidor: el
     cliente lo deja en presupuesto, se va al catálogo y al volver sigue
     como lo dejó. Efecto aparte de los datos de entrega porque se guarda solo,
     apenas se toca, sin esperar el botón "Guardar datos".
     Ojo con el !== false: un carrito viejo puede no traer la clave, y en ese
     caso el pedido va con IVA, que es como venía funcionando siempre. */
  useEffect(() => {
    if (!carrito) return;
    setConIva(carrito.con_iva !== false);
  }, [carrito && carrito.con_iva]);

  const items = (carrito && carrito.items) || [];

  /* Las líneas caídas no suman: ni al total ni al mínimo. Contarlas diría
     "llegaste al mínimo" y, al sacarlas para poder enviar, el pedido se
     caería abajo del mínimo otra vez. Se cuentan aparte, para nombrarlas. */
  const caidos    = items.filter(i => i.disponible === false);
  const comprables = items.filter(i => i.disponible !== false);

  const totales = useMemo(() => {
    const vivos = items.filter(i => i.disponible !== false);
    const neto = vivos.reduce((a, i) => a + (Number(i.subtotal) || 0), 0);
    const iva  = vivos.reduce((a, i) =>
      a + (Number(i.subtotal) || 0) * ((Number(i.iva_pct) || 0) / 100), 0);
    const unidades = vivos.reduce((a, i) => a + (Number(i.cantidad) || 0), 0);
    return { neto, iva, total: neto + iva, unidades };
  }, [items]);

  /* El único número que el cliente va a transferir. Es la misma cuenta que
     hace la base en b2b_pedido.total_a_pagar; acá se repite porque el
     carrito todavía no está sellado y no tiene esa columna cargada. */
  const aPagar = conIva ? totales.total : totales.neto;

  /* El porcentaje que promete la leyenda de la factura. Sale de los ítems,
     no está escrito a mano: hoy el catálogo entero es 21%, pero un producto
     al 10,5% convertiría ese "21%" en un número que la factura no va a
     tener. Con más de una alícuota no se promete ninguna — igual que hace
     el PDF con su etiqueta de IVA. */
  const alicuota = useMemo(() => {
    const pcts = [];
    items.forEach(i => {
      if (i.disponible === false) return;
      const p = Number(i.iva_pct);
      if (p > 0 && pcts.indexOf(p) < 0) pcts.push(p);
    });
    return pcts.length === 1 ? String(pcts[0]) : null;
  }, [items]);

  const minMonto = Number(carrito && carrito.minimo_pedido) || 0;
  const minUnid  = Number(carrito && carrito.minimo_unidades) || 0;
  const faltaMonto = minMonto > 0 && totales.neto < minMonto;
  const faltaUnid  = minUnid  > 0 && totales.unidades < minUnid;
  const puedeEnviar = comprables.length > 0 && caidos.length === 0
                      && !faltaMonto && !faltaUnid && !ocupado;

  const hayCambios =
    dir !== (carrito?.direccion_entrega || '') ||
    notas !== (carrito?.notas || '');

  /* Se guarda solo, en el momento. Un tilde que hay que confirmar con otro
     botón termina enviado en el estado que no era. Si el guardado falla se
     vuelve atrás: un tilde que no coincide con lo guardado es peor que uno
     que no se movió, porque el cliente se va convencido de otra cosa. */
  const cambiarIva = async (valor) => {
    const previo = conIva;
    setConIva(valor);
    setTocandoIva(true);
    try {
      await onGuardarDatos({ con_iva: valor });
    } catch (e) {
      setConIva(previo);
      toast.error(e.message || 'No pudimos guardar la opción de IVA.');
    } finally { setTocandoIva(false); }
  };

  const guardar = async () => {
    setGuardando(true);
    try {
      await onGuardarDatos({ direccion_entrega: dir, notas });
      toast.success('Datos guardados.');
    } catch (e) {
      toast.error(e.message || 'No se pudieron guardar los datos.');
    } finally { setGuardando(false); }
  };

  const enviar = async () => {
    setEnviando(true);
    try {
      /* Se guardan primero los datos de entrega: si el cliente escribió la
         dirección y apretó "Enviar" sin apretar "Guardar", el pedido tiene
         que salir con esa dirección igual. */
      if (hayCambios) {
        await onGuardarDatos({ direccion_entrega: dir, notas });
      }
      /* Va explícito aunque ya esté guardado: si el cliente tildó y mandó en
         el mismo movimiento, esto es más nuevo que el borrador. */
      await onEnviar({ con_iva: conIva });
      setConfirmar(false);
    } catch (e) {
      setConfirmar(false);
      toast.error(e.message || 'No se pudo enviar el pedido.');
    } finally { setEnviando(false); }
  };

  const cambiarCantidad = async (sku, cantidad) => {
    try { await onSetCantidad(sku, cantidad); }
    catch (e) { toast.error(e.message || 'No se pudo actualizar.'); }
  };

  if (!carrito) return <Spinner texto="Cargando tu pedido…"/>;

  if (!items.length) {
    return (
      <Vacio icono="cart" titulo="Tu pedido está vacío">
        Agregá productos desde el catálogo. Lo que cargues queda guardado, así que
        podés seguirlo desde otra computadora o el celular.
      </Vacio>
    );
  }

  return (
    <div className="t-carrito">
      <div className="t-carrito-items">
        <div className="t-items-head">
          <span>{num(comprables.length)} producto{comprables.length === 1 ? '' : 's'} · {num(totales.unidades)} unidades</span>
          <button className="t-link t-link-inline" onClick={onSeguirComprando}>
            <Icon n="plus" s={13}/> Seguir agregando
          </button>
        </div>

        {caidos.length > 0 && (
          <Aviso tipo="warn" titulo={caidos.length === 1
            ? 'Un producto de tu pedido dejó de estar disponible'
            : `${num(caidos.length)} productos de tu pedido dejaron de estar disponibles`}>
            {caidos.map(i => i.modelo || i.sku).join(', ')}. Sacalos del pedido y lo
            podés enviar; el resto queda como está. Si los necesitás, escribinos.
          </Aviso>
        )}

        {items.map(i => (
          <FilaCarrito key={i.sku} item={i} onSetCantidad={cambiarCantidad} ocupado={ocupado}/>
        ))}

        <div className="t-entrega">
          <h3>Datos de entrega</h3>

          <label className="t-label" htmlFor="ca-dir">Dirección de entrega</label>
          <input id="ca-dir" className="t-input" value={dir} onChange={e => setDir(e.target.value)}
                 placeholder="Calle, número, localidad"/>

          {/* Acá vivía "¿Para cuándo lo necesitás?". Lo sacó el dueño: una
              fecha puesta por el comprador se lee después como un plazo
              comprometido, y el equipo terminaba corriendo detrás de una
              fecha que nunca aceptó. La entrega se acuerda al responder el
              pedido. La columna fecha_entrega_deseada sigue en la base para
              los pedidos viejos que ya la tienen; simplemente nadie la
              carga más desde acá. */}

          <label className="t-label" htmlFor="ca-notas">Notas <span className="t-opt">(opcional)</span></label>
          <textarea id="ca-notas" className="t-input t-textarea" rows="3" value={notas}
                    onChange={e => setNotas(e.target.value)}
                    placeholder="Cualquier cosa que tengamos que saber del pedido"/>

          {hayCambios && (
            <button className="t-btn t-btn-ghost" onClick={guardar} disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar datos'}
            </button>
          )}
        </div>
      </div>

      <aside className="t-resumen">
        <h3>Resumen</h3>

        <div className="t-resumen-linea"><span>Neto</span><b>{money(totales.neto)}</b></div>
        {conIva && (
          <div className="t-resumen-linea t-resumen-suave"><span>IVA</span><span>{money(totales.iva)}</span></div>
        )}
        <div className="t-resumen-total">
          <span>{conIva ? 'Total con IVA' : 'Total'}</span><b>{money(aPagar)}</b>
        </div>

        {/* Va acá, pegado al total y no abajo con los datos de entrega, porque
            lo que cambia es el número: el cliente lo toca y ve en el acto
            cuánto tiene que transferir. Es el momento de confirmar el pedido,
            que es donde lo pidió el dueño. */}
        <IvaTilde valor={conIva} onCambiar={cambiarIva} cuit={cuit} alicuota={alicuota}
                  ocupado={ocupado || tocandoIva || enviando}/>

        {/* El mínimo del canal se mide sobre el NETO — es lo que valida el
            backend. Se aclara siempre, tildado o no: con factura porque justo
            arriba hay un total más alto que el mínimo, y como presupuesto
            porque el que acaba de destildar tiene que saber que el mínimo no
            se le movió para abajo. */}
        <Minimo etiqueta="Monto neto" actual={totales.neto} requerido={minMonto} formato={money}/>
        <Minimo etiqueta="Unidades" actual={totales.unidades} requerido={minUnid}/>

        <button className="t-btn t-btn-primary t-btn-block" disabled={!puedeEnviar}
                onClick={() => setConfirmar(true)}>
          Enviar pedido
        </button>

        {caidos.length > 0 ? (
          <div className="t-resumen-nota">
            Primero sacá {caidos.length === 1 ? 'el producto que ya no está disponible' : 'los productos que ya no están disponibles'}.
          </div>
        ) : (faltaMonto || faltaUnid) && (
          <div className="t-resumen-nota">
            Cuando llegues al mínimo de tu canal vas a poder enviarlo.
            {faltaMonto && <> El mínimo se mide sobre el neto.</>}
          </div>
        )}

        <div className="t-resumen-pie">
          Al enviarlo entra en nuestro sistema y te respondemos con la confirmación.
          Los precios quedan congelados en el pedido.
        </div>
      </aside>

      <Modal open={confirmar} title="¿Enviamos el pedido?" onClose={() => !enviando && setConfirmar(false)}
             footer={
               <>
                 <button className="t-btn t-btn-ghost" onClick={() => setConfirmar(false)} disabled={enviando}>
                   Todavía no
                 </button>
                 <button className="t-btn t-btn-primary" onClick={enviar} disabled={enviando}>
                   {enviando ? 'Enviando…' : 'Sí, enviar'}
                 </button>
               </>
             }>
        <p>
          Son <b>{num(comprables.length)}</b> producto{comprables.length === 1 ? '' : 's'} ·
          {' '}<b>{num(totales.unidades)}</b> unidades · <b>{money(aPagar)}</b>.
        </p>
        {/* Se repite acá a propósito. Es lo último que se lee antes de que el
            pedido salga, y es la parte que no se puede deshacer solo: si el
            cliente necesitaba la factura y mandó el presupuesto, hay que
            pedírselo al equipo. */}
        <p className={'t-modal-iva' + (conIva ? '' : ' t-modal-iva-off')}>
          <Icon n={conIva ? 'check' : 'info'} s={14}/>
          {conIva
            ? <> Se genera una <b>factura</b> con el {alicuota ? alicuota + '% de IVA' : 'IVA'}
                {cuit ? <> al CUIT <b>{cuit}</b></> : ' a tu CUIT'}.</>
            : <> <b>Presupuesto</b> sin impuestos ni percepciones.</>}
        </p>
        <p className="t-modal-sec">
          Los precios de este pedido quedan congelados como están ahora. Si después
          cambia la lista, tu pedido no cambia.
        </p>
        <p className="t-modal-sec">
          Vas a poder darlo de baja vos mismo mientras no lo hayamos empezado a preparar.
        </p>
      </Modal>
    </div>
  );
};

/* ── Comprobante de envío ──────────────────────────────────────────────
   Se muestra apenas el puente crea el pedido en el sistema interno. El
   número que ve el cliente es el suyo (numero_b2b); el MAY-xxxx interno no
   se le muestra, es el que usa el equipo adentro.                        */
/* Lo que el cliente pidio en el punto 5: "una vez generado el presupuesto,
   brindar informacion para transferencia". Este es exactamente ese momento —
   el pedido ya tiene numero y total, y el mayorista todavia esta mirando la
   pantalla. Hacerlo buscar el CBU en otro lado seria perder al que iba a
   pagar en el acto. */
const PedidoEnviado = ({ resultado, onVerPedidos, onSeguirComprando, emisor, cliente }) => {
  const [pdf, setPdf] = useState(false);
  const toast = useToast();

  const iva = resultado.total_iva != null
    ? Number(resultado.total_iva)
    : (resultado.total_con_iva != null
        ? Number(resultado.total_con_iva) - Number(resultado.total_neto || 0)
        : null);

  /* Lo que hay que transferir. Manda total_a_pagar, que es la columna
     generada de la base (0170): el comprobante de acá y el papel del PDF
     tienen que decir el mismo número, y ese número lo decide la base. */
  const conIva = resultado.con_iva !== false;
  const aPagar = resultado.total_a_pagar != null
    ? Number(resultado.total_a_pagar)
    : (conIva ? Number(resultado.total_con_iva || 0) : Number(resultado.total_neto || 0));
  const cuit = (cliente && cliente.cuit) || '';

  /* enviarPedido devuelve totales pero no las lineas, asi que el PDF se arma
     con el pedido tal como quedo guardado. Es un viaje mas, solo en el click,
     y a cambio el papel dice exactamente lo que hay en la base. */
  const bajarPdf = async () => {
    setPdf(true);
    try {
      const pedidos = await window.B2B_DATA.misPedidos({});
      const p = (pedidos || []).find(x => x.pedido_id === resultado.pedido_id);
      if (!p) throw new Error('No encontramos el pedido para armar el presupuesto.');
      await window.B2B_PDF.presupuesto(p, { emisor, cliente });
    } catch (e) {
      toast.error(e.message || 'No pudimos generar el presupuesto.');
    } finally { setPdf(false); }
  };

  return (
    <div className="t-enviado">
      <div className="t-enviado-icono"><Icon n="check-circle" s={34} c="var(--green)"/></div>
      <h2>Recibimos tu pedido</h2>
      <p className="t-enviado-num">{resultado.numero}</p>
      <p className="t-enviado-txt">
        Ya está en nuestro sistema y el equipo recibió el aviso. Te contactamos para
        confirmarte disponibilidad y fecha de entrega.
      </p>
      {/* El presupuesto muestra un solo número: el que se cobra. Abrirlo en
          neto + IVA + total cuando no hay factura pone al lado del número
          que se paga otro más alto que no se paga, y así es como el
          mayorista termina transfiriendo de más. */}
      <div className="t-enviado-datos">
        <div><span>Unidades</span><b>{num(resultado.unidades)}</b></div>
        {conIva ? (
          <>
            <div><span>Neto</span><b>{money(resultado.total_neto)}</b></div>
            {iva != null && <div><span>IVA</span><b>{money(iva)}</b></div>}
            <div className="es-total"><span>Total con IVA</span><b>{money(aPagar)}</b></div>
          </>
        ) : (
          <div className="es-total"><span>Total</span><b>{money(aPagar)}</b></div>
        )}
      </div>

      <p className={'t-enviado-iva' + (conIva ? '' : ' t-enviado-iva-off')}>
        <Icon n={conIva ? 'file' : 'info'} s={14}/>
        {conIva
          ? <> Se genera la <b>factura</b>{cuit ? <> al CUIT <b>{cuit}</b></> : ''} por
              {' '}<b>{money(aPagar)}</b>.</>
          : <> <b>Presupuesto</b> sin impuestos ni percepciones.</>}
      </p>

      <div className="t-enviado-acciones">
        <button className="t-btn t-btn-primary" onClick={bajarPdf} disabled={pdf}>
          <Icon n="download" s={15}/> {pdf ? 'Preparando…' : 'Descargar presupuesto'}
        </button>
        <button className="t-btn t-btn-ghost" onClick={onVerPedidos}>Ver mis pedidos</button>
        <button className="t-btn t-btn-ghost" onClick={onSeguirComprando}>Seguir comprando</button>
      </div>

      <DatosTransferencia emisor={emisor}/>

      <p className="t-help t-enviado-pie">
        Cuando transfieras, subí el comprobante desde <b>Mis pedidos</b>: le llega
        derecho al equipo.
      </p>
    </div>
  );
};

window.TiendaCarrito = { PantallaCarrito, PedidoEnviado, FilaCarrito, Minimo, IvaTilde };
