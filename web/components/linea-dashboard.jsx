/* ══ LÍNEA PRODUCTIVA · DASHBOARD (read-only) ═══════════════════════════════
   Pantalla NUEVA y AISLADA. Consume window.prod_rpc_dashboard vía window.SUPA.
   - Solo lectura: NO vincula jornadas, NO escribe stock, NO muta orders/carrier/logs.
   - Cifras dinámicas del RPC (nada hardcodeado).
   - Si el RPC falla, esta pantalla muestra el error y NO afecta a Producción.
   window.LineaDashboardPage
   ══ */
(function () {
  const U = {
    surface:'#FFFFFF', surface2:'#F8F8FA', border:'rgba(0,0,0,0.09)',
    ink:'#0A0A0A', inkSoft:'#555555', inkMuted:'#8A8A8A',
    accent:'#2E4057', ok:'#16A34A', warn:'#D97706', danger:'#DC2626', info:'#2563EB', legacy:'#8A8A8A',
  };
  const POOL_LABEL = { melamina:'Producir (Melamina/CNC)', patas:'Producir (Pino)', insumo:'Comprar (Insumo)', otro:'Intermedio', desconocido:'Sin pool' };
  const n = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('es-AR'));

  function Card({ children, style }) {
    return <div style={Object.assign({ background:U.surface, border:`1px solid ${U.border}`, borderRadius:14, padding:'14px 16px' }, style)}>{children}</div>;
  }
  function Kpi({ label, val, color, sub, hint }) {
    return (
      <Card style={{ flex:1, minWidth:150 }}>
        <div style={{ fontSize:26, fontWeight:800, color:color||U.ink, fontVariantNumeric:'tabular-nums', lineHeight:1 }}>{n(val)}</div>
        <div style={{ fontSize:10.5, color:U.inkSoft, marginTop:6, fontWeight:700 }}>{label}</div>
        {sub ? <div style={{ fontSize:9.5, color:U.inkMuted, marginTop:2 }}>{sub}</div> : null}
        {hint ? <div style={{ fontSize:9, color:U.inkMuted, marginTop:4, fontStyle:'italic' }}>{hint}</div> : null}
      </Card>
    );
  }
  function SectionTitle({ children, note }) {
    return <h3 style={{ fontSize:14.5, fontWeight:800, margin:'22px 0 12px', color:U.ink }}>{children}{note ? <span style={{ fontSize:11, fontWeight:600, color:U.inkMuted, marginLeft:8 }}>{note}</span> : null}</h3>;
  }

  function LineaDashboardPage() {
    const [d, setD] = useState(null);
    const [state, setState] = useState('loading'); // loading | ok | error | forbidden
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
      } catch (e) {
        setState('error'); setErrMsg((e && e.message) || 'No se pudo cargar el tablero');
      }
    };
    useEffect(() => { load(); }, []);

    if (state === 'loading') return <div style={{ textAlign:'center', color:U.inkMuted, padding:'60px 0', fontSize:13 }}>Cargando tablero de Línea Productiva…</div>;
    if (state === 'forbidden') return (
      <div className="admin-empty-state" style={{ padding:'48px 24px', textAlign:'center' }}>
        <Icon n="shield" s={32} c="var(--ink-muted)"/><h3>Sin acceso al tablero</h3>
        <p style={{ color:U.inkMuted }}>Tu rol no tiene permiso para ver el tablero de Línea Productiva.</p>
      </div>
    );
    if (state === 'error') return (
      <div style={{ padding:'32px' }}>
        <Card style={{ borderColor:'rgba(220,38,38,.28)', background:'rgba(220,38,38,.04)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, color:U.danger, fontWeight:700, fontSize:13 }}>
            <Icon n="alert" s={16} c={U.danger}/> No se pudo cargar el tablero de Línea Productiva.
          </div>
          <div style={{ fontSize:12, color:U.inkSoft, marginTop:8 }}>{errMsg}</div>
          <div style={{ fontSize:11, color:U.inkMuted, marginTop:8 }}>El módulo Producción no se ve afectado por este error.</div>
          <button className="btn-secondary" style={{ marginTop:12 }} onClick={load}>Reintentar</button>
        </Card>
      </div>
    );

    const R = (d && d.resumen) || {};
    const S = (d && d.stock) || {};
    const SEC = (d && d.sectores) || {};
    const Q = (d && d.calidad_datos) || {};
    const nec = (d && d.necesidades_por_pieza) || [];
    const j = d && d.jornada;
    const stockCanonicoTotal = (S.canonico_pieza_cnc||0)+(S.canonico_melamina||0)+(S.canonico_patas||0)+(S.canonico_terminado||0);
    const lineaVacia = stockCanonicoTotal === 0;

    // agrupar necesidades por pool
    const porPool = {};
    nec.forEach(x => { const p = x.pool || 'otro'; (porPool[p] = porPool[p] || []).push(x); });

    const SECT = [
      { id:'cnc_cortes', label:'CNC', color:'#2563EB', icon:'layers', sub:'cortar tapas' },
      { id:'melamina_registros', label:'Melamina', color:'#534AB7', icon:'flame', sub:'terminar tapas' },
      { id:'pino_registros', label:'Pino', color:'#0F6E56', icon:'tools', sub:'fabricar patas' },
      { id:'embalaje_registros', label:'Embalaje', color:'#993C1D', icon:'package', sub:'armar productos' },
    ];

    return (
      <div style={{ padding:'18px 32px 40px', color:U.ink, fontSize:13 }}>
        {/* Encabezado */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6, flexWrap:'wrap', gap:10 }}>
          <div>
            <div style={{ fontSize:11, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:U.accent }}>Línea Productiva · Tablero</div>
            <div style={{ fontSize:11, color:U.inkMuted, marginTop:2 }}>
              {j ? <>Jornada <b>{j.fecha}</b> · estado <b>{j.estado}</b></> : <>Sin jornada activa · {R.fuente === 'jornada' ? 'jornada' : 'demanda global pendiente'}</>}
              {' · '}actualizado {d && d.generado_at ? new Date(d.generado_at).toLocaleTimeString('es-AR') : ''}
            </div>
          </div>
          <button className="btn-secondary" onClick={load} style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
            <Icon n="refresh" s={13}/> Actualizar
          </button>
        </div>

        {/* A · Resumen — órdenes vs unidades vs netas SEPARADAS */}
        <SectionTitle note="órdenes, unidades y piezas son unidades de medida distintas">A · Resumen de la jornada</SectionTitle>
        <div style={{ display:'flex', flexWrap:'wrap', gap:10 }}>
          <Kpi label="Órdenes vinculadas" val={R.ordenes_vinculadas} color={U.accent} sub="pedidos (filas)" />
          <Kpi label="Unidades vendidas" val={R.unidades_vendidas} color={U.info} sub="pendientes de venta" />
          <Kpi label="Producidas aplicables" val={R.unidades_producidas_aplicables} color={U.ok} sub="ya producido (legacy)" />
          <Kpi label="Netas a producir" val={R.unidades_netas_a_producir} color={U.warn} sub="vendidas − producidas" />
          <Kpi label="Excedente s/ conciliar" val={R.excedente_producido_pendiente_conciliacion} color={U.danger} sub="producido > pendiente" hint="no es stock disponible" />
        </div>

        {/* B · Necesidades por pieza (agrupadas por pool) */}
        <SectionTitle note="piezas del BOM — NO son unidades vendidas">B · Necesidades productivas por pieza</SectionTitle>
        {nec.length === 0 ? (
          <Card style={{ textAlign:'center', color:U.inkSoft, fontSize:12.5 }}>Sin faltantes: el stock cubre la demanda actual.</Card>
        ) : (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(240px, 1fr))', gap:14 }}>
            {Object.keys(porPool).map(pool => (
              <Card key={pool} style={{ padding:0, overflow:'hidden' }}>
                <div style={{ padding:'10px 14px', borderBottom:`1px solid ${U.border}`, fontSize:11, fontWeight:800, color:U.accent, textTransform:'uppercase', letterSpacing:'.04em' }}>{POOL_LABEL[pool] || pool}</div>
                {porPool[pool].slice(0, 10).map((x, i) => (
                  <div key={x.sku + i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 14px', borderBottom: i < Math.min(porPool[pool].length,10)-1 ? `1px solid ${U.border}` : 'none' }}>
                    <div style={{ minWidth:0 }}>
                      <div style={{ fontSize:12, fontWeight:700 }}>{x.sku}</div>
                      <div style={{ fontSize:9.5, color:U.inkMuted }}>demanda {n(x.demanda_bruta)} · stock {n(x.stock_utilizable)}</div>
                    </div>
                    <span style={{ fontSize:14, fontWeight:800, color:U.warn, fontVariantNumeric:'tabular-nums' }}>{n(x.faltante_neto)}</span>
                  </div>
                ))}
              </Card>
            ))}
          </div>
        )}

        {/* C · Sectores */}
        <SectionTitle>C · Sectores</SectionTitle>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:14 }}>
          {SECT.map(s => (
            <Card key={s.id}>
              <div style={{ display:'flex', alignItems:'center', gap:9, marginBottom:8 }}>
                <span style={{ width:30, height:30, borderRadius:9, background:s.color+'1f', border:`1px solid ${s.color}44`, display:'flex', alignItems:'center', justifyContent:'center' }}><Icon n={s.icon} s={16} c={s.color}/></span>
                <div><div style={{ fontSize:13, fontWeight:800 }}>{s.label}</div><div style={{ fontSize:10, color:U.inkMuted }}>{s.sub}</div></div>
              </div>
              <div style={{ fontSize:22, fontWeight:800, color:s.color, fontVariantNumeric:'tabular-nums' }}>{n(SEC[s.id])}</div>
              <div style={{ fontSize:10, color:U.inkMuted }}>registros en la jornada</div>
              {s.id === 'pino_registros' && SEC.pino_estado === 'pendiente_validacion_patas'
                ? <div style={{ marginTop:6, fontSize:9.5, fontWeight:700, color:U.warn, background:U.warn+'14', display:'inline-block', padding:'3px 7px', borderRadius:999 }}>⚠ patas pendiente de validación</div>
                : s.id === 'pino_registros'
                ? <div style={{ marginTop:6, fontSize:9.5, fontWeight:700, color:U.ok, background:U.ok+'14', display:'inline-block', padding:'3px 7px', borderRadius:999 }}>✓ operativo</div>
                : null}
            </Card>
          ))}
        </div>

        {/* D · Stock — categorías separadas, NO sumadas */}
        <SectionTitle note="categorías separadas — no se suman">D · Stock</SectionTitle>
        <div style={{ display:'flex', flexWrap:'wrap', gap:10 }}>
          <Kpi label="Pieza cruda (CNC)" val={S.canonico_pieza_cnc} color={U.accent} sub="canónico" />
          <Kpi label="Melamina terminada" val={S.canonico_melamina} color={U.accent} sub="canónico" />
          <Kpi label="Patas (Pino)" val={S.canonico_patas} color={U.accent} sub="canónico" />
          <Kpi label="Terminado" val={S.canonico_terminado} color={U.accent} sub="canónico" />
          <Kpi label="Free stock legacy" val={S.legacy_free_stock_pendiente_conciliacion} color={U.legacy} sub="pendiente de conciliación" hint="separado del canónico" />
        </div>
        {lineaVacia ? <div style={{ marginTop:10, fontSize:11.5, color:U.inkMuted, fontStyle:'italic' }}>Stock canónico en cero: la Línea Productiva aún no operó una jornada real. (La carga inicial se hace desde el preview — {n(S.carga_inicial_lotes)} lotes).</div> : null}

        {/* E · Calidad de datos */}
        <SectionTitle>E · Calidad de datos</SectionTitle>
        <div style={{ display:'flex', flexWrap:'wrap', gap:10 }}>
          <Kpi label="Recetas completas" val={Q.recetas_completa} color={U.ok} />
          <Kpi label="Receta INCOMPLETA (patas)" val={Q.recetas_incompleta_patas} color={U.warn} sub="pendiente validación Seba" />
          <Kpi label="Receta INCOMPLETA (config)" val={Q.recetas_incompleta_config} color={Q.recetas_incompleta_config ? U.danger : U.inkSoft} />
          <Kpi label="SKUs sin pool" val={Q.skus_sin_pool_desconocido} color={Q.skus_sin_pool_desconocido ? U.danger : U.inkSoft} />
        </div>

        <div style={{ marginTop:18, fontSize:10.5, color:U.inkMuted, lineHeight:1.5 }}>
          Tablero de solo lectura. No genera movimientos, no vincula jornadas ni modifica Producción. Las cifras salen de <code>prod_rpc_dashboard</code> en vivo.
        </div>
      </div>
    );
  }

  window.LineaDashboardPage = LineaDashboardPage;
})();
