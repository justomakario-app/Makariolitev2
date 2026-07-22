/* ══ LÍNEA PRODUCTIVA · CONFIGURACIÓN ════════════════════════════════════════
   Panel de configuración de la Línea Productiva. Solo owner/admin/encargado.
   Secciones (tabs internas):
     1) Materia prima (placas y Pino): stockMP + mpUpsert (alta/edición) + mpAjuste.
     2) Equivalencia a sets por SKU: setSetsEquiv (numérico o vacío = null).
     3) Mínimos por pool/sku: setMinimoPool + alertas (minimos) + reconocerAlerta.
     4) Mapeo de estados externos: setEstadoExterno (canónico + revisión manual).
   Umbrales de capacidad (270/300) informativos vía capacidad() — sin edición.
   Reusa window.LP_DATA. Runtime clásico (sin import/export ni fragments).
   window.LineaConfigPage  (responsive: desktop + mobile 360/390px)
   ══ */
(function () {
  const U = { surface:'#FFFFFF', surface2:'#F8F8FA', border:'rgba(0,0,0,0.10)', ink:'#0A0A0A', inkSoft:'#555', inkMuted:'#8A8A8A', accent:'#2E4057', ok:'#16A34A', warn:'#D97706', danger:'#DC2626' };
  const PAGE_PAD = '20px clamp(12px,4vw,24px) 32px'; // WEB (mobile usa lateral menor)
  const POOLS = ['mp','pieza','melamina','patas','terminado','insumo'];
  const TIPOS = ['placa','liston','varilla','otro'];

  const btn = (bg, on) => ({ background: on?bg:'#CBD5E1', border:'none', borderRadius:10, color:'#fff', padding:'10px 16px', fontSize:13, fontWeight:800, cursor:on?'pointer':'not-allowed', maxWidth:'100%' });
  const card = { background:U.surface, border:`1px solid ${U.border}`, borderRadius:14, padding:'16px 18px', marginBottom:14, boxSizing:'border-box', maxWidth:'100%' };
  const h = { fontSize:14, fontWeight:800, color:U.ink, margin:'0 0 4px' };
  const sub = { fontSize:12, color:U.inkSoft, margin:'0 0 12px', lineHeight:1.5 };
  const lb = { fontSize:9.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em', color:U.inkMuted, marginBottom:3 };
  const inp = { width:'100%', padding:'9px 10px', borderRadius:8, border:`1px solid ${U.border}`, fontSize:13, boxSizing:'border-box', background:'#fff', minWidth:0, outline:'none' };
  const chip = { fontSize:10.5, fontWeight:700, color:U.inkSoft, background:U.surface, border:`1px solid ${U.border}`, borderRadius:999, padding:'2px 8px' };
  const ghost = (on) => ({ background:U.surface2, color:U.ink, border:`1px solid ${U.border}`, borderRadius:10, padding:'10px 16px', fontSize:13, fontWeight:800, cursor:on?'pointer':'not-allowed', maxWidth:'100%' });

  function Feedback(props) {
    const msg = props.msg, err = props.err;
    if (!msg && !err) return null;
    return (
      <div style={{ marginBottom:12, maxWidth:'100%' }}>
        {msg ? <div style={{ background:'#ECFDF5', border:'1px solid #A7F3D0', color:'#065F46', borderRadius:10, padding:'9px 12px', fontSize:12, fontWeight:700, marginBottom: err?6:0, boxSizing:'border-box', maxWidth:'100%', overflowWrap:'anywhere' }}>{msg}</div> : null}
        {err ? <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', color:'#991B1B', borderRadius:10, padding:'9px 12px', fontSize:12, fontWeight:700, boxSizing:'border-box', maxWidth:'100%', overflowWrap:'anywhere' }}>{err}</div> : null}
      </div>
    );
  }

  // ── Banner informativo de capacidad (umbrales 270/300 leídos, sin edición) ──
  function CapacidadBanner() {
    const [cap, setCap] = useState(undefined); // undefined=cargando
    const [err, setErr] = useState('');
    useEffect(() => {
      let alive = true;
      window.LP_DATA.capacidad()
        .then(c => { if (alive) setCap(c || null); })
        .catch(e => { if (alive) { setErr((e && e.message) || 'error'); setCap(null); } });
      return () => { alive = false; };
    }, []);
    if (cap === undefined) return <div style={{ ...card, color:U.inkMuted, fontSize:12 }}>Cargando capacidad…</div>;
    if (err) return <div style={{ ...card, background:'#FEF2F2', borderColor:'#FECACA', color:'#991B1B', fontSize:12, fontWeight:700 }}>No se pudo leer la capacidad: {err}</div>;
    if (!cap) return null;
    const nivelColor = cap.nivel==='critica'?U.danger:cap.nivel==='advertencia'?U.warn:U.ok;
    const noCalc = cap.calculable === false;
    return (
      <div style={{ ...card, background:U.surface }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', flexWrap:'wrap', gap:8 }}>
          <div style={h}>Capacidad · informativo</div>
          <div style={{ fontSize:11, color:U.inkMuted }}>umbrales fijos — no se editan acá</div>
        </div>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginTop:6 }}>
          <span style={{ ...chip, color:U.warn }}>aviso ≥ {cap.advertencia != null ? cap.advertencia : '—'}</span>
          <span style={{ ...chip, color:U.danger }}>crítico ≥ {cap.critica != null ? cap.critica : '—'}</span>
          {!noCalc ? <span style={{ ...chip, color:nivelColor }}>actual {cap.sets != null ? cap.sets : '—'} sets · {cap.nivel || '—'}</span> : null}
        </div>
        {noCalc ? (
          <div style={{ marginTop:10, background:'#FEF3C7', border:'1px solid #FDE68A', borderRadius:8, padding:'8px 10px', fontSize:12, color:'#92400E' }}>
            Capacidad no calculable: faltan equivalencias a sets{cap.skus_sin_equiv != null ? ' (' + cap.skus_sin_equiv + ' SKU sin equivalencia)' : ''}. Cargalas en la pestaña "Equivalencia a sets".
          </div>
        ) : null}
      </div>
    );
  }

  // ── 1) Materia prima: alta/edición + ajuste de stock + listado ──
  function MateriaPrimaSection() {
    const [rows, setRows] = useState(undefined); // undefined=cargando
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
    const [up, setUp] = useState({ sku:'', nombre:'', tipo:'placa', sector:'', unidad:'' });
    const [aj, setAj] = useState({ sku:'', delta:'', motivo:'' });

    const cargar = React.useCallback(async () => {
      try { setRows(await window.LP_DATA.stockMP()); }
      catch (e) { setErr((e && e.message) || 'No se pudo leer la materia prima'); setRows([]); }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    const editar = (r) => {
      setUp({ sku:r.sku||'', nombre:r.nombre||'', tipo:r.tipo||'placa', sector:r.sector||'', unidad:r.unidad||'' });
      setAj(a => Object.assign({}, a, { sku:r.sku||'' }));
      setMsg(''); setErr('');
    };
    const limpiarForm = () => { setUp({ sku:'', nombre:'', tipo:'placa', sector:'', unidad:'' }); setMsg(''); setErr(''); };

    const guardar = async () => {
      if (busy) return;
      const sku = (up.sku||'').trim();
      if (!sku) { setErr('El SKU es obligatorio.'); setMsg(''); return; }
      setBusy(true); setMsg(''); setErr('');
      try {
        await window.LP_DATA.mpUpsert({ sku, nombre:(up.nombre||'').trim(), tipo:up.tipo, sector:(up.sector||'').trim(), unidad:(up.unidad||'').trim() });
        setMsg('Materia prima guardada: ' + sku + '.');
        await cargar();
      } catch (e) { setErr((e && e.message) || 'No se pudo guardar'); }
      finally { setBusy(false); }
    };

    const ajustar = async () => {
      if (busy) return;
      const sku = (aj.sku||'').trim();
      const delta = parseInt(aj.delta, 10);
      const motivo = (aj.motivo||'').trim();
      if (!sku) { setErr('Indicá el SKU a ajustar.'); setMsg(''); return; }
      if (!Number.isFinite(delta) || delta === 0) { setErr('El delta debe ser un entero distinto de 0 (+/-).'); setMsg(''); return; }
      if (!motivo) { setErr('El motivo es obligatorio.'); setMsg(''); return; }
      setBusy(true); setMsg(''); setErr('');
      try {
        await window.LP_DATA.mpAjuste({ sku, delta, motivo });
        setMsg('Ajuste aplicado a ' + sku + ' (' + (delta>0?'+':'') + delta + ').');
        setAj(a => Object.assign({}, a, { delta:'', motivo:'' }));
        await cargar();
      } catch (e) { setErr((e && e.message) || 'No se pudo aplicar el ajuste'); }
      finally { setBusy(false); }
    };

    const num = (n) => (n===null||n===undefined||n==='') ? '—' : n;

    return (
      <div style={{ maxWidth:'100%' }}>
        <Feedback msg={msg} err={err} />

        <div style={card}>
          <div style={h}>Alta / edición de materia prima</div>
          <div style={sub}>Placas y Pino. Tocá una fila del listado para cargarla acá. Guardar crea o actualiza el maestro (no modifica el stock).</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:10 }}>
            <label style={{ flex:'1 1 130px', minWidth:0 }}><div style={lb}>SKU</div><input value={up.sku} onChange={e=>setUp(o=>Object.assign({},o,{sku:e.target.value}))} placeholder="PLM18BLA…" style={inp} /></label>
            <label style={{ flex:'2 1 170px', minWidth:0 }}><div style={lb}>Nombre</div><input value={up.nombre} onChange={e=>setUp(o=>Object.assign({},o,{nombre:e.target.value}))} placeholder="Placa melamina 18mm blanca" style={inp} /></label>
            <label style={{ flex:'1 1 120px', minWidth:0 }}><div style={lb}>Tipo</div><select value={up.tipo} onChange={e=>setUp(o=>Object.assign({},o,{tipo:e.target.value}))} style={inp}>{TIPOS.map(t=><option key={t} value={t}>{t}</option>)}</select></label>
            <label style={{ flex:'1 1 120px', minWidth:0 }}><div style={lb}>Sector</div><input value={up.sector} onChange={e=>setUp(o=>Object.assign({},o,{sector:e.target.value}))} placeholder="cnc / pino…" style={inp} /></label>
            <label style={{ flex:'1 1 100px', minWidth:0 }}><div style={lb}>Unidad</div><input value={up.unidad} onChange={e=>setUp(o=>Object.assign({},o,{unidad:e.target.value}))} placeholder="placa / u / m" style={inp} /></label>
          </div>
          <div style={{ display:'flex', gap:8, marginTop:12, flexWrap:'wrap' }}>
            <button onClick={guardar} disabled={busy} style={btn(U.accent, !busy)}>Guardar materia prima</button>
            <button onClick={limpiarForm} disabled={busy} style={ghost(!busy)}>Limpiar</button>
          </div>
        </div>

        <div style={card}>
          <div style={h}>Ajuste de stock</div>
          <div style={sub}>Delta entero (+/-). El motivo es obligatorio y queda auditado.</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:10 }}>
            <label style={{ flex:'1 1 130px', minWidth:0 }}><div style={lb}>SKU</div><input value={aj.sku} onChange={e=>setAj(o=>Object.assign({},o,{sku:e.target.value}))} placeholder="SKU" style={inp} /></label>
            <label style={{ flex:'1 1 90px', minWidth:0 }}><div style={lb}>Delta (+/-)</div><input type="number" inputMode="numeric" value={aj.delta} onChange={e=>setAj(o=>Object.assign({},o,{delta:e.target.value}))} placeholder="-5 / 12" style={inp} /></label>
            <label style={{ flex:'3 1 190px', minWidth:0 }}><div style={lb}>Motivo (obligatorio)</div><input value={aj.motivo} onChange={e=>setAj(o=>Object.assign({},o,{motivo:e.target.value}))} placeholder="conteo físico, rotura…" style={inp} /></label>
          </div>
          <div style={{ marginTop:12 }}>
            <button onClick={ajustar} disabled={busy} style={btn(U.warn, !busy)}>Aplicar ajuste</button>
          </div>
        </div>

        <div style={card}>
          <div style={h}>Materia prima en stock</div>
          {rows === undefined ? <div style={{ color:U.inkMuted, fontSize:12 }}>Cargando…</div>
            : rows.length === 0 ? <div style={{ color:U.inkMuted, fontSize:12 }}>No hay materia prima cargada.</div>
            : (
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {rows.map((r,i) => (
                  <div key={r.sku!=null?r.sku:i} onClick={()=>editar(r)} title="Cargar en el formulario de edición / ajuste"
                       style={{ border:`1px solid ${U.border}`, borderRadius:10, padding:'10px 12px', cursor:'pointer', background:U.surface2, minWidth:0, maxWidth:'100%', boxSizing:'border-box' }}>
                    <div style={{ display:'flex', gap:8, justifyContent:'space-between', flexWrap:'wrap', alignItems:'baseline' }}>
                      <div style={{ minWidth:0, overflowWrap:'anywhere' }}><b style={{ color:U.ink }}>{r.sku}</b> <span style={{ color:U.inkSoft, fontSize:12 }}>{r.nombre||''}</span></div>
                      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                        {r.tipo ? <span style={chip}>{r.tipo}</span> : null}
                        {r.sector ? <span style={chip}>{r.sector}</span> : null}
                        {r.unidad ? <span style={chip}>{r.unidad}</span> : null}
                      </div>
                    </div>
                    <div style={{ display:'flex', gap:14, flexWrap:'wrap', marginTop:6, fontSize:12 }}>
                      <span style={{ color:U.ok, fontWeight:700 }}>disp {num(r.disponible)}</span>
                      <span style={{ color:U.warn, fontWeight:700 }}>reserv {num(r.reservado)}</span>
                      <span style={{ color:U.accent, fontWeight:700 }}>en proc {num(r.en_proceso)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
        </div>
      </div>
    );
  }

  // ── 2) Equivalencia a sets por SKU ──
  function SetsSection() {
    const [sku, setSku] = useState('');
    const [val, setVal] = useState('');
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState(''); const [err, setErr] = useState('');

    const guardar = async () => {
      if (busy) return;
      const s = (sku||'').trim();
      if (!s) { setErr('Indicá el SKU.'); setMsg(''); return; }
      const raw = (val||'').trim();
      let sets_equiv = null;
      if (raw !== '') {
        const n = Number(raw);
        if (!Number.isFinite(n)) { setErr('El valor debe ser numérico, o dejalo vacío para borrar la equivalencia.'); setMsg(''); return; }
        sets_equiv = n;
      }
      setBusy(true); setMsg(''); setErr('');
      try {
        await window.LP_DATA.setSetsEquiv({ sku:s, sets_equiv });
        setMsg('Equivalencia guardada: ' + s + ' → ' + (sets_equiv===null ? 'sin equivalencia (null)' : sets_equiv + ' set(s)') + '.');
      } catch (e) { setErr((e && e.message) || 'No se pudo guardar la equivalencia'); }
      finally { setBusy(false); }
    };

    return (
      <div style={{ maxWidth:'100%' }}>
        <Feedback msg={msg} err={err} />
        <div style={card}>
          <div style={h}>Equivalencia a sets por SKU</div>
          <div style={sub}>Cuántos "sets" de capacidad consume una unidad del SKU. Dejá el valor vacío para borrar la equivalencia (null). Impacta el cálculo de capacidad.</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:10 }}>
            <label style={{ flex:'2 1 150px', minWidth:0 }}><div style={lb}>SKU</div><input value={sku} onChange={e=>setSku(e.target.value)} placeholder="Producto / pieza" style={inp} /></label>
            <label style={{ flex:'1 1 140px', minWidth:0 }}><div style={lb}>Sets equiv. (vacío = null)</div><input type="number" inputMode="decimal" step="any" value={val} onChange={e=>setVal(e.target.value)} placeholder="ej. 1.5 — vacío borra" style={inp} /></label>
          </div>
          <div style={{ marginTop:12 }}>
            <button onClick={guardar} disabled={busy} style={btn(U.accent, !busy)}>Guardar equivalencia</button>
          </div>
        </div>
      </div>
    );
  }

  // ── 3) Mínimos por pool/sku + alertas + reconocer ──
  function MinimosSection() {
    const [data, setData] = useState(undefined); // undefined=cargando; {alertas, configurados}
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
    const [form, setForm] = useState({ pool:'mp', sku:'', minimo:'', sector:'' });

    const cargar = React.useCallback(async () => {
      try { setData(await window.LP_DATA.minimos()); }
      catch (e) { setErr((e && e.message) || 'No se pudieron leer los mínimos / alertas'); setData({ alertas:[], configurados:null }); }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    const guardar = async () => {
      if (busy) return;
      const sku = (form.sku||'').trim();
      const minimo = parseInt(form.minimo, 10);
      if (!sku) { setErr('Indicá el SKU.'); setMsg(''); return; }
      if (!Number.isFinite(minimo) || minimo < 0) { setErr('El mínimo debe ser un entero mayor o igual a 0.'); setMsg(''); return; }
      setBusy(true); setMsg(''); setErr('');
      try {
        const payload = { pool:form.pool, sku, minimo };
        const sector = (form.sector||'').trim();
        if (sector) payload.sector = sector;
        await window.LP_DATA.setMinimoPool(payload);
        setMsg('Mínimo guardado: ' + form.pool + '/' + sku + ' = ' + minimo + '.');
        await cargar();
      } catch (e) { setErr((e && e.message) || 'No se pudo guardar el mínimo'); }
      finally { setBusy(false); }
    };

    const reconocer = async (id) => {
      if (busy) return;
      setBusy(true); setMsg(''); setErr('');
      try { await window.LP_DATA.reconocerAlerta({ alerta_id:id }); setMsg('Alerta reconocida.'); await cargar(); }
      catch (e) { setErr((e && e.message) || 'No se pudo reconocer la alerta'); }
      finally { setBusy(false); }
    };

    const nivelColor = (n) => /crit/i.test(n||'') ? U.danger : /baj|adv|warn/i.test(n||'') ? U.warn : U.inkSoft;
    const alertas = data && Array.isArray(data.alertas) ? data.alertas : [];
    const configurados = data && data.configurados != null ? data.configurados : null;

    return (
      <div style={{ maxWidth:'100%' }}>
        <Feedback msg={msg} err={err} />

        <div style={card}>
          <div style={h}>Configurar mínimo por pool / SKU</div>
          <div style={sub}>Umbral de reposición por pool. El sector es opcional.</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:10 }}>
            <label style={{ flex:'1 1 120px', minWidth:0 }}><div style={lb}>Pool</div><select value={form.pool} onChange={e=>setForm(o=>Object.assign({},o,{pool:e.target.value}))} style={inp}>{POOLS.map(p=><option key={p} value={p}>{p}</option>)}</select></label>
            <label style={{ flex:'2 1 140px', minWidth:0 }}><div style={lb}>SKU</div><input value={form.sku} onChange={e=>setForm(o=>Object.assign({},o,{sku:e.target.value}))} placeholder="SKU" style={inp} /></label>
            <label style={{ flex:'1 1 90px', minWidth:0 }}><div style={lb}>Mínimo</div><input type="number" inputMode="numeric" min="0" value={form.minimo} onChange={e=>setForm(o=>Object.assign({},o,{minimo:e.target.value}))} placeholder="0" style={inp} /></label>
            <label style={{ flex:'1 1 110px', minWidth:0 }}><div style={lb}>Sector (opc.)</div><input value={form.sector} onChange={e=>setForm(o=>Object.assign({},o,{sector:e.target.value}))} placeholder="opcional" style={inp} /></label>
          </div>
          <div style={{ marginTop:12 }}>
            <button onClick={guardar} disabled={busy} style={btn(U.accent, !busy)}>Guardar mínimo</button>
          </div>
        </div>

        <div style={card}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', flexWrap:'wrap', gap:8 }}>
            <div style={h}>Alertas actuales</div>
            <div style={{ fontSize:11.5, color:U.inkMuted }}>Mínimos configurados: <b>{configurados != null ? configurados : '—'}</b></div>
          </div>
          {data === undefined ? <div style={{ color:U.inkMuted, fontSize:12 }}>Cargando…</div>
            : alertas.length === 0 ? <div style={{ color:U.inkMuted, fontSize:12 }}>Sin alertas activas.</div>
            : (
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {alertas.map((a,i) => (
                  <div key={a.id!=null?a.id:i} style={{ border:`1px solid ${U.border}`, borderRadius:10, padding:'10px 12px', background:U.surface2, display:'flex', gap:8, justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', minWidth:0, maxWidth:'100%', boxSizing:'border-box' }}>
                    <div style={{ minWidth:0, overflowWrap:'anywhere' }}>
                      <div><span style={chip}>{a.pool}</span> <b style={{ color:U.ink }}>{a.sku}</b> <span style={{ fontWeight:800, color:nivelColor(a.nivel||a.estado), fontSize:12 }}>{(a.nivel||a.estado||'').toString().toUpperCase()}</span></div>
                      <div style={{ fontSize:11.5, color:U.inkSoft, marginTop:3 }}>disp <b>{a.disponible!=null?a.disponible:'—'}</b> · mín <b>{a.minimo!=null?a.minimo:'—'}</b>{a.estado ? <span> · {a.estado}</span> : null}</div>
                    </div>
                    {a.id!=null ? <button onClick={()=>reconocer(a.id)} disabled={busy} style={btn(U.accent, !busy)}>Reconocer</button> : null}
                  </div>
                ))}
              </div>
            )}
        </div>
      </div>
    );
  }

  // ── 4) Mapeo de estados externos ──
  function EstadosSection() {
    const [orderId, setOrderId] = useState('');
    const [valor, setValor] = useState('');
    const [fecha, setFecha] = useState('');
    const [res, setRes] = useState(null);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState(''); const [err, setErr] = useState('');

    const guardar = async () => {
      if (busy) return;
      const oid = (orderId||'').trim();
      const v = (valor||'').trim();
      if (!oid) { setErr('Indicá el order_id.'); setMsg(''); setRes(null); return; }
      if (!v) { setErr('Indicá el valor externo.'); setMsg(''); setRes(null); return; }
      setBusy(true); setMsg(''); setErr(''); setRes(null);
      try {
        const payload = { order_id:oid, valor_externo:v };
        const f = (fecha||'').trim();
        if (f) payload.reprogramada_para = f;
        const r = await window.LP_DATA.setEstadoExterno(payload);
        setRes(r || {});
        setMsg('Estado externo registrado para ' + oid + '.');
      } catch (e) { setErr((e && e.message) || 'No se pudo mapear el estado'); }
      finally { setBusy(false); }
    };

    const revision = !!(res && res.requiere_revision === true);

    return (
      <div style={{ maxWidth:'100%' }}>
        <Feedback msg={msg} err={err} />
        <div style={card}>
          <div style={h}>Mapeo de estados externos</div>
          <div style={sub}>Traducí un valor de estado externo (texto libre) al estado canónico de la línea. Podés indicar una fecha reprogramada.</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:10 }}>
            <label style={{ flex:'1 1 130px', minWidth:0 }}><div style={lb}>Order ID</div><input value={orderId} onChange={e=>setOrderId(e.target.value)} placeholder="ID de la orden" style={inp} /></label>
            <label style={{ flex:'2 1 170px', minWidth:0 }}><div style={lb}>Valor externo</div><input value={valor} onChange={e=>setValor(e.target.value)} placeholder="demorado / reprogramado…" style={inp} /></label>
            <label style={{ flex:'1 1 140px', minWidth:0 }}><div style={lb}>Reprogramada (opc.)</div><input type="date" value={fecha} onChange={e=>setFecha(e.target.value)} style={inp} /></label>
          </div>
          <div style={{ marginTop:12 }}>
            <button onClick={guardar} disabled={busy} style={btn(U.accent, !busy)}>Mapear estado</button>
          </div>

          {res ? (
            <div style={{ marginTop:14, border:`1px solid ${revision?'#FDE68A':U.border}`, background: revision?'#FFFBEB':U.surface2, borderRadius:10, padding:'12px 14px', maxWidth:'100%', boxSizing:'border-box' }}>
              <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em', color:U.inkMuted }}>Estado canónico</div>
              <div style={{ fontSize:16, fontWeight:800, color: revision?'#92400E':U.ink, marginTop:2, overflowWrap:'anywhere' }}>{res.estado_canonico!=null && res.estado_canonico!=='' ? res.estado_canonico : '—'}</div>
              {res.reprogramada_para ? <div style={{ fontSize:12, color:U.inkSoft, marginTop:4 }}>Reprogramada para <b>{res.reprogramada_para}</b></div> : null}
              {revision ? <div style={{ marginTop:8, fontSize:12, fontWeight:800, color:'#92400E' }}>⚠ Estado desconocido — requiere revisión manual.</div> : null}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  function LineaConfigPage() {
    // FIX orden de hooks: NO llamar hooks de datos dentro del inicializador de useState.
    const [role] = useState(() => ((window.MOCK && window.MOCK.user && window.MOCK.user.role) || '').toLowerCase());
    const [tab, setTab] = useState('mp');
    const puede = ['owner','admin','encargado'].includes(role);
    if (!puede) return <div style={{ padding:40, textAlign:'center', color:U.inkMuted }}>Solo owner/admin/encargado.</div>;

    const TABS = [
      { v:'mp', l:'Materia prima' },
      { v:'sets', l:'Equivalencia a sets' },
      { v:'minimos', l:'Mínimos y alertas' },
      { v:'estados', l:'Estados externos' },
    ];
    const tabBtn = (active) => ({ border:`1px solid ${active?U.accent:U.border}`, background: active?U.accent:U.surface, color: active?'#fff':U.inkSoft, borderRadius:999, padding:'8px 14px', fontSize:12.5, fontWeight:800, cursor:'pointer', whiteSpace:'nowrap' });

    return (
      <div style={{ background:U.surface2, padding:PAGE_PAD, minHeight:'60vh', boxSizing:'border-box', maxWidth:'100%', overflowX:'hidden' }}>
        <div style={{ fontSize:11, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:U.accent, marginBottom:2 }}>Línea Productiva</div>
        <div style={{ fontSize:18, fontWeight:800, color:U.ink, marginBottom:14 }}>Configuración</div>

        <CapacidadBanner />

        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:14, maxWidth:'100%' }}>
          {TABS.map(t => <button key={t.v} onClick={()=>setTab(t.v)} style={tabBtn(tab===t.v)}>{t.l}</button>)}
        </div>

        {tab==='mp' ? <MateriaPrimaSection /> : null}
        {tab==='sets' ? <SetsSection /> : null}
        {tab==='minimos' ? <MinimosSection /> : null}
        {tab==='estados' ? <EstadosSection /> : null}
      </div>
    );
  }

  window.LineaConfigPage = LineaConfigPage;
})();
