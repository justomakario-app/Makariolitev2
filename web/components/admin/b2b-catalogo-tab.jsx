/* ══ TIENDA MAYORISTA — CATÁLOGO Y PRECIOS
   Dos niveles de precio, y el orden importa:

     1. PRECIO DE LISTA POR CANAL (lo que diga el catálogo de ese canal).
     2. Si ese canal no tiene precio propio, precio_base × su coeficiente
        (distribuidor 0.55 · mayorista 0.70). Desde 0165 el canal minorista
        esta APAGADO: no es un canal de venta, es lo que representa
        precio_base — el neto con coeficiente 1,00 sobre el que se calculan
        los otros dos. La grilla filtra por activo, asi que no aparece.

   El segundo nivel solo no alcanza. En los catálogos de julio la razón
   distribuidor/mayorista va de 0,7545 (Set Mesas Boomerang) a 1,0000
   (Figura Muditando: $4.000 en los dos), con promedio 0,8851 sobre 27
   productos; un par fijo de coeficientes fuerza 0,7857 para todos. Cargar
   61 precios con la fórmula sola habría cobrado de más algunos productos y
   ~19% de menos otros (Box Aroma: 5.421 calculado contra 6.700 real).

   Para esta pantalla eso significa:

   1. Cada celda de canal es EDITABLE. Vacía = usa la fórmula, y muestra en
      gris lo que daría; con un número adentro, ese número es lo que paga
      ese canal, pase lo que pase con el coeficiente.
   2. Las columnas por canal se recalculan MIENTRAS SE TIPEA, no después de
      guardar. Cargar un precio a ciegas y descubrir en el próximo pedido
      que al distribuidor le quedó mal es justamente lo que hay que evitar.
   3. Tocar un coeficiente reprecia TODO el catálogo de ese canal de una,
      así que ese bloque pide confirmación aparte y es solo del dueño
      (el backend devuelve 42501 si lo intenta un admin). Los SKU con
      precio de lista propio NO se mueven — están por encima de la fórmula.

   precio_base sigue siendo obligatorio para publicar aunque el canal tenga
   su lista: es el respaldo de cualquier canal que se agregue después. El
   CHECK del backend lo rechaza; acá se avisa antes, para no mandar un lote
   que va a volver con error.

   Guardado por LOTE: se acumulan los cambios y se mandan juntos en un solo
   b2b_rpc_admin_set_producto({items:[...]}). Si un item falla, el backend
   aborta la transacción entera — no quedan precios a medio aplicar.

   CARGA MASIVA: son 61 SKU y dos catálogos. Cargarlos de a uno es una tarde
   perdida y un error de tipeo que nadie va a encontrar hasta que un
   mayorista compre barato. "Pegar precios" acepta lo que sale de copiar dos
   columnas de Excel, y se elige a qué columna van: al precio de lista o
   directo a un canal. Los deja en el mismo borrador que la edición manual
   — o sea que se revisan en pantalla, con lo que paga cada canal ya
   resuelto, y recién después se guardan. No hay atajo que escriba directo
   en la base.
   ══ */

/* Resumen de las reglas de venta de un SKU, para no tener que abrir el modal
   producto por producto: "×4 · mín 8 · bulto 4". Vacío cuando no hay ninguna
   regla cargada (múltiplo 1, sin mínimo, bulto 1), que es el caso normal. */
function reglasResumen(it) {
  const partes = [];
  if (Number(it.multiplo_venta) > 1) partes.push(`×${it.multiplo_venta}`);
  if (Number(it.minimo_sku)    > 0) partes.push(`mín ${it.minimo_sku}`);
  if (Number(it.bulto_cantidad) > 1) partes.push(`bulto ${it.bulto_cantidad}`);
  if (Number(it.iva_pct) !== 21)     partes.push(`IVA ${Number(it.iva_pct)}%`);
  if (it.foto_path)                  partes.push('foto');
  return partes.join(' · ');
}

