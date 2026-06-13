/* ══ PANEL DEL ENCARGADO — Línea productiva (FASE 7) ═══════════════════
   Centro de control. El encargado NO carga producción: ve los 4 sectores
   en vivo, edita con auditoría obligatoria, ve stock/alertas y avisos.
   Slate #2E4057. 5 tabs: Inicio · Sectores · Aprobar · Stock · Avisos.
   Data: window.LP_DATA. UI: lp-ui.jsx (LpEditModal con motivoRequerido).
   Fase 8: el encargado aprueba (coord); admin recepciona insumos; el
   director (owner/admin) recibe el mantenimiento.
   Nota: Stock de insumos / remitos / alertas dependen de datos de insumos
   (Fase 6) — hoy muestran estado vacío honesto hasta que se carguen.
   ═══════════════════════════════════════════════════════════════════════ */

/* Paleta integrada a la plataforma (clara/premium). El panel está tokenizado:
   todo el render usa U.*, así que cambiando la paleta se re-tematiza entero
   sin tocar la estructura. Los colores de sector quedan como acento. */
const ENC_UI = {
  accent:'#2E4057', accentText:'#2E4057', accentSoft:'rgba(46,64,87,.08)', accentLine:'rgba(46,64,87,.20)',
  cnc:'#2563EB', mel:'#534AB7', pino:'#0F6E56', emb:'#993C1D',
  bg:'transparent', surface:'#FFFFFF', surface2:'#F4F4F5', border:'rgba(0,0,0,0.09)',
  ink:'#0A0A0A', inkSoft:'#555555', inkMuted:'#8A8A8A', danger:'#DC2626', warn:'#D97706', ok:'#16A34A',
  radius:10,
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
  const M = window.useMockData();
  const role = ((M.user || {}).role || '').toLowerCase();
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
  const [solicitudes, setSolicitudes] = useState([]);
  const [jornadaBusy, setJornadaBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // { sector, row }

  const placaMap = useMemo(() => { const m = {}; for (const p of placas) m[p.sku] = p; return m; }, [placas]);

  const cargar = useCallback(async (opts) => {
    if (!(opts && opts.silent)) setLoading(true);
    try {
      const j = await window.LP_DATA.jornadaHoy();
      setJornada(j);
      const jid = j && j.jornada_id ? j.jornada_id : null;
      const [pl, st, ct, ml, pn, em, dm, al, mt, ins, sl] = await Promise.all([
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
        window.LP_DATA.solicitudes().catch(() => []),
      ]);
      setPlacas(pl); setStock(st || { stock_pieza:[], stock_melamina:[], stock_patas:[], stock_terminado:[] });
      setCortes(ct); setMelamina(ml); setPino(pn); setEmbalaje(em);
      setDemanda(dm); setAlertas(al); setMantes(mt); setInsumos(ins); setSolicitudes(sl);
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
     'prod_alerta', 'prod_mantenimiento', 'prod_solicitud', 'prod_jornada'],
    () => cargar({ silent: true })
  ), [cargar]);

  // Fase 8: aprobar/recepcionar/recibir → RPC + refetch silencioso.
  const handleAprob = useCallback(async (tipo, id, estado) => {
    try {
      if (tipo === 'solicitud') await window.LP_DATA.gestionarSolicitud({ id: id, estado: estado });
      else await window.LP_DATA.gestionarMantenimiento({ id: id, estado: estado });
      toast.success('Listo');
      await cargar({ silent: true });
    } catch (err) { toast.error(err && err.message ? err.message : 'No se pudo'); }
  }, [toast, cargar]);

  // Jornada de producción (brief): el encargado/owner/admin la abre y cierra.
  // Es independiente de la jornada de VENTAS (no la toca). La demanda de cada
  // sector llega igual de los pedidos; la jornada habilita registrar producción.
  const jornadaAbierta = jornada && jornada.estado === 'abierta';
  const toggleJornada = useCallback(async () => {
    setJornadaBusy(true);
    try {
      if (jornada && jornada.estado === 'abierta') {
        const r = await window.LP_DATA.cerrarJornada();
        const rs = (r && r.resumen) || {};
        toast.success('Jornada cerrada · ' + (rs.cortes || 0) + ' cortes · ' + (rs.melamina || 0) + ' melamina · ' + (rs.pino || 0) + ' pino · ' + (rs.embalaje || 0) + ' embalaje');
      } else {
        await window.LP_DATA.abrirJornada();
        toast.success('Jornada de producción abierta');
      }
      await cargar({ silent: true });
    } catch (err) { toast.error(err && err.message ? err.message : 'No se pudo gestionar la jornada'); }
    finally { setJornadaBusy(false); }
  }, [jornada, toast, cargar]);

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

  // Fase 8: cuántos ítems puede accionar el rol actual (para el badge).
  const canDirector = role === 'owner' || role === 'admin';
  const canCoord = canDirector || role === 'encargado';
  const solPend  = solicitudes.filter(s => s.estado === 'pendiente').length;
  const solAprob = solicitudes.filter(s => s.estado === 'aprobada_coord').length;
  const mantPend  = mantes.filter(m => m.estado === 'pendiente').length;
  const mantAprob = mantes.filter(m => m.estado === 'aprobado_coord').length;
  const aprobBadge = (canCoord ? solPend + mantPend : 0) + (canDirector ? solAprob + mantAprob : 0);

  const NAV = [
    { id:'inicio',   label:'Inicio',   icon:'chart' },
    { id:'sectores', label:'Sectores', icon:'layers' },
    { id:'aprob',    label:'Aprobar',  icon:'check', badge: aprobBadge },
    { id:'stock',    label:'Stock',    icon:'box' },
    { id:'avisos',   label:'Avisos',   icon:'bell', badge: alertas.length },
  ];
  // Fase 9: el Histórico (dashboard del director) solo lo ve owner/admin.
  if (canDirector) NAV.push({ id:'historico', label:'Histórico', icon:'history' });

  const editarConfig = {
    cnc:      { titulo:'Editar corte',  campos:[{ key:'hojas', label:'Hojas' }, { key:'desperdicio', label:'Desperdicio' }], fn:'editarCorte',    extra:(r) => ({}) },
    melamina: { titulo:'Editar melamina', campos:[{ key:'terminadas', label:'Terminadas' }, { key:'fallas', label:'Fallas' }], fn:'editarMelamina', extra:(r) => ({}) },
    pino:     { titulo:'Editar pino',   campos:[{ key:'terminadas', label:'Terminadas' }, { key:'masilladas', label:'Masilladas' }], fn:'editarPino', extra:(r) => ({}) },
    embalaje: { titulo:'Editar embalaje', campos:[{ key:'unidades', label:'Unidades' }], fn:'editarEmbalaje', extra:(r) => ({}) },
  };

  return (
    <div style={{background:U.bg, color:U.ink, fontSize:13, padding:'0 32px 32px'}}>

      {/* Header de sección (integrado a la plataforma, no marco de teléfono) */}
      <div style={{padding:'18px 0 14px', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
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
        <div style={{display:'flex', alignItems:'center', gap:14}}>
          <button onClick={toggleJornada} disabled={jornadaBusy}
            style={{border: jornadaAbierta ? ('1px solid ' + U.border) : 'none',
                    background: jornadaAbierta ? U.surface : U.accent,
                    color: jornadaAbierta ? U.inkSoft : '#fff', borderRadius:9, padding:'9px 14px',
                    fontSize:12.5, fontWeight:800, cursor: jornadaBusy ? 'default' : 'pointer',
                    opacity: jornadaBusy ? 0.6 : 1, display:'flex', alignItems:'center', gap:7, whiteSpace:'nowrap'}}>
            <Icon n={jornadaAbierta ? 'check' : 'plus'} s={15} c={jornadaAbierta ? U.inkSoft : '#fff'}/>
            {jornadaAbierta ? 'Cerrar jornada' : 'Abrir jornada'}
          </button>
          <div style={{textAlign:'right'}}>
            <div style={{fontSize:15, fontWeight:800, fontVariantNumeric:'tabular-nums'}}><LpClock/></div>
            <span style={{display:'inline-block', marginTop:3, fontSize:9.5, fontWeight:800, letterSpacing:'.06em',
                          textTransform:'uppercase', padding:'2px 8px', borderRadius:999,
                          background: jornadaAbierta ? 'rgba(22,163,74,.12)' : 'rgba(220,38,38,.10)',
                          color: jornadaAbierta ? U.ok : U.danger}}>
              {jornada ? (jornada.estado === 'abierta' ? 'Jornada abierta' : 'Jornada cerrada') : 'Sin jornada'}
            </span>
          </div>
        </div>
      </div>

      {/* Tabs (estilo plataforma, arriba — reemplaza el bottom-nav de teléfono) */}
      <div style={{display:'flex', gap:2, borderBottom:`1px solid ${U.border}`, overflowX:'auto', marginBottom:18}}>
        {NAV.map(n => {
          const on = tab === n.id;
          return (
            <button key={n.id} onClick={() => setTab(n.id)}
              style={{border:'none', background:'transparent', cursor:'pointer', whiteSpace:'nowrap',
                      padding:'11px 13px', display:'flex', alignItems:'center', gap:7,
                      color: on ? U.accent : U.inkMuted, borderBottom:`2px solid ${on ? U.accent : 'transparent'}`,
                      marginBottom:-1, fontSize:12.5, fontWeight: on ? 800 : 600, transition:'color .15s ease'}}>
              <Icon n={n.icon} s={16} c={on ? U.accent : U.inkMuted}/>
              <span>{n.label}</span>
              {n.badge ? (
                <span style={{minWidth:16, height:16, padding:'0 4px', borderRadius:999, background:U.danger,
                              color:'#fff', fontSize:9.5, fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1}}>{n.badge}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Contenido */}
      <div>
        {loading ? (
          <div style={{textAlign:'center', color:U.inkMuted, padding:'60px 0', fontSize:13}}>Cargando panel…</div>
        ) : tab === 'inicio' ? (
          <EncInicio U={U} kpis={kpis} cadena={{ pieza:sPieza, mel:sMel, patas:sPatas, term:sTerm }} alertas={alertas} demanda={demanda}/>
        ) : tab === 'sectores' ? (
          <EncSectores U={U} jornada={jornada} placaMap={placaMap}
                       cortes={cortes} melamina={melamina} pino={pino} embalaje={embalaje}
                       onEdit={(sector, row) => setEditing({ sector, row })}/>
        ) : tab === 'aprob' ? (
          <EncAprobaciones U={U} role={role} solicitudes={solicitudes} mantes={mantes} onAction={handleAprob}/>
        ) : tab === 'stock' ? (
          <EncStock U={U} insumos={insumos} alertas={alertas} onRemito={() => toast.info('Carga de remitos: se habilita con el stock de insumos (Fase 6)')}/>
        ) : tab === 'historico' ? (
          <EncHistorico U={U}/>
        ) : (
          <EncAvisos U={U} alertas={alertas} mantes={mantes} jornada={jornada}/>
        )}
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

/* ── Tab Aprobaciones (Fase 8) ──
   El encargado aprueba (coord). Insumos: admin (director) recepciona.
   Mantenimiento: el director (owner/admin) recibe. Las acciones se muestran
   según el rol; el backend (RPCs) igual valida server-side. */
function EncAprobaciones({ U, role, solicitudes, mantes, onAction }) {
  const canDirector = role === 'owner' || role === 'admin';
  const canCoord = canDirector || role === 'encargado';

  const solAbiertas  = (solicitudes || []).filter(s => s.estado === 'pendiente' || s.estado === 'aprobada_coord');
  const mantAbiertos = (mantes || []).filter(m => m.estado === 'pendiente' || m.estado === 'aprobado_coord');

  const badge = (txt, col) => (
    <span style={{fontSize:9.5, fontWeight:800, letterSpacing:'.04em', textTransform:'uppercase',
                  padding:'2px 8px', borderRadius:999, background:col+'1f', color:col, whiteSpace:'nowrap'}}>{txt}</span>
  );
  const btn = (label, col, onClick) => (
    <button onClick={onClick}
      style={{border:'none', borderRadius:10, background:col, color:'#fff', padding:'8px 13px',
              fontSize:11.5, fontWeight:800, cursor:'pointer', whiteSpace:'nowrap'}}>{label}</button>
  );
  const espera = (txt) => <span style={{fontSize:11, color:U.inkMuted}}>{txt}</span>;
  const urgCol = (u) => u === 'alta' ? U.danger : (u === 'media' ? U.warn : U.inkSoft);
  const itemsTxt = (items) => {
    if (!Array.isArray(items)) return '—';
    return items.map(it => `${it.nombre}${it.cantidad ? ' ×' + it.cantidad : ''}`).join(' · ');
  };

  return (
    <div>
      {/* Solicitudes de insumos */}
      <h3 style={{fontSize:13.5, fontWeight:800, margin:'0 0 10px', color:U.ink}}>Solicitudes de insumos</h3>
      {solAbiertas.length === 0 ? (
        <div style={{background:U.surface, border:`1px solid ${U.border}`, borderRadius:12, padding:'14px',
                     fontSize:12.5, color:U.inkSoft, textAlign:'center', marginBottom:18}}>Sin solicitudes pendientes.</div>
      ) : (
        <div style={{display:'flex', flexDirection:'column', gap:8, marginBottom:18}}>
          {solAbiertas.map(s => {
            const pend = s.estado === 'pendiente';
            return (
              <div key={s.id} style={{background:U.surface, border:`1px solid ${U.border}`, borderRadius:12, padding:'12px 13px'}}>
                <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6}}>
                  <span style={{fontSize:12.5, fontWeight:800, color:U.ink, textTransform:'capitalize'}}>{s.sector}</span>
                  {pend ? badge('pendiente', U.warn) : badge('aprobada', U.cnc)}
                </div>
                <div style={{fontSize:11.5, color:U.inkSoft, lineHeight:1.5, marginBottom:10}}>{itemsTxt(s.items)}</div>
                <div style={{display:'flex', justifyContent:'flex-end', gap:8}}>
                  {pend && canCoord ? btn('Aprobar', U.accent, () => onAction('solicitud', s.id, 'aprobada_coord')) : null}
                  {!pend && canDirector ? btn('Recepcionar', U.ok, () => onAction('solicitud', s.id, 'recepcionada_admin')) : null}
                  {pend && !canCoord ? espera('Esperando al encargado') : null}
                  {!pend && !canDirector ? espera('Esperando a administración') : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Reportes de mantenimiento */}
      <h3 style={{fontSize:13.5, fontWeight:800, margin:'0 0 10px', color:U.ink}}>Reportes de mantenimiento</h3>
      {mantAbiertos.length === 0 ? (
        <div style={{background:U.surface, border:`1px solid ${U.border}`, borderRadius:12, padding:'14px',
                     fontSize:12.5, color:U.inkSoft, textAlign:'center', marginBottom:18}}>Sin reportes pendientes.</div>
      ) : (
        <div style={{display:'flex', flexDirection:'column', gap:8, marginBottom:18}}>
          {mantAbiertos.map(m => {
            const pend = m.estado === 'pendiente';
            return (
              <div key={m.id} style={{background:U.surface, border:`1px solid ${U.border}`, borderRadius:12, padding:'12px 13px'}}>
                <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6}}>
                  <span style={{fontSize:12.5, fontWeight:800, color:U.ink, textTransform:'capitalize'}}>{m.sector} · {m.tipo || 'mantenimiento'}</span>
                  {badge(m.urgencia || 'media', urgCol(m.urgencia))}
                </div>
                {m.maquina ? <div style={{fontSize:12, color:U.inkSoft, marginBottom:3}}>{m.maquina}</div> : null}
                {m.descripcion ? <div style={{fontSize:11.5, color:U.inkMuted, lineHeight:1.5, marginBottom:10}}>{m.descripcion}</div> : <div style={{height:6}}/>}
                <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:8}}>
                  {pend ? badge('pendiente', U.warn) : badge('aprobado coord', U.pino)}
                  <span style={{display:'flex', gap:8}}>
                    {pend && canCoord ? btn('Aprobar', U.accent, () => onAction('mantenimiento', m.id, 'aprobado_coord')) : null}
                    {!pend && canDirector ? btn('Recibir (director)', U.ok, () => onAction('mantenimiento', m.id, 'recibido_director')) : null}
                    {pend && !canCoord ? espera('Esperando al encargado') : null}
                    {!pend && !canDirector ? espera('Esperando al director') : null}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{background:U.surface2, border:`1px solid ${U.border}`, borderRadius:12, padding:'12px 14px',
                   fontSize:11, color:U.inkMuted, lineHeight:1.6}}>
        <b style={{color:U.inkSoft}}>Flujo:</b> el sector carga → el encargado aprueba → las solicitudes de insumos las recepciona administración y los reportes de mantenimiento los recibe el director.
      </div>
    </div>
  );
}

/* ── Tab Histórico (Fase 9) — Dashboard del Director ──
   Solo owner/admin. KPIs del período, comparativa vs período anterior,
   producción por día, top productos embalados, mantenimientos recibidos,
   y export a Excel. Lee prod_rpc_director_historico (solo lectura). */
function EncHistorico({ U }) {
  const toast = useToast();
  const hoyStr = () => new Date().toISOString().slice(0, 10);
  const diasAtras = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  const [desde, setDesde] = useState(() => diasAtras(29));
  const [hasta, setHasta] = useState(hoyStr);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const r = await window.LP_DATA.directorHistorico({ desde: desde, hasta: hasta });
      setData(r);
    } catch (err) { toast.error(err && err.message ? err.message : 'No se pudo cargar el historico'); }
    finally { setLoading(false); }
  }, [desde, hasta, toast]);

  useEffect(() => { cargar(); }, [cargar]);

  const preset = (n) => { setHasta(hoyStr()); setDesde(diasAtras(n - 1)); };

  const exportXlsx = () => {
    if (typeof window.XLSX === 'undefined' || !data) { toast.error('No hay datos para exportar'); return; }
    const k = data.kpis || {};
    const aoa = [
      ['Historico de produccion'],
      [`Periodo: ${data.desde} a ${data.hasta}`],
      [],
      ['KPI', 'Valor'],
      ['Jornadas', k.jornadas || 0],
      ['Piezas cortadas (netas)', k.piezas_cortadas || 0],
      ['Melamina terminada', k.melamina_term || 0],
      ['Melamina fallas', k.melamina_fallas || 0],
      ['Patas terminadas', k.patas_term || 0],
      ['Embalado', k.embalado || 0],
      ['Mantenimientos recibidos', k.mant_recibidos || 0],
      [],
      ['Produccion por dia'],
      ['Fecha', 'Cortes', 'Melamina', 'Pino', 'Embalaje'],
    ];
    (data.por_dia || []).forEach(d => aoa.push([d.dia, d.cortes, d.melamina, d.pino, d.embalaje]));
    aoa.push([]); aoa.push(['Top productos embalados']); aoa.push(['SKU', 'Nombre', 'Unidades']);
    (data.top_productos || []).forEach(t => aoa.push([t.producto_sku, t.nombre, t.unidades]));
    const ws = window.XLSX.utils.aoa_to_sheet(aoa);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Historico');
    window.XLSX.writeFile(wb, `historico_produccion_${data.desde}_${data.hasta}.xlsx`);
  };

  const k = (data && data.kpis) || {};
  const comp = (data && data.comparativa) || {};
  const porDia = (data && data.por_dia) || [];
  const top = (data && data.top_productos) || [];
  const mant = (data && data.mantenimientos) || [];

  let maxEmb = 1;
  porDia.forEach(d => { const v = Number(d.embalaje) || 0; if (v > maxEmb) maxEmb = v; });
  const embAct = Number(comp.embalado_actual) || 0;
  const embPrev = Number(comp.embalado_prev) || 0;
  const deltaPct = embPrev > 0 ? Math.round(((embAct - embPrev) / embPrev) * 100) : (embAct > 0 ? 100 : 0);
  const deltaCol = deltaPct > 0 ? U.ok : (deltaPct < 0 ? U.danger : U.inkSoft);

  const card = (label, val, color) => (
    <div style={{flex:1, minWidth:0, background:U.surface, border:`1px solid ${U.border}`, borderRadius:14, padding:'12px 13px'}}>
      <div style={{fontSize:22, fontWeight:800, color, fontVariantNumeric:'tabular-nums', lineHeight:1}}>{val}</div>
      <div style={{fontSize:10, color:U.inkSoft, marginTop:6, fontWeight:600}}>{label}</div>
    </div>
  );
  const presetBtn = (n, label) => (
    <button onClick={() => preset(n)}
      style={{flex:1, border:`1px solid ${U.border}`, background:U.surface2, color:U.inkSoft, borderRadius:9,
              padding:'7px 4px', fontSize:11, fontWeight:700, cursor:'pointer'}}>{label}</button>
  );
  const dInput = (val, set) => (
    <input type="date" value={val} max={hoyStr()} onChange={e => set(e.target.value)}
      style={{flex:1, minWidth:0, background:U.surface2, border:`1px solid ${U.border}`, color:U.ink,
              borderRadius:9, padding:'8px 10px', fontSize:12}}/>
  );

  return (
    <div>
      {/* Controles de período */}
      <div style={{display:'flex', gap:6, marginBottom:8}}>
        {presetBtn(1, 'Hoy')}{presetBtn(7, '7 días')}{presetBtn(30, '30 días')}{presetBtn(90, '90 días')}
      </div>
      <div style={{display:'flex', gap:8, alignItems:'center', marginBottom:16}}>
        {dInput(desde, setDesde)}
        <span style={{color:U.inkMuted, fontSize:12}}>→</span>
        {dInput(hasta, setHasta)}
        <button onClick={exportXlsx} title="Exportar a Excel"
          style={{border:'none', background:U.accent, color:'#fff', borderRadius:9, padding:'8px 11px', cursor:'pointer', display:'flex', alignItems:'center'}}>
          <Icon n="download" s={15} c="#fff"/>
        </button>
      </div>

      {loading ? (
        <div style={{textAlign:'center', color:U.inkMuted, padding:'40px 0', fontSize:13}}>Cargando histórico…</div>
      ) : (
        <div>
          {/* KPIs */}
          <div style={{display:'flex', gap:8, marginBottom:8}}>
            {card('Embalado', k.embalado || 0, U.ok)}
            {card('Piezas cortadas', k.piezas_cortadas || 0, U.cnc)}
          </div>
          <div style={{display:'flex', gap:8, marginBottom:8}}>
            {card('Melamina term.', k.melamina_term || 0, U.mel)}
            {card('Patas term.', k.patas_term || 0, U.pino)}
          </div>
          <div style={{display:'flex', gap:8, marginBottom:16}}>
            {card('Jornadas', k.jornadas || 0, U.ink)}
            {card('Fallas melamina', k.melamina_fallas || 0, (k.melamina_fallas ? U.warn : U.inkSoft))}
            {card('Mant. recibidos', k.mant_recibidos || 0, U.ink)}
          </div>

          {/* Comparativa */}
          <div style={{background:U.surface, border:`1px solid ${U.border}`, borderRadius:14, padding:'12px 14px',
                       marginBottom:16, display:'flex', alignItems:'center', justifyContent:'space-between'}}>
            <div>
              <div style={{fontSize:11, color:U.inkSoft, fontWeight:600}}>Embalado vs período anterior</div>
              <div style={{fontSize:10.5, color:U.inkMuted, marginTop:2}}>{comp.prev_desde || '—'} a {comp.prev_hasta || '—'}: {embPrev}</div>
            </div>
            <div style={{fontSize:18, fontWeight:800, color:deltaCol, fontVariantNumeric:'tabular-nums'}}>
              {deltaPct > 0 ? '+' : ''}{deltaPct}%
            </div>
          </div>

          {/* Producción por día (embalado) */}
          <h3 style={{fontSize:13.5, fontWeight:800, margin:'0 0 10px', color:U.ink}}>Embalado por día</h3>
          {porDia.length === 0 ? (
            <div style={{background:U.surface, border:`1px solid ${U.border}`, borderRadius:12, padding:'14px',
                         fontSize:12.5, color:U.inkSoft, textAlign:'center', marginBottom:16}}>Sin jornadas en el período.</div>
          ) : (
            <div style={{background:U.surface, border:`1px solid ${U.border}`, borderRadius:14, padding:'14px 12px 10px',
                         marginBottom:16, display:'flex', alignItems:'flex-end', gap:3, height:120, overflowX:'auto'}}>
              {porDia.map((d, i) => {
                const v = Number(d.embalaje) || 0;
                const h = Math.round((v / maxEmb) * 84);
                return (
                  <div key={d.dia || i} title={`${d.dia}: ${v}`} style={{flex:'1 0 14px', minWidth:14, display:'flex', flexDirection:'column', alignItems:'center', gap:4}}>
                    <span style={{fontSize:8.5, color:U.inkMuted, fontVariantNumeric:'tabular-nums'}}>{v || ''}</span>
                    <div style={{width:'100%', maxWidth:18, height:Math.max(h, v > 0 ? 4 : 1), background: v > 0 ? U.ok : U.border, borderRadius:3}}/>
                    <span style={{fontSize:7.5, color:U.inkMuted}}>{String(d.dia || '').slice(8, 10)}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Top productos */}
          <h3 style={{fontSize:13.5, fontWeight:800, margin:'0 0 10px', color:U.ink}}>Top productos embalados</h3>
          {top.length === 0 ? (
            <div style={{background:U.surface, border:`1px solid ${U.border}`, borderRadius:12, padding:'14px',
                         fontSize:12.5, color:U.inkSoft, textAlign:'center', marginBottom:16}}>Sin embalaje en el período.</div>
          ) : (
            <div style={{background:U.surface, border:`1px solid ${U.border}`, borderRadius:14, overflow:'hidden', marginBottom:16}}>
              {top.slice(0, 10).map((t, i) => (
                <div key={t.producto_sku || i} style={{display:'flex', alignItems:'center', justifyContent:'space-between',
                             padding:'10px 13px', borderBottom: i < Math.min(top.length, 10) - 1 ? `1px solid ${U.border}` : 'none'}}>
                  <div style={{minWidth:0, paddingRight:10}}>
                    <div style={{fontSize:12.5, fontWeight:700, color:U.ink, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{t.nombre || t.producto_sku}</div>
                    <div style={{fontSize:10, color:U.inkMuted}}>{t.producto_sku}</div>
                  </div>
                  <span style={{fontSize:14, fontWeight:800, color:U.ok, fontVariantNumeric:'tabular-nums'}}>{t.unidades}</span>
                </div>
              ))}
            </div>
          )}

          {/* Mantenimientos recibidos */}
          <h3 style={{fontSize:13.5, fontWeight:800, margin:'0 0 10px', color:U.ink}}>Mantenimientos recibidos</h3>
          {mant.length === 0 ? (
            <div style={{background:U.surface, border:`1px solid ${U.border}`, borderRadius:12, padding:'14px',
                         fontSize:12.5, color:U.inkSoft, textAlign:'center'}}>Ninguno en el período.</div>
          ) : (
            <div style={{display:'flex', flexDirection:'column', gap:8}}>
              {mant.slice(0, 10).map(m => (
                <div key={m.id} style={{background:U.surface, border:`1px solid ${U.border}`, borderRadius:12, padding:'11px 13px'}}>
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                    <span style={{fontSize:12.5, fontWeight:700, color:U.ink, textTransform:'capitalize'}}>{m.sector} · {m.tipo || 'mantenimiento'}</span>
                    <span style={{fontSize:10, color:U.inkMuted}}>{String(m.created_at || '').slice(0, 10)}</span>
                  </div>
                  {m.maquina ? <div style={{fontSize:11, color:U.inkSoft, marginTop:3}}>{m.maquina}</div> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

window.EncargadoPanel = EncargadoPanel;
