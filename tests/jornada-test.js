/* ══ Jornada destino — el arnés del bug del 31-ago ══════════════════════
   node tests/jornada-test.js "<ROOT>" web|mobile

   EL BUG QUE ESTE ARCHIVO EXISTE PARA QUE NO VUELVA
   ─────────────────────────────────────────────────
   El cliente grabó un video: carga producción, sale el cartel verde de OK,
   y el número de la pantalla no se mueve. Su lectura fue "registra y no
   guarda nada". Guardaba. Lo que estaba mal era ADÓNDE: el modal mandaba la
   carga a la jornada ACTIVA aunque el usuario estuviera mirando otra.

   Por qué eso es indetectable a ojo: el plan de una jornada se calcula con
   computeCarriersForJornada(id), que cuenta 'pedido' de las orders con ese
   jornada_id y 'producido' de los production_logs con ese jornada_id. O sea
   que una escritura que cae en la jornada equivocada es LITERALMENTE
   indistinguible de una escritura que no ocurrió. No hay error, no hay
   diferencia visible, y la única forma de darse cuenta es mirar la base.

   Por eso hace falta un test y no alcanza con "acordarse". Son cuatro partes:

     A · RENDER — monta ProduceModal de verdad con el escenario exacto del
         video (3 jornadas abiertas, activa la del 31, mirando la del 29) y
         verifica que el destino por defecto sea la que se está VIENDO.

     B · ESTÁTICO, destino de escritura — recorre TODAS las llamadas a
         MOCK_ACTIONS que mandan una jornada y exige que el valor venga de
         seleccionadaId. Esta es la parte que ataja el bug de verdad: si
         mañana alguien agrega un escritor nuevo que caiga en la activa, el
         test se pone rojo antes de llegar a producción.

     C · ESTÁTICO, controles muertos — el mismo modal tenía además un input
         "Fecha" que nunca se enviaba (rpc_register_production escribe
         current_date a mano). Es la versión chica del mismo engaño:
         prometer un control que no existe.

     D · ESTÁTICO, jornada declarada y nunca enviada — el hermano silencioso.
         Un escritor de data.js acepta una jornada y ningún llamador se la
         manda, así que el RPC cae en la activa. Así estaba assignFreeStock
         desde 0029, y la parte B no lo veía porque B mira las llamadas que
         SÍ mandan jornada.
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

console.log(`\n═══ ${VARIANT.toUpperCase()} · jornada destino\n`);

/* ══ A · RENDER ════════════════════════════════════════════════════════
   Escenario del video, tal cual: tres jornadas abiertas, la ACTIVA es la
   del 31 y el usuario está mirando la del 29. Esa diferencia entre
   "activa" y "la que estoy viendo" es todo el bug.                     */

const J29 = 'j-29-ago', J31 = 'j-31-ago-ACTIVA', J01 = 'j-01-sep';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.MouseEvent = dom.window.MouseEvent;
global.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.IS_REACT_ACT_ENVIRONMENT = true;

const ReactDOMClient = require('react-dom/client');
const { act } = require('react');

let capturado = null;   // los params con los que se llamó al escritor

