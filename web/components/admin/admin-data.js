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

  const COLS = 'id, nombre, cuit, email, telefono, notas, created_at, created_by';

  async function loadSuppliers() {
    const { data, error } = await supa
      .from('suppliers')
      .select(COLS)
      .order('nombre', { ascending: true });
    if (error) throw new Error(error.message || 'No se pudo cargar proveedores');
    return data || [];
  }

  async function loadCustomersB2B() {
    const { data, error } = await supa
      .from('customers_b2b')
      .select(COLS)
      .order('nombre', { ascending: true });
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
    'iva_discriminado','categoria','medio_pago','notas',
    'created_at','created_by',
    'suppliers(nombre)',
  ].join(',');

  async function loadExpenses(opts) {
    const { dateFrom, dateTo } = opts || {};
    let q = supa.from('expenses').select(EXPENSE_COLS);
    if (dateFrom) q = q.gte('fecha', dateFrom);
    if (dateTo)   q = q.lte('fecha', dateTo);
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
      .select('id, fecha, tipo, monto, concepto, referencia_externa, created_at')
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
