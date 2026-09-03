/* ══ TIENDA · MIS FACTURAS ════════════════════════════════════════════════
   El archivero del mayorista. Todo lo que el equipo le fue cargando —
   facturas, notas de crédito, recibos, remitos — junto y descargable.

   El espejo exacto de "Adjuntar comprobante de pago": allá sube el cliente
   y mira el equipo; acá sube el equipo y baja el cliente. Misma idea, misma
   plomería (bucket privado + URL firmada), sentido contrario.

   De dónde sale cada cosa:
     · Esta pantalla    → b2b_rpc_mis_facturas, el historial completo.
     · Dentro del pedido → la clave 'facturas' que b2b_rpc_mis_pedidos ya
       trae adentro de cada pedido, así que "Mis pedidos" no pide nada extra.

   Quién ve qué NO se decide acá. La regla vive en la base: la política de
   b2b_factura y la del bucket comparan la carpeta del archivo contra
   b2b_fn_cliente_actual(). Aunque esta pantalla pidiera de más, el backend
   no lo devuelve.

   Va ANTES de tienda-pedidos.jsx en el HTML: la tarjeta del pedido usa
   FacturaCliente para el botón de descarga.
   ═══════════════════════════════════════════════════════════════════════ */

const FACTURA_TIPO_TXT = {
  factura:      'Factura',
  nota_credito: 'Nota de crédito',
  recibo:       'Recibo',
  remito:       'Remito',
  otro:         'Comprobante',
};

/* La fecha viene como 'YYYY-MM-DD' (date, sin hora). Pasarla por new Date()
   la lee como medianoche UTC y la muestra un día antes. Se parte a mano. */
const facFecha = (iso) => {
  if (!iso) return '';
  const p = String(iso).slice(0, 10).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : '';
};

const facAnio = (f) => {
  const s = f.fecha || f.created_at || '';
  return String(s).slice(0, 4) || '—';
};

const facPeso = (bytes) => {
  const n = Number(bytes);
  if (!isFinite(n) || n <= 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / (1024 * 1024)).toFixed(1).replace('.', ',') + ' MB';
};

/* ── Una factura, con su botón de bajarla ─────────────────────────────
   El bucket es privado: la URL se pide en el click y vive 10 minutos. Se
   dispara con un <a download> de mentira porque después del await el
   navegador ya no lo toma como un click de verdad y lo frena igual que un
   pop-up. El nombre del archivo se arma del lado nuestro (Factura-A-0001-
   00001234.pdf) para que en la carpeta de Descargas se entienda qué es:
   el nombre original suele ser "documento(3).pdf". ── */
