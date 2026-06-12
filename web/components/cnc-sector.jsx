/* ══ SECTOR CNC — Línea productiva (FASE 3) ════════════════════════════
   Pantalla del operario CNC. Mobile-first ~430px, dark mode, azul #2563EB.
   - Tab Inicio:      resumen del día (demanda) + cortes del día + neto a Melamina.
   - Tab Scan:        registrar corte (selección manual agrupada → registrar_corte).
   - Tab Solicitud:   pedido de insumos del sector → crear_solicitud.
   - Tab Mantenimiento: reporte de máquina → reportar_mantenimiento.

   Data layer aislada en window.LP_DATA (reutilizable por los otros sectores).
   Usa window.SUPA (cliente expuesto por data.js) — el JWT de sesión resuelve
   auth.uid() en el backend. NO toca data.js ni el store del resto de la app.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Data layer de Línea productiva (definida una vez, compartida) ── */
window.LP_DATA = window.LP_DATA || {
  async jornadaHoy() {
    const { data, error } = await window.SUPA.rpc('prod_rpc_get_jornada_hoy', { p_payload: {} });
    if (error) throw new Error(error.message);
    return data; // {jornada_id, fecha, estado} | null
  },
  async placas() {
    const { data, error } = await window.SUPA.from('prod_placa')
      .select('sku, nombre, material, rendimiento, pieza_sku, combinada').order('sku');
    if (error) throw new Error(error.message);
    return data || [];
  },
  async registrarCorte(payload) {
    const { data, error } = await window.SUPA.rpc('prod_rpc_registrar_corte', { p_payload: payload });
    if (error) throw new Error(error.message);
    return data; // {ok, corte_id, piezas_generadas}
  },
  async cortesDia(jornadaId) {
    const { data, error } = await window.SUPA.from('prod_corte')
      .select('id, placa_sku, hojas, desperdicio, created_at')
      .eq('jornada_id', jornadaId).order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  },
  async resumenDia() {
    const { data, error } = await window.SUPA.from('prod_v_resumen_dia')
      .select('producto_sku, nombre, color, pendiente').order('pendiente', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  },
  async crearSolicitud(payload) {
    const { data, error } = await window.SUPA.rpc('prod_rpc_crear_solicitud', { p_payload: payload });
    if (error) throw new Error(error.message);
    return data;
  },
  async reportarMantenimiento(payload) {
    const { data, error } = await window.SUPA.rpc('prod_rpc_reportar_mantenimiento', { p_payload: payload });
    if (error) throw new Error(error.message);
    return data;
  },
};

/* ── Tokens dark del sector CNC ── */
const CNC_UI = {
  accent:'#2563EB', accentSoft:'rgba(37,99,235,.14)', accentLine:'rgba(37,99,235,.32)',
  bg:'#0B0F1A', surface:'#121826', surface2:'#1A2236', border:'#232C42',
  ink:'#F1F5F9', inkSoft:'#94A3B8', inkMuted:'#64748B', danger:'#F87171', warn:'#FBBF24', ok:'#34D399',
  radius:16,
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
const LP_URGENCIAS = [
  { id:'alta',  label:'Alta',  color:'#F87171' },
  { id:'media', label:'Media', color:'#FBBF24' },
  { id:'baja',  label:'Baja',  color:'#34D399' },
];

/* ── Reloj de la topbar ── */
function LpClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(id); }, []);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return <span>{hh}:{mm}</span>;
}

