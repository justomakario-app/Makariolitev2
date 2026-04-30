/* ══ MOBILE BOTTOM BAR — reemplaza Sidebar en mobile ══ */

function BottomBar({ current, onNav, unread }) {
  const u = window.MOCK.user;
  const allowed = window.MOCK.ROLE_NAV[u.role]?.items || [];

  /* Tabs según rol — máximo 5 (los más usados) */
  const allTabs = [
    { id:'dashboard',   label:'Inicio',     icon:'home' },
    { id:'scan',        label:'Scan',       icon:'qr' },
    { id:'produccion',  label:'Producción', icon:'tools' },
    { id:'notificaciones', label:'Avisos',  icon:'bell', badge: unread },
    { id:'perfil',      label:'Perfil',     icon:'user' },
  ];

  /* Filtrar por rol — ej: operario sólo ve scan + producción + perfil */
  const visible = allTabs.filter(t =>
    t.id === 'scan' || allowed.includes(t.id)
  );

  return (
    <nav className="m-bottombar" role="navigation">
      {visible.map(t => (
        <button
          key={t.id}
          className={`m-tab ${current === t.id ? 'active' : ''}`}
          onClick={() => onNav(t.id)}
        >
          <div className="m-tab-icon-wrap">
            <Icon n={t.icon} s={20}/>
            {t.badge ? <span className="m-tab-badge">{t.badge > 9 ? '9+' : t.badge}</span> : null}
          </div>
          <span className="m-tab-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

window.BottomBar = BottomBar;