function B2BCatalogoTab({ isOwner } = {}) {
  const toast = useToast();

  const [items,    setItems]    = useState([]);
  const [canales,  setCanales]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [q,        setQ]        = useState('');
  const [soloPub,  setSoloPub]  = useState(false);
  const [edits,    setEdits]    = useState({});     // { sku: {precio_base?, publicado?, precios_canal?} }
  const [guardando, setGuardando] = useState(false);
  const [verCanales, setVerCanales] = useState(false);
  const [pegar,    setPegar]    = useState(false);
  const [detalle,  setDetalle]  = useState(null);   // producto abierto en el modal de venta

  const reload = async () => {
    setLoading(true); setError(null);
    try {
      const [cat, cs] = await Promise.all([
        window.B2B_DATA.adminCatalogo({}),
        window.B2B_DATA.canales(),
      ]);
      setItems(cat || []);
      setCanales(cs || []);
      setEdits({});
    } catch (err) {
      const msg = err?.message || 'Error desconocido';
      setError(msg); toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  const canalesActivos = useMemo(
    () => (canales || []).filter(c => c.activo !== false).sort((a, b) => (a.orden || 0) - (b.orden || 0)),
    [canales]
  );

  /* Valor efectivo = lo editado si se tocó, si no lo que vino del backend. */
  const val = (it, campo) => {
    const e = edits[it.sku];
    if (e && Object.prototype.hasOwnProperty.call(e, campo)) return e[campo];
    return it[campo];
  };

  /* Precio de lista de un canal (0160). Cadena vacía = no hay lista propia,
     ese canal se calcula con el coeficiente. `precios_lista` trae SOLO los
     precios cargados a mano; `precios_por_canal` trae el precio ya resuelto
     (lista si hay, fórmula si no) y por eso no sirve para llenar el input:
     mostraría el número calculado como si alguien lo hubiera escrito. */
  const valCanal = (it, codigo) => {
    const e = edits[it.sku];
    if (e && e.precios_canal && Object.prototype.hasOwnProperty.call(e.precios_canal, codigo)) {
      return e.precios_canal[codigo];
    }
    const l = it.precios_lista ? it.precios_lista[codigo] : null;
    return (l === null || l === undefined) ? '' : String(l);
  };

  /* Deja en el borrador solo lo que de verdad difiere del original, y borra
     la entrada si no quedó nada. Sin esto, escribir y deshacer dejaba el SKU
     contado como "1 cambio" y el lote mandaba un item que no cambiaba nada. */
  const limpiar = (entrada, orig) => {
    if (!entrada || !orig) return null;
    const e = { ...entrada };
    const num = (v) => (v === '' || v === null || v === undefined) ? null : Number(v);

    if (Object.prototype.hasOwnProperty.call(e, 'precio_base')
        && num(e.precio_base) === num(orig.precio_base)) {
      delete e.precio_base;
    }
    if (Object.prototype.hasOwnProperty.call(e, 'publicado')
        && !!e.publicado === !!orig.publicado) {
      delete e.publicado;
    }
    if (e.precios_canal) {
      const pc = { ...e.precios_canal };
      Object.keys(pc).forEach(c => {
        const anterior = orig.precios_lista ? orig.precios_lista[c] : null;
        if (num(pc[c]) === num(anterior)) delete pc[c];
      });
      if (Object.keys(pc).length === 0) delete e.precios_canal; else e.precios_canal = pc;
    }
    return Object.keys(e).length === 0 ? null : e;
  };

  const setCampo = (sku, campo, valor) => {
    setEdits(prev => {
      const orig = items.find(i => i.sku === sku);
      const e = limpiar({ ...(prev[sku] || {}), [campo]: valor }, orig);
      const next = { ...prev };
      if (e) next[sku] = e; else delete next[sku];
      return next;
    });
  };

  const setCanal = (sku, codigo, valor) => {
    setEdits(prev => {
      const orig = items.find(i => i.sku === sku);
      const anterior = prev[sku] || {};
      const e = limpiar({
        ...anterior,
        precios_canal: { ...(anterior.precios_canal || {}), [codigo]: valor },
      }, orig);
      const next = { ...prev };
      if (e) next[sku] = e; else delete next[sku];
      return next;
    });
  };

  /* La pegada entra al MISMO borrador que la edición manual (no escribe en la
     base). Se mezcla con lo que ya estaba tocado en vez de reemplazarlo: si el
     admin corrigió tres precios a mano y después pega la lista, no pierde los
     tres. Y si un SKU pegado trae el precio que ya tenía, no cuenta como
     cambio — de eso se encarga limpiar().

     `destino` es 'base' (precio de lista general) o el código de un canal, que
     es como se cargan los dos catálogos de julio: una pegada por canal. */
  const aplicarPegado = (filas, destino) => {
    setEdits(prev => {
      const next = { ...prev };
      filas.forEach(({ sku, precio }) => {
        const orig = items.find(i => i.sku === sku);
        if (!orig) return;
        const anterior = next[sku] || {};
        const propuesta = destino === 'base'
          ? { ...anterior, precio_base: String(precio) }
          : { ...anterior, precios_canal: { ...(anterior.precios_canal || {}), [destino]: String(precio) } };
        const e = limpiar(propuesta, orig);
        if (e) next[sku] = e; else delete next[sku];
      });
      return next;
    });
  };

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (items || []).filter(it => {
      if (soloPub && !val(it, 'publicado')) return false;
      if (!t) return true;
      /* buscaEn (data.js): sin tildes y palabra por palabra. Buscar
         "lampara" tiene que encontrar "Lámpara De Pie Nórdica" — es el
         mismo catálogo que ve el cliente, y ahí ya costó un pedido. */
      return window.buscaEn(t, it.sku, it.modelo, it.categoria, it.color);
    });
    /* eslint-disable-next-line */
  }, [items, q, soloPub, edits]);

  const nCambios = Object.keys(edits).length;

  /* Los que quedarían publicados sin precio: el backend los rechaza, así que
     se avisa acá antes de mandar el lote. */
  const conflictivos = useMemo(() => {
    return Object.keys(edits).map(sku => {
      const it = items.find(i => i.sku === sku);
      if (!it) return null;
      const pub = val(it, 'publicado');
      const pb  = val(it, 'precio_base');
      const sinPrecio = pb === null || pb === undefined || pb === '' || !isFinite(Number(pb));
      return (pub && sinPrecio) ? sku : null;
    }).filter(Boolean);
    /* eslint-disable-next-line */
  }, [edits, items]);

  /* Un precio en 0 vuelve con error desde 0158: el backend lo rechaza porque
     al distribuidor le quedaba en 0 × 0,55 = 0. Desde 0160 lo mismo vale para
     el precio de lista de cada canal. Se avisa acá para no mandar un lote de
     61 SKU que va a volver entero por una celda mal pegada. */
  const enCero = useMemo(() => {
    const malo = (v) => {
      if (v === null || v === undefined || v === '') return false;
      const n = Number(v);
      return !isFinite(n) || n <= 0;
    };
    const fallas = [];
    Object.keys(edits).forEach(sku => {
      const it = items.find(i => i.sku === sku);
      if (!it) return;
      if (malo(val(it, 'precio_base'))) fallas.push(sku);
      const pc = edits[sku].precios_canal || {};
      Object.keys(pc).forEach(c => { if (malo(pc[c])) fallas.push(`${sku} (${c})`); });
    });
    return fallas;
    /* eslint-disable-next-line */
  }, [edits, items]);

  const guardar = async () => {
    if (guardando || nCambios === 0) return;
    if (conflictivos.length > 0) {
      toast.error(`No se puede publicar sin precio: ${conflictivos.join(', ')}`);
      return;
    }
    if (enCero.length > 0) {
      toast.error(`El precio tiene que ser mayor que cero: ${enCero.join(', ')}`);
      return;
    }
    setGuardando(true);
    try {
      const payloadItems = Object.keys(edits).map(sku => {
        const e = edits[sku];
        const item = { sku };
        if (Object.prototype.hasOwnProperty.call(e, 'precio_base')) {
          item.precio_base = (e.precio_base === '' || e.precio_base === null) ? null : Number(e.precio_base);
        }
        if (Object.prototype.hasOwnProperty.call(e, 'publicado')) item.publicado = !!e.publicado;
        /* null borra la lista de ese canal y lo devuelve a la fórmula: es la
           única forma de deshacer un precio de lista desde acá. */
        if (e.precios_canal) {
          item.precios_canal = {};
          Object.keys(e.precios_canal).forEach(c => {
            const v = e.precios_canal[c];
            item.precios_canal[c] = (v === '' || v === null) ? null : Number(v);
          });
        }
        return item;
      });
      const res = await window.B2B_DATA.setProducto({ items: payloadItems });
      toast.success(`${res?.actualizados ?? payloadItems.length} producto(s) actualizado(s)`);
      await reload();
    } catch (err) {
      toast.error(err?.message || 'No se pudo guardar');
    } finally {
      /* Sin este finally el botón quedaba en "Guardando…" para siempre cuando
         el guardado salía bien, y había que recargar la página para tocar otro
         precio. Es la pantalla donde se cargan los 61 SKU: no puede pasar. */
      setGuardando(false);
    }
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

  const publicados = items.filter(i => val(i, 'publicado')).length;
  const sinPrecio  = items.filter(i => {
    const pb = val(i, 'precio_base');
    return pb === null || pb === undefined || pb === '';
  }).length;
  const conPropio  = items.filter(i =>
    canalesActivos.some(c => {
      const v = valCanal(i, c.codigo);
      return v !== '' && v !== null && v !== undefined;
    })).length;

  return (
    <div>
      <div className="admin-tab-header">
        <div className="admin-search">
          <Icon n="search" s={14} c="var(--ink-muted)"/>
          <input className="filter-input admin-search-input"
                 placeholder="Buscar SKU, modelo, categoría, color…"
                 value={q} onChange={e => setQ(e.target.value)}/>
        </div>
        <label className="admin-toggle-inactive">
          <input type="checkbox" checked={soloPub} onChange={e => setSoloPub(e.target.checked)}/>
          Solo publicados
        </label>
        <button className="btn-ghost" onClick={() => setVerCanales(v => !v)}>
          <Icon n="dollar" s={13}/> Canales
        </button>
        <button className="btn-ghost" onClick={() => setPegar(true)}>
          <Icon n="upload" s={13}/> Pegar precios
        </button>
      </div>

      <div style={{display:'flex', gap:18, padding:'0 2px 6px', fontSize:12, color:'var(--ink-muted)'}}>
        <span><b style={{color:'var(--ink)'}}>{items.length}</b> productos</span>
        <span><b style={{color:'#15803d'}}>{publicados}</b> publicados</span>
        {sinPrecio > 0 && <span><b style={{color:'#b45309'}}>{sinPrecio}</b> sin precio cargado</span>}
        {conPropio > 0 && <span><b style={{color:'#b45309'}}>{conPropio}</b> con precio propio de canal</span>}
      </div>

      <div style={{padding:'0 2px 12px', fontSize:11, color:'var(--ink-muted)', lineHeight:1.5}}>
        En las columnas de canal, la celda vacía usa la fórmula (muestra en gris
        cuánto daría). Si escribís un número, ese canal paga ese precio y deja de
        seguir el coeficiente. Vaciar la celda lo devuelve a la fórmula.
      </div>

      {pegar && (
        <B2BPegarPreciosModal
          items={items}
          canales={canalesActivos}
          onClose={() => setPegar(false)}
          onAplicar={(filas, destino) => {
            aplicarPegado(filas, destino);
            setPegar(false);
            const donde = destino === 'base'
              ? 'precio de lista'
              : (canalesActivos.find(c => c.codigo === destino)?.nombre || destino);
            toast.success(`${filas.length} precio(s) de ${donde} cargados en el borrador — revisá y guardá`);
          }}/>
      )}

      {detalle && (
        <B2BProductoVentaModal
          item={detalle}
          onClose={() => setDetalle(null)}
          onGuardado={() => { setDetalle(null); reload(); }}/>
      )}

      {verCanales && (
        <B2BCanalesCard
          canales={canales}
          isOwner={isOwner}
          onGuardado={(nuevos) => { setCanales(nuevos); toast.success('Canales actualizados'); }}/>
      )}

      <div className="card">
        <div style={{overflowX:'auto'}}>
          <table className="data-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Producto</th>
                <th style={{textAlign:'right'}}>Precio de lista</th>
                {canalesActivos.map(c => (
                  <th key={c.codigo} style={{textAlign:'right', whiteSpace:'nowrap'}}>
                    {c.nombre}
                    <div style={{fontWeight:400, fontSize:10, color:'var(--ink-muted)'}}>
                      ×{Number(c.coeficiente).toFixed(2)} · o precio propio
                    </div>
                  </th>
                ))}
                <th style={{textAlign:'center'}}>En la tienda</th>
                <th style={{textAlign:'center', width:1}}>Venta</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(it => {
                const pb      = val(it, 'precio_base');
                const pubOn   = !!val(it, 'publicado');
                const tocado  = !!edits[it.sku];
                const num     = (pb === null || pb === undefined || pb === '') ? null : Number(pb);
                const malo    = pubOn && num === null;
                const cero    = num !== null && (!isFinite(num) || num <= 0);
                return (
                  <tr key={it.sku} style={tocado ? {background:'#fffbeb'} : undefined}>
                    <td><span className="order-num">{it.sku}</span></td>
                    <td>
                      <div style={{fontWeight:600}}>{it.modelo || it.sku}</div>
                      <div style={{fontSize:11, color:'var(--ink-muted)'}}>
                        {[it.categoria, it.color].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </td>
                    <td style={{textAlign:'right'}}>
                      <input className={`field-input ${malo || cero ? 'has-error' : ''}`}
                             type="number" min={0} step="0.01"
                             style={{width:120, textAlign:'right', padding:'4px 8px', fontSize:13}}
                             value={pb === null || pb === undefined ? '' : pb}
                             placeholder="sin precio"
                             onChange={e => setCampo(it.sku, 'precio_base', e.target.value)}/>
                      {cero && (
                        <div style={{fontSize:10, color:'var(--red)', marginTop:2}}>
                          Tiene que ser mayor que 0
                        </div>
                      )}
                    </td>
                    {canalesActivos.map(c => {
                      const lista   = valCanal(it, c.codigo);
                      const propio  = lista !== '' && lista !== null && lista !== undefined;
                      const nL      = propio ? Number(lista) : null;
                      const malL    = propio && (!isFinite(nL) || nL <= 0);
                      const formula = num === null ? null : num * Number(c.coeficiente);
                      return (
                        <td key={c.codigo} style={{textAlign:'right', whiteSpace:'nowrap'}}>
                          <input className={`field-input ${malL ? 'has-error' : ''}`}
                                 type="number" min={0} step="0.01"
                                 style={{width:112, textAlign:'right', padding:'4px 8px', fontSize:13,
                                         fontWeight: propio ? 600 : 400}}
                                 value={lista}
                                 placeholder={formula === null ? 'sin precio' : window.B2B_DATA.money(formula)}
                                 title={propio
                                   ? `Precio propio de ${c.nombre}. Vaciá la celda para volver a la fórmula.`
                                   : `Sale de la fórmula: lista × ${Number(c.coeficiente).toFixed(2)}`}
                                 onChange={e => setCanal(it.sku, c.codigo, e.target.value)}/>
                          <div style={{fontSize:10, marginTop:2,
                                       color: propio ? '#b45309' : 'var(--ink-muted)'}}>
                            {malL
                              ? 'mayor que 0'
                              : propio
                                ? 'precio propio'
                                : (formula === null ? '—' : `×${Number(c.coeficiente).toFixed(2)}`)}
                          </div>
                        </td>
                      );
                    })}
                    <td style={{textAlign:'center'}}>
                      <input type="checkbox" checked={pubOn}
                             onChange={e => setCampo(it.sku, 'publicado', e.target.checked)}/>
                      {malo && (
                        <div style={{fontSize:10, color:'var(--red)', marginTop:2}}>Falta el precio</div>
                      )}
                    </td>
                    <td style={{textAlign:'center', whiteSpace:'nowrap'}}>
                      <button className="btn-ghost" title="Múltiplo, mínimo, bulto, IVA y foto"
                              style={{padding:'4px 8px'}}
                              onClick={() => setDetalle(it)}>
                        <Icon n="edit" s={13}/>
                      </button>
                      <div style={{fontSize:10, color:'var(--ink-muted)', marginTop:2}}>
                        {reglasResumen(it)}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtrados.length === 0 && (
                <tr><td colSpan={5 + canalesActivos.length}
                        style={{textAlign:'center', padding:'24px', color:'var(--ink-muted)'}}>
                  {items.length === 0
                    ? 'Todavía no hay productos en el catálogo de la tienda.'
                    : `Sin resultados para "${q}"`}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {nCambios > 0 && (
        <div style={{position:'sticky', bottom:0, marginTop:12, padding:'12px 14px',
                     background:'var(--bg-elev, #fff)', border:'1px solid var(--line, #e5e7eb)',
                     borderRadius:10, display:'flex', alignItems:'center', gap:12,
                     boxShadow:'0 -2px 12px rgba(0,0,0,.06)'}}>
          <div style={{flex:1, fontSize:13}}>
            <b>{nCambios}</b> producto{nCambios === 1 ? '' : 's'} sin guardar
            {conflictivos.length > 0 && (
              <span style={{color:'var(--red)', marginLeft:8}}>
                — {conflictivos.join(', ')} {conflictivos.length === 1 ? 'queda' : 'quedan'} publicado
                {conflictivos.length === 1 ? '' : 's'} sin precio
              </span>
            )}
            {enCero.length > 0 && (
              <span style={{color:'var(--red)', marginLeft:8}}>
                — {enCero.join(', ')} {enCero.length === 1 ? 'quedó' : 'quedaron'} en 0
              </span>
            )}
          </div>
          <button className="btn-ghost" onClick={() => setEdits({})} disabled={guardando}>Descartar</button>
          <button className="btn-primary" onClick={guardar}
                  disabled={guardando || conflictivos.length > 0 || enCero.length > 0}>
            {guardando ? 'Guardando…' : (<><Icon n="check" s={14}/> Guardar cambios</>)}
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Canales: coeficientes y mínimos ──────────────────────────────────
   Cambiar un coeficiente reprecia todo el catálogo de ese canal, así que
   no se guarda solo: hay botón aparte y confirmación. Escribir es del
   dueño; un admin ve los valores pero los campos vienen bloqueados (y si
   igual mandara el request, el backend responde 42501). ── */
function B2BCanalesCard({ canales, isOwner, onGuardado }) {
  const toast = useToast();
  const [borrador, setBorrador] = useState(() => (canales || []).map(c => ({ ...c })));
  const [guardando, setGuardando] = useState(false);
  const [confirmar, setConfirmar] = useState(false);

  useEffect(() => { setBorrador((canales || []).map(c => ({ ...c }))); }, [canales]);

  const set = (codigo, campo, valor) =>
    setBorrador(b => b.map(c => c.codigo === codigo ? { ...c, [campo]: valor } : c));

  const sucio = useMemo(() => {
    return borrador.some(c => {
      const o = (canales || []).find(x => x.codigo === c.codigo);
      if (!o) return true;
      return Number(c.coeficiente)     !== Number(o.coeficiente)
          || Number(c.minimo_pedido)   !== Number(o.minimo_pedido)
          || Number(c.minimo_unidades) !== Number(o.minimo_unidades)
          || !!c.activo !== !!o.activo;
    });
  }, [borrador, canales]);

  const invalido = borrador.some(c => {
    const k = Number(c.coeficiente);
    return !isFinite(k) || k <= 0 || k > 5;
  });

  const guardar = async () => {
    if (guardando || !sucio || invalido) return;
    setGuardando(true);
    try {
      const nuevos = await window.B2B_DATA.canales({
        canales: borrador.map(c => ({
          codigo: c.codigo,
          coeficiente: Number(c.coeficiente),
          minimo_pedido: Number(c.minimo_pedido) || 0,
          minimo_unidades: Number(c.minimo_unidades) || 0,
          activo: !!c.activo,
        })),
      });
      setConfirmar(false);
      onGuardado?.(nuevos || []);
    } catch (err) {
      toast.error(err?.message || 'No se pudieron guardar los canales');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="card" style={{marginBottom:14, padding:'14px'}}>
      <div style={{fontWeight:700, fontSize:13, marginBottom:4}}>Canales</div>
      <div style={{fontSize:12, color:'var(--ink-muted)', marginBottom:12, lineHeight:1.5}}>
        El coeficiente multiplica el precio de lista. Cambiarlo reprecia todo el
        catálogo de ese canal de una vez.
        {!isOwner && ' Solo el dueño puede modificarlos.'}
      </div>

      <div style={{overflowX:'auto'}}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Canal</th>
              <th style={{textAlign:'right'}}>Coeficiente</th>
              <th style={{textAlign:'right'}}>Mínimo por pedido</th>
              <th style={{textAlign:'right'}}>Mínimo de unidades</th>
              <th style={{textAlign:'center'}}>Activo</th>
            </tr>
          </thead>
          <tbody>
            {borrador.map(c => {
              const k = Number(c.coeficiente);
              const kMalo = !isFinite(k) || k <= 0 || k > 5;
              return (
                <tr key={c.codigo}>
                  <td style={{fontWeight:600}}>
                    {c.nombre}
                    <div style={{fontSize:11, color:'var(--ink-muted)'}}>{c.codigo}</div>
                  </td>
                  <td style={{textAlign:'right'}}>
                    <input className={`field-input ${kMalo ? 'has-error' : ''}`}
                           type="number" step="0.01" min={0.01} max={5} disabled={!isOwner}
                           style={{width:100, textAlign:'right', padding:'4px 8px', fontSize:13}}
                           value={c.coeficiente}
                           onChange={e => set(c.codigo, 'coeficiente', e.target.value)}/>
                    <div style={{fontSize:10, color:'var(--ink-muted)', marginTop:2}}>
                      {isFinite(k) ? `paga el ${Math.round(k * 100)}%` : '—'}
                    </div>
                  </td>
                  <td style={{textAlign:'right'}}>
                    <input className="field-input" type="number" min={0} step="0.01" disabled={!isOwner}
                           style={{width:120, textAlign:'right', padding:'4px 8px', fontSize:13}}
                           value={c.minimo_pedido}
                           onChange={e => set(c.codigo, 'minimo_pedido', e.target.value)}/>
                  </td>
                  <td style={{textAlign:'right'}}>
                    <input className="field-input" type="number" min={0} step={1} disabled={!isOwner}
                           style={{width:100, textAlign:'right', padding:'4px 8px', fontSize:13}}
                           value={c.minimo_unidades}
                           onChange={e => set(c.codigo, 'minimo_unidades', e.target.value)}/>
                  </td>
                  <td style={{textAlign:'center'}}>
                    <input type="checkbox" checked={!!c.activo} disabled={!isOwner}
                           onChange={e => set(c.codigo, 'activo', e.target.checked)}/>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {isOwner && sucio && (
        <div style={{display:'flex', justifyContent:'flex-end', gap:10, marginTop:12}}>
          <button className="btn-ghost" disabled={guardando}
                  onClick={() => setBorrador((canales || []).map(c => ({ ...c })))}>
            Descartar
          </button>
          <button className="btn-primary" disabled={guardando || invalido}
                  onClick={() => setConfirmar(true)}>
            <Icon n="check" s={14}/> Guardar canales
          </button>
        </div>
      )}

      {confirmar && (
        <window.ConfirmModal
          open={true}
          title="Cambiar los coeficientes"
          message="Esto cambia el precio de los productos publicados que NO tengan precio propio en esos canales. Los que tienen precio propio no se mueven, y los pedidos ya enviados no se tocan: cada uno guarda el precio con el que se cerró. ¿Seguimos?"
          confirmText={guardando ? 'Guardando…' : 'Sí, aplicar'}
          onClose={() => setConfirmar(false)}
          onConfirm={guardar}/>
      )}
    </div>
  );
}

/* ── Modal: pegar precios desde Excel ─────────────────────────────────
   Dos columnas, SKU y precio. Se acepta lo que realmente sale de un
   portapapeles: tabulación (Excel), punto y coma (CSV en español), coma o
   espacios. El SKU es lo primero de la línea y el precio lo primero que
   sigue; el resto se descarta, así que pegar tres columnas con la
   descripción al final no molesta.

   ── A dónde van ──
   Primero se elige la columna destino. "Precio de lista" es el precio base
   del que salen todos los canales por coeficiente; elegir un canal carga el
   precio propio de ese canal, que es como entran los dos catálogos de julio
   (uno mayorista y uno distribuidor, con razones que van de 0,7545 a 1,0000
   y por eso no se pueden derivar uno del otro). Se pega una vez por canal.

   ── El número ──
   Es el único lugar donde se puede meter un error caro y silencioso, porque
   "1.500" puede ser mil quinientos (Excel en español) o uno con cinco. La
   regla que se aplica:
     · tiene coma Y punto  → el que está más a la derecha es el decimal
     · solo coma           → decimal (es-AR: 1500,50)
     · solo punto, con forma 1.234 / 1.234.567 → separador de miles
     · solo punto, cualquier otra forma (1500.5) → decimal
   El caso ambiguo de verdad es "1.500": gana miles, que es lo que sale de
   Excel en español y lo que va a pegar la administración. Por eso la vista
   previa muestra el número YA interpretado — se ve antes de aplicar, y
   después otra vez en la grilla con los precios por canal calculados. ── */
function B2BPegarPreciosModal({ items, canales = [], onClose, onAplicar }) {
  const [texto, setTexto]     = useState('');
  const [destino, setDestino] = useState('base');

  const parsearNumero = (crudo) => {
    let s = String(crudo).replace(/[^0-9.,-]/g, '').trim();   // fuera $ y espacios
    if (!s) return null;
    const tieneComa  = s.includes(',');
    const tienePunto = s.includes('.');
    if (tieneComa && tienePunto) {
      const decSep = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
      const milSep = decSep === ',' ? '.' : ',';
      s = s.split(milSep).join('');
      s = s.replace(decSep, '.');
    } else if (tieneComa) {
      s = s.replace(',', '.');
    } else if (tienePunto && /^-?\d{1,3}(\.\d{3})+$/.test(s)) {
      s = s.split('.').join('');
    }
    const n = Number(s);
    return isFinite(n) ? n : null;
  };

  /* Index por SKU en minúscula: quien copia de Excel no controla mayúsculas. */
  const porSku = useMemo(() => {
    const m = {};
    (items || []).forEach(it => { m[String(it.sku).trim().toLowerCase()] = it; });
    return m;
  }, [items]);

  const analisis = useMemo(() => {
    const ok = [], sinSku = [], sinNumero = [], repetidos = [];
    const vistos = new Set();
    (texto || '').split(/\r?\n/).forEach(linea => {
      const l = linea.trim();
      if (!l) return;
      /* Una sola regla, en este orden: el SKU es lo primero de la línea, el
         precio es lo primero que viene después del separador, y todo lo demás
         se descarta. Partir por "cualquier separador" y quedarse con el último
         campo parecía más flexible pero leía mal "MES-120-BL 45.000,50": lo
         cortaba en tres y se quedaba con 50. Acá el precio se toma entero. */
      const m = l.match(/^([^\s,;]+)[\s,;]+(.+)$/);
      if (!m) { sinNumero.push(l); return; }
      const skuCrudo = m[1];
      const it = porSku[skuCrudo.toLowerCase()];
      if (!it) { sinSku.push(skuCrudo); return; }
      /* Se saca el símbolo de moneda ANTES de cortar por espacio: si no,
         "$ 45.000" cortaba en "$" y la línea se descartaba. */
      const precio = parsearNumero(m[2].trim().replace(/^[^\d,.-]+/, '').trim().split(/\s+/)[0]);
      if (precio === null || precio < 0) { sinNumero.push(l); return; }
      if (vistos.has(it.sku)) { repetidos.push(it.sku); return; }
      vistos.add(it.sku);
      const anterior = destino === 'base'
        ? it.precio_base
        : (it.precios_lista ? it.precios_lista[destino] : null);
      ok.push({ sku: it.sku, modelo: it.modelo, precio, anterior });
    });
    return { ok, sinSku, sinNumero, repetidos };
  }, [texto, porSku, destino]);

  const canalDestino = canales.find(c => c.codigo === destino) || null;
  const Cmp = window.Modal;

  return (
    <Cmp open={true} title="Pegar precios" onClose={onClose} footer={
      <>
        <button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" disabled={analisis.ok.length === 0}
                onClick={() => onAplicar?.(analisis.ok, destino)}>
          <Icon n="check" s={14}/> Cargar {analisis.ok.length || ''} precio{analisis.ok.length === 1 ? '' : 's'}
        </button>
      </>
    }>
      <div className="field-group">
        <label className="field-label">¿A qué columna van estos precios?</label>
        <select className="field-input" value={destino} onChange={e => setDestino(e.target.value)}>
          <option value="base">Precio de lista (de acá salen todos los canales)</option>
          {canales.map(c => (
            <option key={c.codigo} value={c.codigo}>
              Precio propio de {c.nombre}
            </option>
          ))}
        </select>
        <div className="field-help">
          {canalDestino
            ? `Estos precios los va a pagar ${canalDestino.nombre} tal cual, sin pasar por el coeficiente ×${Number(canalDestino.coeficiente).toFixed(2)}. Los demás canales no se tocan.`
            : 'Cada canal va a pagar este precio multiplicado por su coeficiente, salvo los que tengan precio propio cargado.'}
        </div>
      </div>

      <div className="field-group">
        <label className="field-label">
          Pegá dos columnas: SKU y precio{canalDestino ? ` de ${canalDestino.nombre}` : ' de lista'}
        </label>
        <textarea className="field-input" rows={8} autoFocus
                  style={{fontFamily:'ui-monospace, monospace', fontSize:12}}
                  placeholder={'MES-120-BL\t45000\nSIL-EAM-NE\t28500,50\nBIB-180-RO\t112.000'}
                  value={texto} onChange={e => setTexto(e.target.value)}/>
        <div className="field-help">
          Sale directo de copiar dos columnas de Excel. También sirve separado por
          punto y coma o por coma. Los SKU que no estén en el catálogo se ignoran.
        </div>
      </div>

      {texto.trim() && (
        <div className="field-group">
          <div style={{fontSize:12, marginBottom:8}}>
            <b>{analisis.ok.length}</b> para cargar
            {analisis.sinSku.length > 0 && (
              <span style={{color:'#b45309', marginLeft:10}}>
                {analisis.sinSku.length} SKU que no existe{analisis.sinSku.length === 1 ? '' : 'n'}
              </span>
            )}
            {analisis.sinNumero.length > 0 && (
              <span style={{color:'var(--red)', marginLeft:10}}>
                {analisis.sinNumero.length} sin precio válido
              </span>
            )}
            {analisis.repetidos.length > 0 && (
              <span style={{color:'#b45309', marginLeft:10}}>
                {analisis.repetidos.length} repetido{analisis.repetidos.length === 1 ? '' : 's'} (vale el primero)
              </span>
            )}
          </div>

          {analisis.ok.length > 0 && (
            <div style={{maxHeight:200, overflowY:'auto', border:'1px solid var(--line, #e5e7eb)',
                         borderRadius:8}}>
              <table className="data-table" style={{margin:0}}>
                <thead>
                  <tr><th>SKU</th><th>Producto</th><th style={{textAlign:'right'}}>Ahora</th>
                      <th style={{textAlign:'right'}}>Queda en</th></tr>
                </thead>
                <tbody>
                  {analisis.ok.map(r => (
                    <tr key={r.sku}>
                      <td><span className="order-num">{r.sku}</span></td>
                      <td style={{fontSize:12}}>{r.modelo || '—'}</td>
                      <td style={{textAlign:'right', color:'var(--ink-muted)'}}>
                        {r.anterior === null || r.anterior === undefined
                          ? '—' : window.B2B_DATA.money(r.anterior)}
                      </td>
                      <td style={{textAlign:'right', fontWeight:600}}>{window.B2B_DATA.money(r.precio)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {analisis.sinSku.length > 0 && (
            <div style={{marginTop:8, fontSize:11, color:'var(--ink-muted)', lineHeight:1.5}}>
              <b>No están en el catálogo:</b> {analisis.sinSku.slice(0, 12).join(', ')}
              {analisis.sinSku.length > 12 && ` y ${analisis.sinSku.length - 12} más`}
            </div>
          )}

          <div style={{marginTop:10, fontSize:11, color:'var(--ink-muted)', lineHeight:1.5}}>
            Esto no guarda nada todavía: los precios quedan en el borrador de la
            grilla, con lo que paga cada canal ya calculado. Se revisa y recién
            ahí se aprieta “Guardar cambios”.
          </div>
        </div>
      )}
    </Cmp>
  );
}

/* ── Modal: cómo se vende un producto ─────────────────────────────────
   El precio se carga en la grilla, por lote, porque son 61 SKU y se pegan
   de Excel. Lo de acá es lo contrario: se toca una vez por producto y casi
   nunca se vuelve a mirar (una mesa se vende de a 1, un juego de patas de
   a 4). Por eso no está en la grilla — sumaba cuatro columnas numéricas a
   la pantalla donde hay que cargar precios sin equivocarse.

   Las cuatro reglas son las que el backend hace cumplir al comprar y otra
   vez al enviar: si el múltiplo es 4, el mayorista no puede pedir 6. Que
   se puedan editar acá es lo que hace que esa validación exista de verdad
   — antes quedaban clavadas en el default (×1, sin mínimo) y no había
   pantalla para cambiarlas.

   Guarda de a un producto y directo (no entra al borrador de la grilla):
   son cambios puntuales, y mezclarlos con el lote de precios hacía que un
   error de tipeo en el IVA volteara la carga de 61 precios. ── */
function B2BProductoVentaModal({ item, onClose, onGuardado }) {
  const toast = useToast();
  const Cmp = window.Modal;
  const fileRef = useRef(null);

  const [f, setF] = useState(() => ({
    multiplo_venta: item.multiplo_venta ?? 1,
    minimo_sku:     item.minimo_sku ?? 0,
    bulto_cantidad: item.bulto_cantidad ?? 1,
    unidad_venta:   item.unidad_venta || 'unidad',
    iva_pct:        item.iva_pct ?? 21,
    descripcion:    item.descripcion || '',
    foto_path:      item.foto_path || null,
  }));
  const [guardando, setGuardando] = useState(false);
  const [subiendo, setSubiendo]   = useState(false);

  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));

  const nMul = Number(f.multiplo_venta), nMin = Number(f.minimo_sku);
  const nBul = Number(f.bulto_cantidad), nIva = Number(f.iva_pct);

  const errores = [];
  if (!Number.isInteger(nMul) || nMul < 1) errores.push('El múltiplo tiene que ser un entero de 1 o más.');
  if (!Number.isInteger(nMin) || nMin < 0) errores.push('El mínimo tiene que ser un entero de 0 o más.');
  if (!Number.isInteger(nBul) || nBul < 1) errores.push('El bulto tiene que ser un entero de 1 o más.');
  if (!isFinite(nIva) || nIva < 0 || nIva > 100) errores.push('El IVA va entre 0 y 100.');

  /* Múltiplo 4 con mínimo 10 no es un error, pero el primer pedido posible
     son 12 y conviene decirlo antes que lo descubra el mayorista. */
  const primeraCompra = (errores.length === 0 && nMul >= 1)
    ? nMul * Math.ceil(Math.max(nMin, 1) / nMul) : null;

  const subirFoto = async (file) => {
    if (!file) return;
    setSubiendo(true);
    try {
      const path = await window.B2B_DATA.subirFotoProducto(item.sku, file);
      set('foto_path', path);
      toast.success('Foto subida — falta guardar');
    } catch (err) {
      toast.error(err?.message || 'No se pudo subir la foto');
    } finally {
      setSubiendo(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const guardar = async () => {
    if (guardando || errores.length > 0) return;
    setGuardando(true);
    try {
      await window.B2B_DATA.setProducto({
        sku: item.sku,
        multiplo_venta: nMul,
        minimo_sku: nMin,
        bulto_cantidad: nBul,
        unidad_venta: (f.unidad_venta || 'unidad').trim() || 'unidad',
        iva_pct: nIva,
        descripcion: f.descripcion,          // mandarla vacía la borra (operador ? del backend)
        foto_path: f.foto_path,
      });
      toast.success('Producto actualizado');
      onGuardado?.();
    } catch (err) {
      toast.error(err?.message || 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  };

  const urlFoto = f.foto_path ? window.B2B_DATA.fotoUrl(f.foto_path) : null;

  return (
    <Cmp open={true} title={`Cómo se vende ${item.sku}`} onClose={onClose} footer={
      <>
        <button className="btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
        <button className="btn-primary" onClick={guardar} disabled={guardando || errores.length > 0}>
          {guardando ? 'Guardando…' : (<><Icon n="check" s={14}/> Guardar</>)}
        </button>
      </>
    }>
      <div style={{fontSize:12, color:'var(--ink-muted)', marginBottom:14, lineHeight:1.5}}>
        <b style={{color:'var(--ink)'}}>{item.modelo || item.sku}</b>
        {[item.categoria, item.color].filter(Boolean).length > 0 &&
          ` · ${[item.categoria, item.color].filter(Boolean).join(' · ')}`}
        <div style={{marginTop:4}}>
          Estas reglas las controla el servidor al agregar al carrito y otra vez
          al enviar el pedido. El precio se carga en la grilla, no acá.
        </div>
      </div>

      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
        <div className="field-group">
          <label className="field-label">Se vende de a (múltiplo)</label>
          <input className="field-input" type="number" min={1} step={1}
                 value={f.multiplo_venta}
                 onChange={e => set('multiplo_venta', e.target.value === '' ? '' : Number(e.target.value))}/>
          <div className="field-help">Con 4, el cliente puede pedir 4, 8, 12 — no 6.</div>
        </div>

        <div className="field-group">
          <label className="field-label">Mínimo por producto</label>
          <input className="field-input" type="number" min={0} step={1}
                 value={f.minimo_sku}
                 onChange={e => set('minimo_sku', e.target.value === '' ? '' : Number(e.target.value))}/>
          <div className="field-help">0 = sin mínimo propio.</div>
        </div>

        <div className="field-group">
          <label className="field-label">Unidades por bulto</label>
          <input className="field-input" type="number" min={1} step={1}
                 value={f.bulto_cantidad}
                 onChange={e => set('bulto_cantidad', e.target.value === '' ? '' : Number(e.target.value))}/>
          <div className="field-help">Solo informativo, para armar el remito.</div>
        </div>

        <div className="field-group">
          <label className="field-label">IVA %</label>
          <input className="field-input" type="number" min={0} max={100} step="0.01"
                 value={f.iva_pct}
                 onChange={e => set('iva_pct', e.target.value === '' ? '' : Number(e.target.value))}/>
          <div className="field-help">21 salvo excepción.</div>
        </div>
      </div>

      <div className="field-group">
        <label className="field-label">Unidad de venta</label>
        <input className="field-input" type="text" maxLength={20}
               value={f.unidad_venta}
               onChange={e => set('unidad_venta', e.target.value)}
               placeholder="unidad"/>
        <div className="field-help">Cómo se cuenta: unidad, juego, par, metro.</div>
      </div>

      {primeraCompra !== null && primeraCompra > 1 && (
        <div style={{fontSize:12, background:'#fffbeb', border:'1px solid #fde68a',
                     borderRadius:8, padding:'8px 10px', marginBottom:12}}>
          Con estas reglas, el pedido más chico posible de este producto es de{' '}
          <b>{primeraCompra}</b> {f.unidad_venta || 'unidad'}{primeraCompra === 1 ? '' : 'es'}.
        </div>
      )}

      <div className="field-group">
        <label className="field-label">Descripción para la tienda</label>
        <textarea className="field-input" rows={3} maxLength={400}
                  value={f.descripcion}
                  onChange={e => set('descripcion', e.target.value)}
                  placeholder="Opcional. Lo ve el mayorista en la ficha del producto."/>
      </div>

      <div className="field-group">
        <label className="field-label">Foto</label>
        <div style={{display:'flex', alignItems:'center', gap:12}}>
          {urlFoto
            ? <img src={urlFoto} alt={item.sku}
                   style={{width:72, height:72, objectFit:'cover', borderRadius:8,
                           border:'1px solid var(--line, #e5e7eb)'}}/>
            : <div style={{width:72, height:72, borderRadius:8, display:'flex',
                           alignItems:'center', justifyContent:'center',
                           border:'1px dashed var(--line, #e5e7eb)', color:'var(--ink-muted)'}}>
                <Icon n="package" s={20}/>
              </div>}
          <div style={{display:'flex', flexDirection:'column', gap:6}}>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp"
                   style={{display:'none'}}
                   onChange={e => subirFoto(e.target.files && e.target.files[0])}/>
            <button className="btn-ghost" disabled={subiendo}
                    onClick={() => fileRef.current && fileRef.current.click()}>
              <Icon n="upload" s={13}/> {subiendo ? 'Subiendo…' : (f.foto_path ? 'Cambiar foto' : 'Subir foto')}
            </button>
            {f.foto_path && (
              <button className="btn-ghost" disabled={subiendo}
                      onClick={() => set('foto_path', null)}>
                Quitar
              </button>
            )}
          </div>
        </div>
        <div className="field-help">JPG, PNG o WEBP, hasta 2 MB.</div>
      </div>

      {errores.length > 0 && (
        <div style={{fontSize:12, color:'var(--red)', lineHeight:1.6}}>
          {errores.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}
    </Cmp>
  );
}

window.B2BCatalogoTab = B2BCatalogoTab;
