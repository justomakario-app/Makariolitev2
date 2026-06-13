/* ══ PANEL DEL ENCARGADO — Línea productiva (FASE 7) ═══════════════════
   Centro de control. El encargado NO carga producción: ve los 4 sectores
   en vivo, edita con auditoría obligatoria, ve stock/alertas y avisos.
   Slate #2E4057. 4 tabs: Inicio · Sectores · Stock · Avisos.
   Data: window.LP_DATA. UI: lp-ui.jsx (LpEditModal con motivoRequerido).
   Nota: Stock de insumos / remitos / alertas dependen de datos de insumos
   (Fase 6) — hoy muestran estado vacío honesto hasta que se carguen.
   ═══════════════════════════════════════════════════════════════════════ */

const ENC_UI = {
  accent:'#2E4057', accentText:'#9FB0C9', accentSoft:'rgba(46,64,87,.40)', accentLine:'rgba(46,64,87,.66)',
  cnc:'#2563EB', mel:'#534AB7', pino:'#0F6E56', emb:'#993C1D',
  bg:'#0C0C0E', surface:'#1A1A1D', surface2:'#222226', border:'#28282E',
  ink:'#EFEFEF', inkSoft:'#9898A6', inkMuted:'#55555F', danger:'#FF4060', warn:'#FFB020', ok:'#00D68F',
  radius:16,
};

const ENC_SECTORES = [
  { id:'cnc',      label:'CNC',      color:'#2563EB', icon:'layers' },
  { id:'melamina', label:'Melamina', color:'#534AB7', icon:'flame' },
  { id:'pino',     label:'Pino',     color:'#0F6E56', icon:'tools' },
  { id:'embalaje', label:'Embalaje', color:'#993C1D', icon:'package' },
];

function sum(arr, fn) { let s = 0; for (const x of (arr || [])) s += (Number(fn(x)) || 0); return s; }

