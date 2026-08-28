/* ══ TIENDA · MIS PEDIDOS ═════════════════════════════════════════════════
   El historial del cliente y la baja temprana.

   Los rótulos de estado son EXACTAMENTE los mismos que el panel interno le
   muestra al equipo en la columna "ve el cliente" (b2b-pedidos-tab.jsx). Si
   alguien cambia uno de los dos lados, el vendedor y el mayorista pasan a
   hablar de cosas distintas por teléfono sobre el mismo pedido.

   El estado lo mueve el admin en Ventas > Mayoristas y el trigger
   b2b_tg_sync_estado lo espeja hasta acá. La tienda nunca lo empuja al
   revés: el único cambio de estado que sale de esta pantalla es la
   anulación, y el backend solo la acepta mientras el pedido siga en
   'cotizacion' del lado interno — o sea, mientras nadie lo haya empezado
   a preparar.

   Acá viven además dos cosas que pidió el cliente (migración 0167):
     · "Descargar presupuesto" — arma el PDF en el browser con lo que ya
       está en pantalla. pdfmake se baja recién en ese click: son ~2 MB que
       el mayorista no tiene por qué pagar solo por mirar sus pedidos.
     · "Adjuntar comprobante de pago" — sube el archivo al bucket privado y
       le avisa al equipo por mail. Sacarlo de la lista es un borrado
       LÓGICO: un pago que el equipo ya miró no se puede evaporar.
   ═══════════════════════════════════════════════════════════════════════ */

const ESTADO_CLIENTE = {
  enviado:        { label: 'Enviado',            bg: '#fef3c7', fg: '#92400e',
                    ayuda: 'Lo recibimos. Estamos revisando disponibilidad y te confirmamos.' },
  confirmado:     { label: 'Confirmado',         bg: '#dbeafe', fg: '#1d4ed8',
                    ayuda: 'Confirmado. Entra a fabricación según el cronograma.' },
  en_produccion:  { label: 'En producción',      bg: '#ede9fe', fg: '#6d28d9',
                    ayuda: 'Se está fabricando.' },
  listo_despacho: { label: 'Listo p/ despacho',  bg: '#ccfbf1', fg: '#0f766e',
                    ayuda: 'Terminado y embalado, esperando el despacho.' },
  despachado:     { label: 'Despachado',         bg: '#e6f7ec', fg: '#15803d',
                    ayuda: 'Salió de planta.' },
  facturado:      { label: 'Facturado',          bg: '#e6f7ec', fg: '#15803d',
                    ayuda: 'Facturado.' },
  anulado:        { label: 'Anulado',            bg: '#fee2e2', fg: '#b91c1c',
                    ayuda: 'Este pedido quedó sin efecto.' },
};

const Chip = ({ estado }) => {
  const e = ESTADO_CLIENTE[estado] || { label: estado || '—', bg: 'var(--paper-dim)', fg: 'var(--ink-soft)' };
  return <span className="t-chip-estado" style={{ background: e.bg, color: e.fg }}>{e.label}</span>;
};

/* ── Los comprobantes que ya mandó ────────────────────────────────
   El bucket es privado: para ver el archivo hay que pedirle al backend una
   URL firmada que dura 10 minutos. Se pide recién en el click y no al armar
   la lista, porque de la otra forma bastaría con dejar la pestaña abierta
   un rato para que todos los links vencieran solos. */
