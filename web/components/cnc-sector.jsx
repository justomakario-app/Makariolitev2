/* ══ SECTOR CNC — Línea productiva (FASE 3) ════════════════════════════
   Pantalla del operario CNC. Mobile-first ~430px, dark mode, azul #2563EB.
   4 tabs: Inicio (demanda + cortes del día) · Scan (registrar corte) ·
   Solicitud · Mantenimiento.
   Data layer: window.LP_DATA (lp-data.jsx). UI compartida: lp-ui.jsx
   (LpClock, LpSolicitud, LpMant). NO toca data.js ni el store de la app.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Tokens dark del sector CNC ── */
/* Paleta integrada a la plataforma (clara/premium). Tokenizado: cambiar la
   paleta re-tematiza todo el sector sin tocar la estructura. Acento = CNC. */
const CNC_UI = {
  accent:'#2563EB', accentSoft:'rgba(37,99,235,.08)', accentLine:'rgba(37,99,235,.20)',
  bg:'transparent', surface:'#FFFFFF', surface2:'#F4F4F5', border:'rgba(0,0,0,0.09)',
  ink:'#0A0A0A', inkSoft:'#555555', inkMuted:'#8A8A8A', danger:'#DC2626', warn:'#D97706', ok:'#16A34A',
  radius:10,
};

/* Categoría de placa (para la selección agrupada del Scan). */
function lpPlacaCat(sku) {
  const s = String(sku || '');
  if (s.startsWith('COM')) return 'Combinadas';
  if (s.startsWith('PMB') || s.startsWith('PMN')) return 'Mármol';
  if (s.startsWith('PLN')) return 'Negras';
  if (s.startsWith('PLB')) return 'Blancas';
  return 'Otras';
}
const LP_CAT_ORDER = ['Blancas', 'Negras', 'Mármol', 'Combinadas', 'Otras'];

/* Catálogos del sector (Solicitud / Mantenimiento) — brief CNC. */
const CNC_SOLICITUD_CAT = [
  { grupo:'Fresas',       items:['Fresa compresión (doble cara)', 'Fresa filo horario (cara superior)'] },
  { grupo:'Esponja',      items:['Esponja limpieza de guías'] },
  { grupo:'Lubricantes',  items:['Aceite', 'Grasa', 'WD-40'] },
  { grupo:'Refrigerante', items:['Agua destilada'] },
];
const CNC_MANT_TIPOS = ['Mecánico', 'Eléctrico', 'Software/CNC', 'Temperatura', 'Ruido/vibración', 'Preventivo'];

