/* ══ SECTOR EMBALAJE — Línea productiva (FASE 3) ═══════════════════════
   Pantalla del operario Embalaje. Mobile-first ~430px, dark, coral.
   Convergen las 2 líneas: consume piezas (Melamina) + patas (Pino) y
   produce producto terminado "listo para despacho". Por producto MAD.
   3 tabs (SIN Mantenimiento): Inicio (prioridad + stocks de origen +
   embalados) · Scan (armar: verificación de componentes + armables) ·
   Solicitud. Data: window.LP_DATA. UI: lp-ui.jsx.
   ═══════════════════════════════════════════════════════════════════════ */

const EMB_UI = {
  accent:'#993C1D', accentSoft:'rgba(153,60,29,.28)', accentLine:'rgba(153,60,29,.48)',
  mel:'#534AB7', melSoft:'rgba(83,74,183,.18)', melLine:'rgba(83,74,183,.34)',
  pino:'#0F6E56', pinoSoft:'rgba(15,110,86,.20)', pinoLine:'rgba(15,110,86,.36)',
  bg:'#0C0C0E', surface:'#1A1A1D', surface2:'#222226', border:'#28282E',
  ink:'#EFEFEF', inkSoft:'#9898A6', inkMuted:'#55555F', danger:'#FF4060', warn:'#FFB020', ok:'#00D68F',
  radius:16,
};

const EMB_SOLICITUD_CAT = [
  { grupo:'Kit de embalaje', items:['Cajas', 'Film burbuja', 'Tornillos', 'Soportes', 'Bolsas'] },
  { grupo:'Otros', items:['Cinta', 'Etiquetas / stickers', 'Fleje / precinto', 'Esquineros de cartón', 'Marcador / fibrón'] },
];

