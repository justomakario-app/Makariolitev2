/* ══ RRHH 0178 — exportar empleados · reporte mensual de recibos · valor del día ══
   node tests/rrhh-export-test.js "<ROOT>" web|mobile

   Carga los archivos REALES (admin-data.js, recibo-pdf-generator.js,
   xlsx.js) con un window falso: SUPA es un query builder en memoria que
   filtra/ordena/pagina como PostgREST y anota cada llamada; XLSX es el
   SheetJS 0.18.5 de scripts/node_modules (la misma versión que el
   browser) con writeFile interceptado. Cada archivo generado se escribe y
   se vuelve a leer con SheetJS: se controla lo que queda en el .xlsx, no
   el objeto en memoria.

   A  migración 0178 (diferencia exacta contra 0076/0064, orden de chequeos)
   B  exportar empleados (columnas, formatos, ida y vuelta por el importador)
   C  reporte mensual (filtro en la base, bordes de mes, totales, paginado)
   D  valor del día (validación, fallback, PDF, sonda de la columna)
   E  seguridad (sin consultas con entrada inválida, sin logs, sin uploads)
   F  paridad web/mobile y ?v=
   ══════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.argv[2] || path.join(__dirname, '..');
const VARIANT = process.argv[3] || 'web';
const BASE = path.join(ROOT, VARIANT === 'web' ? 'web' : 'mobile', 'components');
const XLSX = require(path.join(ROOT, 'scripts', 'node_modules', 'xlsx'));
const CFB = require(path.join(ROOT, 'scripts', 'node_modules', 'cfb'));

const leer = (p) => fs.readFileSync(p, 'utf8');
const SRC_ADMIN = leer(path.join(BASE, 'admin', 'admin-data.js'));
const SRC_PDF = leer(path.join(BASE, 'admin', 'recibo-pdf-generator.js'));
const SRC_XLSXJS = leer(path.join(BASE, 'xlsx.js'));

/* ── sonda de zona horaria (proceso hijo, ver C.9) ─────────────────── */
if (process.argv[4] === '--tz-probe') {
  const w = { SUPA: { from() { throw new Error('no'); } }, XLSX, console };
  new Function('window', SRC_ADMIN)(w);
  const A = w.ADMIN_DATA;
  const { ws } = A.buildRecibosMesSheet([{ id: 'abc', empleado_nombre: 'X', tipo: 'sueldo',
    periodo_desde: '2026-03-01', periodo_hasta: '2026-03-31', fecha_pago: '2026-04-01',
    sueldo_basico: 300000, total: 1, items: [] }], { XLSX });
  const emp = A.buildEmployeesExportSheet([{ dni: '1', nombre: 'X', fecha_ingreso: '2026-01-01' }], { XLSX });
  console.log(JSON.stringify({
    off: new Date(2026, 2, 1).getTimezoneOffset(),
    e2: ws.E2 && ws.E2.v, f2: ws.F2 && ws.F2.v, g2: ws.G2 && ws.G2.v, j2: emp.J2 && emp.J2.v,
  }));
  process.exit(0);
}

