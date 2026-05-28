/* ══ CIERRE REPORTE MODAL (Fase 8 etapa 3)
   Modal grande con reporte detallado de 1 cierre contable.
   - Header empresa + tipo + período + estado + cerrado_por/at.
   - 4 KPIs cards: apertura, ingresos, egresos, cierre.
   - Comparativa con período anterior + variación % por categoría.
   - Top 5 proveedores (del snapshot_jsonb).
   - Top 5 empleados (idem).
   - Botones: 📄 PDF (vía CierrePDF) + 📊 Excel (vía exportCierreXlsx).

   Graceful fallback: empty arrays + null safe + sin período anterior.

   Props: { cierreId, onClose }
   ══ */

function CierreReporteModal({ cierreId, onClose }) {
  const toast = useToast();
  const A = window.ADMIN_DATA;
  const Cmp = window.Modal;

  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [reporte, setReporte] = useState(null);
  const [companySettings, setCompanySettings] = useState(null);
  const [exportingPdf,  setExportingPdf]  = useState(false);
  const [exportingXlsx, setExportingXlsx] = useState(false);

  useEffect(() => {
    if (!cierreId) return;
    let cancelled = false;
    setLoading(true); setError(null);
    Promise.all([
      A.getReporteCierre(cierreId),
      companySettings ? Promise.resolve(companySettings) : A.getCompanySettings().catch(() => null),
    ])
      .then(([r, cs]) => {
        if (cancelled) return;
        setReporte(r);
        if (!companySettings && cs) setCompanySettings(cs);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err.message || 'No se pudo cargar el reporte');
        setLoading(false);
      });
    return () => { cancelled = true; };
    /* eslint-disable-next-line */
  }, [cierreId]);

  const onExportPdf = () => {
    if (exportingPdf || !reporte) return;
    if (!window.CierrePDF) { toast.error('CierrePDF no está cargado'); return; }
    setExportingPdf(true);
    try {
      window.CierrePDF.generate({ reporte, companySettings }, { open: true });
      toast.success('PDF generado');
    } catch (err) {
      toast.error(err.message || 'No se pudo generar el PDF');
    } finally {
      setExportingPdf(false);
    }
  };

  const onExportXlsx = () => {
    if (exportingXlsx || !reporte) return;
    setExportingXlsx(true);
    try {
      A.exportCierreXlsx({ reporte, companySettings });
      toast.success('Excel descargado');
    } catch (err) {
      toast.error(err.message || 'No se pudo exportar Excel');
    } finally {
      setExportingXlsx(false);
    }
  };

  const cierre   = reporte && reporte.cierre;
  const anterior = reporte && reporte.periodo_anterior;
  const snap     = cierre && cierre.snapshot_jsonb;
  const topProv  = (snap && Array.isArray(snap.top_proveedores)) ? snap.top_proveedores : [];
  const topEmpl  = (snap && Array.isArray(snap.top_empleados))   ? snap.top_empleados   : [];

  const tipoLabel  = cierre && (cierre.tipo === 'mensual' ? 'Mensual' : 'Anual');
  const estadoLbl  = cierre && (cierre.estado === 'cerrado' ? '🔒 Cerrado' : '🔓 Reabierto');

  return (
    <Cmp open={true}
         title={cierre ? `Reporte de Cierre · ${tipoLabel} · ${A.formatDate(cierre.periodo_desde)} → ${A.formatDate(cierre.periodo_hasta)}` : 'Reporte de Cierre'}
         onClose={onClose}
         size="lg"
         footer={
           <>
             <button className="btn-ghost" onClick={onClose}>Cerrar</button>
             <button className="btn-ghost" onClick={onExportXlsx} disabled={exportingXlsx || !reporte}>
               {exportingXlsx ? 'Exportando…' : (<><Icon n="download" s={13}/> Excel</>)}
             </button>
             <button className="btn-primary" onClick={onExportPdf} disabled={exportingPdf || !reporte}>
               {exportingPdf ? 'Generando…' : (<><Icon n="download" s={13}/> PDF</>)}
             </button>
           </>
         }>
      {loading ? (
        <div className="admin-empty-state"><span className="loader" style={{width:24, height:24}}/></div>
      ) : error ? (
        <div className="admin-empty-state">
          <Icon n="alert" s={28} c="var(--red)"/>
          <h3>Error al cargar el reporte</h3>
          <p>{error}</p>
        </div>
      ) : !snap ? (
        <div className="admin-empty-state">
          <Icon n="alert" s={28} c="var(--ink-muted)"/>
          <h3>Reporte no disponible</h3>
          <p>Este cierre no tiene snapshot guardado. Volvé a cerrar el período.</p>
        </div>
      ) : (
        <>
          {/* Header info */}
          <div className="cierre-rep-header">
            <span><strong>Estado:</strong> {estadoLbl}</span>
            <span><strong>Cerrado el:</strong> {cierre.cerrado_at ? new Date(cierre.cerrado_at).toLocaleString('es-AR') : '—'}</span>
            {cierre.estado === 'reabierto' && (
              <>
                <span style={{color:'var(--red, #dc2626)'}}>
                  <strong>Reabierto el:</strong> {cierre.reabierto_at ? new Date(cierre.reabierto_at).toLocaleString('es-AR') : '—'}
                </span>
                {cierre.motivo_reapertura && (
                  <div className="cierre-rep-motivo">
                    <strong>Motivo reapertura:</strong> {cierre.motivo_reapertura}
                  </div>
                )}
              </>
            )}
          </div>

          {/* KPIs grid */}
          <div className="kpi-grid kpi-grid-4">
            <div className="kpi-card">
              <div className="kpi-label">Saldo apertura</div>
              <div className="kpi-value">{A.formatMoneyES(cierre.saldo_apertura)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Total ingresos</div>
              <div className="kpi-value" style={{color:'var(--green, #16a34a)'}}>
                {A.formatMoneyES(cierre.total_ingresos)}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Total egresos</div>
              <div className="kpi-value" style={{color:'var(--red, #dc2626)'}}>
                {A.formatMoneyES(cierre.total_egresos)}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Saldo cierre</div>
              <div className="kpi-value" style={{color: A.getSaldoColor(cierre.saldo_cierre)}}>
                {A.formatMoneyES(cierre.saldo_cierre)}
              </div>
              <div className="kpi-sub">
                Acum. histórico: {A.formatMoneyES(cierre.saldo_acumulado_historico)}
              </div>
            </div>
          </div>

          {/* Comparativa */}
          <div className="historial-table-wrap">
            <div className="historial-table-title">Comparativa con período anterior</div>
            {anterior ? (
              <table className="data-table cierre-comparativa-table">
                <thead>
                  <tr>
                    <th>Categoría</th>
                    <th style={{textAlign:'right'}}>Período actual</th>
                    <th style={{textAlign:'right'}}>Período anterior</th>
                    <th style={{textAlign:'right'}}>Variación</th>
                  </tr>
                </thead>
                <tbody>
                  {['compras','sueldos','cheques','otros'].map(cat => {
                    const act = A.getCategoriaBreakdown(cierre,  cat);
                    const ant = A.getCategoriaBreakdown(anterior, cat);
                    const v   = A.calcularVariacion(act, ant);
                    return (
                      <tr key={cat}>
                        <td style={{textTransform:'capitalize'}}>{cat}</td>
                        <td style={{textAlign:'right', color: act < 0 ? 'var(--red, #dc2626)' : (act > 0 ? 'var(--green, #16a34a)' : undefined)}}>
                          {A.formatMoneyES(act)}
                        </td>
                        <td style={{textAlign:'right', color: ant < 0 ? 'var(--red, #dc2626)' : (ant > 0 ? 'var(--green, #16a34a)' : undefined)}}>
                          {A.formatMoneyES(ant)}
                        </td>
                        <td style={{textAlign:'right'}}>
                          <span className={`cierre-variacion cierre-variacion-${v.clase}`}>{v.texto}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="admin-empty-state" style={{padding:'14px'}}>
                <span style={{color:'var(--ink-muted)', fontStyle:'italic'}}>
                  Sin período anterior del mismo tipo para comparar.
                </span>
              </div>
            )}
          </div>

          {/* Top proveedores */}
          <div className="historial-table-wrap" style={{marginTop:14}}>
            <div className="historial-table-title">Top 5 proveedores</div>
            {topProv.length === 0 ? (
              <div className="admin-empty-state" style={{padding:'14px'}}>
                <span style={{color:'var(--ink-muted)', fontStyle:'italic'}}>
                  Sin movimientos de compras en el período.
                </span>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{width:40}}>#</th>
                    <th>Proveedor</th>
                    <th style={{textAlign:'right'}}>Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {topProv.slice(0, 5).map((p, idx) => (
                    <tr key={p.supplier_id || `unk-${idx}`}>
                      <td>{idx + 1}</td>
                      <td>{p.nombre || 'Sin proveedor'}</td>
                      <td style={{textAlign:'right', fontWeight:600}}>{A.formatMoneyES(p.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Top empleados */}
          <div className="historial-table-wrap" style={{marginTop:14}}>
            <div className="historial-table-title">Top 5 empleados (sueldos)</div>
            {topEmpl.length === 0 ? (
              <div className="admin-empty-state" style={{padding:'14px'}}>
                <span style={{color:'var(--ink-muted)', fontStyle:'italic'}}>
                  Sin recibos en el período.
                </span>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{width:40}}>#</th>
                    <th>Empleado</th>
                    <th style={{textAlign:'right'}}>Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {topEmpl.slice(0, 5).map((e, idx) => (
                    <tr key={e.employee_id || `unk-${idx}`}>
                      <td>{idx + 1}</td>
                      <td>{e.nombre || '—'}</td>
                      <td style={{textAlign:'right', fontWeight:600}}>{A.formatMoneyES(e.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {cierre.notas && (
            <div style={{marginTop:14}}>
              <strong>Notas del cierre:</strong>
              <div style={{color:'var(--ink-soft)', marginTop:4}}>{cierre.notas}</div>
            </div>
          )}
        </>
      )}
    </Cmp>
  );
}

window.CierreReporteModal = CierreReporteModal;
