/* ══ BULK IMPORT CHECKS MODAL (S2.5)
   Modal de carga masiva de cheques (emitidos o recibidos) con toggle.
   Reusa window.XLSX (v0.18.5, decision #1).

   3 pantallas + processing intermedio:
     1) upload   : toggle Emitidos/Recibidos + dropzone + plantilla.
     2) preview  : tabla + dropdown action + checkbox movement por fila.
     3) processing: progress bar (visible si items > 1000).
     4) result   : summary + boton descargar reporte.

   Decisiones aplicadas:
     #1 Plantilla received con emisor_*
     #2 Sinonimos de estado mapean a enum BD
     #3 Sin UNIQUE en BD (deteccion frontend)
     #4 Movement con RESTA (backend)
     #5 Toggle generar_movement por fila DEFAULT OFF
     Bonus 1: ignorar moneda
     Bonus 2: normalizeCheckNumber preserva leading zeros

   Props: { initialKind: 'issued' | 'received', onClose, onSuccess }
   ══ */

const MAX_FILE_SIZE_CHECKS = 2 * 1024 * 1024;
const VALID_EXTENSIONS_CHECKS = ['.xlsx', '.xls', '.csv'];

function BulkImportChecksModal({ initialKind, onClose, onSuccess }) {
  const toast = useToast();
  const [kind, setKind] = useState(initialKind === 'received' ? 'received' : 'issued');
  const [screen, setScreen] = useState('upload');
  const [parsing, setParsing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [rows, setRows] = useState([]);
  const [actions, setActions] = useState({});
  const [generarMovementByRow, setGenerarMovementByRow] = useState({});
  const [processing, setProcessing] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState(null);
  const fileInputRef = useRef(null);

  const safeClose = () => {
    if (parsing || screen === 'processing') return;
    onClose?.();
  };

  const A = window.ADMIN_DATA;
  const isReceived = kind === 'received';
  const cuitField   = isReceived ? 'emisor_cuit'   : 'beneficiario_cuit';
  const nombreField = isReceived ? 'emisor_nombre' : 'beneficiario_nombre';

  /* ── PANTALLA 1: upload ──────────────────────────────────────────── */
  const handleFile = async (file) => {
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!VALID_EXTENSIONS_CHECKS.some(ext => lower.endsWith(ext))) {
      toast.error('Formato no soportado. Solo .xlsx, .xls o .csv.');
      return;
    }
    if (file.size > MAX_FILE_SIZE_CHECKS) {
      toast.error(`Archivo demasiado grande (${(file.size/1024/1024).toFixed(1)} MB). Máximo 2 MB.`);
      return;
    }
    setParsing(true);
    try {
      const parsed = await A.parseChecksSpreadsheet(file, kind);
      if (!parsed || parsed.length === 0) {
        toast.error('El archivo no tiene filas de datos.');
        setParsing(false);
        return;
      }
      const validated = parsed.map(r => A.validateCheckRow(r, kind));

      /* Resolver entities por CUIT (matching opcional). */
      const cuitsToResolve = validated
        .filter(r => r.isValid && r.normalized[cuitField])
        .map(r => r.normalized[cuitField]);
      let resolved = { matches: [], unmatched: [] };
      if (cuitsToResolve.length > 0) {
        resolved = await A.resolveEntitiesByCuit(
          cuitsToResolve,
          isReceived ? 'customer_b2b' : 'supplier'
        );
      }
      const matchByCuit = {};
      for (const m of (resolved.matches || [])) matchByCuit[m.cuit] = m;

      /* Detectar duplicados via RPC (pares numero+banco). */
      const pairsToCheck = validated
        .filter(r => r.isValid)
        .map(r => ({ numero: r.normalized.numero, banco: r.normalized.banco }));
      let dupResult = { existing: [], not_existing: [] };
      if (pairsToCheck.length > 0) {
        const fn = isReceived ? A.checkChecksReceivedExist : A.checkChecksIssuedExist;
        dupResult = await fn(pairsToCheck);
      }
      const existingByKey = {};
      for (const e of (dupResult.existing || [])) {
        existingByKey[`${e.numero}|${e.banco}`] = e;
      }

      /* Combinar matches + duplicados */
      const finalRows = validated.map(r => {
        const dupKey = r.isValid ? `${r.normalized.numero}|${r.normalized.banco}` : '';
        const dup = existingByKey[dupKey];
        const cuit = r.normalized[cuitField];
        const entityMatch = cuit ? matchByCuit[cuit] : null;
        return {
          ...r,
          isDuplicate: !!dup,
          existingMatch: dup || null,
          entityMatch: entityMatch || null,
        };
      });

      /* Default actions + movements OFF (decision #5) */
      const defActions = {};
      const defMovs = {};
      for (const r of finalRows) {
        if (!r.isValid)        defActions[r.rowNum] = 'none';
        else if (r.isDuplicate) defActions[r.rowNum] = 'skip';
        else                    defActions[r.rowNum] = 'create';
        defMovs[r.rowNum] = false;  // default OFF
      }

      setRows(finalRows);
      setActions(defActions);
      setGenerarMovementByRow(defMovs);
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
      if (isReceived) A.downloadChecksReceivedTemplate();
      else            A.downloadChecksIssuedTemplate();
      toast.success('Plantilla descargada');
    } catch (err) {
      toast.error(err.message || 'No se pudo generar plantilla');
    }
  };

  /* ── PANTALLA 2: preview ─────────────────────────────────────────── */
  const setRowAction = (rowNum, newAction) => {
    setActions(s => ({ ...s, [rowNum]: newAction }));
  };
  const setRowMovement = (rowNum, val) => {
    setGenerarMovementByRow(s => ({ ...s, [rowNum]: val }));
  };

  const counts = useMemo(() => {
    let validas = 0, duplicados = 0, invalidas = 0, aImportar = 0, conMovement = 0;
    for (const r of rows) {
      if (!r.isValid)        invalidas++;
      else if (r.isDuplicate) duplicados++;
      else                    validas++;
      const a = actions[r.rowNum];
      if (a === 'create' || a === 'update') aImportar++;
      if (generarMovementByRow[r.rowNum] && r.entityMatch) conMovement++;
    }
    return { validas, duplicados, invalidas, aImportar, conMovement };
  }, [rows, actions, generarMovementByRow]);

  /* ── Procesar: segregar + RPCs + acumular ──────────────────────── */
  const onImport = async () => {
    const creates = [];
    const updates = [];
    for (const r of rows) {
      const a = actions[r.rowNum];
      const movement = !!generarMovementByRow[r.rowNum] && !!r.entityMatch;
      const baseItem = buildItemPayload(r, kind, movement);
      if (a === 'create' && r.isValid && !r.isDuplicate) {
        creates.push({ _rowNum: r.rowNum, _normalized: r.normalized, _movement: movement, ...baseItem });
      } else if (a === 'update' && r.isValid && r.isDuplicate && r.existingMatch) {
        updates.push({
          _rowNum: r.rowNum, _normalized: r.normalized, _movement: false, // update NO genera movement
          id: r.existingMatch.id,
          ...baseItem,
        });
      }
    }

    if (creates.length === 0 && updates.length === 0) {
      toast.error('No hay filas para importar (todo Saltar/Inválido).');
      return;
    }

    setScreen('processing');
    setProcessing({ done: 0, total: creates.length + updates.length });

    let createsResult = { created: 0, errors: [] };
    let updatesResult = { updated: 0, errors: [] };
    try {
      if (creates.length > 0) {
        const payload = creates.map(c => {
          const o = { ...c };
          delete o._rowNum; delete o._normalized; delete o._movement;
          return o;
        });
        const fn = isReceived ? A.bulkCreateChecksReceived : A.bulkCreateChecksIssued;
        createsResult = await fn(payload, (done) => {
          setProcessing(s => ({ ...s, done }));
        });
      }
      if (updates.length > 0) {
        const payload = updates.map(u => {
          const o = { ...u };
          delete o._rowNum; delete o._normalized; delete o._movement;
          return o;
        });
        const fn = isReceived ? A.bulkUpdateChecksReceived : A.bulkUpdateChecksIssued;
        updatesResult = await fn(payload, (done) => {
          setProcessing(s => ({ ...s, done: creates.length + done }));
        });
      }
    } catch (err) {
      toast.error(err.message || 'Error procesando batch');
    }

    /* Construir reporte por fila */
    const report = [];
    const createErrIdx = {};
    (createsResult.errors || []).forEach(e => { createErrIdx[e.index] = e; });
    const updateErrIdx = {};
    (updatesResult.errors || []).forEach(e => { updateErrIdx[e.index] = e; });

    creates.forEach((c, i) => {
      const err = createErrIdx[i];
      report.push({
        rowNum: c._rowNum,
        status: err ? 'Rechazado' : 'Creado',
        reason: err ? humanizeCheckReason(err) : '',
        movement_generado: c._movement && !err,
        ...c._normalized,
      });
    });
    updates.forEach((u, i) => {
      const err = updateErrIdx[i];
      report.push({
        rowNum: u._rowNum,
        status: err ? 'Rechazado' : 'Actualizado',
        reason: err ? humanizeCheckReason(err) : '',
        movement_generado: false,
        ...u._normalized,
      });
    });
    for (const r of rows) {
      const a = actions[r.rowNum];
      const alreadyInReport = report.some(x => x.rowNum === r.rowNum);
      if (alreadyInReport) continue;
      if (!r.isValid) {
        report.push({
          rowNum: r.rowNum, status: 'Inválido',
          reason: (r.errors || []).join(' · '),
          movement_generado: false,
          ...r.normalized,
        });
      } else if (a === 'skip') {
        report.push({
          rowNum: r.rowNum, status: 'Saltado',
          reason: 'Duplicado, marcado para saltar',
          movement_generado: false,
          ...r.normalized,
        });
      }
    }
    report.sort((a, b) => (a.rowNum || 0) - (b.rowNum || 0));

    const conMovement = creates.filter((c, i) => !createErrIdx[i] && c._movement).length;
    const summary = {
      creados:      createsResult.created || 0,
      actualizados: updatesResult.updated || 0,
      saltados:     report.filter(r => r.status === 'Saltado').length,
      rechazados:   report.filter(r => r.status === 'Rechazado').length,
      invalidas:    report.filter(r => r.status === 'Inválido').length,
      conMovement:  conMovement,
      total:        rows.length,
      report,
    };

    setResult(summary);
    setScreen('result');
    try { onSuccess?.(); } catch (_) {}
  };

  const onDownloadReport = () => {
    try {
      A.generateChecksBulkReportXlsx(result.report, kind);
      toast.success('Reporte descargado');
    } catch (err) {
      toast.error(err.message || 'No se pudo generar reporte');
    }
  };

  const Cmp = window.Modal;

  return (
    <Cmp open={true}
         title="Importar cheques masivamente"
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
        <div className="bulk-checks-toggle">
          <strong>Tipo de cheque:</strong>
          <label className="bulk-checks-toggle-option">
            <input type="radio" name="bulk-kind" value="issued"
                   checked={kind === 'issued'}
                   onChange={() => { setKind('issued'); setRows([]); }}/>
            <span>Emitidos (yo pago al proveedor)</span>
          </label>
          <label className="bulk-checks-toggle-option">
            <input type="radio" name="bulk-kind" value="received"
                   checked={kind === 'received'}
                   onChange={() => { setKind('received'); setRows([]); }}/>
            <span>Recibidos (un cliente me paga)</span>
          </label>
        </div>

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
          <div className="bulk-dropzone-help">
            Cheques {isReceived ? 'recibidos' : 'emitidos'} · Máx 2 MB · ~5000 filas
          </div>
        </div>

        <div className="bulk-template-row">
          <button type="button" className="btn-ghost-sm" onClick={downloadTemplate}>
            <Icon n="download" s={12}/> Descargar plantilla {isReceived ? 'RECIBIDOS' : 'EMITIDOS'} (.xlsx)
          </button>
        </div>

        <div className="bulk-headers-help">
          <strong>Columnas esperadas:</strong>
          <div>
            numero*, banco*, monto*, fecha_emision*, fecha_cobro_estimada,
            {' '}{isReceived ? 'emisor_cuit, emisor_nombre' : 'beneficiario_cuit, beneficiario_nombre'},
            {' '}estado, notas
          </div>
          <div style={{marginTop:6, fontSize:11, color:'var(--ink-muted)'}}>
            * = obligatorios. Estado acepta: emitido/pendiente, cobrado/pagado, devuelto/rechazado, anulado/cancelado.
            Moneda: ARS (no editable en S2.5). Columna ignorada del archivo.
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
          {counts.conMovement > 0 && (
            <span className="bulk-pill bulk-pill-info">↻ {counts.conMovement} con cta cte</span>
          )}
        </div>

        <div className="bulk-preview-scroll">
          <table className="bulk-preview-table">
            <thead>
              <tr>
                <th style={{width:36}}>#</th>
                <th style={{width:86}}>Estado</th>
                <th style={{width:110}}>Número</th>
                <th style={{width:120}}>Banco</th>
                <th style={{width:120, textAlign:'right'}}>Monto</th>
                <th>{isReceived ? 'Emisor' : 'Beneficiario'}</th>
                <th style={{width:100}}>Estado cheque</th>
                <th style={{width:60}}>Cta cte</th>
                <th style={{width:110}}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <window.BulkImportCheckRow
                  key={r.rowNum}
                  row={r}
                  kind={kind}
                  action={actions[r.rowNum]}
                  generarMovement={generarMovementByRow[r.rowNum]}
                  onActionChange={a => setRowAction(r.rowNum, a)}
                  onMovementChange={v => setRowMovement(r.rowNum, v)}/>
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
        <div className="bulk-processing-title">Procesando {processing.done} / {processing.total} cheques…</div>
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
          <strong>Total procesado:</strong> {result.total} cheques ·
          <strong>{' '}Exitoso:</strong> {totalExitoso} ·
          <strong>{' '}Con movement cta cte:</strong> {result.conMovement}
        </div>

        {rechazadosList.length > 0 && (
          <div className="bulk-result-errors">
            <div className="bulk-result-errors-title">
              <Icon n="alert" s={14} c="var(--red)"/> {rechazadosList.length} fila{rechazadosList.length === 1 ? '' : 's'} rechazada{rechazadosList.length === 1 ? '' : 's'}:
            </div>
            <ul>
              {rechazadosList.slice(0, 10).map(r => (
                <li key={r.rowNum}>Fila {r.rowNum} (#{r.numero || '?'} {r.banco || ''}): {r.reason}</li>
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
        <button className="btn-ghost" onClick={safeClose} disabled={parsing}>Cancelar</button>
      );
    }
    if (screen === 'preview') {
      return (
        <>
          <button className="btn-ghost" onClick={() => { setRows([]); setActions({}); setGenerarMovementByRow({}); setScreen('upload'); }}>
            ← Atrás
          </button>
          <button className="btn-ghost" onClick={safeClose}>Cancelar</button>
          <button className="btn-primary"
                  onClick={onImport}
                  disabled={counts.aImportar === 0}>
            <Icon n="check" s={13}/> Importar {counts.aImportar} cheque{counts.aImportar === 1 ? '' : 's'}
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

/* Construye el item del payload para el RPC bulk. Mapea campos según kind. */
function buildItemPayload(row, kind, generarMovement) {
  const isReceived = kind === 'received';
  const cuitField   = isReceived ? 'emisor_cuit'   : 'beneficiario_cuit';
  const nombreField = isReceived ? 'emisor_nombre' : 'beneficiario_nombre';
  const entityIdField = isReceived ? 'emisor_customer_b2b_id' : 'beneficiario_supplier_id';
  const entityTextoField = isReceived ? 'emisor_texto' : 'beneficiario_texto';

  const n = row.normalized;
  const entityId = row.entityMatch ? row.entityMatch.id : null;
  const entityTexto = entityId ? null : (n[nombreField] || null);  // fallback al texto del archivo si no hay match

  return {
    numero:               n.numero,
    banco:                n.banco,
    monto:                n.monto,
    fecha_emision:        n.fecha_emision,
    fecha_cobro_estimada: n.fecha_cobro_estimada,
    [entityIdField]:      entityId,
    [entityTextoField]:   entityTexto,
    estado:               n.estado,
    notas:                n.notas,
    generar_movement:     !!generarMovement,
  };
}

/* Humanizar reasons del backend. */
function humanizeCheckReason(err) {
  if (!err || !err.reason) return 'Error desconocido';
  switch (err.reason) {
    case 'duplicate_check':  return `Cheque duplicado (#${err.numero || '?'} ${err.banco || ''})`;
    case 'check_violation':  return `Validación BD: ${err.detail || ''}`;
    case 'check_immutable':  return `Campo inmutable: ${err.field || ''} no se puede modificar post-alta`;
    case 'missing_id':       return 'Falta id (interno)';
    case 'not_found':        return 'Cheque no existe (id no encontrado)';
    case 'other':            return err.detail || `Error BD (${err.sqlstate || '?'})`;
    default:                 return err.reason;
  }
}

window.BulkImportChecksModal = BulkImportChecksModal;
