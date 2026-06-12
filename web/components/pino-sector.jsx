/* ══ SECTOR PINO — Línea productiva (FASE 3) ═══════════════════════════
   Pantalla del operario Pino. Mobile-first ~430px, dark, verde.
   2 tamaños (chica/grande). Solo resultado final, carga manual (granel,
   sin QR). Produce patas → stock_patas que alimenta Embalaje.
   4 tabs: Inicio (stock + masilladas + producidas) · Scan (tamaño/estado/
   cantidad) · Solicitud · Mantenimiento. Data: window.LP_DATA. UI: lp-ui.jsx.
   ═══════════════════════════════════════════════════════════════════════ */

const PINO_UI = {
  accent:'#0F6E56', accentSoft:'rgba(15,110,86,.24)', accentLine:'rgba(15,110,86,.46)',
  bg:'#0C0C0E', surface:'#1A1A1D', surface2:'#222226', border:'#28282E',
  ink:'#EFEFEF', inkSoft:'#9898A6', inkMuted:'#55555F', danger:'#FF4060', warn:'#FFB020', ok:'#00D68F',
  radius:16,
};

const PINO_SOLICITUD_CAT = [
  { grupo:'Madera / varillas', items:['Listón 2×1', 'Listón 2×2', 'Varilla 25mm', 'Varilla 14mm'] },
  { grupo:'Lijas', items:['Lija velcro', 'Lija tambor', 'Lija banda'] },
  { grupo:'Masilla / terminación', items:['Masilla', 'Enduido'] },
  { grupo:'Clavos', items:['Clavos 25mm', 'Clavos 30mm', 'Clavos 40mm', 'Clavos 50mm'] },
  { grupo:'Eléctrico / herrajes', items:['Cable blanco', 'Cable negro', 'Portalámpara blanco', 'Portalámpara negro', 'Rosca', 'Tuercas', 'Base 3D', 'Mecha'] },
  { grupo:'Herramientas', items:['Amoladora', 'Atornilladora', 'Clavadora'] },
];
const PINO_MANT_TIPOS = ['Ingletadora', 'Cepilladora', 'Caladora', 'Lijadora de tambor', 'Lijadora de banda', 'Compresor', 'Atornilladora', 'Amoladora'];

const PINO_TAMANOS = [{ id:'chica', label:'Chicas' }, { id:'grande', label:'Grandes' }];

function PinoSector() {
  const U = PINO_UI;
  const toast = useToast();
  const [tab, setTab] = useState('inicio');
  const [jornada, setJornada] = useState(null);
  const [patas, setPatas] = useState([]);          // stock_patas [{tamano, disponible, masilladas}]
  const [registros, setRegistros] = useState([]);  // pinoDia
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const patasMap = useMemo(() => {
    const m = {}; for (const r of patas) m[r.tamano] = r; return m;
  }, [patas]);

  const jornadaAbierta = jornada && jornada.estado === 'abierta';

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const j = await window.LP_DATA.jornadaHoy();
      setJornada(j);
      const [st, rg] = await Promise.all([
        window.LP_DATA.stock().catch(() => null),
        j && j.jornada_id ? window.LP_DATA.pinoDia(j.jornada_id).catch(() => []) : Promise.resolve([]),
      ]);
      setPatas(st && st.stock_patas ? st.stock_patas : []);
      setRegistros(rg || []);
    } catch (err) {
      toast.error(err && err.message ? err.message : 'No se pudo cargar el sector');
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { cargar(); }, [cargar]);

  const totalTerminadas = registros.reduce((s, r) => s + (Number(r.terminadas) || 0), 0);

  const NAV = [
    { id:'inicio',    label:'Inicio',    icon:'home' },
    { id:'scan',      label:'Cargar',    icon:'plus' },
    { id:'solicitud', label:'Solicitud', icon:'package' },
    { id:'mant',      label:'Mant.',     icon:'tools' },
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
            <Icon n="tools" s={18} c={U.accent}/>
          </span>
          <div>
            <div style={{fontSize:14, fontWeight:800, letterSpacing:'.02em', lineHeight:1.1}}>Pino</div>
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
          <PinoInicio U={U} jornadaAbierta={jornadaAbierta} jornada={jornada} patasMap={patasMap} registros={registros} totalTerminadas={totalTerminadas} onEdit={setEditing}/>
        ) : tab === 'scan' ? (
          <PinoScan U={U} jornadaAbierta={jornadaAbierta} onRegistrado={cargar} toast={toast} goInicio={() => setTab('inicio')}/>
        ) : tab === 'solicitud' ? (
          <LpSolicitud U={U} sector="pino" catalogo={PINO_SOLICITUD_CAT} toast={toast}/>
        ) : (
          <LpMant U={U} sector="pino" tipos={PINO_MANT_TIPOS} toast={toast}/>
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

      {editing && (
        <LpEditModal U={U} titulo="Editar producción"
          campos={[{ key:'terminadas', label:'Terminadas' }, { key:'masilladas', label:'Masilladas' }]}
          inicial={{ terminadas: editing.terminadas, masilladas: editing.masilladas }}
          onCerrar={() => setEditing(null)}
          onGuardar={async (v, motivo) => {
            try {
              await window.LP_DATA.editarPino({ id: editing.id, terminadas: v.terminadas, masilladas: v.masilladas, motivo });
              toast.success('Registro actualizado'); setEditing(null); await cargar();
            } catch (err) { toast.error(err && err.message ? err.message : 'No se pudo editar'); }
          }}/>
      )}
    </div>
  );
}

