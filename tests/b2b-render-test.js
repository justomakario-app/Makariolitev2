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
  { sku:'MAD100', modelo:'Mesa Nordica', color:'Blanco', categoria:'Mesas', publicado:true,  precio_base:100000, moneda:'ARS', orden:3 },
  { sku:'MAD200', modelo:'Silla Viena',  color:'Negro',  categoria:'Sillas', publicado:false, precio_base:50000,  moneda:'ARS', orden:7 },
  { sku:'MAD300', modelo:'Banco Pino',   color:'Natural',categoria:'Bancos', publicado:false, precio_base:null,   moneda:'ARS', orden:5 },
];

/* El maestro (sku_catalog) NO es el catálogo de la tienda: tiene cosas que
   todavía no están a la venta. Esa diferencia es todo el punto del alta.

     · MAD400 existe en el maestro y NO en la tienda — el caso que antes no
       tenía pantalla: el producto era invisible y no había forma de ponerle
       precio ni de publicarlo.
     · MAD100 está publicado pero DADO DE BAJA en el maestro. La tienda del
       cliente pide las dos (publicado y activo), el panel mostraba solo la
       primera: el tilde puesto y nadie lo ve.
     · MAD200 tiene `incompleto` en true, que se marca desde Base de
       productos. Guardar desde acá no puede borrárselo. */
const BASE_SKUS = [
  { sku:'MAD100', modelo:'Mesa Nordica', color:'Blanco',  color_hex:'#ffffff', categoria:'Mesas',
    es_fabricado:true, activo:false, incompleto:false },
  { sku:'MAD200', modelo:'Silla Viena',  color:'Negro',   color_hex:'#1a1a1a', categoria:'Sillas',
    es_fabricado:true, activo:true,  incompleto:true },
  { sku:'MAD300', modelo:'Banco Pino',   color:'Natural', color_hex:'#d4a574', categoria:'Bancos',
    es_fabricado:true, activo:true,  incompleto:false },
  { sku:'MAD400', modelo:'Repisa Roble', color:'Roble',   color_hex:'#8b6f47', categoria:'Estantes',
    es_fabricado:false, activo:true, incompleto:false },
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

const STORAGE_LOG = [];
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
  /* El fake no tenía `storage`, así que cualquier click en "Subir foto"
     moría con TypeError antes de llegar a ninguna verificación. Guarda lo
     subido para poder mirar QUÉ se subió y con qué ruta. */
  storage: {
    from(bucket) {
      return {
        upload(ruta, file, opts) {
          STORAGE_LOG.push({ bucket, ruta, tipo: file && file.type, opts });
          return Promise.resolve({ data:{ path: ruta }, error:null });
        },
        getPublicUrl(ruta) {
          return { data:{ publicUrl: 'https://fake.supabase/' + bucket + '/' + ruta } };
        },
      };
    },
  },
};
dom.window.SUPA = SUPA;

/* ADMIN_DATA: solo lo que toca el panel B2B. listPedidosMayoristas es
   owner/admin en el backend, así que para 'ventas' se simula el 42501. */
let ROL = 'owner';
const ADMIN_LOG = [];

/* Facturas: el panel las pide al montarse y las vuelve a pedir después de
   subir una. El fake guarda de verdad en FACTURAS para que "subir" y "listar"
   estén conectados — si estuvieran desconectados (subir OK, listar devuelve
   siempre lo mismo) el test no podría ver el bug de "confirma y no aparece". */
const FACTURAS = [
  { id:'f1', pedido_id:'pm1', cliente_id:'c1', tipo:'factura', numero:'0001-00000123',
    fecha:'2026-08-20', total:210000, path:'c1/f1.pdf', size_bytes:120000,
    subio:'Justo', pedido_numero:'B2B-0001' },
];
const FACTURA_TIPO_OPTIONS = [
  { value:'factura', label:'Factura' }, { value:'nota_credito', label:'Nota de crédito' },
  { value:'recibo', label:'Recibo' },  { value:'remito', label:'Remito' },
  { value:'otro', label:'Otro comprobante' },
];

let BASE_ROMPE = false;

