/* ══ TIENDA · MI RESUMEN ══════════════════════════════════════════════════
   Lo que el cliente compró, leído como negocio y no como lista de pedidos.

   No hay backend nuevo. TODO sale de b2b_rpc_mis_pedidos, la misma llamada
   que ya hace "Mis pedidos" y la franja de "Comprá de nuevo": trae cada
   pedido con su fecha, su estado, sus totales y sus renglones. Con eso
   alcanza para el gasto por mes, el ticket promedio, el ranking de productos
   y el reparto por estado. Agregar una RPC de estadísticas habría sido pedir
   dos veces lo mismo y tener dos verdades que se pueden desincronizar.

   El catálogo se pide aparte y SOLO para las fotos y el nombre de vitrina del
   ranking. Si esa llamada falla, el resumen se muestra igual con los datos
   que ya venían en los renglones del pedido: es un adorno, no un requisito.

   Plata: siempre el NETO (total_neto), sin IVA. Es la misma vara con la que
   se mide el mínimo de compra en el catálogo y en el carrito. Mezclar netos
   con IVA incluido en la misma pantalla es la forma más rápida de que el
   cliente crea que le estamos cobrando de más.

   Los anulados no suman en ningún número. Se muestran aparte, al pie del
   reparto por estado, porque esconderlos hace que las cuentas no cierren
   contra "Mis pedidos", donde el cliente los sigue viendo.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Fechas ────────────────────────────────────────────────────────────
   Todo el agrupado por mes se hace sobre la fecha LOCAL del navegador, no
   sobre el string ISO en UTC: un pedido enviado el 31 a las 22:00 hora
   argentina es de ese mes para el cliente, aunque en UTC ya sea el 1. */
const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
                     'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                     'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const claveMes  = (d) => d.getFullYear() * 12 + d.getMonth();
const mesDesde  = (k) => ({ anio: Math.floor(k / 12), mes: k % 12 });
const rotuloMes = (k) => { const m = mesDesde(k); return MESES_LARGO[m.mes] + ' de ' + m.anio; };

const aFecha = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d) ? null : d;
};

const diasEntre = (a, b) => Math.round((b - a) / 86400000);

/* Plata en formato corto para los números grandes de arriba. money() con dos
   decimales da "$12.345.678,00", que en una ficha de 160px se corta o se
   achica hasta no leerse. El importe exacto siempre está a un renglón de
   distancia (el pie de la ficha, el gráfico, "Mis pedidos"). */
const montoCorto = (n) => {
  const v = Number(n);
  if (!isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1000000) return '$' + (v / 1000000).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + ' M';
  if (abs >= 10000)   return '$' + Math.round(v / 1000).toLocaleString('es-AR') + ' mil';
  return money(v);
};

/* ── El cálculo ────────────────────────────────────────────────────────
   Una sola pasada por el historial que deja armado todo lo que dibujan los
   bloques de abajo. Está afuera de los componentes a propósito: así se puede
   leer (y probar) sin React encima.                                       */
