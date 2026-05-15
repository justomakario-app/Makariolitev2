/* ══ MOBILE DASHBOARD — Cambio 2B: pestañas de jornadas globales ══ */

/* ─── Pestañas de jornadas abiertas (mobile, scroll horizontal) ──── */
function MJornadaTabs({ M, role, onOpenNew, onSelect, onActivate }) {
  const abiertas = M.jornadas?.abiertas || [];
  const activaId = M.jornadas?.activaId;
  const selId    = M.jornadas?.seleccionadaId;
  const puedeAdmin = ['owner','admin','encargado'].includes(role);
  const maxAlcanzado = abiertas.length >= 3;

  return (
    <div style={{display:'flex', alignItems:'stretch', gap:6, marginBottom:14, overflowX:'auto', WebkitOverflowScrolling:'touch', padding:'0 0 4px'}}>
      {abiertas.map(j => {
        const isActive = j.id === activaId;
        const isSel    = j.id === selId;
        const bg = isSel ? 'var(--paper)' : 'var(--paper-off)';
        // Color de acento por día de la semana (sky/emerald/violet/amber).
        // La activa-seleccionada conserva verde (marca de "oficial").
        const accentHex = window.getJornadaAccentColor(j.fecha).hex;
        const borderBottom = isSel
          ? `3px solid ${isActive ? 'var(--green)' : accentHex}`
          : '3px solid transparent';
        return (
          <button
            key={j.id}
            onClick={() => onSelect(j.id)}
            onDoubleClick={() => puedeAdmin && !isActive && onActivate(j.id)}
            style={{
              flex: '0 0 auto',
              minWidth: 124,
              padding: '8px 12px 6px',
              background: bg,
              border: '1px solid var(--border)',
              borderBottom,
              borderRadius: '6px 6px 0 0',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 2,
              fontFamily: 'inherit',
            }}
          >
            <div style={{display:'flex', alignItems:'center', gap:6}}>
              {isActive && <span style={{width:6, height:6, borderRadius:'50%', background:'var(--green)'}}/>}
              <span style={{fontSize:11, fontWeight:700, color:'var(--ink)'}}>{fmt.date(j.fecha)}</span>
            </div>
            <div style={{fontSize:9, color:'var(--ink-muted)', fontWeight:600}}>
              {isActive ? 'ACTIVA' : (isSel ? 'VIENDO' : 'abierta')}
            </div>
          </button>
        );
      })}
      {puedeAdmin && (
        <button
          onClick={onOpenNew}
          disabled={maxAlcanzado}
          style={{
            flex: '0 0 auto',
            minWidth: 110,
            padding: '8px 12px',
            background: maxAlcanzado ? 'var(--paper-off)' : 'var(--paper)',
            border: '1px dashed var(--border-str)',
            borderRadius: 6,
            cursor: maxAlcanzado ? 'not-allowed' : 'pointer',
            opacity: maxAlcanzado ? .5 : 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
            fontFamily: 'inherit',
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--ink-soft)',
          }}
        >
          <Icon n="plus" s={12}/> Abrir
        </button>
      )}
    </div>
  );
}