dom.window.ADMIN_DATA = {
  loadCustomersB2B: async () => [{ id:'c1', nombre:'Corralon Sur', cuit:'30-111-1' }],
  /* El maestro se lee acá y no en b2b-data.js: la tienda del cliente carga
     ese archivo y no tiene por qué recibir la lista de todo lo que la fábrica
     sabe hacer. Puede fallar sin voltear la pantalla de precios. */
  baseProductos: async () => {
    if (BASE_ROMPE) throw new Error('No se pudo cargar la base de productos');
    return BASE_SKUS.map(r => Object.assign({}, r));
  },
  listPedidosMayoristas: async () => {
    if (ROL === 'ventas') { const e = new Error('Sin permiso.'); e.code = '42501'; throw e; }
    return PEDIDOS_MAY;
  },
  updateEstadoPedidoMayorista: async (p) => { ADMIN_LOG.push(p); return { ok:true }; },

  FACTURA_MIMES: ['application/pdf', 'image/jpeg', 'image/png'],
  FACTURA_MAX_BYTES: 10 * 1024 * 1024,
  FACTURA_TIPO_OPTIONS,
  FACTURA_TIPO_LABELS: FACTURA_TIPO_OPTIONS.reduce((a, o) => { a[o.value] = o.label; return a; }, {}),
  listarFacturas: async (p) => FACTURAS.filter(f =>
    (p && p.pedido_id) ? f.pedido_id === p.pedido_id : f.cliente_id === (p && p.cliente_id)),
  subirFactura: async (p) => {
    const f = Object.assign({ id:'f' + (FACTURAS.length + 1), path:'c1/nueva.pdf',
                              size_bytes:1000, subio:'Justo' }, p);
    delete f.file;
    FACTURAS.push(f);
    ADMIN_LOG.push({ subirFactura: f });
    return f;
  },
  borrarFactura: async (id) => {
    const i = FACTURAS.findIndex(f => f.id === id);
    if (i >= 0) FACTURAS.splice(i, 1);
    return { ok:true };
  },
};

/* MOCK_ACTIONS vive en data.js (el panel entero, no solo B2B). El alta lo usa
   para escribir en sku_catalog: es el ÚNICO escritor del maestro que hay en la
   app, y pasar por él es lo que mantiene una sola forma de crear un producto.
   El log deja ver qué se mandó, que es donde estaba el riesgo: guardar con
   datos de display renombraría el producto y le borraría `incompleto`. */
const SKU_LOG = [];
dom.window.MOCK_ACTIONS = {
  crearOActualizarSku: async (sku, payload, isNew) => {
    SKU_LOG.push({ sku, payload, isNew });
    if (isNew && BASE_SKUS.some(r => r.sku === sku)) {
      throw new Error('duplicate key value violates unique constraint "sku_catalog_pkey"');
    }
    return { sku };
  },
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

/* Igual que en tienda-render-test.js: esta lista tiene que tener los MISMOS
   archivos que carga el HTML. Si no, el test monta un panel que no existe —
   un componente nuevo puede compilar y renderizar perfecto acá y no estar en
   el <script> del HTML, o sea no llegar nunca al browser.
   Al revés también importa, y fue lo que pasó de verdad: b2b-facturas.jsx
   entró al HTML y nadie lo agregó acá, así que la suite quedó en rojo desde
   el commit de facturas y dejó de avisar de cualquier otra cosa. Un arnés
   roto no protege: hay que enterarse el día que se desfasa, no meses después. */
const COMPONENTES = ['admin/b2b-facturas.jsx', 'admin/b2b-solicitudes-tab.jsx',
                     'admin/b2b-catalogo-tab.jsx', 'admin/b2b-pedidos-tab.jsx',
                     'admin/b2b-clientes-tab.jsx', 'admin/b2b-tienda-tab.jsx'];

const HTML_PANEL = fs.readFileSync(
  path.join(ROOT, VARIANT === 'web' ? 'web/Macario Lite.html' : 'mobile/index.html'), 'utf8');
const EN_HTML = [...HTML_PANEL.matchAll(/src="components\/(admin\/b2b-[a-z0-9-]+\.jsx)/g)].map(m => m[1]);
if ([...EN_HTML].sort().join('|') !== [...COMPONENTES].sort().join('|')) {
  console.error('Los componentes B2B del test NO coinciden con los del HTML');
  console.error('  test: ' + COMPONENTES.join(', '));
  console.error('  html: ' + EN_HTML.join(', '));
  process.exit(1);
}

/* UN SOLO scope para todos, igual que en el browser: los <script> son
   clasicos y comparten un unico scope lexico, asi que b2b-pedidos-tab.jsx
   puede nombrar <B2BFacturasPanel/> pelado y resolverlo. Cargarlos de a uno
   en su propio `new Function` no reproduce eso: cada archivo quedaba aislado
   y una referencia entre archivos explotaba aca aunque en produccion ande.
   Eso es un falso NEGATIVO — el test rompe por como esta armado el test, no
   por el producto — y es lo que tuvo la suite en rojo desde el commit de
   facturas. El preambulo va una sola vez, adelante de todo. */
const FUENTE = COMPONENTES.map(f => fs.readFileSync(path.join(BASE, f), 'utf8')).join('\n;\n');
const CODIGO = Babel.transform(preamble + FUENTE, { presets:['react'], filename:'b2b-panel.jsx' }).code;
new Function('React', 'window', 'document', CODIGO)(React, dom.window, dom.window.document);

/* ── Utilidades de montaje ─────────────────────────────────────────────── */
const container = dom.window.document.getElementById('root');
let root;
const flush = async () => { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); }); };

