/* ══ MOBILE PAGES — Notificaciones / Perfil ══ */

function NotificacionesPage() {
  const M = window.useMockData();
  const items = M.notifications || [];
  const toast = useToast();
  const ICONS  = { stock_critico:'alert', pedido_urgente:'flame', nuevo_pedido:'box', produccion:'tools', sistema:'info' };
  const COLORS = { stock_critico:'var(--red)', pedido_urgente:'var(--amber)', nuevo_pedido:'var(--blue)', produccion:'var(--green)', sistema:'var(--ink)' };

  const marcarTodas = async () => {
    try { await window.MOCK_ACTIONS.marcarTodasLeidas(); toast.success('Marcadas como leídas'); }
    catch (e) { toast.error(e.message || 'Error'); }
  };

  return (
    <div className="m-page">
      <div className="m-page-header">
        <div style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:10}}>
          <div>
            <div className="m-page-title">Notificaciones</div>
            <div className="m-page-sub">{items.filter(n=>!n.leida).length} sin leer · {items.length} total</div>
          </div>
          {items.some(n=>!n.leida) && (
            <button className="btn-ghost" onClick={marcarTodas} style={{padding:'6px 10px', fontSize:10}}>
              <Icon n="check" s={11}/> Leer todo
            </button>
          )}
        </div>
      </div>

      <div style={{padding:'4px 16px 100px'}}>
        {items.length === 0 ? (
          <div className="m-empty">
            <Icon n="bell" s={32} c="var(--ink-faint)"/>
            <div style={{fontSize:13, fontWeight:700, marginTop:8}}>Sin notificaciones</div>
          </div>
        ) : items.map(n => (
          <div key={n.id} className="m-notif-card" style={{background: n.leida?'var(--paper)':'var(--paper-off)'}}>
            <div style={{width:34, height:34, borderRadius:6, background:`${COLORS[n.tipo]}1a`, color:COLORS[n.tipo], display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0}}>
              <Icon n={ICONS[n.tipo]} s={16}/>
            </div>
            <div style={{flex:1, minWidth:0}}>
              <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:2}}>
                <div style={{fontSize:13, fontWeight: n.leida?500:700}}>{n.titulo}</div>
                {!n.leida && <span style={{width:7, height:7, borderRadius:'50%', background:COLORS[n.tipo], flexShrink:0}}/>}
              </div>
              <div style={{fontSize:12, color:'var(--ink-soft)', lineHeight:1.4}}>{n.mensaje}</div>
              <div style={{fontSize:10, color:'var(--ink-muted)', fontWeight:600, marginTop:4}}>{fmt.agoSimple(n.created_at)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PerfilPage({ onLogout }) {
  const M = window.useMockData();
  const toast = useToast();
  const u = M.user;
  const initials = (u.name || '?').split(' ').map(s=>s[0]).join('').slice(0,2).toUpperCase();
  const ROLE_COLOR = {
    owner:'#0a0a0a', admin:'#7c3aed', encargado:'#2563eb',
    embalaje:'#16a34a', cnc:'#d97706', melamina:'#0891b2',
    pino:'#92400e', logistica:'#6366f1', ventas:'#db2777',
  };
  const c = ROLE_COLOR[u.role] || '#888';

  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);

  const submitPw = async () => {
    if (pw.length < 6)  { toast.error('Mínimo 6 caracteres'); return; }
    if (pw !== pw2)     { toast.error('Las contraseñas no coinciden'); return; }
    setBusy(true);
    try {
      const { error } = await window.SUPA.auth.updateUser({ password: pw });
      if (error) throw new Error(error.message);
      toast.success('Contraseña actualizada');
      setPwOpen(false); setPw(''); setPw2('');
    } catch (e) {
      toast.error(e.message || 'No se pudo cambiar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="m-page">
      <div className="m-page-header">
        <div className="m-page-title">Mi Perfil</div>
        <div className="m-page-sub">Tu información en el sistema</div>
      </div>

      <div style={{padding:'4px 16px 24px'}}>
        <div className="m-card" style={{padding:24, textAlign:'center'}}>
          <div style={{
            width:72, height:72, margin:'0 auto 14px',
            background:c, color:'#fff',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:24, fontWeight:800, borderRadius:8,
          }}>{initials}</div>
          <div style={{fontSize:18, fontWeight:800, letterSpacing:'-.01em'}}>{u.name}</div>
          <div style={{fontSize:12, color:'var(--ink-muted)', marginTop:3, fontFamily:'var(--mono)'}}>@{u.username}</div>
          <div style={{
            display:'inline-block', marginTop:10,
            padding:'3px 10px', borderRadius:10,
            background:`${c}1a`, color:c,
            fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.08em',
          }}>{u.roleLabel}</div>
        </div>

        <div className="m-card" style={{marginTop:14}}>
          <div className="m-card-header"><div className="m-card-title">Cuenta</div></div>
          <div style={{padding:14, fontSize:12, color:'var(--ink-soft)', lineHeight:1.7}}>
            <div><span style={{color:'var(--ink-muted)'}}>Email:</span> <span style={{fontFamily:'var(--mono)'}}>{u.email}</span></div>
            <div><span style={{color:'var(--ink-muted)'}}>Rol:</span> {u.roleLabel}</div>
          </div>
        </div>

        <button className="btn-ghost" style={{width:'100%', marginTop:14, padding:'12px', justifyContent:'center'}} onClick={() => setPwOpen(true)}>
          <Icon n="lock" s={14}/> Cambiar contraseña
        </button>

        <button className="btn-ghost" style={{width:'100%', marginTop:8, padding:'12px', justifyContent:'center', borderColor:'var(--red)', color:'var(--red)'}} onClick={onLogout}>
          <Icon n="logout" s={14}/> Cerrar sesión
        </button>
      </div>

      <Modal open={pwOpen} onClose={() => setPwOpen(false)} title="Cambiar contraseña" footer={
        <>
          <button className="btn-ghost" onClick={() => setPwOpen(false)}>Cancelar</button>
          <button className="btn-primary" onClick={submitPw} disabled={busy || !pw || !pw2}>
            {busy ? <span className="loader"/> : <><Icon n="check" s={14}/> Guardar</>}
          </button>
        </>
      }>
        <div className="field-group">
          <label className="field-label">Nueva contraseña</label>
          <input className="field-input" type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="Mínimo 6 caracteres" autoFocus style={{fontFamily:'var(--mono)'}}/>
        </div>
        <div className="field-group">
          <label className="field-label">Repetir contraseña</label>
          <input className="field-input" type="password" value={pw2} onChange={e=>setPw2(e.target.value)} style={{fontFamily:'var(--mono)'}}/>
        </div>
      </Modal>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   ProductoEditModal — portado desde web/pages.jsx para paridad total.
   Necesario en mobile para el flujo "SKU al vuelo" desde el carrito
   de carga manual. Mismo componente, mismo onSave shape, mismas
   validaciones. El CSS de modals.jsx (Modal full-screen en viewport
   ≤480px) lo adapta automáticamente al mobile.
   ════════════════════════════════════════════════════════════════ */
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
      incompleto: editing.incompleto || false,
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

window.NotificacionesPage = NotificacionesPage;
window.PerfilPage = PerfilPage;
window.ProductoEditModal = ProductoEditModal;