function CncSector() {
  const U = CNC_UI;
  const toast = useToast();
  const [tab, setTab] = useState('inicio');
  const [jornada, setJornada] = useState(null);   // {jornada_id, fecha, estado} | null
  const [placas, setPlacas] = useState([]);
  const [cortes, setCortes] = useState([]);
  const [demanda, setDemanda] = useState([]);
  const [loading, setLoading] = useState(true);

  const placaMap = useMemo(() => {
    const m = {}; for (const p of placas) m[p.sku] = p; return m;
  }, [placas]);

  const jornadaAbierta = jornada && jornada.estado === 'abierta';

  const cargar = useCallback(async () => {
    setLoading(true);
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

  /* derivados de "cortes del día" */
  const cortesView = useMemo(() => cortes.map(c => {
    const p = placaMap[c.placa_sku] || {};
    const rend = Number(p.rendimiento) || 0;
    const generadas = (Number(c.hojas) || 0) * rend;
    const totales = Math.max(generadas - (Number(c.desperdicio) || 0), 0);
    return { id: c.id, placa_sku: c.placa_sku, hojas: c.hojas, desperdicio: c.desperdicio,
             nombre: p.nombre || c.placa_sku, material: p.material || '', generadas, totales };
  }), [cortes, placaMap]);
  const totalNeto = cortesView.reduce((s, c) => s + c.totales, 0);

  const NAV = [
    { id:'inicio',    label:'Inicio',    icon:'home' },
    { id:'scan',      label:'Scan',      icon:'qr' },
    { id:'solicitud', label:'Solicitud', icon:'package' },
    { id:'mant',      label:'Mant.',     icon:'tools' },
  ];

  return (
    <div style={{maxWidth:430, margin:'0 auto', minHeight:600, background:U.bg, color:U.ink,
                 borderRadius:U.radius, overflow:'hidden', display:'flex', flexDirection:'column',
                 boxShadow:'0 10px 40px rgba(0,0,0,.25)', fontSize:14}}>

      {/* ── Topbar ── */}
      <div style={{padding:'16px 18px', background:U.surface, borderBottom:`1px solid ${U.border}`,
                   display:'flex', alignItems:'center', justifyContent:'space-between'}}>
        <div style={{display:'flex', alignItems:'center', gap:9}}>
          <span style={{width:34, height:34, borderRadius:10, background:U.accentSoft,
                        border:`1px solid ${U.accentLine}`, display:'flex', alignItems:'center', justifyContent:'center'}}>
            <Icon n="layers" s={18} c={U.accent}/>
          </span>
          <div>
            <div style={{fontSize:14, fontWeight:800, letterSpacing:'.02em', lineHeight:1.1}}>CNC</div>
            <div style={{display:'flex', alignItems:'center', gap:5, marginTop:2}}>
              <span style={{width:6, height:6, borderRadius:999, background:U.ok, boxShadow:`0 0 0 3px rgba(52,211,153,.18)`}}/>
              <span style={{fontSize:9.5, fontWeight:700, letterSpacing:'.14em', color:U.inkSoft, textTransform:'uppercase'}}>En vivo</span>
            </div>
          </div>
        </div>
        <div style={{textAlign:'right'}}>
          <div style={{fontSize:15, fontWeight:800, fontVariantNumeric:'tabular-nums'}}><LpClock/></div>
          <span style={{display:'inline-block', marginTop:3, fontSize:9.5, fontWeight:800, letterSpacing:'.06em',
                        textTransform:'uppercase', padding:'2px 8px', borderRadius:999,
                        background: jornadaAbierta ? 'rgba(52,211,153,.14)' : 'rgba(248,113,113,.14)',
                        color: jornadaAbierta ? U.ok : U.danger}}>
            {jornada ? (jornadaAbierta ? 'Jornada abierta' : 'Jornada cerrada') : 'Sin jornada'}
          </span>
        </div>
      </div>

      {/* ── Contenido ── */}
      <div style={{flex:1, padding:'18px', overflowY:'auto'}}>
        {loading ? (
          <div style={{textAlign:'center', color:U.inkMuted, padding:'60px 0', fontSize:13}}>Cargando sector…</div>
        ) : tab === 'inicio' ? (
          <CncInicio U={U} jornadaAbierta={jornadaAbierta} jornada={jornada} cortes={cortesView} totalNeto={totalNeto} demanda={demanda}/>
        ) : tab === 'scan' ? (
          <CncScan U={U} jornadaAbierta={jornadaAbierta} placas={placas}
                   onRegistrado={cargar} toast={toast} goInicio={() => setTab('inicio')}/>
        ) : tab === 'solicitud' ? (
          <CncSolicitud U={U} toast={toast}/>
        ) : (
          <CncMant U={U} toast={toast}/>
        )}
      </div>

      {/* ── Bottom nav ── */}
      <div style={{display:'flex', background:U.surface, borderTop:`1px solid ${U.border}`}}>
        {NAV.map(n => {
          const on = tab === n.id;
          return (
            <button key={n.id} onClick={() => setTab(n.id)}
              style={{flex:1, border:'none', background:'transparent', cursor:'pointer',
                      padding:'10px 4px 11px', display:'flex', flexDirection:'column', alignItems:'center', gap:4,
                      color: on ? U.accent : U.inkMuted, borderTop:`2px solid ${on ? U.accent : 'transparent'}`,
                      marginTop:-1, transition:'color .15s ease'}}>
              <Icon n={n.icon} s={19} c={on ? U.accent : U.inkMuted}/>
              <span style={{fontSize:10, fontWeight:on ? 800 : 600, letterSpacing:'.02em'}}>{n.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Tab Inicio ── */
function CncInicio({ U, jornadaAbierta, jornada, cortes, totalNeto, demanda }) {
  return (
    <div>
      {!jornadaAbierta && (
        <div style={{background:'rgba(248,113,113,.10)', border:`1px solid rgba(248,113,113,.28)`,
                     borderRadius:12, padding:'12px 14px', marginBottom:16, display:'flex', gap:10, alignItems:'flex-start'}}>
          <Icon n="alert" s={17} c={U.danger}/>
          <div style={{fontSize:12.5, lineHeight:1.5, color:U.ink}}>
            {jornada ? 'La jornada de hoy está cerrada.' : 'Todavía no se abrió la jornada de hoy.'}
            <span style={{color:U.inkSoft}}> El encargado la gestiona — podés ver lo cargado pero no registrar cortes.</span>
          </div>
        </div>
      )}

      {/* Resumen del día (demanda viva) */}
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
            <div key={c.id} style={{display:'grid', gridTemplateColumns:'1fr 46px 56px 56px', gap:4,
                         padding:'11px 12px', alignItems:'center', borderBottom:`1px solid ${U.border}`, fontSize:12.5}}>
              <div style={{minWidth:0}}>
                <div style={{fontWeight:700, color:U.ink, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{c.nombre}</div>
                <div style={{fontSize:10.5, color:U.inkMuted}}>{c.placa_sku}{c.desperdicio ? ` · ${c.desperdicio} desp.` : ''}</div>
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
        <span style={{fontSize:22, fontWeight:800, color:U.accent, fontVariantNumeric:'tabular-nums'}}>{totalNeto}</span>
      </div>
    </div>
  );
}

/* ── Tab Scan (selección manual agrupada + registrar corte) ── */
function CncScan({ U, jornadaAbierta, placas, onRegistrado, toast, goInicio }) {
  const [sel, setSel] = useState(null);     // placa seleccionada
  const [hojas, setHojas] = useState('');
  const [desp, setDesp] = useState('');
  const [saving, setSaving] = useState(false);

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
      {/* QR (próximamente) */}
      <button disabled style={{width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:9,
                    background:U.surface, border:`1px dashed ${U.border}`, borderRadius:14, color:U.inkMuted,
                    padding:'13px', fontSize:12.5, fontWeight:700, cursor:'not-allowed', marginBottom:18}}>
        <Icon n="qr" s={17} c={U.inkMuted}/> Escanear QR de placa · próximamente
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

          {/* Vista previa en vivo */}
          <div style={{marginTop:16, background:U.accentSoft, border:`1px solid ${U.accentLine}`, borderRadius:14, padding:'14px 16px'}}>
            <div style={{fontSize:10, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:U.accent, marginBottom:8}}>
              Vista previa
            </div>
            <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between'}}>
              <span style={{fontSize:12.5, color:U.inkSoft}}>
                {nH > 0 ? `${nH} hojas × ${rend} − ${nD} desp.` : 'Ingresá las hojas'}
              </span>
              <span style={{fontSize:26, fontWeight:800, color:U.accent, fontVariantNumeric:'tabular-nums'}}>
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
    </div>
  );
}

/* ── Tab Solicitud (pedido de insumos del sector → crear_solicitud) ── */
function CncSolicitud({ U, toast }) {
  const [qty, setQty] = useState({});      // nombre -> cantidad
  const [otros, setOtros] = useState('');
  const [saving, setSaving] = useState(false);

  const bump = (nombre, delta) => setQty(q => {
    const nq = Object.assign({}, q);
    const n = Math.max((nq[nombre] || 0) + delta, 0);
    if (n === 0) delete nq[nombre]; else nq[nombre] = n;
    return nq;
  });

  const seleccionados = Object.keys(qty);
  const hayAlgo = seleccionados.length > 0 || otros.trim().length > 0;

  const enviar = async () => {
    if (!hayAlgo || saving) return;
    setSaving(true);
    try {
      const items = seleccionados.map(n => ({ nombre: n, cantidad: qty[n] }));
      if (otros.trim()) items.push({ nombre: 'Otros: ' + otros.trim(), cantidad: 1 });
      await window.LP_DATA.crearSolicitud({ sector: 'cnc', items });
      toast.success('Solicitud enviada al coordinador');
      setQty({}); setOtros('');
    } catch (err) {
      toast.error(err && err.message ? err.message : 'No se pudo enviar la solicitud');
    } finally { setSaving(false); }
  };

  return (
    <div>
      <h3 style={{fontSize:15, fontWeight:800, margin:'0 0 4px', color:U.ink}}>Solicitud de insumos</h3>
      <p style={{fontSize:11.5, color:U.inkMuted, margin:'0 0 16px'}}>Tocá para agregar. Va al coordinador → administración.</p>

      {CNC_SOLICITUD_CAT.map(cat => (
        <div key={cat.grupo} style={{marginBottom:14}}>
          <div style={{fontSize:10, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:U.inkMuted, marginBottom:8}}>{cat.grupo}</div>
          <div style={{background:U.surface, border:`1px solid ${U.border}`, borderRadius:14, overflow:'hidden'}}>
            {cat.items.map((it, i) => {
              const n = qty[it] || 0;
              return (
                <div key={it} style={{display:'flex', alignItems:'center', justifyContent:'space-between',
                             padding:'11px 12px', borderBottom: i < cat.items.length - 1 ? `1px solid ${U.border}` : 'none'}}>
                  <span style={{fontSize:12.5, color: n > 0 ? U.ink : U.inkSoft, fontWeight: n > 0 ? 700 : 500, paddingRight:10}}>{it}</span>
                  {n > 0 ? (
                    <div style={{display:'flex', alignItems:'center', gap:10}}>
                      <button onClick={() => bump(it, -1)} style={stepBtn(U)}>−</button>
                      <span style={{minWidth:18, textAlign:'center', fontWeight:800, color:U.accent, fontVariantNumeric:'tabular-nums'}}>{n}</span>
                      <button onClick={() => bump(it, 1)} style={stepBtn(U)}>+</button>
                    </div>
                  ) : (
                    <button onClick={() => bump(it, 1)}
                      style={{border:`1px solid ${U.border}`, background:U.surface2, color:U.inkSoft, borderRadius:9,
                              width:30, height:30, fontSize:18, fontWeight:700, cursor:'pointer', lineHeight:1}}>+</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div style={{marginBottom:16}}>
        <div style={{fontSize:10, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:U.inkMuted, marginBottom:8}}>Maquinaria / Otros</div>
        <textarea value={otros} onChange={e => setOtros(e.target.value)} rows={2} placeholder="Detalle libre…"
          style={{width:'100%', boxSizing:'border-box', background:U.surface2, border:`1px solid ${U.border}`,
                  borderRadius:12, color:U.ink, fontSize:13, padding:'11px 12px', outline:'none', resize:'vertical', fontFamily:'inherit'}}/>
      </div>

      <button onClick={enviar} disabled={!hayAlgo || saving}
        style={{width:'100%', padding:'15px', borderRadius:14, border:'none',
                background: hayAlgo && !saving ? U.accent : U.surface2, color: hayAlgo && !saving ? '#fff' : U.inkMuted,
                fontSize:15, fontWeight:800, cursor: hayAlgo && !saving ? 'pointer' : 'not-allowed',
                display:'flex', alignItems:'center', justifyContent:'center', gap:8}}>
        <Icon n="send" s={17} c={hayAlgo && !saving ? '#fff' : U.inkMuted}/>
        {saving ? 'Enviando…' : 'Enviar solicitud'}
      </button>
    </div>
  );
}

/* ── Tab Mantenimiento (reporte de máquina → reportar_mantenimiento) ── */
function CncMant({ U, toast }) {
  const [tipo, setTipo] = useState('');
  const [urg, setUrg] = useState('media');
  const [maquina, setMaquina] = useState('');
  const [desc, setDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const puede = tipo && desc.trim() && !saving;

  const enviar = async () => {
    if (!puede) return;
    setSaving(true);
    try {
      await window.LP_DATA.reportarMantenimiento({ sector:'cnc', tipo, urgencia: urg, maquina: maquina.trim(), descripcion: desc.trim() });
      toast.success('Reporte enviado al coordinador');
      setTipo(''); setUrg('media'); setMaquina(''); setDesc('');
    } catch (err) {
      toast.error(err && err.message ? err.message : 'No se pudo enviar el reporte');
    } finally { setSaving(false); }
  };

  const fieldLabel = { fontSize:10, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:U.inkMuted, marginBottom:8 };
  const txt = { width:'100%', boxSizing:'border-box', background:U.surface2, border:`1px solid ${U.border}`,
                borderRadius:12, color:U.ink, fontSize:13, padding:'12px', outline:'none', fontFamily:'inherit' };

  return (
    <div>
      <h3 style={{fontSize:15, fontWeight:800, margin:'0 0 4px', color:U.ink}}>Reporte de mantenimiento</h3>
      <p style={{fontSize:11.5, color:U.inkMuted, margin:'0 0 16px'}}>Va al coordinador → director.</p>

      <div style={fieldLabel}>Tipo</div>
      <div style={{display:'flex', flexWrap:'wrap', gap:8, marginBottom:16}}>
        {CNC_MANT_TIPOS.map(t => {
          const on = tipo === t;
          return (
            <button key={t} onClick={() => setTipo(t)}
              style={{border:`1px solid ${on ? U.accent : U.border}`, background: on ? U.accentSoft : U.surface,
                      color: on ? U.ink : U.inkSoft, borderRadius:999, padding:'8px 13px', fontSize:12, fontWeight:700, cursor:'pointer'}}>
              {t}
            </button>
          );
        })}
      </div>

      <div style={fieldLabel}>Urgencia</div>
      <div style={{display:'flex', gap:8, marginBottom:16}}>
        {LP_URGENCIAS.map(u => {
          const on = urg === u.id;
          return (
            <button key={u.id} onClick={() => setUrg(u.id)}
              style={{flex:1, border:`1px solid ${on ? u.color : U.border}`, background: on ? `${u.color}22` : U.surface,
                      color: on ? u.color : U.inkSoft, borderRadius:11, padding:'10px', fontSize:12.5, fontWeight:800, cursor:'pointer'}}>
              {u.label}
            </button>
          );
        })}
      </div>

      <div style={fieldLabel}>Máquina afectada</div>
      <input value={maquina} onChange={e => setMaquina(e.target.value)} placeholder="Ej. router CNC 1"
             style={Object.assign({}, txt, { marginBottom:16 })}/>

      <div style={fieldLabel}>Descripción</div>
      <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} placeholder="¿Qué pasó?"
                style={Object.assign({}, txt, { resize:'vertical', marginBottom:18 })}/>

      <button onClick={enviar} disabled={!puede}
        style={{width:'100%', padding:'15px', borderRadius:14, border:'none',
                background: puede ? U.accent : U.surface2, color: puede ? '#fff' : U.inkMuted,
                fontSize:15, fontWeight:800, cursor: puede ? 'pointer' : 'not-allowed',
                display:'flex', alignItems:'center', justifyContent:'center', gap:8}}>
        <Icon n="send" s={17} c={puede ? '#fff' : U.inkMuted}/>
        {saving ? 'Enviando…' : 'Enviar reporte'}
      </button>
    </div>
  );
}

/* stepper redondo reutilizable */
function stepBtn(U) {
  return { border:`1px solid ${U.border}`, background:U.surface2, color:U.ink, borderRadius:8,
           width:28, height:28, fontSize:17, fontWeight:700, cursor:'pointer', lineHeight:1 };
}

window.CncSector = CncSector;
