import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@macario/shared/lib/queryClient';

/**
 * App raíz mobile — placeholder para Fase 3.
 * En Fase 5 se completa con RouterProvider + ToastProvider + ProtectedRoute.
 */
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 24px',
        textAlign: 'center',
        gap: 12,
        background: 'var(--paper)',
      }}>
        <div style={{
          width: 80, height: 80, borderRadius: 16,
          background: 'var(--ink)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 36, fontWeight: 900, letterSpacing: '-0.04em',
        }}>JM</div>
        <h1 style={{fontSize: 22, fontWeight: 800, marginTop: 8}}>Macario Lite</h1>
        <p style={{fontSize: 13, color: 'var(--ink-muted)', maxWidth: 320}}>
          Mobile scaffolding listo. Routing, auth gate y pantallas vienen en las próximas fases.
        </p>
        <p style={{fontSize: 11, color: 'var(--ink-faint)', marginTop: 16, fontFamily: 'var(--mono)'}}>
          Fase 3 ✓ — Vite + React + TS + PWA
        </p>
      </div>
    </QueryClientProvider>
  );
}
