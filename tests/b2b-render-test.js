/* Render real del panel interno de la tienda mayorista (jsdom + React 18.3.1 +
   Babel 7.29.0, las mismas versiones que corren en el browser).

   No es un test de transpilación: monta los 4 componentes DE VERDAD y los hace
   hablar con la capa de datos DE VERDAD (b2b-data.js), contra un Supabase
   falso. O sea que ejercita la cadena entera componente → B2B_DATA → RPC,
   que es donde viven los errores que `transpile` no ve: un payload con la
   clave mal escrita, una lista que llega como objeto, un guard que no cierra.

   Lo que se verifica:
     · el flag es fail-closed de verdad (apagado, y también si la lectura rompe)
     · el rol decide qué pestañas existen, reflejando lo que el backend permite
     · aprobar manda el payload exacto que espera b2b_rpc_resolver_usuario
     · los precios por canal se recalculan mientras se tipea
     · publicar sin precio queda bloqueado ANTES de mandar el lote
     · el detalle del pedido sale de pedidos_mayoristas_items y el avance de
       estado usa la RPC mayorista de siempre (no una nueva)                */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const Babel = require('@babel/standalone');
const React = require('react');

const ROOT = process.argv[2];
const VARIANT = process.argv[3] || 'web';
const BASE = path.join(ROOT, VARIANT === 'web' ? 'web' : 'mobile', 'components');

const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.MouseEvent = dom.window.MouseEvent;
global.IS_REACT_ACT_ENVIRONMENT = true;

const ReactDOMClient = require('react-dom/client');
const { act } = require('react');

/* jsdom no implementa createObjectURL: sin este stub, apretar "Exportar"
   tira TypeError. De paso queda la descarga capturada para poder mirarla. */
const DESCARGAS = [];
const capturarBlob = (blob) => { DESCARGAS.push(blob); return 'blob:fake'; };
dom.window.URL.createObjectURL = capturarBlob;
dom.window.URL.revokeObjectURL = () => {};
/* b2b-data.js se evalúa con new Function(...): ahí adentro `URL` NO es el del
   window sino el global de Node, así que hay que pisar los dos. */
global.URL.createObjectURL = capturarBlob;
global.URL.revokeObjectURL = () => {};

/* ── Fixtures ──────────────────────────────────────────────────────────── */
let FLAG = true;
let FLAG_ROMPE = false;
const RPC_LOG = [];

const CANALES = [
  { codigo:'distribuidor', nombre:'Distribuidor', coeficiente:0.55, minimo_pedido:0, minimo_unidades:0, orden:1, activo:true },
  { codigo:'mayorista',    nombre:'Mayorista',    coeficiente:0.70, minimo_pedido:0, minimo_unidades:0, orden:2, activo:true },
  /* Apagado desde 0165 (el duenio dejo la tienda en mayorista + distribuidor).
     Se deja en el fixture, y no vacio, porque el caso que importa es el de un
     canal apagado que TODAVIA aparece en datos viejos: el cliente c3 y su
     pedido siguen teniendo canal 'minorista'. */
  { codigo:'minorista',    nombre:'Minorista',    coeficiente:1.00, minimo_pedido:0, minimo_unidades:0, orden:3, activo:false },
];

/* Lo que el panel muestra NO es CANALES: es CANALES.filter(activo). Desde
   0165 son dos. Se calcula en vez de escribir "2" para que prender o apagar
   un canal en el fixture arrastre solo a los checks de abajo. */
const CANALES_VISIBLES = CANALES.filter(c => c.activo !== false);

const CATALOGO = [
  { sku:'MAD100', modelo:'Mesa Nordica', color:'Blanco', categoria:'Mesas', publicado:true,  precio_base:100000, moneda:'ARS' },
  { sku:'MAD200', modelo:'Silla Viena',  color:'Negro',  categoria:'Sillas', publicado:false, precio_base:50000,  moneda:'ARS' },
  { sku:'MAD300', modelo:'Banco Pino',   color:'Natural',categoria:'Bancos', publicado:false, precio_base:null,   moneda:'ARS' },
];

const USUARIOS = [
  { id:'u1', email:'ana@corralon.com', nombre:'Ana Perez', telefono:'351-1', estado:'pendiente', created_at:'2026-08-14T10:00:00Z',
    cliente:{ id:'c1', nombre:'Corralon Sur', cuit:'30-111-1', b2b_canal:'mayorista', b2b_habilitado:false } },
  { id:'u2', email:'beto@dist.com', nombre:'Beto Diaz', estado:'pendiente', created_at:'2026-08-13T10:00:00Z',
    cliente:{ id:'c2', nombre:'Distribuidora Norte', cuit:'30-222-2', b2b_canal:'distribuidor', b2b_habilitado:false } },
  { id:'u3', email:'caro@mad.com', nombre:'Caro Lopez', estado:'aprobado', created_at:'2026-08-01T10:00:00Z',
    cliente:{ id:'c3', nombre:'Maderera Este', cuit:'30-333-3', b2b_canal:'minorista', b2b_habilitado:true } },
];

/* La ficha de la empresa. Corralon Sur con un solo catálogo y Distribuidora
   Norte con los dos: son los dos casos que cambian la pantalla (uno solo =
   no hay nada que elegir; dos = el comprador elige al entrar). */
