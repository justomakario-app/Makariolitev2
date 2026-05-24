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

  window.ADMIN_DATA = {
    loadSuppliers,
    loadCustomersB2B,
    createSupplier,
    createCustomerB2B,
    validateNombre,
    validateCuit,
    validateEmail,
    validateNotas,
  };
})();