const resumirCompras = (pedidos, catalogo) => {
  const porSku = new Map();
  (catalogo || []).forEach(p => { if (p && p.sku) porSku.set(p.sku, p); });

  const validos  = (pedidos || []).filter(p => p && p.estado !== 'anulado');
  const anulados = (pedidos || []).filter(p => p && p.estado === 'anulado');

  const meses    = new Map();   // clave numérica de mes -> { total, unidades, pedidos }
  const prods    = new Map();   // sku -> { unidades, gastado, pedidos }
  const estados  = new Map();   // estado -> { cant, total }
  let total = 0, unidades = 0;
  const fechas = [];

  validos.forEach(ped => {
    const neto = Number(ped.total_neto) || 0;
    const uni  = Number(ped.unidades) || 0;
    total += neto;
    unidades += uni;

    const e = estados.get(ped.estado) || { cant: 0, total: 0 };
    e.cant += 1; e.total += neto;
    estados.set(ped.estado, e);

    const d = aFecha(ped.enviado_at);
    if (d) {
      fechas.push(d);
      const k = claveMes(d);
      const m = meses.get(k) || { total: 0, unidades: 0, pedidos: 0 };
      m.total += neto; m.unidades += uni; m.pedidos += 1;
      meses.set(k, m);
    }

    ((ped.items) || []).forEach(it => {
      if (!it || !it.sku) return;
      const s = prods.get(it.sku) || {
        sku: it.sku, modelo: it.modelo, color: it.color,
        unidades: 0, gastado: 0, pedidos: 0,
      };
      s.unidades += Number(it.cantidad) || 0;
      s.gastado  += Number(it.subtotal) || 0;
      s.pedidos  += 1;
      prods.set(it.sku, s);
    });
  });

  /* La serie del gráfico se rellena mes a mes hasta hoy. Sin los ceros, dos
     pedidos separados por medio año quedan pegados y parece que compró todos
     los meses. El hueco es información. */
  const hoy    = claveMes(new Date());
  /* Math.min por si algún enviado_at quedó adelantado (reloj del servidor,
     una carga manual): sin el tope, `desde` se pasaría de `hoy` y el for
     de abajo no daría ni una vuelta — gráfico vacío sin motivo visible. */
  const arranq = fechas.length ? Math.min(hoy, claveMes(new Date(Math.min.apply(null, fechas)))) : hoy;
  const desde  = Math.max(arranq, hoy - 11);
  const serie  = [];
  for (let k = desde; k <= hoy; k++) {
    const m = mesDesde(k);
    const v = meses.get(k) || { total: 0, unidades: 0, pedidos: 0 };
    serie.push({ clave: k, rotulo: MESES_CORTO[m.mes], anio: m.anio, mes: m.mes, ...v });
  }

  /* Cada cuánto compra: el promedio de los días que pasan entre un pedido y
     el siguiente. Con un solo pedido no hay intervalo y no se muestra nada,
     que es más honesto que inventar una periodicidad. */
  fechas.sort((a, b) => a - b);
  let cadaDias = null;
  if (fechas.length >= 2) {
    const span = diasEntre(fechas[0], fechas[fechas.length - 1]);
    cadaDias = Math.max(1, Math.round(span / (fechas.length - 1)));
  }

  const top = Array.from(prods.values())
    .map(s => {
      const c = porSku.get(s.sku);
      return { ...s, modelo: (c && c.modelo) || s.modelo, color: (c && c.color) || s.color,
               foto: c ? urlFoto(c.foto_path) : null };
    })
    .sort((a, b) => b.gastado - a.gastado);

  return {
    cant: validos.length,
    total, unidades,
    promedio: validos.length ? total / validos.length : 0,
    primero: fechas.length ? fechas[0] : null,
    ultimo:  fechas.length ? fechas[fechas.length - 1] : null,
    diasUltimo: fechas.length ? diasEntre(fechas[fechas.length - 1], new Date()) : null,
    cadaDias,
    serie,
    top,
    estados: Array.from(estados.entries())
      .map(([estado, v]) => ({ estado, ...v }))
      .sort((a, b) => b.cant - a.cant),
    anulados: { cant: anulados.length, total: anulados.reduce((a, p) => a + (Number(p.total_neto) || 0), 0) },
  };
};

/* ── Una cifra grande ──────────────────────────────────────────────────── */
const ResKpi = ({ icono, rotulo, valor, pie, fuerte }) => (
  <div className={'t-res-kpi' + (fuerte ? ' t-res-kpi-fuerte' : '')}>
    <div className="t-res-kpi-ico"><Icon n={icono} s={16}/></div>
    <span className="t-res-kpi-rot">{rotulo}</span>
    <b className="t-res-kpi-val">{valor}</b>
    {pie && <span className="t-res-kpi-pie">{pie}</span>}
  </div>
);

/* ── Gasto mes a mes ───────────────────────────────────────────────────
   Barras en CSS, no una librería de gráficos: la tienda no tiene build y
   sumar un <script> más para doce rectángulos es caro por todos lados.
   Al pasar por arriba (o tocar, en el celular) la lectura de arriba cambia:
   ahí va el importe exacto, que en la barra no entra.                     */
