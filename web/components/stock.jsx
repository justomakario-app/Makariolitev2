/* ══ STOCK CENTRAL — almacén redistribuible ══
   Página interna de la solapa "Stock" (visible solo para owner/admin/encargado).
   Dos tabs: Disponible (tabla SKUs) y Movimientos (log de auditoría).
   Bajo el capó: lee window.MOCK.freeStock para la tabla principal y
   window.MOCK_ACTIONS.loadStockMovimientos() para el log. */

function StockPage({ onBack }) {
  const M = window.useMockData();
  const toast = useToast();

  const [tab, setTab] = useState('disponible');   // 'disponible' | 'movimientos'
  const [search, setSearch] = useState('');
  const [showMover, setShowMover] = useState(false);
  const [moverContext, setMoverContext] = useState(null); // {source?, sku?} para preselect

  const stockRows = window.MOCK_ACTIONS.getStockAgregado();
  const totalStock = window.MOCK_ACTIONS.getStockTotal();

  const filtered = stockRows.filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.sku.toLowerCase().includes(q) || (r.modelo || '').toLowerCase().includes(q);
  });

  const openMoverFromRow = (sku) => {
    setMoverContext({ source: 'stock', sku });
    setShowMover(true);
  };
  const openMoverGlobal = () => {
    setMoverContext(null);
    setShowMover(true);
  };

  return (
    <div className="page">
      {/* Header */}
      <div className="page-header" style={{marginBottom:18}}>
        <div>
          <div className="page-title" style={{display:'flex', alignItems:'center', gap:10}}>
            {onBack && (
              <button className="btn-ghost" onClick={onBack} style={{padding:'6px 10px'}}>
                <Icon n="arrow-left" s={14}/> Volver
              </button>
            )}
            <span>Stock · Almacén central</span>
          </div>
          <div className="page-sub">
            {totalStock} {totalStock === 1 ? 'unidad' : 'unidades'} · {stockRows.length} {stockRows.length === 1 ? 'SKU' : 'SKUs'}
          </div>
        </div>
        <div style={{display:'flex', gap:8}}>
          <button className="btn-primary" onClick={openMoverGlobal} disabled={totalStock === 0 && stockRows.length === 0}>
            <Icon n="package" s={13}/> Mover stock
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:'flex', gap:4, borderBottom:'1px solid var(--border)', marginBottom:14}}>
        <button
          onClick={() => setTab('disponible')}
          style={{
            padding:'10px 16px', border:'none', background:'transparent',
            borderBottom: tab==='disponible' ? '2px solid var(--ink)' : '2px solid transparent',
            fontSize:12, fontWeight:700, color: tab==='disponible'?'var(--ink)':'var(--ink-muted)',
            cursor:'pointer', textTransform:'uppercase', letterSpacing:'.08em',
          }}>
          Disponible ({stockRows.length})
        </button>
        <button
          onClick={() => setTab('movimientos')}
          style={{
            padding:'10px 16px', border:'none', background:'transparent',
            borderBottom: tab==='movimientos' ? '2px solid var(--ink)' : '2px solid transparent',
            fontSize:12, fontWeight:700, color: tab==='movimientos'?'var(--ink)':'var(--ink-muted)',
            cursor:'pointer', textTransform:'uppercase', letterSpacing:'.08em',
          }}>
          Movimientos
        </button>
      </div>

      {tab === 'disponible' ? (
        <StockDisponibleTab rows={filtered} search={search} onSearch={setSearch} onMover={openMoverFromRow} totalRaw={stockRows.length}/>
      ) : (
        <StockMovimientosTab/>
      )}

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