function EncargadoPanel() {
  const U = ENC_UI;
  const toast = useToast();
  const [tab, setTab] = useState('inicio');
  const [jornada, setJornada] = useState(null);
  const [placas, setPlacas] = useState([]);
  const [stock, setStock] = useState({ stock_pieza:[], stock_melamina:[], stock_patas:[], stock_terminado:[] });
  const [cortes, setCortes] = useState([]);
  const [melamina, setMelamina] = useState([]);
  const [pino, setPino] = useState([]);
  const [embalaje, setEmbalaje] = useState([]);
  const [demanda, setDemanda] = useState([]);
  const [alertas, setAlertas] = useState([]);
  const [mantes, setMantes] = useState([]);
  const [insumos, setInsumos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // { sector, row }

  const placaMap = useMemo(() => { const m = {}; for (const p of placas) m[p.sku] = p; return m; }, [placas]);

  const cargar = useCallback(async (opts) => {
    if (!(opts && opts.silent)) setLoading(true);
    try {
      const j = await window.LP_DATA.jornadaHoy();
      setJornada(j);
      const jid = j && j.jornada_id ? j.jornada_id : null;
      const [pl, st, ct, ml, pn, em, dm, al, mt, ins] = await Promise.all([
        window.LP_DATA.placas().catch(() => []),
        window.LP_DATA.stock().catch(() => null),
        jid ? window.LP_DATA.cortesDia(jid).catch(() => []) : Promise.resolve([]),
        jid ? window.LP_DATA.melaminaDia(jid).catch(() => []) : Promise.resolve([]),
        jid ? window.LP_DATA.pinoDia(jid).catch(() => []) : Promise.resolve([]),
        jid ? window.LP_DATA.embalajeDia(jid).catch(() => []) : Promise.resolve([]),
        window.LP_DATA.resumenDia().catch(() => []),
        window.LP_DATA.alertas().catch(() => []),
        window.LP_DATA.mantenimientos().catch(() => []),
        window.LP_DATA.insumos().catch(() => []),
      ]);
      setPlacas(pl); setStock(st || { stock_pieza:[], stock_melamina:[], stock_patas:[], stock_terminado:[] });
      setCortes(ct); setMelamina(ml); setPino(pn); setEmbalaje(em);
      setDemanda(dm); setAlertas(al); setMantes(mt); setInsumos(ins);
    } catch (err) {
      toast.error(err && err.message ? err.message : 'No se pudo cargar el panel');
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { cargar(); }, [cargar]);

  // 🔴 Realtime (Fase 4.2): centro de control en vivo — los 4 sectores, los
  // 4 stocks, alertas, mantenimiento y jornada.
  useEffect(() => window.LP_DATA.subscribe(
    ['prod_corte', 'prod_melamina', 'prod_pino', 'prod_embalaje',
     'prod_stock_pieza', 'prod_stock_melamina', 'prod_stock_patas', 'prod_stock_terminado',
     'prod_alerta', 'prod_mantenimiento', 'prod_jornada'],
    () => cargar({ silent: true })
  ), [cargar]);

  // ── Agregados ──
  const cortesNetas = useMemo(() => sum(cortes, c => {
    const rend = Number((placaMap[c.placa_sku] || {}).rendimiento) || 0;
    return Math.max((Number(c.hojas) || 0) * rend - (Number(c.desperdicio) || 0), 0);
  }), [cortes, placaMap]);
  const melTerm = sum(melamina, r => r.terminadas);
  const pinoTerm = sum(pino, r => r.terminadas);
  const embUnid = sum(embalaje, r => r.unidades);

  const sPieza = sum(stock.stock_pieza, r => r.disponible);
  const sMel = sum(stock.stock_melamina, r => r.disponible);
  const sPatas = sum(stock.stock_patas, r => r.disponible);
  const sTerm = sum(stock.stock_terminado, r => r.disponible);

  const producidoHoy = cortesNetas + melTerm + pinoTerm + embUnid;
  const faltaDespachar = sum(demanda, d => d.pendiente);

  const kpis = {
    producido: producidoHoy,
    listos: sTerm,
    falta: faltaDespachar,
    nPedidos: demanda.length,
    alertas: alertas.length,
  };

  const NAV = [
    { id:'inicio',   label:'Inicio',   icon:'chart' },
    { id:'sectores', label:'Sectores', icon:'layers' },
    { id:'stock',    label:'Stock',    icon:'box' },
    { id:'avisos',   label:'Avisos',   icon:'bell', badge: alertas.length },
  ];

  const editarConfig = {
    cnc:      { titulo:'Editar corte',  campos:[{ key:'hojas', label:'Hojas' }, { key:'desperdicio', label:'Desperdicio' }], fn:'editarCorte',    extra:(r) => ({}) },
    melamina: { titulo:'Editar melamina', campos:[{ key:'terminadas', label:'Terminadas' }, { key:'fallas', label:'Fallas' }], fn:'editarMelamina', extra:(r) => ({}) },
    pino:     { titulo:'Editar pino',   campos:[{ key:'terminadas', label:'Terminadas' }, { key:'masilladas', label:'Masilladas' }], fn:'editarPino', extra:(r) => ({}) },
    embalaje: { titulo:'Editar embalaje', campos:[{ key:'unidades', label:'Unidades' }], fn:'editarEmbalaje', extra:(r) => ({}) },
  };

  return (
    <div style={{maxWidth:430, margin:'0 auto', minHeight:600, background:U.bg, color:U.ink,
                 borderRadius:U.radius, overflow:'hidden', display:'flex', flexDirection:'column',
                 boxShadow:'0 10px 40px rgba(0,0,0,.25)', fontSize:14}}>

      {/* Topbar */}
      <div style={{padding:'16px 18px', background:U.surface, borderBottom:`1px solid ${U.border}`,
                   display:'flex', alignItems:'center', justifyContent:'space-between'}}>
        <div style={{display:'flex', alignItems:'center', gap:9}}>
          <span style={{width:34, height:34, borderRadius:10, background:U.accentSoft,
                        border:`1px solid ${U.accentLine}`, display:'flex', alignItems:'center', justifyContent:'center'}}>
            <Icon n="shield" s={18} c={U.accentText}/>
          </span>
          <div>
            <div style={{fontSize:14, fontWeight:800, letterSpacing:'.02em', lineHeight:1.1}}>Encargado</div>
            <div style={{display:'flex', alignItems:'center', gap:5, marginTop:2}}>
              <span style={{width:6, height:6, borderRadius:999, background:U.ok, boxShadow:`0 0 0 3px rgba(0,214,143,.18)`}}/>
              <span style={{fontSize:9.5, fontWeight:700, letterSpacing:'.14em', color:U.inkSoft, textTransform:'uppercase'}}>En vivo</span>
            </div>
          </div>
        </div>
        <div style={{textAlign:'right'}}>
          <div style={{fontSize:15, fontWeight:800, fontVariantNumeric:'tabular-nums'}}><LpClock/></div>
          <span style={{display:'inline-block', marginTop:3, fontSize:9.5, fontWeight:800, letterSpacing:'.06em',
                        textTransform:'uppercase', padding:'2px 8px', borderRadius:999,
                        background: (jornada && jornada.estado === 'abierta') ? 'rgba(0,214,143,.14)' : 'rgba(255,64,96,.14)',
                        color: (jornada && jornada.estado === 'abierta') ? U.ok : U.danger}}>
            {jornada ? (jornada.estado === 'abierta' ? 'Jornada abierta' : 'Jornada cerrada') : 'Sin jornada'}
          </span>
        </div>
      </div>

      {/* Contenido */}
      <div style={{flex:1, padding:'18px', overflowY:'auto'}}>
        {loading ? (
          <div style={{textAlign:'center', color:U.inkMuted, padding:'60px 0', fontSize:13}}>Cargando panel…</div>
        ) : tab === 'inicio' ? (
          <EncInicio U={U} kpis={kpis} cadena={{ pieza:sPieza, mel:sMel, patas:sPatas, term:sTerm }} alertas={alertas} demanda={demanda}/>
        ) : tab === 'sectores' ? (
          <EncSectores U={U} jornada={jornada} placaMap={placaMap}
                       cortes={cortes} melamina={melamina} pino={pino} embalaje={embalaje}
                       onEdit={(sector, row) => setEditing({ sector, row })}/>
        ) : tab === 'stock' ? (
          <EncStock U={U} insumos={insumos} alertas={alertas} onRemito={() => toast.info('Carga de remitos: se habilita con el stock de insumos (Fase 6)')}/>
        ) : (
          <EncAvisos U={U} alertas={alertas} mantes={mantes} jornada={jornada}/>
        )}
      </div>

      {/* Bottom nav */}
      <div style={{display:'flex', background:U.surface, borderTop:`1px solid ${U.border}`}}>
        {NAV.map(n => {
          const on = tab === n.id;
          return (
            <button key={n.id} onClick={() => setTab(n.id)}
              style={{flex:1, border:'none', background:'transparent', cursor:'pointer',
                      padding:'10px 4px 11px', display:'flex', flexDirection:'column', alignItems:'center', gap:4,
                      color: on ? U.accentText : U.inkMuted, borderTop:`2px solid ${on ? U.accentText : 'transparent'}`,
                      marginTop:-1, transition:'color .15s ease'}}>
              <span style={{position:'relative', display:'flex'}}>
                <Icon n={n.icon} s={19} c={on ? U.accentText : U.inkMuted}/>
                {n.badge ? (
                  <span style={{position:'absolute', top:-6, right:-10, minWidth:15, height:15, padding:'0 3px',
                                borderRadius:999, background:U.danger, color:'#fff', fontSize:9, fontWeight:800,
                                display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1}}>{n.badge}</span>
                ) : null}
              </span>
              <span style={{fontSize:10, fontWeight:on ? 800 : 600, letterSpacing:'.02em'}}>{n.label}</span>
            </button>
          );
        })}
      </div>

      {editing && (() => {
        const cfg = editarConfig[editing.sector];
        return (
          <LpEditModal U={U} titulo={cfg.titulo} motivoRequerido={true}
            campos={cfg.campos}
            inicial={editing.row}
            onCerrar={() => setEditing(null)}
            onGuardar={async (v, motivo) => {
              try {
                const payload = Object.assign({ id: editing.row.id, motivo }, v);
                await window.LP_DATA[cfg.fn](payload);
                toast.success('Corregido y auditado');
                setEditing(null); await cargar();
              } catch (err) { toast.error(err && err.message ? err.message : 'No se pudo corregir'); }
            }}/>
        );
      })()}
    </div>
  );
}

/* ── Tab Inicio (estado general) ── */
function EncInicio({ U, kpis, cadena, alertas, demanda }) {
  const kpi = (label, val, color, sub) => (
    <div style={{flex:1, minWidth:0, background:U.surface, border:`1px solid ${U.border}`, borderRadius:14, padding:'13px 14px'}}>
      <div style={{fontSize:26, fontWeight:800, color, fontVariantNumeric:'tabular-nums', lineHeight:1}}>{val}</div>
      <div style={{fontSize:10.5, color:U.inkSoft, marginTop:6, fontWeight:600}}>{label}</div>
      {sub ? <div style={{fontSize:9.5, color:U.inkMuted, marginTop:2}}>{sub}</div> : null}
    </div>
  );
  const nodo = (label, val, color) => (
    <div style={{flex:1, textAlign:'center'}}>
      <div style={{fontSize:9, fontWeight:800, letterSpacing:'.06em', textTransform:'uppercase', color:U.inkMuted, marginBottom:5}}>{label}</div>
      <div style={{background:color+'1f', border:`1px solid ${color}55`, borderRadius:10, padding:'8px 4px'}}>
        <div style={{fontSize:17, fontWeight:800, color, fontVariantNumeric:'tabular-nums'}}>{val}</div>
      </div>
    </div>
  );
  const flecha = <div style={{display:'flex', alignItems:'center', paddingTop:18}}><Icon n="arrow-right" s={14} c={U.inkMuted}/></div>;
  const topDemanda = demanda.filter(d => (Number(d.pendiente) || 0) > 0).slice(0, 6);

  return (
    <div>
      {/* KPIs */}
      <div style={{display:'flex', gap:10, marginBottom:10}}>
        {kpi('Producido hoy', kpis.producido, U.ink)}
        {kpi('Listos despacho', kpis.listos, U.ok)}
      </div>
      <div style={{display:'flex', gap:10, marginBottom:18}}>
        {kpi('Falta despachar', kpis.falta, U.warn, `de ${kpis.nPedidos} productos`)}
        {kpi('Alertas stock', kpis.alertas, kpis.alertas ? U.danger : U.inkSoft)}
      </div>

      {/* Cadena productiva en vivo */}
      <h3 style={{fontSize:13.5, fontWeight:800, margin:'0 0 10px', color:U.ink}}>Cadena productiva · en vivo</h3>
      <div style={{background:U.surface, border:`1px solid ${U.border}`, borderRadius:14, padding:'12px 14px', marginBottom:10}}>
        <div style={{fontSize:9.5, fontWeight:700, color:U.inkMuted, marginBottom:8, letterSpacing:'.04em'}}>LÍNEA 1 · tapas</div>
        <div style={{display:'flex', gap:4}}>
          {nodo('CNC', cadena.pieza, U.cnc)}{flecha}
          {nodo('Melamina', cadena.mel, U.mel)}{flecha}
          {nodo('Terminado', cadena.term, U.emb)}
        </div>
      </div>
      <div style={{background:U.surface, border:`1px solid ${U.border}`, borderRadius:14, padding:'12px 14px', marginBottom:18}}>
        <div style={{fontSize:9.5, fontWeight:700, color:U.inkMuted, marginBottom:8, letterSpacing:'.04em'}}>LÍNEA 2 · patas</div>
        <div style={{display:'flex', gap:4}}>
          {nodo('Pino', cadena.patas, U.pino)}{flecha}
          {nodo('Embalaje', cadena.term, U.emb)}
          <div style={{flex:1}}/>
        </div>
      </div>

      {/* Alertas activas */}
      <h3 style={{fontSize:13.5, fontWeight:800, margin:'0 0 10px', color:U.ink}}>Alertas de stock</h3>
      {alertas.length === 0 ? (
        <div style={{background:U.surface, border:`1px solid ${U.border}`, borderRadius:12, padding:'14px',
                     fontSize:12.5, color:U.inkSoft, textAlign:'center', marginBottom:18}}>Sin alertas activas.</div>
      ) : (
        <div style={{display:'flex', flexDirection:'column', gap:8, marginBottom:18}}>
          {alertas.slice(0, 8).map(a => {
            const crit = a.nivel === 'critico';
            const col = crit ? U.danger : U.warn;
            return (
              <div key={a.id} style={{background:col+'14', border:`1px solid ${col}44`, borderRadius:12, padding:'10px 13px',
                           display:'flex', alignItems:'center', justifyContent:'space-between'}}>
                <div style={{display:'flex', alignItems:'center', gap:9}}>
                  <Icon n="alert" s={15} c={col}/>
                  <span style={{fontSize:12.5, fontWeight:700, color:U.ink}}>{a.insumo_sku}</span>
                </div>
                <span style={{fontSize:11, color:col, fontWeight:700, textTransform:'uppercase'}}>{a.nivel}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Avance / pendientes por producto */}
      {topDemanda.length > 0 && (
        <div>
          <h3 style={{fontSize:13.5, fontWeight:800, margin:'0 0 10px', color:U.ink}}>Pendiente por producto</h3>
          <div style={{background:U.surface, border:`1px solid ${U.border}`, borderRadius:14, overflow:'hidden'}}>
            {topDemanda.map((d, i) => (
              <div key={d.producto_sku || i} style={{display:'flex', alignItems:'center', justifyContent:'space-between',
                           padding:'10px 12px', borderBottom: i < topDemanda.length - 1 ? `1px solid ${U.border}` : 'none'}}>
                <div style={{minWidth:0, paddingRight:10}}>
                  <div style={{fontSize:12.5, fontWeight:700, color:U.ink, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{d.nombre || d.producto_sku}</div>
                  <div style={{fontSize:10.5, color:U.inkMuted}}>{d.producto_sku}{d.color ? ` · ${d.color}` : ''}</div>
                </div>
                <span style={{fontSize:15, fontWeight:800, color:U.warn, fontVariantNumeric:'tabular-nums'}}>{d.pendiente}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Tab Sectores (detalle + edición con auditoría) ── */
function EncSectores({ U, jornada, placaMap, cortes, melamina, pino, embalaje, onEdit }) {
  const estado = jornada ? (jornada.estado === 'abierta' ? 'En curso' : 'Cerrado') : 'Sin jornada';
  const horaUlt = (rows) => {
    let t = null;
    for (const r of rows) { if (r.created_at && (!t || r.created_at > t)) t = r.created_at; }
    if (!t) return '—';
    try { return new Date(t).toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' }); } catch (e) { return '—'; }
  };

  const metrCnc = [
    ['Hojas', sum(cortes, c => c.hojas)],
    ['Piezas', sum(cortes, c => Math.max((Number(c.hojas)||0) * (Number((placaMap[c.placa_sku]||{}).rendimiento)||0) - (Number(c.desperdicio)||0), 0))],
    ['Desperdicio', sum(cortes, c => c.desperdicio)],
  ];
  const metrMel = [['Terminadas', sum(melamina, r => r.terminadas)], ['Fallas', sum(melamina, r => r.fallas)]];
  const metrPino = [
    ['Chicas', sum(pino.filter(r => r.tamano === 'chica'), r => r.terminadas)],
    ['Grandes', sum(pino.filter(r => r.tamano === 'grande'), r => r.terminadas)],
    ['Masilladas', sum(pino, r => r.masilladas)],
  ];
  const metrEmb = [['Embalados', sum(embalaje, r => r.unidades)]];

  const datos = {
    cnc: { metr: metrCnc, rows: cortes, hora: horaUlt(cortes), label: (r) => (placaMap[r.placa_sku] || {}).nombre || r.placa_sku, val: (r) => `${r.hojas} hojas` },
    melamina: { metr: metrMel, rows: melamina, hora: horaUlt(melamina), label: (r) => r.pieza_sku, val: (r) => `${r.terminadas} term · ${r.fallas} fallas` },
    pino: { metr: metrPino, rows: pino, hora: horaUlt(pino), label: (r) => r.tamano, val: (r) => `${r.terminadas} term · ${r.masilladas} mas` },
    embalaje: { metr: metrEmb, rows: embalaje, hora: horaUlt(embalaje), label: (r) => r.producto_sku, val: (r) => `${r.unidades} u` },
  };

  return (
    <div>
      {ENC_SECTORES.map(s => {
        const d = datos[s.id];
        return (
          <div key={s.id} style={{background:U.surface, border:`1px solid ${U.border}`, borderRadius:14, padding:'14px', marginBottom:14}}>
            <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12}}>
              <div style={{display:'flex', alignItems:'center', gap:9}}>
                <span style={{width:30, height:30, borderRadius:9, background:s.color+'22', border:`1px solid ${s.color}55`,
                              display:'flex', alignItems:'center', justifyContent:'center'}}>
                  <Icon n={s.icon} s={16} c={s.color}/>
                </span>
                <div>
                  <div style={{fontSize:13.5, fontWeight:800, color:U.ink}}>{s.label}</div>
                  <div style={{fontSize:10, color:U.inkMuted}}>{estado} · últ. carga {d.hora}</div>
                </div>
              </div>
            </div>

            <div style={{display:'flex', gap:8, marginBottom: d.rows.length ? 12 : 0}}>
              {d.metr.map(([lbl, v]) => (
                <div key={lbl} style={{flex:1, background:U.surface2, borderRadius:10, padding:'8px 6px', textAlign:'center'}}>
                  <div style={{fontSize:16, fontWeight:800, color:U.ink, fontVariantNumeric:'tabular-nums'}}>{v}</div>
                  <div style={{fontSize:9, color:U.inkMuted, marginTop:2, textTransform:'uppercase', letterSpacing:'.04em'}}>{lbl}</div>
                </div>
              ))}
            </div>

            {d.rows.length > 0 && (
              <div style={{borderTop:`1px solid ${U.border}`, paddingTop:8}}>
                {d.rows.slice(0, 6).map(r => (
                  <div key={r.id} onClick={() => onEdit(s.id, r)}
                       style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'7px 2px', cursor:'pointer'}}>
                    <span style={{fontSize:12, color:U.inkSoft, textTransform:'capitalize'}}>{d.label(r)}</span>
                    <span style={{display:'flex', alignItems:'center', gap:8}}>
                      <span style={{fontSize:11.5, color:U.inkMuted, fontVariantNumeric:'tabular-nums'}}>{d.val(r)}</span>
                      <Icon n="edit" s={13} c={U.accentText}/>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div style={{fontSize:11, color:U.inkMuted, textAlign:'center', padding:'4px 16px 8px', lineHeight:1.5}}>
        Tocá cualquier carga para corregirla. Toda corrección exige motivo y queda auditada.
      </div>
    </div>
  );
}

/* ── Tab Stock ── */
function EncStock({ U, insumos, alertas, onRemito }) {
  const bajo = insumos.filter(i => (Number(i.stock_actual) || 0) < (Number(i.stock_minimo) || 0));
  return (
    <div>
      <button onClick={onRemito}
        style={{width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:9, marginBottom:18,
                background:U.accent, border:'none', borderRadius:14, color:'#fff', padding:'14px', fontSize:14, fontWeight:800, cursor:'pointer'}}>
        <Icon n="plus" s={17} c="#fff"/> Cargar remito de mercadería
      </button>

      <h3 style={{fontSize:13.5, fontWeight:800, margin:'0 0 10px', color:U.ink}}>Bajo mínimo</h3>
      {bajo.length === 0 ? (
        <div style={{background:U.surface, border:`1px solid ${U.border}`, borderRadius:12, padding:'14px',
                     fontSize:12.5, color:U.inkSoft, textAlign:'center', marginBottom:18}}>Nada bajo mínimo.</div>
      ) : (
        <div style={{display:'flex', flexDirection:'column', gap:8, marginBottom:18}}>
          {bajo.map(i => {
            const ratio = (Number(i.stock_minimo) || 0) > 0 ? Math.min((Number(i.stock_actual) || 0) / (Number(i.stock_minimo) || 1), 1) : 0;
            const col = ratio < 0.5 ? U.danger : U.warn;
            return (
              <div key={i.sku} style={{background:U.surface, border:`1px solid ${U.border}`, borderRadius:12, padding:'11px 13px'}}>
                <div style={{display:'flex', justifyContent:'space-between', marginBottom:7}}>
                  <span style={{fontSize:12.5, fontWeight:700, color:U.ink}}>{i.nombre || i.sku}</span>
                  <span style={{fontSize:11.5, color:col, fontWeight:700, fontVariantNumeric:'tabular-nums'}}>{i.stock_actual}/{i.stock_minimo} {i.unidad}</span>
                </div>
                <div style={{height:5, background:U.surface2, borderRadius:999, overflow:'hidden'}}>
                  <div style={{height:'100%', width:`${ratio * 100}%`, background:col}}/>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <h3 style={{fontSize:13.5, fontWeight:800, margin:'0 0 10px', color:U.ink}}>Stock general</h3>
      {insumos.length === 0 ? (
        <div style={{background:U.surface, border:`1px dashed ${U.border}`, borderRadius:12, padding:'18px 14px',
                     fontSize:12.5, color:U.inkSoft, textAlign:'center', lineHeight:1.6}}>
          Todavía no hay insumos cargados.<br/>El stock de materia prima e insumos se habilita con la Fase 6.
        </div>
      ) : (
        <div style={{background:U.surface, border:`1px solid ${U.border}`, borderRadius:14, overflow:'hidden'}}>
          {insumos.slice(0, 30).map((i, idx) => (
            <div key={i.sku} style={{display:'flex', alignItems:'center', justifyContent:'space-between',
                         padding:'10px 12px', borderBottom: idx < Math.min(insumos.length, 30) - 1 ? `1px solid ${U.border}` : 'none'}}>
              <div style={{minWidth:0, paddingRight:10}}>
                <div style={{fontSize:12.5, fontWeight:700, color:U.ink, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{i.nombre || i.sku}</div>
                <div style={{fontSize:10, color:U.inkMuted}}>{i.categoria || ''}</div>
              </div>
              <span style={{fontSize:13, fontWeight:700, color:U.ink, fontVariantNumeric:'tabular-nums'}}>{i.stock_actual} {i.unidad}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Tab Avisos ── */
function EncAvisos({ U, alertas, mantes, jornada }) {
  const mantDerivados = mantes.filter(m => m.estado === 'aprobado_coord' || m.estado === 'recibido_director');
  return (
    <div>
      <h3 style={{fontSize:13.5, fontWeight:800, margin:'0 0 10px', color:U.ink}}>Alertas de stock</h3>
      {alertas.length === 0 ? (
        <div style={{background:U.surface, border:`1px solid ${U.border}`, borderRadius:12, padding:'14px',
                     fontSize:12.5, color:U.inkSoft, textAlign:'center', marginBottom:18}}>Sin alertas.</div>
      ) : (
        <div style={{display:'flex', flexDirection:'column', gap:8, marginBottom:18}}>
          {alertas.slice(0, 8).map(a => {
            const col = a.nivel === 'critico' ? U.danger : U.warn;
            return (
              <div key={a.id} style={{background:col+'14', border:`1px solid ${col}44`, borderRadius:12, padding:'10px 13px',
                           display:'flex', alignItems:'center', gap:9}}>
                <Icon n="alert" s={15} c={col}/>
                <span style={{fontSize:12.5, color:U.ink}}>{a.insumo_sku} · <b style={{color:col}}>{a.nivel}</b> ({a.stock_actual}/{a.stock_minimo})</span>
              </div>
            );
          })}
        </div>
      )}

      <h3 style={{fontSize:13.5, fontWeight:800, margin:'0 0 10px', color:U.ink}}>Mantenimiento derivado al director</h3>
      {mantDerivados.length === 0 ? (
        <div style={{background:U.surface, border:`1px solid ${U.border}`, borderRadius:12, padding:'14px',
                     fontSize:12.5, color:U.inkSoft, textAlign:'center', marginBottom:18}}>Nada derivado.</div>
      ) : (
        <div style={{display:'flex', flexDirection:'column', gap:8, marginBottom:18}}>
          {mantDerivados.slice(0, 8).map(m => (
            <div key={m.id} style={{background:U.surface, border:`1px solid ${U.border}`, borderRadius:12, padding:'11px 13px'}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                <span style={{fontSize:12.5, fontWeight:700, color:U.ink, textTransform:'capitalize'}}>{m.sector} · {m.tipo || 'mantenimiento'}</span>
                <span style={{fontSize:10, color:U.inkMuted, textTransform:'uppercase'}}>{m.estado === 'recibido_director' ? 'recibido' : 'derivado'}</span>
              </div>
              {m.maquina ? <div style={{fontSize:11, color:U.inkSoft, marginTop:3}}>{m.maquina}</div> : null}
            </div>
          ))}
        </div>
      )}

      <div style={{background:U.surface2, border:`1px solid ${U.border}`, borderRadius:12, padding:'12px 14px',
                   fontSize:11, color:U.inkMuted, lineHeight:1.6}}>
        <b style={{color:U.inkSoft}}>Ruteo:</b> las solicitudes de insumos las recepciona administración; los reportes de mantenimiento, una vez aprobados por el coordinador, van al director. El encargado no gestiona ninguno — solo los ve informados.
      </div>
    </div>
  );
}

window.EncargadoPanel = EncargadoPanel;
