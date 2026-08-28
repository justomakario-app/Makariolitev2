/* ══ TIENDA MAYORISTA — PEDIDOS
   Los pedidos que entran por la tienda NO se cargan a mano: al enviarlos el
   cliente, b2b_rpc_enviar_pedido los materializa en pedidos_mayoristas y
   dispara la notificación interna. Esta pantalla es la vista de esos
   pedidos desde el lado de adentro.

   ── De dónde sale cada cosa ──
   • CABECERA (b2b_rpc_admin_pedidos): lo propio de la tienda — número B2B,
     quién lo mandó, de qué canal, cuándo, total y unidades.
   • DETALLE (rpc_mayoristas_list_pedidos): los ítems ya viven en
     pedidos_mayoristas_items, que es lo que el admin venía usando. Se
     cruzan por pedido_mayorista_id en vez de duplicar el detalle en una
     RPC nueva: un solo lugar de verdad para los renglones del pedido.
     Esa RPC es owner/admin; un usuario 'ventas' ve la cabecera y no el
     detalle, y la pantalla lo dice en vez de romperse.

   ── El estado se cambia en UN solo lugar ──
   El avance lo hace rpc_mayoristas_update_estado (OWNER-ONLY), igual que
   siempre, y el trigger b2b_tg_sync_estado lo espeja al pedido de la
   tienda. Nunca al revés. Es la lección de 0150: un espejo que además
   maneja al maestro termina arrastrando cosas que nadie pidió.

   ── La excepción: facturar ──
   'facturado' es el único estado que NO existe del lado del admin, porque
   el sistema no tiene tabla de facturas ni integración con ARCA. Lo que se
   emite se emite afuera; acá se anota el número para que el cliente lo vea
   en "Mis pedidos". Por eso facturar es la única transición que se decide
   de este lado (b2b_rpc_admin_facturar_pedido) y por eso un pedido
   facturado se ve como estado_admin "Despachado" + factura cargada: son
   dos caras distintas del mismo pedido, no una contradicción.

   Pide que el pedido esté despachado — facturar algo que todavía no salió
   del taller es al revés — y se puede volver a llamar sobre uno ya
   facturado, que es como se corrige un número mal tipeado. Desde 0161,
   mover el estado del admin hacia atrás ya no lo desfactura.

   ── Lo que se abre al desplegar un pedido ──
   B2BDetallePedido, al final del archivo: los renglones, los comprobantes
   de pago que subió el cliente y los dos PDF (presupuesto para el cliente,
   hoja sin precios para el taller). Los comprobantes se piden recién ahí;
   en la fila alcanza con el clip, que sale del contador que ya trae
   b2b_v_pedidos_admin.

   Mobile: los PDF se ABREN en vez de descargarse. En el celular un
   `download` aterriza en la carpeta de Descargas sin decir nada y parece
   que el botón no anduvo.
   ══ */

/* El membrete de los PDF y los datos para transferir salen de
   company_settings. Se piden UNA sola vez por sesión y no una vez por
   pedido: son los mismos para todos y no cambian mientras alguien mira la
   tabla. Se guarda la promesa, no el resultado, para que dos clicks
   seguidos esperen la misma llamada en vez de disparar dos. Si falla se
   borra, así el próximo intento vuelve a probar. */
let b2bEmisorPromesa = null;
function b2bEmisor() {
  if (!b2bEmisorPromesa) {
    b2bEmisorPromesa = window.ADMIN_DATA.getCompanySettings()
      .then(cs => window.B2B_PDF.emisorDeSettings(cs))
      .catch(e => { b2bEmisorPromesa = null; throw e; });
  }
  return b2bEmisorPromesa;
}

/* Estado interno → cómo se llama acá y qué ve el cliente en la tienda
   (b2b_fn_map_estado). Mostrar las dos caras evita el malentendido de
   creer que el cliente ve la misma palabra que el admin. */
