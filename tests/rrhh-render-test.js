/* ══ RRHH 0178 — render real de las tres pantallas tocadas ═══════════════
   node tests/rrhh-render-test.js "<ROOT>" web|mobile

   jsdom + React 18.3.1 + Babel (mismas versiones que el browser). Monta
   los .jsx REALES con el admin-data.js REAL; solo se reemplazan las
   llamadas a la base (loadEmployees, updateRecibo, …) por espías.

   1  EmployeesTab: "Exportar empleados" respeta filtros; sin filtros baja
      a todos (activos + inactivos); lista vacía avisa y no baja nada;
      "Importar masivo" sigue abriendo su modal.
   2  ReportesTab: con mes → reporte mensual (año y mes elegidos); vacío
      avisa; "Mes: todos" → el Excel anual de siempre, sin cambios.
   3  ReciboModal:
      - sin tocar el valor del día, lo que se manda es BYTE A BYTE lo que
        mandaba la versión anterior (cfcc340), en edición y en alta;
      - tocarlo recalcula los items que lo usan y el total, y viaja;
      - inválido bloquea el guardado; anulado y base sin 0178 → bloqueado;
      - si la base no devuelve valor_dia, se avisa que no se guardó.
   ══════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { JSDOM } = require('jsdom');
const Babel = require('@babel/standalone');
const React = require('react');

const ROOT = process.argv[2] || path.join(__dirname, '..');
const VARIANT = process.argv[3] || 'web';
const DIR = VARIANT === 'web' ? 'web' : 'mobile';
const COMP = path.join(ROOT, DIR, 'components');
const XLSX = require(path.join(ROOT, 'scripts', 'node_modules', 'xlsx'));
/* Última versión antes de la 0178: contra ella se compara lo que se manda. */
const ANTES = 'cfcc340';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
const W = dom.window;
global.window = W;
global.document = W.document;
global.navigator = W.navigator;
global.MouseEvent = W.MouseEvent;
global.IS_REACT_ACT_ENVIRONMENT = true;
const ReactDOMClient = require('react-dom/client');
const { act } = require('react');

/* React avisa por console.error cosas de act(): no ensuciar la salida. */
const errOrig = console.error;
console.error = (...a) => { if (/not wrapped in act|ReactDOMTestUtils/.test(String(a[0]))) return; errOrig(...a); };

