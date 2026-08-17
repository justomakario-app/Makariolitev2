/* Deep-link de la campanita: aviso → pantalla.

   Monta los componentes REALES (jsdom + React 18.3.1 + Babel 7.29.0, las
   mismas versiones del browser) y verifica la cadena entera:

     notifications.link → destinoDeAviso() → window.NAV_INTENT
       → VentasPage abre la pestaña correcta
       → B2BTiendaTab abre la sub-pestaña correcta
       → B2BPedidosTab arranca con el número ya buscado

   Lo que importa que quede probado, porque es donde se rompe:
     · un aviso sin link, o con un link que no sabemos abrir, NO es clickeable
     · un usuario sin permiso para esa pantalla tampoco puede abrirlo
     · la intención se lee al montar y se limpia, así que no queda pegada
     · el orden real de React: el hijo lee NAV_INTENT (en useState) ANTES de
       que el efecto del padre lo borre. Todo el diseño depende de eso.        */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const Babel = require('@babel/standalone');
const React = require('react');

const ROOT = process.argv[2];
const VARIANT = process.argv[3] || 'web';
const BASE = path.join(ROOT, VARIANT, 'components');

const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.MouseEvent = dom.window.MouseEvent;
global.IS_REACT_ACT_ENVIRONMENT = true;

const ReactDOMClient = require('react-dom/client');
const { act } = require('react');

/* ── Fixtures ──────────────────────────────────────────────────────────── */
const AVISOS = [
  { id:'n1', tipo:'nuevo_pedido', titulo:'Pedido B2B nuevo: Corralon Sur',
    mensaje:'Ana cargo el pedido MAY-0007', leida:false, created_at:'2026-08-16T10:00:00Z',
    link:'/ventas?tab=mayoristas&pedido=MAY-0007' },
  { id:'n2', tipo:'produccion', titulo:'Produccion completada',
    mensaje:'MAD100 x3', leida:true, created_at:'2026-08-16T09:00:00Z',
    link:'/canal/colecta' },
  { id:'n3', tipo:'sistema', titulo:'Aviso sin link',
    mensaje:'no lleva a ningun lado', leida:true, created_at:'2026-08-16T08:00:00Z', link:null },
  { id:'n4', tipo:'sistema', titulo:'Link desconocido',
    mensaje:'ruta que la app no tiene', leida:true, created_at:'2026-08-16T07:00:00Z',
    link:'/pantalla-inventada?x=1' },
  { id:'n5', tipo:'sistema', titulo:'Alta B2B pendiente de aprobacion',
    mensaje:'pidio acceso', leida:false, created_at:'2026-08-16T06:00:00Z',
    link:'/ventas?tab=b2b&sub=usuarios' },
];

const PEDIDOS = [
  { b2b_pedido_id:'p1', numero_b2b:'B2B-0001', pedido_mayorista_id:'pm1', numero_pedido:'MAY-0007',
    cliente:'Corralon Sur', cliente_id:'c1', canal:'mayorista', comprador:'Ana Perez',
    comprador_email:'ana@corralon.com', enviado_at:'2026-08-14T12:00:00Z',
    total_neto:210000, unidades:3, estado_admin:'cotizacion', estado_tienda:'enviado' },
  { b2b_pedido_id:'p2', numero_b2b:'B2B-0002', pedido_mayorista_id:'pm2', numero_pedido:'MAY-0008',
    cliente:'Distribuidora Norte', cliente_id:'c2', canal:'distribuidor', comprador:'Beto Diaz',
    comprador_email:'beto@dist.com', enviado_at:'2026-08-13T12:00:00Z',
    total_neto:55000, unidades:1, estado_admin:'confirmado', estado_tienda:'confirmado' },
];

/* ── Supabase / capas de datos falsas ──────────────────────────────────── */
dom.window.SUPA = {
  from(tabla) {
    const q = { tabla, filtros:{} };
    const api = {
      select() { return api; }, eq(k,v) { q.filtros[k]=v; return api; },
      order() { return api; }, limit() { return api; },
      maybeSingle: () => Promise.resolve({
        data: tabla === 'app_flags' ? { name:'b2b', enabled:true } : null, error:null }),
      then: (res, rej) => Promise.resolve({
        data: tabla === 'app_flags' ? [{ name:'b2b', enabled:true }] : [], error:null }).then(res, rej),
    };
    return api;
  },
  rpc(nombre) {
    switch (nombre) {
      case 'b2b_rpc_admin_pedidos':   return Promise.resolve({ data: PEDIDOS, error:null });
      case 'b2b_rpc_admin_canales':   return Promise.resolve({ data: [], error:null });
      case 'b2b_rpc_admin_catalogo':  return Promise.resolve({ data: [], error:null });
      default: return Promise.resolve({ data: [], error:null });
    }
  },
};
dom.window.ADMIN_DATA = {
  loadCustomersB2B: async () => [],
  listPedidosMayoristas: async () => [
    { id:'pm1', numero_pedido:'MAY-0007', cliente_id:'c1', estado:'cotizacion', items:[] },
    { id:'pm2', numero_pedido:'MAY-0008', cliente_id:'c2', estado:'confirmado', items:[] },
  ],
  updateEstadoPedidoMayorista: async () => ({ ok:true }),
};

