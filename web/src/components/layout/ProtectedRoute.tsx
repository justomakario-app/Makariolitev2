import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSession } from '@macario/shared/hooks/useAuth';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{
        position: 'fixed', inset: 0, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: 'var(--paper)',
      }}>
        <span className="loader" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
