/* ══ LÍNEA PRODUCTIVA — primitivas UI compartidas ══════════════════════
   Helpers y componentes reutilizados por TODAS las pantallas de sector
   (CNC, Melamina, Pino, Embalaje). Cargar después de shared.jsx (usa
   useState/useEffect) y antes de los *-sector.jsx.
   ═══════════════════════════════════════════════════════════════════════ */

/* Reloj vivo para la topbar (HH:MM, refresco 30s). */
function LpClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(id); }, []);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return <span>{hh}:{mm}</span>;
}

/* ── Estado neutro de la Línea Productiva por sector ──
   lpNeutralMsg({abierto, hayDemanda, nVentas, nTareas, sectorLabel}) → {titulo, sub} o null.

   Cambió de firma en 0173. Antes preguntaba por la jornada global y decía "cuando el encargado
   inicie la jornada": eso ya no es cierto — ahora el sector abre la suya y puede trabajar aunque
   nadie haya vinculado ventas. Cuatro situaciones, cada una con su salida concreta. */
function lpNeutralMsg(ctx) {
  const c = ctx || {};
  const sec = c.sectorLabel || 'este sector';
  if (!c.abierto) return { titulo:'Tu jornada de ' + sec + ' está cerrada',
    sub:'Abrila con el botón de arriba para empezar a cargar. Mientras esté cerrada no se registra producción de este sector.' };
  if (!c.hayDemanda) return { titulo:'Jornada abierta · todavía sin pedidos vinculados',
    sub:'Podés cargar igual: lo que produzcas entra al stock libre y queda registrado en tu turno. Cuando el encargado vincule ventas, acá aparecen las prioridades.' };
  if (!c.nVentas) return { titulo:'Jornada abierta, todavía sin ventas vinculadas',
    sub:'La jornada arrancó pero todavía no se vincularon ventas. En cuanto se vinculen, aparecen las tareas. Mientras tanto podés cargar a stock libre.' };
  if (!c.nTareas) return { titulo:'No hay trabajo pendiente para ' + sec,
    sub:'Hay ventas en la jornada, pero ' + sec + ' no tiene nada pendiente ahora. Si producís igual, entra como stock libre.' };
  return null;
}

/* ══ TURNO DE SECTOR (0173) ══════════════════════════════════════════
   Seba: "el encargado de cada área tiene que prender su jornada y cerrarla cuando se vaya".
   Todo esto vive una sola vez y lo consumen los cuatro sectores: con el botón copiado cuatro
   veces, el quinto arreglo se olvida en alguno.
   ═════════════════════════════════════════════════════════════════ */

const LP_SECTORES = [
  { id:'cnc',      label:'CNC',      verbo:'registrar cortes' },
  { id:'melamina', label:'Melamina', verbo:'registrar piezas terminadas' },
  { id:'pino',     label:'Pino',     verbo:'registrar producción' },
  { id:'embalaje', label:'Embalaje', verbo:'registrar armados' },
];

/* "3 h 20 min" · "45 min" · "recién". */
function lpDesdeHace(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (!(ms >= 0)) return '';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return min + ' min';
  const h = Math.floor(min / 60), r = min % 60;
  return r ? (h + ' h ' + r + ' min') : (h + ' h');
}

/* Estado + acciones del turno del sector: un solo lugar donde vive abrir/cerrar.
   Devuelve `abierto` como booleano duro para que las pantallas no adivinen. */
function useLpTurno(sector, toast) {
  const [estado, setEstado] = useState(null);
  const [cargando, setCarg] = useState(true);
  const [ocupado, setOcup]  = useState(false);
  const [error, setError]   = useState('');

  /* `toast` es el objeto de useToast() — estable por useMemo, así que sirve de dependencia. */
  const aviso = useCallback((tipo, msg) => {
    if (!toast) return;
    const f = toast[tipo] || toast.info;
    if (f) f(msg);
  }, [toast]);

  const recargar = useCallback(async () => {
    try {
      const e = await window.LP_DATA.sectorEstado();
      setEstado(e || null); setError('');
    } catch (ex) {
      /* Fail-closed: si no se puede leer el estado, NO se asume abierto. Dejar cargar sobre un
         turno que no existe termina en un error del backend después de tipear todo. */
      setEstado(null); setError(ex.message || 'No se pudo leer el estado de la jornada.');
    } finally { setCarg(false); }
  }, []);

  useEffect(() => { recargar(); }, [recargar]);

  const mio = useMemo(() => {
    const list = (estado && estado.sectores) || [];
    for (let i = 0; i < list.length; i++) if (list[i].sector === sector) return list[i];
    return null;
  }, [estado, sector]);

  const abrir = useCallback(async () => {
    setOcup(true);
    try {
      const r = await window.LP_DATA.sectorAbrir({ sector });
      await recargar();
      if (r && r.retomada) aviso('info', 'Tu jornada ya estaba abierta.');
      else if (r && r.sin_jornada_demanda) aviso('info', 'Jornada abierta. Todavía no hay pedidos vinculados: lo que cargues va a stock libre.');
      else aviso('success', 'Jornada abierta. A trabajar.');
      return r;
    } catch (ex) { aviso('error', ex.message || 'No se pudo abrir la jornada.'); throw ex; }
    finally { setOcup(false); }
  }, [sector, recargar, aviso]);

  const cerrar = useCallback(async () => {
    setOcup(true);
    try {
      const r = await window.LP_DATA.sectorCerrar({ sector });
      await recargar();
      return r;
    } catch (ex) { aviso('error', ex.message || 'No se pudo cerrar la jornada.'); throw ex; }
    finally { setOcup(false); }
  }, [sector, recargar, aviso]);

  return {
    estado, cargando, ocupado, error, recargar, abrir, cerrar, sector,
    turno: mio,
    abierto: !!(mio && mio.abierta),
    turnoId: (mio && mio.turno_id) || null,
    jornadaId: (estado && estado.jornada_id) || null,
    hayDemanda: !!(estado && estado.hay_jornada_demanda),
  };
}