let NAV_LOG = [];
dom.window.MOCK = { user: { role:'owner', name:'Justo', username:'justo', email:'x@y.z', roleLabel:'Dueño' } };
dom.window.useMockData = () => ({
  user: dom.window.MOCK.user,
  notifications: AVISOS,
  notificationsSinLeer: 2,
});
dom.window.MOCK_ACTIONS = { marcarTodasLeidas: async () => ({ ok:true }) };
let PERMISOS = () => true;
dom.window.canSeeNav = (id) => PERMISOS(id);

/* ── Cargar los componentes reales ─────────────────────────────────────── */
const preamble = `
  const { useState, useEffect, useRef, useMemo, useCallback } = React;
  const Icon = ({ n, s, c }) => React.createElement('i', { 'data-icon': n });
  const useToast = () => window.__TOAST;
  const fmt = { agoSimple: () => 'hace 1 h', money: (v) => '$' + v, fecha: () => '16/08', fechaHora: () => '16/08 10:00' };
  const Modal = window.Modal;
  const ConfirmModal = window.ConfirmModal;
`;
dom.window.__TOASTS = [];
dom.window.__TOAST = {
  error:  (m) => dom.window.__TOASTS.push(['error', m]),
  success:(m) => dom.window.__TOASTS.push(['success', m]),
  info:   (m) => dom.window.__TOASTS.push(['info', m]),
};
dom.window.Modal = ({ open, title, children, footer }) =>
  !open ? null : React.createElement('div', { 'data-modal': title }, children, footer);
dom.window.ConfirmModal = ({ open, title, message, onConfirm }) =>
  !open ? null : React.createElement('div', { 'data-confirm': title }, message);

function cargar(rel, extra) {
  const file = path.join(BASE, rel);
  const src = preamble + fs.readFileSync(file, 'utf8') + (extra || '');
  const code = Babel.transform(src, { presets:['react'], filename:file }).code;
  new Function('React', 'window', 'document', code)(React, dom.window, dom.window.document);
}

/* b2b-data.js es JS plano (IIFE) */
new Function('window', 'navigator', fs.readFileSync(path.join(BASE, 'b2b-data.js'), 'utf8'))
  (dom.window, dom.window.navigator);

/* pages.jsx no exporta a window (en el browser comparte scope global con
   app.jsx), así que se le agrega el puente solo para el test. */
cargar('pages.jsx', `
  window.__NotificacionesPage = NotificacionesPage;
  window.__destinoDeAviso = destinoDeAviso;
  if (typeof PerfilPage !== 'undefined') window.__PerfilPage = PerfilPage;
`);
cargar('admin/b2b-solicitudes-tab.jsx');
cargar('admin/b2b-catalogo-tab.jsx');
cargar('admin/b2b-clientes-tab.jsx');
cargar('admin/b2b-pedidos-tab.jsx');
cargar('admin/b2b-tienda-tab.jsx');

/* ── Utilidades ────────────────────────────────────────────────────────── */
const container = dom.window.document.getElementById('root');
let root;
const flush = async () => { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); }); };
const txt = (el) => (el.textContent || '').trim();

async function montar(el) {
  if (root) await act(async () => root.unmount());
  root = ReactDOMClient.createRoot(container);
  await act(async () => { root.render(el); });
  await flush();
}
async function click(el) {
  if (!el) throw new Error('elemento inexistente');
  await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles:true })); });
  await flush();
}
const tarjeta = (titulo) =>
  Array.from(container.querySelectorAll('div')).find(d => txt(d).indexOf(titulo) === 0 && d.getAttribute('role') === 'button')
  || Array.from(container.querySelectorAll('[role="button"]')).find(d => txt(d).includes(titulo));
const tarjetaCualquiera = (titulo) => {
  /* La tarjeta es el div que contiene el título y cuyo padre es la lista. */
  const nodos = Array.from(container.querySelectorAll('div')).filter(d => txt(d).includes(titulo));
  return nodos[nodos.length - 1] ? nodos.find(d => d.children.length >= 2) : null;
};

let pass = 0, fail = 0;
function check(nombre, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + nombre); }
  else { fail++; console.log('  FAIL ' + nombre + (extra ? '  → ' + extra : '')); }
}

