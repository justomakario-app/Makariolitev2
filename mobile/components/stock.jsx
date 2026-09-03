/* ══ STOCK CENTRAL MOBILE — cards verticales ══
   Paridad funcional con web/stock.jsx pero UI en cards en lugar de
   tabla para acomodar layout vertical de mobile. */

function StockPage({ onBack }) {
  const M = window.useMockData();
  const toast = useToast();

  const [tab, setTab] = useState('disponible');
  const [search, setSearch] = useState('');
  const [showMover, setShowMover] = useState(false);
  const [moverContext, setMoverContext] = useState(null);

  const stockRows = window.MOCK_ACTIONS.getStockAgregado();
  const totalStock = window.MOCK_ACTIONS.getStockTotal();

  /* buscaEn (data.js): sin tildes y palabra por palabra. */
  const filtered = stockRows.filter(r => window.buscaEn(search, r.sku, r.modelo));

  const openMoverFromRow = (sku) => {
    setMoverContext({ source: 'stock', sku });
    setShowMover(true);
  };
  const openMoverGlobal = () => {
    setMoverContext(null);
    setShowMover(true);
  };

  return (
    <div className="m-page">
      {/* Header */}
      <div style={{padding:'14px 16px', background:'var(--paper)', borderBottom:'1px solid var(--border)'}}>
        {onBack && (
          <button className="btn-ghost" onClick={onBack} style={{padding:'4px 0', marginBottom:8, fontSize:12, background:'none', border:'none', color:'var(--ink-soft)', cursor:'pointer'}}>
            <Icon n="arrow-left" s={13}/> Volver
          </button>
        )}
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:10}}>
          <div>
            <div style={{fontSize:16, fontWeight:800}}>Stock</div>
            <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:2}}>
              {totalStock} {totalStock === 1 ? 'unidad' : 'unidades'} · {stockRows.length} {stockRows.length === 1 ? 'SKU' : 'SKUs'}
            </div>
          </div>
          <button className="btn-primary" style={{padding:'8px 14px', fontSize:11}}
            onClick={openMoverGlobal} disabled={totalStock === 0 && stockRows.length === 0}>
            <Icon n="package" s={12}/> Mover
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:'flex', borderBottom:'1px solid var(--border)', background:'var(--paper)'}}>
        <button
          onClick={() => setTab('disponible')}
          style={{
            flex:1, padding:'12px 8px', border:'none', background:'transparent',
            borderBottom: tab==='disponible' ? '2px solid var(--ink)' : '2px solid transparent',
            fontSize:11, fontWeight:700,
            color: tab==='disponible'?'var(--ink)':'var(--ink-muted)',
            cursor:'pointer', textTransform:'uppercase', letterSpacing:'.08em',
          }}>
          Disponible ({stockRows.length})
        </button>
        <button
          onClick={() => setTab('movimientos')}
          style={{
            flex:1, padding:'12px 8px', border:'none', background:'transparent',
            borderBottom: tab==='movimientos' ? '2px solid var(--ink)' : '2px solid transparent',
            fontSize:11, fontWeight:700,
            color: tab==='movimientos'?'var(--ink)':'var(--ink-muted)',
            cursor:'pointer', textTransform:'uppercase', letterSpacing:'.08em',
          }}>
          Movimientos
        </button>
      </div>

      <div style={{padding:'12px 16px 90px'}}>
        {tab === 'disponible' ? (
          <StockDisponibleTab rows={filtered} search={search} onSearch={setSearch} onMover={openMoverFromRow} totalRaw={stockRows.length}/>
        ) : (
          <StockMovimientosTab/>
        )}
      </div>

      {showMover && window.StockMovementModal && (
        <window.StockMovementModal
          open={true}
          onClose={() => setShowMover(false)}
          context={moverContext}
          onMoved={() => { setShowMover(false); toast.success('Movimiento registrado'); }}
        />
      )}
    </div>
  );
}

