/* ══ Día operativo — que la producción sin jornada de demanda no desaparezca ══
   node tests/dia-operativo-test.js "<ROOT>" web|mobile

   QUÉ ARREGLA ESTO Y POR QUÉ NECESITA UN TEST
   ───────────────────────────────────────────
   La 0173 separó el turno de cada sector de la jornada de demanda, que es lo
   que Seba pidió: "capaz el de melamina trabajó y no trabajó el de patas".
   Pero dejó un agujero.

   Con el turno del sector abierto y NINGUNA jornada de demanda abierta, las
   RPC de carga resuelven así:

       v_jornada := coalesce(nullif(payload->>'jornada_id','')::uuid,
                             prod_fn_jornada_lp_abierta());     -- → NULL

   La fila se escribe con jornada_id = NULL. El operario ve "Cargado ✓", el
   stock sube de verdad… y todo lo que lee producción filtra por jornada_id:

       · la pantalla del sector, cuando cierra el turno
       · el panel del encargado
       · prod_rpc_dashboard
       · el resumen del cierre de jornada
       · prod_rpc_director_historico y su Excel  ← para siempre

   O sea: la carga existe en la base y no existe en ninguna pantalla. Es
   exactamente el bug que este repo persigue —una acción que dice que
   funcionó y no tiene efecto visible— y además es una REGRESIÓN: antes de
   la 0173 la RPC tiraba error duro y no escribía nada.

   La 0175 no mueve dónde se escribe (el turno es independiente de la jornada
   a propósito, por decisión del dueño). Le pone `fecha` al turno y hace que
   todo lo que agrega lea "lo de la jornada MÁS lo huérfano de ese día".

   Cinco partes:

     A · ESTÁTICO, la migración 0175 — la columna, las cuatro vistas por día,
         y las cuatro funciones que agregan contando también lo huérfano.

     B · lpDia — el ámbito de lectura. Con turno propio lista el turno; sin
         turno lista el día; si la vista todavía no existe (la 0175 la aplica
         el dueño a mano) se cae al filtro viejo en vez de dejar la pantalla
         en blanco.

     C · RENDER, la pantalla del sector — con el turno cerrado y sin jornada
         de demanda, lo cargado en el día TIENE que verse. Y el cartel neutro
         dejó de tapar las cargas.

     D · RENDER, el tablero del encargado — "sin abrir todavía" se decide por
         si abrió HOY. Antes miraba el último cierre de toda la historia: al
         segundo día de uso la alarma más importante del panel se apagaba
         sola y no volvía a encenderse nunca.

     E · PARIDAD — web y mobile tienen que traer lo mismo, y los dos HTML el
         mismo ?v=. Un ?v= desparejo hace que una tablet lea la mitad vieja
         y la mitad nueva del mismo cambio.
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

console.log(`\n═══ ${VARIANT.toUpperCase()} · día operativo (0175)\n`);

const DIA = '2026-09-09';

/* ══ A · ESTÁTICO — la migración 0175 ═══════════════════════════════════ */
console.log('[A · estático — migración 0175]');

const MIG = path.join(ROOT, 'supabase', 'migrations', '0175_produccion_sin_jornada_de_demanda.sql');
check('existe la migración 0175', fs.existsSync(MIG), MIG);

/* Corta el cuerpo de UNA función, hasta el $fn$ que la cierra. Un slice de largo fijo
   se mete en la función siguiente y hace pasar checks por vecindad. */
function cuerpoFn(sql, nombre) {
  const i = sql.indexOf('function public.' + nombre);
  if (i < 0) return '';
  const ini = sql.indexOf('$fn$', i);
  if (ini < 0) return '';
  const fin = sql.indexOf('$fn$', ini + 4);
  return fin < 0 ? sql.slice(i) : sql.slice(i, fin + 4);
}