/* ── Tab Inicio ── */
function PinoInicio({ U, jornadaAbierta, jornada, patasMap, registros, totalTerminadas, onEdit }) {
  const chica = patasMap['chica'] || { disponible:0, masilladas:0 };
  const grande = patasMap['grande'] || { disponible:0, masilladas:0 };
  const masilladasTotal = (Number(chica.masilladas) || 0) + (Number(grande.masilladas) || 0);

  const counter = (label, val) => (
    <div style={{flex:1, background:U.surface, border:`1px solid ${U.border}`, borderRadius:14, padding:'16px 14px', textAlign:'center'}}>
      <div style={{fontSize:34, fontWeight:800, color:U.ink, fontVariantNumeric:'tabular-nums', lineHeight:1}}>{Number(val) || 0}</div>
      <div style={{fontSize:11, color:U.inkSoft, marginTop:6, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em'}}>{label}</div>
    </div>
  );

  return (
    <div>
      {!jornadaAbierta && (
        <div style={{background:'rgba(255,64,96,.10)', border:`1px solid rgba(255,64,96,.28)`,
                     borderRadius:12, padding:'12px 14px', marginBottom:16, display:'flex', gap:10, alignItems:'flex-start'}}>
          <Icon n="alert" s={17} c={U.danger}/>
          <div style={{fontSize:12.5, lineHeight:1.5, color:U.ink}}>
            {jornada ? 'La jornada de hoy está cerrada.' : 'Todavía no se abrió la jornada de hoy.'}
            <span style={{color:U.inkSoft}}> Podés ver el stock pero no cargar.</span>
          </div>
        </div>
      )}

      <h3 style={{fontSize:13.5, fontWeight:800, margin:'0 0 10px', color:U.ink}}>Patas terminadas · stock</h3>
      <div style={{display:'flex', gap:12, marginBottom:14}}>
        {counter('Chicas', chica.disponible)}
        {counter('Grandes', grande.disponible)}
      </div>

      <div style={{background:'rgba(255,176,32,.10)', border:`1px solid rgba(255,176,32,.30)`, borderRadius:14,
                   padding:'13px 16px', marginBottom:18, display:'flex', alignItems:'center', justifyContent:'space-between'}}>
        <div style={{display:'flex', alignItems:'center', gap:10}}>
          <Icon n="alert" s={16} c={U.warn}/>
          <div>
            <div style={{fontSize:12.5, fontWeight:700, color:U.ink}}>Patas masilladas · pendientes</div>
            <div style={{fontSize:10.5, color:U.inkSoft}}>requieren otro proceso antes de servir</div>
          </div>
        </div>
        <span style={{fontSize:22, fontWeight:800, color:U.warn, fontVariantNumeric:'tabular-nums'}}>{masilladasTotal}</span>
      </div>

      <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:12}}>
        <h3 style={{fontSize:15, fontWeight:800, margin:0, color:U.ink}}>Producidas hoy</h3>
        <span style={{fontSize:11, color:U.inkMuted}}>{registros.length} {registros.length === 1 ? 'registro' : 'registros'}</span>
      </div>
      {registros.length === 0 ? (
        <div style={{textAlign:'center', color:U.inkMuted, padding:'40px 12px', background:U.surface,
                     border:`1px solid ${U.border}`, borderRadius:14}}>
          <Icon n="tools" s={26} c={U.inkMuted}/>
          <p style={{fontSize:12.5, margin:'12px 0 0'}}>Sin patas cargadas hoy.</p>
        </div>
      ) : (
        <div style={{background:U.surface, border:`1px solid ${U.border}`, borderRadius:14, overflow:'hidden'}}>
          <div style={{display:'grid', gridTemplateColumns:'1fr 72px 72px', gap:4, padding:'10px 12px',
                       fontSize:9.5, fontWeight:800, letterSpacing:'.06em', textTransform:'uppercase',
                       color:U.inkMuted, borderBottom:`1px solid ${U.border}`}}>
            <span>Tipo</span><span style={{textAlign:'right'}}>Terminadas</span><span style={{textAlign:'right'}}>Masilladas</span>
          </div>
          {registros.map(r => {
            const ed = r.editable_hasta ? (new Date(r.editable_hasta) > new Date()) : false;
            return (
            <div key={r.id} onClick={ed ? () => onEdit(r) : undefined}
                 style={{display:'grid', gridTemplateColumns:'1fr 72px 72px', gap:4,
                         padding:'11px 12px', alignItems:'center', borderBottom:`1px solid ${U.border}`, fontSize:12.5,
                         cursor: ed ? 'pointer' : 'default'}}>
              <span style={{fontWeight:700, color:U.ink, textTransform:'capitalize'}}>{r.tamano}{ed ? ' · ✎ editar' : ''}</span>
              <span style={{textAlign:'right', fontVariantNumeric:'tabular-nums', fontWeight:800, color:U.ok}}>{r.terminadas}</span>
              <span style={{textAlign:'right', fontVariantNumeric:'tabular-nums', color: r.masilladas ? U.warn : U.inkMuted}}>{r.masilladas}</span>
            </div>
            );
          })}
        </div>
      )}

      <div style={{marginTop:16, background:U.accentSoft, border:`1px solid ${U.accentLine}`, borderRadius:14,
                   padding:'14px 16px', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
        <div style={{display:'flex', alignItems:'center', gap:10}}>
          <Icon n="arrow-right" s={18} c={U.accent}/>
          <span style={{fontSize:12.5, fontWeight:700, color:U.ink}}>Patas terminadas → Embalaje</span>
        </div>
        <span style={{fontSize:22, fontWeight:800, color:U.ok, fontVariantNumeric:'tabular-nums'}}>{totalTerminadas}</span>
      </div>
    </div>
  );
}

/* ── Tab Scan (carga manual: tamaño → estado → cantidad) ── */
function PinoScan({ U, jornadaAbierta, onRegistrado, toast, goInicio }) {
  const [tamano, setTamano] = useState('');
  const [estado, setEstado] = useState('terminada');
  const [cant, setCant] = useState('');
  const [saving, setSaving] = useState(false);

  const nC = parseInt(cant, 10) || 0;
  const puedeEnviar = jornadaAbierta && tamano && nC > 0 && !saving;

  const enviar = async () => {
    if (!puedeEnviar) return;
    setSaving(true);
    try {
      const payload = {
        tamano: tamano,
        terminadas: estado === 'terminada' ? nC : 0,
        masilladas: estado === 'masillada' ? nC : 0,
      };
      await window.LP_DATA.registrarPino(payload);
      toast.success(estado === 'terminada' ? `+${nC} patas → Embalaje` : `+${nC} patas masilladas`);
      setTamano(''); setEstado('terminada'); setCant('');
      await onRegistrado();
      goInicio();
    } catch (err) {
      toast.error(err && err.message ? err.message : 'No se pudo registrar');
    } finally { setSaving(false); }
  };

  if (!jornadaAbierta) {
    return (
      <div style={{textAlign:'center', color:U.inkMuted, padding:'56px 16px'}}>
        <Icon n="lock" s={28} c={U.inkMuted}/>
        <h3 style={{color:U.ink, fontSize:16, fontWeight:800, margin:'14px 0 6px'}}>Jornada no abierta</h3>
        <p style={{fontSize:12.5, lineHeight:1.6, maxWidth:280, margin:'0 auto'}}>
          No se puede cargar hasta que el encargado abra la jornada de hoy.
        </p>
      </div>
    );
  }

  const chip = (active, onClick, label, key) => (
    <button key={key} onClick={onClick}
      style={{flex:1, border:`1px solid ${active ? U.accent : U.border}`, background: active ? U.accentSoft : U.surface,
              color: active ? U.ink : U.inkSoft, borderRadius:12, padding:'14px', fontSize:14, fontWeight:800, cursor:'pointer'}}>
      {label}
    </button>
  );

  return (
    <div>
      <div style={{fontSize:10, fontWeight:800, letterSpacing:'.12em', textTransform:'uppercase', color:U.inkMuted, marginBottom:10}}>1 · Tamaño</div>
      <div style={{display:'flex', gap:10, marginBottom:18}}>
        {PINO_TAMANOS.map(t => chip(tamano === t.id, () => setTamano(t.id), t.label, t.id))}
      </div>

      <div style={{fontSize:10, fontWeight:800, letterSpacing:'.12em', textTransform:'uppercase', color:U.inkMuted, marginBottom:10}}>2 · Estado</div>
      <div style={{display:'flex', gap:10, marginBottom:18}}>
        {chip(estado === 'terminada', () => setEstado('terminada'), 'Terminada', 'terminada')}
        {chip(estado === 'masillada', () => setEstado('masillada'), 'Masillada', 'masillada')}
      </div>

      <div style={{fontSize:10, fontWeight:800, letterSpacing:'.12em', textTransform:'uppercase', color:U.inkMuted, marginBottom:10}}>3 · Cantidad</div>
      <input type="number" inputMode="numeric" min="0" value={cant} placeholder="0"
             onChange={e => setCant(e.target.value)}
             style={{width:'100%', boxSizing:'border-box', background:U.surface2, border:`1px solid ${U.border}`,
                     borderRadius:12, color:U.ink, fontSize:24, fontWeight:800, textAlign:'center',
                     padding:'16px 10px', outline:'none', fontVariantNumeric:'tabular-nums', marginBottom:8}}/>
      <div style={{fontSize:11.5, color:U.inkSoft, marginBottom:18}}>
        {estado === 'terminada' ? 'Las terminadas van directo al stock de Embalaje.' : 'Las masilladas quedan pendientes (otro proceso antes de servir).'}
      </div>

      <button onClick={enviar} disabled={!puedeEnviar}
        style={{width:'100%', padding:'15px', borderRadius:14, border:'none',
                background: puedeEnviar ? U.accent : U.surface2, color: puedeEnviar ? '#fff' : U.inkMuted,
                fontSize:15, fontWeight:800, cursor: puedeEnviar ? 'pointer' : 'not-allowed',
                display:'flex', alignItems:'center', justifyContent:'center', gap:8}}>
        <Icon n="plus" s={18} c={puedeEnviar ? '#fff' : U.inkMuted}/>
        {saving ? 'Cargando…' : 'Cargar producción'}
      </button>
    </div>
  );
}

window.PinoSector = PinoSector;
