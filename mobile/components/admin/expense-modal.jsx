/* ══ EXPENSE MODAL (B.3 + B.3.1 + S2.1 + S2.3 refactor mayor)
   Alta o edicion manual de egreso. 4 secciones colapsables:
     1) Datos del comprobante (default abierto)
     2) Items detalle (abierto si hay items)
     3) Totales
     4) Comprobante (drag-and-drop upload)

   Diferenciacion semantica (S2.3):
     - medio_pago    = "Como se pago (instrumento)" — efectivo/transfer/cheque/...
     - condicion_pago = "Modalidad de pago (cuando)" — contado/cta_cte/...

   Carteles informativos por tipo_comprobante:
     - nota_credito → "el monto restara del saldo del proveedor"
     - nota_debito  → "el monto se sumara al saldo del proveedor"

   Reusa window.Modal de modals.jsx. Reusa window.ExpenseItemsEditor,
   window.ComprobanteUploader (componentes hermanos S2.3).

   Compat pre-S2.3: si initial tiene campos nuevos NULL, el form usa
   defaults sensatos. items=null → [].

   Props: { suppliers, mode, initial?, onClose, onSuccess }
   ══ */

const HIDE_SUPPLIER_CATEGORIES = ['sueldos', 'impuestos'];

const EXPENSE_CATEGORIAS = [
  { value: 'materiales_insumos',     label: 'Materiales / Insumos' },
  { value: 'fletes',                 label: 'Fletes' },
  { value: 'logistica_flex',         label: 'Logistica Flex' },
  { value: 'correo_encomiendas',     label: 'Correo / Encomiendas' },
  { value: 'gastos_fijos',           label: 'Gastos fijos' },
  { value: 'honorarios',             label: 'Honorarios' },
  { value: 'servicios',              label: 'Servicios' },
  { value: 'intereses_financiacion', label: 'Intereses / Financiacion' },
  { value: 'sueldos',                label: 'Sueldos' },
  { value: 'impuestos',              label: 'Impuestos' },
  { value: 'otros',                  label: 'Otros' },
];

const TIPO_COMPROBANTE_OPTIONS = [
  { value: 'factura',      label: 'Factura' },
  { value: 'nota_credito', label: 'Nota de credito' },
  { value: 'nota_debito',  label: 'Nota de debito' },
  { value: 'recibo',       label: 'Recibo' },
  { value: 'ticket',       label: 'Ticket' },
];

const CLASE_COMPROBANTE_OPTIONS  = ['A','B','C','M'];
const CONDICION_COMPROBANTE_OPTS = [
  { value: 'original',  label: 'Original' },
  { value: 'duplicado', label: 'Duplicado' },
];
const CONDICION_PAGO_OPTIONS = [
  { value: 'contado',          label: 'Contado' },
  { value: 'cuenta_corriente', label: 'Cuenta corriente' },
  { value: 'financiado',       label: 'Financiado' },
  { value: 'otro',             label: 'Otro' },
];

