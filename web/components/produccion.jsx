/* ══ PRODUCCIÓN UNIFICADA — TABS POR CANAL, TODO POR SKU ══ */

function ProduccionPage() {
  const M = window.useMockData();
  const data = M.prod.todos;
  const [tabCanal, setTabCanal] = useState('todos');
  const [show, setShow] = useState(false);

  const total   = data.kpis.totalPedido;
  const done    = data.kpis.producido;
  const pct     = Math.round((done / total) * 100);
  const barColor = pct >= 80 ? 'var(--green)' : pct >= 50 ? '#6366f1' : pct >= 30 ? 'var(--amber)' : 'var(--red)';

  let rows = data.table;
  if (tabCanal !== 'todos') {
    const map = { colecta:'Colecta', flex:'Flex', tiendanube:'Tienda Nube', distribuidor:'Distribuidor' };
    rows = rows.filter(r => r.canal === map[tabCanal]);
  }

  const todayLogs = M.prodLogs.filter(l => l.fecha === '2026-04-25');

  return (
    <div style={{background:'var(--paper-off)', minHeight:'100vh'}}>
      <div className="prod-header">
        <div className="prod-progress-bar">
          <div className="prod-progress-fill" style={{width: `${pct}%`, background: barColor}}/>
        </div>
        <div className="prod-header-inner">
          <div>
            <div style={{fontSize:18, fontWeight:800, letterSpacing:'-.02em'}}>Producción</div>
            <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:2, fontWeight:600}}>
              {done} de {total} unidades · {data.producidoHoy} producidas hoy
            </div>
          </div>
          <div style={{display:'flex', alignItems:'center', gap:14}}>
            <div style={{textAlign:'right'}}>
              <div style={{fontFamily:'var(--mono)', fontSize:18, fontWeight:700, color:'var(--ink)'}}>
                {done}/{total}
              </div>
              <div className="prod-progress-label">{pct}% completado</div>
            </div>
            <button className="btn-primary" onClick={() => setShow(true)}>
              <Icon n="plus" s={13}/> Registrar producción
            </button>
          </div>
        </div>
        <div className="prod-tabs-row">
          <button className={`prod-tab ${tabCanal==='todos'?'active-todos':''}`} onClick={() => setTabCanal('todos')}>
            Todos los canales
          </button>
          <button className={`prod-tab ${tabCanal==='colecta'?'active-todos':''}`} onClick={() => setTabCanal('colecta')}>
            <span style={{width:6, height:6, borderRadius:'50%', background:'#6366f1', display:'inline-block', marginRight:6, verticalAlign:'middle'}}/>
            Colecta
          </button>
          <button className={`prod-tab ${tabCanal==='flex'?'active-todos':''}`} onClick={() => setTabCanal('flex')}>
            <span style={{width:6, height:6, borderRadius:'50%', background:'#15803d', display:'inline-block', marginRight:6, verticalAlign:'middle'}}/>
            Flex
          </button>
          <button className={`prod-tab ${tabCanal==='tiendanube'?'active-todos':''}`} onClick={() => setTabCanal('tiendanube')}>
            <span style={{width:6, height:6, borderRadius:'50%', background:'#2563eb', display:'inline-block', marginRight:6, verticalAlign:'middle'}}/>
            Tienda Nube
          </button>
          <button className={`prod-tab ${tabCanal==='distribuidor'?'active-todos':''}`} onClick={() => setTabCanal('distribuidor')}>
            <span style={{width:6, height:6, borderRadius:'50%', background:'#d97706', display:'inline-block', marginRight:6, verticalAlign:'middle'}}/>
            Distribuidores
          </button>
        </div>
      </div>

      <div style={{padding:'20px 40px 48px'}}>
        {/* KPIs */}
        <div className="kpi-grid" style={{marginBottom:18}}>
          <div className="stat-card" style={{borderLeft:'3px solid var(--red)'}}>
            <div style={{fontSize:9, fontWeight:700, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--ink-muted)', marginBottom:6}}>Faltante total</div>
            <div style={{fontFamily:'var(--mono)', fontSize:32, fontWeight:700, letterSpacing:'-.04em', color:'var(--red)', lineHeight:1}}>{data.kpis.faltante}</div>
            <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:6, fontWeight:500}}>uds. por fabricar</div>
          </div>
          <div className="stat-card" style={{borderLeft:'3px solid var(--green)'}}>
            <div style={{fontSize:9, fontWeight:700, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--ink-muted)', marginBottom:6}}>Producido</div>
            <div style={{fontFamily:'var(--mono)', fontSize:32, fontWeight:700, letterSpacing:'-.04em', color:'var(--green)', lineHeight:1}}>{data.kpis.producido}</div>
            <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:6, fontWeight:500}}>uds. completadas</div>
          </div>
          <div className="stat-card" style={{borderLeft:'3px solid var(--ink)'}}>
            <div style={{fontSize:9, fontWeight:700, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--ink-muted)', marginBottom:6}}>Pedido total</div>
            <div style={{fontFamily:'var(--mono)', fontSize:32, fontWeight:700, letterSpacing:'-.04em', lineHeight:1}}>{data.kpis.totalPedido}</div>
            <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:6, fontWeight:500}}>uds. solicitadas</div>
          </div>
          <div className="stat-card">
            <div style={{fontSize:9, fontWeight:700, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--ink-muted)', marginBottom:6}}>Hoy</div>
            <div style={{fontFamily:'var(--mono)', fontSize:32, fontWeight:700, letterSpacing:'-.04em', lineHeight:1}}>{data.producidoHoy}</div>
            <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:6, fontWeight:500}}>uds. registradas</div>
          </div>
        </div>

        {/* Tabla SKU × Canal */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              {tabCanal === 'todos' ? 'Producción pendiente · todos los canales' : `Producción pendiente · ${tabCanal}`}
            </div>
            <div style={{fontSize:11, color:'var(--ink-muted)', fontWeight:600}}>{rows.length} líneas</div>
          </div>
          {rows.length === 0 ? (
            <div className="empty">
              <Icon n="check-circle" s={28} c="var(--green)"/>
              <div style={{fontSize:13, fontWeight:700}}>Sin producción pendiente en este canal</div>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Producto</th>
                  <th>Canal</th>
                  <th style={{textAlign:'right'}}>Pedido</th>
                  <th style={{textAlign:'right'}}>Producido</th>
                  <th style={{textAlign:'right'}}>Faltante</th>
                  <th style={{textAlign:'right'}} title="Excedente acumulado disponible para próximos pedidos">Stock</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const C = window.CARRIERS[r.canal.toLowerCase().replace(' ','')] || { color: '#888' };
                  const info = window.SKU_DB[r.sku] || {};
                  return (
                    <tr key={`${r.sku}-${r.canal}-${i}`}>
                      <td><span className="order-num">{r.sku}</span></td>
                      <td>
                        <div style={{fontWeight:600, color:'var(--ink)', fontSize:12}}>{info.modelo || r.sku}</div>
                        {info.color && info.color !== '—' && (
                          <div style={{fontSize:10, color:'var(--ink-muted)', marginTop:1, display:'flex', alignItems:'center', gap:5}}>
                            <span style={{width:7, height:7, borderRadius:'50%', background: info.color==='Negro'?'#1a1a1a':'#fff', border:'1px solid #d4cdc1', display:'inline-block'}}/>
                            {info.color}
                          </div>
                        )}
                      </td>
                      <td>
                        <span style={{
                          display:'inline-flex', alignItems:'center', gap:6,
                          padding:'3px 9px', borderRadius:10,
                          background:`${C.color}1a`, color:C.color,
                          fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em'
                        }}>
                          <span style={{width:5, height:5, borderRadius:'50%', background:C.color}}/>
                          {r.canal}
                        </span>
                      </td>
                      <td style={{textAlign:'right'}}><span className="cell-color-num">{r.pedido}</span></td>
                      <td style={{textAlign:'right'}}><span className="cell-color-num" style={{color: r.producido>=r.pedido ? 'var(--green)' : 'var(--ink-soft)'}}>{r.producido}</span></td>
                      <td style={{textAlign:'right'}}>
                        {r.faltante > 0
                          ? <span className="cell-faltante-red">{r.faltante}</span>
                          : <span className="cell-faltante-ok"><Icon n="check" s={14}/></span>}
                      </td>
                      <td style={{textAlign:'right'}}>
                        {r.stock > 0
                          ? <span className="cell-stock-pos" title="Excedente disponible">+{r.stock}</span>
                          : <span style={{fontFamily:'var(--mono)', fontSize:11, color:'var(--ink-faint)'}}>—</span>}
                      </td>
                      <td style={{textAlign:'right', width:1}}>
                        <button className="btn-ghost" style={{padding:'5px 10px', fontSize:10}} onClick={() => setShow(true)} disabled={r.faltante<=0}>
                          <Icon n="plus" s={11}/> Cargar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Recientes */}
        <div className="card" style={{marginTop:14}}>
          <div className="card-header">
            <div className="card-title">Producción registrada hoy</div>
            <div style={{fontSize:11, color:'var(--ink-muted)', fontWeight:600}}>{todayLogs.length} registros</div>
          </div>
          {todayLogs.length === 0 ? (
            <div className="empty">
              <Icon n="package" s={26} c="var(--ink-faint)"/>
              <div style={{fontSize:12, color:'var(--ink-muted)'}}>No hay registros para hoy. Registrá tu primera producción.</div>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr><th>Hora</th><th>SKU</th><th>Producto</th><th>Canal</th><th>Sector</th><th style={{textAlign:'right'}}>Uds.</th><th>Operario</th></tr>
              </thead>
              <tbody>
                {todayLogs.map(l => {
                  const info = window.SKU_DB[l.sku] || {};
                  return (
                    <tr key={l.id}>
                      <td style={{fontSize:11, color:'var(--ink-muted)', fontFamily:'var(--mono)'}}>{l.hora}</td>
                      <td><span className="order-num">{l.sku}</span></td>
                      <td>
                        <div style={{fontWeight:600, fontSize:12}}>{info.modelo || l.sku}</div>
                        {info.color && info.color !== '—' && (
                          <div style={{fontSize:10, color:'var(--ink-muted)', marginTop:1}}>{info.color}</div>
                        )}
                      </td>
                      <td style={{fontSize:11, textTransform:'capitalize'}}>{l.subcanal}</td>
                      <td style={{fontSize:11, color:'var(--ink-soft)'}}>{l.sector}</td>
                      <td style={{textAlign:'right'}}><span className="cell-color-num">{l.unidades}</span></td>
                      <td style={{fontSize:11, color:'var(--ink-soft)'}}>{l.operario}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <ProduceModal open={show} onClose={() => setShow(false)}/>
    </div>
  );
}

window.ProduccionPage = ProduccionPage;
