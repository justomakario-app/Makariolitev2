/* ══ SECTOR MELAMINA — Línea productiva (FASE 3) ═══════════════════════
   Pantalla del operario Melamina. Mobile-first ~430px, dark, violeta.
   Trabaja por TAP individual: consume crudo de CNC (stock_pieza) y produce
   piezas terminadas (stock_melamina) que alimentan Embalaje.
   4 tabs: Inicio (crudo CNC + prioridad + terminadas) · Scan (registrar) ·
   Solicitud · Mantenimiento. Data: window.LP_DATA. UI: lp-ui.jsx.
   ═══════════════════════════════════════════════════════════════════════ */

/* Paleta integrada a la plataforma (clara). Tokenizado: re-tematiza todo.
   Acento = Melamina; se conserva el azul CNC para el banner "crudo de CNC". */
const MEL_UI = {
  accent:'#534AB7', accentSoft:'rgba(83,74,183,.08)', accentLine:'rgba(83,74,183,.20)',
  cnc:'#2563EB', cncSoft:'rgba(37,99,235,.08)', cncLine:'rgba(37,99,235,.20)',
  bg:'transparent', surface:'#FFFFFF', surface2:'#F4F4F5', border:'rgba(0,0,0,0.09)',
  ink:'#0A0A0A', inkSoft:'#555555', inkMuted:'#8A8A8A', danger:'#DC2626', warn:'#D97706', ok:'#16A34A',
  radius:10,
};

const MEL_SOLICITUD_CAT = [
  { grupo:'Filo (colores)', items:['Filo Blanco', 'Filo Negro', 'Filo Teka Ártico', 'Filo Kiri', 'Filo Paraíso', 'Filo Lino Chiaro', 'Filo Seda Giorno'] },
  { grupo:'Herramientas / consumibles', items:['Tiza', 'Espátula', 'Pistola de calor', 'Lijas', 'Mecha', 'Fibrón negro'] },
  { grupo:'Moldes', items:['Molde / detalle'] },
];
const MEL_MANT_TIPOS = ['Enchapadora', 'Pistola de calor', 'Eléctrico', 'Molde', 'Ruido/vibración', 'Preventivo'];

