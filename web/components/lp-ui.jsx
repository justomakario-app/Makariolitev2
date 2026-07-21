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

/* ── Estado neutro de la Línea Productiva por sector (3 situaciones distintas) ──
   lpNeutralMsg(jornada, nVentas, nTareas) → {titulo, sub} o null (null = hay trabajo).
   1) sin jornada abierta · 2) abierta sin ventas vinculadas · 3) con ventas, sin tareas del sector. */
function lpNeutralMsg(jornada, nVentas, nTareas, sectorLabel) {
  const abierta = jornada && jornada.estado === 'abierta';
  if (!abierta) return { titulo:'Línea Productiva todavía no iniciada',
    sub:'Cuando el encargado inicie la jornada y vincule ventas, vas a ver acá tus tareas.' };
  if (!nVentas) return { titulo:'Jornada abierta, todavía sin ventas vinculadas',
    sub:'La jornada arrancó pero todavía no se vincularon ventas. En cuanto se vinculen, aparecen las tareas.' };
  if (!nTareas) return { titulo:'No hay tareas pendientes para este sector',
    sub:'Hay ventas en la jornada, pero ' + (sectorLabel || 'este sector') + ' no tiene trabajo pendiente ahora.' };
  return null;
}
function LpNeutral({ U, msg }) {
  if (!msg) return null;
  return (
    <div style={{ background:U.surface||'#fff', border:`1px dashed ${U.border||'rgba(0,0,0,.12)'}`, borderRadius:14,
                  padding:'36px 20px', textAlign:'center', margin:'10px 0' }}>
      <div style={{ fontSize:15.5, fontWeight:800, color:U.ink||'#0A0A0A', marginBottom:7 }}>{msg.titulo}</div>
      <div style={{ fontSize:12.5, color:U.inkSoft||U.inkMuted||'#666', lineHeight:1.6, maxWidth:420, margin:'0 auto' }}>{msg.sub}</div>
    </div>
  );
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

/* ── Modal de edición de carga propia (ventana 24h) — genérico ──
   props: U, titulo, campos ([{key,label}] numéricos), inicial (obj),
   onGuardar(valores, motivo) -> Promise, onCerrar. */
function LpEditModal({ U, titulo, campos, inicial, onGuardar, onCerrar, motivoRequerido }) {
  const init = {};
  for (const c of campos) init[c.key] = String(inicial[c.key] != null ? inicial[c.key] : '');
  const [vals, setVals] = useState(init);
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);

  const setV = (k, v) => setVals(o => Object.assign({}, o, { [k]: v }));
  const faltaMotivo = motivoRequerido && !motivo.trim();

  const guardar = async () => {
    if (saving || faltaMotivo) return;
    setSaving(true);
    try {
      const out = {};
      for (const c of campos) out[c.key] = parseInt(vals[c.key], 10) || 0;
      await onGuardar(out, motivo.trim());
    } catch (e) { setSaving(false); }
  };

  const inp = { width:'100%', boxSizing:'border-box', background:U.surface2, border:`1px solid ${U.border}`,
                borderRadius:12, color:U.ink, fontSize:20, fontWeight:800, textAlign:'center',
                padding:'12px 10px', outline:'none', fontVariantNumeric:'tabular-nums' };

  return (
    <div onClick={onCerrar} style={{position:'fixed', inset:0, background:'rgba(0,0,0,.62)', zIndex:9999,
                 display:'flex', alignItems:'center', justifyContent:'center', padding:18}}>
      <div onClick={e => e.stopPropagation()} style={{width:'100%', maxWidth:360, background:U.surface,
                   border:`1px solid ${U.border}`, borderRadius:18, padding:'18px', color:U.ink}}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16}}>
          <h3 style={{fontSize:15, fontWeight:800, margin:0}}>{titulo}</h3>
          <button onClick={onCerrar} style={{border:'none', background:'transparent', cursor:'pointer', padding:0}}>
            <Icon n="x" s={18} c={U.inkMuted}/>
          </button>
        </div>
        <div style={{display:'flex', gap:12, marginBottom:14}}>
          {campos.map(c => (
            <label key={c.key} style={{flex:1}}>
              <span style={{display:'block', fontSize:11, color:U.inkSoft, marginBottom:6}}>{c.label}</span>
              <input type="number" inputMode="numeric" min="0" value={vals[c.key]}
                     onChange={e => setV(c.key, e.target.value)} style={inp}/>
            </label>
          ))}
        </div>
        <label style={{display:'block', marginBottom:16}}>
          <span style={{display:'block', fontSize:11, color: faltaMotivo ? U.warn : U.inkSoft, marginBottom:6}}>{motivoRequerido ? 'Motivo (obligatorio)' : 'Motivo (opcional)'}</span>
          <input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="¿Por qué se corrige?"
                 style={{width:'100%', boxSizing:'border-box', background:U.surface2, border:`1px solid ${U.border}`,
                         borderRadius:12, color:U.ink, fontSize:13, padding:'11px 12px', outline:'none', fontFamily:'inherit'}}/>
        </label>
        <div style={{display:'flex', gap:10}}>
          <button onClick={onCerrar} style={{flex:1, padding:'13px', borderRadius:12, border:`1px solid ${U.border}`,
                       background:U.surface2, color:U.inkSoft, fontSize:14, fontWeight:700, cursor:'pointer'}}>Cancelar</button>
          <button onClick={guardar} disabled={saving || faltaMotivo} style={{flex:1, padding:'13px', borderRadius:12, border:'none',
                       background: faltaMotivo ? U.surface2 : U.accent, color: faltaMotivo ? U.inkMuted : '#fff', fontSize:14, fontWeight:800,
                       cursor: (saving || faltaMotivo) ? 'not-allowed' : 'pointer'}}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Escáner de QR por cámara — genérico (reusa window.QrScanner) ──
   Lectura ÚNICA: detecta un código, para la cámara y devuelve el texto por
   onDetect. props: U, onDetect(texto), onClose. Si la librería no está, avisa. */
