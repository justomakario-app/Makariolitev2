/* ══ Turno de sector — que abrir la jornada tenga efecto ════════════════
   node tests/turno-sector-test.js "<ROOT>" web|mobile

   QUÉ ARREGLA ESTO Y POR QUÉ NECESITA UN TEST
   ───────────────────────────────────────────
   Seba lo dijo así: "el encargado de cada área tiene que prender su jornada
   y cerrarla cuando se vaya… capaz el de melamina trabajó y no trabajó el de
   patas o el de CNC. Entonces no puede ser que se prendan todas las jornadas,
   sino por cada sector se prende una jornada."

   Antes había UNA jornada global y el operario no la controlaba. Las cuatro
   pantallas de sector terminaban en un cartel sin salida:

       "Jornada no abierta — No se pueden registrar cortes hasta que el
        encargado abra la jornada de hoy."

   Eso es la versión más cara del bug que este repo persigue: el tipo está
   parado frente a la máquina con el trabajo hecho y la app no le deja
   cargarlo ni le ofrece cómo. La producción existe; en la base, no. Después
   nadie reporta nada, porque no hay error: hay una pantalla gris.

   Cinco partes:

     A · RENDER — monta CncSector de verdad y recorre el camino completo:
         turno cerrado → botón → abierto → cargar → cerrar → resumen.

     B · EFECTO — abrir tiene que RE-LEER el estado y que la pantalla cambie.
         Un sectorAbrir que devuelve ok y deja la pantalla diciendo "cerrada"
         es exactamente "dice que guardó y no guardó nada" con otra ropa.

     C · ESTÁTICO, las cuatro pantallas — ningún sector puede volver a colgarse
         de la jornada global ni quedarse sin el botón. Cubre los sectores que
         hoy nadie está mirando y los que se agreguen mañana.

     D · ESTÁTICO, ámbito de la lista — "lo que cargaste" tiene que salir del
         turno cuando hay turno. Si se lista por jornada, el de CNC ve el
         trabajo del turno anterior como propio y el cierre le miente.

     E · ESTÁTICO, migración 0173 — las cuatro RPC de carga exigen turno y
         estampan turno_id, y las funciones internas siguen revocadas. El
         backend es la única barrera real: la UI se puede saltear.
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

console.log(`\n═══ ${VARIANT.toUpperCase()} · turno de sector\n`);

const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.IS_REACT_ACT_ENVIRONMENT = true;

const ReactDOMClient = require('react-dom/client');
const { act } = require('react');

/* ══ Backend falso ═════════════════════════════════════════════════════
   Guarda TODA llamada. La mitad de los checks son sobre qué se llamó y con
   qué, no sobre lo que se ve: una pantalla puede verse bien y estar
   escribiendo en el lugar equivocado.                                    */

const llamadas = [];
let abierto = false;          // ¿el turno de cnc está abierto?
let hayDemanda = false;       // ¿hay jornada de demanda vinculada?
let resumenCierre = { cargas: 0 };
const TURNO_ID = 'turno-cnc-1';
const JORNADA_ID = 'jornada-demanda-1';

function estadoActual() {
  return {
    mi_sector: 'cnc',
    jornada_id: hayDemanda ? JORNADA_ID : null,
    fecha: hayDemanda ? '2026-09-09' : null,
    hay_jornada_demanda: hayDemanda,
    sectores: ['cnc', 'embalaje', 'melamina', 'pino'].map(s => ({
      sector: s,
      abierta: s === 'cnc' ? abierto : false,
      turno_id: (s === 'cnc' && abierto) ? TURNO_ID : null,
      abierta_at: (s === 'cnc' && abierto) ? new Date(Date.now() - 3 * 3600 * 1000).toISOString() : null,
      abierta_por_nombre: (s === 'cnc' && abierto) ? 'Seba' : null,
      jornada_id: (s === 'cnc' && abierto && hayDemanda) ? JORNADA_ID : null,
      ultimo_cierre: null,
    })),
  };
}

