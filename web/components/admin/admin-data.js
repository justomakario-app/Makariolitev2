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

  const COLS_CUSTOMER = 'id, nombre, cuit, email, telefono, notas, activo, created_at, created_by';
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