const CLIENTES = [
  { cliente_id:'c1', nombre:'Corralon Sur', cuit:'30-111-1', canal:'mayorista',
    canales:['mayorista'], habilitado:true, activo:true, condicion_pago:'30 dias',
    notas_internas:null, coeficiente:0.70, usuarios:2, usuarios_pendientes:0,
    pedidos:3, ultimo_pedido:'2026-08-14T12:00:00Z', total_pedido:210000 },
  { cliente_id:'c2', nombre:'Distribuidora Norte', cuit:'30-222-2', canal:'distribuidor',
    canales:['distribuidor','mayorista'], habilitado:true, activo:true, condicion_pago:null,
    notas_internas:'Paga a 60 dias', coeficiente:0.55, usuarios:1, usuarios_pendientes:1,
    pedidos:1, ultimo_pedido:null, total_pedido:55000 },
];

const INVITACIONES = [
  { id:'i1', email:'nuevo@cliente.com', cliente_nombre:'Cliente Nuevo', cliente_cuit:'30-444-4',
    canal:'mayorista', estado:'pendiente', expira_at:'2099-01-01T00:00:00Z', created_at:'2026-08-14T09:00:00Z' },
];

const PEDIDOS = [
  { b2b_pedido_id:'p1', numero_b2b:'B2B-0001', pedido_mayorista_id:'pm1', numero_pedido:'PM-0001',
    cliente:'Corralon Sur', cliente_id:'c1', canal:'mayorista', comprador:'Ana Perez',
    comprador_email:'ana@corralon.com', enviado_at:'2026-08-14T12:00:00Z',
    total_neto:210000, unidades:3, estado_admin:'cotizacion' },
  { b2b_pedido_id:'p2', numero_b2b:'B2B-0002', pedido_mayorista_id:'pm2', numero_pedido:'PM-0002',
    cliente:'Distribuidora Norte', cliente_id:'c2', canal:'distribuidor', comprador:'Beto Diaz',
    comprador_email:'beto@dist.com', enviado_at:'2026-08-13T12:00:00Z',
    total_neto:55000, unidades:1, estado_admin:'confirmado' },
  /* El tercero existe para el CSV: nombre con ; y con comillas (lo que rompe
     el archivo si no se escapa) y total con decimales (lo que lo rompe si el
     punto decimal no se pasa a coma). */
  { b2b_pedido_id:'p3', numero_b2b:'B2B-0003', pedido_mayorista_id:'pm3', numero_pedido:'PM-0003',
    cliente:'Muebles "El Roble"; SRL', cliente_id:'c3', canal:'minorista', comprador:'Caro Lopez',
    comprador_email:'caro@mad.com', enviado_at:'2026-08-12T12:00:00Z',
    total_neto:112500.5, unidades:2, estado_admin:'entregado',
    estado_tienda:'facturado', factura_nro:'A-0001-00012345', facturado_at:'2026-08-15T09:00:00Z' },
];

const PEDIDOS_MAY = [
  { id:'pm1', numero_pedido:'PM-0001', cliente_id:'c1', estado:'cotizacion',
    items:[ { sku:'MAD100', cantidad:3, precio_unitario:70000, modelo:'Mesa Nordica', color:'Blanco' } ] },
  { id:'pm2', numero_pedido:'PM-0002', cliente_id:'c2', estado:'confirmado',
    items:[ { sku:'MAD200', cantidad:1, precio_unitario:27500, modelo:'Silla Viena', color:'Negro' } ] },
];

/* ── Supabase falso ────────────────────────────────────────────────────── */
function tablaFixture(tabla, filtros) {
  if (tabla === 'app_flags') {
    if (FLAG_ROMPE) return { data:null, error:{ message:'network', code:'PGRST000' } };
    return { data: [{ name:'b2b', enabled: FLAG }].filter(r => !filtros.name || r.name === filtros.name) };
  }
  if (tabla === 'b2b_usuario') {
    return { data: USUARIOS.filter(u => !filtros.estado || u.estado === filtros.estado) };
  }
  if (tabla === 'b2b_invitacion') {
    return { data: INVITACIONES.filter(i => !filtros.estado || i.estado === filtros.estado) };
  }
  return { data: [] };
}

const SUPA = {
  from(tabla) {
    const q = { tabla, filtros:{}, count:null, head:false };
    const api = {
      select(cols, opts) { q.cols = cols; if (opts) { q.count = opts.count; q.head = opts.head; } return api; },
      eq(k, v) { q.filtros[k] = v; return api; },
      order() { return api; },
      limit() { return api; },
      maybeSingle() {
        const r = tablaFixture(q.tabla, q.filtros);
        if (r.error) return Promise.resolve({ data:null, error:r.error });
        return Promise.resolve({ data: (r.data && r.data[0]) || null, error:null });
      },
      then(res, rej) {
        const r = tablaFixture(q.tabla, q.filtros);
        if (r.error) return Promise.resolve({ data:null, error:r.error }).then(res, rej);
        if (q.head && q.count) return Promise.resolve({ data:null, count:r.data.length, error:null }).then(res, rej);
        return Promise.resolve({ data:r.data, error:null }).then(res, rej);
      },
    };
    return api;
  },
  rpc(nombre, args) {
    RPC_LOG.push({ nombre, payload: args && args.p_payload });
    const p = (args && args.p_payload) || {};
    switch (nombre) {
      case 'b2b_rpc_admin_canales':      return Promise.resolve({ data: CANALES, error:null });
      case 'b2b_rpc_admin_catalogo':     return Promise.resolve({ data: CATALOGO, error:null });
      case 'b2b_rpc_admin_pedidos':      return Promise.resolve({ data: PEDIDOS, error:null });
      case 'b2b_rpc_admin_clientes':     return Promise.resolve({ data: CLIENTES, error:null });
      /* Espeja la regla del backend (0162): sin ningún catálogo, rebota. */
      case 'b2b_rpc_admin_set_cliente': {
        if (p.canales && p.canales.length === 0) {
          return Promise.resolve({ data:null,
            error:{ message:'Hay que dejarle habilitado al menos un catalogo.', code:'22023' } });
        }
        return Promise.resolve({ data:{ ok:true, cliente_id:p.cliente_id,
          canal:p.canal, canales:p.canales }, error:null });
      }
      case 'b2b_rpc_resolver_usuario':   return Promise.resolve({ data:{ ok:true, usuario_id:p.usuario_id, estado:p.estado }, error:null });
      case 'b2b_rpc_admin_set_producto': return Promise.resolve({ data:{ ok:true, actualizados:(p.items||[]).length }, error:null });
      case 'b2b_rpc_crear_invitacion':   return Promise.resolve({ data:{ ok:true, invitacion_id:'i9', token:'TOKENSECRETO123', expira_at:'2026-08-28T00:00:00Z' }, error:null });
      default: return Promise.resolve({ data:null, error:{ message:'RPC no fixturada: ' + nombre, code:'P0002' } });
    }
  },
};
dom.window.SUPA = SUPA;

