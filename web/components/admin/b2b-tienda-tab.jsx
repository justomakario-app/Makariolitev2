/* ══ TIENDA MAYORISTA — contenedor del panel interno (B2B / 0151-0154)
   Vive dentro de Ventas, al lado de "Clientes mayoristas", porque los
   pedidos que entran por la tienda aterrizan justamente ahi: al enviarse,
   b2b_rpc_enviar_pedido los materializa en pedidos_mayoristas y quedan
   visibles en la ficha del mayorista sin que nadie los cargue a mano.

   Este panel es la otra mitad: lo que la ficha del mayorista NO muestra
   (quien pide entrar, a que precio ve cada canal, el detalle del pedido
   tal como lo armo el cliente).

   ── Dos compuertas, ninguna cosmetica ──
   1. FLAG: app_flags.b2b. Fail-closed — si no se puede leer, apagado.
      Esconder el tab es solo comodidad: el backend revalida el flag en
      CADA RPC (b2b_fn_guard), asi que forzar la UI no habilita nada.
   2. ROL: owner/admin ven todo. 'ventas' ve solo Pedidos, que es lo unico
      que su rol puede leer en el backend (b2b_rpc_admin_pedidos acepta
      owner/admin/ventas; el resto de las RPC devuelve 42501).
   Se refleja el permiso real del backend en vez de mostrar tabs que
   fallarian al abrirse. ══ */

function B2BTiendaTab() {
  const role    = (window.MOCK?.user?.role || '').toLowerCase();
  const isOwner = role === 'owner';
  const isAdmin = role === 'owner' || role === 'admin';
  const puedeVer = isAdmin || role === 'ventas';

  /* Deep-link desde la campanita. Se copia acá mismo, al construir el estado:
     VentasPage borra window.NAV_INTENT apenas termina de montar, y para cuando
     el flag resuelve (que es cuando recién se monta B2BPedidosTab) ya no
     existiría. Por eso el número viajado se guarda en un estado propio y baja
     como prop, en vez de leerlo el hijo. */
  const intent = window.NAV_INTENT || null;

  const [flagOn,   setFlagOn]   = useState(null);   // null = averiguando
  const [tab,      setTab]      = useState(intent?.b2bSub === 'solicitudes' ? 'solicitudes' : 'pedidos');
  const [buscarInicial]         = useState(intent?.buscar || '');
  const [pend,     setPend]     = useState(0);

  const refrescarPendientes = async () => {
    if (!isAdmin) return;
    setPend(await window.B2B_DATA.pendientesCount());
  };

  useEffect(() => {
    let vivo = true;
    (async () => {
      const on = await window.B2B_DATA.flag();
      if (!vivo) return;
      setFlagOn(on);
      if (on && isAdmin) setPend(await window.B2B_DATA.pendientesCount());
    })();
    return () => { vivo = false; };
    /* eslint-disable-next-line */
  }, []);

  if (!puedeVer) {
    return (
      <div className="admin-empty-state">
        <Icon n="lock" s={32} c="var(--ink-muted)"/>
        <h3>Sin acceso</h3>
        <p>La tienda mayorista la administran el dueño y los administradores.</p>
      </div>
    );
  }

  if (flagOn === null) {
    return <div className="admin-empty-state"><span className="loader" style={{width:24, height:24}}/></div>;
  }

  if (!flagOn) {
    return (
      <div className="admin-empty-state">
        <Icon n="store" s={32} c="var(--ink-muted)"/>
        <h3>La tienda mayorista está apagada</h3>
        <p style={{maxWidth:520, lineHeight:1.55}}>
          El módulo existe en la base pero está deshabilitado, así que nadie puede
          entrar ni pedir. Encenderlo es una acción manual del dueño sobre
          <span className="order-num" style={{margin:'0 4px'}}>app_flags</span>
          (poner <b>b2b</b> en <b>true</b>), no un botón de esta pantalla: mientras
          esté apagado, el backend rechaza todas las operaciones de la tienda.
        </p>
      </div>
    );
  }

  /* El orden sigue el recorrido real de un mayorista: primero pide entrar
     (Accesos), después queda como cuenta con un canal (Clientes), después
     compra (Pedidos). Pedidos va primero igual porque es lo que se mira todos
     los días; los otros tres se tocan de vez en cuando. */
  const TABS = isAdmin
    ? [
        { id:'pedidos',      label:'Pedidos de la tienda' },
        { id:'solicitudes',  label:'Accesos', badge: pend },
        { id:'clientes',     label:'Clientes' },
        { id:'catalogo',     label:'Catálogo y precios' },
      ]
    : [{ id:'pedidos', label:'Pedidos de la tienda' }];

  const activo = TABS.find(t => t.id === tab) ? tab : 'pedidos';

  return (
    <div>
      <div className="tabs" role="tablist" style={{marginTop:0}}>
        {TABS.map(t => (
          <button key={t.id} role="tab"
                  aria-selected={activo === t.id}
                  className={`tab ${activo === t.id ? 'active' : ''}`}
                  onClick={() => setTab(t.id)}>
            {t.label}
            {t.badge > 0 && (
              <span style={{marginLeft:7, fontSize:10, fontWeight:700, padding:'1px 6px',
                            borderRadius:9, background:'#fef3c7', color:'#92400e',
                            verticalAlign:'middle'}}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {activo === 'pedidos'     && window.B2BPedidosTab      ? <window.B2BPedidosTab buscarInicial={buscarInicial}/> :
         activo === 'solicitudes' && window.B2BSolicitudesTab  ? <window.B2BSolicitudesTab onCambio={refrescarPendientes}/> :
         activo === 'clientes'    && window.B2BClientesTab     ? <window.B2BClientesTab isOwner={isOwner}/> :
         activo === 'catalogo'    && window.B2BCatalogoTab     ? <window.B2BCatalogoTab isOwner={isOwner}/> : (
          <div className="admin-empty-state">
            <Icon n="store" s={32} c="var(--ink-muted)"/>
            <h3>No se pudo cargar la pantalla</h3>
            <p>Refrescá la página; si sigue igual, avisá que falta un componente de la tienda.</p>
          </div>
        )}
      </div>
    </div>
  );
}

window.B2BTiendaTab = B2BTiendaTab;
