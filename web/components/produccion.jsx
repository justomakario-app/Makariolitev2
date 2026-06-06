/* ══ PRODUCCIÓN UNIFICADA — TABS POR CANAL, TODO POR SKU ══ */

function ProduccionPage() {
  const M = window.useMockData();
  const toast = useToast();
  const data = M.prod.todos;
  const [tabCanal, setTabCanal] = useState('todos');
  const [show, setShow] = useState(false);
  // Edicion/anulacion de cargas desde la seccion "Cargas de hoy".
  // Reusa EditLogModal y ConfirmModal de modals.jsx (compartidos web+mobile).
  const [editLog, setEditLog] = useState(null);
  const [confirmAnular, setConfirmAnular] = useState(null);

  /* Exportar XLSX — respeta el tab activo: si es "todos", exporta los 4
     canales con columna Canal. Si es un canal específico, solo ese.
     Solo SKUs con faltante > 0. */
  const exportarExcel = () => {
    const label = window.CARRIERS[tabCanal]?.label;
    const fuente = tabCanal === 'todos'
      ? data.table
      : data.table.filter(r => r.canal === label);
    const filas = fuente
      .filter(r => (r.faltante || 0) > 0)
      .map(r => {
        const info = window.SKU_DB[r.sku] || {};
        const modeloFull = info.color && info.color !== '—'
          ? `${info.modelo || r.sku} ${info.color}`
          : (info.modelo || r.sku);
        return { Canal: r.canal, SKU: r.sku, Modelo: modeloFull, Cantidad: r.faltante };
      });
    if (!filas.length) {
      toast.info('Nada para exportar — todo al día');
      return;
    }
    if (typeof window.XLSX === 'undefined') {
      toast.error('Librería de Excel todavía no cargó · reintentá');
      return;
    }
    const ws = window.XLSX.utils.json_to_sheet(filas);
    ws['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 48 }, { wch: 12 }];
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Producción pendiente');
    const fecha = new Date().toISOString().slice(0, 10);
    const nombre = tabCanal === 'todos' ? 'todos' : tabCanal;
    window.XLSX.writeFile(wb, `produccion-${nombre}-${fecha}.xlsx`);
    toast.success(`Excel exportado · ${filas.length} línea${filas.length===1?'':'s'}`);
  };

  const total   = data.kpis.totalPedido;
  const done    = data.kpis.producido;
  const pct     = Math.round((done / total) * 100);
  const barColor = pct >= 80 ? 'var(--green)' : pct >= 50 ? '#6366f1' : pct >= 30 ? 'var(--amber)' : 'var(--red)';

  let rows = data.table;
  if (tabCanal !== 'todos') {
    const label = window.CARRIERS[tabCanal]?.label;
    if (label) rows = rows.filter(r => r.canal === label);
  }

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
            <button className="btn-ghost" onClick={exportarExcel} title="Exportar Excel con producción pendiente">
              <Icon n="download" s={13}/> Exportar
            </button>
            <button className="btn-primary" onClick={() => setShow(true)}>
              <Icon n="plus" s={13}/> Registrar producción
            </button>
          </div>
        </div>
        <div className="prod-tabs-row">
          <button className={`prod-tab ${tabCanal==='todos'?'active-todos':''}`} onClick={() => setTabCanal('todos')}>
            Todos los canales
          </button>
          {['colecta','flex','tiendanube','distribuidor','no_flex','correo_argentino'].map(id => {
            const ch = window.CARRIERS[id] || {};
            return (
              <button
                key={id}
                className={`prod-tab ${tabCanal===id?'active-todos':''}`}
                onClick={() => setTabCanal(id)}
              >
                <span style={{width:6, height:6, borderRadius:'50%', background: ch.color || '#888', display:'inline-block', marginRight:6, verticalAlign:'middle'}}/>
                {ch.label || id}
              </button>
            );
          })}
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

        {/* S2.23: pedidos mayoristas en fabricación — solo en el canal
            Distribuidores y solo para owner/admin (la RPC es owner+admin). */}
        {tabCanal === 'distribuidor' && window.MayoristasEnProduccion && <window.MayoristasEnProduccion/>}

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
                        <div style={{fontWeight:600, color:'var(--ink)', fontSize:14}}>{info.modelo || r.sku}</div>
                        {info.color && info.color !== '—' && (
                          <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:1, display:'flex', alignItems:'center', gap:5}}>
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

        {/* Cargas de hoy — todos los canales y operarios.
            Las RLS de production_logs ya cortan a nivel BD (operario solo
            ve las suyas). Aca filtramos las compensaciones (cantidad<0)
            para que no aparezcan como ruido, pero las usamos para marcar
            el original como "ya anulado" y deshabilitar sus botones.
            Refresco automatico via M.prodLogs (loadProdLogs + realtime). */}
        {(() => {
          const today = new Date().toISOString().slice(0, 10);
          const todayLogs = M.prodLogs.filter(l => l.fecha === today);
          const idsAnulados = new Set();
          for (const l of todayLogs) {
            const m = (l.notas || '').match(/^\[ANULADO\] log_id=([0-9a-f-]+)/);
            if (m) idsAnulados.add(m[1]);
          }
          const visibles = todayLogs.filter(l =>
            !(l.unidades < 0 && (l.notas || '').startsWith('[ANULADO]'))
          );
          return (
            <div className="card" style={{marginTop:14}}>
              <div className="card-header">
                <div className="card-title">Cargas de hoy</div>
                <div style={{fontSize:11, color:'var(--ink-muted)', fontWeight:600}}>
                  {visibles.length} {visibles.length === 1 ? 'registro' : 'registros'}
                </div>
              </div>
              {visibles.length === 0 ? (
                <div className="empty">
                  <Icon n="package" s={26} c="var(--ink-faint)"/>
                  <div style={{fontSize:12, color:'var(--ink-muted)'}}>No hay registros para hoy. Registrá tu primera producción.</div>
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Hora</th><th>SKU</th><th>Producto</th><th>Canal</th>
                      <th>Sector</th><th>Operario</th>
                      <th style={{textAlign:'right'}}>Uds.</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibles.map(l => {
                      const info = window.SKU_DB[l.sku] || {};
                      const yaAnulado = idsAnulados.has(l.id);
                      const esCorregido = (l.notas || '').startsWith('[CORREGIDO]');
                      const tachado = yaAnulado ? { textDecoration: 'line-through' } : {};
                      // EditLogModal/ConfirmModal esperan campos raw del log
                      // (cantidad, channel_id). M.prodLogs los expone como
                      // unidades/subcanal — los re-mapeamos al pasar.
                      const logRaw = { ...l, cantidad: l.unidades, channel_id: l.subcanal };
                      return (
                        <tr key={l.id} style={{opacity: yaAnulado ? 0.5 : 1}}>
                          <td style={{fontSize:11, color:'var(--ink-muted)', fontFamily:'var(--mono)'}}>{l.hora}</td>
                          <td>
                            <span className="order-num" style={tachado}>{l.sku}</span>
                            {yaAnulado && <span style={{marginLeft:6, fontSize:9, fontWeight:700, padding:'1px 6px', borderRadius:6, background:'var(--paper-dim)', color:'var(--ink-muted)'}}>ANULADO</span>}
                            {esCorregido && !yaAnulado && <span style={{marginLeft:6, fontSize:9, fontWeight:700, padding:'1px 6px', borderRadius:6, background:'var(--blue-bg)', color:'var(--blue)'}}>CORRECCIÓN</span>}
                          </td>
                          <td>
                            <div style={{fontWeight:600, fontSize:12, ...tachado}}>{info.modelo || l.sku}</div>
                            {info.color && info.color !== '—' && (
                              <div style={{fontSize:10, color:'var(--ink-muted)', marginTop:1}}>{info.color}</div>
                            )}
                          </td>
                          <td style={{fontSize:11, textTransform:'capitalize'}}>{l.subcanal}</td>
                          <td style={{fontSize:11, color:'var(--ink-soft)'}}>{l.sector}</td>
                          <td style={{fontSize:11, color:'var(--ink-soft)', fontWeight:600}}>{l.operario}</td>
                          <td style={{textAlign:'right'}}><span className="cell-color-num" style={tachado}>{l.unidades}</span></td>
                          <td style={{textAlign:'right', width:1, whiteSpace:'nowrap'}}>
                            {!yaAnulado ? (
                              <>
                                <button className="btn-ghost" style={{padding:'5px 8px', fontSize:10, marginRight:4}} title="Editar carga" onClick={() => setEditLog(logRaw)}>
                                  <Icon n="edit" s={11}/>
                                </button>
                                <button className="btn-ghost" style={{padding:'5px 8px', fontSize:10, color:'var(--red)', borderColor:'rgba(220,38,38,.32)', background:'var(--red-bg)'}} title="Anular carga" onClick={() => setConfirmAnular(logRaw)}>
                                  <Icon n="trash" s={11}/>
                                </button>
                              </>
                            ) : (
                              <span style={{fontSize:10, color:'var(--ink-faint)'}}>—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })()}
      </div>

      <ProduceModal open={show} onClose={() => setShow(false)}/>

      {/* Modal Editar carga (compartido — vive en modals.jsx) */}
      {editLog && window.EditLogModal && (
        <window.EditLogModal
          log={editLog}
          onClose={() => setEditLog(null)}
          onSaved={() => setEditLog(null)}
        />
      )}

      {/* Confirm Anular */}
      <ConfirmModal
        open={!!confirmAnular}
        onClose={() => setConfirmAnular(null)}
        title="Anular carga"
        message={confirmAnular
          ? `Vas a anular la carga de ${confirmAnular.cantidad} × ${confirmAnular.sku} (${window.CARRIERS[confirmAnular.channel_id]?.label || confirmAnular.channel_id}). Se va a registrar una entrada compensatoria que descuenta lo cargado. Queda registrado.`
          : ''}
        confirmText="Sí, anular"
        danger
        onConfirm={async () => {
          try {
            await window.MOCK_ACTIONS.corregirLog({ logId: confirmAnular.id, anular: true });
            toast.success('Carga anulada');
            setConfirmAnular(null);
          } catch (e) { toast.error(e.message || 'No se pudo anular'); }
        }}
      />
    </div>
  );
}

window.ProduccionPage = ProduccionPage;

/* ══ S2.23 — Pedidos mayoristas en fabricación ══
   Lista los pedidos mayoristas en estado 'confirmado' / 'en_produccion'
   para que producción sepa qué fabricar. Solo owner/admin (la RPC
   rpc_mayoristas_list_pedidos es owner+admin; un operario obtendría
   "Sin permiso"). "Marcar como listo" solo owner. */
function MayoristasEnProduccion() {
  const toast = useToast();
  const role = (window.MOCK?.user?.role || '').toLowerCase();
  if (!['owner', 'admin'].includes(role)) return null;
  const isOwner = role === 'owner';

  // Mapa de colores local (no dependemos de ventas.jsx, que carga después).
  const ESTADO_C = {
    cotizacion:    { label:'Cotización',    bg:'#eef0f2', fg:'#64748b' },
    confirmado:    { label:'Confirmado',    bg:'#e0ecff', fg:'#2563eb' },
    en_produccion: { label:'En producción', bg:'#fff0e0', fg:'#d97706' },
    listo:         { label:'Listo',         bg:'#e8f7ed', fg:'#16a34a' },
    entregado:     { label:'Entregado',     bg:'#dcfce7', fg:'#15803d' },
    cancelado:     { label:'Cancelado',     bg:'#fee2e2', fg:'#dc2626' },
  };

  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(null);

  const reload = async () => {
    setLoading(true);
    try {
      const data = await window.ADMIN_DATA.listPedidosMayoristas({});
      setPedidos((data || []).filter(p => p.estado === 'confirmado' || p.estado === 'en_produccion'));
    } catch (err) {
      // Silencioso: si no hay permiso o falla, no rompemos la pantalla de producción.
      console.error('[produccion] mayoristas en produccion:', err?.message ?? err);
      setPedidos([]);
    } finally { setLoading(false); }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  const marcarListo = async (id) => {
    setSaving(id);
    try {
      await window.ADMIN_DATA.updateEstadoPedidoMayorista({ pedido_id: id, estado: 'listo' });
      toast.success('Pedido marcado como listo');
      await reload();
    } catch (err) {
      toast.error(err?.message || 'No se pudo actualizar');
    } finally { setSaving(null); }
  };

  if (loading) {
    return (
      <div className="card" style={{marginBottom:14}}>
        <div className="card-header"><div className="card-title">Pedidos mayoristas en fabricación</div></div>
        <div className="empty"><span className="loader" style={{width:22, height:22}}/></div>
      </div>
    );
  }
  if (pedidos.length === 0) return null;  // nada que fabricar → no ocupar espacio

  return (
    <div className="card" style={{marginBottom:14}}>
      <div className="card-header">
        <div className="card-title">Pedidos mayoristas en fabricación</div>
        <div style={{fontSize:11, color:'var(--ink-muted)', fontWeight:600}}>{pedidos.length} pedido{pedidos.length===1?'':'s'}</div>
      </div>
      <table className="data-table">
        <thead>
          <tr><th>Pedido</th><th>Cliente</th><th>Entrega</th><th>Ítems</th><th>Estado</th><th></th></tr>
        </thead>
        <tbody>
          {pedidos.map(p => {
            const resumen = (p.items || []).map(it => `${it.cantidad}× ${it.modelo || it.sku}`).join(' · ');
            const cAlt = ESTADO_C[p.estado] || { label: p.estado, bg:'#eef0f2', fg:'#64748b' };
            return (
              <tr key={p.id}>
                <td><span className="order-num" style={{fontWeight:700}}>{p.numero_pedido}</span></td>
                <td style={{fontWeight:600}}>{p.cliente_nombre}{p.localidad ? <div style={{fontSize:10, color:'var(--ink-muted)', fontWeight:500}}>{p.localidad}</div> : null}</td>
                <td style={{fontSize:12, color:'var(--ink-soft)'}}>{p.fecha_entrega_estimada ? String(p.fecha_entrega_estimada).slice(0,10) : '—'}</td>
                <td style={{fontSize:11, color:'var(--ink-soft)', maxWidth:280}}>{resumen || '—'}</td>
                <td><span style={{display:'inline-block', fontSize:10, fontWeight:700, padding:'2px 9px', borderRadius:10, background:cAlt.bg, color:cAlt.fg, textTransform:'uppercase', letterSpacing:'.05em'}}>{cAlt.label}</span></td>
                <td style={{textAlign:'right', width:1, whiteSpace:'nowrap'}}>
                  {isOwner && (
                    <button className="btn-ghost" style={{padding:'5px 10px', fontSize:10}}
                            onClick={() => marcarListo(p.id)} disabled={saving === p.id}>
                      <Icon n="check" s={11}/> Marcar como listo
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

window.MayoristasEnProduccion = MayoristasEnProduccion;
