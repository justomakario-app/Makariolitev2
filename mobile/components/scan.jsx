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

  // "Mis cargas" del día — recargado tras cada confirmación
  const [misCargas, setMisCargas]   = useState([]);
  const [editLog, setEditLog]       = useState(null);
  const [confirmAnular, setConfirmAnular] = useState(null);

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

  /* start() solo dispara el flag scanning. El useEffect de abajo
     instancia el scanner DESPUÉS de que React montó el <video> en el
     DOM — sino videoRef.current es null y la lib tira:
     "null is not an object (evaluating 't.disablePictureInPicture=!0')". */
  const start = () => {
    if (!window.QrScanner) {
      setError('Librería de QR no cargada todavía. Recargá la página.');
      return;
    }
    setError('');
    setPD(false);
    setScanning(true);
  };

  /* Inicialización del scanner: corre cuando scanning pasa a true Y el
     <video> ya está montado. Cleanup automático al unmount o cuando
     scanning vuelve a false. */
  useEffect(() => {
    if (!scanning) return;
    // Doble rAF asegura que React ya commiteo el DOM
    let cancelled = false;
    let localScanner = null;

    const init = async () => {
      // Esperar a que el video esté en el DOM
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (cancelled || !videoRef.current) return;
      try {
        localScanner = new window.QrScanner(
          videoRef.current,
          result => handleScan(result?.data ?? result ?? ''),
          { highlightScanRegion: false, highlightCodeOutline: false, returnDetailedScanResult: true }
        );
        scannerRef.current = localScanner;
        await localScanner.start();
        if (cancelled) {
          try { localScanner.stop(); localScanner.destroy(); } catch (e) {}
          scannerRef.current = null;
        }
      } catch (e) {
        if (cancelled) return;
        const msg = (e?.message || '').toLowerCase();
        if (msg.includes('permission') || msg.includes('denied') || msg.includes('notallowed')) {
          setPD(true);
        } else {
          setError(e?.message || 'No se pudo acceder a la cámara');
        }
        setScanning(false);
      }
    };
    init();

    return () => {
      cancelled = true;
      try { localScanner?.stop(); localScanner?.destroy(); } catch (e) {}
      if (scannerRef.current === localScanner) scannerRef.current = null;
    };
    // eslint-disable-next-line
  }, [scanning]);

  /* Modo continuo: cuando se cierra el modal de Registrar, vuelve la
     cámara automáticamente sin que el operario tenga que tocar nada. */
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (wasOpenRef.current && !registerOpen) {
      setTimeout(() => {
        if (!scannerRef.current && !permissionDenied) start();
      }, 350);
    }
    wasOpenRef.current = registerOpen;
  }, [registerOpen]);

  /* Cleanup al desmontar la página */
  useEffect(() => () => stop(), []);

  /* Cargar "Mis cargas de hoy" al montar y después de cada cierre del modal */
  const recargarMisCargas = async () => {
    try {
      const logs = await window.MOCK_ACTIONS.getMisCargasHoy(20);
      setMisCargas(logs);
    } catch (e) { /* silencioso, no es crítico */ }
  };
  useEffect(() => { recargarMisCargas(); }, []);
  useEffect(() => { if (!registerOpen) recargarMisCargas(); }, [registerOpen]);

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

      {/* Mini-resumen de jornadas activas — solo si hay alguna info para mostrar */}
      {(() => {
        const canalesConActiva = Object.keys(M.carriers || {})
          .map(id => ({
            id,
            label: window.CARRIERS[id]?.label || id,
            activa: (M.carriers[id]?.jornadasAbiertas || []).find(j => j.id === M.carriers[id]?.jornadaActivaId),
            abiertas: (M.carriers[id]?.jornadasAbiertas || []).length,
          }))
          .filter(c => c.activa || c.abiertas > 0);
        if (!canalesConActiva.length) return null;
        return (
          <div style={{margin:'12px 16px 0', padding:'10px 12px', background:'var(--paper-off)', border:'1px solid var(--border)', borderRadius:8, fontSize:11}}>
            <div style={{fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'.08em', color:'var(--ink-muted)', marginBottom:6}}>
              Jornadas activas
            </div>
            <div style={{display:'flex', flexWrap:'wrap', gap:8}}>
              {canalesConActiva.map(c => (
                <div key={c.id} style={{display:'flex', alignItems:'center', gap:5, padding:'3px 8px', background:'var(--paper)', border:'1px solid var(--border)', borderRadius:12}}>
                  <span style={{fontWeight:700}}>{c.label}:</span>
                  <span style={{color: c.activa ? 'var(--ink)' : 'var(--red)'}}>
                    {c.activa ? fmt.date(c.activa.fecha) : `${c.abiertas} sin activa`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

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

      {/* Mis cargas de hoy — con botones Editar / Anular.
          Ocultamos las entradas compensatorias (cantidad<0) — son ruido
          técnico — pero usamos su info para marcar el original como
          "ya anulado/corregido" y deshabilitar sus botones. */}
      {(() => {
        // Set de IDs de logs que YA tienen una compensación asociada
        const idsAnulados = new Set();
        for (const l of misCargas) {
          const m = (l.notas || '').match(/^\[ANULADO\] log_id=([0-9a-f-]+)/);
          if (m) idsAnulados.add(m[1]);
        }
        // Filtrar compensaciones (las negativas con [ANULADO]); solo
        // mostramos las cargas reales (positivas).
        const visibles = misCargas.filter(l => !(l.cantidad < 0 && (l.notas || '').startsWith('[ANULADO]')));
        if (!visibles.length) return null;

        return (
          <div className="m-card" style={{margin:'14px 16px 100px'}}>
            <div className="m-card-header">
              <div className="m-card-title">Mis cargas de hoy · {visibles.length}</div>
            </div>
            <div>
              {visibles.map((l, i) => {
                const info = window.SKU_DB[l.sku] || {};
                const ch = window.CARRIERS[l.channel_id] || { label: l.channel_id };
                const yaAnulado = idsAnulados.has(l.id);
                const esCorregido = (l.notas || '').startsWith('[CORREGIDO]');
                return (
                  <div key={l.id} style={{
                    display:'flex', alignItems:'center', gap:10, padding:'10px 14px',
                    borderBottom: i < visibles.length-1 ? '1px solid var(--border)' : 'none',
                    opacity: yaAnulado ? 0.5 : 1,
                  }}>
                    <div style={{fontFamily:'var(--mono)', fontSize:10, color:'var(--ink-muted)', minWidth:38}}>
                      {l.hora ? String(l.hora).slice(0,5) : ''}
                    </div>
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:2, flexWrap:'wrap'}}>
                        <span style={{fontFamily:'var(--mono)', fontWeight:700, fontSize:12, textDecoration: yaAnulado ? 'line-through' : 'none'}}>{l.sku}</span>
                        <span style={{fontSize:9, fontWeight:700, padding:'1px 6px', borderRadius:6, background:`${ch.color}1a`, color:ch.color, textTransform:'uppercase'}}>{ch.label}</span>
                        {yaAnulado && <span style={{fontSize:9, fontWeight:700, padding:'1px 6px', borderRadius:6, background:'var(--paper-dim)', color:'var(--ink-muted)'}}>ANULADO</span>}
                        {esCorregido && !yaAnulado && <span style={{fontSize:9, fontWeight:700, padding:'1px 6px', borderRadius:6, background:'var(--blue-bg)', color:'var(--blue)'}}>CORRECCIÓN</span>}
                      </div>
                      <div style={{fontSize:11, color:'var(--ink-soft)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', textDecoration: yaAnulado ? 'line-through' : 'none'}}>
                        {info.modelo || ''}{info.color && info.color !== '—' ? ` · ${info.color}` : ''}
                      </div>
                    </div>
                    <div style={{fontFamily:'var(--mono)', fontWeight:800, fontSize:14, minWidth:38, textAlign:'right', textDecoration: yaAnulado ? 'line-through' : 'none'}}>
                      +{l.cantidad}
                    </div>
                    {!yaAnulado && (
                      <div style={{display:'flex', flexDirection:'column', gap:4}}>
                        <button onClick={() => setEditLog(l)} title="Editar" style={{width:30, height:30, padding:0, border:'1px solid var(--border-md)', background:'var(--paper)', borderRadius:5, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'var(--ink-soft)'}}>
                          <Icon n="edit" s={12}/>
                        </button>
                        <button onClick={() => setConfirmAnular(l)} title="Anular" style={{width:30, height:30, padding:0, border:'1px solid rgba(220,38,38,.32)', background:'var(--red-bg)', borderRadius:5, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'var(--red)'}}>
                          <Icon n="trash" s={12}/>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      <ProduceModal open={registerOpen} onClose={() => setRegisterOpen(false)} defaultSku={pendingSku}/>

      {/* Modal Editar carga */}
      {editLog && (
        <EditLogModal
          log={editLog}
          onClose={() => setEditLog(null)}
          onSaved={() => { setEditLog(null); recargarMisCargas(); }}
        />
      )}

      {/* Confirm Anular */}
      <ConfirmModal
        open={!!confirmAnular}
        onClose={() => setConfirmAnular(null)}
        title="Anular carga"
        message={confirmAnular
          ? `Vas a anular la carga de ${confirmAnular.cantidad} × ${confirmAnular.sku} (${window.CARRIERS[confirmAnular.channel_id]?.label || confirmAnular.channel_id}). Se va a registrar una entrada compensatoria que descuenta lo cargado. Queda registrado.`
          : ''}
        confirmText="Sí, anular"
        danger
        onConfirm={async () => {
          try {
            await window.MOCK_ACTIONS.corregirLog({ logId: confirmAnular.id, anular: true });
            toast.success('Carga anulada');
            setConfirmAnular(null);
            recargarMisCargas();
          } catch (e) { toast.error(e.message || 'No se pudo anular'); }
        }}
      />
    </div>
  );
}

/* ── Modal: editar una carga existente (corrige cantidad y/o destino) ── */
function EditLogModal({ log, onClose, onSaved }) {
  const toast = useToast();
  const info = window.SKU_DB[log.sku] || {};
  const [cantidad, setCantidad] = useState(log.cantidad);
  const [channelId, setChannelId] = useState(log.channel_id);
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (cantidad === log.cantidad && channelId === log.channel_id) {
      toast.info('No cambiaste nada');
      return;
    }
    if (cantidad <= 0) { toast.error('Cantidad debe ser > 0'); return; }
    setBusy(true);
    try {
      await window.MOCK_ACTIONS.corregirLog({
        logId: log.id,
        nuevaCantidad: cantidad,
        nuevoChannelId: channelId !== log.channel_id ? channelId : null,
        motivo: motivo || null,
        anular: false,
      });
      toast.success('Carga corregida');
      onSaved?.();
    } catch (e) {
      toast.error(e.message || 'No se pudo corregir');
    } finally {
      setBusy(false);
    }
  };

  const channels = ['colecta','flex','tiendanube','distribuidor','no_flex','correo_argentino']
    .filter(id => window.CARRIERS[id]);

  return (
    <Modal open={true} onClose={() => !busy && onClose()} title={`Editar carga · ${log.sku}`} footer={
      <>
        <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn-primary" onClick={submit} disabled={busy}>
          {busy ? <span className="loader" style={{borderColor:'rgba(255,255,255,.3)', borderTopColor:'#fff'}}/> : <><Icon n="check" s={14}/> Guardar corrección</>}
        </button>
      </>
    }>
      <div style={{padding:'10px 12px', background:'var(--paper-off)', border:'1px solid var(--border)', borderRadius:6, marginBottom:14, fontSize:12, color:'var(--ink-soft)'}}>
        <div><strong>{log.sku}</strong> · {info.modelo}{info.color && info.color !== '—' ? ` · ${info.color}` : ''}</div>
        <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:4}}>
          Original: {log.cantidad} uds · {window.CARRIERS[log.channel_id]?.label} · {log.hora?.slice(0,5)}
        </div>
      </div>

      <div className="field-group">
        <label className="field-label">Cantidad correcta</label>
        <div style={{display:'flex', gap:6, alignItems:'center'}}>
          <button onClick={() => setCantidad(Math.max(1, cantidad-1))} className="btn-ghost" style={{padding:'10px 14px', fontSize:18, lineHeight:1}}>−</button>
          <input type="number" min="1" value={cantidad} onChange={e => setCantidad(Math.max(1, parseInt(e.target.value)||1))} className="qty-input"/>
          <button onClick={() => setCantidad(cantidad+1)} className="btn-ghost" style={{padding:'10px 14px', fontSize:18, lineHeight:1}}>+</button>
        </div>
      </div>

      <div className="field-group">
        <label className="field-label">Destino</label>
        <select className="field-input" value={channelId} onChange={e => setChannelId(e.target.value)}>
          {channels.map(id => (
            <option key={id} value={id}>{window.CARRIERS[id].label}</option>
          ))}
        </select>
      </div>

      <div className="field-group">
        <label className="field-label">Motivo (opcional)</label>
        <input className="field-input" value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ej: tipeé mal la cantidad"/>
      </div>

      <div style={{padding:'10px 12px', background:'var(--blue-bg)', border:'1px solid rgba(37,99,235,.2)', borderRadius:6, fontSize:11, color:'var(--ink-soft)', lineHeight:1.6}}>
        <Icon n="info" s={11}/> Al guardar: se anula el original y se registra la corrección. El faltante del canal se recalcula al instante. La acción queda registrada en el historial.
      </div>
    </Modal>
  );
}

window.EditLogModal = EditLogModal;

window.ScanPage = ScanPage;
