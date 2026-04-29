/* ══ SIDEBAR — filtrado por rol ══ */

function Sidebar({ current, onNav, onLogout, unread }) {
  const u = window.MOCK.user;
  const allowed = window.MOCK.ROLE_NAV[u.role]?.items || [];

  /* todos los items posibles */
  const all = [
    { sec:'principal', label:'Principal' },
    { id:'dashboard',     label:'Dashboard',          icon:'home' },

    { sec:'produccion', label:'Producción' },
    { id:'produccion',    label:'Producción',         icon:'tools' },
    { id:'registrar',     label:'Registrar producción', icon:'plus' },

    { sec:'admin', label:'Admin' },
    { id:'historico',     label:'Histórico',          icon:'history' },
    { id:'catalogo',      label:'Catálogo',           icon:'tag' },
    { id:'equipo',        label:'Equipo',             icon:'users' },

    { sec:'sistema', label:'Sistema' },
    { id:'notificaciones', label:'Notificaciones',    icon:'bell', badge: unread },
    { id:'perfil',        label:'Mi Perfil',          icon:'user' },
  ];

  /* filtrar por rol — quitar items y secciones vacías */
  const visible = all.filter(it => it.sec || allowed.includes(it.id));
  /* quitar headers de sección que quedaron sin items debajo */
  const cleaned = visible.filter((it, i) => {
    if (!it.sec) return true;
    const next = visible[i+1];
    return next && !next.sec;
  });

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <Logo size="sm"/>
      </div>

      <nav className="sidebar-nav">
        {cleaned.map((it, i) => it.sec ? (
          <div key={`s-${i}`} className="nav-section-label">{it.label}</div>
        ) : (
          <button
            key={it.id}
            className={`nav-item ${current === it.id ? 'active' : ''}`}
            onClick={() => onNav(it.id)}
          >
            <span className="nav-icon" style={it.tint?{color:it.tint}:undefined}><Icon n={it.icon} s={15}/></span>
            <span className="nav-label">{it.label}</span>
            {it.badge ? <span className="nav-badge">{it.badge}</span> : null}
          </button>
        ))}
      </nav>

      <div className="sidebar-user">
        <div className="user-row">
          <div className="user-avatar">{u.initials}</div>
          <div style={{flex:1, minWidth:0}}>
            <div style={{fontSize:12, fontWeight:700, color:'var(--ink)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{u.name}</div>
            <div style={{fontSize:9, color:'var(--ink-muted)', textTransform:'uppercase', letterSpacing:'.1em', fontWeight:700}}>{u.roleLabel}</div>
          </div>
        </div>
        <button className="logout-btn" onClick={onLogout}>
          <Icon n="logout" s={11}/>
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}

window.Sidebar = Sidebar;
