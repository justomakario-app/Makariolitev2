/* ══ REPORTES TAB (S2.15)
   Tab global con KPIs comparativos + gráfico horizontal por empleado +
   tabla resumen ordenable + export Excel multi-sheet (cap 30 detalle).

   Datos: rpc_admin_reportes_global(year, mes).
   Click "Detalle" en una fila → abre HistorialEmpleadoModal para ese empleado.
   ══ */

function ReportesTab() {
  const toast = useToast();
  const A = window.ADMIN_DATA;

  const currentYear = new Date().getFullYear();
  const [year, setYear]     = useState(currentYear);
  const [mes, setMes]       = useState('todos');
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [exporting, setExporting] = useState(false);

  const [sortKey, setSortKey] = useState('total_year');
  const [sortDir, setSortDir] = useState('desc');

  const [historialEmployeeId, setHistorialEmployeeId] = useState(null);

  const reload = async () => {
    setLoading(true); setError(null);
    try {
      const p = await A.getReportesGlobal(year, mes === 'todos' ? null : Number(mes));
      setPayload(p);
    } catch (err) {
      setError(err.message || 'Error al cargar');
      toast.error(err.message || 'Error al cargar');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [year, mes]);

  const tabla = (payload && Array.isArray(payload.tabla)) ? payload.tabla : [];
  const kpis  = (payload && payload.kpis) || {};

  const sortedTabla = useMemo(() => {
    if (!tabla.length) return [];
    const arr = [...tabla];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      if (av == null) av = '';
      if (bv == null) bv = '';
      if (av < bv) return -1 * dir;
      if (av > bv) return  1 * dir;
      return 0;
    });
    return arr;
  }, [tabla, sortKey, sortDir]);

  const onSort = (key) => {
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'nombre' || key === 'categoria' ? 'asc' : 'desc');
    }
  };

  const sortIcon = (key) => {
    if (key !== sortKey) return null;
    return <Icon n={sortDir === 'asc' ? 'chev-up' : 'chev-down'} s={11}/>;
  };

  /* Comparison data para chart: top 10 empleados con recibos en el año */
  const comparativeData = useMemo(() => {
    return sortedTabla
      .filter(t => Number(t.total_year) > 0)
      .slice(0, 10);
  }, [sortedTabla]);

  /* Si solo hay 1 empleado con recibos → top === low */
  const onlyOneWithRecibos = useMemo(() => {
    const t = kpis.top_employee, l = kpis.low_employee;
    return !!(t && l && t.employee_id === l.employee_id);
  }, [kpis]);

  const onExport = async () => {
    if (exporting || !payload) return;
    setExporting(true);
    try {
      /* Enriquecer la tabla con recibos detallados (hasta el cap 30
         para evitar fetches masivos). */
      const cap = (A.REPORTES_GLOBAL_DETAIL_CAP || 30);
      const detallables = tabla
        .filter(t => Number(t.count_recibos_year || 0) > 0)
        .slice(0, cap);

      const fetched = await Promise.all(detallables.map(async (t) => {
        try {
          const recibos = await A.getRecibosDetalleEmpleado(t.employee_id, year, null, null);
          return { ...t, _recibos: recibos };
        } catch (_) {
          return { ...t, _recibos: null };
        }
      }));

      /* Map por employee_id para mergear de vuelta a la tabla completa */
      const byId = new Map(fetched.map(t => [t.employee_id, t]));
      const enrichedTabla = tabla.map(t => byId.get(t.employee_id) || t);

      const result = A.exportReportesGlobalXlsx({
        ...payload,
        tabla: enrichedTabla,
      });
      if (result && result.truncated) {
        toast.success(`Excel descargado (top ${cap} con detalle, resto solo en Resumen)`);
      } else {
        toast.success('Excel descargado');
      }
    } catch (err) {
      toast.error(err.message || 'No se pudo exportar');
    } finally {
      setExporting(false);
    }
  };

  const years = useMemo(() => {
    const arr = [];
    for (let y = currentYear; y >= currentYear - 5; y--) arr.push(y);
    return arr;
    /* eslint-disable-next-line */
  }, []);

  const mesesOpts = [{ value: 'todos', label: 'Mes: todos' }]
    .concat((A.MES_NAMES_ES || []).map((name, i) => ({ value: String(i + 1), label: name })));

  const openHistorial = (employeeId) => setHistorialEmployeeId(employeeId);

  return (
    <div>
      <div className="admin-tab-header">
        <select className="filter-select" value={year}
                onChange={e => setYear(Number(e.target.value))}>
          {years.map(y => <option key={y} value={y}>Año {y}</option>)}
        </select>
        <select className="filter-select" value={mes}
                onChange={e => setMes(e.target.value)}>
          {mesesOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div style={{flex:1}}/>
        <button className="btn-primary" onClick={onExport}
                disabled={exporting || !payload || tabla.length === 0}>
          {exporting ? 'Generando…' : (<><Icon n="download" s={13}/> Exportar Excel</>)}
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
          <div className="kpi-grid kpi-grid-5">
            <div className="kpi-card">
              <div className="kpi-label">Total año {year}</div>
              <div className="kpi-value">{A.formatMoney(kpis.total_year || 0, 'ARS')}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">{mes === 'todos' ? 'Total mes' : `Total ${A.getMonthName(Number(mes))}`}</div>
              <div className="kpi-value">{kpis.total_month != null ? A.formatMoney(kpis.total_month, 'ARS') : '—'}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Promedio / empleado</div>
              <div className="kpi-value">{A.formatMoney(kpis.avg_per_employee || 0, 'ARS')}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">
                Top {onlyOneWithRecibos && <span className="kpi-badge-unico">único</span>}
              </div>
              <div className="kpi-value kpi-value-sm">{kpis.top_employee ? kpis.top_employee.nombre : '—'}</div>
              <div className="kpi-sub">
                {kpis.top_employee ? A.formatMoney(kpis.top_employee.total_year || 0, 'ARS') : ''}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">
                Low {onlyOneWithRecibos && <span className="kpi-badge-unico">único</span>}
              </div>
              <div className="kpi-value kpi-value-sm">{kpis.low_employee ? kpis.low_employee.nombre : '—'}</div>
              <div className="kpi-sub">
                {kpis.low_employee ? A.formatMoney(kpis.low_employee.total_year || 0, 'ARS') : ''}
              </div>
            </div>
          </div>

          {/* Gráfico comparativo */}
          {window.HistorialChart && comparativeData.length > 0 && (
            <div className="historial-chart-wrap">
              <div className="historial-chart-title">
                Comparativo por empleado · {comparativeData.length} {comparativeData.length === 1 ? 'empleado' : 'empleados'} top
              </div>
              <window.HistorialChart
                mode="comparative"
                data={comparativeData}
                height={Math.max(180, comparativeData.length * 38)}/>
            </div>
          )}

          {/* Tabla resumen */}
          <div className="card">
            <table className="data-table sortable">
              <thead>
                <tr>
                  <th className="sortable-th" onClick={() => onSort('nombre')}>
                    Empleado {sortIcon('nombre')}
                  </th>
                  <th className="sortable-th" onClick={() => onSort('categoria')}>
                    Categoría {sortIcon('categoria')}
                  </th>
                  <th className="sortable-th" style={{textAlign:'right'}} onClick={() => onSort('total_year')}>
                    Total año {sortIcon('total_year')}
                  </th>
                  <th className="sortable-th" style={{textAlign:'right'}} onClick={() => onSort('total_month')}>
                    {mes === 'todos' ? 'Total mes' : `Total ${A.getMonthName(Number(mes))}`} {sortIcon('total_month')}
                  </th>
                  <th className="sortable-th" style={{textAlign:'right'}} onClick={() => onSort('count_recibos_year')}>
                    # Recibos {sortIcon('count_recibos_year')}
                  </th>
                  <th>Último recibo</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sortedTabla.map(t => {
                  const ult = t.ultimo_recibo;
                  return (
                    <tr key={t.employee_id}>
                      <td style={{fontWeight:600}}>{t.nombre || '—'}</td>
                      <td>{t.categoria || '—'}</td>
                      <td style={{textAlign:'right', fontWeight:600}}>
                        {A.formatMoney(t.total_year || 0, 'ARS')}
                      </td>
                      <td style={{textAlign:'right'}}>
                        {A.formatMoney(t.total_month || 0, 'ARS')}
                      </td>
                      <td style={{textAlign:'right'}}>{t.count_recibos_year || 0}</td>
                      <td>
                        {ult
                          ? <span>{ult.tipo} · {A.formatDate(ult.fecha_pago)} · {A.formatMoney(ult.total || 0, 'ARS')}</span>
                          : <span style={{color:'var(--ink-muted)'}}>—</span>}
                      </td>
                      <td>
                        <button className="btn-ghost-sm"
                                title="Ver histórico"
                                onClick={() => openHistorial(t.employee_id)}>
                          Detalle <Icon n="arrow-right" s={11}/>
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {sortedTabla.length === 0 && (
                  <tr><td colSpan={7} style={{textAlign:'center', padding:'24px', color:'var(--ink-muted)'}}>
                    Sin empleados con recibos en este período
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="admin-tab-footer">
            {sortedTabla.length} empleado{sortedTabla.length === 1 ? '' : 's'} activo{sortedTabla.length === 1 ? '' : 's'}
          </div>
        </>
      )}

      {historialEmployeeId && window.HistorialEmpleadoModal && (
        <window.HistorialEmpleadoModal
          employeeId={historialEmployeeId}
          onClose={() => setHistorialEmployeeId(null)}/>
      )}
    </div>
  );
}

window.ReportesTab = ReportesTab;
