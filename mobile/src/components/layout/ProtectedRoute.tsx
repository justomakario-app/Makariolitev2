import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSession, useCurrentProfile } from '@macario/shared/hooks/useAuth';

interface Props {
  children: ReactNode;
  /** Si la ruta tiene un `id` específico, solo se permite si está en role_permissions.items */
  requireItem?: string;
}

export function ProtectedRoute({ children, requireItem }: Props) {
  const { user, loading: sessLoading } = useSession();
  const { data: profileData, isLoading: profLoading } = useCurrentProfile();
  const location = useLocation();

  if (sessLoading || (user && profLoading)) {
    return (
      <div style={{
        position: 'fixed', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--paper)',
      }}>
        <span className="loader"/>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }}/>;
  }

  // Si la ruta requiere un permiso específico y el rol no lo tiene,
  // redirigir al landing del rol
  if (requireItem && profileData?.perms) {
    const allowed = profileData.perms.items ?? [];
    if (!allowed.includes(requireItem)) {
      const landing = profileData.perms.landing ?? '/';
      const landingPath = landing === 'dashboard' ? '/' : `/${landing}`;
      return <Navigate to={landingPath} replace/>;
    }
  }

  return <>{children}</>;
}