/* ─── Modal abrir jornada (mobile) ───────────────────────────────── */
function MJornadaOpenModal({ open, onClose }) {
  const toast = useToast();
  const M = window.useMockData();
  // Fix TZ (hotfix 2B): usar fecha LOCAL en lugar de toISOString.
  const today = window.todayLocalStr();
  const maxFecha = (() => {
    const d = new Date(); d.setDate(d.getDate() + 3);
    return window.todayLocalStr(d);
  })();
  const defaultFecha = (() => {
    const yaAbiertas = new Set((M.jornadas?.abiertas || []).map(j => j.fecha));
    if (!yaAbiertas.has(today)) return today;
    for (let i = 1; i <= 3; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      const iso = window.todayLocalStr(d);
      if (!yaAbiertas.has(iso)) return iso;
    }
    return today;
  })();
  const [fecha, setFecha] = useState(defaultFecha);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setFecha(defaultFecha); setBusy(false); } }, [open, defaultFecha]);

  if (!open) return null;

  const abiertas = M.jornadas?.abiertas || [];
  const fechaInvalida = fecha < today || fecha > maxFecha;
  const fechaDuplicada = abiertas.some(j => j.fecha === fecha);
  const maxAlcanzado  = abiertas.length >= 3;
  const puedeConfirmar = !busy && !fechaInvalida && !fechaDuplicada && !maxAlcanzado;

  const submit = async () => {
    setBusy(true);
    try {
      await window.MOCK_ACTIONS.abrirJornada({ fecha });
      toast.success(`Jornada del ${fmt.date(fecha)} abierta`);
      onClose();
    } catch (e) {
      toast.error(e.message || 'No se pudo abrir la jornada');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title="Abrir nueva jornada" footer={
      <>
        <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn-primary" onClick={submit} disabled={!puedeConfirmar}>
          {busy ? <span className="loader" style={{borderColor:'rgba(255,255,255,.3)', borderTopColor:'#fff'}}/> : <><Icon n="plus" s={14}/> Abrir</>}
        </button>
      </>
    }>
      <label className="field-label">Fecha de la jornada</label>
      <input type="date" className="field-input" value={fecha} min={today} max={maxFecha} onChange={e => setFecha(e.target.value)}/>
      <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:8, lineHeight:1.5}}>
        Hoy o hasta 3 días en el futuro. <strong>{abiertas.length}</strong> abierta{abiertas.length===1?'':'s'} (límite 3).
      </div>
      {maxAlcanzado && (
        <div style={{marginTop:10, padding:'8px 12px', background:'var(--red-bg)', border:'1px solid rgba(220,38,38,.32)', borderRadius:6, fontSize:11, color:'var(--red)'}}>
          Ya hay 3 jornadas abiertas — cerrá una antes de abrir otra.
        </div>
      )}
      {!maxAlcanzado && fechaDuplicada && (
        <div style={{marginTop:10, padding:'8px 12px', background:'var(--red-bg)', border:'1px solid rgba(220,38,38,.32)', borderRadius:6, fontSize:11, color:'var(--red)'}}>
          Ya hay una jornada abierta para esta fecha.
        </div>
      )}
      {!maxAlcanzado && !fechaDuplicada && fechaInvalida && (
        <div style={{marginTop:10, padding:'8px 12px', background:'var(--red-bg)', border:'1px solid rgba(220,38,38,.32)', borderRadius:6, fontSize:11, color:'var(--red)'}}>
          La fecha debe estar entre hoy y {fmt.date(maxFecha)}.
        </div>
      )}
    </Modal>
  );
}

/* ─── Estado vacío mobile ────────────────────────────────────────── */
function MEmptyStateNoJornada({ canOpen, onOpen }) {
  return (
    <div style={{
      padding: '28px 18px',
      background: 'var(--paper)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      textAlign: 'center',
      marginBottom: 14,
    }}>
      <Icon n="calendar" s={36} c="var(--ink-faint)"/>
      <div style={{fontSize:15, fontWeight:700, marginTop:10, color:'var(--ink)'}}>Abrí tu primera jornada del día</div>
      <div style={{fontSize:11, color:'var(--ink-muted)', maxWidth:300, margin:'8px auto 14px', lineHeight:1.5}}>
        Las cargas y la importación de pedidos necesitan una jornada abierta.
      </div>
      {canOpen ? (
        <button className="btn-primary" onClick={onOpen} style={{padding:'10px 18px', fontSize:13}}>
          <Icon n="plus" s={13}/> Abrir jornada
        </button>
      ) : (
        <div style={{fontSize:11, color:'var(--ink-muted)'}}>Pedíle al encargado o admin.</div>
      )}
    </div>
  );
}