function instalarGlobales(W) {
  W.React = React;
  for (const k of ['useState','useEffect','useRef','useMemo','useCallback','useContext','createContext','Fragment'])
    W[k] = React[k];

  W.SKU_DB = {
    MAD020: { modelo: 'MESA REDONDA 40 BLANCO', color: 'Blanco', hex: '#ffffff' },
    MAD301: { modelo: 'Bumerang',               color: 'Blanco', hex: '#ffffff' },
  };
  W.skuName = s => (W.SKU_DB[s] || {}).modelo || s;
  W.CARRIERS = {
    colecta:{label:'Colecta'}, flex:{label:'Flex'}, tiendanube:{label:'Tienda Nube'},
    distribuidor:{label:'Distribuidor'}, no_flex:{label:'No Flex'}, correo_argentino:{label:'Correo Arg.'},
  };

  /* Planes distintos por jornada: la del 29 tiene el pedido pendiente de
     MAD020, la del 31 no. Sirve para comprobar que el "Plan actual" del
     resumen se calcula contra la jornada DESTINO y no contra otra. */
  const PLANES = {
    [J29]: { flex: { table: [{ sku:'MAD020', pedido:1, producido:0, faltante:1, stock:0 }] } },
    [J31]: { flex: { table: [{ sku:'MAD301', pedido:5, producido:5, faltante:0, stock:0 }] } },
    [J01]: { flex: { table: [] } },
  };
  W.computeCarriersForJornada = id => PLANES[id] || {};

  W.MOCK_ACTIONS = {
    async registrarProduccion(p) { capturado = p; return { id: 'log-1' }; },
    async corregirLog() { return {}; },
  };
  W.MOCK_BUS = { subscribe: () => () => {}, emit: () => {} };

  /* jornadaDestinoId NO se copia acá: se saca tal cual de data.js y se
     evalúa. Una copia en el arnés puede quedar bien mientras la de verdad
     se rompe — que es justo el agujero por el que se coló el bug. */
  const dataSrc = fs.readFileSync(path.join(BASE, 'data.js'), 'utf8');
  const mHelper = dataSrc.match(/window\.jornadaDestinoId\s*=\s*function[\s\S]*?\n};/);
  if (!mHelper) {
    console.error('data.js ya no exporta window.jornadaDestinoId'); process.exit(2);
  }
  new Function('window', mHelper[0])(W);

  /* useMockData() de shared.jsx devuelve window.MOCK tal cual. Mockear el
     hook no sirve: shared.jsx lo reinstala con Object.assign y pisa el
     mock. Se puebla MOCK y se deja correr el hook real. */
  W.MOCK = {
    user: { role: 'owner' },
    prod: { todos: { table: [{ sku:'MAD020', canal:'Flex', pedido:1, producido:0, faltante:1, stock:0 }] } },
    carriers: {},
    jornadas: {
      abiertas: [
        { id: J29, fecha: '2026-08-29' },
        { id: J31, fecha: '2026-08-31' },
        { id: J01, fecha: '2026-09-01' },
      ],
      activaId:       J31,   // la marcada en la base
      seleccionadaId: J29,   // la que el usuario está MIRANDO
    },
  };
}

/* shared.jsx y modals.jsx son scripts clásicos: en el browser comparten un
   único scope léxico global. Se concatenan y evalúan juntos, igual que ahí. */
function cargar(W) {
  const fuentes = ['shared.jsx', 'modals.jsx'].map(f => {
    const p = path.join(BASE, f);
    return Babel.transform(fs.readFileSync(p, 'utf8'), { presets: ['react'], filename: p }).code;
  });
  const fn = new Function('window', 'document', 'React', 'navigator',
    'with (window) { ' + fuentes.join('\n;\n') + ' }');
  fn(W, W.document, React, W.navigator);
}

instalarGlobales(dom.window);
cargar(dom.window);

const ProduceModal = dom.window.ProduceModal;
if (typeof ProduceModal !== 'function') {
  console.error('No se pudo cargar ProduceModal de ' + BASE);
  process.exit(2);
}

const txt = () => dom.window.document.getElementById('root').textContent.replace(/\s+/g, ' ');
const $$  = sel => Array.from(dom.window.document.querySelectorAll(sel));
const botonPorTexto = t =>
  $$('button').find(b => (b.textContent || '').toLowerCase().includes(t.toLowerCase()));

const root = ReactDOMClient.createRoot(dom.window.document.getElementById('root'));
act(() => {
  const modal = React.createElement(ProduceModal, {
    open: true, onClose: () => {}, defaultSku: 'MAD020', defaultSubcanal: 'flex',
  });
  const TP = dom.window.ToastProvider;
  root.render(TP ? React.createElement(TP, null, modal) : modal);
});

console.log('[A · render — escenario del video]');

const select = $$('select')[0];
check('hay selector de jornada visible', !!select);
check('el destino por defecto es la jornada que se está VIENDO (29), no la ACTIVA (31)',
      select && select.value === J29,
      select ? 'value = ' + select.value : 'no hay select');

check('el paso 3 dice "Jornada destino"', /Jornada destino/i.test(txt()));
check('la opción mirada está marcada como "la que estás viendo"',
      /la que est[áa]s viendo/i.test(txt()));

check('no queda ningún campo Fecha muerto (el RPC escribe current_date)',
      $$('input[type="date"]').length === 0,
      'inputs date encontrados: ' + $$('input[type="date"]').length);

