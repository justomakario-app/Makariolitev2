import { NavLink, useLocation } from 'react-router-dom';
import { Icon } from '@/components/shared/Icon';
import { Logo } from '@/components/shared/Logo';
import { useCurrentProfile, useLogout } from '@macario/shared/hooks/useAuth';
import { useNotifications } from '@macario/shared/hooks/useNotifications';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Propietario',
  admin: 'Administración',
  encargado: 'Encargado General',
  ventas: 'Ventas',
  cnc: 'Sector CNC',
  melamina: 'Sector Melamina',
  pino: 'Sector Pino',
  embalaje: 'Sector Embalaje',
  carpinteria: 'Carpintería',
  logistica: 'Logística',
  marketing: 'Marketing',
};

interface NavSection { sec: string; label: string; }
interface NavItem { id: string; label: string; icon: Parameters<typeof Icon>[0]['n']; path: string; }
type NavEntry = NavSection | NavItem;

const ALL: NavEntry[] = [
  { sec: 'principal', label: 'Principal' },
  { id: 'dashboard',     label: 'Dashboard',            icon: 'home',    path: '/' },

  { sec: 'produccion', label: 'Producción' },
  { id: 'produccion',    label: 'Producción',           icon: 'tools',   path: '/produccion' },
  { id: 'registrar',     label: 'Registrar producción', icon: 'plus',    path: '/produccion?registrar=1' },

  { sec: 'admin', label: 'Admin' },
  { id: 'historico',     label: 'Histórico',            icon: 'history', path: '/historico' },
  { id: 'catalogo',      label: 'Catálogo',             icon: 'tag',     path: '/catalogo' },
  { id: 'equipo',        label: 'Equipo',               icon: 'users',   path: '/equipo' },

  { sec: 'sistema', label: 'Sistema' },
  { id: 'notificaciones', label: 'Notificaciones',      icon: 'bell',    path: '/notificaciones' },
  { id: 'perfil',        label: 'Mi Perfil',            icon: 'user',    path: '/perfil' },
];

function isItem(e: NavEntry): e is NavItem {
  return 'id' in e;
}

export function Sidebar() {
  const { data } = useCurrentProfile();
  const logout = useLogout();
  const notif = useNotifications();
  const location = useLocation();

  const profile = data?.profile;
  const allowed: string[] = data?.perms?.items ?? [];
  const unread = (notif.data ?? []).filter(n => !n.leida).length;

  if (!profile) return null;

  // Filtrar items por rol
  const visible = ALL.filter(e => !isItem(e) || allowed.includes(e.id));
  // Quitar headers de sección sin items debajo
  const cleaned = visible.filter((e, i) => {
    if (isItem(e)) return true;
    const next = visible[i + 1];
    return next && isItem(next);
  });

  const initials = profile.name.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();

  return (
    <aside className="sidebar">
      <div className="sidebar-logo"><Logo size="sm" /></div>

      <nav className="sidebar-nav">
        {cleaned.map((e, i) => {
          if (!isItem(e)) {
            return <div key={`s-${i}`} className="nav-section-label">{e.label}</div>;
          }
          const active = location.pathname === e.path.split('?')[0]
            && (location.pathname !== '/' || e.path === '/');
          return (
            <NavLink
              key={e.id}
              to={e.path}
              className={`nav-item ${active ? 'active' : ''}`}
            >
              <span className="nav-icon"><Icon n={e.icon} s={15} /></span>
              <span className="nav-label">{e.label}</span>
              {e.id === 'notificaciones' && unread > 0 ? (
                <span className="nav-badge">{unread}</span>
              ) : null}
            </NavLink>
          );
        })}
      </nav>

      <div className="sidebar-user">
        <div className="user-row">
          <div className="user-avatar">{initials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.name}</div>
            <div style={{ fontSize: 9, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 700 }}>
              {ROLE_LABEL[profile.role] ?? profile.role}
            </div>
          </div>
        </div>
        <button className="logout-btn" onClick={() => logout.mutate()} disabled={logout.isPending}>
          <Icon n="logout" s={11} />
          {logout.isPending ? 'Cerrando…' : 'Cerrar sesión'}
        </button>
      </div>
    </aside>
  );
}
