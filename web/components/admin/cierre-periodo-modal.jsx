/* ══ CIERRE PERIODO MODAL (Fase 8 — S2.19 + S2.20)
   Modo 'cerrar': 3 pantallas (selector → preview → éxito).
   Modo 'reabrir': 1 pantalla (motivo obligatorio + confirmar).

   Props:
     - mode: 'cerrar' | 'reabrir'
     - initial?: cierre (para modo reabrir)
     - prefilledRange?: { desde, hasta, tipo } (cuando viene del botón
       en cash-flow header, pre-llena selector)
     - onClose, onSuccess
   ══ */

function CierrePeriodoModal({ mode, initial, prefilledRange, onClose, onSuccess }) {
  const toast = useToast();
  const A = window.ADMIN_DATA;
  const Cmp = window.Modal;

  if (mode === 'reabrir') {
    return <CierreReabrirView initial={initial} onClose={onClose} onSuccess={onSuccess}/>;
  }
  return <CierreCrearFlow prefilledRange={prefilledRange} onClose={onClose} onSuccess={onSuccess}/>;
}

function CierreCrearFlow({ prefilledRange, onClose, onSuccess }) {
  const toast = useToast();
  const A = window.ADMIN_DATA;
  const Cmp = window.Modal;

  /* state */
  const [screen, setScreen] = useState('selector'); /* selector | preview | exito */
  const [tipo, setTipo]   = useState((prefilledRange && prefilledRange.tipo) || 'mensual');
  const [periodoMode, setPeriodoMode] = useState('auto'); /* auto | custom */
  const initialYM = (prefilledRange && prefilledRange.desde)
    ? String(prefilledRange.desde).slice(0, 7)
    : new Date().toISOString().slice(0, 7);
  const initialYear = (prefilledRange && prefilledRange.desde)
    ? Number(String(prefilledRange.desde).slice(0, 4))
    : new Date().getFullYear();
  const [ym, setYm]       = useState(initialYM);
  const [year, setYear]   = useState(initialYear);
  const [customDesde, setCustomDesde] = useState((prefilledRange && prefilledRange.desde) || '');
  const [customHasta, setCustomHasta] = useState((prefilledRange && prefilledRange.hasta) || '');
  const [notas, setNotas] = useState('');

  const [previewData, setPreviewData] = useState(null);
  const [resultData, setResultData]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  /* Cálculo automático del rango basado en tipo + selector */
  const computedRange = useMemo(() => {
    if (periodoMode === 'custom') {
      return { desde: customDesde, hasta: customHasta };
    }
    if (tipo === 'mensual') {
      const m = ym.match(/^(\d{4})-(\d{2})$/);
      if (!m) return { desde: '', hasta: '' };
      const lastDay = new Date(Number(m[1]), Number(m[2]), 0).getDate();
      return { desde: `${m[1]}-${m[2]}-01`, hasta: `${m[1]}-${m[2]}-${String(lastDay).padStart(2,'0')}` };
    }
    if (tipo === 'anual') {
      return { desde: `${year}-01-01`, hasta: `${year}-12-31` };
    }
    return { desde: '', hasta: '' };
  }, [tipo, ym, year, periodoMode, customDesde, customHasta]);

  const validateSelector = () => {
    if (!computedRange.desde || !computedRange.hasta) {
      setError('Período inválido');
      return false;
    }
    if (computedRange.hasta < computedRange.desde) {
      setError('La fecha hasta debe ser >= desde');
      return false;
    }
    setError(null);
    return true;
  };

  const onIrPreview = async () => {
    if (loading) return;
    if (!validateSelector()) return;
    setLoading(true); setError(null);
    try {
      const p = await A.previewCierre(tipo, computedRange.desde, computedRange.hasta);
      if (p && p.overlap_existente) {
        setError('Ya existe un cierre activo del mismo tipo que se solapa con este período. Cancelar.');
        setLoading(false);
        return;
      }
      setPreviewData(p);
      setScreen('preview');
    } catch (err) {
      setError(err.message || 'No se pudo calcular el preview');
    } finally {
      setLoading(false);
    }
  };

  const onConfirmar = async () => {
    if (loading) return;
    if (notas && notas.length > 500) { setError('Notas máximo 500 caracteres'); return; }
    setLoading(true); setError(null);
    try {
      const payload = {
        tipo,
        periodo_desde: computedRange.desde,
        periodo_hasta: computedRange.hasta,
        notas: notas.trim() || undefined,
      };
      const r = await A.crearCierre(payload);
      setResultData(r);
      setScreen('exito');
      try { onSuccess?.(); } catch (_) {}
    } catch (err) {
      const msg = err.message || 'No se pudo crear el cierre';
      if (/cierre_overlap/i.test(msg)) {
        setError('Ya existe un cierre activo del mismo tipo que se solapa con este período.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  /* Render según pantalla */
  if (screen === 'exito') {
    return (
      <Cmp open={true} title="Período cerrado" onClose={onClose} footer={
        <>
          <button className="btn-ghost"
                  title="Reportes disponibles en Etapa 3"
                  disabled>
            <Icon n="download" s={14}/> Ver reporte
          </button>
          <button className="btn-primary" onClick={onClose}>Cerrar</button>
        </>
      }>
        <div className="cierre-exito">
          <div className="cierre-exito-check">✓</div>
          <h3>Período cerrado correctamente</h3>
          <div className="cierre-exito-stat">
            <span className="kpi-label">Saldo final</span>
            <span className="kpi-value" style={{color: A.getSaldoColor(resultData && resultData.saldo_cierre)}}>
              {A.formatMoneyES(resultData && resultData.saldo_cierre)}
            </span>
          </div>
          <div className="cierre-exito-stat">
            <span className="kpi-label">Acum. histórico</span>
            <span className="kpi-value" style={{color: A.getSaldoColor(resultData && resultData.saldo_acumulado_historico)}}>
              {A.formatMoneyES(resultData && resultData.saldo_acumulado_historico)}
            </span>
          </div>
        </div>
      </Cmp>
    );
  }

  if (screen === 'preview') {
    const saldoNeg = previewData && Number(previewData.saldo_cierre) < 0;
    return (
      <Cmp open={true} title="Vista previa del cierre" onClose={onClose} footer={
        <>
          <button className="btn-ghost" onClick={() => setScreen('selector')} disabled={loading}>← Atrás</button>
          <button className="btn-primary cierre-confirm-btn" onClick={onConfirmar} disabled={loading}>
            {loading ? 'Cerrando…' : (<>⚠ Confirmar cierre</>)}
          </button>
        </>
      }>
        {previewData && (
          <>
            <div className="cierre-preview-header">
              <strong>{previewData.tipo === 'mensual' ? 'Cierre mensual' : 'Cierre anual'}</strong> ·{' '}
              {A.formatDate(previewData.periodo_desde)} → {A.formatDate(previewData.periodo_hasta)}
            </div>

            <div className="cierre-preview-grid">
              <div className="cierre-preview-row">
                <span>Saldo apertura</span>
                <strong>{A.formatMoneyES(previewData.saldo_apertura)}</strong>
              </div>
              <div className="cierre-preview-row">
                <span>Total ingresos</span>
                <strong style={{color: 'var(--green, #16a34a)'}}>
                  {A.formatMoneyES(previewData.total_ingresos)}
                </strong>
              </div>
              <div className="cierre-preview-row">
                <span>Total egresos</span>
                <strong style={{color: 'var(--red, #dc2626)'}}>
                  {A.formatMoneyES(previewData.total_egresos)}
                </strong>
              </div>
              <div className="cierre-preview-row cierre-preview-total">
                <span>Saldo cierre</span>
                <strong style={{color: saldoNeg ? 'var(--red, #dc2626)' : undefined}}>
                  {A.formatMoneyES(previewData.saldo_cierre)}
                </strong>
              </div>
            </div>

            <div className="field-help" style={{textAlign:'center'}}>
              {previewData.count_movimientos} movimiento{previewData.count_movimientos === 1 ? '' : 's'} en el período
            </div>

            <div className="field-group" style={{marginTop:14}}>
              <label className="field-label">Notas (opcional)</label>
              <textarea className="field-input" rows={2} maxLength={500}
                        value={notas}
                        placeholder="Comentario interno sobre este cierre"
                        onChange={e => setNotas(e.target.value)}/>
              <div className="field-help">{notas.length} / 500</div>
            </div>

            {error && <div className="field-error" style={{marginTop:8}}>{error}</div>}
          </>
        )}
      </Cmp>
    );
  }

  /* screen === 'selector' (default) */
  const years = [];
  const currentY = new Date().getFullYear();
  for (let y = currentY; y >= currentY - 5; y--) years.push(y);

  const meses = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    meses.push({
      value: d.toISOString().slice(0, 7),
      label: d.toLocaleDateString('es-AR', { year: 'numeric', month: 'long' }),
    });
  }

  return (
    <Cmp open={true} title="Cerrar período contable" onClose={onClose} footer={
      <>
        <button className="btn-ghost" onClick={onClose} disabled={loading}>Cancelar</button>
        <button className="btn-primary" onClick={onIrPreview} disabled={loading}>
          {loading ? 'Calculando…' : (<>Vista previa <Icon n="arrow-right" s={13}/></>)}
        </button>
      </>
    }>
      <div className="field-help" style={{marginBottom:14}}>
        Cerrar un período bloquea la creación/edición/eliminación de movimientos con fecha dentro del rango.
        Solo el owner puede reabrirlo, con motivo obligatorio.
      </div>

      <div className="field-group">
        <label className="field-label">Tipo de cierre *</label>
        <div className="recibo-tipo-radio-row">
          <label className="recibo-tipo-radio">
            <input type="radio" name="cp-tipo" value="mensual"
                   checked={tipo === 'mensual'}
                   onChange={() => setTipo('mensual')}/>
            Mensual
          </label>
          <label className="recibo-tipo-radio">
            <input type="radio" name="cp-tipo" value="anual"
                   checked={tipo === 'anual'}
                   onChange={() => setTipo('anual')}/>
            Anual
          </label>
        </div>
      </div>

      {periodoMode === 'auto' ? (
        <>
          {tipo === 'mensual' && (
            <div className="field-group">
              <label className="field-label">Mes *</label>
              <select className="field-input" value={ym}
                      onChange={e => setYm(e.target.value)}>
                {meses.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <div className="field-help">
                Rango calculado: {A.formatDate(computedRange.desde)} → {A.formatDate(computedRange.hasta)}
              </div>
            </div>
          )}
          {tipo === 'anual' && (
            <div className="field-group">
              <label className="field-label">Año *</label>
              <select className="field-input" value={year}
                      onChange={e => setYear(Number(e.target.value))}>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <div className="field-help">
                Rango calculado: 01/01/{year} → 31/12/{year}
              </div>
            </div>
          )}
          <button type="button" className="btn-link" onClick={() => setPeriodoMode('custom')}>
            Período personalizado →
          </button>
        </>
      ) : (
        <>
          <div className="supplier-modal-grid">
            <div className="field-group">
              <label className="field-label">Desde *</label>
              <input type="date" className="field-input"
                     value={customDesde} onChange={e => setCustomDesde(e.target.value)}/>
            </div>
            <div className="field-group">
              <label className="field-label">Hasta *</label>
              <input type="date" className="field-input"
                     value={customHasta} onChange={e => setCustomHasta(e.target.value)}/>
            </div>
          </div>
          <button type="button" className="btn-link" onClick={() => setPeriodoMode('auto')}>
            ← Volver a selector automático
          </button>
        </>
      )}

      {error && <div className="field-error" style={{marginTop:8}}>{error}</div>}
    </Cmp>
  );
}

function CierreReabrirView({ initial, onClose, onSuccess }) {
  const toast = useToast();
  const A = window.ADMIN_DATA;
  const Cmp = window.Modal;

  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);

  const onConfirmar = async () => {
    if (saving) return;
    const m = motivo.trim();
    if (m.length < 1) { setError('Motivo requerido'); return; }
    if (m.length > 500) { setError('Motivo máximo 500 caracteres'); return; }
    setSaving(true); setError(null);
    try {
      await A.reabrirCierre({ cierre_id: initial.id, motivo: m });
      toast.success('Cierre reabierto');
      try { onSuccess?.(); } catch (_) {}
      onClose?.();
    } catch (err) {
      const msg = err.message || 'No se pudo reabrir';
      if (/cierre_posterior_existe/i.test(msg)) {
        setError('Existen cierres posteriores. Reabrí primero el más reciente.');
      } else if (/not_owner/i.test(msg)) {
        setError('Solo el owner puede reabrir cierres.');
      } else {
        setError(msg);
      }
      setSaving(false);
    }
  };

  if (!initial) return null;

  return (
    <Cmp open={true} title="⚠ Reapertura de cierre" onClose={onClose} footer={
      <>
        <button className="btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn-primary cierre-confirm-btn" onClick={onConfirmar} disabled={saving}>
          {saving ? 'Reabriendo…' : (<>🔓 Reabrir</>)}
        </button>
      </>
    }>
      <div className="cierre-reabrir-banner">
        <Icon n="alert" s={16} c="var(--red)"/>
        <span>Esta acción permitirá modificar movimientos en el período cerrado. Documentá el motivo.</span>
      </div>

      <div className="cierre-preview-header" style={{marginTop:14}}>
        <strong>{initial.tipo === 'mensual' ? 'Cierre mensual' : 'Cierre anual'}</strong> ·{' '}
        {A.formatDate(initial.periodo_desde)} → {A.formatDate(initial.periodo_hasta)}
      </div>
      <div className="cierre-preview-row">
        <span>Saldo cierre</span>
        <strong style={{color: A.getSaldoColor(initial.saldo_cierre)}}>
          {A.formatMoneyES(initial.saldo_cierre)}
        </strong>
      </div>

      <div className="field-group" style={{marginTop:14}}>
        <label className="field-label">Motivo *</label>
        <textarea className={`field-input ${error ? 'has-error' : ''}`}
                  value={motivo} rows={3} maxLength={500} autoFocus
                  placeholder="Ej: corrección de IVA cargado mal en factura X"
                  onChange={e => { setMotivo(e.target.value); setError(null); }}/>
        <div className="field-help">{motivo.length} / 500 · Queda registrado en audit log</div>
      </div>

      {error && <div className="field-error" style={{marginTop:8}}>{error}</div>}
    </Cmp>
  );
}

window.CierrePeriodoModal = CierrePeriodoModal;