check('el resumen muestra la jornada destino (29-ago)',
      /Jornada:\s*29[\s-]*ago/i.test(txt()), txt().slice(-240));

check('el "Plan actual" sale de la jornada destino (0/1 en la del 29)',
      /Plan actual:\s*0\/1/.test(txt()), txt().slice(-240));

check('sin desajuste no aparece la advertencia', !/no van a cambiar/i.test(txt()));

act(() => {
  const b = botonPorTexto('Confirmar registro');
  if (b) b.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
});
check('al confirmar, el escritor recibe la jornada VISTA, no la activa',
      capturado && capturado.jornadaId === J29,
      'capturado = ' + JSON.stringify(capturado));

/* Y si el usuario elige a mano otra jornada, tiene que enterarse ANTES de
   confirmar de que el número de la pantalla no se va a mover. */
act(() => {
  const s = $$('select')[0];
  s.value = J31;
  s.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
});
check('al elegir otra jornada avisa que los números de la pantalla no se mueven',
      /no van a cambiar/i.test(txt()), txt().slice(0, 360));
check('el plan se recalcula contra la nueva jornada destino',
      /Plan actual:\s*5\/5/.test(txt()) || /no tiene pedidos activos/i.test(txt()),
      txt().slice(-240));

/* ══ B · ESTÁTICO — de dónde sale el destino de cada escritura ══════════
   Esta es la parte que ataja el bug para siempre. El test de render cubre
   ProduceModal; este cubre los escritores que todavía no existen.

   Regla: toda llamada a MOCK_ACTIONS que mande una jornada tiene que
   derivar ese valor de seleccionadaId (la que el usuario mira). Se sigue
   la cadena de const hasta 4 saltos, porque el valor casi nunca está
   escrito en la llamada misma.                                          */

console.log('\n[B · estático — el destino sale de la jornada mirada]');

/* Excepciones, cada una con su motivo. Una excepción sin motivo escrito es
   una excepción que nadie va a poder auditar en seis meses. */
const EXENTOS = {
  setActiveJornada: 'su trabajo ES cambiar cuál es la activa; el id sale de la fila que el usuario clickeó',
};

function leer(rel) {
  const p = path.join(BASE, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

/* Extrae el texto entre paréntesis balanceados a partir de un '('. */
function argumentos(src, desde) {
  let nivel = 0;
  for (let i = desde; i < src.length; i++) {
    if (src[i] === '(') nivel++;
    else if (src[i] === ')') { nivel--; if (!nivel) return src.slice(desde + 1, i); }
  }
  return '';
}

/* Sigue `const X = <expr>` hacia atrás buscando la mención de un símbolo. */
function derivaDe(src, expr, simbolo, saltos) {
  if (expr.includes(simbolo)) return true;
  if (saltos <= 0) return false;
  for (const id of expr.match(/[A-Za-z_$][\w$]*/g) || []) {
    const m = src.match(new RegExp('\\b(?:const|let|var)\\s+' + id + '\\s*=\\s*([^;]+);', ));
    if (m && derivaDe(src, m[1], simbolo, saltos - 1)) return true;
  }
  return false;
}

const ARCHIVOS_JSX = fs.readdirSync(BASE).filter(f => f.endsWith('.jsx'));
let llamadasRevisadas = 0;
const sospechosas = [];

for (const archivo of ARCHIVOS_JSX) {
  const src = leer(archivo);
  if (!src) continue;
  const re = /MOCK_ACTIONS\.(\w+)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const escritor = m[1];
    const args = argumentos(src, re.lastIndex - 1);
    /* Sólo nos importan las llamadas que efectivamente mandan una jornada. */
    const j = args.match(/\b(?:target)?[Jj]ornadaId\s*:\s*([^,\n}]+)/);
    if (!j) continue;
    llamadasRevisadas++;
    if (EXENTOS[escritor]) continue;
    /* Dos formas validas: nombrar seleccionadaId, o llamar al helper de
       data.js que la resuelve (que es la que se prefiere). */
    if (!derivaDe(src, j[1], 'seleccionadaId', 4) &&
        !derivaDe(src, j[1], 'jornadaDestinoId', 4)) {
      const linea = src.slice(0, m.index).split('\n').length;
      sospechosas.push(`${archivo}:${linea} · ${escritor}(${j[1].trim()}) no sale de la jornada mirada`);
    }
  }
}

