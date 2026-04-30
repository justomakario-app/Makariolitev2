import { createContext, useContext, useState, useMemo, useCallback, type ReactNode } from 'react';
import { Icon } from './Icon';

type ToastKind = 'success' | 'error' | 'info' | 'warning';
interface ToastItem { id: string; msg: string; kind: ToastKind; show: boolean; }

interface ToastApi {
  success: (m: string) => void;
  error:   (m: string) => void;
  info:    (m: string) => void;
  warning: (m: string) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be inside ToastProvider');
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((msg: string, kind: ToastKind = 'info', dur = 2800) => {
    const id = Math.random().toString(36).slice(2);
    setItems(s => [...s, { id, msg, kind, show: false }]);
    requestAnimationFrame(() => setItems(s => s.map(i => i.id === id ? { ...i, show: true } : i)));
    setTimeout(() => setItems(s => s.map(i => i.id === id ? { ...i, show: false } : i)), dur);
    setTimeout(() => setItems(s => s.filter(i => i.id !== id)), dur + 400);
  }, []);

  const api = useMemo<ToastApi>(() => ({
    success: m => push(m, 'success'),
    error:   m => push(m, 'error', 4500),
    info:    m => push(m, 'info'),
    warning: m => push(m, 'warning', 3500),
  }), [push]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div style={{
        position: 'fixed', top: 24, right: 24, zIndex: 5000,
        display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none',
      }}>
        {items.map(t => (
          <div key={t.id} className={`toast toast-${t.kind} ${t.show ? 'show' : ''}`}>
            <Icon n={t.kind === 'success' ? 'check-circle' : t.kind === 'error' || t.kind === 'warning' ? 'alert' : 'info'} s={16} />
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
