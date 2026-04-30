import { NavLink, useLocation } from 'react-router-dom';
import { Icon } from '@/components/shared/Icon';
import { useCurrentProfile } from '@macario/shared/hooks/useAuth';
import { useNotifications } from '@macario/shared/hooks/useNotifications';

interface TabItem {
  id: string;
  label: string;
  icon: Parameters<typeof Icon>[0]['n'];
  path: string;
  /** Si está en role_permissions.items del usuario, se muestra. */
}

/**
 * Lógica de tabs por rol:
 * - Operarios y todos los roles ven: Producción + Notificaciones + Perfil
 * - Operarios + encargado + admin ven también: Scan
 * - Encargado / owner / admin ven también: Dashboard (al frente) + Carrier
 *
 * Bottom nav muestra MÁX 5 items para que entren bien en mobile.
 * Los items se filtran por role_permissions.items y por priorities.
 */
const ALL_TABS: TabItem[] = [
  { id: 'dashboard',     label: 'Inicio',   icon: 'home',  path: '/' },
  { id: 'produccion',    label: 'Prod.',    icon: 'tools', path: '/produccion' },
  { id: 'qr',            label: 'Escanear', icon: 'qr',    path: '/scan' },
  { id: 'notificaciones', label: 'Avisos',   icon: 'bell',  path: '/notificaciones' },
  { id: 'perfil',        label: 'Perfil',   icon: 'user',  path: '/perfil' },
];

export function BottomTabs() {
  const { data } = useCurrentProfile();
  const notif = useNotifications();
  const location = useLocation();

  const allowed = data?.perms?.items ?? [];
  const role = data?.profile?.role;
  const unread = (notif.data ?? []).filter(n => !n.leida).length;

  // QR scanner habilitado para todos los roles excepto marketing
  // (marketing no tiene acceso a operación)
  const tabs = ALL_TABS.filter(t => {
    if (t.id === 'qr') {
      return role !== 'marketing';
    }
    if (t.id === 'dashboard') {
      // Dashboard tab visible para todos (los operarios lo ven simplificado)
      return allowed.includes('dashboard') || role !== undefined;
    }
    return allowed.includes(t.id);
  });

  return (
    <nav className="m-tabbar" role="navigation" aria-label="Navegación principal">
      {tabs.map(t => {
        // Active si la ruta actual coincide exactamente o es una sub-ruta del tab
        const active = t.path === '/'
          ? location.pathname === '/'
          : location.pathname.startsWith(t.path);
        return (
          <NavLink
            key={t.id}
            to={t.path}
            className={`m-tab ${active ? 'active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            <Icon n={t.icon} s={20}/>
            <span>{t.label}</span>
            {t.id === 'notificaciones' && unread > 0 && (
              <span className="m-tab-badge" aria-label={`${unread} no leídas`}>
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}
