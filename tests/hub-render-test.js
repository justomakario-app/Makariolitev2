/* Render real (jsdom + React 18.3.1 + Babel 7.29.0, mismas versiones que el browser)
   de produccion-hub.jsx web y mobile. Verifica que la LP quedó ANIDADA:
   - el hub muestra sólo 4 tabs (Producción / Stock / De fábrica / Línea productiva)
   - dentro de "Línea productiva" están las 6 sub-tabs (3 para roles sin stock)
   - cada sub-tab monta la pantalla correcta y respeta el guard owner/admin/encargado
   - con el flag LP en OFF no aparece nada de LP (fail-closed) */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const Babel = require('@babel/standalone');
const React = require('react');

const ROOT = process.argv[2];
const VARIANT = process.argv[3] || 'web';
const FILE = path.join(ROOT, VARIANT === 'web' ? 'web' : 'mobile', 'components', 'produccion-hub.jsx');
const TABLERO_KEY = VARIANT === 'web' ? 'LineaDashboardPage' : 'LineaDashboardPageMobile';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.MouseEvent = dom.window.MouseEvent;
global.IS_REACT_ACT_ENVIRONMENT = true;

const ReactDOMClient = require('react-dom/client');
const { act } = require('react');

const marker = (name) => function Marker() { return React.createElement('div', { 'data-page': name }, name); };

const PAGES = ['ProduccionPage', 'StockPage', TABLERO_KEY, 'LineaTareasPage', 'LineaActivacionPage',
               'LineaConfigPage', 'LineaStockCargaPage', 'EncargadoPanel', 'CncSector', 'MelaminaSector',
               'PinoSector', 'EmbalajeSector'];

let currentRole = 'owner';
let flagValue = true;

function installGlobals() {
  for (const p of PAGES) dom.window[p] = marker(p);
  dom.window.ProximamentePlaceholder = marker('Proximamente');
  dom.window.useMockData = () => ({ user: { role: currentRole } });
  dom.window.LP_DATA = {
    lpFlag: () => Promise.resolve(flagValue),
    subscribe: () => () => {},
    stock: async () => ({ stock_terminado: [] }),
    resumenDia: async () => [], alertas: async () => [], ordenSector: async () => [], compras: async () => [],
  };
}
installGlobals();

/* Preámbulo: lo que shared.jsx expone globalmente en el browser. */
const preamble = `
  const { useState, useEffect, useRef, useMemo, useCallback } = React;
  const Icon = ({ n, s, c }) => React.createElement('i', { 'data-icon': n });
  const useToast = () => ({ error(){}, success(){}, info(){} });
  const LpClock = () => React.createElement('span', null, '00:00');
`;
const code = Babel.transform(preamble + fs.readFileSync(FILE, 'utf8'), { presets: ['react'], filename: FILE }).code;
new Function('React', 'window', 'document', code)(React, dom.window, dom.window.document);

const Hub = dom.window.ProduccionHubPage;
if (typeof Hub !== 'function') { console.error('No se exportó ProduccionHubPage'); process.exit(1); }

const container = dom.window.document.getElementById('root');
let root;

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

async function mount(role, flag) {
  currentRole = role; flagValue = flag;
  if (root) await act(async () => root.unmount());
  root = ReactDOMClient.createRoot(container);
  await act(async () => { root.render(React.createElement(Hub)); });
  await flush();
}

const txt = (el) => el.textContent.trim();
const hubTabs = () => Array.from(container.querySelectorAll('[role="tab"]')).map(txt);
const pills = () => Array.from(container.querySelectorAll('button[aria-pressed]')).map(txt);
const mounted = () => Array.from(container.querySelectorAll('[data-page]')).map(e => e.getAttribute('data-page'));

