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

   0178 — Valor del día editable, solo en ESTE recibo (recibos.valor_dia;
   no toca al empleado ni a otros recibos). Sin tocarlo todo es como antes:
   sueldo/30 y no se manda nada. Si se cambia, los items que lo usan como
   valor unitario (marcados "linked", marca que vive solo en el front) se
   recalculan y con ellos el total. Se edita donde se editan los items:
   alta y edición, nunca en anulados (el backend además rechaza anulados y
   períodos cerrados).

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
  /* 0178: valor del día con el que se abrió el recibo (el propio, o sueldo/30). */
  const vdInicial = (isEdit && initial) ? A.valorDiaDeRecibo(initial) : 0;
  /* Misma cuenta con la que se precargó el item, antes y después de la 0178
     (vd.toFixed(2)). Con Math.round(x*100) un sueldo/30 en medio centavo
     (21,45 / 30 = 0,715: toFixed da 0,71, Math.round 0,72) dejaba al item
     sin seguir el valor del día al reabrir el recibo. */
  const aDosDec = (x) => Number(x).toFixed(2);
  const [items, setItems] = useState(
    Array.isArray(initial && initial.items) ? initial.items.map(it => ({
      concepto: it.concepto || '',
      cantidad: it.cantidad != null ? String(it.cantidad) : '',
      valor_unitario: it.valor_unitario != null ? String(it.valor_unitario) : '',
      subtotal: it.subtotal != null ? Number(it.subtotal) : 0,
      tipo: it.tipo || 'haber',
      /* 0178: usa el valor del día como valor unitario → lo sigue si se edita. */
      linked: vdInicial > 0 && it.valor_unitario != null && it.valor_unitario !== ''
        && aDosDec(it.valor_unitario) === aDosDec(vdInicial),
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

  /* Valor del día automático (sueldo / 30, calc en vivo) */
  const valorDiaAuto = useMemo(() => A.calcValorDia(sueldoBasico), [sueldoBasico]);

  /* 0178 — Valor del día propio del recibo */
  const valorDiaPropio = (initial && initial.valor_dia != null && initial.valor_dia !== ''
                          && Number(initial.valor_dia) > 0) ? Number(initial.valor_dia) : null;
  const [valorDiaInput, setValorDiaInput] = useState(valorDiaPropio != null ? valorDiaPropio.toFixed(2) : '');
  const [valorDiaTocado, setValorDiaTocado] = useState(false);
  /* ¿La base ya tiene la columna? Un recibo leído con select('*') la trae
     como clave (aunque sea null); si no, se pregunta. false = falta la 0178. */
  const [colValorDia, setColValorDia] = useState(
    (initial && Object.prototype.hasOwnProperty.call(initial, 'valor_dia')) ? true : null
  );
  useEffect(() => {
    if (colValorDia !== null || isAnulado) return;
    let cancelled = false;
    A.reciboTieneValorDia().then(r => { if (!cancelled) setColValorDia(r); });
    return () => { cancelled = true; };
    /* eslint-disable-next-line */
  }, []);
  const valorDiaParse = valorDiaTocado ? A.parseValorDia(valorDiaInput) : null;
  /* El que vale ahora: lo tipeado (si es válido) > el propio > sueldo/30 */
  const valorDia = valorDiaTocado
    ? (valorDiaParse.ok ? valorDiaParse.valor : null)
    : (valorDiaPropio != null ? valorDiaPropio : valorDiaAuto);
  const valorDiaBloqueado = isAnulado || colValorDia === false;
  const valorDiaError = errors.valorDia || (valorDiaParse && !valorDiaParse.ok ? valorDiaParse.error : null);
  const itemsLinked = items.filter(it => it.linked).length;

  const onChangeValorDia = (txt) => {
    setValorDiaInput(txt);
    setValorDiaTocado(true);
    if (errors.valorDia) setErrors(e => ({ ...e, valorDia: undefined }));
    const r = A.parseValorDia(txt);
    if (!r.ok) return; /* los items quedan como estaban hasta que el valor sea válido */
    setItems(arr => arr.map(it => {
      if (!it.linked) return it;
      /* igual que si se tipeara el valor en su "Vlr. Unit." (ver updateItem) */
      const c = Number(it.cantidad);
      return { ...it, valor_unitario: r.valor.toFixed(2), subtotal: Number.isFinite(c) ? c * r.valor : 0 };
    }));
  };

  /* Valor del día para items nuevos (precarga / insertar día). Sin tocar el
     campo es exactamente lo de antes de la 0178: sueldo/30 sin redondear. */
  const vdParaItemsNuevos = () => (valorDiaTocado ? valorDia : A.calcValorDia(sueldoBasico));

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
    const vd = vdParaItemsNuevos() || 0;
    if (t === 'adelanto') {
      setItems([{ concepto: 'Adelanto a cuenta de sueldo', cantidad: '1', valor_unitario: '', subtotal: 0, tipo: 'haber' }]);
    } else if (t === 'quincena') {
      const v = vd ? vd.toFixed(2) : '';
      setItems([{ concepto: 'Días trabajados', cantidad: '15', valor_unitario: v, subtotal: vd * 15, tipo: 'haber', linked: true }]);
    } else if (t === 'sueldo') {
      const v = vd ? vd.toFixed(2) : '';
      setItems([{ concepto: 'Días trabajados', cantidad: '30', valor_unitario: v, subtotal: vd * 30, tipo: 'haber', linked: true }]);
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
      if (field === 'valor_unitario') next.linked = false; /* 0178: valor propio del item */
      const c = Number(next.cantidad);
      const v = Number(next.valor_unitario);
      next.subtotal = (Number.isFinite(c) && Number.isFinite(v)) ? c * v : 0;
      return next;
    }));
  };

  const insertarDiaComoItem = () => {
    const vd = vdParaItemsNuevos();
    if (!vd) {
      toast.error(valorDiaTocado ? 'Corregí el valor del día primero' : 'Cargá un sueldo básico válido primero');
      return;
    }
    setItems(arr => [...arr, {
      concepto: 'Días trabajados',
      cantidad: '1',
      valor_unitario: vd.toFixed(2),
      subtotal: vd,
      tipo: 'haber',
      linked: true,
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
    if (valorDiaTocado) {
      const r = A.parseValorDia(valorDiaInput);
      if (!r.ok) e.valorDia = r.error;
    }
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
      /* 0178: la clave solo viaja si se tocó el campo. Sin ella el backend
         no escribe la columna (alta: NULL; edición: conserva lo guardado). */
      const mandaValorDia = valorDiaTocado;
      if (mandaValorDia) payload.valor_dia = String(A.parseValorDia(valorDiaInput).valor);
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
      /* 0178: las RPC nuevas devuelven valor_dia. Si no vino, la base todavía
         no tiene la migración y el valor se ignoró: decirlo, no taparlo. */
      if (mandaValorDia && !(result && Object.prototype.hasOwnProperty.call(result, 'valor_dia'))) {
        toast.error('Se guardó el recibo, pero el valor del día NO: falta aplicar la migración 0178 en la base.');
      } else {
        toast.success(okMsg);
      }

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
            <label className="field-label">Valor del día</label>
            {valorDiaBloqueado ? (
              <input className="field-input is-readonly" readOnly
                     value={window.ReciboPDF ? window.ReciboPDF.fmtMoney(valorDia || 0) : Number(valorDia || 0).toFixed(2)}
                     title={valorDiaPropio != null ? 'Valor del día cargado en este recibo' : 'sueldo básico / 30'}/>
            ) : (
              <input type="number" step="0.01" min="0.01"
                     className={`field-input ${valorDiaError ? 'has-error' : ''}`}
                     value={valorDiaTocado ? valorDiaInput : (valorDia ? valorDia.toFixed(2) : '')}
                     placeholder="sueldo básico / 30"
                     title="Cambia solo en este recibo: no toca al empleado ni a otros recibos"
                     onChange={e => onChangeValorDia(e.target.value)}/>
            )}
            {valorDiaError && !valorDiaBloqueado && <div className="field-error">{valorDiaError}</div>}
            <div className="field-help">
              {colValorDia === false && !isAnulado && (
                <div>Para editarlo falta aplicar la migración 0178 en la base. Mientras tanto es sueldo básico / 30.</div>
              )}
              {!valorDiaBloqueado && (
                <div>
                  {(valorDiaTocado || valorDiaPropio != null)
                    ? `Cargado a mano, solo para este recibo (automático: ${window.ReciboPDF ? window.ReciboPDF.fmtMoney(valorDiaAuto) : valorDiaAuto.toFixed(2)}).`
                    : 'Automático: sueldo básico / 30. Si lo cambiás, cambia solo en este recibo.'}
                  {itemsLinked > 0 && ` Lo usa${itemsLinked > 1 ? 'n' : ''} ${itemsLinked} item${itemsLinked > 1 ? 's' : ''} como valor unitario: se recalcula${itemsLinked > 1 ? 'n' : ''} solo${itemsLinked > 1 ? 's' : ''}.`}
                </div>
              )}
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
