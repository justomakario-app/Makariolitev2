/* ══ Placas — avisar en vez de bloquear, y contar las dos medidas ═══════
   node tests/placas-test.js "<ROOT>" web|mobile

   QUÉ ARREGLA ESTO Y POR QUÉ NECESITA UN TEST
   ───────────────────────────────────────────
   Dos agujeros distintos, los dos de la misma familia: el sistema dice una
   cosa y el galpón hace otra.

   1 · LA LÍNEA ESTABA TRABADA DE PUNTA A PUNTA.
       prod_stock_mp arranca en 0 para las 29 placas y prod_pino_receta está
       vacía. Con mp_consumo_obligatorio=1, cada corte y cada pata reventaban
       con un error de stock. La única salida para cargar placas estaba en
       Configuración → Materia prima, adonde el operario de CNC no entra.
       Resultado: cero filas en toda la producción, no porque nadie trabaje
       sino porque nadie pudo cargar.

       La 0174 lo da vuelta: el corte ENTRA, descuenta lo que hay, y lo que
       faltaba queda anotado como "faltante a reponer" con un aviso. El
       trabajo real nunca se pierde por un número mal cargado.

   2 · LAS PLACAS COMBINADAS TIRABAN EL 65% A LA BASURA.
       Una COM001 da 8 tapas de una medida y 15 de otra en la misma hoja. El
       sistema acreditaba sólo las 8. Las otras 15 se cortaban, existían
       apiladas, y no entraban a ningún lado. Peor: el plan de corte
       RECOMENDABA las combinadas porque ahorran placas — el sistema empujaba
       al operario justo hacia el corte que peor registraba.

   Seis partes:

     A · DATA LAYER — placas() tiene que devolver placas SIEMPRE. La vista
         nueva la aplica el dueño cuando aprieta Deploy; si todavía no está,
         sel() tira y CNC se queda sin una sola placa que elegir. Pantalla
         abierta, cero opciones, ningún error: el bug que este repo persigue.

     B · CNC RENDER — la segunda medida se ve antes de apretar y el número de
         la vista previa es el mismo que devuelve el backend.

     C · AVISOS — el corte entra Y el aviso llega. Un aviso que se descarta
         (como hacía Pino con la respuesta de registrarPino) es un faltante
         que nadie va a reponer nunca.

     D · ENCARGADO — las placas a reponer se ven en el tablero. Una tabla que
         se llena y no se muestra en ninguna pantalla no arregla nada.

     E · ESTÁTICO, las dos plataformas — mobile no puede quedar sin la mitad.

     F · ESTÁTICO, migración 0174 — el backend es la barrera real.
   ═══════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const Babel = require('@babel/standalone');
const React = require('react');

const ROOT = process.argv[2] || path.join(__dirname, '..');
const VARIANT = process.argv[3] || 'web';
const BASE = path.join(ROOT, VARIANT === 'web' ? 'web' : 'mobile', 'components');

let pass = 0, fail = 0;
function check(nombre, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + nombre); }
  else { fail++; console.log('  FAIL ' + nombre + (extra ? '\n         → ' + extra : '')); }
}

console.log(`\n═══ ${VARIANT.toUpperCase()} · placas: avisar en vez de bloquear\n`);

const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.IS_REACT_ACT_ENVIRONMENT = true;

const ReactDOMClient = require('react-dom/client');
const { act } = require('react');

const compilar = (f) => {
  const p = path.join(BASE, f);
  return Babel.transform(fs.readFileSync(p, 'utf8'), { presets: ['react'], filename: p }).code;
};

/* ══ Supabase falso ════════════════════════════════════════════════════
   El query builder de supabase-js encadena y recién se resuelve al await.
   Este lo imita con lo justo: from().select().order() y un then().        */