function MelaminaSector() {
  const U = MEL_UI;
  const toast = useToast();
  const [tab, setTab] = useState('inicio');
  const [jornada, setJornada] = useState(null);
  const [piezas, setPiezas] = useState([]);       // TAP
  const [crudo, setCrudo] = useState([]);          // stock_pieza [{pieza_sku, disponible}]
  const [prioridad, setPrioridad] = useState([]);  // prod_v_prioridad_melamina
  const [registros, setRegistros] = useState([]);  // melaminaDia
  const [ventas, setVentas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const crudoMap = useMemo(() => {
    const m = {}; for (const r of crudo) m[r.pieza_sku] = Number(r.disponible) || 0; return m;
  }, [crudo]);
  const piezaNombre = useMemo(() => {
    const m = {}; for (const p of piezas) m[p.sku] = p.nombre || p.sku; return m;
  }, [piezas]);

  const jornadaAbierta = jornada && jornada.estado === 'abierta';

  const cargar = useCallback(async (opts) => {
    if (!(opts && opts.silent)) setLoading(true);
    try {
      const j = await window.LP_DATA.jornadaHoy();
      setJornada(j);
      const [pz, st, pr, rg, vv] = await Promise.all([
        window.LP_DATA.piezas().catch(() => []),
        window.LP_DATA.stock().catch(() => null),
        window.LP_DATA.prioridadMelamina().catch(() => []),
        j && j.jornada_id ? window.LP_DATA.melaminaDia(j.jornada_id).catch(() => []) : Promise.resolve([]),
        j && j.jornada_id ? window.LP_DATA.ventasVinculadas(j.jornada_id).catch(() => []) : Promise.resolve([]),
      ]);
      setPiezas((pz || []).filter(p => String(p.sku).startsWith('TAP')));
      setCrudo(st && st.stock_pieza ? st.stock_pieza : []);
      setPrioridad(pr || []);
      setRegistros(rg || []);
      setVentas(vv || []);
    } catch (err) {
      toast.error(err && err.message ? err.message : 'No se pudo cargar el sector');
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { cargar(); }, [cargar]);

  // 🔴 Realtime (Fase 4.2): crudo de CNC + cargas propias + jornada en vivo.
  useEffect(() => window.LP_DATA.subscribe(
    ['prod_stock_pieza', 'prod_melamina', 'prod_jornada'],
    () => cargar({ silent: true })
  ), [cargar]);

  const totalTerminadas = registros.reduce((s, r) => s + (Number(r.terminadas) || 0), 0);

  const NAV = [
    { id:'inicio',    label:'Inicio',    icon:'home', badge: prioridad.filter(p => (Number(p.falta) || 0) > 0).length },
    { id:'scan',      label:'Scan',      icon:'qr' },
    { id:'solicitud', label:'Solicitud', icon:'package' },
    { id:'mant',      label:'Mant.',     icon:'tools' },
  ];

  return (
    <div style={{background:U.bg, color:U.ink, fontSize:13, padding:'0 16px 24px'}}>

      {/* Header de sección (integrado, sin marco de teléfono) */}
      <div style={{padding:'18px 0 14px', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
        <div style={{display:'flex', alignItems:'center', gap:9}}>
          <span style={{width:34, height:34, borderRadius:10, background:U.accentSoft,
                        border:`1px solid ${U.accentLine}`, display:'flex', alignItems:'center', justifyContent:'center'}}>
            <Icon n="flame" s={18} c={U.accent}/>
          </span>
          <div>
            <div style={{fontSize:14, fontWeight:800, letterSpacing:'.02em', lineHeight:1.1}}>Melamina</div>
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

      {/* Tabs (estilo plataforma, arriba) */}
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

      {/* Contenido */}
      <div>
        {loading ? (
          <div style={{textAlign:'center', color:U.inkMuted, padding:'60px 0', fontSize:13}}>Cargando sector…</div>
        ) : tab === 'inicio' ? (
          <MelInicio U={U} jornadaAbierta={jornadaAbierta} jornada={jornada} crudo={crudo}
                     prioridad={prioridad} registros={registros} piezaNombre={piezaNombre} totalTerminadas={totalTerminadas}
                     nVentas={ventas.filter(v => v.snapshot_status !== 'cancelada').length} onEdit={setEditing}/>
        ) : tab === 'scan' ? (
          <MelScan U={U} jornadaAbierta={jornadaAbierta} piezas={piezas} crudoMap={crudoMap}
                   onRegistrado={cargar} toast={toast} goInicio={() => setTab('inicio')}/>
        ) : tab === 'solicitud' ? (
          <LpSolicitud U={U} sector="melamina" catalogo={MEL_SOLICITUD_CAT} toast={toast}/>
        ) : (
          <LpMant U={U} sector="melamina" tipos={MEL_MANT_TIPOS} toast={toast}/>
        )}
      </div>

      {editing && (
        <LpEditModal U={U} titulo="Editar pieza terminada"
          campos={[{ key:'terminadas', label:'Terminadas' }, { key:'fallas', label:'Fallas' }]}
          inicial={{ terminadas: editing.terminadas, fallas: editing.fallas }}
          onCerrar={() => setEditing(null)}
          onGuardar={async (v, motivo) => {
            try {
              await window.LP_DATA.editarMelamina({ id: editing.id, terminadas: v.terminadas, fallas: v.fallas, motivo });
              toast.success('Registro actualizado'); setEditing(null); await cargar();
            } catch (err) { toast.error(err && err.message ? err.message : 'No se pudo editar'); }
          }}/>
      )}
    </div>
  );
}

/* ── Tab Inicio ── */
function MelInicio({ U, jornadaAbierta, jornada, crudo, prioridad, registros, piezaNombre, totalTerminadas, nVentas, onEdit }) {
  const prioridadFalta = prioridad.filter(p => (Number(p.falta) || 0) > 0);
  const neu = lpNeutralMsg(jornada, nVentas, prioridadFalta.length, 'Melamina');
  if (neu) return <LpNeutral U={U} msg={neu}/>;
  return (
    <div>
      {!jornadaAbierta && (
        <div style={{background:'rgba(255,64,96,.10)', border:`1px solid rgba(255,64,96,.28)`,
                     borderRadius:12, padding:'12px 14px', marginBottom:16, display:'flex', gap:10, alignItems:'flex-start'}}>
          <Icon n="alert" s={17} c={U.danger}/>
          <div style={{fontSize:12.5, lineHeight:1.5, color:U.ink}}>
            {jornada ? 'La jornada de hoy está cerrada.' : 'Todavía no se abrió la jornada de hoy.'}
            <span style={{color:U.inkSoft}}> Podés ver el stock pero no registrar.</span>
          </div>
        </div>
      )}

      {/* Crudo de CNC */}
      <div style={{marginBottom:18}}>
        <div style={{display:'flex', alignItems:'center', gap:7, marginBottom:10}}>
          <span style={{width:8, height:8, borderRadius:2, background:U.cnc}}/>
          <h3 style={{fontSize:13.5, fontWeight:800, margin:0, color:U.ink}}>Piezas crudas · de CNC</h3>
        </div>
        {crudo.length === 0 ? (
          <div style={{background:U.cncSoft, border:`1px solid ${U.cncLine}`, borderRadius:12, padding:'14px',
                       fontSize:12.5, color:U.inkSoft, textAlign:'center'}}>Esperando cortes de CNC…</div>
        ) : (
          <div style={{display:'flex', flexWrap:'wrap', gap:8}}>
            {crudo.map(r => (
              <div key={r.pieza_sku} style={{background:U.cncSoft, border:`1px solid ${U.cncLine}`, borderRadius:11, padding:'8px 12px'}}>
                <div style={{fontSize:11, color:U.inkSoft, fontWeight:600}}>{r.pieza_sku}</div>
                <div style={{fontSize:17, fontWeight:800, color:U.cnc, fontVariantNumeric:'tabular-nums'}}>{r.disponible}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Prioridad del día por TAP */}
      {prioridadFalta.length > 0 && (
        <div style={{marginBottom:18}}>
          <h3 style={{fontSize:13.5, fontWeight:800, margin:'0 0 10px', color:U.ink}}>Prioridad del día · por TAP</h3>
          <div style={{display:'flex', flexDirection:'column', gap:8}}>
            {prioridadFalta.map(p => {
              const falta = Number(p.falta) || 0;
              const cnc = Number(p.crudo_cnc) || 0;
              const listo = cnc >= falta;
              const col = listo ? U.accent : U.warn;
              const colSoft = listo ? U.accentSoft : 'rgba(255,176,32,.12)';
              const colLine = listo ? U.accentLine : 'rgba(255,176,32,.30)';
              return (
                <div key={p.pieza_sku} style={{background:colSoft, border:`1px solid ${colLine}`, borderRadius:12,
                             padding:'11px 14px', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
                  <div>
                    <div style={{fontSize:12.5, fontWeight:800, color:U.ink}}>{p.pieza_sku}</div>
                    <div style={{fontSize:10.5, color:U.inkSoft, marginTop:1}}>
                      {listo ? `crudo ${cnc} disponible` : `esperando CNC · crudo ${cnc}/${falta}`}
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

      {/* Terminadas hoy */}
      <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:12}}>
        <h3 style={{fontSize:15, fontWeight:800, margin:0, color:U.ink}}>Piezas terminadas hoy</h3>
        <span style={{fontSize:11, color:U.inkMuted}}>{registros.length} {registros.length === 1 ? 'registro' : 'registros'}</span>
      </div>
      {registros.length === 0 ? (
        <div style={{textAlign:'center', color:U.inkMuted, padding:'40px 12px', background:U.surface,
                     border:`1px solid ${U.border}`, borderRadius:14}}>
          <Icon n="flame" s={26} c={U.inkMuted}/>
          <p style={{fontSize:12.5, margin:'12px 0 0'}}>Sin piezas terminadas hoy.</p>
        </div>
      ) : (
        <div style={{background:U.surface, border:`1px solid ${U.border}`, borderRadius:14, overflow:'hidden'}}>
          <div style={{display:'grid', gridTemplateColumns:'1fr 56px 48px 56px', gap:4, padding:'10px 12px',
                       fontSize:9.5, fontWeight:800, letterSpacing:'.06em', textTransform:'uppercase',
                       color:U.inkMuted, borderBottom:`1px solid ${U.border}`}}>
            <span>Pieza</span><span style={{textAlign:'right'}}>Term.</span>
            <span style={{textAlign:'right'}}>Fallas</span><span style={{textAlign:'right'}}>Netas</span>
          </div>
          {registros.map(r => {
            const ed = r.editable_hasta ? (new Date(r.editable_hasta) > new Date()) : false;
            return (
            <div key={r.id} onClick={ed ? () => onEdit(r) : undefined}
                 style={{display:'grid', gridTemplateColumns:'1fr 56px 48px 56px', gap:4,
                         padding:'11px 12px', alignItems:'center', borderBottom:`1px solid ${U.border}`, fontSize:12.5,
                         cursor: ed ? 'pointer' : 'default'}}>
              <div style={{minWidth:0}}>
                <div style={{fontWeight:700, color:U.ink, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{piezaNombre[r.pieza_sku] || r.pieza_sku}</div>
                <div style={{fontSize:10.5, color:U.inkMuted}}>{r.pieza_sku}{ed ? ' · ✎ editar' : ''}</div>
              </div>
              <span style={{textAlign:'right', fontVariantNumeric:'tabular-nums', color:U.inkSoft}}>{r.terminadas}</span>
              <span style={{textAlign:'right', fontVariantNumeric:'tabular-nums', color: r.fallas ? U.danger : U.inkMuted}}>{r.fallas}</span>
              <span style={{textAlign:'right', fontVariantNumeric:'tabular-nums', fontWeight:800, color:U.ok}}>{r.terminadas}</span>
            </div>
            );
          })}
        </div>
      )}

      <div style={{marginTop:16, background:U.accentSoft, border:`1px solid ${U.accentLine}`, borderRadius:14,
                   padding:'14px 16px', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
        <div style={{display:'flex', alignItems:'center', gap:10}}>
          <Icon n="arrow-right" s={18} c={U.accent}/>
          <span style={{fontSize:12.5, fontWeight:700, color:U.ink}}>Piezas netas → Embalaje</span>
        </div>
        <span style={{fontSize:22, fontWeight:800, color:U.ok, fontVariantNumeric:'tabular-nums'}}>{totalTerminadas}</span>
      </div>
    </div>
  );
}

/* ── Tab Scan ── */
function MelScan({ U, jornadaAbierta, piezas, crudoMap, onRegistrado, toast, goInicio }) {
  const [sel, setSel] = useState(null);
  const [term, setTerm] = useState('');
  const [fallas, setFallas] = useState('');
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);

  const crudo = sel ? (crudoMap[sel.sku] || 0) : 0;
  const nT = parseInt(term, 10) || 0;
  const nF = parseInt(fallas, 10) || 0;
  const consumo = nT + nF;
  const excede = sel && consumo > crudo;
  const puedeEnviar = jornadaAbierta && sel && consumo > 0 && !excede && !saving;

  const enviar = async () => {
    if (!puedeEnviar) return;
    setSaving(true);
    try {
      await window.LP_DATA.registrarMelamina({ pieza_sku: sel.sku, terminadas: nT, fallas: nF });
      toast.success(`+${nT} piezas → Embalaje`);
      setSel(null); setTerm(''); setFallas('');
      await onRegistrado();
      goInicio();
    } catch (err) {
      toast.error(err && err.message ? err.message : 'No se pudo registrar');
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
          No se puede registrar hasta que el encargado abra la jornada de hoy.
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
        <Icon n="qr" s={17} c={U.accent}/> Escanear QR de pieza
      </button>

      <div style={{fontSize:10, fontWeight:800, letterSpacing:'.12em', textTransform:'uppercase', color:U.inkMuted, marginBottom:10}}>
        1 · Elegí la pieza (TAP)
      </div>
      {piezas.length === 0 ? (
        <div style={{textAlign:'center', color:U.inkMuted, padding:'30px 12px', background:U.surface,
                     border:`1px solid ${U.border}`, borderRadius:12, fontSize:12.5, marginBottom:18}}>
          No hay piezas cargadas todavía (se cargan al importar el catálogo).
        </div>
      ) : (
        <div style={{display:'flex', flexWrap:'wrap', gap:8, marginBottom:8}}>
          {piezas.map(p => {
            const on = sel && sel.sku === p.sku;
            const cr = crudoMap[p.sku] || 0;
            return (
              <button key={p.sku} onClick={() => setSel(p)}
                style={{border:`1px solid ${on ? U.accent : U.border}`, background: on ? U.accentSoft : U.surface,
                        borderRadius:11, padding:'9px 12px', cursor:'pointer', textAlign:'left', minWidth:104}}>
                <div style={{fontSize:12.5, fontWeight:700, color:on ? U.ink : U.inkSoft, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:150}}>{p.nombre || p.sku}</div>
                <div style={{fontSize:10, color: cr > 0 ? U.cnc : U.inkMuted, marginTop:1}}>{p.sku} · crudo {cr}</div>
              </button>
            );
          })}
        </div>
      )}

      {sel && (
        <div>
          <div style={{fontSize:12, color:U.inkSoft, margin:'16px 0 10px'}}>
            Crudo disponible de <b style={{color:U.cnc}}>{sel.sku}</b>: <b style={{color:U.cnc}}>{crudo}</b>
          </div>
          <div style={{display:'flex', gap:12}}>
            <label style={{flex:1}}>
              <span style={{display:'block', fontSize:11, color:U.inkSoft, marginBottom:6}}>Terminadas</span>
              <input type="number" inputMode="numeric" min="0" value={term} placeholder="0"
                     onChange={e => setTerm(e.target.value)} style={inputStyle}/>
            </label>
            <label style={{flex:1}}>
              <span style={{display:'block', fontSize:11, color:U.inkSoft, marginBottom:6}}>Fallas / roturas</span>
              <input type="number" inputMode="numeric" min="0" value={fallas} placeholder="0"
                     onChange={e => setFallas(e.target.value)} style={inputStyle}/>
            </label>
          </div>

          <div style={{marginTop:16, background:U.accentSoft, border:`1px solid ${U.accentLine}`, borderRadius:14, padding:'14px 16px'}}>
            <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between'}}>
              <span style={{fontSize:12.5, color:U.inkSoft}}>Consume crudo</span>
              <span style={{fontSize:18, fontWeight:800, color: excede ? U.danger : U.ink, fontVariantNumeric:'tabular-nums'}}>{consumo} / {crudo}</span>
            </div>
            <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginTop:6}}>
              <span style={{fontSize:12.5, color:U.inkSoft}}>Netas → Embalaje</span>
              <span style={{fontSize:22, fontWeight:800, color:U.ok, fontVariantNumeric:'tabular-nums'}}>{nT}</span>
            </div>
            {excede && <div style={{fontSize:11, color:U.danger, marginTop:8}}>Supera el crudo disponible de CNC.</div>}
          </div>

          <button onClick={enviar} disabled={!puedeEnviar}
            style={{width:'100%', marginTop:16, padding:'15px', borderRadius:14, border:'none',
                    background: puedeEnviar ? U.accent : U.surface2, color: puedeEnviar ? '#fff' : U.inkMuted,
                    fontSize:15, fontWeight:800, cursor: puedeEnviar ? 'pointer' : 'not-allowed',
                    display:'flex', alignItems:'center', justifyContent:'center', gap:8}}>
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
            const p = piezas.find(x => x.sku === sku);
            setScanning(false);
            if (p) { setSel(p); toast.success(`Pieza ${sku}`); }
            else { toast.error(`SKU no reconocido: ${sku}`); }
          }}/>
      )}
    </div>
  );
}

window.MelaminaSector = MelaminaSector;
