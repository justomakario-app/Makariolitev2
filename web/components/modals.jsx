/* ══ MODALES — registrar producción, importar, cierre ══ */

function Modal({ open, title, onClose, children, footer, size }) {
  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className={`modal-back on`} onClick={e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`modal ${size==='lg'?'lg':''}`}>
        <div className="modal-hd">
          <div className="modal-ti">{title}</div>
          <button className="modal-cl" onClick={onClose} aria-label="Cerrar"><Icon n="x" s={18}/></button>
        </div>
        <div className="modal-bd">{children}</div>
        {footer && <div className="modal-ft">{footer}</div>}
      </div>
    </div>
  );
}

/* ── Registrar producción modal — SIN COLOR (el SKU lo define) ── */
function ProduceModal({ open, onClose, defaultSku, defaultSubcanal }) {
  const toast = useToast();
  // useMockData asegura que el modal refresque cuando llegan datos nuevos
  // (ej: jornadas abiertas/activas via realtime mientras está abierto).
  const M = window.useMockData();
  const skus = Object.keys(window.SKU_DB);

  const [step, setStep] = useState(1);
  const [sku, setSku] = useState(defaultSku || skus[0]);
  const [search, setSearch] = useState('');
  // Default vacio en lugar de 'colecta' — si la vía de carga no aporta
  // contexto de canal (Producción, Scan QR), el operario tiene que
  // elegir explícitamente en step 2 antes de avanzar. Bug 2026-05-13:
  // el default 'colecta' hacía que cargas hechas desde Producción/Scan
  // se fueran al canal equivocado si el operario no tocaba el selector.
  const [subcanal, setSubcanal] = useState(defaultSubcanal || '');
  const [cantidad, setCantidad] = useState(1);
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0,10));
  const [nota, setNota] = useState('');
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  /* jornadaIdOverride: si se elige a mano del selector. Si null, el RPC
     usa la jornada activa del canal automaticamente. */
  const [jornadaIdOverride, setJornadaIdOverride] = useState(null);

  useEffect(() => {
    if (open) {
      const hasSku = !!defaultSku;
      const hasCanal = !!defaultSubcanal;
      setStep(hasSku && hasCanal ? 3 : hasSku ? 2 : 1);
      setSku(defaultSku || skus[0]);
      setSearch('');
      setSubcanal(defaultSubcanal || '');
      setCantidad(1); setFecha(new Date().toISOString().slice(0,10));
      setNota(''); setScanning(false);
      setJornadaIdOverride(null);
    }
  }, [open, defaultSku, defaultSubcanal]);

  /* Reset override al cambiar de canal — la lista de jornadas abiertas cambia */
  useEffect(() => { setJornadaIdOverride(null); }, [subcanal]);

  /* simular scan QR */
  const startScan = () => {
    setScanning(true);
    setTimeout(() => {
      const detected = skus[Math.floor(Math.random()*skus.length)];
      setSku(detected);
      setScanning(false);
      toast.success(`QR detectado: ${detected}`);
    }, 1500);
  };

  /* faltante actual del SKU+canal seleccionados */
  const lineaPlan = M.prod.todos.table.find(r =>
    r.sku === sku && r.canal.toLowerCase().replace(' ','') === subcanal
  );
  const faltanteActual = lineaPlan?.faltante || 0;
  const overflow = cantidad > faltanteActual && faltanteActual > 0;
  const sinPlan = !lineaPlan && step === 3;

  const submit = async () => {
    setBusy(true);
    try {
      const log = await window.MOCK_ACTIONS.registrarProduccion({
        sku, subcanal, cantidad, nota,
        jornadaId: jornadaIdOverride || undefined,
      });
      onClose();
      toast.success(`${cantidad} × ${sku} → ${window.CARRIERS[subcanal]?.label}`, {
        dur: 5000,
        action: log?.id ? {
          label: 'Deshacer',
          onClick: async () => {
            try {
              await window.MOCK_ACTIONS.corregirLog({ logId: log.id, anular: true });
              toast.info('Carga deshecha');
            } catch (e) {
              toast.error('No se pudo deshacer · ' + (e.message || ''));
            }
          },
        } : undefined,
      });
    } catch (e) {
      toast.error(e.message || 'No se pudo registrar la producción');
    } finally {
      setBusy(false);
    }
  };

  const filtrados = skus.filter(s => {
    if (!search) return true;
    const q = search.toLowerCase();
    const info = window.SKU_DB[s];
    return s.toLowerCase().includes(q) || info.modelo.toLowerCase().includes(q) || (info.color||'').toLowerCase().includes(q);
  });

  const skuInfo = window.SKU_DB[sku] || {};

  return (
    <Modal open={open} onClose={onClose} title="Registrar producción" size="lg" footer={
      <>
        {step > 1 && <button className="btn-ghost" onClick={() => setStep(step - 1)}>Atrás</button>}
        <button className="btn-ghost" onClick={onClose}>Cancelar</button>
        {step < 3 && <button className="btn-primary" onClick={() => setStep(step + 1)} disabled={(step === 1 && !sku) || (step === 2 && !subcanal)}>Siguiente</button>}
        {step === 3 && (
          <button className="btn-primary" onClick={submit} disabled={busy || cantidad < 1}>
            {busy ? <span className="loader" style={{borderColor:'rgba(255,255,255,.3)', borderTopColor:'#fff'}}/> : <><Icon n="check" s={14}/> Confirmar registro</>}
          </button>
        )}
      </>
    }>
      {/* Stepper 3 pasos */}
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24, padding:'0 4px'}}>
        {['Producto','Canal','Cantidad'].map((lbl, i) => {
          const n = i + 1;
          const active = step === n;
          const done = step > n;
          return (
            <div key={lbl} style={{display:'flex', alignItems:'center', flex: i === 2 ? 0 : 1, gap:8}}>
              <div style={{
                width:24, height:24, borderRadius:'50%',
                background: done ? 'var(--green)' : active ? 'var(--ink)' : 'var(--paper-dim)',
                color: done || active ? '#fff' : 'var(--ink-muted)',
                fontSize:11, fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
              }}>{done ? <Icon n="check" s={12}/> : n}</div>
              <div style={{fontSize:11, fontWeight:700, color: active||done?'var(--ink)':'var(--ink-muted)', textTransform:'uppercase', letterSpacing:'.08em'}}>{lbl}</div>
              {i < 2 && <div style={{flex:1, height:1, background: done?'var(--green)':'var(--border)', margin:'0 8px'}}/>}
            </div>
          );
        })}
      </div>

      {/* Paso 1: SKU con QR + búsqueda */}
      {step === 1 && (
        <div>
          <label className="field-label">Identificá el producto</label>

          {/* fila QR + cámara */}
          <div style={{display:'flex', gap:8, marginBottom:14}}>
            <button className="btn-ghost" onClick={startScan} disabled={scanning} style={{flex:1, padding:'14px', justifyContent:'center', borderColor: scanning?'var(--accent)':undefined}}>
              {scanning ? (
                <><span className="loader"/> Escaneando QR…</>
              ) : (
                <><Icon n="qr" s={16}/> Escanear QR</>
              )}
            </button>
            <button className="btn-ghost" onClick={startScan} disabled={scanning} style={{padding:'14px', minWidth:48, justifyContent:'center'}} title="Usar cámara">
              <Icon n="camera" s={16}/>
            </button>
          </div>

          <div style={{position:'relative', marginBottom:10}}>
            <input
              className="field-input"
              placeholder="Buscar por SKU, modelo o color…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{paddingLeft:36}}
            />
            <span style={{position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', pointerEvents:'none', display:'flex'}}>
              <Icon n="search" s={14} c="var(--ink-muted)"/>
            </span>
          </div>

          <div style={{maxHeight:240, overflowY:'auto', border:'1px solid var(--border)', borderRadius:6, background:'var(--paper-off)'}}>
            {filtrados.length === 0 ? (
              <div style={{padding:20, textAlign:'center', fontSize:12, color:'var(--ink-muted)'}}>Sin resultados</div>
            ) : filtrados.map(s => {
              const info = window.SKU_DB[s];
              const sel = sku === s;
              return (
                <button key={s} onClick={() => setSku(s)} style={{
                  display:'flex', alignItems:'center', gap:12, width:'100%',
                  padding:'12px 14px',
                  border:'none',
                  borderLeft: sel ? '3px solid var(--ink)' : '3px solid transparent',
                  borderBottom:'1px solid var(--border)',
                  background: sel ? 'var(--ink)' : 'transparent',
                  color: sel ? '#fff' : 'var(--ink)',
                  cursor:'pointer', textAlign:'left',
                  transition:'background .15s, color .15s',
                }}>
                  <span style={{
                    minWidth:64,
                    fontFamily:'var(--mono)',
                    fontSize:11,
                    fontWeight:700,
                    letterSpacing:'.02em',
                    color: sel ? 'rgba(255,255,255,.8)' : 'var(--ink-muted)',
                  }}>{s}</span>
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{fontSize:12, fontWeight:600, color: sel ? '#fff' : 'var(--ink)'}}>{info.modelo}</div>
                    {info.color && info.color !== '—' && (
                      <div style={{fontSize:10, color: sel ? 'rgba(255,255,255,.7)' : 'var(--ink-muted)', marginTop:1, display:'flex', alignItems:'center', gap:5}}>
                        <span style={{width:7, height:7, borderRadius:'50%', background: info.colorHex || (info.color==='Negro'?'#1a1a1a':info.color==='Blanco'?'#fff':'#888'), border: sel ? '1px solid rgba(255,255,255,.4)' : '1px solid #d4cdc1', display:'inline-block'}}/>
                        {info.color} · {info.categoria}
                      </div>
                    )}
                  </div>
                  {sel && (
                    <div style={{
                      display:'flex', alignItems:'center', gap:5,
                      fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.08em',
                      padding:'4px 8px', borderRadius:10,
                      background:'rgba(255,255,255,.18)', color:'#fff',
                    }}>
                      <Icon n="check" s={11} c="#fff"/> Seleccionado
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Producto elegido — confirmación visible debajo de la lista */}
          {sku && window.SKU_DB[sku] && (
            <div style={{
              marginTop:12, padding:'10px 14px',
              background:'var(--paper)', border:'1px solid var(--ink)', borderRadius:6,
              display:'flex', alignItems:'center', gap:12,
            }}>
              <div style={{
                width:32, height:32, borderRadius:6,
                background:'var(--ink)', color:'#fff',
                display:'flex', alignItems:'center', justifyContent:'center',
                flexShrink:0,
              }}>
                <Icon n="check" s={16} c="#fff"/>
              </div>
              <div style={{flex:1, minWidth:0}}>
                <div style={{fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.08em', color:'var(--ink-muted)', marginBottom:2}}>Producto elegido</div>
                <div style={{fontSize:12, fontWeight:700}}>
                  <span style={{fontFamily:'var(--mono)', marginRight:8}}>{sku}</span>
                  {window.SKU_DB[sku].modelo}
                  {window.SKU_DB[sku].color && window.SKU_DB[sku].color !== '—' && (
                    <span style={{fontWeight:500, color:'var(--ink-muted)', marginLeft:6}}>· {window.SKU_DB[sku].color}</span>
                  )}
                </div>
              </div>
              <button type="button" onClick={() => setSku('')} className="btn-ghost" style={{padding:'4px 8px', fontSize:10}}>
                Cambiar
              </button>
            </div>
          )}
        </div>
      )}

      {/* Paso 2: canal */}
      {step === 2 && (
        <div>
          <label className="field-label">Canal de destino</label>
          <div className="radio-card-group">
            {[
              { v:'colecta', l:'Colecta', s:'ML retiro 12hs', c:'#6366f1' },
              { v:'flex',    l:'Flex',    s:'ML retiro 14hs', c:'#15803d' },
              { v:'tiendanube', l:'Tienda Nube', s:'Web propia', c:'#2563eb' },
              { v:'distribuidor', l:'Distribuidor', s:'Mayorista', c:'#d97706' },
              { v:'no_flex', l:'No Flex', s:'Logística inversa', c:'#db2777' },
              { v:'correo_argentino', l:'Correo Arg.', s:'Logística inversa', c:'#0891b2' },
            ].map(o => (
              <label key={o.v} className={`radio-card ${subcanal===o.v?'selected':''}`} style={{'--sel-color':o.c, '--sel-bg':`${o.c}1a`}}>
                <input type="radio" checked={subcanal===o.v} onChange={() => setSubcanal(o.v)}/>
                <div className="radio-card-dot"/>
                <div className="radio-card-info">
                  <div className="radio-card-label">{o.l}</div>
                  <div className="radio-card-sub">{o.s}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Paso 3: cantidad + fecha + nota + resumen */}
      {step === 3 && (
        <div>
          {/* Selector de jornada — solo si hay 2+ abiertas globalmente.
              Cambio 2A/2B: las jornadas son globales (no por canal).
              Default = la activa (RPC la elige sin que el usuario haga click). */}
          {(() => {
            const abiertas = M.jornadas?.abiertas || [];
            const activaId = M.jornadas?.activaId;
            if (abiertas.length < 2) return null;
            const selectedId = jornadaIdOverride || activaId || abiertas[0]?.id;
            return (
              <div style={{marginBottom:14, padding:'10px 12px', background:'#fef3c7', border:'1px solid #fbbf24', borderRadius:6}}>
                <div style={{fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.08em', color:'var(--ink-muted)', marginBottom:6}}>
                  Hay {abiertas.length} jornadas abiertas — elegí a cuál cargar
                </div>
                <select
                  className="field-input"
                  value={selectedId || ''}
                  onChange={e => setJornadaIdOverride(e.target.value)}
                  style={{fontSize:12, fontWeight:600}}
                >
                  {abiertas.map(j => (
                    <option key={j.id} value={j.id}>
                      {fmt.date(j.fecha)} {j.id === activaId ? '· ACTIVA' : ''}
                    </option>
                  ))}
                </select>
              </div>
            );
          })()}

          <label className="field-label">Cantidad producida</label>
          <div style={{display:'flex', gap:6, alignItems:'center'}}>
            <button onClick={() => setCantidad(Math.max(1, cantidad-1))} className="btn-ghost" style={{padding:'10px 14px', fontSize:18, lineHeight:1}}>−</button>
            <input type="number" min="1" value={cantidad} onChange={e => setCantidad(Math.max(1, parseInt(e.target.value)||1))} className="qty-input"/>
            <button onClick={() => setCantidad(cantidad+1)} className="btn-ghost" style={{padding:'10px 14px', fontSize:18, lineHeight:1}}>+</button>
          </div>

          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginTop:14}}>
            <div>
              <label className="field-label">Fecha</label>
              <input type="date" className="field-input" value={fecha} onChange={e => setFecha(e.target.value)}/>
            </div>
            <div>
              <label className="field-label">Nota interna (opcional)</label>
              <input className="field-input" placeholder="Ej: lote especial" value={nota} onChange={e => setNota(e.target.value)}/>
            </div>
          </div>

          {/* Validaciones contextuales */}
          {sinPlan && (
            <div style={{marginTop:14, padding:'10px 12px', background:'var(--amber-bg)', border:'1px solid var(--amber)', borderRadius:6, fontSize:11, color:'var(--ink-soft)', display:'flex', gap:8, alignItems:'flex-start'}}>
              <Icon n="alert" s={14} c="var(--amber)"/>
              <span>Este SKU no tiene pedidos activos en <strong>{window.CARRIERS[subcanal]?.label}</strong>. Se va a registrar como producción adelantada (stock).</span>
            </div>
          )}
          {overflow && (
            <div style={{marginTop:14, padding:'10px 12px', background:'#fff3e0', border:'1px solid var(--amber)', borderRadius:6, fontSize:11, color:'var(--ink-soft)', display:'flex', gap:8, alignItems:'flex-start'}}>
              <Icon n="alert" s={14} c="var(--amber)"/>
              <span>El faltante de este SKU en <strong>{window.CARRIERS[subcanal]?.label}</strong> es <strong>{faltanteActual}</strong>. Vas a registrar <strong>{cantidad - faltanteActual}</strong> uds. de más como sobrante.</span>
            </div>
          )}

          {/* Resumen */}
          <div style={{marginTop:16, padding:14, background:'var(--paper-off)', border:'1px solid var(--border)', borderRadius:6}}>
            <div style={{fontSize:9, fontWeight:700, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--ink-muted)', marginBottom:8}}>Resumen</div>
            <div style={{fontSize:12, lineHeight:1.7}}>
              <div><strong style={{fontFamily:'var(--mono)'}}>{cantidad}×</strong> {sku} — {skuInfo.modelo} {skuInfo.color && skuInfo.color!=='—' ? skuInfo.color : ''}</div>
              <div>Canal: <strong style={{textTransform:'capitalize'}}>{window.CARRIERS[subcanal]?.label}</strong></div>
              <div>Fecha: <strong>{fecha}</strong></div>
              {!sinPlan && lineaPlan && (
                <div style={{marginTop:6, paddingTop:6, borderTop:'1px dashed var(--border)', fontSize:11, color:'var(--ink-muted)'}}>
                  Plan actual: {lineaPlan.producido}/{lineaPlan.pedido} · Faltante: <strong style={{color: lineaPlan.faltante>0?'var(--red)':'var(--green)'}}>{lineaPlan.faltante}</strong>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ── Importar Excel — selector canal + preview ── */
function ImportModal({ open, onClose, channel: defaultChannel }) {
  const toast = useToast();
  const M = window.useMockData();
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  // Default vacio en lugar de 'colecta' — consistencia con ProduceModal.
  // El autodetect por filename (onPickFile) y por contenido del Excel
  // (extractOrders.canalDetectado) sigue activo y setea channel cuando
  // corresponda. Si ni se pasa defaultChannel ni se detecta canal, el
  // operario tiene que elegir explicitamente antes de poder importar.
  const [channel, setChannel] = useState(defaultChannel || '');
  // Cambio 2B: la importación se hace contra la jornada seleccionada (o la
  // activa si seleccionada === activa). Si no hay ninguna jornada abierta,
  // bloqueamos el submit con banner explícito.
  const jornadaDestinoId = M.jornadas?.seleccionadaId || M.jornadas?.activaId || null;
  const jornadaDestino   = (M.jornadas?.abiertas || []).find(j => j.id === jornadaDestinoId);
  const [detected, setDetected] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState(null);
  const [orders, setOrders] = useState([]);
  const [tipo, setTipo] = useState(null);

  useEffect(() => {
    if (!open) {
      setFile(null); setProgress(0); setBusy(false); setDetected(null);
      setOrders([]); setParseError(null); setTipo(null);
    }
    if (open && defaultChannel) setChannel(defaultChannel);
  }, [open, defaultChannel]);

  /* SKUs no reconocidos */
  const skuDesconocidos = orders.filter(o => !window.SKU_DB[o.sku]).map(o => o.sku);
  const skusUnicos = [...new Set(skuDesconocidos)];
  const totalUnidades = orders.reduce((s,o) => s + o.cantidad, 0);

  const onPickFile = async (f) => {
    setFile(f);
    setOrders([]); setParseError(null); setDetected(null); setTipo(null);
    if (!f) return;

    setParsing(true);
    try {
      const rows = await window.parseXLSX(f);
      const result = window.extractOrders(rows);
      setOrders(result.orders);
      setTipo(result.tipo);
      // Auto-seleccionar canal según contenido o nombre
      const name = f.name.toLowerCase();
      if (result.canalDetectado) {
        setChannel(result.canalDetectado);
        setDetected(`MercadoLibre · ${result.canalDetectado === 'colecta' ? 'Colecta' : 'Flex'} (${result.orders.length} pedidos)`);
      } else if (name.includes('flex')) {
        setChannel('flex'); setDetected(`MercadoLibre · Flex (${result.orders.length} pedidos)`);
      } else if (name.includes('colecta') || name.includes('ml')) {
        setChannel('colecta'); setDetected(`MercadoLibre · Colecta (${result.orders.length} pedidos)`);
      } else if (name.includes('tn') || name.includes('tiendanube')) {
        setChannel('tiendanube'); setDetected(`Tienda Nube (${result.orders.length} pedidos)`);
      } else {
        setDetected(`Genérico (${result.orders.length} pedidos)`);
      }
      if (result.orders.length === 0) {
        setParseError('No se encontraron pedidos. Verificá que la planilla tenga columnas "SKU" y "Unidades".');
      }
    } catch (e) {
      setParseError('No se pudo leer el archivo: ' + e.message);
    }
    setParsing(false);
  };

  const submit = async () => {
    if (!file || !orders.length) return;
    setBusy(true);
    setProgress(20);
    try {
      // Filtrar SKUs reconocidos para no romper la FK del backend.
      // Pasamos `estado` para que importarLote filtre cancelados.
      const items = orders
        .filter(o => window.SKU_DB[o.sku])
        .map(o => ({
          sku: o.sku,
          cantidad: o.cantidad,
          order_number: o.numero,
          cliente: o.cliente,
          fecha_pedido: o.fecha,
          estado: o.estado,
        }));
      const ignorados = orders.length - items.length;
      setProgress(50);
      const result = await window.MOCK_ACTIONS.importarLote({
        channelId: channel,
        filename: file.name,
        items,
        targetJornadaId: jornadaDestinoId,
      });
      setProgress(100);
      onClose();
      const cancelados = result?.cancelled_count_local ?? result?.cancelled_count ?? 0;
      const canalLabel = window.CARRIERS[channel]?.label;
      // Caso extremo: todos cancelados — no se procesó el archivo.
      if (result?.skipped_all) {
        toast.success(`${file.name} · ${cancelados} saltado(s) por cancelados · archivo no procesado`);
      } else {
        const aplicados = result?.unidades_count ?? items.reduce((s, o) => s + o.cantidad, 0);
        const partes = [`${file.name} importado · ${aplicados} uds. aplicadas a ${canalLabel}`];
        if (cancelados > 0) partes.push(`${cancelados} saltado(s) por cancelados`);
        if (ignorados > 0)  partes.push(`${ignorados} con SKU desconocido`);
        toast.success(partes.join(' · '));
      }
    } catch (e) {
      toast.error(e.message || 'No se pudo importar el lote');
    } finally {
      setBusy(false);
    }
  };

  const C = window.CARRIERS[channel] || { label: 'Canal' };
  const previewRows = orders.slice(0, 8);

  return (
    <Modal open={open} onClose={onClose} title="Importar ventas desde Excel" size="lg" footer={
      <>
        <button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" onClick={submit} disabled={!file || !orders.length || busy || parsing || !channel || !jornadaDestino}>
          {busy ? <span className="loader" style={{borderColor:'rgba(255,255,255,.3)', borderTopColor:'#fff'}}/> : <><Icon n="upload" s={14}/> Importar {orders.length>0 ? `${orders.length} pedidos` : ''} a {C.label}</>}
        </button>
      </>
    }>
      {/* Banner jornada destino — Cambio 2B */}
      <div style={{padding:'8px 12px', background: jornadaDestino ? 'var(--green-bg)' : 'var(--red-bg)',
                   border: '1px solid ' + (jornadaDestino ? 'rgba(22,163,74,.32)' : 'rgba(220,38,38,.32)'),
                   borderRadius:6, marginBottom:14, fontSize:11, color: jornadaDestino ? 'var(--green)' : 'var(--red)'}}>
        {jornadaDestino
          ? <>Jornada destino: <strong>{fmt.date(jornadaDestino.fecha)}</strong>{jornadaDestino.id === M.jornadas?.activaId ? ' (activa)' : ''}</>
          : <><Icon n="alert" s={12}/> No hay jornadas abiertas — abrí una desde el Dashboard antes de importar.</>}
      </div>

      {/* Selector canal */}
      <label className="field-label">Canal de destino</label>
      <div className="radio-card-group" style={{marginBottom:14}}>
        {[
          { v:'colecta', l:'Colecta', c:'#6366f1' },
          { v:'flex', l:'Flex', c:'#15803d' },
          { v:'tiendanube', l:'Tienda Nube', c:'#2563eb' },
          { v:'distribuidor', l:'Distribuidor', c:'#d97706' },
          { v:'no_flex', l:'No Flex', c:'#db2777' },
          { v:'correo_argentino', l:'Correo Arg.', c:'#0891b2' },
        ].map(o => (
          <label key={o.v} className={`radio-card ${channel===o.v?'selected':''}`} style={{'--sel-color':o.c, '--sel-bg':`${o.c}1a`}}>
            <input type="radio" checked={channel===o.v} onChange={() => setChannel(o.v)}/>
            <div className="radio-card-dot"/>
            <div className="radio-card-info">
              <div className="radio-card-label">{o.l}</div>
            </div>
          </label>
        ))}
      </div>

      {/* Dropzone */}
      <label htmlFor="file-input" style={{
        display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
        padding:'28px 20px', border:'2px dashed var(--border-str)', borderRadius:8, cursor:'pointer',
        background:'var(--paper-off)', textAlign:'center', gap:8,
      }}>
        <Icon n={parsing?'loader':file?'check-circle':'upload'} s={28} c={file?'var(--green)':'var(--ink-muted)'}/>
        <div style={{fontSize:13, fontWeight:700}}>{parsing ? 'Leyendo archivo…' : file ? file.name : 'Seleccionar archivo .xlsx / .csv'}</div>
        <div style={{fontSize:11, color:'var(--ink-muted)'}}>{file ? `${Math.round(file.size/1024)} KB` : 'Arrastrá o hacé clic'}</div>
        <input id="file-input" type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}} onChange={e => onPickFile(e.target.files?.[0] || null)}/>
      </label>

      {/* Error parseo */}
      {parseError && (
        <div style={{marginTop:12, padding:'10px 12px', background:'var(--red-bg)', border:'1px solid rgba(220,38,38,.3)', borderRadius:6, fontSize:12, color:'var(--red)', display:'flex', gap:8, alignItems:'flex-start'}}>
          <Icon n="alert" s={14}/>
          <span>{parseError}</span>
        </div>
      )}

      {/* SKUs desconocidos */}
      {orders.length > 0 && skusUnicos.length > 0 && (
        <div style={{marginTop:12, padding:'10px 12px', background:'var(--amber-bg)', border:'1px solid rgba(217,119,6,.3)', borderRadius:6, fontSize:12, color:'var(--amber)', display:'flex', gap:8, alignItems:'flex-start'}}>
          <Icon n="alert" s={14}/>
          <span><strong>{skusUnicos.length} SKU{skusUnicos.length>1?'s':''} no reconocido{skusUnicos.length>1?'s':''}:</strong> {skusUnicos.slice(0,5).join(', ')}{skusUnicos.length>5?'…':''}. Se ignorarán al importar. Agregalos al catálogo si querés que se procesen.</span>
        </div>
      )}

      {/* Preview */}
      {orders.length > 0 && (
        <div style={{marginTop:14}}>
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8}}>
            <div style={{fontSize:11, fontWeight:700, color:'var(--ink-muted)', textTransform:'uppercase', letterSpacing:'.1em'}}>
              Preview · {previewRows.length} de {orders.length} pedidos · {totalUnidades} uds. totales
            </div>
            {detected && (
              <span style={{fontSize:10, fontWeight:700, padding:'3px 10px', borderRadius:10, background:'var(--accent-bg)', color:'var(--accent)', textTransform:'uppercase', letterSpacing:.4}}>
                {detected}
              </span>
            )}
          </div>
          <table className="data-table" style={{borderRadius:6, overflow:'hidden', border:'1px solid var(--border)'}}>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Producto (resuelto)</th>
                <th style={{textAlign:'right'}}>Cantidad</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((r,i) => {
                const known = !!window.SKU_DB[r.sku];
                return (
                  <tr key={i} style={{opacity: known ? 1 : .55}}>
                    <td><span className="order-num">{r.sku}</span></td>
                    <td style={{fontSize:11, color:'var(--ink-soft)'}}>
                      {known ? window.skuName(r.sku) : <em style={{color:'var(--amber)'}}>SKU no reconocido</em>}
                    </td>
                    <td style={{textAlign:'right'}}><span className="cell-color-num">{r.cantidad}</span></td>
                    <td style={{width:1, textAlign:'right'}}>
                      {known
                        ? <Icon n="check-circle" s={14} c="var(--green)"/>
                        : <Icon n="alert" s={14} c="var(--amber)"/>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{marginTop:8, fontSize:11, color:'var(--ink-muted)'}}>
            El sistema usa el <strong>SKU</strong> para identificar producto, color y variante automáticamente.
          </div>
        </div>
      )}

      {busy && (
        <div style={{marginTop:14}}>
          <div style={{height:6, background:'var(--paper-dim)', borderRadius:3, overflow:'hidden'}}>
            <div style={{height:'100%', width:`${progress}%`, background:'var(--ink)', transition:'width .1s'}}/>
          </div>
          <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:6, textAlign:'center'}}>{progress}% — Aplicando pedidos…</div>
        </div>
      )}
    </Modal>
  );
}

/* ── Cierre de jornada GLOBAL (Cambio 2A/2B) ──
   Cierra el día completo (todos los canales). Recibe `jornadaId` desde
   el dashboard (es la jornada seleccionada por el usuario). El preview
   se agrupa por canal y suma totales globales. El RPC v6 ignora
   p_channel_id (shim) y genera snapshot agrupado por (channel_id, sku). */
function CierreModal({ open, onClose, onConfirm, jornadaId }) {
  const M = window.useMockData();
  const abiertas = M.jornadas?.abiertas || [];
  const jornada = abiertas.find(j => j.id === jornadaId);
  const fechaCierre = jornada?.fecha;
  const esActiva = jornadaId === M.jornadas?.activaId;

  if (!open) return null;

  // Filas por (canal, sku) — replica la fórmula del RPC v6.
  // pedido es transversal (suma orders pendientes/arrastradas del canal).
  // producido se filtra por jornada_id.
  const canalesIds = ['colecta','flex','tiendanube','distribuidor','no_flex','correo_argentino'];
  const filas = [];   // [{ channel, sku, pedido, producido, faltante, stock }]
  let totalPedido = 0, totalProducido = 0, totalFaltante = 0;

  for (const cid of canalesIds) {
    const orders = M.carriers[cid]?.orders || [];
    const pedidoMap = {};
    for (const o of orders) pedidoMap[o.sku] = (pedidoMap[o.sku] || 0) + (o.cantidad || 0);

    const prodMap = {};
    for (const l of (M.prodLogs || [])) {
      if (l.subcanal !== cid || l.jornadaId !== jornadaId) continue;
      prodMap[l.sku] = (prodMap[l.sku] || 0) + (l.unidades || 0);
    }

    const skus = Array.from(new Set([...Object.keys(pedidoMap), ...Object.keys(prodMap)])).sort();
    for (const sku of skus) {
      const pedido    = pedidoMap[sku] || 0;
      const producido = prodMap[sku]   || 0;
      if (pedido === 0 && producido === 0) continue;
      const faltante = Math.max(0, pedido - producido);
      const stock    = Math.max(0, producido - pedido);
      filas.push({ channel: cid, sku, pedido, producido, faltante, stock });
      totalPedido    += pedido;
      totalProducido += producido;
      totalFaltante  += faltante;
    }
  }

  const handleConfirm = () => {
    onConfirm?.({ fecha: fechaCierre, jornadaId });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={`Cerrar jornada del ${fechaCierre ? fmt.date(fechaCierre) : '—'}`} size="lg" footer={
      <>
        <button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn-success" onClick={handleConfirm} disabled={!fechaCierre || !jornada}>
          <Icon n="lock" s={14}/> Confirmar cierre
        </button>
      </>
    }>
      {!jornada ? (
        <div style={{padding:'12px 14px', background:'var(--red-bg)', border:'1px solid rgba(220,38,38,.32)', borderRadius:6, color:'var(--red)', fontSize:12}}>
          La jornada seleccionada no está disponible. Volvé al dashboard.
        </div>
      ) : (
        <>
          <div style={{fontSize:12, color:'var(--ink-soft)', lineHeight:1.6, marginBottom:12}}>
            Vas a guardar un <strong>snapshot inmutable</strong> de toda la jornada del <strong>{fmt.date(fechaCierre)}</strong> (todos los canales).
          </div>

          <div style={{padding:'10px 12px', background:'var(--paper-off)', border:'1px solid var(--border)', borderRadius:6, marginBottom:14, fontSize:11, color:'var(--ink-soft)', lineHeight:1.6}}>
            <div style={{fontSize:9, fontWeight:700, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--ink-muted)', marginBottom:6}}>Qué pasa al cerrar</div>
            <div>✓ Los pedidos <strong>completados</strong> de todos los canales se archivan en el histórico.</div>
            <div>✓ El <strong>faltante</strong> se arrastra al día siguiente como nueva línea.</div>
            <div>✓ Se genera un snapshot que <strong>no se puede modificar</strong>.</div>
            <div>✓ El <strong>sobrante</strong> (si lo hay) se transfiere automáticamente al <strong>Stock central</strong>.</div>
            {esActiva && abiertas.length >= 2 && (
              <div>✓ La marca <strong>activa para producción</strong> pasa a la siguiente jornada abierta automáticamente.</div>
            )}
          </div>

          <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, marginBottom:14}}>
            <div className="stat-card" style={{padding:12}}>
              <div style={{fontSize:9, fontWeight:700, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--ink-muted)', marginBottom:4}}>Pedidos</div>
              <div style={{fontFamily:'var(--mono)', fontSize:22, fontWeight:700}}>{totalPedido}</div>
            </div>
            <div className="stat-card" style={{padding:12}}>
              <div style={{fontSize:9, fontWeight:700, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--ink-muted)', marginBottom:4}}>Producido</div>
              <div style={{fontFamily:'var(--mono)', fontSize:22, fontWeight:700}}>{totalProducido}</div>
            </div>
            <div className="stat-card" style={{padding:12, borderLeft: totalFaltante>0?'3px solid var(--red)':'3px solid var(--green)'}}>
              <div style={{fontSize:9, fontWeight:700, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--ink-muted)', marginBottom:4}}>Arrastra</div>
              <div style={{fontFamily:'var(--mono)', fontSize:22, fontWeight:700, color: totalFaltante>0?'var(--red)':'var(--green)'}}>{totalFaltante}</div>
            </div>
          </div>

          <div style={{fontSize:11, fontWeight:700, color:'var(--ink-muted)', textTransform:'uppercase', letterSpacing:'.1em', marginBottom:8}}>
            Snapshot por canal
          </div>
          {filas.length === 0 ? (
            <div style={{padding:14, textAlign:'center', fontSize:12, color:'var(--ink-muted)', border:'1px dashed var(--border)', borderRadius:6}}>
              Sin pedidos ni producción para esta jornada.
            </div>
          ) : (
            canalesIds.map(cid => {
              const filasCanal = filas.filter(f => f.channel === cid);
              if (filasCanal.length === 0) return null;
              const C = window.CARRIERS[cid] || { label: cid, color: '#888' };
              return (
                <div key={cid} style={{marginBottom:14}}>
                  <div style={{fontSize:11, fontWeight:700, color:C.color, marginBottom:6, textTransform:'uppercase', letterSpacing:'.06em'}}>
                    {C.label}
                  </div>
                  <table className="data-table" style={{borderRadius:6, overflow:'hidden', border:'1px solid var(--border)'}}>
                    <thead>
                      <tr>
                        <th>SKU</th>
                        <th>Producto</th>
                        <th style={{textAlign:'right'}}>Pedido</th>
                        <th style={{textAlign:'right'}}>Producido</th>
                        <th style={{textAlign:'right'}}>Arrastra</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filasCanal.map(r => (
                        <tr key={cid + '|' + r.sku}>
                          <td><span className="order-num">{r.sku}</span></td>
                          <td style={{fontSize:11, color:'var(--ink-soft)'}}>{window.skuName(r.sku)}</td>
                          <td style={{textAlign:'right'}}><span className="cell-color-num">{r.pedido}</span></td>
                          <td style={{textAlign:'right'}}><span className="cell-color-num" style={{color:'var(--green)'}}>{r.producido}</span></td>
                          <td style={{textAlign:'right'}}>
                            {r.faltante > 0
                              ? <span className="cell-faltante-red">{r.faltante}</span>
                              : <span className="cell-faltante-ok"><Icon n="check" s={12}/></span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })
          )}
        </>
      )}
    </Modal>
  );
}

/* ── Confirm modal genérico ── */
function ConfirmModal({ open, onClose, onConfirm, title, message, confirmText, danger }) {
  return (
    <Modal open={open} onClose={onClose} title={title} footer={
      <>
        <button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button className={danger?'btn-danger':'btn-primary'} onClick={() => { onConfirm?.(); onClose(); }}>
          <Icon n="check" s={14}/> {confirmText || 'Confirmar'}
        </button>
      </>
    }>
      <div style={{fontSize:13, color:'var(--ink-soft)', lineHeight:1.6}}>{message}</div>
    </Modal>
  );
}

/* ════════════════════════════════════════════════════════════════
   ManualOrderModal — carrito de carga manual
   Solo se renderiza cuando window.FEATURE_PEDIDOS_MANUALES === true
   (CarrierPage controla el trigger).
   ════════════════════════════════════════════════════════════════ */
function ManualOrderModal({ open, onClose, channel }) {
  const toast = useToast();
  const M = window.useMockData();
  const C = window.CARRIERS[channel] || {};
  const data = M.carriers[channel];
  // Cambio 2A/2B: jornada es global. La activa = la que recibe la carga.
  const activaId = M.jornadas?.activaId;
  const activa = (M.jornadas?.abiertas || []).find(j => j.id === activaId);

  const [orderNumber, setOrderNumber] = useState('');
  const [cliente, setCliente]         = useState('');
  const [motivo, setMotivo]           = useState('');
  const [items, setItems]             = useState([{ sku: '', cantidad: 1 }]);
  const [busy, setBusy]               = useState(false);
  const [activeRow, setActiveRow]     = useState(0);
  const [confirmMerge, setConfirmMerge] = useState(null); // {existingCount}

  useEffect(() => {
    if (open) {
      setOrderNumber(''); setCliente(''); setMotivo('');
      setItems([{ sku: '', cantidad: 1 }]);
      setBusy(false); setConfirmMerge(null);
    }
  }, [open]);

  /* Listener para refrescar cuando se crea un SKU al vuelo */
  const onCreatedRef = useRef(null);
  useEffect(() => {
    onCreatedRef.current = (sku) => {
      // Preselecciona el SKU recien creado en la fila activa
      setItems(prev => prev.map((r, i) => i === activeRow ? { ...r, sku } : r));
    };
  }, [activeRow]);

  const addRow = () => setItems(s => [...s, { sku: '', cantidad: 1 }]);
  const removeRow = (idx) => setItems(s => s.length > 1 ? s.filter((_, i) => i !== idx) : s);
  const updateRow = (idx, patch) => setItems(s => s.map((r, i) => i === idx ? { ...r, ...patch } : r));

  const skusCatalog = Object.keys(window.SKU_DB);
  const totalUnits = items.reduce((s, r) => s + (parseInt(r.cantidad, 10) || 0), 0);
  const validItems = items.filter(r => r.sku && (parseInt(r.cantidad, 10) || 0) > 0);

  const submit = async (forceMerge = false) => {
    if (!validItems.length) { toast.error('Agregá al menos un item con SKU y cantidad'); return; }
    if (!activa) { toast.error('No hay jornada activa — abrí una desde el Dashboard antes de cargar pedidos.'); return; }

    setBusy(true);
    try {
      const result = await window.MOCK_ACTIONS.crearPedidoManual({
        channelId: channel,
        orderNumber: orderNumber.trim() || undefined,
        cliente: cliente.trim() || undefined,
        items: validItems.map(r => ({ sku: r.sku.toUpperCase(), cantidad: parseInt(r.cantidad, 10) })),
        motivo: motivo.trim() || undefined,
        forceMerge,
      });
      toast.success('Pedido cargado · ' + result.order_number);
      onClose();
    } catch (e) {
      const msg = e.message || '';
      // Caso colision: ofrecer merge
      if (msg.includes('ya existe en') && msg.includes('items')) {
        const m = msg.match(/(\d+) items/);
        setConfirmMerge({ existingCount: m ? parseInt(m[1], 10) : 0 });
      } else {
        toast.error(msg || 'No se pudo cargar el pedido');
      }
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title={`Cargar pedido manual — ${C.label || channel}`} size="lg" footer={
      <>
        <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn-primary" onClick={() => submit(false)} disabled={busy || !validItems.length}>
          {busy ? <span className="loader" style={{borderColor:'rgba(255,255,255,.3)', borderTopColor:'#fff'}}/>
                : <><Icon n="check" s={14}/> Confirmar pedido</>}
        </button>
      </>
    }>
      {/* Info de jornada destino */}
      <div style={{padding:'8px 12px', background: activa ? 'var(--green-bg)' : 'var(--red-bg)',
                   border: '1px solid ' + (activa ? 'rgba(22,163,74,.32)' : 'rgba(220,38,38,.32)'),
                   borderRadius:6, marginBottom:14, fontSize:11, color: activa ? 'var(--green)' : 'var(--red)'}}>
        {activa
          ? <>Jornada destino: <strong>{fmt.date(activa.fecha)}</strong> (activa)</>
          : <><Icon n="alert" s={12}/> No hay jornada activa. Pedíle al encargado que abra una desde el Dashboard.</>}
      </div>

      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14}}>
        <div>
          <label className="field-label">N° de pedido (opcional)</label>
          <input className="field-input" value={orderNumber} onChange={e => setOrderNumber(e.target.value)}
                 placeholder="Autogenerar (MAN-...)" style={{fontFamily:'var(--mono)'}}/>
        </div>
        <div>
          <label className="field-label">Cliente (opcional)</label>
          <input className="field-input" value={cliente} onChange={e => setCliente(e.target.value)}
                 placeholder="Nombre del cliente"/>
        </div>
      </div>

      <div style={{marginBottom:8, fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.08em', color:'var(--ink-muted)'}}>
        Items del pedido
      </div>
      <div style={{display:'flex', flexDirection:'column', gap:8, marginBottom:10}}>
        {items.map((r, idx) => {
          const skuExists = r.sku && skusCatalog.includes(r.sku.toUpperCase());
          const skuTipeado = (r.sku || '').toUpperCase().trim();
          return (
            <div key={idx} style={{display:'grid', gridTemplateColumns:'1fr 100px auto', gap:8, alignItems:'flex-end'}}>
              <div>
                <input
                  list={`skus-${idx}`}
                  className="field-input"
                  value={r.sku}
                  onChange={e => updateRow(idx, { sku: e.target.value.toUpperCase() })}
                  onFocus={() => setActiveRow(idx)}
                  placeholder="SKU (ej: MAD050)"
                  style={{fontFamily:'var(--mono)'}}
                />
                <datalist id={`skus-${idx}`}>
                  {skusCatalog.map(s => {
                    const info = window.SKU_DB[s];
                    return <option key={s} value={s}>{info.modelo}{info.color && info.color !== '—' ? ' · ' + info.color : ''}</option>;
                  })}
                </datalist>
                {skuExists && (
                  <div style={{fontSize:10, color:'var(--ink-muted)', marginTop:2}}>
                    {window.skuName(r.sku.toUpperCase())}
                  </div>
                )}
                {!skuExists && skuTipeado && (
                  <button type="button" className="btn-ghost" style={{padding:'3px 8px', fontSize:10, marginTop:4}}
                          onClick={() => {
                            setActiveRow(idx);
                            window.openProductoEditModal?.({
                              newSku: skuTipeado, incompleto: true,
                              onCreated: (created) => onCreatedRef.current?.(created),
                            });
                          }}>
                    <Icon n="plus" s={10}/> Crear SKU "{skuTipeado}"
                  </button>
                )}
              </div>
              <input type="number" min="1" className="field-input" value={r.cantidad}
                     onChange={e => updateRow(idx, { cantidad: e.target.value })}/>
              <button type="button" className="btn-ghost" style={{padding:'8px 10px'}}
                      onClick={() => removeRow(idx)} disabled={items.length === 1} title="Quitar item">
                <Icon n="x" s={14}/>
              </button>
            </div>
          );
        })}
      </div>

      <button type="button" className="btn-ghost" onClick={addRow} style={{fontSize:11}}>
        <Icon n="plus" s={12}/> Agregar item
      </button>

      <div style={{marginTop:14}}>
        <label className="field-label">Motivo (opcional)</label>
        <input className="field-input" value={motivo} onChange={e => setMotivo(e.target.value)}
               placeholder="Ej: WSP cliente directo"/>
      </div>

      <div style={{marginTop:14, padding:10, background:'var(--paper-off)', border:'1px solid var(--border)', borderRadius:6, fontSize:12}}>
        <strong>{validItems.length} item{validItems.length === 1 ? '' : 's'}</strong> · <strong>{totalUnits} unidades</strong> totales
      </div>

      {/* Sub-modal de confirmación de merge */}
      {confirmMerge && (
        <Modal open={true} onClose={() => setConfirmMerge(null)} title="Número de pedido ya existe" footer={
          <>
            <button className="btn-ghost" onClick={() => setConfirmMerge(null)}>Cambiar número</button>
            <button className="btn-primary" onClick={() => { setConfirmMerge(null); submit(true); }}>
              Agregar al pedido existente
            </button>
          </>
        }>
          <div style={{fontSize:13, color:'var(--ink-soft)', lineHeight:1.6}}>
            El número <strong>{orderNumber}</strong> ya existe en {C.label} con <strong>{confirmMerge.existingCount}</strong> items.
            ¿Querés agregar estos items al mismo pedido o usar otro número?
          </div>
        </Modal>
      )}
    </Modal>
  );
}

/* ════════════════════════════════════════════════════════════════
   OrderEditModal — edición full-screen de un pedido existente
   ════════════════════════════════════════════════════════════════ */
function OrderEditModal({ open, onClose, channel, orderNumber }) {
  const toast = useToast();
  const M = window.useMockData();
  const C = window.CARRIERS[channel] || {};
  const data = M.carriers[channel];

  // Items del pedido (snapshot al abrir)
  const itemsOriginales = (data?.orders || []).filter(o => o.numero === orderNumber);
  // Cambio 2A/2B: historial es global (M.jornadas.historial), no por canal.
  const jornadaIdPedido = itemsOriginales[0]?.jornadaId;
  const jornadaCerrada  = (M.jornadas?.historial || []).find(c => c.id === jornadaIdPedido);
  const isClosed        = !!jornadaCerrada;
  const cliente         = itemsOriginales[0]?.cliente || '';

  // State editable
  const [drafts, setDrafts]       = useState({}); // {sku: {cantidad, version, removed?: bool}}
  const [agregar, setAgregar]     = useState([]); // [{sku, cantidad}]
  const [motivo, setMotivo]       = useState('');
  const [busy, setBusy]           = useState(false);

  useEffect(() => {
    if (open) {
      const d = {};
      for (const it of itemsOriginales) {
        d[it.sku] = { cantidad: it.cantidad, version: it.version, removed: false };
      }
      setDrafts(d);
      setAgregar([]);
      setMotivo('');
      setBusy(false);
    }
  }, [open, orderNumber]);

  const updateDraft = (sku, patch) => setDrafts(prev => ({ ...prev, [sku]: { ...prev[sku], ...patch } }));
  const toggleRemove = (sku) => setDrafts(prev => ({ ...prev, [sku]: { ...prev[sku], removed: !prev[sku]?.removed } }));
  const addNew = () => setAgregar(s => [...s, { sku: '', cantidad: 1 }]);
  const removeNew = (idx) => setAgregar(s => s.filter((_, i) => i !== idx));
  const updateNew = (idx, patch) => setAgregar(s => s.map((r, i) => i === idx ? { ...r, ...patch } : r));

  // Calcular cambios pendientes
  const cambios = (() => {
    const modificar = [];
    const quitar = [];
    for (const it of itemsOriginales) {
      const d = drafts[it.sku];
      if (!d) continue;
      if (d.removed) {
        quitar.push({ sku: it.sku, version: it.version });
      } else if (parseInt(d.cantidad, 10) !== it.cantidad) {
        modificar.push({ sku: it.sku, cantidad_nueva: parseInt(d.cantidad, 10), version: it.version });
      }
    }
    const agregarValid = agregar.filter(r => r.sku && (parseInt(r.cantidad, 10) || 0) > 0)
      .map(r => ({ sku: r.sku.toUpperCase(), cantidad: parseInt(r.cantidad, 10) }));
    return { modificar, agregar: agregarValid, quitar };
  })();
  const totalCambios = cambios.modificar.length + cambios.agregar.length + cambios.quitar.length;

  const submit = async () => {
    if (totalCambios === 0) { toast.info('No hay cambios para aplicar'); return; }
    setBusy(true);
    try {
      await window.MOCK_ACTIONS.editarPedido({
        channelId: channel,
        orderNumber,
        cambios,
        motivo: motivo.trim() || undefined,
      });
      toast.success(`Pedido editado · ${totalCambios} cambio${totalCambios === 1 ? '' : 's'}`);
      onClose();
    } catch (e) {
      toast.error(e.message || 'No se pudo editar el pedido');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  // Bloqueo si jornada cerrada
  if (isClosed) {
    return (
      <Modal open={open} onClose={onClose} title={`Editar pedido — ${orderNumber}`} size="lg" footer={
        <button className="btn-ghost" onClick={onClose}>Entendido</button>
      }>
        <div style={{padding:'18px 14px', textAlign:'center'}}>
          <div style={{fontSize:32, marginBottom:8}}>🔒</div>
          <div style={{fontSize:14, fontWeight:700, marginBottom:8}}>Este pedido está en una jornada cerrada</div>
          <div style={{fontSize:12, color:'var(--ink-soft)', lineHeight:1.6, maxWidth:420, margin:'0 auto'}}>
            Para corregirlo, pedíselo a un admin (el flujo de ajuste post-cierre se va a implementar próximamente).
          </div>
        </div>
      </Modal>
    );
  }

  if (!itemsOriginales.length) {
    return (
      <Modal open={open} onClose={onClose} title="Pedido no encontrado" footer={
        <button className="btn-ghost" onClick={onClose}>Cerrar</button>
      }>
        <div style={{fontSize:13, color:'var(--ink-soft)'}}>
          El pedido {orderNumber} no se encuentra en {C.label}. Puede haber sido eliminado o archivado.
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title={`Editar pedido — ${orderNumber}`} size="lg" footer={
      <>
        <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn-primary" onClick={submit} disabled={busy || totalCambios === 0}>
          {busy ? <span className="loader" style={{borderColor:'rgba(255,255,255,.3)', borderTopColor:'#fff'}}/>
                : <><Icon n="check" s={14}/> Aplicar {totalCambios} cambio{totalCambios === 1 ? '' : 's'}</>}
        </button>
      </>
    }>
      <div style={{fontSize:11, color:'var(--ink-muted)', marginBottom:12}}>
        Canal: <strong>{C.label}</strong>
        {cliente && <> · Cliente: <strong>{cliente}</strong></>}
      </div>

      {/* Items existentes */}
      <div style={{marginBottom:8, fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.08em', color:'var(--ink-muted)'}}>
        Items existentes
      </div>
      <div style={{display:'flex', flexDirection:'column', gap:8, marginBottom:14}}>
        {itemsOriginales.map(it => {
          const d = drafts[it.sku] || {};
          const info = window.SKU_DB[it.sku] || {};
          const removed = !!d.removed;
          return (
            <div key={it.sku} style={{
              display:'grid', gridTemplateColumns:'1fr 100px auto', gap:8, alignItems:'center',
              padding:8, background:'var(--paper-off)', border:'1px solid var(--border)', borderRadius:6,
              opacity: removed ? 0.5 : 1, textDecoration: removed ? 'line-through' : 'none',
            }}>
              <div>
                <div style={{fontFamily:'var(--mono)', fontSize:11, fontWeight:700}}>{it.sku} <span style={{color:'var(--ink-muted)', fontSize:9, fontWeight:500}}>v{it.version}</span></div>
                <div style={{fontSize:11, color:'var(--ink-soft)'}}>
                  {info.modelo}{info.color && info.color !== '—' ? ' · ' + info.color : ''}
                </div>
              </div>
              <input type="number" min="1" className="field-input" disabled={removed}
                     value={d.cantidad ?? it.cantidad}
                     onChange={e => updateDraft(it.sku, { cantidad: e.target.value })}
                     style={{textAlign:'right'}}/>
              <button type="button" className="btn-ghost" style={{padding:'6px 10px', fontSize:10}}
                      onClick={() => toggleRemove(it.sku)}>
                {removed ? 'Restaurar' : <><Icon n="trash" s={12}/> Quitar</>}
              </button>
            </div>
          );
        })}
      </div>

      {/* Items nuevos */}
      <div style={{marginBottom:8, fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.08em', color:'var(--ink-muted)'}}>
        Items nuevos
      </div>
      {agregar.length === 0 ? (
        <div style={{fontSize:11, color:'var(--ink-faint)', marginBottom:8, fontStyle:'italic'}}>Sin items nuevos.</div>
      ) : (
        <div style={{display:'flex', flexDirection:'column', gap:8, marginBottom:8}}>
          {agregar.map((r, idx) => (
            <div key={idx} style={{display:'grid', gridTemplateColumns:'1fr 100px auto', gap:8, alignItems:'center'}}>
              <input list={`new-skus-${idx}`} className="field-input" value={r.sku}
                     onChange={e => updateNew(idx, { sku: e.target.value.toUpperCase() })}
                     placeholder="SKU" style={{fontFamily:'var(--mono)'}}/>
              <datalist id={`new-skus-${idx}`}>
                {Object.keys(window.SKU_DB).map(s => <option key={s} value={s}>{window.skuName(s)}</option>)}
              </datalist>
              <input type="number" min="1" className="field-input" value={r.cantidad}
                     onChange={e => updateNew(idx, { cantidad: e.target.value })}/>
              <button type="button" className="btn-ghost" style={{padding:'8px 10px'}} onClick={() => removeNew(idx)}>
                <Icon n="x" s={14}/>
              </button>
            </div>
          ))}
        </div>
      )}
      <button type="button" className="btn-ghost" onClick={addNew} style={{fontSize:11, marginBottom:14}}>
        <Icon n="plus" s={12}/> Agregar item nuevo
      </button>

      <div>
        <label className="field-label">Motivo (opcional)</label>
        <input className="field-input" value={motivo} onChange={e => setMotivo(e.target.value)}
               placeholder="Ej: cliente cambia color"/>
      </div>

      {/* Resumen de cambios */}
      {totalCambios > 0 && (
        <div style={{marginTop:14, padding:10, background:'#fef3c7', border:'1px solid #fbbf24', borderRadius:6}}>
          <div style={{fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.08em', color:'var(--ink-muted)', marginBottom:6}}>
            Cambios pendientes ({totalCambios})
          </div>
          <div style={{fontSize:11, lineHeight:1.7, color:'var(--ink-soft)', fontFamily:'var(--mono)'}}>
            {cambios.modificar.map(c => {
              const orig = itemsOriginales.find(it => it.sku === c.sku);
              return <div key={'m'+c.sku}>{c.sku}: {orig?.cantidad} → {c.cantidad_nueva}</div>;
            })}
            {cambios.quitar.map(c => <div key={'q'+c.sku} style={{color:'var(--red)'}}>{c.sku}: quitar</div>)}
            {cambios.agregar.map(c => <div key={'a'+c.sku} style={{color:'var(--green)'}}>{c.sku}: nuevo, +{c.cantidad}</div>)}
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ════════════════════════════════════════════════════════════════
   OrderHistoryModal — historial de ediciones de un pedido
   ════════════════════════════════════════════════════════════════ */
function OrderHistoryModal({ open, onClose, channel, orderNumber }) {
  const toast = useToast();
  const [logs, setLogs]   = useState([]);
  const [busy, setBusy]   = useState(false);

  useEffect(() => {
    if (!open) return;
    setBusy(true);
    window.MOCK_ACTIONS.getOrderEditLog({ channelId: channel, orderNumber })
      .then(setLogs)
      .catch(e => toast.error(e.message || 'No se pudo cargar el historial'))
      .finally(() => setBusy(false));
  }, [open, channel, orderNumber]);

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title={`Historial — ${orderNumber}`} size="lg" footer={
      <button className="btn-ghost" onClick={onClose}>Cerrar</button>
    }>
      {busy ? (
        <div style={{padding:18, textAlign:'center'}}><span className="loader"/></div>
      ) : logs.length === 0 ? (
        <div style={{padding:18, textAlign:'center', fontSize:12, color:'var(--ink-muted)'}}>
          Sin ediciones registradas.
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Fecha/hora</th>
              <th>Usuario</th>
              <th>Cambio</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {logs.map(l => {
              const userName = l.profile?.name || l.profile?.username || '—';
              let cambio = '';
              if (l.evento === 'cantidad_changed') cambio = `${l.sku}: ${l.cantidad_anterior} → ${l.cantidad_nueva}`;
              else if (l.evento === 'item_added') cambio = `${l.sku}: nuevo (+${l.cantidad_nueva})`;
              else if (l.evento === 'item_removed') cambio = `${l.sku}: quitado (era ${l.cantidad_anterior})`;
              return (
                <tr key={l.id}>
                  <td style={{fontSize:11, color:'var(--ink-muted)'}}>{fmt.dateTime(l.at)}</td>
                  <td style={{fontSize:11, fontWeight:600}}>{userName}</td>
                  <td style={{fontFamily:'var(--mono)', fontSize:11}}>{cambio}</td>
                  <td style={{fontSize:11, color:'var(--ink-soft)', fontStyle: l.motivo ? 'normal' : 'italic'}}>
                    {l.motivo || '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

/* ── Modal: editar una carga existente (corrige cantidad y/o destino).
   Compartido web + mobile. Lo invoca tanto la seccion "Cargas de hoy"
   en Produccion (web) como ScanPage (mobile). ────────────────────── */
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

/* ── StockMovementModal — 5 steps. Cambio 1 Step 3. ──────────────────
   context: {source?, sku?} para preselect cuando se invoca desde fila
     de CarrierPage (source=channel_id, sku) o StockPage (source='stock', sku).
     Si context es null → arranca en Step 1 sin preselect.
   Routing automático según source/target:
     - canal→stock = rpc_send_to_free_stock (enviarAStock)
     - stock→canal = rpc_assign_free_stock (assignFreeStock — existente)
     - canal→canal = rpc_transfer_between_channels (transferirEntreCanales)
     - stock→stock = bloqueado en UI */
function StockMovementModal({ open, onClose, context, onMoved }) {
  const toast = useToast();
  const M = window.useMockData();

  const initialSource = context?.source || '';
  const initialSku    = context?.sku || '';
  const initialStep   = (initialSource && initialSku) ? 3 : (initialSku ? 2 : 1);

  const [step, setStep]         = useState(initialStep);
  const [source, setSource]     = useState(initialSource);
  const [sku, setSku]           = useState(initialSku);
  const [cantidad, setCantidad] = useState(1);
  const [target, setTarget]     = useState('');
  const [motivo, setMotivo]     = useState('');
  const [busy, setBusy]         = useState(false);

  useEffect(() => {
    if (open) {
      setStep(initialStep);
      setSource(initialSource); setSku(initialSku);
      setCantidad(1); setTarget(''); setMotivo(''); setBusy(false);
    }
  }, [open]);

  // Lugares (canales + stock). Stock es violeta para diferenciarlo.
  const lugares = [
    { v:'stock', l:'Stock (almacén)', c:'#7c3aed' },
    { v:'colecta', l:'Colecta', c:'#6366f1' },
    { v:'flex', l:'Flex', c:'#15803d' },
    { v:'tiendanube', l:'Tienda Nube', c:'#2563eb' },
    { v:'distribuidor', l:'Distribuidores', c:'#d97706' },
    { v:'no_flex', l:'No Flex', c:'#db2777' },
    { v:'correo_argentino', l:'Correo Arg.', c:'#0891b2' },
  ];

  // SKUs disponibles según source
  const skusDisponibles = (() => {
    if (!source) return [];
    if (source === 'stock') {
      return window.MOCK_ACTIONS.getStockAgregado();
    }
    // Canal: SKUs con stock>0 en este canal
    const table = M.carriers[source]?.table || [];
    return table
      .filter(r => (r.stock || 0) > 0)
      .map(r => {
        const info = window.SKU_DB[r.sku] || {};
        return { sku: r.sku, cantidad: r.stock, modelo: info.modelo || r.sku, color: info.color || null };
      });
  })();

  // Cantidad disponible para el SKU+source elegido
  const disponible = (() => {
    if (!source || !sku) return 0;
    if (source === 'stock') return window.MOCK.freeStock?.[sku] || 0;
    const row = M.carriers[source]?.table?.find(r => r.sku === sku);
    return row?.stock || 0;
  })();

  const sourceL = lugares.find(l => l.v === source)?.l || '';
  const targetL = lugares.find(l => l.v === target)?.l || '';

  const submit = async () => {
    if (!source || !sku || !cantidad || !target) return;
    if (source === target) { toast.error('Origen y destino deben ser distintos'); return; }
    if (cantidad > disponible) { toast.error(`Solo hay ${disponible} disponibles`); return; }
    setBusy(true);
    try {
      if (source !== 'stock' && target === 'stock') {
        await window.MOCK_ACTIONS.enviarAStock({ sku, cantidad, sourceChannelId: source, motivo });
      } else if (source === 'stock' && target !== 'stock') {
        await window.MOCK_ACTIONS.assignFreeStock({ sku, cantidad, channelId: target, motivo });
      } else if (source !== 'stock' && target !== 'stock') {
        await window.MOCK_ACTIONS.transferirEntreCanales({ sku, cantidad, sourceChannelId: source, targetChannelId: target, motivo });
      }
      toast.success(`${cantidad} × ${sku}: ${sourceL} → ${targetL}`);
      onMoved?.();
    } catch (e) {
      toast.error(e.message || 'No se pudo mover el stock');
    } finally {
      setBusy(false);
    }
  };

  const canAdvance =
    (step === 1 && !!source) ||
    (step === 2 && !!sku) ||
    (step === 3 && cantidad > 0 && cantidad <= disponible) ||
    (step === 4 && !!target && target !== source);

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title="Mover stock" size="lg" footer={
      <>
        {step > 1 && <button className="btn-ghost" onClick={() => setStep(step - 1)} disabled={busy}>Atrás</button>}
        <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
        {step < 5 && (
          <button className="btn-primary" onClick={() => setStep(step + 1)} disabled={!canAdvance}>
            Siguiente
          </button>
        )}
        {step === 5 && (
          <button className="btn-primary" onClick={submit} disabled={busy}>
            {busy ? <span className="loader" style={{borderColor:'rgba(255,255,255,.3)', borderTopColor:'#fff'}}/>
              : <><Icon n="check" s={14}/> Confirmar movimiento</>}
          </button>
        )}
      </>
    }>
      {/* Stepper compacto */}
      <div style={{display:'flex', gap:6, marginBottom:18, fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.08em'}}>
        {['Origen','SKU','Cantidad','Destino','Confirmar'].map((lbl, i) => {
          const n = i + 1, active = step === n, done = step > n;
          return (
            <span key={lbl} style={{
              flex:1, textAlign:'center', padding:'6px 4px', borderRadius:4,
              background: done?'var(--green-bg)':active?'var(--ink)':'var(--paper-off)',
              color: done?'var(--green)':active?'#fff':'var(--ink-muted)',
            }}>{n}. {lbl}</span>
          );
        })}
      </div>

      {/* Step 1 — Origen */}
      {step === 1 && (
        <div className="field-group">
          <label className="field-label">¿De dónde sale el stock?</label>
          <div className="radio-card-group">
            {lugares.map(o => (
              <label key={o.v} className={`radio-card ${source===o.v?'selected':''}`}
                style={{'--sel-color':o.c, '--sel-bg':`${o.c}1a`}}>
                <input type="radio" checked={source===o.v} onChange={() => { setSource(o.v); setSku(''); }}/>
                <div className="radio-card-dot"/>
                <div className="radio-card-info"><div className="radio-card-label">{o.l}</div></div>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Step 2 — SKU */}
      {step === 2 && (
        <div className="field-group">
          <label className="field-label">¿Qué SKU? (con stock disponible en {sourceL})</label>
          {skusDisponibles.length === 0 ? (
            <div style={{padding:14, background:'var(--amber-bg)', border:'1px solid rgba(217,119,6,.3)', borderRadius:6, fontSize:12, color:'var(--ink-soft)'}}>
              No hay stock disponible en {sourceL}. Volvé al paso anterior y elegí otro origen.
            </div>
          ) : (
            <div style={{maxHeight:300, overflowY:'auto', border:'1px solid var(--border)', borderRadius:6}}>
              {skusDisponibles.map(s => {
                const sel = sku === s.sku;
                return (
                  <button key={s.sku} onClick={() => setSku(s.sku)} style={{
                    display:'flex', alignItems:'center', gap:12, width:'100%', padding:'12px 14px',
                    border:'none', borderBottom:'1px solid var(--border)',
                    background: sel ? 'var(--ink)' : 'transparent',
                    color: sel ? '#fff' : 'var(--ink)', cursor:'pointer', textAlign:'left',
                  }}>
                    <span style={{minWidth:64, fontFamily:'var(--mono)', fontSize:11, fontWeight:700, color: sel?'rgba(255,255,255,.8)':'var(--ink-muted)'}}>{s.sku}</span>
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{fontSize:12, fontWeight:600}}>{s.modelo}</div>
                      {s.color && s.color !== '—' && <div style={{fontSize:10, color: sel?'rgba(255,255,255,.7)':'var(--ink-muted)'}}>{s.color}</div>}
                    </div>
                    <span style={{fontFamily:'var(--mono)', fontWeight:700, fontSize:13, color: sel?'#fff':'#7c3aed'}}>{s.cantidad}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Step 3 — Cantidad */}
      {step === 3 && (
        <div className="field-group">
          <div style={{padding:'10px 12px', background:'var(--paper-off)', border:'1px solid var(--border)', borderRadius:6, marginBottom:14, fontSize:12, color:'var(--ink-soft)'}}>
            <div><strong>{sku}</strong> desde <strong>{sourceL}</strong></div>
            <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:4}}>
              Disponible: <strong style={{color:'#7c3aed'}}>{disponible}</strong> unidades
            </div>
          </div>
          <label className="field-label">¿Cuántas unidades?</label>
          <div style={{display:'flex', gap:6, alignItems:'center'}}>
            <button onClick={() => setCantidad(Math.max(1, cantidad-1))} className="btn-ghost" style={{padding:'10px 14px', fontSize:18}}>−</button>
            <input type="number" min="1" max={disponible} value={cantidad}
              onChange={e => setCantidad(Math.max(1, Math.min(disponible, parseInt(e.target.value)||1)))}
              className="qty-input"/>
            <button onClick={() => setCantidad(Math.min(disponible, cantidad+1))} className="btn-ghost" style={{padding:'10px 14px', fontSize:18}}>+</button>
            <button className="btn-ghost" style={{padding:'10px 14px', fontSize:11, marginLeft:8}}
              onClick={() => setCantidad(disponible)}>
              Tomar todo ({disponible})
            </button>
          </div>
        </div>
      )}

      {/* Step 4 — Destino */}
      {step === 4 && (
        <div className="field-group">
          <label className="field-label">¿A dónde va?</label>
          <div className="radio-card-group">
            {lugares.filter(o => o.v !== source).map(o => (
              <label key={o.v} className={`radio-card ${target===o.v?'selected':''}`}
                style={{'--sel-color':o.c, '--sel-bg':`${o.c}1a`}}>
                <input type="radio" checked={target===o.v} onChange={() => setTarget(o.v)}/>
                <div className="radio-card-dot"/>
                <div className="radio-card-info"><div className="radio-card-label">{o.l}</div></div>
              </label>
            ))}
          </div>
          <label className="field-label" style={{marginTop:14}}>Motivo (opcional)</label>
          <input className="field-input" value={motivo} onChange={e => setMotivo(e.target.value)}
            placeholder="Ej: Pedido grande de TN próxima jornada"/>
        </div>
      )}

      {/* Step 5 — Confirmación */}
      {step === 5 && (() => {
        // Detectar si el destino tiene pedido pendiente del SKU. Si no,
        // mostrar warning informativo (no bloqueante) — el cliente puede
        // estar haciendo prefarming de stock para pedidos futuros.
        // Stock como destino siempre se considera "esperado" (no warning).
        const targetTienePedido = target === 'stock'
          ? true
          : (() => {
              const row = M.carriers[target]?.table?.find(r => r.sku === sku);
              return !!row && row.faltante > 0;
            })();
        return (
          <div>
            <div style={{padding:14, background:'var(--paper-off)', border:'1px solid var(--border)', borderRadius:6, marginBottom:14}}>
              <div style={{display:'grid', gridTemplateColumns:'80px 1fr', gap:6, fontSize:12}}>
                <div style={{color:'var(--ink-muted)', fontWeight:600}}>De</div>
                <div><strong>{sourceL}</strong></div>
                <div style={{color:'var(--ink-muted)', fontWeight:600}}>A</div>
                <div><strong>{targetL}</strong></div>
                <div style={{color:'var(--ink-muted)', fontWeight:600}}>SKU</div>
                <div><span className="order-num">{sku}</span> · {window.SKU_DB[sku]?.modelo || ''}{window.SKU_DB[sku]?.color && window.SKU_DB[sku]?.color !== '—' ? ` · ${window.SKU_DB[sku].color}` : ''}</div>
                <div style={{color:'var(--ink-muted)', fontWeight:600}}>Unidades</div>
                <div><strong>{cantidad}</strong> de {disponible} disponibles</div>
                {motivo && (<>
                  <div style={{color:'var(--ink-muted)', fontWeight:600}}>Motivo</div>
                  <div>{motivo}</div>
                </>)}
              </div>
            </div>
            {!targetTienePedido && (
              <div style={{padding:'10px 12px', background:'var(--amber-bg)', border:'1px solid rgba(217,119,6,.3)', borderRadius:6, fontSize:11, color:'var(--ink-soft)', lineHeight:1.6, marginBottom:10}}>
                <Icon n="alert" s={11} c="var(--amber)"/> <strong>{targetL}</strong> no tiene pedidos pendientes de <strong>{sku}</strong>{window.SKU_DB[sku]?.color && window.SKU_DB[sku]?.color !== '—' ? ` ${window.SKU_DB[sku].color}` : ''}. Las <strong>{cantidad}</strong> {cantidad === 1 ? 'unidad va a quedar' : 'unidades van a quedar'} como stock acumulado disponible para futuros pedidos.
              </div>
            )}
            <div style={{padding:'10px 12px', background:'var(--blue-bg)', border:'1px solid rgba(37,99,235,.2)', borderRadius:6, fontSize:11, color:'var(--ink-soft)', lineHeight:1.6}}>
              <Icon n="info" s={11}/> Al confirmar se descuentan <strong>{cantidad}</strong> uds. de <strong>{sourceL}</strong> y se suman a <strong>{targetL}</strong>. El movimiento queda registrado en el historial.
            </div>
          </div>
        );
      })()}
    </Modal>
  );
}

window.Modal = Modal;
window.ProduceModal = ProduceModal;
window.ImportModal = ImportModal;
window.ConfirmModal = ConfirmModal;
window.CierreModal = CierreModal;
window.ManualOrderModal = ManualOrderModal;
window.OrderEditModal = OrderEditModal;
window.OrderHistoryModal = OrderHistoryModal;
window.EditLogModal = EditLogModal;
window.StockMovementModal = StockMovementModal;
