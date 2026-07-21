/* ══ LÍNEA PRODUCTIVA · DASHBOARD MOBILE (read-only) ═══════════════════════
   Versión mobile del tablero. Mismo contrato que desktop: window.prod_rpc_dashboard.
   Solo lectura. NO muta. Si el RPC falla, Producción sigue funcionando.
   window.LineaDashboardPageMobile
   ══ */
(function () {
  const U = {
    surface:'#FFFFFF', border:'rgba(0,0,0,0.09)',
    ink:'#0A0A0A', inkSoft:'#555555', inkMuted:'#8A8A8A',
    accent:'#2E4057', ok:'#16A34A', warn:'#D97706', danger:'#DC2626', info:'#2563EB', legacy:'#8A8A8A',
  };
  const POOL_LABEL = { melamina:'Producir (Melamina/CNC)', patas:'Producir (Pino)', insumo:'Comprar (Insumo)', otro:'Intermedio', desconocido:'Sin pool' };
  const n = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('es-AR'));

  function Kpi({ label, val, color, sub, hint }) {
    return (
      <div style={{ flex:'1 1 45%', minWidth:130, background:U.surface, border:`1px solid ${U.border}`, borderRadius:12, padding:'12px 13px' }}>
        <div style={{ fontSize:22, fontWeight:800, color:color||U.ink, fontVariantNumeric:'tabular-nums', lineHeight:1 }}>{n(val)}</div>
        <div style={{ fontSize:10, color:U.inkSoft, marginTop:5, fontWeight:700 }}>{label}</div>
        {sub ? <div style={{ fontSize:9, color:U.inkMuted, marginTop:2 }}>{sub}</div> : null}
        {hint ? <div style={{ fontSize:8.5, color:U.inkMuted, marginTop:3, fontStyle:'italic' }}>{hint}</div> : null}
      </div>
    );
  }
  const Title = ({ children }) => <h3 style={{ fontSize:13.5, fontWeight:800, margin:'20px 0 10px', color:U.ink }}>{children}</h3>;

  function LineaDashboardPageMobile() {
    const [d, setD] = useState(null);
    const [state, setState] = useState('loading');
    const [errMsg, setErrMsg] = useState('');

    const load = async () => {
      setState('loading');
      try {
        const { data, error } = await window.SUPA.rpc('prod_rpc_dashboard', { p_payload: {} });
        if (error) {
          const msg = error.message || 'Error';
          if (/permiso|sesion|expiro/i.test(msg)) { setState('forbidden'); setErrMsg(msg); }
          else { setState('error'); setErrMsg(msg); }
          return;
        }
        setD(data); setState('ok');
      } catch (e) { setState('error'); setErrMsg((e && e.message) || 'No se pudo cargar'); }
    };
    useEffect(() => { load(); }, []);

    if (state === 'loading') return <div style={{ textAlign:'center', color:U.inkMuted, padding:'50px 0', fontSize:13 }}>Cargando tablero…</div>;
    if (state === 'forbidden') return <div style={{ padding:'40px 20px', textAlign:'center' }}><Icon n="shield" s={30} c="var(--ink-muted)"/><h3 style={{ margin:'10px 0 4px' }}>Sin acceso</h3><p style={{ color:U.inkMuted, fontSize:12 }}>Tu rol no ve el tablero de Línea Productiva.</p></div>;
    if (state === 'error') return (
      <div style={{ padding:'20px 14px' }}>
        <div style={{ border:'1px solid rgba(220,38,38,.28)', background:'rgba(220,38,38,.04)', borderRadius:12, padding:'14px' }}>
          <div style={{ color:U.danger, fontWeight:700, fontSize:12.5, display:'flex', gap:8, alignItems:'center' }}><Icon n="alert" s={15} c={U.danger}/> No se pudo cargar el tablero.</div>
          <div style={{ fontSize:11.5, color:U.inkSoft, marginTop:7 }}>{errMsg}</div>
          <div style={{ fontSize:10.5, color:U.inkMuted, marginTop:7 }}>Producción no se ve afectada.</div>
          <button className="btn-secondary" style={{ marginTop:10 }} onClick={load}>Reintentar</button>
        </div>
      </div>
    );

    const R = (d && d.resumen) || {}, S = (d && d.stock) || {}, SEC = (d && d.sectores) || {}, Q = (d && d.calidad_datos) || {};
    const nec = (d && d.necesidades_por_pieza) || [], j = d && d.jornada;
    const stockCanon = (S.canonico_pieza_cnc||0)+(S.canonico_melamina||0)+(S.canonico_patas||0)+(S.canonico_terminado||0);
    const porPool = {}; nec.forEach(x => { const p = x.pool||'otro'; (porPool[p]=porPool[p]||[]).push(x); });
    const SECT = [
      { id:'cnc_cortes', label:'CNC', color:'#2563EB' }, { id:'melamina_registros', label:'Melamina', color:'#534AB7' },
      { id:'pino_registros', label:'Pino', color:'#0F6E56' }, { id:'embalaje_registros', label:'Embalaje', color:'#993C1D' },
    ];

    return (
      <div style={{ padding:'16px 14px 34px', color:U.ink, fontSize:12.5 }}>
        <div style={{ fontSize:10.5, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:U.accent }}>Línea Productiva · Tablero</div>
        <div style={{ fontSize:10.5, color:U.inkMuted, marginTop:2, marginBottom:2 }}>
          {j ? <>Jornada {j.fecha} · {j.estado}</> : <>Sin jornada · {R.fuente==='jornada'?'jornada':'demanda global pendiente'}</>}
        </div>
        <button className="btn-secondary" onClick={load} style={{ marginTop:6, display:'inline-flex', alignItems:'center', gap:6, fontSize:12 }}><Icon n="refresh" s={12}/> Actualizar</button>

        <Title>A · Resumen</Title>
        <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
          <Kpi label="Órdenes" val={R.ordenes_vinculadas} color={U.accent} sub="pedidos" />
          <Kpi label="Unid. vendidas" val={R.unidades_vendidas} color={U.info} sub="pendientes" />
          <Kpi label="Producidas aplic." val={R.unidades_producidas_aplicables} color={U.ok} />
          <Kpi label="Netas a producir" val={R.unidades_netas_a_producir} color={U.warn} />
          <Kpi label="Excedente s/conciliar" val={R.excedente_producido_pendiente_conciliacion} color={U.danger} hint="no es stock disponible" />
        </div>

        <Title>B · Necesidades por pieza</Title>
        {nec.length === 0 ? <div style={{ background:U.surface, border:`1px solid ${U.border}`, borderRadius:12, padding:'14px', textAlign:'center', color:U.inkSoft, fontSize:12 }}>Sin faltantes.</div> :
          Object.keys(porPool).map(pool => (
            <div key={pool} style={{ background:U.surface, border:`1px solid ${U.border}`, borderRadius:12, overflow:'hidden', marginBottom:10 }}>
              <div style={{ padding:'9px 12px', borderBottom:`1px solid ${U.border}`, fontSize:10.5, fontWeight:800, color:U.accent, textTransform:'uppercase' }}>{POOL_LABEL[pool]||pool}</div>
              {porPool[pool].slice(0,8).map((x,i) => (
                <div key={x.sku+i} style={{ display:'flex', justifyContent:'space-between', padding:'8px 12px', borderBottom: i<Math.min(porPool[pool].length,8)-1?`1px solid ${U.border}`:'none' }}>
                  <div><div style={{ fontSize:12, fontWeight:700 }}>{x.sku}</div><div style={{ fontSize:9, color:U.inkMuted }}>dem {n(x.demanda_bruta)} · stk {n(x.stock_utilizable)}</div></div>
                  <span style={{ fontSize:14, fontWeight:800, color:U.warn }}>{n(x.faltante_neto)}</span>
                </div>
              ))}
            </div>
          ))}

        <Title>C · Sectores</Title>
        <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
          {SECT.map(s => (
            <div key={s.id} style={{ flex:'1 1 45%', minWidth:130, background:U.surface, border:`1px solid ${U.border}`, borderRadius:12, padding:'12px 13px' }}>
              <div style={{ fontSize:12.5, fontWeight:800, color:s.color }}>{s.label}</div>
              <div style={{ fontSize:20, fontWeight:800, color:s.color, marginTop:4 }}>{n(SEC[s.id])}</div>
              <div style={{ fontSize:9.5, color:U.inkMuted }}>registros</div>
              {s.id==='pino_registros' ? (SEC.pino_estado==='pendiente_validacion_patas'
                ? <div style={{ marginTop:5, fontSize:9, fontWeight:700, color:U.warn }}>⚠ patas s/validar</div>
                : <div style={{ marginTop:5, fontSize:9, fontWeight:700, color:U.ok }}>✓ operativo</div>) : null}
            </div>
          ))}
        </div>

        <Title>D · Stock (categorías separadas)</Title>
        <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
          <Kpi label="Pieza CNC" val={S.canonico_pieza_cnc} color={U.accent} sub="canónico" />
          <Kpi label="Melamina" val={S.canonico_melamina} color={U.accent} sub="canónico" />
          <Kpi label="Patas" val={S.canonico_patas} color={U.accent} sub="canónico" />
          <Kpi label="Terminado" val={S.canonico_terminado} color={U.accent} sub="canónico" />
          <Kpi label="Free stock legacy" val={S.legacy_free_stock_pendiente_conciliacion} color={U.legacy} hint="separado del canónico" />
        </div>
        {stockCanon===0 ? <div style={{ marginTop:8, fontSize:10.5, color:U.inkMuted, fontStyle:'italic' }}>Stock canónico en cero: la línea aún no operó jornada real.</div> : null}

        <Title>E · Calidad de datos</Title>
        <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
          <Kpi label="Recetas completas" val={Q.recetas_completa} color={U.ok} />
          <Kpi label="Incompleta (patas)" val={Q.recetas_incompleta_patas} color={U.warn} />
          <Kpi label="Incompleta (config)" val={Q.recetas_incompleta_config} color={Q.recetas_incompleta_config?U.danger:U.inkSoft} />
          <Kpi label="SKUs sin pool" val={Q.skus_sin_pool_desconocido} color={Q.skus_sin_pool_desconocido?U.danger:U.inkSoft} />
        </div>

        <div style={{ marginTop:16, fontSize:10, color:U.inkMuted, lineHeight:1.5 }}>Solo lectura. No genera movimientos ni modifica Producción.</div>
      </div>
    );
  }
  window.LineaDashboardPageMobile = LineaDashboardPageMobile;
})();