/* Chip de la topbar. Mientras el turno está abierto el tiempo sube solo cada 30 s: el operario
   ve que la pantalla está viva y no una foto vieja. */
function LpTurnoChip({ U, t }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!t.abierto) return undefined;
    const id = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, [t.abierto]);

  const ok  = t.abierto;
  const col = t.cargando ? U.inkMuted : (ok ? U.ok : U.danger);
  const bg  = t.cargando ? 'rgba(0,0,0,.05)' : (ok ? 'rgba(22,163,74,.12)' : 'rgba(220,38,38,.12)');
  const txt = t.cargando ? 'Cargando…'
            : ok ? ('Tu jornada · ' + lpDesdeHace(t.turno && t.turno.abierta_at))
            : 'Tu jornada cerrada';
  return (
    <span style={{display:'inline-flex', alignItems:'center', gap:6, padding:'5px 10px', borderRadius:999,
                  background:bg, color:col, fontSize:11, fontWeight:800, whiteSpace:'nowrap'}}>
      <span style={{width:7, height:7, borderRadius:999, background:col, flexShrink:0,
                    boxShadow: ok ? `0 0 0 3px ${bg}` : 'none'}}/>
      {txt}
    </span>
  );
}

/* Botón de abrir/cerrar. Cerrar pide confirmación y después muestra el resumen del turno:
   cerrar sin ver qué hiciste es la clase de acción que después nadie puede auditar. */
function LpTurnoBoton({ U, t, sectorLabel, compact }) {
  const [paso, setPaso] = useState(null);   // null | 'confirmar' | 'resumen'
  const [res, setRes]   = useState(null);

  const doCerrar = async () => {
    try { const r = await t.cerrar(); setRes(r); setPaso('resumen'); }
    catch (e) { setPaso(null); }
  };

  const base = { border:'none', borderRadius:9, fontWeight:800, cursor:'pointer', lineHeight:1,
                 whiteSpace:'nowrap', fontSize: compact ? 11.5 : 12.5,
                 padding: compact ? '7px 11px' : '9px 15px' };

  if (t.cargando) return null;

  return (
    <React.Fragment>
      {!t.abierto ? (
        <button onClick={t.abrir} disabled={t.ocupado}
          style={{...base, background:U.accent, color:'#fff', opacity: t.ocupado ? .6 : 1,
                  boxShadow:`0 2px 10px ${U.accentSoft}`}}>
          {t.ocupado ? 'Abriendo…' : 'Abrir mi jornada'}
        </button>
      ) : (
        <button onClick={() => setPaso('confirmar')} disabled={t.ocupado}
          style={{...base, background:'transparent', color:U.inkSoft,
                  border:`1px solid ${U.border}`, opacity: t.ocupado ? .6 : 1}}>
          {t.ocupado ? 'Cerrando…' : 'Cerrar mi jornada'}
        </button>
      )}

      {paso === 'confirmar' && (
        <LpTurnoModal U={U} titulo={`¿Cerrás tu jornada de ${sectorLabel}?`} onCerrar={() => setPaso(null)}>
          <p style={{margin:'0 0 12px', fontSize:13, lineHeight:1.6, color:U.inkSoft}}>
            Trabajaste <b style={{color:U.ink}}>{lpDesdeHace(t.turno && t.turno.abierta_at)}</b>. Al cerrar
            no vas a poder cargar más en {sectorLabel} hasta que la vuelvas a abrir.
          </p>
          <p style={{margin:'0 0 18px', fontSize:12, lineHeight:1.6, color:U.inkMuted}}>
            Los otros sectores siguen trabajando normal — esto cierra <b>solo el tuyo</b>. Si te quedó
            material reservado sin usar, vuelve al stock.
          </p>
          <div style={{display:'flex', gap:8, justifyContent:'flex-end', flexWrap:'wrap'}}>
            <button onClick={() => setPaso(null)}
              style={{...base, background:'transparent', color:U.inkSoft, border:`1px solid ${U.border}`}}>
              Seguir trabajando
            </button>
            <button onClick={doCerrar} disabled={t.ocupado}
              style={{...base, background:U.accent, color:'#fff', opacity: t.ocupado ? .6 : 1}}>
              {t.ocupado ? 'Cerrando…' : 'Sí, cerrar'}
            </button>
          </div>
        </LpTurnoModal>
      )}

      {paso === 'resumen' && (
        <LpTurnoModal U={U} titulo={`Jornada de ${sectorLabel} cerrada`} onCerrar={() => setPaso(null)}>
          <LpTurnoResumen U={U} r={res} sectorLabel={sectorLabel}/>
          <div style={{display:'flex', justifyContent:'flex-end', marginTop:16}}>
            <button onClick={() => setPaso(null)} style={{...base, background:U.accent, color:'#fff'}}>Listo</button>
          </div>
        </LpTurnoModal>
      )}
    </React.Fragment>
  );
}

