/* ══ DASHBOARD — Cambio 2B: pestañas de jornadas globales ══ */

function ChannelCard({ id, label, sub, count, color, icon, onClick }) {
  const isEmpty = count === 0;
  return (
    <div className="channel-card" data-channel={id} onClick={onClick}>
      <div style={{position:'absolute', top:0, left:0, right:0, height:3, background:color}}/>
      <div className="channel-card-label" style={{color}}>{label}</div>
      <div className="channel-card-num" style={{color: isEmpty ? 'var(--ink-faint)' : 'var(--ink)'}}>
        {isEmpty ? <Icon n="package" s={48} c="var(--ink-faint)"/> : count}
      </div>
      <div className="channel-card-sub">{sub}</div>
    </div>
  );
}

/* ─── Pestañas de jornadas abiertas ─────────────────────────────── */
function JornadaTabs({ M, role, onOpenNew, onSelect, onActivate }) {
  const abiertas = M.jornadas?.abiertas || [];
  const activaId = M.jornadas?.activaId;
  const selId    = M.jornadas?.seleccionadaId;
  const puedeAdmin = ['owner','admin','encargado'].includes(role);
  const maxAlcanzado = abiertas.length >= 3;

  // Total unidades activas por jornada (suma pedido — transversal entre jornadas).
  // Para mostrar en el chip de cada tab: "13/05 · 71 uds".
  const totalActivas = (() => {
    let s = 0;
    for (const cid of Object.keys(M.carriers || {})) {
      for (const o of M.carriers[cid].orders || []) s += (o.cantidad || 0);
    }
    return s;
  })();

  return (
    <div style={{display:'flex', alignItems:'stretch', gap:6, marginBottom:14, flexWrap:'wrap'}}>
      {abiertas.map(j => {
        const isActive = j.id === activaId;
        const isSel    = j.id === selId;
        const bg = isSel ? 'var(--paper)' : 'var(--paper-off)';
        const borderBottom = isSel
          ? `3px solid ${isActive ? 'var(--green)' : 'var(--accent, #2563eb)'}`
          : '3px solid transparent';
        return (
          <button
            key={j.id}
            onClick={() => onSelect(j.id)}
            onDoubleClick={() => puedeAdmin && !isActive && onActivate(j.id)}
            title={puedeAdmin && !isActive ? 'Click para ver · doble-click para marcar como activa' : 'Click para ver'}
            style={{
              minWidth: 160,
              padding: '10px 14px 8px',
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
              {isActive && <span style={{width:7, height:7, borderRadius:'50%', background:'var(--green)'}}/>}
              <span style={{fontSize:12, fontWeight:700, color:'var(--ink)'}}>{fmt.date(j.fecha)}</span>
            </div>
            <div style={{fontSize:10, color:'var(--ink-muted)', fontWeight:600}}>
              {isActive ? 'ACTIVA' : (isSel ? 'VIENDO' : 'abierta')}
            </div>
          </button>
        );
      })}
      {puedeAdmin && (
        <button
          onClick={onOpenNew}
          disabled={maxAlcanzado}
          title={maxAlcanzado ? 'Ya hay 3 jornadas abiertas (límite)' : 'Abrir nueva jornada'}
          style={{
            minWidth: 140,
            padding: '10px 14px',
            background: maxAlcanzado ? 'var(--paper-off)' : 'var(--paper)',
            border: '1px dashed var(--border-str)',
            borderRadius: '6px',
            cursor: maxAlcanzado ? 'not-allowed' : 'pointer',
            opacity: maxAlcanzado ? .5 : 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            fontFamily: 'inherit',
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--ink-soft)',
          }}
        >
          <Icon n="plus" s={14}/> Abrir jornada
        </button>
      )}
    </div>
  );
}

/* ─── Modal para abrir jornada nueva ─────────────────────────────── */
function JornadaOpenModal({ open, onClose }) {
  const toast = useToast();
  const M = window.useMockData();
  // Fix TZ (hotfix 2B): usar fecha LOCAL en lugar de toISOString. En
  // Argentina (UTC-3) después de las 21h, toISOString devuelve el día
  // siguiente y el default queda shifted +1 día.
  const today = window.todayLocalStr();
  const maxFecha = (() => {
    const d = new Date(); d.setDate(d.getDate() + 3);
    return window.todayLocalStr(d);
  })();
  // Default: la primera fecha disponible (hoy o el primer día tras la última abierta).
  const defaultFecha = (() => {
    const yaAbiertas = new Set((M.jornadas?.abiertas || []).map(j => j.fecha));
    if (!yaAbiertas.has(today)) return today;
    // Buscar el próximo día libre dentro de today..today+3
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
        Hoy o hasta 3 días en el futuro. Una sola jornada por fecha. Hay <strong>{abiertas.length}</strong> abierta{abiertas.length===1?'':'s'} (límite 3).
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

/* ─── Estado vacío: ninguna jornada abierta ───────────────────────── */
function EmptyStateNoJornada({ canOpen, onOpen }) {
  return (
    <div style={{
      padding: '40px 32px',
      background: 'var(--paper)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      textAlign: 'center',
      marginBottom: 18,
    }}>
      <Icon n="calendar" s={48} c="var(--ink-faint)"/>
      <div style={{fontSize:18, fontWeight:700, marginTop:14, color:'var(--ink)'}}>Abrí tu primera jornada del día</div>
      <div style={{fontSize:12, color:'var(--ink-muted)', maxWidth:420, margin:'8px auto 18px', lineHeight:1.6}}>
        Las cargas de producción y la importación de pedidos necesitan una jornada abierta. La jornada cubre todos los canales del día.
      </div>
      {canOpen ? (
        <button className="btn-primary" onClick={onOpen} style={{padding:'10px 22px', fontSize:13}}>
          <Icon n="plus" s={14}/> Abrir jornada de hoy
        </button>
      ) : (
        <div style={{fontSize:11, color:'var(--ink-muted)'}}>Pedíle al encargado o admin que abra una jornada.</div>
      )}
    </div>
  );
}

function DashboardPage({ onNav }) {
  const M = window.useMockData();
  const toast = useToast();
  // Reloj en vivo
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000); // refresca cada 30s
    return () => clearInterval(t);
  }, []);

  // Modales del dashboard
  const [showOpen, setShowOpen]                       = useState(false);
  const [showCierre, setShowCierre]                   = useState(false);
  const [showProduce, setShowProduce]                 = useState(false);
  const [showConfirmProducir, setShowConfirmProducir] = useState(false);

  /* Exportar Excel consolidado: todos los canales en un solo archivo,
     con columna "Canal" para identificar cada fila. Solo SKUs con
     faltante > 0 (lo que hay que fabricar). */
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
        filas.push({
          Canal: cInfo.label,
          SKU: r.sku,
          Modelo: modeloFull,
          Cantidad: r.faltante,
        });
      }
    }
    if (!filas.length) {
      toast.info('Nada para exportar — todos los canales están al día');
      return;
    }
    if (typeof window.XLSX === 'undefined') {
      toast.error('Librería de Excel todavía no cargó · reintentá en un segundo');
      return;
    }
    const ws = window.XLSX.utils.json_to_sheet(filas);
    ws['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 48 }, { wch: 12 }];
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Producción pendiente');
    const fecha = new Date().toISOString().slice(0, 10);
    window.XLSX.writeFile(wb, `produccion-todos-${fecha}.xlsx`);
    toast.success(`Excel exportado · ${filas.length} línea${filas.length===1?'':'s'} de ${orden.filter(id => (M.carriers[id]?.table||[]).some(r => (r.faltante||0)>0)).length} canal(es)`);
  };

  // Lista de canales visibles (filtra por rol). Centralizado acá para
  // que el orden y la lista sean consistentes con el dashboard mobile.
  const canalesIds = ['colecta','flex','tiendanube','distribuidor','no_flex','correo_argentino'];
  const counts = {};
  let total = 0;
  for (const id of canalesIds) {
    const u = M.carriers[id]?.kpis?.unidades || 0;
    counts[id] = u;
    total += u;
  }
  const fechaTxt = now.toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long' });
  const horaTxt = now.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit', hour12:true });
  const todayCtx = `${now.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit'})} · ${horaTxt}`;
  const C = window.CARRIERS;

  const userRole = (M.user?.role || '').toLowerCase();
  const puedeAdmin = ['owner','admin','encargado'].includes(userRole);
  const abiertas   = M.jornadas?.abiertas || [];
  const activaId   = M.jornadas?.activaId;
  const selId      = M.jornadas?.seleccionadaId;
  const seleccionada = abiertas.find(j => j.id === selId);
  const activa       = abiertas.find(j => j.id === activaId);
  const viendoOtra   = !!(seleccionada && activa && seleccionada.id !== activa.id);

  // Fecha de la jornada SELECCIONADA, formato largo en mayúsculas (protagonista del hero).
  const fechaJornadaTxt = seleccionada
    ? window.parseLocalDate(seleccionada.fecha)
        .toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long' })
        .toUpperCase()
    : '';

  // Botón Cerrar: solo habilitado si seleccionada === activa Y la fecha es hoy.
  const todayLocal = window.todayLocalStr();
  const puedeCerrar = !!(seleccionada && activa && seleccionada.id === activa.id && seleccionada.fecha === todayLocal);

  /* Click "+ Producir": si la pestaña seleccionada NO es la activa, mostrar
     confirmación porque la producción siempre va a la jornada activa. */
  const handleProducirClick = () => {
    if (viendoOtra) setShowConfirmProducir(true);
    else            setShowProduce(true);
  };

  const handleCerrarConfirm = async ({ fecha, jornadaId } = {}) => {
    try {
      await window.MOCK_ACTIONS.cerrarJornada({ fecha });
      toast.success(`Jornada del ${fmt.date(fecha)} cerrada · snapshot guardado`);
    } catch (e) {
      toast.error(e.message || 'No se pudo cerrar la jornada');
    }
  };

  return (
    <div className="page">
      {/* Header con reloj en vivo */}
      <div className="page-header" style={{marginBottom:14}}>
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-sub">Vista general de canales y producción</div>
        </div>
        <div style={{display:'flex', alignItems:'center', gap:10, fontFamily:'var(--font-mono)', fontSize:11, fontWeight:700, letterSpacing:'.08em', color:'var(--ink-soft)'}}>
          <button className="btn-ghost" onClick={exportarTodos} title="Exportar Excel con producción pendiente de todos los canales">
            <Icon n="download" s={13}/> Exportar todo
          </button>
          <span style={{display:'inline-flex', alignItems:'center', gap:6, padding:'5px 10px', background:'var(--green-bg)', border:'1px solid rgba(22,163,74,.25)', borderRadius:4, color:'var(--green)'}}>
            <span style={{width:6, height:6, borderRadius:'50%', background:'var(--green)', animation:'live-pulse 1.4s ease-in-out infinite'}}/>
            EN VIVO
          </span>
          <span>{horaTxt.toUpperCase()}</span>
        </div>
      </div>

      {/* Pestañas de jornadas (solo si hay 1+ abierta) o estado vacío */}
      {abiertas.length > 0 ? (
        <JornadaTabs
          M={M}
          role={userRole}
          onOpenNew={() => setShowOpen(true)}
          onSelect={(id) => window.MOCK_ACTIONS.seleccionarJornada(id)}
          onActivate={async (id) => {
            try {
              await window.MOCK_ACTIONS.setActiveJornada({ jornadaId: id });
              toast.success('Jornada marcada como activa');
            } catch (e) {
              toast.error(e.message || 'No se pudo cambiar');
            }
          }}
        />
      ) : (
        <EmptyStateNoJornada canOpen={puedeAdmin} onOpen={() => setShowOpen(true)}/>
      )}

      {/* Chip "VIENDO X — VOLVER A ACTIVA Y" — arriba del hero (Cambio 2B hotfix 2.3) */}
      {abiertas.length > 0 && viendoOtra && (
        <div
          onClick={() => window.MOCK_ACTIONS.seleccionarJornada(activa.id)}
          title="Volver a la jornada activa"
          style={{
            padding: '8px 14px',
            background: 'rgba(99,102,241,.10)',
            border: '1px solid rgba(99,102,241,.32)',
            borderRadius: 6,
            marginBottom: 10,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '.06em',
            color: '#4f46e5',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <span>VIENDO {fmt.date(seleccionada.fecha)} — VOLVER A LA ACTIVA {fmt.date(activa.fecha)}</span>
          <Icon n="arrow-right" s={14}/>
        </div>
      )}

      {/* Hero (solo si hay jornada abierta). Cambio 2B hotfix:
           - Fecha de la jornada SELECCIONADA como protagonista (línea grande).
           - "Ventas activas" + "Hoy · DD/MM · HH:MM" en chico abajo.
           - Fondo cambia según activa vs no-activa (feedback "app nueva"). */}
      {abiertas.length > 0 && (
        <div
          className="dash-hero"
          style={viendoOtra
            ? { background: '#1a1a2e', border: '1px solid rgba(99,102,241,.32)' }
            : undefined}
        >
          <div className="dash-hero-grid"/>
          <div className="dash-hero-glow"/>
          <div className="dash-hero-left">
            <div className="dash-hero-number">{total}</div>
            <div className="dash-hero-meta">
              <div style={{fontSize:26, fontWeight:700, color:'#fff', letterSpacing:'.02em', lineHeight:1.1, marginBottom:8}}>
                {fechaJornadaTxt}
              </div>
              <div className="dash-hero-label"><span className="dash-hero-dot"/>Ventas activas</div>
              <div className="dash-hero-date" style={{fontSize:10, opacity:.55, marginTop:2}}>
                Hoy · {todayCtx.toUpperCase()}
              </div>
            </div>
          </div>
          <div className="dash-hero-right">
            <div className="dash-hero-stat">
              <span className="dash-hero-stat-label">Pendientes</span>
              <span className="dash-hero-stat-val">{M.prod.todos.kpis.faltante}</span>
            </div>
            <div className="dash-hero-stat">
              <span className="dash-hero-stat-label">Producido</span>
              <span className="dash-hero-stat-val">{M.prod.todos.producidoHoy}</span>
            </div>
          </div>
        </div>
      )}

      {/* Acciones rápidas: + Producir / Cerrar jornada (debajo del hero) */}
      {abiertas.length > 0 && (
        <div style={{display:'flex', justifyContent:'flex-end', gap:8, margin:'10px 0 18px'}}>
          <button className="btn-ghost" onClick={handleProducirClick}>
            <Icon n="plus" s={13}/> Producir
          </button>
          {puedeAdmin && seleccionada && (
            <button
              className="btn-success"
              onClick={() => puedeCerrar && setShowCierre(true)}
              disabled={!puedeCerrar}
              title={puedeCerrar
                ? `Cerrar la jornada del ${fmt.date(seleccionada.fecha)} (todos los canales)`
                : 'Solo se puede cerrar la jornada del día actual'}
              style={!puedeCerrar ? {opacity:.5, cursor:'not-allowed'} : undefined}
            >
              <Icon n="lock" s={13}/> Cerrar jornada del {fmt.date(seleccionada.fecha)}
            </button>
          )}
        </div>
      )}

      {/* Channels — 3 columnas (2 filas con 6 canales) — armónico en cualquier viewport.
          Stock se renderiza como un cuadrito mas solo para owner/admin/encargado. */}
      <div className="channel-grid" style={{gridTemplateColumns:'repeat(3, 1fr)'}}>
        {canalesIds.map(id => (
          <ChannelCard
            key={id}
            id={id}
            label={C[id]?.label || id}
            sub={C[id]?.sub || ''}
            count={counts[id]}
            color={C[id]?.color || '#888'}
            onClick={() => onNav(id)}
          />
        ))}
        {['owner','admin','encargado'].includes(userRole) && (
          <ChannelCard
            id="stock"
            label="Stock"
            sub="Almacén central"
            count={window.MOCK_ACTIONS.getStockTotal()}
            color="#7c3aed"
            onClick={() => onNav('stock')}
          />
        )}
      </div>

      {/* ── Modales globales del dashboard ── */}
      <JornadaOpenModal open={showOpen} onClose={() => setShowOpen(false)}/>
      <ProduceModal     open={showProduce} onClose={() => setShowProduce(false)}/>
      <CierreModal
        open={showCierre}
        onClose={() => setShowCierre(false)}
        onConfirm={handleCerrarConfirm}
        jornadaId={selId}
      />
      {/* Confirmación: producir desde pestaña no-activa (Ajuste 2 del plan 2B) */}
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
