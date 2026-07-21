/* ══ LÍNEA PRODUCTIVA · CARGA INICIAL DE STOCK ════════════════════════════
   Pantalla para que el encargado/owner cargue stock SIN ejecutar SQL/RPC manual.
   - Abrir o previsualizar NUNCA modifica stock (preview es read-only).
   - Confirmar es una acción EXPLÍCITA (write) e idempotente por lote.
   - Anti doble-tap (botones deshabilitados mientras procesa).
   window.LineaStockCargaPage  (responsive: desktop + mobile 360px)
   ══ */
(function () {
  const U = { surface:'#FFFFFF', surface2:'#F8F8FA', border:'rgba(0,0,0,0.10)', ink:'#0A0A0A', inkSoft:'#555', inkMuted:'#8A8A8A', accent:'#2E4057', ok:'#16A34A', warn:'#D97706', danger:'#DC2626' };
  const BUCKETS = [
    { v:'pieza', l:'Pieza cruda (CNC)' }, { v:'melamina', l:'Melamina terminada' },
    { v:'patas', l:'Patas (Pino)' }, { v:'terminado', l:'Producto terminado' }, { v:'insumo', l:'Insumo / varilla' },
  ];
  const ORIGENES = [ {v:'conteo_fisico',l:'Conteo físico'}, {v:'stock_legacy',l:'Stock legacy'}, {v:'compra',l:'Compra/ingreso'}, {v:'ajuste',l:'Ajuste'}, {v:'otro',l:'Otro'} ];
  const nuevaFila = () => ({ sku:'', bucket:'insumo', cantidad:'', origen:'conteo_fisico', motivo:'' });
  const nuevoLote = () => 'CI-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' + Math.random().toString(36).slice(2,7);

  function LineaStockCargaPage() {
    const [role] = useState(() => ((window.useMockData && window.useMockData().user.role) || '').toLowerCase());
    const [lote, setLote] = useState(nuevoLote);
    const [filas, setFilas] = useState([nuevaFila()]);
    const [preview, setPreview] = useState(null);
    const [result, setResult] = useState(null);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');

    const puedeConfirmar = ['owner','admin'].includes(role);
    const setFila = (i, k, v) => { setFilas(fs => fs.map((f,ix)=> ix===i ? Object.assign({},f,{[k]:v}) : f)); setPreview(null); setResult(null); };
    const addFila = () => { setFilas(fs => fs.concat([nuevaFila()])); setPreview(null); setResult(null); };
    const delFila = (i) => { setFilas(fs => fs.filter((_,ix)=>ix!==i)); setPreview(null); setResult(null); };
    const limpiar = () => { setFilas([nuevaFila()]); setPreview(null); setResult(null); setMsg(''); setLote(nuevoLote()); };

    const payloadFilas = () => filas
      .filter(f => (f.sku||'').trim() !== '')
      .map(f => ({ sku:(f.sku||'').trim().toUpperCase(), bucket:f.bucket, cantidad:parseInt(f.cantidad,10)||0, origen:f.origen, motivo:(f.motivo||'').trim() }));

    const previsualizar = async () => {
      if (busy) return;
      const fs = payloadFilas();
      if (fs.length === 0) { setMsg('Agregá al menos una fila con SKU.'); return; }
      setBusy(true); setMsg(''); setResult(null);
      try {
        const r = await window.SUPA.rpc('prod_rpc_stock_preview', { p_payload: { lote_id: lote, filas: fs } });
        if (r.error) { setMsg(r.error.message || 'No se pudo previsualizar'); setPreview(null); }
        else setPreview(r.data);
      } catch (e) { setMsg((e && e.message) || 'Error de red al previsualizar'); }
      finally { setBusy(false); }
    };

    const confirmar = async () => {
      if (busy || !preview) return;
      if (preview.resumen && preview.resumen.bloqueadas > 0) { setMsg('Hay filas bloqueadas: corregilas antes de confirmar.'); return; }
      if (!puedeConfirmar) { setMsg('Tu rol no puede confirmar (solo owner/admin).'); return; }
      setBusy(true); setMsg('');
      try {
        const r = await window.SUPA.rpc('prod_rpc_stock_confirmar', { p_payload: { lote_id: lote, filas: payloadFilas() } });
        if (r.error) { setMsg(r.error.message || 'No se pudo confirmar'); }
        else { setResult(r.data); setPreview(null); }
      } catch (e) { setMsg((e && e.message) || 'Error de red al confirmar'); }
      finally { setBusy(false); }
    };

    const colorEstado = (e) => e==='valida' ? U.ok : e==='advertencia' ? U.warn : U.danger;

    return (
      <div style={{ padding:'16px clamp(14px,3vw,32px) 40px', color:U.ink, fontSize:13, maxWidth:920, margin:'0 auto' }}>
        <div style={{ fontSize:11, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:U.accent }}>Línea Productiva · Carga inicial de stock</div>
        <div style={{ fontSize:11.5, color:U.inkMuted, marginTop:3, marginBottom:14 }}>
          Cargá stock por sector. <b>Previsualizar no modifica nada</b>; el stock cambia solo al <b>Confirmar</b>. Lote: <code>{lote}</code>
        </div>

        {filas.map((f, i) => (
          <div key={i} style={{ background:U.surface, border:`1px solid ${U.border}`, borderRadius:12, padding:'12px', marginBottom:10 }}>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8, alignItems:'flex-end' }}>
              <label style={{ flex:'2 1 130px', minWidth:110 }}><div style={lb}>SKU</div>
                <input value={f.sku} onChange={e=>setFila(i,'sku',e.target.value)} placeholder="TAP005 / PAT001 / VAR003…" style={inp} /></label>
              <label style={{ flex:'2 1 150px', minWidth:130 }}><div style={lb}>Sector / bucket</div>
                <select value={f.bucket} onChange={e=>setFila(i,'bucket',e.target.value)} style={inp}>{BUCKETS.map(b=><option key={b.v} value={b.v}>{b.l}</option>)}</select></label>
              <label style={{ flex:'1 1 80px', minWidth:70 }}><div style={lb}>Cantidad</div>
                <input type="number" inputMode="numeric" min="1" value={f.cantidad} onChange={e=>setFila(i,'cantidad',e.target.value)} placeholder="0" style={inp} /></label>
              <label style={{ flex:'1 1 120px', minWidth:110 }}><div style={lb}>Origen</div>
                <select value={f.origen} onChange={e=>setFila(i,'origen',e.target.value)} style={inp}>{ORIGENES.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}</select></label>
              <label style={{ flex:'3 1 160px', minWidth:130 }}><div style={lb}>Motivo</div>
                <input value={f.motivo} onChange={e=>setFila(i,'motivo',e.target.value)} placeholder="obligatorio" style={inp} /></label>
              <button onClick={()=>delFila(i)} disabled={filas.length<=1} title="Quitar fila"
                style={{ border:`1px solid ${U.border}`, background:U.surface2, borderRadius:8, padding:'8px 10px', cursor: filas.length<=1?'not-allowed':'pointer', color:U.danger }}>✕</button>
            </div>
            {preview && preview.filas && preview.filas[i] ? (
              <div style={{ marginTop:8, fontSize:11, display:'flex', flexWrap:'wrap', gap:'4px 14px', alignItems:'center' }}>
                <span style={{ fontWeight:800, color:colorEstado(preview.filas[i].estado), textTransform:'uppercase', fontSize:10 }}>{preview.filas[i].estado}</span>
                <span style={{ color:U.inkMuted }}>{preview.filas[i].detalle}</span>
                <span style={{ color:U.inkSoft }}>stock actual <b>{preview.filas[i].stock_actual}</b> → proyectado <b>{preview.filas[i].stock_proyectado}</b></span>
              </div>
            ) : null}
          </div>
        ))}

        <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginTop:4, marginBottom:14 }}>
          <button onClick={addFila} disabled={busy} style={btn(U,'ghost')}>+ Agregar fila</button>
          <button onClick={previsualizar} disabled={busy} style={btn(U,'primary')}>{busy?'…':'Previsualizar (no modifica)'}</button>
          <button onClick={limpiar} disabled={busy} style={btn(U,'ghost')}>Cancelar / limpiar</button>
        </div>

        {msg ? <div style={{ background:'rgba(220,38,38,.05)', border:'1px solid rgba(220,38,38,.25)', color:U.danger, borderRadius:10, padding:'10px 12px', fontSize:12, marginBottom:12 }}>{msg}</div> : null}

        {preview && preview.resumen ? (
          <div style={{ background:U.surface, border:`1px solid ${U.border}`, borderRadius:12, padding:'12px 14px', marginBottom:12 }}>
            <div style={{ fontSize:12.5, fontWeight:800, marginBottom:6 }}>Previsualización del lote (no aplicada)</div>
            <div style={{ display:'flex', gap:16, flexWrap:'wrap', fontSize:12 }}>
              <span style={{ color:U.ok, fontWeight:700 }}>✓ {preview.resumen.validas} válidas</span>
              <span style={{ color:U.warn, fontWeight:700 }}>⚠ {preview.resumen.advertencias} advertencias</span>
              <span style={{ color:U.danger, fontWeight:700 }}>✕ {preview.resumen.bloqueadas} bloqueadas</span>
            </div>
            <button onClick={confirmar} disabled={busy || preview.resumen.bloqueadas>0 || !puedeConfirmar}
              style={Object.assign({}, btn(U, (preview.resumen.bloqueadas>0||!puedeConfirmar)?'disabled':'confirm'), { marginTop:12, width:'100%', padding:'13px' })}>
              {busy ? 'Aplicando…' : preview.resumen.bloqueadas>0 ? 'Corregí las filas bloqueadas' : !puedeConfirmar ? 'Solo owner/admin confirma' : `Confirmar lote (${preview.resumen.validas} filas)`}
            </button>
          </div>
        ) : null}

        {result ? (
          <div style={{ background:'rgba(22,163,74,.06)', border:'1px solid rgba(22,163,74,.3)', borderRadius:12, padding:'12px 14px', fontSize:12.5 }}>
            <div style={{ fontWeight:800, color:U.ok }}>✓ Lote {result.lote_id} confirmado</div>
            <div style={{ color:U.inkSoft, marginTop:4 }}>Aplicadas nuevas: <b>{result.aplicadas_nuevas}</b> · ya aplicadas (idempotente): <b>{result.ya_aplicadas_idempotente}</b></div>
            <button onClick={limpiar} style={Object.assign({}, btn(U,'ghost'), { marginTop:10 })}>Cargar otro lote</button>
          </div>
        ) : null}

        <div style={{ marginTop:16, fontSize:10.5, color:U.inkMuted, lineHeight:1.5 }}>
          free_stock legacy (44) queda pendiente de conciliación y separado — no se migra desde acá. VAR002 (diámetro) queda aparte si su longitud es ambigua.
        </div>
      </div>
    );
  }
  const lb = { fontSize:9.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em', color:'#8A8A8A', marginBottom:3 };
  const inp = { width:'100%', boxSizing:'border-box', border:'1px solid rgba(0,0,0,0.14)', borderRadius:8, padding:'9px 10px', fontSize:13, background:'#fff', outline:'none' };
  function btn(U, kind){
    const base={ border:'1px solid '+U.border, borderRadius:10, padding:'10px 14px', fontSize:12.5, fontWeight:700, cursor:'pointer' };
    if(kind==='primary') return Object.assign({},base,{ background:U.accent, color:'#fff', borderColor:U.accent });
    if(kind==='confirm') return Object.assign({},base,{ background:U.ok, color:'#fff', borderColor:U.ok });
    if(kind==='disabled') return Object.assign({},base,{ background:U.surface2, color:U.inkMuted, cursor:'not-allowed' });
    return Object.assign({},base,{ background:U.surface, color:U.ink });
  }
  window.LineaStockCargaPage = LineaStockCargaPage;
})();
