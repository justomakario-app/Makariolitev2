/* ══ LÍNEA PRODUCTIVA · TAREAS (ciclo reservado → en_proceso → finalizada) ══
   Panel operativo de las tareas de una jornada.
   - Lee window.LP_DATA.jornadaHoy() (null → estado neutro "no iniciada").
   - Lee window.LP_DATA.tareas() (vista prod_v_tareas), agrupadas por sector.
   - Reservar jornada (owner/admin/encargado) → genera/actualiza tareas + reserva.
   - Por tarea: Iniciar (parcial, reservado→en_proceso, default=reservado) ·
     Finalizar (consume en_proceso, genera output, default=en_proceso) ·
     Cancelar (solo gestor; movimiento compensatorio).
   - Permisos reales: operario de sector (role===tarea.sector) inicia/finaliza
     SU sector; owner/admin/encargado todo. config_incompleta muestra su nota y
     no permite iniciar. Mensajes de éxito/error del backend tal cual; refresca
     tras cada acción. Responsivo, sin overflow horizontal a 360/390px.
   window.LineaTareasPage
   ══ */
(function () {
  const U = { surface:'#FFFFFF', surface2:'#F8F8FA', border:'rgba(0,0,0,0.10)', ink:'#0A0A0A', inkSoft:'#555', inkMuted:'#8A8A8A', accent:'#2E4057', ok:'#16A34A', warn:'#D97706', danger:'#DC2626' };
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const btn = (bg, on) => ({ background: on?bg:'#CBD5E1', border:'none', borderRadius:10, color:'#fff', padding:'10px 16px', fontSize:13, fontWeight:800, cursor:on?'pointer':'not-allowed' });
  const btnGhost = { background:'transparent', border:`1px solid ${U.border}`, borderRadius:10, color:U.inkSoft, padding:'10px 16px', fontSize:13, fontWeight:800, cursor:'pointer' };
  const btnDanger = { background:'transparent', border:`1px solid ${U.danger}`, borderRadius:10, color:U.danger, padding:'10px 16px', fontSize:13, fontWeight:800, cursor:'pointer' };

  const ESTADO = {
    planificada:       { label:'Planificada',        c:'#8A8A8A', bg:'#F1F5F9' },
    reservada:         { label:'Reservada',          c:'#2E4057', bg:'#EEF2F7' },
    en_proceso:        { label:'En proceso',         c:'#D97706', bg:'#FFFBEB' },
    finalizada:        { label:'Finalizada',         c:'#16A34A', bg:'#ECFDF5' },
    cancelada:         { label:'Cancelada',          c:'#DC2626', bg:'#FEF2F2' },
    config_incompleta: { label:'Config. incompleta', c:'#B45309', bg:'#FEF3C7' },
  };
  const SECTOR_LABEL = { cnc:'CNC', melamina:'Melamina', pino:'Pino', embalaje:'Embalaje' };
  const SECTOR_COLOR = { cnc:'#2563EB', melamina:'#7C3AED', pino:'#B45309', embalaje:'#0EA5E9' };
  const SECTOR_ORDER = ['cnc', 'melamina', 'pino'];

  const card = { background:U.surface, border:`1px solid ${U.border}`, borderRadius:14, padding:'16px 18px', marginBottom:14, boxSizing:'border-box', maxWidth:'100%' };

  // ── Tarjeta de una tarea (con sus acciones e inputs de cantidad) ──
  function TareaCard({ tarea, role, esGestor, onDone, onMsg, onErr }) {
    const [modo, setModo] = useState(null);   // 'iniciar' | 'finalizar' | null
    const [cant, setCant] = useState('');
    const [saving, setSaving] = useState(false);

    const estado = tarea.estado || '';
    const em = ESTADO[estado] || { label: estado || '—', c:U.inkMuted, bg:U.surface2 };
    const term = estado === 'finalizada' || estado === 'cancelada';
    const incompleta = estado === 'config_incompleta';
    const sc = SECTOR_COLOR[tarea.sector] || U.accent;

    const puedeOperar = esGestor || (role && role === tarea.sector);
    const reservado = num(tarea.reservado);
    const enProceso = num(tarea.en_proceso);
    const canIniciar   = puedeOperar && !incompleta && !term && reservado > 0;
    const canFinalizar = puedeOperar && !incompleta && !term && enProceso > 0;
    const canCancelar  = esGestor && !incompleta && !term;

    const n = Number(cant);
    const nOk = Number.isFinite(n) && n > 0;

    const doAccion = async (kind) => {
      if (saving) return;
      setSaving(true); onMsg(''); onErr('');
      try {
        if (kind === 'iniciar') { await window.LP_DATA.iniciarTarea({ tarea_id: tarea.id, cantidad: n }); onMsg('Iniciada: ' + n + ' u. en ' + (SECTOR_LABEL[tarea.sector] || tarea.sector) + ' (' + (tarea.output_sku || '') + ').'); }
        else if (kind === 'finalizar') { await window.LP_DATA.finalizarTarea({ tarea_id: tarea.id, cantidad: n }); onMsg('Finalizada: ' + n + ' u. de ' + (tarea.output_sku || '') + '.'); }
        else if (kind === 'cancelar') { await window.LP_DATA.cancelarTarea({ tarea_id: tarea.id }); onMsg('Tarea cancelada (' + (tarea.output_sku || '') + ').'); }
        setModo(null); setCant('');
        await onDone();
      } catch (e) { onErr(e && e.message ? e.message : 'No se pudo completar la acción'); }
      finally { setSaving(false); }
    };

    const abrir = (kind) => { onMsg(''); onErr(''); setModo(kind); setCant(String(kind === 'iniciar' ? reservado : enProceso)); };
    const cancelarTarea = () => { if (window.confirm('¿Cancelar esta tarea? Se registra un movimiento compensatorio.')) doAccion('cancelar'); };

    const inp = { width:96, maxWidth:'42vw', minWidth:0, boxSizing:'border-box', padding:'9px 10px', borderRadius:8, border:`1px solid ${U.border}`, fontSize:15, fontWeight:800, textAlign:'center', fontVariantNumeric:'tabular-nums' };
    const stats = [
      { k:'Plan',       v: num(tarea.input_plan),      c:U.inkSoft },
      { k:'Reservado',  v: reservado,                  c:U.accent },
      { k:'En proceso', v: enProceso,                  c:U.warn },
      { k:'Producido',  v: num(tarea.output_generado), c:U.ok },
    ];

    return (
      <div style={{ background:U.surface, border:`1px solid ${U.border}`, borderLeft:`3px solid ${sc}`, borderRadius:12, padding:'12px 14px', marginBottom:10, boxSizing:'border-box', maxWidth:'100%' }}>
        <div style={{ display:'flex', gap:10, alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap' }}>
          <div style={{ minWidth:0, flex:'1 1 160px' }}>
            <div style={{ fontSize:14, fontWeight:800, color:U.ink, wordBreak:'break-word' }}>{tarea.output_sku || '—'}</div>
            <div style={{ fontSize:11.5, color:U.inkMuted, marginTop:2, wordBreak:'break-word' }}>
              desde <b style={{ color:U.inkSoft }}>{tarea.input_sku || '—'}</b>{num(tarea.factor) && num(tarea.factor) !== 1 ? ' · ×' + num(tarea.factor) : ''}
            </div>
          </div>
          <span style={{ fontSize:11, fontWeight:800, color:em.c, background:em.bg, border:`1px solid ${em.c}33`, borderRadius:999, padding:'3px 10px', whiteSpace:'nowrap' }}>{em.label}</span>
        </div>

        <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginTop:10 }}>
          {stats.map(s => (
            <div key={s.k} style={{ flex:'1 1 68px', minWidth:0, background:U.surface2, border:`1px solid ${U.border}`, borderRadius:9, padding:'7px 9px', boxSizing:'border-box' }}>
              <div style={{ fontSize:9.5, fontWeight:800, letterSpacing:'.04em', textTransform:'uppercase', color:U.inkMuted, whiteSpace:'nowrap' }}>{s.k}</div>
              <div style={{ fontSize:17, fontWeight:800, color:s.c, fontVariantNumeric:'tabular-nums', lineHeight:1.15 }}>{s.v}</div>
            </div>
          ))}
        </div>

        {tarea.nota ? (
          <div style={{ marginTop:10, background: incompleta ? '#FEF3C7' : U.surface2, border:`1px solid ${incompleta ? '#FDE68A' : U.border}`, borderRadius:9, padding:'8px 10px', fontSize:12, color: incompleta ? '#92400E' : U.inkSoft, wordBreak:'break-word' }}>
            {tarea.nota}
          </div>
        ) : null}

        {incompleta ? null : modo ? (
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginTop:11 }}>
            <span style={{ fontSize:12, fontWeight:700, color:U.inkSoft }}>{modo === 'iniciar' ? 'A iniciar' : 'A finalizar'}</span>
            <input type="number" inputMode="numeric" min="0" value={cant} onChange={e => setCant(e.target.value)} style={inp}/>
            <button disabled={saving || !nOk} style={btn(modo === 'iniciar' ? U.accent : U.ok, !saving && nOk)} onClick={() => doAccion(modo)}>{saving ? '…' : 'Confirmar'}</button>
            <button disabled={saving} style={btnGhost} onClick={() => { setModo(null); setCant(''); }}>Volver</button>
          </div>
        ) : (canIniciar || canFinalizar || canCancelar) ? (
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:11 }}>
            {canIniciar ? <button disabled={saving} style={btn(U.accent, !saving)} onClick={() => abrir('iniciar')}>Iniciar</button> : null}
            {canFinalizar ? <button disabled={saving} style={btn(U.ok, !saving)} onClick={() => abrir('finalizar')}>Finalizar</button> : null}
            {canCancelar ? <button disabled={saving} style={btnDanger} onClick={cancelarTarea}>Cancelar</button> : null}
          </div>
        ) : null}
      </div>
    );
  }

  function LineaTareasPage() {
    const [role] = useState(() => ((window.MOCK && window.MOCK.user && window.MOCK.user.role) || '').toLowerCase());
    const [jornada, setJornada] = useState(undefined); // undefined=cargando, null=sin jornada
    const [tareas, setTareas] = useState(null);        // null=cargando, []=vacío
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');
    const [err, setErr] = useState('');
    const [cargaErr, setCargaErr] = useState('');

    const esGestor = ['owner', 'admin', 'encargado'].includes(role);

    const cargar = React.useCallback(async () => {
      setCargaErr('');
      try {
        const j = await window.LP_DATA.jornadaHoy();
        setJornada(j || null);
        if (j && j.jornada_id) {
          const t = await window.LP_DATA.tareas({ jornada_id: j.jornada_id });
          setTareas(Array.isArray(t) ? t : []);
        } else {
          setTareas([]);
        }
      } catch (e) {
        setCargaErr(e && e.message ? e.message : 'No se pudo cargar');
        setJornada(prev => prev === undefined ? null : prev);
        setTareas(prev => prev || []);
      }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    const reservar = async () => {
      if (busy) return; setBusy(true); setMsg(''); setErr('');
      try {
        await window.LP_DATA.reservarJornada(jornada && jornada.jornada_id ? { jornada_id: jornada.jornada_id } : {});
        setMsg('Jornada reservada. Tareas generadas/actualizadas.');
        await cargar();
      } catch (e) { setErr(e && e.message ? e.message : 'No se pudo reservar la jornada'); }
      finally { setBusy(false); }
    };

    // Agrupar por sector: cnc/melamina/pino primero; cualquier extra, alfabético.
    const grupos = (() => {
      const map = {};
      for (const t of (tareas || [])) { const s = t.sector || 'otros'; (map[s] = map[s] || []).push(t); }
      const extra = Object.keys(map).filter(s => SECTOR_ORDER.indexOf(s) < 0).sort();
      return SECTOR_ORDER.concat(extra).filter(s => map[s]).map(s => ({ sector:s, items:map[s] }));
    })();

    if (jornada === undefined && !cargaErr) return <div style={{ padding:40, textAlign:'center', color:U.inkMuted }}>Cargando…</div>;

    const estadoJ = jornada && jornada.estado;
    const jBadge = estadoJ === 'abierta' ? { t:'Abierta', c:U.ok, bg:'#ECFDF5' } : { t: estadoJ ? estadoJ : '—', c:U.inkMuted, bg:U.surface2 };

    return (
      <div style={{ background:U.surface2, padding:'20px clamp(12px,4vw,24px) 32px', minHeight:'60vh', boxSizing:'border-box', maxWidth:'100%', overflowX:'hidden' }}>
        {msg ? <div style={{ ...card, background:'#ECFDF5', borderColor:'#A7F3D0', color:'#065F46', fontWeight:700, wordBreak:'break-word' }}>{msg}</div> : null}
        {err ? <div style={{ ...card, background:'#FEF2F2', borderColor:'#FECACA', color:'#991B1B', fontWeight:700, wordBreak:'break-word' }}>{err}</div> : null}

        {cargaErr ? (
          <div style={{ ...card, background:'#FEF2F2', borderColor:'#FECACA' }}>
            <div style={{ color:'#991B1B', fontWeight:800, marginBottom:6 }}>No se pudieron cargar las tareas</div>
            <div style={{ fontSize:12.5, color:'#991B1B', marginBottom:10, wordBreak:'break-word' }}>{cargaErr}</div>
            <button onClick={cargar} style={btn(U.accent, true)}>Reintentar</button>
          </div>
        ) : null}

        {!jornada && !cargaErr ? (
          <div style={{ ...card, textAlign:'center', padding:'40px 18px' }}>
            <div style={{ fontSize:18, fontWeight:800, color:U.ink, marginBottom:8 }}>Línea Productiva todavía no iniciada</div>
            <div style={{ fontSize:13, color:U.inkSoft, lineHeight:1.6 }}>
              Cuando se inicie y se reserve una jornada, acá vas a ver las tareas por sector para iniciarlas y finalizarlas.
            </div>
          </div>
        ) : null}

        {jornada ? (
          <div style={card}>
            <div style={{ display:'flex', gap:10, alignItems:'center', justifyContent:'space-between', flexWrap:'wrap' }}>
              <div style={{ minWidth:0 }}>
                <div style={{ fontSize:14, fontWeight:800, color:U.ink }}>Tareas de la jornada · {jornada.fecha || ''}</div>
                <div style={{ fontSize:12, color:U.inkSoft, marginTop:4 }}>
                  <span style={{ fontWeight:800, color:jBadge.c, background:jBadge.bg, border:`1px solid ${jBadge.c}33`, borderRadius:999, padding:'2px 9px' }}>{jBadge.t}</span>
                  {' '}Ciclo reservado → en proceso → finalizada.
                </div>
              </div>
              {esGestor ? <button onClick={reservar} disabled={busy} style={btn(U.accent, !busy)}>{busy ? 'Reservando…' : 'Reservar jornada'}</button> : null}
            </div>
          </div>
        ) : null}

        {jornada ? (
          tareas === null ? (
            <div style={{ padding:30, textAlign:'center', color:U.inkMuted }}>Cargando tareas…</div>
          ) : tareas.length === 0 ? (
            <div style={{ ...card, textAlign:'center', color:U.inkMuted, padding:'32px 18px' }}>
              <div style={{ fontSize:14, fontWeight:700, color:U.inkSoft, marginBottom:4 }}>Sin tareas todavía</div>
              <div style={{ fontSize:12.5 }}>{esGestor ? 'Reservá la jornada para generar las tareas por sector.' : 'El encargado todavía no reservó la jornada.'}</div>
            </div>
          ) : (
            grupos.map(g => {
              const gc = SECTOR_COLOR[g.sector] || U.accent;
              return (
                <div key={g.sector} style={{ marginBottom:16 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, margin:'2px 2px 10px' }}>
                    <span style={{ width:9, height:9, borderRadius:999, background:gc, flexShrink:0 }}/>
                    <span style={{ fontSize:13, fontWeight:800, color:U.ink }}>{SECTOR_LABEL[g.sector] || g.sector}</span>
                    <span style={{ fontSize:11, fontWeight:700, color:U.inkMuted }}>· {g.items.length} {g.items.length === 1 ? 'tarea' : 'tareas'}</span>
                  </div>
                  {g.items.map(t => (
                    <TareaCard key={t.id} tarea={t} role={role} esGestor={esGestor} onDone={cargar} onMsg={setMsg} onErr={setErr}/>
                  ))}
                </div>
              );
            })
          )
        ) : null}
      </div>
    );
  }

  window.LineaTareasPage = LineaTareasPage;
})();