check(`se revisaron las llamadas con jornada (${llamadasRevisadas} encontradas)`,
      llamadasRevisadas >= 3,
      'esperábamos al menos ProduceModal, ImportModal y ManualOrderModal');
check('toda escritura con jornada sale de la que el usuario está mirando',
      sospechosas.length === 0,
      sospechosas.join('\n         → '));

/* ══ C · ESTÁTICO — sin controles muertos en el modal de producción ═════
   rpc_register_production escribe current_date/current_time a mano: nunca
   hubo forma de que el front eligiera la fecha. Un input de fecha ahí es
   una promesa que el backend no puede cumplir.                          */

console.log('\n[C · estático — sin controles muertos]');

const modalsSrc = leer('modals.jsx') || '';
const iProduce = modalsSrc.indexOf('function ProduceModal');
const iSiguiente = modalsSrc.indexOf('\nfunction ', iProduce + 10);
const cuerpoProduce = iProduce >= 0
  ? modalsSrc.slice(iProduce, iSiguiente > 0 ? iSiguiente : modalsSrc.length)
  : '';

check('ProduceModal existe en el fuente', cuerpoProduce.length > 0);
check('ProduceModal no tiene input de fecha (el RPC la escribe él)',
      !/type\s*=\s*["']date["']/.test(cuerpoProduce));
check('ProduceModal no guarda estado de fecha sin usar',
      !/\[\s*fecha\s*,\s*setFecha\s*\]/.test(cuerpoProduce));

/* ══ D · ESTÁTICO — jornada que se declara y nunca se manda ══════════
   `assignFreeStock({ sku, cantidad, channelId, jornadaId, motivo })` acepta
   una jornada desde 0029. Ninguno de sus llamadores se la mandaba. Y el RPC,
   cuando no la recibe, cae en fn_resolve_active_jornada — la ACTIVA. O sea:
   asignar stock libre a un canal mientras mirás otra jornada dejaba el
   production_log colgado del lado equivocado y el "producido" de la pantalla
   quieto. Mismo síntoma exacto que el video: confirma y no pasa nada.

   La parte B no lo veía: ella revisa las llamadas que SÍ mandan jornada.
   Esta revisa las que deberían mandarla y no lo hacen.                    */

console.log('\n[D · estático — jornada declarada pero nunca enviada]');

const dataSrcTest = leer('data.js') || '';
const reFirma = /^\s*async\s+([a-zA-Z_$][\w$]*)\s*\(\s*\{([^}]*)\}/gm;
const conJornada = [];
let mFirma;
while ((mFirma = reFirma.exec(dataSrcTest))) {
  const nombre = mFirma[1];
  const param = (mFirma[2].match(/\b((?:target)?[Jj]ornadaId)\b/) || [])[1];
  if (param && !EXENTOS[nombre]) conJornada.push({ nombre, param });
}

check(`data.js declara escritores que aceptan jornada (${conJornada.length})`,
      conJornada.length >= 3,
      conJornada.map(w => w.nombre).join(', ') || 'ninguno');

const mudas = [];
for (const { nombre, param } of conJornada) {
  for (const archivo of ARCHIVOS_JSX) {
    const src = leer(archivo);
    if (!src) continue;
    const reLlamada = new RegExp('MOCK_ACTIONS\\.' + nombre + '\\s*\\(', 'g');
    let mLlamada;
    while ((mLlamada = reLlamada.exec(src))) {
      const args = argumentos(src, reLlamada.lastIndex - 1);
      if (/\b(?:target)?[Jj]ornadaId\s*[:,}]/.test(args)) continue;
      const linea = src.slice(0, mLlamada.index).split('\n').length;
      mudas.push(`${archivo}:${linea} · ${nombre}() no manda ${param} — el RPC la cuelga de la ACTIVA`);
    }
  }
}

check('todo llamador manda la jornada que su escritor acepta',
      mudas.length === 0, mudas.join('\n         → '));

console.log('\n--------------------------------');
console.log(`${pass}/${pass + fail} checks OK · fallos: ${fail}`);
process.exit(fail ? 1 : 0);
