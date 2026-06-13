/* ══ RECIBO MODAL (S2.12)
   Modal de alta/edición de recibo de sueldo (adelanto/quincena/sueldo).

   Patrón heredado de EmployeeModal (secciones colapsables) + tabla de
   items dinámicos con cálculo en vivo del subtotal y total.

   Snapshot empleado: al seleccionar un empleado en el dropdown, se
   autocompletan DNI, categoría, fecha ingreso y sueldo básico (este
   último editable). Los snapshots quedan congelados en BD al crear.

   En modo edit: bloquea empleado, tipo, período, sueldo básico
   (inmutables) y solo permite editar items, fecha_pago, notas.
   Si estado='anulado': todo read-only + banner rojo.

   Props: { mode: 'create'|'edit', initial?, onClose, onSuccess,
            onAfterCreatePdf? (opcional, dispara PDF tras crear) }
   ══ */

function ReciboModal({ mode, initial, onClose, onSuccess, onAfterCreatePdf }) {
  const toast = useToast();
  const isEdit = mode === 'edit';
  const A = window.ADMIN_DATA;

  const isAnulado = isEdit && initial && initial.estado === 'anulado';
  const title = isEdit
    ? (isAnulado ? 'Ver recibo (anulado)' : 'Editar recibo')
    : 'Nuevo recibo';
  const okMsg = isEdit ? 'Recibo actualizado' : 'Recibo creado';

  const [employees, setEmployees]   = useState([]);
  const [empLoading, setEmpLoading] = useState(!isEdit); /* edit no necesita lista */
  const [empError, setEmpError]     = useState(null);

  const [employeeId, setEmployeeId] = useState((initial && initial.employee_id) || '');
  const [tipo, setTipo] = useState((initial && initial.tipo) || 'sueldo');
  const [periodoDesde, setPeriodoDesde] = useState(
    (initial && initial.periodo_desde) ? String(initial.periodo_desde).slice(0, 10) : ''
  );
  const [periodoHasta, setPeriodoHasta] = useState(
    (initial && initial.periodo_hasta) ? String(initial.periodo_hasta).slice(0, 10) : ''
  );
  const [fechaPago, setFechaPago] = useState(
    (initial && initial.fecha_pago)
      ? String(initial.fecha_pago).slice(0, 10)
      : new Date().toISOString().slice(0, 10)
  );
  const [sueldoBasico, setSueldoBasico] = useState(
    initial && initial.sueldo_basico != null ? String(initial.sueldo_basico) : ''
  );
  const [items, setItems] = useState(
    Array.isArray(initial && initial.items) ? initial.items.map(it => ({
      concepto: it.concepto || '',
      cantidad: it.cantidad != null ? String(it.cantidad) : '',
      valor_unitario: it.valor_unitario != null ? String(it.valor_unitario) : '',
      subtotal: it.subtotal != null ? Number(it.subtotal) : 0,
      tipo: it.tipo || 'haber',
    })) : []
  );
  const [notas, setNotas] = useState((initial && initial.notas) || '');

  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [openSections, setOpenSections] = useState({
    empleado: true,
    periodo:  true,
    basico:   true,
    items:    true,
  });

  /* Cargar empleados al mount (solo modo create) */
  useEffect(() => {
    if (isEdit) return;
    let cancelled = false;
    setEmpLoading(true);
    A.loadEmployees({ includeInactive: false })
      .then(data => {
        if (cancelled) return;
        setEmployees(data);
        setEmpLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setEmpError(err.message || 'No se pudo cargar empleados');
        setEmpLoading(false);
      });
    return () => { cancelled = true; };
    /* eslint-disable-next-line */
  }, []);

  /* Empleado seleccionado actual (modo create) */
  const empleadoSelected = useMemo(() => {
    if (!employeeId) return null;
    return employees.find(e => e.id === employeeId) || null;
  }, [employeeId, employees]);

  /* Valor del día (calc en vivo) */
  const valorDia = useMemo(() => A.calcValorDia(sueldoBasico), [sueldoBasico]);

  /* Total = SUM(items.subtotal) */
  const total = useMemo(() => A.calcTotal(items), [items]);
  const totalNegativo = total < 0;

  const toggleSection = (k) => setOpenSections(s => ({ ...s, [k]: !s[k] }));

  /* Al seleccionar empleado (modo create), autocompletar sueldo básico */
  const onSelectEmployee = (id) => {
    setEmployeeId(id);
    if (!id) return;
    const emp = employees.find(e => e.id === id);
    if (emp && emp.sueldo_bruto_base != null && !sueldoBasico) {
      setSueldoBasico(String(emp.sueldo_bruto_base));
    }
  };

  /* Pre-carga items según tipo (modo create, solo si items está vacío) */
  const prefillItemsForTipo = (t) => {
    if (isEdit) return;
    if (items.length > 0) return; /* respetar carga manual */
    const vd = A.calcValorDia(sueldoBasico);
    if (t === 'adelanto') {
      setItems([{ concepto: 'Adelanto a cuenta de sueldo', cantidad: '1', valor_unitario: '', subtotal: 0, tipo: 'haber' }]);
    } else if (t === 'quincena') {
      const v = vd ? vd.toFixed(2) : '';
      setItems([{ concepto: 'Días trabajados', cantidad: '15', valor_unitario: v, subtotal: vd * 15, tipo: 'haber' }]);
    } else if (t === 'sueldo') {
      const v = vd ? vd.toFixed(2) : '';
      setItems([{ concepto: 'Días trabajados', cantidad: '30', valor_unitario: v, subtotal: vd * 30, tipo: 'haber' }]);
    }
  };

  const onChangeTipo = (newTipo) => {
    setTipo(newTipo);
    prefillItemsForTipo(newTipo);
  };

  /* Item handlers */
  const addItem = () => {
    setItems(arr => [...arr, { concepto: '', cantidad: '1', valor_unitario: '', subtotal: 0, tipo: 'haber' }]);
  };
  const removeItem = (idx) => {
    setItems(arr => arr.filter((_, i) => i !== idx));
  };
  const updateItem = (idx, field, value) => {
    setItems(arr => arr.map((it, i) => {
      if (i !== idx) return it;
      const next = { ...it, [field]: value };
      const c = Number(next.cantidad);
      const v = Number(next.valor_unitario);
      next.subtotal = (Number.isFinite(c) && Number.isFinite(v)) ? c * v : 0;
      return next;
    }));
  };

  const insertarDiaComoItem = () => {
    const vd = A.calcValorDia(sueldoBasico);
    if (!vd) { toast.error('Cargá un sueldo básico válido primero'); return; }
    setItems(arr => [...arr, {
      concepto: 'Días trabajados',
      cantidad: '1',
      valor_unitario: vd.toFixed(2),
      subtotal: vd,
      tipo: 'haber',
    }]);
  };

  const validate = () => {
    const e = {};
    if (!employeeId && !isEdit) e.employeeId = 'Seleccioná un empleado';
    if (!tipo) e.tipo = 'Tipo requerido';
    if (!periodoDesde) e.periodoDesde = 'Fecha desde requerida';
    if (!periodoHasta) e.periodoHasta = 'Fecha hasta requerida';
    if (periodoDesde && periodoHasta && periodoHasta < periodoDesde) {
      e.periodoHasta = 'Hasta debe ser >= Desde';
    }
    if (!fechaPago) e.fechaPago = 'Fecha de pago requerida';
    const sb = Number(sueldoBasico);
    if (sueldoBasico === '' || !Number.isFinite(sb) || sb < 0) {
      e.sueldoBasico = 'Sueldo básico requerido (>= 0)';
    }
    if (items.length === 0) {
      e.items = 'Agregá al menos un item';
    } else {
      const malo = items.findIndex(it => !(it.concepto && it.concepto.trim()));
      if (malo >= 0) e.items = `Item #${malo+1}: concepto requerido`;
    }
    if (notas.length > 500) e.notas = 'Máximo 500 caracteres';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const buildPayload = () => {
    return {
      employee_id: employeeId,
      tipo: tipo,
      periodo_desde: periodoDesde,
      periodo_hasta: periodoHasta,
      fecha_pago: fechaPago,
      sueldo_basico: String(Number(sueldoBasico)),
      items: items.map(it => ({
        concepto: (it.concepto || '').trim(),
        cantidad: Number(it.cantidad) || 0,
        valor_unitario: Number(it.valor_unitario) || 0,
        subtotal: Number(it.subtotal) || 0,
        tipo: it.tipo === 'descuento' ? 'descuento' : 'haber',
      })),
      total: String(total),
      notas: notas.trim(),
    };
  };

  const doSubmit = async (alsoGeneratePdf) => {
    if (saving) return;
    if (isAnulado) { toast.error('No se puede editar un recibo anulado'); return; }
    if (!validate()) { toast.error('Revisá los campos en rojo'); return; }
    setSaving(true);
    try {
      let result;
      const payload = buildPayload();
      if (isEdit) {
        payload.id = initial.id;
        /* En edit, NO mandamos employee_id/tipo/periodo (snapshot inmutable). */
        delete payload.employee_id;
        delete payload.tipo;
        delete payload.periodo_desde;
        delete payload.periodo_hasta;
        delete payload.sueldo_basico;
        result = await A.updateRecibo(payload);
      } else {
        result = await A.createRecibo(payload);
      }
      toast.success(okMsg);

      if (alsoGeneratePdf && typeof onAfterCreatePdf === 'function') {
        const reciboId = (result && (result.recibo_id || result.id)) || (isEdit && initial && initial.id);
        try {
          await onAfterCreatePdf(reciboId);
        } catch (errPdf) {
          toast.error('Recibo guardado, pero el PDF falló: ' + (errPdf.message || ''));
        }
      }

      try { onSuccess?.(); } catch (_) {}
      onClose?.();
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar');
      setSaving(false);
    }
  };

  const safeClose = () => { if (!saving) onClose?.(); };
  const Cmp = window.Modal;
  const readOnly = isAnulado;

  return (
    <Cmp open={true} title={title} onClose={safeClose} footer={
      <>
        <button className="btn-ghost" onClick={safeClose} disabled={saving}>
          {readOnly ? 'Cerrar' : 'Cancelar'}
        </button>
        {!readOnly && (
          <>
            <button className="btn-ghost" onClick={() => doSubmit(false)} disabled={saving}>
              {saving ? 'Guardando…' : (<><Icon n="check" s={14}/> Guardar</>)}
            </button>
            <button className="btn-primary" onClick={() => doSubmit(true)} disabled={saving}>
              {saving ? 'Guardando…' : (<><Icon n="download" s={14}/> Guardar + PDF</>)}
            </button>
          </>
        )}
      </>
    }>
      {isAnulado && (
        <div className="recibo-anulado-banner">
          <Icon n="alert" s={14} c="var(--red)"/>
          <strong>Recibo anulado</strong> — solo lectura.
        </div>
      )}

      {/* SECCIÓN 1 — Empleado y tipo */}
      <ReciboSection open={openSections.empleado} onToggle={() => toggleSection('empleado')}
                     title="Empleado y tipo">
        {!isEdit && (
          <div className="field-group">
            <label className="field-label">Empleado *</label>
            {empLoading ? (
              <div className="field-help"><span className="loader" style={{width:14,height:14,verticalAlign:'middle'}}/> Cargando empleados…</div>
            ) : empError ? (
              <div className="field-error">{empError}</div>
            ) : (
              <select className={`field-input ${errors.employeeId ? 'has-error' : ''}`}
                      value={employeeId}
                      onChange={e => onSelectEmployee(e.target.value)}>
                <option value="">— Seleccionar empleado activo —</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>
                    {emp.nombre} {emp.dni ? `· ${emp.dni}` : ''}
                  </option>
                ))}
              </select>
            )}
            {errors.employeeId && <div className="field-error">{errors.employeeId}</div>}
            {empleadoSelected && (
              <div className="recibo-empleado-snapshot">
                <span><strong>DNI:</strong> {empleadoSelected.dni || '—'}</span>
                <span><strong>Categoría:</strong> {empleadoSelected.categoria || '—'}</span>
                <span><strong>F. ingreso:</strong> {A.formatDate(empleadoSelected.fecha_ingreso)}</span>
              </div>
            )}
          </div>
        )}

        {isEdit && (
          <div className="recibo-empleado-snapshot is-locked">
            <div><strong>Empleado:</strong> {initial.empleado_nombre || '—'}</div>
            <div><strong>DNI:</strong> {initial.empleado_dni || '—'}</div>
            <div><strong>Categoría:</strong> {initial.empleado_categoria || '—'}</div>
            <div><strong>F. ingreso:</strong> {A.formatDate(initial.empleado_fecha_ingreso)}</div>
            <div className="field-help">Snapshot inmutable post-alta.</div>
          </div>
        )}

        <div className="field-group">
          <label className="field-label">Tipo de recibo *</label>
          {isEdit ? (
            <div className="recibo-empleado-snapshot is-locked">
              <span className={`recibo-tipo-badge recibo-tipo-${initial.tipo}`}>{
                (A.RECIBO_TIPO_OPTIONS.find(o => o.value === initial.tipo) || {}).label || initial.tipo
              }</span>
              <span className="field-help" style={{marginLeft:6}}>Inmutable post-alta.</span>
            </div>
          ) : (
            <div className="recibo-tipo-radio-row">
              {A.RECIBO_TIPO_OPTIONS.map(o => (
                <label key={o.value} className="recibo-tipo-radio">
                  <input type="radio" name="tipo" value={o.value}
                         checked={tipo === o.value}
                         onChange={() => onChangeTipo(o.value)}/>
                  {o.label}
                </label>
              ))}
            </div>
          )}
          {errors.tipo && <div className="field-error">{errors.tipo}</div>}
        </div>
      </ReciboSection>

      {/* SECCIÓN 2 — Período y fecha */}
      <ReciboSection open={openSections.periodo} onToggle={() => toggleSection('periodo')}
                     title="Período y fecha de pago">
        <div className="supplier-modal-grid">
          <div className="field-group">
            <label className="field-label">Desde *</label>
            <input type="date" className={`field-input ${errors.periodoDesde ? 'has-error' : ''} ${isEdit ? 'is-readonly' : ''}`}
                   value={periodoDesde}
                   readOnly={isEdit}
                   title={isEdit ? 'Período inmutable post-alta' : ''}
                   onChange={e => setPeriodoDesde(e.target.value)}/>
            {errors.periodoDesde && <div className="field-error">{errors.periodoDesde}</div>}
          </div>
          <div className="field-group">
            <label className="field-label">Hasta *</label>
            <input type="date" className={`field-input ${errors.periodoHasta ? 'has-error' : ''} ${isEdit ? 'is-readonly' : ''}`}
                   value={periodoHasta}
                   readOnly={isEdit}
                   title={isEdit ? 'Período inmutable post-alta' : ''}
                   onChange={e => setPeriodoHasta(e.target.value)}/>
            {errors.periodoHasta && <div className="field-error">{errors.periodoHasta}</div>}
          </div>
        </div>
        <div className="field-group">
          <label className="field-label">Fecha de pago *</label>
          <input type="date" className={`field-input ${errors.fechaPago ? 'has-error' : ''}`}
                 value={fechaPago}
                 readOnly={readOnly}
                 onChange={e => setFechaPago(e.target.value)}/>
          {errors.fechaPago && <div className="field-error">{errors.fechaPago}</div>}
        </div>
      </ReciboSection>

      {/* SECCIÓN 3 — Básico + valor día */}
      <ReciboSection open={openSections.basico} onToggle={() => toggleSection('basico')}
                     title="Sueldo básico y valor del día">
        <div className="supplier-modal-grid">
          <div className="field-group">
            <label className="field-label">Sueldo básico *</label>
            <input type="number" step="0.01" min="0"
                   className={`field-input ${errors.sueldoBasico ? 'has-error' : ''} ${isEdit ? 'is-readonly' : ''}`}
                   value={sueldoBasico}
                   readOnly={isEdit}
                   title={isEdit ? 'Snapshot inmutable post-alta' : 'Snapshot del básico al momento del recibo'}
                   onChange={e => setSueldoBasico(e.target.value)}/>
            {errors.sueldoBasico && <div className="field-error">{errors.sueldoBasico}</div>}
          </div>
          <div className="field-group">
            <label className="field-label">Valor del día (calc.)</label>
            <input className="field-input is-readonly" readOnly
                   value={window.ReciboPDF ? window.ReciboPDF.fmtMoney(valorDia) : valorDia.toFixed(2)}
                   title="sueldo básico / 30"/>
            <div className="field-help">
              {!readOnly && !isEdit && (
                <button type="button" className="btn-link" onClick={insertarDiaComoItem}>
                  + Insertar día como item
                </button>
              )}
            </div>
          </div>
        </div>
      </ReciboSection>

      {/* SECCIÓN 4 — Items */}
      <ReciboSection open={openSections.items} onToggle={() => toggleSection('items')}
                     title="Items (haberes y descuentos)">
        <table className="recibo-items-table">
          <thead>
            <tr>
              <th>Concepto</th>
              <th style={{width:70, textAlign:'right'}}>Cant.</th>
              <th style={{width:110, textAlign:'right'}}>Vlr. Unit.</th>
              <th style={{width:110, textAlign:'right'}}>Subtotal</th>
              <th style={{width:70}}>Tipo</th>
              <th style={{width:32}}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => {
              const esDescuento = it.tipo === 'descuento';
              return (
                <tr key={idx}>
                  <td>
                    <input className="field-input field-input-sm"
                           value={it.concepto}
                           readOnly={readOnly}
                           onChange={e => updateItem(idx, 'concepto', e.target.value)}/>
                  </td>
                  <td>
                    <input type="number" step="0.01" className="field-input field-input-sm" style={{textAlign:'right'}}
                           value={it.cantidad}
                           readOnly={readOnly}
                           onChange={e => updateItem(idx, 'cantidad', e.target.value)}/>
                  </td>
                  <td>
                    <input type="number" step="0.01" className="field-input field-input-sm" style={{textAlign:'right'}}
                           value={it.valor_unitario}
                           readOnly={readOnly}
                           onChange={e => updateItem(idx, 'valor_unitario', e.target.value)}/>
                  </td>
                  <td style={{textAlign:'right', fontWeight:600, color: (esDescuento || Number(it.subtotal) < 0) ? 'var(--red, #dc2626)' : undefined}}>
                    {window.ReciboPDF ? window.ReciboPDF.fmtMoney(it.subtotal) : Number(it.subtotal).toFixed(2)}
                  </td>
                  <td>
                    <select className="field-input field-input-sm"
                            value={it.tipo}
                            disabled={readOnly}
                            onChange={e => updateItem(idx, 'tipo', e.target.value)}>
                      <option value="haber">Haber</option>
                      <option value="descuento">Descuento</option>
                    </select>
                  </td>
                  <td>
                    {!readOnly && (
                      <button type="button" className="btn-ghost-sm danger" title="Quitar"
                              onClick={() => removeItem(idx)}>
                        <Icon n="x" s={12}/>
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr><td colSpan={6} style={{textAlign:'center', padding:'14px', color:'var(--ink-muted)'}}>
                Sin items. {!readOnly && 'Agregá al menos uno.'}
              </td></tr>
            )}
          </tbody>
        </table>

        {!readOnly && (
          <div style={{marginTop:8}}>
            <button type="button" className="btn-ghost" onClick={addItem}>
              <Icon n="plus" s={13}/> Agregar item
            </button>
          </div>
        )}

        {errors.items && <div className="field-error" style={{marginTop:6}}>{errors.items}</div>}

        <div className="recibo-total-row">
          <span>Total a pagar:</span>
          <strong style={{color: totalNegativo ? 'var(--red, #dc2626)' : undefined}}>
            {window.ReciboPDF ? window.ReciboPDF.fmtMoney(total) : total.toFixed(2)}
          </strong>
          {totalNegativo && <span className="badge-vencido" style={{marginLeft:8}}>total negativo</span>}
        </div>

        <div className="field-group" style={{marginTop:12}}>
          <label className="field-label">Notas (opcional)</label>
          <textarea className={`field-input ${errors.notas ? 'has-error' : ''}`}
                    value={notas} rows={2} maxLength={500}
                    readOnly={readOnly}
                    onChange={e => setNotas(e.target.value)}/>
          {errors.notas
            ? <div className="field-error">{errors.notas}</div>
            : <div className="field-help">{notas.length} / 500</div>}
        </div>
      </ReciboSection>
    </Cmp>
  );
}

function ReciboSection({ open, onToggle, title, children }) {
  return (
    <div className={`supplier-modal-section ${open ? 'is-open' : ''}`}>
      <button type="button" className="supplier-modal-section-header" onClick={onToggle}>
        <Icon n={open ? 'chev-down' : 'chev-right'} s={14}/>
        <span>{title}</span>
      </button>
      {open && <div className="supplier-modal-section-body">{children}</div>}
    </div>
  );
}

window.ReciboModal = ReciboModal;
