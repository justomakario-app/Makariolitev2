/* ══ TIENDA · CATÁLOGO ════════════════════════════════════════════════════
   Lo que el cliente ve para comprar.

   ★ El precio SIEMPRE viene calculado del servidor. b2b_rpc_catalogo
   devuelve 'precio' y 'precio_con_iva' ya multiplicados por el coeficiente
   del canal, y NUNCA manda precio_base ni el coeficiente. Por eso acá no
   hay una sola multiplicacion de precios: si algun dia alguien agrega una,
   estaria filtrando el margen — dos clientes de canales distintos reciben
   numeros distintos por la misma llamada y ninguno puede deducir el del
   otro. Es el corazon del aislamiento por canal.

   El catalogo entero son ~61 SKU, asi que se baja una vez y se filtra en el
   browser. Buscar no dispara un request por tecla.
   ═══════════════════════════════════════════════════════════════════════ */

/* Bucket de las fotos de producto. Existe desde 0156 y es publico, que es lo
   que hace que getPublicUrl() de abajo sirva (en un bucket privado devuelve
   una URL que da 400). Lo confidencial de esta tienda no es la foto — es el
   precio, y el precio nunca sale del catalogo sin filtrar por canal.
   `foto_path` admite DOS formas: una ruta del bucket (lo que sube el dueño
   desde el panel) o una URL absoluta a una foto de afuera — hoy la mayoria
   apunta a la tienda publica justomakario.com, que es donde ya estaban las
   fotos de los mismos SKU. urlFoto() de abajo resuelve las dos.
   El que se queda sin foto muestra el recuadro vacio, que es deliberado: una
   tienda sin fotos se usa igual, una con fotos rotas no. */
const BUCKET_FOTOS = 'b2b_fotos';

const urlFoto = (path) => {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  try {
    const { data } = window.SUPA.storage.from(BUCKET_FOTOS).getPublicUrl(path);
    return (data && data.publicUrl) || null;
  } catch (e) { return null; }
};

/* ── Selector de cantidad ──────────────────────────────────────────────
   Los pasos respetan el multiplo de venta: si el producto se vende de a 6,
   el "+" suma 6. Escribir a mano tambien se permite, y al salir del campo
   se redondea al valor valido mas cercano hacia arriba (ajustarCantidad).
   Es la misma regla que valida el backend con errcode 22023.            */
const Cantidad = ({ prod, valor, onChange, chico }) => {
  const { paso, inicial } = reglaSku(prod);
  const [texto, setTexto] = useState(String(valor || ''));

  useEffect(() => { setTexto(valor ? String(valor) : ''); }, [valor]);

  const aplicar = (n) => {
    const v = Math.max(0, n);
    onChange(v === 0 ? 0 : ajustarCantidad(v, prod));
  };

  return (
    <div className={'t-cant' + (chico ? ' t-cant-chico' : '')}>
      <button type="button" className="t-cant-btn" aria-label="Restar"
              disabled={!valor}
              onClick={() => aplicar((Number(valor) || 0) - paso)}>
        <Icon n="minus" s={14}/>
      </button>
      <input className="t-cant-input" inputMode="numeric" value={texto}
             aria-label="Cantidad"
             placeholder={String(inicial)}
             onChange={e => setTexto(e.target.value.replace(/[^\d]/g, ''))}
             onBlur={() => aplicar(Number(texto) || 0)}
             onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }}/>
      <button type="button" className="t-cant-btn" aria-label="Sumar"
              onClick={() => aplicar((Number(valor) || 0) + paso)}>
        <Icon n="plus" s={14}/>
      </button>
    </div>
  );
};