function EmbalajeSector() {
  const U = EMB_UI;
  const toast = useToast();
  const [tab, setTab] = useState('inicio');
  const [jornada, setJornada] = useState(null);
  const [productos, setProductos] = useState([]);
  const [armables, setArmables] = useState([]);     // prod_v_armables
  const [stockMel, setStockMel] = useState([]);     // stock_melamina
  const [stockPatas, setStockPatas] = useState([]); // stock_patas
  const [demanda, setDemanda] = useState([]);       // resumen del día
  const [registros, setRegistros] = useState([]);   // embalajeDia
  const [loading, setLoading] = useState(true);

  const armMap = useMemo(() => {
    const m = {}; for (const a of armables) m[a.producto_sku] = Number(a.armables) || 0; return m;
  }, [armables]);
  const melMap = useMemo(() => {
    const m = {}; for (const r of stockMel) m[r.pieza_sku] = Number(r.disponible) || 0; return m;
  }, [stockMel]);
  const patasMap = useMemo(() => {
    const m = {}; for (const r of stockPatas) m[r.tamano] = Number(r.disponible) || 0; return m;
  }, [stockPatas]);

  const jornadaAbierta = jornada && jornada.estado === 'abierta';

  const cargar = useCallback(async (opts) => {
    if (!(opts && opts.silent)) setLoading(true);
    try {
      const j = await window.LP_DATA.jornadaHoy();
      setJornada(j);
      const [pr, ar, st, dm, rg] = await Promise.all([
        window.LP_DATA.productos().catch(() => []),
        window.LP_DATA.armables().catch(() => []),
        window.LP_DATA.stock().catch(() => null),
        window.LP_DATA.resumenDia().catch(() => []),
        j && j.jornada_id ? window.LP_DATA.embalajeDia(j.jornada_id).catch(() => []) : Promise.resolve([]),
      ]);
      setProductos(pr || []);
      setArmables(ar || []);
      setStockMel(st && st.stock_melamina ? st.stock_melamina : []);
      setStockPatas(st && st.stock_patas ? st.stock_patas : []);
      setDemanda(dm || []);
      setRegistros(rg || []);
    } catch (err) {
      toast.error(err && err.message ? err.message : 'No se pudo cargar el sector');
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { cargar(); }, [cargar]);

  // 🔴 Realtime (Fase 4.2): insumos de Melamina/Pino + cargas propias + jornada.
  useEffect(() => window.LP_DATA.subscribe(
    ['prod_stock_melamina', 'prod_stock_patas', 'prod_embalaje', 'prod_jornada'],
    () => cargar({ silent: true })
  ), [cargar]);

  const totalEmbalado = registros.reduce((s, r) => s + (Number(r.unidades) || 0), 0);

  const NAV = [
    { id:'inicio',    label:'Inicio',    icon:'home', badge: demanda.filter(d => (Number(d.pendiente) || 0) > 0).length },
    { id:'scan',      label:'Armar',     icon:'package-check' },
    { id:'solicitud', label:'Solicitud', icon:'package' },
  ];

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
            <Icon n="package" s={18} c={U.accent}/>
          </span>
          <div>
            <div style={{fontSize:14, fontWeight:800, letterSpacing:'.02em', lineHeight:1.1}}>Embalaje</div>
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

      {/* Contenido */}
      <div style={{flex:1, padding:'18px', overflowY:'auto'}}>
        {loading ? (
          <div style={{textAlign:'center', color:U.inkMuted, padding:'60px 0', fontSize:13}}>Cargando sector…</div>
        ) : tab === 'inicio' ? (
          <EmbInicio U={U} jornadaAbierta={jornadaAbierta} jornada={jornada} demanda={demanda} armMap={armMap}
                     stockMel={stockMel} stockPatas={stockPatas} registros={registros} totalEmbalado={totalEmbalado}/>
        ) : tab === 'scan' ? (
          <EmbScan U={U} jornadaAbierta={jornadaAbierta} productos={productos} armMap={armMap}
                   melMap={melMap} patasMap={patasMap} onRegistrado={cargar} toast={toast} goInicio={() => setTab('inicio')}/>
        ) : (
          <LpSolicitud U={U} sector="embalaje" catalogo={EMB_SOLICITUD_CAT} toast={toast}/>
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
                      color: on ? U.accent : U.inkMuted, borderTop:`2px solid ${on ? U.accent : 'transparent'}`,
                      marginTop:-1, transition:'color .15s ease'}}>
              <span style={{position:'relative', display:'flex'}}>
                <Icon n={n.icon} s={19} c={on ? U.accent : U.inkMuted}/>
                {n.badge ? (
                  <span style={{position:'absolute', top:-6, right:-10, minWidth:15, height:15, padding:'0 3px',
                                borderRadius:999, background:U.accent, color:'#fff', fontSize:9, fontWeight:800,
                                display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1}}>{n.badge}</span>
                ) : null}
              </span>
              <span style={{fontSize:10, fontWeight:on ? 800 : 600, letterSpacing:'.02em'}}>{n.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Tab Inicio ── */
function EmbInicio({ U, jornadaAbierta, jornada, demanda, armMap, stockMel, stockPatas, registros, totalEmbalado }) {
  const prioridad = demanda.filter(d => (Number(d.pendiente) || 0) > 0);
  return (
    <div>
      {!jornadaAbierta && (
        <div style={{background:'rgba(255,64,96,.10)', border:`1px solid rgba(255,64,96,.28)`,
                     borderRadius:12, padding:'12px 14px', marginBottom:16, display:'flex', gap:10, alignItems:'flex-start'}}>
          <Icon n="alert" s={17} c={U.danger}/>
          <div style={{fontSize:12.5, lineHeight:1.5, color:U.ink}}>
            {jornada ? 'La jornada de hoy está cerrada.' : 'Todavía no se abrió la jornada de hoy.'}
            <span style={{color:U.inkSoft}}> Podés ver el stock pero no armar.</span>
          </div>
        </div>
      )}

      {/* Prioridad: productos a embalar */}
      {prioridad.length > 0 && (
        <div style={{marginBottom:18}}>
          <h3 style={{fontSize:13.5, fontWeight:800, margin:'0 0 10px', color:U.ink}}>Prioridad · productos a embalar</h3>
          <div style={{display:'flex', flexDirection:'column', gap:8}}>
            {prioridad.slice(0, 10).map(d => {
              const falta = Number(d.pendiente) || 0;
              const arm = armMap[d.producto_sku] || 0;
              const listo = arm > 0;
              const colSoft = listo ? U.accentSoft : 'rgba(255,176,32,.12)';
              const colLine = listo ? U.accentLine : 'rgba(255,176,32,.30)';
              const col = listo ? U.accent : U.warn;
              return (
                <div key={d.producto_sku} style={{background:colSoft, border:`1px solid ${colLine}`, borderRadius:12,
                             padding:'11px 14px', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
                  <div style={{minWidth:0, paddingRight:10}}>
                    <div style={{fontSize:12.5, fontWeight:800, color:U.ink, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{d.nombre || d.producto_sku}</div>
                    <div style={{fontSize:10.5, color:U.inkSoft, marginTop:1}}>
                      {listo ? `armás hasta ${arm} ahora` : 'esperando piezas / patas'}
                    </div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontSize:18, fontWeight:800, color:col, fontVariantNumeric:'tabular-nums'}}>{falta}</div>
                    <div style={{fontSize:9, color:U.inkMuted, textTransform:'uppercase', letterSpacing:'.08em'}}>falta</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Stocks de origen */}
      <div style={{display:'flex', gap:12, marginBottom:18}}>
        <div style={{flex:1}}>
          <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:8}}>
            <span style={{width:8, height:8, borderRadius:2, background:U.mel}}/>
            <span style={{fontSize:11, fontWeight:800, color:U.ink}}>Piezas · Melamina</span>
          </div>
          <div style={{background:U.melSoft, border:`1px solid ${U.melLine}`, borderRadius:12, padding:'10px 12px', minHeight:54}}>
            {stockMel.length === 0 ? <div style={{fontSize:11.5, color:U.inkSoft}}>Sin stock</div> :
              stockMel.slice(0, 6).map(r => (
                <div key={r.pieza_sku} style={{display:'flex', justifyContent:'space-between', fontSize:11.5, padding:'2px 0'}}>
                  <span style={{color:U.inkSoft}}>{r.pieza_sku}</span>
                  <b style={{color:U.mel, fontVariantNumeric:'tabular-nums'}}>{r.disponible}</b>
                </div>
              ))}
          </div>
        </div>
        <div style={{flex:1}}>
          <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:8}}>
            <span style={{width:8, height:8, borderRadius:2, background:U.pino}}/>
            <span style={{fontSize:11, fontWeight:800, color:U.ink}}>Patas · Pino</span>
          </div>
          <div style={{background:U.pinoSoft, border:`1px solid ${U.pinoLine}`, borderRadius:12, padding:'10px 12px', minHeight:54}}>
            {stockPatas.length === 0 ? <div style={{fontSize:11.5, color:U.inkSoft}}>Sin stock</div> :
              stockPatas.map(r => (
                <div key={r.tamano} style={{display:'flex', justifyContent:'space-between', fontSize:11.5, padding:'2px 0'}}>
                  <span style={{color:U.inkSoft, textTransform:'capitalize'}}>{r.tamano}</span>
                  <b style={{color:U.pino, fontVariantNumeric:'tabular-nums'}}>{r.disponible}</b>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Embalados hoy */}
      <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:12}}>
        <h3 style={{fontSize:15, fontWeight:800, margin:0, color:U.ink}}>Embalados hoy</h3>
        <span style={{fontSize:11, color:U.inkMuted}}>{registros.length} {registros.length === 1 ? 'registro' : 'registros'}</span>
      </div>
      {registros.length === 0 ? (
        <div style={{textAlign:'center', color:U.inkMuted, padding:'40px 12px', background:U.surface,
                     border:`1px solid ${U.border}`, borderRadius:14}}>
          <Icon n="package-check" s={26} c={U.inkMuted}/>
          <p style={{fontSize:12.5, margin:'12px 0 0'}}>Sin productos embalados hoy.</p>
        </div>
      ) : (
        <div style={{background:U.surface, border:`1px solid ${U.border}`, borderRadius:14, overflow:'hidden'}}>
          {registros.map((r, i) => (
            <div key={r.id} style={{display:'flex', alignItems:'center', justifyContent:'space-between',
                         padding:'11px 12px', borderBottom: i < registros.length - 1 ? `1px solid ${U.border}` : 'none', fontSize:12.5}}>
              <div style={{minWidth:0, paddingRight:10}}>
                <div style={{fontWeight:700, color:U.ink}}>{r.producto_sku}</div>
                <div style={{fontSize:10.5, color:U.inkMuted}}>{r.canal ? r.canal : 'sin canal'}</div>
              </div>
              <span style={{fontSize:15, fontWeight:800, color:U.ok, fontVariantNumeric:'tabular-nums'}}>{r.unidades}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{marginTop:16, background:U.accentSoft, border:`1px solid ${U.accentLine}`, borderRadius:14,
                   padding:'14px 16px', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
        <div style={{display:'flex', alignItems:'center', gap:10}}>
          <Icon n="check-circle" s={18} c={U.accent}/>
          <span style={{fontSize:12.5, fontWeight:700, color:U.ink}}>Listos para despacho</span>
        </div>
        <span style={{fontSize:22, fontWeight:800, color:U.ok, fontVariantNumeric:'tabular-nums'}}>{totalEmbalado}</span>
      </div>
    </div>
  );
}

/* ── Tab Scan (armar producto: verificación de componentes + armables) ── */
function EmbScan({ U, jornadaAbierta, productos, armMap, melMap, patasMap, onRegistrado, toast, goInicio }) {
  const [sel, setSel] = useState(null);
  const [unidades, setUnidades] = useState(1);
  const [receta, setReceta] = useState([]);
  const [loadingRec, setLoadingRec] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);

  const armMax = sel ? (armMap[sel.sku] || 0) : 0;

  useEffect(() => {
    if (!sel) { setReceta([]); return; }
    let vivo = true;
    setLoadingRec(true);
    window.LP_DATA.recetaProducto(sel.sku)
      .then(r => { if (vivo) setReceta(r || []); })
      .catch(() => { if (vivo) setReceta([]); })
      .finally(() => { if (vivo) setLoadingRec(false); });
    return () => { vivo = false; };
  }, [sel]);

  const u = Math.max(parseInt(unidades, 10) || 0, 0);

  // Verificación de componentes (✓/✗)
  const comps = [];
  for (const r of receta) {
    const need = u * (Number(r.cantidad) || 0);
    const have = melMap[r.pieza_sku] || 0;
    comps.push({ tipo:'Tapa', nombre: r.pieza_sku, need, have, ok: have >= need });
  }
  if (sel && sel.patas_tipo && (Number(sel.patas_cant) || 0) > 0) {
    const need = u * (Number(sel.patas_cant) || 0);
    const have = patasMap[sel.patas_tipo] || 0;
    comps.push({ tipo:'Patas', nombre: sel.patas_tipo, need, have, ok: have >= need });
  }
  const kit = sel && sel.kit_embalaje ? Object.keys(sel.kit_embalaje).map(k => `${k}: ${sel.kit_embalaje[k]}`) : [];

  const puedeEnviar = jornadaAbierta && sel && u > 0 && u <= armMax && !saving;

  const enviar = async () => {
    if (!puedeEnviar) return;
    setSaving(true);
    try {
      await window.LP_DATA.registrarEmbalaje({ producto_sku: sel.sku, unidades: u });
      toast.success(`${u} ${sel.sku} listos para despacho`);
      setSel(null); setUnidades(1);
      await onRegistrado();
      goInicio();
    } catch (err) {
      toast.error(err && err.message ? err.message : 'No se pudo registrar el embalaje');
    } finally { setSaving(false); }
  };

  if (!jornadaAbierta) {
    return (
      <div style={{textAlign:'center', color:U.inkMuted, padding:'56px 16px'}}>
        <Icon n="lock" s={28} c={U.inkMuted}/>
        <h3 style={{color:U.ink, fontSize:16, fontWeight:800, margin:'14px 0 6px'}}>Jornada no abierta</h3>
        <p style={{fontSize:12.5, lineHeight:1.6, maxWidth:280, margin:'0 auto'}}>
          No se puede armar hasta que el encargado abra la jornada de hoy.
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
        <Icon n="qr" s={17} c={U.accent}/> Escanear QR de producto
      </button>

      <div style={{fontSize:10, fontWeight:800, letterSpacing:'.12em', textTransform:'uppercase', color:U.inkMuted, marginBottom:10}}>
        1 · Elegí el producto
      </div>
      {productos.length === 0 ? (
        <div style={{textAlign:'center', color:U.inkMuted, padding:'30px 12px', background:U.surface,
                     border:`1px solid ${U.border}`, borderRadius:12, fontSize:12.5, marginBottom:18}}>
          No hay productos cargados todavía (se cargan al importar el catálogo).
        </div>
      ) : (
        <div style={{display:'flex', flexWrap:'wrap', gap:8, marginBottom:8}}>
          {productos.map(p => {
            const on = sel && sel.sku === p.sku;
            const arm = armMap[p.sku] || 0;
            return (
              <button key={p.sku} onClick={() => { setSel(p); setUnidades(Math.min(1, arm) || 1); }}
                style={{border:`1px solid ${on ? U.accent : U.border}`, background: on ? U.accentSoft : U.surface,
                        borderRadius:11, padding:'9px 12px', cursor:'pointer', textAlign:'left', minWidth:108}}>
                <div style={{fontSize:12.5, fontWeight:700, color:on ? U.ink : U.inkSoft, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:150}}>{p.nombre || p.sku}</div>
                <div style={{fontSize:10, color: arm > 0 ? U.accent : U.inkMuted, marginTop:1}}>{p.sku} · arma {arm}</div>
              </button>
            );
          })}
        </div>
      )}

      {sel && (
        <div>
          {/* Verificación de componentes */}
          <div style={{fontSize:10, fontWeight:800, letterSpacing:'.12em', textTransform:'uppercase', color:U.inkMuted, margin:'18px 0 10px'}}>
            2 · Verificación de componentes
          </div>
          <div style={{background:U.surface, border:`1px solid ${U.border}`, borderRadius:14, overflow:'hidden', marginBottom:8}}>
            {loadingRec ? (
              <div style={{padding:'16px', fontSize:12, color:U.inkMuted, textAlign:'center'}}>Cargando receta…</div>
            ) : comps.length === 0 ? (
              <div style={{padding:'16px', fontSize:12, color:U.inkMuted, textAlign:'center'}}>Este producto no tiene componentes en la receta.</div>
            ) : comps.map((c, i) => (
              <div key={i} style={{display:'flex', alignItems:'center', justifyContent:'space-between',
                           padding:'11px 12px', borderBottom: i < comps.length - 1 ? `1px solid ${U.border}` : 'none'}}>
                <div style={{display:'flex', alignItems:'center', gap:9}}>
                  <Icon n={c.ok ? 'check-circle' : 'x'} s={17} c={c.ok ? U.ok : U.danger}/>
                  <div>
                    <div style={{fontSize:12.5, fontWeight:700, color:U.ink}}>{c.nombre}</div>
                    <div style={{fontSize:10, color:U.inkMuted}}>{c.tipo}</div>
                  </div>
                </div>
                <span style={{fontSize:12, fontWeight:700, color: c.ok ? U.inkSoft : U.danger, fontVariantNumeric:'tabular-nums'}}>{c.have} / {c.need}</span>
              </div>
            ))}
          </div>
          {kit.length > 0 && (
            <div style={{display:'flex', flexWrap:'wrap', gap:6, marginBottom:8}}>
              {kit.map((k, i) => (
                <span key={i} style={{fontSize:10.5, color:U.inkSoft, background:U.surface2, border:`1px solid ${U.border}`, borderRadius:999, padding:'3px 9px'}}>kit · {k}</span>
              ))}
            </div>
          )}

          {/* Cantidad a armar */}
          <div style={{fontSize:10, fontWeight:800, letterSpacing:'.12em', textTransform:'uppercase', color:U.inkMuted, margin:'14px 0 10px'}}>
            3 · Cantidad a armar
          </div>
          <div style={{display:'flex', alignItems:'center', gap:12, marginBottom:6}}>
            <button onClick={() => setUnidades(Math.max(u - 1, 0))} style={lpStepBtn(U)}>−</button>
            <input type="number" inputMode="numeric" min="0" max={armMax} value={unidades}
                   onChange={e => setUnidades(e.target.value)}
                   style={{flex:1, boxSizing:'border-box', background:U.surface2, border:`1px solid ${U.border}`,
                           borderRadius:12, color:U.ink, fontSize:22, fontWeight:800, textAlign:'center',
                           padding:'14px 10px', outline:'none', fontVariantNumeric:'tabular-nums'}}/>
            <button onClick={() => setUnidades(Math.min(u + 1, armMax))} style={lpStepBtn(U)}>+</button>
          </div>
          <div style={{fontSize:11.5, color: u > armMax ? U.danger : U.inkSoft, marginBottom:18}}>
            {u > armMax ? `Solo se pueden armar ${armMax} con el stock actual.` : `Armables ahora: ${armMax}`}
          </div>

          <button onClick={enviar} disabled={!puedeEnviar}
            style={{width:'100%', padding:'15px', borderRadius:14, border:'none',
                    background: puedeEnviar ? U.accent : U.surface2, color: puedeEnviar ? '#fff' : U.inkMuted,
                    fontSize:15, fontWeight:800, cursor: puedeEnviar ? 'pointer' : 'not-allowed',
                    display:'flex', alignItems:'center', justifyContent:'center', gap:8}}>
            <Icon n="package-check" s={18} c={puedeEnviar ? '#fff' : U.inkMuted}/>
            {saving ? 'Armando…' : 'Marcar listo para despacho'}
          </button>
        </div>
      )}

      {scanning && (
        <LpQrScan U={U} onClose={() => setScanning(false)}
          onDetect={(text) => {
            let sku = text || '';
            if (sku.indexOf('·') >= 0) sku = sku.split('·').pop().trim();
            if (sku.indexOf(' ') >= 0) sku = sku.split(' ').pop().trim();
            const p = productos.find(x => x.sku === sku);
            setScanning(false);
            if (p) { setSel(p); setUnidades(Math.min(1, armMap[p.sku] || 0) || 1); toast.success(`Producto ${sku}`); }
            else { toast.error(`SKU no reconocido: ${sku}`); }
          }}/>
      )}
    </div>
  );
}

window.EmbalajeSector = EmbalajeSector;
