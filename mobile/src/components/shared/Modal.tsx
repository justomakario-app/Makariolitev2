import { useEffect, type ReactNode } from 'react';
import { Icon } from './Icon';

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg';
}

export function Modal({ open, title, onClose, children, footer, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-back on" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${size === 'lg' ? 'lg' : ''}`}>
        <div className="modal-hd">
          <div className="modal-ti">{title}</div>
          <button className="modal-cl" onClick={onClose} aria-label="Cerrar">
            <Icon n="x" s={18} />
          </button>
        </div>
        <div className="modal-bd">{children}</div>
        {footer && <div className="modal-ft">{footer}</div>}
      </div>
    </div>
  );
}

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmModal(p: ConfirmModalProps) {
  return (
    <Modal open={p.open} title={p.title} onClose={p.onClose} footer={
      <>
        <button className="btn-ghost" onClick={p.onClose}>Cancelar</button>
        <button className={p.danger ? 'btn-danger' : 'btn-primary'} onClick={() => { p.onConfirm(); p.onClose(); }}>
          <Icon n="check" s={14}/> {p.confirmText ?? 'Confirmar'}
        </button>
      </>
    }>
      <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6 }}>{p.message}</div>
    </Modal>
  );
}