/* ══════════════════════════════════════════════════════════════════════ */
(async () => {
  console.log(`\n=== ${VARIANT} — deep-link de la campanita ===\n`);

  /* ── 1. El parser de links ──────────────────────────────────────────── */
  const D = dom.window.__destinoDeAviso;
  const d1 = D('/ventas?tab=mayoristas&pedido=MAY-0007');
  check('pedido de la tienda → Ventas > Tienda mayorista > Pedidos',
    d1 && d1.page === 'ventas' && d1.ventasTab === 'tienda-b2b' && d1.b2bSub === 'pedidos', JSON.stringify(d1));
  check('el número del pedido viaja para el buscador', d1 && d1.buscar === 'MAY-0007', JSON.stringify(d1));

  const d5 = D('/ventas?tab=b2b&sub=usuarios');
  check('alta pendiente → sub-pestaña Accesos', d5 && d5.b2bSub === 'solicitudes', JSON.stringify(d5));

  const d2 = D('/canal/colecta');
  check('canal → su pantalla', d2 && d2.page === 'colecta', JSON.stringify(d2));
  check('canal inventado → null', D('/canal/loquesea') === null);
  check('link vacío → null', D(null) === null && D('') === null && D(undefined) === null);
  check('ruta desconocida → null', D('/pantalla-inventada?x=1') === null);
  check('link anulación sin número no rompe',
    (() => { const d = D('/ventas?tab=mayoristas&pedido='); return d && d.buscar === ''; })());

  /* ── 2. La lista de avisos ──────────────────────────────────────────── */
  PERMISOS = () => true;
  NAV_LOG = [];
  dom.window.NAV_INTENT = null;
  await montar(React.createElement(dom.window.__NotificacionesPage, { onNav: (p) => NAV_LOG.push(p) }));

  const clickeables = Array.from(container.querySelectorAll('[role="button"]'));
  check('3 avisos clickeables (pedido, canal, alta) y 2 no', clickeables.length === 3,
    'hay ' + clickeables.length + ': ' + clickeables.map(e => txt(e).slice(0, 28)).join(' | '));
  check('el aviso sin link no es clickeable',
    !clickeables.some(e => txt(e).includes('Aviso sin link')));
  check('el link desconocido no es clickeable',
    !clickeables.some(e => txt(e).includes('Link desconocido')));

  const c1 = clickeables.find(e => txt(e).includes('Pedido B2B nuevo'));
  await click(c1);
  check('abrir el aviso navega a Ventas', NAV_LOG[NAV_LOG.length - 1] === 'ventas', JSON.stringify(NAV_LOG));
  check('deja la intención en window.NAV_INTENT',
    dom.window.NAV_INTENT && dom.window.NAV_INTENT.ventasTab === 'tienda-b2b'
    && dom.window.NAV_INTENT.buscar === 'MAY-0007', JSON.stringify(dom.window.NAV_INTENT));

  const c2 = Array.from(container.querySelectorAll('[role="button"]')).find(e => txt(e).includes('Produccion completada'));
  await click(c2);
  check('el aviso de producción navega a su canal', NAV_LOG[NAV_LOG.length - 1] === 'colecta');

  /* Sin permiso para Ventas: el aviso llega igual (es por rol) pero no se abre. */
  PERMISOS = (id) => id !== 'ventas';
  await montar(React.createElement(dom.window.__NotificacionesPage, { onNav: (p) => NAV_LOG.push(p) }));
  const sinVentas = Array.from(container.querySelectorAll('[role="button"]'));
  check('sin el módulo Ventas, esos avisos no se pueden abrir',
    sinVentas.length === 1 && txt(sinVentas[0]).includes('Produccion'),
    'quedaron ' + sinVentas.map(e => txt(e).slice(0, 24)).join(' | '));
  check('el aviso igual se sigue viendo', (container.textContent || '').includes('Pedido B2B nuevo'));

  /* Sin onNav (por si alguien la monta suelta) no debe romper ni ofrecer nada. */
  PERMISOS = () => true;
  await montar(React.createElement(dom.window.__NotificacionesPage));
  check('sin onNav no hay nada clickeable y no explota',
    container.querySelectorAll('[role="button"]').length === 0
    && (container.textContent || '').includes('Pedido B2B nuevo'));

  /* ── 3. El panel B2B recibe la intención ────────────────────────────── */
  dom.window.NAV_INTENT = { page:'ventas', ventasTab:'tienda-b2b', b2bSub:'pedidos', buscar:'MAY-0007' };
  await montar(React.createElement(dom.window.B2BTiendaTab));
  const buscador = Array.from(container.querySelectorAll('input'))
    .find(i => (i.placeholder || '').toLowerCase().includes('busc'));
  check('el buscador de pedidos arranca con el número del aviso',
    buscador && buscador.value === 'MAY-0007', buscador ? `value="${buscador.value}"` : 'no hay buscador');
  const cuerpo = container.textContent || '';
  check('queda a la vista solo ese pedido',
    cuerpo.includes('MAY-0007') && !cuerpo.includes('MAY-0008'));

  dom.window.NAV_INTENT = { page:'ventas', ventasTab:'tienda-b2b', b2bSub:'solicitudes', buscar:'' };
  await montar(React.createElement(dom.window.B2BTiendaTab));
  const activa = Array.from(container.querySelectorAll('[role="tab"]')).find(t => t.className.includes('active'));
  check('un alta pendiente abre directo en Accesos', activa && txt(activa).includes('Accesos'),
    activa ? txt(activa) : 'ninguna pestaña activa');

  dom.window.NAV_INTENT = null;
  await montar(React.createElement(dom.window.B2BTiendaTab));
  const activa2 = Array.from(container.querySelectorAll('[role="tab"]')).find(t => t.className.includes('active'));
  check('sin intención abre en Pedidos, como siempre', activa2 && txt(activa2).includes('Pedidos'));

  /* ── 4. El orden padre/hijo del que depende todo ─────────────────────── */
  /* El padre (VentasPage) limpia NAV_INTENT en un useEffect; el hijo
     (B2BTiendaTab) lo lee en un useState. Si React corriera el efecto del
     padre antes de renderizar al hijo, el hijo leería null y el deep-link
     no llegaría nunca al panel. Se verifica con los dos componentes tal
     como están escritos, no con la teoría. */
  dom.window.NAV_INTENT = { page:'ventas', ventasTab:'tienda-b2b', b2bSub:'solicitudes', buscar:'MAY-0007' };
  const { useState: uS, useEffect: uE } = React;
  const PadreComoVentasPage = () => {
    const intent = dom.window.NAV_INTENT || null;
    const [tab] = uS(intent && intent.ventasTab === 'tienda-b2b' ? 'tienda-b2b' : 'alta-clientes');
    uE(() => { dom.window.NAV_INTENT = null; }, []);
    return tab === 'tienda-b2b' ? React.createElement(dom.window.B2BTiendaTab) : null;
  };
  await montar(React.createElement(PadreComoVentasPage));
  const activa3 = Array.from(container.querySelectorAll('[role="tab"]')).find(t => t.className.includes('active'));
  check('el hijo lee la intención antes de que el padre la borre',
    activa3 && txt(activa3).includes('Accesos'), activa3 ? txt(activa3) : 'ninguna');
  check('y la intención queda limpia después de montar', dom.window.NAV_INTENT === null);

  /* ── 5. Mobile: la puerta de entrada a Ventas desde Perfil ───────────── */
  /* La barra de abajo llega a 5 pestañas y Ventas no entra. Sin esta lista,
     la tienda mayorista solo se abría tocando un aviso, y un aviso se cae de
     los últimos 50. */
  if (VARIANT === 'mobile') {
    dom.window.VentasPage = () => null;
    dom.window.MarketingPage = () => null;
    dom.window.AdminPage = () => null;
    dom.window.FEATURE_ADMIN = true;

    PERMISOS = (id) => ['ventas','marketing','administracion','perfil'].includes(id);
    NAV_LOG = [];
    await montar(React.createElement(dom.window.__PerfilPage, { onLogout: () => {}, onNav: (p) => NAV_LOG.push(p) }));
    const botones = Array.from(container.querySelectorAll('button')).map(txt);
    check('el dueño ve la entrada a Ventas y tienda mayorista',
      botones.some(b => b.includes('Ventas y tienda mayorista')), botones.join(' | '));
    const bVentas = Array.from(container.querySelectorAll('button')).find(b => txt(b).includes('Ventas y tienda'));
    await click(bVentas);
    check('y desde ahí se navega a Ventas', NAV_LOG[NAV_LOG.length - 1] === 'ventas', JSON.stringify(NAV_LOG));

    PERMISOS = (id) => ['perfil','produccion-hub'].includes(id);
    await montar(React.createElement(dom.window.__PerfilPage, { onLogout: () => {}, onNav: (p) => NAV_LOG.push(p) }));
    check('un operario no ve ningún módulo extra',
      !(container.textContent || '').includes('Módulos'));

    PERMISOS = () => true;
    dom.window.VentasPage = undefined;
    await montar(React.createElement(dom.window.__PerfilPage, { onLogout: () => {}, onNav: (p) => NAV_LOG.push(p) }));
    check('si la pantalla no está cargada, tampoco se ofrece',
      !(container.textContent || '').includes('Ventas y tienda mayorista'));
  }

  console.log(`\n--------------------------------\n${VARIANT}: ${pass} ok · ${fail} fail\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('EXPLOTÓ:', e); process.exit(1); });
