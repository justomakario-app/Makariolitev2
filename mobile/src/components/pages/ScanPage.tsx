import { useState } from 'react';
import { Icon } from '@/components/shared/Icon';
import { QRScanner } from '@/components/shared/QRScanner';
import { useToast } from '@/components/shared/Toast';
import { supabase } from '@macario/shared/lib/supabase';
import { useSession } from '@macario/shared/hooks/useAuth';
import { useSkuCatalog } from '@macario/shared/hooks/useCatalog';
import { fmt } from '@macario/shared/lib/fmt';

interface ScanRecord {
  id: string;
  code: string;
  sku: string | null;
  modelo: string | null;
  scanned_at: string;
}

export function ScanPage() {
  const toast = useToast();
  const { user } = useSession();
  const { data: catalog = [] } = useSkuCatalog();
  const [scanning, setScanning] = useState(false);
  const [recent, setRecent] = useState<ScanRecord[]>([]);

  const handleDetect = async (code: string) => {
    if (!user) return;

    // Resolver SKU: el QR puede tener solo el SKU (ej "MAD061") o un texto más largo
    // (ej "ML-8203 · MAD061"). Buscamos un patrón que matchee algún SKU del catálogo.
    const knownSku = catalog.find(c => code.includes(c.sku))?.sku ?? null;

    try {
      const { data, error } = await supabase
        .from('qr_scans')
        .insert({
          code,
          sku: knownSku,
          operario_id: user.id,
        })
        .select()
        .single();

      if (error) throw error;

      const skuMeta = catalog.find(c => c.sku === knownSku);
      setRecent(prev => [{
        id: data.id,
        code,
        sku: knownSku,
        modelo: skuMeta?.modelo ?? null,
        scanned_at: data.scanned_at,
      }, ...prev.slice(0, 9)]); // mantener últimos 10

      if (knownSku) {
        toast.success(`✓ ${knownSku} — ${skuMeta?.modelo ?? ''}`);
      } else {
        toast.warning(`Código registrado pero SKU no reconocido: ${code.slice(0, 30)}`);
      }
    } catch (e) {
      toast.error('Error registrando scan: ' + (e as Error).message);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Escáner QR</div>
          <div className="page-sub">Confirmá embalado con la cámara</div>
        </div>
      </div>

      <div className="card" style={{padding: 24, textAlign: 'center', marginTop: 8}}>
        <div style={{
          margin: '0 auto 16px',
          width: 80, height: 80,
          background: 'var(--paper-dim)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 12, position: 'relative',
        }}>
          <Icon n="qr" s={42} c="var(--ink)"/>
          <div style={{
            position: 'absolute', inset: 0,
            border: '2px dashed var(--blue)',
            borderRadius: 12,
            animation: 'pulseDot 2s infinite',
          }}/>
        </div>
        <div style={{fontSize: 14, fontWeight: 700, marginBottom: 4}}>
          Listo para escanear
        </div>
        <div style={{fontSize: 12, color: 'var(--ink-muted)', marginBottom: 18}}>
          Toca para abrir la cámara y apuntar al QR del producto
        </div>
        <button
          className="btn-primary"
          onClick={() => setScanning(true)}
          style={{width: '100%', justifyContent: 'center', minHeight: 50, fontSize: 13}}
        >
          <Icon n="camera" s={18}/> Abrir cámara
        </button>
      </div>

      {recent.length > 0 && (
        <div className="card" style={{marginTop: 14}}>
          <div className="card-header">
            <div className="card-title">Escaneados recientes</div>
            <div style={{fontSize: 11, color: 'var(--ink-muted)', fontWeight: 600}}>
              {recent.length} en esta sesión
            </div>
          </div>
          <div style={{display: 'flex', flexDirection: 'column'}}>
            {recent.map(r => (
              <div
                key={r.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: 8,
                  background: r.sku ? 'var(--green-bg)' : 'var(--amber-bg)',
                  color: r.sku ? 'var(--green)' : 'var(--amber)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <Icon n={r.sku ? 'check-circle' : 'alert'} s={18}/>
                </div>
                <div style={{flex: 1, minWidth: 0}}>
                  <div style={{fontSize: 12, fontWeight: 700, fontFamily: 'var(--mono)'}}>
                    {r.sku ?? r.code.slice(0, 24)}
                  </div>
                  {r.modelo && (
                    <div style={{fontSize: 11, color: 'var(--ink-soft)', marginTop: 1}}>
                      {r.modelo}
                    </div>
                  )}
                  <div style={{fontSize: 10, color: 'var(--ink-muted)', marginTop: 2, fontFamily: 'var(--mono)'}}>
                    {fmt.dateTime(r.scanned_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {scanning && (
        <QRScanner
          onDetect={(code) => {
            handleDetect(code);
          }}
          onClose={() => setScanning(false)}
          continuous={false}
        />
      )}
    </div>
  );
}
