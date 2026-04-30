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
  const [showCierre, setShowCierre]   = useState(false);
  const [openOrders, setOpenOrders]   = useState(false);
  const [openLotes, setOpenLotes]     = useState(false);
  const [openCierres, setOpenCierres] = useState(false);
  const [loteAEliminar, setLoteAEliminar] = useState(null);  // lote pendiente de borrar
  const [borrando, setBorrando] = useState(false);

  const userRole = window.MOCK.user.role;
  const puedeEliminarLote = ['owner','admin','encargado'].includes(userRole);

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
            <Icon n={channel==='colecta'?'truck':channel==='flex'?'package':channel==='tiendanube'?'box':'users'} s={18}/>
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
          <button className="btn-ghost" onClick={() => toast.info('Generando reporte...')}>
            <Icon n="download" s={13}/> Exportar
          </button>
          <button className="btn-primary" onClick={() => { setProduceCtx({ subcanal: channel }); setShowProduce(true); }}>
            <Icon n="plus" s={13}/> Producir
          </button>
        </div>
      </div>

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
        {/* KPIs */}
        <div className="carrier-kpis">
          <div className="carrier-kpi" style={{borderLeft:`3px solid ${C.color}`}}>
            <div className="carrier-kpi-label">Pedidos activos</div>
            <div className="carrier-kpi-value" style={{color: data.kpis.activos>0?'var(--ink)':'var(--ink-faint)'}}>{data.kpis.activos}</div>
          </div>
          <div className="carrier-kpi">
            <div className="carrier-kpi-label">Unidades totales</div>
            <div className="carrier-kpi-value">{data.kpis.unidades}</div>
          </div>
          <div className="carrier-kpi" style={{borderLeft: data.kpis.pendiente>0 ? '3px solid var(--red)' : '3px solid var(--green)'}}>
            <div className="carrier-kpi-label">Pendiente fabricar</div>
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
                <div style={{fontSize:11, color:'var(--ink-muted)', fontWeight:600}}>{data.table.length} productos</div>
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
                          <div style={{fontWeight:600, color:'var(--ink)', fontSize:12}}>{info.modelo || r.sku}</div>
                          {info.color && info.color !== '—' && (
                            <div style={{fontSize:10, color:'var(--ink-muted)', marginTop:1, display:'flex', alignItems:'center', gap:5}}>
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
                            ? <span className="cell-stock-pos" title="Excedente disponible">+{r.stock}</span>
                            : <span style={{fontFamily:'var(--mono)', fontSize:11, color:'var(--ink-faint)'}}>—</span>}
                        </td>
                        <td style={{textAlign:'right', width:1}}>
                          <button className="btn-ghost" style={{padding:'5px 10px', fontSize:10}} onClick={() => { setProduceCtx({ sku: r.sku, subcanal: channel }); setShowProduce(true); }} disabled={r.faltante<=0}>
                            <Icon n="plus" s={11}/> Registrar
                          </button>
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
                      <tr><th>N° pedido</th><th>Cliente</th><th>SKU</th><th>Producto</th><th style={{textAlign:'right'}}>Cant.</th><th>Fecha</th></tr>
                    </thead>
                    <tbody>
                      {data.orders.map(o => (
                        <tr key={o.numero}>
                          <td><span className="order-num">{o.numero}</span></td>
                          <td style={{fontWeight:600, color:'var(--ink)'}}>{o.cliente}</td>
                          <td><span className="order-num" style={{fontSize:10}}>{o.sku}</span></td>
                          <td style={{fontSize:11, color:'var(--ink-soft)'}}>{window.skuName(o.sku)}</td>
                          <td style={{textAlign:'right'}}><span className="cell-color-num">{o.cantidad}</span></td>
                          <td style={{fontSize:11, color:'var(--ink-muted)'}}>{o.fecha}</td>
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
                        <tr><th>Fecha</th><th>Pedidos</th><th>Faltante arrastrado</th><th>Snapshot</th></tr>
                      </thead>
                      <tbody>
                        {data.cierres.map((c, i) => (
                          <tr key={i}>
                            <td>{fmt.dateTime(c.fecha)}</td>
                            <td><span className="cell-color-num">{c.pedidos}</span></td>
                            <td><FaltanteBadge value={c.faltante}/></td>
                            <td><span style={{fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:10, background:'var(--green-bg)', color:'var(--green)'}}>{c.snapshot}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Cerrar jornada — solo en canales con cierre horario */}
            {esHorario && (
              <div style={{marginTop:20, display:'flex', justifyContent:'space-between', alignItems:'center', gap:12}}>
                <div style={{fontSize:11, color:'var(--ink-muted)', maxWidth:520, lineHeight:1.5}}>
                  <Icon n="info" s={12} style={{verticalAlign:'middle', marginRight:4}}/>
                  Al cerrar: archivamos los pedidos completados y arrastramos el faltante al día siguiente como nueva línea.
                </div>
                <button
                  className="btn-success"
                  onClick={() => setShowCierre(true)}
                  style={vencida ? {background:'var(--red)', animation:'pulseDot 1.5s infinite'} : undefined}
                >
                  <Icon n="lock" s={13}/> {vencida ? 'Cerrar jornada (vencida)' : 'Cerrar jornada'}
                </button>
              </div>
            )}
            {!esHorario && data.cierres.length === 0 && data.kpis.activos > 0 && (
              <div style={{marginTop:20, padding:14, background:'var(--paper-off)', border:'1px dashed var(--border-md)', borderRadius:6, fontSize:11, color:'var(--ink-soft)', display:'flex', gap:10, alignItems:'center'}}>
                <Icon n="info" s={14} c="var(--ink-muted)"/>
                <span>Este canal no tiene cierre obligatorio diario. El faltante se arrastra automáticamente cada día sin necesidad de acción.</span>
              </div>
            )}
          </>
        )}
      </div>

      <ProduceModal open={showProduce} onClose={() => setShowProduce(false)} defaultSku={produceCtx.sku} defaultSubcanal={produceCtx.subcanal}/>
      <ImportModal open={showImport} onClose={() => setShowImport(false)} channel={channel}/>
      <CierreModal
        open={showCierre}
        onClose={() => setShowCierre(false)}
        onConfirm={async () => {
          try {
            await window.MOCK_ACTIONS.cerrarJornada({ channelId: channel });
            toast.success('Jornada cerrada · snapshot guardado');
          } catch (e) {
            toast.error(e.message || 'No se pudo cerrar la jornada');
          }
        }}
        channel={channel}
      />

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
    </div>
  );
}

window.CarrierPage = CarrierPage;