function LpQrScan({ U, onDetect, onClose }) {
  const videoRef = useRef(null);
  const scannerRef = useRef(null);
  const handledRef = useRef(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!window.QrScanner) { setErr('El escáner no está disponible en este dispositivo.'); return; }
    let cancelled = false;
    let scanner = null;
    const init = async () => {
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (cancelled || !videoRef.current) return;
      try {
        scanner = new window.QrScanner(
          videoRef.current,
          result => {
            if (handledRef.current) return;
            handledRef.current = true;
            try { scanner.stop(); } catch (e) {}
            const t = (result && result.data != null) ? result.data : (result || '');
            onDetect(String(t).trim());
          },
          { highlightScanRegion: true, highlightCodeOutline: true, returnDetailedScanResult: true }
        );
        scannerRef.current = scanner;
        await scanner.start();
      } catch (e) {
        if (!cancelled) {
          const m = ((e && e.message) || '').toLowerCase();
          setErr(m.includes('permission') || m.includes('denied') || m.includes('notallowed')
            ? 'Permiso de cámara denegado.' : ((e && e.message) || 'No se pudo acceder a la cámara'));
        }
      }
    };
    init();
    return () => { cancelled = true; try { if (scanner) { scanner.stop(); scanner.destroy(); } } catch (e) {} };
    // eslint-disable-next-line
  }, []);

  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'rgba(0,0,0,.85)', zIndex:9999,
                 display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:18}}>
      <div onClick={e => e.stopPropagation()} style={{width:'100%', maxWidth:360}}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12}}>
          <span style={{fontSize:13, fontWeight:800, color:'#fff'}}>Escanear QR</span>
          <button onClick={onClose} style={{border:'none', background:'transparent', cursor:'pointer', padding:0}}>
            <Icon n="x" s={20} c="#fff"/>
          </button>
        </div>
        <div style={{position:'relative', width:'100%', aspectRatio:'1 / 1', background:'#000',
                     borderRadius:16, overflow:'hidden', border:`1px solid ${U.border}`}}>
          <video ref={videoRef} playsInline muted style={{width:'100%', height:'100%', objectFit:'cover'}}/>
        </div>
        {err
          ? <div style={{marginTop:12, fontSize:12.5, color:U.danger, textAlign:'center', lineHeight:1.5}}>{err}</div>
          : <div style={{marginTop:12, fontSize:12, color:'#cbd5e1', textAlign:'center'}}>Apuntá la cámara al QR del SKU</div>}
      </div>
    </div>
  );
}
