/* ══ MOBILE PAGES — Notificaciones / Perfil ══ */

/* La lista trae las ultimas 50 (loadNotifications); el contador sin leer sale
   de una consulta aparte y es el total real. Los dos numeros no coinciden a
   proposito y la pantalla lo dice.

   El filtro por tipo esta porque "Producción completada" se lleva casi todo el
   volumen: sin el, un aviso de pedido nuevo de la tienda queda enterrado. */
/* Cada aviso puede traer un link (public.notifications.link) y la pantalla lo
   ignoraba: se leía "Pedido B2B nuevo: Fulano" y no había cómo llegar al
   pedido. En el celular eso es todavía peor que en la compu, porque no hay
   barra de módulos donde ir a buscarlo a mano.

   Formas que escribe la base hoy:
     /canal/<id>                       → la pantalla de ese canal
     /ventas?tab=mayoristas&pedido=X   → pedido nuevo / anulado de la tienda
     /ventas?tab=b2b&sub=usuarios      → alguien pidió acceso a la tienda
   Lo que no sepamos abrir devuelve null y la tarjeta queda como estaba. */
const NAV_CANALES = ['colecta','flex','tiendanube','distribuidor','no_flex','correo_argentino'];

function destinoDeAviso(link) {
  if (!link || typeof link !== 'string') return null;
  const [ruta, query] = link.split('?');
  const qs = new URLSearchParams(query || '');

  if (ruta.indexOf('/canal/') === 0) {
    const canal = ruta.slice(7);
    return NAV_CANALES.includes(canal) ? { page: canal } : null;
  }

  if (ruta === '/ventas') {
    const tab = qs.get('tab');
    /* Va a "Tienda mayorista" y no a la ficha del mayorista porque es la única
       pantalla donde el pedido se puede mover de estado y facturar; el número
       viaja para que quede escrito en el buscador. */
    if (tab === 'mayoristas' || tab === 'b2b' || tab === 'tienda-b2b') {
      return {
        page: 'ventas',
        ventasTab: 'tienda-b2b',
        b2bSub: qs.get('sub') === 'usuarios' ? 'solicitudes' : 'pedidos',
        buscar: qs.get('pedido') || '',
      };
    }
    return { page: 'ventas' };
  }

  return null;
}