function ExpenseModal({ suppliers, mode, initial, onClose, onSuccess }) {
  const toast = useToast();
  const today = window.todayLocalStr();
  const isEdit = mode === 'edit';

  /* Migrar categoria pre-S2.3 'insumos' → 'materiales_insumos' al cargar
     (no deberia pasar porque la migration ya lo hizo, pero defensivo). */
  const initialCategoria = (() => {
    const c = (initial && initial.categoria) || 'materiales_insumos';
    return c === 'insumos' ? 'materiales_insumos' : c;
  })();

  const [form, setForm] = useState({
    // legado (B.3)
    fecha: (initial && initial.fecha) ? String(initial.fecha).slice(0,10) : today,
    supplier_id: (initial && initial.supplier_id) || '',
    concepto: (initial && initial.concepto) || '',
    monto_total: (initial && initial.monto_total != null) ? String(initial.monto_total) : '',
    moneda: (initial && initial.moneda) || 'ARS',
    iva_discriminado: (initial && initial.iva_discriminado != null) ? String(initial.iva_discriminado) : '',
    categoria: initialCategoria,
    medio_pago: (initial && initial.medio_pago) || 'efectivo',
    notas: (initial && initial.notas) || '',
    // S2.3 comprobante
    tipo_comprobante:        (initial && initial.tipo_comprobante)        || '',
    clase_comprobante:       (initial && initial.clase_comprobante)       || '',
    condicion_comprobante:   (initial && initial.condicion_comprobante)   || '',
    punto_venta:             (initial && initial.punto_venta)             || '',
    numero_comprobante:      (initial && initial.numero_comprobante)      || '',
    fecha_vencimiento:       (initial && initial.fecha_vencimiento)
                              ? String(initial.fecha_vencimiento).slice(0,10) : '',
    cae:                     (initial && initial.cae)                     || '',
    condicion_pago:          (initial && initial.condicion_pago)          || '',
    concepto_libre:          (initial && initial.concepto_libre)          || '',
    razon_social_proveedor:  (initial && initial.razon_social_proveedor)  || '',
    condicion_iva_proveedor: (initial && initial.condicion_iva_proveedor) || '',
    // S2.3 totales
    subtotal_neto:           (initial && initial.subtotal_neto != null) ? String(initial.subtotal_neto) : '',
    iva_pct:                 (initial && initial.iva_pct != null) ? String(initial.iva_pct) : '',
    iva_monto:               (initial && initial.iva_monto != null) ? String(initial.iva_monto) : '',
    otros_tributos_desc:     (initial && initial.otros_tributos_desc) || '',
    otros_tributos_pct:      (initial && initial.otros_tributos_pct != null) ? String(initial.otros_tributos_pct) : '',
    otros_tributos_monto:    (initial && initial.otros_tributos_monto != null) ? String(initial.otros_tributos_monto) : '',
  });

  /* Items array (jsonb). */
  const [items, setItems] = useState(() => {
    if (initial && Array.isArray(initial.items)) return initial.items;
    return [];
  });

  /* Comprobante state (separado del form porque el upload tiene side effects). */
  const [comprobante, setComprobante] = useState(() => {
    if (initial && initial.comprobante_url) {
      return {
        url: initial.comprobante_url,
        mime: initial.comprobante_mime || null,
        size_bytes: initial.comprobante_size_bytes || null,
      };
    }
    return null;
  });

  const [genOverride, setGenOverride] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState(
    initial && initial.supplier_id
      ? ((initial.suppliers && initial.suppliers.nombre) || '')
      : ''
  );
  const [supplierDropdownOpen, setSupplierDropdownOpen] = useState(false);

  /* Tracking del path en _pending/ para cleanup al cancelar.
     Solo aplica en mode='create' (en edit el path es definitivo). */
  const [pendingComprobantePath, setPendingComprobantePath] = useState(null);

  const [openSections, setOpenSections] = useState({
    comprobante: true,
    items:       items.length > 0,
    totales:     false,
    archivo:     !!(initial && initial.comprobante_url),
  });

  const showSupplier = !HIDE_SUPPLIER_CATEGORIES.includes(form.categoria);

  useEffect(() => { setGenOverride(null); }, [form.supplier_id, form.medio_pago]);

  useEffect(() => {
    if (!showSupplier) {
      setForm(s => ({ ...s, supplier_id: '' }));
      setSupplierSearch('');
      setSupplierDropdownOpen(false);
      setGenOverride(null);
      setErrors(e => { const { supplier_id, ...rest } = e; return rest; });
    }
    /* eslint-disable-next-line */
  }, [form.categoria]);

  /* Auto-prefill razon social al elegir proveedor. */
  const selectedSupplier = useMemo(
    () => suppliers.find(s => s.id === form.supplier_id) || null,
    [suppliers, form.supplier_id]
  );
  useEffect(() => {
    if (selectedSupplier && !form.razon_social_proveedor) {
      setForm(s => ({
        ...s,
        razon_social_proveedor: selectedSupplier.razon_social_arca || selectedSupplier.nombre || '',
        condicion_iva_proveedor: s.condicion_iva_proveedor || selectedSupplier.condicion_iva || selectedSupplier.condicion_fiscal || '',
      }));
    }
    /* eslint-disable-next-line */
  }, [selectedSupplier]);

  const set = (k, v) => setForm(s => ({ ...s, [k]: v }));
  const toggle = (k) => setOpenSections(s => ({ ...s, [k]: !s[k] }));

  /* Totales calculados (useMemo). */
  const subtotalCalculado = useMemo(
    () => items.reduce((acc, it) => acc + (Number(it.subtotal) || 0), 0),
    [items]
  );
  const ivaCalculado = useMemo(
    () => items.reduce((acc, it) => {
      const s = Number(it.subtotal) || 0;
      const p = Number(it.iva_pct) || 0;
      return acc + (s * p / 100);
    }, 0),
    [items]
  );
  const effectiveSubtotal = (form.subtotal_neto !== '' && form.subtotal_neto != null)
    ? Number(form.subtotal_neto)
    : subtotalCalculado;
  const effectiveIva = (form.iva_monto !== '' && form.iva_monto != null)
    ? Number(form.iva_monto)
    : ivaCalculado;
  const otrosTributosMonto = useMemo(() => {
    if (form.otros_tributos_monto !== '' && form.otros_tributos_monto != null) {
      return Number(form.otros_tributos_monto);
    }
    const pct = Number(form.otros_tributos_pct) || 0;
    return effectiveSubtotal * pct / 100;
  }, [form.otros_tributos_monto, form.otros_tributos_pct, effectiveSubtotal]);
  const totalCalculado = effectiveSubtotal + effectiveIva + otrosTributosMonto;

  const filteredSuppliers = useMemo(() => {
    const q = supplierSearch.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter(s =>
      (s.nombre || '').toLowerCase().includes(q) ||
      (s.cuit   || '').toLowerCase().includes(q)
    );
  }, [suppliers, supplierSearch]);

  const validate = () => {
    const A = window.ADMIN_DATA;
    const e = {};
    const f = A.validateFecha(form.fecha);       if (!f.ok) e.fecha = f.msg;
    const c = A.validateConcepto(form.concepto); if (!c.ok) e.concepto = c.msg;
    /* monto_total: si hay items con importe, usa total calculado; si no, valida input manual. */
    const montoToValidate = (form.monto_total !== '' && form.monto_total != null)
      ? form.monto_total
      : String(Math.round(totalCalculado * 100) / 100);
    const m = A.validateMonto(montoToValidate); if (!m.ok) e.monto_total = m.msg;
    const n = A.validateNotas(form.notas);      if (!n.ok) e.notas = n.msg;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSubmit = async () => {
    if (saving) return;
    if (!validate()) {
      toast.error('Revisa los campos en rojo');
      // abrir bloques con errores
      setOpenSections(s => ({ ...s, comprobante: s.comprobante || !!errors.concepto || !!errors.fecha }));
      return;
    }
    setSaving(true);
    try {
      /* Si monto_total esta vacio, usa totalCalculado. */
      const finalMonto = (form.monto_total !== '' && form.monto_total != null)
        ? Number(form.monto_total)
        : Math.round(totalCalculado * 100) / 100;

      const payload = {
        // legado
        fecha: form.fecha,
        supplier_id: showSupplier ? (form.supplier_id || null) : null,
        concepto: form.concepto.trim(),
        monto_total: String(finalMonto),
        moneda: form.moneda,
        iva_discriminado: (form.iva_discriminado !== '')
          ? String(Number(form.iva_discriminado)) : null,
        categoria: form.categoria,
        medio_pago: form.medio_pago,
        notas: form.notas.trim(),
        // S2.3
        tipo_comprobante:        form.tipo_comprobante || null,
        clase_comprobante:       form.clase_comprobante || null,
        condicion_comprobante:   form.condicion_comprobante || null,
        punto_venta:             form.punto_venta || null,
        numero_comprobante:      form.numero_comprobante || null,
        fecha_vencimiento:       form.fecha_vencimiento || null,
        cae:                     form.cae || null,
        condicion_pago:          form.condicion_pago || null,
        concepto_libre:          form.concepto_libre || null,
        razon_social_proveedor:  form.razon_social_proveedor || null,
        condicion_iva_proveedor: form.condicion_iva_proveedor || null,
        subtotal_neto:           form.subtotal_neto !== '' ? String(Number(form.subtotal_neto)) : (subtotalCalculado > 0 ? String(Math.round(subtotalCalculado * 100) / 100) : null),
        iva_pct:                 form.iva_pct !== '' ? String(Number(form.iva_pct)) : null,
        iva_monto:               form.iva_monto !== '' ? String(Number(form.iva_monto)) : (ivaCalculado > 0 ? String(Math.round(ivaCalculado * 100) / 100) : null),
        otros_tributos_desc:     form.otros_tributos_desc || null,
        otros_tributos_pct:      form.otros_tributos_pct !== '' ? String(Number(form.otros_tributos_pct)) : null,
        otros_tributos_monto:    form.otros_tributos_monto !== '' ? String(Number(form.otros_tributos_monto)) : (otrosTributosMonto > 0 ? String(Math.round(otrosTributosMonto * 100) / 100) : null),
        items:                   items,
        comprobante_url:         comprobante ? comprobante.url : null,
        comprobante_mime:        comprobante ? comprobante.mime : null,
        comprobante_size_bytes:  comprobante ? comprobante.size_bytes : null,
      };
      if (isEdit) {
        payload.id = initial.id;
        await window.ADMIN_DATA.updateExpense(payload);
        toast.success('Egreso actualizado');
      } else {
        payload.confirmed_by_human = true;
        const showCheckbox = showSupplier && !!form.supplier_id;
        if (showCheckbox) {
          const defaultGen = !(form.medio_pago === 'efectivo' || form.medio_pago === 'transferencia');
          const effGen = (genOverride !== null) ? genOverride : defaultGen;
          payload.generate_supplier_movement = effGen;
        }
        await window.ADMIN_DATA.createExpense(payload);
        toast.success('Egreso registrado');
      }
      /* Submit OK: el comprobante _pending/ quedó referenciado en
         expense.comprobante_url, NO debemos borrarlo. Limpiar tracking. */
      setPendingComprobantePath(null);
      try { onSuccess?.(); } catch (_) {}
      onClose?.();
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar');
      setSaving(false);
    }
  };

  /* Cancelar (botón Cancelar, ESC, click backdrop):
     - Si mode='create' Y se subió un comprobante a _pending/ que no
       quedó referenciado en ningún expense (porque cancelamos antes
       de guardar) → borrarlo del bucket para evitar archivos
       huérfanos.
     - mode='edit': el path es definitivo, no se toca.
     - safeClose es async pero el window.Modal espera un onClose sync;
       igual funciona porque el cleanup corre en fire-and-await y
       después llama onClose. */
  const safeClose = async () => {
    if (saving) return;
    if (!isEdit
        && pendingComprobantePath
        && pendingComprobantePath.includes('/_pending/')) {
      try {
        await window.ADMIN_DATA.deleteComprobante(pendingComprobantePath);
      } catch (e) {
        console.warn('No se pudo limpiar comprobante huérfano:', e);
      }
    }
    onClose?.();
  };
  const Cmp = window.Modal;

  /* Wrappear el onChange del uploader para trackear el path pendiente
     solo cuando estamos en mode='create' Y el path es _pending/. */
  const handleComprobanteChange = (next) => {
    setComprobante(next);
    if (!isEdit) {
      if (next && next.url && next.url.includes('/_pending/')) {
        setPendingComprobantePath(next.url);
      } else {
        // El user eliminó el comprobante O el path ya no es _pending/
        setPendingComprobantePath(null);
      }
    }
  };

  const pickSupplier = (id, name) => {
    set('supplier_id', id);
    setSupplierSearch(name);
    setSupplierDropdownOpen(false);
  };

  const showCheckbox = showSupplier && !!form.supplier_id;
  const defaultGen = !(form.medio_pago === 'efectivo' || form.medio_pago === 'transferencia');
  const effectiveGen = (genOverride !== null) ? genOverride : defaultGen;

  const showClaseField   = form.tipo_comprobante === 'factura';
  const isNotaCredito    = form.tipo_comprobante === 'nota_credito';
  const isNotaDebito     = form.tipo_comprobante === 'nota_debito';

  return (
    <Cmp open={true}
         title={isEdit ? 'Editar egreso' : 'Nuevo egreso'}
         onClose={safeClose}
         size="lg"
         footer={
           <>
             <button className="btn-ghost" onClick={safeClose} disabled={saving}>Cancelar</button>
             <button className="btn-primary" onClick={onSubmit} disabled={saving}>
               {saving ? 'Guardando…' : (<><Icon n="check" s={14}/> Guardar</>)}
             </button>
           </>
         }>

      {/* Carteles informativos NC/ND */}
      {isNotaCredito && (
        <div className="expense-modal-banner expense-modal-banner-info">
          <Icon n="info" s={16}/>
          <span><strong>Nota de credito:</strong> el monto restará automáticamente del saldo del proveedor en cuenta corriente.</span>
        </div>
      )}
      {isNotaDebito && (
        <div className="expense-modal-banner expense-modal-banner-warning">
          <Icon n="info" s={16}/>
          <span><strong>Nota de debito:</strong> el monto se sumará al saldo del proveedor en cuenta corriente.</span>
        </div>
      )}

      {/* ── SECCION 1: Datos del comprobante ── */}
      <ExpenseSection open={openSections.comprobante} onToggle={() => toggle('comprobante')}
                      title="Datos del comprobante">
        <div className="expense-modal-grid">
          <div className="field-group">
            <label className="field-label">Tipo</label>
            <select className="field-input" value={form.tipo_comprobante}
                    onChange={e => set('tipo_comprobante', e.target.value)}>
              <option value="">— Sin especificar —</option>
              {TIPO_COMPROBANTE_OPTIONS.map(o =>
                <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {showClaseField ? (
            <div className="field-group">
              <label className="field-label">Clase</label>
              <select className="field-input" value={form.clase_comprobante}
                      onChange={e => set('clase_comprobante', e.target.value)}>
                <option value="">— Sin clase —</option>
                {CLASE_COMPROBANTE_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          ) : (
            <div className="field-group">
              <label className="field-label">Condicion</label>
              <select className="field-input" value={form.condicion_comprobante}
                      onChange={e => set('condicion_comprobante', e.target.value)}>
                <option value="">— Sin especificar —</option>
                {CONDICION_COMPROBANTE_OPTS.map(o =>
                  <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="expense-modal-grid">
          <div className="field-group">
            <label className="field-label">Punto de venta</label>
            <input className="field-input" value={form.punto_venta}
                   placeholder="Ej: 0005"
                   onChange={e => set('punto_venta', e.target.value)}/>
          </div>
          <div className="field-group">
            <label className="field-label">N° comprobante</label>
            <input className="field-input" value={form.numero_comprobante}
                   placeholder="Ej: 00103625"
                   onChange={e => set('numero_comprobante', e.target.value)}/>
          </div>
        </div>

        <div className="expense-modal-grid">
          <div className="field-group">
            <label className="field-label">Fecha emisión *</label>
            <input type="date" className={`field-input ${errors.fecha ? 'has-error' : ''}`}
                   value={form.fecha}
                   onChange={e => set('fecha', e.target.value)} onBlur={validate}/>
            {errors.fecha && <div className="field-error">{errors.fecha}</div>}
          </div>
          <div className="field-group">
            <label className="field-label">Fecha vencimiento</label>
            <input type="date" className="field-input"
                   value={form.fecha_vencimiento}
                   onChange={e => set('fecha_vencimiento', e.target.value)}/>
          </div>
        </div>

        <div className="field-group">
          <label className="field-label">CAE</label>
          <input className="field-input" value={form.cae}
                 placeholder="Ej: 86206322424393"
                 onChange={e => set('cae', e.target.value)}/>
        </div>

        <div className="expense-modal-grid">
          <div className="field-group">
            <label className="field-label" title="Cómo se pagó (instrumento físico)">
              Medio de pago * <span className="field-label-hint">(cómo)</span>
            </label>
            <select className="field-input" value={form.medio_pago}
                    onChange={e => set('medio_pago', e.target.value)}>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="cheque">Cheque</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="otro">Otro</option>
            </select>
            <div className="field-help">Instrumento físico del pago.</div>
          </div>
          <div className="field-group">
            <label className="field-label" title="Modalidad comercial del pago (cuándo se paga)">
              Condición de pago <span className="field-label-hint">(cuándo)</span>
            </label>
            <select className="field-input" value={form.condicion_pago}
                    onChange={e => set('condicion_pago', e.target.value)}>
              <option value="">— Sin especificar —</option>
              {CONDICION_PAGO_OPTIONS.map(o =>
                <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <div className="field-help">Modalidad comercial (contado vs cta cte).</div>
          </div>
        </div>

        {showSupplier && (
          <div className="field-group">
            <label className="field-label">Proveedor</label>
            <div className="supplier-combo">
              <input className="field-input"
                     placeholder={selectedSupplier ? selectedSupplier.nombre : 'Sin proveedor del catalogo'}
                     value={supplierSearch}
                     onFocus={() => setSupplierDropdownOpen(true)}
                     onChange={e => { setSupplierSearch(e.target.value); setSupplierDropdownOpen(true); }}/>
              {supplierDropdownOpen && (
                <div className="supplier-dropdown" onMouseLeave={() => setSupplierDropdownOpen(false)}>
                  <button type="button" className="supplier-option"
                          onClick={() => pickSupplier('', '')}>
                    <em>Sin proveedor del catalogo</em>
                  </button>
                  {filteredSuppliers.length === 0 ? (
                    <div className="supplier-empty">
                      {suppliers.length === 0
                        ? 'No hay proveedores cargados. Cargá uno desde tab Proveedores.'
                        : 'Sin resultados'}
                    </div>
                  ) : (
                    filteredSuppliers.map(s => (
                      <button type="button" key={s.id} className="supplier-option"
                              onClick={() => pickSupplier(s.id, s.nombre)}>
                        <strong>{s.nombre}</strong>
                        {s.cuit && <span style={{marginLeft:6, color:'var(--ink-muted)'}}>{s.cuit}</span>}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="expense-modal-grid">
          <div className="field-group">
            <label className="field-label">Razón social proveedor</label>
            <input className="field-input" value={form.razon_social_proveedor}
                   placeholder="(autocompleta desde proveedor)"
                   onChange={e => set('razon_social_proveedor', e.target.value)}/>
          </div>
          <div className="field-group">
            <label className="field-label">Condición IVA proveedor</label>
            <input className="field-input" value={form.condicion_iva_proveedor}
                   placeholder="RI / Monotributo / Exento / ..."
                   onChange={e => set('condicion_iva_proveedor', e.target.value)}/>
          </div>
        </div>

        <div className="expense-modal-grid">
          <div className="field-group">
            <label className="field-label">Categoría *</label>
            <select className="field-input" value={form.categoria}
                    onChange={e => set('categoria', e.target.value)}>
              {EXPENSE_CATEGORIAS.map(c =>
                <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div className="field-group">
            <label className="field-label">Moneda *</label>
            <select className="field-input" value={form.moneda}
                    onChange={e => set('moneda', e.target.value)}>
              <option value="ARS">ARS</option>
              <option value="USD">USD</option>
            </select>
          </div>
        </div>

        <div className="field-group">
          <label className="field-label">Concepto *</label>
          <input className={`field-input ${errors.concepto ? 'has-error' : ''}`}
                 placeholder="Descripcion del gasto"
                 value={form.concepto} maxLength={500}
                 onChange={e => set('concepto', e.target.value)} onBlur={validate}/>
          {errors.concepto && <div className="field-error">{errors.concepto}</div>}
        </div>

        <div className="field-group">
          <label className="field-label">Concepto libre (texto adicional del comprobante)</label>
          <textarea className="field-input" rows={2} value={form.concepto_libre}
                    placeholder="Detalle adicional opcional (ej: 'Compra mensual madera')"
                    onChange={e => set('concepto_libre', e.target.value)}/>
        </div>

        {showCheckbox && (
          <div className="field-group expense-cta-row">
            <label className="expense-cta-label">
              <input type="checkbox"
                     checked={effectiveGen}
                     onChange={e => setGenOverride(e.target.checked)}/>
              <span>Generar movimiento en cta cte del proveedor</span>
            </label>
            <div className="field-help">
              Default según medio de pago: {defaultGen ? 'sí' : 'no'}
              {genOverride !== null && ' (override manual)'}
            </div>
          </div>
        )}

        <div className="field-group">
          <label className="field-label">Notas internas</label>
          <textarea className={`field-input ${errors.notas ? 'has-error' : ''}`}
                    value={form.notas} rows={2} maxLength={500}
                    onChange={e => set('notas', e.target.value)} onBlur={validate}/>
          {errors.notas
            ? <div className="field-error">{errors.notas}</div>
            : <div className="field-help">{form.notas.length} / 500 · Visible solo para owner/admin</div>}
        </div>
      </ExpenseSection>

      {/* ── SECCION 2: Items detalle ── */}
      <ExpenseSection open={openSections.items} onToggle={() => toggle('items')}
                      title={`Items detalle ${items.length > 0 ? `(${items.length})` : ''}`}>
        <window.ExpenseItemsEditor
          value={items}
          onChange={setItems}
          disabled={saving}/>
      </ExpenseSection>

      {/* ── SECCION 3: Totales ── */}
      <ExpenseSection open={openSections.totales} onToggle={() => toggle('totales')}
                      title="Totales">
        <div className="expense-modal-grid">
          <div className="field-group">
            <label className="field-label">Subtotal neto</label>
            <input type="number" step="0.01" min="0"
                   className="field-input"
                   value={form.subtotal_neto}
                   placeholder={`Calculado: ${window.ADMIN_DATA.formatMoney(subtotalCalculado, form.moneda)}`}
                   onChange={e => set('subtotal_neto', e.target.value)}/>
            <div className="field-help">
              {form.subtotal_neto === '' ? 'Tomando valor calculado de items.' : 'Manual (override).'}
            </div>
          </div>
          <div className="field-group">
            <label className="field-label">IVA %</label>
            <select className="field-input" value={form.iva_pct}
                    onChange={e => set('iva_pct', e.target.value)}>
              <option value="">— Sin —</option>
              <option value="0">0 %</option>
              <option value="10.5">10.5 %</option>
              <option value="21">21 %</option>
              <option value="27">27 %</option>
            </select>
          </div>
        </div>

        <div className="expense-modal-grid">
          <div className="field-group">
            <label className="field-label">IVA monto</label>
            <input type="number" step="0.01" min="0"
                   className="field-input"
                   value={form.iva_monto}
                   placeholder={`Calculado: ${window.ADMIN_DATA.formatMoney(ivaCalculado, form.moneda)}`}
                   onChange={e => set('iva_monto', e.target.value)}/>
          </div>
          <div className="field-group">
            <label className="field-label">IVA discriminado (legado B.3)</label>
            <input type="number" step="0.01" min="0"
                   className="field-input"
                   value={form.iva_discriminado}
                   onChange={e => set('iva_discriminado', e.target.value)}/>
            <div className="field-help">Campo legado, opcional.</div>
          </div>
        </div>

        <div className="field-group">
          <label className="field-label">Otros tributos / percepciones — descripción</label>
          <input className="field-input" value={form.otros_tributos_desc}
                 placeholder="Ej: Percepción IIBB Bs.As."
                 onChange={e => set('otros_tributos_desc', e.target.value)}/>
        </div>

        <div className="expense-modal-grid">
          <div className="field-group">
            <label className="field-label">Otros tributos %</label>
            <input type="number" step="0.01" min="0"
                   className="field-input"
                   value={form.otros_tributos_pct}
                   onChange={e => set('otros_tributos_pct', e.target.value)}/>
          </div>
          <div className="field-group">
            <label className="field-label">Otros tributos monto</label>
            <input type="number" step="0.01" min="0"
                   className="field-input"
                   value={form.otros_tributos_monto}
                   placeholder={`Calculado: ${window.ADMIN_DATA.formatMoney(otrosTributosMonto, form.moneda)}`}
                   onChange={e => set('otros_tributos_monto', e.target.value)}/>
          </div>
        </div>

        <div className="expense-totales-summary">
          <div>
            <span className="expense-totales-label">Subtotal:</span>
            <span className="expense-totales-value">
              {window.ADMIN_DATA.formatMoney(effectiveSubtotal, form.moneda)}
            </span>
          </div>
          <div>
            <span className="expense-totales-label">IVA:</span>
            <span className="expense-totales-value">
              {window.ADMIN_DATA.formatMoney(effectiveIva, form.moneda)}
            </span>
          </div>
          <div>
            <span className="expense-totales-label">Otros:</span>
            <span className="expense-totales-value">
              {window.ADMIN_DATA.formatMoney(otrosTributosMonto, form.moneda)}
            </span>
          </div>
          <div className="expense-totales-total">
            <span className="expense-totales-label">Total:</span>
            <span className="expense-totales-value">
              {window.ADMIN_DATA.formatMoney(totalCalculado, form.moneda)}
            </span>
          </div>
        </div>

        <div className="field-group">
          <label className="field-label">Monto total * <span className="field-label-hint">(override)</span></label>
          <input type="number" step="0.01" min="0.01"
                 className={`field-input ${errors.monto_total ? 'has-error' : ''}`}
                 value={form.monto_total}
                 placeholder={`Calculado: ${window.ADMIN_DATA.formatMoney(totalCalculado, form.moneda)}`}
                 onChange={e => set('monto_total', e.target.value)} onBlur={validate}/>
          {errors.monto_total
            ? <div className="field-error">{errors.monto_total}</div>
            : <div className="field-help">
                {form.monto_total === ''
                  ? 'Si dejás vacío, se usa el total calculado al guardar.'
                  : 'Override manual del total.'}
              </div>}
        </div>
      </ExpenseSection>

      {/* ── SECCION 4: Comprobante (upload) ── */}
      <ExpenseSection open={openSections.archivo} onToggle={() => toggle('archivo')}
                      title={`Comprobante ${comprobante ? '✓' : ''}`}>
        <window.ComprobanteUploader
          expenseId={isEdit ? initial.id : null}
          initial={comprobante}
          disabled={saving}
          onChange={handleComprobanteChange}/>
      </ExpenseSection>
    </Cmp>
  );
}

/* Subcomponente: seccion colapsable. */
function ExpenseSection({ open, onToggle, title, children }) {
  return (
    <div className={`expense-modal-section ${open ? 'is-open' : ''}`}>
      <button type="button" className="expense-modal-section-header" onClick={onToggle}>
        <Icon n={open ? 'chev-down' : 'chev-right'} s={14}/>
        <span>{title}</span>
      </button>
      {open && <div className="expense-modal-section-body">{children}</div>}
    </div>
  );
}

window.ExpenseModal = ExpenseModal;
