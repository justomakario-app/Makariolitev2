/* ══ ADMIN DATA LAYER (B.2)
   Fetchers + actions + validadores para los tabs Proveedores y Clientes
   B2B. Consume RPCs SECURITY DEFINER de Tanda A (rpc_admin_create_*).
   Lectura via SELECT directo (RLS gated por is_owner_or_admin()).
   Sin cache global: cada tab re-fetch on mount. ══ */

(function () {
  const supa = window.SUPA;
  if (!supa) {
    console.error('[admin-data] window.SUPA no esta listo');
    return;
  }

  const COLS = 'id, nombre, cuit, email, telefono, notas, activo, created_at, created_by';

  /* S2.1: opts.includeInactive=true trae tambien filas con activo=false.
     Default: solo activas (filtro server-side). */
  async function loadSuppliers(opts) {
    const includeInactive = opts && opts.includeInactive === true;
    let q = supa.from('suppliers').select(COLS).order('nombre', { ascending: true });
    if (!includeInactive) q = q.eq('activo', true);
    const { data, error } = await q;
    if (error) throw new Error(error.message || 'No se pudo cargar proveedores');
    return data || [];
  }

  async function loadCustomersB2B(opts) {
    const includeInactive = opts && opts.includeInactive === true;
    let q = supa.from('customers_b2b').select(COLS).order('nombre', { ascending: true });
    if (!includeInactive) q = q.eq('activo', true);
    const { data, error } = await q;
    if (error) throw new Error(error.message || 'No se pudo cargar clientes');
    return data || [];
  }

  async function createSupplier(payload) {
    const { data, error } = await supa.rpc('rpc_admin_create_supplier', { p_payload: payload });
    if (error) throw new Error(error.message || 'No se pudo crear proveedor');
    return data;
  }

  async function createCustomerB2B(payload) {
    const { data, error } = await supa.rpc('rpc_admin_create_customer_b2b', { p_payload: payload });
    if (error) throw new Error(error.message || 'No se pudo crear cliente');
    return data;
  }

  /* Validadores: mismos criterios que BD (CHECK constraints).
     Devuelven { ok: bool, msg?: string }. */
  function validateNombre(s) {
    const v = (s || '').trim();
    if (v.length < 1) return { ok: false, msg: 'Nombre requerido' };
    if (v.length > 120) return { ok: false, msg: 'Maximo 120 caracteres' };
    return { ok: true };
  }
  function validateCuit(s) {
    const v = (s || '').trim();
    if (!v) return { ok: true };
    if (!/^\d{2}-\d{8}-\d$/.test(v)) return { ok: false, msg: 'Formato XX-XXXXXXXX-X' };
    return { ok: true };
  }
  function validateEmail(s) {
    const v = (s || '').trim();
    if (!v) return { ok: true };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { ok: false, msg: 'Email invalido' };
    return { ok: true };
  }
  function validateNotas(s) {
    const v = (s || '').trim();
    if (v.length > 500) return { ok: false, msg: 'Maximo 500 caracteres' };
    return { ok: true };
  }

  /* ── Egresos / Compras (B.3) ─────────────────────────────────────── */
  const EXPENSE_COLS = [
    'id','fecha','supplier_id','concepto','monto_total','moneda',
    'iva_discriminado','categoria','medio_pago','notas','activo',
    'created_at','created_by',
    'suppliers(nombre)',
  ].join(',');

  /* S2.1: opts.includeInactive=true trae tambien egresos con activo=false. */
  async function loadExpenses(opts) {
    const { dateFrom, dateTo, includeInactive } = opts || {};
    let q = supa.from('expenses').select(EXPENSE_COLS);
    if (dateFrom) q = q.gte('fecha', dateFrom);
    if (dateTo)   q = q.lte('fecha', dateTo);
    if (!includeInactive) q = q.eq('activo', true);
    q = q.order('fecha', { ascending: false })
         .order('created_at', { ascending: false });
    const { data, error } = await q;
    if (error) throw new Error(error.message || 'No se pudo cargar egresos');
    return data || [];
  }

  async function createExpense(payload) {
    const { data, error } = await supa.rpc('rpc_admin_create_expense', { p_payload: payload });
    if (error) throw new Error(error.message || 'No se pudo crear egreso');
    return data;
  }

  /* Formato AR: $50.000,00 ARS */
  function formatMoney(n, currency) {
    const cur = currency || 'ARS';
    const v = Number(n) || 0;
    const fmt = new Intl.NumberFormat('es-AR', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(v);
    return `$${fmt} ${cur}`;
  }

  /* Formato visible: 20/05/2026 (acepta 'YYYY-MM-DD' o timestamp). */
  function formatDate(d) {
    if (!d) return '—';
    const s = String(d).slice(0, 10);
    const parts = s.split('-');
    if (parts.length !== 3) return s;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  /* Preset → { from, to } como 'YYYY-MM-DD'. Timezone-safe via todayLocalStr. */
  function dateRangeForPreset(preset, customFrom, customTo) {
    const t = window.todayLocalStr;
    const today = t();
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const firstOfMonth  = t(new Date(y, m, 1));
    const lastOfPrev    = t(new Date(y, m, 0));
    const firstOfPrev   = t(new Date(y, m - 1, 1));
    const ninetyDaysAgo = t(new Date(Date.now() - 90 * 24 * 3600 * 1000));
    switch (preset) {
      case 'mes_actual':    return { from: firstOfMonth, to: today };
      case 'mes_pasado':    return { from: firstOfPrev,  to: lastOfPrev };
      case 'ultimos_90':    return { from: ninetyDaysAgo, to: today };
      case 'personalizado': return { from: customFrom || null, to: customTo || null };
      default:              return { from: firstOfMonth, to: today };
    }
  }

  function validateConcepto(s) {
    const v = (s || '').trim();
    if (v.length < 1) return { ok: false, msg: 'Concepto requerido' };
    if (v.length > 500) return { ok: false, msg: 'Maximo 500 caracteres' };
    return { ok: true };
  }
  function validateMonto(s) {
    if (s === '' || s == null) return { ok: false, msg: 'Monto requerido' };
    const v = Number(s);
    if (!Number.isFinite(v)) return { ok: false, msg: 'Numero invalido' };
    if (v <= 0) return { ok: false, msg: 'Debe ser mayor a 0' };
    return { ok: true };
  }
  function validateIva(iva, monto) {
    if (iva === '' || iva == null) return { ok: true };
    const v = Number(iva);
    if (!Number.isFinite(v) || v < 0) return { ok: false, msg: 'Numero invalido' };
    const m = Number(monto);
    if (Number.isFinite(m) && v > m) return { ok: false, msg: 'IVA no puede ser mayor al monto' };
    return { ok: true };
  }
  function validateFecha(s) {
    if (!s) return { ok: false, msg: 'Fecha requerida' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { ok: false, msg: 'Formato invalido' };
    return { ok: true };
  }

  /* ── Cuentas Corrientes (B.5) ─────────────────────────────────── */

  async function loadSuppliersWithCredit() {
    const { data, error } = await supa
      .from('suppliers_credit')
      .select('id, saldo, updated_at, suppliers(id, nombre, cuit, email)')
      .order('nombre', { referencedTable: 'suppliers', ascending: true });
    if (error) throw new Error(error.message || 'No se pudo cargar proveedores');
    return data || [];
  }

  async function loadCustomersWithCredit() {
    const { data, error } = await supa
      .from('customers_credit')
      .select('id, saldo, updated_at, customer_type, customers_b2b(id, nombre, cuit, email)')
      .eq('customer_type', 'b2b')
      .order('nombre', { referencedTable: 'customers_b2b', ascending: true });
    if (error) throw new Error(error.message || 'No se pudo cargar clientes');
    return data || [];
  }

  async function loadSupplierMovements(supplierCreditId) {
    const { data, error } = await supa
      .from('suppliers_credit_movements')
      .select('id, fecha, tipo, monto, concepto, expense_id, check_id, created_at, expenses(id, concepto, fecha, categoria, medio_pago)')
      .eq('supplier_credit_id', supplierCreditId)
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message || 'No se pudo cargar movimientos');
    return data || [];
  }

  async function loadCustomerMovements(customerCreditId) {
    const { data, error } = await supa
      .from('customers_credit_movements')
      .select('id, fecha, tipo, monto, concepto, referencia_externa, check_id, created_at')
      .eq('customer_credit_id', customerCreditId)
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message || 'No se pudo cargar movimientos');
    return data || [];
  }

  /* Wrappers RPC: create (Tanda A) + update/delete (0051). */
  async function createSupplierMovement(payload) {
    const { data, error } = await supa.rpc('rpc_admin_create_supplier_credit_movement', { p_payload: payload });
    if (error) throw new Error(error.message || 'No se pudo crear movimiento');
    return data;
  }
  async function updateSupplierMovement(payload) {
    const { data, error } = await supa.rpc('rpc_admin_update_supplier_credit_movement', { p_payload: payload });
    if (error) throw new Error(error.message || 'No se pudo actualizar movimiento');
    return data;
  }
  async function deleteSupplierMovement(payload) {
    const { data, error } = await supa.rpc('rpc_admin_delete_supplier_credit_movement', { p_payload: payload });
    if (error) throw new Error(error.message || 'No se pudo eliminar movimiento');
    return data;
  }
  async function createCustomerMovement(payload) {
    const { data, error } = await supa.rpc('rpc_admin_create_customer_credit_movement', { p_payload: payload });
    if (error) throw new Error(error.message || 'No se pudo crear movimiento');
    return data;
  }
  async function updateCustomerMovement(payload) {
    const { data, error } = await supa.rpc('rpc_admin_update_customer_credit_movement', { p_payload: payload });
    if (error) throw new Error(error.message || 'No se pudo actualizar movimiento');
    return data;
  }
  async function deleteCustomerMovement(payload) {
    const { data, error } = await supa.rpc('rpc_admin_delete_customer_credit_movement', { p_payload: payload });
    if (error) throw new Error(error.message || 'No se pudo eliminar movimiento');
    return data;
  }

  /* Validador especifico de monto para movements: ajuste permite negativo. */
  function validateMovementMonto(s, tipo) {
    if (s === '' || s == null) return { ok: false, msg: 'Monto requerido' };
    const v = Number(s);
    if (!Number.isFinite(v)) return { ok: false, msg: 'Numero invalido' };
    if (v === 0) return { ok: false, msg: 'Debe ser distinto de 0' };
    if (tipo !== 'ajuste' && v <= 0) return { ok: false, msg: 'Debe ser mayor a 0 (usá ajuste para negativos)' };
    return { ok: true };
  }

  /* ── Cheques (B.4) ──────────────────────────────────────────────── */

  const CHECK_COLS_ISSUED = [
    'id','numero','banco','monto','fecha_emision','fecha_cobro_estimada',
    'fecha_cobro','fecha_anulado','fecha_devuelto',
    'beneficiario_supplier_id','beneficiario_texto','estado','notas',
    'created_at','updated_at',
    'suppliers(id, nombre, cuit)',
  ].join(',');

  const CHECK_COLS_RECEIVED = [
    'id','numero','banco','monto','fecha_emision','fecha_cobro_estimada',
    'fecha_cobro','fecha_anulado','fecha_devuelto',
    'emisor_customer_b2b_id','emisor_texto','estado','notas',
    'created_at','updated_at',
    'customers_b2b(id, nombre, cuit)',
  ].join(',');

  async function loadChecksIssued() {
    const { data, error } = await supa
      .from('checks_issued')
      .select(CHECK_COLS_ISSUED)
      .order('fecha_emision', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message || 'No se pudo cargar cheques emitidos');
    return data || [];
  }

  async function loadChecksReceived() {
    const { data, error } = await supa
      .from('checks_received')
      .select(CHECK_COLS_RECEIVED)
      .order('fecha_emision', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message || 'No se pudo cargar cheques recibidos');
    return data || [];
  }

  async function createCheckIssued(payload) {
    const p = { ...payload, generate_supplier_movement: false };
    const { data, error } = await supa.rpc('rpc_admin_create_check', { p_payload: p });
    if (error) throw new Error(error.message || 'No se pudo crear cheque');
    return data;
  }
  async function createCheckReceived(payload) {
    const p = { ...payload, generate_customer_movement: false };
    const { data, error } = await supa.rpc('rpc_admin_create_check_received', { p_payload: p });
    if (error) throw new Error(error.message || 'No se pudo crear cheque');
    return data;
  }
  async function updateCheckIssued(payload) {
    const { data, error } = await supa.rpc('rpc_admin_update_check', { p_payload: payload });
    if (error) throw new Error(error.message || 'No se pudo actualizar cheque');
    return data;
  }
  async function updateCheckReceived(payload) {
    const { data, error } = await supa.rpc('rpc_admin_update_check_received', { p_payload: payload });
    if (error) throw new Error(error.message || 'No se pudo actualizar cheque');
    return data;
  }
  async function deleteCheckIssued(payload) {
    const { data, error } = await supa.rpc('rpc_admin_delete_check', { p_payload: payload });
    if (error) throw new Error(error.message || 'No se pudo eliminar cheque');
    return data;
  }
  async function deleteCheckReceived(payload) {
    const { data, error } = await supa.rpc('rpc_admin_delete_check_received', { p_payload: payload });
    if (error) throw new Error(error.message || 'No se pudo eliminar cheque');
    return data;
  }
  async function changeCheckStatus(payload) {
    const { data, error } = await supa.rpc('rpc_admin_change_check_status', { p_payload: payload });
    if (error) throw new Error(error.message || 'No se pudo cambiar estado del cheque');
    return data;
  }

  /* Validadores cheques. */
  function validateNumeroCheque(s) {
    const v = (s || '').trim();
    if (v.length < 1) return { ok: false, msg: 'Numero requerido' };
    if (v.length > 50) return { ok: false, msg: 'Maximo 50 caracteres' };
    return { ok: true };
  }
  function validateBanco(s) {
    const v = (s || '').trim();
    if (v.length < 1) return { ok: false, msg: 'Banco requerido' };
    if (v.length > 120) return { ok: false, msg: 'Maximo 120 caracteres' };
    return { ok: true };
  }
  function validateFechaVencimiento(s) {
    if (!s) return { ok: true };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { ok: false, msg: 'Formato invalido' };
    return { ok: true };
  }

  /* ── Edit/Delete universal (S2.1) ────────────────────────────────
     Wrappers que preservan error.hint y error.code para que el
     frontend pueda detectar 'has_relations' y 'duplicate_cuit'. */
  async function _rpcWithHint(name, payload, defaultMsg) {
    const { data, error } = await supa.rpc(name, { p_payload: payload });
    if (error) {
      const e = new Error(error.message || defaultMsg);
      e.hint = error.hint || null;
      e.code = error.code || null;
      throw e;
    }
    return data;
  }
  async function updateSupplier(payload) {
    return _rpcWithHint('rpc_admin_update_supplier', payload, 'No se pudo actualizar proveedor');
  }
  async function deleteSupplier(payload) {
    return _rpcWithHint('rpc_admin_delete_supplier', payload, 'No se pudo eliminar proveedor');
  }
  async function updateCustomerB2B(payload) {
    return _rpcWithHint('rpc_admin_update_customer_b2b', payload, 'No se pudo actualizar cliente');
  }
  async function deleteCustomerB2B(payload) {
    return _rpcWithHint('rpc_admin_delete_customer_b2b', payload, 'No se pudo eliminar cliente');
  }
  async function updateExpense(payload) {
    return _rpcWithHint('rpc_admin_update_expense', payload, 'No se pudo actualizar egreso');
  }
  async function deleteExpense(payload) {
    return _rpcWithHint('rpc_admin_delete_expense', payload, 'No se pudo eliminar egreso');
  }

  /* Parser del mensaje de borrado bloqueado. Extrae los numeros que
     vienen en el mensaje "No se puede eliminar: tiene N egresos, ..." */
  function parseHasRelationsMessage(msg) {
    if (!msg) return null;
    const nums = (msg.match(/\d+/g) || []).map(Number);
    return { raw: msg, counts: nums };
  }

  /* Helper de vencimiento (solo aplica si estado='emitido'). */
  function isVenceProximo(check) {
    if (!check || check.estado !== 'emitido') return 'ok';
    if (!check.fecha_cobro_estimada) return 'ok';
    const today = window.todayLocalStr();
    const venc = String(check.fecha_cobro_estimada).slice(0, 10);
    if (venc < today) return 'vencido';
    const limit = window.todayLocalStr(new Date(Date.now() + 7 * 24 * 3600 * 1000));
    if (venc <= limit) return 'por_vencer';
    return 'ok';
  }

  window.ADMIN_DATA = {
    // B.2
    loadSuppliers,
    loadCustomersB2B,
    createSupplier,
    createCustomerB2B,
    validateNombre,
    validateCuit,
    validateEmail,
    validateNotas,
    // B.3
    loadExpenses,
    createExpense,
    formatMoney,
    formatDate,
    dateRangeForPreset,
    validateConcepto,
    validateMonto,
    validateIva,
    validateFecha,
    // B.5
    loadSuppliersWithCredit,
    loadCustomersWithCredit,
    loadSupplierMovements,
    loadCustomerMovements,
    createSupplierMovement,
    updateSupplierMovement,
    deleteSupplierMovement,
    createCustomerMovement,
    updateCustomerMovement,
    deleteCustomerMovement,
    validateMovementMonto,
    // B.4
    loadChecksIssued,
    loadChecksReceived,
    createCheckIssued,
    createCheckReceived,
    updateCheckIssued,
    updateCheckReceived,
    deleteCheckIssued,
    deleteCheckReceived,
    changeCheckStatus,
    validateNumeroCheque,
    validateBanco,
    validateFechaVencimiento,
    isVenceProximo,
    // S2.1
    updateSupplier,
    deleteSupplier,
    updateCustomerB2B,
    deleteCustomerB2B,
    updateExpense,
    deleteExpense,
    parseHasRelationsMessage,
  };

  /* ── Navegacion cross-tab (B.5) ───────────────────────────────────
     Bus liviano para que el boton "Ver egreso" de un movement automatico
     pida al admin.jsx que cambie de tab + pase el expenseId a ExpensesTab. */
  window.ADMIN_NAV = window.ADMIN_NAV || {
    _listeners: [],
    subscribe(fn) {
      this._listeners.push(fn);
      return () => { this._listeners = this._listeners.filter(x => x !== fn); };
    },
    goToExpense(expenseId) {
      this._listeners.forEach(fn => { try { fn({ tab: 'egresos', expenseId }); } catch (_) {} });
    },
  };
})();