function NotificacionesPage({ onNav }) {
  const M = window.useMockData();
  const items = M.notifications || [];
  const sinLeer = M.notificationsSinLeer || 0;
  const toast = useToast();
  const [filtro, setFiltro] = useState(null);
  const ICONS  = { stock_critico:'alert', pedido_urgente:'flame', nuevo_pedido:'box', produccion:'tools', sistema:'info' };
  const COLORS = { stock_critico:'var(--red)', pedido_urgente:'var(--amber)', nuevo_pedido:'var(--blue)', produccion:'var(--green)', sistema:'var(--ink)' };
  const NOMBRES = { stock_critico:'Stock crítico', pedido_urgente:'Urgentes', nuevo_pedido:'Pedidos de la tienda', produccion:'Producción', sistema:'Sistema' };

  /* Solo los tipos que realmente aparecen: chips vacios serian ruido. */
  const tipos = useMemo(() => {
    const c = {};
    items.forEach(n => { c[n.tipo] = (c[n.tipo] || 0) + 1; });
    return Object.keys(c).sort((a, b) => c[b] - c[a]).map(t => ({ tipo: t, n: c[t] }));
  }, [items]);

  const visibles = filtro ? items.filter(n => n.tipo === filtro) : items;

  const marcarTodas = async () => {
    try { await window.MOCK_ACTIONS.marcarTodasLeidas(); toast.success('Marcadas como leídas'); }
    catch (e) { toast.error(e.message || 'Error'); }
  };

  /* Clickeable solo si sabemos abrirlo Y el rol tiene esa pantalla: un aviso
     que rebota al inicio es peor que uno que no se toca. */
  const destinoVisible = (n) => {
    if (!onNav) return null;
    const d = destinoDeAviso(n.link);
    if (!d) return null;
    if (window.canSeeNav && !window.canSeeNav(d.page)) return null;
    return d;
  };

  const abrir = (d) => {
    /* La intención viaja por window (ver app.jsx): VentasPage se monta como
       window.VentasPage, sin props, y el panel B2B está dos niveles abajo. */
    window.NAV_INTENT = d;
    onNav(d.page);
  };

  return (
    <div className="m-page">
      <div className="m-page-header">
        <div style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:10}}>
          <div>
            <div className="m-page-title">Notificaciones</div>
            <div className="m-page-sub">
              {sinLeer} sin leer
              {sinLeer > items.length && ` · se ven las ${items.length} más recientes`}
            </div>
          </div>
          {sinLeer > 0 && (
            <button className="btn-ghost" onClick={marcarTodas} style={{padding:'6px 10px', fontSize:10}}>
              <Icon n="check" s={11}/> Leer todo
            </button>
          )}
        </div>

        {tipos.length > 1 && (
          <div style={{display:'flex', gap:6, overflowX:'auto', marginTop:10, paddingBottom:2}}>
            {[{ tipo:null, n:items.length }].concat(tipos).map(t => {
              const on = filtro === t.tipo;
              return (
                <button key={t.tipo || 'todo'} onClick={() => setFiltro(t.tipo)}
                  style={{
                    padding:'5px 10px', borderRadius:20, fontSize:10, fontWeight:700, whiteSpace:'nowrap',
                    border:`1px solid ${on ? (COLORS[t.tipo] || 'var(--ink)') : 'var(--border)'}`,
                    background: on ? `${COLORS[t.tipo] || 'var(--ink)'}1a` : 'var(--paper)',
                    color: on ? (COLORS[t.tipo] || 'var(--ink)') : 'var(--ink-soft)',
                  }}>
                  {t.tipo ? (NOMBRES[t.tipo] || t.tipo) : 'Todo'} · {t.n}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div style={{padding:'4px 16px 100px'}}>
        {visibles.length === 0 ? (
          <div className="m-empty">
            <Icon n="bell" s={32} c="var(--ink-faint)"/>
            <div style={{fontSize:13, fontWeight:700, marginTop:8}}>
              {filtro ? 'Nada de este tipo por ahora' : 'Sin notificaciones'}
            </div>
          </div>
        ) : visibles.map(n => {
          const dest = destinoVisible(n);
          return (
            <div key={n.id} className="m-notif-card"
              onClick={dest ? () => abrir(dest) : undefined}
              role={dest ? 'button' : undefined}
              style={{background: n.leida?'var(--paper)':'var(--paper-off)', cursor: dest ? 'pointer' : 'default'}}>
              <div style={{width:34, height:34, borderRadius:6, background:`${COLORS[n.tipo]}1a`, color:COLORS[n.tipo], display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0}}>
                <Icon n={ICONS[n.tipo]} s={16}/>
              </div>
              <div style={{flex:1, minWidth:0}}>
                <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:2}}>
                  <div style={{fontSize:13, fontWeight: n.leida?500:700}}>{n.titulo}</div>
                  {!n.leida && <span style={{width:7, height:7, borderRadius:'50%', background:COLORS[n.tipo], flexShrink:0}}/>}
                </div>
                <div style={{fontSize:12, color:'var(--ink-soft)', lineHeight:1.4}}>{n.mensaje}</div>
                {/* Mobile: la señal de "esto se abre" va abajo, en la misma
                    línea de la fecha, y no como columna a la derecha. La
                    tarjeta ya es angosta y una columna más le come el ancho
                    al mensaje, que es lo que hay que poder leer. */}
                <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, marginTop:4}}>
                  <div style={{fontSize:10, color:'var(--ink-muted)', fontWeight:600}}>{fmt.agoSimple(n.created_at)}</div>
                  {dest && (
                    <div style={{display:'flex', alignItems:'center', gap:3, fontSize:10, fontWeight:700, color:COLORS[n.tipo]}}>
                      Abrir <Icon n="chev-right" s={11}/>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PerfilPage({ onLogout, onNav }) {
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

  /* Módulos que existen en mobile pero no entran en la barra de abajo, que ya
     llega a sus 5 pestañas y no admite una sexta. Sin esto, la Tienda
     mayorista (que vive adentro de Ventas) solo se podía abrir tocando un
     aviso de la campanita: si el aviso se caía de los últimos 50, el dueño se
     quedaba sin puerta desde el celular.
     El filtro es el permiso real —el mismo canSeeNav que usa el resto de la
     navegación—, y además se chequea que el componente esté cargado. */
  const puedeNav = (id) => (window.canSeeNav ? window.canSeeNav(id) : false);
  const modulos = !onNav ? [] : [
    { page:'ventas',    label:'Ventas y tienda mayorista', icon:'store',
      ok: puedeNav('ventas') && !!window.VentasPage },
    { page:'marketing', label:'Marketing', icon:'chart',
      ok: puedeNav('marketing') && !!window.MarketingPage },
    /* El id de permiso es 'administracion' pero la ruta mobile se llama
       'admin' desde antes; se respetan los dos nombres. */
    { page:'admin',     label:'Administración', icon:'briefcase',
      ok: puedeNav('administracion') && !!window.AdminPage && !!window.FEATURE_ADMIN },
  ].filter(m => m.ok);

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

        {modulos.length > 0 && (
          <div className="m-card" style={{marginTop:14}}>
            <div className="m-card-header"><div className="m-card-title">Módulos</div></div>
            <div style={{padding:'10px 14px 14px'}}>
              {modulos.map(m => (
                <button key={m.page} className="btn-ghost"
                        style={{width:'100%', marginTop:6, padding:'12px', justifyContent:'flex-start'}}
                        onClick={() => onNav(m.page)}>
                  <Icon n={m.icon} s={14}/> {m.label}
                </button>
              ))}
            </div>
          </div>
        )}

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