async function clickTab(label) {
  const b = Array.from(container.querySelectorAll('[role="tab"]')).find(e => txt(e) === label);
  if (!b) throw new Error(`tab "${label}" no existe (hay: ${hubTabs().join(', ')})`);
  await act(async () => { b.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  await flush();
}
async function clickPill(label) {
  const b = Array.from(container.querySelectorAll('button[aria-pressed]')).find(e => txt(e) === label);
  if (!b) throw new Error(`pill "${label}" no existe (hay: ${pills().join(', ')})`);
  await act(async () => { b.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  await flush();
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' → ' + extra : '')); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  console.log(`\n═══ ${VARIANT.toUpperCase()} · ${path.relative(ROOT, FILE)}\n`);

  /* 1 · owner, flag ON */
  await mount('owner', true);
  console.log('[owner · flag ON]');
  check('hub tiene exactamente 4 tabs', eq(hubTabs(), ['Producción', 'Stock', 'De fábrica', 'Línea productiva']), hubTabs().join(' | '));
  await clickTab('Línea productiva');
  check('6 sub-tabs dentro de LP',
        eq(pills(), ['Supervisión', 'Tablero', 'Tareas', 'Activar', 'Configurar', 'Carga stock']), pills().join(' | '));
  check('arranca en la pantalla de sector (EncargadoPanel)', eq(mounted(), ['EncargadoPanel']), mounted().join(','));
  for (const [pill, page] of [['Tablero', TABLERO_KEY], ['Tareas', 'LineaTareasPage'], ['Activar', 'LineaActivacionPage'],
                              ['Configurar', 'LineaConfigPage'], ['Carga stock', 'LineaStockCargaPage']]) {
    await clickPill(pill);
    check(`"${pill}" monta ${page}`, eq(mounted(), [page]), mounted().join(','));
  }
  await clickPill('Supervisión');
  check('vuelve al sector', eq(mounted(), ['EncargadoPanel']), mounted().join(','));
  check('las sub-tabs NO se filtraron al hub', eq(hubTabs(), ['Producción', 'Stock', 'De fábrica', 'Línea productiva']), hubTabs().join(' | '));

  /* 2 · encargado */
  await mount('encargado', true);
  console.log('\n[encargado · flag ON]');
  check('aterriza en Línea productiva', mounted().length > 0 && mounted()[0] === 'EncargadoPanel', mounted().join(','));
  check('6 sub-tabs (ve stock)', pills().length === 6, pills().join(' | '));
  check('label del sector = "Panel"', pills()[0] === 'Panel', pills()[0]);

  /* 3 · roles de sector sin permiso de stock */
  for (const [role, page] of [['cnc', 'CncSector'], ['melamina', 'MelaminaSector'], ['pino', 'PinoSector'], ['embalaje', 'EmbalajeSector']]) {
    await mount(role, true);
    console.log(`\n[${role} · flag ON]`);
    check('hub sin tab Stock', eq(hubTabs(), ['Producción', 'De fábrica', 'Línea productiva']), hubTabs().join(' | '));
    check('aterriza en su sector', eq(mounted(), [page]), mounted().join(','));
    check('sólo 3 sub-tabs (sin Activar/Configurar/Carga stock)',
          eq(pills(), ['Mi sector', 'Tablero', 'Tareas']), pills().join(' | '));
    await clickPill('Tablero');
    check('"Tablero" accesible', eq(mounted(), [TABLERO_KEY]), mounted().join(','));
    await clickPill('Tareas');
    check('"Tareas" accesible', eq(mounted(), ['LineaTareasPage']), mounted().join(','));
  }

  /* 4 · rol productivo sin pantalla de sector */
  await mount('carpinteria', true);
  console.log('\n[carpinteria · flag ON — sin sector propio]');
  check('NO aterriza en LP (queda en Producción legacy)', eq(mounted(), ['ProduccionPage']), mounted().join(','));
  await clickTab('Línea productiva');
  check('sub-tabs = Mi sector/Tablero/Tareas', eq(pills(), ['Mi sector', 'Tablero', 'Tareas']), pills().join(' | '));
  check('placeholder de sector', eq(mounted(), ['Proximamente']), mounted().join(','));

  /* 5 · fail-closed: flag OFF */
  await mount('owner', false);
  console.log('\n[owner · flag OFF — fail-closed]');
  const tabsOff = hubTabs();
  check('sin tabs LP en el hub', !tabsOff.includes('Línea productiva') && !tabsOff.includes('De fábrica'),
        tabsOff.join(' | ') || '(mobile: sin tab bar)');
  check('sin pantallas LP montadas', mounted().every(p => p === 'ProduccionPage' || p === 'StockPage'), mounted().join(','));
  check('sin sub-tabs LP', pills().length === 0, pills().join(' | '));

  console.log(`\n${pass}/${pass + fail} checks OK · fallos: ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