/* ADMIN_DATA: solo lo que toca el panel B2B. listPedidosMayoristas es
   owner/admin en el backend, así que para 'ventas' se simula el 42501. */
let ROL = 'owner';
const ADMIN_LOG = [];
dom.window.ADMIN_DATA = {
  loadCustomersB2B: async () => [{ id:'c1', nombre:'Corralon Sur', cuit:'30-111-1' }],
  listPedidosMayoristas: async () => {
    if (ROL === 'ventas') { const e = new Error('Sin permiso.'); e.code = '42501'; throw e; }
    return PEDIDOS_MAY;
  },
  updateEstadoPedidoMayorista: async (p) => { ADMIN_LOG.push(p); return { ok:true }; },
};

/* ── Cargar la capa de datos y los componentes reales ──────────────────── */
const preamble = `
  const { useState, useEffect, useRef, useMemo, useCallback } = React;
  const Icon = ({ n, s, c }) => React.createElement('i', { 'data-icon': n });
  const useToast = () => window.__TOAST;
`;
dom.window.__TOAST = {
  error:  (m) => dom.window.__TOASTS.push(['error', m]),
  success:(m) => dom.window.__TOASTS.push(['success', m]),
  info:   (m) => dom.window.__TOASTS.push(['info', m]),
};
dom.window.__TOASTS = [];

/* Modal / ConfirmModal: los reales viven en modals.jsx (fuera de alcance acá).
   Se renderizan inline para poder inspeccionar su contenido y apretar botones. */
dom.window.Modal = ({ open, title, children, footer }) =>
  !open ? null : React.createElement('div', { 'data-modal': title }, children, footer);
dom.window.ConfirmModal = ({ open, title, message, onConfirm }) =>
  !open ? null : React.createElement('div', { 'data-confirm': title },
    message, React.createElement('button', { 'data-confirm-ok': '1', onClick: onConfirm }, 'OK'));

/* b2b-data.js es JS plano (IIFE) — se evalúa tal cual, sin Babel. */
new Function('window', 'navigator', fs.readFileSync(path.join(BASE, 'b2b-data.js'), 'utf8'))
  (dom.window, dom.window.navigator);

for (const f of ['admin/b2b-solicitudes-tab.jsx', 'admin/b2b-catalogo-tab.jsx',
                 'admin/b2b-pedidos-tab.jsx', 'admin/b2b-clientes-tab.jsx',
                 'admin/b2b-tienda-tab.jsx']) {
  const file = path.join(BASE, f);
  const code = Babel.transform(preamble + fs.readFileSync(file, 'utf8'),
                               { presets:['react'], filename:file }).code;
  new Function('React', 'window', 'document', code)(React, dom.window, dom.window.document);
}

/* ── Utilidades de montaje ─────────────────────────────────────────────── */
const container = dom.window.document.getElementById('root');
let root;
const flush = async () => { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); }); };

async function montar(rol, flag, rompe) {
  ROL = rol; FLAG = flag !== false; FLAG_ROMPE = !!rompe;
  dom.window.MOCK = { user: { role: rol } };
  dom.window.__TOASTS = [];
  RPC_LOG.length = 0; ADMIN_LOG.length = 0;
  if (root) await act(async () => root.unmount());
  root = ReactDOMClient.createRoot(container);
  await act(async () => { root.render(React.createElement(dom.window.B2BTiendaTab)); });
  await flush();
}

const txt  = (el) => (el.textContent || '').trim();
const tabs = () => Array.from(container.querySelectorAll('[role="tab"]')).map(txt);
const cuerpo = () => container.textContent || '';

async function click(el) {
  if (!el) throw new Error('elemento inexistente');
  await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles:true })); });
  await flush();
}
async function clickTab(parcial) {
  const b = Array.from(container.querySelectorAll('[role="tab"]')).find(e => txt(e).includes(parcial));
  if (!b) throw new Error(`no hay tab "${parcial}" (hay: ${tabs().join(' | ')})`);
  await click(b);
}
async function clickTexto(sel, parcial) {
  const b = Array.from(container.querySelectorAll(sel)).find(e => txt(e).includes(parcial));
  if (!b) throw new Error(`no hay ${sel} con "${parcial}"`);
  await click(b);
}
async function tipear(input, valor) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, valor);
    input.dispatchEvent(new dom.window.Event('input', { bubbles:true }));
  });
  await flush();
}
async function tildar(input, valor) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'checked').set;
    setter.call(input, valor);
    input.dispatchEvent(new dom.window.Event('click', { bubbles:true }));
  });
  await flush();
}
async function tipearArea(area, valor) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(area, valor);
    area.dispatchEvent(new dom.window.Event('input', { bubbles:true }));
  });
  await flush();
}