function CncSector() {
  const U = CNC_UI;
  const toast = useToast();
  const [tab, setTab] = useState('inicio');
  const [jornada, setJornada] = useState(null);
  const [placas, setPlacas] = useState([]);
  const [cortes, setCortes] = useState([]);
  const [demanda, setDemanda] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const placaMap = useMemo(() => {
    const m = {}; for (const p of placas) m[p.sku] = p; return m;
  }, [placas]);

  const jornadaAbierta = jornada && jornada.estado === 'abierta';

  const cargar = useCallback(async (opts) => {
    if (!(opts && opts.silent)) setLoading(true);
    try {
      const j = await window.LP_DATA.jornadaHoy();
      setJornada(j);
      const [pl, ct, dm] = await Promise.all([
        window.LP_DATA.placas().catch(() => []),
        j && j.jornada_id ? window.LP_DATA.cortesDia(j.jornada_id).catch(() => []) : Promise.resolve([]),
        window.LP_DATA.resumenDia().catch(() => []),
      ]);
      setPlacas(pl); setCortes(ct); setDemanda(dm);
    } catch (err) {
      toast.error(err && err.message ? err.message : 'No se pudo cargar el sector');
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { cargar(); }, [cargar]);

  // 🔴 Realtime (Fase 4.2): refresca en vivo ante cargas propias / jornada.
  useEffect(() => window.LP_DATA.subscribe(
    ['prod_corte', 'prod_jornada'],
    () => cargar({ silent: true })
  ), [cargar]);

  const cortesView = useMemo(() => cortes.map(c => {
    const p = placaMap[c.placa_sku] || {};
    const rend = Number(p.rendimiento) || 0;
    const generadas = (Number(c.hojas) || 0) * rend;
    const totales = Math.max(generadas - (Number(c.desperdicio) || 0), 0);
    return { id: c.id, placa_sku: c.placa_sku, hojas: c.hojas, desperdicio: c.desperdicio,
             nombre: p.nombre || c.placa_sku, material: p.material || '', generadas, totales,
             editable: c.editable_hasta ? (new Date(c.editable_hasta) > new Date()) : false };
  }), [cortes, placaMap]);
  const totalNeto = cortesView.reduce((s, c) => s + c.totales, 0);

  const NAV = [
    { id:'inicio',    label:'Inicio',    icon:'home', badge: demanda.length },
    { id:'opt',       label:'Optimizar', icon:'spark' },
    { id:'scan',      label:'Scan',      icon:'qr' },
    { id:'solicitud', label:'Solicitud', icon:'package' },
    { id:'mant',      label:'Mant.',     icon:'tools' },
  ];

  return (
    <div style={{background:U.bg, color:U.ink, fontSize:13, padding:'0 32px 32px'}}>

      {/* ── Header de sección (integrado, sin marco de teléfono) ── */}
      <div style={{padding:'18px 0 14px', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
        <div style={{display:'flex', alignItems:'center', gap:9}}>
          <span style={{width:34, height:34, borderRadius:10, background:U.accentSoft,
                        border:`1px solid ${U.accentLine}`, display:'flex', alignItems:'center', justifyContent:'center'}}>
            <Icon n="layers" s={18} c={U.accent}/>
          </span>
          <div>
            <div style={{fontSize:14, fontWeight:800, letterSpacing:'.02em', lineHeight:1.1}}>CNC</div>
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
                        background: jornadaAbierta ? 'rgba(0,214,143,.14)' : 'rgba(255,64,96,.14)',
                        color: jornadaAbierta ? U.ok : U.danger}}>
            {jornada ? (jornadaAbierta ? 'Jornada abierta' : 'Jornada cerrada') : 'Sin jornada'}
          </span>
        </div>
      </div>

      {/* ── Tabs (estilo plataforma, arriba) ── */}
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
                <span style={{minWidth:16, height:16, padding:'0 4px', borderRadius:999, background:U.accent,
                              color:'#fff', fontSize:9.5, fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1}}>{n.badge}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* ── Contenido ── */}
      <div>
        {loading ? (
          <div style={{textAlign:'center', color:U.inkMuted, padding:'60px 0', fontSize:13}}>Cargando sector…</div>
        ) : tab === 'inicio' ? (
          <CncInicio U={U} jornadaAbierta={jornadaAbierta} jornada={jornada} cortes={cortesView} totalNeto={totalNeto} demanda={demanda} onEdit={setEditing}/>
        ) : tab === 'opt' ? (
          <CncOptimizacion U={U} placaMap={placaMap} toast={toast}/>
        ) : tab === 'scan' ? (
          <CncScan U={U} jornadaAbierta={jornadaAbierta} placas={placas}
                   onRegistrado={cargar} toast={toast} goInicio={() => setTab('inicio')}/>
        ) : tab === 'solicitud' ? (
          <LpSolicitud U={U} sector="cnc" catalogo={CNC_SOLICITUD_CAT} toast={toast}/>
        ) : (
          <LpMant U={U} sector="cnc" tipos={CNC_MANT_TIPOS} toast={toast}/>
        )}
      </div>

      {editing && (
        <LpEditModal U={U} titulo="Editar corte"
          campos={[{ key:'hojas', label:'Hojas' }, { key:'desperdicio', label:'Desperdicio' }]}
          inicial={{ hojas: editing.hojas, desperdicio: editing.desperdicio }}
          onCerrar={() => setEditing(null)}
          onGuardar={async (v, motivo) => {
            try {
              await window.LP_DATA.editarCorte({ id: editing.id, hojas: v.hojas, desperdicio: v.desperdicio, motivo });
              toast.success('Corte actualizado'); setEditing(null); await cargar();
            } catch (err) { toast.error(err && err.message ? err.message : 'No se pudo editar'); }
          }}/>
      )}
    </div>
  );
}

/* ── Tab Inicio ── */
function CncInicio({ U, jornadaAbierta, jornada, cortes, totalNeto, demanda, onEdit }) {
  return (
    <div>
      {!jornadaAbierta && (
        <div style={{background:'rgba(255,64,96,.10)', border:`1px solid rgba(255,64,96,.28)`,
                     borderRadius:12, padding:'12px 14px', marginBottom:16, display:'flex', gap:10, alignItems:'flex-start'}}>
          <Icon n="alert" s={17} c={U.danger}/>
          <div style={{fontSize:12.5, lineHeight:1.5, color:U.ink}}>
            {jornada ? 'La jornada de hoy está cerrada.' : 'Todavía no se abrió la jornada de hoy.'}
            <span style={{color:U.inkSoft}}> El encargado la gestiona — podés ver lo cargado pero no registrar cortes.</span>
          </div>
        </div>
      )}

      {demanda && demanda.length > 0 && (
        <div style={{marginBottom:18}}>
          <h3 style={{fontSize:15, fontWeight:800, margin:'0 0 10px', color:U.ink}}>Resumen del día</h3>
          <div style={{background:U.surface, border:`1px solid ${U.border}`, borderRadius:14, overflow:'hidden'}}>
            {demanda.slice(0, 12).map((d, i) => (
              <div key={d.producto_sku || i} style={{display:'flex', alignItems:'center', justifyContent:'space-between',
                           padding:'10px 12px', borderBottom: i < Math.min(demanda.length, 12) - 1 ? `1px solid ${U.border}` : 'none'}}>
                <div style={{minWidth:0, paddingRight:10}}>
                  <div style={{fontSize:12.5, fontWeight:700, color:U.ink, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{d.nombre || d.producto_sku}</div>
                  <div style={{fontSize:10.5, color:U.inkMuted}}>{d.producto_sku}{d.color ? ` · ${d.color}` : ''}</div>
                </div>
                <span style={{fontSize:15, fontWeight:800, color:U.accent, fontVariantNumeric:'tabular-nums'}}>{d.pendiente}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:12}}>
        <h3 style={{fontSize:15, fontWeight:800, margin:0, color:U.ink}}>Cortes del día</h3>
        <span style={{fontSize:11, color:U.inkMuted}}>{cortes.length} {cortes.length === 1 ? 'registro' : 'registros'}</span>
      </div>

      {cortes.length === 0 ? (
        <div style={{textAlign:'center', color:U.inkMuted, padding:'40px 12px', background:U.surface,
                     border:`1px solid ${U.border}`, borderRadius:14}}>
          <Icon n="layers" s={26} c={U.inkMuted}/>
          <p style={{fontSize:12.5, margin:'12px 0 0'}}>Sin cortes cargados hoy.</p>
        </div>
      ) : (
        <div style={{background:U.surface, border:`1px solid ${U.border}`, borderRadius:14, overflow:'hidden'}}>
          <div style={{display:'grid', gridTemplateColumns:'1fr 46px 56px 56px', gap:4, padding:'10px 12px',
                       fontSize:9.5, fontWeight:800, letterSpacing:'.06em', textTransform:'uppercase',
                       color:U.inkMuted, borderBottom:`1px solid ${U.border}`}}>
            <span>Placa</span><span style={{textAlign:'right'}}>Hojas</span>
            <span style={{textAlign:'right'}}>Gener.</span><span style={{textAlign:'right'}}>Netas</span>
          </div>
          {cortes.map(c => (
            <div key={c.id} onClick={c.editable ? () => onEdit(c) : undefined}
                 style={{display:'grid', gridTemplateColumns:'1fr 46px 56px 56px', gap:4,
                         padding:'11px 12px', alignItems:'center', borderBottom:`1px solid ${U.border}`, fontSize:12.5,
                         cursor: c.editable ? 'pointer' : 'default'}}>
              <div style={{minWidth:0}}>
                <div style={{fontWeight:700, color:U.ink, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{c.nombre}</div>
                <div style={{fontSize:10.5, color:U.inkMuted}}>{c.placa_sku}{c.desperdicio ? ` · ${c.desperdicio} desp.` : ''}{c.editable ? ' · ✎ editar' : ''}</div>
              </div>
              <span style={{textAlign:'right', fontVariantNumeric:'tabular-nums', color:U.inkSoft}}>{c.hojas}</span>
              <span style={{textAlign:'right', fontVariantNumeric:'tabular-nums', color:U.inkSoft}}>{c.generadas}</span>
              <span style={{textAlign:'right', fontVariantNumeric:'tabular-nums', fontWeight:800, color:U.accent}}>{c.totales}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{marginTop:16, background:U.accentSoft, border:`1px solid ${U.accentLine}`, borderRadius:14,
                   padding:'14px 16px', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
        <div style={{display:'flex', alignItems:'center', gap:10}}>
          <Icon n="arrow-right" s={18} c={U.accent}/>
          <span style={{fontSize:12.5, fontWeight:700, color:U.ink}}>Piezas netas → Melamina</span>
        </div>
        <span style={{fontSize:22, fontWeight:800, color:U.ok, fontVariantNumeric:'tabular-nums'}}>{totalNeto}</span>
      </div>
    </div>
  );
}

/* ── Tab Scan (selección manual agrupada + registrar corte) ── */
function CncScan({ U, jornadaAbierta, placas, onRegistrado, toast, goInicio }) {
  const [sel, setSel] = useState(null);
  const [hojas, setHojas] = useState('');
  const [desp, setDesp] = useState('');
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);

  const grupos = useMemo(() => {
    const g = {};
    for (const p of placas) { const k = lpPlacaCat(p.sku); (g[k] = g[k] || []).push(p); }
    return LP_CAT_ORDER.filter(k => g[k]).map(k => ({ cat:k, items:g[k] }));
  }, [placas]);

  const rend = Number(sel && sel.rendimiento) || 0;
  const nH = parseInt(hojas, 10); const nD = parseInt(desp, 10) || 0;
  const preview = sel && Number.isFinite(nH) && nH > 0 ? Math.max(nH * rend - nD, 0) : null;
  const puedeEnviar = jornadaAbierta && sel && Number.isFinite(nH) && nH > 0 && !saving;

  const enviar = async () => {
    if (!puedeEnviar) return;
    setSaving(true);
    try {
      const res = await window.LP_DATA.registrarCorte({ placa_sku: sel.sku, hojas: nH, desperdicio: nD });
      const pg = res && res.piezas_generadas != null ? res.piezas_generadas : preview;
      toast.success(`+${pg} piezas → Melamina`);
      setSel(null); setHojas(''); setDesp('');
      await onRegistrado();
      goInicio();
    } catch (err) {
      toast.error(err && err.message ? err.message : 'No se pudo registrar el corte');
    } finally { setSaving(false); }
  };

  const inputStyle = {
    width:'100%', boxSizing:'border-box', background:U.surface2, border:`1px solid ${U.border}`,
    borderRadius:12, color:U.ink, fontSize:20, fontWeight:800, textAlign:'center',
    padding:'14px 10px', outline:'none', fontVariantNumeric:'tabular-nums',
  };

  if (!jornadaAbierta) {
    return (
      <div style={{textAlign:'center', color:U.inkMuted, padding:'56px 16px'}}>
        <Icon n="lock" s={28} c={U.inkMuted}/>
        <h3 style={{color:U.ink, fontSize:16, fontWeight:800, margin:'14px 0 6px'}}>Jornada no abierta</h3>
        <p style={{fontSize:12.5, lineHeight:1.6, maxWidth:280, margin:'0 auto'}}>
          No se pueden registrar cortes hasta que el encargado abra la jornada de hoy.
        </p>
      </div>
    );
  }

  return (
    <div>
      <button onClick={() => window.QrScanner ? setScanning(true) : toast.info('El escáner no está disponible en este dispositivo')}
              style={{width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:9,
                    background:U.accentSoft, border:`1px solid ${U.accentLine}`, borderRadius:14, color:U.accent,
                    padding:'13px', fontSize:12.5, fontWeight:700, cursor:'pointer', marginBottom:18}}>
        <Icon n="qr" s={17} c={U.accent}/> Escanear QR de placa
      </button>

      <div style={{fontSize:10, fontWeight:800, letterSpacing:'.12em', textTransform:'uppercase', color:U.inkMuted, marginBottom:10}}>
        1 · Elegí la placa
      </div>
      {grupos.length === 0 ? (
        <div style={{textAlign:'center', color:U.inkMuted, padding:'30px 12px', background:U.surface,
                     border:`1px solid ${U.border}`, borderRadius:12, fontSize:12.5, marginBottom:18}}>
          No hay placas cargadas todavía (se cargan al importar el catálogo).
        </div>
      ) : grupos.map(g => (
        <div key={g.cat} style={{marginBottom:14}}>
          <div style={{fontSize:11, fontWeight:700, color:U.inkSoft, marginBottom:7}}>{g.cat}</div>
          <div style={{display:'flex', flexWrap:'wrap', gap:8}}>
            {g.items.map(p => {
              const on = sel && sel.sku === p.sku;
              return (
                <button key={p.sku} onClick={() => setSel(p)}
                  style={{border:`1px solid ${on ? U.accent : U.border}`, background: on ? U.accentSoft : U.surface,
                          color: on ? U.ink : U.inkSoft, borderRadius:11, padding:'9px 12px', cursor:'pointer',
                          textAlign:'left', minWidth:96, transition:'all .12s ease'}}>
                  <div style={{fontSize:12.5, fontWeight:700, color:on ? U.ink : U.inkSoft}}>{p.nombre || p.sku}</div>
                  <div style={{fontSize:10, color: on ? U.accent : U.inkMuted, marginTop:1}}>
                    {p.sku} · rinde {p.rendimiento != null ? p.rendimiento : '—'}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {sel && (
        <div>
          <div style={{fontSize:10, fontWeight:800, letterSpacing:'.12em', textTransform:'uppercase',
                       color:U.inkMuted, margin:'18px 0 10px'}}>2 · Cantidades</div>
          <div style={{display:'flex', gap:12}}>
            <label style={{flex:1}}>
              <span style={{display:'block', fontSize:11, color:U.inkSoft, marginBottom:6}}>Hojas cortadas</span>
              <input type="number" inputMode="numeric" min="0" value={hojas} placeholder="0"
                     onChange={e => setHojas(e.target.value)} style={inputStyle}/>
            </label>
            <label style={{flex:1}}>
              <span style={{display:'block', fontSize:11, color:U.inkSoft, marginBottom:6}}>Desperdicio</span>
              <input type="number" inputMode="numeric" min="0" value={desp} placeholder="0"
                     onChange={e => setDesp(e.target.value)} style={inputStyle}/>
            </label>
          </div>

          <div style={{marginTop:16, background:U.accentSoft, border:`1px solid ${U.accentLine}`, borderRadius:14, padding:'14px 16px'}}>
            <div style={{fontSize:10, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:U.accent, marginBottom:8}}>
              Vista previa
            </div>
            <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between'}}>
              <span style={{fontSize:12.5, color:U.inkSoft}}>
                {nH > 0 ? `${nH} hojas × ${rend} − ${nD} desp.` : 'Ingresá las hojas'}
              </span>
              <span style={{fontSize:26, fontWeight:800, color:U.ok, fontVariantNumeric:'tabular-nums'}}>
                {preview != null ? preview : '—'}
              </span>
            </div>
            <div style={{fontSize:11, color:U.inkMuted, marginTop:4}}>piezas netas que pasan a Melamina</div>
          </div>

          <button onClick={enviar} disabled={!puedeEnviar}
            style={{width:'100%', marginTop:16, padding:'15px', borderRadius:14, border:'none',
                    background: puedeEnviar ? U.accent : U.surface2, color: puedeEnviar ? '#fff' : U.inkMuted,
                    fontSize:15, fontWeight:800, cursor: puedeEnviar ? 'pointer' : 'not-allowed',
                    display:'flex', alignItems:'center', justifyContent:'center', gap:8, transition:'all .15s ease'}}>
            <Icon n="plus" s={18} c={puedeEnviar ? '#fff' : U.inkMuted}/>
            {saving ? 'Registrando…' : 'Agregar al reporte'}
          </button>
        </div>
      )}

      {scanning && (
        <LpQrScan U={U} onClose={() => setScanning(false)}
          onDetect={(text) => {
            let sku = text || '';
            if (sku.indexOf('·') >= 0) sku = sku.split('·').pop().trim();
            if (sku.indexOf(' ') >= 0) sku = sku.split(' ').pop().trim();
            const p = placas.find(x => x.sku === sku);
            setScanning(false);
            if (p) { setSel(p); toast.success(`Placa ${sku}`); }
            else { toast.error(`SKU no reconocido: ${sku}`); }
          }}/>
      )}
    </div>
  );
}

/* ── Tab Optimizar (Fase 5b: plan de corte óptimo por demanda) ──────────
   Llama a prod_rpc_plan_corte: minimiza la CANTIDAD de placas (y a igualdad,
   la merma) aprovechando las placas combinadas. Solo lectura. */
function CncOptimizacion({ U, placaMap, toast }) {
  const [plan, setPlan] = useState(null);   // { total_placas, total_merma, plan:[] }
  const [piezaMap, setPiezaMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [pz, res] = await Promise.all([
        window.LP_DATA.piezas().catch(() => []),
        window.LP_DATA.planCorte(),
      ]);
      const pm = {}; for (const p of pz) pm[p.sku] = p.nombre || p.sku;
      setPiezaMap(pm);
      setPlan(res || { total_placas:0, total_merma:0, plan:[] });
    } catch (err) {
      setError(err && err.message ? err.message : 'No se pudo calcular el plan');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  // Combinadas primero (son la jugada que ahorra placas), luego simples.
  const items = useMemo(() => {
    const list = (plan && Array.isArray(plan.plan)) ? plan.plan.slice() : [];
    return list.sort((a, b) => {
      if (a.tipo !== b.tipo) return a.tipo === 'combinada' ? -1 : 1;
      return (b.cantidad || 0) - (a.cantidad || 0);
    });
  }, [plan]);

  if (loading) {
    return <div style={{textAlign:'center', color:U.inkMuted, padding:'60px 0', fontSize:13}}>Calculando plan de corte…</div>;
  }
  if (error) {
    return (
      <div style={{textAlign:'center', padding:'48px 16px'}}>
        <Icon n="alert" s={26} c={U.danger}/>
        <p style={{fontSize:12.5, color:U.ink, margin:'12px 0 14px', maxWidth:300, marginLeft:'auto', marginRight:'auto'}}>{error}</p>
        <button onClick={cargar} style={{border:`1px solid ${U.border}`, background:U.surface, color:U.ink,
          borderRadius:11, padding:'9px 16px', fontSize:12.5, fontWeight:700, cursor:'pointer'}}>Reintentar</button>
      </div>
    );
  }

  const tieneDemanda = items.length > 0;

  return (
    <div>
      {/* Intro */}
      <div style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, marginBottom:16}}>
        <div style={{display:'flex', gap:10, alignItems:'flex-start', minWidth:0}}>
          <span style={{width:30, height:30, flexShrink:0, borderRadius:9, background:U.accentSoft,
                        border:`1px solid ${U.accentLine}`, display:'flex', alignItems:'center', justifyContent:'center'}}>
            <Icon n="spark" s={16} c={U.accent}/>
          </span>
          <div style={{minWidth:0}}>
            <h3 style={{fontSize:15, fontWeight:800, margin:0, color:U.ink}}>Plan de corte sugerido</h3>
            <p style={{fontSize:11.5, color:U.inkSoft, margin:'3px 0 0', lineHeight:1.5}}>
              Cubre la demanda pendiente con la menor cantidad de placas. Las combinadas rinden 2 medidas en un corte.
            </p>
          </div>
        </div>
        <button onClick={cargar} title="Recalcular"
          style={{flexShrink:0, border:`1px solid ${U.border}`, background:U.surface, color:U.inkSoft,
                  borderRadius:10, padding:'8px 10px', cursor:'pointer', display:'flex', alignItems:'center', gap:6, fontSize:11.5, fontWeight:700}}>
          <Icon n="refresh" s={14} c={U.inkSoft}/> Recalcular
        </button>
      </div>

      {/* KPIs */}
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:18}}>
        <div style={{background:U.accentSoft, border:`1px solid ${U.accentLine}`, borderRadius:14, padding:'14px 16px'}}>
          <div style={{fontSize:9.5, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:U.accent}}>Placas a cortar</div>
          <div style={{fontSize:28, fontWeight:800, color:U.ink, fontVariantNumeric:'tabular-nums', marginTop:2}}>{plan.total_placas}</div>
        </div>
        <div style={{background:U.surface, border:`1px solid ${U.border}`, borderRadius:14, padding:'14px 16px'}}>
          <div style={{fontSize:9.5, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:U.inkMuted}}>Merma (piezas)</div>
          <div style={{fontSize:28, fontWeight:800, color: plan.total_merma > 0 ? U.warn : U.ok, fontVariantNumeric:'tabular-nums', marginTop:2}}>{plan.total_merma}</div>
        </div>
      </div>

      {!tieneDemanda ? (
        <div style={{textAlign:'center', color:U.inkMuted, padding:'40px 12px', background:U.surface,
                     border:`1px solid ${U.border}`, borderRadius:14}}>
          <Icon n="check-circle" s={26} c={U.ok}/>
          <p style={{fontSize:12.5, margin:'12px 0 0', color:U.ink, fontWeight:700}}>Sin demanda de tapas pendiente.</p>
          <p style={{fontSize:11.5, margin:'4px 0 0'}}>No hace falta cortar placas por ahora.</p>
        </div>
      ) : (
        <div style={{display:'flex', flexDirection:'column', gap:10}}>
          {items.map((it, i) => {
            const pl = placaMap[it.placa] || {};
            const combinada = it.tipo === 'combinada';
            const produce = it.produce || {};
            const keys = Object.keys(produce);
            return (
              <div key={(it.placa || '') + i} style={{background:U.surface, border:`1px solid ${combinada ? U.accentLine : U.border}`,
                           borderRadius:14, padding:'13px 14px'}}>
                <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:10}}>
                  <div style={{minWidth:0}}>
                    <div style={{display:'flex', alignItems:'center', gap:7}}>
                      <span style={{fontSize:13.5, fontWeight:800, color:U.ink}}>{pl.nombre || it.placa}</span>
                      {combinada && (
                        <span style={{fontSize:9, fontWeight:800, letterSpacing:'.06em', textTransform:'uppercase',
                                      color:U.accent, background:U.accentSoft, border:`1px solid ${U.accentLine}`,
                                      borderRadius:999, padding:'2px 7px'}}>Combinada</span>
                      )}
                    </div>
                    <div style={{fontSize:10.5, color:U.inkMuted, marginTop:2}}>
                      {it.placa}{it.material ? ` · ${it.material}` : ''}
                    </div>
                  </div>
                  <div style={{textAlign:'right', flexShrink:0}}>
                    <div style={{fontSize:24, fontWeight:800, color:U.accent, fontVariantNumeric:'tabular-nums', lineHeight:1}}>{it.cantidad}</div>
                    <div style={{fontSize:9.5, color:U.inkMuted, fontWeight:700, letterSpacing:'.04em', textTransform:'uppercase'}}>placas</div>
                  </div>
                </div>
                {keys.length > 0 && (
                  <div style={{display:'flex', flexWrap:'wrap', gap:6, marginTop:11, paddingTop:11, borderTop:`1px solid ${U.border}`}}>
                    {keys.map(k => (
                      <span key={k} style={{display:'inline-flex', alignItems:'center', gap:5, fontSize:11,
                                    background:U.surface2, border:`1px solid ${U.border}`, borderRadius:999, padding:'4px 9px'}}>
                        <span style={{color:U.inkSoft, fontWeight:600}}>{piezaMap[k] || k}</span>
                        <span style={{color:U.ink, fontWeight:800, fontVariantNumeric:'tabular-nums'}}>{produce[k]}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

window.CncSector = CncSector;