const ListaComprobantes = ({ comprobantes, onQuitar, quitandoId }) => {
  const [abriendo, setAbriendo] = useState(null);
  const toast = useToast();

  const abrir = async (c) => {
    setAbriendo(c.id);
    try {
      const url = await window.B2B_DATA.comprobanteUrl(c.path);
      /* Un window.open después del await lo frena el bloqueador de pop-ups,
         porque para el browser ya no es el click. Un <a target="_blank"> que
         se clickea solo, no. */
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (e) {
      toast.error(e.message || 'No pudimos abrir el comprobante.');
    } finally { setAbriendo(null); }
  };

  if (!comprobantes || !comprobantes.length) return null;

  return (
    <ul className="t-comprobantes">
      {comprobantes.map(c => (
        <li key={c.id} className="t-comprobante">
          <span className="t-comprobante-ico">
            <Icon n={c.mime === 'application/pdf' ? 'file' : 'clip'} s={15} c="var(--ink-muted)"/>
          </span>
          <div className="t-comprobante-txt">
            <b>{c.nombre || 'Comprobante'}</b>
            <span>
              {fechaHora(c.created_at)}
              {c.monto != null ? ' · ' + money(c.monto) : ''}
              {c.nota ? ' · ' + c.nota : ''}
            </span>
          </div>
          <button className="t-btn t-btn-ghost t-btn-mini" onClick={() => abrir(c)}
                  disabled={abriendo === c.id}>
            {abriendo === c.id ? 'Abriendo…' : 'Ver'}
          </button>
          <button className="t-icon-btn" onClick={() => onQuitar(c)}
                  disabled={quitandoId === c.id} title="Quitar de la lista"
                  aria-label="Quitar comprobante">
            <Icon n="trash" s={15}/>
          </button>
        </li>
      ))}
    </ul>
  );
};

/* ── Adjuntar el comprobante ──────────────────────────────────────────
   Son dos viajes que tienen que salir los dos: primero el archivo al bucket
   privado, después la fila en b2b_comprobante. Si el segundo falla queda un
   archivo huérfano en storage — molesto pero inofensivo, y preferible a la
   alternativa (una fila que apunta a un archivo que nunca subió, que en el
   panel se ve como un pago que no se puede abrir).

   Se monta y se desmonta con el pedido, así que no hace falta limpiar el
   formulario a mano: cada vez que se abre, arranca en cero. */
const ModalComprobante = ({ pedido, clienteId, onCerrar, onListo }) => {
  const [archivo, setArchivo] = useState(null);
  const [monto, setMonto]     = useState('');
  const [nota, setNota]       = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const [err, setErr]         = useState(null);
  const toast = useToast();

  const MAX   = window.B2B_DATA.COMPROBANTE_MAX_BYTES;
  const MIMES = window.B2B_DATA.COMPROBANTE_MIMES;

  /* Se valida acá también, aunque el backend lo valide igual: enterarse de
     que el archivo pesa 30 MB recién después de esperar la subida entera por
     una red de celular es una forma innecesaria de hacer perder el tiempo. */
  const elegir = (e) => {
    const f = e.target.files && e.target.files[0];
    setErr(null);
    if (!f) { setArchivo(null); return; }
    if (MIMES.indexOf(f.type) < 0) {
      setArchivo(null); setErr('Solo aceptamos JPG, PNG o PDF.'); return;
    }
    if (f.size > MAX) {
      setArchivo(null);
      setErr('El archivo pesa ' + (f.size / 1048576).toFixed(1) + ' MB y el límite son 10 MB.');
      return;
    }
    setArchivo(f);
  };

  const enviar = async () => {
    if (!archivo) return;
    setSubiendo(true); setErr(null);
    try {
      const meta = await window.B2B_DATA.subirComprobante({
        cliente_id: clienteId, pedido_id: pedido.pedido_id, file: archivo });
      await window.B2B_DATA.adjuntarComprobante({
        pedido_id: pedido.pedido_id,
        path: meta.path, mime: meta.mime, size_bytes: meta.size_bytes,
        nombre: meta.nombre,
        /* El monto se tipea como acá se escribe la plata: "12.500,50". El
           backend lo castea a numeric, que espera punto decimal. */
        monto: monto.trim() ? monto.trim().replace(/\./g, '').replace(',', '.') : null,
        nota: nota.trim() || null });
      toast.success('Recibimos tu comprobante. Lo revisamos y te confirmamos.');
      await onListo();
    } catch (e) {
      setErr(e.message || 'No pudimos adjuntar el comprobante.');
    } finally { setSubiendo(false); }
  };

  const total = pedido.total_con_iva != null ? pedido.total_con_iva : pedido.total_neto;

  return (
    <Modal open title="Adjuntar comprobante de pago"
           onClose={() => !subiendo && onCerrar()}
           footer={
             <>
               <button className="t-btn t-btn-ghost" onClick={onCerrar} disabled={subiendo}>
                 Cancelar
               </button>
               <button className="t-btn t-btn-primary" onClick={enviar} disabled={subiendo || !archivo}>
                 {subiendo ? 'Subiendo…' : 'Adjuntar'}
               </button>
             </>
           }>
      <p>
        Vas a adjuntar el comprobante del pedido <b>{pedido.numero}</b> por <b>{money(total)}</b>.
        Lo recibe el equipo y lo revisa. El pedido no cambia de estado solo por esto.
      </p>

      <label className={'t-drop' + (archivo ? ' es-listo' : '')}>
        <input type="file" accept="image/jpeg,image/png,application/pdf"
               onChange={elegir} disabled={subiendo}/>
        <Icon n={archivo ? 'file' : 'upload'} s={22} c={archivo ? 'var(--green)' : 'var(--ink-muted)'}/>
        <span className="t-drop-txt">
          {archivo ? <b>{archivo.name}</b> : <b>Elegí el archivo</b>}
          <span>
            {archivo
              ? (archivo.size / 1024).toFixed(0) + ' KB · Tocá de nuevo para cambiarlo'
              : 'Foto o PDF de la transferencia · JPG, PNG o PDF, hasta 10 MB'}
          </span>
        </span>
      </label>

      <div className="t-fila-2">
        <div>
          <label className="t-label" htmlFor="cp-monto">
            Monto transferido <span className="t-opt">(opcional)</span>
          </label>
          <input id="cp-monto" className="t-input" inputMode="decimal" value={monto}
                 onChange={e => setMonto(e.target.value)} disabled={subiendo}
                 placeholder="Si pagaste una parte, cuánto"/>
        </div>
        <div>
          <label className="t-label" htmlFor="cp-nota">
            Nota <span className="t-opt">(opcional)</span>
          </label>
          <input id="cp-nota" className="t-input" value={nota} maxLength={300}
                 onChange={e => setNota(e.target.value)} disabled={subiendo}
                 placeholder="N° de operación, banco, etc."/>
        </div>
      </div>

      {err && <Aviso tipo="error">{err}</Aviso>}
    </Modal>
  );
};

/* ── Un pedido ─────────────────────────────────────────────────────────── */
const Pedido = ({ p, onAnular, anulando, onRepetir, onAdjuntar,
                  onQuitarComprobante, quitandoId, emisor, cliente }) => {
  const [abierto, setAbierto] = useState(false);
  const [pdf, setPdf] = useState(false);
  const toast = useToast();
  const info = ESTADO_CLIENTE[p.estado] || null;
  /* La baja solo se ofrece mientras nadie lo tocó. Después la hace el equipo:
     mostrar el botón igual y que el backend lo rebote sería peor que no tenerlo. */
  const sePuedeAnular = p.estado === 'enviado';
  /* Un pedido dado de baja no se paga: ni comprobante ni datos bancarios. */
  const sigueVivo = p.estado !== 'anulado';
  const comprobantes = p.comprobantes || [];

  /* El PDF se arma con lo que ya está en pantalla: el mismo pedido que el
     backend devolvió, sin volver a pedir nada. Lo único que viaja en el
     click es pdfmake desde el CDN, y una sola vez por pestaña. */
  const bajarPdf = async () => {
    setPdf(true);
    try {
      await window.B2B_PDF.presupuesto(p, { emisor, cliente });
    } catch (e) {
      toast.error(e.message || 'No pudimos generar el presupuesto. Proba de nuevo.');
    } finally { setPdf(false); }
  };

  return (
    <div className="t-pedido">
      <button className="t-pedido-head" onClick={() => setAbierto(a => !a)}
              aria-expanded={abierto}>
        <Icon n={abierto ? 'chev-down' : 'chev-right'} s={16} c="var(--ink-muted)"/>
        <div className="t-pedido-num">
          <b>{p.numero || '—'}</b>
          <span>{fechaHora(p.enviado_at)}</span>
        </div>
        <Chip estado={p.estado}/>
        <div className="t-pedido-tot">
          <span>{num(p.unidades)} u.</span>
          <b>{money(p.total_neto)}</b>
        </div>
      </button>

      {abierto && (
        <div className="t-pedido-cuerpo">
          {info && info.ayuda && <div className="t-pedido-ayuda">{info.ayuda}</div>}

          {/* El numero de factura lo escribe el equipo despues de emitirla
              afuera (b2b_rpc_admin_facturar_pedido). El comprobante en si NO
              sale de este sistema: se manda por mail o se entrega con la
              mercaderia. Mostrar el numero acá es lo que le permite al
              cliente cruzar "mi pedido B2B-00012" con la factura que tiene
              en la mano sin llamar por telefono. */}
          {p.factura_nro && (
            <div className="t-pedido-factura">
              <Icon n="ticket" s={14} c="var(--green)"/>
              <span>Facturado con el comprobante <b>{p.factura_nro}</b></span>
            </div>
          )}

          {p.fecha_entrega_deseada && (
            <div className="t-pedido-dato">
              Entrega pedida para <b>{fecha(p.fecha_entrega_deseada)}</b>
            </div>
          )}

          <table className="t-tabla">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="t-num">Cantidad</th>
                <th className="t-num">Unitario</th>
                <th className="t-num">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {(p.items || []).map(i => (
                <tr key={i.sku}>
                  <td className="t-mono">{i.sku}</td>
                  <td className="t-num">{num(i.cantidad)}</td>
                  <td className="t-num">{money(i.precio_unitario)}</td>
                  <td className="t-num">{money(i.subtotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="3">Neto</td>
                <td className="t-num">{money(p.total_neto)}</td>
              </tr>
              {p.total_con_iva != null && (
                <tr className="t-fila-suave">
                  <td colSpan="3">IVA</td>
                  <td className="t-num">{money(Number(p.total_con_iva) - Number(p.total_neto || 0))}</td>
                </tr>
              )}
              {p.total_con_iva != null && (
                <tr>
                  <td colSpan="3">Total</td>
                  <td className="t-num"><b>{money(p.total_con_iva)}</b></td>
                </tr>
              )}
            </tfoot>
          </table>

          {/* Cómo pagarlo, y con qué se pagó. Solo mientras el pedido siga
              vivo: en uno anulado esto es ruido que confunde. */}
          {sigueVivo && <DatosTransferencia emisor={emisor} compacto/>}

          {sigueVivo && comprobantes.length > 0 && (
            <div className="t-pedido-pagos">
              <span className="t-label-mini">
                {comprobantes.length === 1 ? 'Comprobante adjuntado' : 'Comprobantes adjuntados'}
              </span>
              <ListaComprobantes comprobantes={comprobantes} quitandoId={quitandoId}
                                 onQuitar={c => onQuitarComprobante(p, c)}/>
            </div>
          )}

          <div className="t-pedido-pie">
            <span className="t-help">Precios congelados al momento de enviarlo.</span>
            <button className="t-btn t-btn-ghost" onClick={bajarPdf} disabled={pdf}>
              <Icon n="download" s={14}/> {pdf ? 'Preparando…' : 'Descargar presupuesto'}
            </button>
            {sigueVivo && (
              <button className="t-btn t-btn-ghost" onClick={() => onAdjuntar(p)}>
                <Icon n="clip" s={14}/>{' '}
                {comprobantes.length ? 'Adjuntar otro comprobante' : 'Adjuntar comprobante de pago'}
              </button>
            )}
            {/* "Repetir" se ofrece en CUALQUIER estado, incluso anulado: si un
                pedido se cayó, volver a cargarlo es justamente lo que el
                cliente quiere hacer. Lo que no se puede repetir lo filtra el
                backend producto por producto y lo informa. */}
            <button className="t-btn t-btn-ghost" onClick={() => onRepetir(p)}>
              <Icon n="refresh" s={14}/> Repetir este pedido
            </button>
            {sePuedeAnular && (
              <button className="t-btn t-btn-peligro" disabled={anulando}
                      onClick={() => onAnular(p)}>
                {anulando ? 'Anulando…' : 'Dar de baja'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/* ══ Pantalla ═══════════════════════════════════════════════════════════ */
/* onRepetido() SOLO recarga el carrito del shell; onIrCarrito() navega. Están
   separados a propósito: si recargar navegara, esta pantalla se desmontaría y
   se llevaría puesto el modal que explica qué no se pudo repetir — justo lo
   que el cliente tiene que leer. */
const PantallaPedidos = ({ recargarSenal, onIrCatalogo, onIrCarrito,
                          carritoUnidades = 0, onRepetido, cuenta }) => {
  const [pedidos, setPedidos] = useState(null);
  const [error, setError]     = useState(null);
  const [aAnular, setAAnular] = useState(null);
  const [motivo, setMotivo]   = useState('');
  const [anulando, setAnulando] = useState(false);
  /* Repetir tiene tres momentos: se pregunta (aRepetir), se ejecuta
     (repitiendo) y — solo si algo no entró tal cual — se muestra el saldo
     (resultado). Si salió todo limpio no hay tercer paso: va derecho al
     carrito, que es donde el cliente quería llegar. */
  const [aRepetir, setARepetir]   = useState(null);
  const [modo, setModo]           = useState('agregar');
  const [repitiendo, setRepitiendo] = useState(false);
  const [resultado, setResultado] = useState(null);
  /* Comprobantes: cuál pedido está adjuntando, y cuál se está quitando. */
  const [aAdjuntar, setAAdjuntar] = useState(null);
  const [quitandoId, setQuitandoId] = useState(null);
  const toast = useToast();

  /* De la cuenta salen las dos cosas que esta pantalla no sabe sola: a qué
     cliente pertenece la carpeta del comprobante, y con qué membrete y qué
     datos bancarios se arma el presupuesto. */
  const emisor    = (cuenta && cuenta.emisor) || null;
  const cliente   = (cuenta && cuenta.cliente) || null;
  const clienteId = cliente && cliente.id;

  const cargar = useCallback(async () => {
    try {
      const data = await window.B2B_DATA.misPedidos({});
      setPedidos(data); setError(null);
    } catch (e) {
      setPedidos([]); setError(e.message || 'No se pudieron cargar tus pedidos.');
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar, recargarSenal]);

  const anular = async () => {
    setAnulando(true);
    try {
      await window.B2B_DATA.anularPedido({ pedido_id: aAnular.pedido_id, motivo: motivo.trim() });
      toast.success('El pedido quedó dado de baja.');
      setAAnular(null); setMotivo('');
      await cargar();
    } catch (e) {
      /* 0A000 = el admin ya lo tocó entre que se abrió el modal y se
         confirmó. No es un error del cliente: hay que explicarlo. */
      const msg = e.code === '0A000'
        ? 'Ya empezamos a preparar este pedido, así que no se puede dar de baja solo. Escribinos y lo vemos.'
        : (e.message || 'No se pudo dar de baja el pedido.');
      toast.error(msg);
      setAAnular(null);
      await cargar();
    } finally { setAnulando(false); }
  };

  const repetir = async () => {
    setRepitiendo(true);
    try {
      const r = await window.B2B_DATA.repetirPedido({ pedido_id: aRepetir.pedido_id, modo });
      const omitidos  = (r && r.omitidos)  || [];
      const ajustados = (r && r.ajustados) || [];
      setARepetir(null);

      /* Se recarga SIEMPRE, incluso si no entró ninguna línea: en modo
         "reemplazar" el backend vació el carrito antes de intentar cargar, así
         que el shell estaría mostrando un carrito que ya no existe. */
      await onRepetido();

      if (!r || !r.agregados) {
        /* Caso feo pero real: el pedido era viejo y hoy no queda nada de eso
           publicado. Mejor decirlo que dejarlo yendo a un carrito vacío. */
        setResultado({ ...r, omitidos, ajustados, vacio: true });
        return;
      }

      if (omitidos.length || ajustados.length) {
        setResultado({ ...r, omitidos, ajustados });
      } else {
        toast.success(`Cargamos las ${r.agregados} líneas de ${r.origen} en tu pedido.`);
        onIrCarrito();
      }
    } catch (e) {
      toast.error(e.message || 'No se pudo repetir el pedido.');
      setARepetir(null);
    } finally { setRepitiendo(false); }
  };

  /* Sacarlo de la vista es un borrado logico del lado del backend: el equipo
     lo sigue viendo si tiene que auditar un pago. Por eso el texto no promete
     que "se elimina", promete que sale de la lista. */
  const quitarComprobante = async (pedido, c) => {
    setQuitandoId(c.id);
    try {
      await window.B2B_DATA.borrarComprobante({ comprobante_id: c.id });
      toast.success('Lo sacamos de la lista.');
      await cargar();
    } catch (e) {
      toast.error(e.message || 'No pudimos quitar el comprobante.');
    } finally { setQuitandoId(null); }
  };

  if (pedidos === null) return <Spinner texto="Cargando tus pedidos…"/>;

  if (error) return <Aviso tipo="error" titulo="No pudimos cargar tus pedidos">{error}</Aviso>;

  if (!pedidos.length) {
    return (
      <Vacio icono="history" titulo="Todavía no hiciste ningún pedido">
        <button className="t-btn t-btn-primary" onClick={onIrCatalogo}>Ver el catálogo</button>
      </Vacio>
    );
  }

  return (
    <div className="t-pedidos">
      {pedidos.map(p => (
        <Pedido key={p.pedido_id} p={p} anulando={anulando && aAnular && aAnular.pedido_id === p.pedido_id}
                emisor={emisor} cliente={cliente} quitandoId={quitandoId}
                onAnular={x => { setAAnular(x); setMotivo(''); }}
                onAdjuntar={x => setAAdjuntar(x)}
                onQuitarComprobante={quitarComprobante}
                onRepetir={x => { setARepetir(x); setModo(carritoUnidades > 0 ? 'agregar' : 'reemplazar'); }}/>
      ))}

      {/* Se monta solo cuando hace falta: así el formulario arranca limpio en
          cada pedido, sin tener que acordarse de vaciarlo. */}
      {aAdjuntar && (
        <ModalComprobante pedido={aAdjuntar} clienteId={clienteId}
                          onCerrar={() => setAAdjuntar(null)}
                          onListo={async () => { setAAdjuntar(null); await cargar(); }}/>
      )}

      <Modal open={!!aAnular} title="Dar de baja el pedido"
             onClose={() => !anulando && setAAnular(null)}
             footer={
               <>
                 <button className="t-btn t-btn-ghost" onClick={() => setAAnular(null)} disabled={anulando}>
                   No, dejarlo
                 </button>
                 <button className="t-btn t-btn-peligro" onClick={anular} disabled={anulando}>
                   {anulando ? 'Anulando…' : 'Sí, darlo de baja'}
                 </button>
               </>
             }>
        <p>
          Vas a dar de baja el pedido <b>{aAnular && aAnular.numero}</b> por{' '}
          <b>{aAnular && money(aAnular.total_neto)}</b>. No se puede deshacer:
          si después lo querés, hay que cargarlo de nuevo.
        </p>
        <label className="t-label" htmlFor="an-motivo">Motivo <span className="t-opt">(opcional)</span></label>
        <input id="an-motivo" className="t-input" value={motivo} onChange={e => setMotivo(e.target.value)}
               placeholder="Nos sirve para saber qué pasó"/>
      </Modal>

      {/* ── Repetir: se pregunta antes ─────────────────────────────────── */}
      <Modal open={!!aRepetir} title="Repetir este pedido"
             onClose={() => !repitiendo && setARepetir(null)}
             footer={
               <>
                 <button className="t-btn t-btn-ghost" onClick={() => setARepetir(null)} disabled={repitiendo}>
                   Cancelar
                 </button>
                 <button className="t-btn t-btn-primary" onClick={repetir} disabled={repitiendo}>
                   {repitiendo ? 'Cargando…' : 'Cargar en mi pedido'}
                 </button>
               </>
             }>
        <p>
          Vamos a cargar los productos de <b>{aRepetir && aRepetir.numero}</b> en tu pedido actual.
          Todavía no se envía nada: podés revisarlo y cambiarlo antes.
        </p>
        <Aviso tipo="info">
          Se cargan a los <b>precios de hoy</b>, que pueden no ser los de aquel pedido.
          Si algo dejó de estar disponible, te lo avisamos y no lo incluimos.
        </Aviso>

        {carritoUnidades > 0 && (
          <>
            <label className="t-label">Ya tenés {num(carritoUnidades)} unidades cargadas. ¿Qué hacemos?</label>
            <div className="t-radios">
              <label className="t-radio">
                <input type="radio" name="rep-modo" value="agregar" checked={modo === 'agregar'}
                       onChange={() => setModo('agregar')}/>
                <span>Sumarlo a lo que ya tengo</span>
              </label>
              <label className="t-radio">
                <input type="radio" name="rep-modo" value="reemplazar" checked={modo === 'reemplazar'}
                       onChange={() => setModo('reemplazar')}/>
                <span>Vaciar y dejar solo este pedido</span>
              </label>
            </div>
          </>
        )}
      </Modal>

      {/* ── Repetir: el saldo, cuando algo no entró tal cual ───────────── */}
      <Modal open={!!resultado} title={resultado && resultado.vacio ? 'No pudimos repetirlo' : 'Cargado, con cambios'}
             onClose={() => setResultado(null)}
             footer={
               <>
                 <button className="t-btn t-btn-ghost" onClick={() => setResultado(null)}>Cerrar</button>
                 {resultado && !resultado.vacio && (
                   <button className="t-btn t-btn-primary"
                           onClick={() => { setResultado(null); onIrCarrito(); }}>
                     Ver mi pedido
                   </button>
                 )}
               </>
             }>
        {resultado && resultado.vacio ? (
          <p>
            Ninguno de los productos de <b>{resultado.origen}</b> está disponible hoy.
            Escribinos y lo vemos juntos.
          </p>
        ) : (
          <p>
            Cargamos <b>{resultado && resultado.agregados}</b> de las líneas de{' '}
            <b>{resultado && resultado.origen}</b> en tu pedido. Con estos cambios:
          </p>
        )}

        {resultado && resultado.omitidos.length > 0 && (
          <>
            <label className="t-label">No los incluimos</label>
            <ul className="t-lista-motivos">
              {resultado.omitidos.map(o => (
                <li key={o.sku}><b className="t-mono">{o.sku}</b> — {o.motivo}</li>
              ))}
            </ul>
          </>
        )}

        {resultado && resultado.ajustados.length > 0 && (
          <>
            <label className="t-label">Les cambiamos la cantidad</label>
            <ul className="t-lista-motivos">
              {resultado.ajustados.map(a => (
                <li key={a.sku}>
                  <b className="t-mono">{a.sku}</b> — pediste {num(a.pedida)}, cargamos{' '}
                  <b>{num(a.cargada)}</b>: {a.motivo}
                </li>
              ))}
            </ul>
          </>
        )}
      </Modal>
    </div>
  );
};

window.TiendaPedidos = { PantallaPedidos, ESTADO_CLIENTE, Chip };
