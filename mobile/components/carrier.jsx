/* ══ MOBILE CARRIER — vista compacta de un canal ══ */

function CarrierPage({ channel, onBack }) {
  const M = window.useMockData();
  const C = window.CARRIERS[channel];
  const data = M.carriers[channel];
  const [registerOpen, setRegisterOpen] = useState(false);
  const [pendingSku, setPendingSku] = useState(null);

  if (!data || !C) return null;

  const empty = data.kpis.activos === 0 && data.table.length === 0;

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
            <Icon n={channel==='colecta'?'truck':channel==='flex'?'package':channel==='tiendanube'?'box':'users'} s={16}/>
          </div>
          <div style={{minWidth:0}}>
            <div style={{fontSize:15, fontWeight:800, letterSpacing:'-.02em'}}>{C.label}</div>
            <div style={{fontSize:10, color:'var(--ink-muted)', fontWeight:600}}>{C.sub}</div>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="m-kpi-row" style={{marginTop:0}}>
        <div className="m-kpi" style={{borderLeft:`3px solid ${C.color}`}}>
          <div className="m-kpi-label">Pedidos</div>
          <div className="m-kpi-value">{data.kpis.activos}</div>
        </div>
        <div className="m-kpi">
          <div className="m-kpi-label">Unidades</div>
          <div className="m-kpi-value">{data.kpis.unidades}</div>
        </div>
        <div className="m-kpi" style={{borderLeft: data.kpis.pendiente>0?'3px solid var(--red)':'3px solid var(--green)'}}>
          <div className="m-kpi-label">Pendiente</div>
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
      </div>

      <ProduceModal open={registerOpen} onClose={() => setRegisterOpen(false)} defaultSku={pendingSku} defaultSubcanal={channel}/>
    </div>
  );
}

window.CarrierPage = CarrierPage;