if (fs.existsSync(MIG)) {
  const sql = fs.readFileSync(MIG, 'utf8');

  /* El ancla de todo: sin fecha en el turno, no hay forma de saber a qué día
     pertenece una carga que no tiene jornada. */
  check('el turno de sector gana una fecha',
        /alter table public\.prod_jornada_sector\s+add column if not exists fecha date/i.test(sql), 'A1');
  check('la fecha del turno se completa para los turnos que ya existían',
        /update public\.prod_jornada_sector set fecha = abierta_at::date where fecha is null/i.test(sql), 'A2');
  check('la fecha del turno queda obligatoria y con default',
        /alter column fecha set default current_date/i.test(sql)
        && /alter column fecha set not null/i.test(sql), 'A3');

  for (const v of ['corte', 'melamina', 'pino', 'embalaje']) {
    const vista = 'prod_v_' + v + '_dia';
    check(`${vista} existe y respeta la RLS del que consulta (hardening 0125)`,
          new RegExp('create or replace view public\\.' + vista + ' with \\(security_invoker = true\\)', 'i').test(sql), vista);
    check(`${vista} no queda expuesta a anon`,
          new RegExp('revoke all on public\\.' + vista + '[\\s\\S]{0,80}from public, anon', 'i').test(sql)
          && new RegExp('grant select on public\\.' + vista + '\\s+to authenticated', 'i').test(sql), vista);
  }

  /* El orden del coalesce importa: jornada PRIMERO. Si el turno mandara, una fila con
     jornada podría cambiar de día y el histórico dejaría de cuadrar con lo que ya
     mostraba. Así el arreglo sólo AGREGA filas, nunca mueve las que ya se contaban. */
  const coalesces = sql.match(/coalesce\((\w+)\.fecha,\s*(\w+)\.fecha,\s*\w+\.created_at::date\)\s+as dia/g) || [];
  check('las cuatro vistas resuelven el día jornada → turno → created_at',
        coalesces.length === 4, 'encontradas: ' + coalesces.length);
  check('la jornada manda sobre el turno (el arreglo suma filas, no las mueve de día)',
        /coalesce\(jj\.fecha,\s*ts\.fecha/.test(sql) && !/coalesce\(ts\.fecha,\s*jj\.fecha/.test(sql), 'A4');

  /* Las cuatro funciones que agregan. Cada una tiene que contar lo huérfano del día. */
  const dash = cuerpoFn(sql, 'prod_rpc_dashboard');
  check('prod_rpc_dashboard existe en la 0175', dash.length > 0);
  check('el dashboard cuenta también lo cargado sin jornada de demanda',
        /jornada_id is null and x\.dia = v_dia/.test(dash), 'A5');
  check('el dashboard lee las vistas por día, no las tablas peladas',
        /prod_v_corte_dia/.test(dash) && /prod_v_melamina_dia/.test(dash)
        && /prod_v_pino_dia/.test(dash) && /prod_v_embalaje_dia/.test(dash), 'A6');
  /* Que el encargado vea CUÁNTO quedó suelto: si no, arregla el síntoma y nunca se
     entera de que alguien está trabajando sin jornada abierta. */
  check('el dashboard avisa cuántas cargas quedaron sin jornada',
        /'sin_jornada_demanda'/.test(dash), 'A7');

  const cierre = cuerpoFn(sql, 'prod_rpc_cerrar_jornada');
  check('prod_rpc_cerrar_jornada existe en la 0175', cierre.length > 0);
  check('el resumen del cierre incluye lo huérfano del día',
        /jornada_id is null and x\.dia = v_fecha/.test(cierre), 'A8');
  check('y lo muestra aparte, para que el encargado sepa que pasó',
        /'resumen_sin_jornada'/.test(cierre), 'A9');

  const hist = cuerpoFn(sql, 'prod_rpc_director_historico');
  check('prod_rpc_director_historico existe en la 0175', hist.length > 0);
  /* Éste es el que no se puede recuperar después: el Excel del director sale de acá.
     Con el INNER JOIN contra prod_jornada, la carga sin jornada se perdía para siempre. */
  check('el histórico ya no pierde filas por el join con la jornada',
        !/join public\.prod_jornada\s+jj\s+on jj\.id =/i.test(hist), 'A10');
  check('el histórico lee las vistas por día',
        /prod_v_corte_dia/.test(hist) && /prod_v_embalaje_dia/.test(hist), 'A11');
  /* Los días del gráfico salen de la unión: si sólo saliera de prod_jornada, un día
     entero de trabajo sin jornada de demanda no aparecería ni como columna vacía. */
  check('los días del histórico salen de la jornada UNION los turnos de sector',
        /from prod_jornada\s+where fecha between[\s\S]{0,120}union[\s\S]{0,120}from prod_jornada_sector/i.test(hist), 'A12');

  const sest = cuerpoFn(sql, 'prod_rpc_sector_estado');
  check('prod_rpc_sector_estado existe en la 0175', sest.length > 0);
  check('sector_estado publica el día operativo (y nunca null)',
        /'fecha_operativa', v_dia/.test(sest) && /v_dia := coalesce\(v_fecha, current_date\)/.test(sest), 'A13');
  for (const k of ['abrio_hoy', 'ultimo_cierre_hoy', 'ultimo_turno_id', 'turno_de_otro_dia']) {
    check(`sector_estado publica ${k}`, new RegExp("'" + k + "'").test(sest), k);
  }
  /* `ultimo_cierre` sigue existiendo: lo usa el "cerró hace 3 h". Lo que NO puede pasar
     es que se siga usando para decidir si el sector trabajó hoy. */
  check('sector_estado conserva ultimo_cierre para el "hace 3 h"',
        /'ultimo_cierre'/.test(sest), 'A14');

  /* `create or replace view` no sirve acá: la vista GANA una columna y Postgres solo deja
     reemplazar si la lista de columnas empieza igual y no cambia de tipo. Por eso la
     migración hace drop + create (sin cascade, para que si algo dependiera de la vista
     reviente en el momento de aplicar y no en silencio). El regex pedía la forma que
     justamente no se puede usar: la migración estaba bien y el check estaba mal. */
  check('prod_v_turnos se recrea entera (drop + create), no "or replace"',
        /drop view if exists public\.prod_v_turnos\s*;/i.test(sql), 'A15a');
  check('prod_v_turnos trae la fecha del turno (si no, no se puede filtrar por día)',
        /create (or replace )?view public\.prod_v_turnos with \(security_invoker = true\)[\s\S]{0,900}t\.fecha/i.test(sql), 'A15');

  /* Cluster 4: dos SECURITY DEFINER que la 0173 dejó sin revoke. Cualquier logueado
     podía llamarlas directo. No filtran datos ajenos, pero la regla del repo desde la
     0125 es que ninguna función interna quede ejecutable por el rol de la app. */
  check('prod_fn_jornada_lp_abierta queda revocada (la 0173 se la olvidó)',
        /revoke execute on function public\.prod_fn_jornada_lp_abierta\(\)\s+from public, anon, authenticated/i.test(sql), 'A16');
  check('prod_fn_sector_de_rol queda revocada (la 0173 se la olvidó)',
        /revoke execute on function public\.prod_fn_sector_de_rol\(public\.role_enum\)\s+from public, anon, authenticated/i.test(sql), 'A17');

  check('la migración es atómica (o entra entera o no entra)',
        /^\s*begin;/m.test(sql) && /^\s*commit;/m.test(sql), 'A18');
}


/* ══ Montaje del kit ════════════════════════════════════════════════════ */
const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.IS_REACT_ACT_ENVIRONMENT = true;

const ReactDOMClient = require('react-dom/client');
const { act } = require('react');


/* ══ B · lpDia — el ámbito de lectura ═══════════════════════════════════
   Se evalúa lp-data.jsx de verdad contra un Supabase falso que anota tabla,
   columnas y filtros. Lo que importa no es lo que devuelve: es CONTRA QUÉ
   consulta. Una pantalla puede verse bien leyendo del lugar equivocado. */
console.log('\n[B · lpDia — contra qué consulta]');

const consultas = [];
let vistasExisten = true;

function fakeQuery(tabla, cols) {
  const q = {
    tabla, cols, filtros: {},
    eq(col, val) { this.filtros[col] = val; return this; },
    order() { return this; },
    limit() { return this; },
    then(res, rej) {
      consultas.push({ tabla: this.tabla, cols: this.cols, filtros: this.filtros });
      /* Mientras el dueño no aplique la 0175, la vista no existe y PostgREST
         contesta 42P01. La pantalla no puede quedarse en blanco por eso. */
      if (!vistasExisten && /_dia$/.test(this.tabla)) {
        return Promise.resolve({ data: null, error: { message: 'relation "' + this.tabla + '" does not exist' } }).then(res, rej);
      }
      return Promise.resolve({ data: [{ id: 'r1' }], error: null }).then(res, rej);
    },
  };
  return q;
}

dom.window.SUPA = { from: (t) => ({ select: (c) => fakeQuery(t, c) }) };
delete dom.window.LP_DATA;
new Function('window', 'document',
  Babel.transform(fs.readFileSync(path.join(BASE, 'lp-data.jsx'), 'utf8'),
                  { presets: ['react'], filename: 'lp-data.jsx' }).code
)(dom.window, dom.window.document);

const LP = dom.window.LP_DATA;
const ultimaConsulta = () => consultas[consultas.length - 1] || {};

(async () => {

consultas.length = 0;
await LP.cortesDia({ turno_id: 'T1', jornada_id: 'J1', dia: DIA });
check('con turno propio lista EL turno (no el día, no la jornada)',
      ultimaConsulta().tabla === 'prod_corte' && ultimaConsulta().filtros.turno_id === 'T1'
      && ultimaConsulta().filtros.dia === undefined,
      JSON.stringify(ultimaConsulta()));

consultas.length = 0;
await LP.cortesDia({ turno_id: null, jornada_id: null, dia: DIA });
check('sin turno y sin jornada lista EL DÍA (antes devolvía [] sin consultar)',
      ultimaConsulta().tabla === 'prod_v_corte_dia' && ultimaConsulta().filtros.dia === DIA,
      JSON.stringify(ultimaConsulta()));
check('y pide la columna dia, si no el filtro sería sobre una columna que no trajo',
      /\bdia\b/.test(ultimaConsulta().cols || ''), ultimaConsulta().cols);

consultas.length = 0;
await LP.melaminaDia({ dia: DIA });
const t2 = ultimaConsulta().tabla;
await LP.pinoDia({ dia: DIA });
const t3 = ultimaConsulta().tabla;
await LP.embalajeDia({ dia: DIA });
check('los cuatro sectores leen su vista por día',
      t2 === 'prod_v_melamina_dia' && t3 === 'prod_v_pino_dia'
      && ultimaConsulta().tabla === 'prod_v_embalaje_dia',
      [t2, t3, ultimaConsulta().tabla].join(' · '));

/* El caso del deploy a medias: código nuevo, migración vieja. */
vistasExisten = false;
consultas.length = 0;
const conFallback = await LP.cortesDia({ dia: DIA, jornada_id: 'J1' });
check('si la vista todavía no existe, se cae al filtro por jornada en vez de morir',
      consultas.length === 2 && ultimaConsulta().tabla === 'prod_corte'
      && ultimaConsulta().filtros.jornada_id === 'J1' && conFallback.length === 1,
      JSON.stringify(consultas));

/* Y si NO hay a qué caer, el error tiene que subir. Una lista vacía silenciosa se lee
   como "hoy no se produjo nada", que es la mentira que este arreglo vino a sacar. */
let tiro = false;
try { await LP.cortesDia({ dia: DIA }); } catch (e) { tiro = true; }
check('sin jornada a la que caer, el error sube (no miente con una lista vacía)', tiro);
vistasExisten = true;

consultas.length = 0;
const vacio = await LP.cortesDia({});
check('sin ámbito ninguno sigue sin consultar (no trae la tabla entera como "lo tuyo")',
      consultas.length === 0 && vacio.length === 0, JSON.stringify(consultas));


/* ══ C · RENDER — la pantalla del sector ════════════════════════════════ */
console.log('\n[C · render — la pantalla del sector]');

const preamble = `
  const { useState, useEffect, useRef, useMemo, useCallback, createContext, useContext } = React;
  const Icon = ({ n, s, c }) => React.createElement('i', { 'data-icon': n });
  const TOAST = { error(){}, success(){}, info(){}, warning(){} };
  const useToast = () => TOAST;
`;

const fuentes = ['lp-ui.jsx', 'cnc-sector.jsx'].map(f => {
  const p = path.join(BASE, f);
  return Babel.transform(fs.readFileSync(p, 'utf8'), { presets: ['react'], filename: p }).code;
});
/* lp-ui.jsx no exporta a window (en el browser todo comparte un único scope global).
   El test sí lo necesita, así que se lo agrega acá en vez de ensuciar el archivo de
   producción con exports que sólo existirían para los tests. */
const epilogo = ';window.__kit = { LpTurnosStrip, LpTurnosHistorial, LpNeutral, LpTurnoOtroDia, lpNeutralMsg };';
new Function('React', 'window', 'document', preamble + fuentes.join('\n;\n') + epilogo)(
  React, dom.window, dom.window.document);

const CncSector = dom.window.CncSector;
if (typeof CncSector !== 'function') { console.error('No se exportó CncSector'); process.exit(2); }
const { LpTurnosStrip, LpTurnosHistorial } = dom.window.__kit;

const container = dom.window.document.getElementById('root');
const txt = () => container.textContent.replace(/\s+/g, ' ');
const $$ = (sel) => Array.from(container.querySelectorAll(sel));
const botones = (t) => $$('button').filter(b => (b.textContent || '').toLowerCase().includes(t.toLowerCase()));
const flush = async () => {
  for (let i = 0; i < 12; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
};
const click = async (el) => {
  await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  await flush();
};

const U_FAKE = { ink:'#000', inkSoft:'#555', inkMuted:'#888', surface:'#fff', surface2:'#eee',
                 border:'#ddd', accent:'#2E4057', accentSoft:'#eef', accentLine:'#ccd',
                 accentText:'#2E4057', ok:'#16A34A', warn:'#D97706', danger:'#DC2626' };

/* Escenario exacto del bug: turno de CNC CERRADO, NINGUNA jornada de demanda,
   y dos cortes cargados hoy mientras el turno estaba abierto. */
let escen = { abierta:false, turno_de_otro_dia:false, abrio_hoy:true, hayDemanda:false };
const pedidos = [];
const CORTES = [
  { id:'c1', placa_sku:'PLB001', hojas:4, desperdicio:0, created_at:new Date().toISOString(), dia:DIA },
  { id:'c2', placa_sku:'PLB001', hojas:3, desperdicio:1, created_at:new Date().toISOString(), dia:DIA },
];

dom.window.LP_DATA = {
  subscribe: () => () => {},
  sectorEstado: async () => ({
    mi_sector: 'cnc',
    jornada_id: escen.hayDemanda ? 'J1' : null,
    fecha: escen.hayDemanda ? DIA : null,
    fecha_operativa: DIA,
    hoy: DIA,
    hay_jornada_demanda: escen.hayDemanda,
    sectores: ['cnc', 'melamina', 'pino', 'embalaje'].map(s => ({
      sector: s,
      abierta: s === 'cnc' ? escen.abierta : false,
      turno_id: (s === 'cnc' && escen.abierta) ? 'T1' : null,
      abierta_at: (s === 'cnc' && escen.abierta) ? new Date(Date.now() - 2*3600*1000).toISOString() : null,
      fecha: (s === 'cnc' && escen.abierta) ? (escen.turno_de_otro_dia ? '2026-09-08' : DIA) : null,
      turno_de_otro_dia: s === 'cnc' ? escen.turno_de_otro_dia : false,
      abrio_hoy: s === 'cnc' ? escen.abrio_hoy : false,
      ultimo_cierre: null, ultimo_cierre_hoy: null, ultimo_turno_id: null, turnos_hoy: 0,
    })),
  }),
  sectorAbrir: async () => ({ ok:true }),
  sectorCerrar: async () => ({ ok:true, resumen:{} }),
  jornadaHoy: async () => (escen.hayDemanda ? { jornada_id:'J1', fecha:DIA, estado:'abierta' } : null),
  cortesDia: async (a) => { pedidos.push(a); return CORTES; },
  ventasVinculadas: async () => [],
  resumenDia: async () => [],
  placas: async () => [{ sku:'PLB001', nombre:'Placa blanca 18', material:'Melamina', rendimiento:6 }],
  registrarCorte: async () => ({ piezas_generadas:6 }),
  turnos: async () => [],
};

let root;
async function montar(Comp, props) {
  if (root) await act(async () => root.unmount());
  root = ReactDOMClient.createRoot(container);
  await act(async () => { root.render(React.createElement(Comp, props || undefined)); });
  await flush();
}

pedidos.length = 0;
await montar(CncSector);
const ped = pedidos[pedidos.length - 1] || {};
check('con el turno cerrado y sin jornada de demanda, la pantalla pide EL DÍA',
      ped.dia === DIA, JSON.stringify(ped));
/* El corazón del asunto: antes esto era una pantalla vacía con un cartel gris. */
check('y lo cargado hoy se ve (antes: "todavía no cargaste nada" con el stock ya subido)',
      /Placa blanca 18/.test(txt()) || /PLB001/.test(txt()), txt().slice(0, 400));
check('el aviso de turno cerrado sigue estando (podés mirar, no cargar)',
      /Tu jornada de CNC está cerrada/i.test(txt()), txt().slice(0, 300));

/* Turno ABIERTO, sin demanda, con cargas: el cartel neutro no puede tapar las cargas. */
escen = { abierta:true, turno_de_otro_dia:false, abrio_hoy:true, hayDemanda:false };
await montar(CncSector);
check('el cartel "todavía sin pedidos vinculados" ya no REEMPLAZA tus cargas',
      /todavía sin pedidos vinculados/i.test(txt())
      && (/Placa blanca 18/.test(txt()) || /PLB001/.test(txt())),
      txt().slice(0, 500));

/* Turno colgado de ayer: se avisa, no se cierra solo. Cerrarle el turno al que hace
   el turno noche le partiría el trabajo al medio. */
escen = { abierta:true, turno_de_otro_dia:true, abrio_hoy:false, hayDemanda:false };
await montar(CncSector);
check('avisa cuando el turno viene abierto de otro día',
      /viene abierta/i.test(txt()) && /2026-09-08/.test(txt()), txt().slice(0, 500));
check('y explica la consecuencia (lo de hoy se cuenta en ese día)',
      /se cuenta en ese día/i.test(txt()), txt().slice(0, 600));


/* ══ D · RENDER — el tablero del encargado ══════════════════════════════ */
console.log('\n[D · render — el tablero del encargado]');

/* melamina cerró hace 5 h PERO fue ayer: hoy no abrió. Éste es el caso que la 0173
   pintaba como "Cerrada · último cierre hace 5 h", o sea igual que el que trabajó
   toda la mañana y se fue. La alarma se apagaba sola para siempre. */
const stripSectores = [
  { sector:'cnc', abierta:true, turno_id:'t1', abierta_at:new Date(Date.now() - 2*3600*1000).toISOString(),
    abierta_por_nombre:'Seba', abrio_hoy:true, ultimo_cierre:null, ultimo_cierre_hoy:null },
  { sector:'melamina', abierta:false, turno_id:null, abrio_hoy:false,
    ultimo_cierre:new Date(Date.now() - 29*3600*1000).toISOString(), ultimo_cierre_hoy:null },
  { sector:'pino', abierta:false, turno_id:null, abrio_hoy:true,
    ultimo_cierre:new Date(Date.now() - 5*3600*1000).toISOString(),
    ultimo_cierre_hoy:new Date(Date.now() - 5*3600*1000).toISOString() },
  { sector:'embalaje', abierta:false, turno_id:null, abrio_hoy:false, ultimo_cierre:null, ultimo_cierre_hoy:null },
];
dom.window.LP_DATA.sectorEstado = async () => ({ sectores: stripSectores, hay_jornada_demanda:false, fecha_operativa:DIA });

await montar(LpTurnosStrip, { U: U_FAKE, toast:{ success(){}, error(){}, info(){} }, puedeGestionar:false });

check('el que cerró AYER y hoy no abrió sale marcado, aunque tenga un cierre viejo',
      (txt().match(/Sin abrir todavía/gi) || []).length === 2, txt().slice(0, 600));
check('el que abrió y cerró hoy se sigue distinguiendo (cerró hace 5 h)',
      /último cierre hace 5 h/i.test(txt()), txt().slice(0, 600));
check('el tablero aclara que "jornada de demanda" es otra cosa que el turno del sector',
      /jornada de demanda/i.test(txt()) && /pueden trabajar igual/i.test(txt()), txt().slice(0, 600));

/* El historial: `prod_v_turnos` y LP_DATA.turnos() existían desde la 0173 sin una sola
   pantalla que los mostrara. Una capacidad sin pantalla no existe para el que trabaja. */
dom.window.LP_DATA.turnos = async (p) => {
  pedidos.push(['turnos', p]);
  return [{ id:'t9', sector:'cnc', fecha:DIA, estado:'cerrada', horas:6.5,
            abierta_at:new Date(Date.now() - 8*3600*1000).toISOString(),
            cerrada_at:new Date(Date.now() - 1.5*3600*1000).toISOString(),
            abierta_por_nombre:'Seba', resumen:{ cortes:4, hojas:12 } }];
};
await montar(LpTurnosHistorial, { U: U_FAKE, limite: 20 });
check('el historial de turnos arranca plegado (no le tira 30 filas encima al encargado)',
      !/Seba/.test(txt()) && botones('Historial de turnos').length === 1, txt().slice(0, 300));
await click(botones('Historial de turnos')[0]);
check('abierto, muestra quién abrió, cuánto duró y qué produjo',
      /Seba/.test(txt()) && /6\.5 h/.test(txt()) && /cortes 4/.test(txt()), txt().slice(0, 500));


/* ══ E · ESTÁTICO — que no quede la mitad del arreglo ═══════════════════ */
console.log('\n[E · estático — pantallas y paridad]');

const src = {};
for (const f of ['lp-data.jsx', 'lp-ui.jsx', 'cnc-sector.jsx', 'melamina-sector.jsx',
                 'pino-sector.jsx', 'embalaje-sector.jsx', 'encargado-panel.jsx']) {
  src[f] = fs.readFileSync(path.join(BASE, f), 'utf8');
}

for (const f of ['cnc-sector.jsx', 'melamina-sector.jsx', 'pino-sector.jsx', 'embalaje-sector.jsx']) {
  check(`${f}: con el turno cerrado cae al día, no a la jornada`,
        /\{ dia: diaOper, jornada_id:/.test(src[f]), f);
  check(`${f}: el día operativo lo dice el backend, no el reloj del dispositivo`,
        /turno\.fechaOperativa/.test(src[f]) && !/new Date\(\)\.toISOString\(\)\.slice\(0, ?10\)/.test(src[f]), f);
  /* Si `diaOper` no está en las dependencias, la pantalla se queda con el día que leyó
     la primera vez: a la medianoche sigue mostrando lo de ayer como si fuera hoy. */
  check(`${f}: recarga cuando cambia el día operativo`,
        /\}, \[toast, turnoId, diaOper\]\);/.test(src[f]), f);
  check(`${f}: el cartel neutro dejó de tapar lo que ya cargaste`,
        /if \(neu && !\((cortes|registros) \|\| \[\]\)\.length\) return <LpNeutral/.test(src[f]), f);
  check(`${f}: avisa si el turno viene abierto de otro día`,
        /<LpTurnoOtroDia\s/.test(src[f]), f);
}

check('el panel del encargado lee producción por día, no sólo por jornada de demanda',
      /const dia = \(se && se\.fecha_operativa\)/.test(src['encargado-panel.jsx'])
      && !/window\.LP_DATA\.cortesDia\(jid\)/.test(src['encargado-panel.jsx']), 'E1');
check('el panel se refresca cuando alguien abre o cierra un turno',
      /'prod_jornada_sector'/.test(src['encargado-panel.jsx']), 'E2');
check('cada tarjeta de sector muestra SU turno, no el estado de la jornada de demanda',
      /sectEstado/.test(src['encargado-panel.jsx']) && /estadoDe\(s\.id\)/.test(src['encargado-panel.jsx']), 'E3');
check('el panel deja ver el historial de turnos',
      /<LpTurnosHistorial\s/.test(src['encargado-panel.jsx']), 'E4');
/* Cluster 12: "jornada" nombraba el turno del sector Y la jornada de demanda en la
   misma pantalla. Con el mismo nombre para las dos, "abrir la jornada" no decía nada. */
check('el botón de la topbar dice qué jornada abre',
      /Cerrar demanda' : 'Abrir demanda/.test(src['encargado-panel.jsx'])
      && !/'Cerrar jornada' : 'Abrir jornada'/.test(src['encargado-panel.jsx']), 'E5');

check('lp-ui.jsx define el aviso de turno de otro día',
      /function LpTurnoOtroDia\s*\(/.test(src['lp-ui.jsx']), 'E6');
check('lp-ui.jsx define el historial de turnos',
      /function LpTurnosHistorial\s*\(/.test(src['lp-ui.jsx']), 'E7');
check('useLpTurno expone el día operativo y si el sector abrió hoy',
      /fechaOperativa:/.test(src['lp-ui.jsx']) && /abrioHoy:/.test(src['lp-ui.jsx'])
      && /turnoDeOtroDia:/.test(src['lp-ui.jsx']), 'E8');
/* El fallback importa: el dueño aplica las migraciones a mano, así que hay una ventana
   en la que corre el código nuevo contra la base vieja. */
check('el tablero sigue funcionando mientras la 0175 no esté aplicada',
      /t\.abrio_hoy !== undefined \? t\.abrio_hoy : !!t\.ultimo_cierre/.test(src['lp-ui.jsx']), 'E9');
check('lp-data.jsx mapea cada tabla a su vista por día',
      /LP_VISTA_DIA/.test(src['lp-data.jsx'])
      && /prod_corte:\s*'prod_v_corte_dia'/.test(src['lp-data.jsx']), 'E10');

/* Paridad: el mobile tiene que traer lo mismo. La regla del proyecto es "experiencia
   premium también en el teléfono, SIN QUITAR NINGUNA FUNCIÓN". */
const OTRA = path.join(ROOT, VARIANT === 'web' ? 'mobile' : 'web', 'components');
for (const f of ['lp-data.jsx', 'lp-ui.jsx', 'cnc-sector.jsx', 'melamina-sector.jsx',
                 'pino-sector.jsx', 'embalaje-sector.jsx', 'encargado-panel.jsx']) {
  const otro = fs.readFileSync(path.join(OTRA, f), 'utf8');
  const marcas = ['LP_VISTA_DIA', 'fechaOperativa', 'LpTurnoOtroDia', 'LpTurnosHistorial',
                  'diaOper', 'sectEstado', 'abrio_hoy'];
  const faltan = marcas.filter(m => src[f].includes(m) !== otro.includes(m));
  check(`${f}: web y mobile traen lo mismo`, faltan.length === 0, faltan.join(', '));
}

/* Sin bump de ?v=, la tablet del taller sigue corriendo el archivo viejo desde su caché
   y el deploy no existe para ella. Y si los dos HTML no coinciden, peor: mitad y mitad. */
const htmlWeb = fs.readFileSync(path.join(ROOT, 'web', 'Macario Lite.html'), 'utf8');
const htmlMob = fs.readFileSync(path.join(ROOT, 'mobile', 'index.html'), 'utf8');
const ver = (html, f) => {
  const m = html.match(new RegExp(f.replace('.', '\\.') + '\\?v=(\\d+)'));
  return m ? m[1] : null;
};
for (const f of ['lp-data.jsx', 'lp-ui.jsx', 'cnc-sector.jsx', 'melamina-sector.jsx',
                 'pino-sector.jsx', 'embalaje-sector.jsx', 'encargado-panel.jsx']) {
  const a = ver(htmlWeb, f), b = ver(htmlMob, f);
  check(`${f}: los dos HTML piden la misma versión`, a !== null && a === b, `web=${a} mobile=${b}`);
}

console.log(`\n${pass} ok · ${fail} fail\n`);
process.exit(fail ? 1 : 0);

})();
