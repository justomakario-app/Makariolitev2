/* ══ PRODUCCIÓN HUB PAGE (S2.21b)
   Wrapper con 4 tabs que agrupa el sistema productivo:
   - Producción (DEFAULT) — renderea window.ProduccionPage sin tocarla.
   - Stock — renderea window.StockPage sin tocarla.
     SOLO visible para owner/admin/encargado (guard de rol en cliente).
   - De fábrica — panorama operativo: orden por sector + lista de compras + KPIs.
   - Línea productiva — router por rol (guard FASE 1): cada sector ve su pantalla.

   Accesible para todos los roles que tenían 'produccion-hub' en ROLE_NAV.
   El guard de Stock es adicional al del backend y al de app.jsx.
   ══ */

/* ── FASE 1 · guard de rol: router de "Línea productiva" por sector ──
   Cada rol de producción ve la identidad de SU sector (paleta oficial de la
   brief). El backend (RPCs + cadena de stock) ya está; la UI por sector es
   Fase 3. Un rol sin producción ve el placeholder genérico, sin cambios. */
const SECTOR_THEME = {
  cnc:       { label:'Sector CNC',          color:'#2563EB', icon:'layers',  desc:'Corte de placas' },
  melamina:  { label:'Sector Melamina',     color:'#534AB7', icon:'flame',   desc:'Terminado de tapas' },
  pino:      { label:'Sector Pino',         color:'#0F6E56', icon:'tools',   desc:'Patas de madera' },
  embalaje:  { label:'Sector Embalaje',     color:'#993C1D', icon:'package', desc:'Armado y despacho' },
  encargado: { label:'Panel del Encargado', color:'#2E4057', icon:'shield',  desc:'Centro de control' },
  owner:     { label:'Supervisión',         color:'#2E4057', icon:'eye',     desc:'Vista de dirección' },
  admin:     { label:'Supervisión',         color:'#2E4057', icon:'eye',     desc:'Vista de dirección' },
};