/* Desde 0160 cada fila del catálogo tiene 4 campos numéricos: el precio de
   lista y uno por canal. El precio derivado (lista × coeficiente) ya no se
   escribe como texto: vive en el placeholder del campo del canal, porque ese
   campo también acepta un precio propio que pisa la fórmula. Leerlo desde el
   placeholder es leer exactamente lo que ve el dueño. */
const filas    = () => Array.from(container.querySelectorAll('tbody tr'));
const camposDe = (i) => Array.from(filas()[i].querySelectorAll('input[type="number"]'));
const derivados = () => Array.from(container.querySelectorAll('tbody input[type="number"]'))
  .map(i => i.getAttribute('placeholder') || '').join(' | ');

let pass = 0, fail = 0;
function check(nombre, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + nombre); }
  else { fail++; console.log('  FAIL ' + nombre + (extra ? '  → ' + extra : '')); }
}

/* ── Corrida ───────────────────────────────────────────────────────────── */
(async () => {
  console.log(`\n══ Panel tienda mayorista · ${VARIANT} ══\n`);

  /* (1) Fail-closed */
  console.log('— El flag manda —');
  await montar('owner', false);
  check('flag OFF: no aparece ninguna pestaña de la tienda', tabs().length === 0, tabs().join('|'));
  check('flag OFF: explica que está apagada', /apagada/i.test(cuerpo()));
  check('flag OFF: no se llamó ninguna RPC de la tienda',
        RPC_LOG.filter(r => r.nombre.startsWith('b2b_rpc')).length === 0,
        RPC_LOG.map(r => r.nombre).join(','));

  await montar('owner', true, true);   // la lectura del flag rompe
  check('lectura del flag rota: se comporta como apagada (fail-closed)',
        tabs().length === 0 && /apagada/i.test(cuerpo()));

  /* (2) El rol decide las pestañas */
  console.log('\n— El rol decide qué se ve —');
  await montar('cnc', true);
  check('un operario de planta no entra', /sin acceso/i.test(cuerpo()) && tabs().length === 0);

  await montar('ventas', true);
  check('ventas ve solo Pedidos (es lo único que su rol lee en el backend)',
        tabs().length === 1 && tabs()[0].includes('Pedidos'), tabs().join('|'));

  /* Cuatro desde 0158/0160: Pedidos · Accesos · Clientes · Catálogo. */
  await montar('admin', true);
  check('admin ve las 4 pestañas', tabs().length === 4, tabs().join('|'));

  await montar('owner', true);
  check('owner ve las 4 pestañas', tabs().length === 4, tabs().join('|'));
  check('el badge muestra los 2 que esperan aprobación',
        tabs().some(t => /Accesos\s*2/.test(t.replace(/\s+/g, ' '))), tabs().join('|'));

  /* (3) Pedidos */
  console.log('\n— Pedidos —');
  check('lista los pedidos que entraron por la tienda',
        cuerpo().includes('B2B-0001') && cuerpo().includes('B2B-0002'));
  check('muestra el total con formato de plata', cuerpo().includes('210.000,00'));
  check('traduce el estado interno a lo que ve el cliente',
        cuerpo().includes('Recibido') && cuerpo().includes('Enviado'));

  let detalleAntes = cuerpo().includes('70.000,00');
  await clickTexto('button', '');   // no-op seguro: fuerza un ciclo
  const expandir = container.querySelector('[data-icon="chev-right"]');
  check('cada pedido se puede desplegar', !!expandir);
  if (expandir) {
    await click(expandir.closest('button'));
    check('el detalle sale de pedidos_mayoristas_items (sku, cantidad, precio congelado)',
          cuerpo().includes('MAD100') && cuerpo().includes('70.000,00') && !detalleAntes);
    check('avisa que el precio quedó congelado', /congelado/i.test(cuerpo()));
  }

  const selects = Array.from(container.querySelectorAll('select'));
  check('el dueño puede avanzar el estado', selects.length >= 2, `hay ${selects.length}`);
  if (selects.length) {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set;
      setter.call(selects[0], 'en_produccion');
      selects[0].dispatchEvent(new dom.window.Event('change', { bubbles:true }));
    });
    await flush();
    check('avanzar usa la RPC mayorista de siempre, con el id del pedido mayorista',
          ADMIN_LOG.length === 1 && ADMIN_LOG[0].pedido_id === 'pm1' && ADMIN_LOG[0].estado === 'en_produccion',
          JSON.stringify(ADMIN_LOG));
    check('no se inventó una RPC nueva para cambiar el estado',
          !RPC_LOG.some(r => /b2b_rpc.*estado/.test(r.nombre)));
  }

  await montar('admin', true);
  check('un admin NO ve el selector de estado (avanzar es del dueño)',
        container.querySelectorAll('select').length === 0);

  await montar('ventas', true);
  check('ventas ve la cabecera pero avisa que no tiene el detalle',
        cuerpo().includes('B2B-0001') && /no el detalle/i.test(cuerpo()));

  /* — Exportar a Excel —
     Es para conciliar facturación, así que lo que importa es que el archivo
     ABRA BIEN en el Excel de acá: separador ';', BOM y coma decimal. Un CSV
     que hay que arreglar a mano cada vez no se usa. */
  console.log('\n— Exportar pedidos —');
  await montar('owner', true);
  DESCARGAS.length = 0;
  await clickTexto('button', 'Exportar');
  check('el botón baja un archivo', DESCARGAS.length === 1, `${DESCARGAS.length} descargas`);
  const csv = DESCARGAS.length ? await DESCARGAS[0].text() : '';
  const lineas = csv.replace(/^﻿/, '').split('\r\n');
  /* Hay que mirar los BYTES: .text() decodifica como UTF-8 y se come el BOM,
     así que el archivo podría salir sin BOM y este check pasar igual. */
  const bytes = DESCARGAS.length
    ? new Uint8Array(await DESCARGAS[0].arrayBuffer()) : new Uint8Array();
  check('★ arranca con BOM (sin BOM Excel muestra "CorralÃ³n")',
        bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF,
        Array.from(bytes.slice(0, 3)).join(','));
  check('★ separa con ; (el Excel es-AR usa la coma para decimales)',
        lineas[0].includes('Pedido tienda;Pedido interno;Fecha'), lineas[0]);
  check('trae una fila por pedido más el encabezado',
        lineas.length === PEDIDOS.length + 1, `${lineas.length} líneas`);
  check('★ los importes van con coma decimal y sin separador de miles',
        lineas.some(l => l.includes(';112500,5;')),
        lineas.find(l => l.includes('B2B-0003')));
  check('★ un nombre con ; y comillas no parte la fila',
        lineas.filter(l => l.includes('B2B-0003')).length === 1
        && csv.includes('"Muebles ""El Roble""; SRL"'),
        lineas.find(l => l.includes('B2B-0003')));
  check('★ sale el número de factura (es para lo que se exporta)',
        lineas.some(l => l.includes('A-0001-00012345')), lineas.find(l => l.includes('B2B-0003')));
  check('lleva los dos estados: el interno y el que ve el cliente',
        lineas[0].includes('Estado interno;Ve el cliente'), lineas[0]);
  check('un pedido facturado figura como Facturado del lado del cliente',
        (lineas.find(l => l.includes('B2B-0003')) || '').includes('Despachado;Facturado'),
        lineas.find(l => l.includes('B2B-0003')));
  check('NO exporta el detalle por renglón (ventas no lo puede leer)',
        !csv.includes('MAD100'));

  /* Exporta lo que está en pantalla: si filtró, baja el filtro. */
  DESCARGAS.length = 0;
  await clickTexto('button', 'Facturados');
  await clickTexto('button', 'Exportar');
  const csv2 = DESCARGAS.length ? await DESCARGAS[0].text() : '';
  check('★ exporta lo filtrado, no la lista entera',
        csv2.includes('B2B-0003') && !csv2.includes('B2B-0001'),
        csv2.split('\r\n').length + ' líneas');

  /* (4) Accesos */
  console.log('\n— Accesos —');
  await montar('owner', true);
  await clickTab('Accesos');
  check('lista a los que esperan aprobación', cuerpo().includes('Ana Perez') && cuerpo().includes('Beto Diaz'));
  check('no mezcla a los ya aprobados', !cuerpo().includes('Caro Lopez'));
  check('muestra de qué cliente y canal es cada uno',
        cuerpo().includes('Corralon Sur') && cuerpo().includes('mayorista'));
  check('lista las invitaciones emitidas', cuerpo().includes('nuevo@cliente.com'));

  await clickTexto('button', 'Aprobar');
  const aprobar = RPC_LOG.filter(r => r.nombre === 'b2b_rpc_resolver_usuario');
  check('aprobar manda el payload exacto que espera el backend',
        aprobar.length === 1 && aprobar[0].payload.usuario_id === 'u1' && aprobar[0].payload.estado === 'aprobado',
        JSON.stringify(aprobar[0] && aprobar[0].payload));

  /* (5) Catálogo y precios */
  console.log('\n— Catálogo y precios —');
  await montar('owner', true);
  await clickTab('Catálogo');
  check('lista el catálogo', cuerpo().includes('MAD100') && cuerpo().includes('MAD300'));
  check('calcula el precio de cada canal sobre el mismo precio base',
        derivados().includes('55.000,00') && derivados().includes('70.000,00'), derivados());
  /* 0165: el minorista se apago. Su coeficiente es 1,00, asi que su columna
     habria mostrado el precio_base tal cual — o sea, el numero que el cliente
     NO tiene que poder ver. Que no este es la mitad del punto. */
  check('★ el canal apagado no deja una columna de precios atras',
        !derivados().includes('100.000,00'), derivados());
  check('★ y no aparece por ningun lado del catalogo',
        !/minorista/i.test(cuerpo()), cuerpo().slice(0, 160));
  check('el producto sin precio no inventa ningún canal',
        camposDe(2).slice(1).every(i => /sin precio/i.test(i.getAttribute('placeholder') || '')),
        camposDe(2).map(i => i.getAttribute('placeholder')).join('|'));
  check('avisa cuántos productos quedaron sin precio', /1\s*sin precio/i.test(cuerpo().replace(/\s+/g,' ')));

  /* Una fila = precio de lista + un campo por canal (0160). */
  const precios = Array.from(container.querySelectorAll('tbody input[type="number"]'));
  check('cada producto tiene el precio de lista y uno por canal activo',
        precios.length === CATALOGO.length * (1 + CANALES_VISIBLES.length)
        && camposDe(0).length === 1 + CANALES_VISIBLES.length, `hay ${precios.length}`);
  await tipear(camposDe(0)[0], '200000');
  check('los precios por canal se recalculan MIENTRAS se tipea (sin guardar)',
        derivados().includes('110.000,00') && derivados().includes('140.000,00'), derivados());
  check('avisa que hay cambios sin guardar', /1 producto sin guardar/i.test(cuerpo()));

  await clickTexto('button', 'Descartar');
  check('descartar vuelve todo atrás',
        !/sin guardar/i.test(cuerpo()) && derivados().includes('55.000,00'), derivados());

  /* Precio propio de canal: pisa la fórmula sin tocar el precio de lista ni
     los otros dos canales. Es el caso de los dos catálogos de julio, donde
     distribuidor no sale de multiplicar la lista. */
  await tipear(camposDe(0)[1], '61000');
  check('un precio propio de canal no mueve el precio de lista ni a los otros canales',
        camposDe(0)[0].value === '100000' && derivados().includes('70.000,00'),
        `base=${camposDe(0)[0].value} · ${derivados()}`);
  check('el campo con precio propio queda marcado como tal',
        /precio propio/i.test(txt(filas()[0])));
  const btnPropio = Array.from(container.querySelectorAll('button')).find(b => txt(b).includes('Guardar cambios'));
  await click(btnPropio);
  const lotePropio = RPC_LOG.filter(r => r.nombre === 'b2b_rpc_admin_set_producto');
  check('el precio propio viaja en precios_canal, no como precio_base',
        lotePropio.length === 1
        && lotePropio[0].payload.items[0].sku === 'MAD100'
        && lotePropio[0].payload.items[0].precios_canal.distribuidor === 61000
        && !('precio_base' in lotePropio[0].payload.items[0]),
        JSON.stringify(lotePropio[0] && lotePropio[0].payload.items));

  /* publicar sin precio: MAD300 no tiene precio_base.
     Se remonta para arrancar con el log de RPC limpio. */
  await montar('owner', true);
  await clickTab('Catálogo');
  const checks = Array.from(container.querySelectorAll('input[type="checkbox"]'));
  const chkMad300 = checks[checks.length - 1];
  await tildar(chkMad300, true);
  check('publicar sin precio se marca como error antes de mandar nada',
        /Falta el precio/i.test(cuerpo()) && /quedan? publicado/i.test(cuerpo()));
  const btnGuardar = Array.from(container.querySelectorAll('button')).find(b => txt(b).includes('Guardar cambios'));
  check('el botón de guardar queda deshabilitado', !!btnGuardar && btnGuardar.disabled);
  check('no se mandó ningún lote al backend',
        !RPC_LOG.some(r => r.nombre === 'b2b_rpc_admin_set_producto'));

  /* guardado válido: el precio de lista de MAD200 (fila 1, primer campo) */
  await tildar(chkMad300, false);
  await tipear(camposDe(1)[0], '60000');
  const btnOk = Array.from(container.querySelectorAll('button')).find(b => txt(b).includes('Guardar cambios'));
  check('con datos válidos el guardado se habilita', !!btnOk && !btnOk.disabled);
  await click(btnOk);
  const lote = RPC_LOG.filter(r => r.nombre === 'b2b_rpc_admin_set_producto');
  check('guarda en UN solo lote (transacción única, no un request por SKU)',
        lote.length === 1 && Array.isArray(lote[0].payload.items) && lote[0].payload.items.length === 1,
        JSON.stringify(lote[0] && lote[0].payload));
  check('el lote manda el precio como número, no como texto',
        lote.length === 1 && lote[0].payload.items[0].sku === 'MAD200'
        && lote[0].payload.items[0].precio_base === 60000,
        JSON.stringify(lote[0] && lote[0].payload.items));

  /* (5b) Pegar precios: es la vía real de carga de los 61 SKU de los dos
     catálogos de julio, así que el parser tiene su propia red. */
  console.log('\n— Pegar precios —');
  await montar('owner', true);
  await clickTab('Catálogo');
  await clickTexto('button', 'Pegar precios');
  const area = container.querySelector('textarea');
  check('el modal de pegado abre con su caja de texto', !!area);
  await tipearArea(area,
    'MAD100\t$ 45.000,50\n'   +   // símbolo de moneda + miles con punto y decimal con coma
    'mad200; 28500\n'         +   // minúscula + punto y coma
    'MAD300 112.000\n'        +   // separado por espacio, miles con punto
    'MAD100,99000\n'          +   // repetido: vale el primero
    'NOEXISTE 1000\n'         +   // SKU que no está en el catálogo
    'MAD200 sinprecio\n');        // sin número válido
  check('lee las tres formas de pegar (tab, punto y coma, espacio)',
        /3\s*para cargar/.test(cuerpo().replace(/\s+/g,' ')), cuerpo().slice(0, 200));
  check('avisa el SKU que no existe', /1 SKU que no existe/i.test(cuerpo()));
  check('avisa la línea sin precio válido', /1 sin precio válido/i.test(cuerpo()));
  check('avisa el repetido y aclara que vale el primero',
        /1 repetido/i.test(cuerpo()) && /vale el primero/i.test(cuerpo()));

  await clickTexto('button', 'Cargar');
  check('lo pegado entra al borrador, no directo a la base',
        !RPC_LOG.some(r => r.nombre === 'b2b_rpc_admin_set_producto'));
  check('quedan los 3 productos sin guardar', /3 productos sin guardar/i.test(cuerpo()));
  check('el precio pegado se lee entero, sin cortarse en el decimal',
        camposDe(0)[0].value === '45000.5', camposDe(0)[0].value);
  check('los miles con punto se leen como miles', camposDe(2)[0].value === '112000',
        camposDe(2)[0].value);
  await clickTexto('button', 'Guardar cambios');
  const lotePegado = RPC_LOG.filter(r => r.nombre === 'b2b_rpc_admin_set_producto');
  check('los 3 precios pegados se guardan en un solo lote y como número',
        lotePegado.length === 1 && lotePegado[0].payload.items.length === 3
        && lotePegado[0].payload.items.every(i => typeof i.precio_base === 'number'),
        JSON.stringify(lotePegado[0] && lotePegado[0].payload.items));

  /* Pegar a un canal carga precios_canal, no precio_base: así entra el
     catálogo de distribuidor, que no sale de multiplicar la lista. */
  await montar('owner', true);
  await clickTab('Catálogo');
  await clickTexto('button', 'Pegar precios');
  const selDestino = container.querySelector('[data-modal] select');
  check('se elige a qué columna van los precios pegados', !!selDestino);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set;
    setter.call(selDestino, 'distribuidor');
    selDestino.dispatchEvent(new dom.window.Event('change', { bubbles:true }));
  });
  await flush();
  check('avisa que ese canal deja de pasar por el coeficiente',
        /sin pasar por el coeficiente/i.test(cuerpo()));
  await tipearArea(container.querySelector('textarea'), 'MAD100 61000\n');
  await clickTexto('button', 'Cargar');
  await clickTexto('button', 'Guardar cambios');
  const loteCanal = RPC_LOG.filter(r => r.nombre === 'b2b_rpc_admin_set_producto');
  check('pegar a un canal escribe precios_canal y deja el precio de lista quieto',
        loteCanal.length === 1
        && loteCanal[0].payload.items[0].precios_canal.distribuidor === 61000
        && !('precio_base' in loteCanal[0].payload.items[0]),
        JSON.stringify(loteCanal[0] && loteCanal[0].payload.items));

  /* (6) Canales: owner-only */
  console.log('\n— Canales —');
  await montar('admin', true);
  await clickTab('Catálogo');
  await clickTexto('button', 'Canales');
  const inputsCanal = Array.from(container.querySelectorAll('input[type="number"]'))
    .filter(i => i.closest('table') && (i.closest('table').textContent || '').includes('Coeficiente'));
  check('un admin ve los coeficientes pero no los puede tocar',
        inputsCanal.length > 0 && inputsCanal.every(i => i.disabled), `${inputsCanal.length} inputs`);
  check('a un admin no se le ofrece guardar canales',
        !Array.from(container.querySelectorAll('button')).some(b => txt(b).includes('Guardar canales')));

  await montar('owner', true);
  await clickTab('Catálogo');
  await clickTexto('button', 'Canales');
  const coefOwner = Array.from(container.querySelectorAll('input[type="number"]'))
    .filter(i => i.closest('table') && (i.closest('table').textContent || '').includes('Coeficiente'));
  check('el dueño sí los puede editar', coefOwner.length > 0 && coefOwner.every(i => !i.disabled));
  await tipear(coefOwner[0], '0.6');
  check('muestra en vivo el porcentaje que pasa a pagar ese canal', /paga el 60%/.test(cuerpo()));
  await clickTexto('button', 'Guardar canales');
  check('cambiar coeficientes pide confirmación (reprecia todo el catálogo)',
        !!container.querySelector('[data-confirm]'));
  /* Web y mobile lo dicen distinto ("no se tocan" / "tampoco"), pero las dos
     tienen que decir las dos cosas: que los pedidos enviados no se repricean y
     que cada uno guarda el precio con el que se cerró. */
  check('la confirmación aclara que los pedidos ya enviados no se repricean',
        /pedidos ya enviados/i.test(cuerpo()) && /precio con el que se cerr/i.test(cuerpo()),
        (cuerpo().match(/Esto cambia[^¿]*/) || [''])[0].slice(0, 160));
  check('la confirmación aclara que un precio propio de canal no se pisa',
        /precio propio no se mueven|NO tengan precio propio/i.test(cuerpo()));
  await click(container.querySelector('[data-confirm-ok]'));
  const escrituraCanal = RPC_LOG.filter(r => r.nombre === 'b2b_rpc_admin_canales' && r.payload && r.payload.canales);
  check('recién ahí escribe, y manda los 3 canales',
        escrituraCanal.length === 1 && escrituraCanal[0].payload.canales.length === 3
        && Number(escrituraCanal[0].payload.canales[0].coeficiente) === 0.6,
        JSON.stringify(escrituraCanal[0] && escrituraCanal[0].payload.canales));

  /* (7) El token de invitación se muestra una sola vez */
  console.log('\n— Invitación —');
  await montar('owner', true);
  await clickTab('Accesos');
  await clickTexto('button', 'Invitar mayorista');
  const inputs = Array.from(container.querySelectorAll('input'));
  const email = inputs.find(i => i.type === 'email');
  check('el modal de invitación abre', !!email);
  if (email) {
    await tipear(email, 'test@mayorista.com');
    const selCanal = container.querySelector('[data-modal] select');
    check('el canal se elige al invitar (fija el precio que va a ver)', !!selCanal);
    const radios = Array.from(container.querySelectorAll('input[type="radio"]'));
    await tildar(radios[1], true);   // "Es nuevo"
    const razon = Array.from(container.querySelectorAll('input'))
      .find(i => (i.placeholder || '').includes('Razón social'));
    if (razon) await tipear(razon, 'Nuevo Corralon SA');
    await clickTexto('button', 'Crear invitación');
    const inv = RPC_LOG.filter(r => r.nombre === 'b2b_rpc_crear_invitacion');
    check('crear invitación manda email, canal y cliente',
          inv.length === 1 && inv[0].payload.email === 'test@mayorista.com'
          && !!inv[0].payload.canal && inv[0].payload.cliente_nombre === 'Nuevo Corralon SA',
          JSON.stringify(inv[0] && inv[0].payload));
    /* El token va en un <input readOnly> (se selecciona al hacer foco y hay
       botón Copiar) — o sea que NO está en textContent, hay que leer .value. */
    const inputTok = Array.from(container.querySelectorAll('input')).find(i => i.readOnly);
    check('el token queda en un campo listo para copiar',
          !!inputTok && inputTok.value === 'TOKENSECRETO123', inputTok && inputTok.value);
    check('hay botón de copiar al lado',
          Array.from(container.querySelectorAll('button')).some(b => txt(b).includes('Copiar')));
    check('avisa fuerte que el código no se vuelve a ver', /una sola vez/i.test(cuerpo()));
    check('dice a qué mail hay que mandárselo', cuerpo().includes('test@mayorista.com'));
  }


  /* (N) Clientes: qué catálogos ve cada uno --------------------------- */
  console.log('\n— Clientes · catálogos habilitados —');

  const filaCli = (nombre) => filas().find(tr => txt(tr).includes(nombre));
  const enModal = (sel) => Array.from(container.querySelectorAll('[data-modal] ' + sel));
  const chkCanal = (nombre) => {
    const l = enModal('.b2b-cli-canal').find(x => txt(x).includes(nombre));
    return l && l.querySelector('input[type="checkbox"]');
  };
  const btnGuardarCli = () => enModal('button').find(b => txt(b).includes('Guardar cambios'));
  const ultimoSet = () => [...RPC_LOG].reverse().find(r => r.nombre === 'b2b_rpc_admin_set_cliente');

  await montar('owner', true);
  await clickTab('Clientes');
  check('la lista de clientes carga', !!filaCli('Corralon Sur') && !!filaCli('Distribuidora Norte'),
        filas().length + ' filas');
  check('★ la fila muestra TODOS los catálogos que tiene habilitados, no solo el de arranque',
        /Distribuidor/.test(txt(filaCli('Distribuidora Norte')))
        && /\+ Mayorista/.test(txt(filaCli('Distribuidora Norte'))),
        txt(filaCli('Distribuidora Norte')));
  check('el que tiene uno solo no muestra un "+" vacío',
        !/\+/.test(txt(filaCli('Corralon Sur'))), txt(filaCli('Corralon Sur')));

  /* Un catálogo → dos. Es el alta del "mismo usuario, dos listas". */
  await click(filaCli('Corralon Sur').querySelector('button'));
  check('el modal ofrece solo los catálogos activos',
        enModal('.b2b-cli-canal').length === CANALES_VISIBLES.length,
        `ofrece ${enModal('.b2b-cli-canal').length}`);
  /* 0165 otra vez: si un canal apagado siguiera apareciendo acá, el primer
     click del dueño metería un cliente en un catálogo que el backend después
     le rechaza (b2b_rpc_admin_cliente exige "and activo"). */
  check('★ y NO ofrece el que está apagado',
        !/minorista/i.test(enModal('.b2b-cli-canal').map(e => txt(e)).join(' ')),
        enModal('.b2b-cli-canal').map(e => txt(e)).join(' | '));
  check('viene tildado solo el que tiene',
        enModal('.b2b-cli-canal input:checked').length === 1 && !!chkCanal('Mayorista').checked);
  check('★ con un solo catálogo no se pregunta con cuál arranca (no hay nada que elegir)',
        enModal('select').length === 0);

  await tildar(chkCanal('Distribuidor'), true);
  check('★ avisa que sigue siendo el mismo usuario y que va a elegir al entrar',
        /mismo usuario/i.test(cuerpo()) && /preguntar/i.test(cuerpo()));
  check('recién con dos aparece con cuál arranca', enModal('select').length === 1);

  await click(btnGuardarCli());
  const setA = ultimoSet();
  check('★ guarda la lista de catálogos habilitados',
        !!setA && Array.isArray(setA.payload.canales)
        && setA.payload.canales.join(',') === 'distribuidor,mayorista',
        JSON.stringify(setA && setA.payload));
  check('no manda el catálogo de arranque si no cambió',
        !!setA && !('canal' in setA.payload), JSON.stringify(setA && setA.payload));

  /* Sacarle el catálogo que además era el de arranque. */
  await clickTab('Clientes');
  await click(filaCli('Distribuidora Norte').querySelector('button'));
  check('el cliente con dos viene con los dos tildados',
        enModal('.b2b-cli-canal input:checked').length === 2);

  await tildar(chkCanal('Distribuidor'), false);
  check('★ avisa que el pedido en curso de ese catálogo NO se borra',
        /no se borra nada/i.test(cuerpo()) && /vuelve a aparecer/i.test(cuerpo()));
  check('★ el catálogo de arranque se corre solo al que queda (igual que el backend)',
        enModal('select').length === 0 && /Mayorista/.test(txt(container.querySelector('[data-modal]'))));

  await click(btnGuardarCli());
  const setB = ultimoSet();
  check('guarda la lista achicada', !!setB && setB.payload.canales.join(',') === 'mayorista',
        JSON.stringify(setB && setB.payload));
  check('★ y manda también el nuevo catálogo de arranque, no lo deja apuntando al que sacó',
        !!setB && setB.payload.canal === 'mayorista', JSON.stringify(setB && setB.payload));

  /* Ninguno: el backend lo rechaza, así que acá ni se ofrece. */
  await clickTab('Clientes');
  await click(filaCli('Corralon Sur').querySelector('button'));
  const antesCli = RPC_LOG.filter(r => r.nombre === 'b2b_rpc_admin_set_cliente').length;
  await tildar(chkCanal('Mayorista'), false);
  check('★ sin ningún catálogo no deja guardar', !!btnGuardarCli() && btnGuardarCli().disabled);
  check('y explica que para cortarle la compra se usa el acceso, no las listas',
        /al menos un catálogo/i.test(cuerpo()) && /Puede entrar y hacer pedidos/.test(cuerpo()));
  check('no llegó ninguna escritura al backend',
        RPC_LOG.filter(r => r.nombre === 'b2b_rpc_admin_set_cliente').length === antesCli);

  console.log(`\n${pass}/${pass + fail} checks · fallos: ${fail}\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\nEXPLOTÓ: ' + e.message + '\n' + e.stack); process.exit(1); });
