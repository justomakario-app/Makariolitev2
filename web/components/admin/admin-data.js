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

  const COLS_CUSTOMER = 'id, nombre, cuit, email, telefono, notas, activo, created_at, created_by, es_mayorista, localidad, provincia';
  /* S2.2: suppliers usa '*' para traer los 11 campos nuevos de ficha
     ampliada sin tener que enumerarlos uno a uno. */
  const COLS_SUPPLIER = '*';

  /* S2.1: opts.includeInactive=true trae tambien filas con activo=false.
     Default: solo activas (filtro server-side). */
  async function loadSuppliers(opts) {
    const includeInactive = opts && opts.includeInactive === true;
    let q = supa.from('suppliers').select(COLS_SUPPLIER).order('nombre', { ascending: true });
    if (!includeInactive) q = q.eq('activo', true);
    const { data, error } = await q;
    if (error) throw new Error(error.message || 'No se pudo cargar proveedores');
    return data || [];
  }

  async function loadCustomersB2B(opts) {
    const includeInactive = opts && opts.includeInactive === true;
    let q = supa.from('customers_b2b').select(COLS_CUSTOMER).order('nombre', { ascending: true });
    if (!includeInactive) q = q.eq('activo', true);
    const { data, error } = await q;
    if (error) throw new Error(error.message || 'No se pudo cargar clientes');
    return data || [];
  }

  /* S2.2: historial completo de un proveedor (egresos + cheques + cta cte). */
  async function getSupplierHistorial(supplierId) {
    const { data, error } = await supa.rpc('rpc_admin_get_supplier_historial', { p_supplier_id: supplierId });
    if (error) throw new Error(error.message || 'No se pudo cargar historial');
    return data;
  }

  /* S2.2: provincias argentinas hardcoded (23 provincias + CABA). */
  const ARG_PROVINCIAS = [
    'Buenos Aires',
    'Catamarca',
    'Chaco',
    'Chubut',
    'CABA',
    'Cordoba',
    'Corrientes',
    'Entre Rios',
    'Formosa',
    'Jujuy',
    'La Pampa',
    'La Rioja',
    'Mendoza',
    'Misiones',
    'Neuquen',
    'Rio Negro',
    'Salta',
    'San Juan',
    'San Luis',
    'Santa Cruz',
    'Santa Fe',
    'Santiago del Estero',
    'Tierra del Fuego',
    'Tucuman',
  ];

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

  /* ── S2.23 MAYORISTAS ──────────────────────────────────────────────
     Wrappers de los 4 RPCs de migration 0066. Los consume MayoristasTab
     (ventas.jsx) y la sección de Producción (produccion.jsx). */
  async function loadMayoristas() {
    const { data, error } = await supa.rpc('rpc_mayoristas_list', { p_payload: {} });
    if (error) throw new Error(error.message || 'No se pudo cargar mayoristas');
    return data || [];
  }
  async function createPedidoMayorista(payload) {
    const { data, error } = await supa.rpc('rpc_mayoristas_create_pedido', { p_payload: payload });
    if (error) throw new Error(error.message || 'No se pudo crear el pedido');
    return data;
  }
  async function updateEstadoPedidoMayorista(payload) {
    const { data, error } = await supa.rpc('rpc_mayoristas_update_estado', { p_payload: payload });
    if (error) throw new Error(error.message || 'No se pudo actualizar el estado');
    return data;
  }
  async function listPedidosMayoristas(payload) {
    const { data, error } = await supa.rpc('rpc_mayoristas_list_pedidos', { p_payload: payload || {} });
    if (error) throw new Error(error.message || 'No se pudo cargar pedidos');
    return data || [];
  }
  /* S2.23 patch1: soft delete (activo=false) de un mayorista. owner-only. */
  async function deleteMayorista(payload) {
    const { data, error } = await supa.rpc('rpc_mayoristas_delete', { p_payload: payload });
    if (error) throw new Error(error.message || 'No se pudo eliminar el mayorista');
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
      // S2.23 patch2: traer `activo` del cliente para no mostrar en Cuentas
      // Corrientes los clientes dados de baja (soft delete activo=false),
      // igual que ya hacen la pestaña Clientes y la lista de Mayoristas.
      .select('id, saldo, updated_at, customer_type, customers_b2b(id, nombre, cuit, email, activo)')
      .eq('customer_type', 'b2b')
      .order('nombre', { referencedTable: 'customers_b2b', ascending: true });
    if (error) throw new Error(error.message || 'No se pudo cargar clientes');
    // Filtro client-side (robusto, sin depender de embedded !inner): excluye
    // clientes inactivos. Un saldo distinto de 0 igual queda registrado en BD.
    return (data || []).filter(r => r.customers_b2b && r.customers_b2b.activo !== false);
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

  /* ── Comprobante (Storage admin_receipts) (S2.3) ──────────────── */

  /* Genera signed URL para mostrar/descargar el archivo. TTL 1h. */
  async function getComprobanteSignedUrl(path, ttlSec) {
    const ttl = Number(ttlSec) > 0 ? Number(ttlSec) : 3600;
    const { data, error } = await supa.storage
      .from('admin_receipts')
      .createSignedUrl(path, ttl);
    if (error) throw new Error(error.message || 'No se pudo generar URL');
    return data && data.signedUrl;
  }

  /* Borra el archivo del bucket. No toca expenses (eso lo hace el form
     marcando comprobante_url=null en el payload). */
  async function deleteComprobante(path) {
    const { error } = await supa.storage
      .from('admin_receipts')
      .remove([path]);
    if (error) throw new Error(error.message || 'No se pudo eliminar');
    return true;
  }

  /* Labels de categorias S2.3 (11 valores). Para uso en tablas/listados. */
  const EXPENSE_CATEGORIA_LABELS = {
    materiales_insumos:     'Materiales / Insumos',
    fletes:                 'Fletes',
    logistica_flex:         'Logistica Flex',
    correo_encomiendas:     'Correo / Encomiendas',
    gastos_fijos:           'Gastos fijos',
    honorarios:             'Honorarios',
    servicios:              'Servicios',
    intereses_financiacion: 'Intereses / Financiacion',
    sueldos:                'Sueldos',
    impuestos:              'Impuestos',
    otros:                  'Otros',
  };

  /* ── Bulk import suppliers (S2.4) ──────────────────────────────── */

  /* Diccionario de sinonimos para fuzzy matching de headers. Sin 'dni'
     en cuit por decision Jefe #2: rechazar DNI, solo CUIT formal. */
  const SUPPLIER_HEADER_SYNONYMS = {
    nombre:               ['nombre','razon_social','razonsocial','rs','razon','denominacion','proveedor'],
    cuit:                 ['cuit','cuil','cuit_cuil','cuitcuil','nro_cuit'],
    email:                ['email','correo','mail','correo_electronico','e_mail'],
    telefono:             ['telefono','tel','telef','telefono_contacto','celular','cel','phone'],
    condicion_fiscal:     ['condicion_fiscal','cond_fiscal','condicionfiscal','condicion'],
    condicion_iva:        ['condicion_iva','cond_iva','condicioniva','iva'],
    provincia:            ['provincia','prov','estado','region'],
    ciudad:               ['ciudad','localidad','city','partido'],
    direccion:            ['direccion','domicilio','calle','address','adr'],
    codigo_postal:        ['codigo_postal','cp','codigopostal','postal_code','zip'],
    rubro:                ['rubro','categoria','sector','actividad'],
    productos_habituales: ['productos_habituales','productos','products','articulos'],
    notas:                ['notas','observaciones','comentarios','obs','notes','comments'],
  };

  /* Normaliza un header: lowercase + sin acentos + non-alfanum → _ */
  function normalizeHeader(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  /* Mapea headers del archivo a campos internos. Throws si faltan
     mandatorios (nombre, cuit). */
  function mapBulkHeaders(rawHeaders) {
    const fieldMap = {};
    for (let i = 0; i < rawHeaders.length; i++) {
      const norm = normalizeHeader(rawHeaders[i]);
      for (const [field, synonyms] of Object.entries(SUPPLIER_HEADER_SYNONYMS)) {
        if (synonyms.includes(norm)) { fieldMap[i] = field; break; }
      }
    }
    const fields = Object.values(fieldMap);
    if (!fields.includes('nombre')) {
      throw new Error('Falta columna obligatoria "nombre" (o sinónimos: razón social, RS, denominación).');
    }
    if (!fields.includes('cuit')) {
      throw new Error('Falta columna obligatoria "cuit" (o sinónimo CUIT/CUIL). No se aceptan DNIs sueltos.');
    }
    return fieldMap;
  }

  /* Normaliza CUIT a XX-XXXXXXXX-X (extrae solo 11 digitos). Devuelve null
     si no son exactamente 11. */
  function normalizeCuit(raw) {
    if (raw == null || raw === '') return null;
    const digits = String(raw).replace(/\D/g, '');
    if (digits.length !== 11) return null;
    return `${digits.slice(0,2)}-${digits.slice(2,10)}-${digits.slice(10)}`;
  }

  /* Parsea un archivo .xlsx o .csv y devuelve rows como array of objects
     usando los headers internos mapeados (post fuzzy). Throws si falla. */
  async function parseSupplierSpreadsheet(file) {
    if (typeof window.XLSX === 'undefined') {
      throw new Error('SheetJS (XLSX) no esta cargado. Recargá la página.');
    }
    const buf = await file.arrayBuffer();
    const wb = window.XLSX.read(buf, { type: 'array', cellDates: false });
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const arr = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    if (!arr || arr.length < 2) {
      throw new Error('Archivo vacío o sin filas de datos (esperado header + ≥1 fila).');
    }
    const rawHeaders = arr[0];
    const fieldMap = mapBulkHeaders(rawHeaders);
    const rows = [];
    for (let i = 1; i < arr.length; i++) {
      const raw = arr[i];
      // Skip filas totalmente vacias
      if (raw.every(c => c == null || String(c).trim() === '')) continue;
      const obj = {};
      for (const [idxStr, field] of Object.entries(fieldMap)) {
        obj[field] = raw[Number(idxStr)] != null ? String(raw[Number(idxStr)]) : '';
      }
      obj._rowNum = i + 1;  // numero de fila en el archivo original (1-indexed con header en fila 1)
      rows.push(obj);
    }
    return rows;
  }

  /* Valida una fila parseada. Devuelve { rowNum, isValid, errors, normalized }. */
  function validateSupplierRow(row) {
    const errors = [];
    const nombre = (row.nombre || '').trim();
    if (!nombre) errors.push('Falta nombre');
    else if (nombre.length > 120) errors.push('Nombre supera 120 caracteres');

    const cuitNorm = normalizeCuit(row.cuit);
    if (!cuitNorm) errors.push(`CUIT inválido en formato XX-XXXXXXXX-X (no se aceptan DNIs sueltos).`);

    const email = (row.email || '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push(`Email mal formado: "${email}"`);
    }

    const cf = (row.condicion_fiscal || '').trim();
    if (cf && !['RI','Monotributo','Consumidor','Exento'].includes(cf)) {
      errors.push('Condición fiscal inválida (RI/Monotributo/Consumidor/Exento)');
    }

    const prov = (row.provincia || '').trim();
    if (prov && !ARG_PROVINCIAS.includes(prov)) {
      errors.push(`Provincia desconocida: "${prov}"`);
    }

    const notas = (row.notas || '').trim();
    if (notas.length > 500) errors.push('Notas supera 500 caracteres');

    return {
      rowNum: row._rowNum,
      isValid: errors.length === 0,
      errors,
      normalized: {
        nombre,
        cuit: cuitNorm,
        email: email,
        telefono:             (row.telefono             || '').trim(),
        condicion_fiscal:     cf,
        condicion_iva:        (row.condicion_iva        || '').trim(),
        provincia:            prov,
        ciudad:               (row.ciudad               || '').trim(),
        direccion:            (row.direccion            || '').trim(),
        codigo_postal:        (row.codigo_postal        || '').trim(),
        rubro:                (row.rubro                || '').trim(),
        productos_habituales: (row.productos_habituales || '').trim(),
        notas:                notas,
      },
    };
  }

  /* Llama check_cuits_exist. Devuelve { existing: [{cuit,id,nombre,activo}],
     not_existing: [cuit] }. */
  async function checkCuitsExist(cuits) {
    const arr = Array.isArray(cuits) ? cuits.filter(Boolean) : [];
    if (arr.length === 0) return { existing: [], not_existing: [] };
    const { data, error } = await supa.rpc('rpc_admin_check_cuits_exist', { p_cuits: arr });
    if (error) throw new Error(error.message || 'No se pudo verificar duplicados');
    return data || { existing: [], not_existing: [] };
  }

  /* Bulk create con chunking automatico (decision Jefe #3). Chunks de 1000,
     llamadas secuenciales, progress via onProgress(done, total). */
  async function bulkCreateSuppliers(items, onProgress) {
    const arr = Array.isArray(items) ? items : [];
    if (arr.length === 0) return { created: 0, errors: [] };
    const CHUNK = 1000;
    let totalCreated = 0;
    const totalErrors = [];
    for (let i = 0; i < arr.length; i += CHUNK) {
      const chunk = arr.slice(i, i + CHUNK);
      const { data, error } = await supa.rpc('rpc_admin_bulk_create_suppliers', {
        p_payload: { items: chunk },
      });
      if (error) throw new Error(error.message || 'No se pudo crear batch');
      totalCreated += (data && data.created) || 0;
      // Re-mapear indices del chunk a indices globales del array original
      const errs = (data && data.errors) || [];
      for (const e of errs) totalErrors.push({ ...e, index: e.index + i });
      if (typeof onProgress === 'function') onProgress(Math.min(i + CHUNK, arr.length), arr.length);
    }
    return { created: totalCreated, errors: totalErrors };
  }

  /* Bulk update con chunking. Idem create pero sobre update_suppliers. */
  async function bulkUpdateSuppliers(items, onProgress) {
    const arr = Array.isArray(items) ? items : [];
    if (arr.length === 0) return { updated: 0, errors: [] };
    const CHUNK = 1000;
    let totalUpdated = 0;
    const totalErrors = [];
    for (let i = 0; i < arr.length; i += CHUNK) {
      const chunk = arr.slice(i, i + CHUNK);
      const { data, error } = await supa.rpc('rpc_admin_bulk_update_suppliers', {
        p_payload: { items: chunk },
      });
      if (error) throw new Error(error.message || 'No se pudo actualizar batch');
      totalUpdated += (data && data.updated) || 0;
      const errs = (data && data.errors) || [];
      for (const e of errs) totalErrors.push({ ...e, index: e.index + i });
      if (typeof onProgress === 'function') onProgress(Math.min(i + CHUNK, arr.length), arr.length);
    }
    return { updated: totalUpdated, errors: totalErrors };
  }

  /* Genera y dispara download de un .xlsx con headers + 1 fila de ejemplo
     + nota explicativa al final. */
  function downloadSuppliersTemplate() {
    if (typeof window.XLSX === 'undefined') {
      throw new Error('SheetJS (XLSX) no esta cargado.');
    }
    const headers = [
      'nombre','cuit','email','telefono','condicion_fiscal','condicion_iva',
      'provincia','ciudad','direccion','codigo_postal','rubro',
      'productos_habituales','notas',
    ];
    const example = [
      'MAGUEMA SRL','30-12345678-9','ventas@maguema.com.ar','011-4444-5555',
      'RI','Responsable Inscripto','Buenos Aires','Florida',
      'Av. Maipu 1234','1602','Maderas',
      'Melamina 18mm, herrajes, tornillos',
      'Proveedor principal de materia prima',
    ];
    const note = [
      'NOTA: columnas obligatorias = nombre + cuit. CUIT en formato XX-XXXXXXXX-X (o 11 dígitos sin guiones).',
    ];
    const aoa = [headers, example, [], note];
    const ws = window.XLSX.utils.aoa_to_sheet(aoa);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Proveedores');
    window.XLSX.writeFile(wb, 'plantilla-proveedores.xlsx');
  }

  /* Genera y dispara download del reporte post-import. Cada fila tiene
     {rowNum, status, reason, ...datos_originales}. */
  function generateBulkReportXlsx(results) {
    if (typeof window.XLSX === 'undefined') {
      throw new Error('SheetJS (XLSX) no esta cargado.');
    }
    const rows = Array.isArray(results) ? results : [];
    const out = rows.map(r => ({
      '#': r.rowNum,
      'Estado': r.status,
      'Motivo': r.reason || '',
      'Nombre': r.nombre || '',
      'CUIT': r.cuit || '',
      'Email': r.email || '',
      'Telefono': r.telefono || '',
      'Condicion fiscal': r.condicion_fiscal || '',
      'Provincia': r.provincia || '',
      'Ciudad': r.ciudad || '',
      'Direccion': r.direccion || '',
      'Codigo postal': r.codigo_postal || '',
      'Rubro': r.rubro || '',
      'Notas': r.notas || '',
    }));
    const ws = window.XLSX.utils.json_to_sheet(out);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Reporte import');
    const fecha = new Date().toISOString().slice(0, 10);
    window.XLSX.writeFile(wb, `reporte-import-proveedores-${fecha}.xlsx`);
  }

  /* ── Bulk import checks (S2.5) ─────────────────────────────────── */

  /* Diccionarios de sinonimos para fuzzy matching. Incluye 'librador_*'
     en received como sinonimo de 'emisor_*' (decision Jefe #1: tolerar
     ambas nomenclaturas en el archivo, mapear todas a emisor_*). */
  const CHECK_ISSUED_HEADER_SYNONYMS = {
    numero:               ['numero','nro','n','num','cheque_nro','nro_cheque'],
    banco:                ['banco','entidad','banco_emisor'],
    monto:                ['monto','importe','valor','total','amount'],
    fecha_emision:        ['fecha_emision','fecha','emision','fecha_cheque'],
    fecha_cobro_estimada: ['fecha_cobro_estimada','fecha_vencimiento','vencimiento','vto','fecha_pago_estimada'],
    beneficiario_cuit:    ['beneficiario_cuit','cuit_beneficiario','cuit','cuit_proveedor'],
    beneficiario_nombre:  ['beneficiario_nombre','beneficiario','proveedor','nombre','razon_social','rs'],
    estado:               ['estado','status','situacion'],
    notas:                ['notas','observaciones','comentarios','obs','notes'],
    // moneda: NO mapeada (decision bonus 1: ignorar columna).
  };

  const CHECK_RECEIVED_HEADER_SYNONYMS = {
    numero:               ['numero','nro','n','num','cheque_nro','nro_cheque'],
    banco:                ['banco','entidad','banco_emisor'],
    monto:                ['monto','importe','valor','total','amount'],
    fecha_emision:        ['fecha_emision','fecha','emision','fecha_cheque'],
    fecha_cobro_estimada: ['fecha_cobro_estimada','fecha_vencimiento','vencimiento','vto','fecha_pago_estimada'],
    emisor_cuit:          ['emisor_cuit','cuit_emisor','cuit','cuit_cliente','librador_cuit','cuit_librador','customer_cuit'],
    emisor_nombre:        ['emisor_nombre','emisor','cliente','customer','nombre','razon_social','rs','librador','librador_nombre','customer_nombre'],
    estado:               ['estado','status','situacion'],
    notas:                ['notas','observaciones','comentarios','obs','notes'],
  };

  /* Mapeo de sinonimos de estado al enum BD (decision Jefe #2).
     Devuelve null si el valor no es reconocido. */
  const CHECK_STATE_MAP = {
    'pendiente':  'emitido',
    'emitido':    'emitido',
    'cobrado':    'cobrado',
    'pagado':     'cobrado',
    'rechazado':  'devuelto',
    'devuelto':   'devuelto',
    'anulado':    'anulado',
    'cancelado':  'anulado',
  };

  function normalizeCheckEstado(raw) {
    if (raw == null || raw === '') return 'emitido';
    const k = String(raw).trim().toLowerCase();
    if (k === '') return 'emitido';
    const mapped = CHECK_STATE_MAP[k];
    return mapped || null;  // null = invalido
  }

  /* Decision bonus 2: SIN strip de leading zeros. Solo trim + collapse
     internal whitespace. "00123" y "123" se tratan como distintos. */
  function normalizeCheckNumber(raw) {
    if (raw == null || raw === '') return null;
    const n = String(raw).trim().replace(/\s+/g, '');
    if (n.length === 0) return null;
    return n;
  }

  function mapCheckHeaders(rawHeaders, kind) {
    const dict = kind === 'received' ? CHECK_RECEIVED_HEADER_SYNONYMS : CHECK_ISSUED_HEADER_SYNONYMS;
    const fieldMap = {};
    for (let i = 0; i < rawHeaders.length; i++) {
      const norm = normalizeHeader(rawHeaders[i]);
      for (const [field, synonyms] of Object.entries(dict)) {
        if (synonyms.includes(norm)) { fieldMap[i] = field; break; }
      }
    }
    const fields = Object.values(fieldMap);
    if (!fields.includes('numero')) {
      throw new Error('Falta columna obligatoria "numero" (o sinónimos: nro, n, num).');
    }
    if (!fields.includes('banco')) {
      throw new Error('Falta columna obligatoria "banco".');
    }
    if (!fields.includes('monto')) {
      throw new Error('Falta columna obligatoria "monto" (o sinónimos: importe, valor, total).');
    }
    if (!fields.includes('fecha_emision')) {
      throw new Error('Falta columna obligatoria "fecha_emision" (o sinónimos: fecha, emision).');
    }
    return fieldMap;
  }

  async function parseChecksSpreadsheet(file, kind) {
    if (typeof window.XLSX === 'undefined') {
      throw new Error('SheetJS (XLSX) no esta cargado. Recargá la página.');
    }
    if (kind !== 'issued' && kind !== 'received') {
      throw new Error('kind debe ser issued o received');
    }
    const buf = await file.arrayBuffer();
    const wb = window.XLSX.read(buf, { type: 'array', cellDates: false });
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const arr = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    if (!arr || arr.length < 2) {
      throw new Error('Archivo vacío o sin filas de datos.');
    }
    const fieldMap = mapCheckHeaders(arr[0], kind);
    const rows = [];
    for (let i = 1; i < arr.length; i++) {
      const raw = arr[i];
      if (raw.every(c => c == null || String(c).trim() === '')) continue;
      const obj = {};
      for (const [idxStr, field] of Object.entries(fieldMap)) {
        obj[field] = raw[Number(idxStr)] != null ? String(raw[Number(idxStr)]) : '';
      }
      obj._rowNum = i + 1;
      rows.push(obj);
    }
    return rows;
  }

  /* Validacion por fila. Devuelve estructura normalizada.
     kind: 'issued' | 'received'. */
  function validateCheckRow(row, kind) {
    const errors = [];

    const numero = normalizeCheckNumber(row.numero);
    if (!numero) errors.push('Falta numero o invalido');
    else if (numero.length > 50) errors.push('Numero supera 50 caracteres');

    const banco = (row.banco || '').trim();
    if (!banco) errors.push('Falta banco');
    else if (banco.length > 120) errors.push('Banco supera 120 caracteres');

    const montoRaw = String(row.monto || '').trim().replace(/\./g, '').replace(',', '.');
    const monto = Number(montoRaw);
    if (!Number.isFinite(monto) || monto <= 0) {
      errors.push(`Monto inválido o no positivo: "${row.monto}"`);
    }

    const fechaEmision = window.parseFechaAR ? window.parseFechaAR(row.fecha_emision) : null;
    if (!fechaEmision) errors.push(`fecha_emision inválida: "${row.fecha_emision}"`);

    const fechaCobroEst = row.fecha_cobro_estimada
      ? (window.parseFechaAR ? window.parseFechaAR(row.fecha_cobro_estimada) : null)
      : null;
    if (row.fecha_cobro_estimada && !fechaCobroEst) {
      errors.push(`fecha_cobro_estimada inválida: "${row.fecha_cobro_estimada}"`);
    }

    const estado = normalizeCheckEstado(row.estado);
    if (estado === null) {
      errors.push(`Estado desconocido: "${row.estado}"`);
    }

    const notas = (row.notas || '').trim();
    if (notas.length > 500) errors.push('Notas supera 500 caracteres');

    // CUIT entidad (opcional)
    const cuitField = kind === 'received' ? 'emisor_cuit' : 'beneficiario_cuit';
    const nombreField = kind === 'received' ? 'emisor_nombre' : 'beneficiario_nombre';
    const cuitNorm = normalizeCuit(row[cuitField]);
    if (row[cuitField] && row[cuitField].trim() && !cuitNorm) {
      errors.push(`CUIT entidad inválido: "${row[cuitField]}"`);
    }
    const nombreEntidad = (row[nombreField] || '').trim();

    // Si no hay match de cuit ni nombre → falla CHECK constraint *_required
    // El "match" se resuelve mas tarde con resolveEntitiesByCuit; aca solo
    // confirmamos que al menos uno de los dos esta cargado.
    if (!cuitNorm && !nombreEntidad) {
      errors.push(`Falta entidad: cargá ${cuitField} o ${nombreField}`);
    }

    return {
      rowNum: row._rowNum,
      isValid: errors.length === 0,
      errors,
      normalized: {
        numero,
        banco,
        monto,
        fecha_emision: fechaEmision,
        fecha_cobro_estimada: fechaCobroEst,
        [cuitField]: cuitNorm,           // 'beneficiario_cuit' o 'emisor_cuit'
        [nombreField]: nombreEntidad,    // texto libre, va a *_texto si no hay match
        estado: estado || 'emitido',
        notas: notas,
      },
    };
  }

  async function checkChecksIssuedExist(pairs) {
    const arr = Array.isArray(pairs) ? pairs.filter(p => p && p.numero && p.banco) : [];
    if (arr.length === 0) return { existing: [], not_existing: [] };
    const { data, error } = await supa.rpc('rpc_admin_check_checks_issued_exist', {
      p_payload: { pairs: arr },
    });
    if (error) throw new Error(error.message || 'No se pudo verificar duplicados');
    return data || { existing: [], not_existing: [] };
  }

  async function checkChecksReceivedExist(pairs) {
    const arr = Array.isArray(pairs) ? pairs.filter(p => p && p.numero && p.banco) : [];
    if (arr.length === 0) return { existing: [], not_existing: [] };
    const { data, error } = await supa.rpc('rpc_admin_check_checks_received_exist', {
      p_payload: { pairs: arr },
    });
    if (error) throw new Error(error.message || 'No se pudo verificar duplicados');
    return data || { existing: [], not_existing: [] };
  }

  async function resolveEntitiesByCuit(cuits, entityType) {
    const arr = Array.isArray(cuits) ? cuits.filter(Boolean) : [];
    if (arr.length === 0) return { matches: [], unmatched: [] };
    const { data, error } = await supa.rpc('rpc_admin_resolve_entities_by_cuit', {
      p_cuits: arr, p_entity_type: entityType,
    });
    if (error) throw new Error(error.message || 'No se pudo resolver entidades');
    return data || { matches: [], unmatched: [] };
  }

  /* Helper interno: chunking 1000 + secuencial + acumulacion. */
  async function _bulkChunked(rpcName, items, onProgress) {
    const arr = Array.isArray(items) ? items : [];
    if (arr.length === 0) return { count: 0, errors: [] };
    const CHUNK = 1000;
    let totalCount = 0;
    const totalErrors = [];
    const countKey = rpcName.includes('update') ? 'updated' : 'created';
    for (let i = 0; i < arr.length; i += CHUNK) {
      const chunk = arr.slice(i, i + CHUNK);
      const { data, error } = await supa.rpc(rpcName, { p_payload: { items: chunk } });
      if (error) throw new Error(error.message || `No se pudo ejecutar ${rpcName}`);
      totalCount += (data && data[countKey]) || 0;
      const errs = (data && data.errors) || [];
      for (const e of errs) totalErrors.push({ ...e, index: e.index + i });
      if (typeof onProgress === 'function') onProgress(Math.min(i + CHUNK, arr.length), arr.length);
    }
    return { count: totalCount, errors: totalErrors };
  }

  async function bulkCreateChecksIssued(items, onProgress) {
    const r = await _bulkChunked('rpc_admin_bulk_create_checks_issued', items, onProgress);
    return { created: r.count, errors: r.errors };
  }
  async function bulkUpdateChecksIssued(items, onProgress) {
    const r = await _bulkChunked('rpc_admin_bulk_update_checks_issued', items, onProgress);
    return { updated: r.count, errors: r.errors };
  }
  async function bulkCreateChecksReceived(items, onProgress) {
    const r = await _bulkChunked('rpc_admin_bulk_create_checks_received', items, onProgress);
    return { created: r.count, errors: r.errors };
  }
  async function bulkUpdateChecksReceived(items, onProgress) {
    const r = await _bulkChunked('rpc_admin_bulk_update_checks_received', items, onProgress);
    return { updated: r.count, errors: r.errors };
  }

  function _writeChecksTemplate(kind) {
    if (typeof window.XLSX === 'undefined') {
      throw new Error('SheetJS (XLSX) no esta cargado.');
    }
    let headers, example, fileName;
    if (kind === 'received') {
      headers = [
        'numero','banco','monto','fecha_emision','fecha_cobro_estimada',
        'emisor_cuit','emisor_nombre','estado','notas',
      ];
      example = [
        '00125','Galicia','85000','2026-05-20','2026-06-20',
        '30-12345678-9','CLIENTE B2B SA','emitido',
        'Cheque a 30 dias',
      ];
      fileName = 'plantilla-cheques-recibidos.xlsx';
    } else {
      headers = [
        'numero','banco','monto','fecha_emision','fecha_cobro_estimada',
        'beneficiario_cuit','beneficiario_nombre','estado','notas',
      ];
      example = [
        '00125','Galicia','85000','2026-05-20','2026-06-20',
        '30-12345678-9','MAGUEMA SRL','emitido',
        'Pago factura 0001-00125',
      ];
      fileName = 'plantilla-cheques-emitidos.xlsx';
    }
    const note = [
      'NOTA: numero, banco, monto y fecha_emision son obligatorios.',
      '       Estado acepta: emitido/pendiente, cobrado/pagado, devuelto/rechazado, anulado/cancelado.',
      '       Moneda: ARS (no editable en S2.5).',
      '       CUIT entidad: formato XX-XXXXXXXX-X o 11 dígitos sin guiones.',
    ];
    const aoa = [headers, example, [], ...note.map(n => [n])];
    const ws = window.XLSX.utils.aoa_to_sheet(aoa);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Cheques');
    window.XLSX.writeFile(wb, fileName);
  }
  function downloadChecksIssuedTemplate()   { _writeChecksTemplate('issued'); }
  function downloadChecksReceivedTemplate() { _writeChecksTemplate('received'); }

  /* Genera reporte post-import como .xlsx descargable. */
  function generateChecksBulkReportXlsx(results, kind) {
    if (typeof window.XLSX === 'undefined') {
      throw new Error('SheetJS (XLSX) no esta cargado.');
    }
    const rows = Array.isArray(results) ? results : [];
    const cuitField = kind === 'received' ? 'emisor_cuit' : 'beneficiario_cuit';
    const nombreField = kind === 'received' ? 'emisor_nombre' : 'beneficiario_nombre';
    const out = rows.map(r => ({
      '#': r.rowNum,
      'Estado': r.status,
      'Motivo': r.reason || '',
      'Numero': r.numero || '',
      'Banco': r.banco || '',
      'Monto': r.monto || '',
      'Fecha emision': r.fecha_emision || '',
      'Fecha cobro estimada': r.fecha_cobro_estimada || '',
      'CUIT entidad': r[cuitField] || '',
      'Nombre entidad': r[nombreField] || '',
      'Estado cheque': r.estado || '',
      'Movement generado': r.movement_generado ? 'sí' : 'no',
      'Notas': r.notas || '',
    }));
    const ws = window.XLSX.utils.json_to_sheet(out);
    const wb = window.XLSX.utils.book_new();
    const sheet = kind === 'received' ? 'Reporte recibidos' : 'Reporte emitidos';
    window.XLSX.utils.book_append_sheet(wb, ws, sheet);
    const fecha = new Date().toISOString().slice(0, 10);
    const prefix = kind === 'received' ? 'reporte-cheques-recibidos' : 'reporte-cheques-emitidos';
    window.XLSX.writeFile(wb, `${prefix}-${fecha}.xlsx`);
  }

  /* ── Employees (S2.11) ─────────────────────────────────────────── */

  const EMPLOYEE_COLS = '*';  // 27 columnas, simple

  /* Listado con filtro activos. SELECT directo (decision Jefe:
     reutilizar RLS, igual que suppliers/customers). */
  async function loadEmployees(opts) {
    const includeInactive = opts && opts.includeInactive === true;
    let q = supa.from('employees').select(EMPLOYEE_COLS).order('nombre', { ascending: true });
    if (!includeInactive) q = q.eq('activo', true);
    const { data, error } = await q;
    if (error) throw new Error(error.message || 'No se pudo cargar empleados');
    return data || [];
  }

  async function createEmployee(payload) {
    return _rpcWithHint('rpc_admin_create_employee', payload, 'No se pudo crear empleado');
  }
  async function updateEmployee(payload) {
    return _rpcWithHint('rpc_admin_update_employee', payload, 'No se pudo actualizar empleado');
  }
  async function deleteEmployee(payload) {
    return _rpcWithHint('rpc_admin_delete_employee', payload, 'No se pudo eliminar empleado');
  }

  /* ── S2.24 HORAS EXTRAS ─────────────────────────────────────────────
     Wrappers de los 5 RPCs de migration 0068. Los consume HsExtrasTab
     (rrhh.jsx). El campo valor_hora_extra del empleado se guarda con el
     resto del modal (rpc_admin_update/create_employee extendidos) o
     puntualmente con updateValorHoraEmpleado (quick edit del tab). */
  async function listHorasExtras(payload) {
    const { data, error } = await supa.rpc('rpc_rrhh_list_horas_extras', { p_payload: payload || {} });
    if (error) throw new Error(error.message || 'No se pudo cargar horas extras');
    return data || [];
  }
  async function createHoraExtra(payload) {
    const { data, error } = await supa.rpc('rpc_rrhh_create_hora_extra', { p_payload: payload });
    if (error) throw new Error(error.message || 'No se pudo registrar la hora extra');
    return data;
  }
  async function deleteHoraExtra(payload) {
    const { data, error } = await supa.rpc('rpc_rrhh_delete_hora_extra', { p_payload: payload });
    if (error) throw new Error(error.message || 'No se pudo eliminar la hora extra');
    return data;
  }
  async function reporteHsExtras(payload) {
    const { data, error } = await supa.rpc('rpc_rrhh_reporte_hs_extras', { p_payload: payload });
    if (error) throw new Error(error.message || 'No se pudo generar el reporte');
    return data || [];
  }
  async function updateValorHoraEmpleado(payload) {
    const { data, error } = await supa.rpc('rpc_rrhh_update_valor_hora', { p_payload: payload });
    if (error) throw new Error(error.message || 'No se pudo actualizar el valor hora');
    return data;
  }

  async function getEmployeeHistorial(employeeId) {
    const { data, error } = await supa.rpc('rpc_admin_get_employee_historial', { p_employee_id: employeeId });
    if (error) throw new Error(error.message || 'No se pudo cargar historial');
    return data;
  }

  async function checkCuilsExist(cuils) {
    const arr = Array.isArray(cuils) ? cuils.filter(Boolean) : [];
    if (arr.length === 0) return { existing: [], not_existing: [] };
    const { data, error } = await supa.rpc('rpc_admin_check_cuils_exist', { p_cuils: arr });
    if (error) throw new Error(error.message || 'No se pudo verificar duplicados');
    return data || { existing: [], not_existing: [] };
  }

  /* Bulk con chunking 1000 (patron S2.4). */
  async function bulkCreateEmployees(items, onProgress) {
    const arr = Array.isArray(items) ? items : [];
    if (arr.length === 0) return { created: 0, errors: [] };
    const CHUNK = 1000;
    let totalCreated = 0;
    const totalErrors = [];
    for (let i = 0; i < arr.length; i += CHUNK) {
      const chunk = arr.slice(i, i + CHUNK);
      const { data, error } = await supa.rpc('rpc_admin_bulk_create_employees', {
        p_payload: { items: chunk },
      });
      if (error) throw new Error(error.message || 'No se pudo crear batch');
      totalCreated += (data && data.created) || 0;
      const errs = (data && data.errors) || [];
      for (const e of errs) totalErrors.push({ ...e, index: e.index + i });
      if (typeof onProgress === 'function') onProgress(Math.min(i + CHUNK, arr.length), arr.length);
    }
    return { created: totalCreated, errors: totalErrors };
  }
  async function bulkUpdateEmployees(items, onProgress) {
    const arr = Array.isArray(items) ? items : [];
    if (arr.length === 0) return { updated: 0, errors: [] };
    const CHUNK = 1000;
    let totalUpdated = 0;
    const totalErrors = [];
    for (let i = 0; i < arr.length; i += CHUNK) {
      const chunk = arr.slice(i, i + CHUNK);
      const { data, error } = await supa.rpc('rpc_admin_bulk_update_employees', {
        p_payload: { items: chunk },
      });
      if (error) throw new Error(error.message || 'No se pudo actualizar batch');
      totalUpdated += (data && data.updated) || 0;
      const errs = (data && data.errors) || [];
      for (const e of errs) totalErrors.push({ ...e, index: e.index + i });
      if (typeof onProgress === 'function') onProgress(Math.min(i + CHUNK, arr.length), arr.length);
    }
    return { updated: totalUpdated, errors: totalErrors };
  }

  /* Selects compartidos modal + bulk. */
  const MODALIDAD_OPTIONS = [
    { value: 'full_time', label: 'Full time' },
    { value: 'part_time', label: 'Part time' },
    { value: 'horas',     label: 'Por horas' },
    { value: 'eventual',  label: 'Eventual' },
  ];
  const TIPO_CONTRATACION_OPTIONS = [
    { value: 'relacion_dependencia', label: 'Relación de dependencia' },
    { value: 'monotributo',          label: 'Monotributo' },
    { value: 'autonomo',             label: 'Autónomo' },
    { value: 'eventual',             label: 'Eventual' },
  ];
  const FORMA_COBRO_OPTIONS = [
    { value: 'transferencia', label: 'Transferencia' },
    { value: 'efectivo',      label: 'Efectivo' },
    { value: 'cheque',        label: 'Cheque' },
    { value: 'otro',          label: 'Otro' },
  ];

  /* Diccionario fuzzy headers para bulk import. 'cuit' aceptado como
     sinonimo de 'cuil' (decision Jefe). */
  const EMPLOYEE_HEADER_SYNONYMS = {
    cuil:                    ['cuil','cuil_cuit','cuit','nro_cuil','dni_cuil'],
    nombre:                  ['nombre','apellido_nombre','nombre_apellido','empleado','razon_social','rs'],
    fecha_nacimiento:        ['fecha_nacimiento','nacimiento','fecha_nac','f_nacimiento','fec_nac'],
    email:                   ['email','correo','mail','correo_electronico','e_mail'],
    telefono:                ['telefono','tel','telef','celular','cel','phone'],
    direccion:               ['direccion','domicilio','calle','address'],
    ciudad:                  ['ciudad','localidad','partido','city'],
    provincia:               ['provincia','prov','estado','region'],
    codigo_postal:           ['codigo_postal','cp','codigopostal','postal_code','zip'],
    fecha_ingreso:           ['fecha_ingreso','ingreso','fec_ingreso','alta','fecha_alta'],
    categoria:               ['categoria','puesto','cargo','rol'],
    modalidad:               ['modalidad','horario','tipo_horario','jornada'],
    tipo_contratacion:       ['tipo_contratacion','contratacion','contrato','relacion'],
    lugar_trabajo:           ['lugar_trabajo','lugar','sede','sucursal'],
    convenio:                ['convenio','convenio_colectivo','cct'],
    sueldo_bruto_base:       ['sueldo_bruto_base','sueldo_bruto','sueldo','salario','bruto','remuneracion','sueldo_base'],
    dias_vacaciones_anuales: ['dias_vacaciones_anuales','vacaciones','dias_vacaciones','dias_vac'],
    banco:                   ['banco','entidad_bancaria'],
    cbu:                     ['cbu','cuenta_bancaria','nro_cbu','banco_cbu'],
    alias_cbu:               ['alias_cbu','alias','alias_bancario'],
    forma_cobro:             ['forma_cobro','metodo_pago','medio_pago','forma_pago'],
    notas:                   ['notas','observaciones','comentarios','obs'],
  };

  /* normalizeCuil = alias de normalizeCuit (mismo regex XX-XXXXXXXX-X). */
  const normalizeCuil = normalizeCuit;

  function mapEmployeeHeaders(rawHeaders) {
    const fieldMap = {};
    for (let i = 0; i < rawHeaders.length; i++) {
      const norm = normalizeHeader(rawHeaders[i]);
      for (const [field, synonyms] of Object.entries(EMPLOYEE_HEADER_SYNONYMS)) {
        if (synonyms.includes(norm)) { fieldMap[i] = field; break; }
      }
    }
    const fields = Object.values(fieldMap);
    if (!fields.includes('nombre')) {
      throw new Error('Falta columna obligatoria "nombre" (o sinónimos: apellido_nombre, empleado, razón social).');
    }
    if (!fields.includes('cuil')) {
      throw new Error('Falta columna obligatoria "cuil" (o sinónimo CUIT/CUIL).');
    }
    return fieldMap;
  }

  async function parseEmployeesSpreadsheet(file) {
    if (typeof window.XLSX === 'undefined') {
      throw new Error('SheetJS (XLSX) no esta cargado. Recargá la página.');
    }
    const buf = await file.arrayBuffer();
    const wb = window.XLSX.read(buf, { type: 'array', cellDates: false });
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const arr = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    if (!arr || arr.length < 2) {
      throw new Error('Archivo vacío o sin filas de datos.');
    }
    const fieldMap = mapEmployeeHeaders(arr[0]);
    const rows = [];
    for (let i = 1; i < arr.length; i++) {
      const raw = arr[i];
      if (raw.every(c => c == null || String(c).trim() === '')) continue;
      const obj = {};
      for (const [idxStr, field] of Object.entries(fieldMap)) {
        obj[field] = raw[Number(idxStr)] != null ? String(raw[Number(idxStr)]) : '';
      }
      obj._rowNum = i + 1;
      rows.push(obj);
    }
    return rows;
  }

  function validateEmployeeRow(row) {
    const errors = [];
    const nombre = (row.nombre || '').trim();
    if (!nombre) errors.push('Falta nombre');
    else if (nombre.length > 120) errors.push('Nombre supera 120 caracteres');

    const cuilNorm = normalizeCuil(row.cuil);
    if (!cuilNorm) errors.push(`CUIL inválido (formato XX-XXXXXXXX-X o 11 dígitos)`);

    const email = (row.email || '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push(`Email mal formado: "${email}"`);
    }

    const modalidad = (row.modalidad || '').trim();
    if (modalidad && !MODALIDAD_OPTIONS.some(o => o.value === modalidad)) {
      errors.push(`Modalidad inválida (full_time/part_time/horas/eventual)`);
    }
    const tipoCont = (row.tipo_contratacion || '').trim();
    if (tipoCont && !TIPO_CONTRATACION_OPTIONS.some(o => o.value === tipoCont)) {
      errors.push(`Tipo de contratación inválido`);
    }
    const formaCobro = (row.forma_cobro || '').trim();
    if (formaCobro && !FORMA_COBRO_OPTIONS.some(o => o.value === formaCobro)) {
      errors.push(`Forma de cobro inválida (transferencia/efectivo/cheque/otro)`);
    }
    const prov = (row.provincia || '').trim();
    if (prov && !ARG_PROVINCIAS.includes(prov)) {
      errors.push(`Provincia desconocida: "${prov}"`);
    }

    const sueldoStr = String(row.sueldo_bruto_base || '').trim().replace(/\./g, '').replace(',', '.');
    const sueldo = sueldoStr === '' ? null : Number(sueldoStr);
    if (sueldo !== null && (!Number.isFinite(sueldo) || sueldo < 0)) {
      errors.push(`Sueldo bruto base inválido: "${row.sueldo_bruto_base}"`);
    }

    const cbuRaw = (row.cbu || '').trim().replace(/\s+/g, '');
    if (cbuRaw && !/^\d{22}$/.test(cbuRaw)) {
      errors.push(`CBU inválido: "${row.cbu}" (debe ser 22 dígitos)`);
    }

    const fNac = row.fecha_nacimiento ? (window.parseFechaAR ? window.parseFechaAR(row.fecha_nacimiento) : null) : null;
    if (row.fecha_nacimiento && !fNac) errors.push(`fecha_nacimiento inválida: "${row.fecha_nacimiento}"`);
    const fIng = row.fecha_ingreso ? (window.parseFechaAR ? window.parseFechaAR(row.fecha_ingreso) : null) : null;
    if (row.fecha_ingreso && !fIng) errors.push(`fecha_ingreso inválida: "${row.fecha_ingreso}"`);

    const notas = (row.notas || '').trim();
    if (notas.length > 500) errors.push('Notas supera 500 caracteres');

    return {
      rowNum: row._rowNum,
      isValid: errors.length === 0,
      errors,
      normalized: {
        nombre,
        cuil: cuilNorm,
        fecha_nacimiento: fNac,
        email,
        telefono: (row.telefono || '').trim(),
        direccion: (row.direccion || '').trim(),
        ciudad: (row.ciudad || '').trim(),
        provincia: prov,
        codigo_postal: (row.codigo_postal || '').trim(),
        fecha_ingreso: fIng,
        categoria: (row.categoria || '').trim(),
        modalidad: modalidad,
        tipo_contratacion: tipoCont,
        lugar_trabajo: (row.lugar_trabajo || '').trim(),
        convenio: (row.convenio || '').trim(),
        sueldo_bruto_base: sueldo,
        dias_vacaciones_anuales: row.dias_vacaciones_anuales ? parseInt(row.dias_vacaciones_anuales, 10) || null : null,
        banco: (row.banco || '').trim(),
        cbu: cbuRaw,
        alias_cbu: (row.alias_cbu || '').trim(),
        forma_cobro: formaCobro,
        notas,
      },
    };
  }

  function downloadEmployeesTemplate() {
    if (typeof window.XLSX === 'undefined') {
      throw new Error('SheetJS (XLSX) no esta cargado.');
    }
    const headers = [
      'cuil','nombre','fecha_nacimiento','email','telefono','direccion',
      'ciudad','provincia','codigo_postal','fecha_ingreso','categoria',
      'modalidad','tipo_contratacion','lugar_trabajo','convenio',
      'sueldo_bruto_base','dias_vacaciones_anuales','banco','cbu',
      'alias_cbu','forma_cobro','notas',
    ];
    const example = [
      '20-12345678-9','Juan Pérez','1985-03-15','juan@example.com','011-4444-5555',
      'Av. Maipú 1234','Florida','Buenos Aires','1602','2024-03-01','Operario',
      'full_time','relacion_dependencia','Taller principal','UOM',
      '450000','14','Galicia','0001234567890123456789',
      'juan.perez.gal','transferencia','Empleado de planta',
    ];
    const note = [
      'NOTA: cuil y nombre son obligatorios.',
      '       CUIL formato XX-XXXXXXXX-X o 11 dígitos sin guiones.',
      '       Modalidad: full_time/part_time/horas/eventual.',
      '       Tipo contratación: relacion_dependencia/monotributo/autonomo/eventual.',
      '       Forma cobro: transferencia/efectivo/cheque/otro.',
      '       CBU: 22 dígitos exactos si presente.',
      '       Aceptamos "CUIT" como sinónimo de "CUIL".',
    ];
    const aoa = [headers, example, [], ...note.map(n => [n])];
    const ws = window.XLSX.utils.aoa_to_sheet(aoa);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Empleados');
    window.XLSX.writeFile(wb, 'plantilla-empleados.xlsx');
  }

  function generateEmployeesBulkReportXlsx(results) {
    if (typeof window.XLSX === 'undefined') {
      throw new Error('SheetJS (XLSX) no esta cargado.');
    }
    const rows = Array.isArray(results) ? results : [];
    const out = rows.map(r => ({
      '#': r.rowNum,
      'Estado': r.status,
      'Motivo': r.reason || '',
      'CUIL': r.cuil || '',
      'Nombre': r.nombre || '',
      'Fecha ingreso': r.fecha_ingreso || '',
      'Categoria': r.categoria || '',
      'Modalidad': r.modalidad || '',
      'Tipo contratacion': r.tipo_contratacion || '',
      'Sueldo bruto base': r.sueldo_bruto_base || '',
      'Banco': r.banco || '',
      'CBU': r.cbu || '',
      'Forma cobro': r.forma_cobro || '',
      'Notas': r.notas || '',
    }));
    const ws = window.XLSX.utils.json_to_sheet(out);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Reporte empleados');
    const fecha = new Date().toISOString().slice(0, 10);
    window.XLSX.writeFile(wb, `reporte-import-empleados-${fecha}.xlsx`);
  }

  /* ────────────────────────────────────────────────────────────────
     S2.12 — Recibos de sueldo + Company settings
     ──────────────────────────────────────────────────────────────── */

  const RECIBO_TIPO_OPTIONS = [
    { value: 'adelanto', label: 'Adelanto' },
    { value: 'quincena', label: 'Quincena' },
    { value: 'sueldo',   label: 'Sueldo' },
  ];

  const RECIBO_ESTADO_OPTIONS = [
    { value: 'emitido', label: 'Emitido' },
    { value: 'anulado', label: 'Anulado' },
  ];

  async function getCompanySettings() {
    const { data, error } = await supa.rpc('rpc_admin_get_company_settings');
    if (error) throw new Error(error.message || 'No se pudo cargar configuración de empresa');
    return data;
  }

  async function updateCompanySettings(payload) {
    const { data, error } = await supa.rpc('rpc_admin_update_company_settings', { p_payload: payload });
    if (error) throw new Error(error.message || 'No se pudo guardar configuración de empresa');
    return data;
  }

  /* loadRecibos: SELECT directo (RLS owner/admin only). Incluye anulados
     si opts.includeAnulados=true. */
  async function loadRecibos(opts) {
    const includeAnulados = opts && opts.includeAnulados === true;
    let q = supa.from('recibos').select('*').order('fecha_pago', { ascending: false });
    if (!includeAnulados) q = q.eq('estado', 'emitido');
    const { data, error } = await q;
    if (error) throw new Error(error.message || 'No se pudo cargar recibos');
    return data || [];
  }

  async function getRecibo(id) {
    const { data, error } = await supa.from('recibos').select('*').eq('id', id).single();
    if (error) throw new Error(error.message || 'No se pudo obtener recibo');
    return data;
  }

  async function createRecibo(payload) {
    const { data, error } = await supa.rpc('rpc_admin_create_recibo', { p_payload: payload });
    if (error) throw new Error(error.message || 'No se pudo crear recibo');
    return data;
  }

  async function updateRecibo(payload) {
    const { data, error } = await supa.rpc('rpc_admin_update_recibo', { p_payload: payload });
    if (error) throw new Error(error.message || 'No se pudo actualizar recibo');
    return data;
  }

  async function anularRecibo(payload) {
    const { data, error } = await supa.rpc('rpc_admin_anular_recibo', { p_payload: payload });
    if (error) throw new Error(error.message || 'No se pudo anular recibo');
    return data;
  }

  async function deleteRecibo(payload) {
    const { data, error } = await supa.rpc('rpc_admin_delete_recibo', { p_payload: payload });
    if (error) throw new Error(error.message || 'No se pudo eliminar recibo');
    return data;
  }

  async function listRecibosByPeriod(desde, hasta, tipo) {
    const { data, error } = await supa.rpc('rpc_admin_list_recibos_by_period', {
      p_desde: desde, p_hasta: hasta, p_tipo: tipo || null,
    });
    if (error) throw new Error(error.message || 'No se pudo listar recibos del período');
    return data || [];
  }

  /* Helpers de cálculo (valor del día = sueldo / 30; subtotal y total
     se recalculan en frontend en vivo y se mandan junto al payload). */
  function calcValorDia(sueldoBasico) {
    const n = Number(sueldoBasico);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n / 30;
  }
  function calcSubtotal(cantidad, valorUnitario) {
    const c = Number(cantidad);
    const v = Number(valorUnitario);
    if (!Number.isFinite(c) || !Number.isFinite(v)) return 0;
    return c * v;
  }
  function calcTotal(items) {
    if (!Array.isArray(items)) return 0;
    return items.reduce((acc, it) => {
      const s = Number(it && it.subtotal);
      return acc + (Number.isFinite(s) ? s : 0);
    }, 0);
  }

  /* Validador CUIT formato XX-XXXXXXXX-X (alias del existente para
     que company-settings-modal lo use con el mismo mensaje). */
  /* (se reusa validateCuit ya definido arriba). */

  /* ────────────────────────────────────────────────────────────────
     S2.15 — Histórico salarial + Reportes
     ──────────────────────────────────────────────────────────────── */

  async function getHistorialEmpleado(employeeId, year) {
    const { data, error } = await supa.rpc('rpc_admin_historial_empleado', {
      p_employee_id: employeeId,
      p_year: year,
    });
    if (error) throw new Error(error.message || 'No se pudo cargar histórico del empleado');
    return data;
  }

  async function getReportesGlobal(year, mes) {
    const { data, error } = await supa.rpc('rpc_admin_reportes_global', {
      p_year: year,
      p_mes: mes || null,
    });
    if (error) throw new Error(error.message || 'No se pudo cargar reportes');
    return data;
  }

  async function getRecibosDetalleEmpleado(employeeId, year, mes, tipo) {
    const { data, error } = await supa.rpc('rpc_admin_recibos_detalle_empleado', {
      p_employee_id: employeeId,
      p_year: year,
      p_mes: mes || null,
      p_tipo: tipo || null,
    });
    if (error) throw new Error(error.message || 'No se pudo cargar recibos del empleado');
    return data || [];
  }

  /* Helper para normalizar nombre de archivo (saca tildes/espacios). */
  function normalizeFilename(s) {
    return String(s || 'sin_nombre')
      .toLowerCase()
      .replace(/[áä]/g, 'a').replace(/[éë]/g, 'e').replace(/[íï]/g, 'i')
      .replace(/[óö]/g, 'o').replace(/[úü]/g, 'u').replace(/ñ/g, 'n')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  const MES_NAMES_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  function getMonthName(mes) {
    const m = Number(mes);
    if (!Number.isInteger(m) || m < 1 || m > 12) return '—';
    return MES_NAMES_ES[m - 1];
  }

  /* Export Excel del histórico individual. 1 hoja con detalle del empleado. */
  function exportHistorialEmpleadoXlsx(payload) {
    if (typeof window.XLSX === 'undefined') {
      throw new Error('SheetJS (XLSX) no esta cargado.');
    }
    const empleado = (payload && payload.empleado) || {};
    const totales  = (payload && payload.totales)  || {};
    const recibos  = Array.isArray(payload && payload.recibos) ? payload.recibos : [];
    const year     = (payload && payload.year) || new Date().getFullYear();

    /* Encabezado + KPIs */
    const aoa = [
      [`Histórico salarial - ${empleado.nombre || '—'}`],
      [`CUIL: ${empleado.cuil || '—'}    Categoría: ${empleado.categoria || '—'}    F.Ingreso: ${empleado.fecha_ingreso || '—'}`],
      [`Año: ${year}`],
      [],
      [`Total año:        $ ${Number(totales.year_total || 0).toLocaleString('es-AR', {minimumFractionDigits:2})}`],
      [`Total mes actual: $ ${Number(totales.month_total || 0).toLocaleString('es-AR', {minimumFractionDigits:2})}`],
      [`Promedio mensual: $ ${Number(totales.avg_monthly || 0).toLocaleString('es-AR', {minimumFractionDigits:2})}`],
      [`Cantidad recibos: ${totales.count_recibos || 0}`],
      [],
      ['Tipo','Período desde','Período hasta','Fecha pago','Sueldo básico','Total','Notas'],
    ];
    let suma = 0;
    recibos.forEach(r => {
      const t = Number(r.total || 0);
      suma += t;
      aoa.push([
        r.tipo || '',
        String(r.periodo_desde || '').slice(0,10),
        String(r.periodo_hasta || '').slice(0,10),
        String(r.fecha_pago || '').slice(0,10),
        Number(r.sueldo_basico || 0),
        t,
        r.notas || '',
      ]);
    });
    aoa.push([]);
    aoa.push(['', '', '', '', 'TOTAL:', suma, '']);

    const ws = window.XLSX.utils.aoa_to_sheet(aoa);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, `Recibos ${year}`);
    const fname = `historial_${normalizeFilename(empleado.nombre)}_${year}.xlsx`;
    window.XLSX.writeFile(wb, fname);
  }

  /* Export Excel global. Worksheet "Resumen" + N hojas detalle (cap 30). */
  const REPORTES_GLOBAL_DETAIL_CAP = 30; /* S2.15: cap a 30 para evitar archivos >20MB. Si Noe necesita todos, dividir por categoría en sprint hardening. */

  function exportReportesGlobalXlsx(payload) {
    if (typeof window.XLSX === 'undefined') {
      throw new Error('SheetJS (XLSX) no esta cargado.');
    }
    const tabla = Array.isArray(payload && payload.tabla) ? payload.tabla : [];
    const kpis  = (payload && payload.kpis) || {};
    const year  = (payload && payload.year) || new Date().getFullYear();
    const mes   = payload && payload.mes;

    const wb = window.XLSX.utils.book_new();

    /* Hoja Resumen */
    const resumenAoa = [
      [`Reportes salariales - Año ${year}${mes ? ` · Mes ${mes}` : ''}`],
      [],
      [`Total año:        $ ${Number(kpis.total_year || 0).toLocaleString('es-AR', {minimumFractionDigits:2})}`],
      mes ? [`Total mes:        $ ${Number(kpis.total_month || 0).toLocaleString('es-AR', {minimumFractionDigits:2})}`] : [],
      [`Promedio/empleado:$ ${Number(kpis.avg_per_employee || 0).toLocaleString('es-AR', {minimumFractionDigits:2})}`],
      [`Empleados activos: ${kpis.empleados_count || 0}`],
      kpis.top_employee ? [`Top:  ${kpis.top_employee.nombre} → $ ${Number(kpis.top_employee.total_year || 0).toLocaleString('es-AR')}`] : [],
      kpis.low_employee ? [`Low:  ${kpis.low_employee.nombre} → $ ${Number(kpis.low_employee.total_year || 0).toLocaleString('es-AR')}`] : [],
      [],
      ['Empleado','CUIL','Categoría','Total año','Total mes','Adelantos','Quincenas','Sueldos','# Recibos','Último recibo'],
    ];
    tabla.forEach(t => {
      const ultimo = t.ultimo_recibo;
      const ultimoTxt = ultimo
        ? `${ultimo.tipo} · ${String(ultimo.fecha_pago).slice(0,10)} · $${Number(ultimo.total||0).toLocaleString('es-AR')}`
        : '—';
      resumenAoa.push([
        t.nombre || '—',
        t.cuil || '',
        t.categoria || '',
        Number(t.total_year || 0),
        Number(t.total_month || 0),
        Number(t.total_adelanto || 0),
        Number(t.total_quincena || 0),
        Number(t.total_sueldo || 0),
        Number(t.count_recibos_year || 0),
        ultimoTxt,
      ]);
    });
    const wsResumen = window.XLSX.utils.aoa_to_sheet(resumenAoa.filter(r => r && r.length >= 0));
    window.XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

    /* N hojas detalle (cap REPORTES_GLOBAL_DETAIL_CAP) */
    const detallables = tabla
      .filter(t => Number(t.count_recibos_year || 0) > 0)
      .slice(0, REPORTES_GLOBAL_DETAIL_CAP);
    detallables.forEach((t, idx) => {
      const detalleAoa = [
        [`Detalle - ${t.nombre || '—'}`],
        [`CUIL: ${t.cuil || '—'}    Categoría: ${t.categoria || '—'}    Año ${year}`],
        [],
        ['Tipo','Período desde','Período hasta','Fecha pago','Sueldo básico','Total','Notas'],
      ];
      /* Sin acceso a recibos por empleado en este payload — el componente
         deberá fetchearlos via getRecibosDetalleEmpleado y mergear antes
         de llamar a este export, o exportar solo el resumen. Para mantener
         el flow simple, dejamos las hojas detalle vacías si payload no
         trae recibos (ver reportes-tab.jsx fetch en bucle). */
      if (Array.isArray(t._recibos)) {
        let suma = 0;
        t._recibos.forEach(r => {
          const v = Number(r.total || 0);
          suma += v;
          detalleAoa.push([
            r.tipo || '',
            String(r.periodo_desde || '').slice(0,10),
            String(r.periodo_hasta || '').slice(0,10),
            String(r.fecha_pago || '').slice(0,10),
            Number(r.sueldo_basico || 0),
            v,
            r.notas || '',
          ]);
        });
        detalleAoa.push([]);
        detalleAoa.push(['', '', '', '', 'TOTAL:', suma, '']);
      } else {
        detalleAoa.push(['(Recibos detallados no incluidos en el export rápido. Usar el modal individual.)']);
      }
      const ws = window.XLSX.utils.aoa_to_sheet(detalleAoa);
      /* Nombre de hoja: máx 31 chars, sin caracteres prohibidos /\?*[] */
      const safeName = `Detalle - ${(t.nombre || `Empl${idx+1}`)}`
        .replace(/[\/\\?*\[\]:]/g, ' ')
        .slice(0, 31);
      window.XLSX.utils.book_append_sheet(wb, ws, safeName);
    });

    const truncated = tabla.filter(t => Number(t.count_recibos_year || 0) > 0).length > REPORTES_GLOBAL_DETAIL_CAP;
    const fname = `reportes_salariales_${year}${mes ? `_${String(mes).padStart(2,'0')}` : ''}${truncated ? '_top30' : ''}.xlsx`;
    window.XLSX.writeFile(wb, fname);

    return { truncated, total_employees: detallables.length };
  }

  /* ────────────────────────────────────────────────────────────────
     S2.16 — Cash Flow Diario
     ──────────────────────────────────────────────────────────────── */

  const CASH_FLOW_TIPOS = ['ingreso', 'egreso'];

  const CASH_FLOW_CATEGORIAS_SUGERIDAS = [
    'otros',
    'cobranza',
    'venta directa',
    'aporte capital',
    'devolución impuesto',
    'préstamo',
    'inversión',
    'ajuste caja',
    'anticipo cliente',
  ];

  async function getCashFlow(desde, hasta, incluirProyectado) {
    const { data, error } = await supa.rpc('rpc_admin_get_cash_flow', {
      p_fecha_desde: desde,
      p_fecha_hasta: hasta,
      p_incluir_proyectado: incluirProyectado !== false,
    });
    if (error) throw new Error(error.message || 'No se pudo cargar cash flow');
    return data;
  }

  async function listCashFlowManual(desde, hasta, tipo, includeInactivos) {
    const { data, error } = await supa.rpc('rpc_admin_list_cash_flow_manual', {
      p_fecha_desde: desde,
      p_fecha_hasta: hasta,
      p_tipo: tipo || null,
      p_include_inactivos: includeInactivos === true,
    });
    if (error) throw new Error(error.message || 'No se pudo cargar movimientos manuales');
    return data || [];
  }

  async function createCashFlowManual(payload) {
    const { data, error } = await supa.rpc('rpc_admin_create_cash_flow_manual', { p_payload: payload });
    if (error) throw new Error(error.message || 'No se pudo crear movimiento');
    return data;
  }

  async function updateCashFlowManual(payload) {
    const { data, error } = await supa.rpc('rpc_admin_update_cash_flow_manual', { p_payload: payload });
    if (error) throw new Error(error.message || 'No se pudo actualizar movimiento');
    return data;
  }

  async function deleteCashFlowManual(id) {
    const { data, error } = await supa.rpc('rpc_admin_delete_cash_flow_manual', { p_payload: { id } });
    if (error) throw new Error(error.message || 'No se pudo eliminar movimiento');
    return data;
  }

  /* Helpers cosméticos */
  function formatMoneyES(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '$ 0,00';
    return v.toLocaleString('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function getSaldoColor(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v === 0) return undefined;
    return v < 0 ? 'var(--red, #dc2626)' : 'var(--green, #16a34a)';
  }

  /* Export Excel del cash flow (1 worksheet con header + KPIs + tabla). */
  function exportCashFlowXlsx(args) {
    if (typeof window.XLSX === 'undefined') {
      throw new Error('SheetJS (XLSX) no esta cargado.');
    }
    const { payload, companySettings, period, filas } = args || {};
    if (!payload) throw new Error('payload requerido');

    const kpis  = payload.kpis  || {};
    const modo  = (period && period.modo)  || 'dia';
    const desde = (period && period.desde) || '';
    const hasta = (period && period.hasta) || '';
    const incluirProy = !!(period && period.incluirProy);
    const rs   = (companySettings && companySettings.razon_social) || 'MACARIO';
    const cuit = (companySettings && companySettings.cuit) || '';

    const filasArr = Array.isArray(filas) ? filas : [];

    /* Header */
    const aoa = [
      [`Cash Flow - ${rs}${cuit ? ' (CUIT ' + cuit + ')' : ''}`],
      [`Período: ${desde} al ${hasta}${incluirProy ? ' · incluye proyectado' : ''}`],
      [],
      [`Total ingresos:  $ ${Number(kpis.total_ingresos_real || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`],
      [`Total egresos:   $ ${Number(kpis.total_egresos_real  || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`],
      [`Saldo período:   $ ${Number(kpis.saldo_periodo_real  || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`],
    ];
    if (incluirProy) {
      aoa.push([`Saldo final proyectado:  $ ${Number(kpis.saldo_final_proyectado || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`]);
    }
    aoa.push([]);
    aoa.push([modo === 'mes' ? 'Mes' : 'Fecha', 'Compras', 'Sueldos', 'Cheques', 'Otros', 'Total', 'Saldo acum.', 'Clase']);
    filasArr.forEach((r) => {
      aoa.push([
        modo === 'mes'
          ? String(r.ym || String(r.fecha || '').slice(0, 7))
          : String(r.fecha || '').slice(0, 10),
        Number(r.compras  || 0),
        Number(r.sueldos  || 0),
        Number(r.cheques  || 0),
        Number(r.otros    || 0),
        Number(r.total_dia       || 0),
        Number(r.saldo_acumulado || 0),
        r.clase || 'real',
      ]);
    });

    /* Total al pie */
    if (filasArr.length > 0) {
      const lastSaldo = Number(filasArr[filasArr.length - 1].saldo_acumulado || 0);
      aoa.push([]);
      aoa.push(['', '', '', '', '', 'SALDO FINAL:', lastSaldo, '']);
    }

    const ws = window.XLSX.utils.aoa_to_sheet(aoa);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, `Cash Flow ${(desde || '').slice(0, 7) || ''}`.slice(0, 31));
    const fechaHoy = new Date().toISOString().slice(0, 10);
    const fname = `cash_flow_${desde}_${hasta}_${fechaHoy}.xlsx`.replace(/--+/g, '-');
    window.XLSX.writeFile(wb, fname);
  }

  /* Agrupa filas diarias por mes (YYYY-MM) para vista Mes en frontend. */
  function groupRowsByMonth(filas) {
    if (!Array.isArray(filas) || filas.length === 0) return [];
    const map = new Map();
    filas.forEach(r => {
      const ym = String(r.fecha || '').slice(0, 7);
      if (!ym) return;
      const acc = map.get(ym) || {
        fecha: `${ym}-01`,
        ym,
        compras: 0, sueldos: 0, cheques: 0, otros: 0,
        total_dia: 0, saldo_acumulado: 0,
        clase: r.clase,
      };
      acc.compras   += Number(r.compras   || 0);
      acc.sueldos   += Number(r.sueldos   || 0);
      acc.cheques   += Number(r.cheques   || 0);
      acc.otros     += Number(r.otros     || 0);
      acc.total_dia += Number(r.total_dia || 0);
      /* saldo_acumulado en mes = último valor del mes (el último día) */
      acc.saldo_acumulado = Number(r.saldo_acumulado || 0);
      map.set(ym, acc);
    });
    return Array.from(map.values()).sort((a, b) => a.ym.localeCompare(b.ym));
  }

  /* ────────────────────────────────────────────────────────────────
     Fase 8 — Cierres contables (S2.19 + S2.20)
     ──────────────────────────────────────────────────────────────── */

  async function listCierres(year, tipo) {
    const { data, error } = await supa.rpc('rpc_admin_get_cierres', {
      p_year: year || null,
      p_tipo: tipo || null,
    });
    if (error) throw new Error(error.message || 'No se pudo cargar cierres');
    return data || [];
  }

  async function previewCierre(tipo, desde, hasta) {
    const { data, error } = await supa.rpc('rpc_admin_preview_cierre', {
      p_tipo:  tipo,
      p_desde: desde,
      p_hasta: hasta,
    });
    if (error) throw new Error(error.message || 'No se pudo calcular preview');
    return data;
  }

  async function crearCierre(payload) {
    const { data, error } = await supa.rpc('rpc_admin_crear_cierre', { p_payload: payload });
    if (error) throw new Error(error.message || 'No se pudo crear el cierre');
    return data;
  }

  async function reabrirCierre(payload) {
    const { data, error } = await supa.rpc('rpc_admin_reabrir_cierre', { p_payload: payload });
    if (error) throw new Error(error.message || 'No se pudo reabrir el cierre');
    return data;
  }

  async function validarPeriodoApertura(fecha) {
    const { data, error } = await supa.rpc('rpc_admin_validar_periodo_apertura', { p_fecha: fecha });
    if (error) throw new Error(error.message || 'No se pudo validar período');
    return data;
  }

  async function getSaldoHistorico() {
    const { data, error } = await supa.rpc('rpc_admin_get_saldo_historico');
    if (error) throw new Error(error.message || 'No se pudo cargar saldo histórico');
    return data || [];
  }

  /* Detecta si un rango de fechas corresponde a un mes completo,
     año completo, o personalizado. Útil para habilitar el botón
     "Cerrar período" en cash-flow.jsx. */
  function detectarTipoPeriodo(desde, hasta) {
    if (!desde || !hasta) return 'personalizado';
    const d = String(desde).slice(0, 10);
    const h = String(hasta).slice(0, 10);
    /* Mes completo: desde = YYYY-MM-01, hasta = último día del mismo mes */
    const md = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const mh = h.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!md || !mh) return 'personalizado';
    if (md[1] === mh[1] && md[2] === mh[2] && md[3] === '01') {
      const lastDay = new Date(Number(md[1]), Number(md[2]), 0).getDate();
      if (Number(mh[3]) === lastDay) return 'mensual';
    }
    /* Año completo: 01/01 al 31/12 del mismo año */
    if (md[1] === mh[1] && md[2] === '01' && md[3] === '01' && mh[2] === '12' && mh[3] === '31') {
      return 'anual';
    }
    return 'personalizado';
  }

  /* Fase 8 etapa 3 — Reportes de cierre */
  async function getReporteCierre(cierreId) {
    const { data, error } = await supa.rpc('rpc_admin_get_reporte_cierre', { p_cierre_id: cierreId });
    if (error) throw new Error(error.message || 'No se pudo cargar el reporte');
    return data;
  }

  /* Calcula variación % con 4 edge cases. */
  function calcularVariacion(actual, anterior) {
    const a = Number(actual)   || 0;
    const p = Number(anterior) || 0;
    if (p === 0 && a === 0) return { texto: '0%',     clase: 'neutro' };
    if (p === 0 && a !== 0) return { texto: 'Nuevo',  clase: 'nuevo'  };
    if (p !== 0 && a === 0) return { texto: '-100%',  clase: 'baja'   };
    const pct = ((a - p) / Math.abs(p)) * 100;
    return {
      texto: `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`,
      clase: pct > 0 ? 'suba' : (pct < 0 ? 'baja' : 'neutro'),
    };
  }

  /* Helper: extrae el monto de una categoría del snapshot_jsonb del cierre. */
  function getCategoriaBreakdown(cierre, categoria) {
    if (!cierre || !cierre.snapshot_jsonb) return 0;
    const bd = cierre.snapshot_jsonb.breakdown_categorias || {};
    if (categoria === 'cheques') {
      const inn  = Number(bd.cheques_cobrados_in)  || 0;
      const outt = Number(bd.cheques_cobrados_out) || 0;
      return inn - outt;
    }
    if (categoria === 'otros') {
      const ing  = Number(bd.otros_ingreso) || 0;
      const egr  = Number(bd.otros_egreso)  || 0;
      return ing - egr;
    }
    return Number(bd[categoria]) || 0;
  }

  /* Export Excel del reporte de cierre. */
  function exportCierreXlsx(args) {
    if (typeof window.XLSX === 'undefined') {
      throw new Error('SheetJS (XLSX) no esta cargado.');
    }
    const { reporte, companySettings } = args || {};
    if (!reporte || !reporte.cierre) throw new Error('Reporte requerido');

    const c  = reporte.cierre;
    const ant = reporte.periodo_anterior || null;
    const snap = c.snapshot_jsonb || {};
    const topProv  = Array.isArray(snap.top_proveedores) ? snap.top_proveedores : [];
    const topEmpl  = Array.isArray(snap.top_empleados)   ? snap.top_empleados   : [];

    const rs   = (companySettings && companySettings.razon_social) || 'MACARIO';
    const cuit = (companySettings && companySettings.cuit) || '';
    const dom  = (companySettings && companySettings.domicilio) || '';

    const aoa = [
      [`${rs}${cuit ? ' · CUIT ' + cuit : ''}`],
      [dom],
      [],
      [`Reporte de cierre ${c.tipo === 'mensual' ? 'mensual' : 'anual'}`],
      [`Período: ${String(c.periodo_desde).slice(0,10)} al ${String(c.periodo_hasta).slice(0,10)}`],
      [`Estado: ${c.estado}`],
      [],
      ['KPI', 'Monto'],
      ['Saldo apertura', Number(c.saldo_apertura) || 0],
      ['Total ingresos', Number(c.total_ingresos) || 0],
      ['Total egresos',  Number(c.total_egresos)  || 0],
      ['Saldo cierre',   Number(c.saldo_cierre)   || 0],
      ['Saldo acumulado histórico', Number(c.saldo_acumulado_historico) || 0],
      ['# Movimientos',  Number(c.count_movimientos) || 0],
      [],
    ];

    /* Comparativa */
    if (ant) {
      aoa.push(['Comparativa con período anterior']);
      aoa.push(['Categoría', 'Actual', 'Anterior', 'Variación']);
      ['compras','sueldos','cheques','otros'].forEach(cat => {
        const act = getCategoriaBreakdown(c,   cat);
        const ant_ = getCategoriaBreakdown(ant, cat);
        const v = calcularVariacion(act, ant_);
        aoa.push([cat[0].toUpperCase()+cat.slice(1), act, ant_, v.texto]);
      });
      aoa.push([]);
    } else {
      aoa.push(['Sin período anterior para comparar']);
      aoa.push([]);
    }

    /* Top proveedores */
    aoa.push(['Top proveedores']);
    if (topProv.length === 0) {
      aoa.push(['(sin movimientos de compras en el período)']);
    } else {
      aoa.push(['Proveedor', 'Monto']);
      topProv.forEach(p => {
        aoa.push([p.nombre || 'Sin proveedor', Number(p.total) || 0]);
      });
    }
    aoa.push([]);

    /* Top empleados */
    aoa.push(['Top empleados']);
    if (topEmpl.length === 0) {
      aoa.push(['(sin recibos en el período)']);
    } else {
      aoa.push(['Empleado', 'Monto']);
      topEmpl.forEach(e => {
        aoa.push([e.nombre || '—', Number(e.total) || 0]);
      });
    }
    aoa.push([]);
    aoa.push([`Generado: ${new Date().toLocaleString('es-AR')}`]);

    const ws = window.XLSX.utils.aoa_to_sheet(aoa);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, `Cierre ${String(c.periodo_desde).slice(0,7)}`.slice(0,31));
    const fechaHoy = new Date().toISOString().slice(0,10);
    const fname = `cierre_${c.tipo}_${String(c.periodo_desde).slice(0,10)}_${String(c.periodo_hasta).slice(0,10)}_${fechaHoy}.xlsx`;
    window.XLSX.writeFile(wb, fname);
  }

  /* Dado un array de cierres y un rango de fechas, encuentra si hay
     algún cierre con estado='cerrado' que solape con el rango. */
  function cierreActivoEnRango(cierres, desde, hasta) {
    if (!Array.isArray(cierres) || !desde || !hasta) return null;
    const dStart = String(desde).slice(0, 10);
    const dEnd   = String(hasta).slice(0, 10);
    for (const c of cierres) {
      if (c.estado !== 'cerrado') continue;
      const cs = String(c.periodo_desde).slice(0, 10);
      const ce = String(c.periodo_hasta).slice(0, 10);
      if (cs <= dEnd && ce >= dStart) return c;
    }
    return null;
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
    // S2.23 mayoristas
    loadMayoristas,
    createPedidoMayorista,
    updateEstadoPedidoMayorista,
    listPedidosMayoristas,
    deleteMayorista,
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
    // S2.2
    getSupplierHistorial,
    ARG_PROVINCIAS,
    // S2.3
    getComprobanteSignedUrl,
    deleteComprobante,
    EXPENSE_CATEGORIA_LABELS,
    // S2.4 bulk import
    SUPPLIER_HEADER_SYNONYMS,
    normalizeHeader,
    normalizeCuit,
    parseSupplierSpreadsheet,
    validateSupplierRow,
    checkCuitsExist,
    bulkCreateSuppliers,
    bulkUpdateSuppliers,
    downloadSuppliersTemplate,
    generateBulkReportXlsx,
    // S2.5 bulk import checks
    CHECK_ISSUED_HEADER_SYNONYMS,
    CHECK_RECEIVED_HEADER_SYNONYMS,
    CHECK_STATE_MAP,
    normalizeCheckNumber,
    normalizeCheckEstado,
    parseChecksSpreadsheet,
    validateCheckRow,
    checkChecksIssuedExist,
    checkChecksReceivedExist,
    resolveEntitiesByCuit,
    bulkCreateChecksIssued,
    bulkUpdateChecksIssued,
    bulkCreateChecksReceived,
    bulkUpdateChecksReceived,
    downloadChecksIssuedTemplate,
    downloadChecksReceivedTemplate,
    generateChecksBulkReportXlsx,
    // S2.11 employees
    loadEmployees,
    createEmployee,
    updateEmployee,
    deleteEmployee,
    // S2.24 horas extras
    listHorasExtras,
    createHoraExtra,
    deleteHoraExtra,
    reporteHsExtras,
    updateValorHoraEmpleado,
    getEmployeeHistorial,
    checkCuilsExist,
    bulkCreateEmployees,
    bulkUpdateEmployees,
    normalizeCuil,
    parseEmployeesSpreadsheet,
    validateEmployeeRow,
    downloadEmployeesTemplate,
    generateEmployeesBulkReportXlsx,
    EMPLOYEE_HEADER_SYNONYMS,
    MODALIDAD_OPTIONS,
    TIPO_CONTRATACION_OPTIONS,
    FORMA_COBRO_OPTIONS,
    // S2.12 recibos + company_settings
    RECIBO_TIPO_OPTIONS,
    RECIBO_ESTADO_OPTIONS,
    getCompanySettings,
    updateCompanySettings,
    loadRecibos,
    getRecibo,
    createRecibo,
    updateRecibo,
    anularRecibo,
    deleteRecibo,
    listRecibosByPeriod,
    calcValorDia,
    calcSubtotal,
    calcTotal,
    // S2.15 histórico + reportes
    getHistorialEmpleado,
    getReportesGlobal,
    getRecibosDetalleEmpleado,
    exportHistorialEmpleadoXlsx,
    exportReportesGlobalXlsx,
    getMonthName,
    MES_NAMES_ES,
    REPORTES_GLOBAL_DETAIL_CAP,
    // S2.16 cash flow
    CASH_FLOW_TIPOS,
    CASH_FLOW_CATEGORIAS_SUGERIDAS,
    getCashFlow,
    listCashFlowManual,
    createCashFlowManual,
    updateCashFlowManual,
    deleteCashFlowManual,
    formatMoneyES,
    getSaldoColor,
    groupRowsByMonth,
    exportCashFlowXlsx,
    // Fase 8 cierres
    listCierres,
    previewCierre,
    crearCierre,
    reabrirCierre,
    validarPeriodoApertura,
    getSaldoHistorico,
    detectarTipoPeriodo,
    cierreActivoEnRango,
    // Fase 8 etapa 3 — reportes
    getReporteCierre,
    calcularVariacion,
    getCategoriaBreakdown,
    exportCierreXlsx,
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
