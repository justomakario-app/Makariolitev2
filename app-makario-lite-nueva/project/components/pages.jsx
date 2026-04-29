/* ══ PAGES — QR / Histórico / Catálogo / Equipo / Notif / Config ══ */

/* ── QR Scanner ── */
function QRPage() {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [last, setLast] = useState([
    { code:'ML-8203 · MAD303', cliente:'Martín L.', sku:'MAD303', t:'09:24' },
    { code:'ML-8201 · MAD201', cliente:'Carlos R.', sku:'MAD201', t:'09:18' },
    { code:'ML-8205 · MAD095', cliente:'Diego C.',  sku:'MAD095', t:'09:11' },
  ]);
  const ref = useRef();
  const [usingCam, setUsingCam] = useState(false);

  useEffect(() => { ref.current?.focus(); }, []);

  const submit = e => {
    e.preventDefault();
    if (!code.trim()) return;
    const now = new Date();
    const t = now.toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit'});
    setLast([{ code, cliente:'—', sku:'detectado', t }, ...last]);
    setCode('');
    toast.success(`Embalado · ${code}`);
    ref.current?.focus();
  };

  const simulateCam = () => {
    setUsingCam(true);
    setTimeout(() => {
      setUsingCam(false);
      const skus = Object.keys(window.SKU_DB);
      const s = skus[Math.floor(Math.random()*skus.length)];
      setCode(`ML-${8200+Math.floor(Math.random()*99)} · ${s}`);
      toast.success(`QR detectado: ${s}`);
    }, 1500);
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Scanner QR</div>
          <div className="page-sub">Escaneá la etiqueta para confirmar embalado</div>
        </div>
      </div>

      <div className="card" style={{padding:32, textAlign:'center'}}>
        <div style={{margin:'0 auto 18px', width:80, height:80, background:'var(--paper-dim)', display:'flex', alignItems:'center', justifyContent:'center', borderRadius:8, position:'relative'}}>
          <Icon n="qr" s={42} c="var(--ink)"/>
          <div style={{position:'absolute', inset:0, border:'2px dashed var(--blue)', borderRadius:8, animation:'pulseDot 2s infinite'}}/>
        </div>
        <div style={{fontSize:14, fontWeight:700, marginBottom:4}}>Listo para escanear</div>
        <div style={{fontSize:12, color:'var(--ink-muted)', marginBottom:18}}>Apuntá la pistola QR o usá la cámara</div>
        <form onSubmit={submit} style={{maxWidth:380, margin:'0 auto', display:'flex', gap:8}}>
          <input
            ref={ref}
            className="qr-input"
            placeholder="ML-XXXX-..."
            value={code}
            onChange={e => setCode(e.target.value)}
            style={{flex:1}}
          />
          <button type="button" className="btn-ghost" onClick={simulateCam} disabled={usingCam} style={{padding:'12px 14px'}}>
            {usingCam ? <span className="loader"/> : <Icon n="camera" s={16}/>}
          </button>
        </form>
      </div>

      <div className="card" style={{marginTop:14}}>
        <div className="card-header">
          <div className="card-title">Embalados recientes</div>
        </div>
        <table className="data-table">
          <thead><tr><th>Hora</th><th>Código</th><th>Producto</th><th>Cliente</th></tr></thead>
          <tbody>
            {last.slice(0,8).map((r,i) => (
              <tr key={i}>
                <td style={{fontFamily:'var(--mono)', fontSize:11, color:'var(--ink-muted)'}}>{r.t}</td>
                <td><span className="order-num">{r.code}</span></td>
                <td style={{fontSize:11, color:'var(--ink-soft)'}}>{r.sku !== 'detectado' ? window.skuName(r.sku) : 'Detectado'}</td>
                <td style={{color:'var(--ink-soft)'}}>{r.cliente}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Histórico (calendario mensual) con filtros ── */
function HistoricoPage() {
  const toast = useToast();
  const M = window.MOCK;
  const H = M.historico;
  const [month, setMonth] = useState(H.month);
  const [year, setYear]   = useState(H.year);
  const [canal, setCanal] = useState('todos');
  const [skuF, setSkuF]   = useState('todos');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [selDay, setSelDay] = useState(null);

  const days = [];
  const first = new Date(year, month, 1);
  const startW = first.getDay() === 0 ? 6 : first.getDay() - 1;
  const last = new Date(year, month + 1, 0).getDate();
  for (let i = 0; i < startW; i++) days.push(null);
  for (let d = 1; d <= last; d++) {
    const k = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    days.push({ d, key:k, prod: H.days[k] || 0 });
  }

  const monthName = new Date(year, month, 1).toLocaleDateString('es-AR', {month:'long', year:'numeric'});
  const detalleLogs = selDay ? M.prodLogs.filter(l => l.fecha === selDay) : [];

  const skus = Object.keys(window.SKU_DB);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Histórico de producción</div>
          <div className="page-sub">Vista mensual · clic en un día para ver detalle</div>
        </div>
        <button className="btn-ghost" onClick={() => toast.info('Generando reporte...')}>
          <Icon n="download" s={13}/> Exportar
        </button>
      </div>

      {/* Filtros */}
      <div className="filter-bar">
        <select className="filter-select" value={canal} onChange={e => setCanal(e.target.value)}>
          <option value="todos">Todos los canales</option>
          <option value="colecta">Colecta</option>
          <option value="flex">Flex</option>
          <option value="tiendanube">Tienda Nube</option>
          <option value="distribuidor">Distribuidor</option>
        </select>
        <select className="filter-select" value={skuF} onChange={e => setSkuF(e.target.value)}>
          <option value="todos">Todos los SKU</option>
          {skus.map(s => <option key={s} value={s}>{s} — {window.SKU_DB[s].modelo}</option>)}
        </select>
        <input type="date" className="filter-select" value={desde} onChange={e => setDesde(e.target.value)} placeholder="Desde"/>
        <input type="date" className="filter-select" value={hasta} onChange={e => setHasta(e.target.value)} placeholder="Hasta"/>
      </div>

      <div className="kpi-grid">
        <div className="stat-card">
          <div style={{fontSize:9, fontWeight:700, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--ink-muted)', marginBottom:6}}>Total mes</div>
          <div style={{fontFamily:'var(--mono)', fontSize:32, fontWeight:700, letterSpacing:'-.04em', lineHeight:1}}>{H.kpis.total}</div>
          <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:6, fontWeight:500}}>unidades producidas</div>
        </div>
        <div className="stat-card">
          <div style={{fontSize:9, fontWeight:700, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--ink-muted)', marginBottom:6}}>Días activos</div>
          <div style={{fontFamily:'var(--mono)', fontSize:32, fontWeight:700, letterSpacing:'-.04em', lineHeight:1}}>{H.kpis.diasActivos}</div>
          <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:6, fontWeight:500}}>con producción</div>
        </div>
        <div className="stat-card">
          <div style={{fontSize:9, fontWeight:700, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--ink-muted)', marginBottom:6}}>Promedio/día</div>
          <div style={{fontFamily:'var(--mono)', fontSize:32, fontWeight:700, letterSpacing:'-.04em', lineHeight:1}}>{Math.round(H.kpis.total / H.kpis.diasActivos)}</div>
          <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:6, fontWeight:500}}>uds. promedio</div>
        </div>
        <div className="stat-card">
          <div style={{fontSize:9, fontWeight:700, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--ink-muted)', marginBottom:6}}>Mejor día</div>
          <div style={{fontFamily:'var(--mono)', fontSize:32, fontWeight:700, letterSpacing:'-.04em', lineHeight:1}}>{Math.max(...Object.values(H.days))}</div>
          <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:6, fontWeight:500}}>uds. en un día</div>
        </div>
      </div>

      <div className="card" style={{marginTop:14}}>
        <div className="card-header">
          <div className="card-title" style={{textTransform:'capitalize'}}>{monthName}</div>
          <div style={{display:'flex', gap:6}}>
            <button className="btn-ghost" style={{padding:'5px 10px'}} onClick={() => setMonth(m => m === 0 ? (setYear(y=>y-1), 11) : m-1)}><Icon n="arrow-left" s={12}/></button>
            <button className="btn-ghost" style={{padding:'5px 10px'}} onClick={() => setMonth(m => m === 11 ? (setYear(y=>y+1), 0) : m+1)}><Icon n="arrow-right" s={12}/></button>
          </div>
        </div>
        <div style={{padding:'18px 22px 22px'}}>
          <div className="cal-grid">
            {['LUN','MAR','MIÉ','JUE','VIE','SÁB','DOM'].map(w => <div key={w} className="cal-header-cell">{w}</div>)}
            {days.map((d, i) => d === null ? (
              <div key={`e-${i}`} className="cal-day empty"/>
            ) : d.prod > 0 ? (
              <div key={d.d} className={`cal-day has-prod ${selDay===d.key?'sel':''}`} onClick={() => setSelDay(d.key)} style={{cursor:'pointer'}}>
                <span className="cal-day-num">{d.d}</span>
                <span className="cal-day-units">{d.prod}</span>
              </div>
            ) : (
              <div key={d.d} className="cal-day"><span className="cal-day-num">{d.d}</span></div>
            ))}
          </div>
        </div>
      </div>

      {/* Detalle del día seleccionado */}
      {selDay && (
        <div className="card" style={{marginTop:14}}>
          <div className="card-header">
            <div className="card-title">Detalle del {selDay}</div>
            <button className="btn-ghost" style={{padding:'5px 10px', fontSize:10}} onClick={() => setSelDay(null)}>
              <Icon n="x" s={11}/> Cerrar
            </button>
          </div>
          {detalleLogs.length === 0 ? (
            <div className="empty" style={{padding:32}}>
              <Icon n="package" s={26} c="var(--ink-faint)"/>
              <div style={{fontSize:12, color:'var(--ink-muted)'}}>Sin registros para este día</div>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr><th>Hora</th><th>SKU</th><th>Producto</th><th>Canal</th><th>Sector</th><th style={{textAlign:'right'}}>Uds.</th><th>Operario</th></tr>
              </thead>
              <tbody>
                {detalleLogs.map(l => (
                  <tr key={l.id}>
                    <td style={{fontFamily:'var(--mono)', fontSize:11, color:'var(--ink-muted)'}}>{l.hora}</td>
                    <td><span className="order-num">{l.sku}</span></td>
                    <td style={{fontSize:11, color:'var(--ink-soft)'}}>{window.skuName(l.sku)}</td>
                    <td style={{fontSize:11, textTransform:'capitalize'}}>{l.subcanal}</td>
                    <td style={{fontSize:11, color:'var(--ink-soft)'}}>{l.sector}</td>
                    <td style={{textAlign:'right'}}><span className="cell-color-num">{l.unidades}</span></td>
                    <td style={{fontSize:11, color:'var(--ink-soft)'}}>{l.operario}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Catálogo desde SKU_DB ── */
function CatalogoPage() {
  const toast = useToast();
  const [filter, setFilter] = useState('');
  const [cat, setCat] = useState('todas');
  const [showQR, setShowQR] = useState(false);
  const [editing, setEditing] = useState(null); // {sku, isNew}
  const [, forceUpdate] = useState(0);

  const skus = Object.keys(window.SKU_DB);
  const cats = [...new Set(skus.map(s => window.SKU_DB[s].categoria))];

  const filtered = skus.filter(s => {
    const c = window.SKU_DB[s];
    if (cat !== 'todas' && c.categoria !== cat) return false;
    if (filter) {
      const q = filter.toLowerCase();
      if (!c.modelo.toLowerCase().includes(q) && !s.toLowerCase().includes(q) && !(c.color||'').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const onSave = (sku, data, isNew) => {
    if (isNew) {
      if (window.SKU_DB[sku]) { toast.error(`SKU ${sku} ya existe`); return false; }
      window.SKU_DB[sku] = data;
      toast.success(`SKU ${sku} creado`);
    } else {
      window.SKU_DB[sku] = data;
      toast.success(`SKU ${sku} actualizado`);
    }
    setEditing(null);
    forceUpdate(n => n+1);
    return true;
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Catálogo</div>
          <div className="page-sub">{skus.length} SKUs · {skus.filter(s => window.SKU_DB[s].es_fabricado).length} fabricados</div>
        </div>
        <div style={{display:'flex', gap:8}}>
          <button className="btn-ghost" onClick={() => setShowQR(true)}><Icon n="qr" s={13}/> Generar QR</button>
          <button className="btn-primary" onClick={() => setEditing({sku:'', isNew:true})}>
            <Icon n="plus" s={13}/> Nuevo producto
          </button>
        </div>
      </div>

      <div className="filter-bar">
        <div>
          <Icon n="search" s={14} c="var(--ink-muted)"/>
          <input className="filter-input" placeholder="Buscar SKU, modelo o color..." value={filter} onChange={e => setFilter(e.target.value)} style={{paddingLeft:30, minWidth:240}}/>
        </div>
        <select className="filter-select" value={cat} onChange={e => setCat(e.target.value)}>
          <option value="todas">Todas las categorías</option>
          {cats.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="card">
        <table className="data-table">
          <thead><tr><th>SKU</th><th>Modelo</th><th>Color</th><th>Categoría</th><th>Tipo</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {filtered.map(s => {
              const c = window.SKU_DB[s];
              return (
                <tr key={s}>
                  <td><span className="order-num">{s}</span></td>
                  <td style={{fontWeight:600}}>{c.modelo}</td>
                  <td>
                    {c.color && c.color !== '—' ? (
                      <span style={{display:'inline-flex', alignItems:'center', gap:6, fontSize:11, fontWeight:600}}>
                        <span style={{width:10, height:10, borderRadius:'50%', background: c.colorHex || (c.color==='Negro'?'#1a1a1a':c.color==='Blanco'?'#fff':'#888'), border:'1px solid #d4cdc1', display:'inline-block'}}/>
                        {c.color}
                      </span>
                    ) : <span style={{color:'var(--ink-faint)'}}>—</span>}
                  </td>
                  <td><span style={{fontSize:11, fontWeight:600, color:'var(--ink-muted)'}}>{c.categoria}</span></td>
                  <td>{c.es_fabricado ? <span style={{fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:10, background:'var(--green-bg)', color:'var(--green)'}}>FABRICADO</span> : <span style={{fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:10, background:'var(--paper-dim)', color:'var(--ink-muted)'}}>REVENTA</span>}</td>
                  <td>{c.activo ? <span style={{display:'inline-flex', alignItems:'center', gap:5, fontSize:11, color:'var(--green)'}}><span style={{width:6, height:6, borderRadius:'50%', background:'var(--green)'}}/>Activo</span> : <span style={{fontSize:11, color:'var(--ink-muted)'}}>Inactivo</span>}</td>
                  <td style={{textAlign:'right', width:1, whiteSpace:'nowrap'}}>
                    <button className="btn-ghost" style={{padding:'5px 10px', fontSize:10, marginRight:4}} onClick={() => setEditing({sku:s, isNew:false})}><Icon n="edit" s={11}/> Editar</button>
                    <button className="btn-ghost" style={{padding:'5px 10px', fontSize:10}} onClick={() => toast.info(`QR ${s} generado`)}><Icon n="qr" s={11}/> QR</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modal Editar / Crear */}
      {editing && (
        <ProductoEditModal
          editing={editing}
          onClose={() => setEditing(null)}
          onSave={onSave}
          cats={cats}
        />
      )}

      {/* Modal QR genérico */}
      {showQR && (
        <Modal open={showQR} onClose={() => setShowQR(false)} title="Generar QRs del catálogo" footer={
          <>
            <button className="btn-ghost" onClick={() => setShowQR(false)}>Cerrar</button>
            <button className="btn-primary" onClick={() => { toast.success('PDF generado · ' + filtered.length + ' QRs'); setShowQR(false); }}>
              <Icon n="download" s={14}/> Descargar PDF
            </button>
          </>
        }>
          <div style={{fontSize:12, color:'var(--ink-soft)', lineHeight:1.7}}>
            Vamos a generar un PDF con <strong>{filtered.length} códigos QR</strong> (uno por SKU filtrado), listos para imprimir y pegar en cada caja.
          </div>
          <div style={{marginTop:14, padding:14, background:'var(--paper-off)', border:'1px solid var(--border)', borderRadius:6, fontSize:11, color:'var(--ink-muted)'}}>
            Cada QR codifica el SKU. Al escanearlo en producción o embalaje, el sistema resuelve modelo, color y variante automáticamente.
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ── Modal Editar/Crear producto ── */
function ProductoEditModal({ editing, onClose, onSave, cats }) {
  const toast = useToast();
  const existing = !editing.isNew ? window.SKU_DB[editing.sku] : null;
  const [sku, setSku]       = useState(editing.sku || '');
  const [modelo, setModelo] = useState(existing?.modelo || '');
  const [color, setColor]   = useState(existing?.color || '');
  const [colorHex, setColorHex] = useState(existing?.colorHex || (existing?.color==='Negro'?'#1a1a1a':existing?.color==='Blanco'?'#ffffff':'#cccccc'));
  const [categoria, setCategoria] = useState(existing?.categoria || cats[0] || 'Mesas');
  const [esFab, setEsFab]   = useState(existing?.es_fabricado ?? true);
  const [activo, setActivo] = useState(existing?.activo ?? true);
  const [nuevaCat, setNuevaCat] = useState(false);
  const [catCustom, setCatCustom] = useState('');

  const submit = () => {
    if (!sku.trim()) { toast.error('Falta SKU'); return; }
    if (!modelo.trim()) { toast.error('Falta nombre del modelo'); return; }
    const finalCat = nuevaCat ? catCustom.trim() : categoria;
    if (!finalCat) { toast.error('Falta categoría'); return; }
    const data = {
      modelo: modelo.trim(),
      color: color.trim() || '—',
      colorHex: color.trim() && color.trim() !== '—' ? colorHex : null,
      categoria: finalCat,
      es_fabricado: esFab,
      activo,
    };
    onSave(sku.trim().toUpperCase(), data, editing.isNew);
  };

  const PRESETS = [
    {n:'Blanco', h:'#ffffff'},
    {n:'Negro',  h:'#1a1a1a'},
    {n:'Natural', h:'#d4a574'},
    {n:'Roble',  h:'#8b6f47'},
    {n:'Nogal',  h:'#5c3a21'},
    {n:'Gris',   h:'#888888'},
  ];

  return (
    <Modal open={true} onClose={onClose} title={editing.isNew ? 'Nuevo producto' : `Editar ${editing.sku}`} size="lg" footer={
      <>
        <button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" onClick={submit}>
          <Icon n="check" s={14}/> {editing.isNew ? 'Crear producto' : 'Guardar cambios'}
        </button>
      </>
    }>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
        <div>
          <label className="field-label">SKU</label>
          <input className="field-input" value={sku} onChange={e => setSku(e.target.value)} disabled={!editing.isNew} placeholder="Ej: MAD500" style={{fontFamily:'var(--mono)', textTransform:'uppercase'}}/>
          {!editing.isNew && <div style={{fontSize:10, color:'var(--ink-muted)', marginTop:4}}>El SKU no se puede cambiar después de creado.</div>}
        </div>
        <div>
          <label className="field-label">Categoría</label>
          {!nuevaCat ? (
            <div style={{display:'flex', gap:6}}>
              <select className="field-input" value={categoria} onChange={e => setCategoria(e.target.value)} style={{flex:1}}>
                {cats.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <button type="button" className="btn-ghost" style={{padding:'8px 10px', fontSize:10}} onClick={() => setNuevaCat(true)} title="Nueva categoría">
                <Icon n="plus" s={12}/>
              </button>
            </div>
          ) : (
            <div style={{display:'flex', gap:6}}>
              <input className="field-input" value={catCustom} onChange={e => setCatCustom(e.target.value)} placeholder="Nueva categoría..." style={{flex:1}}/>
              <button type="button" className="btn-ghost" style={{padding:'8px 10px', fontSize:10}} onClick={() => setNuevaCat(false)}>
                <Icon n="x" s={12}/>
              </button>
            </div>
          )}
        </div>
      </div>

      <div style={{marginTop:14}}>
        <label className="field-label">Nombre del modelo</label>
        <input className="field-input" value={modelo} onChange={e => setModelo(e.target.value)} placeholder="Ej: Mesa Nórdica Redonda 50cm"/>
      </div>

      {/* Color libre */}
      <div style={{marginTop:14}}>
        <label className="field-label">Color / variante</label>
        <div style={{display:'flex', gap:8, alignItems:'center', marginBottom:10}}>
          <input className="field-input" value={color} onChange={e => setColor(e.target.value)} placeholder="Ej: Blanco, Negro, Natural, Beige..." style={{flex:1}}/>
          <input type="color" value={colorHex} onChange={e => setColorHex(e.target.value)} style={{width:48, height:38, border:'1px solid var(--border)', borderRadius:4, padding:2, cursor:'pointer', background:'#fff'}}/>
        </div>
        <div style={{display:'flex', flexWrap:'wrap', gap:5}}>
          <span style={{fontSize:10, fontWeight:700, color:'var(--ink-muted)', textTransform:'uppercase', letterSpacing:'.08em', alignSelf:'center', marginRight:4}}>Atajos:</span>
          {PRESETS.map(p => (
            <button key={p.n} type="button" onClick={() => { setColor(p.n); setColorHex(p.h); }} style={{
              display:'flex', alignItems:'center', gap:5, padding:'3px 8px', fontSize:10, fontWeight:600,
              background: color===p.n?'var(--ink)':'var(--paper-off)', color: color===p.n?'#fff':'var(--ink-soft)',
              border:'1px solid var(--border)', borderRadius:10, cursor:'pointer'
            }}>
              <span style={{width:9, height:9, borderRadius:'50%', background:p.h, border:'1px solid #d4cdc1'}}/>
              {p.n}
            </button>
          ))}
        </div>
        <div style={{fontSize:10, color:'var(--ink-muted)', marginTop:6}}>Dejar vacío si el producto no tiene variantes de color.</div>
      </div>

      {/* Toggles */}
      <div style={{marginTop:18, display:'flex', gap:24}}>
        <label style={{display:'flex', alignItems:'center', gap:8, fontSize:12, fontWeight:600, cursor:'pointer'}}>
          <input type="checkbox" checked={esFab} onChange={e => setEsFab(e.target.checked)}/>
          Producto fabricado
        </label>
        <label style={{display:'flex', alignItems:'center', gap:8, fontSize:12, fontWeight:600, cursor:'pointer'}}>
          <input type="checkbox" checked={activo} onChange={e => setActivo(e.target.checked)}/>
          Activo en catálogo
        </label>
      </div>
    </Modal>
  );
}

/* ── Equipo ── */
const ROLE_COLOR = {
  owner:'#0a0a0a', admin:'#7c3aed', encargado:'#2563eb',
  embalaje:'#16a34a', cnc:'#d97706', melamina:'#0891b2',
  pino:'#92400e', logistica:'#6366f1', ventas:'#db2777',
  carpinteria:'#a16207', marketing:'#0d9488',
};

function EquipoPage() {
  const M = window.MOCK;
  const toast = useToast();
  const [, refresh] = useState(0);
  const [editing, setEditing] = useState(null); // {user, isNew}
  const [filter, setFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('todos');

  const onSave = (original, data, isNew) => {
    if (isNew) {
      if (M.users.some(u => u.username === data.username)) { toast.error(`@${data.username} ya existe`); return; }
      M.users.push({ ...data, active: true });
      toast.success(`${data.name} agregado al equipo`);
    } else {
      const i = M.users.findIndex(u => u.username === original.username);
      if (i >= 0) M.users[i] = { ...M.users[i], ...data };
      toast.success(`${data.name} actualizado`);
    }
    setEditing(null);
    refresh(n => n+1);
  };

  const onToggleActive = (u) => {
    u.active = !u.active;
    toast.info(`${u.name} ${u.active ? 'reactivado' : 'desactivado'}`);
    refresh(n => n+1);
  };

  const onRemove = (u) => {
    if (!confirm(`¿Eliminar a ${u.name} del equipo? No se puede deshacer.`)) return;
    const i = M.users.findIndex(x => x.username === u.username);
    if (i >= 0) M.users.splice(i, 1);
    toast.success(`${u.name} eliminado`);
    refresh(n => n+1);
  };

  const filtered = M.users.filter(u => {
    if (roleFilter !== 'todos' && u.role !== roleFilter) return false;
    if (filter) {
      const q = filter.toLowerCase();
      if (!u.name.toLowerCase().includes(q) && !u.username.toLowerCase().includes(q) && !(u.area||'').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Equipo</div>
          <div className="page-sub">{M.users.filter(u=>u.active).length} activos · {M.users.length} en total</div>
        </div>
        <button className="btn-primary" onClick={() => setEditing({ user:null, isNew:true })}><Icon n="plus" s={13}/> Invitar usuario</button>
      </div>

      <div className="filter-bar">
        <div>
          <Icon n="search" s={14} c="var(--ink-muted)"/>
          <input className="filter-input" placeholder="Buscar nombre, usuario o área..." value={filter} onChange={e => setFilter(e.target.value)} style={{paddingLeft:30, minWidth:240}}/>
        </div>
        <select className="filter-select" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
          <option value="todos">Todos los roles</option>
          {Object.keys(M.RL).map(r => <option key={r} value={r}>{M.RL[r]}</option>)}
        </select>
      </div>

      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(300px, 1fr))', gap:12}}>
        {filtered.map(u => {
          const c = ROLE_COLOR[u.role] || '#888';
          const initials = u.name.split(' ').map(s=>s[0]).join('').slice(0,2).toUpperCase();
          return (
            <div key={u.username} className="card" style={{padding:18, display:'flex', gap:14, alignItems:'center', opacity: u.active ? 1 : 0.55}}>
              <div style={{width:44, height:44, background:c, color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, fontWeight:800, borderRadius:6, flexShrink:0}}>{initials}</div>
              <div style={{flex:1, minWidth:0}}>
                <div style={{display:'flex', alignItems:'center', gap:6}}>
                  <div style={{fontSize:14, fontWeight:700}}>{u.name}</div>
                  {!u.active && <span style={{fontSize:9, fontWeight:700, padding:'1px 6px', borderRadius:8, background:'var(--paper-dim)', color:'var(--ink-muted)', textTransform:'uppercase'}}>Inactivo</span>}
                </div>
                <div style={{fontSize:11, color:'var(--ink-muted)', fontFamily:'var(--mono)'}}>@{u.username}{u.area ? ' · ' + u.area : ''}</div>
                <div style={{marginTop:6, display:'inline-flex', alignItems:'center', gap:5, fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', padding:'2px 8px', borderRadius:10, background:`${c}1a`, color:c}}>
                  {M.RL[u.role] || u.role}
                </div>
              </div>
              <div style={{display:'flex', flexDirection:'column', gap:4}}>
                <button className="btn-ghost" style={{padding:'4px 8px', fontSize:10}} onClick={() => setEditing({ user:u, isNew:false })} title="Editar"><Icon n="edit" s={11}/></button>
                <button className="btn-ghost" style={{padding:'4px 8px', fontSize:10}} onClick={() => onToggleActive(u)} title={u.active?'Desactivar':'Reactivar'}>
                  <Icon n={u.active?'x':'check'} s={11}/>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {editing && (
        <UsuarioEditModal
          editing={editing}
          onClose={() => setEditing(null)}
          onSave={onSave}
          onRemove={onRemove}
        />
      )}
    </div>
  );
}

/* ── Modal Editar/Invitar usuario ── */
function genTempPassword() {
  const adj = ['Pino','Roble','Mesa','Banco','Cubo','Tabla','Hoja','Nube'];
  const num = Math.floor(100 + Math.random() * 900);
  return adj[Math.floor(Math.random()*adj.length)] + num + '!';
}

function UsuarioEditModal({ editing, onClose, onSave, onRemove }) {
  const M = window.MOCK;
  const toast = useToast();
  const u = editing.user;
  const [name, setName]         = useState(u?.name || '');
  const [username, setUsername] = useState(u?.username || '');
  const [role, setRole]         = useState(u?.role || 'embalaje');
  const [area, setArea]         = useState(u?.area || '');

  // Contraseña — modos: generada automática vs manual
  const [pwMode, setPwMode]     = useState('auto'); // 'auto' | 'manual'
  const [password, setPassword] = useState(editing.isNew ? genTempPassword() : '');
  const [pwVisible, setPwVisible] = useState(true);

  // Reset password (solo edición)
  const [resetPw, setResetPw]   = useState(false);
  const [newPassword, setNewPassword] = useState('');

  const regen = () => setPassword(genTempPassword());

  const copy = (txt) => {
    if (navigator.clipboard) navigator.clipboard.writeText(txt);
    toast.success('Copiado al portapapeles');
  };

  const submit = () => {
    if (!name.trim()) { toast.error('Falta el nombre'); return; }
    if (!username.trim()) { toast.error('Falta el nombre de usuario'); return; }
    if (editing.isNew) {
      if (pwMode === 'manual' && password.length < 4) { toast.error('La contraseña debe tener al menos 4 caracteres'); return; }
    }
    if (!editing.isNew && resetPw && newPassword.length < 4) { toast.error('La nueva contraseña debe tener al menos 4 caracteres'); return; }

    onSave(u, {
      name: name.trim(),
      username: username.trim().toLowerCase().replace(/\s+/g,''),
      role,
      area: area.trim() || M.RL[role] || '',
      password: editing.isNew ? password : (resetPw ? newPassword : u?.password),
    }, editing.isNew);
  };

  const remove = () => {
    onClose();
    onRemove(u);
  };

  return (
    <Modal open={true} onClose={onClose} title={editing.isNew ? 'Invitar usuario' : `Editar @${u.username}`} size="md" footer={
      <>
        {!editing.isNew && (
          <button className="btn-ghost" onClick={remove} style={{color:'var(--red)', marginRight:'auto'}}>
            <Icon n="trash" s={13}/> Eliminar
          </button>
        )}
        <button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" onClick={submit}>
          <Icon n="check" s={14}/> {editing.isNew ? 'Invitar' : 'Guardar'}
        </button>
      </>
    }>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
        <div>
          <label className="field-label">Nombre completo</label>
          <input className="field-input" value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Juan Pérez"/>
        </div>
        <div>
          <label className="field-label">Usuario</label>
          <input className="field-input" value={username} onChange={e => setUsername(e.target.value)} disabled={!editing.isNew} placeholder="juan" style={{fontFamily:'var(--mono)'}}/>
          {!editing.isNew && <div style={{fontSize:10, color:'var(--ink-muted)', marginTop:4}}>El usuario no se puede cambiar.</div>}
        </div>
      </div>

      <div style={{marginTop:14}}>
        <label className="field-label">Rol</label>
        <select className="field-input" value={role} onChange={e => setRole(e.target.value)}>
          {Object.keys(M.RL).map(r => <option key={r} value={r}>{M.RL[r]}</option>)}
        </select>
        <div style={{fontSize:10, color:'var(--ink-muted)', marginTop:4}}>El rol determina qué secciones ve este usuario al iniciar sesión.</div>
      </div>

      <div style={{marginTop:14}}>
        <label className="field-label">Área / Sector (opcional)</label>
        <input className="field-input" value={area} onChange={e => setArea(e.target.value)} placeholder="Ej: Producción, Embalaje, Logística..."/>
      </div>

      {/* Contraseña — solo en alta */}
      {editing.isNew && (
        <div style={{marginTop:18, padding:14, background:'var(--paper-off)', border:'1px solid var(--border)', borderRadius:6}}>
          <div style={{fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.08em', color:'var(--ink-muted)', marginBottom:10}}>Contraseña inicial</div>

          <div style={{display:'flex', gap:6, marginBottom:10}}>
            <button type="button" onClick={() => setPwMode('auto')} style={{
              flex:1, padding:'8px 10px', fontSize:11, fontWeight:600, cursor:'pointer',
              background: pwMode==='auto'?'var(--ink)':'var(--paper)',
              color: pwMode==='auto'?'#fff':'var(--ink-soft)',
              border:'1px solid var(--border)', borderRadius:4,
            }}>Generar automática</button>
            <button type="button" onClick={() => { setPwMode('manual'); setPassword(''); }} style={{
              flex:1, padding:'8px 10px', fontSize:11, fontWeight:600, cursor:'pointer',
              background: pwMode==='manual'?'var(--ink)':'var(--paper)',
              color: pwMode==='manual'?'#fff':'var(--ink-soft)',
              border:'1px solid var(--border)', borderRadius:4,
            }}>Definir manual</button>
          </div>

          <div style={{display:'flex', gap:6}}>
            <div style={{flex:1, position:'relative'}}>
              <input
                className="field-input"
                type={pwVisible?'text':'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={pwMode==='manual'?'Mínimo 4 caracteres':''}
                style={{fontFamily:'var(--mono)', fontSize:13, fontWeight:600, paddingRight:36}}
                readOnly={pwMode==='auto'}
              />
              <button type="button" onClick={() => setPwVisible(v=>!v)} style={{
                position:'absolute', right:6, top:'50%', transform:'translateY(-50%)',
                padding:6, background:'transparent', border:'none', cursor:'pointer', color:'var(--ink-muted)',
              }} title={pwVisible?'Ocultar':'Mostrar'}>
                <Icon n={pwVisible?'eye-off':'eye'} s={14}/>
              </button>
            </div>
            {pwMode === 'auto' && (
              <button type="button" className="btn-ghost" onClick={regen} style={{padding:'8px 12px'}} title="Regenerar">
                <Icon n="refresh" s={14}/>
              </button>
            )}
            <button type="button" className="btn-ghost" onClick={() => copy(password)} style={{padding:'8px 12px'}} title="Copiar" disabled={!password}>
              <Icon n="copy" s={14}/>
            </button>
          </div>

          <div style={{marginTop:10, fontSize:10, color:'var(--ink-muted)', lineHeight:1.6}}>
            {pwMode === 'auto'
              ? 'Se generó una contraseña fácil de recordar. Compartila con el usuario por WhatsApp o en persona — la podrá cambiar al ingresar.'
              : 'Definí una contraseña simple. El usuario la podrá cambiar después desde su perfil.'}
          </div>
        </div>
      )}

      {/* Reset password — solo en edición */}
      {!editing.isNew && (
        <div style={{marginTop:18, padding:14, background:'var(--paper-off)', border:'1px solid var(--border)', borderRadius:6}}>
          {!resetPw ? (
            <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:12}}>
              <div>
                <div style={{fontSize:12, fontWeight:700, marginBottom:3}}>Contraseña</div>
                <div style={{fontSize:11, color:'var(--ink-muted)'}}>El usuario puede cambiarla desde su perfil. ¿Olvidó la contraseña?</div>
              </div>
              <button type="button" className="btn-ghost" onClick={() => { setResetPw(true); setNewPassword(genTempPassword()); }}>
                <Icon n="refresh" s={13}/> Resetear
              </button>
            </div>
          ) : (
            <>
              <div style={{fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.08em', color:'var(--ink-muted)', marginBottom:10}}>Nueva contraseña</div>
              <div style={{display:'flex', gap:6}}>
                <input
                  className="field-input"
                  type="text"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  style={{fontFamily:'var(--mono)', fontSize:13, fontWeight:600, flex:1}}
                />
                <button type="button" className="btn-ghost" onClick={() => setNewPassword(genTempPassword())} style={{padding:'8px 12px'}} title="Regenerar">
                  <Icon n="refresh" s={14}/>
                </button>
                <button type="button" className="btn-ghost" onClick={() => copy(newPassword)} style={{padding:'8px 12px'}} title="Copiar">
                  <Icon n="copy" s={14}/>
                </button>
                <button type="button" className="btn-ghost" onClick={() => setResetPw(false)} style={{padding:'8px 12px'}} title="Cancelar">
                  <Icon n="x" s={14}/>
                </button>
              </div>
              <div style={{marginTop:8, fontSize:10, color:'var(--amber)', fontWeight:600}}>
                ⚠ Al guardar, la contraseña actual deja de funcionar. Compartí la nueva con el usuario.
              </div>
            </>
          )}
        </div>
      )}

      {editing.isNew && (
        <div style={{marginTop:14, padding:12, background:'var(--blue-bg)', border:'1px solid var(--blue-border)', borderRadius:6, fontSize:11, color:'var(--ink-soft)', lineHeight:1.6}}>
          <strong>Tip:</strong> al guardar, podés copiar usuario + contraseña con un click para enviárselos al usuario.
        </div>
      )}
    </Modal>
  );
}

/* ── Notificaciones ── */
function NotificacionesPage() {
  const M = window.MOCK;
  const [items, setItems] = useState(M.notifications);
  const ICONS = { stock_critico:'alert', pedido_urgente:'flame', nuevo_pedido:'box', produccion:'tools', sistema:'info' };
  const COLORS = { stock_critico:'var(--red)', pedido_urgente:'var(--amber)', nuevo_pedido:'var(--blue)', produccion:'var(--green)', sistema:'var(--ink)' };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Notificaciones</div>
          <div className="page-sub">{items.filter(n=>!n.leida).length} sin leer · {items.length} en total</div>
        </div>
        <button className="btn-ghost" onClick={() => setItems(items.map(n => ({...n, leida:true})))}>
          <Icon n="check" s={13}/> Marcar todo como leído
        </button>
      </div>

      <div className="card">
        {items.map(n => (
          <div key={n.id} style={{
            display:'flex', gap:14, padding:'16px 22px', borderBottom:'1px solid var(--border)',
            background: n.leida ? 'var(--paper)' : 'var(--paper-off)',
          }}>
            <div style={{width:32, height:32, borderRadius:6, background:`${COLORS[n.tipo]}1a`, color:COLORS[n.tipo], display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0}}>
              <Icon n={ICONS[n.tipo]} s={16}/>
            </div>
            <div style={{flex:1, minWidth:0}}>
              <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:3}}>
                <div style={{fontSize:13, fontWeight: n.leida?500:700}}>{n.titulo}</div>
                {!n.leida && <span style={{width:7, height:7, borderRadius:'50%', background:COLORS[n.tipo]}}/>}
              </div>
              <div style={{fontSize:12, color:'var(--ink-soft)', marginBottom:4}}>{n.mensaje}</div>
              <div style={{fontSize:10, color:'var(--ink-muted)', fontWeight:600}}>{fmt.agoSimple(n.created_at)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Configuración ── */
function ConfigPage() {
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Configuración</div>
          <div className="page-sub">Ajustes del sistema</div>
        </div>
      </div>

      <div style={{display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:12}}>
        {[
          { i:'shield',   t:'Seguridad',     s:'Cambiar contraseña, sesiones activas' },
          { i:'bell',     t:'Notificaciones', s:'Preferencias y umbrales de alerta' },
          { i:'truck',    t:'Canales de venta', s:'Horarios de cierre, plantillas Excel' },
          { i:'settings', t:'Sistema',       s:'Backup, exportación, integración' },
        ].map(c => (
          <div key={c.t} className="card" style={{padding:20, display:'flex', gap:14, cursor:'pointer'}}>
            <div style={{width:40, height:40, background:'var(--paper-dim)', display:'flex', alignItems:'center', justifyContent:'center', borderRadius:6, flexShrink:0}}>
              <Icon n={c.i} s={18}/>
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:14, fontWeight:700, marginBottom:3}}>{c.t}</div>
              <div style={{fontSize:11, color:'var(--ink-muted)'}}>{c.s}</div>
            </div>
            <Icon n="chev-right" s={16} c="var(--ink-faint)"/>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { QRPage, HistoricoPage, CatalogoPage, EquipoPage, NotificacionesPage, ConfigPage });
