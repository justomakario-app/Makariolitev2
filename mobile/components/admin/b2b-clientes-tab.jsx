/* ══ TIENDA MAYORISTA — CLIENTES (la ficha de la empresa, no de la persona)
   "Accesos" es por PERSONA: si una ferretería tiene dos compradores, ahí son
   dos filas. Acá son una sola, que es como se factura y como se decide el
   precio — el canal cuelga del cliente, no del usuario.

   Lo que se puede cambiar desde acá y no se podía desde ningún otro lado:

   1. CATÁLOGOS HABILITADOS. Cuáles de las listas ve ese cliente. Con dos
      habilitados es UN SOLO usuario que elige con cuál compra cada vez que
      entra (0162) — no son dos cuentas. Cada catálogo tiene su lista de
      precios, su mínimo y su propio pedido en curso, así que sacarle uno no
      le borra nada: el borrador de ese catálogo queda guardado y vuelve a
      aparecer el día que se lo rehabiliten.
   2. CATÁLOGO POR DEFECTO. Con cuál arranca el que todavía no eligió. Si
      tiene uno solo habilitado, es directamente el precio que ve y punto.
      Los pedidos ya enviados NO se tocan: su precio quedó congelado en
      b2b_pedido_item.precio_unitario al enviarse, justamente para que un
      cambio de canal no reescriba historia.
   3. HABILITADO. El corte limpio. Apagarlo deja al cliente y a sus pedidos
      donde están, pero la tienda le muestra la pantalla de espera en vez de
      dejarlo pedir. Es lo que hay que usar cuando alguien queda con deuda:
      no borrar nada, cerrar la canilla.
   4. CONDICIÓN DE PAGO y NOTAS INTERNAS. Texto libre, para el que atiende.
      Las notas no las ve el cliente en ningún lado.

   Guarda solo lo que cambiaste: b2b_rpc_admin_set_cliente escribe únicamente
   las claves presentes en el payload, así que mandar el formulario entero
   pisaría campos que otro pudo haber tocado mientras el modal estaba abierto.
   Por eso el modal arma el objeto por diferencia contra el valor original.
   ══ */