const FacturaCliente = ({ f, compacto }) => {
  const [bajando, setBajando] = useState(false);
  const toast = useToast();

  const bajar = async () => {
    if (bajando) return;
    setBajando(true);
    try {
      const nombre = window.B2B_DATA.facturaNombreArchivo(f);
      const url = await window.B2B_DATA.facturaUrl(f.path, nombre);
      if (!url) throw new Error('No pudimos abrir el archivo.');
      const a = document.createElement('a');
      a.href = url; a.download = nombre;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (e) {
      toast.error(e.message || 'No pudimos descargar la factura.');
    } finally { setBajando(false); }
  };

  const detalle = [
    facFecha(f.fecha),
    f.total != null ? money(f.total) : '',
    !compacto && f.pedido_numero ? 'Pedido ' + f.pedido_numero : '',
    facPeso(f.size_bytes),
  ].filter(Boolean).join(' · ');

  return (
    <li className="t-comprobante t-fac">
      <span className="t-comprobante-ico">
        <Icon n="file" s={15} c="var(--ink-muted)"/>
      </span>
      <div className="t-comprobante-txt">
        <b>
          <span className={'t-fac-tipo' + (f.tipo === 'nota_credito' ? ' es-nc' : '')}>
            {FACTURA_TIPO_TXT[f.tipo] || 'Comprobante'}
          </span>
          {f.numero ? ' ' + f.numero : ' sin número'}
        </b>
        <span>{detalle}</span>
        {f.nota && <span className="t-fac-nota">{f.nota}</span>}
      </div>
      <button className="t-btn t-btn-ghost t-btn-mini" onClick={bajar} disabled={bajando}>
        <Icon n="download" s={13}/> {bajando ? 'Bajando…' : 'Descargar'}
      </button>
    </li>
  );
};

/* ── La lista suelta, para meter adentro de la tarjeta de un pedido ── */
const ListaFacturas = ({ facturas }) => {
  if (!facturas || !facturas.length) return null;
  return (
    <ul className="t-comprobantes">
      {facturas.map(f => <FacturaCliente key={f.id} f={f} compacto/>)}
    </ul>
  );
};

/* ══ Pantalla ═══════════════════════════════════════════════════════════
   Tres números arriba y la lista agrupada por año abajo. Los números salen
   de sumar lo que hay en pantalla, no de una consulta aparte: una sola
   fuente, imposible que digan cosas distintas.

   Las notas de crédito NO se restan del total facturado, se muestran
   aparte. Restarlas daría un "neto" que el cliente iba a comparar contra el
   de su contador, y el de su contador incluye cosas que este sistema no
   conoce. Mejor dos números ciertos que uno interpretado.
   ═══════════════════════════════════════════════════════════════════════ */
const PantallaFacturas = ({ recargarSenal, onIrPedidos }) => {
  const [facturas, setFacturas] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');

  const cargar = useCallback(async () => {
    try {
      const data = await window.B2B_DATA.misFacturas({});
      setFacturas(data); setError(null);
    } catch (e) {
      setFacturas([]); setError(e.message || 'No pudimos cargar tus facturas.');
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar, recargarSenal]);

  const resumen = useMemo(() => {
    const lista = facturas || [];
    let facturado = 0, credito = 0, conImporte = 0;
    lista.forEach(f => {
      const t = Number(f.total);
      if (!isFinite(t) || f.total == null) return;
      conImporte++;
      if (f.tipo === 'nota_credito') credito += t; else facturado += t;
    });
    return { total: lista.length, facturado, credito, conImporte,
             ultima: lista.length ? (lista[0].fecha || lista[0].created_at) : null };
  }, [facturas]);

  /* Busca por número, por pedido y por tipo. El cliente que entra acá
     normalmente viene con un número escrito en un mail del contador. */
  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return facturas || [];
    return (facturas || []).filter(f =>
      window.buscaEn(t, f.numero, f.pedido_numero, FACTURA_TIPO_TXT[f.tipo], f.nota));
  }, [facturas, q]);

  /* Agrupado por año, y solo si hay más de uno: con un año solo el título
     repetido arriba de la lista no informa nada. */
  const grupos = useMemo(() => {
    const map = new Map();
    filtradas.forEach(f => {
      const a = facAnio(f);
      if (!map.has(a)) map.set(a, []);
      map.get(a).push(f);
    });
    return Array.from(map.entries());
  }, [filtradas]);

  if (facturas === null) return <Spinner texto="Buscando tus facturas…"/>;
  if (error) return <Aviso tipo="error" titulo="No pudimos cargar tus facturas">{error}</Aviso>;

  if (!facturas.length) {
    return (
      <Vacio icono="file" titulo="Todavía no tenés facturas cargadas">
        Cuando facturemos un pedido tuyo, el comprobante aparece acá y lo
        podés descargar cuando quieras. También te avisamos por mail.
        {onIrPedidos && (
          <div style={{marginTop:14}}>
            <button className="t-btn t-btn-ghost" onClick={onIrPedidos}>Ver mis pedidos</button>
          </div>
        )}
      </Vacio>
    );
  }

  return (
    <div className="t-facturas">
      <div className="t-fac-tarjetas">
        <div className="t-fac-tarjeta">
          <span>Comprobantes</span>
          <b>{num(resumen.total)}</b>
        </div>
        <div className="t-fac-tarjeta">
          <span>Facturado</span>
          <b>{money(resumen.facturado)}</b>
        </div>
        {resumen.credito > 0 ? (
          <div className="t-fac-tarjeta">
            <span>Notas de crédito</span>
            <b>{money(resumen.credito)}</b>
          </div>
        ) : (
          <div className="t-fac-tarjeta">
            <span>Última</span>
            <b>{facFecha(resumen.ultima) || '—'}</b>
          </div>
        )}
      </div>

      {resumen.conImporte < resumen.total && (
        <p className="t-fac-aclara">
          El total suma los {num(resumen.conImporte)} comprobantes que tienen
          importe cargado. Los demás están para descargar igual.
        </p>
      )}

      <div className="t-fac-buscar">
        <Icon n="search" s={15} c="var(--ink-muted)"/>
        <input className="t-input" value={q} onChange={e => setQ(e.target.value)}
               placeholder="Buscar por número, pedido o tipo…"/>
      </div>

      {filtradas.length === 0 ? (
        <div className="t-fac-nada">
          Ninguna factura coincide con “{q.trim()}”.
        </div>
      ) : (
        grupos.map(([anio, lista]) => (
          <div key={anio} className="t-fac-grupo">
            {grupos.length > 1 && <span className="t-label-mini">{anio}</span>}
            <ul className="t-comprobantes">
              {lista.map(f => <FacturaCliente key={f.id} f={f}/>)}
            </ul>
          </div>
        ))
      )}

      <p className="t-fac-pie">
        Las emitimos nosotros y las subimos acá apenas están. Si te falta
        alguna o hay algo que no cierra, escribinos y lo revisamos.
      </p>
    </div>
  );
};

window.TiendaFacturas = { PantallaFacturas, ListaFacturas, FacturaCliente, FACTURA_TIPO_TXT };