dom.window.LP_DATA = {
  subscribe: () => () => {},
  sectorEstado: async () => { llamadas.push(['sectorEstado']); return estadoActual(); },
  sectorAbrir: async (p) => {
    llamadas.push(['sectorAbrir', p]);
    abierto = true;
    return { ok: true, sector: 'cnc', turno_id: TURNO_ID, retomada: false, sin_jornada_demanda: !hayDemanda };
  },
  sectorCerrar: async (p) => {
    llamadas.push(['sectorCerrar', p]);
    abierto = false;
    return { ok: true, sector: 'cnc', turno_id: TURNO_ID, horas: 3.2, resumen: resumenCierre };
  },
  jornadaHoy: async () => (hayDemanda ? { jornada_id: JORNADA_ID, fecha: '2026-09-09', estado: 'abierta' } : null),
  cortesDia: async (a) => { llamadas.push(['cortesDia', a]); return []; },
  ventasVinculadas: async () => [],
  resumenDia: async () => [],
  placas: async () => [{ sku: 'PLB001', nombre: 'Placa blanca 18', material: 'Melamina', rendimiento: 6 }],
  registrarCorte: async (p) => { llamadas.push(['registrarCorte', p]); return { piezas_generadas: 6 }; },
};

const ultima = (nombre) => {
  for (let i = llamadas.length - 1; i >= 0; i--) if (llamadas[i][0] === nombre) return llamadas[i][1];
  return undefined;
};
const conteo = (nombre) => llamadas.filter(l => l[0] === nombre).length;

/* Preámbulo: lo que shared.jsx expone globalmente en el browser real.
   El toast se devuelve SIEMPRE el mismo objeto, como el useMemo de verdad:
   uno nuevo por render haría que `cargar` cambie de identidad en cada vuelta
   y el efecto se dispare para siempre. */
const preamble = `
  const { useState, useEffect, useRef, useMemo, useCallback, createContext, useContext } = React;
  const Icon = ({ n, s, c }) => React.createElement('i', { 'data-icon': n });
  const TOAST = { error(){}, success(){}, info(){} };
  const useToast = () => TOAST;
`;

const fuentes = ['lp-ui.jsx', 'cnc-sector.jsx'].map(f => {
  const p = path.join(BASE, f);
  return Babel.transform(fs.readFileSync(p, 'utf8'), { presets: ['react'], filename: p }).code;
});
/* lp-ui.jsx no exporta a window: en el browser todo comparte un unico scope global y no hace
   falta. El test si lo necesita, asi que se lo agrega aca en vez de ensuciar el archivo de
   produccion con exports que solo existirian para los tests. */
const epilogo = ';window.__kit = { LpTurnosStrip, lpNeutralMsg, lpDesdeHace };';
new Function('React', 'window', 'document', preamble + fuentes.join('\n;\n') + epilogo)(
  React, dom.window, dom.window.document);

const CncSector = dom.window.CncSector;
if (typeof CncSector !== 'function') { console.error('No se exportó CncSector'); process.exit(2); }

const container = dom.window.document.getElementById('root');
const txt = () => container.textContent.replace(/\s+/g, ' ');
const $$ = (sel) => Array.from(container.querySelectorAll(sel));
const botones = (t) => $$('button').filter(b => (b.textContent || '').toLowerCase().includes(t.toLowerCase()));
/* Cada carga encadena varios await (jornadaHoy → Promise.all → setState → efecto →
   cargar de nuevo). Con pocos ticks el test lee una pantalla a medio pintar y falla
   por el harness, no por el código. */
const flush = async () => {
  for (let i = 0; i < 12; i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  }
};
const click = async (el) => {
  await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  await flush();
};

let root;
async function montar() {
  if (root) await act(async () => root.unmount());
  root = ReactDOMClient.createRoot(container);
  await act(async () => { root.render(React.createElement(CncSector)); });
  await flush();
}

