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
  const u = M.user;
  const initials = (u.name || '?').split(' ').map(s=>s[0]).join('').slice(0,2).toUpperCase();
  const ROLE_COLOR = {
    owner:'#0a0a0a', admin:'#7c3aed', encargado:'#2563eb',
    embalaje:'#16a34a', cnc:'#d97706', melamina:'#0891b2',
    pino:'#92400e', logistica:'#6366f1', ventas:'#db2777',
  };
  const c = ROLE_COLOR[u.role] || '#888';

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

        <button className="btn-ghost" style={{width:'100%', marginTop:14, padding:'12px', justifyContent:'center', borderColor:'var(--red)', color:'var(--red)'}} onClick={onLogout}>
          <Icon n="logout" s={14}/> Cerrar sesión
        </button>
      </div>
    </div>
  );
}

window.NotificacionesPage = NotificacionesPage;
window.PerfilPage = PerfilPage;