/* ── Tarjeta de producto ───────────────────────────────────────────────── */
const TarjetaProducto = ({ prod, enCarrito, onSetCantidad, ocupado }) => {
  const [cant, setCant] = useState(0);
  const foto = urlFoto(prod.foto_path);
  const regla = textoRegla(prod);
  const { inicial } = reglaSku(prod);

  const agregar = () => {
    const q = cant || inicial;
    onSetCantidad(prod.sku, (enCarrito || 0) + q);
    setCant(0);
  };

  return (
    <article className="t-prod">
      <div className="t-prod-foto">
        {foto
          ? <img src={foto} alt={prod.modelo || prod.sku} loading="lazy"/>
          : <div className="t-prod-sinfoto"><Icon n="box" s={26} c="var(--ink-faint)"/></div>}
        {enCarrito > 0 && (
          <span className="t-prod-encarrito"><Icon n="check" s={12}/> {num(enCarrito)} en el pedido</span>
        )}
      </div>

      <div className="t-prod-cuerpo">
        <h3 className="t-prod-nombre">{prod.modelo || prod.sku}</h3>

        <div className="t-prod-meta">
          {prod.color && (
            <span className="t-prod-color">
              {prod.color_hex && <i className="t-swatch" style={{ background: prod.color_hex }}/>}
              {prod.color}
            </span>
          )}
          <span className="t-prod-sku">{prod.sku}</span>
        </div>

        {prod.descripcion && <p className="t-prod-desc">{prod.descripcion}</p>}

        <div className="t-prod-precio">
          <b>{money(prod.precio)}</b>
          <span className="t-prod-iva">{money(prod.precio_con_iva)} con IVA</span>
        </div>

        {regla && <div className="t-prod-regla">{regla}</div>}

        <div className="t-prod-accion">
          <Cantidad prod={prod} valor={cant} onChange={setCant}/>
          <button className="t-btn t-btn-primary" onClick={agregar} disabled={ocupado}>
            <Icon n="plus" s={14}/> Agregar
          </button>
        </div>
      </div>
    </article>
  );
};

/* ── Aviso de compra mínima ────────────────────────────────────────────
   El mínimo del canal se avisaba SOLO en el carrito: el cliente cargaba diez
   productos y recién al final se enteraba de que no llegaba. Esta barra lo
   acompaña mientras compra, así la restricción no es una sorpresa al final.

   Hace la MISMA cuenta que el carrito a propósito — neto sin IVA, sumando
   `subtotal` — porque dos lugares mostrando números distintos del mismo
   pedido es peor que no mostrarlo. Si el canal no tiene mínimo (0 =
   desactivado, que es como estuvo hasta que el dueño pasó los montos) no se
   muestra nada.                                                          */
const BarraMinimo = ({ carrito, onIrCarrito }) => {
  const minMonto = Number(carrito && carrito.minimo_pedido) || 0;
  const minUnid  = Number(carrito && carrito.minimo_unidades) || 0;
  if (!minMonto && !minUnid) return null;

  const items = (carrito && carrito.items) || [];
  const neto  = items.reduce((a, i) => a + (Number(i.subtotal)  || 0), 0);
  const unid  = items.reduce((a, i) => a + (Number(i.cantidad) || 0), 0);

  const faltaMonto = minMonto > 0 && neto < minMonto;
  const faltaUnid  = minUnid  > 0 && unid < minUnid;
  const vacio = !items.length;
  const listo = !faltaMonto && !faltaUnid && !vacio;

  /* Con los dos mínimos activos manda el que va más atrasado: es el que
     decide si puede enviar, así que es el que hay que mostrar. */
  const avances = [];
  if (minMonto > 0) avances.push(neto / minMonto);
  if (minUnid  > 0) avances.push(unid / minUnid);
  const pct = Math.min(100, Math.round(Math.min.apply(null, avances) * 100));

  /* Lo que falta, dicho en las unidades que le faltan y no en porcentaje. */
  const faltan = [];
  if (faltaMonto) faltan.push(money(minMonto - neto));
  if (faltaUnid) {
    const n = minUnid - unid;
    faltan.push(num(n) + (n === 1 ? ' unidad' : ' unidades'));
  }

  /* El mínimo enunciado entero, para cuando el pedido todavía está vacío. */
  const enunciado = [];
  if (minMonto > 0) enunciado.push(money(minMonto) + ' + IVA');
  if (minUnid  > 0) enunciado.push(num(minUnid) + (minUnid === 1 ? ' unidad' : ' unidades'));

  return (
    <div className={'t-barramin' + (listo ? ' t-barramin-ok' : '')}
         role="status" aria-live="polite">
      <div className="t-barramin-in">
        <span className="t-barramin-icono">
          <Icon n={listo ? 'check' : 'cart'} s={15}/>
        </span>

        <div className="t-barramin-txt">
          {vacio ? (
            <>
              <b>Mínimo de compra: {enunciado.join(' y ')}</b>
              <span>{minMonto > 0 ? 'Se mide sobre el neto, sin IVA.' : 'Agregá productos para empezar.'}</span>
            </>
          ) : listo ? (
            <>
              <b>Llegaste al mínimo</b>
              <span>Ya podés enviar tu pedido cuando quieras.</span>
            </>
          ) : (
            <>
              <b>Te falta {faltan.join(' y ')} para el mínimo</b>
              <span>
                {minMonto > 0
                  ? 'Llevás ' + money(neto) + ' netos de ' + money(minMonto)
                  : 'Llevás ' + num(unid) + ' de ' + num(minUnid) + ' unidades'}
              </span>
            </>
          )}
        </div>

        {!vacio && (
          <>
            <div className="t-barramin-barra" aria-hidden="true">
              <i style={{ width: pct + '%' }}/>
            </div>
            <button className={'t-btn ' + (listo ? 't-btn-primary' : 't-btn-ghost')}
                    onClick={onIrCarrito}>
              Ver mi pedido
            </button>
          </>
        )}
      </div>
    </div>
  );
};

