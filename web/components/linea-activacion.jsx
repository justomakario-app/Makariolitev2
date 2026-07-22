/* ══ LÍNEA PRODUCTIVA · ACTIVACIÓN (puente ventas ↔ jornada) ════════════════
   Arranca en 0 a propósito. Este es el puente que faltaba para EMPEZAR a usarla:
   - Estado neutro "Línea Productiva todavía no iniciada".
   - Iniciar primera jornada (owner/admin/encargado; validado también en backend).
   - Elegir origen de ventas → Preview read-only → Confirmar explícito (idempotente).
   - Actualizar jornada (sync: nuevas/cantidades/cancelaciones, sin duplicar).
   - Arrastre NETO de pendientes de la jornada anterior (no re-demanda lo terminado).
   - Cerrar con guarda: si hay pendientes, pide confirmación (forzar).
   window.LineaActivacionPage
   ══ */
(function () {
  const U = { surface:'#FFFFFF', surface2:'#F8F8FA', border:'rgba(0,0,0,0.10)', ink:'#0A0A0A', inkSoft:'#555', inkMuted:'#8A8A8A', accent:'#2E4057', ok:'#16A34A', warn:'#D97706', danger:'#DC2626' };
  const hoy = () => new Date().toISOString().slice(0,10);
  const btn = (bg, on) => ({ background: on?bg:'#CBD5E1', border:'none', borderRadius:10, color:'#fff', padding:'10px 16px', fontSize:13, fontWeight:800, cursor:on?'pointer':'not-allowed' });

  // ── Gestión de jornadas (0138/0141): hasta 3 abiertas, 1 en ejecución, capacidad, override ──
  function JornadasPanel() {
    const pcard = { background:U.surface, border:`1px solid ${U.border}`, borderRadius:14, padding:'16px 18px', marginBottom:14 };
    const [role] = useState(() => ((window.MOCK && window.MOCK.user && window.MOCK.user.role) || '').toLowerCase());
    const [lista, setLista] = useState(null);
    const [cap, setCap] = useState(null);
    const [busy, setBusy] = useState(false);
    const [nueva, setNueva] = useState(hoy);
    const [pmsg, setPmsg] = useState(''); const [perr, setPerr] = useState('');
    const puede = ['owner','admin','encargado'].includes(role);
    const cargar = React.useCallback(async () => {
      try { setLista(await window.LP_DATA.listaJornadas()); }
      catch (e) { setPerr((e && e.message) || 'error'); setLista([]); }
      try { setCap(await window.LP_DATA.capacidad()); } catch (e) { setCap(null); }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);
    if (!puede) return null;
    const planificar = async () => { setBusy(true); setPmsg(''); setPerr(''); try { await window.LP_DATA.planificarJornada({ fecha: nueva }); setPmsg('Jornada planificada.'); await cargar(); } catch (e) { setPerr((e && e.message) || 'error'); } finally { setBusy(false); } };
    const pausar = async (id) => { setBusy(true); setPmsg(''); setPerr(''); try { await window.LP_DATA.pausarJornada({ jornada_id: id }); setPmsg('Jornada pausada.'); await cargar(); } catch (e) { setPerr((e && e.message) || 'error'); } finally { setBusy(false); } };
    const ejecutar = async (id) => {
      setBusy(true); setPmsg(''); setPerr('');
      try { await window.LP_DATA.ejecutarJornada({ jornada_id: id }); setPmsg('Jornada en ejecución.'); await cargar(); }
      catch (e) {
        const m = (e && e.message) || '';
        if (/Capacidad incompleta|no calculable/.test(m)) {
          const motivo = window.prompt('Capacidad no calculable (faltan equivalencias a sets). Ingresá el MOTIVO del override para ejecutar igual (queda auditado):');
          if (motivo && motivo.trim()) { try { await window.LP_DATA.ejecutarJornada({ jornada_id: id, override_motivo: motivo.trim() }); setPmsg('Ejecutada con override auditado.'); await cargar(); } catch (e2) { setPerr((e2 && e2.message) || 'error'); } }
          else setPerr('Ejecución cancelada (sin override).');
        } else setPerr(m || 'error');
      } finally { setBusy(false); }
    };
    const faseLabel = { planificada:'Planificada', en_ejecucion:'▶ En ejecución', pausada:'⏸ Pausada' };
    const faseColor = { planificada:'#8A8A8A', en_ejecucion:'#16A34A', pausada:'#D97706' };
    return (
      <div style={pcard}>
        <div style={{ fontWeight:800, marginBottom:8, color:U.ink }}>Jornadas · máx. 3 abiertas, 1 en ejecución</div>
        {pmsg ? <div style={{ color:'#065F46', fontSize:12, marginBottom:6, fontWeight:700 }}>{pmsg}</div> : null}
        {perr ? <div style={{ color:'#991B1B', fontSize:12, marginBottom:6, fontWeight:700 }}>{perr}</div> : null}
        {cap && cap.calculable === false && cap.nivel === 'no_calculable'
          ? <div style={{ background:'#FEF3C7', border:'1px solid #FDE68A', borderRadius:8, padding:8, fontSize:12, color:'#92400E', marginBottom:8 }}>Capacidad no calculable: faltan equivalencias a sets ({cap.skus_sin_equiv || '—'}). Para ejecutar hará falta override auditado.</div>
          : cap && cap.calculable ? <div style={{ fontSize:12, fontWeight:700, color: cap.nivel==='critica'?'#DC2626':cap.nivel==='advertencia'?'#D97706':'#16A34A', marginBottom:8 }}>Capacidad: {cap.sets} sets · {cap.nivel} (aviso {cap.advertencia} / crítico {cap.critica})</div> : null}
        <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:10 }}>
          {(lista || []).map(j => (
            <div key={j.id} style={{ display:'flex', gap:8, alignItems:'center', justifyContent:'space-between', border:`1px solid ${U.border}`, borderRadius:8, padding:'8px 10px', flexWrap:'wrap' }}>
              <div style={{ minWidth:0 }}><span style={{ fontWeight:700 }}>{j.fecha}</span> <span style={{ color:faseColor[j.fase]||U.inkMuted, fontWeight:800, fontSize:12 }}>{faseLabel[j.fase]||j.fase}</span></div>
              <div style={{ display:'flex', gap:6 }}>
                {j.fase !== 'en_ejecucion'
                  ? <button disabled={busy} style={btn('#16A34A', !busy)} onClick={() => ejecutar(j.id)}>Ejecutar</button>
                  : <button disabled={busy} style={btn('#D97706', !busy)} onClick={() => pausar(j.id)}>Pausar</button>}
              </div>
            </div>
          ))}
          {lista && lista.length === 0 ? <div style={{ color:U.inkMuted, fontSize:12 }}>No hay jornadas abiertas.</div> : null}
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          <input type="date" value={nueva} onChange={e => setNueva(e.target.value)} style={{ padding:'8px 10px', borderRadius:8, border:`1px solid ${U.border}`, minWidth:0, maxWidth:'100%', boxSizing:'border-box' }}/>
          <button disabled={busy} style={btn(U.accent, !busy)} onClick={planificar}>Planificar jornada</button>
        </div>
      </div>
    );
  }

  function LineaActivacionPage() {
    // FIX auditoría: NO llamar el hook useMockData() dentro del inicializador de useState
    // (rompe el orden de hooks → crash en el primer re-render). role no necesita reactividad.
    const [role] = useState(() => ((window.MOCK && window.MOCK.user && window.MOCK.user.role) || '').toLowerCase());
    const [jornada, setJornada] = useState(undefined); // undefined=cargando, null=sin jornada
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');
    const [err, setErr] = useState('');
    const [origenTipo, setOrigenTipo] = useState('fecha_desde');
    const [fecha, setFecha] = useState(hoy);
    const [preview, setPreview] = useState(null);
    const [arrastre, setArrastre] = useState(null);
    const [cierre, setCierre] = useState(null); // resumen de guarda si requiere confirmación

    const puede = ['owner','admin','encargado'].includes(role);
    const abierta = jornada && jornada.estado === 'abierta';

    const cargar = React.useCallback(async () => {
      try { const j = await window.LP_DATA.jornadaHoy(); setJornada(j || null); }
      catch (e) { setErr(e && e.message ? e.message : 'No se pudo leer la jornada'); setJornada(null); }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    const origen = () => origenTipo === 'arrastre' ? { tipo:'arrastre' } : { tipo:'fecha_desde', fecha };
    const limpiar = () => { setPreview(null); setArrastre(null); setCierre(null); setMsg(''); setErr(''); };

    const iniciar = async () => {
      if (busy) return; setBusy(true); setErr('');
      try { await window.LP_DATA.abrirJornada(); setMsg('Jornada iniciada.'); await cargar(); }
      catch (e) { setErr(e && e.message ? e.message : 'No se pudo iniciar'); }
      finally { setBusy(false); }
    };
    const doPreview = async () => {
      if (busy) return; setBusy(true); limpiar();
      try { setPreview(await window.LP_DATA.vincularPreview({ origen: origen() })); }
      catch (e) { setErr(e && e.message ? e.message : 'No se pudo previsualizar'); }
      finally { setBusy(false); }
    };
    const confirmar = async () => {
      if (busy) return; setBusy(true); setErr('');
      try { const r = await window.LP_DATA.vincularConfirmar({ origen: origen() });
        setMsg('Vinculadas ' + (r.vinculadas_nuevas||0) + ' venta(s). Cubiertas con stock terminado: ' + (r.auto_asignadas_de_stock_libre||0) + '. Total en jornada: ' + (r.total_en_jornada||0) + '.'); setPreview(null); }
      catch (e) { setErr(e && e.message ? e.message : 'No se pudo confirmar'); }
      finally { setBusy(false); }
    };
    const actualizar = async () => {
      if (busy) return; setBusy(true); setErr('');
      try { const r = await window.LP_DATA.jornadaSync({ origen: origen() });
        setMsg('Sync: ' + (r.nuevas||0) + ' nuevas · ' + (r.actualizadas||0) + ' actualizadas · ' + (r.canceladas||0) + ' canceladas · '
          + (r.cumplidas||0) + ' cumplidas · ' + (r.reactivadas||0) + ' reactivadas · '
          + (r.liberadas_a_stock_libre||0) + ' u. liberadas a stock · ' + (r.auto_asignadas_de_stock_libre||0) + ' cubiertas con stock'
          + ((r.anomalias_archivado_con_pendiente||0) > 0 ? ' · ⚠ ' + r.anomalias_archivado_con_pendiente + ' archivada(s) con pendiente' : '') + '.'); }
      catch (e) { setErr(e && e.message ? e.message : 'No se pudo actualizar'); }
      finally { setBusy(false); }
    };
    const verArrastre = async () => {
      if (busy) return; setBusy(true); limpiar();
      try { setArrastre(await window.LP_DATA.arrastrePreview({})); }
      catch (e) { setErr(e && e.message ? e.message : 'No se pudo leer el arrastre'); }
      finally { setBusy(false); }
    };
    const cerrar = async (forzar) => {
      if (busy) return; setBusy(true); setErr('');
      try { const r = await window.LP_DATA.cerrarJornada(forzar ? { forzar:true } : {});
        if (r && r.ok === false && r.requiere_confirmacion) { setCierre(r); }
        else { setMsg('Jornada cerrada.'); setCierre(null); await cargar(); } }
      catch (e) { setErr(e && e.message ? e.message : 'No se pudo cerrar'); }
      finally { setBusy(false); }
    };

    const card = { background:U.surface, border:`1px solid ${U.border}`, borderRadius:14, padding:'16px 18px', marginBottom:14 };
    const h = { fontSize:14, fontWeight:800, color:U.ink, margin:'0 0 10px' };

    if (jornada === undefined) return <div style={{ padding:40, textAlign:'center', color:U.inkMuted }}>Cargando…</div>;
    if (!puede) return <div style={{ padding:40, textAlign:'center', color:U.inkMuted }}>Solo owner/admin/encargado pueden activar la Línea Productiva.</div>;

    return (
      <div style={{ background:U.surface2, padding:'20px clamp(12px,4vw,24px) 32px', minHeight:'60vh', boxSizing:'border-box', maxWidth:'100%', overflowX:'hidden' }}>
        {msg ? <div style={{ ...card, background:'#ECFDF5', borderColor:'#A7F3D0', color:'#065F46', fontWeight:700 }}>{msg}</div> : null}
        {err ? <div style={{ ...card, background:'#FEF2F2', borderColor:'#FECACA', color:'#991B1B', fontWeight:700 }}>{err}</div> : null}

        <JornadasPanel/>

        {!abierta ? (
          <div style={{ ...card, textAlign:'center', padding:'40px 18px' }}>
            <div style={{ fontSize:18, fontWeight:800, color:U.ink, marginBottom:8 }}>Línea Productiva todavía no iniciada</div>
            <div style={{ fontSize:13, color:U.inkSoft, marginBottom:20, lineHeight:1.6 }}>
              Empieza en cero a propósito. Cuando quieras arrancar, iniciá la primera jornada y elegí qué ventas incorporar.<br/>
              No se traen ventas históricas sin tu confirmación.
            </div>
            <button onClick={iniciar} disabled={busy} style={btn(U.accent, !busy)}>Iniciar Línea Productiva</button>
          </div>
        ) : (
          <>
            <div style={card}>
              <h3 style={h}>Jornada abierta · {jornada.fecha}</h3>
              <div style={{ fontSize:12.5, color:U.inkSoft, marginBottom:14 }}>Elegí el origen de ventas, previsualizá y confirmá. Nada se vincula hasta que confirmes.</div>
              <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', marginBottom:12 }}>
                <select value={origenTipo} onChange={e => { setOrigenTipo(e.target.value); limpiar(); }}
                        style={{ padding:'8px 10px', borderRadius:8, border:`1px solid ${U.border}`, fontSize:13, flex:'1 1 150px', minWidth:0, maxWidth:'100%', boxSizing:'border-box' }}>
                  <option value="fecha_desde">Ventas desde una fecha</option>
                  <option value="arrastre">Pendientes de la jornada anterior</option>
                </select>
                {origenTipo === 'fecha_desde' ? (
                  <input type="date" value={fecha} onChange={e => { setFecha(e.target.value); limpiar(); }}
                         style={{ padding:'8px 10px', borderRadius:8, border:`1px solid ${U.border}`, fontSize:13, flex:'1 1 130px', minWidth:0, maxWidth:'100%', boxSizing:'border-box' }}/>
                ) : null}
                {origenTipo === 'arrastre'
                  ? <button onClick={verArrastre} disabled={busy} style={btn(U.accent, !busy)}>Ver pendientes</button>
                  : <button onClick={doPreview} disabled={busy} style={btn(U.accent, !busy)}>Previsualizar</button>}
              </div>

              {arrastre ? (
                <div style={{ background:U.surface2, border:`1px solid ${U.border}`, borderRadius:10, padding:12, marginBottom:12 }}>
                  <div style={{ fontWeight:800, marginBottom:8, color:U.ink }}>Pendientes de la jornada anterior (por pedido)</div>
                  {(arrastre.pendientes_por_pedido || []).length === 0
                    ? <div style={{ color:U.inkMuted, fontSize:12.5 }}>No hay pendientes arrastrables.</div>
                    : (arrastre.pendientes_por_pedido || []).map((p,i) => (
                      <div key={i} style={{ fontSize:12.5, color:U.ink, padding:'3px 0' }}>
                        <b>{p.sku}</b> — pedido {p.cantidad} · cubierto {p.ya_asignado} · <b style={{ color:U.accent }}>a fabricar {p.pendiente_real}</b>
                      </div>))}
                </div>
              ) : null}

              {preview ? (
                <div style={{ background:U.surface2, border:`1px solid ${U.border}`, borderRadius:10, padding:12, marginBottom:12 }}>
                  <div style={{ fontWeight:800, marginBottom:8, color:U.ink }}>Se vincularían: {preview.total_ventas} venta(s) · {preview.total_unidades} unidad(es)</div>
                  {(preview.detalle || []).slice(0,40).map((d,i) => (
                    <div key={i} style={{ fontSize:12.5, color:U.ink, padding:'2px 0' }}>{d.sku} — {d.unidades} u {d.canal ? `· ${d.canal}` : ''}</div>
                  ))}
                  {(preview.total_ventas > 0) && <div style={{ fontSize:11.5, color:U.inkMuted, marginTop:6 }}>Read-only: todavía no se escribió nada.</div>}
                </div>
              ) : null}

              <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
                <button onClick={confirmar} disabled={busy || (!preview && origenTipo!=='arrastre') || (preview && preview.total_ventas===0)} style={btn(U.ok, !busy && (origenTipo==='arrastre' || (preview && preview.total_ventas>0)))}>Confirmar vinculación</button>
                <button onClick={actualizar} disabled={busy} style={btn(U.accent, !busy)}>Actualizar jornada</button>
              </div>
            </div>

            <div style={card}>
              <h3 style={h}>Cerrar jornada</h3>
              {cierre ? (
                <div style={{ background:'#FFFBEB', border:'1px solid #FDE68A', borderRadius:10, padding:12, marginBottom:12 }}>
                  <div style={{ fontWeight:800, color:'#92400E', marginBottom:6 }}>Queda trabajo pendiente</div>
                  <div style={{ fontSize:12.5, color:'#92400E', marginBottom:8 }}>
                    Mesas por armar: <b>{cierre.mesas_pendientes_total}</b> · Piezas faltantes: <b>{cierre.faltantes_piezas_count}</b>.
                    Lo pendiente se arrastra NETO a la próxima jornada (no se re-fabrica lo ya hecho).
                  </div>
                  <button onClick={() => cerrar(true)} disabled={busy} style={btn(U.danger, !busy)}>Cerrar igual (forzar)</button>
                </div>
              ) : (
                <button onClick={() => cerrar(false)} disabled={busy} style={btn(U.accent, !busy)}>Cerrar jornada</button>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  window.LineaActivacionPage = LineaActivacionPage;
})();
