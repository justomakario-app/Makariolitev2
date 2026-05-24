/* ══ CHECK MODAL (B.4)
   Alta o edicion de cheque (emitido o recibido) segun props.
   No genera movement al crear (siempre generate=false); el movement
   se crea cuando el cheque pasa a estado=cobrado via check-status-modal.
   Solo se puede editar si estado='emitido' (el RPC valida).
   Props: { checkType: 'issued'|'received', mode: 'create'|'edit',
            parties, initial?, onClose, onSuccess }
   ══ */

function CheckModal({ checkType, mode, parties, initial, onClose, onSuccess }) {
  const toast = useToast();
  const isIssued = checkType === 'issued';
  const title = (mode === 'edit')
    ? (isIssued ? 'Editar cheque emitido' : 'Editar cheque recibido')
    : (isIssued ? 'Nuevo cheque emitido' : 'Nuevo cheque recibido');

  const partyLabel = isIssued ? 'Beneficiario' : 'Emisor';
  const partyTextoLabel = isIssued ? 'Beneficiario libre' : 'Emisor libre';
  const partyList = isIssued ? (parties.suppliers || []) : (parties.customers || []);

  const initialPartyId = isIssued
    ? (initial && initial.beneficiario_supplier_id) || ''
    : (initial && initial.emisor_customer_b2b_id) || '';
  const initialPartyTexto = isIssued
    ? (initial && initial.beneficiario_texto) || ''
    : (initial && initial.emisor_texto) || '';

  const [form, setForm] = useState({
    fecha_emision:        (initial && initial.fecha_emision) ? String(initial.fecha_emision).slice(0, 10) : window.todayLocalStr(),
    fecha_cobro_estimada: (initial && initial.fecha_cobro_estimada) ? String(initial.fecha_cobro_estimada).slice(0, 10) : '',
    numero:               (initial && initial.numero) || '',
    banco:                (initial && initial.banco) || '',
    monto:                (initial && initial.monto != null) ? String(initial.monto) : '',
    party_id:             initialPartyId,
    party_texto:          initialPartyTexto,
    notas:                (initial && initial.notas) || '',
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [partySearch, setPartySearch] = useState('');
  const [partyDropdownOpen, setPartyDropdownOpen] = useState(false);

  const selectedParty = useMemo(
    () => partyList.find(p => {
      const entity = isIssued ? p : p;  // partyList ya es flat (suppliers o customers_b2b shape uniforme)
      return entity.id === form.party_id;
    }) || null,
    [partyList, form.party_id, isIssued]
  );

  const filteredParties = useMemo(() => {
    const q = partySearch.trim().toLowerCase();
    if (!q) return partyList;
    return partyList.filter(p =>
      (p.nombre || '').toLowerCase().includes(q) ||
      (p.cuit || '').toLowerCase().includes(q)
    );
  }, [partyList, partySearch]);

  const set = (k, v) => setForm(s => ({ ...s, [k]: v }));

  const validate = () => {
    const A = window.ADMIN_DATA;
    const e = {};
    const f = A.validateFecha(form.fecha_emision);                  if (!f.ok)  e.fecha_emision = f.msg;
    const v = A.validateFechaVencimiento(form.fecha_cobro_estimada); if (!v.ok)  e.fecha_cobro_estimada = v.msg;
    const n = A.validateNumeroCheque(form.numero);                  if (!n.ok)  e.numero = n.msg;
    const b = A.validateBanco(form.banco);                          if (!b.ok)  e.banco = b.msg;
    const m = A.validateMonto(form.monto);                          if (!m.ok)  e.monto = m.msg;
    // Beneficiario/emisor: debe haber al menos uno (de catalogo o texto libre)
    if (!form.party_id && !form.party_texto.trim()) {
      e.party = isIssued ? 'Indicá beneficiario (del catálogo o texto libre)' : 'Indicá emisor (del catálogo o texto libre)';
    }
    const nt = A.validateNotas(form.notas);                         if (!nt.ok) e.notas = nt.msg;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSubmit = async () => {
    if (saving) return;
    if (!validate()) { toast.error('Revisa los campos en rojo'); return; }
    setSaving(true);
    try {
      const payloadBase = {
        numero: form.numero.trim(),
        banco: form.banco.trim(),
        monto: String(Number(form.monto)),
        fecha_emision: form.fecha_emision,
        fecha_cobro_estimada: form.fecha_cobro_estimada || null,
        notas: form.notas.trim(),
      };
      if (isIssued) {
        payloadBase.beneficiario_supplier_id = form.party_id || null;
        payloadBase.beneficiario_texto = form.party_texto.trim();
      } else {
        payloadBase.emisor_customer_b2b_id = form.party_id || null;
        payloadBase.emisor_texto = form.party_texto.trim();
      }
      if (mode === 'edit') {
        payloadBase.check_id = initial.id;
        if (isIssued) await window.ADMIN_DATA.updateCheckIssued(payloadBase);
        else          await window.ADMIN_DATA.updateCheckReceived(payloadBase);
        toast.success('Cheque actualizado');
      } else {
        if (isIssued) await window.ADMIN_DATA.createCheckIssued(payloadBase);
        else          await window.ADMIN_DATA.createCheckReceived(payloadBase);
        toast.success('Cheque registrado');
      }
      try { onSuccess?.(); } catch (_) {}
      onClose?.();
    } catch (err) {
      toast.error(err.message || 'No se pudo guardar');
      setSaving(false);
    }
  };

  const pickParty = (id, nombre) => {
    set('party_id', id);
    setPartySearch(nombre || '');
    setPartyDropdownOpen(false);
  };

  const safeClose = () => { if (!saving) onClose?.(); };
  const Cmp = window.Modal;

  return (
    <Cmp open={true} title={title} onClose={safeClose} size="lg" footer={
      <>
        <button className="btn-ghost" onClick={safeClose} disabled={saving}>Cancelar</button>
        <button className="btn-primary" onClick={onSubmit} disabled={saving}>
          {saving ? 'Guardando…' : (<><Icon n="check" s={14}/> Guardar</>)}
        </button>
      </>
    }>
      <div className="expense-form-grid">
        <div className="field-group">
          <label className="field-label">Fecha emision *</label>
          <input type="date" className={`field-input ${errors.fecha_emision ? 'has-error' : ''}`}
                 value={form.fecha_emision}
                 onChange={e => set('fecha_emision', e.target.value)}
                 onBlur={validate}/>
          {errors.fecha_emision && <div className="field-error">{errors.fecha_emision}</div>}
        </div>

        <div className="field-group">
          <label className="field-label">Fecha vencimiento</label>
          <input type="date" className={`field-input ${errors.fecha_cobro_estimada ? 'has-error' : ''}`}
                 value={form.fecha_cobro_estimada}
                 onChange={e => set('fecha_cobro_estimada', e.target.value)}
                 onBlur={validate}/>
          {errors.fecha_cobro_estimada
            ? <div className="field-error">{errors.fecha_cobro_estimada}</div>
            : <div className="field-help">Opcional</div>}
        </div>

        <div className="field-group">
          <label className="field-label">Numero *</label>
          <input className={`field-input ${errors.numero ? 'has-error' : ''}`}
                 value={form.numero} maxLength={50}
                 onChange={e => set('numero', e.target.value)}
                 onBlur={validate}/>
          {errors.numero && <div className="field-error">{errors.numero}</div>}
        </div>

        <div className="field-group">
          <label className="field-label">Banco *</label>
          <input className={`field-input ${errors.banco ? 'has-error' : ''}`}
                 value={form.banco} maxLength={120}
                 onChange={e => set('banco', e.target.value)}
                 onBlur={validate}/>
          {errors.banco && <div className="field-error">{errors.banco}</div>}
        </div>

        <div className="field-group expense-field-full">
          <label className="field-label">Monto *</label>
          <input type="number" step="0.01" min="0.01"
                 className={`field-input ${errors.monto ? 'has-error' : ''}`}
                 value={form.monto}
                 onChange={e => set('monto', e.target.value)}
                 onBlur={validate}/>
          {errors.monto && <div className="field-error">{errors.monto}</div>}
        </div>

        <div className="field-group expense-field-full">
          <label className="field-label">{partyLabel} {!form.party_id && !form.party_texto && '*'}</label>
          <div className="supplier-combo">
            <input className={`field-input ${errors.party ? 'has-error' : ''}`}
                   placeholder={selectedParty ? selectedParty.nombre : 'Buscar en catálogo o dejar vacio para texto libre'}
                   value={partySearch}
                   onFocus={() => setPartyDropdownOpen(true)}
                   onChange={e => { setPartySearch(e.target.value); setPartyDropdownOpen(true); }}/>
            {partyDropdownOpen && (
              <div className="supplier-dropdown" onMouseLeave={() => setPartyDropdownOpen(false)}>
                <button type="button" className="supplier-option"
                        onClick={() => pickParty('', '')}>
                  <em>Sin {isIssued ? 'beneficiario' : 'emisor'} del catalogo (usar texto libre)</em>
                </button>
                {filteredParties.length === 0 ? (
                  <div className="supplier-empty">
                    {partyList.length === 0
                      ? `No hay ${isIssued ? 'proveedores' : 'clientes'} cargados. Cargá uno desde su tab.`
                      : 'Sin resultados'}
                  </div>
                ) : (
                  filteredParties.map(p => (
                    <button type="button" key={p.id} className="supplier-option"
                            onClick={() => pickParty(p.id, p.nombre)}>
                      <strong>{p.nombre}</strong>
                      {p.cuit && <span style={{marginLeft:6, color:'var(--ink-muted)'}}>{p.cuit}</span>}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {!form.party_id && (
          <div className="field-group expense-field-full">
            <label className="field-label">{partyTextoLabel}</label>
            <input className={`field-input ${errors.party ? 'has-error' : ''}`}
                   placeholder={`Texto libre si ${isIssued ? 'beneficiario' : 'emisor'} no esta en el catalogo`}
                   value={form.party_texto}
                   onChange={e => set('party_texto', e.target.value)}
                   onBlur={validate}/>
            {errors.party && <div className="field-error">{errors.party}</div>}
          </div>
        )}

        <div className="field-group expense-field-full">
          <label className="field-label">Notas</label>
          <textarea className={`field-input ${errors.notas ? 'has-error' : ''}`}
                    value={form.notas} rows={3} maxLength={500}
                    onChange={e => set('notas', e.target.value)}
                    onBlur={validate}/>
          {errors.notas
            ? <div className="field-error">{errors.notas}</div>
            : <div className="field-help">{form.notas.length} / 500</div>}
        </div>
      </div>
    </Cmp>
  );
}

window.CheckModal = CheckModal;