let pass = 0, fail = 0;
function check(nombre, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + nombre); }
  else { fail++; console.log('  FAIL ' + nombre + (extra !== undefined ? '\n         → ' + extra : '')); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ══ window falso ═══════════════════════════════════════════════════ */
function makeSupa(db) {
  const calls = [];
  const supa = {
    calls,
    from(table) {
      const q = { table, filters: [], orders: [], range: null, count: null, cols: null, limit: null };
      calls.push(q);
      const exec = () => {
        if (db.throwNet) throw new Error('Failed to fetch');
        if (db.error) return { data: null, error: db.error, count: null };
        let rows = (db[table] || []).filter(r => q.filters.every(([op, c, v]) =>
          op === 'eq' ? r[c] === v : op === 'gte' ? r[c] >= v : op === 'lte' ? r[c] <= v : r[c] < v));
        rows = rows.slice().sort((a, b) => {
          for (const [c, asc] of q.orders) {
            const x = a[c] == null ? '' : a[c], y = b[c] == null ? '' : b[c];
            if (x < y) return asc ? -1 : 1;
            if (x > y) return asc ? 1 : -1;
          }
          return 0;
        });
        const total = rows.length + (db.countDelta || 0);
        if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
        if (q.limit != null) rows = rows.slice(0, q.limit);
        return { data: rows, error: null, count: q.count === 'exact' ? total : null };
      };
      const b = {
        select(cols, opts) { q.cols = cols; q.count = opts && opts.count; return b; },
        eq(c, v) { q.filters.push(['eq', c, v]); return b; },
        gte(c, v) { q.filters.push(['gte', c, v]); return b; },
        lt(c, v) { q.filters.push(['lt', c, v]); return b; },
        lte(c, v) { q.filters.push(['lte', c, v]); return b; },
        order(c, o) { q.orders.push([c, !(o && o.ascending === false)]); return b; },
        range(a, z) { q.range = [a, z]; return b; },
        limit(n) { q.limit = n; return b; },
        then(res, rej) { return new Promise(r => r(exec())).then(res, rej); },
      };
      return b;
    },
    rpc(name, args) { calls.push({ rpc: name, args }); return Promise.resolve({ data: null, error: null }); },
  };
  return supa;
}

const writes = [];
const XLw = Object.assign({}, XLSX, { writeFile: (wb, fn) => { writes.push({ wb, fn }); } });
const logs = [];
const fakeConsole = { log: (...a) => logs.push(a), error: (...a) => logs.push(a), warn: (...a) => logs.push(a), info: (...a) => logs.push(a) };
const DB = {};
const supa = makeSupa(DB);
const W = {
  SUPA: supa, XLSX: XLw, console: fakeConsole,
  MOCK: { users: [{ id: 'u-owner', name: 'Dueño Núñez' }] },
};
new Function('window', SRC_XLSXJS)(W);
new Function('window', 'console', SRC_ADMIN)(W, fakeConsole);
const A = W.ADMIN_DATA;

/* Escribe el libro a .xlsx de verdad y lo vuelve a leer. */
const aBuffer = (wb) => XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
const releer = (wb) => XLSX.read(aBuffer(wb), { type: 'buffer', cellFormula: true, cellNF: true });
const sheetXml = (wb) => {
  const z = CFB.read(aBuffer(wb), { type: 'buffer' });
  const f = CFB.find(z, '/xl/worksheets/sheet1.xml');
  if (!f) throw new Error('no se encontró sheet1.xml dentro del .xlsx');
  return Buffer.from(f.content).toString('utf8');
};

console.log(`\n═══ ${VARIANT.toUpperCase()} · RRHH 0178\n`);

(async () => {
/* ══ A · migración 0178 ══════════════════════════════════════════════ */
console.log('[A · migración 0178]');
const MIG = path.join(ROOT, 'supabase', 'migrations');
const sql78 = leer(path.join(MIG, '0178_recibos_valor_dia.sql'));
const sql76 = leer(path.join(MIG, '0076_rrhh_cuil_a_dni.sql'));
const sql64 = leer(path.join(MIG, '0064_admin_periodo_cerrado_check.sql'));
const sinComent = sql78.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');

function cuerpo(sql, nombre) {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${nombre}(`);
  if (i < 0) return null;
  const m = /AS\s+(\$[A-Za-z_]*\$)/.exec(sql.slice(i));
  const tag = m[1];
  const abre = i + m.index + m[0].length;
  const cierra = sql.indexOf(tag, abre);
  return sql.slice(i, cierra + tag.length + 1);
}
/* diff por líneas (LCS) */
function diffLineas(a, b) {
  const A_ = a.split('\n').map(s => s.trimEnd()), B_ = b.split('\n').map(s => s.trimEnd());
  const n = A_.length, m = B_.length;
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    L[i][j] = A_[i] === B_[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const quitadas = [], agregadas = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A_[i] === B_[j]) { i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) quitadas.push(A_[i++]);
    else agregadas.push(B_[j++]);
  }
  while (i < n) quitadas.push(A_[i++]);
  while (j < m) agregadas.push(B_[j++]);
  return { quitadas, agregadas };
}
function agregadoValido(lineas) {
  /* las líneas agregadas: el bloque 0178 completo, o líneas que nombran valor_dia/0178 */
  let dentro = false;
  return lineas.filter(l => {
    if (/-- 0178: valor del dia propio/.test(l)) { dentro = true; return false; }
    if (/-- \/0178/.test(l)) { dentro = false; return false; }
    if (dentro) return false;
    /* el RETURN de update se partió en dos líneas para sumar valor_dia */
    return !(/valor_dia|0178/.test(l) || l.trim() === '' || /^\s*RETURN jsonb_build_object\(.*,$/.test(l));
  });
}

check('envuelta en begin; … commit;', /^begin;$/m.test(sql78) && /^commit;$/m.test(sql78));
check('ADD COLUMN IF NOT EXISTS valor_dia numeric(14,2), nullable y SIN default',
  /ADD COLUMN IF NOT EXISTS valor_dia numeric\(14,2\);/.test(sinComent) && !/valor_dia[^;\n]*DEFAULT/i.test(sinComent) && !/valor_dia[^;\n]*NOT NULL/i.test(sinComent));
check('CHECK (valor_dia IS NULL OR valor_dia > 0): las filas existentes (NULL) lo cumplen',
  /CHECK \(valor_dia IS NULL OR valor_dia > 0\)/.test(sinComent));
check('no hay backfill: el único UPDATE de recibos es el de rpc_admin_update_recibo',
  (sinComent.match(/UPDATE public\.recibos/g) || []).length === 1 && !/UPDATE public\.recibos SET valor_dia/.test(sinComent));
check('no toca employees ni otras tablas (sin ALTER/UPDATE/DELETE/INSERT fuera de recibos)',
  !/ALTER TABLE public\.(?!recibos)/.test(sinComent) && !/(UPDATE|DELETE FROM|INSERT INTO) public\.(?!recibos)/.test(sinComent));
check('rollback documentado (DROP CONSTRAINT + DROP COLUMN + re-emitir 0076/0064)',
  /DROP CONSTRAINT IF EXISTS recibos_valor_dia_positivo/.test(sql78) && /DROP COLUMN IF EXISTS valor_dia/.test(sql78) && /0076/.test(sql78) && /0064/.test(sql78));
check('REVOKE anon/public + GRANT authenticated en las dos RPC',
  /REVOKE EXECUTE ON FUNCTION public\.rpc_admin_create_recibo\(jsonb\) FROM anon, public;/.test(sql78)
  && /REVOKE EXECUTE ON FUNCTION public\.rpc_admin_update_recibo\(jsonb\) FROM anon, public;/.test(sql78)
  && /GRANT\s+EXECUTE ON FUNCTION public\.rpc_admin_create_recibo\(jsonb\) TO authenticated;/.test(sql78)
  && /GRANT\s+EXECUTE ON FUNCTION public\.rpc_admin_update_recibo\(jsonb\) TO authenticated;/.test(sql78));

for (const [fn, viejoSql, viejoNom, quitadasOk] of [
  ['rpc_admin_create_recibo', sql76, '0076', [/created_by\) VALUES \($/, /auth\.uid\(\)$/, /^\s*RETURN jsonb_build_object/]],
  ['rpc_admin_update_recibo', sql64, '0064', [/^\s*RETURN jsonb_build_object/]],
]) {
  const nuevo = cuerpo(sql78, fn), viejo = cuerpo(viejoSql, fn);
  check(`${fn}: se encontró en 0178 y en ${viejoNom}`, !!nuevo && !!viejo);
  if (!nuevo || !viejo) continue;
  const { quitadas, agregadas } = diffLineas(viejo, nuevo);
  const raras = agregadoValido(agregadas);
  check(`${fn}: toda línea agregada es del bloque 0178 o nombra valor_dia`, raras.length === 0, raras.join(' ¶ '));
  const quitRaras = quitadas.filter(l => !quitadasOk.some(rx => rx.test(l)));
  check(`${fn}: solo cambió ${quitadasOk.length} línea(s) de ${viejoNom} (columnas del INSERT / RETURN)`,
    quitRaras.length === 0 && quitadas.length <= quitadasOk.length, quitadas.join(' ¶ '));
  const bloque = nuevo.indexOf('-- 0178: valor del dia propio');
  const ultimo = (rx) => { let k = -1, m; const r = new RegExp(rx.source, 'g'); while ((m = r.exec(nuevo))) k = m.index; return k; };
  check(`${fn}: la validación de valor_dia va DESPUÉS de auth (42501) y del permiso owner/admin`,
    bloque > ultimo(/HINT='auth'/) && bloque > ultimo(/HINT='not_authorized'/));
  check(`${fn}: … y después del chequeo de período cerrado`, bloque > ultimo(/HINT='periodo_cerrado'/));
  if (fn === 'rpc_admin_update_recibo') {
    check(`${fn}: … y después de rechazar anulados`, bloque > ultimo(/HINT='recibo_anulado'/));
    check(`${fn}: clave ausente conserva lo guardado (COALESCE(v_valor_dia, valor_dia))`,
      /valor_dia = COALESCE\(v_valor_dia, valor_dia\)/.test(nuevo));
  } else {
    check(`${fn}: escribe v_valor_dia (NULL si no vino la clave)`, /auth\.uid\(\), v_valor_dia/.test(nuevo));
  }
  check(`${fn}: SECURITY DEFINER + search_path fijo`, /SECURITY DEFINER/.test(nuevo) && /SET search_path/.test(nuevo));
  check(`${fn}: devuelve valor_dia (el front detecta si se guardó)`, /'valor_dia',/.test(nuevo));
  check(`${fn}: errores 22023 con HINT valor_dia_invalido (5 casos)`,
    (nuevo.match(/HINT='valor_dia_invalido'/g) || []).length === 4 && /ERRCODE='22023'/.test(nuevo));
}
check('la regex del backend y la del front son la misma',
  sql78.includes("!~ '^-?[0-9]+(\\.[0-9]+)?$'") && SRC_ADMIN.includes('/^-?[0-9]+(\\.[0-9]+)?$/'));
const trg = leer(path.join(MIG, '0060_admin_recibos_y_company_settings.sql'));
const aud = leer(path.join(MIG, '0053_admin_audit_log.sql'));
check('auditoría: recibos_audit_log_trg AFTER INSERT OR UPDATE OR DELETE → trg_audit_log (fila entera antes/después)',
  /CREATE TRIGGER recibos_audit_log_trg\s+AFTER INSERT OR UPDATE OR DELETE ON public\.recibos/.test(trg)
  && /'before', to_jsonb\(OLD\)/.test(aud) && /'after',\s+to_jsonb\(NEW\)/.test(aud));
const otrasMig = fs.readdirSync(MIG).filter(f => /^\d{4}_/.test(f) && f > '0178' && f !== '0178_recibos_valor_dia.sql');
check('ninguna migración posterior re-emite las dos RPC', otrasMig.every(f => !/FUNCTION public\.rpc_admin_(create|update)_recibo/.test(leer(path.join(MIG, f)))), otrasMig.join(','));

/* ══ B · exportar empleados ══════════════════════════════════════════ */
console.log('\n[B · exportar empleados]');
writes.length = 0;
A.downloadEmployeesTemplate();
const plantilla = writes[0] && XLSX.utils.sheet_to_json(writes[0].wb.Sheets[writes[0].wb.SheetNames[0]], { header: 1, defval: '' })[0];
const cols = A.EMPLOYEE_EXPORT_COLS.map(c => c[0]);
check('la plantilla tiene 22 columnas', Array.isArray(plantilla) && plantilla.length === 22, plantilla && plantilla.length);
check('las 22 primeras del export = plantilla, mismo nombre y orden', eq(cols.slice(0, 22), plantilla), cols.slice(0, 22).join(','));
const sinonimos = new Set([].concat(...Object.values(A.EMPLOYEE_HEADER_SYNONYMS)));
const extras = cols.slice(22);
check('las extra van al final y ninguna es sinónimo del importador (se ignoran al reimportar)',
  extras.length > 0 && extras.every(h => !sinonimos.has(A.normalizeHeader(h))), extras.join(','));
check('no se inventó legajo ni CUIL', !cols.some(h => /legajo|cuil/i.test(h)));

const EMPS = [
  { id: '11111111-aaaa-bbbb-cccc-000000000001', dni: '12.345.678', nombre: 'Ñandú Pérez Güemes', fecha_nacimiento: '1985-03-15',
    email: 'nandu@example.com', telefono: '011-4444-5555', direccion: 'Av. Maipú 1234 2°B', ciudad: 'Florida', provincia: 'Buenos Aires',
    codigo_postal: '01602', fecha_ingreso: '2024-03-01', categoria: 'Operario', modalidad: 'full_time',
    tipo_contratacion: 'relacion_dependencia', lugar_trabajo: 'Taller principal', convenio: 'UOM',
    sueldo_bruto_base: 450000.5, dias_vacaciones_anuales: 14, banco: 'Galicia', cbu: '0001234567890123456789',
    alias_cbu: 'nandu.perez.gal', forma_cobro: 'transferencia', notas: 'Señalización — año 2024',
    activo: true, valor_hora_extra: 2812.5, created_by: 'u-owner', created_at: '2024-03-01T12:30:00Z', updated_at: '2026-01-02T03:04:05Z' },
  { id: '11111111-aaaa-bbbb-cccc-000000000002', dni: '1.234.567', nombre: 'José Ñúñez', fecha_nacimiento: '2000-12-31',
    email: '', telefono: '0221 15-123-4567', direccion: '', ciudad: 'La Plata', provincia: 'Buenos Aires',
    codigo_postal: '', fecha_ingreso: '2026-02-28', categoria: 'Administración', modalidad: 'part_time',
    tipo_contratacion: 'monotributo', lugar_trabajo: '', convenio: '', sueldo_bruto_base: 300000,
    dias_vacaciones_anuales: null, banco: '', cbu: '', alias_cbu: '', forma_cobro: 'efectivo', notas: '',
    activo: false, valor_hora_extra: null, created_by: 'u-desconocido', created_at: '2026-02-28T23:30:00Z', updated_at: null },
  /* Contenido que Excel podría tomar como fórmula */
  { id: '11111111-aaaa-bbbb-cccc-000000000003', dni: '30.123.456', nombre: '=1+1', fecha_nacimiento: null,
    email: '', telefono: '+54 9 11 5555-5555', direccion: '-2+3', ciudad: '@SUM(A1)', provincia: 'Córdoba',
    codigo_postal: '', fecha_ingreso: null, categoria: '=HYPERLINK("http://x.invalid","clic")', modalidad: '',
    tipo_contratacion: '', lugar_trabajo: '', convenio: '', sueldo_bruto_base: null, dias_vacaciones_anuales: null,
    banco: '', cbu: '', alias_cbu: '', forma_cobro: '', notas: '=cmd|\' /C calc\'!A0', activo: true },
];
writes.length = 0;
const r = A.exportEmployeesXlsx(EMPS);
const hoy = new Date();
const hoyIso = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
check('nombre de archivo empleados_AAAA-MM-DD.xlsx (fecha local)', r.filename === `empleados_${hoyIso}.xlsx` && writes[0].fn === r.filename, r.filename);
check('una sola hoja "Empleados"', eq(writes[0].wb.SheetNames, ['Empleados']));
check('devuelve filas e inactivos (para el aviso)', r.filas === 3 && r.inactivos === 1);
const wbE = releer(writes[0].wb);
const wsE = wbE.Sheets.Empleados;
const aoaE = XLSX.utils.sheet_to_json(wsE, { header: 1, defval: '', raw: false });
const col = (h) => cols.indexOf(h);
const celda = (fila, h) => wsE[XLSX.utils.encode_cell({ r: fila, c: col(h) })];
check('fila 1 = encabezados (sin banda de marca: el importador lee la fila 1)', eq(aoaE[0], cols));
check('una fila por empleado', aoaE.length === 4, aoaE.length);
check('ñ y tildes intactas', aoaE[1][col('nombre')] === 'Ñandú Pérez Güemes' && aoaE[2][col('nombre')] === 'José Ñúñez'
  && aoaE[1][col('notas')] === 'Señalización — año 2024' && aoaE[3][col('provincia')] === 'Córdoba');
for (const h of ['dni', 'telefono', 'codigo_postal', 'cbu', 'alias_cbu']) {
  const c = celda(1, h);
  check(`${h} es texto (t:s, formato @)`, c && c.t === 's' && c.z === '@', JSON.stringify(c));
}
check('CBU de 22 dígitos con ceros adelante, sin notación científica', celda(1, 'cbu').v === '0001234567890123456789' && aoaE[1][col('cbu')] === '0001234567890123456789');
check('CP con cero adelante', aoaE[1][col('codigo_postal')] === '01602');
check('DNI de 7 dígitos tal cual', aoaE[2][col('dni')] === '1.234.567');
check('fechas: número de serie con formato dd/mm/yyyy → se ven 15/03/1985', celda(1, 'fecha_nacimiento').t === 'n'
  && aoaE[1][col('fecha_nacimiento')] === '15/03/1985' && aoaE[1][col('fecha_ingreso')] === '01/03/2024' && aoaE[2][col('fecha_nacimiento')] === '31/12/2000');
check('fecha vacía → celda vacía', aoaE[3][col('fecha_nacimiento')] === '' && aoaE[3][col('fecha_ingreso')] === '');
check('estado_empleado activo / inactivo', aoaE[1][col('estado_empleado')] === 'activo' && aoaE[2][col('estado_empleado')] === 'inactivo');
check('creado_por resuelve el nombre; uuid desconocido queda vacío (no se muestra el uuid)',
  aoaE[1][col('creado_por')] === 'Dueño Núñez' && aoaE[2][col('creado_por')] === '');
check('fecha_alta_sistema dd/mm/yyyy hh:mm', /^\d{2}\/\d{2}\/2024 \d{2}:\d{2}$/.test(aoaE[1][col('fecha_alta_sistema')]), aoaE[1][col('fecha_alta_sistema')]);
check('sueldo como texto con coma decimal (450000,5) y entero sin coma (300000)',
  celda(1, 'sueldo_bruto_base').t === 's' && aoaE[1][col('sueldo_bruto_base')] === '450000,5' && aoaE[2][col('sueldo_bruto_base')] === '300000');
check('valor_hora_extra número', celda(1, 'valor_hora_extra').t === 'n' && celda(1, 'valor_hora_extra').v === 2812.5);
const xmlE = sheetXml(writes[0].wb);
check('inyección de fórmulas: ninguna celda tiene fórmula (=, +, -, @ quedan como texto)',
  xmlE.includes('<sheetData>') && !/<f[ >]/.test(xmlE) &&Object.keys(wsE).filter(k => k[0] !== '!').every(k => !wsE[k].f));
check('… y el texto llega literal', aoaE[3][col('nombre')] === '=1+1' && aoaE[3][col('telefono')] === '+54 9 11 5555-5555'
  && aoaE[3][col('direccion')] === '-2+3' && aoaE[3][col('ciudad')] === '@SUM(A1)' && celda(3, 'categoria').t === 's');
let tiro = null;
try { A.exportEmployeesXlsx([]); } catch (e) { tiro = e.message; }
check('lista vacía → error, no baja archivo', !!tiro);

/* ida y vuelta por el importador real (sin tocarlo) */
const buf = aBuffer(writes[0].wb);
const filas = await A.parseEmployeesSpreadsheet({ arrayBuffer: async () => buf });
const norm = filas.map(f => A.validateEmployeeRow(f));
check('reimportar: el importador lee las 3 filas', norm.length === 3, norm.length);
const n0 = norm[0].normalized, n1 = norm[1].normalized;
check('reimportar: fila 1 válida', norm[0].isValid, norm[0].errors.join('; '));
const camposOk = ['nombre', 'email', 'telefono', 'direccion', 'ciudad', 'provincia', 'codigo_postal', 'categoria', 'modalidad',
  'tipo_contratacion', 'lugar_trabajo', 'convenio', 'banco', 'cbu', 'alias_cbu', 'forma_cobro', 'notas'];
const difs = camposOk.filter(k => n0[k] !== (EMPS[0][k] || ''));
check('reimportar: los 17 campos de texto vuelven idénticos', difs.length === 0, difs.map(k => `${k}: ${n0[k]} ≠ ${EMPS[0][k]}`).join('; '));
check('reimportar: DNI, fechas y vacaciones', n0.dni === '12.345.678' && n0.fecha_nacimiento === '1985-03-15'
  && n0.fecha_ingreso === '2024-03-01' && n0.dias_vacaciones_anuales === 14 && n1.dni === '1.234.567' && n1.fecha_ingreso === '2026-02-28');
check('reimportar: sueldo con centavos vuelve exacto (450000.5) y entero (300000)', n0.sueldo_bruto_base === 450000.5 && n1.sueldo_bruto_base === 300000,
  `${n0.sueldo_bruto_base} / ${n1.sueldo_bruto_base}`);
/* Por qué el sueldo no va como número: lo que haría el importador */
const wsNum = { A1: { t: 's', v: 'dni' }, B1: { t: 's', v: 'nombre' }, C1: { t: 's', v: 'sueldo_bruto_base' },
  A2: { t: 's', v: '12.345.678' }, B2: { t: 's', v: 'X' }, C2: { t: 'n', v: 450000.5 }, '!ref': 'A1:C2' };
const wbNum = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wbNum, wsNum, 'E');
const bufNum = aBuffer(wbNum);
const comoNumero = A.validateEmployeeRow((await A.parseEmployeesSpreadsheet({ arrayBuffer: async () => bufNum }))[0]).normalized.sueldo_bruto_base;
check('(control) como número, el importador lo cargaría ×10 → por eso va como texto', comoNumero === 4500005, comoNumero);

/* ══ C · reporte mensual de recibos ═════════════════════════════════ */
console.log('\n[C · reporte mensual de recibos]');
let seq = 0;
const rec = (o) => Object.assign({ id: `r${String(++seq).padStart(4, '0')}-0000-0000-0000-000000000000`, estado: 'emitido', tipo: 'sueldo',
  empleado_nombre: 'Ana', empleado_dni: '20.000.001', empleado_categoria: 'Operario', sueldo_basico: 450000,
  periodo_hasta: o.periodo_desde, fecha_pago: o.periodo_desde, items: [], total: 0 }, o);
DB.recibos = [
  rec({ empleado_nombre: 'Ñandú Pérez', empleado_dni: '12.345.678', tipo: 'quincena', periodo_desde: '2026-03-01', periodo_hasta: '2026-03-15',
        fecha_pago: '2026-03-16', sueldo_basico: 450000, valor_dia: null, total: 220000,
        items: [{ concepto: 'Días trabajados', cantidad: 15, valor_unitario: 15000, subtotal: 225000, tipo: 'haber' },
                { concepto: 'Presentismo', cantidad: 1, valor_unitario: 5000, subtotal: 5000, tipo: 'haber' },
                { concepto: 'Adelanto', cantidad: 1, valor_unitario: -10000, subtotal: -10000, tipo: 'descuento' }] }),
  rec({ empleado_nombre: 'Ñandú Pérez', empleado_dni: '12.345.678', tipo: 'quincena', periodo_desde: '2026-03-16', periodo_hasta: '2026-03-31',
        fecha_pago: '2026-04-03', sueldo_basico: 450000, valor_dia: 16000, total: 245000,
        items: [{ concepto: 'Días trabajados', cantidad: 15, valor_unitario: 16000, subtotal: 240000, tipo: 'haber' },
                { concepto: '  presentismo ', cantidad: 1, valor_unitario: 5000, subtotal: 5000, tipo: 'haber' }] }),
  rec({ empleado_nombre: 'Beto Álvarez', empleado_dni: '30.000.002', periodo_desde: '2026-03-31', periodo_hasta: '2026-03-31',
        sueldo_basico: 100000, total: 1.01,
        /* 1.005 * 100 = 100.49999999999999 en binario: Math.round solo daría 1.00 */
        items: [{ concepto: 'Días trabajados', cantidad: 0.5, valor_unitario: 2.01, subtotal: 1.005, tipo: 'haber' }] }),
  rec({ empleado_nombre: 'Anulado', periodo_desde: '2026-03-10', estado: 'anulado', total: 999,
        items: [{ concepto: 'Días trabajados', cantidad: 1, valor_unitario: 999, subtotal: 999, tipo: 'haber' }] }),
  rec({ empleado_nombre: 'Abril', periodo_desde: '2026-04-01', total: 1 }),
  rec({ empleado_nombre: 'Febrero', periodo_desde: '2026-02-28', total: 1 }),
  rec({ empleado_nombre: 'Bisiesto', periodo_desde: '2024-02-29', total: 1 }),
  rec({ empleado_nombre: 'NoBisiesto', periodo_desde: '2025-02-28', total: 1 }),
  rec({ empleado_nombre: 'Marzo25', periodo_desde: '2025-03-01', total: 1 }),
  rec({ empleado_nombre: 'Abril30', periodo_desde: '2026-04-30', total: 1 }),
  rec({ empleado_nombre: 'Mayo1', periodo_desde: '2026-05-01', total: 1 }),
  rec({ empleado_nombre: 'Dic31', periodo_desde: '2026-12-31', total: 1 }),
  rec({ empleado_nombre: 'Ene1', periodo_desde: '2027-01-01', total: 1 }),
];
writes.length = 0; supa.calls.length = 0;
const rm = await A.exportRecibosMesXlsx(2026, 3);
const q0 = supa.calls[0];
check('filtra la base: estado=emitido, periodo_desde >= 2026-03-01 y < 2026-04-01',
  q0 && q0.table === 'recibos' && eq(q0.filters, [['eq', 'estado', 'emitido'], ['gte', 'periodo_desde', '2026-03-01'], ['lt', 'periodo_desde', '2026-04-01']]),
  JSON.stringify(q0 && q0.filters));
check('pide count exacto, orden estable (termina en id) y pagina', q0.count === 'exact' && q0.orders[q0.orders.length - 1][0] === 'id' && eq(q0.range, [0, 999]));
check('archivo recibos_2026-03.xlsx', rm.filename === 'recibos_2026-03.xlsx' && writes.length === 1 && writes[0].fn === 'recibos_2026-03.xlsx');
check('UNA sola hoja', writes[0].wb.SheetNames.length === 1, writes[0].wb.SheetNames.join('|'));
check('nombre de hoja ≤ 31 caracteres', writes[0].wb.SheetNames[0].length <= 31);
const wbR = releer(writes[0].wb);
const wsR = wbR.Sheets[wbR.SheetNames[0]];
const aoaR = XLSX.utils.sheet_to_json(wsR, { header: 1, defval: null, raw: true });
const H = aoaR[0];
const ci = (h) => H.indexOf(h);
check('3 recibos de marzo (el 31/03 entra; anulado, 01/04 y 28/02 no) + fila TOTAL', aoaR.length === 5 && rm.filas === 3, aoaR.length);
check('empleado con dos quincenas → dos filas', aoaR.filter(f => f[0] === 'Ñandú Pérez').length === 2);
check('identificación: Empleado y DNI (no hay legajo ni CUIL en el sistema)', H[0] === 'Empleado' && H[1] === 'DNI' && !H.some(h => /legajo|cuil/i.test(h)));
check('período desde/hasta y fecha de pago', ['Período desde', 'Período hasta', 'Fecha de pago'].every(h => ci(h) >= 0));
check('columnas: días, valor del día, cada concepto, totales y neto',
  ['Días trabajados (cantidad)', 'Valor del día', 'Días trabajados', 'Presentismo', 'Adelanto (descuento)', 'Total haberes', 'Total descuentos', 'Neto'].every(h => ci(h) >= 0), H.join(' | '));
check('"Presentismo" y "  presentismo " son la misma columna', H.filter(h => /presentismo/i.test(h)).length === 1);
check('haberes antes que descuentos', ci('Presentismo') < ci('Adelanto (descuento)'));
const filaDe = (n, desde) => aoaR.find(f => f[0] === n && (!desde || XLSX.SSF.format('yyyy-mm-dd', f[ci('Período desde')]) === desde));
const q1 = filaDe('Ñandú Pérez', '2026-03-01'), q2 = filaDe('Ñandú Pérez', '2026-03-16'), b = filaDe('Beto Álvarez');
check('concepto que el recibo no tiene → celda vacía', q2[ci('Adelanto (descuento)')] === null);
check('valor del día propio (16000) y automático (450000/30 = 15000)', q2[ci('Valor del día')] === 16000 && q1[ci('Valor del día')] === 15000);
check('días trabajados = cantidad del item', q1[ci('Días trabajados (cantidad)')] === 15 && b[ci('Días trabajados (cantidad)')] === 0.5);
check('neto = total guardado del recibo', q1[ci('Neto')] === 220000 && q2[ci('Neto')] === 245000);
check('descuento con el signo con que se guardó', q1[ci('Adelanto (descuento)')] === -10000 && q1[ci('Total descuentos')] === -10000);
check('redondeo como la base y el PDF: 1.005 → 1.01 (no 1.00)', b[ci('Días trabajados')] === 1.01 && b[ci('Total haberes')] === 1.01,
  b[ci('Días trabajados')]);
const tot = aoaR[aoaR.length - 1];
check('fila TOTAL rotulada con la cantidad', tot[0] === 'TOTAL (3 recibos)');
const cent = (x) => Math.round(Number((Math.abs(x) * 100).toPrecision(15))) * Math.sign(x);
const indep = (h) => aoaR.slice(1, -1).reduce((a, f) => a + (f[ci(h)] == null ? 0 : cent(f[ci(h)])), 0) / 100;
for (const h of ['Días trabajados', 'Presentismo', 'Adelanto (descuento)', 'Total haberes', 'Total descuentos', 'Neto', 'Días trabajados (cantidad)']) {
  const c = wsR[XLSX.utils.encode_cell({ r: aoaR.length - 1, c: ci(h) })];
  const L = XLSX.utils.encode_col(ci(h));
  check(`TOTAL "${h}" = suma independiente al centavo y fórmula SUM(${L}2:${L}4)`, c && c.v === indep(h) && c.f === `SUM(${L}2:${L}4)`,
    c && `${c.v} vs ${indep(h)} · f=${c.f}`);
}
check('Neto total = 220000 + 245000 + 1.01', tot[ci('Neto')] === 465001.01, tot[ci('Neto')]);
check('sueldo básico y valor del día NO se suman', tot[ci('Sueldo básico')] === null && tot[ci('Valor del día')] === null);
check('importes con formato #,##0.00', wsR[XLSX.utils.encode_cell({ r: 1, c: ci('Neto') })].z === '#,##0.00');
const aoaRtxt = XLSX.utils.sheet_to_json(wsR, { header: 1, raw: false, defval: '' });
const q1txt = aoaRtxt[aoaR.indexOf(q1)];
check('fechas del reporte dd/mm/yyyy', q1txt[ci('Período desde')] === '01/03/2026' && q1txt[ci('Período hasta')] === '15/03/2026'
  && q1txt[ci('Fecha de pago')] === '16/03/2026', q1txt && q1txt.join('|'));
check('orden: por empleado y, dentro de cada uno, por período', aoaR[1][0] === 'Beto Álvarez' && aoaR.indexOf(q1) < aoaR.indexOf(q2));
check('ñ y tildes en el reporte', aoaR.some(f => f[0] === 'Ñandú Pérez') && aoaR.some(f => f[0] === 'Beto Álvarez') && ci('Categoría') >= 0);
check('inyección: el reporte no tiene más fórmulas que las SUM de la fila TOTAL',
  (sheetXml(writes[0].wb).match(/<f>/g) || []).length === H.filter((h, i) => tot[i] !== null && i > 0).length);

/* mes vacío */
writes.length = 0;
const vacio = await A.exportRecibosMesXlsx(2026, 7);
check('mes sin recibos → { vacio: true } y no se baja archivo', vacio.vacio === true && writes.length === 0);

/* bordes de mes */
const rango = async (y, m) => { const x = await A.loadRecibosMes(y, m); return [x.desde, x.hasta, x.recibos.map(r => r.empleado_nombre)]; };
const [fd, fh, fn] = await rango(2024, 2);
check('febrero bisiesto 2024: 01/02 a < 01/03, el 29/02 entra', fd === '2024-02-01' && fh === '2024-03-01' && eq(fn, ['Bisiesto']));
const [, , fn25] = await rango(2025, 2);
check('febrero 2025 (28 días): el 28/02 entra, el 01/03 no', eq(fn25, ['NoBisiesto']));
const [, , ab] = await rango(2026, 4);
check('abril (30 días): 01/04 y 30/04 entran, 01/05 no', eq(ab.sort(), ['Abril', 'Abril30']));
const [dd, dh, dn] = await rango(2026, 12);
check('diciembre → hasta 2027-01-01: el 31/12 entra, el 01/01 no', dd === '2026-12-01' && dh === '2027-01-01' && eq(dn, ['Dic31']));
const [ed, eh, en] = await rango(2027, 1);
check('enero 2027: 01/01 entra', ed === '2027-01-01' && eh === '2027-02-01' && eq(en, ['Ene1']));
check('acepta mes como texto ("3") igual que número', (await A.loadRecibosMes('2026', '3')).recibos.length === 3);

/* zona horaria: fechas como serie UTC, iguales en cualquier TZ */
const tzs = ['America/Argentina/Buenos_Aires', 'Pacific/Kiritimati', 'Etc/GMT+12', 'UTC'];
const sondas = tzs.map(tz => {
  const o = spawnSync(process.execPath, [__filename, ROOT, VARIANT, '--tz-probe'], { env: Object.assign({}, process.env, { TZ: tz }), encoding: 'utf8' });
  try { return JSON.parse(o.stdout.trim().split('\n').pop()); } catch (_) { return { err: o.stderr || o.stdout }; }
});
const offs = new Set(sondas.map(s => s.off));
check('la sonda corrió con zonas horarias distintas (UTC-3, UTC+14, UTC-12, UTC)', offs.size >= 3, JSON.stringify(sondas));
check('mismo número de serie de fecha en todas las zonas (sin corrimiento de día)',
  sondas.every(s => s.e2 === 46082 && s.f2 === 46112 && s.g2 === 46113 && s.j2 === 46023), JSON.stringify(sondas));

/* paginado */
const muchos = Array.from({ length: 2500 }, (_, i) => rec({ empleado_nombre: `E${String(i).padStart(4, '0')}`, periodo_desde: '2026-06-15', total: 1 }));
const guard = DB.recibos;
DB.recibos = guard.concat(muchos);
supa.calls.length = 0;
const pag = await A.loadRecibosMes(2026, 6);
check('2500 recibos → 3 páginas de 1000 y no se pierde ninguno', pag.recibos.length === 2500 && eq(supa.calls.map(c => c.range), [[0, 999], [1000, 1999], [2000, 2999]]),
  JSON.stringify(supa.calls.map(c => c.range)));
check('sin duplicados entre páginas', new Set(pag.recibos.map(r => r.id)).size === 2500);
DB.countDelta = 1;
let corto = null;
try { await A.loadRecibosMes(2026, 6); } catch (e) { corto = e.message; }
check('si lo leído no coincide con el count → error, no un reporte corto', /Se leyeron 2500 recibos de 2501/.test(corto || ''), corto);
DB.countDelta = 0;
DB.recibos = guard;
DB.error = { message: 'permission denied for table recibos', code: '42501' };
writes.length = 0;
let den = null;
try { await A.exportRecibosMesXlsx(2026, 3); } catch (e) { den = e.message; }
check('sin permiso (RLS) → error visible y ningún archivo', /permission denied/.test(den || '') && writes.length === 0, den);
DB.error = null;

/* ══ D · valor del día ═══════════════════════════════════════════════ */
console.log('\n[D · valor del día]');
const casos = [
  ['1500', true, 1500], ['1500.5', true, 1500.5], ['1500.50', true, 1500.5], ['1500.500', true, 1500.5], ['  12.3 ', true, 12.3],
  ['999999999999.99', true, 999999999999.99], ['0.01', true, 0.01],
  ['1500.505', false], ['0', false], ['0.00', false], ['-5', false], ['abc', false], ['1e3', false], ['1,5', false],
  ['', false], [null, false], ['1000000000000', false], ['12.', false], ['.5', false], ['1 500', false], ['0x10', false],
];
for (const [inp, ok, val] of casos) {
  const p = A.parseValorDia(inp);
  check(`parseValorDia(${JSON.stringify(inp)}) → ${ok ? 'ok ' + val : 'error'}`, p.ok === ok && (!ok || p.valor === val) && (ok || typeof p.error === 'string' && p.error.length > 5),
    JSON.stringify(p));
}
check('valorDiaDeRecibo: propio > 0 gana', A.valorDiaDeRecibo({ valor_dia: '16000.00', sueldo_basico: 450000 }) === 16000);
check('valorDiaDeRecibo: NULL / vacío / ausente → sueldo/30 (lo de siempre)',
  A.valorDiaDeRecibo({ valor_dia: null, sueldo_basico: 450000 }) === 15000 && A.valorDiaDeRecibo({ valor_dia: '', sueldo_basico: 450000 }) === 15000
  && A.valorDiaDeRecibo({ sueldo_basico: 100000 }) === 100000 / 30);
check('valorDiaDeRecibo: sin sueldo → 0', A.valorDiaDeRecibo({ sueldo_basico: 0 }) === 0 && A.valorDiaDeRecibo(null) === 0);

/* sonda de la columna */
supa.calls.length = 0;
check('reciboTieneValorDia: la columna existe → true (select valor_dia limit 1)', (await A.reciboTieneValorDia()) === true
  && supa.calls[0].cols === 'valor_dia' && supa.calls[0].limit === 1);
DB.error = { code: '42703', message: 'column recibos.valor_dia does not exist' };
check('… falta la migración (42703) → false', (await A.reciboTieneValorDia()) === false);
DB.error = { code: 'PGRST301', message: 'JWT expired' };
check('… otro error → null (no bloquea; el aviso post-guardado sigue)', (await A.reciboTieneValorDia()) === null);
DB.error = null; DB.throwNet = true;
check('… sin red → null', (await A.reciboTieneValorDia()) === null);
DB.throwNet = false;

/* PDF */
let docDef = null;
const WP = { pdfMake: { createPdf: (dd) => { docDef = dd; return { open() {}, download() {} }; } } };
new Function('window', SRC_PDF)(WP);
const textoValorDia = () => {
  let out = null;
  const walk = (n) => {
    if (out != null || n == null) return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (typeof n === 'object') {
      if (Array.isArray(n.text) && n.text[0] && n.text[0].text === 'Valor del día: ') { out = n.text[1]; return; }
      Object.values(n).forEach(walk);
    }
  };
  walk(docDef.content);
  return out;
};
const basePdf = { id: 'abcdef12-0000', tipo: 'sueldo', estado: 'emitido', empleado_nombre: 'Ñandú', periodo_desde: '2026-03-01',
  periodo_hasta: '2026-03-31', fecha_pago: '2026-04-01', sueldo_basico: 450000, total: 480000, items: [] };
WP.ReciboPDF.generate(Object.assign({}, basePdf, { valor_dia: 16000 }), {});
check('PDF: imprime el valor del día propio ($ 16.000,00)', textoValorDia() === '$ 16.000,00', textoValorDia());
WP.ReciboPDF.generate(Object.assign({}, basePdf, { valor_dia: null }), {});
check('PDF: sin valor propio → sueldo/30 ($ 15.000,00), como antes', textoValorDia() === '$ 15.000,00', textoValorDia());
WP.ReciboPDF.generate(Object.assign({}, basePdf), {});
check('PDF: recibo leído antes de la migración (sin la clave) → sueldo/30', textoValorDia() === '$ 15.000,00');
const netoReporte = (total) => {
  const { ws } = A.buildRecibosMesSheet([{ id: 'z', empleado_nombre: 'Z', total, items: [] }], { XLSX });
  const fila = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  return fila[1][fila[0].indexOf('Neto')];
};
const pares = [1.005, 0.285, 1.015, 8.345, 2.675, 1234.565].map(x => [x, WP.ReciboPDF.fmtMoney(x), netoReporte(x)]);
check('PDF y reporte redondean igual el medio centavo (1.005, 0.285, 1.015, 8.345, 2.675, 1234.565)',
  pares.every(([, pdf, rep]) => pdf === WP.ReciboPDF.fmtMoney(rep)) && pares[0][2] === 1.01 && pares[1][2] === 0.29, JSON.stringify(pares));

/* ══ E · seguridad ═══════════════════════════════════════════════════ */
console.log('\n[E · seguridad]');
const malos = [['1; drop table recibos', 2026], [0, 2026], [13, 2026], [2026.5, 2026], [NaN, 2026], ['', 2026], [null, 2026],
  ['3 OR 1=1', 2026], ['03abc', 2026], [3, 1999], [3, 2101], [3, '2026; --'], [3, '2026-01']];
for (const [m, y] of malos) {
  supa.calls.length = 0; writes.length = 0;
  let e = null;
  try { await A.exportRecibosMesXlsx(y, m); } catch (er) { e = er.message; }
  check(`mes=${JSON.stringify(m)} año=${JSON.stringify(y)} → rechazado sin consultar la base`, e === 'Elegí un mes y un año válidos.' && supa.calls.length === 0 && writes.length === 0, e);
}
check('ningún console.* durante todo el test (sin datos personales en logs)', logs.length === 0, JSON.stringify(logs).slice(0, 200));
const bloque = (desde, hasta) => SRC_ADMIN.slice(SRC_ADMIN.indexOf(desde), SRC_ADMIN.indexOf(hasta));
const codigoNuevo = bloque('RRHH 0178 — celdas de Excel', 'S2.12 — Recibos de sueldo') + bloque('0178 — El valor del día de UN recibo', 'Validador CUIT formato');
check('el código nuevo no loguea, no sube a storage, no abre URLs', codigoNuevo.length > 2000 && !/console\.|\.storage|createSignedUrl|window\.open|location\.|fetch\(/.test(codigoNuevo));
check('nombres de archivo sin datos personales', /^empleados_\d{4}-\d{2}-\d{2}\.xlsx$/.test(r.filename) && /^recibos_\d{4}-\d{2}\.xlsx$/.test(rm.filename));

/* ══ F · paridad web/mobile y ?v= ════════════════════════════════════ */
console.log('\n[F · paridad web/mobile]');
const ARCH = ['admin/admin-data.js', 'admin/employees-tab.jsx', 'admin/recibo-modal.jsx', 'admin/recibo-pdf-generator.js', 'admin/reportes-tab.jsx'];
for (const a of ARCH) {
  const wv = leer(path.join(ROOT, 'web', 'components', a)), mv = leer(path.join(ROOT, 'mobile', 'components', a));
  check(`${a} idéntico en web y mobile`, wv === mv);
}
const htmlW = leer(path.join(ROOT, 'web', 'Macario Lite.html')), htmlM = leer(path.join(ROOT, 'mobile', 'index.html'));
for (const a of ARCH) {
  const rx = new RegExp(a.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '\\?v=(\\d+)');
  const vw = (htmlW.match(rx) || [])[1], vm = (htmlM.match(rx) || [])[1];
  check(`${a}: mismo ?v= en los dos HTML (${vw})`, vw && vw === vm, `${vw} / ${vm}`);
}

console.log(`\n${pass} ok · ${fail} fail`);
process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); console.log(`\n${pass} ok · ${fail + 1} fail`); process.exit(1); });
