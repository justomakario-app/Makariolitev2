/* ══ CASH FLOW PAGE (S2.16, Fase 7 Contabilidad)
   Dashboard standalone con flujo de caja real + proyectado, 4
   categorias (Compras / Sueldos / Cheques / Otros).

   Switcher Día/Mes agrupa en frontend.
   Toggle "Incluir proyectado" pasa al RPC + filtra visualmente.
   Botón "+ Movimiento manual" abre CashFlowManualModal.
   Botones export PDF/Excel: deshabilitados con tooltip
   "Disponible en Etapa 3" (gráficos + exports vienen en S2.16 Etapa 3).

   Decisión Jefe: orders excluido del MVP por falta de columna monto.
   Las ventas se manejan como movimientos manuales o via cheques cobrados.
   ══ */

function CashFlowPage() {
  const toast = useToast();
  const A = window.ADMIN_DATA;

  /* Rango default: mes en curso */
  const today = new Date();
  const todayStr  = today.toISOString().slice(0, 10);
  const firstStr  = `${today.toISOString().slice(0, 7)}-01`;

  const [modo, setModo]             = useState('dia');       /* 'dia' | 'mes' */
  const [fechaDesde, setFechaDesde] = useState(firstStr);
  const [fechaHasta, setFechaHasta] = useState(todayStr);
  const [incluirProy, setIncluirProy] = useState(true);

  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const [manualList, setManualList]       = useState([]);
  const [loadingManual, setLoadingManual] = useState(false);
  const [showManualSection, setShowManualSection] = useState(false);
  const [showInactivos, setShowInactivos]         = useState(false);

  const [modalState, setModalState]           = useState(null);  /* {mode, initial?} */
  const [confirmDelete, setConfirmDelete]     = useState(null);

  /* S2.16 etapa 3: refs a los canvas para capturar como imagen
     vía canvas.toDataURL en el export PDF. */
  const canvasSaldoRef  = React.useRef(null);
  const canvasBarrasRef = React.useRef(null);
  const [companySettings, setCompanySettings] = useState(null);
  const [exportingPdf,  setExportingPdf]  = useState(false);
  const [exportingXlsx, setExportingXlsx] = useState(false);

  const reload = async () => {
    setLoading(true); setError(null);
    try {
      const p = await A.getCashFlow(fechaDesde, fechaHasta, incluirProy);
      setPayload(p);
    } catch (err) {
      setError(err.message || 'Error al cargar');
      toast.error(err.message || 'Error al cargar');
    } finally {
      setLoading(false);
    }
  };

  const reloadManual = async () => {
    setLoadingManual(true);
    try {
      const rows = await A.listCashFlowManual(fechaDesde, fechaHasta, null, showInactivos);
      setManualList(rows);
    } catch (err) {
      toast.error(err.message || 'Error cargando manuales');
    } finally {
      setLoadingManual(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [fechaDesde, fechaHasta, incluirProy]);

  useEffect(() => {
    if (showManualSection) reloadManual();
    /* eslint-disable-next-line */
  }, [showManualSection, showInactivos, fechaDesde, fechaHasta]);

  /* Carga lazy de company_settings (1 sola vez por sesión de la página).
     Best-effort: si falla, el export PDF usa fallbacks (razón social
     'MACARIO', resto vacío). */
  useEffect(() => {
    if (companySettings) return;
    let cancelled = false;
    A.getCompanySettings()
      .then(cs => { if (!cancelled && cs) setCompanySettings(cs); })
      .catch(_ => { /* silencioso */ });
    return () => { cancelled = true; };
    /* eslint-disable-next-line */
  }, []);

  /* Combinar real + proyectado y agrupar por modo */
  const filasMostrar = useMemo(() => {
    if (!payload) return [];
    const reales = Array.isArray(payload.filas) ? payload.filas : [];
    const proy   = (incluirProy && Array.isArray(payload.proyectado_filas)) ? payload.proyectado_filas : [];
    const combinado = [...reales];
    proy.forEach(p => {
      /* Proyectadas vienen con compras/sueldos/otros = 0; cheques es el monto */
      combinado.push({
        fecha: p.fecha,
        compras: 0, sueldos: 0, cheques: Number(p.cheques || p.total_dia || 0), otros: 0,
        total_dia: Number(p.total_dia || 0),
        saldo_acumulado: Number(p.saldo_acumulado || 0),
        clase: 'proyectado',
      });
    });
    combinado.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
    return modo === 'mes' ? A.groupRowsByMonth(combinado) : combinado;
  }, [payload, incluirProy, modo]);

  const kpis = (payload && payload.kpis) || {};
  const saldoAcumFinal = filasMostrar.length > 0
    ? Number(filasMostrar[filasMostrar.length - 1].saldo_acumulado || 0)
    : 0;

  const onDeleteManual = async () => {
    if (!confirmDelete) return;
    try {
      await A.deleteCashFlowManual(confirmDelete.id);
      toast.success('Movimiento eliminado');
      setConfirmDelete(null);
      await Promise.all([reload(), reloadManual()]);
    } catch (err) {
      toast.error(err.message || 'No se pudo eliminar');
    }
  };

  const captureCanvas = (canvas) => {
    if (!canvas) return null;
    try { return canvas.toDataURL('image/png'); }
    catch (err) {
      console.warn('[CashFlow] toDataURL failed:', err);
      return null;
    }
  };

  const onExportPdf = async () => {
    if (exportingPdf || !payload) return;
    if (!window.CashFlowPDF) { toast.error('PDF generator no está cargado'); return; }
    setExportingPdf(true);
    try {
      const chartImages = {
        saldo:  captureCanvas(canvasSaldoRef.current),
        barras: captureCanvas(canvasBarrasRef.current),
      };
      window.CashFlowPDF.generate({
        payload,
        companySettings,
        period: { desde: fechaDesde, hasta: fechaHasta, modo, incluirProy },
        filas:  filasMostrar,
        chartImages,
      }, { open: true });
      toast.success('PDF generado');
    } catch (err) {
      toast.error(err.message || 'No se pudo generar el PDF');
    } finally {
      setExportingPdf(false);
    }
  };

  const onExportXlsx = async () => {
    if (exportingXlsx || !payload) return;
    setExportingXlsx(true);
    try {
      A.exportCashFlowXlsx({
        payload,
        companySettings,
        period: { desde: fechaDesde, hasta: fechaHasta, modo, incluirProy },
        filas:  filasMostrar,
      });
      toast.success('Excel descargado');
    } catch (err) {
      toast.error(err.message || 'No se pudo exportar Excel');
    } finally {
      setExportingXlsx(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Cash Flow</div>
          <div className="page-sub">
            Flujo de caja {incluirProy ? 'real + proyectado' : 'real'} · {fechaDesde} → {fechaHasta}
          </div>
        </div>
      </div>

      {/* HEADER + filtros */}
      <div className="admin-tab-header cf-header">
        <div className="cf-switcher">
          <button className={`cf-switch-btn ${modo === 'dia' ? 'active' : ''}`} onClick={() => setModo('dia')}>Día</button>
          <button className={`cf-switch-btn ${modo === 'mes' ? 'active' : ''}`} onClick={() => setModo('mes')}>Mes</button>
        </div>
        <input type="date" className="filter-input" value={fechaDesde}
               onChange={e => setFechaDesde(e.target.value)}/>
        <span style={{color:'var(--ink-muted)'}}>→</span>
        <input type="date" className="filter-input" value={fechaHasta}
               onChange={e => setFechaHasta(e.target.value)}/>
        <label className="admin-toggle-inactive">
          <input type="checkbox" checked={incluirProy}
                 onChange={e => setIncluirProy(e.target.checked)}/>
          Incluir proyectado
        </label>
        <div style={{flex:1}}/>
        <button className="btn-ghost"
                onClick={onExportPdf}
                disabled={exportingPdf || !payload}>
          {exportingPdf ? 'Generando…' : (<><Icon n="download" s={13}/> PDF</>)}
        </button>
        <button className="btn-ghost"
                onClick={onExportXlsx}
                disabled={exportingXlsx || !payload}>
          {exportingXlsx ? 'Exportando…' : (<><Icon n="download" s={13}/> Excel</>)}
        </button>
        <button className="btn-primary"
                onClick={() => setModalState({ mode: 'create' })}>
          <Icon n="plus" s={13}/> Movimiento manual
        </button>
      </div>

      {loading ? (
        <div className="admin-empty-state"><span className="loader" style={{width:24, height:24}}/></div>
      ) : error ? (
        <div className="admin-empty-state">
          <Icon n="alert" s={28} c="var(--red)"/>
          <h3>Error al cargar</h3>
          <p>{error}</p>
          <button className="btn-ghost" onClick={reload}>
            <Icon n="refresh" s={13}/> Reintentar
          </button>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="kpi-grid kpi-grid-4">
            <div className="kpi-card">
              <div className="kpi-label">Total ingresos</div>
              <div className="kpi-value" style={{color: 'var(--green, #16a34a)'}}>
                {A.formatMoneyES(kpis.total_ingresos_real || 0)}
              </div>
              {incluirProy && Number(kpis.total_ingresos_proy) !== 0 && (
                <div className="kpi-sub">+ proy: {A.formatMoneyES(kpis.total_ingresos_proy)}</div>
              )}
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Total egresos</div>
              <div className="kpi-value" style={{color: 'var(--red, #dc2626)'}}>
                {A.formatMoneyES(kpis.total_egresos_real || 0)}
              </div>
              {incluirProy && Number(kpis.total_egresos_proy) !== 0 && (
                <div className="kpi-sub">+ proy: {A.formatMoneyES(kpis.total_egresos_proy)}</div>
              )}
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Saldo del período</div>
              <div className="kpi-value" style={{color: A.getSaldoColor(kpis.saldo_periodo_real)}}>
                {A.formatMoneyES(kpis.saldo_periodo_real || 0)}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Saldo acumulado{incluirProy ? ' (incl. proy.)' : ''}</div>
              <div className="kpi-value" style={{color: A.getSaldoColor(saldoAcumFinal)}}>
                {A.formatMoneyES(saldoAcumFinal)}
              </div>
            </div>
          </div>

          {/* Gráficos chart.js — grid 2 cols desktop, stack mobile */}
          {window.CashFlowChart && filasMostrar.length > 0 && (
            <div className="cf-charts-grid">
              <div className="cf-chart-wrap">
                <window.CashFlowChart
                  mode="line"
                  data={filasMostrar}
                  title="Saldo acumulado"
                  height={240}
                  onCanvasReady={(c) => { canvasSaldoRef.current = c; }}/>
              </div>
              <div className="cf-chart-wrap">
                <window.CashFlowChart
                  mode="bars"
                  data={filasMostrar}
                  title="Ingresos vs egresos"
                  height={240}
                  onCanvasReady={(c) => { canvasBarrasRef.current = c; }}/>
              </div>
            </div>
          )}

          {/* Tabla principal */}
          <window.CashFlowTable filas={filasMostrar} modo={modo}/>

          {/* Sección expandible de movimientos manuales (CRUD) */}
          <div className="cf-section-toggle">
            <button className="btn-ghost"
                    onClick={() => setShowManualSection(s => !s)}>
              <Icon n={showManualSection ? 'chev-down' : 'chev-right'} s={13}/>
              Movimientos manuales ({manualList.length})
            </button>
            {showManualSection && (
              <label className="admin-toggle-inactive" style={{marginLeft:12}}>
                <input type="checkbox" checked={showInactivos}
                       onChange={e => setShowInactivos(e.target.checked)}/>
                Incluir eliminados
              </label>
            )}
          </div>

          {showManualSection && (
            <div className="card cf-manual-card">
              {loadingManual ? (
                <div className="admin-empty-state"><span className="loader" style={{width:18, height:18}}/></div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Tipo</th>
                      <th>Concepto</th>
                      <th>Categoría</th>
                      <th style={{textAlign:'right'}}>Monto</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {manualList.map(m => {
                      const inactivo = m.activo === false;
                      return (
                        <tr key={m.id} className={inactivo ? 'row-inactive' : ''}>
                          <td>{A.formatDate(m.fecha)}</td>
                          <td>
                            <span className={`recibo-tipo-badge ${m.tipo === 'ingreso' ? 'recibo-tipo-sueldo' : 'recibo-tipo-adelanto'}`}>
                              {m.tipo}
                            </span>
                            {inactivo && <span className="badge-vencido" style={{marginLeft:6}}>eliminado</span>}
                          </td>
                          <td style={{fontWeight:600}}>{m.concepto}</td>
                          <td>{m.categoria || 'otros'}</td>
                          <td style={{textAlign:'right', fontWeight:600,
                                      color: m.tipo === 'ingreso' ? 'var(--green, #16a34a)' : 'var(--red, #dc2626)'}}>
                            {m.tipo === 'egreso' ? '-' : ''}{A.formatMoneyES(m.monto)}
                          </td>
                          <td className="cta-cte-actions">
                            {!inactivo && (
                              <>
                                <button className="btn-ghost-sm" title="Editar"
                                        onClick={() => setModalState({ mode: 'edit', initial: m })}>
                                  <Icon n="edit" s={12}/>
                                </button>
                                <button className="btn-ghost-sm danger" title="Eliminar"
                                        onClick={() => setConfirmDelete(m)}>
                                  <Icon n="trash" s={12}/>
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {manualList.length === 0 && (
                      <tr><td colSpan={6} style={{textAlign:'center', padding:'24px', color:'var(--ink-muted)'}}>
                        Sin movimientos manuales en este período
                      </td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}

      {modalState && window.CashFlowManualModal && (
        <window.CashFlowManualModal
          mode={modalState.mode}
          initial={modalState.initial}
          onClose={() => setModalState(null)}
          onSuccess={async () => {
            setModalState(null);
            await Promise.all([reload(), reloadManual()]);
          }}/>
      )}

      <window.ConfirmModal
        open={!!confirmDelete}
        title="Eliminar movimiento"
        message={confirmDelete
          ? `¿Eliminar "${confirmDelete.concepto}" del ${A.formatDate(confirmDelete.fecha)}? Soft delete: se marca como inactivo pero queda en el histórico.`
          : ''}
        confirmText="Eliminar" danger
        onClose={() => setConfirmDelete(null)}
        onConfirm={onDeleteManual}/>
    </div>
  );
}

window.CashFlowPage = CashFlowPage;
