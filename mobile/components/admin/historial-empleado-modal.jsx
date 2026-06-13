/* ══ HISTORIAL EMPLEADO MODAL (S2.15)
   Modal grande individual con histórico salarial completo del empleado:
   - Header con datos del empleado (snapshot).
   - 4 KPIs cards: total año, mes actual, promedio mensual, count.
   - Filtros: año (default actual), mes opcional, tipo opcional.
   - Gráfico stacked bars por mes con breakdown por tipo.
   - Tabla recibos del año (filtrable, solo lectura).
   - Botón "Exportar Excel".

   Datos:
   - Payload completo (KPIs + por_mes + recibos del año) → rpc_admin_historial_empleado.
   - Recibos filtrados (por mes/tipo) → rpc_admin_recibos_detalle_empleado.

   Props: { employeeId, onClose }
   ══ */

function HistorialEmpleadoModal({ employeeId, onClose }) {
  const toast = useToast();
  const A = window.ADMIN_DATA;
  const Cmp = window.Modal;

  const currentYear = new Date().getFullYear();
  const [year, setYear]   = useState(currentYear);
  const [mes, setMes]     = useState('todos');
  const [tipo, setTipo]   = useState('todos');

  const [payload, setPayload]         = useState(null);   /* RPC historial_empleado */
  const [recibosFiltered, setRecibosFiltered] = useState(null); /* RPC recibos_detalle_empleado */
  const [companySettings, setCompanySettings] = useState(null);
  const [loading, setLoading]         = useState(true);
  const [loadingFiltered, setLoadingFiltered] = useState(false);
  const [error, setError]             = useState(null);

  /* Carga inicial: payload completo + company_settings (para PDFs). */
  useEffect(() => {
    if (!employeeId) return;
    let cancelled = false;
    setLoading(true); setError(null);
    Promise.all([
      A.getHistorialEmpleado(employeeId, year),
      companySettings ? Promise.resolve(companySettings) : A.getCompanySettings(),
    ])
      .then(([h, cs]) => {
        if (cancelled) return;
        setPayload(h);
        if (!companySettings && cs) setCompanySettings(cs);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err.message || 'Error al cargar histórico');
        setLoading(false);
      });
    return () => { cancelled = true; };
    /* eslint-disable-next-line */
  }, [employeeId, year]);

  /* Recarga recibos filtrados cuando cambian mes/tipo. Si "todos", usa
     los recibos del payload completo (sin re-fetch). */
  useEffect(() => {
    if (!employeeId || !payload) return;
    if (mes === 'todos' && tipo === 'todos') {
      setRecibosFiltered(null); /* usa payload.recibos */
      return;
    }
    let cancelled = false;
    setLoadingFiltered(true);
    A.getRecibosDetalleEmpleado(
      employeeId,
      year,
      mes === 'todos' ? null : Number(mes),
      tipo === 'todos' ? null : tipo,
    )
      .then(rows => {
        if (cancelled) return;
        setRecibosFiltered(rows);
        setLoadingFiltered(false);
      })
      .catch(err => {
        if (cancelled) return;
        toast.error(err.message || 'Error al filtrar');
        setLoadingFiltered(false);
      });
    return () => { cancelled = true; };
    /* eslint-disable-next-line */
  }, [mes, tipo, payload]);

  const recibosToShow = recibosFiltered != null
    ? recibosFiltered
    : (payload && Array.isArray(payload.recibos) ? payload.recibos : []);

  const empleado = (payload && payload.empleado) || {};
  const totales  = (payload && payload.totales)  || {};
  const porMes   = (payload && Array.isArray(payload.por_mes)) ? payload.por_mes : [];

  const onPdf = (recibo) => {
    if (!window.ReciboPDF) { toast.error('pdfmake no está cargado'); return; }
    try {
      window.ReciboPDF.generate(recibo, companySettings, { open: true });
    } catch (err) {
      toast.error(err.message || 'No se pudo generar PDF');
    }
  };

  const onExport = () => {
    if (!payload) return;
    try {
      A.exportHistorialEmpleadoXlsx({
        empleado,
        totales,
        recibos: recibosToShow,
        year,
      });
      toast.success('Excel descargado');
    } catch (err) {
      toast.error(err.message || 'No se pudo exportar');
    }
  };

  /* Opciones filtros */
  const years = useMemo(() => {
    const arr = [];
    for (let y = currentYear; y >= currentYear - 5; y--) arr.push(y);
    return arr;
    /* eslint-disable-next-line */
  }, []);

  const mesesOpts = [{ value: 'todos', label: 'Mes: todos' }]
    .concat((A.MES_NAMES_ES || []).map((name, i) => ({ value: String(i + 1), label: name })));

  const tipoOpts = [{ value: 'todos', label: 'Tipo: todos' }]
    .concat((A.RECIBO_TIPO_OPTIONS || []).map(o => ({ value: o.value, label: o.label })));

  const headerSnapshot = empleado.id ? (
    <div className="historial-snapshot">
      <span><strong>DNI:</strong> {empleado.dni || '—'}</span>
      <span><strong>Categoría:</strong> {empleado.categoria || '—'}</span>
      <span><strong>F. ingreso:</strong> {A.formatDate(empleado.fecha_ingreso)}</span>
      {empleado.lugar_trabajo && <span><strong>Lugar:</strong> {empleado.lugar_trabajo}</span>}
      {empleado.activo === false && <span className="badge-vencido">inactivo</span>}
    </div>
  ) : null;

  return (
    <Cmp open={true}
         title={`Histórico de ${empleado.nombre || '(cargando…)'}`}
         onClose={onClose}
         size="lg"
         footer={
           <>
             <button className="btn-ghost" onClick={onClose}>Cerrar</button>
             <button className="btn-primary" onClick={onExport} disabled={!payload || loading}>
               <Icon n="download" s={13}/> Exportar Excel
             </button>
           </>
         }>
      {loading ? (
        <div className="admin-empty-state"><span className="loader" style={{width:24, height:24}}/></div>
      ) : error ? (
        <div className="admin-empty-state">
          <Icon n="alert" s={28} c="var(--red)"/>
          <h3>Error al cargar</h3>
          <p>{error}</p>
        </div>
      ) : payload ? (
        <>
          {headerSnapshot}

          {/* KPIs */}
          <div className="kpi-grid kpi-grid-4">
            <div className="kpi-card">
              <div className="kpi-label">Total año {year}</div>
              <div className="kpi-value">{A.formatMoney(totales.year_total || 0, 'ARS')}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Mes actual</div>
              <div className="kpi-value">{A.formatMoney(totales.month_total || 0, 'ARS')}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Promedio mensual</div>
              <div className="kpi-value">{A.formatMoney(totales.avg_monthly || 0, 'ARS')}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Cant. recibos</div>
              <div className="kpi-value">{totales.count_recibos || 0}</div>
            </div>
          </div>

          {/* Filtros */}
          <div className="historial-filters">
            <select className="filter-select" value={year}
                    onChange={e => setYear(Number(e.target.value))}>
              {years.map(y => <option key={y} value={y}>Año {y}</option>)}
            </select>
            <select className="filter-select" value={mes}
                    onChange={e => setMes(e.target.value)}>
              {mesesOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select className="filter-select" value={tipo}
                    onChange={e => setTipo(e.target.value)}>
              {tipoOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* Gráfico */}
          {window.HistorialChart && (
            <div className="historial-chart-wrap">
              <div className="historial-chart-title">Evolución mensual por tipo</div>
              <window.HistorialChart mode="monthly" data={porMes} height={220}/>
            </div>
          )}

          {/* Tabla recibos */}
          <div className="historial-table-wrap">
            <div className="historial-table-title">
              Recibos {mes !== 'todos' ? `· ${A.getMonthName(Number(mes))}` : ''} {tipo !== 'todos' ? `· ${tipo}` : ''}
              {loadingFiltered && <span className="loader" style={{width:12, height:12, marginLeft:8, verticalAlign:'middle'}}/>}
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Período</th>
                  <th>F. pago</th>
                  <th style={{textAlign:'right'}}>Básico</th>
                  <th style={{textAlign:'right'}}>Total</th>
                  <th>Notas</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {recibosToShow.map(r => (
                  <window.HistorialEmpleadoRow
                    key={r.id}
                    recibo={r}
                    companySettings={companySettings}
                    onPdf={onPdf}/>
                ))}
                {recibosToShow.length === 0 && (
                  <tr><td colSpan={7} style={{textAlign:'center', padding:'24px', color:'var(--ink-muted)'}}>
                    Sin recibos en este período
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </Cmp>
  );
}

window.HistorialEmpleadoModal = HistorialEmpleadoModal;