(async () => {

/* ══ A · RENDER — el camino completo del operario ═══════════════════════ */
console.log('[A · render — turno cerrado, el operario tiene salida]');

await montar();

check('con el turno cerrado el chip lo dice',
      /Tu jornada cerrada/i.test(txt()), txt().slice(0, 200));

check('hay un botón para abrir la jornada (antes era un cartel sin salida)',
      botones('Abrir mi jornada').length > 0,
      'botones: ' + $$('button').map(b => b.textContent.trim()).join(' | ').slice(0, 240));

check('ya no dice que hay que esperar al encargado',
      !/hasta que el encargado abra la jornada/i.test(txt()), txt().slice(0, 300));

check('explica que la jornada es propia y no afecta a los demás sectores',
      /no afecta a los otros sectores/i.test(txt()), txt().slice(0, 400));

/* ══ B · EFECTO — abrir cambia la pantalla, no sólo la base ═════════════ */
console.log('\n[B · abrir tiene efecto visible]');

const antesEstado = conteo('sectorEstado');
await click(botones('Abrir mi jornada')[0]);

check('el click llama a sectorAbrir con el sector',
      JSON.stringify(ultima('sectorAbrir')) === JSON.stringify({ sector: 'cnc' }),
      'payload = ' + JSON.stringify(ultima('sectorAbrir')));

check('después de abrir vuelve a leer el estado (si no, la pantalla miente)',
      conteo('sectorEstado') > antesEstado,
      `sectorEstado antes=${antesEstado} después=${conteo('sectorEstado')}`);

check('la pantalla pasa a decir que tu jornada está abierta',
      /Tu jornada · /i.test(txt()) && !/Tu jornada cerrada/i.test(txt()), txt().slice(0, 200));

check('aparece el botón de cerrar', botones('Cerrar mi jornada').length > 0,
      $$('button').map(b => b.textContent.trim()).join(' | ').slice(0, 240));

check('sin jornada de demanda igual se puede trabajar: lo dice y ofrece stock libre',
      /stock libre/i.test(txt()), txt().slice(0, 500));

check('el ámbito de la lista pasa a ser TU turno, no la jornada',
      (ultima('cortesDia') || {}).turno_id === TURNO_ID,
      'ámbito = ' + JSON.stringify(ultima('cortesDia')));

/* La pantalla de carga: con el turno abierto tiene que dejar registrar. */
await click(botones('Scan')[0]);
check('con el turno abierto el Scan deja cargar (no muestra la portada)',
      !/Tu jornada de CNC está cerrada/i.test(txt()) && /Elegí la placa/i.test(txt()),
      txt().slice(0, 300));

/* ══ C · CERRAR — confirma, y el resumen no miente ═════════════════════ */
console.log('\n[C · cerrar confirma y rinde cuentas]');

await click(botones('Inicio')[0]);
const antesCerrar = conteo('sectorCerrar');
await click(botones('Cerrar mi jornada')[0]);

check('primero pregunta: cerrar sin querer deja al sector sin poder cargar',
      conteo('sectorCerrar') === antesCerrar && /Cerrás tu jornada de CNC/i.test(txt()),
      txt().slice(0, 300));

check('el aviso dice que sólo se cierra tu sector',
      /solo el tuyo/i.test(txt()), txt().slice(0, 400));

check('se puede volver atrás sin cerrar', botones('Seguir trabajando').length > 0);

await click(botones('Sí, cerrar')[0]);
check('al confirmar sí llama a sectorCerrar', conteo('sectorCerrar') === antesCerrar + 1);

check('muestra el resumen del turno con las horas',
      /3\.2 h/.test(txt()), txt().slice(0, 400));

check('turno sin cargas: lo dice con todas las letras en vez de mostrar un 0 mudo',
      /ese trabajo no existe para el sistema/i.test(txt()), txt().slice(0, 600));

/* ══ D · el resumen con cargas muestra los números reales ═══════════════ */
console.log('\n[D · resumen con producción]');

resumenCierre = { cargas: 4, hojas: 12, desperdicio: 3 };
hayDemanda = true;
await montar();
await click(botones('Abrir mi jornada')[0]);
await click(botones('Cerrar mi jornada')[0]);
await click(botones('Sí, cerrar')[0]);

check('el resumen traduce las claves del backend a palabras del taller',
      /Placas cortadas/i.test(txt()) && /Desperdicio/i.test(txt()), txt().slice(0, 500));
/* textContent pega rotulo y numero: "Cargas4", asi que no hay borde de palabra. */
check('muestra la cantidad de cargas del turno', /Cargas\s*4/.test(txt()), txt().slice(0, 300));
check('con cargas NO aparece el aviso de turno vacío',
      !/ese trabajo no existe para el sistema/i.test(txt()));

/* ══ E · ESTÁTICO — las cuatro pantallas, no sólo la que se testeó ══════ */
console.log('\n[E · estático — los cuatro sectores]');

const SECTORES = [
  { f: 'cnc-sector.jsx', sec: 'cnc', label: 'CNC' },
  { f: 'melamina-sector.jsx', sec: 'melamina', label: 'Melamina' },
  { f: 'pino-sector.jsx', sec: 'pino', label: 'Pino' },
  { f: 'embalaje-sector.jsx', sec: 'embalaje', label: 'Embalaje' },
];

/* Los checks negativos ("esta frase ya no existe") se corren sobre el codigo sin
   comentarios: el propio comentario que documenta el cambio cita la frase vieja, y
   sin esto el test se dispararia contra su propia explicacion. */
const sinComentarios = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

for (const s of SECTORES) {
  const src = fs.readFileSync(path.join(BASE, s.f), 'utf8');
  const vivo = sinComentarios(src);
  const nombre = s.label;

  check(`${nombre}: usa su propio turno (useLpTurno)`,
        src.includes(`useLpTurno('${s.sec}'`), s.f);

  check(`${nombre}: ya no se cuelga de la jornada global para dejar cargar`,
        !/jornada\s*&&\s*jornada\.estado\s*===\s*'abierta'/.test(vivo), s.f);

  check(`${nombre}: escucha prod_jornada_sector en vivo`,
        src.includes("'prod_jornada_sector'"), s.f);

  check(`${nombre}: la pantalla de carga ofrece abrir en vez de un cartel muerto`,
        src.includes('LpTurnoPortada') && !/hasta que el encargado abra la jornada/i.test(vivo), s.f);

  check(`${nombre}: el botón de la jornada está en la topbar, visible desde cualquier tab`,
        src.includes('LpTurnoBoton') && src.includes('LpTurnoChip'), s.f);

  check(`${nombre}: con el turno cerrado pero con datos, avisa y deja mirar`,
        src.includes('LpTurnoAviso'), s.f);

  /* D · ámbito: la lista del día se pide con el ámbito (turno o jornada),
     nunca con el jornada_id pelado — eso mostraba trabajo ajeno como propio. */
  check(`${nombre}: la lista del día se pide por ámbito (turno primero)`,
        /(cortes|melamina|pino|embalaje)Dia\(ambito\)/.test(src)
        && !/(cortes|melamina|pino|embalaje)Dia\(j\.jornada_id\)/.test(src), s.f);
}

/* El kit vive una sola vez: si falta una pieza en un bundle, ese bundle
   arranca en blanco y nadie lo nota hasta que el operario abre la app. */
const uiSrc = fs.readFileSync(path.join(BASE, 'lp-ui.jsx'), 'utf8');
for (const n of ['useLpTurno', 'LpTurnoChip', 'LpTurnoBoton', 'LpTurnoModal',
                 'LpTurnoResumen', 'LpTurnoPortada', 'LpTurnoAviso', 'lpDesdeHace']) {
  check(`lp-ui.jsx define ${n}`, new RegExp('function ' + n + '\\s*\\(').test(uiSrc));
}

check('lpNeutralMsg dejó de hablar de "cuando el encargado inicie la jornada"',
      !/Cuando el encargado inicie la jornada/i.test(sinComentarios(uiSrc)));

/* ══ F · ESTÁTICO — la migración 0173 ══════════════════════════════════ */
console.log('\n[F · estático — migración 0173]');

const MIG = path.join(ROOT, 'supabase', 'migrations', '0173_jornada_por_sector.sql');
check('existe la migración 0173', fs.existsSync(MIG), MIG);
if (fs.existsSync(MIG)) {
  const sql = fs.readFileSync(MIG, 'utf8');

  check('sólo puede haber UNA jornada abierta por sector (índice único parcial)',
        /create unique index[\s\S]{0,200}prod_jornada_sector\s*\(sector\)\s*where\s+estado\s*=\s*'abierta'/i.test(sql));

  check('las cuatro tablas de carga estampan turno_id',
        ['prod_corte', 'prod_melamina', 'prod_pino', 'prod_embalaje']
          .every(t => new RegExp('alter table[\\s\\S]{0,40}' + t + '[\\s\\S]{0,200}turno_id', 'i').test(sql)));

  /* La barrera real. La UI se puede saltear con una llamada directa a la RPC;
     esto es lo que impide que una carga caiga fuera de todo turno. */
  for (const r of ['registrar_corte', 'registrar_melamina', 'registrar_pino', 'registrar_embalaje']) {
    const i = sql.indexOf('function public.prod_rpc_' + r);
    const cuerpo = i >= 0 ? sql.slice(i, i + 9000) : '';
    check(`prod_rpc_${r} exige turno abierto`, /prod_fn_exigir_turno/.test(cuerpo), r);
    check(`prod_rpc_${r} guarda el turno_id de la carga`, /turno_id/.test(cuerpo), r);
  }

  /* 0147 revocó esta función a propósito: sin el revoke, cualquier logueado
     libera las reservas de cualquier jornada. Al cambiarle la firma hay que
     volver a revocarla — la nueva firma no hereda el revoke de la vieja. */
  check('prod_fn_liberar_jornada_reservas(uuid, text) sigue revocada',
        /revoke execute on function public\.prod_fn_liberar_jornada_reservas\(uuid,\s*text\)\s+from\s+public,\s*anon,\s*authenticated/i.test(sql));

  check('el cierre de un sector no libera las reservas de los otros',
        /prod_fn_liberar_jornada_reservas\(v_t\.jornada_id,\s*v_sector\)/.test(sql));

  check('get_jornada_hoy es determinista (order by, no "cualquiera de las abiertas")',
        /from public\.prod_jornada[\s\S]{0,200}order by \(estado = 'abierta'\) desc/.test(sql));

  check('prod_jornada_sector va a realtime (si no, el chip queda congelado)',
        /alter publication supabase_realtime add table public\.prod_jornada_sector/i.test(sql));

  check('la vista de turnos respeta la RLS del que consulta (security_invoker, hardening 0125)',
        /create or replace view public\.prod_v_turnos with \(security_invoker = true\)/i.test(sql));

  check('prod_jornada_sector tiene RLS activa',
        /alter table public\.prod_jornada_sector enable row level security/i.test(sql));
}


/* ══ G · el tablero del encargado ═══════════════════════════════════════
   La otra mitad del agujero: si el de CNC no abre su jornada, sus cargas se rechazan todo el
   día. El operario lo ve en su pantalla; el encargado, hasta ahora, no veía nada. */
console.log('\n[G · tablero de turnos del encargado]');

const { LpTurnosStrip, lpNeutralMsg, lpDesdeHace } = dom.window.__kit;

check('lpDesdeHace habla en criollo, no en timestamps',
      lpDesdeHace(new Date(Date.now() - 3.5 * 3600 * 1000).toISOString()) === '3 h 30 min'
      && lpDesdeHace(new Date(Date.now() - 45 * 60000).toISOString()) === '45 min'
      && lpDesdeHace(null) === '',
      lpDesdeHace(new Date(Date.now() - 3.5 * 3600 * 1000).toISOString()));

check('con el turno cerrado el mensaje neutro no manda a esperar al encargado',
      !/encargado/i.test(lpNeutralMsg({ abierto:false, sectorLabel:'CNC' }).sub),
      lpNeutralMsg({ abierto:false, sectorLabel:'CNC' }).sub);

/* cnc trabajando · embalaje trabajando · melamina cerró hace rato · pino NUNCA abrió hoy */
let stripSectores = [
  { sector:'cnc',      abierta:true,  turno_id:'t1', abierta_at:new Date(Date.now() - 2*3600*1000).toISOString(), abierta_por_nombre:'Seba',  ultimo_cierre:null },
  { sector:'embalaje', abierta:true,  turno_id:'t2', abierta_at:new Date(Date.now() - 30*60000).toISOString(),   abierta_por_nombre:'Mauro', ultimo_cierre:null },
  { sector:'melamina', abierta:false, turno_id:null, ultimo_cierre:new Date(Date.now() - 5*3600*1000).toISOString() },
  { sector:'pino',     abierta:false, turno_id:null, ultimo_cierre:null },
];
const stripLlamadas = [];
dom.window.LP_DATA.sectorEstado = async () => ({ sectores: stripSectores, hay_jornada_demanda:true });
dom.window.LP_DATA.sectorAbrir  = async (p) => {
  stripLlamadas.push(['abrir', p]);
  stripSectores = stripSectores.map(x => x.sector === p.sector
    ? Object.assign({}, x, { abierta:true, turno_id:'nuevo', abierta_at:new Date().toISOString(), abierta_por_nombre:'Encargado' })
    : x);
  return { ok:true };
};
dom.window.LP_DATA.sectorCerrar = async (p) => {
  stripLlamadas.push(['cerrar', p]);
  stripSectores = stripSectores.map(x => x.sector === p.sector
    ? Object.assign({}, x, { abierta:false, turno_id:null, ultimo_cierre:new Date().toISOString() })
    : x);
  return { ok:true };
};
const cerrados = () => stripLlamadas.filter(l => l[0] === 'cerrar').length;

const U_FAKE = { ink:'#000', inkSoft:'#555', inkMuted:'#888', surface:'#fff', surface2:'#eee',
                 border:'#ddd', accent:'#2E4057', accentSoft:'#eef', accentLine:'#ccd',
                 ok:'#16A34A', warn:'#D97706', danger:'#DC2626' };

async function montarStrip(puedeGestionar) {
  if (root) await act(async () => root.unmount());
  root = ReactDOMClient.createRoot(container);
  await act(async () => {
    root.render(React.createElement(LpTurnosStrip, {
      U: U_FAKE, toast: { success(){}, error(){}, info(){} }, puedeGestionar,
    }));
  });
  await flush();
}

await montarStrip(true);

check('el tablero dice cuántos sectores están trabajando',
      /2 de 4 sectores/.test(txt()), txt().slice(0, 200));

check('muestra quién abrió y desde hace cuánto',
      /Seba/.test(txt()) && /2 h/.test(txt()), txt().slice(0, 400));

/* Este check es el que justifica la pantalla entera. */
check('el sector que NUNCA abrió hoy sale marcado, no como uno más que está cerrado',
      /Sin abrir todavía/i.test(txt()) && /no puede cargar producción/i.test(txt()),
      txt().slice(0, 600));

check('el que cerró normal se distingue del que nunca abrió',
      /último cierre hace 5 h/i.test(txt()), txt().slice(0, 600));

const antesAbrir = stripLlamadas.length;
await click(botones('Abrir por él')[0]);
check('abrir por el operario llama a sectorAbrir con ese sector',
      stripLlamadas.length === antesAbrir + 1 && stripLlamadas[antesAbrir][0] === 'abrir',
      JSON.stringify(stripLlamadas));
check('y el tablero refleja el cambio (no se queda diciendo "sin abrir")',
      /3 de 4 sectores/.test(txt()), txt().slice(0, 200));

const antesCerrarStrip = cerrados();
await click(botones('Cerrar por él')[0]);
check('cerrar el turno de otro pregunta antes',
      cerrados() === antesCerrarStrip && /cierra el turno de otra persona/i.test(txt()),
      txt().slice(0, 400));
await click(botones('Sí, cerrar')[0]);
check('al confirmar sí lo cierra', cerrados() === antesCerrarStrip + 1);

await montarStrip(false);
check('un operario común ve el tablero pero no puede tocar el turno ajeno',
      botones('Abrir por él').length === 0 && botones('Cerrar por él').length === 0
      && /sectores con la jornada abierta/i.test(txt()), txt().slice(0, 200));

for (const b of ['web', 'mobile']) {
  const enc = fs.readFileSync(path.join(ROOT, b, 'components', 'encargado-panel.jsx'), 'utf8');
  check(`${b}: el panel del encargado muestra el tablero de turnos`,
        /<LpTurnosStrip\s/.test(enc), b);
}

console.log(`\n${pass} ok · ${fail} fail`);
process.exit(fail ? 1 : 0);

})().catch(e => { console.error(e); process.exit(2); });
