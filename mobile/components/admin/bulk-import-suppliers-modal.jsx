/* ══ BULK IMPORT SUPPLIERS MODAL (S2.4)
   Modal de carga masiva de proveedores via .xlsx o .csv. Reusa
   window.XLSX (v0.18.5 ya cargado, decision Jefe #1).

   3 pantallas:
     1) upload  : dropzone + link descargar plantilla.
     2) preview : tabla de filas validadas + dropdown de accion en
                  duplicados (Saltar / Actualizar).
     3) result  : summary + boton descargar reporte.

   Entre 2 y 3: si items > 1000, chunking automatico en chunks de 1000
   con progress bar (decision Jefe #3).

   DNI rechazado (decision Jefe #2): solo CUIT formal XX-XXXXXXXX-X.

   Props: { onClose, onSuccess }
   ══ */

const MAX_FILE_SIZE = 2 * 1024 * 1024;  // 2 MB
const VALID_EXTENSIONS = ['.xlsx', '.xls', '.csv'];

function BulkImportSuppliersModal({ onClose, onSuccess }) {
  const toast = useToast();
  const [screen, setScreen] = useState('upload');  // upload | preview | processing | result
  const [parsing, setParsing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [rows, setRows] = useState([]);            // validated + duplicate-marked
  const [actions, setActions] = useState({});      // { rowNum: 'create'|'skip'|'update' }
  const [processing, setProcessing] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState(null);
  const fileInputRef = useRef(null);

  const safeClose = () => {
    if (parsing || screen === 'processing') return;
    onClose?.();
  };

  /* ── PANTALLA 1: upload ─────────────────────────────────────────── */
  const handleFile = async (file) => {
    if (!file) return;
    const A = window.ADMIN_DATA;
    if (typeof A.parseSupplierSpreadsheet !== 'function') {
      toast.error('Parser no disponible. Recargá la página.');
      return;
    }
    const lower = file.name.toLowerCase();
    if (!VALID_EXTENSIONS.some(ext => lower.endsWith(ext))) {
      toast.error('Formato no soportado. Solo .xlsx, .xls o .csv.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error(`Archivo demasiado grande (${(file.size/1024/1024).toFixed(1)} MB). Máximo 2 MB.`);
      return;
    }
    setParsing(true);
    try {
      const parsed = await A.parseSupplierSpreadsheet(file);
      if (!parsed || parsed.length === 0) {
        toast.error('El archivo no tiene filas de datos.');
        setParsing(false);
        return;
      }
      // Validar fila por fila
      const validated = parsed.map(r => A.validateSupplierRow(r));

      // Detectar duplicados via RPC
      const cuitsToCheck = validated
        .filter(r => r.isValid && r.normalized.cuit)
        .map(r => r.normalized.cuit);
      let dupResult = { existing: [], not_existing: [] };
      if (cuitsToCheck.length > 0) {
        dupResult = await A.checkCuitsExist(cuitsToCheck);
      }
      const existingByCuit = {};
      for (const e of (dupResult.existing || [])) {
        existingByCuit[e.cuit] = e;
      }

      // Marcar filas duplicadas
      const finalRows = validated.map(r => {
        const match = r.isValid && r.normalized.cuit ? existingByCuit[r.normalized.cuit] : null;
        return {
          ...r,
          isDuplicate: !!match,
          existingMatch: match || null,
        };
      });

      // Acciones default
      const defaultActions = {};
      for (const r of finalRows) {
        if (!r.isValid)        defaultActions[r.rowNum] = 'none';
        else if (r.isDuplicate) defaultActions[r.rowNum] = 'skip';  // default skip
        else                    defaultActions[r.rowNum] = 'create';
      }

      setRows(finalRows);
      setActions(defaultActions);
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
      window.ADMIN_DATA.downloadSuppliersTemplate();
      toast.success('Plantilla descargada');
    } catch (err) {
      toast.error(err.message || 'No se pudo generar plantilla');
    }
  };

  /* ── PANTALLA 2: preview ─────────────────────────────────────────── */
  const setRowAction = (rowNum, newAction) => {
    setActions(s => ({ ...s, [rowNum]: newAction }));
  };

  const counts = useMemo(() => {
    let validas = 0, duplicados = 0, invalidas = 0, aImportar = 0;
    for (const r of rows) {
      if (!r.isValid)        invalidas++;
      else if (r.isDuplicate) duplicados++;
      else                    validas++;
      const a = actions[r.rowNum];
      if (a === 'create' || a === 'update') aImportar++;
    }
    return { validas, duplicados, invalidas, aImportar };
  }, [rows, actions]);

  /* ── PANTALLA 2.5 → 3: procesar ──────────────────────────────────── */
  const onImport = async () => {
    const A = window.ADMIN_DATA;

    // Segregar items por accion
    const creates = [];
    const updates = [];
    for (const r of rows) {
      const a = actions[r.rowNum];
      if (a === 'create' && r.isValid && !r.isDuplicate) {
        creates.push({ _rowNum: r.rowNum, _normalized: r.normalized, ...r.normalized });
      } else if (a === 'update' && r.isValid && r.isDuplicate && r.existingMatch) {
        updates.push({
          _rowNum: r.rowNum,
          _normalized: r.normalized,
          id: r.existingMatch.id,
          ...r.normalized,
          cuit: r.normalized.cuit,  // explicit
        });
      }
    }

    if (creates.length === 0 && updates.length === 0) {
      toast.error('No hay filas para importar (todo Saltar/Inválido).');
      return;
    }

    setScreen('processing');
    const totalToProcess = creates.length + updates.length;
    setProcessing({ done: 0, total: totalToProcess });

    let createsResult = { created: 0, errors: [] };
    let updatesResult = { updated: 0, errors: [] };

    try {
      if (creates.length > 0) {
        const createItems = creates.map(c => {
          const o = { ...c };
          delete o._rowNum;
          delete o._normalized;
          return o;
        });
        createsResult = await A.bulkCreateSuppliers(createItems, (done) => {
          setProcessing(s => ({ ...s, done: done }));
        });
      }
      if (updates.length > 0) {
        const updateItems = updates.map(u => {
          const o = { ...u };
          delete o._rowNum;
          delete o._normalized;
          return o;
        });
        updatesResult = await A.bulkUpdateSuppliers(updateItems, (done) => {
          setProcessing(s => ({ ...s, done: creates.length + done }));
        });
      }
    } catch (err) {
      toast.error(err.message || 'Error procesando batch');
      // Continuamos a result con lo acumulado parcialmente
    }

    // Construir reporte por fila
    const report = [];
    const createErrorByIdx = {};
    (createsResult.errors || []).forEach(e => { createErrorByIdx[e.index] = e; });
    const updateErrorByIdx = {};
    (updatesResult.errors || []).forEach(e => { updateErrorByIdx[e.index] = e; });

    creates.forEach((c, i) => {
      const err = createErrorByIdx[i];
      report.push({
        rowNum: c._rowNum,
        status: err ? 'Rechazado' : 'Creado',
        reason: err ? humanizeReason(err) : '',
        ...c._normalized,
      });
    });
    updates.forEach((u, i) => {
      const err = updateErrorByIdx[i];
      report.push({
        rowNum: u._rowNum,
        status: err ? 'Rechazado' : 'Actualizado',
        reason: err ? humanizeReason(err) : '',
        ...u._normalized,
      });
    });
    // Filas no procesadas (skip / invalid)
    for (const r of rows) {
      const a = actions[r.rowNum];
      const alreadyInReport = report.some(x => x.rowNum === r.rowNum);
      if (alreadyInReport) continue;
      if (!r.isValid) {
        report.push({
          rowNum: r.rowNum,
          status: 'Inválido',
          reason: (r.errors || []).join(' · '),
          ...r.normalized,
        });
      } else if (a === 'skip') {
        report.push({
          rowNum: r.rowNum,
          status: 'Saltado',
          reason: 'Duplicado, marcado para saltar',
          ...r.normalized,
        });
      }
    }
    report.sort((a, b) => (a.rowNum || 0) - (b.rowNum || 0));

    const summary = {
      creados:      createsResult.created || 0,
      actualizados: updatesResult.updated || 0,
      saltados:     report.filter(r => r.status === 'Saltado').length,
      rechazados:   report.filter(r => r.status === 'Rechazado').length,
      invalidas:    report.filter(r => r.status === 'Inválido').length,
      total:        rows.length,
      report,
    };

    setResult(summary);
    setScreen('result');
    try { onSuccess?.(); } catch (_) {}
  };

  const onDownloadReport = () => {
    try {
      window.ADMIN_DATA.generateBulkReportXlsx(result.report);
      toast.success('Reporte descargado');
    } catch (err) {
      toast.error(err.message || 'No se pudo generar reporte');
    }
  };

  const Cmp = window.Modal;

  return (
    <Cmp open={true}
         title="Importar proveedores masivamente"
         onClose={safeClose}
         size="lg"
         footer={renderFooter()}>
      {screen === 'upload'     && renderUpload()}
      {screen === 'preview'    && renderPreview()}
      {screen === 'processing' && renderProcessing()}
      {screen === 'result'     && renderResult()}
    </Cmp>
  );

  /* ── Renderers ─────────────────────────────────────────────────── */

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
          <div className="bulk-dropzone-help">o hacé click para seleccionar · Máx 2 MB · ~5000 filas</div>
        </div>

        <div className="bulk-template-row">
          <button type="button" className="btn-ghost-sm" onClick={downloadTemplate}>
            <Icon n="download" s={12}/> Descargar plantilla .xlsx
          </button>
        </div>

        <div className="bulk-headers-help">
          <strong>Columnas esperadas:</strong>
          <div>nombre*, cuit*, email, telefono, condicion_fiscal, condicion_iva, provincia, ciudad, direccion, codigo_postal, rubro, productos_habituales, notas</div>
          <div style={{marginTop:6, fontSize:11, color:'var(--ink-muted)'}}>
            * = obligatorios. El sistema tolera variaciones de mayúsculas, acentos y sinónimos (ej: "Razón Social" → nombre). NO se aceptan DNIs sueltos, solo CUIT formal.
          </div>
        </div>
      </div>
    );
  }

  function renderPreview() {
    return (
      <div>
        <div className="bulk-preview-summary">
          <span className="bulk-pill bulk-pill-valid">✓ {counts.validas} válidas</span>
          <span className="bulk-pill bulk-pill-duplicate">⚠ {counts.duplicados} duplicados</span>
          <span className="bulk-pill bulk-pill-invalid">✗ {counts.invalidas} inválidas</span>
        </div>

        <div className="bulk-preview-scroll">
          <table className="bulk-preview-table">
            <thead>
              <tr>
                <th style={{width:40}}>#</th>
                <th style={{width:90}}>Estado</th>
                <th>Nombre</th>
                <th style={{width:140}}>CUIT</th>
                <th style={{width:180}}>Email</th>
                <th style={{width:120}}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <window.BulkImportRow
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
        <div className="bulk-processing-title">Procesando {processing.done} / {processing.total} filas…</div>
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
          <strong>{' '}Exitoso:</strong> {totalExitoso} filas
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
      return (
        <button className="btn-ghost" onClick={safeClose} disabled={parsing}>
          Cancelar
        </button>
      );
    }
    if (screen === 'preview') {
      return (
        <>
          <button className="btn-ghost" onClick={() => { setRows([]); setActions({}); setScreen('upload'); }}>
            ← Atrás
          </button>
          <button className="btn-ghost" onClick={safeClose}>Cancelar</button>
          <button className="btn-primary"
                  onClick={onImport}
                  disabled={counts.aImportar === 0}>
            <Icon n="check" s={13}/> Importar {counts.aImportar} fila{counts.aImportar === 1 ? '' : 's'}
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

/* Humanizar reasons del backend para mostrar en reporte/UI. */
function humanizeReason(err) {
  if (!err || !err.reason) return 'Error desconocido';
  switch (err.reason) {
    case 'duplicate_cuit':   return `CUIT duplicado (${err.cuit || ''})`;
    case 'check_violation':  return `Validación BD: ${err.detail || ''}`;
    case 'cuit_immutable':   return `CUIT no se puede modificar (era ${err.current_cuit}, intentó ${err.new_cuit})`;
    case 'missing_id':       return 'Falta id (interno)';
    case 'not_found':        return 'Proveedor no existe (id no encontrado)';
    case 'other':            return err.detail || `Error BD (${err.sqlstate || '?'})`;
    default:                 return err.reason;
  }
}

window.BulkImportSuppliersModal = BulkImportSuppliersModal;