function LineaProductivaGuard({ role }) {
  const t = SECTOR_THEME[role];
  // Pantallas de sector ya construidas (Fase 3); el resto, placeholder por sector.
  if (role === 'cnc' && window.CncSector) return <window.CncSector/>;
  if (role === 'melamina' && window.MelaminaSector) return <window.MelaminaSector/>;
  if (role === 'pino' && window.PinoSector) return <window.PinoSector/>;
  if (role === 'embalaje' && window.EmbalajeSector) return <window.EmbalajeSector/>;
  if ((role === 'encargado' || role === 'owner' || role === 'admin') && window.EncargadoPanel) return <window.EncargadoPanel/>;
  if (!t) {
    return window.ProximamentePlaceholder
      ? <window.ProximamentePlaceholder nombre="Línea productiva"/>
      : <div className="admin-empty-state"><Icon n="tools" s={32} c="var(--ink-muted)"/><h3>Línea productiva</h3><p>Próximamente</p></div>;
  }
  return (
    <div style={{display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', textAlign:'center', padding:'48px 24px', minHeight:320}}>
      <div style={{width:72, height:72, borderRadius:20, background:t.color+'14', border:'1px solid '+t.color+'29', display:'flex', alignItems:'center', justifyContent:'center', marginBottom:18}}>
        <Icon n={t.icon} s={32} c={t.color}/>
      </div>
      <div style={{fontSize:11, fontWeight:800, letterSpacing:'.12em', textTransform:'uppercase', color:t.color, marginBottom:8}}>{t.desc}</div>
      <h3 style={{fontSize:22, fontWeight:800, color:'var(--ink)', margin:'0 0 6px'}}>{t.label}</h3>
      <p style={{fontSize:13, color:'var(--ink-muted)', margin:'0 0 20px', maxWidth:340, lineHeight:1.6}}>
        Tu pantalla de sector está en construcción. El backend ya está listo (carga, stock y cadena productiva); la interfaz de este sector llega en la próxima entrega.
      </p>
      <span style={{display:'inline-flex', alignItems:'center', gap:6, fontSize:11, fontWeight:700, padding:'6px 12px', borderRadius:999, background:t.color+'14', color:t.color}}>
        <Icon n="tools" s={12} c={t.color}/> En construcción · Fase 3
      </span>
    </div>
  );
}

/* ── Tab "De fábrica" — panorama operativo de la fábrica hoy ──────────
   Vista consolidada (read-only) que reúne, en un solo lugar:
   · KPIs del día (listos para despacho, pendiente de producir, a comprar, alertas)
   · Orden por sector (prod_v_orden_sector): qué le toca producir hoy a cada sector
   · Lista de compras (prod_v_compras): materia prima a reponer, en unidades
   Reusa window.LP_DATA. Tema claro, integrado a la plataforma. */
const FAB_UI = {
  surface:'#FFFFFF', surface2:'#F4F4F5', border:'rgba(0,0,0,0.09)',
  ink:'#0A0A0A', inkSoft:'#555555', inkMuted:'#8A8A8A',
  accent:'#2E4057', ok:'#16A34A', warn:'#D97706', danger:'#DC2626',
};
const FAB_SECTORES = [
  { id:'cnc',      label:'CNC',      color:'#2563EB', icon:'layers',  sub:'cortar tapas' },
  { id:'melamina', label:'Melamina', color:'#534AB7', icon:'flame',   sub:'terminar tapas' },
  { id:'pino',     label:'Pino',     color:'#0F6E56', icon:'tools',   sub:'fabricar patas' },
  { id:'embalaje', label:'Embalaje', color:'#993C1D', icon:'package', sub:'armar productos' },
];

function DeFabrica() {
  const U = FAB_UI;
  const toast = useToast();
  const [d, setD] = useState({ terminado:[], resumen:[], alertas:[], orden:[], compras:[] });
  const [loading, setLoading] = useState(true);

  const cargar = useCallback(async (opts) => {
    if (!(opts && opts.silent)) setLoading(true);
    try {
      const [st, rs, al, orden, compras] = await Promise.all([
        window.LP_DATA.stock().catch(() => null),
        window.LP_DATA.resumenDia().catch(() => []),
        window.LP_DATA.alertas().catch(() => []),
        window.LP_DATA.ordenSector().catch(() => []),
        window.LP_DATA.compras().catch(() => []),
      ]);
      setD({ terminado: (st && st.stock_terminado) || [], resumen: rs || [], alertas: al || [], orden: orden || [], compras: compras || [] });
    } catch (err) {
      toast.error(err && err.message ? err.message : 'No se pudo cargar');
    } finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { cargar(); }, [cargar]);

  // 🔴 Realtime: refresca cuando cambia producción / stock / alertas.
  useEffect(() => window.LP_DATA.subscribe(
    ['prod_corte','prod_melamina','prod_pino','prod_embalaje','prod_stock_terminado','prod_alerta','prod_insumo'],
    () => cargar({ silent:true })
  ), [cargar]);

  const sum = (arr, fn) => (arr || []).reduce((s, x) => s + (Number(fn(x)) || 0), 0);
  const listos = sum(d.terminado, r => r.disponible);
  const pendiente = sum(d.resumen, r => r.pendiente);
  const ordenPorSector = (sid) => d.orden.filter(o => o.sector === sid);

  if (loading) return <div style={{ textAlign:'center', color:U.inkMuted, padding:'60px 0', fontSize:13 }}>Cargando panorama de fábrica…</div>;

  const kpi = (label, val, color, sub) => (
    <div style={{ flex:1, minWidth:150, background:U.surface, border:`1px solid ${U.border}`, borderRadius:14, padding:'14px 16px' }}>
      <div style={{ fontSize:26, fontWeight:800, color, fontVariantNumeric:'tabular-nums', lineHeight:1 }}>{val}</div>
      <div style={{ fontSize:10.5, color:U.inkSoft, marginTop:6, fontWeight:600 }}>{label}</div>
      {sub ? <div style={{ fontSize:9.5, color:U.inkMuted, marginTop:2 }}>{sub}</div> : null}
    </div>
  );

  return (
    <div style={{ padding:'18px 32px 32px', color:U.ink, fontSize:13 }}>
      {/* KPIs */}
      <div style={{ display:'flex', flexWrap:'wrap', gap:10, marginBottom:20 }}>
        {kpi('Listos para despacho', listos, U.ok)}
        {kpi('Pendiente de producir', pendiente, U.warn, `de ${d.resumen.length} productos`)}
        {kpi('Ítems a comprar', d.compras.length, d.compras.length ? U.danger : U.inkSoft)}
        {kpi('Alertas de stock', d.alertas.length, d.alertas.length ? U.danger : U.inkSoft)}
      </div>

      {/* Orden por sector */}
      <h3 style={{ fontSize:15, fontWeight:800, margin:'0 0 12px' }}>Orden por sector · hoy</h3>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(260px, 1fr))', gap:14, marginBottom:24 }}>
        {FAB_SECTORES.map(s => {
          const items = ordenPorSector(s.id);
          const total = sum(items, x => x.cantidad);
          return (
            <div key={s.id} style={{ background:U.surface, border:`1px solid ${U.border}`, borderRadius:14, overflow:'hidden' }}>
              <div style={{ display:'flex', alignItems:'center', gap:9, padding:'12px 14px', borderBottom:`1px solid ${U.border}` }}>
                <span style={{ width:30, height:30, borderRadius:9, background:s.color + '1f', border:`1px solid ${s.color}44`,
                               display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <Icon n={s.icon} s={16} c={s.color}/>
                </span>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13.5, fontWeight:800 }}>{s.label}</div>
                  <div style={{ fontSize:10, color:U.inkMuted }}>{s.sub}</div>
                </div>
                <span style={{ fontSize:18, fontWeight:800, color:s.color, fontVariantNumeric:'tabular-nums' }}>{total}</span>
              </div>
              {items.length === 0 ? (
                <div style={{ padding:'16px 14px', fontSize:12, color:U.inkMuted, textAlign:'center' }}>Sin demanda pendiente.</div>
              ) : items.slice(0, 8).map((it, i) => (
                <div key={(it.sku || '') + i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                     padding:'9px 14px', borderBottom: i < Math.min(items.length, 8) - 1 ? `1px solid ${U.border}` : 'none' }}>
                  <div style={{ minWidth:0, paddingRight:10 }}>
                    <div style={{ fontSize:12, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{it.nombre || it.sku}</div>
                    <div style={{ fontSize:9.5, color:U.inkMuted }}>{it.sku}</div>
                  </div>
                  <span style={{ fontSize:14, fontWeight:800, color:s.color, fontVariantNumeric:'tabular-nums' }}>{it.cantidad}</span>
                </div>
              ))}
              {items.length > 8 ? <div style={{ padding:'7px 14px', fontSize:10.5, color:U.inkMuted }}>+{items.length - 8} más</div> : null}
            </div>
          );
        })}
      </div>

      {/* Lista de compras */}
      <h3 style={{ fontSize:15, fontWeight:800, margin:'0 0 12px' }}>Lista de compras · materia prima a reponer</h3>
      {d.compras.length === 0 ? (
        <div style={{ background:U.surface, border:`1px solid ${U.border}`, borderRadius:14, padding:'20px',
                      textAlign:'center', fontSize:12.5, color:U.inkSoft }}>Nada por comprar — el stock cubre la demanda.</div>
      ) : (
        <div style={{ background:U.surface, border:`1px solid ${U.border}`, borderRadius:14, overflow:'hidden' }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 90px 90px 90px', gap:6, padding:'9px 14px',
                        fontSize:9.5, fontWeight:800, letterSpacing:'.05em', textTransform:'uppercase',
                        color:U.inkMuted, borderBottom:`1px solid ${U.border}` }}>
            <span>Insumo</span><span style={{ textAlign:'right' }}>Necesita</span><span style={{ textAlign:'right' }}>Stock</span><span style={{ textAlign:'right' }}>Falta</span>
          </div>
          {d.compras.slice(0, 40).map((c, i) => (
            <div key={c.sku || i} style={{ display:'grid', gridTemplateColumns:'1fr 90px 90px 90px', gap:6, padding:'10px 14px',
                         alignItems:'center', borderBottom: i < Math.min(d.compras.length, 40) - 1 ? `1px solid ${U.border}` : 'none', fontSize:12.5 }}>
              <div style={{ minWidth:0 }}>
                <div style={{ fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{c.nombre || c.sku}</div>
                <div style={{ fontSize:9.5, color:U.inkMuted }}>{c.categoria || ''}{c.unidad ? ` · ${c.unidad}` : ''}</div>
              </div>
              <span style={{ textAlign:'right', fontVariantNumeric:'tabular-nums', color:U.inkSoft }}>{c.necesita}</span>
              <span style={{ textAlign:'right', fontVariantNumeric:'tabular-nums', color:U.inkSoft }}>{c.stock}</span>
              <span style={{ textAlign:'right', fontVariantNumeric:'tabular-nums', fontWeight:800, color:U.danger }}>{c.falta}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop:16, fontSize:11, color:U.inkMuted, lineHeight:1.5 }}>
        Vista consolidada de la fábrica: la demanda de cada sector sale de la explosión de pedidos; la lista de compras, de la materia prima vs stock. Todo se actualiza en vivo.
      </div>
    </div>
  );
}

function ProduccionHubPage() {
  const M = window.useMockData();
  const role = (M.user.role || '').toLowerCase();
  const canSeeStock = ['owner', 'admin', 'encargado'].includes(role);

  const ALL_TABS = [
    { id:'produccion', label:'Producción',      stockOnly: false },
    { id:'stock',      label:'Stock',           stockOnly: true  },
    { id:'fe-fabrica', label:'De fábrica',      stockOnly: false },
    { id:'linea-prod', label:'Línea productiva', stockOnly: false },
    { id:'tablero',    label:'Tablero LP',      stockOnly: false },
    { id:'activar',    label:'Activar LP',      stockOnly: true  },
    { id:'carga-stock',label:'Carga stock',     stockOnly: true  },
  ];

  // Aislamiento LP (F1/F2): flag TRI-ESTADO — 'loading' | true | false. loading/false/error ⇒ LP OFF
  // (fail-closed). Se revalida al montar, al recuperar foco/visibilidad y periódicamente mientras el
  // hub está abierto; si se apaga en caliente, LP se desmonta y el usuario queda en una tab permitida.
  const [lpFlag, setLpFlag] = useState('loading');
  const lpOn = lpFlag === true;
  const readFlag = useCallback(() => {
    if (!(window.LP_DATA && window.LP_DATA.lpFlag)) { setLpFlag(false); return; }
    window.LP_DATA.lpFlag().then(v => setLpFlag(v === true)).catch(() => setLpFlag(false));
  }, []);
  useEffect(() => {
    readFlag();
    const onFocus = () => readFlag();
    const onVis = () => { if (document.visibilityState === 'visible') readFlag(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    const id = setInterval(readFlag, 20000);
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVis); clearInterval(id); };
  }, [readFlag]);

  const LP_TAB_IDS = ['linea-prod', 'tablero', 'activar', 'carga-stock', 'fe-fabrica'];
  // Tabs AUTORIZADAS: LP sólo con flag ON. 'produccion' siempre está (destino seguro por defecto).
  const TABS = ALL_TABS.filter(t => (!t.stockOnly || canSeeStock) && (lpOn || LP_TAB_IDS.indexOf(t.id) === -1));

  const PROD_ROLES = ['encargado','cnc','melamina','pino','embalaje','carpinteria','logistica'];
  // Roles con pantalla de sector LP propia (aterrizan en 'linea-prod' con flag ON). carpinteria y
  // logistica NO tienen sector LP: por fuente funcional conservan Producción legacy como destino.
  const LP_SECTOR_ROLES = ['encargado','cnc','melamina','pino','embalaje'];
  const [tab, setTab] = useState('produccion');
  // Tab EFECTIVA derivada EXCLUSIVAMENTE de las tabs autorizadas: si la actual dejó de ser válida
  // (p.ej. el flag se apagó y desapareció una tab LP), cae a la primera permitida.
  const effTab = TABS.some(t => t.id === tab) ? tab : (TABS[0] ? TABS[0].id : 'produccion');
  useEffect(() => { if (effTab !== tab) setTab(effTab); }, [effTab, tab]);
  // Con flag ON, los roles productivos aterrizan en su pantalla LP (una vez, sólo desde 'produccion').
  useEffect(() => { if (lpOn && LP_SECTOR_ROLES.includes(role) && tab === 'produccion') setTab('linea-prod'); }, [lpOn]);

  const isLPTab = LP_TAB_IDS.indexOf(effTab) !== -1;
  const active = TABS.find(t => t.id === effTab) || TABS[0] || { id: 'produccion', label: 'Producción' };

  return (
    <div>
      <div style={{padding:'0 32px 0'}}>
        <div className="tabs" role="tablist" style={{marginBottom:0, overflowX:'auto', flexWrap:'nowrap', WebkitOverflowScrolling:'touch', scrollbarWidth:'none'}}>
          {TABS.map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={effTab === t.id}
              className={`tab ${effTab === t.id ? 'active' : ''}`}
              style={{whiteSpace:'nowrap', flexShrink:0}}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel">
        {/* Cada rama LP exige lpOn Y que la tab efectiva sea LP: nunca se monta LP con flag off/cargando. */}
        {effTab === 'produccion' ? (
          window.ProduccionPage ? <window.ProduccionPage/> : null
        ) : effTab === 'stock' && canSeeStock ? (
          window.StockPage ? <window.StockPage/> : null
        ) : lpOn && effTab === 'linea-prod' ? (
          <LineaProductivaGuard role={role}/>
        ) : lpOn && effTab === 'fe-fabrica' ? (
          <DeFabrica/>
        ) : lpOn && effTab === 'tablero' ? (
          window.LineaDashboardPage ? <window.LineaDashboardPage/> : null
        ) : lpOn && effTab === 'activar' && canSeeStock ? (
          window.LineaActivacionPage ? <window.LineaActivacionPage/> : null
        ) : lpOn && effTab === 'carga-stock' && canSeeStock ? (
          window.LineaStockCargaPage ? <window.LineaStockCargaPage/> : null
        ) : (
          <div className="admin-empty-state">
            <Icon n="tools" s={32} c="var(--ink-muted)"/>
            <h3>{active.label}</h3>
            <p>{isLPTab ? 'Línea Productiva no está habilitada.' : 'Módulo no disponible.'}</p>
          </div>
        )}
      </div>
    </div>
  );
}

window.ProduccionHubPage = ProduccionHubPage;