function DashboardPage({ onNav }) {
  const M = window.useMockData();
  const toast = useToast();
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  // Modales del dashboard
  const [showOpen, setShowOpen]                       = useState(false);
  const [showCierre, setShowCierre]                   = useState(false);
  const [showProduce, setShowProduce]                 = useState(false);
  const [showConfirmProducir, setShowConfirmProducir] = useState(false);

  // Refs para slide+fade al cambiar de pestaña (técnica 5).
  const wrapperRef = useRef(null);
  const heroRef    = useRef(null);

  /* Exportar Excel consolidado: todos los canales con columna Canal,
     SKU, Modelo, Cantidad. Solo SKUs con faltante > 0. */
  const exportarTodos = () => {
    const filas = [];
    const orden = ['colecta','flex','tiendanube','distribuidor'];
    for (const id of orden) {
      const carrier = M.carriers[id];
      const cInfo = window.CARRIERS[id] || { label: id };
      if (!carrier) continue;
      for (const r of carrier.table || []) {
        if ((r.faltante || 0) <= 0) continue;
        const info = window.SKU_DB[r.sku] || {};
        const modeloFull = info.color && info.color !== '—'
          ? `${info.modelo || r.sku} ${info.color}`
          : (info.modelo || r.sku);
        filas.push({ Canal: cInfo.label, SKU: r.sku, Modelo: modeloFull, Cantidad: r.faltante });
      }
    }
    if (!filas.length) { toast.info('Nada para exportar — todo al día'); return; }
    if (typeof window.XLSX === 'undefined') {
      toast.error('Librería de Excel todavía no cargó · reintentá');
      return;
    }
    const ws = window.XLSX.utils.json_to_sheet(filas);
    ws['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 48 }, { wch: 12 }];
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Producción pendiente');
    const fecha = new Date().toISOString().slice(0, 10);
    window.XLSX.writeFile(wb, `produccion-todos-${fecha}.xlsx`);
    toast.success(`Excel exportado · ${filas.length} líneas`);
  };

  const canalesIds = ['colecta','flex','tiendanube','distribuidor','no_flex','correo_argentino'];
  const counts = {};
  let total = 0;
  for (const id of canalesIds) {
    const u = M.carriers[id]?.kpis?.unidades || 0;
    counts[id] = u;
    total += u;
  }
  const fechaTxt = now.toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long' });
  const horaTxt = now.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' });
  const todayCtx = `${now.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit'})} · ${horaTxt}`;
  const C = window.CARRIERS;

  const userRole   = (M.user?.role || '').toLowerCase();
  const puedeAdmin = ['owner','admin','encargado'].includes(userRole);
  const abiertas   = M.jornadas?.abiertas || [];
  const activaId   = M.jornadas?.activaId;
  const selId      = M.jornadas?.seleccionadaId;
  const seleccionada = abiertas.find(j => j.id === selId);
  const activa       = abiertas.find(j => j.id === activaId);
  const viendoOtra   = !!(seleccionada && activa && seleccionada.id !== activa.id);

  // Fecha de la jornada seleccionada (protagonista del hero).
  const fechaJornadaTxt = seleccionada
    ? window.parseLocalDate(seleccionada.fecha)
        .toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long' })
        .toUpperCase()
    : '';

  const todayLocal = window.todayLocalStr();
  // Hotfix migration 0041: permitir cerrar jornadas pasadas que quedaron abiertas (fecha <= hoy).
  const puedeCerrar = !!(seleccionada && activa && seleccionada.id === activa.id && seleccionada.fecha <= todayLocal);

  const handleProducirClick = () => {
    if (viendoOtra) setShowConfirmProducir(true);
    else            setShowProduce(true);
  };

  /* Slide+fade al cambiar pestaña (técnica 5). Idéntico al web. */
  const handleSelectTab = (id) => {
    if (!id || id === selId) return;
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const w = wrapperRef.current;
    if (reduceMotion || !w) {
      window.MOCK_ACTIONS.seleccionarJornada(id);
      return;
    }
    const oldIdx = abiertas.findIndex(j => j.id === selId);
    const newIdx = abiertas.findIndex(j => j.id === id);
    const dir = newIdx > oldIdx ? 1 : -1;

    w.style.transition = 'opacity 200ms ease, transform 200ms ease';
    w.style.opacity = '0';
    w.style.transform = `translateX(${dir * 8}px)`;

    setTimeout(() => {
      window.MOCK_ACTIONS.seleccionarJornada(id);
      w.style.transition = 'none';
      w.style.transform = `translateX(${-dir * 8}px)`;
      void w.offsetWidth;

      requestAnimationFrame(() => {
        w.style.transition = 'opacity 250ms ease, transform 250ms ease';
        w.style.opacity = '1';
        w.style.transform = 'translateX(0)';
      });

      const h = heroRef.current;
      if (h) {
        setTimeout(() => {
          if (!heroRef.current) return;
          h.style.transition = 'transform 300ms cubic-bezier(.34,1.56,.64,1), box-shadow 300ms ease';
          h.style.transform = 'scale(1.015)';
          h.style.boxShadow = '0 0 24px rgba(255,255,255,0.08)';
          setTimeout(() => {
            if (!heroRef.current) return;
            h.style.transform = 'scale(1)';
            h.style.boxShadow = 'none';
          }, 200);
        }, 150);
      }
    }, 200);
  };

  const handleCerrarConfirm = async ({ fecha } = {}) => {
    try {
      await window.MOCK_ACTIONS.cerrarJornada({ fecha });
      toast.success(`Jornada del ${fmt.date(fecha)} cerrada · snapshot guardado`);
    } catch (e) {
      toast.error(e.message || 'No se pudo cerrar la jornada');
    }
  };

  return (
    <div className="m-page">
      <div className="m-page-header">
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:8}}>
          <div style={{minWidth:0}}>
            <div className="m-page-title">Hola, {(M.user.name || '').split(' ')[0]}</div>
            <div className="m-page-sub" style={{textTransform:'capitalize'}}>{fechaTxt}</div>
          </div>
          <div style={{display:'flex', alignItems:'center', gap:6, flexShrink:0}}>
            <button
              onClick={exportarTodos}
              title="Exportar Excel"
              style={{width:36, height:36, border:'1px solid var(--border-md)', background:'var(--paper)', borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'var(--ink-soft)'}}
            >
              <Icon n="download" s={15}/>
            </button>
            <span style={{display:'inline-flex', alignItems:'center', gap:5, padding:'4px 9px', background:'var(--green-bg)', border:'1px solid rgba(22,163,74,.25)', borderRadius:4, fontSize:9, fontWeight:700, letterSpacing:'.08em', color:'var(--green)'}}>
              <span style={{width:5, height:5, borderRadius:'50%', background:'var(--green)', animation:'live-pulse 1.4s ease-in-out infinite'}}/>
              EN VIVO
            </span>
          </div>
        </div>
      </div>

      {/* Pestañas o estado vacío */}
      {abiertas.length > 0 ? (
        <MJornadaTabs
          M={M}
          role={userRole}
          onOpenNew={() => setShowOpen(true)}
          onSelect={handleSelectTab}
          onActivate={async (id) => {
            try {
              await window.MOCK_ACTIONS.setActiveJornada({ jornadaId: id });
              toast.success('Jornada activa cambiada');
            } catch (e) {
              toast.error(e.message || 'No se pudo cambiar');
            }
          }}
        />
      ) : (
        <MEmptyStateNoJornada canOpen={puedeAdmin} onOpen={() => setShowOpen(true)}/>
      )}

      {/* Banner: la jornada activa no es de hoy (probable olvido de cierre).
          Hotfix migration 0041 — visibilidad del estado anómalo. */}
      {abiertas.length > 0 && activa && activa.fecha < todayLocal && (
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--amber-bg)',
            border: '1px solid rgba(217, 119, 6, .32)',
            borderRadius: 6,
            marginBottom: 10,
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--amber)',
            lineHeight: 1.5,
          }}
        >
          ⚠️ La jornada activa es del <strong>{fmt.date(activa.fecha)}</strong> (no es hoy). Quizás te olvidaste de cerrar.
        </div>
      )}

      {/* Wrapper para slide+fade al cambiar pestaña (técnica 5) */}
      <div ref={wrapperRef} style={{willChange:'opacity, transform'}}>

      {/* Chip "VIENDO X — VOLVER A ACTIVA Y" — color de acento por día. */}
      {abiertas.length > 0 && viendoOtra && (() => {
        const accentHex = window.getJornadaAccentColor(seleccionada.fecha).hex;
        return (
          <div
            onClick={() => handleSelectTab(activa.id)}
            style={{
              padding: '7px 12px',
              background: window.jornadaAccentRgba(seleccionada.fecha, 0.10),
              border: '1px solid ' + window.jornadaAccentRgba(seleccionada.fecha, 0.32),
              borderRadius: 6,
              margin: '0 0 10px',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '.06em',
              color: accentHex,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span>VIENDO {fmt.date(seleccionada.fecha)} — VOLVER A ACTIVA {fmt.date(activa.fecha)}</span>
            <Icon n="arrow-right" s={12}/>
          </div>
        );
      })()}

      {/* Hero (solo si hay jornada abierta). Cambio 2B hotfix:
           - Fecha de la jornada SELECCIONADA como protagonista.
           - Ventas activas + Hoy en chico debajo.
           - Fondo cambia según activa vs no-activa. */}
      {abiertas.length > 0 && (
        <div
          ref={heroRef}
          className="m-hero"
          style={viendoOtra
            ? { background: '#1a1a2e', border: '1px solid rgba(99,102,241,.32)', willChange:'transform, box-shadow' }
            : { willChange:'transform, box-shadow' }}
        >
          <div className="m-hero-grid"/>
          <div className="m-hero-glow"/>
          <div style={{position:'relative', zIndex:2}}>
            <div style={{fontSize:20, fontWeight:700, color:'#fff', letterSpacing:'.02em', lineHeight:1.1, marginBottom:6}}>
              {fechaJornadaTxt}
            </div>
            <div className="m-hero-label"><span className="m-hero-dot"/>Ventas activas</div>
            <div style={{fontSize:9, opacity:.55, color:'#fff', marginTop:2}}>
              Hoy · {todayCtx.toUpperCase()}
            </div>
            <div className="m-hero-number">{total}</div>
            <div style={{display:'flex', gap:18, marginTop:10}}>
              <div>
                <div className="m-hero-stat-label">Pendientes</div>
                <div className="m-hero-stat-val">{M.prod.todos.kpis.faltante}</div>
              </div>
              <div>
                <div className="m-hero-stat-label">Producido</div>
                <div className="m-hero-stat-val">{M.prod.todos.producidoHoy}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Acciones rápidas: + Producir / Cerrar jornada */}
      {abiertas.length > 0 && (
        <div style={{display:'flex', gap:8, margin:'8px 0 14px', flexWrap:'wrap'}}>
          <button className="btn-ghost" onClick={handleProducirClick} style={{flex:1, minWidth:120}}>
            <Icon n="plus" s={13}/> Producir
          </button>
          {puedeAdmin && seleccionada && (
            <button
              className="btn-success"
              onClick={() => puedeCerrar && setShowCierre(true)}
              disabled={!puedeCerrar}
              title={puedeCerrar ? '' : 'Solo se puede cerrar la jornada activa si es de hoy o anterior'}
              style={{flex:1, minWidth:140, ...(!puedeCerrar ? {opacity:.5, cursor:'not-allowed'} : {})}}
            >
              <Icon n="lock" s={13}/> Cerrar {fmt.date(seleccionada.fecha)}
            </button>
          )}
        </div>
      )}

      {/* Canales 2 columnas + Stock al final (solo para admin/encargado/owner) */}
      <div className="m-channel-grid">
        {canalesIds.map(id => {
          const c = C[id] || {}; const count = counts[id]; const empty = count === 0;
          return (
            <div key={id} className="channel-card" data-channel={id} onClick={() => onNav(id)}>
              <div style={{position:'absolute', top:0, left:0, right:0, height:3, background:c.color}}/>
              <div className="channel-card-label" style={{color:c.color}}>{c.label}</div>
              <div className="channel-card-num" style={{color: empty?'var(--ink-faint)':'var(--ink)', fontSize:32}}>
                {empty ? <Icon n="package" s={32} c="var(--ink-faint)"/> : count}
              </div>
              <div className="channel-card-sub" style={{fontSize:10}}>{c.sub}</div>
            </div>
          );
        })}
        {['owner','admin','encargado'].includes(userRole) && (() => {
          const stockTotal = window.MOCK_ACTIONS.getStockTotal();
          const empty = stockTotal === 0;
          return (
            <div key="stock" className="channel-card" data-channel="stock" onClick={() => onNav('stock')}>
              <div style={{position:'absolute', top:0, left:0, right:0, height:3, background:'#7c3aed'}}/>
              <div className="channel-card-label" style={{color:'#7c3aed'}}>Stock</div>
              <div className="channel-card-num" style={{color: empty?'var(--ink-faint)':'var(--ink)', fontSize:32}}>
                {empty ? <Icon n="package" s={32} c="var(--ink-faint)"/> : stockTotal}
              </div>
              <div className="channel-card-sub" style={{fontSize:10}}>Almacén central</div>
            </div>
          );
        })()}
      </div>
      </div>{/* cierra wrapperRef */}

      {/* Modales globales */}
      <MJornadaOpenModal open={showOpen} onClose={() => setShowOpen(false)}/>
      <ProduceModal      open={showProduce} onClose={() => setShowProduce(false)}/>
      <CierreModal
        open={showCierre}
        onClose={() => setShowCierre(false)}
        onConfirm={handleCerrarConfirm}
        jornadaId={selId}
      />
      {/* Confirmación: producir desde pestaña no-activa */}
      <Modal
        open={showConfirmProducir}
        onClose={() => setShowConfirmProducir(false)}
        title="Confirmar producción"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setShowConfirmProducir(false)}>Cancelar</button>
            <button className="btn-primary" onClick={() => { setShowConfirmProducir(false); setShowProduce(true); }}>
              Sí, continuar
            </button>
          </>
        }
      >
        <div style={{fontSize:13, color:'var(--ink-soft)', lineHeight:1.6}}>
          Vas a cargar producción a la jornada <strong>activa</strong>
          {activa && <> ({fmt.date(activa.fecha)})</>}, no a la jornada que estás viendo
          {seleccionada && <> ({fmt.date(seleccionada.fecha)})</>}.
          <br/><br/>
          ¿Continuar?
        </div>
      </Modal>
    </div>
  );
}

window.DashboardPage = DashboardPage;