let pass = 0, fail = 0;
function check(nombre, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + nombre); }
  else { fail++; console.log('  FAIL ' + nombre + (extra !== undefined ? '\n         → ' + extra : '')); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ── globals que en el browser ponen data.js, shared.jsx y la app ───── */
const dataSrc = fs.readFileSync(path.join(COMP, 'data.js'), 'utf8');
const ini = dataSrc.indexOf('window.sinTildes = function'), fin = dataSrc.indexOf('const MAKARIO_BRAND_NAME');
new Function('window', dataSrc.slice(ini, fin))(W);   /* buscaEn real */

W.SUPA = { from() { throw new Error('el test no debe tocar la base'); }, rpc() { throw new Error('el test no debe tocar la base'); } };
W.XLSX = XLSX;
W.MOCK = { users: [] };
new Function('window', fs.readFileSync(path.join(COMP, 'admin', 'admin-data.js'), 'utf8'))(W);
new Function('window', fs.readFileSync(path.join(COMP, 'admin', 'recibo-pdf-generator.js'), 'utf8'))(W);
const REAL = Object.assign({}, W.ADMIN_DATA);

const toasts = [];
W.__toast = {
  error: (m) => toasts.push(['error', m]), success: (m) => toasts.push(['success', m]), info: (m) => toasts.push(['info', m]),
};
const ultimoToast = () => toasts[toasts.length - 1] || [];
W.Modal = ({ title, footer, children }) =>
  React.createElement('div', { 'data-modal': title }, children, React.createElement('div', { 'data-footer': '' }, footer));
W.BulkImportEmployeesModal = () => React.createElement('div', { 'data-bulk': '1' }, 'bulk');
W.EmployeeModal = () => null;
W.ConfirmModal = () => null;

const preamble = `
  const { useState, useEffect, useRef, useMemo, useCallback } = React;
  const Icon = ({ n }) => React.createElement('i', { 'data-icon': n });
  const useToast = () => window.__toast;
`;
function cargar(src, nombre) {
  const code = Babel.transform(preamble + src, { presets: ['react'], filename: nombre }).code;
  new Function('React', 'window', 'document', code)(React, W, W.document);
}
cargar(fs.readFileSync(path.join(COMP, 'admin', 'employees-tab.jsx'), 'utf8'), 'employees-tab.jsx');
cargar(fs.readFileSync(path.join(COMP, 'admin', 'reportes-tab.jsx'), 'utf8'), 'reportes-tab.jsx');
cargar(fs.readFileSync(path.join(COMP, 'admin', 'recibo-modal.jsx'), 'utf8'), 'recibo-modal.jsx');
const ReciboModalNuevo = W.ReciboModal;
let ReciboModalViejo = null;
const viejo = spawnSync('git', ['show', `${ANTES}:${DIR}/components/admin/recibo-modal.jsx`], { cwd: ROOT, encoding: 'utf8' });
if (viejo.status === 0 && viejo.stdout) {
  cargar(viejo.stdout, 'recibo-modal-cfcc340.jsx');
  ReciboModalViejo = W.ReciboModal;
  W.ReciboModal = ReciboModalNuevo;
}

/* ── helpers de DOM ─────────────────────────────────────────────────── */
const container = W.document.getElementById('root');
let root = null;
const flush = async () => { await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); }); };
async function montar(el) {
  if (root) await act(async () => root.unmount());
  container.innerHTML = '';
  root = ReactDOMClient.createRoot(container);
  await act(async () => { root.render(el); });
  await flush();
}
const $$ = (sel) => Array.from(container.querySelectorAll(sel));
const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const boton = (t) => $$('button').find(b => txt(b) === t || txt(b).endsWith(' ' + t) || txt(b) === t.trim());
async function click(el) { await act(async () => { el.dispatchEvent(new W.MouseEvent('click', { bubbles: true })); }); await flush(); }
async function escribir(el, v) {
  const proto = el.tagName === 'SELECT' ? W.HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? W.HTMLTextAreaElement.prototype : W.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new W.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
  await flush();
}
/* label tal cual o con el " *" de obligatorio */
const grupo = (label) => $$('.field-group').find(x => txt(x.querySelector('.field-label')).replace(/ \*$/, '') === label);
const campo = (label) => { const g = grupo(label); return g ? g.querySelector('input, select, textarea') : null; };
const filasItems = () => $$('.recibo-items-table tbody tr').filter(tr => tr.querySelectorAll('input').length).map(tr => {
  const inp = tr.querySelectorAll('input');
  return { concepto: inp[0].value, cantidad: inp[1].value, vu: inp[2].value, sub: txt(tr.querySelectorAll('td')[3]) };
});
const totalTxt = () => txt(container.querySelector('.recibo-total-row strong'));
const fmt = W.ReciboPDF.fmtMoney;

console.log(`\n═══ ${VARIANT.toUpperCase()} · RRHH 0178 render\n`);

