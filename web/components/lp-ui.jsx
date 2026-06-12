/* ══ LÍNEA PRODUCTIVA — primitivas UI compartidas ══════════════════════
   Helpers y componentes reutilizados por TODAS las pantallas de sector
   (CNC, Melamina, Pino, Embalaje). Cargar después de shared.jsx (usa
   useState/useEffect) y antes de los *-sector.jsx.
   ═══════════════════════════════════════════════════════════════════════ */

/* Reloj vivo para la topbar (HH:MM, refresco 30s). */
function LpClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(id); }, []);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return <span>{hh}:{mm}</span>;
}

/* Niveles de urgencia (Mantenimiento) — color por nivel. */
const LP_URGENCIAS = [
  { id:'alta',  label:'Alta',  color:'#FF4060' },
  { id:'media', label:'Media', color:'#FFB020' },
  { id:'baja',  label:'Baja',  color:'#00D68F' },
];

/* Estilo del botón redondo de stepper (−/+), tematizado por sector (U = tokens). */
function lpStepBtn(U) {
  return { border:`1px solid ${U.border}`, background:U.surface2, color:U.ink, borderRadius:8,
           width:28, height:28, fontSize:17, fontWeight:700, cursor:'pointer', lineHeight:1 };
}

/* ── Tab Solicitud GENÉRICA (catálogo con stepper + "Otros") ──
   props: U (tokens del sector), sector ('cnc'|'melamina'|…), catalogo
   ([{grupo, items:[...]}]), toast. Crea UNA solicitud con todos los ítems. */
function LpSolicitud({ U, sector, catalogo, toast }) {
  const [qty, setQty] = useState({});
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
      await window.LP_DATA.crearSolicitud({ sector: sector, items: items });
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

      {catalogo.map(cat => (
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
                      <button onClick={() => bump(it, -1)} style={lpStepBtn(U)}>−</button>
                      <span style={{minWidth:18, textAlign:'center', fontWeight:800, color:U.accent, fontVariantNumeric:'tabular-nums'}}>{n}</span>
                      <button onClick={() => bump(it, 1)} style={lpStepBtn(U)}>+</button>
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
        <div style={{fontSize:10, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:U.inkMuted, marginBottom:8}}>Otros</div>
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

/* ── Tab Mantenimiento GENÉRICA (tipo + urgencia + máquina + descripción) ──
   props: U, sector, tipos ([string]), toast. */
function LpMant({ U, sector, tipos, toast }) {
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
      await window.LP_DATA.reportarMantenimiento({ sector: sector, tipo: tipo, urgencia: urg, maquina: maquina.trim(), descripcion: desc.trim() });
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
        {tipos.map(t => {
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
      <input value={maquina} onChange={e => setMaquina(e.target.value)} placeholder="Ej. máquina 1"
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