function B2BClientesTab({ isOwner } = {}) {
  const toast = useToast();

  const [clientes, setClientes] = useState([]);
  const [canales,  setCanales]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [q,        setQ]        = useState('');
  const [soloHab,  setSoloHab]  = useState(false);
  const [editando, setEditando] = useState(null);     // cliente en edición
  const [facturando, setFacturando] = useState(null);  // cliente cuyas facturas se miran

  const reload = async () => {
    setLoading(true); setError(null);
    try {
      const [cls, cs] = await Promise.all([
        window.B2B_DATA.adminClientes({}),
        window.B2B_DATA.canales(),
      ]);
      setClientes(cls || []);
      setCanales((cs || []).filter(c => c.activo !== false));
    } catch (err) {
      const msg = err?.message || 'Error desconocido';
      setError(msg); toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  const guardar = async (cliente, cambios) => {
    /* Sin cambios no se llama al backend: evita un update inútil y evita
       ensuciar el log con operaciones que no operan nada. */
    if (!cambios || Object.keys(cambios).length === 0) {
      setEditando(null);
      return;
    }
    try {
      await window.B2B_DATA.setCliente({ cliente_id: cliente.cliente_id, ...cambios });
      toast.success(`${cliente.nombre} actualizado`);
      setEditando(null);
      await reload();
    } catch (err) {
      toast.error(err?.message || 'No se pudo guardar');
      throw err;   // el modal se queda abierto con lo que el admin escribió
    }
  };

  const filtrados = clientes.filter(c => {
    if (soloHab && !c.habilitado) return false;
    const t = q.trim().toLowerCase();
    if (!t) return true;
    /* buscaEn (data.js): "corralon" tiene que encontrar a "Corralón Sur". */
    return window.buscaEn(t, c.nombre, c.cuit);
  });

  const nombreCanal = (codigo) => {
    const c = canales.find(x => x.codigo === codigo);
    return c ? c.nombre : (codigo || '—');
  };

  /* Los catálogos habilitados que NO son el de arranque. */
  const otrosCanales = (c) =>
    (Array.isArray(c.canales) ? c.canales : []).filter(x => x && x !== c.canal);

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
        <input className="field-input" style={{maxWidth:260}}
               placeholder="Buscar por nombre o CUIT…"
               value={q} onChange={e => setQ(e.target.value)}/>
        <label className="admin-toggle-inactive">
          <input type="checkbox" checked={soloHab} onChange={e => setSoloHab(e.target.checked)}/>
          Solo los que pueden comprar
        </label>
        <button className="btn-ghost" onClick={reload}><Icon n="refresh" s={13}/> Actualizar</button>
      </div>

      <div className="card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Catálogos</th>
              <th>Tienda</th>
              <th>Compradores</th>
              <th>Condición de pago</th>
              <th style={{textAlign:'right'}}>Pedidos</th>
              <th style={{textAlign:'right'}}>Total pedido</th>
              <th>Último</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map(c => (
              <tr key={c.cliente_id}>
                <td>
                  <div style={{fontWeight:600}}>{c.nombre}</div>
                  {c.cuit && <span className="order-num" style={{fontSize:10}}>{c.cuit}</span>}
                  {c.notas_internas && (
                    <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:3, maxWidth:280}}>
                      {c.notas_internas}
                    </div>
                  )}
                </td>
                <td>
                  <div style={{fontWeight:600}}>{nombreCanal(c.canal)}</div>
                  {/* Los otros catálogos que tiene habilitados. Sin esto, la
                      lista miente: muestra uno solo cuando el cliente en
                      realidad compra con los dos. */}
                  {otrosCanales(c).length > 0 && (
                    <div style={{fontSize:11, color:'var(--ink-muted)'}}>
                      + {otrosCanales(c).map(nombreCanal).join(', ')}
                    </div>
                  )}
                  {c.coeficiente != null && (
                    <div style={{fontSize:11, color:'var(--ink-muted)'}}>
                      paga el {Math.round(Number(c.coeficiente) * 100)}% de la lista
                    </div>
                  )}
                </td>
                <td>
                  {c.habilitado ? (
                    <span style={{fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:6,
                                  background:'#e6f7ec', color:'#15803d', textTransform:'uppercase',
                                  letterSpacing:'.05em'}}>Puede comprar</span>
                  ) : (
                    <span style={{fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:6,
                                  background:'#fee2e2', color:'#b91c1c', textTransform:'uppercase',
                                  letterSpacing:'.05em'}}>Cerrada</span>
                  )}
                </td>
                <td>
                  {c.usuarios || 0}
                  {c.usuarios_pendientes > 0 && (
                    <span style={{marginLeft:6, fontSize:10, fontWeight:700, padding:'1px 6px',
                                  borderRadius:9, background:'#fef3c7', color:'#92400e'}}>
                      {c.usuarios_pendientes} esperando
                    </span>
                  )}
                </td>
                <td>{c.condicion_pago || '—'}</td>
                <td style={{textAlign:'right'}}>{c.pedidos || 0}</td>
                <td style={{textAlign:'right', fontWeight:600}}>{window.B2B_DATA.money(c.total_pedido)}</td>
                <td>{c.ultimo_pedido ? window.B2B_DATA.fecha(c.ultimo_pedido) : '—'}</td>
                <td className="cta-cte-actions">
                  {/* Acá se ven TODAS sus facturas, incluidas las sueltas: la
                      venta que se cerró por teléfono y nunca pasó por la
                      tienda no tiene pedido de dónde colgarse. */}
                  <button className="btn-ghost-sm" onClick={() => setFacturando(c)}
                          title="Ver y cargar las facturas de este cliente">
                    <Icon n="file" s={12}/> Facturas
                  </button>
                  <button className="btn-ghost-sm" onClick={() => setEditando(c)}>
                    <Icon n="edit" s={12}/> Editar
                  </button>
                </td>
              </tr>
            ))}
            {filtrados.length === 0 && (
              <tr><td colSpan={9} style={{textAlign:'center', padding:'24px', color:'var(--ink-muted)'}}>
                {clientes.length === 0
                  ? 'Todavía no hay clientes en la tienda. Aparecen acá cuando aprobás su acceso en la pestaña "Accesos".'
                  : 'Ningún cliente coincide con el filtro.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {facturando && (
        <B2BFacturasModal
          clienteId={facturando.cliente_id}
          clienteNombre={facturando.nombre}
          onClose={() => setFacturando(null)}/>
      )}

      {editando && (
        <B2BClienteModal
          cliente={editando}
          canales={canales}
          isOwner={isOwner}
          onClose={() => setEditando(null)}
          onGuardar={(cambios) => guardar(editando, cambios)}/>
      )}
    </div>
  );
}

