/* ══ MÉTRICAS SELLER — LA PANTALLA (0177) ═══════════════════════════════════════
   La pantalla del veredicto. Toda la aritmética vive en metricas-seller-motor.js;
   acá no se calcula nada, solo se lee y se dibuja.

   ── Qué tiene que lograr ──────────────────────────────────────────────

   Que alguien parado frente a la lista de precios de un proveedor sepa en
   tres segundos si comprar o no. Un solo número gigante — PAGÁ HASTA $X —
   y abajo la explicación para el que quiera discutirla.

   El resto de las planillas hacen lo contrario: 40 celdas del mismo
   tamaño y la conclusión escondida en la fila 38. Acá la jerarquía es
   deliberada: el techo ocupa la pantalla, el desglose está pero en
   segundo plano, y lo que no se sabe se dice que no se sabe.

   ── Las tres decisiones de diseño ─────────────────────────────────────

   1 · CUATRO COLORES, NO TRES. Verde / ámbar / rojo / GRIS. El gris es
       "falta un dato". Un semáforo de tres colores está obligado a
       elegir, y termina pintando de verde una cuenta a la que le falta el
       flete. Acá, si falta un dato, no hay veredicto: hay una lista de lo
       que falta.

   2 · LA CASCADA SE VE. Cada costo muestra su base, su divisor y el
       resultado: "envío 12.000 ÷ 0,94 = 12.766". Ver el divisor es ver
       por qué las devoluciones encarecen la unidad que NO se devolvió.
       Un número final solo se cree o no se cree; uno con su cuenta al
       lado se puede discutir.

   3 · EL DENOMINADOR SE ESCRIBE. La fórmula aparece literal en pantalla:
       precio = costos ÷ (1 − cargos − margen). Es el error que hace que
       una planilla prometa 20% y entregue pérdida, y la única forma de
       que no vuelva a pasar es que esté escrito donde se mira.

   ── Dónde se guarda ───────────────────────────────────────────────────

   localStorage, a propósito. Cero migraciones en la v0: los supuestos de
   impuestos y comisiones van a cambiar diez veces la primera semana y no
   tiene sentido que cada cambio sea un deploy. Cuando el modelo se
   estabilice, esto sube a Supabase.
   ═════════════════════════════════════════════════════════════════════ */

/* ── Plata y porcentajes, en argentino ── */
const revMoney = (n, dec) => {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  const s = Math.abs(v).toLocaleString('es-AR', {
    minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0,
  });
  return (v < 0 && s !== '0' ? '-$ ' : '$ ') + s;
};
const revPct = (n, dec) => {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  return (Number(n) * 100).toFixed(dec === undefined ? 1 : dec).replace('.', ',') + '%';
};
const revNum = (n, dec) => {
  if (!Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('es-AR', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec === undefined ? 2 : dec });
};

const REV_COLOR = {
  verde: { c: '#16A34A', bg: '#F0FDF4', label: 'Comprar' },
  ambar: { c: '#D97706', bg: '#FFFBEB', label: 'Al límite' },
  rojo:  { c: '#DC2626', bg: '#FEF2F2', label: 'No comprar' },
  gris:  { c: '#888888', bg: '#F5F5F5', label: 'Falta un dato' },
};

const REV_LS_CONFIG = 'makario_seller_config';
const REV_LS_FICHA  = 'makario_seller_ficha';
const REV_LS_LOTE   = 'makario_seller_lote';

function revLeer(clave, porDefecto) {
  try {
    const raw = localStorage.getItem(clave);
    return raw ? JSON.parse(raw) : porDefecto;
  } catch (e) { return porDefecto; }
}
function revGuardar(clave, valor) {
  try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (e) { /* modo privado */ }
}

/* ══ CAMPO ══════════════════════════════════════════════════════════════
   Un input que no pelea con quien escribe. Mientras el foco está adentro
   manda el texto tal cual se tipea; recién al salir se convierte a número.
   Si no, borrar el "0" para escribir "12" es imposible: el 0 vuelve solo.

   `supuesto` lo pinta en ámbar. Es el contrato con el dueño: todo lo que
   puse yo y él todavía no confirmó se ve distinto, y deja de verse
   distinto en cuanto lo toca. Un default que se lee como dato confirmado
   es peor que un campo vacío, porque nadie lo revisa. */
function RevCampo({ label, valor, onChange, tipo, ayuda, supuesto, sufijo, ancho }) {
  const [foco, setFoco] = useState(false);
  const [borrador, setBorrador] = useState('');

  const aTexto = (v) => {
    if (v === null || v === undefined || v === '') return '';
    if (tipo === 'pct') return String(Math.round(Number(v) * 10000) / 100).replace('.', ',');
    return String(v).replace('.', ',');
  };
  const aNumero = (t) => {
    const limpio = String(t).replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, '');
    if (limpio === '' || limpio === '-') return undefined;
    const v = Number(limpio);
    if (!Number.isFinite(v)) return undefined;
    return tipo === 'pct' ? v / 100 : v;
  };

  const mostrado = foco ? borrador : aTexto(valor);
  const vacio = valor === undefined || valor === null || valor === '';

  return (
    <label className={`rev-campo ${supuesto && !vacio ? 'es-supuesto' : ''}`} style={ancho ? { gridColumn: `span ${ancho}` } : null}>
      <span className="rev-campo-label">
        {label}
        {supuesto && <span className="rev-supuesto-dot" title="Supuesto mío, sin verificar. Tocalo para confirmarlo.">supuesto</span>}
      </span>
      <span className="rev-campo-caja">
        {tipo === 'money' && <span className="rev-campo-fijo">$</span>}
        <input
          type="text" inputMode="decimal" className="rev-campo-input"
          value={mostrado}
          placeholder={tipo === 'pct' ? '0,0' : '—'}
          onFocus={() => { setBorrador(aTexto(valor)); setFoco(true); }}
          onChange={e => { setBorrador(e.target.value); onChange(aNumero(e.target.value)); }}
          onBlur={() => setFoco(false)}/>
        {tipo === 'pct' && <span className="rev-campo-fijo">%</span>}
        {sufijo && <span className="rev-campo-fijo">{sufijo}</span>}
      </span>
      {ayuda && <span className="rev-campo-ayuda">{ayuda}</span>}
    </label>
  );
}

function RevCampoTexto({ label, valor, onChange, ancho, placeholder }) {
  return (
    <label className="rev-campo" style={ancho ? { gridColumn: `span ${ancho}` } : null}>
      <span className="rev-campo-label">{label}</span>
      <span className="rev-campo-caja">
        <input type="text" className="rev-campo-input" value={valor || ''}
               placeholder={placeholder || ''}
               onChange={e => onChange(e.target.value)}/>
      </span>
    </label>
  );
}

function RevCampoSelect({ label, valor, onChange, opciones, ayuda, ancho }) {
  return (
    <label className="rev-campo" style={ancho ? { gridColumn: `span ${ancho}` } : null}>
      <span className="rev-campo-label">{label}</span>
      <span className="rev-campo-caja">
        <select className="rev-campo-input" value={valor || ''} onChange={e => onChange(e.target.value)}>
          {opciones.map(o => <option key={o.v} value={o.v}>{o.t}</option>)}
        </select>
      </span>
      {ayuda && <span className="rev-campo-ayuda">{ayuda}</span>}
    </label>
  );
}

function RevCampoBool({ label, valor, onChange, ayuda }) {
  return (
    <label className="rev-campo rev-campo-bool">
      <input type="checkbox" checked={valor !== false} onChange={e => onChange(e.target.checked)}/>
      <span>
        <span className="rev-campo-label" style={{ margin: 0 }}>{label}</span>
        {ayuda && <span className="rev-campo-ayuda">{ayuda}</span>}
      </span>
    </label>
  );
}

/* ══ EL HERO ════════════════════════════════════════════════════════════
   El número que justifica que esto exista. Todo lo demás en la pantalla
   está para respaldarlo.

   Abajo, la barra: dónde cae el precio que pide el proveedor contra el
   techo. Es la misma información que el número, dicha de nuevo en forma
   de distancia — porque "62.480" no dice si estás cerca o lejos, y la
   barra sí. */
