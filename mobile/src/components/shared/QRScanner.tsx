import { useEffect, useState } from 'react';
import { Scanner } from '@yudiel/react-qr-scanner';
import { Icon } from './Icon';

interface Props {
  /** Callback cuando se detecta un código. Recibe el string completo. */
  onDetect: (code: string) => void;
  onClose: () => void;
  /** Si true, el scanner queda abierto después de detectar (continuous). Default: false. */
  continuous?: boolean;
}

/**
 * Componente aislado de QR scanner. Encapsula la lib usada (`@yudiel/react-qr-scanner`)
 * para poder cambiarla en el futuro sin tocar el resto del código.
 *
 * Maneja permisos de cámara y muestra mensajes claros si se rechazan.
 */
export function QRScanner({ onDetect, onClose, continuous = false }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);

  // Lock body scroll while open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <div className="m-qr-scanner" role="dialog" aria-label="Escáner de QR">
      <button
        className="m-qr-scanner-close"
        onClick={onClose}
        aria-label="Cerrar escáner"
      >
        <Icon n="x" s={20}/>
      </button>

      <div className="m-qr-scanner-frame">
        <Scanner
          onScan={(detected) => {
            if (paused) return;
            const first = detected[0];
            if (!first) return;
            const code = first.rawValue?.trim();
            if (!code) return;
            if (!continuous) setPaused(true);
            onDetect(code);
          }}
          onError={(err) => {
            const e = err as Error;
            const msg = (e.message || '').toLowerCase();
            if (msg.includes('permission') || msg.includes('denied') || msg.includes('notallowed')) {
              setError('Permiso de cámara denegado. Revisá la configuración del navegador.');
            } else {
              setError('No se pudo iniciar la cámara: ' + e.message);
            }
          }}
          constraints={{ facingMode: 'environment' }}
          styles={{
            container: { width: '100%', height: '100%' },
            video: { width: '100%', height: '100%', objectFit: 'cover' },
          }}
        />
        <div className="m-qr-scanner-overlay" aria-hidden="true"/>
      </div>

      {/* Footer con instrucciones */}
      <div style={{
        padding: '20px 24px calc(20px + env(safe-area-inset-bottom))',
        background: 'rgba(0,0,0,0.85)',
        color: '#fff',
        textAlign: 'center',
      }}>
        {error ? (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            background: 'rgba(220,38,38,0.2)',
            border: '1px solid rgba(220,38,38,0.5)',
            padding: '10px 14px', borderRadius: 8,
            fontSize: 12, lineHeight: 1.4, textAlign: 'left',
          }}>
            <Icon n="alert" s={16} c="#fff"/>
            <span>{error}</span>
          </div>
        ) : paused ? (
          <div>
            <div style={{fontSize: 14, fontWeight: 700, marginBottom: 6}}>Procesando…</div>
            <button
              onClick={() => setPaused(false)}
              style={{
                background: 'rgba(255,255,255,0.15)',
                border: '1px solid rgba(255,255,255,0.3)',
                color: '#fff',
                padding: '10px 18px',
                borderRadius: 8,
                fontSize: 12, fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Escanear otro
            </button>
          </div>
        ) : (
          <>
            <div style={{fontSize: 14, fontWeight: 700, marginBottom: 4}}>Apuntá al código QR</div>
            <div style={{fontSize: 12, opacity: 0.7}}>El sistema lo detecta automáticamente</div>
          </>
        )}
      </div>
    </div>
  );
}
