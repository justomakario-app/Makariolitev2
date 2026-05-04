/* ══ MOBILE SCAN PAGE — modo continuo + feedback rico + debounce ══ */

function ScanPage({ onNav }) {
  const toast = useToast();
  const M = window.useMockData();
  const videoRef = useRef(null);
  const scannerRef = useRef(null);

  // Anti-doble-scan: ignorar el mismo SKU si vuelve a aparecer en <3s.
  const lastScanRef = useRef({ sku: null, time: 0 });

  const [scanning, setScanning]     = useState(false);
  const [error, setError]           = useState('');
  const [permissionDenied, setPD]   = useState(false);
  const [lastSku, setLastSku]       = useState(null);
  const [lastScans, setLastScans]   = useState([]);
  const [feedback, setFeedback]     = useState(null); // 'success' | 'error' | null
  const [registerOpen, setRegisterOpen] = useState(false);
  const [pendingSku, setPendingSku] = useState(null);

  const stop = () => {
    try { scannerRef.current?.stop(); scannerRef.current?.destroy(); } catch (e) {}
    scannerRef.current = null;
    setScanning(false);
  };

  const flashFeedback = (kind, ms = 250) => {
    setFeedback(kind);
    setTimeout(() => setFeedback(null), ms);
  };

  /* Manejo de un escaneo individual: parsea, valida, da feedback. */
  const handleScan = (text) => {
    // Extraer SKU de distintos formatos posibles:
    //   "MAD050" (puro)
    //   "ML-8203 · MAD050" (formato ML)
    //   "ALGO MAD050" (algo + sku final)
    let sku = (text || '').toString().trim();
    if (sku.includes('·')) sku = sku.split('·').pop().trim();
    if (sku.includes(' ')) sku = sku.split(' ').pop().trim();

    // Debounce: mismo SKU dentro de 3s lo ignoramos (evita re-disparos
    // del mismo cuadradito mientras la cámara enfoca).
    const now = Date.now();
    if (lastScanRef.current.sku === sku && (now - lastScanRef.current.time) < 3000) {
      return;
    }
    lastScanRef.current = { sku, time: now };

    if (window.SKU_DB[sku]) {
      // ── SKU válido ──
      try { navigator.vibrate?.(40); } catch {}
      flashFeedback('success', 250);
      setLastSku(sku);
      setPendingSku(sku);
      setLastScans(s => [
        { sku, time: new Date().toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' }) },
        ...s,
      ].slice(0, 8));
      // Stop la cámara mientras está abierto el modal — se reactiva al cerrarlo (modo continuo).
      stop();
      setRegisterOpen(true);
    } else {
      // ── SKU no reconocido ──
      try { navigator.vibrate?.([40, 60, 40]); } catch {}
      flashFeedback('error', 450);
      toast.error(`SKU no reconocido: ${sku}`);
      // No paramos — el operario puede apuntar a otro QR.
    }
  };

  const start = async () => {
    if (!window.QrScanner) {
      setError('Librería de QR no cargada todavía. Recargá la página.');
      return;
    }
    setError('');
    setPD(false);
    setScanning(true);
    try {
      const scanner = new window.QrScanner(
        videoRef.current,
        result => handleScan(result?.data ?? result ?? ''),
        { highlightScanRegion: false, highlightCodeOutline: false, returnDetailedScanResult: true }
      );
      scannerRef.current = scanner;
      await scanner.start();
    } catch (e) {
      const msg = (e?.message || '').toLowerCase();
      if (msg.includes('permission') || msg.includes('denied') || msg.includes('notallowed')) {
        setPD(true);
      } else {
        setError(e?.message || 'No se pudo acceder a la cámara');
      }
      setScanning(false);
    }
  };

  /* Modo continuo: cuando se cierra el modal de Registrar, vuelve la
     cámara automáticamente sin que el operario tenga que tocar nada. */
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (wasOpenRef.current && !registerOpen) {
      // El modal acaba de cerrarse → reactivar cámara (delay corto para
      // evitar conflicto con el unmount del modal).
      setTimeout(() => {
        if (!scannerRef.current && !permissionDenied) start();
      }, 350);
    }
    wasOpenRef.current = registerOpen;
  }, [registerOpen]);

  /* Cleanup al desmontar la página */
  useEffect(() => () => stop(), []);

  const skuInfo = lastSku ? window.SKU_DB[lastSku] : null;

  // ── PANTALLA: permiso de cámara denegado ──
  if (permissionDenied) {
    return (
      <div className="m-page">
        <div className="m-page-header">
          <div className="m-page-title">Permiso de cámara</div>
          <div className="m-page-sub">Necesitamos acceso para escanear QRs</div>
        </div>
        <div style={{padding:'20px 16px', textAlign:'center'}}>
          <div style={{
            width:80, height:80, margin:'0 auto 18px',
            background:'var(--red-bg)', border:'2px dashed var(--red)',
            borderRadius:12, display:'flex', alignItems:'center', justifyContent:'center',
          }}>
            <Icon n="alert" s={36} c="var(--red)"/>
          </div>
          <div style={{fontSize:14, fontWeight:700, marginBottom:8}}>Cámara bloqueada</div>
          <div style={{fontSize:12, color:'var(--ink-soft)', lineHeight:1.6, maxWidth:300, margin:'0 auto'}}>
            Permitiste que la app use la cámara pero el navegador la bloqueó. Andá a Configuración del navegador → Permisos → Cámara → Permitir para esta página.
          </div>
          <button className="btn-primary" style={{marginTop:18}} onClick={() => { setPD(false); start(); }}>
            <Icon n="refresh" s={14}/> Volver a pedir permiso
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="m-page">
      <div className="m-page-header">
        <div className="m-page-title">Scanner QR</div>
        <div className="m-page-sub">Apuntá la cámara al QR del modelo</div>
      </div>

      {/* Marco de cámara con feedback de color */}
      <div className={`m-scan-frame m-scan-${feedback||'idle'}`}>
        {scanning ? (
          <video ref={videoRef} className="m-scan-video" playsInline muted/>
        ) : (
          <div className="m-scan-placeholder">
            <Icon n="qr" s={56} c="var(--ink-faint)"/>
            <div style={{fontSize:13, fontWeight:600, color:'var(--ink-soft)', marginTop:10}}>Cámara apagada</div>
            <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:4, textAlign:'center', maxWidth:240}}>Tocá el botón para activar el escáner</div>
          </div>
        )}
        {scanning && <div className="m-scan-overlay"><div className="m-scan-square"/></div>}
        {feedback === 'success' && (
          <div className="m-scan-flash m-scan-flash-ok">
            <Icon n="check" s={48} c="#fff"/>
          </div>
        )}
        {feedback === 'error' && (
          <div className="m-scan-flash m-scan-flash-err">
            <Icon n="x" s={48} c="#fff"/>
          </div>
        )}
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

      {scanning && (
        <div style={{padding:'8px 16px 0', fontSize:11, color:'var(--ink-muted)', textAlign:'center'}}>
          Modo continuo: después de cargar volvés solo a la cámara
        </div>
      )}

      {/* Último escaneado (cuando el modal está cerrado) */}
      {lastSku && skuInfo && !registerOpen && (
        <div className="m-card" style={{margin:'14px 16px'}}>
          <div className="m-card-header">
            <div className="m-card-title">Último escaneado</div>
          </div>
          <div style={{padding:14}}>
            <div style={{fontFamily:'var(--mono)', fontWeight:700, fontSize:14}}>{lastSku}</div>
            <div style={{fontSize:13, color:'var(--ink-soft)', marginTop:3}}>
              {skuInfo.modelo}{skuInfo.color && skuInfo.color !== '—' ? ` · ${skuInfo.color}` : ''}
            </div>
            <button className="btn-primary" style={{marginTop:10, width:'100%'}} onClick={() => { setPendingSku(lastSku); setRegisterOpen(true); }}>
              <Icon n="plus" s={14}/> Registrar producción
            </button>
          </div>
        </div>
      )}

      {/* Mis últimos escaneos en esta sesión (placeholder — Etapa 4 lo reemplaza) */}
      {lastScans.length > 0 && (
        <div className="m-card" style={{margin:'14px 16px 100px'}}>
          <div className="m-card-header">
            <div className="m-card-title">Recientes en esta sesión</div>
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