async function montar(rol, flag, rompe) {
  ROL = rol; FLAG = flag !== false; FLAG_ROMPE = !!rompe;
  dom.window.MOCK = { user: { role: rol }, categories: ['Mesas', 'Sillas', 'Bancos'] };
  dom.window.__TOASTS = [];
  RPC_LOG.length = 0; ADMIN_LOG.length = 0;
  SKU_LOG.length = 0; STORAGE_LOG.length = 0;
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
  /* La pestaña arranca mostrando a TODOS (verTodos = true): es la lista de
     usuarios de la tienda, no una bandeja de pendientes. Destildando queda
     solo lo frenado. Se comprueban las dos vistas, no una sola. */
  check('arranca mostrando también a los ya aprobados', cuerpo().includes('Caro Lopez'));
  const tgVerTodos = Array.from(container.querySelectorAll('input[type="checkbox"]'))
    .find(i => txt(i.closest('label') || i).includes('Ver todos'));
  check('hay un filtro para ver solo a los frenados', !!tgVerTodos);
  if (tgVerTodos) {
    await act(async () => { tgVerTodos.click(); });   // jsdom togglea y dispara el change de React
    await flush();
    check('★ destildado deja solo a los frenados (el aprobado desaparece)',
          !cuerpo().includes('Caro Lopez') && cuerpo().includes('Ana Perez'));
    await act(async () => { tgVerTodos.click(); });
    await flush();
  }
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

  /* (5c) Alta y ficha del producto ─────────────────────────────────────
     Hasta acá el panel sabía poner precios, no productos. El dueño tenía que
     crear el SKU en Ventas → Base de productos y después no aparecía nunca en
     esta pantalla, porque la grilla arranca de b2b_producto: quedaba invisible
     y sin forma de ponerle precio. Lo que se prueba es esa cadena entera, que
     cruza DOS tablas y por eso puede fallar a la mitad diciendo que anduvo. */
  console.log('\n— Alta y ficha del producto —');
  await montar('owner', true);
  await clickTab('Catálogo');

  check('★ avisa que un publicado dado de baja no lo ve el mayorista',
        /Inactivo: no se ve/i.test(cuerpo()), cuerpo().slice(0, 300));

  await clickTexto('button', 'Agregar producto');
  const ficha = () => container.querySelector('[data-modal]');
  const fNum  = () => Array.from(ficha().querySelectorAll('input[type="number"]'));
  const fChk  = () => Array.from(ficha().querySelectorAll('input[type="checkbox"]'));
  const fPh   = (ph) => Array.from(ficha().querySelectorAll('input'))
                          .find(i => (i.getAttribute('placeholder') || '').includes(ph));
  const btnFicha = () => Array.from(ficha().querySelectorAll('button'))
                          .find(b => /Agregar al catálogo|^Guardar$/.test(txt(b)));
  check('la ficha en blanco abre desde el botón', !!ficha());
  check('pide el código antes que nada', !!fPh('MAD500'));
  check('no deja guardar una ficha vacía', !!btnFicha() && btnFicha().disabled);

  /* Un código mal escrito moría con "violates check constraint
     sku_catalog_sku_check". El CHECK de la base está replicado del lado del
     panel para que el error se pueda leer y corregir. */
  await tipear(fPh('MAD500'), 'MAD-500');
  check('★ el código mal escrito se explica en castellano, no con el CHECK crudo',
        /2 a 4 letras/i.test(txt(ficha())) && !/check constraint/i.test(txt(ficha())),
        txt(ficha()).slice(0, 200));
  check('y no deja guardar', btnFicha().disabled);

  /* Duplicar un SKU que ya está en la tienda daba error 23505 crudo. */
  await tipear(fPh('MAD500'), 'MAD100');
  check('★ avisa que ese producto ya está en la tienda, sin ir a la base',
        /ya está en el catálogo/i.test(txt(ficha())) && btnFicha().disabled,
        txt(ficha()).slice(0, 200));

  /* El caso que no tenía pantalla: existe en el maestro, no en la tienda. */
  await tipear(fPh('MAD500'), 'mad400');
  check('★ reconoce el código en minúscula (nadie escribe en mayúscula)',
        /ya existe en tu base/i.test(txt(ficha())), txt(ficha()).slice(0, 220));
  const nombreInput = Array.from(ficha().querySelectorAll('input'))
    .find(i => i.value === 'Repisa Roble');
  check('trae los datos del maestro en vez de pedirlos de nuevo', !!nombreInput);
  check('no deja publicar sin precio tampoco desde la ficha',
        (await (async () => { await tildar(fChk()[2], true); return /precio de lista/i.test(txt(ficha())); })())
        && btnFicha().disabled, txt(ficha()).slice(0, 260));

  await tipear(fNum()[0], '80000');
  check('con precio ya se puede publicar', !btnFicha().disabled);
  await click(btnFicha());
  check('★ adoptar un SKU existente NO lo crea de nuevo',
        SKU_LOG.length === 0, JSON.stringify(SKU_LOG));
  const alta = RPC_LOG.filter(r => r.nombre === 'b2b_rpc_admin_set_producto');
  check('lo suma a la tienda con su precio y publicado',
        alta.length === 1 && alta[0].payload.items[0].sku === 'MAD400'
        && alta[0].payload.items[0].precio_base === 80000
        && alta[0].payload.items[0].publicado === true,
        JSON.stringify(alta[0] && alta[0].payload.items));
  check('★ el producto nuevo va al final de la tienda, no al principio',
        alta[0].payload.items[0].orden === 8,
        String(alta[0] && alta[0].payload.items[0].orden));

  /* Alta de un producto que no existe en ningún lado: dos tablas, en orden. */
  await montar('owner', true);
  await clickTab('Catálogo');
  await clickTexto('button', 'Agregar producto');
  await tipear(fPh('MAD500'), 'MAD900');
  await tipear(fPh('Mesa Nórdica Petiribí'), 'Mesa Gota XS');
  await tipear(fNum()[0], '120000');
  await tipear(fNum()[2], '95000');           // precio propio de mayorista
  await tildar(fChk()[2], true);              // publicado
  await click(btnFicha());
  check('★ el SKU se crea en el maestro ANTES de la fila comercial',
        SKU_LOG.length === 1 && SKU_LOG[0].sku === 'MAD900' && SKU_LOG[0].isNew === true
        && SKU_LOG[0].payload.modelo === 'Mesa Gota XS',
        JSON.stringify(SKU_LOG));
  const alta2 = RPC_LOG.filter(r => r.nombre === 'b2b_rpc_admin_set_producto');
  check('y después nace en la tienda, publicado y con precio, en UNA sola llamada',
        alta2.length === 1 && alta2[0].payload.items[0].sku === 'MAD900'
        && alta2[0].payload.items[0].publicado === true
        && alta2[0].payload.items[0].precio_base === 120000,
        JSON.stringify(alta2[0] && alta2[0].payload.items));
  check('el precio propio de canal viaja aparte del precio de lista',
        alta2[0].payload.items[0].precios_canal.mayorista === 95000
        && alta2[0].payload.items[0].precios_canal.distribuidor === null,
        JSON.stringify(alta2[0].payload.items[0].precios_canal));

  /* La ficha de un producto que ya está: edita TODO, no solo las reglas. */
  await montar('owner', true);
  await clickTab('Catálogo');
  /* El lápiz de la grilla no tiene texto, solo el ícono: se busca por su
     título, que es lo mismo que ve el dueño al pasar el mouse. */
  const lapizDe = (i) => Array.from(container.querySelectorAll('tbody button'))
    .filter(b => /Editar la ficha/.test(b.getAttribute('title') || ''))[i];
  check('el lápiz de la grilla dice que abre la ficha entera, no solo las reglas',
        !!lapizDe(0) && /nombre, color, categoría, precio, foto/.test(lapizDe(0).getAttribute('title')),
        lapizDe(0) && lapizDe(0).getAttribute('title'));
  await click(lapizDe(0));
  check('la ficha de un producto existente abre con su nombre',
        !!Array.from(ficha().querySelectorAll('input')).find(i => i.value === 'Mesa Nordica'));
  check('★ y avisa ahí mismo que está dado de baja y no se ve',
        /el mayorista no lo ve/i.test(txt(ficha())), txt(ficha()).slice(0, 300));

  /* Cambiar el nombre de MAD200 (fila 1). `incompleto` está en true y se pone
     desde otra pantalla: guardar desde acá no puede borrárselo. */
  await montar('owner', true);
  await clickTab('Catálogo');
  await click(lapizDe(1));
  const nom = Array.from(ficha().querySelectorAll('input')).find(i => i.value === 'Silla Viena');
  await tipear(nom, 'Silla Viena Reforzada');
  await click(btnFicha());
  check('★ editar el nombre no le borra la marca de "faltan datos"',
        SKU_LOG.length === 1 && SKU_LOG[0].payload.incompleto === true
        && SKU_LOG[0].isNew === false,
        JSON.stringify(SKU_LOG));
  check('y el nombre viaja como se escribió',
        SKU_LOG[0].payload.modelo === 'Silla Viena Reforzada', JSON.stringify(SKU_LOG[0].payload));

  /* Guardar desde la ficha recargaba todo y vaciaba el borrador de la grilla:
     el que venía pegando precios los perdía sin que nada se lo avisara. */
  await montar('owner', true);
  await clickTab('Catálogo');
  await tipear(camposDe(0)[0], '333000');
  check('hay un precio en el borrador antes de abrir la ficha',
        /1 producto sin guardar/i.test(cuerpo()));
  await click(lapizDe(2));
  await tipear(fNum()[3], '4');               // múltiplo de MAD300
  await click(btnFicha());
  check('★ guardar una ficha no se lleva puesto el borrador de los otros',
        /1 producto sin guardar/i.test(cuerpo()) && camposDe(0)[0].value === '333000',
        camposDe(0)[0].value);

  /* La foto no se sube al elegirla: viaja al guardar. Antes, cancelar el alta
     después de elegir la foto dejaba el archivo colgado en el bucket. */
  await montar('owner', true);
  await clickTab('Catálogo');
  await clickTexto('button', 'Agregar producto');
  await tipear(fPh('MAD500'), 'MAD901');
  await tipear(fPh('Mesa Nórdica Petiribí'), 'Banqueta Alta');
  const inputFoto = ficha().querySelector('input[type="file"]');
  check('la ficha tiene por dónde subir la foto', !!inputFoto);
  await act(async () => {
    Object.defineProperty(inputFoto, 'files', {
      configurable: true,
      value: [{ name:'foto.jpg', type:'image/jpeg', size: 50000 }],
    });
    inputFoto.dispatchEvent(new dom.window.Event('change', { bubbles:true }));
  });
  await flush();
  check('★ elegir la foto todavía no la sube (cancelar no deja basura)',
        STORAGE_LOG.length === 0, JSON.stringify(STORAGE_LOG));
  await click(btnFicha());
  check('★ la foto se sube recién al guardar, con el código ya definitivo',
        STORAGE_LOG.length === 1 && STORAGE_LOG[0].ruta === 'MAD901/foto.jpg'
        && STORAGE_LOG[0].bucket === 'b2b_fotos',
        JSON.stringify(STORAGE_LOG));
  const altaFoto = RPC_LOG.filter(r => r.nombre === 'b2b_rpc_admin_set_producto');
  check('y la ruta queda guardada en el producto',
        altaFoto.length === 1 && altaFoto[0].payload.items[0].foto_path === 'MAD901/foto.jpg',
        JSON.stringify(altaFoto[0] && altaFoto[0].payload.items));

  /* Si el maestro no carga, la pantalla de precios tiene que seguir andando y
     el alta tiene que decir por qué no se puede. Lo que no puede pasar es que
     el nombre se deje editar y guardar en el vacío. */
  BASE_ROMPE = true;
  await montar('owner', true);
  await clickTab('Catálogo');
  BASE_ROMPE = false;
  check('★ si falla la base de productos, los precios se siguen cargando',
        cuerpo().includes('MAD100') && container.querySelectorAll('tbody input[type="number"]').length > 0);
  const btnAlta = Array.from(container.querySelectorAll('button'))
    .find(b => txt(b).includes('Agregar producto'));
  check('★ y el alta queda apagada con el motivo, no rota',
        !!btnAlta && btnAlta.disabled
        && /base de productos/i.test(btnAlta.getAttribute('title') || ''),
        btnAlta && btnAlta.getAttribute('title'));
  await click(lapizDe(0));
  const nomRoto = Array.from(ficha().querySelectorAll('input')).find(i => i.value === 'Mesa Nordica');
  check('★ y el nombre no se deja editar para no guardar en el vacío',
        !!nomRoto && nomRoto.disabled && /no se pudo leer la base/i.test(txt(ficha())),
        txt(ficha()).slice(0, 200));

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
       botón Copiar) — o sea que NO está en textContent, hay que leer .value.
       Ojo: readOnly hay más de uno — en la pestaña también está el link de
       alta abierta (?alta=1). Se busca por contenido, no por posición. */
    const readOnlys = Array.from(container.querySelectorAll('input')).filter(i => i.readOnly);
    const inputTok = readOnlys.find(i => i.value === 'TOKENSECRETO123');
    check('el token queda en un campo listo para copiar',
          !!inputTok, readOnlys.map(i => i.value).join(' | '));
    /* El link que el dueño realmente copia y manda. Si el token no viaja
       adentro, el mayorista abre la tienda y no le sirve de nada — y eso no
       se ve mirando la pantalla, que muestra un link con buena pinta. */
    const inputLink = readOnlys.find(i => /\/tienda\/\?codigo=/.test(i.value || ''));
    check('★ el link que se le manda lleva el token adentro',
          !!inputLink && inputLink.value.includes('TOKENSECRETO123'),
          readOnlys.map(i => i.value).join(' | '));
    check('hay botón de copiar al lado',
          Array.from(container.querySelectorAll('button')).some(b => txt(b).includes('Copiar')));
    check('avisa fuerte que el código no se vuelve a ver', /una sola vez/i.test(cuerpo()));
    check('dice a qué mail hay que mandárselo', cuerpo().includes('test@mayorista.com'));
  }


  /* (N) Clientes: qué catálogos ve cada uno --------------------------- */
  console.log('\n— Clientes · catálogos habilitados —');

  const filaCli = (nombre) => filas().find(tr => txt(tr).includes(nombre));
  /* Por etiqueta, NO por posición: la fila del cliente tiene varias acciones
     ("Facturas", "Editar") y el orden cambia cada vez que se suma una. Un
     querySelector('button') a secas apretaba la que estuviera primera. */
  const btnFila = (nombre, etiqueta) =>
    Array.from(filaCli(nombre).querySelectorAll('button')).find(b => txt(b).includes(etiqueta));
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
  await click(btnFila('Corralon Sur', 'Editar'));
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
  await click(btnFila('Distribuidora Norte', 'Editar'));
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
  await click(btnFila('Corralon Sur', 'Editar'));
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