/* ══ Catálogo ═══════════════════════════════════════════════════════════ */
const PantallaCatalogo = ({ carrito, onSetCantidad, ocupado, onIrCarrito }) => {
  const [items, setItems]   = useState(null);
  const [error, setError]   = useState(null);
  const [q, setQ]           = useState('');
  const [cat, setCat]       = useState(null);
  const toast = useToast();

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const data = await window.B2B_DATA.catalogo({});
        if (vivo) { setItems(data); setError(null); }
      } catch (e) {
        if (vivo) { setItems([]); setError(e.message || 'No se pudo cargar el catálogo.'); }
      }
    })();
    return () => { vivo = false; };
  }, []);

  /* Cantidad ya pedida por SKU, para marcarlo en la tarjeta. */
  const enCarrito = useMemo(() => {
    const m = {};
    ((carrito && carrito.items) || []).forEach(i => { m[i.sku] = i.cantidad; });
    return m;
  }, [carrito]);

  const categorias = useMemo(() => {
    const s = new Set();
    (items || []).forEach(i => { if (i.categoria) s.add(i.categoria); });
    return Array.from(s).sort();
  }, [items]);

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (items || []).filter(i => {
      if (cat && i.categoria !== cat) return false;
      if (!t) return true;
      return [i.sku, i.modelo, i.color, i.categoria, i.descripcion]
        .some(v => String(v || '').toLowerCase().includes(t));
    });
  }, [items, q, cat]);

  const setCantidad = async (sku, cantidad) => {
    try {
      await onSetCantidad(sku, cantidad);
      toast.success('Agregado al pedido.');
    } catch (e) {
      toast.error(e.message || 'No se pudo agregar.');
    }
  };

  if (items === null) return <Spinner texto="Cargando el catálogo…"/>;

  if (error) {
    return (
      <Aviso tipo="error" titulo="No pudimos cargar el catálogo">
        {error}
      </Aviso>
    );
  }

  if (!items.length) {
    return (
      <Vacio icono="box" titulo="Todavía no hay productos publicados">
        Estamos cargando el catálogo. Escribinos y te pasamos la lista mientras tanto.
      </Vacio>
    );
  }

  return (
    <div className="t-catalogo">
      <div className="t-filtros">
        <div className="t-buscador">
          <Icon n="search" s={16} c="var(--ink-muted)"/>
          <input className="t-buscador-input" value={q} onChange={e => setQ(e.target.value)}
                 placeholder="Buscar por modelo, color o código" aria-label="Buscar productos"/>
          {q && (
            <button className="t-icon-btn" onClick={() => setQ('')} aria-label="Limpiar búsqueda">
              <Icon n="x" s={14}/>
            </button>
          )}
        </div>

        {categorias.length > 1 && (
          <div className="t-chips">
            <button className={'t-chip' + (cat === null ? ' t-chip-on' : '')}
                    onClick={() => setCat(null)}>Todo</button>
            {categorias.map(c => (
              <button key={c} className={'t-chip' + (cat === c ? ' t-chip-on' : '')}
                      onClick={() => setCat(cat === c ? null : c)}>{c}</button>
            ))}
          </div>
        )}
      </div>

      {!visibles.length ? (
        <Vacio icono="search" titulo="No encontramos nada con eso">
          Probá con otra palabra o mirá todas las categorías.
        </Vacio>
      ) : (
        <>
          <div className="t-conteo">{num(visibles.length)} producto{visibles.length === 1 ? '' : 's'}</div>
          <div className="t-grilla">
            {visibles.map(p => (
              <TarjetaProducto key={p.sku} prod={p} enCarrito={enCarrito[p.sku] || 0}
                               onSetCantidad={setCantidad} ocupado={ocupado}/>
            ))}
          </div>
        </>
      )}

      <BarraMinimo carrito={carrito} onIrCarrito={onIrCarrito}/>
    </div>
  );
};

window.TiendaCatalogo = { PantallaCatalogo, TarjetaProducto, Cantidad, BarraMinimo, urlFoto, BUCKET_FOTOS };
