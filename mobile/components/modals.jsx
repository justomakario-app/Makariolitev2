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
  const M = window.MOCK;
  const skus = Object.keys(window.SKU_DB);

  const [step, setStep] = useState(1);
  const [sku, setSku] = useState(defaultSku || skus[0]);
  const [search, setSearch] = useState('');
  const [subcanal, setSubcanal] = useState(defaultSubcanal || 'colecta');
  const [cantidad, setCantidad] = useState(1);
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0,10));
  const [nota, setNota] = useState('');
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      // Si vinimos con SKU + canal preseleccionados, saltar directo al paso 3 (cantidad)
      // Si solo viene canal, empezar en paso 1 pero con canal listo
      // Si nada, empezar de cero
      const hasSku = !!defaultSku;
      const hasCanal = !!defaultSubcanal;
      setStep(hasSku && hasCanal ? 3 : hasSku ? 2 : 1);
      setSku(defaultSku || skus[0]);
      setSearch('');
      setSubcanal(defaultSubcanal || 'colecta');
      setCantidad(1); setFecha(new Date().toISOString().slice(0,10));
      setNota(''); setScanning(false);
    }
  }, [open, defaultSku, defaultSubcanal]);

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
      // El backend setea production_logs.fecha = CURRENT_DATE automáticamente.
      // El campo `fecha` del modal queda como informativo (resumen) — no se envía.
      await window.MOCK_ACTIONS.registrarProduccion({ sku, subcanal, cantidad, nota });
      onClose();
      toast.success(`${cantidad} × ${sku} → ${window.CARRIERS[subcanal]?.label} registrado`);
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
        {step < 3 && <button className="btn-primary" onClick={() => setStep(step + 1)} disabled={!sku}>Siguiente</button>}
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
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [channel, setChannel] = useState(defaultChannel || 'colecta');
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
      // Filtrar SKUs reconocidos para no romper la FK del backend
      const items = orders
        .filter(o => window.SKU_DB[o.sku])
        .map(o => ({
          sku: o.sku,
          cantidad: o.cantidad,
          order_number: o.numero,
          cliente: o.cliente,
          fecha_pedido: o.fecha,
        }));
      const ignorados = orders.length - items.length;
      setProgress(50);
      const result = await window.MOCK_ACTIONS.importarLote({
        channelId: channel,
        filename: file.name,
        items,
      });
      setProgress(100);
      onClose();
      const aplicados = result?.unidades_count ?? items.reduce((s, o) => s + o.cantidad, 0);
      if (ignorados > 0) {
        toast.success(`${file.name} importado · ${aplicados} uds. aplicadas a ${window.CARRIERS[channel]?.label} · ${ignorados} pedido(s) con SKU desconocido ignorados`);
      } else {
        toast.success(`${file.name} importado · ${aplicados} uds. aplicadas a ${window.CARRIERS[channel]?.label}`);
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
        <button className="btn-primary" onClick={submit} disabled={!file || !orders.length || busy || parsing}>
          {busy ? <span className="loader" style={{borderColor:'rgba(255,255,255,.3)', borderTopColor:'#fff'}}/> : <><Icon n="upload" s={14}/> Importar {orders.length>0 ? `${orders.length} pedidos` : ''} a {C.label}</>}
        </button>
      </>
    }>
      {/* Selector canal */}
      <label className="field-label">Canal de destino</label>
      <div className="radio-card-group" style={{marginBottom:14}}>
        {[
          { v:'colecta', l:'Colecta', c:'#6366f1' },
          { v:'flex', l:'Flex', c:'#15803d' },
          { v:'tiendanube', l:'Tienda Nube', c:'#2563eb' },
          { v:'distribuidor', l:'Distribuidor', c:'#d97706' },
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

/* ── Cierre de jornada con preview snapshot ── */
function CierreModal({ open, onClose, onConfirm, channel }) {
  const M = window.MOCK;
  const data = M.carriers[channel];
  if (!data) return null;
  const C = window.CARRIERS[channel] || {};

  return (
    <Modal open={open} onClose={onClose} title={`Cerrar jornada — ${C.label}`} size="lg" footer={
      <>
        <button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn-success" onClick={() => { onConfirm?.(); onClose(); }}>
          <Icon n="lock" s={14}/> Confirmar cierre
        </button>
      </>
    }>
      <div style={{fontSize:12, color:'var(--ink-soft)', lineHeight:1.6, marginBottom:12}}>
        Vas a guardar un <strong>snapshot inmutable</strong> de la jornada de hoy en <strong>{C.label}</strong>.
        {C.cierreHora && <> Hora de retiro: <strong>{C.cierreHora}</strong>.</>}
      </div>

      <div style={{padding:'10px 12px', background:'var(--paper-off)', border:'1px solid var(--border)', borderRadius:6, marginBottom:14, fontSize:11, color:'var(--ink-soft)', lineHeight:1.6}}>
        <div style={{fontSize:9, fontWeight:700, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--ink-muted)', marginBottom:6}}>Qué pasa al cerrar</div>
        <div>✓ Los pedidos <strong>completados</strong> se archivan en el histórico.</div>
        <div>✓ El <strong>faltante</strong> se arrastra al día siguiente como nueva línea.</div>
        <div>✓ Se genera un snapshot que <strong>no se puede modificar</strong>.</div>
      </div>

      <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, marginBottom:14}}>
        <div className="stat-card" style={{padding:12}}>
          <div style={{fontSize:9, fontWeight:700, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--ink-muted)', marginBottom:4}}>Pedidos</div>
          <div style={{fontFamily:'var(--mono)', fontSize:22, fontWeight:700}}>{data.kpis.activos}</div>
        </div>
        <div className="stat-card" style={{padding:12}}>
          <div style={{fontSize:9, fontWeight:700, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--ink-muted)', marginBottom:4}}>Unidades</div>
          <div style={{fontFamily:'var(--mono)', fontSize:22, fontWeight:700}}>{data.kpis.unidades}</div>
        </div>
        <div className="stat-card" style={{padding:12, borderLeft: data.kpis.pendiente>0?'3px solid var(--red)':'3px solid var(--green)'}}>
          <div style={{fontSize:9, fontWeight:700, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--ink-muted)', marginBottom:4}}>Arrastra</div>
          <div style={{fontFamily:'var(--mono)', fontSize:22, fontWeight:700, color: data.kpis.pendiente>0?'var(--red)':'var(--green)'}}>{data.kpis.pendiente}</div>
        </div>
      </div>

      <div style={{fontSize:11, fontWeight:700, color:'var(--ink-muted)', textTransform:'uppercase', letterSpacing:'.1em', marginBottom:8}}>
        Snapshot por SKU
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
          {data.table.map(r => (
            <tr key={r.sku}>
              <td><span className="order-num">{r.sku}</span></td>
              <td style={{fontSize:11, color:'var(--ink-soft)'}}>{window.skuName(r.sku)}</td>
              <td style={{textAlign:'right'}}><span className="cell-color-num">{r.pedido}</span></td>
              <td style={{textAlign:'right'}}><span className="cell-color-num" style={{color:'var(--green)'}}>{r.producido}</span></td>
              <td style={{textAlign:'right'}}>
                {r.faltante>0
                  ? <span className="cell-faltante-red">{r.faltante}</span>
                  : <span className="cell-faltante-ok"><Icon n="check" s={12}/></span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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

window.Modal = Modal;
window.ProduceModal = ProduceModal;
window.ImportModal = ImportModal;
window.ConfirmModal = ConfirmModal;
window.CierreModal = CierreModal;