const ResGrafico = ({ serie }) => {
  const ultimoCon = serie.reduce((acc, m, i) => (m.total > 0 ? i : acc), serie.length - 1);
  const [foco, setFoco] = useState(null);
  const i = foco === null ? ultimoCon : foco;
  const act  = serie[i] || serie[serie.length - 1];
  const prev = serie[i - 1];
  const tope = Math.max.apply(null, serie.map(m => m.total).concat([1]));

  /* Comparación contra el mes anterior. Solo si el anterior tuvo movimiento:
     "+∞%" respecto de un mes en cero no dice nada. */
  const delta = (act && prev && prev.total > 0)
    ? Math.round(((act.total - prev.total) / prev.total) * 100)
    : null;

  return (
    <div className="t-res-graf">
      <div className="t-res-graf-lectura">
        <div>
          <span className="t-res-graf-mes">{act ? rotuloMes(act.clave) : '—'}</span>
          <b className="t-res-graf-val">{money(act ? act.total : 0)}</b>
        </div>
        <div className="t-res-graf-costado">
          {delta !== null && (
            <span className={'t-res-delta ' + (delta >= 0 ? 't-res-delta-sube' : 't-res-delta-baja')}>
              <Icon n="trend" s={13}/>
              {(delta >= 0 ? '+' : '') + delta + '% vs ' + MESES_LARGO[prev.mes]}
            </span>
          )}
          <span className="t-res-graf-pie">
            {act && act.pedidos
              ? num(act.pedidos) + (act.pedidos === 1 ? ' pedido · ' : ' pedidos · ') + num(act.unidades) + ' u.'
              : 'Sin pedidos este mes'}
          </span>
        </div>
      </div>

      <div className="t-res-barras" role="list">
        {serie.map((m, idx) => (
          <button key={m.clave} type="button" role="listitem"
                  className={'t-res-col' + (idx === i ? ' t-res-col-on' : '') + (m.total > 0 ? '' : ' t-res-col-cero')}
                  onMouseEnter={() => setFoco(idx)} onFocus={() => setFoco(idx)}
                  onMouseLeave={() => setFoco(null)} onBlur={() => setFoco(null)}
                  onClick={() => setFoco(idx)}
                  title={rotuloMes(m.clave) + ': ' + money(m.total)}
                  aria-label={rotuloMes(m.clave) + ': ' + money(m.total)}>
            <span className="t-res-col-caja">
              {/* Mínimo 3px aunque sea cero: la columna tiene que existir para
                  poder tocarla y para que se vea que ese mes no quedó afuera. */}
              <i className="t-res-barra" style={{ height: Math.max(3, (m.total / tope) * 100) + '%' }}/>
            </span>
            <span className="t-res-col-rot">{m.rotulo}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

/* ── Ranking de productos ──────────────────────────────────────────────
   Ordenado por plata gastada y no por unidades: es lo que contesta "¿en qué
   se me va el pedido?". Las unidades van igual en el renglón, porque para
   reponer stock esa es la cifra que importa. */
const ResTop = ({ top }) => {
  const tope = Math.max.apply(null, top.map(t => t.gastado).concat([1]));
  return (
    <ol className="t-res-top">
      {top.map((t, i) => (
        <li key={t.sku} className="t-res-top-fila">
          <span className="t-res-top-pos">{i + 1}</span>
          <span className="t-res-top-foto">
            {t.foto
              ? <img src={t.foto} alt="" loading="lazy"/>
              : <Icon n="box" s={16} c="var(--ink-faint)"/>}
          </span>
          <span className="t-res-top-cuerpo">
            <b className="t-res-top-nom">{(t.modelo || t.sku) + (t.color ? ' · ' + t.color : '')}</b>
            <span className="t-res-top-pista">
              <i className="t-res-top-relleno" style={{ width: ((t.gastado / tope) * 100) + '%' }}/>
            </span>
            <span className="t-res-top-datos">{num(t.unidades)} u. en {num(t.pedidos)} {t.pedidos === 1 ? 'pedido' : 'pedidos'}</span>
          </span>
          <b className="t-res-top-monto">{money(t.gastado)}</b>
        </li>
      ))}
    </ol>
  );
};

/* ── En qué anda cada pedido ───────────────────────────────────────────
   Los colores y los rótulos son los MISMOS que los chips de "Mis pedidos"
   (ESTADO_CLIENTE): si acá el verde fuera otro estado que allá, el cliente
   tendría que aprender dos idiomas para la misma información.             */
const ResEstados = ({ estados, cant, anulados }) => (
  <div className="t-res-estados">
    <div className="t-res-cinta">
      {estados.map(e => {
        const c = ESTADO_CLIENTE[e.estado] || { bg: 'var(--border-md)', fg: 'var(--ink)', label: e.estado };
        return (
          <i key={e.estado} className="t-res-cinta-seg"
             style={{ width: ((e.cant / Math.max(1, cant)) * 100) + '%', background: c.fg }}
             title={c.label + ': ' + num(e.cant)}/>
        );
      })}
    </div>
    <ul className="t-res-leyenda">
      {estados.map(e => {
        const c = ESTADO_CLIENTE[e.estado] || { fg: 'var(--ink)', label: e.estado };
        return (
          <li key={e.estado} className="t-res-leyenda-it">
            <i className="t-res-punto" style={{ background: c.fg }}/>
            <span>{c.label}</span>
            <b>{num(e.cant)}</b>
            <em>{money(e.total)}</em>
          </li>
        );
      })}
    </ul>
    {anulados.cant > 0 && (
      <p className="t-res-nota">
        Además tenés {num(anulados.cant)} {anulados.cant === 1 ? 'pedido anulado' : 'pedidos anulados'} por{' '}
        {money(anulados.total)}. {anulados.cant === 1 ? 'No está sumado' : 'No están sumados'} en
        ninguno de los números de arriba.
      </p>
    )}
  </div>
);

/* ══ Pantalla ═══════════════════════════════════════════════════════════ */
const PantallaResumen = ({ cuenta, recargarSenal, onIrCatalogo, onVerPedidos }) => {
  const [pedidos, setPedidos]   = useState(null);
  const [catalogo, setCatalogo] = useState([]);
  const [error, setError]       = useState(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const p = await window.B2B_DATA.misPedidos({});
        if (vivo) { setPedidos(p || []); setError(null); }
      } catch (e) {
        if (vivo) { setPedidos([]); setError(e.message || 'No se pudo cargar tu resumen.'); }
      }
    })();
    return () => { vivo = false; };
  }, [recargarSenal]);

  /* El catálogo es solo para las fotos del ranking: falla en silencio. */
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const c = await window.B2B_DATA.catalogo({});
        if (vivo) setCatalogo(c || []);
      } catch (e) { if (vivo) setCatalogo([]); }
    })();
    return () => { vivo = false; };
  }, [cuenta && cuenta.canal]);

  const r = useMemo(() => resumirCompras(pedidos, catalogo), [pedidos, catalogo]);

  if (pedidos === null) return <Spinner texto="Armando tu resumen…"/>;

  if (error && !pedidos.length) {
    return <Aviso tipo="error" titulo="No pudimos armar tu resumen">{error}</Aviso>;
  }

  /* Sin compras válidas hay dos situaciones distintas y conviene no
     confundirlas: el que nunca pidió nada, y el que pidió pero se le anuló
     todo. Al segundo decirle "cuando nos mandes tu primer pedido" le suena a
     que el sistema se olvidó de lo que pasó. */
  if (!r.cant) {
    const soloAnulados = r.anulados.cant > 0;
    return (
      <Vacio icono="chart" titulo={soloAnulados ? 'Todavía no hay compras para resumir'
                                                : 'Todavía no hay nada para resumir'}>
        {soloAnulados
          ? <>
              {r.anulados.cant === 1 ? 'Tu único pedido hasta ahora fue anulado, '
                                     : 'Tus ' + num(r.anulados.cant) + ' pedidos hasta ahora fueron anulados, '}
              así que no hay compras para sumar. En cuanto entre uno nuevo, acá vas a ver
              cuánto llevás comprado, en qué se te va y cómo viene mes a mes.
            </>
          : <>
              Cuando nos mandes tu primer pedido, acá vas a ver cuánto llevás comprado,
              en qué se te va, cómo viene mes a mes y en qué anda cada pedido.
            </>}
        <br/>
        <button className="t-btn t-btn-primary t-res-cta" onClick={onIrCatalogo}>
          Ver el catálogo
        </button>
      </Vacio>
    );
  }

  /* El nombre lindo del canal sale de la lista habilitada del cliente, que es
     la misma que alimenta el selector del header. canalInfo() no sirve acá:
     tiene los textos de la pantalla de elección, no el rótulo. */
  const canales = (cuenta && cuenta.cliente && cuenta.cliente.canales) || [];
  const canalAct = canales.find(c => c && c.codigo === (cuenta && cuenta.canal)) || null;
  const canalTxt = (canalAct && canalAct.nombre) || (cuenta && cuenta.canal) || null;

  return (
    <div className="t-res">
      <header className="t-res-hero">
        <div>
          <h1 className="t-res-h1">Tu resumen</h1>
          <p className="t-res-sub">
            Todo lo que {(cuenta && cuenta.cliente && cuenta.cliente.nombre) || 'tu empresa'} lleva comprado
            {r.primero ? ' desde ' + rotuloMes(claveMes(r.primero)) : ''}.
            {canalTxt ? ' Precios del catálogo ' + String(canalTxt).toLowerCase() + '.' : ''}
          </p>
        </div>
        <button className="t-btn t-btn-ghost t-res-verpedidos" onClick={onVerPedidos}>
          <Icon n="history" s={15}/> Ver mis pedidos
        </button>
      </header>

      <div className="t-res-kpis">
        <ResKpi fuerte icono="dollar" rotulo="Total comprado"
                valor={montoCorto(r.total)} pie={money(r.total) + ' sin IVA'}/>
        <ResKpi icono="history" rotulo="Pedidos"
                valor={num(r.cant)}
                pie={r.diasUltimo === null ? null
                     : r.diasUltimo === 0 ? 'El último, hoy'
                     : 'El último, hace ' + num(r.diasUltimo) + (r.diasUltimo === 1 ? ' día' : ' días')}/>
        <ResKpi icono="chart" rotulo="Promedio por pedido"
                valor={montoCorto(r.promedio)} pie={money(r.promedio) + ' sin IVA'}/>
        <ResKpi icono="package" rotulo="Unidades" valor={num(r.unidades)}
                pie={r.cadaDias ? 'Comprás cada ' + num(r.cadaDias) + ' días aprox.' : 'Piezas en total'}/>
      </div>

      <section className="t-res-panel">
        <div className="t-res-panel-head">
          <h2 className="t-res-panel-tit"><Icon n="calendar" s={16}/> Mes a mes</h2>
          <span className="t-res-panel-baj">Tocá un mes para ver el detalle</span>
        </div>
        <ResGrafico serie={r.serie}/>
      </section>

      <div className="t-res-cols">
        <section className="t-res-panel">
          <div className="t-res-panel-head">
            <h2 className="t-res-panel-tit"><Icon n="box" s={16}/> En qué se te va el pedido</h2>
            <span className="t-res-panel-baj">Tus {Math.min(6, r.top.length)} productos de mayor gasto</span>
          </div>
          <ResTop top={r.top.slice(0, 6)}/>
        </section>

        <section className="t-res-panel">
          <div className="t-res-panel-head">
            <h2 className="t-res-panel-tit"><Icon n="clock" s={16}/> En qué anda cada pedido</h2>
            <span className="t-res-panel-baj">Sobre {num(r.cant)} {r.cant === 1 ? 'pedido' : 'pedidos'}</span>
          </div>
          <ResEstados estados={r.estados} cant={r.cant} anulados={r.anulados}/>
        </section>
      </div>

      <p className="t-res-legal">
        Los importes son netos, sin IVA — la misma base con la que se mide el mínimo de compra.
        Si algo no te cierra contra tu cuenta corriente, escribinos y lo revisamos.
      </p>
    </div>
  );
};

window.TiendaResumen = { PantallaResumen, resumirCompras, montoCorto };
