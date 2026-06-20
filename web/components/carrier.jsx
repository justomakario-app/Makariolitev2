/* ══ CARRIER PAGE — Colecta / Flex / Tienda Nube / Distribuidor ══ */

function FaltanteBadge({ value }) {
  if (value > 0)  return <span className="cell-faltante-red">{value}</span>;
  if (value < 0)  return <span className="cell-faltante-over">+{Math.abs(value)}</span>;
  return <span className="cell-faltante-ok"><Icon n="check" s={14}/></span>;
}

function CarrierPage({ channel, onBack, onNav }) {
  const M = window.useMockData();
  const C = window.CARRIERS[channel];
  const data = M.carriers[channel];
  const toast = useToast();

  const [showProduce, setShowProduce] = useState(false);
  const [produceCtx, setProduceCtx]   = useState({}); // { sku, subcanal }
  const [showImport, setShowImport]   = useState(false);
  // Cambio 2B: el cierre de jornada vive en el dashboard (botón global).
  // CarrierPage solo lee la jornada seleccionada y muestra los números de
  // ese día por canal. Sin botones de Abrir/Cerrar/marcar activa.
  const [openOrders, setOpenOrders]   = useState(false);
  const [openLotes, setOpenLotes]     = useState(false);
  const [openCierres, setOpenCierres] = useState(false);
  const [openCancel, setOpenCancel]   = useState(false);  // sección Canceladas (informativo)
  const [openReprog, setOpenReprog]   = useState(false);  // sección Reprogramadas (informativo)
  const [loteAEliminar, setLoteAEliminar] = useState(null);  // lote pendiente de borrar
  const [borrando, setBorrando] = useState(false);
  // Carga manual + edición (feature flag protege visibilidad)
  const [showManualOrder, setShowManualOrder] = useState(false);
  const [editingOrder, setEditingOrder]       = useState(null); // string order_number
  const [historyOrder, setHistoryOrder]       = useState(null); // string order_number
  // Mover stock (Cambio 1 Step 5): admin/encargado/owner puede abrir el
  // StockMovementModal desde una fila SKU. Contexto preselecciona source=canal+sku.
  const [showStockMover, setShowStockMover] = useState(false);
  const [stockMoverCtx, setStockMoverCtx]   = useState(null);
  const featurePedidos = !!window.FEATURE_PEDIDOS_MANUALES && channel !== 'distribuidor';

  const userRole = window.MOCK.user.role;
  const puedeEliminarLote = ['owner','admin','encargado'].includes(userRole);
  const puedeMoverStock = puedeEliminarLote;  // mismo set de roles

  // Estados informativos del canal (spec ML): canceladas (ya existen) +
  // reprogramadas (Fase B). Filtrados a ESTE canal en la jornada seleccionada.
  const selJornadaId = M.jornadas?.seleccionadaId || M.jornadas?.activaId || null;
  const cancelChannel = (selJornadaId && window.getCancellationsForJornada)
    ? window.getCancellationsForJornada(selJornadaId).filter(c => c.canal === channel) : [];
  const reprogChannel = (selJornadaId && window.getReprogramadasForJornada)
    ? window.getReprogramadasForJornada(selJornadaId).filter(c => c.canal === channel) : [];
  const exportEstado = (rows, tipo) => {
    if (!window.XLSX || !rows || !rows.length) return;
    const aoa = [['# venta', 'SKU', 'Producto', 'Cantidad', tipo === 'cancel' ? 'Motivo' : 'Reprogramada']];
    rows.forEach(r => aoa.push([r.numero, r.sku, r.modelo, r.cantidad, tipo === 'cancel' ? (r.motivo || '') : (r.reprogramadaAt || '')]));
    const ws = window.XLSX.utils.aoa_to_sheet(aoa);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, tipo === 'cancel' ? 'Canceladas' : 'Reprogramadas');
    window.XLSX.writeFile(wb, `${tipo === 'cancel' ? 'canceladas' : 'reprogramadas'}-${channel}.xlsx`);
  };

  if (!data) return null;

  const empty = data.kpis.activos === 0 && data.table.length === 0;
  const esHorario = C.tipo_cierre === 'horario';
  const cierreHora = C.cierreHora;

  /* Countdown hasta cierre (Colecta/Flex) */
  const ahora = new Date();
  let countdown = null, vencida = false;
  if (esHorario && cierreHora) {
    const [h,m] = cierreHora.split(':').map(Number);
    const cierre = new Date(ahora); cierre.setHours(h,m,0,0);
    const diff = cierre - ahora;
    if (diff > 0) {
      const hh = Math.floor(diff/3600000);
      const mm = Math.floor((diff%3600000)/60000);
      countdown = `${hh}h ${mm}m`;
    } else { vencida = true; }
  }

  return (
    <div style={{background:'var(--paper-off)', minHeight:'100vh'}}>
      <div className="carrier-header" style={{borderTop:`3px solid ${C.color}`}}>
        <button className="carrier-back" onClick={onBack}>
          <Icon n="arrow-left" s={14}/> Dashboard
        </button>
        <div style={{flex:1, display:'flex', alignItems:'center', gap:14, minWidth:0}}>
          <div style={{width:36, height:36, background:C.bg, color:C.color, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:8, flexShrink:0}}>
            <Icon n={({colecta:'truck', flex:'package', tiendanube:'box', distribuidor:'users', no_flex:'package-check', correo_argentino:'send'})[channel] || 'box'} s={18}/>
          </div>
          <div style={{minWidth:0}}>
            <div className="carrier-title">{C.label}</div>
            <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:2, fontWeight:600}}>
              {C.sub} · Último cierre: {data.lastClosure ? fmt.dateTime(data.lastClosure) : '—'}
            </div>
          </div>
        </div>
        <div className="carrier-actions">
          <button className="btn-ghost" onClick={() => setShowImport(true)}>
            <Icon n="upload" s={13}/> Importar Excel
          </button>
          <button className="btn-ghost" onClick={() => {
            // Exporta XLSX con lo que falta producir en este canal.
            // Para mandar por WhatsApp al sector de producción.
            const filas = (data.table || [])
              .filter(r => (r.faltante || 0) > 0)
              .map(r => {
                const info = window.SKU_DB[r.sku] || {};
                const modeloFull = info.color && info.color !== '—'
                  ? `${info.modelo || r.sku} ${info.color}`
                  : (info.modelo || r.sku);
                return { SKU: r.sku, Modelo: modeloFull, Cantidad: r.faltante };
              });
            if (!filas.length) {
              toast.info('Nada para exportar — todos los pedidos están al día');
              return;
            }
            if (typeof window.XLSX === 'undefined') {
              toast.error('Librería de Excel todavía no cargó · reintentá en un segundo');
              return;
            }
            const ws = window.XLSX.utils.json_to_sheet(filas);
            ws['!cols'] = [{ wch: 12 }, { wch: 48 }, { wch: 12 }];
            const wb = window.XLSX.utils.book_new();
            window.XLSX.utils.book_append_sheet(wb, ws, (C.label || 'Pendiente').slice(0, 31));
            const fecha = new Date().toISOString().slice(0, 10);
            window.XLSX.writeFile(wb, `produccion-${channel}-${fecha}.xlsx`);
            toast.success(`Excel exportado · ${filas.length} SKU${filas.length===1?'':'s'}`);
          }}>
            <Icon n="download" s={13}/> Exportar
          </button>
          {/* Cargar pedido manual — solo bajo feature flag, admin/encargado, no distribuidor */}
          {featurePedidos && ['owner','admin','encargado'].includes(userRole) && (
            <button className="btn-ghost" onClick={() => setShowManualOrder(true)}>
              <Icon n="plus" s={13}/> Cargar pedido manual
            </button>
          )}
          <button className="btn-primary" onClick={() => { setProduceCtx({ subcanal: channel }); setShowProduce(true); }}>
            <Icon n="plus" s={13}/> Producir
          </button>
        </div>
      </div>

      {/* Chip de jornada — read-only desde Cambio 2B (jornadas son globales).
          La selección, apertura y cierre viven en el Dashboard. */}
      {(() => {
        const abiertas = M.jornadas?.abiertas || [];
        const activaId = M.jornadas?.activaId;
        const selId    = M.jornadas?.seleccionadaId;
        if (abiertas.length === 0) {
          return (
            <div className="carrier-banner" style={{background:'#fff3e0', borderColor:'rgba(217,119,6,.32)', color:'#92400e', cursor:'pointer'}} onClick={() => onNav?.('dashboard')}>
              <Icon n="alert" s={16}/>
              <span>Sin jornada abierta. Abrí una desde el Dashboard.</span>
            </div>
          );
        }
        const seleccionada = abiertas.find(j => j.id === selId) || abiertas.find(j => j.id === activaId) || abiertas[0];
        const esActiva = seleccionada.id === activaId;
        return (
          <div
            onClick={() => onNav?.('dashboard')}
            style={{padding:'10px 24px', borderBottom:'1px solid var(--border)', background:'#fff', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', cursor:'pointer'}}
            title="Volver al dashboard para cambiar de jornada"
          >
            <div style={{fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.08em', color:'var(--ink-muted)'}}>
              Viendo jornada
            </div>
            <div style={{fontSize:13, fontWeight:700}}>
              {fmt.date(seleccionada.fecha)}
              <span style={{marginLeft:8, fontSize:10, color: esActiva ? 'var(--green)' : 'var(--ink-muted)', fontWeight:600}}>
                {esActiva ? '· activa' : '· no es la activa'}
              </span>
            </div>
            <span style={{fontSize:11, color:'var(--ink-muted)', marginLeft:'auto'}}>
              {abiertas.length} jornada{abiertas.length===1?'':'s'} abierta{abiertas.length===1?'':'s'}
            </span>
          </div>
        );
      })()}

      {data.allDone && data.kpis.activos === 0 ? (
        <div className="carrier-banner green">
          <Icon n="check-circle" s={16}/>
          <span>Todos los pedidos de este canal están al día. Sin faltante para producir.</span>
        </div>
      ) : esHorario && vencida ? (
        <div className="carrier-banner" style={{background:'var(--red-bg)', borderColor:'rgba(220,38,38,.32)', color:'var(--red)'}}>
          <Icon n="alert" s={16}/>
          <span><strong>Jornada vencida</strong> — la hora de cierre era <strong>{cierreHora}</strong>. Cerrá ahora para archivar y arrastrar el faltante.</span>
        </div>
      ) : esHorario && countdown ? (
        <div className="carrier-banner" style={{background:'#fff8e6', borderColor:'rgba(217,119,6,.32)', color:'#92400e'}}>
          <Icon n="clock" s={16}/>
          <span>La jornada cierra hoy a las <strong>{cierreHora}</strong> — quedan <strong>{countdown}</strong>. Pendiente: <strong>{data.kpis.pendiente} uds.</strong></span>
        </div>
      ) : !esHorario ? (
        <div className="carrier-banner" style={{background:'var(--paper-off)', borderColor:'var(--border)', color:'var(--ink-soft)'}}>
          <Icon n="info" s={16}/>
          <span>Canal sin cierre obligatorio diario — el faltante se arrastra automáticamente.</span>
        </div>
      ) : data.kpis.pendiente > 0 ? (
        <div className="carrier-banner amber">
          <Icon n="alert" s={16}/>
          <span><strong>{data.kpis.pendiente} unidades pendientes</strong> de fabricar.</span>
        </div>
      ) : null}

      <div className="carrier-body">
        {/* KPIs — Pedidas / Producidas / Faltantes (cómo lo ve el sector de producción) */}
        <div className="carrier-kpis">
          <div className="carrier-kpi" style={{borderLeft:`3px solid ${C.color}`}}>
            <div className="carrier-kpi-label">Unidades totales</div>
            <div className="carrier-kpi-value">{data.kpis.unidades}</div>
          </div>
          <div className="carrier-kpi" style={{borderLeft:'3px solid var(--ink-faint)'}}>
            <div className="carrier-kpi-label">Unidades producidas</div>
            <div className="carrier-kpi-value">{(data.table || []).reduce((s,r) => s + (r.producido || 0), 0)}</div>
          </div>
          <div className="carrier-kpi" style={{borderLeft: data.kpis.pendiente>0 ? '3px solid var(--red)' : '3px solid var(--green)'}}>
            <div className="carrier-kpi-label">Faltantes de producir</div>
            <div className="carrier-kpi-value" style={{color: data.kpis.pendiente>0?'var(--red)':'var(--green)'}}>{data.kpis.pendiente}</div>
          </div>
        </div>

        {empty ? (
          <div className="card">
            <div className="empty">
              <Icon n="check-circle" s={32} c="var(--green)"/>
              <div style={{fontSize:14, fontWeight:700, color:'var(--ink)'}}>Sin pedidos activos</div>
              <div style={{fontSize:12, color:'var(--ink-muted)'}}>No hay nada que producir en este canal.</div>
              <button className="btn-ghost" onClick={() => setShowImport(true)} style={{marginTop:8}}>
                <Icon n="upload" s={13}/> Importar Excel
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Tabla SKUs pendientes */}
            <div className="card">
              <div className="card-header">
                <div className="card-title">Pendiente por SKU</div>
                <div style={{fontSize:11, color:'var(--ink-muted)', fontWeight:600}}>
                  {data.table.length} producto{data.table.length===1?'':'s'}
                  {data.table.filter(r => (r.faltante||0) > 0).length !== data.table.length && (
                    <> · <span style={{color:'var(--red)'}}>{data.table.filter(r => (r.faltante||0) > 0).length} con faltante</span></>
                  )}
                </div>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Producto</th>
                    <th style={{textAlign:'right'}}>Pedido</th>
                    <th style={{textAlign:'right'}}>Producido</th>
                    <th style={{textAlign:'right'}}>Faltante</th>
                    <th style={{textAlign:'right'}} title="Excedente acumulado disponible para próximos pedidos">Stock</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.table.map(r => {
                    const info = window.SKU_DB[r.sku] || {};
                    return (
                      <tr key={r.sku}>
                        <td><span className="order-num">{r.sku}</span></td>
                        <td>
                          <div style={{fontWeight:600, color:'var(--ink)', fontSize:14}}>{info.modelo || r.sku}</div>
                          {info.color && info.color !== '—' && (
                            <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:1, display:'flex', alignItems:'center', gap:5}}>
                              <span style={{width:7, height:7, borderRadius:'50%', background: info.color==='Negro'?'#1a1a1a':'#fff', border:'1px solid #d4cdc1', display:'inline-block'}}/>
                              {info.color}
                            </div>
                          )}
                        </td>
                        <td style={{textAlign:'right'}}><span className="cell-color-num">{r.pedido}</span></td>
                        <td style={{textAlign:'right'}}><span className="cell-color-num" style={{color: r.producido>=r.pedido ? 'var(--green)' : 'var(--ink-soft)'}}>{r.producido}</span></td>
                        <td style={{textAlign:'right'}}><FaltanteBadge value={r.faltante}/></td>
                        <td style={{textAlign:'right'}}>
                          {r.stock > 0
                            ? <span className="cell-stock-pos" title="Stock acumulado disponible — mover desde botón Mover" style={{color:'#7c3aed', fontWeight:700}}>+{r.stock}</span>
                            : <span style={{fontFamily:'var(--mono)', fontSize:11, color:'var(--ink-faint)'}}>—</span>}
                        </td>
                        <td style={{textAlign:'right', width:1, whiteSpace:'nowrap'}}>
                          <button className="btn-ghost" style={{padding:'5px 10px', fontSize:10, marginRight: puedeMoverStock && r.stock>0 ? 4 : 0}}
                            onClick={() => { setProduceCtx({ sku: r.sku, subcanal: channel }); setShowProduce(true); }}
                            disabled={r.faltante<=0}>
                            <Icon n="plus" s={11}/> Registrar
                          </button>
                          {puedeMoverStock && r.stock > 0 && (
                            <button className="btn-ghost" style={{padding:'5px 10px', fontSize:10, color:'#7c3aed', borderColor:'rgba(124,58,237,.3)'}}
                              onClick={() => { setStockMoverCtx({ source: channel, sku: r.sku }); setShowStockMover(true); }}
                              title="Mover stock de este SKU a otro canal o al almacén central">
                              <Icon n="arrow-right" s={11}/> Mover
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pedidos colapsable */}
            <div className="collapsible" style={{marginTop:14}}>
              <div className="collapsible-header" onClick={() => setOpenOrders(o => !o)}>
                <div className="collapsible-title">Pedidos individuales · {data.orders.length}</div>
                <span className={`collapsible-arrow ${openOrders?'open':''}`}><Icon n="chev-down" s={14}/></span>
              </div>
              {openOrders && (
                <div className="collapsible-body" style={{padding:0}}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>N° pedido</th>
                        <th>Cliente</th>
                        <th>SKU</th>
                        <th>Producto</th>
                        <th style={{textAlign:'right'}}>Cant.</th>
                        <th>Fecha</th>
                        {featurePedidos && <th></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {data.orders.map((o, idx) => (
                        <tr key={`${o.numero}-${o.sku}-${idx}`}>
                          <td>
                            <span className="order-num">{o.numero}</span>
                            {featurePedidos && o.editsCount > 0 && (
                              <button
                                className="btn-ghost"
                                style={{padding:'1px 6px', fontSize:9, marginLeft:6, background:'#fef3c7', borderColor:'#fbbf24', color:'#92400e'}}
                                onClick={() => setHistoryOrder(o.numero)}
                                title="Ver historial de ediciones"
                              >
                                ✏ Editado ({o.editsCount})
                              </button>
                            )}
                          </td>
                          <td style={{fontWeight:600, color:'var(--ink)'}}>{o.cliente}</td>
                          <td><span className="order-num" style={{fontSize:10}}>{o.sku}</span></td>
                          <td style={{fontSize:11, color:'var(--ink-soft)'}}>{window.skuName(o.sku)}</td>
                          <td style={{textAlign:'right'}}><span className="cell-color-num">{o.cantidad}</span></td>
                          <td style={{fontSize:11, color:'var(--ink-muted)'}}>{o.fecha}</td>
                          {featurePedidos && (
                            <td style={{textAlign:'right', width:1, whiteSpace:'nowrap'}}>
                              {['owner','admin','encargado'].includes(userRole) && (
                                <button
                                  className="btn-ghost"
                                  style={{padding:'4px 8px', fontSize:10}}
                                  onClick={() => setEditingOrder(o.numero)}
                                >
                                  <Icon n="edit" s={11}/> Editar
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Lotes */}
            {data.lotes.length > 0 && (
              <div className="collapsible">
                <div className="collapsible-header" onClick={() => setOpenLotes(o => !o)}>
                  <div className="collapsible-title">Lotes importados · {data.lotes.length}</div>
                  <span className={`collapsible-arrow ${openLotes?'open':''}`}><Icon n="chev-down" s={14}/></span>
                </div>
                {openLotes && (
                  <div className="collapsible-body" style={{padding:0}}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Fecha</th>
                          <th>Archivo</th>
                          <th style={{textAlign:'right'}}>Pedidos</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.lotes.map(l => (
                          <tr key={l.id}>
                            <td style={{fontSize:11}}>{fmt.dateTime(l.fecha)}</td>
                            <td style={{fontSize:11, color:'var(--ink-muted)', fontFamily:'var(--mono)'}}>{l.archivo}</td>
                            <td style={{textAlign:'right'}}><span className="cell-color-num">{l.cantidad}</span></td>
                            <td style={{textAlign:'right', width:1, whiteSpace:'nowrap'}}>
                              {puedeEliminarLote && (
                                <button
                                  className="btn-ghost"
                                  style={{padding:'4px 10px', fontSize:10, color:'var(--red)', borderColor:'rgba(220,38,38,.32)'}}
                                  onClick={() => setLoteAEliminar(l)}
                                  title="Eliminar lote y todas sus órdenes"
                                >
                                  <Icon n="trash" s={11}/> Eliminar
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Canceladas — informativo · acumulable (datos existentes: status='cancelado') */}
            {cancelChannel.length > 0 && (
              <div className="collapsible">
                <div className="collapsible-header" onClick={() => setOpenCancel(o => !o)}>
                  <div className="collapsible-title" style={{display:'flex', alignItems:'center', gap:8}}>
                    <span style={{color:'var(--red)'}}>Canceladas · {cancelChannel.length}</span>
                    <span style={{fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'.04em', color:'var(--red)', background:'var(--red-bg)', border:'1px solid rgba(220,38,38,.32)', borderRadius:999, padding:'2px 7px'}}>Informativo · acumulable</span>
                  </div>
                  <span style={{display:'flex', alignItems:'center', gap:8}}>
                    <button className="btn-ghost" style={{fontSize:10, padding:'3px 8px', color:'var(--red)', borderColor:'rgba(220,38,38,.32)'}}
                      onClick={e => { e.stopPropagation(); exportEstado(cancelChannel, 'cancel'); }}><Icon n="download" s={11}/> Exportar</button>
                    <span className={`collapsible-arrow ${openCancel?'open':''}`}><Icon n="chev-down" s={14}/></span>
                  </span>
                </div>
                {openCancel && (
                  <div className="collapsible-body" style={{padding:0}}>
                    <table className="data-table">
                      <thead><tr><th>SKU</th><th>Producto / Orden</th><th style={{textAlign:'right'}}>Cant.</th><th>Motivo</th></tr></thead>
                      <tbody>
                        {cancelChannel.map((c, i) => (
                          <tr key={(c.numero||'')+'|'+(c.sku||'')+i}>
                            <td><span className="order-num" style={{fontSize:10}}>{c.sku}</span></td>
                            <td><div style={{fontSize:12, color:'var(--ink)'}}>{c.modelo}</div><div style={{fontSize:10, color:'var(--ink-muted)'}}>#{c.numero}</div></td>
                            <td style={{textAlign:'right'}}><span className="cell-color-num">{c.cantidad}</span></td>
                            <td style={{fontSize:11, color:'var(--ink-soft)'}}>{c.motivo || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Reprogramadas — informativo · acumulable (se llena en Fase B: ML "demorado") */}
            {reprogChannel.length > 0 && (
              <div className="collapsible">
                <div className="collapsible-header" onClick={() => setOpenReprog(o => !o)}>
                  <div className="collapsible-title" style={{display:'flex', alignItems:'center', gap:8}}>
                    <span style={{color:'var(--amber)'}}>Reprogramadas · {reprogChannel.length}</span>
                    <span style={{fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'.04em', color:'var(--amber)', background:'var(--amber-bg)', border:'1px solid rgba(217,119,6,.32)', borderRadius:999, padding:'2px 7px'}}>Informativo · acumulable</span>
                  </div>
                  <span style={{display:'flex', alignItems:'center', gap:8}}>
                    <button className="btn-ghost" style={{fontSize:10, padding:'3px 8px', color:'var(--amber)', borderColor:'rgba(217,119,6,.32)'}}
                      onClick={e => { e.stopPropagation(); exportEstado(reprogChannel, 'reprog'); }}><Icon n="download" s={11}/> Exportar</button>
                    <span className={`collapsible-arrow ${openReprog?'open':''}`}><Icon n="chev-down" s={14}/></span>
                  </span>
                </div>
                {openReprog && (
                  <div className="collapsible-body" style={{padding:0}}>
                    <table className="data-table">
                      <thead><tr><th>SKU</th><th>Producto / Orden</th><th style={{textAlign:'right'}}>Cant.</th><th>Fecha</th></tr></thead>
                      <tbody>
                        {reprogChannel.map((c, i) => (
                          <tr key={(c.numero||'')+'|'+(c.sku||'')+i}>
                            <td><span className="order-num" style={{fontSize:10}}>{c.sku}</span></td>
                            <td><div style={{fontSize:12, color:'var(--ink)'}}>{c.modelo}</div><div style={{fontSize:10, color:'var(--ink-muted)'}}>#{c.numero}</div></td>
                            <td style={{textAlign:'right'}}><span className="cell-color-num">{c.cantidad}</span></td>
                            <td style={{fontSize:11, color:'var(--ink-soft)'}}>{c.fecha || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Cierres anteriores */}
            {data.cierres.length > 0 && (
              <div className="collapsible">
                <div className="collapsible-header" onClick={() => setOpenCierres(o => !o)}>
                  <div className="collapsible-title">Cierres anteriores · {data.cierres.length}</div>
                  <span className={`collapsible-arrow ${openCierres?'open':''}`}><Icon n="chev-down" s={14}/></span>
                </div>
                {openCierres && (
                  <div className="collapsible-body" style={{padding:0}}>
                    <table className="data-table">
                      <thead>
                        <tr><th>Fecha jornada</th><th>Cerrada el</th><th>Pedidos</th><th>Producidas</th><th>Faltante</th><th style={{textAlign:'right'}}>Reporte</th></tr>
                      </thead>
                      <tbody>
                        {data.cierres.map((c, i) => (
                          <tr key={c.id || i}>
                            <td style={{fontWeight:600}}>{c.fechaJornada ? fmt.date(c.fechaJornada) : '—'}</td>
                            <td>{fmt.dateTime(c.fecha)}</td>
                            <td><span className="cell-color-num">{c.pedidos}</span></td>
                            <td>{c.unidadesProducidas || 0}</td>
                            <td><FaltanteBadge value={c.faltante}/></td>
                            <td style={{textAlign:'right', whiteSpace:'nowrap'}}>
                              <button className="btn-ghost" style={{padding:'4px 8px', fontSize:10, marginRight:4}}
                                onClick={async () => {
                                  try {
                                    await window.REPORT_UTILS.descargarReporteCierre(c, channel, 'xlsx');
                                    toast.success('Excel descargado');
                                  } catch (e) { toast.error(e.message); }
                                }}>
                                <Icon n="download" s={11}/> Excel
                              </button>
                              <button className="btn-ghost" style={{padding:'4px 8px', fontSize:10}}
                                onClick={async () => {
                                  try {
                                    await window.REPORT_UTILS.descargarReporteCierre(c, channel, 'pdf');
                                    toast.success('PDF descargado');
                                  } catch (e) { toast.error(e.message); }
                                }}>
                                <Icon n="download" s={11}/> PDF
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Cambio 2B: el cierre de jornada se hace desde el Dashboard
                (botón global). CarrierPage es solo vista. */}
          </>
        )}
      </div>

      <ProduceModal open={showProduce} onClose={() => setShowProduce(false)} defaultSku={produceCtx.sku} defaultSubcanal={produceCtx.subcanal}/>
      <ImportModal open={showImport} onClose={() => setShowImport(false)} channel={channel}/>

      <ConfirmModal
        open={!!loteAEliminar}
        onClose={() => !borrando && setLoteAEliminar(null)}
        title="Eliminar lote"
        message={loteAEliminar
          ? `Vas a eliminar el lote ${loteAEliminar.archivo} y TODAS sus órdenes (${loteAEliminar.cantidad} pedidos). El faltante se va a recalcular automáticamente. Esta acción NO se puede deshacer.`
          : ''}
        confirmText={borrando ? 'Eliminando...' : 'Sí, eliminar todo'}
        danger
        onConfirm={async () => {
          if (!loteAEliminar || borrando) return;
          setBorrando(true);
          try {
            await window.MOCK_ACTIONS.eliminarLote(loteAEliminar.id);
            toast.success('Lote eliminado · ' + loteAEliminar.archivo);
            setLoteAEliminar(null);
          } catch (e) {
            toast.error(e.message || 'No se pudo eliminar el lote');
          } finally {
            setBorrando(false);
          }
        }}
      />

      {/* Carga manual + edición + historial — montados solo si feature flag ON */}
      {featurePedidos && window.ManualOrderModal && (
        <window.ManualOrderModal
          open={showManualOrder}
          onClose={() => setShowManualOrder(false)}
          channel={channel}
        />
      )}
      {featurePedidos && window.OrderEditModal && editingOrder && (
        <window.OrderEditModal
          open={!!editingOrder}
          onClose={() => setEditingOrder(null)}
          channel={channel}
          orderNumber={editingOrder}
        />
      )}
      {featurePedidos && window.OrderHistoryModal && historyOrder && (
        <window.OrderHistoryModal
          open={!!historyOrder}
          onClose={() => setHistoryOrder(null)}
          channel={channel}
          orderNumber={historyOrder}
        />
      )}

      {/* StockMovementModal — Cambio 1 Step 5. Solo admin/encargado/owner. */}
      {showStockMover && window.StockMovementModal && (
        <window.StockMovementModal
          open={true}
          onClose={() => setShowStockMover(false)}
          context={stockMoverCtx}
          onMoved={() => { setShowStockMover(false); toast.success('Movimiento registrado'); }}
        />
      )}
    </div>
  );
}

window.CarrierPage = CarrierPage;