function fakeSupa(handler) {
  return {
    from(tabla) {
      const q = {
        _cols: null,
        select(cols) { q._cols = cols; return q; },
        order() { return q; },
        eq() { return q; },
        neq() { return q; },
        maybeSingle() { return q; },
        then(res, rej) { return Promise.resolve().then(() => handler(tabla, q._cols)).then(res, rej); },
      };
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  };
}

(async () => {

/* ══ A · DATA LAYER — placas() no se puede quedar vacía ════════════════ */
console.log('[A · data layer — la vista nueva puede no estar aplicada todavía]');

/* lp-data.jsx se evalúa aparte, contra un window de mentira, porque hace
   `window.LP_DATA = window.LP_DATA || (…)` y acá lo queremos crudo. */
const win2 = { SUPA: null };
new Function('window', 'React', 'document', compilar('lp-data.jsx'))(win2, React, dom.window.document);
const DATA = win2.LP_DATA;
check('lp-data.jsx expone LP_DATA', DATA && typeof DATA.placas === 'function');

const PLACA_VISTA = {
  sku: 'COM001', nombre: 'Combinada 18mm', material: 'Melamina', combinada: true,
  pieza_sku: 'TAP001', rendimiento: 8, rendimiento_extra: 15, rendimiento_total: 23,
  extras: [{ pieza_sku: 'TAP009', rendimiento: 15 }],
};

let consultadas = [];
win2.SUPA = fakeSupa((tabla) => {
  consultadas.push(tabla);
  if (tabla === 'prod_v_placa') return { data: [PLACA_VISTA], error: null };
  if (tabla === 'prod_placa') return { data: [{ sku: 'COM001', rendimiento: 8 }], error: null };
  if (tabla === 'prod_v_mp_faltante') return { data: [{ mp_sku: 'MEL18B', faltan: 12 }], error: null };
  return { data: [], error: null };
});

let filas = await DATA.placas();
check('con la vista aplicada, placas() trae las dos medidas',
      filas.length === 1 && filas[0].rendimiento_total === 23 && filas[0].rendimiento_extra === 15,
      JSON.stringify(filas));
check('...y no consulta la tabla vieja al pedo',
      consultadas.indexOf('prod_placa') === -1, consultadas.join(', '));

/* El caso que importa: el dueño todavía no apretó Deploy. */
consultadas = [];
win2.SUPA = fakeSupa((tabla) => {
  consultadas.push(tabla);
  if (tabla === 'prod_v_placa') return { data: null, error: { message: 'relation "prod_v_placa" does not exist' } };
  if (tabla === 'prod_placa') return { data: [{ sku: 'COM001', nombre: 'Combinada 18mm', rendimiento: 8 }], error: null };
  return { data: [], error: null };
});
filas = await DATA.placas();
check('si la vista nueva no existe todavía, CNC igual recibe las placas',
      Array.isArray(filas) && filas.length === 1 && filas[0].sku === 'COM001',
      JSON.stringify(filas));
check('...después de haberla intentado primero',
      consultadas[0] === 'prod_v_placa' && consultadas[1] === 'prod_placa', consultadas.join(', '));

/* Si TAMBIÉN falla la tabla vieja, ahí sí tiene que tirar: eso es un problema
   de verdad (sesión caída, RLS) y taparlo con [] sería mentirle al operario. */
win2.SUPA = fakeSupa(() => ({ data: null, error: { message: 'JWT expired' } }));
let tiro = false;
try { await DATA.placas(); } catch (e) { tiro = /JWT expired/.test(e.message); }
check('si falla todo (sesión caída) avisa, no devuelve una lista vacía silenciosa', tiro);

/* mpFaltantes: al revés. El panel del encargado tiene que abrir igual. */
win2.SUPA = fakeSupa((tabla) => (tabla === 'prod_v_mp_faltante'
  ? { data: null, error: { message: 'relation "prod_v_mp_faltante" does not exist' } }
  : { data: [], error: null }));
check('mpFaltantes() sin la vista devuelve [] y no rompe el panel',
      Array.isArray(await DATA.mpFaltantes()) && (await DATA.mpFaltantes()).length === 0);

win2.SUPA = fakeSupa((tabla) => (tabla === 'prod_v_mp_faltante'
  ? { data: [{ mp_sku: 'MEL18B', nombre: 'Melamina blanca 18', faltan: 12, stock_actual: 0 }], error: null }
  : { data: [], error: null }));
const falt = await DATA.mpFaltantes();
check('mpFaltantes() con la vista trae lo que hay que reponer',
      falt.length === 1 && falt[0].faltan === 12, JSON.stringify(falt));


/* ══ B/C · CNC — la segunda medida y los avisos ════════════════════════ */
console.log('\n[B · CNC render — las dos medidas de una placa combinada]');

const TOASTS = [];
const preamble = `
  const { useState, useEffect, useRef, useMemo, useCallback, createContext, useContext } = React;
  const Icon = ({ n, s, c }) => React.createElement('i', { 'data-icon': n });
  const TOAST = {
    success(m, o) { window.__toasts.push(['success', m, o]); },
    error(m, o)   { window.__toasts.push(['error', m, o]); },
    info(m, o)    { window.__toasts.push(['info', m, o]); },
    warning(m, o) { window.__toasts.push(['warning', m, o]); },
    dismiss() {},
  };
  const useToast = () => TOAST;
`;
dom.window.__toasts = TOASTS;

const llamadas = [];
const AVISOS = [
  'Se cortaron 3 hojas de MEL18B que el sistema no tenia cargadas. Quedan anotadas como faltante a reponer.',
];
dom.window.LP_DATA = {
  subscribe: () => () => {},
  sectorEstado: async () => ({
    mi_sector: 'cnc', jornada_id: 'J1', fecha: '2026-09-09', hay_jornada_demanda: true,
    sectores: [{ sector: 'cnc', abierta: true, turno_id: 'T1', jornada_id: 'J1',
                 abierta_at: new Date(Date.now() - 3600 * 1000).toISOString(),
                 abierta_por_nombre: 'Seba', ultimo_cierre: null }],
  }),
  sectorAbrir: async () => ({ ok: true }),
  sectorCerrar: async () => ({ ok: true }),
  jornadaHoy: async () => ({ jornada_id: 'J1', fecha: '2026-09-09', estado: 'abierta' }),
  placas: async () => [PLACA_VISTA, { sku: 'PLB001', nombre: 'Placa blanca 18', material: 'Melamina', rendimiento: 6 }],
  cortesDia: async () => [],
  resumenDia: async () => [],
  ventasVinculadas: async () => [],
  piezas: async () => [],
  planCorte: async () => ({ total_placas: 0, total_merma: 0, plan: [] }),
  registrarCorte: async (p) => {
    llamadas.push(['registrarCorte', p]);
    /* Lo que devuelve la 0174: el TOTAL (principal + extras), no sólo la principal. */
    return { piezas_generadas: 45, piezas_primarias: 15, avisos: AVISOS.slice() };
  },
};

const fuentes = ['lp-ui.jsx', 'cnc-sector.jsx'].map(compilar);
new Function('React', 'window', 'document', preamble + fuentes.join('\n;\n'))(
  React, dom.window, dom.window.document);

const CncSector = dom.window.CncSector;
if (typeof CncSector !== 'function') { console.error('No se exportó CncSector'); process.exit(2); }

const container = dom.window.document.getElementById('root');
const txt = () => container.textContent.replace(/\s+/g, ' ');
const $$ = (s) => Array.from(container.querySelectorAll(s));
const botones = (t) => $$('button').filter(b => (b.textContent || '').toLowerCase().includes(t.toLowerCase()));
const flush = async () => {
  for (let i = 0; i < 12; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
};
const click = async (el) => {
  await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  await flush();
};
const tipear = async (input, valor) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, valor);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  await flush();
};

const root = ReactDOMClient.createRoot(container);
await act(async () => { root.render(React.createElement(CncSector)); });
await flush();
await click(botones('Scan')[0]);

check('la pantalla de carga abre con el turno abierto',
      /Elegí la placa/i.test(txt()), txt().slice(0, 300));

check('la placa combinada dice lo que rinde DE VERDAD (23, no 8)',
      /COM001\s*·\s*rinde\s*23/.test(txt()), txt().slice(0, 700));

check('y avisa que son dos medidas, para que el operario sepa por qué son tantas',
      /COM001\s*·\s*rinde\s*23\s*·\s*2 medidas/.test(txt()), txt().slice(0, 700));

check('la placa común sigue mostrando su rendimiento simple, sin ruido',
      /PLB001\s*·\s*rinde\s*6(?!\s*·\s*2 medidas)/.test(txt()), txt().slice(0, 700));

const btnCom = $$('button').find(b => /COM001/.test(b.textContent || ''));
await click(btnCom);
const nums = $$('input[type="number"]');
check('hay campos de hojas y desperdicio', nums.length >= 2, 'inputs=' + nums.length);
await tipear(nums[0], '2');
await tipear(nums[1], '1');

/* 2 hojas × 8 − 1 desperdicio = 15 de la medida principal, + 2 × 15 = 30 de la
   otra = 45. Antes acá se leía 15 y las otras 30 no existían para nadie. */
check('la vista previa suma las dos medidas (45, no 15)',
      /45/.test(txt()) && /2 hojas × 23 − 1 desp\./.test(txt()), txt().slice(0, 900));

check('el desglose dice cuántas van de cada medida',
      /Placa combinada:\s*15\s*de\s*TAP001\s*\+\s*30\s*de\s*TAP009/.test(txt()),
      txt().slice(0, 900));

console.log('\n[C · avisos — el corte entra igual y el aviso llega]');

TOASTS.length = 0;
await click(botones('Agregar al reporte')[0]);

check('el corte se registra con lo que cargó el operario',
      JSON.stringify(llamadas[llamadas.length - 1]) ===
      JSON.stringify(['registrarCorte', { placa_sku: 'COM001', hojas: 2, desperdicio: 1 }]),
      JSON.stringify(llamadas[llamadas.length - 1]));

const ok = TOASTS.filter(t => t[0] === 'success');
check('el mensaje de éxito usa el total del backend, no una cuenta propia',
      ok.length === 1 && /\+45 piezas/.test(ok[0][1]), JSON.stringify(ok));

const warns = TOASTS.filter(t => t[0] === 'warning');
check('el aviso de placas sin cargar se le muestra al operario (antes se descartaba)',
      warns.length === AVISOS.length && /faltante a reponer/i.test(warns[0][1]),
      JSON.stringify(TOASTS));

check('el aviso dura más que un toast común: pide hacer algo después',
      warns.length > 0 && warns[0][2] && warns[0][2].dur >= 5000,
      JSON.stringify(warns[0] && warns[0][2]));

check('el aviso NO se disfraza de error: el corte se registró',
      TOASTS.filter(t => t[0] === 'error').length === 0, JSON.stringify(TOASTS));

await act(async () => root.unmount());


/* ══ D · ENCARGADO — las placas a reponer, a la vista ══════════════════ */
console.log('\n[D · el encargado ve lo que hay que reponer]');

const dom2 = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
dom2.window.IS_REACT_ACT_ENVIRONMENT = true;
dom2.window.__toasts = [];
dom2.window.LP_DATA = {
  subscribe: () => () => {},
  sectorEstado: async () => ({ sectores: [], hay_jornada_demanda: true }),
};
const epilogo = ';window.__enc = { EncInicio };';
new Function('React', 'window', 'document',
  preamble + ['lp-ui.jsx', 'encargado-panel.jsx'].map(compilar).join('\n;\n') + epilogo)(
  React, dom2.window, dom2.window.document);

const { EncInicio } = dom2.window.__enc;
check('encargado-panel.jsx define el Inicio del encargado', typeof EncInicio === 'function');

const U_FAKE = {
  bg: '#fff', ink: '#000', inkSoft: '#555', inkMuted: '#888', surface: '#fff', surface2: '#eee',
  border: '#ddd', accent: '#2E4057', accentSoft: '#eef', accentLine: '#ccd',
  ok: '#16A34A', warn: '#D97706', danger: '#DC2626',
  cnc: '#2E4057', mel: '#7A5C3E', pino: '#4E6E58', emb: '#8A6D3B',
};
const KPIS = { producido: 0, listos: 0, falta: 0, nPedidos: 0, alertas: 0 };
const CADENA = { pieza: 0, mel: 0, patas: 0, term: 0 };

const c2 = dom2.window.document.getElementById('root');
const txt2 = () => c2.textContent.replace(/\s+/g, ' ');
const root2 = ReactDOMClient.createRoot(c2);

const pintar = async (mpFalta) => {
  await act(async () => {
    root2.render(React.createElement(EncInicio, {
      U: U_FAKE, kpis: KPIS, cadena: CADENA, alertas: [], demanda: [],
      toast: { success() {}, error() {}, info() {}, warning() {} },
      puedeGestionar: true, mpFalta,
    }));
  });
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
};

await pintar([]);
check('sin faltantes el panel no inventa una sección vacía',
      !/Placas a reponer/i.test(txt2()), txt2().slice(0, 300));

await pintar([
  { mp_sku: 'MEL18B', nombre: 'Melamina blanca 18', faltan: 12, stock_actual: 0, veces: 3 },
  { mp_sku: 'MEL18N', nombre: 'Melamina negra 18', faltan: 4, stock_actual: 2, veces: 1 },
]);
check('con faltantes aparece la sección "Placas a reponer"',
      /Placas a reponer/i.test(txt2()), txt2().slice(0, 400));
check('dice cuántas faltan de cada una, no sólo que "hay un problema"',
      /faltan 12/.test(txt2()) && /faltan 4/.test(txt2()), txt2().slice(0, 600));
check('nombra la placa en criollo además del SKU',
      /Melamina blanca 18/.test(txt2()) && /MEL18B/.test(txt2()), txt2().slice(0, 600));
check('y dice qué hacer para saldarlo (si no, es un cartel sin salida)',
      /Carga de stock/i.test(txt2()) && /materia prima/i.test(txt2()), txt2().slice(0, 700));

await act(async () => root2.unmount());


/* ══ E · ESTÁTICO — las dos plataformas ════════════════════════════════ */
console.log('\n[E · estático — web y mobile, sin mitades]');

const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

for (const b of ['web', 'mobile']) {
  const carga = leer(`${b}/components/linea-stock-carga.jsx`);
  check(`${b}: la carga de stock deja cargar placas (bucket 'mp')`,
        /\{\s*v:'mp',\s*l:'Placa \/ materia prima'\s*\}/.test(carga), b);
  check(`${b}: y avisa cuando la carga salda un faltante`,
        /faltantes_saldados/.test(carga), b);

  const data = leer(`${b}/components/lp-data.jsx`);
  check(`${b}: placas() usa la vista nueva con red de seguridad`,
        /prod_v_placa/.test(data) && /catch[\s\S]{0,120}prod_placa'/.test(data), b);
  check(`${b}: existe mpFaltantes()`, /mpFaltantes:/.test(data) && /prod_v_mp_faltante/.test(data), b);

  const cnc = leer(`${b}/components/cnc-sector.jsx`);
  check(`${b}: CNC cuenta el rendimiento extra`, /rendimiento_extra/.test(cnc), b);
  check(`${b}: CNC muestra los avisos del backend`,
        /res && res\.avisos/.test(cnc) && /toast\.warning/.test(cnc), b);

  const pino = leer(`${b}/components/pino-sector.jsx`);
  check(`${b}: Pino ya no tira a la basura la respuesta de registrarPino`,
        /const res = await window\.LP_DATA\.registrarPino/.test(pino), b);
  check(`${b}: Pino muestra los avisos`,
        /res && res\.avisos/.test(pino) && /toast\.warning/.test(pino), b);

  const enc = leer(`${b}/components/encargado-panel.jsx`);
  check(`${b}: el panel del encargado carga y muestra los faltantes`,
        /mpFaltantes\(\)/.test(enc) && /Placas a reponer/.test(enc), b);
}

/* Bumpear el ?v= en una sola plataforma es cómo mobile se queda con el JS
   viejo en caché y "no anda" sin que nadie sepa por qué. */
const HTML_WEB = leer('web/Macario Lite.html');
const HTML_MOB = leer('mobile/index.html');
for (const f of ['linea-stock-carga.jsx', 'lp-data.jsx', 'cnc-sector.jsx', 'pino-sector.jsx', 'encargado-panel.jsx']) {
  const re = new RegExp(f.replace('.', '\\.') + '\\?v=(\\d+)');
  const w = HTML_WEB.match(re), m = HTML_MOB.match(re);
  check(`cache-busting parejo en web y mobile · ${f}`,
        !!w && !!m && w[1] === m[1], `web=${w && w[1]} mobile=${m && m[1]}`);
}


/* ══ F · ESTÁTICO — migración 0174 ═════════════════════════════════════ */
console.log('\n[F · migración 0174 — el backend es la barrera real]');

const MIG = path.join(ROOT, 'supabase', 'migrations', '0174_placas_avisan_y_combinadas.sql');
const existe = fs.existsSync(MIG);
check('existe la migración 0174', existe, MIG);
const sql = existe ? fs.readFileSync(MIG, 'utf8') : '';

check('0174 corre entera o no corre: begin/commit',
      /^\s*begin\s*;/m.test(sql) && /^\s*commit\s*;/m.test(sql));

check("el bucket 'mp' es válido en la carga de stock",
      /prod_stock_ajuste_bucket_check[\s\S]{0,300}'mp'/.test(sql));

check('hay tabla de faltantes de materia prima',
      /create table if not exists public\.prod_mp_faltante/.test(sql));
check('...con RLS prendida', /alter table public\.prod_mp_faltante enable row level security/.test(sql));
check('...y sin políticas de escritura para el cliente (escriben las RPC)',
      !/on public\.prod_mp_faltante\s+for\s+(insert|update|delete)/i.test(sql));

check('el corte descuenta sólo lo que hay y anota el resto',
      /least\(v_mpdisp, v_hojas\)/.test(sql) && /insert into public\.prod_mp_faltante/.test(sql));

check('el corte YA NO revienta por falta de placas: avisa',
      /v_avisos/.test(sql) && /no tenia cargadas/.test(sql));

check('el corte acredita las piezas de la segunda medida',
      /prod_placa_pieza_extra[\s\S]{0,400}prod_stock_pieza/.test(sql));

check('editar un corte también revierte y acredita las extras',
      /prod_rpc_editar_corte[\s\S]{0,4000}prod_placa_pieza_extra/.test(sql));

check('Pino avisa en vez de reventar cuando no hay tirante o no hay receta',
      /prod_rpc_registrar_pino[\s\S]{0,3000}avisos/.test(sql));

check('cargar placas salda el faltante y lo informa',
      /prod_fn_mp_faltante_saldar/.test(sql) && /faltantes_saldados/.test(sql));

check('la función de saldar no la puede llamar el cliente',
      /revoke execute on function public\.prod_fn_mp_faltante_saldar\(text,int,text\) from public, anon, authenticated/.test(sql));

check('las vistas nuevas respetan RLS del que consulta (security_invoker)',
      (sql.match(/create or replace view public\.prod_v_mp_faltante with \(security_invoker = true\)/) || []).length === 1 &&
      (sql.match(/create or replace view public\.prod_v_placa with \(security_invoker = true\)/) || []).length === 1);

check('ninguna vista nueva queda expuesta a anon',
      /revoke all on public\.prod_v_mp_faltante from public, anon/.test(sql) &&
      /revoke all on public\.prod_v_placa from public, anon/.test(sql));

check('prod_v_placa expone el total, no obliga a cada pantalla a sumar',
      /as rendimiento_total/.test(sql) && /as rendimiento_extra/.test(sql));

console.log(`\n${pass} ok · ${fail} fail`);
process.exit(fail ? 1 : 0);

})().catch(e => { console.error(e); process.exit(2); });