/* Modal propio del kit LP, no el de la app: estas pantallas las usa gente con guantes y
   necesitan tipografía y áreas de toque más grandes. */
function LpTurnoModal({ U, titulo, children, onCerrar }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCerrar(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCerrar]);
  return (
    <div onClick={onCerrar}
      style={{position:'fixed', inset:0, background:'rgba(10,10,10,.45)', backdropFilter:'blur(3px)',
              display:'flex', alignItems:'center', justifyContent:'center', padding:16, zIndex:9000}}>
      <div onClick={(e) => e.stopPropagation()}
        style={{background:U.surface, borderRadius:16, padding:'22px 22px 20px', width:'100%', maxWidth:440,
                boxShadow:'0 24px 60px rgba(0,0,0,.28)', border:`1px solid ${U.border}`}}>
        <h3 style={{margin:'0 0 12px', fontSize:17, fontWeight:850, color:U.ink, lineHeight:1.3}}>{titulo}</h3>
        {children}
      </div>
    </div>
  );
}

/* Lo que hizo el turno. Si no hizo nada lo dice con todas las letras en vez de mostrar ceros
   sueltos: un tablero en cero se lee igual que "no cargó" y que "no anduvo", y no son lo mismo. */
function LpTurnoResumen({ U, r, sectorLabel }) {
  const res = (r && r.resumen) || {};
  const cargas = res.cargas || 0;
  const filas = Object.keys(res).filter((k) => k !== 'cargas').map((k) => ({ k, v: res[k] }));
  const etiqueta = { hojas:'Placas cortadas', desperdicio:'Desperdicio', terminadas:'Terminadas',
                     fallas:'Fallas', masilladas:'Masilladas', unidades:'Unidades armadas' };
  const kpi = (rot, val) => (
    <div style={{flex:'1 1 120px', background:U.surface2, borderRadius:12, padding:'12px 14px'}}>
      <div style={{fontSize:10, fontWeight:700, color:U.inkMuted, textTransform:'uppercase', letterSpacing:'.08em'}}>{rot}</div>
      <div style={{fontSize:19, fontWeight:850, color:U.ink, marginTop:3}}>{val}</div>
    </div>
  );
  return (
    <div>
      <div style={{display:'flex', gap:10, flexWrap:'wrap', marginBottom:14}}>
        {kpi('Duración', (r && r.horas != null) ? `${r.horas} h` : '—')}
        {kpi('Cargas', cargas)}
      </div>

      {cargas === 0 ? (
        <div style={{background:'rgba(217,119,6,.08)', border:'1px solid rgba(217,119,6,.25)', borderRadius:12,
                     padding:'12px 14px', fontSize:12.5, lineHeight:1.6, color:U.warn}}>
          No quedó ninguna carga registrada en este turno de {sectorLabel}. Si hoy produjiste algo,
          avisale al encargado: sin carga, ese trabajo no existe para el sistema.
        </div>
      ) : (
        <div style={{border:`1px solid ${U.border}`, borderRadius:12, overflow:'hidden'}}>
          {filas.map((f, i) => (
            <div key={f.k} style={{display:'flex', justifyContent:'space-between', alignItems:'center',
                                   padding:'10px 14px', fontSize:13,
                                   borderTop: i ? `1px solid ${U.border}` : 'none'}}>
              <span style={{color:U.inkSoft}}>{etiqueta[f.k] || f.k}</span>
              <b style={{color:U.ink, fontSize:14.5}}>{f.v}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* Turno cerrado pero con contenido para mirar (demanda del día, lo ya cargado). Barra arriba
   con el botón, y la pantalla sigue abajo: cerrar el turno no tiene por qué cegar al operario.
   Antes acá había un cartel rojo que sólo decía "el encargado la gestiona" y no ofrecía salida. */
function LpTurnoAviso({ U, t, sectorLabel, verbo }) {
  return (
    <div style={{background:U.accentSoft, border:`1px solid ${U.accentLine}`, borderRadius:12,
                 padding:'12px 14px', marginBottom:16, display:'flex', gap:12, alignItems:'center',
                 flexWrap:'wrap'}}>
      <Icon n="lock" s={17} c={U.accent}/>
      <div style={{flex:'1 1 200px', fontSize:12.5, lineHeight:1.5, color:U.ink}}>
        Tu jornada de {sectorLabel} está cerrada.
        <span style={{color:U.inkSoft}}> Podés mirar, pero para {verbo || 'cargar'} tenés que abrirla.</span>
      </div>
      <LpTurnoBoton U={U} t={t} sectorLabel={sectorLabel} compact/>
    </div>
  );
}

/* Portada del sector con el turno cerrado. Reemplaza al viejo cartel "Jornada no abierta / no se
   pueden registrar cortes hasta que el encargado abra la jornada", que además de ser un callejón
   sin salida era falso: ahora el que abre es el propio sector, y el botón está acá mismo. */
function LpTurnoPortada({ U, t, sectorLabel, verbo }) {
  return (
    <div style={{textAlign:'center', padding:'46px 22px', background:U.surface,
                 border:`1px solid ${U.border}`, borderRadius:16, margin:'10px 0'}}>
      <div style={{width:56, height:56, borderRadius:999, margin:'0 auto 16px', background:U.accentSoft,
                   display:'flex', alignItems:'center', justifyContent:'center'}}>
        <span style={{width:14, height:14, borderRadius:999, background:U.accent, display:'block'}}/>
      </div>
      <div style={{color:U.ink, fontSize:17.5, fontWeight:850, marginBottom:8}}>
        Tu jornada de {sectorLabel} está cerrada
      </div>
      <div style={{color:U.inkSoft, fontSize:13, lineHeight:1.65, maxWidth:380, margin:'0 auto 20px'}}>
        Abrila para {verbo || 'cargar producción'}. Es tuya: no depende de ventas ni de que el
        encargado abra nada, y no afecta a los otros sectores.
      </div>
      {t.error ? (
        <div style={{color:U.danger, fontSize:12.5, margin:'0 0 14px', lineHeight:1.6}}>{t.error}</div>
      ) : null}
      <button onClick={t.abrir} disabled={t.ocupado}
        style={{border:'none', borderRadius:11, background:U.accent, color:'#fff', fontWeight:850,
                fontSize:14.5, padding:'13px 26px', cursor:'pointer', opacity: t.ocupado ? .6 : 1,
                boxShadow:`0 6px 20px ${U.accentSoft}`}}>
        {t.ocupado ? 'Abriendo…' : 'Abrir mi jornada'}
      </button>
      {t.turno && t.turno.ultimo_cierre ? (
        <div style={{color:U.inkMuted, fontSize:11.5, marginTop:16}}>
          Último cierre: hace {lpDesdeHace(t.turno.ultimo_cierre)}
        </div>
      ) : null}
    </div>
  );
}
/* ── Tablero de turnos (panel del encargado) ──────────────────────────────────────────────
   Con la jornada por sector, el encargado ya no prende nada: cada sector prende el suyo. El
   riesgo nuevo es el silencio — si el de CNC nunca abrió, sus cargas se rechazan todo el día
   y nadie se entera hasta que falta la producción. Esto lo pone a la vista, y como el backend
   ya deja que encargado/owner/admin abran o cierren cualquier sector (para destrabar al que se
   fue sin cerrar), acá está el botón: una capacidad sin pantalla es tan inútil como un botón
   sin efecto. */
function LpTurnosStrip({ U, toast, puedeGestionar }) {
  const [estado, setEstado] = useState(null);
  const [error, setError]   = useState('');
  const [busy, setBusy]     = useState('');      // sector en curso
  const [confirmar, setConf] = useState(null);   // sector a cerrar

  const recargar = useCallback(async () => {
    try { setEstado(await window.LP_DATA.sectorEstado()); setError(''); }
    catch (ex) { setError((ex && ex.message) || 'No se pudo leer el estado de los sectores.'); }
  }, []);

  useEffect(() => { recargar(); }, [recargar]);
  useEffect(() => window.LP_DATA.subscribe(['prod_jornada_sector'], recargar), [recargar]);

  /* Se re-pinta cada 60 s para que "hace 3 h" no envejezca mientras el panel queda abierto en
     una pantalla del taller todo el día. */
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 60000); return () => clearInterval(id); }, []);

  const porSector = useMemo(() => {
    const m = {};
    for (const s of ((estado && estado.sectores) || [])) m[s.sector] = s;
    return m;
  }, [estado]);

  const accion = async (fn, sector, msgOk) => {
    setBusy(sector);
    try { await fn({ sector }); await recargar(); if (toast) toast.success(msgOk); }
    catch (ex) { if (toast) toast.error((ex && ex.message) || 'No se pudo.'); }
    finally { setBusy(''); setConf(null); }
  };

  const abiertos = LP_SECTORES.filter((s) => porSector[s.id] && porSector[s.id].abierta).length;
  const btn = {
    border:'none', borderRadius:8, fontSize:11, fontWeight:800, padding:'6px 10px',
    cursor:'pointer', lineHeight:1, whiteSpace:'nowrap',
  };

  return (
    <div style={{marginBottom:18}}>
      <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:10, marginBottom:10, flexWrap:'wrap'}}>
        <h3 style={{fontSize:15, fontWeight:800, margin:0, color:U.ink}}>Quién está trabajando</h3>
        <span style={{fontSize:11.5, color:U.inkMuted, fontWeight:700}}>
          {abiertos} de {LP_SECTORES.length} sectores con la jornada abierta
        </span>
      </div>

      {error ? (
        <div style={{color:U.danger, fontSize:12.5, marginBottom:10, lineHeight:1.6}}>{error}</div>
      ) : null}

      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(190px, 1fr))', gap:10}}>
        {LP_SECTORES.map((s) => {
          const t  = porSector[s.id] || {};
          const on = !!t.abierta;
          const trabajando = busy === s.id;
          return (
            <div key={s.id} style={{background:U.surface, border:`1px solid ${on ? 'rgba(22,163,74,.35)' : U.border}`,
                                    borderRadius:14, padding:'13px 14px'}}>
              <div style={{display:'flex', alignItems:'center', gap:7, marginBottom:6}}>
                <span style={{width:8, height:8, borderRadius:999, flexShrink:0,
                              background: on ? U.ok : U.inkMuted,
                              boxShadow: on ? '0 0 0 3px rgba(22,163,74,.15)' : 'none'}}/>
                <span style={{fontSize:13.5, fontWeight:800, color:U.ink}}>{s.label}</span>
              </div>

              <div style={{fontSize:11.5, color:U.inkSoft, lineHeight:1.55, minHeight:32}}>
                {on ? (
                  <React.Fragment>
                    Abierta hace <b style={{color:U.ink}}>{lpDesdeHace(t.abierta_at)}</b>
                    {t.abierta_por_nombre ? <span style={{color:U.inkMuted}}> · {t.abierta_por_nombre}</span> : null}
                  </React.Fragment>
                ) : t.ultimo_cierre ? (
                  <span style={{color:U.inkMuted}}>Cerrada · último cierre hace {lpDesdeHace(t.ultimo_cierre)}</span>
                ) : (
                  /* Nunca abrió. Es el caso caro: no es que cerró temprano, es que todo lo que
                     hizo hoy no se pudo cargar. */
                  <span style={{color:U.warn, fontWeight:700}}>Sin abrir todavía — no puede cargar producción</span>
                )}
              </div>

              {puedeGestionar ? (
                <div style={{marginTop:10}}>
                  {on ? (
                    <button onClick={() => setConf(s)} disabled={trabajando}
                      style={{...btn, background:'transparent', color:U.inkSoft,
                              border:`1px solid ${U.border}`, opacity: trabajando ? .6 : 1}}>
                      {trabajando ? 'Cerrando…' : 'Cerrar por él'}
                    </button>
                  ) : (
                    <button onClick={() => accion(window.LP_DATA.sectorAbrir, s.id, `Jornada de ${s.label} abierta.`)}
                      disabled={trabajando}
                      style={{...btn, background:U.accentSoft, color:U.accent,
                              border:`1px solid ${U.accentLine}`, opacity: trabajando ? .6 : 1}}>
                      {trabajando ? 'Abriendo…' : 'Abrir por él'}
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {confirmar ? (
        <LpTurnoModal U={U} titulo={`¿Cerrás la jornada de ${confirmar.label}?`} onCerrar={() => setConf(null)}>
          <p style={{margin:'0 0 18px', fontSize:13, lineHeight:1.6, color:U.inkSoft}}>
            Esto cierra el turno de otra persona. Desde ese momento {confirmar.label} no puede cargar
            producción hasta que lo vuelva a abrir. Usalo cuando el operario se fue sin cerrar.
          </p>
          <div style={{display:'flex', gap:8, justifyContent:'flex-end', flexWrap:'wrap'}}>
            <button onClick={() => setConf(null)}
              style={{...btn, padding:'9px 14px', fontSize:12.5, background:'transparent',
                      color:U.inkSoft, border:`1px solid ${U.border}`}}>
              Dejarla abierta
            </button>
            <button onClick={() => accion(window.LP_DATA.sectorCerrar, confirmar.id, `Jornada de ${confirmar.label} cerrada.`)}
              style={{...btn, padding:'9px 14px', fontSize:12.5, background:U.accent, color:'#fff'}}>
              Sí, cerrar
            </button>
          </div>
        </LpTurnoModal>
      ) : null}
    </div>
  );
}

function LpNeutral({ U, msg }) {
  if (!msg) return null;
  return (
    <div style={{ background:U.surface||'#fff', border:`1px dashed ${U.border||'rgba(0,0,0,.12)'}`, borderRadius:14,
                  padding:'36px 20px', textAlign:'center', margin:'10px 0' }}>
      <div style={{ fontSize:15.5, fontWeight:800, color:U.ink||'#0A0A0A', marginBottom:7 }}>{msg.titulo}</div>
      <div style={{ fontSize:12.5, color:U.inkSoft||U.inkMuted||'#666', lineHeight:1.6, maxWidth:420, margin:'0 auto' }}>{msg.sub}</div>
    </div>
  );
}

/* Niveles de urgencia (Mantenimiento) — color por nivel. */
const LP_URGENCIAS = [
  { id:'alta',  label:'Alta',  color:'#FF4060' },
  { id:'media', label:'Media', color:'#FFB020' },
  { id:'baja',  label:'Baja',  color:'#00D68F' },
];

/* Estilo del botón redondo de stepper (−/+), tematizado por sector (U = tokens). */
function lpStepBtn(U) {
  return { border:`1px solid ${U.border}`, background:U.surface2, color:U.ink, borderRadius:8,
           width:28, height:28, fontSize:17, fontWeight:700, cursor:'pointer', lineHeight:1 };
}

/* ── Tab Solicitud GENÉRICA (catálogo con stepper + "Otros") ──
   props: U (tokens del sector), sector ('cnc'|'melamina'|…), catalogo
   ([{grupo, items:[...]}]), toast. Crea UNA solicitud con todos los ítems. */
function LpSolicitud({ U, sector, catalogo, toast }) {
  const [qty, setQty] = useState({});
  const [otros, setOtros] = useState('');
  const [saving, setSaving] = useState(false);

  const bump = (nombre, delta) => setQty(q => {
    const nq = Object.assign({}, q);
    const n = Math.max((nq[nombre] || 0) + delta, 0);
    if (n === 0) delete nq[nombre]; else nq[nombre] = n;
    return nq;
  });

  const seleccionados = Object.keys(qty);
  const hayAlgo = seleccionados.length > 0 || otros.trim().length > 0;

  const enviar = async () => {
    if (!hayAlgo || saving) return;
    setSaving(true);
    try {
      const items = seleccionados.map(n => ({ nombre: n, cantidad: qty[n] }));
      if (otros.trim()) items.push({ nombre: 'Otros: ' + otros.trim(), cantidad: 1 });
      await window.LP_DATA.crearSolicitud({ sector: sector, items: items });
      toast.success('Solicitud enviada al coordinador');
      setQty({}); setOtros('');
    } catch (err) {
      toast.error(err && err.message ? err.message : 'No se pudo enviar la solicitud');
    } finally { setSaving(false); }
  };

  return (
    <div>
      <h3 style={{fontSize:15, fontWeight:800, margin:'0 0 4px', color:U.ink}}>Solicitud de insumos</h3>
      <p style={{fontSize:11.5, color:U.inkMuted, margin:'0 0 16px'}}>Tocá para agregar. Va al coordinador → administración.</p>

      {catalogo.map(cat => (
        <div key={cat.grupo} style={{marginBottom:14}}>
          <div style={{fontSize:10, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:U.inkMuted, marginBottom:8}}>{cat.grupo}</div>
          <div style={{background:U.surface, border:`1px solid ${U.border}`, borderRadius:14, overflow:'hidden'}}>
            {cat.items.map((it, i) => {
              const n = qty[it] || 0;
              return (
                <div key={it} style={{display:'flex', alignItems:'center', justifyContent:'space-between',
                             padding:'11px 12px', borderBottom: i < cat.items.length - 1 ? `1px solid ${U.border}` : 'none'}}>
                  <span style={{fontSize:12.5, color: n > 0 ? U.ink : U.inkSoft, fontWeight: n > 0 ? 700 : 500, paddingRight:10}}>{it}</span>
                  {n > 0 ? (
                    <div style={{display:'flex', alignItems:'center', gap:10}}>
                      <button onClick={() => bump(it, -1)} style={lpStepBtn(U)}>−</button>
                      <span style={{minWidth:18, textAlign:'center', fontWeight:800, color:U.accent, fontVariantNumeric:'tabular-nums'}}>{n}</span>
                      <button onClick={() => bump(it, 1)} style={lpStepBtn(U)}>+</button>
                    </div>
                  ) : (
                    <button onClick={() => bump(it, 1)}
                      style={{border:`1px solid ${U.border}`, background:U.surface2, color:U.inkSoft, borderRadius:9,
                              width:30, height:30, fontSize:18, fontWeight:700, cursor:'pointer', lineHeight:1}}>+</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div style={{marginBottom:16}}>
        <div style={{fontSize:10, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:U.inkMuted, marginBottom:8}}>Otros</div>
        <textarea value={otros} onChange={e => setOtros(e.target.value)} rows={2} placeholder="Detalle libre…"
          style={{width:'100%', boxSizing:'border-box', background:U.surface2, border:`1px solid ${U.border}`,
                  borderRadius:12, color:U.ink, fontSize:13, padding:'11px 12px', outline:'none', resize:'vertical', fontFamily:'inherit'}}/>
      </div>

      <button onClick={enviar} disabled={!hayAlgo || saving}
        style={{width:'100%', padding:'15px', borderRadius:14, border:'none',
                background: hayAlgo && !saving ? U.accent : U.surface2, color: hayAlgo && !saving ? '#fff' : U.inkMuted,
                fontSize:15, fontWeight:800, cursor: hayAlgo && !saving ? 'pointer' : 'not-allowed',
                display:'flex', alignItems:'center', justifyContent:'center', gap:8}}>
        <Icon n="send" s={17} c={hayAlgo && !saving ? '#fff' : U.inkMuted}/>
        {saving ? 'Enviando…' : 'Enviar solicitud'}
      </button>
    </div>
  );
}

/* ── Tab Mantenimiento GENÉRICA (tipo + urgencia + máquina + descripción) ──
   props: U, sector, tipos ([string]), toast. */
function LpMant({ U, sector, tipos, toast }) {
  const [tipo, setTipo] = useState('');
  const [urg, setUrg] = useState('media');
  const [maquina, setMaquina] = useState('');
  const [desc, setDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const puede = tipo && desc.trim() && !saving;

  const enviar = async () => {
    if (!puede) return;
    setSaving(true);
    try {
      await window.LP_DATA.reportarMantenimiento({ sector: sector, tipo: tipo, urgencia: urg, maquina: maquina.trim(), descripcion: desc.trim() });
      toast.success('Reporte enviado al coordinador');
      setTipo(''); setUrg('media'); setMaquina(''); setDesc('');
    } catch (err) {
      toast.error(err && err.message ? err.message : 'No se pudo enviar el reporte');
    } finally { setSaving(false); }
  };

  const fieldLabel = { fontSize:10, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:U.inkMuted, marginBottom:8 };
  const txt = { width:'100%', boxSizing:'border-box', background:U.surface2, border:`1px solid ${U.border}`,
                borderRadius:12, color:U.ink, fontSize:13, padding:'12px', outline:'none', fontFamily:'inherit' };

  return (
    <div>
      <h3 style={{fontSize:15, fontWeight:800, margin:'0 0 4px', color:U.ink}}>Reporte de mantenimiento</h3>
      <p style={{fontSize:11.5, color:U.inkMuted, margin:'0 0 16px'}}>Va al coordinador → director.</p>

      <div style={fieldLabel}>Tipo</div>
      <div style={{display:'flex', flexWrap:'wrap', gap:8, marginBottom:16}}>
        {tipos.map(t => {
          const on = tipo === t;
          return (
            <button key={t} onClick={() => setTipo(t)}
              style={{border:`1px solid ${on ? U.accent : U.border}`, background: on ? U.accentSoft : U.surface,
                      color: on ? U.ink : U.inkSoft, borderRadius:999, padding:'8px 13px', fontSize:12, fontWeight:700, cursor:'pointer'}}>
              {t}
            </button>
          );
        })}
      </div>

      <div style={fieldLabel}>Urgencia</div>
      <div style={{display:'flex', gap:8, marginBottom:16}}>
        {LP_URGENCIAS.map(u => {
          const on = urg === u.id;
          return (
            <button key={u.id} onClick={() => setUrg(u.id)}
              style={{flex:1, border:`1px solid ${on ? u.color : U.border}`, background: on ? `${u.color}22` : U.surface,
                      color: on ? u.color : U.inkSoft, borderRadius:11, padding:'10px', fontSize:12.5, fontWeight:800, cursor:'pointer'}}>
              {u.label}
            </button>
          );
        })}
      </div>

      <div style={fieldLabel}>Máquina afectada</div>
      <input value={maquina} onChange={e => setMaquina(e.target.value)} placeholder="Ej. máquina 1"
             style={Object.assign({}, txt, { marginBottom:16 })}/>

      <div style={fieldLabel}>Descripción</div>
      <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} placeholder="¿Qué pasó?"
                style={Object.assign({}, txt, { resize:'vertical', marginBottom:18 })}/>

      <button onClick={enviar} disabled={!puede}
        style={{width:'100%', padding:'15px', borderRadius:14, border:'none',
                background: puede ? U.accent : U.surface2, color: puede ? '#fff' : U.inkMuted,
                fontSize:15, fontWeight:800, cursor: puede ? 'pointer' : 'not-allowed',
                display:'flex', alignItems:'center', justifyContent:'center', gap:8}}>
        <Icon n="send" s={17} c={puede ? '#fff' : U.inkMuted}/>
        {saving ? 'Enviando…' : 'Enviar reporte'}
      </button>
    </div>
  );
}

/* ── Modal de edición de carga propia (ventana 24h) — genérico ──
   props: U, titulo, campos ([{key,label}] numéricos), inicial (obj),
   onGuardar(valores, motivo) -> Promise, onCerrar. */
function LpEditModal({ U, titulo, campos, inicial, onGuardar, onCerrar, motivoRequerido }) {
  const init = {};
  for (const c of campos) init[c.key] = String(inicial[c.key] != null ? inicial[c.key] : '');
  const [vals, setVals] = useState(init);
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);

  const setV = (k, v) => setVals(o => Object.assign({}, o, { [k]: v }));
  const faltaMotivo = motivoRequerido && !motivo.trim();

  const guardar = async () => {
    if (saving || faltaMotivo) return;
    setSaving(true);
    try {
      const out = {};
      for (const c of campos) out[c.key] = parseInt(vals[c.key], 10) || 0;
      await onGuardar(out, motivo.trim());
    } catch (e) { setSaving(false); }
  };

  const inp = { width:'100%', boxSizing:'border-box', background:U.surface2, border:`1px solid ${U.border}`,
                borderRadius:12, color:U.ink, fontSize:20, fontWeight:800, textAlign:'center',
                padding:'12px 10px', outline:'none', fontVariantNumeric:'tabular-nums' };

  return (
    <div onClick={onCerrar} style={{position:'fixed', inset:0, background:'rgba(0,0,0,.62)', zIndex:9999,
                 display:'flex', alignItems:'center', justifyContent:'center', padding:18}}>
      <div onClick={e => e.stopPropagation()} style={{width:'100%', maxWidth:360, background:U.surface,
                   border:`1px solid ${U.border}`, borderRadius:18, padding:'18px', color:U.ink}}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16}}>
          <h3 style={{fontSize:15, fontWeight:800, margin:0}}>{titulo}</h3>
          <button onClick={onCerrar} style={{border:'none', background:'transparent', cursor:'pointer', padding:0}}>
            <Icon n="x" s={18} c={U.inkMuted}/>
          </button>
        </div>
        <div style={{display:'flex', gap:12, marginBottom:14}}>
          {campos.map(c => (
            <label key={c.key} style={{flex:1}}>
              <span style={{display:'block', fontSize:11, color:U.inkSoft, marginBottom:6}}>{c.label}</span>
              <input type="number" inputMode="numeric" min="0" value={vals[c.key]}
                     onChange={e => setV(c.key, e.target.value)} style={inp}/>
            </label>
          ))}
        </div>
        <label style={{display:'block', marginBottom:16}}>
          <span style={{display:'block', fontSize:11, color: faltaMotivo ? U.warn : U.inkSoft, marginBottom:6}}>{motivoRequerido ? 'Motivo (obligatorio)' : 'Motivo (opcional)'}</span>
          <input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="¿Por qué se corrige?"
                 style={{width:'100%', boxSizing:'border-box', background:U.surface2, border:`1px solid ${U.border}`,
                         borderRadius:12, color:U.ink, fontSize:13, padding:'11px 12px', outline:'none', fontFamily:'inherit'}}/>
        </label>
        <div style={{display:'flex', gap:10}}>
          <button onClick={onCerrar} style={{flex:1, padding:'13px', borderRadius:12, border:`1px solid ${U.border}`,
                       background:U.surface2, color:U.inkSoft, fontSize:14, fontWeight:700, cursor:'pointer'}}>Cancelar</button>
          <button onClick={guardar} disabled={saving || faltaMotivo} style={{flex:1, padding:'13px', borderRadius:12, border:'none',
                       background: faltaMotivo ? U.surface2 : U.accent, color: faltaMotivo ? U.inkMuted : '#fff', fontSize:14, fontWeight:800,
                       cursor: (saving || faltaMotivo) ? 'not-allowed' : 'pointer'}}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Escáner de QR por cámara — genérico (reusa window.QrScanner) ──
   Lectura ÚNICA: detecta un código, para la cámara y devuelve el texto por
   onDetect. props: U, onDetect(texto), onClose. Si la librería no está, avisa. */
function LpQrScan({ U, onDetect, onClose }) {
  const videoRef = useRef(null);
  const scannerRef = useRef(null);
  const handledRef = useRef(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!window.QrScanner) { setErr('El escáner no está disponible en este dispositivo.'); return; }
    let cancelled = false;
    let scanner = null;
    const init = async () => {
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (cancelled || !videoRef.current) return;
      try {
        scanner = new window.QrScanner(
          videoRef.current,
          result => {
            if (handledRef.current) return;
            handledRef.current = true;
            try { scanner.stop(); } catch (e) {}
            const t = (result && result.data != null) ? result.data : (result || '');
            onDetect(String(t).trim());
          },
          { highlightScanRegion: true, highlightCodeOutline: true, returnDetailedScanResult: true }
        );
        scannerRef.current = scanner;
        await scanner.start();
      } catch (e) {
        if (!cancelled) {
          const m = ((e && e.message) || '').toLowerCase();
          setErr(m.includes('permission') || m.includes('denied') || m.includes('notallowed')
            ? 'Permiso de cámara denegado.' : ((e && e.message) || 'No se pudo acceder a la cámara'));
        }
      }
    };
    init();
    return () => { cancelled = true; try { if (scanner) { scanner.stop(); scanner.destroy(); } } catch (e) {} };
    // eslint-disable-next-line
  }, []);

  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'rgba(0,0,0,.85)', zIndex:9999,
                 display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:18}}>
      <div onClick={e => e.stopPropagation()} style={{width:'100%', maxWidth:360}}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12}}>
          <span style={{fontSize:13, fontWeight:800, color:'#fff'}}>Escanear QR</span>
          <button onClick={onClose} style={{border:'none', background:'transparent', cursor:'pointer', padding:0}}>
            <Icon n="x" s={20} c="#fff"/>
          </button>
        </div>
        <div style={{position:'relative', width:'100%', aspectRatio:'1 / 1', background:'#000',
                     borderRadius:16, overflow:'hidden', border:`1px solid ${U.border}`}}>
          <video ref={videoRef} playsInline muted style={{width:'100%', height:'100%', objectFit:'cover'}}/>
        </div>
        {err
          ? <div style={{marginTop:12, fontSize:12.5, color:U.danger, textAlign:'center', lineHeight:1.5}}>{err}</div>
          : <div style={{marginTop:12, fontSize:12, color:'#cbd5e1', textAlign:'center'}}>Apuntá la cámara al QR del SKU</div>}
      </div>
    </div>
  );
}
