/* ══ MOBILE CARRIER — vista compacta de un canal ══ */

function CarrierPage({ channel, onBack }) {
  const M = window.useMockData();
  const toast = useToast();
  const C = window.CARRIERS[channel];
  const data = M.carriers[channel];
  const [registerOpen, setRegisterOpen] = useState(false);
  const [pendingSku, setPendingSku] = useState(null);
  const [loteAEliminar, setLoteAEliminar] = useState(null);
  const [borrando, setBorrando] = useState(false);

  if (!data || !C) return null;

  const empty = data.kpis.activos === 0 && data.table.length === 0;
  const userRole = window.MOCK.user.role;
  const puedeEliminarLote = ['owner','admin','encargado'].includes(userRole);

  const exportarExcel = () => {
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
  };

  return (
    <div className="m-page">
      <div className="m-carrier-header" style={{borderTop:`3px solid ${C.color}`}}>
        <button className="m-back-btn" onClick={onBack}>
          <Icon n="arrow-left" s={16}/>
        </button>
        <div style={{flex:1, display:'flex', alignItems:'center', gap:10, minWidth:0}}>
          <div style={{
            width:32, height:32, background:C.bg, color:C.color,
            display:'flex', alignItems:'center', justifyContent:'center',
            borderRadius:6, flexShrink:0,
          }}>
            <Icon n={({colecta:'truck', flex:'package', tiendanube:'box', distribuidor:'users', no_flex:'package-check', correo_argentino:'send'})[channel] || 'box'} s={16}/>
          </div>
          <div style={{minWidth:0}}>
            <div style={{fontSize:15, fontWeight:800, letterSpacing:'-.02em'}}>{C.label}</div>
            <div style={{fontSize:10, color:'var(--ink-muted)', fontWeight:600}}>{C.sub}</div>
          </div>
        </div>
        <button
          className="m-back-btn"
          onClick={exportarExcel}
          title="Exportar Excel"
          style={{flexShrink:0}}
        >
          <Icon n="download" s={16}/>
        </button>
      </div>

      {/* KPIs */}
      <div className="m-kpi-row" style={{marginTop:0}}>
        <div className="m-kpi" style={{borderLeft:`3px solid ${C.color}`}}>
          <div className="m-kpi-label">Total</div>
          <div className="m-kpi-value">{data.kpis.unidades}</div>
        </div>
        <div className="m-kpi" style={{borderLeft:'3px solid var(--ink-faint)'}}>
          <div className="m-kpi-label">Producidas</div>
          <div className="m-kpi-value">{(data.table || []).reduce((s,r) => s + (r.producido || 0), 0)}</div>
        </div>
        <div className="m-kpi" style={{borderLeft: data.kpis.pendiente>0?'3px solid var(--red)':'3px solid var(--green)'}}>
          <div className="m-kpi-label">Faltantes</div>
          <div className="m-kpi-value" style={{color: data.kpis.pendiente>0?'var(--red)':'var(--green)'}}>{data.kpis.pendiente}</div>
        </div>
      </div>

      <div style={{padding:'4px 16px 100px'}}>
        {empty ? (
          <div className="m-empty">
            <Icon n="check-circle" s={32} c="var(--green)"/>
            <div style={{fontSize:13, fontWeight:700, marginTop:8}}>Sin pedidos activos</div>
            <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:4}}>Todo al día en este canal</div>
          </div>
        ) : (
          <>
            <div style={{fontSize:10, fontWeight:700, color:'var(--ink-muted)', textTransform:'uppercase', letterSpacing:'.1em', margin:'12px 0 8px'}}>
              Pendiente por SKU
            </div>
            {data.table.map(r => {
              const info = window.SKU_DB[r.sku] || {};
              return (
                <div key={r.sku} className="m-prod-card">
                  <div style={{display:'flex', alignItems:'flex-start', gap:10}}>
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{fontFamily:'var(--mono)', fontSize:11, fontWeight:700, color:'var(--ink-muted)', marginBottom:2}}>{r.sku}</div>
                      <div style={{fontSize:13, fontWeight:600}}>{info.modelo || r.sku}</div>
                      {info.color && info.color !== '—' && (
                        <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:1}}>{info.color}</div>
                      )}
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontFamily:'var(--mono)', fontSize:18, fontWeight:800, color: r.faltante>0?'var(--red)':'var(--green)'}}>
                        {r.faltante > 0 ? r.faltante : '✓'}
                      </div>
                      <div style={{fontSize:9, color:'var(--ink-muted)', textTransform:'uppercase', letterSpacing:'.06em', fontWeight:700, marginTop:1}}>
                        {r.faltante > 0 ? 'faltan' : 'OK'}
                      </div>
                    </div>
                  </div>
                  <div style={{display:'flex', alignItems:'center', gap:10, marginTop:10}}>
                    <div style={{flex:1, fontSize:11, color:'var(--ink-soft)'}}>
                      Pedido: <strong style={{fontFamily:'var(--mono)'}}>{r.pedido}</strong> · Hecho: <strong style={{fontFamily:'var(--mono)', color:'var(--green)'}}>{r.producido}</strong>
                    </div>
                    {r.faltante > 0 && (
                      <button className="btn-primary" style={{padding:'7px 14px', fontSize:10}} onClick={() => { setPendingSku(r.sku); setRegisterOpen(true); }}>
                        <Icon n="plus" s={11}/> Cargar
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* Lotes importados (con eliminar) */}
        {puedeEliminarLote && (data.lotes || []).length > 0 && (
          <>
            <div style={{fontSize:10, fontWeight:700, color:'var(--ink-muted)', textTransform:'uppercase', letterSpacing:'.1em', margin:'18px 0 8px'}}>
              Lotes importados · {data.lotes.length}
            </div>
            {data.lotes.map(l => (
              <div key={l.id} className="m-prod-card" style={{padding:'12px 14px'}}>
                <div style={{display:'flex', alignItems:'center', gap:10}}>
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{fontSize:12, fontWeight:600, color:'var(--ink)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{l.archivo}</div>
                    <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:2}}>
                      {fmt.dateTime(l.fecha)} · <strong style={{fontFamily:'var(--mono)'}}>{l.cantidad}</strong> uds.
                    </div>
                  </div>
                  <button
                    onClick={() => setLoteAEliminar(l)}
                    title="Eliminar lote y todas sus órdenes"
                    style={{
                      width:38, height:38, flexShrink:0,
                      border:'1px solid rgba(220,38,38,.32)',
                      background:'var(--red-bg)',
                      borderRadius:6,
                      display:'flex', alignItems:'center', justifyContent:'center',
                      color:'var(--red)', cursor:'pointer',
                    }}
                  >
                    <Icon n="trash" s={15}/>
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <ProduceModal open={registerOpen} onClose={() => setRegisterOpen(false)} defaultSku={pendingSku} defaultSubcanal={channel}/>

      <ConfirmModal
        open={!!loteAEliminar}
        onClose={() => !borrando && setLoteAEliminar(null)}
        title="Eliminar lote"
        message={loteAEliminar
          ? `Vas a eliminar el lote "${loteAEliminar.archivo}" y todas sus órdenes (${loteAEliminar.cantidad} uds.). El faltante se va a recalcular. Esta acción NO se puede deshacer.`
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
