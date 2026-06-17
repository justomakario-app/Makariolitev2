/* ══ MARKETING — Cockpit (5 módulos) ══════════════════════════════════
   Dashboard · Calendario · Ángulos de venta · Publicidad · Prioridades.
   Estilo "command center" oscuro/futurista con los acentos de marca
   (violeta #7C3AED + azul #2563EB). Tokenizado en MKT_UI. Data: MKT_DATA.
   Acceso: owner / admin / marketing. ═════════════════════════════════ */

const MKT_DARK = {
  bg:'#0B0B12', panel:'#12121C', surface:'rgba(255,255,255,0.045)', surface2:'rgba(255,255,255,0.07)',
  border:'rgba(255,255,255,0.10)', borderHi:'rgba(124,58,237,0.45)',
  ink:'#F2F2F7', inkSoft:'#A6A6B8', inkMuted:'#6C6C80',
  accent:'#7C3AED', accent2:'#2563EB', cyan:'#22D3EE', green:'#22C55E', amber:'#F59E0B', red:'#EF4444', pink:'#EC4899',
  radius:16, mono:"'JetBrains Mono', ui-monospace, monospace",
};
const MKT_LIGHT = {
  bg:'#F5F6FB', panel:'#FFFFFF', surface:'#FFFFFF', surface2:'#EEF0F6',
  border:'rgba(10,12,30,0.10)', borderHi:'rgba(124,58,237,0.40)',
  ink:'#10101A', inkSoft:'#52526A', inkMuted:'#8A8AA0',
  accent:'#7C3AED', accent2:'#2563EB', cyan:'#0891B2', green:'#16A34A', amber:'#D97706', red:'#DC2626', pink:'#DB2777',
  radius:16, mono:"'JetBrains Mono', ui-monospace, monospace",
};
const MKT_UI = MKT_DARK; /* default; MarketingPage elige según el toggle */

/* nº compacto: 1.2K / 3.4M */
function mNf(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(v % 1e6 === 0 ? 0 : 1) + 'M';
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(v % 1e3 === 0 ? 0 : 1) + 'K';
  return String(v);
}
function mMoney(n) { return '$' + (Number(n) || 0).toLocaleString('es-AR'); }

const MKT_PLATS = {
  instagram:{ label:'Instagram', c:'#EC4899' }, tiktok:{ label:'TikTok', c:'#22D3EE' },
  youtube:{ label:'YouTube', c:'#EF4444' }, meta:{ label:'Meta Ads', c:'#2563EB' }, facebook:{ label:'Facebook', c:'#3B82F6' },
};
const MKT_EV_ESTADOS = [
  { id:'idea', label:'Idea', c:'#6C6C80' }, { id:'guion', label:'Guion', c:'#7C3AED' },
  { id:'a_grabar', label:'A grabar', c:'#EC4899' }, { id:'editando', label:'Editando', c:'#F59E0B' },
  { id:'ok_cliente', label:'OK cliente', c:'#22D3EE' }, { id:'programado', label:'Programado', c:'#2563EB' },
  { id:'publicado', label:'Publicado', c:'#22C55E' },
];
const mEstadoC = (id) => { const e = MKT_EV_ESTADOS.find(x => x.id === id); return e ? e.c : '#6C6C80'; };

