/* ══ RECIBOS TAB (S2.12)
   Listado + filtros + alta/edit/anular/delete + generación de PDFs
   (individual y lote por período).

   Patrón heredado: ChecksTab + EmployeesTab.
   SELECT directo (reusa RLS owner_or_admin).
   PDFs vía window.ReciboPDF (helper sin JSX).
   ══ */

function RecibosTab() {
  const toast = useToast();
  const A = window.ADMIN_DATA;

  const [items, setItems]             = useState([]);
  const [companySettings, setCompanySettings] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [tipoFilter, setTipoFilter]   = useState('todos');
  const [employeeFilter, setEmployeeFilter] = useState('todos');
  const [mes, setMes]                 = useState(() => new Date().toISOString().slice(0, 7));
  const [showAnulados, setShowAnulados] = useState(false);

  const [modalState, setModalState]   = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmAnular, setConfirmAnular] = useState(null);
  const [loteModalOpen, setLoteModalOpen] = useState(false);

  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [actionRunning, setActionRunning] = useState(false);

  const reload = async () => {
    setLoading(true); setError(null);
    try {
      const [recibos, cs] = await Promise.all([
        A.loadRecibos({ includeAnulados: showAnulados }),
        companySettings ? Promise.resolve(companySettings) : A.getCompanySettings(),
      ]);
      setItems(recibos);
      if (!companySettings && cs) setCompanySettings(cs);
    } catch (err) {
      setError(err.message || 'Error al cargar');
      toast.error(err.message || 'Error al cargar');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [showAnulados]);

  const empleadosDisponibles = useMemo(() => {
    const map = new Map();
    items.forEach(it => {
      const key = it.employee_id || `__snapshot_${it.empleado_cuil || it.empleado_nombre}`;
      if (!map.has(key)) {
        map.set(key, { id: key, nombre: it.empleado_nombre || '—', cuil: it.empleado_cuil || '' });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [items]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const mesYear = mes; /* YYYY-MM */
    return items.filter(it => {
      if (tipoFilter !== 'todos' && it.tipo !== tipoFilter) return false;
      if (employeeFilter !== 'todos') {
        const key = it.employee_id || `__snapshot_${it.empleado_cuil || it.empleado_nombre}`;
        if (key !== employeeFilter) return false;
      }
      if (mesYear) {
        const fp = String(it.fecha_pago || '').slice(0, 7);
        if (fp !== mesYear) return false;
      }
      if (q) {
        const blob = `${it.empleado_nombre || ''} ${it.empleado_cuil || ''}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [items, searchQuery, tipoFilter, employeeFilter, mes]);

  const counts = useMemo(() => {
    const emitidos = items.filter(it => it.estado === 'emitido').length;
    const anulados = items.filter(it => it.estado === 'anulado').length;
    const totalMes = filtered
      .filter(it => it.estado === 'emitido')
      .reduce((acc, it) => acc + (Number(it.total) || 0), 0);
    return { emitidos, anulados, totalMes };
  }, [items, filtered]);

  /* PDFs */
  const generatePdfIndividual = async (recibo, opts) => {
    if (!window.ReciboPDF) { toast.error('pdfmake no está cargado'); return; }
    try {
      window.ReciboPDF.generate(recibo, companySettings, opts || {});
      /* Marcar pdf_generado_at en BD (solo si emitido) — best effort */
      if (recibo.estado === 'emitido' && !recibo.pdf_generado_at) {
        try {
          await A.updateRecibo({ id: recibo.id, pdf_generado_at: new Date().toISOString() });
        } catch (_) { /* silencioso */ }
      }
    } catch (err) {
      toast.error(err.message || 'No se pudo generar el PDF');
    }
  };

  const onGenerateAfterCreate = async (reciboId) => {
    if (!reciboId) return;
    const recibo = await A.getRecibo(reciboId);
    await generatePdfIndividual(recibo, { open: false });
  };

  const onAnular = async () => {
    if (actionRunning || !confirmAnular) return;
    setActionRunning(true);
    try {
      await A.anularRecibo({ id: confirmAnular.id });
      toast.success('Recibo anulado');
      setConfirmAnular(null);
      await reload();
    } catch (err) {
      toast.error(err.message || 'No se pudo anular');
    } finally {
      setActionRunning(false);
    }
  };

  const onDelete = async () => {
    if (actionRunning || !confirmDelete) return;
    setActionRunning(true);
    try {
      await A.deleteRecibo({ id: confirmDelete.id });
      toast.success('Recibo eliminado');
      setConfirmDelete(null);
      await reload();
    } catch (err) {
      toast.error(err.message || 'No se pudo eliminar');
    } finally {
      setActionRunning(false);
    }
  };

  const tipoOptionsAll = [{ value: 'todos', label: 'Tipo: todos' }]
    .concat((A.RECIBO_TIPO_OPTIONS || []).map(o => ({ value: o.value, label: o.label })));

  const noEmployeesYet = !loading && !error && items.length === 0;

  return (
    <div>
      {!loading && !error && (
        <div className="cta-cte-totals">
          <span><strong>Emitidos:</strong> {counts.emitidos}</span>
          {counts.anulados > 0 && <span><strong>Anulados:</strong> {counts.anulados}</span>}
          {mes && (
            <span>
              <strong>Total {mes}:</strong> {A.formatMoney(counts.totalMes, 'ARS')}
            </span>
          )}
        </div>
      )}

      <div className="admin-tab-header">
        <div className="admin-search">
          <Icon n="search" s={14} c="var(--ink-muted)"/>
          <input className="filter-input admin-search-input"
                 placeholder="Buscar empleado, CUIL…"
                 value={searchQuery}
                 onChange={e => setSearchQuery(e.target.value)}/>
        </div>
        <select className="filter-select" value={tipoFilter}
                onChange={e => setTipoFilter(e.target.value)}>
          {tipoOptionsAll.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="filter-select" value={employeeFilter}
                onChange={e => setEmployeeFilter(e.target.value)}>
          <option value="todos">Empleado: todos</option>
          {empleadosDisponibles.map(e => (
            <option key={e.id} value={e.id}>{e.nombre}{e.cuil ? ` · ${e.cuil}` : ''}</option>
          ))}
        </select>
        <input type="month" className="filter-input"
               value={mes} onChange={e => setMes(e.target.value)}
               title="Filtrar por mes (fecha de pago)"/>
        <label className="admin-toggle-inactive">
          <input type="checkbox" checked={showAnulados}
                 onChange={e => setShowAnulados(e.target.checked)}/>
          Incluir anulados
        </label>
        <button className="btn-ghost" onClick={() => setLoteModalOpen(true)}>
          <Icon n="download" s={13}/> PDFs del mes
        </button>
        <button className="btn-primary" onClick={() => setModalState({ mode: 'create' })}>
          <Icon n="plus" s={13}/> Nuevo recibo
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
      ) : noEmployeesYet ? (
        <div className="admin-empty-state">
          <Icon n="file-text" s={32} c="var(--ink-muted)"/>
          <h3>Todavía no hay recibos</h3>
          <p>Cargá adelantos, quincenas o sueldos mensuales para los empleados.</p>
          <button className="btn-primary" onClick={() => setModalState({ mode: 'create' })}>
            <Icon n="plus" s={13}/> Nuevo recibo
          </button>
        </div>
      ) : (
        <>
          <div className="card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Empleado</th>
                  <th>CUIL</th>
                  <th>Tipo</th>
                  <th>Período</th>
                  <th>F. pago</th>
                  <th style={{textAlign:'right'}}>Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <window.ReciboRow
                    key={r.id}
                    recibo={r}
                    companySettings={companySettings}
                    onEdit={(rec) => setModalState({ mode: 'edit', initial: rec })}
                    onAnular={(rec) => setConfirmAnular(rec)}
                    onDelete={(rec) => setConfirmDelete(rec)}
                    onPdf={(rec) => generatePdfIndividual(rec, { open: true })}/>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} style={{textAlign:'center', padding:'24px', color:'var(--ink-muted)'}}>
                    Sin resultados para los filtros aplicados
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="admin-tab-footer">
            {filtered.length === items.length
              ? `${items.length} recibo${items.length === 1 ? '' : 's'}`
              : `${filtered.length} de ${items.length}`}
          </div>
        </>
      )}

      {modalState && window.ReciboModal && (
        <window.ReciboModal
          mode={modalState.mode}
          initial={modalState.initial}
          onClose={() => setModalState(null)}
          onSuccess={async () => { setModalState(null); await reload(); }}
          onAfterCreatePdf={onGenerateAfterCreate}/>
      )}

      <window.ConfirmModal
        open={!!confirmAnular}
        title="Anular recibo"
        message={confirmAnular
          ? `¿Anular el recibo de ${confirmAnular.empleado_nombre} (${confirmAnular.tipo})? Quedará como histórico no editable.`
          : ''}
        confirmText="Anular" danger
        onClose={() => setConfirmAnular(null)}
        onConfirm={onAnular}/>

      <window.ConfirmModal
        open={!!confirmDelete}
        title="Eliminar recibo"
        message={confirmDelete
          ? `¿Eliminar físicamente el recibo de ${confirmDelete.empleado_nombre}? Para preservar histórico, preferí "Anular".`
          : ''}
        confirmText="Eliminar" danger
        onClose={() => setConfirmDelete(null)}
        onConfirm={onDelete}/>

      {loteModalOpen && (
        <RecibosLoteModal
          mes={mes}
          companySettings={companySettings}
          onClose={() => setLoteModalOpen(false)}/>
      )}
    </div>
  );
}

/* Modal interno para generar PDFs en lote por período. */
function RecibosLoteModal({ mes, companySettings, onClose }) {
  const toast = useToast();
  const A = window.ADMIN_DATA;
  const Cmp = window.Modal;
  const [desde, setDesde] = useState(() => {
    if (!mes) return '';
    return `${mes}-01`;
  });
  const [hasta, setHasta] = useState(() => {
    if (!mes) return '';
    const [y, m] = mes.split('-');
    const lastDay = new Date(Number(y), Number(m), 0).getDate();
    return `${mes}-${String(lastDay).padStart(2, '0')}`;
  });
  const [tipoFilter, setTipoFilter] = useState('todos');
  const [generating, setGenerating] = useState(false);

  const onGenerate = async () => {
    if (generating) return;
    if (!desde || !hasta) { toast.error('Rango de fechas requerido'); return; }
    if (!window.ReciboPDF) { toast.error('pdfmake no está cargado'); return; }
    setGenerating(true);
    try {
      const tipo = tipoFilter === 'todos' ? null : tipoFilter;
      const recibos = await A.listRecibosByPeriod(desde, hasta, tipo);
      if (!recibos || recibos.length === 0) {
        toast.error('No hay recibos emitidos en ese período');
        setGenerating(false);
        return;
      }
      window.ReciboPDF.generateLote(recibos, companySettings);
      toast.success(`${recibos.length} recibo${recibos.length === 1 ? '' : 's'} en PDF`);
      onClose?.();
    } catch (err) {
      toast.error(err.message || 'No se pudo generar el lote');
      setGenerating(false);
    }
  };

  const tipoOpts = [{ value: 'todos', label: 'Todos' }]
    .concat((A.RECIBO_TIPO_OPTIONS || []).map(o => ({ value: o.value, label: o.label })));

  return (
    <Cmp open={true} title="Generar PDFs del mes" onClose={onClose} footer={
      <>
        <button className="btn-ghost" onClick={onClose} disabled={generating}>Cancelar</button>
        <button className="btn-primary" onClick={onGenerate} disabled={generating}>
          {generating ? 'Generando…' : (<><Icon n="download" s={14}/> Generar</>)}
        </button>
      </>
    }>
      <div className="field-help" style={{marginBottom:12}}>
        Genera un único PDF con un recibo por página (page break entre cada uno).
        Solo entran los recibos en estado <strong>emitido</strong>.
      </div>

      <div className="supplier-modal-grid">
        <div className="field-group">
          <label className="field-label">Desde *</label>
          <input type="date" className="field-input"
                 value={desde} onChange={e => setDesde(e.target.value)}/>
        </div>
        <div className="field-group">
          <label className="field-label">Hasta *</label>
          <input type="date" className="field-input"
                 value={hasta} onChange={e => setHasta(e.target.value)}/>
        </div>
      </div>

      <div className="field-group">
        <label className="field-label">Tipo (opcional)</label>
        <select className="field-input" value={tipoFilter}
                onChange={e => setTipoFilter(e.target.value)}>
          {tipoOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    </Cmp>
  );
}

window.RecibosTab = RecibosTab;