const B2B_ESTADOS = [
  { id:'cotizacion',    label:'Recibido',            cliente:'Enviado',          bg:'#fef3c7', fg:'#92400e' },
  { id:'confirmado',    label:'Confirmado',          cliente:'Confirmado',       bg:'#dbeafe', fg:'#1d4ed8' },
  { id:'en_produccion', label:'En producción',       cliente:'En producción',    bg:'#ede9fe', fg:'#6d28d9' },
  { id:'listo',         label:'Listo para despacho', cliente:'Listo p/ despacho',bg:'#ccfbf1', fg:'#0f766e' },
  { id:'entregado',     label:'Despachado',          cliente:'Despachado',       bg:'#e6f7ec', fg:'#15803d' },
  { id:'cancelado',     label:'Anulado',             cliente:'Anulado',          bg:'#fee2e2', fg:'#b91c1c' },
];

/* buscarInicial: número de pedido que viene del aviso de la campanita. Se usa
   solo como valor inicial del buscador — después el filtro es del usuario. */
function B2BPedidosTab({ buscarInicial }) {
  const toast = useToast();
  const role    = (window.MOCK?.user?.role || '').toLowerCase();
  const isOwner = role === 'owner';
  const isAdmin = role === 'owner' || role === 'admin';
  /* 9 columnas fijas + Factura (admin) + Avanzar (dueño). Se calcula una vez
     porque el colSpan de la fila expandida y el del "sin resultados" tienen
     que seguirla; hardcodearlo ya había dejado la tabla corrida. */
  const nCols = 9 + (isAdmin ? 1 : 0) + (isOwner ? 1 : 0);

  const [pedidos,  setPedidos]  = useState([]);
  const [detalles, setDetalles] = useState({});   // { pedido_mayorista_id: [items] }
  const [sinDetalle, setSinDetalle] = useState(false);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [filtro,   setFiltro]   = useState('');   // '' = todos
  const [q,        setQ]        = useState(buscarInicial || '');
  const [abierto,  setAbierto]  = useState(null); // b2b_pedido_id expandido
  const [cambiando, setCambiando] = useState(null);
  const [facturando, setFacturando] = useState(null); // pedido abierto en el modal de factura

  const reload = async () => {
    setLoading(true); setError(null);
    try {
      const cab = await window.B2B_DATA.adminPedidos({});
      setPedidos(cab || []);

      /* El detalle es un extra: si el rol no puede leerlo, la cabecera igual
         se muestra. Por eso va en su propio try y no tumba la pantalla. */
      try {
        const pm = await window.ADMIN_DATA.listPedidosMayoristas({});
        const idx = {};
        (pm || []).forEach(p => { idx[p.id] = p.items || []; });
        setDetalles(idx);
        setSinDetalle(false);
      } catch (e) {
        setDetalles({});
        setSinDetalle(true);
      }
    } catch (err) {
      const msg = err?.message || 'Error desconocido';
      setError(msg); toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  const cambiarEstado = async (p, estado) => {
    if (cambiando) return;
    setCambiando(p.b2b_pedido_id);
    try {
      await window.ADMIN_DATA.updateEstadoPedidoMayorista({
        pedido_id: p.pedido_mayorista_id, estado,
      });
      const e = B2B_ESTADOS.find(x => x.id === estado);
      toast.success(`${p.numero_b2b || p.numero_pedido} → ${e ? e.label : estado}`);
      await reload();
    } catch (err) {
      toast.error(err?.message || 'No se pudo cambiar el estado');
    } finally {
      setCambiando(null);
    }
  };

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (pedidos || []).filter(p => {
      /* Los dos filtros con guion bajo miran el estado de la TIENDA, no el del
         admin: facturado no existe del otro lado. */
      if (filtro === '_facturado') {
        if (p.estado_tienda !== 'facturado') return false;
      } else if (filtro === '_por_facturar') {
        if (p.estado_tienda !== 'despachado') return false;
      } else if (filtro && p.estado_admin !== filtro) {
        return false;
      }
      if (!t) return true;
      return (p.numero_b2b || '').toLowerCase().includes(t)
          || (p.numero_pedido || '').toLowerCase().includes(t)
          || (p.cliente || '').toLowerCase().includes(t)
          || (p.comprador || '').toLowerCase().includes(t)
          || (p.comprador_email || '').toLowerCase().includes(t);
    });
  }, [pedidos, filtro, q]);

  const conteo = useMemo(() => {
    const c = {};
    (pedidos || []).forEach(p => { c[p.estado_admin] = (c[p.estado_admin] || 0) + 1; });
    return c;
  }, [pedidos]);

  /* El filtro de arriba cuenta por estado del admin; "Facturados" es aparte
     porque vive en la otra cara del pedido y si no, no habría manera de
     encontrar lo que falta facturar en una lista larga. */
  const facturados = useMemo(
    () => (pedidos || []).filter(p => p.estado_tienda === 'facturado').length,
    [pedidos]
  );
  const porFacturar = useMemo(
    () => (pedidos || []).filter(p => p.estado_tienda === 'despachado').length,
    [pedidos]
  );

  /* Exporta EXACTAMENTE lo que está filtrado en pantalla, no la lista entera:
     el que filtró "Sin facturar" quiere bajarse eso. La cabecera alcanza para
     conciliar facturación, que es para lo que se usa; el detalle por renglón
     no va porque el rol 'ventas' no lo puede leer y el archivo saldría
     distinto según quién apreta el botón — un export que a veces trae los
     renglones y a veces no es peor que uno que nunca los trae. */
  const exportar = () => {
    const est = (id, campo) => {
      const e = B2B_ESTADOS.find(x => x.id === id);
      return e ? e[campo] : (id || '');
    };
    const n = window.B2B_DATA.descargarCSV(
      `pedidos-tienda-mayorista-${new Date().toISOString().slice(0, 10)}.csv`,
      filtrados.map(p => ({
        'Pedido tienda':  p.numero_b2b || '',
        'Pedido interno': p.numero_pedido || '',
        'Fecha':          p.enviado_at ? window.B2B_DATA.fecha(p.enviado_at) : '',
        'Cliente':        p.cliente || '',
        'Canal':          p.canal || '',
        'Comprador':      p.comprador || '',
        'Email':          p.comprador_email || '',
        'Unidades':       window.B2B_DATA.numeroCSV(p.unidades),
        'Total neto':     window.B2B_DATA.numeroCSV(p.total_neto),
        'Estado interno': est(p.estado_admin, 'label'),
        'Ve el cliente':  p.estado_tienda === 'facturado' ? 'Facturado' : est(p.estado_admin, 'cliente'),
        'Factura':        p.factura_nro || '',
        'Fecha factura':  p.facturado_at ? window.B2B_DATA.fecha(p.facturado_at) : '',
      }))
    );
    if (n > 0) toast.success(`${n} pedido(s) exportado(s)`);
  };

  const badge = (estadoId) => {
    const e = B2B_ESTADOS.find(x => x.id === estadoId)
           || { label: estadoId || '—', bg:'#e5e7eb', fg:'#374151' };
    return (
      <span style={{fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:6,
                    background:e.bg, color:e.fg, textTransform:'uppercase', letterSpacing:'.05em',
                    whiteSpace:'nowrap'}}>
        {e.label}
      </span>
    );
  };

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

  if (pedidos.length === 0) {
    return (
      <div className="admin-empty-state">
        <Icon n="store" s={32} c="var(--ink-muted)"/>
        <h3>Todavía no entró ningún pedido por la tienda</h3>
        <p style={{maxWidth:480, lineHeight:1.55}}>
          Cuando un mayorista aprobado mande su pedido, aparece acá solo y llega
          el aviso. No hay que cargar nada a mano.
        </p>
        <button className="btn-ghost" onClick={reload}><Icon n="refresh" s={13}/> Actualizar</button>
      </div>
    );
  }

  return (
    <div>
      <div className="admin-tab-header">
        <div className="admin-search">
          <Icon n="search" s={14} c="var(--ink-muted)"/>
          <input className="filter-input admin-search-input"
                 placeholder="Buscar número, cliente, comprador…"
                 value={q} onChange={e => setQ(e.target.value)}/>
        </div>
        <button className="btn-ghost" onClick={exportar} disabled={filtrados.length === 0}
                title="Bajar a Excel los pedidos que estás viendo">
          <Icon n="download" s={13}/> Exportar ({filtrados.length})
        </button>
        <button className="btn-ghost" onClick={reload}><Icon n="refresh" s={13}/> Actualizar</button>
      </div>

      <div style={{display:'flex', flexWrap:'wrap', gap:6, padding:'0 2px 12px'}}>
        <button className={`tab ${filtro === '' ? 'active' : ''}`}
                style={{padding:'4px 10px', fontSize:12}}
                onClick={() => setFiltro('')}>
          Todos ({pedidos.length})
        </button>
        {B2B_ESTADOS.filter(e => conteo[e.id]).map(e => (
          <button key={e.id}
                  className={`tab ${filtro === e.id ? 'active' : ''}`}
                  style={{padding:'4px 10px', fontSize:12}}
                  onClick={() => setFiltro(filtro === e.id ? '' : e.id)}>
            {e.label} ({conteo[e.id]})
          </button>
        ))}
        {porFacturar > 0 && (
          <button className={`tab ${filtro === '_por_facturar' ? 'active' : ''}`}
                  style={{padding:'4px 10px', fontSize:12}}
                  title="Despachados que todavía no tienen factura anotada"
                  onClick={() => setFiltro(filtro === '_por_facturar' ? '' : '_por_facturar')}>
            Sin facturar ({porFacturar})
          </button>
        )}
        {facturados > 0 && (
          <button className={`tab ${filtro === '_facturado' ? 'active' : ''}`}
                  style={{padding:'4px 10px', fontSize:12}}
                  onClick={() => setFiltro(filtro === '_facturado' ? '' : '_facturado')}>
            Facturados ({facturados})
          </button>
        )}
      </div>

      {facturando && (
        <B2BFacturarModal
          pedido={facturando}
          onClose={() => setFacturando(null)}
          onHecho={() => { setFacturando(null); reload(); }}/>
      )}

      {sinDetalle && (
        <div style={{padding:'8px 12px', marginBottom:10, borderRadius:8, fontSize:12,
                     background:'#f3f4f6', color:'var(--ink-muted)'}}>
          Tu rol ve el resumen de cada pedido pero no el detalle de renglones.
        </div>
      )}

      <div className="card">
        <div style={{overflowX:'auto', WebkitOverflowScrolling:'touch'}}>
          <table className="data-table">
            <thead>
              <tr>
                <th></th>
                <th>Pedido</th><th>Cliente</th><th>Canal</th><th>Comprador</th>
                <th>Entró</th>
                <th style={{textAlign:'right'}}>Unid.</th>
                <th style={{textAlign:'right'}}>Total</th>
                <th>Estado</th>
                {isAdmin && <th>Factura</th>}
                {isOwner && <th>Avanzar</th>}
              </tr>
            </thead>
            <tbody>
              {filtrados.map(p => {
                const items = detalles[p.pedido_mayorista_id];
                const expandido = abierto === p.b2b_pedido_id;
                const estadoInfo = B2B_ESTADOS.find(x => x.id === p.estado_admin);
                const facturado = p.estado_tienda === 'facturado';
                const puedeFacturar = p.estado_tienda === 'despachado';
                return (
                  <React.Fragment key={p.b2b_pedido_id}>
                    <tr>
                      <td style={{width:28}}>
                        {/* Antes esta flecha salía solo si había renglones. Ahora el panel
                            de abajo también trae los comprobantes de pago, la dirección de
                            entrega y los PDF, así que se abre siempre: hasta 'ventas', que
                            no ve el detalle, tiene por qué entrar. */}
                        <button className="btn-ghost-sm" title={expandido ? 'Cerrar' : 'Ver el detalle'}
                                onClick={() => setAbierto(expandido ? null : p.b2b_pedido_id)}>
                          <Icon n={expandido ? 'chev-down' : 'chev-right'} s={13}/>
                        </button>
                      </td>
                      <td>
                        <div style={{display:'flex', alignItems:'center', gap:6}}>
                          <span className="order-num" style={{fontWeight:700}}>{p.numero_b2b || '—'}</span>
                          {/* El clip se ve desde la fila, sin abrir nada: si el cliente
                              ya subió el comprobante, el que cobra lo tiene que ver de
                              un vistazo mientras baja la lista. */}
                          {Number(p.comprobantes) > 0 && (
                            <span className="b2b-clip"
                                  title={`${p.comprobantes} comprobante${p.comprobantes === 1 ? '' : 's'} de pago`}>
                              <Icon n="clip" s={11}/>{p.comprobantes}
                            </span>
                          )}
                        </div>
                        {p.numero_pedido && (
                          <div style={{fontSize:11, color:'var(--ink-muted)'}}>interno {p.numero_pedido}</div>
                        )}
                      </td>
                      <td style={{fontWeight:600}}>{p.cliente || '—'}</td>
                      <td style={{textTransform:'capitalize'}}>{p.canal || '—'}</td>
                      <td>
                        <div>{p.comprador || '—'}</div>
                        <div style={{fontSize:11, color:'var(--ink-muted)'}}>{p.comprador_email || ''}</div>
                      </td>
                      <td style={{whiteSpace:'nowrap'}}>{window.B2B_DATA.fechaHora(p.enviado_at)}</td>
                      <td style={{textAlign:'right'}}>{p.unidades ?? '—'}</td>
                      <td style={{textAlign:'right', fontWeight:700, whiteSpace:'nowrap'}}>
                        {window.B2B_DATA.money(p.total_neto)}
                      </td>
                      <td>
                        {badge(p.estado_admin)}
                        {estadoInfo && (
                          <div style={{fontSize:10, color:'var(--ink-muted)', marginTop:3}}>
                            el cliente ve “{facturado ? 'Facturado' : estadoInfo.cliente}”
                          </div>
                        )}
                      </td>
                      {isAdmin && (
                        <td style={{whiteSpace:'nowrap'}}>
                          {facturado ? (
                            <>
                              <div style={{fontSize:11, fontWeight:700}}>
                                {p.factura_nro || 'sin número'}
                              </div>
                              <div style={{fontSize:10, color:'var(--ink-muted)'}}>
                                {window.B2B_DATA.fechaHora(p.facturado_at)}
                              </div>
                              <button className="btn-ghost-sm" style={{marginTop:3, marginLeft:0}}
                                      title="Corregir el número de factura"
                                      onClick={() => setFacturando(p)}>
                                Corregir
                              </button>
                            </>
                          ) : puedeFacturar ? (
                            <button className="btn-ghost-sm" style={{marginLeft:0}}
                                    onClick={() => setFacturando(p)}>
                              <Icon n="edit" s={12}/> Facturar
                            </button>
                          ) : (
                            <span style={{fontSize:10, color:'var(--ink-muted)'}}
                                  title="Se factura una vez que el pedido está despachado">
                              —
                            </span>
                          )}
                        </td>
                      )}
                      {isOwner && (
                        <td>
                          <select className="field-input"
                                  style={{padding:'4px 6px', fontSize:12, minWidth:150}}
                                  value={p.estado_admin || ''}
                                  disabled={cambiando === p.b2b_pedido_id}
                                  onChange={e => {
                                    if (e.target.value && e.target.value !== p.estado_admin) {
                                      cambiarEstado(p, e.target.value);
                                    }
                                  }}>
                            {B2B_ESTADOS.map(e => (
                              <option key={e.id} value={e.id}>{e.label}</option>
                            ))}
                          </select>
                        </td>
                      )}
                    </tr>

                    {expandido && (
                      <tr>
                        <td colSpan={nCols} style={{background:'#fafafa', padding:'12px 14px'}}>
                          <B2BDetallePedido pedido={p} items={items} sinDetalle={sinDetalle}/>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {filtrados.length === 0 && (
                <tr><td colSpan={nCols}
                        style={{textAlign:'center', padding:'24px', color:'var(--ink-muted)'}}>
                  Sin pedidos que coincidan.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="admin-tab-footer">
        {filtrados.length === pedidos.length
          ? `${pedidos.length} pedido${pedidos.length === 1 ? '' : 's'} por la tienda`
          : `${filtrados.length} de ${pedidos.length}`}
        {isAdmin && !isOwner && ' · el avance de estado lo hace el dueño'}
      </div>
    </div>
  );
}

/* ── El panel que se abre debajo de un pedido ──────────────────────────
   Junta las tres cosas que antes obligaban a salir del sistema:

     · los renglones con el precio congelado,
     · los comprobantes de pago que subió el cliente (punto 4 de la lista),
     · y los dos PDF (punto 2): el presupuesto que se le manda al cliente y
       la hoja que se imprime y baja a producción.

   Los comprobantes se piden recién acá, cuando alguien abre el pedido. La
   tabla puede tener doscientas filas y pedir los adjuntos de todas para
   mostrar un clip sería tirar el ancho de banda a la basura: el clip ya
   viene contado en la vista (b2b_v_pedidos_admin.comprobantes).

   Y el panel se desmonta al cerrar, así que al volver a abrirlo se piden
   de nuevo. Es a propósito: entre que se abrió la tabla y que el que cobra
   entra a mirar, el cliente pudo haber subido la transferencia. ── */
function B2BDetallePedido({ pedido, items, sinDetalle }) {
  const toast = useToast();
  const cuantos = Number(pedido.comprobantes) || 0;
  const renglones = Array.isArray(items) ? items : [];

  const [comps, setComps] = useState([]);
  const [cargandoComps, setCargandoComps] = useState(false);
  const [errComps, setErrComps] = useState('');
  const [abriendo, setAbriendo] = useState('');
  const [pdf, setPdf] = useState('');   // '' | 'presupuesto' | 'produccion'

  useEffect(() => {
    if (cuantos === 0) { setComps([]); return; }
    let vivo = true;
    setCargandoComps(true); setErrComps('');
    window.B2B_DATA.adminComprobantes({ pedido_id: pedido.b2b_pedido_id })
      .then(r => { if (vivo) setComps(r || []); })
      .catch(e => { if (vivo) setErrComps(e?.message || 'No se pudieron cargar los comprobantes'); })
      .then(() => { if (vivo) setCargandoComps(false); });
    return () => { vivo = false; };
  }, [pedido.b2b_pedido_id, cuantos]);

  /* El bucket es privado: la URL se pide al hacer click y vence en 10
     minutos. Y se abre con un <a> de mentira en vez de window.open porque
     después de un await el navegador ya no lo considera un click del
     usuario y lo bloquea como si fuera un pop-up. */
  const abrirComprobante = async (c) => {
    if (abriendo) return;
    setAbriendo(c.id);
    try {
      const url = await window.B2B_DATA.comprobanteUrl(c.path);
      if (!url) throw new Error('No pudimos abrir el archivo.');
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) {
      toast.error(e?.message || 'No pudimos abrir el comprobante');
    } finally {
      setAbriendo('');
    }
  };

  /* La vista del panel y b2b_rpc_mis_pedidos no traen las mismas claves, así
     que acá se traduce una fila del panel a lo que espera el generador. El
     subtotal se recalcula con el precio congelado del renglón: es la misma
     cuenta que muestra la tabla de arriba, no un precio de hoy. */
  const paraPdf = () => ({
    numero: pedido.numero_b2b,
    enviado_at: pedido.enviado_at,
    fecha_entrega_deseada: pedido.fecha_entrega_estimada,
    direccion_entrega: pedido.direccion_entrega,
    notas: pedido.notas_cliente,
    condicion_pago: pedido.condicion_pago,
    canal: pedido.canal,
    total_neto: pedido.total_neto,
    total_con_iva: pedido.total_con_iva,
    unidades: pedido.unidades,
    items: renglones.map(it => ({
      sku: it.sku, modelo: it.modelo, color: it.color,
      cantidad: Number(it.cantidad) || 0,
      precio_unitario: Number(it.precio_unitario) || 0,
      subtotal: (Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0),
    })),
  });

  const bajarPdf = async (cual) => {
    if (pdf) return;
    setPdf(cual);
    try {
      const emisor = await b2bEmisor();
      const cliente = { nombre: pedido.cliente, cuit: pedido.cliente_cuit };
      /* abrir:true y no descargar. En el celular el download aterriza en la
         carpeta de Descargas sin avisar nada y el que apreto el boton se
         queda mirando la pantalla creyendo que no anduvo. */
      const opts = { emisor, cliente, abrir: true };
      if (cual === 'produccion') await window.B2B_PDF.produccion(paraPdf(), opts);
      else                       await window.B2B_PDF.presupuesto(paraPdf(), opts);
    } catch (e) {
      toast.error(e?.message || 'No pudimos generar el PDF. Probá de nuevo.');
    } finally {
      setPdf('');
    }
  };

  const ficha = [
    ['Dirección de entrega', pedido.direccion_entrega],
    ['Condición de pago',    pedido.condicion_pago],
    ['CUIT del cliente',     pedido.cliente_cuit],
    ['Total con IVA',        pedido.total_con_iva != null
                               ? window.B2B_DATA.money(pedido.total_con_iva) : ''],
  ].filter(f => f[1]);

  return (
    <div className="b2b-det">
      {ficha.length > 0 && (
        <div className="b2b-det-ficha">
          {ficha.map(f => (
            <div key={f[0]}><span>{f[0]}</span><b>{f[1]}</b></div>
          ))}
        </div>
      )}

      {pedido.notas_cliente && (
        <div className="b2b-det-notas">
          <b>Notas del cliente:</b> {pedido.notas_cliente}
        </div>
      )}

      {renglones.length > 0 ? (
        <>
          <table className="data-table" style={{margin:0}}>
            <thead>
              <tr>
                <th>SKU</th><th>Producto</th>
                <th style={{textAlign:'right'}}>Cantidad</th>
                <th style={{textAlign:'right'}}>Precio unitario</th>
                <th style={{textAlign:'right'}}>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {renglones.map((it, i) => (
                <tr key={`${it.sku}-${i}`}>
                  <td><span className="order-num">{it.sku}</span></td>
                  <td>{[it.modelo, it.color].filter(Boolean).join(' · ') || '—'}</td>
                  <td style={{textAlign:'right'}}>{it.cantidad}</td>
                  <td style={{textAlign:'right'}}>{window.B2B_DATA.money(it.precio_unitario)}</td>
                  <td style={{textAlign:'right', fontWeight:600}}>
                    {window.B2B_DATA.money(Number(it.cantidad) * Number(it.precio_unitario))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:8}}>
            El precio de cada renglón quedó congelado cuando el cliente mandó el
            pedido. Cambiar el coeficiente del canal después no lo toca.
          </div>
        </>
      ) : (
        <div className="b2b-det-vacio">
          {sinDetalle
            ? 'Tu rol no ve los renglones de este pedido, así que tampoco se pueden armar los PDF.'
            : 'Este pedido no tiene renglones cargados.'}
        </div>
      )}

      {/* ── Comprobantes de pago ── */}
      <div className="b2b-det-tit">
        <Icon n="clip" s={13}/> Comprobantes de pago
        {cuantos > 0 && <span className="b2b-det-tit-n">{cuantos}</span>}
      </div>
      {cargandoComps ? (
        <div className="b2b-det-vacio">Buscando los comprobantes…</div>
      ) : errComps ? (
        <div className="b2b-det-vacio" style={{color:'var(--red)'}}>{errComps}</div>
      ) : comps.length === 0 ? (
        <div className="b2b-det-vacio">
          El cliente todavía no subió ninguno. Los sube él desde “Mis pedidos”
          en la tienda y aparecen acá al instante.
        </div>
      ) : (
        <ul className="b2b-comps">
          {comps.map(c => (
            <li key={c.id} className="b2b-comp">
              <Icon n="file" s={15} c="var(--ink-muted)"/>
              <div className="b2b-comp-txt">
                <div className="b2b-comp-nom">{c.nombre || 'comprobante'}</div>
                <div className="b2b-comp-sub">
                  {window.B2B_DATA.fechaHora(c.created_at)}
                  {c.subio ? ` · ${c.subio}` : ''}
                  {c.monto != null ? ` · ${window.B2B_DATA.money(c.monto)}` : ''}
                </div>
                {c.nota && <div className="b2b-comp-nota">{c.nota}</div>}
              </div>
              <button className="btn-ghost-sm" style={{marginLeft:0}}
                      disabled={abriendo === c.id}
                      onClick={() => abrirComprobante(c)}>
                <Icon n="eye" s={12}/> {abriendo === c.id ? 'Abriendo…' : 'Ver'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* ── Los dos PDF ──
          Distintos a propósito: el presupuesto lleva precios, IVA y los datos
          para transferir; la hoja de producción no lleva un solo número de
          plata, porque termina arriba de una mesa en el taller. */}
      {renglones.length > 0 && (
        <div className="b2b-det-acciones">
          <button className="btn-ghost" disabled={!!pdf}
                  title="El presupuesto que se le manda al cliente: neto, IVA y datos para transferir"
                  onClick={() => bajarPdf('presupuesto')}>
            <Icon n="download" s={13}/>
            {pdf === 'presupuesto' ? 'Armando…' : 'Presupuesto'}
          </button>
          <button className="btn-ghost" disabled={!!pdf}
                  title="La hoja para el taller: SKU, modelo, color y cantidad. Sin precios."
                  onClick={() => bajarPdf('produccion')}>
            <Icon n="tools" s={13}/>
            {pdf === 'produccion' ? 'Armando…' : 'Hoja de producción'}
          </button>
        </div>
      )}
    </div>
  );
}

/* ══ ANOTAR LA FACTURA DE UN PEDIDO ══
   No emite nada: guarda el número de una factura que ya se emitió afuera y
   mueve el pedido de la tienda a 'facturado', que es lo que el cliente ve en
   "Mis pedidos". El estado del admin queda donde estaba (Despachado).

   El número es opcional a propósito: se factura por lote y los números
   aparecen después, y obligar a tipearlo en el momento llevaba a inventarlo.
   Sobre un pedido ya facturado este mismo modal sirve para corregirlo.

   Mobile: sin autoFocus. En el celular el foco automático levanta el teclado
   y tapa el resumen del pedido, que es justo lo que hay que mirar antes de
   confirmar que se está facturando la fila correcta. */
function B2BFacturarModal({ pedido, onClose, onHecho }) {
  const toast = useToast();
  const Cmp = window.Modal;
  const yaFacturado = pedido.estado_tienda === 'facturado';

  const [nro, setNro] = useState(pedido.factura_nro || '');
  const [enviando, setEnviando] = useState(false);

  const confirmar = async () => {
    if (enviando) return;
    setEnviando(true);
    try {
      await window.B2B_DATA.facturarPedido({
        pedido_id: pedido.b2b_pedido_id,
        factura_nro: nro.trim(),
      });
      toast.success(yaFacturado
        ? `Factura de ${pedido.numero_b2b} actualizada`
        : `${pedido.numero_b2b} quedó facturado`);
      onHecho?.();
    } catch (err) {
      toast.error(err?.message || 'No se pudo facturar');
      setEnviando(false);
    }
  };

  return (
    <Cmp open={true}
         title={yaFacturado ? `Factura de ${pedido.numero_b2b}` : `Facturar ${pedido.numero_b2b}`}
         onClose={onClose}
         footer={
           <>
             <button className="btn-ghost" onClick={onClose} disabled={enviando}>Cancelar</button>
             <button className="btn-primary" onClick={confirmar} disabled={enviando}>
               {enviando ? 'Guardando…' : (<><Icon n="check" s={14}/> {yaFacturado ? 'Guardar' : 'Marcar facturado'}</>)}
             </button>
           </>
         }>
      {/* Resumen apilado: en pantalla angosta la línea corrida se parte sola
          en cualquier lado y deja de leerse como "de qué pedido hablamos". */}
      <div style={{fontSize:12, color:'var(--ink-muted)', lineHeight:1.55, marginBottom:14}}>
        <div style={{color:'var(--ink)', fontWeight:700, fontSize:13}}>{pedido.cliente}</div>
        <div>
          {pedido.unidades ?? '—'} unidades ·{' '}
          <b style={{color:'var(--ink)'}}>{window.B2B_DATA.money(pedido.total_neto)}</b>
        </div>
        <div style={{marginTop:6}}>
          Esto no emite ninguna factura: anota la que ya emitiste, para que el
          cliente la vea en “Mis pedidos”. El estado interno del pedido no se
          mueve — sigue en Despachado.
        </div>
      </div>

      <div className="field-group">
        <label className="field-label">Número de factura</label>
        <input className="field-input" type="text" maxLength={40}
               inputMode="text" autoCapitalize="characters" autoCorrect="off"
               value={nro} onChange={e => setNro(e.target.value)}
               placeholder="A-0001-00001234"/>
        <div className="field-help">
          Se puede dejar vacío y cargarlo después: el pedido queda marcado como
          facturado igual, y este mismo botón vuelve a abrirse para completarlo.
        </div>
      </div>

      {yaFacturado && (
        <div style={{fontSize:11, color:'var(--ink-muted)'}}>
          Facturado el {window.B2B_DATA.fechaHora(pedido.facturado_at)}. Cambiar el
          número acá no cambia esa fecha.
        </div>
      )}
    </Cmp>
  );
}

window.B2BPedidosTab = B2BPedidosTab;
