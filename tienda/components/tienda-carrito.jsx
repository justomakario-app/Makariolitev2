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
const PantallaCarrito = ({ carrito, onSetCantidad, onGuardarDatos, onEnviar, onSeguirComprando, ocupado }) => {
  const [dir, setDir]       = useState('');
  const [fechaE, setFechaE] = useState('');
  const [notas, setNotas]   = useState('');
  const [confirmar, setConfirmar] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [enviando, setEnviando]   = useState(false);
  const toast = useToast();

  /* Los datos guardados mandan; el estado local es solo el borrador de la
     edición en curso. Cuando el servidor devuelve otra cosa, gana el servidor. */
  useEffect(() => {
    if (!carrito) return;
    setDir(carrito.direccion_entrega || '');
    setFechaE(carrito.fecha_entrega_deseada || '');
    setNotas(carrito.notas || '');
  }, [carrito && carrito.direccion_entrega, carrito && carrito.fecha_entrega_deseada,
      carrito && carrito.notas]);

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

  const minMonto = Number(carrito && carrito.minimo_pedido) || 0;
  const minUnid  = Number(carrito && carrito.minimo_unidades) || 0;
  const faltaMonto = minMonto > 0 && totales.neto < minMonto;
  const faltaUnid  = minUnid  > 0 && totales.unidades < minUnid;
  const puedeEnviar = comprables.length > 0 && caidos.length === 0
                      && !faltaMonto && !faltaUnid && !ocupado;

  const hayCambios =
    dir !== (carrito?.direccion_entrega || '') ||
    fechaE !== (carrito?.fecha_entrega_deseada || '') ||
    notas !== (carrito?.notas || '');

  const guardar = async () => {
    setGuardando(true);
    try {
      await onGuardarDatos({ direccion_entrega: dir, fecha_entrega_deseada: fechaE, notas });
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
        await onGuardarDatos({ direccion_entrega: dir, fecha_entrega_deseada: fechaE, notas });
      }
      await onEnviar();
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

          <label className="t-label" htmlFor="ca-fecha">¿Para cuándo lo necesitás? <span className="t-opt">(opcional)</span></label>
          <input id="ca-fecha" className="t-input" type="date" value={fechaE}
                 onChange={e => setFechaE(e.target.value)}/>
          <div className="t-help">Es una preferencia, no una fecha confirmada: te la confirmamos al responderte.</div>

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
        <div className="t-resumen-linea t-resumen-suave"><span>IVA</span><span>{money(totales.iva)}</span></div>
        <div className="t-resumen-total"><span>Total</span><b>{money(totales.total)}</b></div>

        {/* El mínimo del canal se mide SIN IVA — es lo que valida el backend
            ("El minimo de compra es X (sin IVA)"). Se aclara acá porque justo
            arriba está el total CON IVA: sin la aclaración, el cliente ve un
            total más alto que el mínimo y no entiende por qué le falta. */}
        <Minimo etiqueta="Monto sin IVA" actual={totales.neto} requerido={minMonto} formato={money}/>
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
            {faltaMonto && <> El mínimo se mide sobre el neto, sin IVA.</>}
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
          {' '}<b>{num(totales.unidades)}</b> unidades · <b>{money(totales.total)}</b> con IVA.
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
const PedidoEnviado = ({ resultado, onVerPedidos, onSeguirComprando }) => (
  <div className="t-enviado">
    <div className="t-enviado-icono"><Icon n="check-circle" s={34} c="var(--green)"/></div>
    <h2>Recibimos tu pedido</h2>
    <p className="t-enviado-num">{resultado.numero}</p>
    <p className="t-enviado-txt">
      Ya está en nuestro sistema y el equipo recibió el aviso. Te contactamos para
      confirmarte disponibilidad y fecha de entrega.
    </p>
    <div className="t-enviado-datos">
      <div><span>Unidades</span><b>{num(resultado.unidades)}</b></div>
      <div><span>Neto</span><b>{money(resultado.total_neto)}</b></div>
    </div>
    <div className="t-enviado-acciones">
      <button className="t-btn t-btn-primary" onClick={onVerPedidos}>Ver mis pedidos</button>
      <button className="t-btn t-btn-ghost" onClick={onSeguirComprando}>Seguir comprando</button>
    </div>
  </div>
);

window.TiendaCarrito = { PantallaCarrito, PedidoEnviado, FilaCarrito, Minimo };