/* ── Modal: ficha B2B del cliente ─────────────────────────────────────
   Manda solo lo que cambió (ver el comentario de arriba). El aviso del
   cambio de canal aparece únicamente cuando el canal cambió de verdad: un
   cartel rojo permanente se vuelve invisible a los tres días. ── */
function B2BClienteModal({ cliente, canales, isOwner, onClose, onGuardar }) {
  /* Un cliente viejo puede no tener la lista cargada: en ese caso el único
     catálogo habilitado es el que ya tenía asignado. */
  const canalesOrig = Array.isArray(cliente.canales) && cliente.canales.length
    ? cliente.canales.slice()
    : (cliente.canal ? [cliente.canal] : []);

  const orig = {
    canal:          cliente.canal || '',
    canales:        canalesOrig,
    habilitado:     !!cliente.habilitado,
    condicion_pago: cliente.condicion_pago || '',
    notas_internas: cliente.notas_internas || '',
  };
  const [form, setForm] = useState(orig);
  const [guardando, setGuardando] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  /* Tildar/destildar un catálogo. El de arranque tiene que quedar adentro de
     los habilitados — si se destilda justo ese, se corre solo al primero que
     queda, que es exactamente lo que hace el backend (0162). Hacerlo también
     acá es lo que evita que el modal muestre una cosa y se guarde otra. */
  const toggleCanal = (codigo) => setForm(f => {
    const tiene = f.canales.includes(codigo);
    const lista = canales
      .map(c => c.codigo)
      .filter(x => tiene ? (f.canales.includes(x) && x !== codigo)
                        : (f.canales.includes(x) || x === codigo));
    return { ...f, canales: lista, canal: lista.includes(f.canal) ? f.canal : (lista[0] || '') };
  });

  const mismoSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
  const cambioCanales = !mismoSet(form.canales, orig.canales);
  const cambioCanal   = form.canal !== orig.canal;
  const cambioHab     = form.habilitado !== orig.habilitado;

  const quitados  = orig.canales.filter(x => !form.canales.includes(x));
  const agregados = form.canales.filter(x => !orig.canales.includes(x));
  const sinCanales  = form.canales.length === 0;
  const unSoloCanal = form.canales.length === 1;

  const diff = () => {
    const d = {};
    if (cambioCanales) d.canales = form.canales;
    if (cambioCanal && form.canal) d.canal = form.canal;
    if (cambioHab) d.habilitado = form.habilitado;
    if (form.condicion_pago.trim() !== orig.condicion_pago) d.condicion_pago = form.condicion_pago.trim();
    if (form.notas_internas.trim() !== orig.notas_internas) d.notas_internas = form.notas_internas.trim();
    return d;
  };

  /* Sin ningún catálogo no hay nada que guardar: el backend lo rechaza
     (b2b_canales tiene un CHECK de al menos uno) y acá se ve antes. */
  const hayCambios = Object.keys(diff()).length > 0 && !sinCanales;

  const confirmar = async () => {
    if (guardando) return;
    setGuardando(true);
    try {
      await onGuardar?.(diff());
    } catch (e) {
      setGuardando(false);
    }
  };

  const cerrar = () => { if (!guardando) onClose?.(); };
  const Cmp = window.Modal;
  const canalOrig = canales.find(c => c.codigo === orig.canal);
  const canalNuevo = canales.find(c => c.codigo === form.canal);

  return (
    <Cmp open={true} title={cliente.nombre} onClose={cerrar} footer={
      <>
        <button className="btn-ghost" onClick={cerrar} disabled={guardando}>Cancelar</button>
        <button className="btn-primary" onClick={confirmar} disabled={guardando || !hayCambios}>
          {guardando ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </>
    }>
      {/* Qué listas ve. Va primero porque manda sobre todo lo de abajo: el
          catálogo de arranque sale de acá, y con dos habilitados el precio
          deja de ser una sola cosa fija — lo elige el comprador al entrar. */}
      <div className="field-group">
        <label className="field-label">Catálogos habilitados</label>
        <div className="b2b-cli-canales">
          {canales.map(c => {
            const on = form.canales.includes(c.codigo);
            return (
              <label key={c.codigo} className={'b2b-cli-canal' + (on ? ' b2b-cli-canal-on' : '')}>
                <input type="checkbox" checked={on} onChange={() => toggleCanal(c.codigo)}/>
                <span style={{fontWeight:600}}>{c.nombre}</span>
                <span style={{marginLeft:'auto', fontSize:11, color:'var(--ink-muted)'}}>
                  paga el {Math.round(Number(c.coeficiente) * 100)}% de la lista
                </span>
              </label>
            );
          })}
        </div>

        {sinCanales ? (
          <div style={{display:'flex', gap:8, alignItems:'flex-start', marginTop:8, padding:'10px 12px',
                       borderRadius:8, background:'#fee2e2', color:'#b91c1c', fontSize:12, lineHeight:1.5}}>
            <Icon n="alert" s={16} c="#b91c1c"/>
            <div>
              Tiene que quedarle <b>al menos un catálogo</b>. Para cerrarle la compra
              sin sacarle listas, destildá “Puede entrar y hacer pedidos” acá abajo.
            </div>
          </div>
        ) : quitados.length > 0 ? (
          <div style={{display:'flex', gap:8, alignItems:'flex-start', marginTop:8, padding:'10px 12px',
                       borderRadius:8, background:'#fef3c7', color:'#92400e', fontSize:12, lineHeight:1.5}}>
            <Icon n="alert" s={16} c="#92400e"/>
            <div>
              Le sacás <b>{quitados.map(x => (canales.find(c => c.codigo === x) || {}).nombre || x).join(', ')}</b>.
              El que estuviera comprando ahí va a tener que elegir de nuevo entre los que le
              queden. <b>No se borra nada</b>: el pedido en curso que tenga en ese catálogo
              queda guardado y vuelve a aparecer intacto si se lo rehabilitás.
            </div>
          </div>
        ) : agregados.length > 0 ? (
          <div style={{display:'flex', gap:8, alignItems:'flex-start', marginTop:8, padding:'10px 12px',
                       borderRadius:8, background:'#eff6ff', color:'#1d4ed8', fontSize:12, lineHeight:1.5}}>
            <Icon n="info" s={16} c="#1d4ed8"/>
            <div>
              Le sumás <b>{agregados.map(x => (canales.find(c => c.codigo === x) || {}).nombre || x).join(', ')}</b>.
              Sigue siendo <b>el mismo usuario</b>: la próxima vez que entre le vamos a
              preguntar con qué catálogo quiere comprar, y lo puede cambiar cuando quiera.
            </div>
          </div>
        ) : (
          <div className="field-help">
            {unSoloCanal
              ? 'Con uno solo habilitado, entra derecho a ese: no se le pregunta nada.'
              : 'Con más de uno, el comprador elige con cuál compra cada vez que entra. Cada catálogo tiene su lista de precios, su mínimo y su propio pedido en curso.'}
          </div>
        )}
      </div>

      <div className="field-group">
        <label className="field-label">{unSoloCanal ? 'Precio que ve' : 'Catálogo con el que arranca'}</label>
        {unSoloCanal ? (
          <div style={{fontSize:13, fontWeight:600}}>
            {canalNuevo ? canalNuevo.nombre : '—'}
            {canalNuevo && (
              <span style={{marginLeft:8, fontWeight:400, fontSize:12, color:'var(--ink-muted)'}}>
                paga el {Math.round(Number(canalNuevo.coeficiente) * 100)}% de la lista
              </span>
            )}
          </div>
        ) : (
          <select className="field-input" value={form.canal}
                  onChange={e => set('canal', e.target.value)}>
            {!orig.canal && <option value="">Sin canal asignado…</option>}
            {canales.filter(c => form.canales.includes(c.codigo)).map(c => (
              <option key={c.codigo} value={c.codigo}>
                {c.nombre} — paga el {Math.round(Number(c.coeficiente) * 100)}% de la lista
              </option>
            ))}
          </select>
        )}
        {cambioCanal ? (
          <div style={{display:'flex', gap:8, alignItems:'flex-start', marginTop:8, padding:'10px 12px',
                       borderRadius:8, background:'#fef3c7', color:'#92400e', fontSize:12, lineHeight:1.5}}>
            <Icon n="alert" s={16} c="#92400e"/>
            <div>
              {unSoloCanal ? (
                <>
                  Le cambiás el precio a <b>todo</b> el catálogo: de{' '}
                  <b>{canalOrig ? `${Math.round(Number(canalOrig.coeficiente) * 100)}%` : '—'}</b> a{' '}
                  <b>{canalNuevo ? `${Math.round(Number(canalNuevo.coeficiente) * 100)}%` : '—'}</b> de la lista.
                  Los pedidos que ya mandó quedan como están — su precio se congeló al enviarlos.
                </>
              ) : (
                <>
                  Pasa a arrancar en <b>{canalNuevo ? canalNuevo.nombre : '—'}</b>. Al que ya venía
                  comprando con otro de sus catálogos no le cambia nada: sigue en el que eligió
                  hasta que lo cambie él. Los pedidos ya enviados no se tocan.
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="field-help">
            {unSoloCanal
              ? 'Es lo que define el precio que ve. Nadie ve el de otro catálogo.'
              : 'Es el que ve el que todavía no eligió, y el que le queda si le sacás el suyo.'}
          </div>
        )}
      </div>

      <div className="field-group">
        <label className="field-label">Acceso a la tienda</label>
        <label style={{display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13}}>
          <input type="checkbox" checked={form.habilitado}
                 onChange={e => set('habilitado', e.target.checked)}/>
          Puede entrar y hacer pedidos
        </label>
        {cambioHab && !form.habilitado ? (
          <div style={{display:'flex', gap:8, alignItems:'flex-start', marginTop:8, padding:'10px 12px',
                       borderRadius:8, background:'#fee2e2', color:'#b91c1c', fontSize:12, lineHeight:1.5}}>
            <Icon n="lock" s={16} c="#b91c1c"/>
            <div>
              Al guardar, sus compradores dejan de ver precios y de poder pedir; les
              aparece la pantalla de espera. <b>No se borra nada</b>: el cliente, sus
              pedidos y su historial quedan intactos y volvés a abrirlo cuando quieras.
            </div>
          </div>
        ) : (
          <div className="field-help">
            Destildar es el corte limpio para una cuenta con deuda: cierra la compra sin borrar nada.
          </div>
        )}
      </div>

      <div className="field-group">
        <label className="field-label">Condición de pago</label>
        <input className="field-input" maxLength={120}
               value={form.condicion_pago}
               placeholder="30 días fecha factura, contado, etc."
               onChange={e => set('condicion_pago', e.target.value)}/>
        <div className="field-help">Informativo: la tienda no cobra ni valida plazos.</div>
      </div>

      <div className="field-group">
        <label className="field-label">Notas internas</label>
        <textarea className="field-input" rows={3} maxLength={500}
                  value={form.notas_internas}
                  placeholder="Lo que conviene saber antes de atenderlo…"
                  onChange={e => set('notas_internas', e.target.value)}/>
        <div className="field-help">Solo se ven acá. El cliente nunca las ve.</div>
      </div>

      {!isOwner && (
        <div className="field-help" style={{marginTop:-4}}>
          El coeficiente de cada canal (cuánto paga sobre la lista) lo cambia solo el dueño,
          desde “Catálogo y precios”.
        </div>
      )}
    </Cmp>
  );
}

window.B2BClientesTab = B2BClientesTab;