(async () => {
/* ══ 1 · EmployeesTab ════════════════════════════════════════════════ */
console.log('[1 · Exportar empleados]');
const EMP = [
  { id: 'e1', dni: '20.111.111', nombre: 'Ana Núñez', categoria: 'Operario', modalidad: 'full_time', activo: true, sueldo_bruto_base: 450000 },
  { id: 'e2', dni: '20.222.222', nombre: 'Beto Gómez', categoria: 'Administración', modalidad: 'part_time', activo: true, sueldo_bruto_base: 300000 },
  { id: 'e3', dni: '20.333.333', nombre: 'Carla Peña', categoria: 'Operario', modalidad: 'full_time', activo: true, sueldo_bruto_base: 450000 },
  { id: 'e4', dni: '20.444.444', nombre: 'Dario Inactivo', categoria: 'Operario', modalidad: 'full_time', activo: false, sueldo_bruto_base: 1 },
];
const cargas = [], exportados = [];
Object.assign(W.ADMIN_DATA, REAL, {
  loadEmployees: async (o) => { cargas.push(o); return o && o.includeInactive ? EMP.slice() : EMP.filter(e => e.activo); },
  exportEmployeesXlsx: (lista) => { exportados.push(lista.map(e => e.id)); return { filename: 'x.xlsx', filas: lista.length, inactivos: lista.filter(e => e.activo === false).length }; },
});
await montar(React.createElement(W.EmployeesTab));
const bExp = boton('Exportar empleados'), bImp = boton('Importar masivo');
check('botón "Exportar empleados" al lado de "Importar masivo"', bExp && bImp && bImp.nextElementSibling === bExp);
check('la tabla muestra solo activos (tilde "Mostrar inactivos" apagado)', $$('table.data-table tbody tr').length === 3);
cargas.length = 0;
await click(bExp);
check('sin filtros → vuelve a leer con includeInactive:true y baja a los 4 (con el inactivo)',
  eq(cargas, [{ includeInactive: true }]) && eq(exportados.pop(), ['e1', 'e2', 'e3', 'e4']), JSON.stringify(cargas));
check('… y avisa cuántos inactivos van', /4 empleados \(1 inactivo\)/.test(ultimoToast()[1] || ''), ultimoToast()[1]);
await escribir(container.querySelector('.admin-search-input'), 'nunez');
cargas.length = 0;
await click(boton('Exportar empleados'));
check('con búsqueda ("nunez" sin tilde) → baja exactamente lo filtrado, sin volver a leer', eq(exportados.pop(), ['e1']) && cargas.length === 0);
check('… y el aviso dice que van los filtros', /con los filtros aplicados/.test(ultimoToast()[1] || ''));
await escribir(container.querySelector('.admin-search-input'), '');
const selCat = $$('select.filter-select').find(s => Array.from(s.options).some(o => o.value === 'Operario'));
await escribir(selCat, 'Operario');
await click(boton('Exportar empleados'));
check('con categoría → solo esa categoría', eq(exportados.pop(), ['e1', 'e3']));
const selMod = $$('select.filter-select').find(s => Array.from(s.options).some(o => o.value === 'part_time'));
await escribir(selMod, 'part_time');
const nExp = exportados.length;
await click(boton('Exportar empleados'));
check('filtros sin resultados → avisa y no baja nada', exportados.length === nExp && ultimoToast()[0] === 'error' && /Ningún empleado coincide/.test(ultimoToast()[1]));
await click(boton('Importar masivo'));
check('"Importar masivo" sigue abriendo su modal', $$('[data-bulk]').length === 1);

/* ══ 2 · ReportesTab ═════════════════════════════════════════════════ */
console.log('\n[2 · Reportes]');
const llamadasMes = [], llamadasAnual = [];
let respMes = { vacio: false, filas: 3, filename: 'recibos_x.xlsx' };
Object.assign(W.ADMIN_DATA, REAL, {
  getReportesGlobal: async () => ({ kpis: {}, tabla: [{ employee_id: 'e1', nombre: 'Ana', count_recibos_year: 2, total_year: 10, total_month: 0 }] }),
  getRecibosDetalleEmpleado: async () => [],
  exportRecibosMesXlsx: async (y, m) => { llamadasMes.push([y, m]); if (respMes instanceof Error) throw respMes; return respMes; },
  exportReportesGlobalXlsx: (p) => { llamadasAnual.push(p); return { truncated: false }; },
});
await montar(React.createElement(W.ReportesTab));
const anio = new Date().getFullYear();
const bRep = () => $$('button.btn-primary')[0];
check('con "Mes: todos" el botón es "Exportar Excel"', /Exportar Excel$/.test(txt(bRep())));
await click(bRep());
check('"Mes: todos" → el Excel anual de siempre (no el mensual)', llamadasAnual.length === 1 && llamadasMes.length === 0 && ultimoToast()[1] === 'Excel descargado');
const [selAnio, selMes] = $$('select.filter-select');
await escribir(selMes, '3');
check('con mes elegido el botón dice "Exportar recibos del mes"', /Exportar recibos del mes$/.test(txt(bRep())));
await click(bRep());
check('mes → exportRecibosMesXlsx(año, 3) como número', eq(llamadasMes.pop(), [anio, 3]) && llamadasAnual.length === 1);
check('… aviso con cantidad y mes', ultimoToast()[0] === 'success' && ultimoToast()[1] === `Excel descargado: 3 recibos de ${REAL.getMonthName(3)} ${anio}`, ultimoToast()[1]);
await escribir(selAnio, String(anio - 1));
await escribir(selMes, '12');
respMes = { vacio: true, filas: 0 };
await click(bRep());
check('año y mes elegidos llegan tal cual (diciembre del año anterior)', eq(llamadasMes.pop(), [anio - 1, 12]));
check('mes vacío → mensaje claro y nada descargado', ultimoToast()[0] === 'error' && /No hay recibos emitidos .* No se descargó nada\./.test(ultimoToast()[1]), ultimoToast()[1]);
respMes = new Error('permission denied for table recibos');
await click(bRep());
check('error de la base → se muestra, el botón vuelve a habilitarse', ultimoToast()[1] === 'permission denied for table recibos' && !bRep().disabled);

/* ══ 3 · ReciboModal ═════════════════════════════════════════════════ */
console.log('\n[3 · Modal del recibo]');
let enviados = [];
let respuesta = (p) => ({ recibo_id: p.id || 'nuevo', updated: true, total: Number(p.total), valor_dia: p.valor_dia != null ? Number(p.valor_dia) : null });
let sondas = 0, sondaResp = true;
const EMPS_ALTA = [{ id: 'e1', dni: '20.111.111', nombre: 'Ana Núñez', categoria: 'Operario', fecha_ingreso: '2024-03-01', sueldo_bruto_base: 450000, activo: true }];
Object.assign(W.ADMIN_DATA, REAL, {
  updateRecibo: async (p) => { enviados.push(['update', JSON.parse(JSON.stringify(p))]); return respuesta(p); },
  createRecibo: async (p) => { enviados.push(['create', JSON.parse(JSON.stringify(p))]); return respuesta(p); },
  reciboTieneValorDia: async () => { sondas++; return sondaResp; },
  loadEmployees: async () => EMPS_ALTA.slice(),
});
const RECIBO = {
  id: 'rec-1', estado: 'emitido', tipo: 'quincena', employee_id: 'e1', empleado_nombre: 'Ana Núñez', empleado_dni: '20.111.111',
  periodo_desde: '2026-03-01', periodo_hasta: '2026-03-15', fecha_pago: '2026-03-16', sueldo_basico: 450000, valor_dia: null,
  items: [{ concepto: 'Días trabajados', cantidad: 15, valor_unitario: 15000, subtotal: 225000, tipo: 'haber' },
          { concepto: 'Presentismo', cantidad: 1, valor_unitario: 5000, subtotal: 5000, tipo: 'haber' },
          { concepto: 'Adelanto', cantidad: 1, valor_unitario: -20000, subtotal: -20000, tipo: 'descuento' }],
  total: 210000, notas: 'nota',
};
const abrir = async (Cmp, props) => { enviados = []; toasts.length = 0; await montar(React.createElement(Cmp, Object.assign({ onClose() {}, onSuccess() {} }, props))); };
const guardar = async () => { await click(boton('Guardar')); };

/* R2: sin tocar el valor del día, igual que antes */
if (ReciboModalViejo) {
  await abrir(ReciboModalViejo, { mode: 'edit', initial: RECIBO });
  await guardar();
  const antes = enviados[0];
  await abrir(ReciboModalNuevo, { mode: 'edit', initial: RECIBO });
  check('edición: el campo arranca en sueldo/30 (15000.00)', campo('Valor del día').value === '15000.00');
  await guardar();
  const ahora = enviados[0];
  check(`edición sin tocar el valor del día → payload IDÉNTICO al de ${ANTES} (sin clave valor_dia)`,
    antes && ahora && eq(antes, ahora) && !('valor_dia' in ahora[1]), `${JSON.stringify(antes)}\n         ≠ ${JSON.stringify(ahora)}`);
  check('… y avisa "Recibo actualizado"', ultimoToast()[1] === 'Recibo actualizado');

  /* alta: mismo recorrido en las dos versiones */
  const alta = async (Cmp) => {
    await abrir(Cmp, { mode: 'create' });
    await escribir(container.querySelector('select.field-input'), 'e1');
    await click($$('input[type=radio]').find(r => r.value === 'quincena'));
    await escribir(campo('Desde'), '2026-03-01');
    await escribir(campo('Hasta'), '2026-03-15');
    await escribir(campo('Fecha de pago'), '2026-03-16');
    await guardar();
    return enviados[0];
  };
  const altaAntes = await alta(ReciboModalViejo);
  const altaAhora = await alta(ReciboModalNuevo);
  check(`alta sin tocar el valor del día → payload IDÉNTICO al de ${ANTES}`, altaAntes && eq(altaAntes, altaAhora) && !('valor_dia' in altaAhora[1]),
    `${JSON.stringify(altaAntes)}\n         ≠ ${JSON.stringify(altaAhora)}`);
} else {
  check(`(se necesita git para comparar con ${ANTES})`, false, viejo.stderr);
}

/* editar el valor del día */
await abrir(ReciboModalNuevo, { mode: 'edit', initial: RECIBO });
await escribir(campo('Valor del día'), '16000');
let it = filasItems();
check('cambiar a 16000 recalcula SOLO el item que usaba el valor del día', it[0].vu === '16000.00' && it[0].sub === fmt(240000)
  && it[1].vu === '5000' && it[1].sub === fmt(5000) && it[2].sub === fmt(-20000), JSON.stringify(it));
check('… y el total (240000 + 5000 − 20000)', totalTxt() === fmt(225000), totalTxt());
check('… el aviso dice que es solo para este recibo', /solo para este recibo/.test(txt(grupo('Valor del día'))));
await guardar();
let [op, p] = enviados[0] || [];
check('guardar manda valor_dia como texto ("16000"), id, items y total recalculados',
  op === 'update' && p.valor_dia === '16000' && p.id === 'rec-1' && p.total === '225000'
  && eq(p.items[0], { concepto: 'Días trabajados', cantidad: 15, valor_unitario: 16000, subtotal: 240000, tipo: 'haber' })
  && eq(p.items[1], { concepto: 'Presentismo', cantidad: 1, valor_unitario: 5000, subtotal: 5000, tipo: 'haber' }), JSON.stringify(p));
check('en edición no viajan empleado, tipo, período ni sueldo (inmutables)', !['employee_id', 'tipo', 'periodo_desde', 'periodo_hasta', 'sueldo_basico'].some(k => k in p));
check('respuesta con valor_dia → "Recibo actualizado"', ultimoToast()[0] === 'success');

/* centavos */
await abrir(ReciboModalNuevo, { mode: 'edit', initial: RECIBO });
await escribir(campo('Valor del día'), '15123.45');
it = filasItems();
check('con centavos: 15 × 15123,45 = 226851,75', it[0].vu === '15123.45' && it[0].sub === fmt(226851.75) && totalTxt() === fmt(211851.75), `${it[0].sub} · ${totalTxt()}`);

/* inválidos */
for (const malo of ['0', '-5', '1500.505', '']) {
  await abrir(ReciboModalNuevo, { mode: 'edit', initial: RECIBO });
  await escribir(campo('Valor del día'), malo);
  const err = txt(grupo('Valor del día').querySelector('.field-error'));
  await guardar();
  check(`valor "${malo}" → error visible y NO se guarda`, enviados.length === 0 && err.length > 5 && /Revisá los campos/.test(ultimoToast()[1] || ''), `${err} · ${enviados.length}`);
  check(`valor "${malo}" → los items no cambian`, filasItems()[0].vu === '15000' && totalTxt() === fmt(210000));
}

/* el recibo ya tenía su valor del día */
const PROPIO = Object.assign({}, RECIBO, { valor_dia: 16000, items: [Object.assign({}, RECIBO.items[0], { valor_unitario: 16000, subtotal: 240000 })], total: 240000 });
await abrir(ReciboModalNuevo, { mode: 'edit', initial: PROPIO });
check('recibo con valor propio → el campo muestra 16000.00, no sueldo/30', campo('Valor del día').value === '16000.00');
await guardar();
check('… guardar sin tocarlo NO manda valor_dia (la base conserva el que tiene)', enviados[0] && !('valor_dia' in enviados[0][1]));
await abrir(ReciboModalNuevo, { mode: 'edit', initial: PROPIO });
await escribir(campo('Valor del día'), '17000');
check('… y cambiarlo arrastra al item que lo usaba', filasItems()[0].vu === '17000.00' && totalTxt() === fmt(255000));

/* medio centavo: sueldo/30 = 0,715, el item se guardó con 0.71 (toFixed) */
const MEDIO = Object.assign({}, RECIBO, { sueldo_basico: 21.45, items: [{ concepto: 'Días trabajados', cantidad: 15, valor_unitario: 0.71, subtotal: 10.725, tipo: 'haber' }], total: 10.73 });
await abrir(ReciboModalNuevo, { mode: 'edit', initial: MEDIO });
await escribir(campo('Valor del día'), '1');
check('sueldo/30 en medio centavo (21,45/30): el item guardado con 0,71 sigue al valor del día', filasItems()[0].vu === '1.00' && totalTxt() === fmt(15),
  JSON.stringify(filasItems()));

/* un item con valor propio deja de seguir al valor del día */
await abrir(ReciboModalNuevo, { mode: 'edit', initial: RECIBO });
const vuInput = $$('.recibo-items-table tbody tr')[0].querySelectorAll('input')[2];
await escribir(vuInput, '14000');
await escribir(campo('Valor del día'), '16000');
check('si se tipeó el valor unitario del item, el valor del día ya no lo pisa', filasItems()[0].vu === '14000');

/* anulado */
sondas = 0;
await abrir(ReciboModalNuevo, { mode: 'edit', initial: Object.assign({}, RECIBO, { estado: 'anulado' }) });
check('anulado → valor del día de solo lectura y sin botones de guardar', campo('Valor del día').readOnly && !boton('Guardar') && !boton('Guardar + PDF'));
check('anulado → no consulta la base', sondas === 0);

/* base sin la 0178 */
const SIN_COL = Object.assign({}, RECIBO); delete SIN_COL.valor_dia;
sondaResp = false; sondas = 0;
await abrir(ReciboModalNuevo, { mode: 'edit', initial: SIN_COL });
check('recibo leído sin la columna → pregunta a la base una vez', sondas === 1);
check('base sin 0178 → campo bloqueado y explica por qué', campo('Valor del día').readOnly && /falta aplicar la migración 0178/.test(txt(grupo('Valor del día'))));
check('… pero el resto del recibo se edita igual', !!boton('Guardar') && !campo('Fecha de pago').readOnly);
sondaResp = null;
await abrir(ReciboModalNuevo, { mode: 'edit', initial: SIN_COL });
check('sonda sin respuesta clara (red/permiso) → no bloquea', !campo('Valor del día').readOnly);
/* … y si igual la base no lo guardó, se dice */
respuesta = (pl) => ({ recibo_id: pl.id, updated: true, total: Number(pl.total) });
await escribir(campo('Valor del día'), '16000');
await guardar();
check('la base no devuelve valor_dia → aviso "el valor del día NO" (no un falso "actualizado")',
  ultimoToast()[0] === 'error' && /el valor del día NO: falta aplicar la migración 0178/.test(ultimoToast()[1]), ultimoToast()[1]);
await abrir(ReciboModalNuevo, { mode: 'edit', initial: SIN_COL });
await guardar();
check('… sin tocarlo, con la base vieja, todo como antes ("Recibo actualizado")', ultimoToast()[1] === 'Recibo actualizado');
sondaResp = true;
respuesta = (pl) => ({ recibo_id: pl.id || 'nuevo', total: Number(pl.total), valor_dia: pl.valor_dia != null ? Number(pl.valor_dia) : null });

/* alta con valor del día */
await abrir(ReciboModalNuevo, { mode: 'create' });
await escribir(container.querySelector('select.field-input'), 'e1');
/* "sueldo" ya viene marcado y no precarga (así era antes): se elige quincena */
await click($$('input[type=radio]').find(r => r.value === 'quincena'));
check('alta: precarga 15 días a sueldo/30', eq(filasItems()[0], { concepto: 'Días trabajados', cantidad: '15', vu: '15000.00', sub: fmt(225000) }));
await escribir(campo('Valor del día'), '16000');
await click(boton('+ Insertar día como item'));
it = filasItems();
check('alta: cambiarlo recalcula la precarga y "Insertar día" usa el nuevo valor', it[0].vu === '16000.00' && it[0].sub === fmt(240000) && it[1].vu === '16000.00' && totalTxt() === fmt(256000),
  JSON.stringify(it));
await escribir(campo('Desde'), '2026-03-01');
await escribir(campo('Hasta'), '2026-03-15');
await escribir(campo('Fecha de pago'), '2026-03-16');
await guardar();
[op, p] = enviados[0] || [];
check('alta: manda valor_dia "16000" con el empleado, tipo y período', op === 'create' && p.valor_dia === '16000' && p.employee_id === 'e1'
  && p.tipo === 'quincena' && p.total === '256000', JSON.stringify(p));

await act(async () => root.unmount());
console.log(`\n${pass} ok · ${fail} fail`);
process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); console.log(`\n${pass} ok · ${fail + 1} fail`); process.exit(1); });