/* ── helpers de UI ── */
function MktGlowCard({ U, accent, children, style }) {
  return (
    <div style={Object.assign({
      background:U.surface, border:`1px solid ${U.border}`, borderRadius:U.radius, padding:'16px 18px',
      position:'relative', overflow:'hidden',
      boxShadow: accent ? `0 0 0 1px ${accent}22, 0 8px 30px ${accent}18` : 'none',
    }, style || {})}>
      {accent ? <div style={{position:'absolute', top:0, left:0, right:0, height:2,
        background:`linear-gradient(90deg, transparent, ${accent}, transparent)`}}/> : null}
      {children}
    </div>
  );
}
function MktKpi({ U, label, value, sub, accent }) {
  return (
    <MktGlowCard U={U} accent={accent} style={{ padding:'14px 16px' }}>
      <div style={{ fontSize:9.5, fontWeight:800, letterSpacing:'.14em', textTransform:'uppercase', color:U.inkMuted }}>{label}</div>
      <div style={{ fontSize:26, fontWeight:800, color:U.ink, fontFamily:U.mono, marginTop:6, lineHeight:1 }}>{value}</div>
      {sub ? <div style={{ fontSize:11, color: accent || U.inkSoft, marginTop:5, fontWeight:600 }}>{sub}</div> : null}
    </MktGlowCard>
  );
}
function MktModal({ U, titulo, onClose, children, wide }) {
  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(4,4,10,0.78)', backdropFilter:'blur(4px)',
                 zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', padding:18 }}>
      <div onClick={e => e.stopPropagation()} style={{ width:'100%', maxWidth: wide ? 560 : 440, maxHeight:'90vh', overflowY:'auto',
                   background:U.panel, border:`1px solid ${U.borderHi}`, borderRadius:18, padding:'20px',
                   color:U.ink, boxShadow:`0 24px 80px rgba(124,58,237,0.25)` }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
          <h3 style={{ fontSize:15.5, fontWeight:800, margin:0 }}>{titulo}</h3>
          <button onClick={onClose} style={{ border:'none', background:U.surface2, cursor:'pointer', borderRadius:8, padding:6, lineHeight:0 }}>
            <Icon n="x" s={16} c={U.inkSoft}/>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
const mInp = (U) => ({ width:'100%', boxSizing:'border-box', background:U.surface2, border:`1px solid ${U.border}`,
  borderRadius:10, color:U.ink, fontSize:13, padding:'10px 12px', outline:'none', fontFamily:'inherit' });
const mLbl = (U) => ({ display:'block', fontSize:10.5, fontWeight:700, color:U.inkSoft, marginBottom:5, letterSpacing:'.02em' });

function MktField({ U, label, value, onChange, type, placeholder, full }) {
  return (
    <label style={{ display:'block', flex: full ? '1 1 100%' : 1, minWidth: full ? 0 : 130 }}>
      <span style={mLbl(U)}>{label}</span>
      <input type={type || 'text'} value={value == null ? '' : value} placeholder={placeholder || ''}
             inputMode={type === 'number' ? 'numeric' : undefined}
             onChange={e => onChange(e.target.value)} style={mInp(U)}/>
    </label>
  );
}
function MktSelect({ U, label, value, onChange, options, full }) {
  return (
    <label style={{ display:'block', flex: full ? '1 1 100%' : 1, minWidth: full ? 0 : 130 }}>
      <span style={mLbl(U)}>{label}</span>
      <select value={value || ''} onChange={e => onChange(e.target.value)} style={Object.assign({}, mInp(U), { cursor:'pointer' })}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
function MktBtn({ U, onClick, children, kind, disabled, small }) {
  const primary = kind === 'primary';
  const danger = kind === 'danger';
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ border: primary ? 'none' : `1px solid ${danger ? U.red + '66' : U.border}`,
               background: primary ? `linear-gradient(135deg, ${U.accent}, ${U.accent2})` : (danger ? U.red + '14' : U.surface2),
               color: primary ? '#fff' : (danger ? U.red : U.ink), borderRadius:10,
               padding: small ? '7px 11px' : '10px 15px', fontSize: small ? 11.5 : 13, fontWeight:700,
               cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
               display:'inline-flex', alignItems:'center', gap:7, whiteSpace:'nowrap' }}>
      {children}
    </button>
  );
}
function MktEmpty({ U, icon, title, sub }) {
  return (
    <div style={{ textAlign:'center', padding:'50px 16px', background:U.surface, border:`1px dashed ${U.border}`, borderRadius:U.radius }}>
      <Icon n={icon || 'spark'} s={28} c={U.inkMuted}/>
      <div style={{ fontSize:14, fontWeight:800, color:U.ink, marginTop:12 }}>{title}</div>
      {sub ? <div style={{ fontSize:12, color:U.inkMuted, marginTop:4 }}>{sub}</div> : null}
    </div>
  );
}
function MktChip({ U, c, children }) {
  return <span style={{ fontSize:9.5, fontWeight:800, letterSpacing:'.04em', textTransform:'uppercase',
    padding:'3px 9px', borderRadius:999, background:(c||U.accent)+'1f', color:c||U.accent, border:`1px solid ${(c||U.accent)}40` }}>{children}</span>;
}

/* ════════════ MÓDULO: DASHBOARD ════════════ */
function MktDashboard({ U }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [eventos, setEventos] = useState([]);
  const [camps, setCamps] = useState([]);
  const [loading, setLoading] = useState(true);
  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [d, ev, cp] = await Promise.all([
        window.MKT_DATA.dashboard(),
        window.MKT_DATA.eventos().catch(() => []),
        window.MKT_DATA.campanias().catch(() => []),
      ]);
      setData(d); setEventos(ev || []); setCamps(cp || []);
    } catch (e) { toast.error(e && e.message ? e.message : 'No se pudo cargar'); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { cargar(); }, [cargar]);

  if (loading) return <div style={{ textAlign:'center', color:U.inkMuted, padding:'60px 0' }}>Cargando dashboard…</div>;
  const k = (data && data.kpis) || {};
  const topA = (data && data.top_angulos) || [];
  const topV = (data && data.top_videos) || [];
  const maxA = Math.max(1, ...topA.map(a => Number(a.alcance_total) || 0));
  const hoy = new Date().toISOString().slice(0, 10);
  const proximos = eventos.filter(e => (e.fecha || '') >= hoy).slice(0, 6);
  const pipeline = MKT_EV_ESTADOS.map(es => Object.assign({}, es, { n: eventos.filter(e => (e.estado || 'idea') === es.id).length }));
  const maxPipe = Math.max(1, ...pipeline.map(p => p.n));
  const platMix = Object.keys(MKT_PLATS).map(pk => ({ k:pk, label:MKT_PLATS[pk].label, c:MKT_PLATS[pk].c, n: eventos.filter(e => e.plataforma === pk).length })).filter(x => x.n > 0);
  const totalPlat = platMix.reduce((s, x) => s + x.n, 0) || 1;
  const paid = camps.reduce((a, c) => ({ gasto:a.gasto + (+c.gasto || 0), clicks:a.clicks + (+c.clicks || 0), impres:a.impres + (+c.impresiones || 0), result:a.result + (+c.resultados || 0), ingr:a.ingr + (+c.ingresos || 0) }), { gasto:0, clicks:0, impres:0, result:0, ingr:0 });
  const paidCtr = paid.impres > 0 ? (paid.clicks / paid.impres * 100).toFixed(2) : 0;
  const paidCpm = paid.impres > 0 ? Math.round(paid.gasto / paid.impres * 1000) : 0;

  // donut de plataformas (conic-gradient)
  let acc = 0;
  const grad = platMix.length ? platMix.map(x => { const s = acc / totalPlat * 360; acc += x.n; const e = acc / totalPlat * 360; return `${x.c} ${s}deg ${e}deg`; }).join(', ') : `${U.surface2} 0deg 360deg`;

  return (
    <div>
      {/* KPI hero */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:12, marginBottom:12 }}>
        {MktKpi({ U, label:'Alcance', value:mNf(k.alcance), accent:U.accent })}
        {MktKpi({ U, label:'Reproducciones', value:mNf(k.reproducciones), accent:U.accent2 })}
        {MktKpi({ U, label:'Engagement', value:(k.er_promedio || 0) + '%', accent:U.pink })}
        {MktKpi({ U, label:'Hook rate', value:(k.hook_promedio || 0) + '%', accent:U.cyan })}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:12, marginBottom:20 }}>
        {MktKpi({ U, label:'Seguidores', value:'+' + mNf(k.seguidores), accent:U.green })}
        {MktKpi({ U, label:'Inversión ads', value:mMoney(k.gasto), sub:(paidCtr + '% CTR · ' + mMoney(paidCpm) + ' CPM'), accent:U.amber })}
        {MktKpi({ U, label:'ROAS', value:(k.roas || 0) + 'x', sub: k.resultados ? (k.resultados + ' resultados · CPR ' + mMoney(k.cpr)) : null, accent:U.green })}
        {MktKpi({ U, label:'Videos · Ángulos', value:(k.n_videos || 0) + ' · ' + (k.n_angulos || 0), sub:(k.n_campanias || 0) + ' campañas activas', accent:U.accent })}
      </div>

      {/* fila de paneles */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(330px, 1fr))', gap:14 }}>
        {/* Agenda próxima */}
        <MktGlowCard U={U} accent={U.accent2}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
            <Icon n="calendar" s={16} c={U.accent2}/><span style={{ fontSize:13, fontWeight:800 }}>Próximo en el calendario</span>
          </div>
          {proximos.length === 0 ? <div style={{ fontSize:12, color:U.inkMuted }}>Nada agendado próximamente.</div> :
            proximos.map((e, i) => (
              <div key={e.id || i} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 0', borderBottom: i < proximos.length - 1 ? `1px solid ${U.border}` : 'none' }}>
                <span style={{ width:7, height:7, borderRadius:2, background:mEstadoC(e.estado), flexShrink:0 }}/>
                <div style={{ minWidth:0, flex:1 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:U.ink, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{e.titulo}</div>
                  <div style={{ fontSize:10, color:U.inkMuted }}>{e.fecha} · {(MKT_PLATS[e.plataforma] || {}).label || e.plataforma} · {e.formato}</div>
                </div>
              </div>
            ))}
        </MktGlowCard>

        {/* Pipeline de contenido */}
        <MktGlowCard U={U} accent={U.pink}>
          <div style={{ fontSize:13, fontWeight:800, marginBottom:12 }}>Pipeline de contenido</div>
          {pipeline.map(p => (
            <div key={p.id} style={{ marginBottom:9 }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                <span style={{ fontSize:11, color:U.inkSoft }}>{p.label}</span>
                <span style={{ fontSize:11, fontFamily:U.mono, color:U.ink }}>{p.n}</span>
              </div>
              <div style={{ height:5, background:U.surface2, borderRadius:999, overflow:'hidden' }}>
                <div style={{ height:'100%', width:(p.n / maxPipe * 100) + '%', background:p.c }}/>
              </div>
            </div>
          ))}
        </MktGlowCard>

        {/* Mix por plataforma (donut) */}
        <MktGlowCard U={U} accent={U.cyan}>
          <div style={{ fontSize:13, fontWeight:800, marginBottom:12 }}>Contenido por plataforma</div>
          {platMix.length === 0 ? <div style={{ fontSize:12, color:U.inkMuted }}>Sin contenido agendado.</div> : (
            <div style={{ display:'flex', alignItems:'center', gap:18 }}>
              <div style={{ width:104, height:104, borderRadius:'50%', background:`conic-gradient(${grad})`, flexShrink:0, position:'relative' }}>
                <div style={{ position:'absolute', inset:13, borderRadius:'50%', background:U.bg, display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <span style={{ fontSize:18, fontWeight:800, fontFamily:U.mono }}>{totalPlat}</span>
                </div>
              </div>
              <div style={{ flex:1 }}>
                {platMix.map(x => (
                  <div key={x.k} style={{ display:'flex', alignItems:'center', gap:7, marginBottom:6 }}>
                    <span style={{ width:9, height:9, borderRadius:3, background:x.c }}/>
                    <span style={{ fontSize:11.5, color:U.inkSoft, flex:1 }}>{x.label}</span>
                    <span style={{ fontSize:11.5, fontFamily:U.mono, color:U.ink }}>{x.n} · {Math.round(x.n / totalPlat * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </MktGlowCard>

        {/* Top ángulos */}
        <MktGlowCard U={U} accent={U.accent}>
          <div style={{ fontSize:13, fontWeight:800, marginBottom:12 }}>Top ángulos por alcance</div>
          {topA.length === 0 ? <div style={{ fontSize:12, color:U.inkMuted }}>Sin datos todavía.</div> :
            topA.map((a, i) => (
              <div key={a.id || i} style={{ marginBottom:11 }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                  <span style={{ fontSize:12, fontWeight:700, color:U.ink }}>{a.nombre}</span>
                  <span style={{ fontSize:11.5, fontFamily:U.mono, color:U.inkSoft }}>{mNf(a.alcance_total)} · ER {a.er_promedio || 0}%</span>
                </div>
                <div style={{ height:6, background:U.surface2, borderRadius:999, overflow:'hidden' }}>
                  <div style={{ height:'100%', width:((Number(a.alcance_total) || 0) / maxA * 100) + '%',
                    background:`linear-gradient(90deg, ${a.color || U.accent}, ${U.accent2})` }}/>
                </div>
              </div>
            ))}
        </MktGlowCard>

        {/* Top videos */}
        <MktGlowCard U={U} accent={U.cyan}>
          <div style={{ fontSize:13, fontWeight:800, marginBottom:12 }}>Top videos por engagement</div>
          {topV.length === 0 ? <div style={{ fontSize:12, color:U.inkMuted }}>Sin datos todavía.</div> :
            topV.map((v, i) => (
              <div key={v.id || i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                   padding:'8px 0', borderBottom: i < topV.length - 1 ? `1px solid ${U.border}` : 'none' }}>
                <div style={{ minWidth:0, paddingRight:10 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:U.ink, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{v.titulo}</div>
                  <div style={{ fontSize:10, color:U.inkMuted }}>{(MKT_PLATS[v.plataforma] || {}).label || v.plataforma} · {mNf(v.alcance)} alcance</div>
                </div>
                <span style={{ fontSize:13, fontWeight:800, fontFamily:U.mono, color:U.pink }}>{v.er_pct || 0}%</span>
              </div>
            ))}
        </MktGlowCard>

        {/* Publicidad resumen */}
        <MktGlowCard U={U} accent={U.amber}>
          <div style={{ fontSize:13, fontWeight:800, marginBottom:12 }}>Publicidad · resumen</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            {[['Inversión', mMoney(paid.gasto), U.amber], ['Impresiones', mNf(paid.impres), U.inkSoft],
              ['Clicks', mNf(paid.clicks), U.accent2], ['CTR', paidCtr + '%', U.cyan],
              ['Resultados', mNf(paid.result), U.accent2], ['Ingresos', mMoney(paid.ingr), U.green]].map(([l, val, col], i) => (
              <div key={i}>
                <div style={{ fontSize:9, fontWeight:800, letterSpacing:'.08em', textTransform:'uppercase', color:U.inkMuted }}>{l}</div>
                <div style={{ fontSize:17, fontWeight:800, fontFamily:U.mono, color:col, marginTop:3 }}>{val}</div>
              </div>
            ))}
          </div>
        </MktGlowCard>
      </div>
    </div>
  );
}

/* ════════════ MÓDULO: ÁNGULOS DE VENTA ════════════ */
function MktAngulos({ U }) {
  const toast = useToast();
  const [angulos, setAngulos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState({ level:'list' });
  const [modal, setModal] = useState(null);

  const cargarAngulos = useCallback(async () => {
    setLoading(true);
    try { setAngulos(await window.MKT_DATA.angulos()); }
    catch (e) { toast.error(e && e.message ? e.message : 'No se pudo cargar'); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { cargarAngulos(); }, [cargarAngulos]);

  if (loading) return <div style={{ textAlign:'center', color:U.inkMuted, padding:'60px 0' }}>Cargando ángulos…</div>;

  return (
    <div>
      {view.level === 'list' ? (
        <MktAngulosList U={U} angulos={angulos}
          onNuevo={() => setModal({ tipo:'angulo', data:{} })}
          onEdit={(a) => setModal({ tipo:'angulo', data:a })}
          onOpen={(a) => setView({ level:'angulo', a })}/>
      ) : view.level === 'angulo' ? (
        <MktAnguloDetalle U={U} angulo={view.a} toast={toast}
          onBack={() => { setView({ level:'list' }); cargarAngulos(); }}
          onEditAngulo={() => setModal({ tipo:'angulo', data:view.a })}
          onDelAngulo={async () => {
            if (!window.confirm('¿Eliminar el ángulo y todos sus videos?')) return;
            try { await window.MKT_DATA.deleteAngulo(view.a.id); toast.success('Ángulo eliminado'); setView({ level:'list' }); cargarAngulos(); }
            catch (e) { toast.error(e.message); }
          }}
          onOpenVideo={(v) => setView({ level:'video', a:view.a, v })}
          newVideo={() => setModal({ tipo:'video', data:{ angulo_id:view.a.id } })}
          editVideo={(v) => setModal({ tipo:'video', data:v })}/>
      ) : (
        <MktVideoDetalle U={U} video={view.v} angulo={view.a} toast={toast}
          onBack={() => setView({ level:'angulo', a:view.a })}
          onCargarMetrica={() => setModal({ tipo:'metrica', data:{ video_id:view.v.id } })}
          onEditVideo={() => setModal({ tipo:'video', data:view.v })}
          onDelVideo={async () => {
            if (!window.confirm('¿Eliminar este video?')) return;
            try { await window.MKT_DATA.deleteVideo(view.v.id); toast.success('Video eliminado'); setView({ level:'angulo', a:view.a }); }
            catch (e) { toast.error(e.message); }
          }}/>
      )}

      {modal && modal.tipo === 'angulo' && (
        <MktAnguloModal U={U} inicial={modal.data} onClose={() => setModal(null)}
          onSaved={() => { setModal(null); cargarAngulos(); }} toast={toast}/>
      )}
      {modal && modal.tipo === 'video' && (
        <MktVideoModal U={U} inicial={modal.data} onClose={() => setModal(null)}
          onSaved={() => { setModal(null); if (view.level === 'angulo') setView(Object.assign({}, view)); }} toast={toast}/>
      )}
      {modal && modal.tipo === 'metrica' && (
        <MktMetricaModal U={U} videoId={modal.data.video_id} onClose={() => setModal(null)}
          onSaved={() => { setModal(null); if (view.level === 'video') setView(Object.assign({}, view)); }} toast={toast}/>
      )}
    </div>
  );
}

function MktAngulosList({ U, angulos, onNuevo, onEdit, onOpen }) {
  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
        <div style={{ fontSize:12.5, color:U.inkSoft }}>{angulos.length} ángulos de venta · tocá uno para ver sus videos y métricas</div>
        <MktBtn U={U} kind="primary" onClick={onNuevo}><Icon n="plus" s={15} c="#fff"/> Ángulo</MktBtn>
      </div>
      {angulos.length === 0 ? (
        <MktEmpty U={U} icon="spark" title="Todavía no hay ángulos" sub="Creá tu primer ángulo de venta (Luxuria, Productos, Patria…)"/>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(230px, 1fr))', gap:14 }}>
          {angulos.map(a => (
            <div key={a.id} onClick={() => onOpen(a)} style={{ cursor:'pointer',
              background:U.surface, border:`1px solid ${U.border}`, borderRadius:U.radius, padding:'16px', position:'relative', overflow:'hidden' }}>
              <div style={{ position:'absolute', top:0, left:0, bottom:0, width:4, background:a.color || U.accent }}/>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <span style={{ fontSize:15, fontWeight:800, color:U.ink }}>{a.nombre}</span>
                <button onClick={e => { e.stopPropagation(); onEdit(a); }} style={{ border:'none', background:'transparent', cursor:'pointer', padding:2 }}>
                  <Icon n="edit" s={14} c={U.inkMuted}/>
                </button>
              </div>
              {a.descripcion ? <div style={{ fontSize:11, color:U.inkMuted, marginTop:3, lineHeight:1.4 }}>{a.descripcion}</div> : null}
              <div style={{ display:'flex', gap:14, marginTop:14 }}>
                <div><div style={{ fontSize:18, fontWeight:800, fontFamily:U.mono, color:U.ink }}>{a.n_videos || 0}</div><div style={{ fontSize:9, color:U.inkMuted, textTransform:'uppercase', letterSpacing:'.08em' }}>videos</div></div>
                <div><div style={{ fontSize:18, fontWeight:800, fontFamily:U.mono, color:U.accent }}>{mNf(a.alcance_total)}</div><div style={{ fontSize:9, color:U.inkMuted, textTransform:'uppercase', letterSpacing:'.08em' }}>alcance</div></div>
                <div><div style={{ fontSize:18, fontWeight:800, fontFamily:U.mono, color:U.pink }}>{a.er_promedio || 0}%</div><div style={{ fontSize:9, color:U.inkMuted, textTransform:'uppercase', letterSpacing:'.08em' }}>ER</div></div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MktBreadcrumb({ U, items }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:14, flexWrap:'wrap' }}>
      {items.map((it, i) => [
        <button key={'b' + i} onClick={it.onClick} disabled={!it.onClick}
          style={{ border:'none', background:'transparent', cursor: it.onClick ? 'pointer' : 'default',
                   color: it.onClick ? U.inkSoft : U.ink, fontSize:13, fontWeight: it.onClick ? 600 : 800, padding:0 }}>{it.label}</button>,
        i < items.length - 1 ? <Icon key={'s' + i} n="chev-right" s={13} c={U.inkMuted}/> : null,
      ])}
    </div>
  );
}

function MktAnguloDetalle({ U, angulo, toast, onBack, onEditAngulo, onDelAngulo, onOpenVideo, newVideo, editVideo }) {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const cargar = useCallback(async () => {
    setLoading(true);
    try { setVideos(await window.MKT_DATA.videos(angulo.id)); }
    catch (e) { toast.error(e.message); } finally { setLoading(false); }
  }, [angulo.id, toast]);
  useEffect(() => { cargar(); }, [cargar]);

  return (
    <div>
      <MktBreadcrumb U={U} items={[{ label:'Ángulos', onClick:onBack }, { label:angulo.nombre }]}/>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16, gap:10, flexWrap:'wrap' }}>
        <div style={{ display:'flex', gap:14, alignItems:'center' }}>
          <span style={{ width:10, height:34, borderRadius:4, background:angulo.color || U.accent, display:'inline-block' }}/>
          <div>
            <div style={{ fontSize:18, fontWeight:800 }}>{angulo.nombre}</div>
            <div style={{ fontSize:11.5, color:U.inkSoft }}>{angulo.n_videos || 0} videos · alcance {mNf(angulo.alcance_total)} · ER {angulo.er_promedio || 0}% · Hook {angulo.hook_promedio || 0}%</div>
          </div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <MktBtn U={U} small onClick={onEditAngulo}><Icon n="edit" s={13} c={U.ink}/> Editar</MktBtn>
          <MktBtn U={U} small kind="danger" onClick={onDelAngulo}><Icon n="trash" s={13} c={U.red}/></MktBtn>
          <MktBtn U={U} kind="primary" small onClick={newVideo}><Icon n="plus" s={14} c="#fff"/> Video</MktBtn>
        </div>
      </div>
      {loading ? <div style={{ textAlign:'center', color:U.inkMuted, padding:'40px 0' }}>Cargando videos…</div> :
       videos.length === 0 ? <MktEmpty U={U} icon="qr" title="Sin videos en este ángulo" sub="Agregá los videos que vas subiendo de este ángulo"/> : (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {videos.map(v => (
            <div key={v.id} onClick={() => onOpenVideo(v)} style={{ cursor:'pointer', background:U.surface, border:`1px solid ${U.border}`,
                 borderRadius:U.radius, padding:'13px 15px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
              <div style={{ minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ fontSize:13.5, fontWeight:800, color:U.ink, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{v.titulo}</span>
                  <MktChip U={U} c={(MKT_PLATS[v.plataforma] || {}).c}>{(MKT_PLATS[v.plataforma] || {}).label || v.plataforma}</MktChip>
                </div>
                <div style={{ fontSize:10.5, color:U.inkMuted, marginTop:3 }}>{v.fecha_publicacion || 'sin fecha'} · {v.formato}</div>
              </div>
              <div style={{ display:'flex', gap:16, flexShrink:0 }}>
                <div style={{ textAlign:'right' }}><div style={{ fontSize:15, fontWeight:800, fontFamily:U.mono, color:U.accent }}>{mNf(v.alcance)}</div><div style={{ fontSize:8.5, color:U.inkMuted, textTransform:'uppercase' }}>alcance</div></div>
                <div style={{ textAlign:'right' }}><div style={{ fontSize:15, fontWeight:800, fontFamily:U.mono, color:U.pink }}>{v.er_pct || 0}%</div><div style={{ fontSize:8.5, color:U.inkMuted, textTransform:'uppercase' }}>ER</div></div>
                <div style={{ textAlign:'right' }}><div style={{ fontSize:15, fontWeight:800, fontFamily:U.mono, color:U.cyan }}>{v.hook_pct || 0}%</div><div style={{ fontSize:8.5, color:U.inkMuted, textTransform:'uppercase' }}>hook</div></div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MktVideoDetalle({ U, video, angulo, toast, onBack, onCargarMetrica, onEditVideo, onDelVideo }) {
  const [v, setV] = useState(video);
  const [hist, setHist] = useState([]);
  const refrescar = useCallback(async () => {
    try {
      const r = await window.MKT_DATA.videoResumen(video.id);
      if (r && r[0]) setV(r[0]);
      setHist(await window.MKT_DATA.metricas(video.id));
    } catch (e) { toast.error(e.message); }
  }, [video.id, toast]);
  useEffect(() => { refrescar(); }, [refrescar]);

  const cards = [
    { l:'Alcance', v:mNf(v.alcance), c:U.accent }, { l:'Reproducciones', v:mNf(v.reproducciones), c:U.accent2 },
    { l:'Engagement', v:(v.er_pct || 0) + '%', c:U.pink }, { l:'Hook rate', v:(v.hook_pct || 0) + '%', c:U.cyan },
    { l:'Likes', v:mNf(v.likes), c:U.inkSoft }, { l:'Comentarios', v:mNf(v.comentarios), c:U.inkSoft },
    { l:'Compartidos', v:mNf(v.compartidos), c:U.green }, { l:'Guardados', v:mNf(v.guardados), c:U.amber },
    { l:'Seguidores', v:'+' + mNf(v.seguidores), c:U.green }, { l:'Retención', v:(v.retencion_pct != null ? v.retencion_pct + '%' : '—'), c:U.cyan },
  ];
  const maxAl = Math.max(1, ...hist.map(h => Number(h.alcance) || 0));

  return (
    <div>
      <MktBreadcrumb U={U} items={[{ label:'Ángulos', onClick:() => {} }, { label:angulo.nombre, onClick:onBack }, { label:v.titulo }]}/>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16, gap:10, flexWrap:'wrap' }}>
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:18, fontWeight:800 }}>{v.titulo}</span>
            <MktChip U={U} c={(MKT_PLATS[v.plataforma] || {}).c}>{(MKT_PLATS[v.plataforma] || {}).label || v.plataforma}</MktChip>
          </div>
          <div style={{ fontSize:11.5, color:U.inkSoft, marginTop:3 }}>
            {v.metrica_fecha ? ('última métrica ' + v.metrica_fecha + (v.fuente ? ' · ' + v.fuente : '')) : 'sin métricas cargadas'}
            {v.url ? [' · ', <a key="l" href={v.url} target="_blank" rel="noreferrer" style={{ color:U.accent2 }}>ver post</a>] : null}
          </div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <MktBtn U={U} small onClick={onEditVideo}><Icon n="edit" s={13} c={U.ink}/> Editar</MktBtn>
          <MktBtn U={U} small kind="danger" onClick={onDelVideo}><Icon n="trash" s={13} c={U.red}/></MktBtn>
          <MktBtn U={U} kind="primary" small onClick={onCargarMetrica}><Icon n="plus" s={14} c="#fff"/> Métrica</MktBtn>
        </div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(130px, 1fr))', gap:11, marginBottom:18 }}>
        {cards.map((c, i) => (
          <div key={i} style={{ background:U.surface, border:`1px solid ${U.border}`, borderRadius:12, padding:'12px 14px' }}>
            <div style={{ fontSize:9, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:U.inkMuted }}>{c.l}</div>
            <div style={{ fontSize:20, fontWeight:800, fontFamily:U.mono, color:c.c, marginTop:5 }}>{c.v}</div>
          </div>
        ))}
      </div>
      {hist.length > 1 ? (
        <MktGlowCard U={U} accent={U.accent}>
          <div style={{ fontSize:12.5, fontWeight:800, marginBottom:12 }}>Evolución del alcance</div>
          <div style={{ display:'flex', alignItems:'flex-end', gap:4, height:90 }}>
            {hist.map((h, i) => (
              <div key={i} title={h.fecha + ': ' + mNf(h.alcance)} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
                <div style={{ width:'100%', maxWidth:26, height:Math.max(3, (Number(h.alcance) || 0) / maxAl * 72),
                  background:`linear-gradient(180deg, ${U.accent}, ${U.accent2})`, borderRadius:4 }}/>
                <span style={{ fontSize:8, color:U.inkMuted }}>{String(h.fecha || '').slice(5)}</span>
              </div>
            ))}
          </div>
        </MktGlowCard>
      ) : null}
    </div>
  );
}

/* ── Modales Ángulos ── */
function MktAnguloModal({ U, inicial, onClose, onSaved, toast }) {
  const [f, setF] = useState({ nombre: inicial.nombre || '', descripcion: inicial.descripcion || '', color: inicial.color || '#7C3AED' });
  const [saving, setSaving] = useState(false);
  const set = (k, val) => setF(p => Object.assign({}, p, { [k]: val }));
  const COLORS = ['#7C3AED', '#2563EB', '#EC4899', '#22D3EE', '#22C55E', '#F59E0B', '#EF4444'];
  const guardar = async () => {
    if (!f.nombre.trim()) { toast.error('Falta el nombre'); return; }
    setSaving(true);
    try { await window.MKT_DATA.upsertAngulo(Object.assign({}, inicial.id ? { id:inicial.id } : {}, f)); toast.success('Guardado'); onSaved(); }
    catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  return (
    <MktModal U={U} titulo={inicial.id ? 'Editar ángulo' : 'Nuevo ángulo de venta'} onClose={onClose}>
      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        <MktField U={U} label="Nombre" value={f.nombre} onChange={v => set('nombre', v)} placeholder="Luxuria, Productos, Patria…" full/>
        <MktField U={U} label="Descripción" value={f.descripcion} onChange={v => set('descripcion', v)} placeholder="Opcional" full/>
        <div>
          <span style={mLbl(U)}>Color</span>
          <div style={{ display:'flex', gap:8 }}>
            {COLORS.map(c => <button key={c} onClick={() => set('color', c)} style={{ width:28, height:28, borderRadius:8, background:c,
              border: f.color === c ? `2px solid ${U.ink}` : `1px solid ${U.border}`, cursor:'pointer' }}/>)}
          </div>
        </div>
        <div style={{ display:'flex', gap:10, marginTop:4 }}>
          <MktBtn U={U} onClick={onClose}>Cancelar</MktBtn>
          <div style={{ flex:1 }}/>
          <MktBtn U={U} kind="primary" disabled={saving} onClick={guardar}>{saving ? 'Guardando…' : 'Guardar'}</MktBtn>
        </div>
      </div>
    </MktModal>
  );
}
function MktVideoModal({ U, inicial, onClose, onSaved, toast }) {
  const [f, setF] = useState({ titulo: inicial.titulo || '', plataforma: inicial.plataforma || 'instagram',
    formato: inicial.formato || 'reel', url: inicial.url || '', fecha_publicacion: inicial.fecha_publicacion || '', estado: inicial.estado || 'publicado' });
  const [saving, setSaving] = useState(false);
  const set = (k, val) => setF(p => Object.assign({}, p, { [k]: val }));
  const guardar = async () => {
    if (!f.titulo.trim()) { toast.error('Falta el título'); return; }
    setSaving(true);
    try {
      await window.MKT_DATA.upsertVideo(Object.assign({}, inicial.id ? { id:inicial.id } : { angulo_id:inicial.angulo_id }, f));
      toast.success('Video guardado'); onSaved();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  return (
    <MktModal U={U} titulo={inicial.id ? 'Editar video' : 'Nuevo video'} onClose={onClose}>
      <div style={{ display:'flex', flexWrap:'wrap', gap:12 }}>
        <MktField U={U} label="Título" value={f.titulo} onChange={v => set('titulo', v)} full/>
        <MktSelect U={U} label="Plataforma" value={f.plataforma} onChange={v => set('plataforma', v)}
          options={Object.keys(MKT_PLATS).map(k => ({ value:k, label:MKT_PLATS[k].label }))}/>
        <MktSelect U={U} label="Formato" value={f.formato} onChange={v => set('formato', v)}
          options={['reel','post','carrusel','story','video'].map(x => ({ value:x, label:x }))}/>
        <MktField U={U} label="Fecha publicación" type="date" value={f.fecha_publicacion} onChange={v => set('fecha_publicacion', v)}/>
        <MktField U={U} label="URL del post" value={f.url} onChange={v => set('url', v)} full/>
        <div style={{ display:'flex', gap:10, marginTop:4, width:'100%' }}>
          <MktBtn U={U} onClick={onClose}>Cancelar</MktBtn>
          <div style={{ flex:1 }}/>
          <MktBtn U={U} kind="primary" disabled={saving} onClick={guardar}>{saving ? 'Guardando…' : 'Guardar'}</MktBtn>
        </div>
      </div>
    </MktModal>
  );
}
function MktMetricaModal({ U, videoId, onClose, onSaved, toast }) {
  const campos = [['alcance','Alcance'],['impresiones','Impresiones'],['reproducciones','Reproducciones'],['vistas_3s','Vistas 3s (hook)'],
    ['likes','Likes'],['comentarios','Comentarios'],['compartidos','Compartidos'],['guardados','Guardados'],
    ['seguidores','Seguidores ganados'],['retencion_pct','Retención %']];
  const [f, setF] = useState({ fecha: new Date().toISOString().slice(0, 10) });
  const [saving, setSaving] = useState(false);
  const set = (k, val) => setF(p => Object.assign({}, p, { [k]: val }));
  const guardar = async () => {
    setSaving(true);
    try { await window.MKT_DATA.cargarMetrica(Object.assign({ video_id:videoId }, f)); toast.success('Métrica cargada'); onSaved(); }
    catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  return (
    <MktModal U={U} titulo="Cargar métricas del video" onClose={onClose} wide>
      <MktField U={U} label="Fecha del snapshot" type="date" value={f.fecha} onChange={v => set('fecha', v)} full/>
      <div style={{ display:'flex', flexWrap:'wrap', gap:12, marginTop:12 }}>
        {campos.map(([k, l]) => <MktField key={k} U={U} label={l} type="number" value={f[k]} onChange={v => set(k, v)}/>)}
      </div>
      <div style={{ display:'flex', gap:10, marginTop:16 }}>
        <MktBtn U={U} onClick={onClose}>Cancelar</MktBtn>
        <div style={{ flex:1 }}/>
        <MktBtn U={U} kind="primary" disabled={saving} onClick={guardar}>{saving ? 'Guardando…' : 'Guardar métrica'}</MktBtn>
      </div>
    </MktModal>
  );
}

/* ════════════ MÓDULO: CALENDARIO ════════════ */
function MktCalendario({ U }) {
  const toast = useToast();
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y:d.getFullYear(), m:d.getMonth() }; });
  const [eventos, setEventos] = useState([]);
  const [angulos, setAngulos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    const desde = new Date(cursor.y, cursor.m, 1).toISOString().slice(0, 10);
    const hasta = new Date(cursor.y, cursor.m + 1, 0).toISOString().slice(0, 10);
    try {
      const [ev, an] = await Promise.all([window.MKT_DATA.eventos(desde, hasta), window.MKT_DATA.angulos().catch(() => [])]);
      setEventos(ev); setAngulos(an);
    } catch (e) { toast.error(e.message); } finally { setLoading(false); }
  }, [cursor, toast]);
  useEffect(() => { cargar(); }, [cargar]);

  const porDia = useMemo(() => {
    const m = {}; for (const e of eventos) { (m[e.fecha] = m[e.fecha] || []).push(e); } return m;
  }, [eventos]);

  const primerDia = new Date(cursor.y, cursor.m, 1).getDay();
  const offset = (primerDia + 6) % 7;
  const diasMes = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const hoy = new Date().toISOString().slice(0, 10);
  const celdas = [];
  for (let i = 0; i < offset; i++) celdas.push(null);
  for (let d = 1; d <= diasMes; d++) celdas.push(d);
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const mover = (delta) => setCursor(c => { let m = c.m + delta, y = c.y; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } return { y, m }; });

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14, flexWrap:'wrap', gap:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <MktBtn U={U} small onClick={() => mover(-1)}><Icon n="arrow-left" s={14} c={U.ink}/></MktBtn>
          <span style={{ fontSize:16, fontWeight:800, minWidth:150, textAlign:'center' }}>{meses[cursor.m]} {cursor.y}</span>
          <MktBtn U={U} small onClick={() => mover(1)}><Icon n="arrow-right" s={14} c={U.ink}/></MktBtn>
        </div>
        <MktBtn U={U} kind="primary" onClick={() => setModal({ data:{ fecha: hoy } })}><Icon n="plus" s={15} c="#fff"/> Contenido</MktBtn>
      </div>
      {loading ? <div style={{ textAlign:'center', color:U.inkMuted, padding:'40px 0' }}>Cargando calendario…</div> : (
        <div style={{ background:U.surface, border:`1px solid ${U.border}`, borderRadius:U.radius, overflow:'hidden' }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(7, 1fr)' }}>
            {['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(d => (
              <div key={d} style={{ padding:'9px 6px', fontSize:10, fontWeight:800, letterSpacing:'.08em', textTransform:'uppercase',
                color:U.inkMuted, textAlign:'center', borderBottom:`1px solid ${U.border}` }}>{d}</div>
            ))}
            {celdas.map((d, i) => {
              const fstr = d ? `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
              const evs = fstr ? (porDia[fstr] || []) : [];
              const esHoy = fstr === hoy;
              return (
                <div key={i} onClick={() => fstr && setModal({ data:{ fecha:fstr } })}
                  style={{ minHeight:78, padding:'5px 5px 7px', borderRight: (i % 7 !== 6) ? `1px solid ${U.border}` : 'none',
                    borderTop:`1px solid ${U.border}`, cursor: fstr ? 'pointer' : 'default',
                    background: esHoy ? U.accent + '12' : 'transparent' }}>
                  {d ? <div style={{ fontSize:11, fontWeight: esHoy ? 800 : 600, color: esHoy ? U.accent : U.inkSoft, marginBottom:3 }}>{d}</div> : null}
                  {evs.slice(0, 3).map(e => (
                    <div key={e.id} onClick={ev => { ev.stopPropagation(); setModal({ data:e }); }}
                      style={{ fontSize:9.5, fontWeight:700, color:'#fff', background:mEstadoC(e.estado), borderRadius:5,
                        padding:'2px 5px', marginBottom:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
                        borderLeft:`3px solid ${(MKT_PLATS[e.plataforma] || {}).c || '#fff'}` }}>{e.titulo}</div>
                  ))}
                  {evs.length > 3 ? <div style={{ fontSize:9, color:U.inkMuted }}>+{evs.length - 3} más</div> : null}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div style={{ display:'flex', flexWrap:'wrap', gap:10, marginTop:12 }}>
        {MKT_EV_ESTADOS.map(e => (
          <span key={e.id} style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:10.5, color:U.inkSoft }}>
            <span style={{ width:9, height:9, borderRadius:3, background:e.c }}/>{e.label}
          </span>
        ))}
      </div>
      {modal && <MktEventoModal U={U} inicial={modal.data} angulos={angulos} onClose={() => setModal(null)}
        onSaved={() => { setModal(null); cargar(); }} toast={toast}/>}
    </div>
  );
}
function MktEventoModal({ U, inicial, angulos, onClose, onSaved, toast }) {
  const [f, setF] = useState({
    titulo: inicial.titulo || '', fecha: inicial.fecha || new Date().toISOString().slice(0, 10),
    plataforma: inicial.plataforma || 'instagram', formato: inicial.formato || 'reel', objetivo: inicial.objetivo || '',
    angulo_id: inicial.angulo_id || '', estado: inicial.estado || 'idea', copy: inicial.copy || '',
    material_url: inicial.material_url || '', arte_url: inicial.arte_url || '', responsable: inicial.responsable || '', notas_cm: inicial.notas_cm || '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k, val) => setF(p => Object.assign({}, p, { [k]: val }));
  const guardar = async () => {
    if (!f.titulo.trim()) { toast.error('Falta el título'); return; }
    setSaving(true);
    try { await window.MKT_DATA.upsertEvento(Object.assign({}, inicial.id ? { id:inicial.id } : {}, f)); toast.success('Guardado'); onSaved(); }
    catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  const borrar = async () => {
    if (!window.confirm('¿Eliminar este contenido del calendario?')) return;
    try { await window.MKT_DATA.deleteEvento(inicial.id); toast.success('Eliminado'); onSaved(); } catch (e) { toast.error(e.message); }
  };
  return (
    <MktModal U={U} titulo={inicial.id ? 'Editar contenido' : 'Nuevo contenido'} onClose={onClose} wide>
      <div style={{ display:'flex', flexWrap:'wrap', gap:12 }}>
        <MktField U={U} label="Título / Temática" value={f.titulo} onChange={v => set('titulo', v)} full/>
        <MktField U={U} label="Fecha" type="date" value={f.fecha} onChange={v => set('fecha', v)}/>
        <MktSelect U={U} label="Plataforma" value={f.plataforma} onChange={v => set('plataforma', v)}
          options={Object.keys(MKT_PLATS).map(k => ({ value:k, label:MKT_PLATS[k].label }))}/>
        <MktSelect U={U} label="Formato" value={f.formato} onChange={v => set('formato', v)}
          options={['reel','post','carrusel','story','guion','video'].map(x => ({ value:x, label:x }))}/>
        <MktSelect U={U} label="Estado" value={f.estado} onChange={v => set('estado', v)}
          options={MKT_EV_ESTADOS.map(e => ({ value:e.id, label:e.label }))}/>
        <MktSelect U={U} label="Ángulo de venta" value={f.angulo_id} onChange={v => set('angulo_id', v)}
          options={[{ value:'', label:'— ninguno —' }].concat(angulos.map(a => ({ value:a.id, label:a.nombre })))}/>
        <MktField U={U} label="Objetivo" value={f.objetivo} onChange={v => set('objetivo', v)} placeholder="ventas / tráfico / marca"/>
        <MktField U={U} label="Responsable" value={f.responsable} onChange={v => set('responsable', v)}/>
        <MktField U={U} label="Material (link)" value={f.material_url} onChange={v => set('material_url', v)} full/>
        <MktField U={U} label="Copy + #" value={f.copy} onChange={v => set('copy', v)} full/>
        <MktField U={U} label="Notas para CM" value={f.notas_cm} onChange={v => set('notas_cm', v)} full/>
      </div>
      <div style={{ display:'flex', gap:10, marginTop:16, alignItems:'center' }}>
        {inicial.id ? <MktBtn U={U} kind="danger" small onClick={borrar}><Icon n="trash" s={13} c={U.red}/></MktBtn> : null}
        <MktBtn U={U} onClick={onClose}>Cancelar</MktBtn>
        <div style={{ flex:1 }}/>
        <MktBtn U={U} kind="primary" disabled={saving} onClick={guardar}>{saving ? 'Guardando…' : 'Guardar'}</MktBtn>
      </div>
    </MktModal>
  );
}

/* ════════════ MÓDULO: PUBLICIDAD ════════════ */
function MktPublicidad({ U }) {
  const toast = useToast();
  const [camps, setCamps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const cargar = useCallback(async () => {
    setLoading(true);
    try { setCamps(await window.MKT_DATA.campanias()); } catch (e) { toast.error(e.message); } finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { cargar(); }, [cargar]);

  const tot = camps.reduce((a, c) => ({ gasto:a.gasto + (+c.gasto || 0), result:a.result + (+c.resultados || 0), ingr:a.ingr + (+c.ingresos || 0),
    impres:a.impres + (+c.impresiones || 0), clicks:a.clicks + (+c.clicks || 0), alcance:a.alcance + (+c.alcance || 0) }),
    { gasto:0, result:0, ingr:0, impres:0, clicks:0, alcance:0 });
  const roas = tot.gasto > 0 ? (tot.ingr / tot.gasto).toFixed(2) : 0;
  const cpr = tot.result > 0 ? Math.round(tot.gasto / tot.result) : 0;
  const ctrTot = tot.impres > 0 ? (tot.clicks / tot.impres * 100).toFixed(2) : 0;
  const cpmTot = tot.impres > 0 ? Math.round(tot.gasto / tot.impres * 1000) : 0;
  const estC = (e) => e === 'activa' ? U.green : (e === 'pausada' ? U.amber : U.inkMuted);

  return (
    <div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:12, marginBottom:16 }}>
        {MktKpi({ U, label:'Inversión total', value:mMoney(tot.gasto), accent:U.amber })}
        {MktKpi({ U, label:'Impresiones', value:mNf(tot.impres), accent:U.inkSoft })}
        {MktKpi({ U, label:'Alcance', value:mNf(tot.alcance), accent:U.accent })}
        {MktKpi({ U, label:'Clicks', value:mNf(tot.clicks), accent:U.accent2 })}
        {MktKpi({ U, label:'CTR', value:ctrTot + '%', accent:U.cyan })}
        {MktKpi({ U, label:'CPM', value:mMoney(cpmTot), accent:U.inkSoft })}
        {MktKpi({ U, label:'Resultados', value:mNf(tot.result), accent:U.accent2 })}
        {MktKpi({ U, label:'Costo / resultado', value:mMoney(cpr), accent:U.pink })}
        {MktKpi({ U, label:'Ingresos', value:mMoney(tot.ingr), accent:U.green })}
        {MktKpi({ U, label:'ROAS', value:roas + 'x', accent:U.green })}
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
        <div style={{ fontSize:12.5, color:U.inkSoft }}>{camps.length} campañas</div>
        <MktBtn U={U} kind="primary" onClick={() => setModal({ tipo:'camp', data:{} })}><Icon n="plus" s={15} c="#fff"/> Campaña</MktBtn>
      </div>
      {loading ? <div style={{ textAlign:'center', color:U.inkMuted, padding:'40px 0' }}>Cargando…</div> :
       camps.length === 0 ? <MktEmpty U={U} icon="dollar" title="Sin campañas" sub="Cargá tu primera campaña de Meta Ads / IG / TikTok / YouTube"/> : (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {camps.map(c => (
            <div key={c.id} style={{ background:U.surface, border:`1px solid ${U.border}`, borderRadius:U.radius, padding:'14px 16px' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, flexWrap:'wrap' }}>
                <div style={{ display:'flex', alignItems:'center', gap:9, minWidth:0 }}>
                  <span style={{ fontSize:14, fontWeight:800, color:U.ink }}>{c.nombre}</span>
                  <MktChip U={U} c={(MKT_PLATS[c.plataforma] || {}).c}>{(MKT_PLATS[c.plataforma] || {}).label || c.plataforma}</MktChip>
                  <MktChip U={U} c={estC(c.estado)}>{c.estado}</MktChip>
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <MktBtn U={U} small onClick={() => setModal({ tipo:'metrica', data:c })}><Icon n="chart" s={13} c={U.ink}/> Métricas</MktBtn>
                  <MktBtn U={U} small onClick={() => setModal({ tipo:'camp', data:c })}><Icon n="edit" s={13} c={U.ink}/></MktBtn>
                  <MktBtn U={U} small kind="danger" onClick={async () => { if (window.confirm('¿Eliminar campaña?')) { try { await window.MKT_DATA.deleteCampania(c.id); toast.success('Eliminada'); cargar(); } catch (e) { toast.error(e.message); } } }}><Icon n="trash" s={13} c={U.red}/></MktBtn>
                </div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(82px, 1fr))', gap:12, marginTop:12 }}>
                {[['Gasto', mMoney(c.gasto), U.amber], ['Impresiones', mNf(c.impresiones), U.inkSoft], ['Alcance', mNf(c.alcance), U.inkSoft],
                  ['Frecuencia', (c.frecuencia != null ? Number(c.frecuencia).toFixed(1) : '—'), U.inkSoft], ['Clicks', mNf(c.clicks), U.accent2],
                  ['CTR', (c.ctr || 0) + '%', U.cyan], ['CPM', mMoney(c.cpm), U.inkSoft], ['CPC', mMoney(c.cpc), U.inkSoft],
                  ['Resultados', mNf(c.resultados), U.accent2], ['CPR', mMoney(c.cpr), U.pink],
                  ['Conv.', (Number(c.clicks) > 0 ? (Number(c.resultados) / Number(c.clicks) * 100).toFixed(1) : '0') + '%', U.cyan],
                  ['Ingresos', mMoney(c.ingresos), U.green], ['ROAS', (c.roas || 0) + 'x', U.green]].map(([l, v, col], i) => (
                  <div key={i}><div style={{ fontSize:14, fontWeight:800, fontFamily:U.mono, color:col }}>{v}</div><div style={{ fontSize:8.5, color:U.inkMuted, textTransform:'uppercase', letterSpacing:'.06em' }}>{l}</div></div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {modal && modal.tipo === 'camp' && <MktCampaniaModal U={U} inicial={modal.data} onClose={() => setModal(null)} onSaved={() => { setModal(null); cargar(); }} toast={toast}/>}
      {modal && modal.tipo === 'metrica' && <MktCampaniaMetricaModal U={U} camp={modal.data} onClose={() => setModal(null)} onSaved={() => { setModal(null); cargar(); }} toast={toast}/>}
    </div>
  );
}
function MktCampaniaModal({ U, inicial, onClose, onSaved, toast }) {
  const [f, setF] = useState({ nombre: inicial.nombre || '', plataforma: inicial.plataforma || 'meta', objetivo: inicial.objetivo || 'ventas',
    presupuesto: inicial.presupuesto || '', estado: inicial.estado || 'activa', fecha_inicio: inicial.fecha_inicio || '', fecha_fin: inicial.fecha_fin || '' });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF(p => Object.assign({}, p, { [k]: v }));
  const guardar = async () => {
    if (!f.nombre.trim()) { toast.error('Falta el nombre'); return; }
    setSaving(true);
    try { await window.MKT_DATA.upsertCampania(Object.assign({}, inicial.id ? { id:inicial.id } : {}, f)); toast.success('Guardada'); onSaved(); }
    catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  return (
    <MktModal U={U} titulo={inicial.id ? 'Editar campaña' : 'Nueva campaña'} onClose={onClose} wide>
      <div style={{ display:'flex', flexWrap:'wrap', gap:12 }}>
        <MktField U={U} label="Nombre" value={f.nombre} onChange={v => set('nombre', v)} full/>
        <MktSelect U={U} label="Plataforma" value={f.plataforma} onChange={v => set('plataforma', v)}
          options={['meta','instagram','tiktok','youtube'].map(k => ({ value:k, label:(MKT_PLATS[k] || {}).label || k }))}/>
        <MktSelect U={U} label="Objetivo" value={f.objetivo} onChange={v => set('objetivo', v)}
          options={['ventas','trafico','alcance','mensajes','leads'].map(x => ({ value:x, label:x }))}/>
        <MktField U={U} label="Presupuesto" type="number" value={f.presupuesto} onChange={v => set('presupuesto', v)}/>
        <MktSelect U={U} label="Estado" value={f.estado} onChange={v => set('estado', v)}
          options={['activa','pausada','finalizada'].map(x => ({ value:x, label:x }))}/>
        <MktField U={U} label="Inicio" type="date" value={f.fecha_inicio} onChange={v => set('fecha_inicio', v)}/>
        <MktField U={U} label="Fin" type="date" value={f.fecha_fin} onChange={v => set('fecha_fin', v)}/>
      </div>
      <div style={{ display:'flex', gap:10, marginTop:16 }}>
        <MktBtn U={U} onClick={onClose}>Cancelar</MktBtn><div style={{ flex:1 }}/>
        <MktBtn U={U} kind="primary" disabled={saving} onClick={guardar}>{saving ? 'Guardando…' : 'Guardar'}</MktBtn>
      </div>
    </MktModal>
  );
}
function MktCampaniaMetricaModal({ U, camp, onClose, onSaved, toast }) {
  const campos = [['gasto','Gasto'],['impresiones','Impresiones'],['alcance','Alcance'],['clicks','Clicks'],
    ['resultados','Resultados'],['ingresos','Ingresos (ventas)']];
  const [f, setF] = useState({ fecha: new Date().toISOString().slice(0, 10), tipo_resultado: camp.tipo_resultado || '' });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF(p => Object.assign({}, p, { [k]: v }));
  const guardar = async () => {
    setSaving(true);
    try { await window.MKT_DATA.cargarCampaniaMetrica(Object.assign({ campania_id:camp.id }, f)); toast.success('Métricas cargadas'); onSaved(); }
    catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  return (
    <MktModal U={U} titulo={'Métricas · ' + camp.nombre} onClose={onClose} wide>
      <div style={{ display:'flex', flexWrap:'wrap', gap:12 }}>
        <MktField U={U} label="Fecha" type="date" value={f.fecha} onChange={v => set('fecha', v)}/>
        <MktField U={U} label="Tipo de resultado" value={f.tipo_resultado} onChange={v => set('tipo_resultado', v)} placeholder="compras / mensajes / leads"/>
        {campos.map(([k, l]) => <MktField key={k} U={U} label={l} type="number" value={f[k]} onChange={v => set(k, v)}/>)}
      </div>
      <div style={{ display:'flex', gap:10, marginTop:16 }}>
        <MktBtn U={U} onClick={onClose}>Cancelar</MktBtn><div style={{ flex:1 }}/>
        <MktBtn U={U} kind="primary" disabled={saving} onClick={guardar}>{saving ? 'Guardando…' : 'Guardar'}</MktBtn>
      </div>
    </MktModal>
  );
}

/* ════════════ MÓDULO: PRIORIDADES ════════════ */
function MktPrioridades({ U }) {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const cargar = useCallback(async () => {
    setLoading(true);
    try { setItems(await window.MKT_DATA.prioridades()); } catch (e) { toast.error(e.message); } finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { cargar(); }, [cargar]);

  const cols = [{ id:'pendiente', label:'Pendiente', c:U.amber }, { id:'en_progreso', label:'En progreso', c:U.accent2 }, { id:'hecho', label:'Hecho', c:U.green }];
  const urgC = (u) => u === 'alta' ? U.red : (u === 'media' ? U.amber : U.inkMuted);
  const mover = async (it, estado) => { try { await window.MKT_DATA.gestionarPrioridad({ id:it.id, estado }); cargar(); } catch (e) { toast.error(e.message); } };
  const borrar = async (it) => { if (!window.confirm('¿Eliminar prioridad?')) return; try { await window.MKT_DATA.deletePrioridad(it.id); cargar(); } catch (e) { toast.error(e.message); } };

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
        <div style={{ fontSize:12.5, color:U.inkSoft }}>Al crear una prioridad se le notifica al dueño y al encargado de Marketing</div>
        <MktBtn U={U} kind="primary" onClick={() => setModal(true)}><Icon n="plus" s={15} c="#fff"/> Prioridad</MktBtn>
      </div>
      {loading ? <div style={{ textAlign:'center', color:U.inkMuted, padding:'40px 0' }}>Cargando…</div> : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(240px, 1fr))', gap:14 }}>
          {cols.map(col => {
            const list = items.filter(i => (i.estado || 'pendiente') === col.id);
            return (
              <div key={col.id}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
                  <span style={{ width:9, height:9, borderRadius:3, background:col.c }}/>
                  <span style={{ fontSize:12, fontWeight:800, color:U.ink }}>{col.label}</span>
                  <span style={{ fontSize:11, color:U.inkMuted, fontFamily:U.mono }}>{list.length}</span>
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
                  {list.length === 0 ? <div style={{ fontSize:11, color:U.inkMuted, padding:'10px 0', textAlign:'center' }}>—</div> :
                   list.map(it => (
                    <div key={it.id} style={{ background:U.surface, border:`1px solid ${U.border}`, borderLeft:`3px solid ${urgC(it.urgencia)}`, borderRadius:12, padding:'11px 12px' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', gap:8 }}>
                        <span style={{ fontSize:12.5, fontWeight:700, color:U.ink }}>{it.titulo}</span>
                        <MktChip U={U} c={urgC(it.urgencia)}>{it.urgencia}</MktChip>
                      </div>
                      {it.descripcion ? <div style={{ fontSize:11, color:U.inkMuted, marginTop:4, lineHeight:1.4 }}>{it.descripcion}</div> : null}
                      <div style={{ display:'flex', gap:6, marginTop:10, flexWrap:'wrap' }}>
                        {col.id !== 'pendiente' ? <MktBtn U={U} small onClick={() => mover(it, 'pendiente')}>← Pend.</MktBtn> : null}
                        {col.id !== 'en_progreso' ? <MktBtn U={U} small onClick={() => mover(it, 'en_progreso')}>En progreso</MktBtn> : null}
                        {col.id !== 'hecho' ? <MktBtn U={U} small kind="primary" onClick={() => mover(it, 'hecho')}>Hecho ✓</MktBtn> : null}
                        <MktBtn U={U} small kind="danger" onClick={() => borrar(it)}><Icon n="trash" s={12} c={U.red}/></MktBtn>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {modal && <MktPrioridadModal U={U} onClose={() => setModal(false)} onSaved={() => { setModal(false); cargar(); }} toast={toast}/>}
    </div>
  );
}
function MktPrioridadModal({ U, onClose, onSaved, toast }) {
  const [f, setF] = useState({ titulo:'', descripcion:'', urgencia:'media', area:'' });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF(p => Object.assign({}, p, { [k]: v }));
  const guardar = async () => {
    if (!f.titulo.trim()) { toast.error('Falta el título'); return; }
    setSaving(true);
    try { const r = await window.MKT_DATA.crearPrioridad(f); toast.success('Prioridad creada · ' + ((r && r.notificados) || 0) + ' notificados'); onSaved(); }
    catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  return (
    <MktModal U={U} titulo="Nueva prioridad" onClose={onClose}>
      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        <MktField U={U} label="¿Qué se necesita?" value={f.titulo} onChange={v => set('titulo', v)} full/>
        <MktField U={U} label="Detalle" value={f.descripcion} onChange={v => set('descripcion', v)} full/>
        <div style={{ display:'flex', gap:12 }}>
          <MktSelect U={U} label="Urgencia" value={f.urgencia} onChange={v => set('urgencia', v)} options={['alta','media','baja'].map(x => ({ value:x, label:x }))}/>
          <MktField U={U} label="Área / contexto" value={f.area} onChange={v => set('area', v)}/>
        </div>
        <div style={{ display:'flex', gap:10, marginTop:4 }}>
          <MktBtn U={U} onClick={onClose}>Cancelar</MktBtn><div style={{ flex:1 }}/>
          <MktBtn U={U} kind="primary" disabled={saving} onClick={guardar}>{saving ? 'Creando…' : 'Crear y notificar'}</MktBtn>
        </div>
      </div>
    </MktModal>
  );
}

/* ════════════ HUB ════════════ */
function MarketingPage() {
  const M = window.useMockData ? window.useMockData() : { user:{} };
  const role = ((M.user || {}).role || '').toLowerCase();
  const [tab, setTab] = useState('dashboard');
  const [tema, setTema] = useState(() => {
    try { return localStorage.getItem('mkt_tema') || 'dark'; } catch (e) { return 'dark'; }
  });
  const U = tema === 'light' ? MKT_LIGHT : MKT_DARK;
  const setTemaP = (t) => { setTema(t); try { localStorage.setItem('mkt_tema', t); } catch (e) {} };

  const TABS = [
    { id:'dashboard', label:'Dashboard', icon:'chart' },
    { id:'calendario', label:'Calendario', icon:'calendar' },
    { id:'angulos', label:'Ángulos', icon:'spark' },
    { id:'publicidad', label:'Publicidad', icon:'dollar' },
    { id:'prioridades', label:'Prioridades', icon:'bell' },
  ];

  if (role && ['owner', 'admin', 'marketing'].indexOf(role) < 0) {
    return <div className="page"><div style={{ padding:40, textAlign:'center', color:'var(--ink-muted)' }}>Sin acceso al módulo de Marketing.</div></div>;
  }

  return (
    <div style={{ minHeight:'100vh', boxSizing:'border-box', color:U.ink, padding:'20px 26px 40px',
      background:`radial-gradient(1100px 520px at 0% -8%, ${U.accent}26, transparent), radial-gradient(950px 480px at 100% -4%, ${U.accent2}1c, transparent), ${U.bg}` }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18, flexWrap:'wrap', gap:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ width:40, height:40, borderRadius:12, display:'flex', alignItems:'center', justifyContent:'center',
            background:`linear-gradient(135deg, ${U.accent}, ${U.accent2})`, boxShadow:`0 8px 26px ${U.accent}55` }}>
            <Icon n="megaphone" s={21} c="#fff"/>
          </span>
          <div>
            <div style={{ fontSize:18, fontWeight:800, letterSpacing:'.01em' }}>Marketing</div>
            <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:'.18em', textTransform:'uppercase', color:U.inkMuted }}>Command Center</div>
          </div>
        </div>
        <div style={{ display:'flex', gap:4, background:U.surface, border:`1px solid ${U.border}`, borderRadius:10, padding:3 }}>
          {[['dark', 'Oscuro', 'eye-off'], ['light', 'Claro', 'eye']].map(opt => {
            const on = tema === opt[0];
            return (
              <button key={opt[0]} onClick={() => setTemaP(opt[0])}
                style={{ border:'none', cursor:'pointer', borderRadius:8, padding:'6px 12px', fontSize:11.5, fontWeight:700,
                  display:'inline-flex', alignItems:'center', gap:6,
                  background: on ? `linear-gradient(135deg, ${U.accent}, ${U.accent2})` : 'transparent',
                  color: on ? '#fff' : U.inkSoft }}>
                <Icon n={opt[2]} s={13} c={on ? '#fff' : U.inkMuted}/> {opt[1]}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ display:'flex', gap:7, marginBottom:22, flexWrap:'wrap' }}>
        {TABS.map(t => {
          const on = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ border:`1px solid ${on ? U.borderHi : U.border}`, cursor:'pointer', borderRadius:11,
                padding:'10px 16px', display:'inline-flex', alignItems:'center', gap:8, fontSize:13, fontWeight: on ? 800 : 600,
                color: on ? '#fff' : U.inkSoft,
                background: on ? `linear-gradient(135deg, ${U.accent}, ${U.accent2})` : U.surface,
                boxShadow: on ? `0 6px 20px ${U.accent}44` : 'none', transition:'all .15s ease' }}>
              <Icon n={t.icon} s={15} c={on ? '#fff' : U.inkMuted}/> {t.label}
            </button>
          );
        })}
      </div>
      {tab === 'dashboard' ? <MktDashboard U={U}/> :
       tab === 'calendario' ? <MktCalendario U={U}/> :
       tab === 'angulos' ? <MktAngulos U={U}/> :
       tab === 'publicidad' ? <MktPublicidad U={U}/> :
       <MktPrioridades U={U}/>}
    </div>
  );
}

window.MarketingPage = MarketingPage;
