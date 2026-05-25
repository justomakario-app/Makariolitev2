/* ══ SUPPLIER HISTORIAL (S2.2)
   Componente lazy-mount que se monta cuando se expande el bloque 4
   de SupplierModal. Consume rpc_admin_get_supplier_historial via
   window.ADMIN_DATA.getSupplierHistorial(supplierId).

   Renderiza:
     - Summary: total egresos + sum egresos + count cheques + saldo cta cte.
     - Top 5 egresos (fecha / concepto / monto / categoria).
     - Top 10 cheques (numero / banco / monto / estado / fecha).
     - Top 10 movements de cta cte (fecha / tipo / monto / concepto).

   Props: { supplierId }
   ══ */

function SupplierHistorial({ supplierId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const A = window.ADMIN_DATA;

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setData(null);
    A.getSupplierHistorial(supplierId)
      .then(d => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(e => { if (!cancelled) { setError(e.message || 'Error'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [supplierId]);

  if (loading) {
    return (
      <div className="supplier-historial-state">
        <span className="loader" style={{width:20, height:20}}/>
        <span>Cargando historial…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="supplier-historial-state error">
        <Icon n="alert" s={16} c="var(--red)"/>
        <span>{error}</span>
      </div>
    );
  }
  if (!data) return null;

  const egresos    = Array.isArray(data.ultimos_egresos)   ? data.ultimos_egresos   : [];
  const cheques    = Array.isArray(data.cheques)           ? data.cheques           : [];
  const movements  = Array.isArray(data.ultimos_movements) ? data.ultimos_movements : [];

  return (
    <div className="supplier-historial">
      {/* ── Summary ── */}
      <div className="supplier-historial-summary">
        <div className="supplier-historial-stat">
          <div className="supplier-historial-stat-label">Egresos totales</div>
          <div className="supplier-historial-stat-value">{data.total_egresos || 0}</div>
          <div className="supplier-historial-stat-sub">
            {A.formatMoney(data.suma_egresos || 0, 'ARS')}
          </div>
        </div>
        <div className="supplier-historial-stat">
          <div className="supplier-historial-stat-label">Cheques emitidos</div>
          <div className="supplier-historial-stat-value">{data.count_cheques || 0}</div>
        </div>
        <div className="supplier-historial-stat">
          <div className="supplier-historial-stat-label">Saldo cta cte</div>
          <div className="supplier-historial-stat-value">
            {A.formatMoney(data.saldo || 0, 'ARS')}
          </div>
        </div>
      </div>

      {/* ── Top 5 egresos ── */}
      <div className="supplier-historial-block">
        <div className="supplier-historial-block-title">Ultimos egresos</div>
        {egresos.length === 0 ? (
          <div className="supplier-historial-empty">Sin egresos registrados.</div>
        ) : (
          <table className="supplier-historial-table">
            <thead>
              <tr><th>Fecha</th><th>Concepto</th><th>Categoria</th><th style={{textAlign:'right'}}>Monto</th></tr>
            </thead>
            <tbody>
              {egresos.map(e => (
                <tr key={e.id}>
                  <td>{A.formatDate(e.fecha)}</td>
                  <td>{e.concepto || '—'}</td>
                  <td><span className="supplier-historial-pill">{e.categoria || '—'}</span></td>
                  <td style={{textAlign:'right', fontWeight:600}}>
                    {A.formatMoney(e.monto_total, e.moneda || 'ARS')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Top 10 cheques ── */}
      <div className="supplier-historial-block">
        <div className="supplier-historial-block-title">Ultimos cheques emitidos</div>
        {cheques.length === 0 ? (
          <div className="supplier-historial-empty">Sin cheques registrados.</div>
        ) : (
          <table className="supplier-historial-table">
            <thead>
              <tr><th>Numero</th><th>Banco</th><th>Estado</th><th>Emision</th><th>Cobro estim.</th><th style={{textAlign:'right'}}>Monto</th></tr>
            </thead>
            <tbody>
              {cheques.map(c => (
                <tr key={c.id}>
                  <td><span className="order-num">{c.numero}</span></td>
                  <td>{c.banco}</td>
                  <td><span className={`check-status-pill estado-${c.estado || 'emitido'}`}>{c.estado || 'emitido'}</span></td>
                  <td>{A.formatDate(c.fecha_emision)}</td>
                  <td>{A.formatDate(c.fecha_cobro_estimada)}</td>
                  <td style={{textAlign:'right', fontWeight:600}}>
                    {A.formatMoney(c.monto, 'ARS')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Top 10 movements ── */}
      <div className="supplier-historial-block">
        <div className="supplier-historial-block-title">Ultimos movimientos cta cte</div>
        {movements.length === 0 ? (
          <div className="supplier-historial-empty">Sin movimientos en cta cte.</div>
        ) : (
          <table className="supplier-historial-table">
            <thead>
              <tr><th>Fecha</th><th>Tipo</th><th>Concepto</th><th style={{textAlign:'right'}}>Monto</th></tr>
            </thead>
            <tbody>
              {movements.map(m => (
                <tr key={m.id}>
                  <td>{A.formatDate(m.fecha)}</td>
                  <td>
                    <span className="supplier-historial-pill">{m.tipo}</span>
                    {m.es_automatico && <span className="supplier-historial-pill auto" style={{marginLeft:4}}>auto</span>}
                  </td>
                  <td>{m.concepto || '—'}</td>
                  <td style={{textAlign:'right', fontWeight:600}}>
                    {A.formatMoney(m.monto, 'ARS')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

window.SupplierHistorial = SupplierHistorial;