function RevHero({ r, costoPedido }) {
  const col = REV_COLOR[r.veredicto] || REV_COLOR.gris;
  const techo = r.techo_costo;
  const hayTecho = techo !== null && techo !== undefined && Number.isFinite(techo);
  const sobra = hayTecho && costoPedido > 0 ? techo - costoPedido : null;
  /* La barra llega al 100% cuando el proveedor pide exactamente el techo. */
  const llenado = hayTecho && costoPedido > 0 && techo > 0
    ? Math.min(costoPedido / techo, 1.35) : 0;

  return (
    <div className="rev-hero" style={{ background: col.bg, borderColor: col.c + '33' }}>
      <div className="rev-hero-main">
        <div className="rev-hero-kicker" style={{ color: col.c }}>
          <span className="rev-dot" style={{ background: col.c }}/>
          {col.label}
        </div>
        {r.veredicto === 'gris' ? (
          <>
            <div className="rev-hero-num rev-hero-num-gris">No alcanza para decidir</div>
            <div className="rev-hero-sub">
              Falta cargar: <strong>{r.faltantes.join(' · ')}</strong>
            </div>
          </>
        ) : hayTecho ? (
          <>
            <div className="rev-hero-label">Pagá hasta</div>
            <div className="rev-hero-num" style={{ color: col.c }}>{revMoney(techo)}</div>
            <div className="rev-hero-sub">por unidad, precio de lista con IVA</div>
          </>
        ) : (
          <>
            <div className="rev-hero-num rev-hero-num-gris">No hay techo posible</div>
            <div className="rev-hero-sub">
              A este precio de venta, los cargos y el margen mínimo no dejan lugar ni para un producto gratis.
            </div>
          </>
        )}
      </div>

      {costoPedido > 0 && hayTecho && (
        <div className="rev-hero-side">
          <div className="rev-hero-side-row">
            <span>El proveedor pide</span>
            <strong>{revMoney(costoPedido)}</strong>
          </div>
          <div className="rev-barra">
            <div className="rev-barra-fill" style={{
              width: `${Math.min(llenado, 1) * 100}%`,
              background: col.c,
            }}/>
            {llenado > 1 && (
              <div className="rev-barra-exceso" style={{ width: `${Math.min(llenado - 1, 0.35) * 100}%` }}/>
            )}
            <div className="rev-barra-techo" title="Techo"/>
          </div>
          <div className="rev-hero-side-row rev-hero-side-final" style={{ color: col.c }}>
            {sobra >= 0
              ? <><span>Te sobran</span><strong>{revMoney(sobra)}</strong></>
              : <><span>Hay que negociar</span><strong>{revMoney(-sobra)}</strong></>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ══ LOS TRES NÚMEROS ═══════════════════════════════════════════════════
   Margen, utilidad y ROI, cada uno contra su umbral. Un número solo no
   dice nada: 28% de margen puede ser excelente o un desastre según lo que
   se haya fijado como mínimo. Por eso siempre va el objetivo al lado. */
function RevMetricas({ r, cfg }) {
  /* Sin datos no hay número. Un "0,0%" con borde rojo se lee como un
     veredicto ("este producto pierde") cuando en realidad no se calculó
     nada todavía. */
  const vacio = r.veredicto === 'gris';
  const items = [
    { k: 'Margen',   v: revPct(r.margen), meta: `objetivo ${revPct(cfg.margen_objetivo, 0)}`,
      ok: r.margen >= cfg.margen_objetivo, mal: r.margen < cfg.margen_minimo },
    { k: 'Utilidad', v: revMoney(r.utilidad), meta: `mínimo ${revMoney(cfg.utilidad_minima_unidad)}`,
      ok: r.utilidad >= cfg.utilidad_minima_unidad, mal: r.utilidad <= 0 },
    { k: 'ROI',      v: revPct(r.roi), meta: `mínimo ${revPct(cfg.roi_minimo, 0)}`,
      ok: r.roi >= cfg.roi_minimo, mal: r.roi < 0 },
    { k: 'Precio sugerido', v: revMoney(r.precio_sugerido), meta: `para ${revPct(cfg.margen_objetivo, 0)} de margen`,
      neutro: true },
  ];
  return (
    <div className="rev-metricas">
      {items.map(it => (
        <div key={it.k} className={`rev-metrica ${(it.neutro || vacio) ? '' : it.mal ? 'mal' : it.ok ? 'bien' : 'medio'}`}>
          <div className="rev-metrica-k">{it.k}</div>
          <div className={`rev-metrica-v ${vacio ? 'vacio' : ''}`}>{vacio ? '—' : it.v}</div>
          <div className="rev-metrica-meta">{it.meta}</div>
        </div>
      ))}
    </div>
  );
}

/* ══ LA CASCADA ═════════════════════════════════════════════════════════
   El desglose que hace discutible el número. Cada costo con su divisor a
   la vista: no es lo mismo "envío 12.766" que "envío 12.000 ÷ 0,94".

   Lo segundo se puede pelear — "¿por qué 0,94?" — y esa pregunta lleva
   directo a la tasa de devoluciones, que es el parámetro que más mueve la
   cuenta y el que nadie mira. */
function RevCascada({ r, cfg }) {
  const conDivisor = r.detalle_fijos.filter(f => f.divisor < 0.9999);
  const mEf = r._debug.margen_efectivo_objetivo;
  const denom = 1 - r.cargos_pct - mEf;

  return (
    <div className="rev-panel">
      <div className="rev-panel-head">
        <h3>La cuenta</h3>
        <span className="rev-panel-nota">todo en neto de IVA</span>
      </div>

      {/* Costos fijos por unidad */}
      <table className="rev-tabla">
        <thead>
          <tr>
            <th>Costo por unidad</th>
            <th className="num">Base</th>
            <th className="num">÷</th>
            <th className="num">Costeado</th>
          </tr>
        </thead>
        <tbody>
          {r.detalle_fijos.map(f => (
            <tr key={f.id}>
              <td>{f.label}</td>
              <td className="num soft">{revMoney(f.base)}</td>
              <td className="num">
                {f.divisor < 0.9999
                  ? <span className="rev-divisor">{revNum(f.divisor, 3).replace('.', ',')}</span>
                  : <span className="soft">—</span>}
              </td>
              <td className="num strong">{revMoney(f.costeado)}</td>
            </tr>
          ))}
          <tr className="rev-tabla-total">
            <td>Costos fijos</td><td/><td/>
            <td className="num">{revMoney(r.costos_totales)}</td>
          </tr>
        </tbody>
      </table>

      {conDivisor.length > 0 && (
        <p className="rev-explica">
          <Icon n="info" s={13} c="var(--ink-muted)"/>
          <span>
            Los divisores son las devoluciones. De cada 100 unidades despachadas,{' '}
            <strong>{revNum(r._debug.d * 100, 0)}</strong> vuelven — el envío de ida
            de esas ya se pagó y el de vuelta lo paga el vendedor (ley 24.240, art. 34,
            no se puede renunciar). Ese costo no tiene a quién cobrárselo: lo pagan las
            ventas que quedaron firmes. Por eso se divide, nunca se multiplica.
          </span>
        </p>
      )}

      {/* Cargos sobre la venta — el denominador */}
      <table className="rev-tabla rev-tabla-pct">
        <thead>
          <tr>
            <th>Cargos sobre la venta</th>
            <th className="num">%</th>
            <th className="num">En pesos</th>
          </tr>
        </thead>
        <tbody>
          {r.detalle_pct.map(p => (
            <tr key={p.id}>
              <td>{p.label}</td>
              <td className="num soft">{revPct(p.costeado, 2)}</td>
              <td className="num">{revMoney(r.precio_neto * p.costeado)}</td>
            </tr>
          ))}
          <tr className="rev-tabla-total">
            <td>Total sobre la venta</td>
            <td className="num">{revPct(r.cargos_pct, 2)}</td>
            <td className="num">{revMoney(r.precio_neto * r.cargos_pct)}</td>
          </tr>
        </tbody>
      </table>

      {/* La fórmula, escrita. Es el corazón de todo esto. */}
      <div className="rev-formula">
        <div className="rev-formula-tit">Por qué estos van abajo y no arriba</div>
        <p>
          Son porcentajes <strong>de la venta</strong>: si subís el precio para cubrirlos,
          suben ellos también. Sumarlos al costo es la trampa que hace que una planilla
          prometa margen y entregue pérdida.
        </p>
        <div className="rev-formula-linea">
          <span>precio</span>
          <span className="op">=</span>
          <span className="frac">
            <span className="arriba">{revMoney(r.costos_totales)}</span>
            <span className="abajo">1 − {revPct(r.cargos_pct, 1)} − {revPct(mEf, 1)}</span>
          </span>
          <span className="op">=</span>
          <span className="res">{revMoney(r.precio_sugerido)}</span>
        </div>
        {denom <= 0 && (
          <div className="rev-formula-rota">
            El denominador dio {revNum(denom, 3)}. No existe ningún precio que cierre:
            cada peso que subas se lo comen los cargos. Hay que bajar el margen pedido,
            cambiar de canal o soltar el producto.
          </div>
        )}
        {mEf > cfg.margen_objetivo + 0.0001 && (
          <p className="rev-formula-nota">
            El margen del denominador es {revPct(mEf, 1)} y no {revPct(cfg.margen_objetivo, 1)}:
            se agranda para que, después de pagar Ganancias, quede limpio el que pediste.
          </p>
        )}
      </div>

      {/* Resultado */}
      <table className="rev-tabla rev-tabla-res">
        <tbody>
          <tr>
            <td>Venta neta (sin IVA)</td>
            <td className="num">{revMoney(r.precio_neto)}</td>
          </tr>
          <tr className="soft-row">
            <td>IVA débito (no es tuyo)</td>
            <td className="num soft">{revMoney(r.iva_debito)}</td>
          </tr>
          <tr>
            <td>Costos y cargos</td>
            <td className="num">{revMoney(-(r.costos_totales + r.precio_neto * r.cargos_pct))}</td>
          </tr>
          <tr>
            <td>Utilidad antes de impuesto</td>
            <td className="num">{revMoney(r.utilidad_antes_impuesto)}</td>
          </tr>
          <tr>
            <td>Ganancias ({revPct(cfg.ganancias_pct, 0)} sobre la utilidad)</td>
            <td className="num">{revMoney(-r.ganancias)}</td>
          </tr>
          <tr className="rev-tabla-total rev-final">
            <td>Utilidad neta por unidad</td>
            <td className="num">{revMoney(r.utilidad)}</td>
          </tr>
        </tbody>
      </table>

      {/* Las otras dos inversas */}
      <div className="rev-inversas">
        <div className="rev-inversa">
          <div className="rev-inversa-k">Precio piso</div>
          <div className="rev-inversa-v">{revMoney(r.precio_piso)}</div>
          <div className="rev-inversa-s">
            {r.descuento_maximo !== null
              ? `descuento máximo ${revPct(r.descuento_maximo, 1)} antes de trabajar gratis`
              : 'no hay precio que llegue a cero'}
          </div>
        </div>
        <div className="rev-inversa">
          <div className="rev-inversa-k">CPA máximo</div>
          <div className="rev-inversa-v">{revMoney(r.cpa_maximo_con_iva)}</div>
          <div className="rev-inversa-s">
            por venta traída con publicidad, con IVA, sin bajar del {revPct(cfg.margen_minimo, 0)}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══ ALERTAS ════════════════════════════════════════════════════════════
   Lo que el número no dice. Cada una es una cosa que puede hacer que la
   cuenta esté bien y el negocio igual salga mal. */
function RevAlertas({ r }) {
  /* Qué falta ya lo dice el hero, en grande. Repetirlo acá era la misma
     frase dos veces en la misma pantalla. */
  if (!r.alertas.length && r.faltantes.length) return null;
  if (!r.alertas.length) {
    return (
      <div className="rev-alertas">
        <div className="rev-alerta nivel-verde">
          <Icon n="check-circle" s={15} c="#16A34A"/>
          <span>Sin observaciones. Todos los datos cargados y ningún supuesto sin confirmar.</span>
        </div>
      </div>
    );
  }
  const icono = { rojo: 'alert', ambar: 'alert', gris: 'info', verde: 'check-circle' };
  return (
    <div className="rev-alertas">
      {r.alertas.map((a, i) => (
        <div key={i} className={`rev-alerta nivel-${a.nivel}`}>
          <Icon n={icono[a.nivel] || 'info'} s={15} c={(REV_COLOR[a.nivel] || REV_COLOR.gris).c}/>
          <span>{a.texto}</span>
        </div>
      ))}
    </div>
  );
}

/* ══ LA FICHA ═══════════════════════════════════════════════════════════ */
function RevFicha({ ficha, setFicha, cfg, resultado }) {
  const set = (k) => (v) => setFicha(f => Object.assign({}, f, { [k]: v }));
  const canales = Object.keys(window.SELLER.CANALES)
    .map(k => ({ v: k, t: window.SELLER.CANALES[k].label }));
  const canalCfg = window.SELLER.CANALES[ficha.canal] || {};

  return (
    <div className="rev-grid-2">
      <div className="rev-panel">
        <div className="rev-panel-head">
          <h3>El producto</h3>
        </div>
        <div className="rev-campos">
          <RevCampoTexto label="Nombre" valor={ficha.nombre} onChange={set('nombre')} ancho={2}
                         placeholder="Lámpara de pie nórdica"/>
          <RevCampoTexto label="SKU del proveedor" valor={ficha.sku} onChange={set('sku')}/>
          <RevCampo label="Precio de lista del proveedor" tipo="money"
                    valor={ficha.costo_proveedor} onChange={set('costo_proveedor')}
                    ayuda="Como está en la lista, con IVA"/>
          <RevCampoBool label="El proveedor da factura A"
                        valor={ficha.proveedor_factura_a} onChange={set('proveedor_factura_a')}
                        ayuda="Si da factura A y sos RI, el IVA de la compra es crédito fiscal y no es costo. Si no da, son 21 puntos que se pegan al costo."/>
          <RevCampo label="Flete de entrada del lote" tipo="money"
                    valor={ficha.costo_entrada_lote} onChange={set('costo_entrada_lote')}
                    ayuda="Se prorratea entre las unidades"/>
          <RevCampo label="Unidades del lote" tipo="entero"
                    valor={ficha.unidades_lote} onChange={set('unidades_lote')}/>
        </div>

        <div className="rev-panel-head rev-panel-head-mid">
          <h3>La venta</h3>
        </div>
        <div className="rev-campos">
          <RevCampo label="Precio de venta publicado" tipo="money" ancho={2}
                    valor={ficha.precio_venta} onChange={set('precio_venta')}
                    ayuda="Con IVA, como lo ve el comprador"/>
          <RevCampoSelect label="Canal" valor={ficha.canal} onChange={set('canal')}
                          opciones={canales} ancho={2}/>
          <RevCampo label="Comisión del canal" tipo="pct" supuesto={canalCfg._supuesto}
                    valor={ficha.comision_pct !== undefined ? ficha.comision_pct : canalCfg.comision_pct}
                    onChange={set('comision_pct')}
                    ayuda={canalCfg._supuesto ? 'Confirmala en la publicación real' : null}/>
          <RevCampo label="Cargo fijo por unidad" tipo="money"
                    valor={ficha.cargo_fijo} onChange={set('cargo_fijo')}/>
          <RevCampo label="Costo de envío al comprador" tipo="money"
                    valor={ficha.costo_envio} onChange={set('costo_envio')}/>
          <RevCampo label="Lo paga el vendedor" tipo="pct"
                    valor={ficha.pct_envio_a_cargo} onChange={set('pct_envio_a_cargo')}
                    ayuda="100% = envío gratis"/>
          <RevCampo label="Empaque por unidad" tipo="money"
                    valor={ficha.costo_empaque} onChange={set('costo_empaque')}/>
          <RevCampo label="Publicidad sobre la venta" tipo="pct"
                    valor={ficha.publicidad_pct} onChange={set('publicidad_pct')}
                    ayuda="ACOS"/>
        </div>

        <div className="rev-panel-head rev-panel-head-mid">
          <h3>Lo que sale mal</h3>
        </div>
        <div className="rev-campos">
          <RevCampo label="Devoluciones" tipo="pct" supuesto={ficha.tasa_devolucion === undefined}
                    valor={ficha.tasa_devolucion !== undefined ? ficha.tasa_devolucion : cfg.tasa_devolucion}
                    onChange={set('tasa_devolucion')}
                    ayuda="Art. 34: 10 días de arrepentimiento, flete de vuelta a tu cargo"/>
          <RevCampo label="De lo devuelto, se revende" tipo="pct"
                    valor={ficha.tasa_reventa_devuelto !== undefined ? ficha.tasa_reventa_devuelto : cfg.tasa_reventa_devuelto}
                    onChange={set('tasa_reventa_devuelto')}/>
          <RevCampo label="Envío de devolución" tipo="money"
                    valor={ficha.costo_envio_vuelta} onChange={set('costo_envio_vuelta')}
                    ayuda="Si se deja vacío, usa el de ida"/>
          <RevCampo label="Merma de depósito" tipo="pct"
                    valor={ficha.merma_pct !== undefined ? ficha.merma_pct : cfg.merma_pct}
                    onChange={set('merma_pct')}
                    ayuda="Rotura, robo, obsolescencia"/>
        </div>
      </div>

      <RevCascada r={resultado} cfg={cfg}/>
    </div>
  );
}

/* ══ EL LOTE ════════════════════════════════════════════════════════════
   El riesgo real de esta herramienta no es que la cuenta esté mal: es que
   nadie la use. Nadie carga 40 productos de a uno dos veces. Por eso la
   lista entera está desde el día uno y no en una v2 que no llega.

   Dos entradas, porque las dos pasan: el archivo del proveedor, y el
   copiar-pegar desde una planilla abierta. La segunda no necesita que el
   archivo exista ni que tenga el formato correcto. */

function revParsearPegado(texto) {
  const lineas = String(texto || '').split('\n').map(l => l.trim()).filter(Boolean);
  if (!lineas.length) return [];
  const partir = (l) => l.split(/\t|;|\s{2,}/).map(c => c.trim()).filter(c => c !== '');
  const aNum = (t) => {
    const limpio = String(t).replace(/[^0-9.,\-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
    const v = Number(limpio);
    return Number.isFinite(v) && limpio !== '' ? v : undefined;
  };
  /* Si la primera línea no tiene ningún número, es el encabezado. */
  const primera = partir(lineas[0]);
  const hayEncabezado = primera.every(c => aNum(c) === undefined);
  return lineas.slice(hayEncabezado ? 1 : 0).map(l => {
    const c = partir(l);
    const nums = c.map(aNum);
    const iCosto = nums.findIndex(n => n !== undefined);
    const iPrecio = nums.findIndex((n, i) => n !== undefined && i > iCosto);
    const textos = c.filter((_, i) => nums[i] === undefined);
    return {
      sku: textos.length > 1 ? textos[0] : '',
      nombre: textos.length > 1 ? textos.slice(1).join(' ') : (textos[0] || ''),
      costo_proveedor: iCosto >= 0 ? nums[iCosto] : undefined,
      precio_venta: iPrecio >= 0 ? nums[iPrecio] : undefined,
    };
  }).filter(f => f.nombre || f.costo_proveedor !== undefined);
}

/* Un número editable adentro de la tabla. Muestra "$ 35.000" mientras
   no se lo toca y deja tipear "35000" (o "35.000", o "35000,5") cuando
   sí. Si el costo y el techo están uno al lado del otro en formatos
   distintos, el ojo los compara mal. */
function RevInline({ valor, onChange, prefijo }) {
  const [foco, setFoco]   = useState(false);
  const [texto, setTexto] = useState('');
  const hay = valor !== undefined && valor !== null && valor !== '' && Number.isFinite(Number(valor));
  const mostrado = foco ? texto : (hay ? (prefijo ? prefijo + ' ' : '') + revNum(valor) : '');
  const entrar = () => { setTexto(hay ? String(valor).replace('.', ',') : ''); setFoco(true); };
  const cambiar = (e) => {
    const t = e.target.value;
    setTexto(t);
    const limpio = t.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
    if (limpio === '' || limpio === '-') { onChange(undefined); return; }
    const n = Number(limpio);
    if (Number.isFinite(n)) onChange(n);
  };
  return (
    <input className="rev-inline" value={mostrado} placeholder="—" inputMode="decimal"
           onFocus={entrar} onBlur={() => setFoco(false)} onChange={cambiar}/>
  );
}

function RevLote({ cfg, ficha }) {
  const [filas, setFilas]   = useState(() => revLeer(REV_LS_LOTE, []));
  const [pegado, setPegado] = useState('');
  const [orden, setOrden]   = useState('veredicto');
  const toast = useToast();

  useEffect(() => { revGuardar(REV_LS_LOTE, filas); }, [filas]);

  /* La configuración del lote es la ficha SIN lo que es de cada producto.
     El motor también los borra, pero dejarlo explícito acá evita que
     alguien "arregle" esto pasando la ficha entera. */
  const base = useMemo(() => {
    const b = Object.assign({}, cfg, ficha);
    delete b.costo_proveedor; delete b.precio_venta; delete b.sku; delete b.nombre;
    return b;
  }, [cfg, ficha]);

  /* Lo que la lista hereda de la ficha y todavía no está. Sin costo de
     envío todas las filas salen grises, y la nota de abajo culparía al
     costo o al precio de cada producto, que no tienen la culpa. */
  const faltaBase = useMemo(() => {
    const prueba = window.SELLER.calcular(Object.assign({}, base, { costo_proveedor: 1, precio_venta: 1 }));
    return prueba.faltantes || [];
  }, [base]);

  const resultados = useMemo(() => window.SELLER.calcularLote(filas, base), [filas, base]);
  const resumen    = useMemo(() => window.SELLER.resumenLote(resultados), [resultados]);

  const ordenados = useMemo(() => {
    const peso = { verde: 0, ambar: 1, gris: 2, rojo: 3 };
    const copia = resultados.slice();
    if (orden === 'veredicto') copia.sort((a, b) => (peso[a.veredicto] - peso[b.veredicto]) || (b.utilidad - a.utilidad));
    if (orden === 'utilidad')  copia.sort((a, b) => (b.utilidad || 0) - (a.utilidad || 0));
    if (orden === 'margen')    copia.sort((a, b) => (b.margen || 0) - (a.margen || 0));
    if (orden === 'sobra')     copia.sort((a, b) => ((b.techo_costo || 0) - (b.costo_proveedor || 0)) - ((a.techo_costo || 0) - (a.costo_proveedor || 0)));
    return copia;
  }, [resultados, orden]);

  const cargarPegado = () => {
    const nuevas = revParsearPegado(pegado);
    if (!nuevas.length) { toast.error('No se reconoció ninguna fila. Copiá las columnas desde el Excel.'); return; }
    setFilas(f => f.concat(nuevas));
    setPegado('');
    toast.success(`${nuevas.length} producto${nuevas.length === 1 ? '' : 's'} cargado${nuevas.length === 1 ? '' : 's'}`);
  };

  const cargarArchivo = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!window.XLSX) { toast.error('El lector de Excel no está disponible. Usá copiar y pegar.'); return; }
    try {
      const buf = await file.arrayBuffer();
      const wb = window.XLSX.read(buf, { type: 'array' });
      const hoja = wb.Sheets[wb.SheetNames[0]];
      const matriz = window.XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: '' });
      const texto = matriz.map(fila => fila.join('\t')).join('\n');
      const nuevas = revParsearPegado(texto);
      if (!nuevas.length) { toast.error('El archivo no tenía filas reconocibles.'); return; }
      setFilas(f => f.concat(nuevas));
      toast.success(`${nuevas.length} producto${nuevas.length === 1 ? '' : 's'} desde ${file.name}`);
    } catch (err) {
      toast.error('No se pudo leer el archivo: ' + (err.message || err));
    }
  };

  const editar = (i, k, v) => setFilas(f => f.map((x, j) => j === i ? Object.assign({}, x, { [k]: v }) : x));

  return (
    <div className="rev-lote">
      {faltaBase.length > 0 && (
        <div className="rev-alerta nivel-ambar">
          <Icon n="alert" s={15} c={REV_COLOR.ambar.c}/>
          <span>
            En la pestaña <strong>Producto</strong> falta cargar: <strong>{faltaBase.join(', ')}</strong>.
            La lista lo hereda de ahí, y sin eso ninguna fila puede tener veredicto.
          </span>
        </div>
      )}
      <div className="rev-panel">
        <div className="rev-panel-head">
          <h3>Cargar la lista del proveedor</h3>
          <span className="rev-panel-nota">SKU · nombre · costo · precio de venta</span>
        </div>
        <div className="rev-cargar">
          <textarea className="rev-pegar" rows={4} value={pegado}
                    placeholder={'Copiá las columnas desde el Excel y pegá acá.\nMAD132\tLámpara de pie\t40000\t129900'}
                    onChange={e => setPegado(e.target.value)}/>
          <div className="rev-cargar-btns">
            <button className="btn-primary" onClick={cargarPegado} disabled={!pegado.trim()}>
              <Icon n="plus" s={13}/> Cargar lo pegado
            </button>
            <label className="btn-ghost rev-file">
              <Icon n="upload" s={13}/> Abrir Excel
              <input type="file" accept=".xlsx,.xls,.csv" onChange={cargarArchivo} hidden/>
            </label>
            {filas.length > 0 && (
              <button className="btn-ghost" onClick={() => setFilas([])}>
                <Icon n="trash" s={13}/> Vaciar
              </button>
            )}
          </div>
        </div>
        <p className="rev-explica">
          <Icon n="info" s={13} c="var(--ink-muted)"/>
          <span>
            Todo lo que cargaste en la pestaña <strong>Producto</strong> — canal, envío,
            impuestos, devoluciones — se aplica a cada fila. Lo único que sale de la
            lista es el SKU, el nombre, el costo y el precio de venta.
          </span>
        </p>
      </div>

      {filas.length > 0 && (
        <>
          <div className="rev-resumen">
            {[['verde', 'Comprar'], ['ambar', 'Al límite'], ['rojo', 'No comprar'], ['gris', 'Falta un dato']].map(([k, t]) => (
              <div key={k} className="rev-resumen-item">
                <span className="rev-dot" style={{ background: REV_COLOR[k].c }}/>
                <strong>{resumen[k]}</strong> {t}
              </div>
            ))}
            <div className="rev-resumen-plata">
              <div className="rev-resumen-item">
                Utilidad del lote comprable <strong>{revMoney(resumen.utilidad_total)}</strong>
              </div>
              <div className="rev-resumen-item">
                ROI de cartera <strong>{revPct(resumen.roi_cartera)}</strong>
              </div>
            </div>
          </div>

          <div className="rev-panel">
            <div className="rev-panel-head">
              <h3>{filas.length} producto{filas.length === 1 ? '' : 's'}</h3>
              <div className="rev-orden">
                <span>Ordenar por</span>
                {[['veredicto', 'veredicto'], ['sobra', 'lo que sobra'], ['utilidad', 'utilidad'], ['margen', 'margen']].map(([v, t]) => (
                  <button key={v} className={`rev-orden-btn ${orden === v ? 'activo' : ''}`}
                          onClick={() => setOrden(v)}>{t}</button>
                ))}
              </div>
            </div>
            <div className="rev-tabla-scroll">
              <table className="rev-tabla rev-tabla-lote">
                <thead>
                  <tr>
                    <th/>
                    <th>Producto</th>
                    <th className="num">Pide</th>
                    <th className="num">Techo</th>
                    <th className="num">Diferencia</th>
                    <th className="num">Precio</th>
                    <th className="num">Margen</th>
                    <th className="num">Utilidad</th>
                    <th className="num">ROI</th>
                    <th/>
                  </tr>
                </thead>
                <tbody>
                  {ordenados.map(x => {
                    const col = REV_COLOR[x.veredicto] || REV_COLOR.gris;
                    const dif = (Number.isFinite(x.techo_costo) && x.costo_proveedor > 0)
                      ? x.techo_costo - x.costo_proveedor : null;
                    return (
                      <tr key={x._fila} className={`rev-fila-${x.veredicto}`}>
                        <td><span className="rev-dot" style={{ background: col.c }} title={col.label}/></td>
                        <td className="rev-td-producto">
                          <div className="rev-fila-nombre" title={x.nombre || ''}>{x.nombre || <em className="soft">sin nombre</em>}</div>
                          {x.sku && <div className="rev-fila-sku">{x.sku}</div>}
                        </td>
                        <td className="num">
                          <RevInline prefijo="$" valor={filas[x._fila].costo_proveedor}
                                     onChange={v => editar(x._fila, 'costo_proveedor', v)}/>
                        </td>
                        <td className="num strong" style={{ color: col.c }}>{revMoney(x.techo_costo)}</td>
                        <td className="num" style={{ color: dif === null ? 'var(--ink-faint)' : dif >= 0 ? '#16A34A' : '#DC2626' }}>
                          {dif === null ? '—' : (dif >= 0 ? '+' : '') + revMoney(dif)}
                        </td>
                        <td className="num">
                          <RevInline prefijo="$" valor={filas[x._fila].precio_venta}
                                     onChange={v => editar(x._fila, 'precio_venta', v)}/>
                        </td>
                        <td className="num">{x.veredicto === 'gris' ? '—' : revPct(x.margen)}</td>
                        <td className="num">{x.veredicto === 'gris' ? '—' : revMoney(x.utilidad)}</td>
                        <td className="num">{x.veredicto === 'gris' ? '—' : revPct(x.roi, 0)}</td>
                        <td>
                          <button className="btn-ghost-sm danger" title="Sacar de la lista"
                                  onClick={() => setFilas(f => f.filter((_, j) => j !== x._fila))}>
                            <Icon n="x" s={12}/>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {resumen.gris > 0 && (
              <p className="rev-explica">
                <Icon n="info" s={13} c="var(--ink-muted)"/>
                <span>
                  {resumen.gris} fila{resumen.gris === 1 ? '' : 's'} en gris: les falta el costo
                  o el precio. No están en rojo porque no sabemos si son malas —
                  no sabemos nada de ellas.
                </span>
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ══ CONFIGURACIÓN ══════════════════════════════════════════════════════
   Lo que vale para todos los productos: la situación fiscal, la provincia
   y los umbrales de decisión. Todo lo que está en ámbar lo puse yo y
   todavía no lo confirmó nadie. */
function RevConfig({ cfg, setCfg }) {
  const set = (k) => (v) => setCfg(c => Object.assign({}, c, { [k]: v, [`_tocado_${k}`]: true }));
  const sup = (k) => !cfg[`_tocado_${k}`];

  return (
    <div className="rev-grid-2">
      <div className="rev-panel">
        <div className="rev-panel-head">
          <h3>Situación fiscal</h3>
        </div>
        <div className="rev-campos">
          <RevCampoSelect label="Condición frente a ARCA" valor={cfg.condicion} onChange={set('condicion')}
                          ancho={2}
                          opciones={[{ v: 'ri', t: 'Responsable Inscripto' }, { v: 'monotributo', t: 'Monotributo' }]}/>
          <RevCampo label="IVA ventas" tipo="pct" valor={cfg.iva_ventas} onChange={set('iva_ventas')}/>
          <RevCampo label="IVA compras" tipo="pct" valor={cfg.iva_compra} onChange={set('iva_compra')}/>
          <RevCampo label="Ingresos Brutos" tipo="pct" supuesto={sup('iibb_pct')}
                    valor={cfg.iibb_pct} onChange={set('iibb_pct')}
                    ayuda="La alícuota de TU provincia y TU actividad. La que está es un supuesto."/>
          <RevCampo label="Ganancias" tipo="pct" valor={cfg.ganancias_pct} onChange={set('ganancias_pct')}
                    ayuda="Sobre la utilidad, no sobre la venta"/>
          <RevCampo label="Impuesto al cheque" tipo="pct" valor={cfg.deb_cred_pct} onChange={set('deb_cred_pct')}/>
        </div>

        <div className="rev-panel-head rev-panel-head-mid">
          <h3>Supuestos de operación</h3>
        </div>
        <div className="rev-campos">
          <RevCampo label="Devoluciones" tipo="pct" supuesto={sup('tasa_devolucion')}
                    valor={cfg.tasa_devolucion} onChange={set('tasa_devolucion')}/>
          <RevCampo label="De lo devuelto, se revende" tipo="pct" supuesto={sup('tasa_reventa_devuelto')}
                    valor={cfg.tasa_reventa_devuelto} onChange={set('tasa_reventa_devuelto')}/>
          <RevCampo label="Merma de depósito" tipo="pct" supuesto={sup('merma_pct')}
                    valor={cfg.merma_pct} onChange={set('merma_pct')}/>
          <RevCampo label="El canal reintegra la comisión" tipo="pct" supuesto={sup('canal_reintegra_comision')}
                    valor={cfg.canal_reintegra_comision} onChange={set('canal_reintegra_comision')}
                    ayuda="100% = te la devuelve entera cuando hay devolución"/>
        </div>
      </div>

      <div className="rev-panel">
        <div className="rev-panel-head">
          <h3>Cuándo comprar</h3>
          <span className="rev-panel-nota">los umbrales del semáforo</span>
        </div>
        <div className="rev-campos">
          <RevCampo label="Margen objetivo" tipo="pct" supuesto={sup('margen_objetivo')}
                    valor={cfg.margen_objetivo} onChange={set('margen_objetivo')}
                    ayuda="Debajo de esto, ámbar"/>
          <RevCampo label="Margen mínimo" tipo="pct" supuesto={sup('margen_minimo')}
                    valor={cfg.margen_minimo} onChange={set('margen_minimo')}
                    ayuda="Debajo de esto, rojo. Es el que fija el techo de costo."/>
          <RevCampo label="Utilidad mínima por unidad" tipo="money" supuesto={sup('utilidad_minima_unidad')}
                    valor={cfg.utilidad_minima_unidad} onChange={set('utilidad_minima_unidad')}
                    ayuda="Un 40% sobre algo de $2.000 no paga el trabajo de venderlo"/>
          <RevCampo label="ROI mínimo" tipo="pct" supuesto={sup('roi_minimo')}
                    valor={cfg.roi_minimo} onChange={set('roi_minimo')}
                    ayuda="Sobre la plata inmovilizada en el depósito"/>
        </div>

        <div className="rev-nota-supuestos">
          <div className="rev-nota-tit">
            <span className="rev-supuesto-dot">supuesto</span>
            Qué significa esta marca
          </div>
          <p>
            Los valores marcados los puse yo para que la pantalla arranque, no salieron
            de tus números. Mientras estén en ámbar, el veredicto es una estimación.
            En cuanto tocás el campo, deja de estar marcado.
          </p>
          <p>
            Los tres que más mueven el resultado, en orden: <strong>la comisión real
            del canal</strong> (cambia por categoría y por precio — miralo en la
            publicación), <strong>Ingresos Brutos de tu provincia</strong>, y{' '}
            <strong>la tasa de devoluciones</strong>, que no vas a saber hasta tener
            tres meses de ventas.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ══ CAMPAÑAS — LA TABLA DE DIAGNÓSTICO (0177-b) ════════════════════════
   La misma pregunta que el resto del módulo, del otro lado del mostrador.
   Arriba: cuánto puedo pagar por el producto. Acá: cuánto puedo pagar por
   la venta.

   ── Las dos decisiones que la hacen servir para decidir ──

   1 · EL ROAS OBJETIVO NO SE ESCRIBE. Sale del costo del producto. Toda
       tabla donde el objetivo se tipea permite ponerle 5x a algo que
       necesita 6,8x, y entonces una campaña que "le gana al objetivo por
       30%" pierde plata igual, con la fila pintada de verde. Acá la
       columna Objetivo es de solo lectura y abajo dice de dónde salió.

   2 · LA CONTRIBUCIÓN VA EN PESOS. Un ROAS más bajo con más ganancia
       total es un éxito, y ningún porcentaje puede decir eso. Además el
       "% de desvío" del cuadro original tiene el denominador en cero
       justo cuando más importa — cuando el objetivo es el equilibrio.

   Y el gris. Con tres ventas atribuidas el ROAS medido es ruido: la misma
   campaña podría estar en 2x o en 25x sin que pase nada raro. Pintarla de
   rojo es inventar un dato. Por eso cada fila muestra el intervalo, y
   cuando el intervalo cruza el umbral el veredicto es gris con el número
   de ventas que harían falta para que deje de serlo.
   ═══════════════════════════════════════════════════════════════════════ */

const CAMP_LS = 'makario_seller_campanias';

/* Los nombres son los del panel de Publicidad de Mercado Libre, tal cual
   figuran ahí, para que se pueda transcribir sin traducir nada. */
const CAMP_VACIA = {
  nombre: '', inversion: undefined, ingresos: undefined, ventas: undefined,
  ventas_directas: undefined, ventas_indirectas: undefined,
  ventas_sin_ads: undefined, ingresos_sin_ads: undefined,
  roas_objetivo_ml: undefined, desde: '', hasta: '',
};

/* Días entre una fecha ISO y hoy. Devuelve null si no hay fecha: el motor
   distingue "no sé cuándo cerró" de "cerró hace mucho", y eso importa
   porque ML sigue atribuyendo 14 días después del clic. */
function campDiasDesde(iso) {
  if (!iso) return null;
  const t = Date.parse(iso + 'T00:00:00');
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 86400000));
}

function campHoyISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/* ══ EL MODAL ═══════════════════════════════════════════════════════════
   Reusa window.Modal, que ya se encarga de Escape, del clic afuera y de
   bloquear el scroll del fondo. */
function CampModal({ abierto, fila, onGuardar, onCerrar, ref_ }) {
  const Modal = window.Modal;
  const [d, setD] = useState(fila || CAMP_VACIA);

  useEffect(() => { setD(fila || CAMP_VACIA); }, [fila, abierto]);

  const set = (k) => (v) => setD(x => Object.assign({}, x, { [k]: v }));

  /* La vista previa del veredicto, viva, mientras se tipea. Es la razón
     de que esto sea un modal y no un formulario aparte: se ve el efecto
     de cada número sin cerrar nada. */
  const prev = useMemo(() => {
    try {
      return window.SELLER.diagnosticarCampania(
        Object.assign({}, d, { dias_desde_fin: campDiasDesde(d.hasta) }), ref_ || {});
    } catch (e) { return null; }
  }, [d, ref_]);

  const col = prev ? (REV_COLOR[prev.veredicto] || REV_COLOR.gris) : REV_COLOR.gris;
  const objML = Number(d.roas_objetivo_ml) || 0;
  const objReal = ref_ && ref_.roas_minimo;

  return (
    <Modal
      open={abierto} size="lg" onClose={onCerrar}
      title={fila && fila.id ? 'Editar campaña' : 'Cargar campaña'}
      footer={
        <>
          <button className="btn-ghost" onClick={onCerrar}>Cancelar</button>
          <button className="btn-primary" onClick={() => onGuardar(d)}
                  disabled={!String(d.nombre || '').trim()}>
            <Icon n="check" s={13}/> Guardar
          </button>
        </>
      }>
      <div className="camp-modal">
        <p className="rev-explica">
          <Icon n="info" s={13} c="var(--ink-muted)"/>
          <span>
            Copiá los números del panel de <strong>Publicidad</strong> de Mercado Libre,
            del período que quieras mirar. Los nombres de acá abajo son los mismos
            que usa ML.
          </span>
        </p>

        <div className="rev-grid-2">
          <RevCampoTexto label="Nombre de la campaña" valor={d.nombre} onChange={set('nombre')}
                         ancho={2} placeholder="Ej: Lámparas — Clásica"/>
          <RevCampo label="Inversión" valor={d.inversion} onChange={set('inversion')} tipo="money"
                    ayuda="Sin IVA. Es como lo muestra ML: el IVA se agrega en la factura."/>
          <RevCampo label="Ingresos" valor={d.ingresos} onChange={set('ingresos')} tipo="money"
                    ayuda="Con IVA. Es la suma del precio publicado, sin envío."/>
          <RevCampo label="Ventas por publicidad" valor={d.ventas} onChange={set('ventas')}
                    ayuda="El total: directas más indirectas."/>
          <RevCampo label="Ventas indirectas" valor={d.ventas_indirectas} onChange={set('ventas_indirectas')}
                    ayuda="Las que entraron por otra publicación. Opcional."/>
        </div>

        {prev && (
          <div className="camp-preview" style={{ background: col.bg, borderColor: col.c + '44' }}>
            <div className="camp-preview-izq">
              <span className="rev-dot" style={{ background: col.c }}/>
              <strong style={{ color: col.c }}>{prev.estado}</strong>
              {prev.decision && <span className="camp-preview-dec">· {prev.decision}</span>}
            </div>
            <div className="camp-preview-der">
              <span>ROAS <b>{prev.roas === null ? '—' : revNum(prev.roas, 2) + 'x'}</b></span>
              <span>Mínimo <b>{prev.roas_minimo === null || prev.roas_minimo === undefined
                ? '—' : revNum(prev.roas_minimo, 2) + 'x'}</b></span>
              <span>Ganancia <b>{prev.ganancia === null ? '—' : revMoney(prev.ganancia)}</b></span>
            </div>
          </div>
        )}

        <div className="camp-modal-sec">
          <h4>Lo que vende sola</h4>
          <p className="camp-modal-nota">
            Opcional, pero es lo único que delata si la campaña está cobrándose
            ventas que ibas a hacer igual. La columna se llama <strong>Ventas sin
            Product Ads</strong> en el panel de ML.
          </p>
          <div className="rev-grid-2">
            <RevCampo label="Ventas sin Product Ads" valor={d.ventas_sin_ads} onChange={set('ventas_sin_ads')}/>
            <RevCampo label="Ingresos sin Product Ads" valor={d.ingresos_sin_ads} onChange={set('ingresos_sin_ads')} tipo="money"/>
          </div>
        </div>

        <div className="camp-modal-sec">
          <h4>El período</h4>
          <div className="rev-grid-2">
            <label className="rev-campo">
              <span className="rev-campo-label">Desde</span>
              <span className="rev-campo-caja">
                <input type="date" className="rev-campo-input" value={d.desde || ''}
                       max={campHoyISO()} onChange={e => set('desde')(e.target.value)}/>
              </span>
            </label>
            <label className="rev-campo">
              <span className="rev-campo-label">Hasta</span>
              <span className="rev-campo-caja">
                <input type="date" className="rev-campo-input" value={d.hasta || ''}
                       max={campHoyISO()} onChange={e => set('hasta')(e.target.value)}/>
              </span>
              <span className="rev-campo-ayuda">
                ML atribuye hasta 14 días después del clic. Un período que cerró
                hace menos que eso todavía está sumando ventas.
              </span>
            </label>
          </div>
        </div>

        <div className="camp-modal-sec">
          <h4>El objetivo que pusiste en Mercado Libre</h4>
          <div className="rev-grid-2">
            <RevCampo label="ROAS objetivo configurado en ML" valor={d.roas_objetivo_ml}
                      onChange={set('roas_objetivo_ml')} sufijo="x"
                      ayuda="Opcional. Solo para comparar contra el que sale de tus costos."/>
            {objML > 0 && objReal ? (
              <div className={`camp-cotejo ${objML < objReal ? 'mal' : 'bien'}`}>
                {objML < objReal ? (
                  <>
                    <strong>Lo tenés bajo.</strong> Le pediste {revNum(objML, 1)}x a ML,
                    pero este producto necesita {revNum(objReal, 1)}x solo para no perder
                    contra tu margen mínimo. ML va a seguir comprando clics que a vos
                    no te cierran.
                  </>
                ) : (
                  <>
                    <strong>Está bien.</strong> Le pediste {revNum(objML, 1)}x y tu piso
                    es {revNum(objReal, 1)}x.
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>

      </div>
    </Modal>
  );
}

/* ══ LAS REFERENCIAS ════════════════════════════════════════════════════
   De dónde sale el objetivo. Va arriba de la tabla y no se puede editar:
   para moverlo hay que cambiar el costo o el precio en la pestaña
   Producto, que es exactamente el punto. */
function CampReferencias({ r }) {
  const hay = r && Number.isFinite(r.roas_equilibrio);
  if (!hay) {
    return (
      <div className="rev-alerta nivel-ambar camp-ref-vacio">
        <Icon n="alert" s={15} c={REV_COLOR.ambar.c}/>
        <div>
          <strong>Todavía no hay objetivo.</strong>{' '}
          {r && r.faltante_para_publicar > 0
            ? <>Con este costo y este precio el producto no banca un peso de
                publicidad: le faltan <b>{revMoney(r.faltante_para_publicar)}</b> por
                unidad para llegar al margen mínimo aun sin publicitar.</>
            : <>Cargá el costo y el precio en la pestaña <strong>Producto</strong> y
                el objetivo aparece solo.</>}
        </div>
      </div>
    );
  }
  const filas = [
    ['Equilibrio', r.roas_equilibrio, r.gasto_ads_equilibrio,
     'Debajo de acá perdés plata con cada venta.', REV_COLOR.rojo.c],
    ['Mínimo', r.roas_minimo, r.gasto_ads_maximo,
     'Tu margen mínimo. Es el umbral que debería estar cargado en ML.', REV_COLOR.ambar.c],
    ['Objetivo', r.roas_objetivo, r.gasto_ads_objetivo,
     'Tu margen objetivo. Arriba de acá conviene escalar.', REV_COLOR.verde.c],
  ];
  return (
    <div className="rev-panel">
      <div className="rev-panel-head">
        <h3>Tus tres ROAS</h3>
        <span className="rev-panel-nota">salen del costo del producto, no se escriben</span>
      </div>
      <div className="camp-ref-grid">
        {filas.map(([t, roas, gasto, ayuda, c]) => (
          <div key={t} className="camp-ref-item" style={{ borderTopColor: c }}>
            <span className="camp-ref-label">{t}</span>
            <span className="camp-ref-num" style={{ color: c }}>
              {roas === null ? '—' : revNum(roas, 2) + 'x'}
            </span>
            <span className="camp-ref-gasto">
              hasta {revMoney(gasto)} de pauta por venta
            </span>
            <span className="camp-ref-ayuda">{ayuda}</span>
          </div>
        ))}
      </div>
      <p className="rev-explica">
        <Icon n="info" s={13} c="var(--ink-muted)"/>
        <span>
          Están en las mismas unidades que el panel de ML: ingresos <strong>con</strong> IVA
          sobre inversión <strong>sin</strong> IVA. Si los comparás contra un ROAS calculado
          todo en neto te van a dar 21% corridos, que es más que cualquier desvío
          que quieras medir.
        </span>
      </p>
    </div>
  );
}

/* ══ UNA FILA ═══════════════════════════════════════════════════════════ */
function CampFila({ d, objML, onEditar, onBorrar, abierta, onAbrir }) {
  const col = REV_COLOR[d.veredicto] || REV_COLOR.gris;
  const gan = d.ganancia;
  return (
    <>
      <tr className={`camp-fila ${abierta ? 'abierta' : ''}`} onClick={onAbrir}>
        <td className="camp-td-nombre" title={d.nombre || ''}>
          <div className="camp-nombre">
            <Icon n={abierta ? 'chev-down' : 'chev-right'} s={13} c="var(--ink-muted)"/>
            <span>{d.nombre || <em>sin nombre</em>}</span>
          </div>
        </td>
        <td className="num">
          {d.roas_minimo === null || d.roas_minimo === undefined
            ? '—' : revNum(d.roas_minimo, 2) + 'x'}
          {objML > 0 && d.roas_minimo > 0 && (
            <span className="camp-rango" title="El objetivo que tiene cargado esta campaña en Mercado Libre"
                  style={objML < d.roas_minimo ? { color: REV_COLOR.ambar.c } : undefined}>
              en ML {revNum(objML, 2)}x
            </span>
          )}
        </td>
        <td className="num">
          {d.roas === null ? '—' : <strong>{revNum(d.roas, 2)}x</strong>}
          {d.roas !== null && d.roas_alto !== null && (
            <span className="camp-rango">{revNum(d.roas_bajo, 1)} – {revNum(d.roas_alto, 1)}</span>
          )}
        </td>
        <td className="num">
          {gan === null ? '—' : (
            <span style={{ color: gan >= 0 ? REV_COLOR.verde.c : REV_COLOR.rojo.c }}>
              {gan >= 0 ? '+' : ''}{revMoney(gan)}
            </span>
          )}
        </td>
        <td>
          <span className="camp-estado" style={{ color: col.c, background: col.bg, borderColor: col.c + '33' }}>
            <span className="rev-dot" style={{ background: col.c }}/>{d.estado}
          </span>
        </td>
        <td className="camp-td-decision">{d.decision}</td>
        <td className="camp-td-acc" onClick={e => e.stopPropagation()}>
          <button className="icon-btn" title="Editar" onClick={onEditar}><Icon n="edit" s={13}/></button>
          <button className="icon-btn" title="Borrar" onClick={onBorrar}><Icon n="trash" s={13}/></button>
        </td>
      </tr>
      {abierta && (
        <tr className="camp-detalle-fila">
          <td colSpan={7}>
            <div className="camp-detalle">
              <div className="camp-detalle-nums">
                {[
                  ['Inversión', revMoney(d.inversion)],
                  ['Ingresos', revMoney(d.ingresos)],
                  ['Ventas', d.ventas],
                  ['CPA real', d.cpa === null ? '—' : revMoney(d.cpa)],
                  ['Ticket', d.ticket === null ? '—' : revMoney(d.ticket)],
                  ['ACOS', d.acos === null ? '—' : revPct(d.acos)],
                  ['TACOS', d.tacos === null ? '—' : revPct(d.tacos)],
                  ['Contribución', revMoney(d.contribucion)],
                ].map(([t, v]) => (
                  <div key={t} className="camp-detalle-num">
                    <span>{t}</span><strong>{v === undefined || v === null ? '—' : v}</strong>
                  </div>
                ))}
              </div>

              {d.ventas_para_firmeza && (
                <div className="camp-nota-firmeza">
                  <Icon n="clock" s={13} c={REV_COLOR.gris.c}/>
                  <span>
                    Con {d.ventas} venta{d.ventas === 1 ? '' : 's'} el número todavía no
                    decide nada: el ROAS verdadero podría estar en cualquier lugar entre{' '}
                    <b>{revNum(d.roas_bajo, 1)}x</b> y <b>{revNum(d.roas_alto, 1)}x</b>.
                    Manteniendo este mismo rendimiento, con <b>{d.ventas_para_firmeza} ventas</b>{' '}
                    ya se podría afirmar algo.
                  </span>
                </div>
              )}

              {d.escalon_sugerido && (
                <div className="camp-nota-escalar">
                  <Icon n="trending-up" s={13} c={REV_COLOR.verde.c}/>
                  <span>
                    Próximo escalón: subir la inversión a <b>{revMoney(d.inversion + d.escalon_sugerido)}</b>{' '}
                    (+15%). Uno por vez, y no la toques otra vez hasta dentro de 14 días.
                  </span>
                </div>
              )}

              {d.alertas.map((a, i) => (
                <div key={i} className={`rev-alerta nivel-${a.nivel}`}>
                  <Icon n={a.nivel === 'verde' ? 'trending-up' : a.nivel === 'gris' ? 'info' : 'alert'}
                        s={14} c={REV_COLOR[a.nivel] ? REV_COLOR[a.nivel].c : REV_COLOR.gris.c}/>
                  <span>{a.texto}</span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ══ LA PESTAÑA ═════════════════════════════════════════════════════════ */
function CampPanel({ resultado }) {
  const [filas, setFilas]   = useState(() => {
    const v = revLeer(CAMP_LS, []);
    const base = Date.now();
    return (Array.isArray(v) ? v : []).map((f, i) =>
      f && f.id ? f : Object.assign({}, f, { id: 'c' + base + '-' + i }));
  });
  const [modal, setModal]   = useState(null);   /* null | {} | fila */
  const [abierta, setAbierta] = useState(null);
  const toast = useToast();

  useEffect(() => { revGuardar(CAMP_LS, filas); }, [filas]);

  const diag = useMemo(() => window.SELLER.diagnosticarCampanias(
    filas.map(f => Object.assign({}, f, { dias_desde_fin: campDiasDesde(f.hasta) })),
    resultado || {}), [filas, resultado]);

  const resumen = useMemo(() => window.SELLER.resumenCampanias(diag), [diag]);

  /* Rojo primero. En una tabla de campañas lo que urge es lo que está
     quemando plata ahora, no lo que anda bien. */
  const orden = useMemo(() => {
    const peso = { rojo: 0, gris: 1, ambar: 2, verde: 3 };
    return diag.map((d, i) => ({ d, i }))
      .sort((a, b) => (peso[a.d.veredicto] - peso[b.d.veredicto])
                   || ((a.d.ganancia || 0) - (b.d.ganancia || 0)));
  }, [diag]);

  const guardar = (d) => {
    if (d.id) setFilas(f => f.map(x => x.id === d.id ? d : x));
    else setFilas(f => f.concat([Object.assign({}, d, { id: 'c' + Date.now() + Math.random().toString(36).slice(2, 6) })]));
    setModal(null);
    toast.success(d.id ? 'Campaña actualizada' : 'Campaña cargada');
  };

  const borrar = (i) => {
    const nom = filas[i] && filas[i].nombre;
    setFilas(f => f.filter((_, j) => j !== i));
    setAbierta(null);
    toast.success(`"${nom || 'Sin nombre'}" borrada`);
  };

  return (
    <div className="camp-panel">
      <CampReferencias r={resultado}/>

      <div className="rev-panel">
        <div className="rev-panel-head">
          <h3>Campañas</h3>
          <button className="btn-primary" onClick={() => setModal({})}>
            <Icon n="plus" s={13}/> Cargar campaña
          </button>
        </div>

        {!filas.length ? (
          <div className="camp-vacio">
            <Icon n="megaphone" s={22} c="var(--ink-muted)"/>
            <strong>Todavía no cargaste ninguna campaña.</strong>
            <span>
              Abrí el panel de Publicidad de Mercado Libre, elegí un período cerrado
              hace más de 14 días y copiá inversión, ingresos y ventas.
            </span>
          </div>
        ) : (
          <>
            <div className="camp-resumen">
              {[['rojo', 'No funcionan'], ['gris', 'Sin evidencia'], ['ambar', 'Al límite'], ['verde', 'Para escalar']]
                .map(([k, t]) => (
                  <div key={k} className="rev-resumen-item">
                    <span className="rev-dot" style={{ background: REV_COLOR[k].c }}/>
                    <strong>{resumen[k]}</strong> {t}
                  </div>
                ))}
              <div className="camp-resumen-plata">
                <span>Invertido <b>{revMoney(resumen.inversion_total)}</b></span>
                <span>ROAS de cartera <b>{resumen.roas_cartera === null ? '—' : revNum(resumen.roas_cartera, 2) + 'x'}</b></span>
                <span style={{ color: resumen.ganancia_total >= 0 ? REV_COLOR.verde.c : REV_COLOR.rojo.c }}>
                  Ganancia <b>{resumen.ganancia_total >= 0 ? '+' : ''}{revMoney(resumen.ganancia_total)}</b>
                </span>
              </div>
            </div>

            <div className="camp-tabla-wrap">
              <table className="rev-tabla camp-tabla">
                <thead>
                  <tr>
                    <th>Campaña</th>
                    <th className="num">ROAS mínimo</th>
                    <th className="num">ROAS real</th>
                    <th className="num">Ganancia</th>
                    <th>Estado</th>
                    <th>Decisión</th>
                    <th/>
                  </tr>
                </thead>
                <tbody>
                  {orden.map(({ d, i }) => (
                    <CampFila key={filas[i].id || i} d={d}
                              objML={Number(filas[i].roas_objetivo_ml) || 0}
                              abierta={abierta === i}
                              onAbrir={() => setAbierta(a => a === i ? null : i)}
                              onEditar={() => setModal(filas[i])}
                              onBorrar={() => borrar(i)}/>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="rev-explica">
              <Icon n="info" s={13} c="var(--ink-muted)"/>
              <span>
                La columna <strong>ROAS mínimo</strong> no se escribe: sale del costo y
                el precio que cargaste en la pestaña Producto, y es el umbral que debería
                estar cargado en ML. Si cargaste el que tiene la campaña, aparece debajo —
                en ámbar cuando está más bajo, porque entonces ML compra clics que a vos no
                te cierran. El rango chiquito abajo del ROAS real es dónde podría estar el
                número verdadero con la cantidad de ventas que tenés: cuando ese rango cruza
                el umbral, el estado es gris, porque todavía no alcanza para decidir.
              </span>
            </p>
          </>
        )}
      </div>

      <CampModal abierto={modal !== null} fila={modal} ref_={resultado}
                 onGuardar={guardar} onCerrar={() => setModal(null)}/>
    </div>
  );
}

/* ══ LA PÁGINA ══════════════════════════════════════════════════════════ */
function MetricasSellerPage() {
  const [tab, setTab] = useState('ficha');
  const [cfg, setCfg] = useState(() =>
    Object.assign({}, window.SELLER.DEFAULTS, revLeer(REV_LS_CONFIG, {})));
  const [ficha, setFicha] = useState(() => revLeer(REV_LS_FICHA, {
    canal: 'mercadolibre_clasica',
    pct_envio_a_cargo: 1,
    unidades_lote: 1,
  }));

  useEffect(() => { revGuardar(REV_LS_CONFIG, cfg); }, [cfg]);
  useEffect(() => { revGuardar(REV_LS_FICHA, ficha); }, [ficha]);

  const resultado = useMemo(
    () => window.SELLER.calcular(Object.assign({}, cfg, ficha)),
    [cfg, ficha]);

  const col = REV_COLOR[resultado.veredicto] || REV_COLOR.gris;

  return (
    <div className="page rev-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Métricas Seller</h1>
          <div className="page-sub">
            Cuánto se puede pagar por un producto para que el negocio cierre.
            Reventa, stock propio, Argentina.
          </div>
        </div>
        <div className="rev-tabs">
          {[['ficha', 'Producto', 'tag'], ['lote', 'Lista del proveedor', 'layers'], ['campanias', 'Campañas', 'megaphone'], ['config', 'Configuración', 'settings']]
            .map(([v, t, ic]) => (
              <button key={v} className={`rev-tab ${tab === v ? 'activo' : ''}`} onClick={() => setTab(v)}>
                <Icon n={ic} s={13}/> {t}
              </button>
            ))}
        </div>
      </div>

      {tab === 'ficha' && (
        <>
          <RevHero r={resultado} costoPedido={Number(ficha.costo_proveedor) || 0}/>
          <RevMetricas r={resultado} cfg={cfg}/>
          <RevAlertas r={resultado}/>
        </>
      )}

      {tab === 'ficha'  && <RevFicha ficha={ficha} setFicha={setFicha} cfg={cfg} resultado={resultado}/>}
      {tab === 'lote'   && <RevLote cfg={cfg} ficha={ficha}/>}
      {tab === 'campanias' && <CampPanel resultado={resultado}/>}
      {tab === 'config' && <RevConfig cfg={cfg} setCfg={setCfg}/>}
    </div>
  );
}

window.MetricasSellerPage = MetricasSellerPage;
