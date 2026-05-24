/* ══ CHECK STATUS MODAL (B.4)
   Modal para cambiar estado de un cheque emitido a cobrado/anulado/devuelto.
   Si nuevo estado = cobrado: checkbox opcional para generar movement de
   pago en cta cte (default ON si tiene party).
   Props: { check, checkType, onClose, onSuccess }
   ══ */

function CheckStatusModal({ check, checkType, onClose, onSuccess }) {
  const toast = useToast();
  const isIssued = checkType === 'issued';
  const partyId = isIssued ? check.beneficiario_supplier_id : check.emisor_customer_b2b_id;
  const hasParty = !!partyId;

  const [form, setForm] = useState({
    new_status: 'cobrado',
    fecha_cambio: window.todayLocalStr(),
    generate_movement: hasParty,  // default ON si tiene party
    notas: '',
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(s => ({ ...s, [k]: v }));

  const showCheckbox = hasParty && form.new_status === 'cobrado';

  const onSubmit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const payload = {
        check_type: checkType,
        check_id: check.id,
        new_status: form.new_status,
        fecha_cambio: form.fecha_cambio,
        generate_movement: showCheckbox ? form.generate_movement : false,
        notas: form.notas.trim() || null,
      };
      await window.ADMIN_DATA.changeCheckStatus(payload);
      toast.success(`Cheque marcado como ${form.new_status}`);
      try { onSuccess?.(); } catch (_) {}
      onClose?.();
    } catch (err) {
      toast.error(err.message || 'No se pudo cambiar el estado');
      setSaving(false);
    }
  };

  const safeClose = () => { if (!saving) onClose?.(); };
  const Cmp = window.Modal;

  return (
    <Cmp open={true} title={`Cambiar estado del cheque #${check.numero}`} onClose={safeClose} footer={
      <>
        <button className="btn-ghost" onClick={safeClose} disabled={saving}>Cancelar</button>
        <button className="btn-primary" onClick={onSubmit} disabled={saving}>
          {saving ? 'Guardando…' : (<><Icon n="check" s={14}/> Confirmar</>)}
        </button>
      </>
    }>
      <div className="field-group">
        <label className="field-label">Nuevo estado *</label>
        <div className="check-status-radio-row">
          <label className="check-status-radio">
            <input type="radio" name="new_status" value="cobrado"
                   checked={form.new_status === 'cobrado'}
                   onChange={e => set('new_status', e.target.value)}/>
            <span>Cobrado</span>
          </label>
          <label className="check-status-radio">
            <input type="radio" name="new_status" value="anulado"
                   checked={form.new_status === 'anulado'}
                   onChange={e => set('new_status', e.target.value)}/>
            <span>Anulado</span>
          </label>
          <label className="check-status-radio">
            <input type="radio" name="new_status" value="devuelto"
                   checked={form.new_status === 'devuelto'}
                   onChange={e => set('new_status', e.target.value)}/>
            <span>Devuelto</span>
          </label>
        </div>
      </div>

      <div className="field-group">
        <label className="field-label">Fecha del cambio *</label>
        <input type="date" className="field-input"
               value={form.fecha_cambio}
               onChange={e => set('fecha_cambio', e.target.value)}/>
      </div>

      {showCheckbox && (
        <div className="field-group expense-cta-row">
          <label className="expense-cta-label">
            <input type="checkbox"
                   checked={form.generate_movement}
                   onChange={e => set('generate_movement', e.target.checked)}/>
            <span>
              Generar movimiento de pago en cta cte del{' '}
              {isIssued ? 'proveedor' : 'cliente'}
            </span>
          </label>
          <div className="field-help">
            Default: marcado cuando el cheque tiene {isIssued ? 'beneficiario' : 'emisor'} del catalogo.
          </div>
        </div>
      )}

      <div className="field-group">
        <label className="field-label">Notas (se anexan a las notas existentes)</label>
        <textarea className="field-input" value={form.notas} rows={2} maxLength={500}
                  placeholder={`Razon del cambio a "${form.new_status}" (opcional)`}
                  onChange={e => set('notas', e.target.value)}/>
        <div className="field-help">{form.notas.length} / 500</div>
      </div>
    </Cmp>
  );
}

window.CheckStatusModal = CheckStatusModal;