/* Tab 1: tabla por SKU con cantidad disponible + botón Mover. */
function StockDisponibleTab({ rows, search, onSearch, onMover, totalRaw }) {
  if (totalRaw === 0) {
    return (
      <div className="empty" style={{padding:'40px 20px'}}>
        <Icon n="package" s={32} c="var(--ink-faint)"/>
        <div style={{fontSize:13, fontWeight:700, marginTop:10}}>No hay stock acumulado todavía</div>
        <div style={{fontSize:12, color:'var(--ink-muted)', marginTop:6, maxWidth:380}}>
          Cuando se cierre una jornada con sobrante, el excedente va a entrar acá automáticamente.
          También podés enviar stock manual desde cualquier canal.
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={{position:'relative', marginBottom:12, maxWidth:360}}>
        <input
          className="field-input"
          placeholder="Buscar por SKU o modelo…"
          value={search}
          onChange={e => onSearch(e.target.value)}
          style={{paddingLeft:32}}
        />
        <span style={{position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', pointerEvents:'none'}}>
          <Icon n="search" s={14} c="var(--ink-muted)"/>
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="empty" style={{padding:'30px 20px', fontSize:12, color:'var(--ink-muted)'}}>
          Sin resultados para "{search}"
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Modelo</th>
              <th>Color</th>
              <th style={{textAlign:'right'}}>Disponible</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.sku}>
                <td><span className="order-num">{r.sku}</span></td>
                <td style={{fontWeight:600, fontSize:13}}>{r.modelo}</td>
                <td style={{fontSize:11, color:'var(--ink-soft)'}}>
                  {r.color && r.color !== '—' ? (
                    <span style={{display:'inline-flex', alignItems:'center', gap:5}}>
                      <span style={{width:8, height:8, borderRadius:'50%',
                        background: r.colorHex || (r.color==='Negro'?'#1a1a1a':r.color==='Blanco'?'#fff':'#888'),
                        border:'1px solid #d4cdc1', display:'inline-block'}}/>
                      {r.color}
                    </span>
                  ) : <span style={{color:'var(--ink-faint)'}}>—</span>}
                </td>
                <td style={{textAlign:'right'}}>
                  <span className="cell-color-num" style={{color:'#7c3aed', fontWeight:700}}>
                    {r.cantidad}
                  </span>
                </td>
                <td style={{textAlign:'right', width:1, whiteSpace:'nowrap'}}>
                  <button className="btn-ghost" style={{padding:'5px 10px', fontSize:10}}
                    onClick={() => onMover(r.sku)}>
                    <Icon n="arrow-right" s={11}/> Mover
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/* Tab 2: log de movimientos con 4 filtros (fecha, usuario, SKU, tipo). */
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

  // Deduplicar pares transfer_out + transfer_in (mismo movimiento, dos logs)
  // Mostramos solo el OUT — el IN se filtra para no duplicar visualmente.
  const visibles = filtered.filter(m => m.tipo !== 'transfer_in');

  return (
    <>
      {/* Filtros */}
      <div style={{display:'flex', gap:8, marginBottom:14, flexWrap:'wrap'}}>
        <select className="field-input" style={{maxWidth:160}}
          value={filters.fecha} onChange={e => setFilters({...filters, fecha:e.target.value})}>
          <option value="">Todas las fechas</option>
          {fechas.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select className="field-input" style={{maxWidth:160}}
          value={filters.usuario} onChange={e => setFilters({...filters, usuario:e.target.value})}>
          <option value="">Todos los usuarios</option>
          {usuarios.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
        <select className="field-input" style={{maxWidth:140}}
          value={filters.sku} onChange={e => setFilters({...filters, sku:e.target.value})}>
          <option value="">Todos los SKUs</option>
          {skus.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="field-input" style={{maxWidth:200}}
          value={filters.tipo} onChange={e => setFilters({...filters, tipo:e.target.value})}>
          <option value="">Todos los tipos</option>
          <option value="canal_a_stock">Canal → Stock (manual)</option>
          <option value="stock_a_canal">Stock → Canal</option>
          <option value="auto_cierre_a_stock">Auto cierre → Stock</option>
          <option value="transfer_out">Transferencia entre canales</option>
        </select>
      </div>

      {loading ? (
        <div className="empty" style={{padding:'30px 20px'}}>
          <span className="loader"/> Cargando movimientos…
        </div>
      ) : visibles.length === 0 ? (
        <div className="empty" style={{padding:'40px 20px'}}>
          <Icon n="history" s={28} c="var(--ink-faint)"/>
          <div style={{fontSize:12, color:'var(--ink-muted)', marginTop:8}}>
            {movs.length === 0 ? 'Todavía no hay movimientos registrados.' : 'No hay movimientos con esos filtros.'}
          </div>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Fecha/Hora</th>
              <th>Usuario</th>
              <th>De → Hacia</th>
              <th>SKU</th>
              <th style={{textAlign:'right'}}>Cant.</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map(m => (
              <tr key={m.id}>
                <td style={{fontSize:11, color:'var(--ink-muted)', fontFamily:'var(--mono)'}}>
                  {m.fecha} {m.hora}
                </td>
                <td style={{fontSize:11, fontWeight:600}}>{m.operario}</td>
                <td style={{fontSize:11}}>{renderDeHacia(m)}</td>
                <td><span className="order-num">{m.sku}</span></td>
                <td style={{textAlign:'right'}}>
                  <span className="cell-color-num">{Math.abs(m.cantidad)}</span>
                </td>
                <td style={{fontSize:11, color:'var(--ink-soft)', fontStyle: m.motivo ? 'normal' : 'italic'}}>
                  {m.motivo || (m.tipo === 'auto_cierre_a_stock' ? 'Auto al cerrar jornada' : '—')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

window.StockPage = StockPage;
