/* ══ BULK IMPORT EMPLOYEES MODAL (S2.11)
   Modal de carga masiva de empleados via .xlsx o .csv. Reusa
   window.XLSX (v0.18.5) y patron S2.4 (3 pantallas + processing
   intermedio + chunking 1000).

   Pantallas:
     1) upload  : dropzone + descarga plantilla
     2) preview : tabla con N filas + dropdown action en duplicados
     3) result  : summary + boton descargar reporte

   RRHH por DNI (pedido de Seba). Sinonimos 'cuil'/'cuit' tolerados en
   headers: si vienen 11 dígitos tomamos los 8 del medio (DNI).

   Props: { onClose, onSuccess }
   ══ */

const MAX_FILE_SIZE_EMP = 2 * 1024 * 1024;
const VALID_EXTENSIONS_EMP = ['.xlsx', '.xls', '.csv'];

function BulkImportEmployeesModal({ onClose, onSuccess }) {
  const toast = useToast();
  const [screen, setScreen] = useState('upload');
  const [parsing, setParsing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [rows, setRows] = useState([]);
  const [actions, setActions] = useState({});
  const [processing, setProcessing] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState(null);
  const fileInputRef = useRef(null);
  const A = window.ADMIN_DATA;

  const safeClose = () => {
    if (parsing || screen === 'processing') return;
    onClose?.();
  };

  const handleFile = async (file) => {
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!VALID_EXTENSIONS_EMP.some(ext => lower.endsWith(ext))) {
      toast.error('Formato no soportado. Solo .xlsx, .xls o .csv.');
      return;
    }
    if (file.size > MAX_FILE_SIZE_EMP) {
      toast.error(`Archivo demasiado grande (${(file.size/1024/1024).toFixed(1)} MB). Máximo 2 MB.`);
      return;
    }
    setParsing(true);
    try {
      const parsed = await A.parseEmployeesSpreadsheet(file);
      if (!parsed || parsed.length === 0) {
        toast.error('El archivo no tiene filas de datos.');
        setParsing(false);
        return;
      }
      const validated = parsed.map(r => A.validateEmployeeRow(r));

      const dnisToCheck = validated
        .filter(r => r.isValid && r.normalized.dni)
        .map(r => r.normalized.dni);
      let dup = { existing: [], not_existing: [] };
      if (dnisToCheck.length > 0) {
        dup = await A.checkDnisExist(dnisToCheck);
      }
      const existingByDni = {};
      for (const e of (dup.existing || [])) existingByDni[e.dni] = e;

      const finalRows = validated.map(r => {
        const match = r.isValid && r.normalized.dni ? existingByDni[r.normalized.dni] : null;
        return {
          ...r,
          isDuplicate: !!match,
          existingMatch: match || null,
        };
      });

      const defActions = {};
      for (const r of finalRows) {
        if (!r.isValid)         defActions[r.rowNum] = 'none';
        else if (r.isDuplicate) defActions[r.rowNum] = 'skip';
        else                    defActions[r.rowNum] = 'create';
      }

      setRows(finalRows);
      setActions(defActions);
      setScreen('preview');
    } catch (err) {
      toast.error(err.message || 'No se pudo parsear el archivo');
    } finally {
      setParsing(false);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (parsing) return;
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFile(file);
  };
  const onDragOver = (e) => { e.preventDefault(); if (!parsing) setDragOver(true); };
  const onDragLeave = () => setDragOver(false);

  const downloadTemplate = () => {
    try {
      A.downloadEmployeesTemplate();
      toast.success('Plantilla descargada');
    } catch (err) {
      toast.error(err.message || 'No se pudo generar plantilla');
    }
  };

  const setRowAction = (rowNum, newAction) => {
    setActions(s => ({ ...s, [rowNum]: newAction }));
  };

  const counts = useMemo(() => {
    let validas = 0, duplicados = 0, invalidas = 0, aImportar = 0;
    for (const r of rows) {
      if (!r.isValid)         invalidas++;
      else if (r.isDuplicate) duplicados++;
      else                    validas++;
      const a = actions[r.rowNum];
      if (a === 'create' || a === 'update') aImportar++;
    }
    return { validas, duplicados, invalidas, aImportar };
  }, [rows, actions]);

  const onImport = async () => {
    const creates = [];
    const updates = [];
    for (const r of rows) {
      const a = actions[r.rowNum];
      if (a === 'create' && r.isValid && !r.isDuplicate) {
        creates.push({ _rowNum: r.rowNum, _normalized: r.normalized, ...r.normalized });
      } else if (a === 'update' && r.isValid && r.isDuplicate && r.existingMatch) {
        updates.push({
          _rowNum: r.rowNum, _normalized: r.normalized,
          id: r.existingMatch.id,
          ...r.normalized,
          dni: r.normalized.dni,
        });
      }
    }

    if (creates.length === 0 && updates.length === 0) {
      toast.error('No hay filas para importar (todo Saltar/Inválido).');
      return;
    }

    setScreen('processing');
    setProcessing({ done: 0, total: creates.length + updates.length });

    let createsRes = { created: 0, errors: [] };
    let updatesRes = { updated: 0, errors: [] };
    try {
      if (creates.length > 0) {
        const payload = creates.map(c => { const o = { ...c }; delete o._rowNum; delete o._normalized; return o; });
        createsRes = await A.bulkCreateEmployees(payload, (done) => {
          setProcessing(s => ({ ...s, done }));
        });
      }
      if (updates.length > 0) {
        const payload = updates.map(u => { const o = { ...u }; delete o._rowNum; delete o._normalized; return o; });
        updatesRes = await A.bulkUpdateEmployees(payload, (done) => {
          setProcessing(s => ({ ...s, done: creates.length + done }));
        });
      }
    } catch (err) {
      toast.error(err.message || 'Error procesando batch');
    }

    const report = [];
    const createErrIdx = {}; (createsRes.errors || []).forEach(e => createErrIdx[e.index] = e);
    const updateErrIdx = {}; (updatesRes.errors || []).forEach(e => updateErrIdx[e.index] = e);

    creates.forEach((c, i) => {
      const err = createErrIdx[i];
      report.push({
        rowNum: c._rowNum,
        status: err ? 'Rechazado' : 'Creado',
        reason: err ? humanizeEmpReason(err) : '',
        ...c._normalized,
      });
    });
    updates.forEach((u, i) => {
      const err = updateErrIdx[i];
      report.push({
        rowNum: u._rowNum,
        status: err ? 'Rechazado' : 'Actualizado',
        reason: err ? humanizeEmpReason(err) : '',
        ...u._normalized,
      });
    });
    for (const r of rows) {
      const a = actions[r.rowNum];
      if (report.some(x => x.rowNum === r.rowNum)) continue;
      if (!r.isValid) {
        report.push({
          rowNum: r.rowNum, status: 'Inválido',
          reason: (r.errors || []).join(' · '),
          ...r.normalized,
        });
      } else if (a === 'skip') {
        report.push({
          rowNum: r.rowNum, status: 'Saltado',
          reason: 'Duplicado, marcado para saltar',
          ...r.normalized,
        });
      }
    }
    report.sort((a, b) => (a.rowNum || 0) - (b.rowNum || 0));

    setResult({
      creados:      createsRes.created || 0,
      actualizados: updatesRes.updated || 0,
      saltados:     report.filter(r => r.status === 'Saltado').length,
      rechazados:   report.filter(r => r.status === 'Rechazado').length,
      invalidas:    report.filter(r => r.status === 'Inválido').length,
      total:        rows.length,
      report,
    });
    setScreen('result');
    try { onSuccess?.(); } catch (_) {}
  };

  const onDownloadReport = () => {
    try {
      A.generateEmployeesBulkReportXlsx(result.report);
      toast.success('Reporte descargado');
    } catch (err) {
      toast.error(err.message || 'No se pudo generar reporte');
    }
  };

  const Cmp = window.Modal;

  return (
    <Cmp open={true}
         title="Importar empleados masivamente"
         onClose={safeClose}
         size="lg"
         footer={renderFooter()}>
      {screen === 'upload'     && renderUpload()}
      {screen === 'preview'    && renderPreview()}
      {screen === 'processing' && renderProcessing()}
      {screen === 'result'     && renderResult()}
    </Cmp>
  );

  function renderUpload() {
    return (
      <div>
        <div className={`bulk-dropzone ${dragOver ? 'is-dragover' : ''}`}
             onDrop={onDrop}
             onDragOver={onDragOver}
             onDragLeave={onDragLeave}
             onClick={() => !parsing && fileInputRef.current?.click()}>
          <input ref={fileInputRef}
                 type="file"
                 accept=".xlsx,.xls,.csv"
                 style={{display:'none'}}
                 onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleFile(f); }}/>
          <Icon n="upload" s={36} c="var(--ink-muted)"/>
          <div className="bulk-dropzone-title">
            {parsing ? 'Parseando archivo…' : 'Arrastrá un archivo .xlsx o .csv'}
          </div>
          <div className="bulk-dropzone-help">o hacé click · Máx 2 MB · ~5000 filas</div>
        </div>

        <div className="bulk-template-row">
          <button type="button" className="btn-ghost-sm" onClick={downloadTemplate}>
            <Icon n="download" s={12}/> Descargar plantilla.xlsx
          </button>
        </div>

        <div className="bulk-headers-help">
          <strong>Columnas esperadas (dni + nombre obligatorios):</strong>
          <div>
            dni*, nombre*, fecha_nacimiento, email, telefono, direccion,
            ciudad, provincia, codigo_postal, fecha_ingreso, categoria,
            modalidad, tipo_contratacion, lugar_trabajo, convenio,
            sueldo_bruto_base, dias_vacaciones_anuales, banco, cbu,
            alias_cbu, forma_cobro, notas
          </div>
          <div style={{marginTop:6, fontSize:11, color:'var(--ink-muted)'}}>
            * = obligatorios. DNI: 7 u 8 dígitos. Si pegás un CUIL/CUIT de 11, tomamos los 8 del medio.
            Modalidad: full_time/part_time/horas/eventual.
            Tipo contratación: relacion_dependencia/monotributo/autonomo/eventual.
          </div>
        </div>
      </div>
    );
  }

  function renderPreview() {
    return (
      <div>
        <div className="bulk-preview-summary">
          <span className="bulk-pill bulk-pill-valid">✓ {counts.validas} válidos</span>
          <span className="bulk-pill bulk-pill-duplicate">⚠ {counts.duplicados} duplicados</span>
          <span className="bulk-pill bulk-pill-invalid">✗ {counts.invalidas} inválidos</span>
        </div>
        <div className="bulk-preview-scroll">
          <table className="bulk-preview-table">
            <thead>
              <tr>
                <th style={{width:36}}>#</th>
                <th style={{width:86}}>Estado</th>
                <th style={{width:140}}>DNI</th>
                <th>Nombre</th>
                <th style={{width:140}}>Categoría</th>
                <th style={{width:120}}>Modalidad</th>
                <th style={{width:110}}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <window.BulkImportEmployeeRow
                  key={r.rowNum}
                  row={r}
                  action={actions[r.rowNum]}
                  onActionChange={a => setRowAction(r.rowNum, a)}/>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function renderProcessing() {
    const pct = processing.total > 0 ? Math.round(processing.done * 100 / processing.total) : 0;
    return (
      <div className="bulk-processing">
        <span className="loader" style={{width:32, height:32}}/>
        <div className="bulk-processing-title">Procesando {processing.done} / {processing.total} empleados…</div>
        <div className="bulk-progress-track">
          <div className="bulk-progress-fill" style={{width: `${pct}%`}}/>
        </div>
        <div className="bulk-processing-help">{pct}%</div>
      </div>
    );
  }

  function renderResult() {
    if (!result) return null;
    const totalExitoso = result.creados + result.actualizados;
    const rechazadosList = result.report.filter(r => r.status === 'Rechazado');
    return (
      <div>
        <div className="bulk-result-grid">
          <div className="bulk-result-stat"><div className="bulk-result-label">Creados</div><div className="bulk-result-value">{result.creados}</div></div>
          <div className="bulk-result-stat"><div className="bulk-result-label">Actualizados</div><div className="bulk-result-value">{result.actualizados}</div></div>
          <div className="bulk-result-stat"><div className="bulk-result-label">Saltados</div><div className="bulk-result-value">{result.saltados}</div></div>
          <div className="bulk-result-stat"><div className="bulk-result-label">Rechazados</div><div className="bulk-result-value">{result.rechazados + result.invalidas}</div></div>
        </div>
        <div className="bulk-result-totals">
          <strong>Total procesado:</strong> {result.total} filas ·
          <strong>{' '}Exitoso:</strong> {totalExitoso}
        </div>
        {rechazadosList.length > 0 && (
          <div className="bulk-result-errors">
            <div className="bulk-result-errors-title">
              <Icon n="alert" s={14} c="var(--red)"/> {rechazadosList.length} fila{rechazadosList.length === 1 ? '' : 's'} rechazada{rechazadosList.length === 1 ? '' : 's'}:
            </div>
            <ul>
              {rechazadosList.slice(0, 10).map(r => (
                <li key={r.rowNum}>Fila {r.rowNum} ({r.nombre || '?'}): {r.reason}</li>
              ))}
              {rechazadosList.length > 10 && (
                <li><em>… y {rechazadosList.length - 10} más (ver reporte completo).</em></li>
              )}
            </ul>
          </div>
        )}
        <div className="bulk-result-actions">
          <button type="button" className="btn-primary" onClick={onDownloadReport}>
            <Icon n="download" s={13}/> Descargar reporte completo (.xlsx)
          </button>
        </div>
      </div>
    );
  }

  function renderFooter() {
    if (screen === 'upload') {
      return <button className="btn-ghost" onClick={safeClose} disabled={parsing}>Cancelar</button>;
    }
    if (screen === 'preview') {
      return (
        <>
          <button className="btn-ghost" onClick={() => { setRows([]); setActions({}); setScreen('upload'); }}>
            ← Atrás
          </button>
          <button className="btn-ghost" onClick={safeClose}>Cancelar</button>
          <button className="btn-primary" onClick={onImport} disabled={counts.aImportar === 0}>
            <Icon n="check" s={13}/> Importar {counts.aImportar} empleado{counts.aImportar === 1 ? '' : 's'}
          </button>
        </>
      );
    }
    if (screen === 'processing') {
      return <span className="bulk-processing-footer-help">No cerrés la pestaña…</span>;
    }
    if (screen === 'result') {
      return <button className="btn-primary" onClick={safeClose}>Cerrar</button>;
    }
    return null;
  }
}

function humanizeEmpReason(err) {
  if (!err || !err.reason) return 'Error desconocido';
  switch (err.reason) {
    case 'duplicate_dni':   return `DNI duplicado (${err.dni || ''})`;
    case 'check_violation': return `Validación BD: ${err.detail || ''}`;
    case 'dni_immutable':   return `DNI no se puede modificar (era ${err.current_dni}, intentó ${err.new_dni})`;
    case 'missing_id':      return 'Falta id (interno)';
    case 'not_found':       return 'Empleado no existe (id no encontrado)';
    case 'other':           return err.detail || `Error BD (${err.sqlstate || '?'})`;
    default:                return err.reason;
  }
}

window.BulkImportEmployeesModal = BulkImportEmployeesModal;
