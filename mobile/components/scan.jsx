/* ══ MOBILE SCAN PAGE — cámara real con qr-scanner ══ */

function ScanPage({ onNav }) {
  const toast = useToast();
  const M = window.useMockData();
  const videoRef = useRef(null);
  const scannerRef = useRef(null);

  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [lastSku, setLastSku] = useState(null);
  const [lastScans, setLastScans] = useState([]);

  /* Mostrar Producción/Registrar al detectar SKU válido */
  const [registerOpen, setRegisterOpen] = useState(false);
  const [pendingSku, setPendingSku] = useState(null);

  const stop = () => {
    try { scannerRef.current?.stop(); scannerRef.current?.destroy(); } catch (e) {}
    scannerRef.current = null;
    setScanning(false);
  };

  const start = async () => {
    if (!window.QrScanner) {
      setError('Librería de QR no cargada todavía. Recargá la página.');
      return;
    }
    setError('');
    setScanning(true);
    try {
      const scanner = new window.QrScanner(
        videoRef.current,
        result => {
          const text = (result?.data ?? result ?? '').toString().trim();
          if (!text) return;
          /* Extraer SKU: si es un SKU directo lo usamos; si es ML-XXXX·SKU lo parseamos */
          let sku = text;
          if (text.includes('·')) sku = text.split('·').pop().trim();
          if (text.includes(' ')) sku = text.split(' ').pop().trim();

          if (window.SKU_DB[sku]) {
            setLastSku(sku);
            setPendingSku(sku);
            setLastScans(s => [{ sku, time: new Date().toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit'}) }, ...s].slice(0, 8));
            toast.success(`SKU detectado: ${sku}`);
            stop();
            setRegisterOpen(true);
          } else {
            toast.error(`SKU no reconocido: ${sku}`);
          }
        },
        { highlightScanRegion: true, highlightCodeOutline: true, returnDetailedScanResult: true }
      );
      scannerRef.current = scanner;
      await scanner.start();
    } catch (e) {
      setError(e?.message || 'No se pudo acceder a la cámara');
      setScanning(false);
    }
  };

  /* limpiar cámara al desmontar */
  useEffect(() => () => stop(), []);

  const skuInfo = lastSku ? window.SKU_DB[lastSku] : null;

  return (
    <div className="m-page">
      <div className="m-page-header">
        <div className="m-page-title">Scanner QR</div>
        <div className="m-page-sub">Apuntá la cámara al código del producto</div>
      </div>

      <div className="m-scan-frame">
        {scanning ? (
          <video ref={videoRef} className="m-scan-video" playsInline muted/>
        ) : (
          <div className="m-scan-placeholder">
            <Icon n="qr" s={56} c="var(--ink-faint)"/>
            <div style={{fontSize:13, fontWeight:600, color:'var(--ink-soft)', marginTop:10}}>Cámara apagada</div>
            <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:4, textAlign:'center', maxWidth:240}}>Tocá el botón para activar el escáner</div>
          </div>
        )}

        {/* Overlay marco */}
        {scanning && <div className="m-scan-overlay"><div className="m-scan-square"/></div>}
      </div>

      {error && (
        <div style={{margin:'12px 16px', padding:'10px 12px', background:'var(--red-bg)', border:'1px solid rgba(220,38,38,.28)', color:'var(--red)', fontSize:12, fontWeight:600, borderRadius:6, display:'flex', gap:8, alignItems:'center'}}>
          <Icon n="alert" s={14}/> {error}
        </div>
      )}

      <div className="m-scan-controls">
        {!scanning ? (
          <button className="btn-primary m-scan-btn-big" onClick={start}>
            <Icon n="qr" s={16}/> Iniciar escáner
          </button>
        ) : (
          <button className="btn-ghost m-scan-btn-big" onClick={stop}>
            <Icon n="x" s={16}/> Detener
          </button>
        )}
      </div>

      {lastSku && skuInfo && (
        <div className="m-card" style={{margin:'14px 16px'}}>
          <div className="m-card-header">
            <div className="m-card-title">Último escaneado</div>
          </div>
          <div style={{padding:14}}>
            <div style={{fontFamily:'var(--mono)', fontWeight:700, fontSize:14}}>{lastSku}</div>
            <div style={{fontSize:13, color:'var(--ink-soft)', marginTop:3}}>{skuInfo.modelo}{skuInfo.color && skuInfo.color !== '—' ? ` · ${skuInfo.color}` : ''}</div>
            <button className="btn-primary" style={{marginTop:10, width:'100%'}} onClick={() => { setPendingSku(lastSku); setRegisterOpen(true); }}>
              <Icon n="plus" s={14}/> Registrar producción
            </button>
          </div>
        </div>
      )}

      {lastScans.length > 0 && (
        <div className="m-card" style={{margin:'14px 16px'}}>
          <div className="m-card-header">
            <div className="m-card-title">Recientes</div>
          </div>
          <div>
            {lastScans.map((r, i) => (
              <div key={i} style={{display:'flex', alignItems:'center', gap:12, padding:'10px 14px', borderBottom: i < lastScans.length-1 ? '1px solid var(--border)' : 'none'}}>
                <div style={{fontFamily:'var(--mono)', fontSize:11, color:'var(--ink-muted)'}}>{r.time}</div>
                <div style={{flex:1, fontFamily:'var(--mono)', fontWeight:700, fontSize:12}}>{r.sku}</div>
                <div style={{fontSize:11, color:'var(--ink-soft)'}}>{window.skuName(r.sku)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <ProduceModal open={registerOpen} onClose={() => setRegisterOpen(false)} defaultSku={pendingSku}/>
    </div>
  );
}

window.ScanPage = ScanPage;