/* Tab 1: cards verticales con SKU+disponible+botón Mover. */
function StockDisponibleTab({ rows, search, onSearch, onMover, totalRaw }) {
  if (totalRaw === 0) {
    return (
      <div style={{padding:'40px 20px', textAlign:'center'}}>
        <Icon n="package" s={28} c="var(--ink-faint)"/>
        <div style={{fontSize:13, fontWeight:700, marginTop:10}}>No hay stock todavía</div>
        <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:6}}>
          Cuando se cierre una jornada con sobrante, va a aparecer acá.
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={{position:'relative', marginBottom:12}}>
        <input className="field-input" placeholder="Buscar…" value={search}
          onChange={e => onSearch(e.target.value)} style={{paddingLeft:32}}/>
        <span style={{position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', pointerEvents:'none'}}>
          <Icon n="search" s={13} c="var(--ink-muted)"/>
        </span>
      </div>

      {rows.length === 0 ? (
        <div style={{padding:'30px 20px', fontSize:11, color:'var(--ink-muted)', textAlign:'center'}}>
          Sin resultados para "{search}"
        </div>
      ) : (
        <div style={{display:'flex', flexDirection:'column', gap:8}}>
          {rows.map(r => (
            <div key={r.sku} className="m-card" style={{padding:'12px 14px'}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10}}>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:3}}>
                    <span style={{fontFamily:'var(--mono)', fontWeight:700, fontSize:12}}>{r.sku}</span>
                    {r.color && r.color !== '—' && (
                      <span style={{fontSize:9, padding:'2px 6px', borderRadius:5, background:'var(--paper-off)', color:'var(--ink-muted)'}}>
                        {r.color}
                      </span>
                    )}
                  </div>
                  <div style={{fontSize:12, color:'var(--ink-soft)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                    {r.modelo}
                  </div>
                </div>
                <div style={{textAlign:'right', flexShrink:0}}>
                  <div style={{fontFamily:'var(--mono)', fontSize:20, fontWeight:800, color:'#7c3aed', lineHeight:1}}>
                    {r.cantidad}
                  </div>
                  <div style={{fontSize:9, color:'var(--ink-muted)', textTransform:'uppercase', letterSpacing:'.08em', marginTop:2}}>
                    disponible
                  </div>
                </div>
              </div>
              <button className="btn-primary" style={{marginTop:10, width:'100%', padding:'8px', fontSize:11}}
                onClick={() => onMover(r.sku)}>
                <Icon n="arrow-right" s={11}/> Mover
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* Tab 2: lista vertical de movimientos. Filtros más compactos (3 selects). */
function StockMovimientosTab() {
  const [movs, setMovs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ fecha:'', usuario:'', sku:'', tipo:'' });

  const cargar = async () => {
    setLoading(true);
    try {
      const data = await window.MOCK_ACTIONS.loadStockMovimientos({ limit: 200 });
      setMovs(data);
    } catch (e) { console.error(e); }
    setLoading(false);
  };
  useEffect(() => { cargar(); }, []);
  useEffect(() => window.MOCK_BUS.subscribe(cargar), []);

  const fechas   = [...new Set(movs.map(m => m.fecha))].sort().reverse();
  const usuarios = [...new Set(movs.map(m => m.operario))].sort();
  const skus     = [...new Set(movs.map(m => m.sku))].sort();

  const filtered = movs.filter(m =>
    (!filters.fecha   || m.fecha === filters.fecha) &&
    (!filters.usuario || m.operario === filters.usuario) &&
    (!filters.sku     || m.sku === filters.sku) &&
    (!filters.tipo    || m.tipo === filters.tipo)
  );

  const channelLabel = (id) => window.CARRIERS[id]?.label || id;
  const renderDeHacia = (m) => {
    switch (m.tipo) {
      case 'canal_a_stock':       return `${channelLabel(m.channel_id)} → Stock`;
      case 'stock_a_canal':       return `Stock → ${channelLabel(m.channel_id)}`;
      case 'auto_cierre_a_stock': return `${channelLabel(m.channel_id)} → Stock`;
      case 'transfer_out':        return `${channelLabel(m.channel_id)} → ${channelLabel(m.contraparte)}`;
      case 'transfer_in':         return `${channelLabel(m.contraparte)} → ${channelLabel(m.channel_id)}`;
      default: return m.channel_id;
    }
  };

  const visibles = filtered.filter(m => m.tipo !== 'transfer_in');

  return (
    <>
      <div style={{display:'flex', gap:6, marginBottom:12, flexWrap:'wrap'}}>
        <select className="field-input" style={{fontSize:11, padding:'7px 8px', flex:1, minWidth:120}}
          value={filters.fecha} onChange={e => setFilters({...filters, fecha:e.target.value})}>
          <option value="">Todas fechas</option>
          {fechas.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select className="field-input" style={{fontSize:11, padding:'7px 8px', flex:1, minWidth:110}}
          value={filters.usuario} onChange={e => setFilters({...filters, usuario:e.target.value})}>
          <option value="">Todos usuarios</option>
          {usuarios.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
        <select className="field-input" style={{fontSize:11, padding:'7px 8px', flex:1, minWidth:110}}
          value={filters.sku} onChange={e => setFilters({...filters, sku:e.target.value})}>
          <option value="">Todos SKUs</option>
          {skus.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="field-input" style={{fontSize:11, padding:'7px 8px', flex:1, minWidth:140}}
          value={filters.tipo} onChange={e => setFilters({...filters, tipo:e.target.value})}>
          <option value="">Todos tipos</option>
          <option value="canal_a_stock">Canal → Stock</option>
          <option value="stock_a_canal">Stock → Canal</option>
          <option value="auto_cierre_a_stock">Auto cierre</option>
          <option value="transfer_out">Transfer entre canales</option>
        </select>
      </div>

      {loading ? (
        <div style={{padding:'30px 20px', textAlign:'center'}}>
          <span className="loader"/> <span style={{fontSize:11, color:'var(--ink-muted)'}}>Cargando…</span>
        </div>
      ) : visibles.length === 0 ? (
        <div style={{padding:'40px 20px', textAlign:'center'}}>
          <Icon n="history" s={26} c="var(--ink-faint)"/>
          <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:8}}>
            {movs.length === 0 ? 'Todavía no hay movimientos.' : 'No hay movimientos con esos filtros.'}
          </div>
        </div>
      ) : (
        <div style={{display:'flex', flexDirection:'column', gap:8}}>
          {visibles.map(m => (
            <div key={m.id} className="m-card" style={{padding:'10px 12px'}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4}}>
                <span style={{fontSize:10, color:'var(--ink-muted)', fontFamily:'var(--mono)'}}>
                  {m.fecha} {m.hora}
                </span>
                <span style={{fontFamily:'var(--mono)', fontWeight:800, fontSize:14}}>
                  {Math.abs(m.cantidad)}×{m.sku}
                </span>
              </div>
              <div style={{fontSize:11, fontWeight:700, marginBottom:2}}>
                {renderDeHacia(m)}
              </div>
              <div style={{fontSize:10, color:'var(--ink-soft)'}}>
                {m.operario}{m.motivo ? ` · ${m.motivo}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

window.StockPage = StockPage;
