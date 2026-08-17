/* Render real de la TIENDA MAYORISTA del cliente (jsdom + React 18.3.1 +
   Babel 7.29.0 — las mismas versiones que corren en el browser).

   Monta TiendaRoot de verdad, con los 6 archivos de tienda/components y la
   capa de datos de verdad (web/components/b2b-data.js, que es exactamente el
   archivo que sirve nginx en /components/b2b-data.js), contra un Supabase
   falso. Los 6 .jsx se concatenan en UN solo scope a propósito: en el browser
   son <script> clásicos que comparten el scope global, y ese detalle es el que
   hace que `Icon` declarado en tienda-ui.jsx se vea desde tienda-carrito.jsx.

   Lo que se verifica:
     · la escalera de acceso: cada una de las 6 situaciones muestra lo suyo y
       NINGUNA de ellas toca el catálogo ni el carrito
     · el precio sale del servidor: precio_base y coeficiente no aparecen nunca
     · buscar filtra en el browser, sin un request por tecla
     · múltiplo y mínimo por SKU se respetan antes de mandar
     · el mínimo del canal bloquea el envío del lado del cliente
     · enviar guarda los datos de entrega aunque no se haya apretado "Guardar"
     · los rótulos de estado coinciden EXACTO con los del panel interno
     · anular solo se ofrece mientras el pedido está en 'enviado'            */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const Babel = require('@babel/standalone');
const React = require('react');

const ROOT = process.argv[2];
const TIENDA = path.join(ROOT, 'tienda', 'components');
const DATA = path.join(ROOT, 'web', 'components', 'b2b-data.js');

const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.MouseEvent = dom.window.MouseEvent;
global.IS_REACT_ACT_ENVIRONMENT = true;

const ReactDOMClient = require('react-dom/client');
const { act } = require('react');

/* ── Fixtures ──────────────────────────────────────────────────────────────
   MAD100 vale 70000 para este canal. Con coeficiente 0.70 eso significa un
   precio_base de 100000 — un número que NO tiene que aparecer en ninguna
   pantalla del cliente. Es el canario del aislamiento por canal.           */
const PRECIO_BASE_QUE_NO_DEBE_VERSE = 100000;

const CATALOGO = [
  { sku:'MAD100', modelo:'Mesa Nordica', color:'Blanco', color_hex:'#FFFFFF',
    categoria:'Mesas', descripcion:'Mesa de comedor', foto_path:null,
    unidad_venta:'unidad', bulto_cantidad:1, multiplo_venta:1, minimo_sku:0,
    moneda:'ARS', iva_pct:21, precio:70000, precio_con_iva:84700, orden:1 },
  { sku:'MAD200', modelo:'Silla Viena', color:'Negro', color_hex:'#000000',
    categoria:'Sillas', descripcion:'Silla apilable', foto_path:null,
    unidad_venta:'unidad', bulto_cantidad:6, multiplo_venta:6, minimo_sku:12,
    moneda:'ARS', iva_pct:21, precio:9000, precio_con_iva:10890, orden:2 },
];

const MIS_PEDIDOS = [
  { pedido_id:'p1', numero:'B2B-0002', estado:'enviado', enviado_at:'2026-08-14T12:00:00Z',
    fecha_entrega_deseada:'2026-08-25', total_neto:210000, unidades:3,
    items:[{ sku:'MAD100', cantidad:3, precio_unitario:70000, subtotal:210000 }] },
  { pedido_id:'p2', numero:'B2B-0001', estado:'en_produccion', enviado_at:'2026-08-01T12:00:00Z',
    fecha_entrega_deseada:null, total_neto:54000, unidades:6,
    items:[{ sku:'MAD200', cantidad:6, precio_unitario:9000, subtotal:54000 }] },
];

/* Cuenta: se cambia por escenario antes de montar. */
let CUENTA = null;
let CUENTA_ROMPE = false;

/* Carrito con estado real: set_item lo muta y carrito lo lee, así el flujo
   agregar → ver → enviar se ejercita de punta a punta como en producción. */
let ITEMS = [];
let DATOS = { direccion_entrega:null, fecha_entrega_deseada:null, notas:null };
/* 250.000 elegido para que el carrito de la corrida (12 sillas + 1 mesa =
   178.000) quede POR DEBAJO y se pueda ver el bloqueo, y que subir la mesa a
   3 (318.000) lo destrabe. */
const MINIMO_PEDIDO = 250000;

function carritoJson() {
  const items = ITEMS.map(it => {
    const p = CATALOGO.find(c => c.sku === it.sku);
    return { sku:it.sku, modelo:p.modelo, color:p.color, cantidad:it.cantidad,
             precio_unitario:p.precio, iva_pct:p.iva_pct,
             subtotal:p.precio * it.cantidad, notas_item:null,
             multiplo_venta:p.multiplo_venta, minimo_sku:p.minimo_sku,
             bulto_cantidad:p.bulto_cantidad };
  });
  return {
    pedido_id:'borrador-1', estado:'borrador', items,
    direccion_entrega:DATOS.direccion_entrega,
    fecha_entrega_deseada:DATOS.fecha_entrega_deseada, notas:DATOS.notas,
    total_neto: items.reduce((a,i) => a + i.subtotal, 0),
    unidades:   items.reduce((a,i) => a + i.cantidad, 0),
    minimo_pedido: MINIMO_PEDIDO, minimo_unidades: 0,
  };
}

/* ── Supabase falso ────────────────────────────────────────────────────── */
const RPC_LOG = [];
const FN_LOG = [];
let SESION = null;
let AUTH_CB = null;
let ENVIADOS = 0;

const SUPA = {
  auth: {
    getSession: () => Promise.resolve({ data:{ session: SESION }, error:null }),
    onAuthStateChange: (cb) => {
      AUTH_CB = cb;
      return { data:{ subscription:{ unsubscribe(){ AUTH_CB = null; } } } };
    },
    signInWithPassword: async ({ email }) => {
      if (!/@/.test(String(email))) return { error:{ message:'Invalid login credentials' } };
      SESION = { user:{ id:'u1', email } };
      return { data:{ session:SESION }, error:null };
    },
    signOut: async () => { SESION = null; return { error:null }; },
  },
  storage: {
    from: () => ({ getPublicUrl: (p) => ({ data:{ publicUrl:'https://cdn/' + p } }) }),
  },
  functions: {
    invoke: async (nombre, opts) => {
      FN_LOG.push({ nombre, body: opts && opts.body });
      return { data:{ ok:true }, error:null };
    },
  },
  from() {  /* la tienda no lee tablas directo; si lo hiciera, se ve acá */
    const api = { select:()=>api, eq:()=>api, order:()=>api, limit:()=>api,
                  maybeSingle:()=>Promise.resolve({ data:null, error:null }),
                  then:(r)=>Promise.resolve({ data:[], error:null }).then(r) };
    RPC_LOG.push({ nombre:'FROM(tabla directa)' });
    return api;
  },
  rpc(nombre, args) {
    const p = (args && args.p_payload) || {};
    RPC_LOG.push({ nombre, payload:p });
    switch (nombre) {
      case 'b2b_rpc_mi_cuenta':
        if (CUENTA_ROMPE) return Promise.resolve({ data:null, error:{ message:'network', code:'PGRST000' } });
        return Promise.resolve({ data:CUENTA, error:null });
      case 'b2b_rpc_catalogo':  return Promise.resolve({ data:CATALOGO, error:null });
      case 'b2b_rpc_carrito':   return Promise.resolve({ data:carritoJson(), error:null });
      case 'b2b_rpc_carrito_set_item': {
        const cant = Number(p.cantidad) || 0;
        ITEMS = ITEMS.filter(i => i.sku !== p.sku);
        if (cant > 0) ITEMS.push({ sku:p.sku, cantidad:cant });
        return Promise.resolve({ data:{ ok:true, sku:p.sku, cantidad:cant }, error:null });
      }
      case 'b2b_rpc_carrito_set_datos':
        /* coalesce(nullif(trim(...))): un campo vacío NO borra el anterior. */
        ['direccion_entrega','fecha_entrega_deseada','notas'].forEach(k => {
          const v = p[k] == null ? '' : String(p[k]).trim();
          if (v) DATOS[k] = v;
        });
        return Promise.resolve({ data:{ ok:true, pedido_id:'borrador-1' }, error:null });
      case 'b2b_rpc_enviar_pedido': {
        const c = carritoJson();
        ENVIADOS++;
        ITEMS = [];
        return Promise.resolve({ data:{ ok:true, pedido_id:'p9', numero:'B2B-0009',
                                        numero_mayorista:'MAY-0009',
                                        total_neto:c.total_neto, unidades:c.unidades }, error:null });
      }
      case 'b2b_rpc_mis_pedidos':   return Promise.resolve({ data:MIS_PEDIDOS, error:null });
      case 'b2b_rpc_anular_pedido': return Promise.resolve({ data:{ ok:true, pedido_id:p.pedido_id, estado:'anulado' }, error:null });
      case 'b2b_rpc_ver_invitacion':return Promise.resolve({ data:{ ok:true, email:'nuevo@cliente.com', cliente:'Corralon Sur' }, error:null });
      case 'b2b_rpc_canjear_invitacion': return Promise.resolve({ data:{ ok:true, estado:'pendiente' }, error:null });
      default: return Promise.resolve({ data:null, error:{ message:'RPC no fixturada: ' + nombre, code:'P0002' } });
    }
  },
};
dom.window.SUPA = SUPA;

/* ── Cargar capa de datos + componentes reales ─────────────────────────── */
new Function('window', 'navigator', fs.readFileSync(DATA, 'utf8'))(dom.window, dom.window.navigator);

const ORDEN = ['tienda-ui.jsx', 'tienda-acceso.jsx', 'tienda-catalogo.jsx',
               'tienda-carrito.jsx', 'tienda-pedidos.jsx', 'tienda-app.jsx'];
const fuente = ORDEN.map(f => fs.readFileSync(path.join(TIENDA, f), 'utf8')).join('\n;\n');
const codigo = Babel.transform(fuente, { presets:['react'], filename:'tienda.jsx' }).code;
new Function('React', 'window', 'document', 'setTimeout', codigo)
  (React, dom.window, dom.window.document, dom.window.setTimeout);

/* ── Montaje ───────────────────────────────────────────────────────────── */
const container = dom.window.document.getElementById('root');
let root;
const flush = async () => { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }); };

async function montar(cuenta, opts) {
  const o = opts || {};
  CUENTA = cuenta;
  CUENTA_ROMPE = !!o.rompe;
  SESION = o.sinSesion ? null : { user:{ id:'u1', email:'ana@corralon.com' } };
  ITEMS = o.items ? o.items.slice() : [];
  DATOS = { direccion_entrega:null, fecha_entrega_deseada:null, notas:null };
  RPC_LOG.length = 0; FN_LOG.length = 0; ENVIADOS = 0;
  if (root) await act(async () => root.unmount());
  root = ReactDOMClient.createRoot(container);
  await act(async () => { root.render(React.createElement(dom.window.TiendaRoot)); });
  await flush();
}

const cuerpo = () => container.textContent || '';
const txt = (el) => (el.textContent || '').trim();
const rpcs = () => RPC_LOG.map(r => r.nombre);
const ultimo = (n) => [...RPC_LOG].reverse().find(r => r.nombre === n);

async function click(el) {
  if (!el) throw new Error('elemento inexistente');
  await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles:true })); });
  await flush();
}
async function clickTexto(sel, parcial, raiz) {
  const b = Array.from((raiz || container).querySelectorAll(sel)).find(e => txt(e).includes(parcial));
  if (!b) throw new Error(`no hay ${sel} con "${parcial}"`);
  await click(b);
}
async function tipear(input, valor) {
  await act(async () => {
    const proto = input.tagName === 'TEXTAREA'
      ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, valor);
    input.dispatchEvent(new dom.window.Event('input', { bubbles:true }));
  });
  await flush();
}
/* Salir del campo. Va por 'focusout' y no por 'blur' a propósito: desde React
   17 el onBlur del JSX se implementa con el evento nativo focusout (blur no
   burbujea y React delega todo en la raíz). Un dispatch de 'blur' se despacha
   sin error y sin efecto: el handler nunca corre y el test miente. */
async function salirDelCampo(input) {
  await act(async () => {
    input.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles:true }));
  });
  await flush();
}
const tarjeta = (sku) =>
  Array.from(container.querySelectorAll('.t-prod')).find(a => txt(a).includes(sku));
const boton = (parcial, raiz) =>
  Array.from((raiz || container).querySelectorAll('button')).find(b => txt(b).includes(parcial));

let pass = 0, fail = 0;
function check(nombre, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + nombre); }
  else { fail++; console.log('  FAIL ' + nombre + (extra ? '  → ' + extra : '')); }
}

const APROBADO = {
  ok:true, usuario_id:'u1', nombre:'Ana Perez', email:'ana@corralon.com',
  estado:'aprobado', es_titular:true,
  cliente:{ id:'c1', nombre:'Corralon Sur', cuit:'30-11111111-1', habilitado:true,
            condicion_pago:'30 dias', minimo_pedido:MINIMO_PEDIDO, minimo_unidades:0 },
};

/* ── Corrida ───────────────────────────────────────────────────────────── */
(async () => {
  console.log('\n══ Tienda mayorista · storefront del cliente ══\n');

  /* (1) La escalera de acceso ------------------------------------------- */
  console.log('— Quién puede comprar —');

  await montar(null, { sinSesion:true });
  check('sin sesión: aparece la pantalla de acceso', /Tienda mayorista/i.test(cuerpo()) && !!container.querySelector('.t-acceso'));
  check('sin sesión: no se llamó NINGUNA RPC', RPC_LOG.length === 0, rpcs().join(','));
  check('sin sesión: no hay registro abierto, solo código de invitación',
        !/regist[rá]ate/i.test(cuerpo()) && /código de invitación/i.test(cuerpo()));

  await montar({ ok:false, motivo:'b2b_deshabilitado' });
  /* La tienda apagada NO es un problema de la cuenta del mayorista: si el
     texto se lee como "te cortamos el acceso", el cliente llama pensando que
     lo dieron de baja. Tiene que quedar claro que su cuenta está intacta. */
  check('tienda apagada: se lo dice sin dar a entender que es su cuenta',
        /tienda mayorista está cerrada/i.test(cuerpo()) && /no es nada de tu cuenta/i.test(cuerpo()),
        cuerpo().slice(0, 140));
  check('tienda apagada: no pidió el catálogo', !rpcs().includes('b2b_rpc_catalogo'), rpcs().join(','));

  await montar({ ok:false, motivo:'sin_cuenta_b2b' });
  check('sin cuenta vinculada: ofrece canjear un código',
        /código de invitación/i.test(cuerpo()) && !!boton('Continuar'));
  check('sin cuenta vinculada: no pidió el carrito', !rpcs().includes('b2b_rpc_carrito'), rpcs().join(','));

  /* ★ Vincular a ciegas es un error que NO se puede deshacer desde la tienda:
     el comprador queda comprando con el canal y los precios de otra empresa y
     hay que ir a la base a despegarlo. Por eso son dos pasos. */
  await tipear(container.querySelector('.t-input'), 'TOK-123');
  await clickTexto('button', 'Continuar');
  check('★ el primer paso valida pero todavía NO vincula',
        rpcs().includes('b2b_rpc_ver_invitacion') && !rpcs().includes('b2b_rpc_canjear_invitacion'),
        rpcs().join(','));
  check('★ muestra a qué cliente va a quedar pegada la cuenta antes de vincular',
        /Corralon Sur/.test(cuerpo()), cuerpo().slice(0, 160));
  check('si no es ese cliente, se puede probar otro código',
        !!boton('probar otro código'));
  await clickTexto('button', 'vincular mi cuenta');
  check('recién al confirmar canjea',
        rpcs().includes('b2b_rpc_canjear_invitacion'), rpcs().join(','));

  await montar({ ok:true, usuario_id:'u1', nombre:'Ana', email:'a@b.com', estado:'pendiente', cliente:null });
  check('pendiente: dice que está en revisión', /en revisión/i.test(cuerpo()));
  check('pendiente: no ve precios', !rpcs().includes('b2b_rpc_catalogo'), rpcs().join(','));

  await montar({ ok:true, usuario_id:'u1', nombre:'Ana', email:'a@b.com', estado:'rechazado',
                 rechazo_motivo:'CUIT no verificado', cliente:null });
  check('rechazado: mensaje propio, no el genérico de pendiente',
        /rechazada/i.test(cuerpo()) && !/en revisión/i.test(cuerpo()));
  check('rechazado: le muestra el motivo que cargó el equipo', /CUIT no verificado/.test(cuerpo()));

  await montar({ ok:true, usuario_id:'u1', nombre:'Ana', email:'a@b.com', estado:'suspendido', cliente:null });
  check('suspendido: mensaje propio', /suspendida/i.test(cuerpo()));

  await montar({ ...APROBADO, cliente:{ ...APROBADO.cliente, habilitado:false } });
  check('aprobado pero cliente sin habilitar: lo distingue de "pendiente"',
        /Falta habilitar/i.test(cuerpo()) && !rpcs().includes('b2b_rpc_catalogo'));

  await montar(APROBADO, { rompe:true });
  check('si mi_cuenta falla: no se rompe la pantalla, ofrece reintentar',
        /No pudimos conectarnos/i.test(cuerpo()) && !!boton('Reintentar'));

  /* (2) Catálogo --------------------------------------------------------- */
  console.log('\n— El catálogo y el precio del canal —');
  await montar(APROBADO);
  check('aprobado y habilitado: entra al catálogo', !!container.querySelector('.t-grilla'));
  check('muestra los 2 productos', container.querySelectorAll('.t-prod').length === 2);
  check('muestra el precio que devolvió el servidor', /\$\s?70\.000,00/.test(cuerpo()));
  check('muestra el precio con IVA del servidor', /84\.700,00/.test(cuerpo()));

  const fuga = new RegExp(PRECIO_BASE_QUE_NO_DEBE_VERSE.toLocaleString('es-AR').replace('.', '\\.'));
  check('★ NO se filtra el precio_base (aislamiento por canal)', !fuga.test(cuerpo()), cuerpo().slice(0, 200));
  check('★ NO se filtra el coeficiente', !/0,55|0,70|0\.55|0\.70/.test(cuerpo()));

  check('la regla de venta se le explica al cliente', /se vende de a 6/.test(cuerpo()));
  check('el header muestra el cliente, no el email suelto', /Corralon Sur/.test(cuerpo()));

  /* Buscar: filtra en el browser, sin request nuevo */
  const antesDeBuscar = RPC_LOG.filter(r => r.nombre === 'b2b_rpc_catalogo').length;
  await tipear(container.querySelector('.t-buscador-input'), 'viena');
  check('buscar deja un solo producto', container.querySelectorAll('.t-prod').length === 1);
  check('buscar NO dispara un request por tecla',
        RPC_LOG.filter(r => r.nombre === 'b2b_rpc_catalogo').length === antesDeBuscar);
  await tipear(container.querySelector('.t-buscador-input'), '');

  /* (3) Agregar respeta múltiplo y mínimo del SKU ------------------------ */
  console.log('\n— Múltiplo y mínimo por SKU —');
  await clickTexto('button', 'Agregar', tarjeta('MAD200'));
  const set1 = ultimo('b2b_rpc_carrito_set_item');
  check('agregar una silla manda 12 (mínimo 12, múltiplo 6), no 1',
        set1 && set1.payload.sku === 'MAD200' && set1.payload.cantidad === 12,
        JSON.stringify(set1 && set1.payload));

  /* "Agregar" dejó el selector de la tarjeta en 0. Desde ahí el "+" NO puede
     dar 6: 6 es múltiplo válido pero está por debajo del mínimo del SKU (12),
     así que ajustarCantidad lo sube al primer valor que el backend aceptaría.
     Recién a partir de ahí camina de a 6. */
  const mas = () => tarjeta('MAD200').querySelectorAll('.t-cant-btn')[1];
  const inputCant = () => tarjeta('MAD200').querySelector('.t-cant-input');
  await click(mas());
  check('el "+" no cae por debajo del mínimo del SKU: 0 → 12',
        inputCant().value === '12', inputCant().value);
  await click(mas());
  check('ya sobre el mínimo, el "+" salta de a 6: 12 → 18',
        inputCant().value === '18', inputCant().value);

  await clickTexto('button', 'Agregar', tarjeta('MAD100'));
  const set2 = ultimo('b2b_rpc_carrito_set_item');
  check('un producto sin múltiplo agrega 1', set2 && set2.payload.cantidad === 1, JSON.stringify(set2 && set2.payload));
  check('el contador del carrito suma las unidades', /13/.test(txt(container.querySelector('.t-badge'))),
        txt(container.querySelector('.t-badge')));

  /* (4) Carrito y mínimo del canal --------------------------------------- */
  console.log('\n— El pedido en preparación —');
  await clickTexto('.t-tab', 'Mi pedido');
  check('el carrito lista las 2 líneas', container.querySelectorAll('.t-item').length === 2);
  check('neto = 108.000 + 70.000', /178\.000,00/.test(cuerpo()));
  /* 178.000 contra un mínimo de canal de 250.000: acá se ve el bloqueo. */
  check('bajo el mínimo del canal: no deja enviar', boton('Enviar pedido').disabled,
        'neto=' + carritoJson().total_neto + ' mínimo=' + MINIMO_PEDIDO);
  check('le dice cuánto le falta para el mínimo', /te falta/i.test(cuerpo()));

  /* Subir la mesa a 3 lleva el neto a 318.000 y pasa el mínimo */
  const filaMesa = Array.from(container.querySelectorAll('.t-item')).find(f => txt(f).includes('MAD100'));
  await tipear(filaMesa.querySelector('.t-cant-input'), '3');
  await salirDelCampo(filaMesa.querySelector('.t-cant-input'));
  check('con el mínimo cubierto se habilita enviar', !boton('Enviar pedido').disabled,
        'neto=' + carritoJson().total_neto);

  /* Datos de entrega escritos y NO guardados a mano */
  await tipear(Array.from(container.querySelectorAll('input')).find(i => i.id === 'ca-dir'),
               'Av. Siempreviva 742');
  await clickTexto('button', 'Enviar pedido');
  check('pide confirmación antes de mandar', /¿Enviamos el pedido\?/.test(cuerpo()));
  check('avisa que el precio queda congelado', /congelados/i.test(cuerpo()));
  await clickTexto('button', 'Sí, enviar');

  const datos = ultimo('b2b_rpc_carrito_set_datos');
  check('★ guarda la dirección tipeada aunque no se haya apretado "Guardar"',
        !!datos && datos.payload.direccion_entrega === 'Av. Siempreviva 742',
        JSON.stringify(datos && datos.payload));
  check('los datos se guardan ANTES de enviar',
        RPC_LOG.findIndex(r => r.nombre === 'b2b_rpc_carrito_set_datos') <
        RPC_LOG.findIndex(r => r.nombre === 'b2b_rpc_enviar_pedido'));
  check('el pedido se envió una sola vez', ENVIADOS === 1, String(ENVIADOS));
  check('muestra el comprobante con el número del cliente', /B2B-0009/.test(cuerpo()));
  check('NO le muestra el número interno MAY-', !/MAY-0009/.test(cuerpo()));
  check('el carrito quedó vacío después de enviar', ITEMS.length === 0);

  /* (5) Mis pedidos ------------------------------------------------------ */
  console.log('\n— Mis pedidos —');
  await montar(APROBADO);
  await clickTexto('.t-tab', 'Mis pedidos');
  check('lista los 2 pedidos', container.querySelectorAll('.t-pedido').length === 2);
  check('rótulo "Enviado" tal cual lo ve el equipo', /Enviado/.test(cuerpo()));
  check('rótulo "En producción" tal cual lo ve el equipo', /En producción/.test(cuerpo()));

  const pedEnviado = Array.from(container.querySelectorAll('.t-pedido')).find(p => txt(p).includes('B2B-0002'));
  await click(pedEnviado.querySelector('.t-pedido-head'));
  check('al abrirlo muestra los ítems y el precio congelado',
        /MAD100/.test(txt(pedEnviado)) && /congelados/i.test(txt(pedEnviado)));
  check('un pedido en "enviado" se puede dar de baja', !!boton('Dar de baja', pedEnviado));

  const pedProd = Array.from(container.querySelectorAll('.t-pedido')).find(p => txt(p).includes('B2B-0001'));
  await click(pedProd.querySelector('.t-pedido-head'));
  check('★ un pedido "en producción" NO ofrece darse de baja', !boton('Dar de baja', pedProd));

  await clickTexto('button', 'Dar de baja', pedEnviado);
  check('la baja pide confirmación', /No se puede deshacer/i.test(cuerpo()));
  await clickTexto('button', 'Sí, darlo de baja');
  const anul = ultimo('b2b_rpc_anular_pedido');
  check('anular manda el pedido_id correcto', !!anul && anul.payload.pedido_id === 'p1',
        JSON.stringify(anul && anul.payload));

  /* (6) Alta por invitación --------------------------------------------- */
  console.log('\n— Alta con código de invitación —');
  await montar(null, { sinSesion:true });
  await clickTexto('button', 'Tengo un código');
  await tipear(container.querySelector('#ac-token'), 'TOKEN-DE-PRUEBA');
  await clickTexto('button', 'Continuar');
  check('valida el código contra ver_invitacion antes de pedir datos',
        rpcs().includes('b2b_rpc_ver_invitacion'));
  check('muestra para qué correo y qué cliente es la invitación',
        /nuevo@cliente\.com/.test(cuerpo()) && /Corralon Sur/.test(cuerpo()));

  await tipear(container.querySelector('#ac-nombre'), 'Nuevo Comprador');
  await tipear(container.querySelector('#ac-p1'), 'corta');
  await tipear(container.querySelector('#ac-p2'), 'corta');
  await clickTexto('button', 'Crear mi acceso');
  check('★ contraseña corta: ni siquiera llama a la edge function',
        FN_LOG.length === 0 && /al menos 8/.test(cuerpo()), JSON.stringify(FN_LOG));

  await tipear(container.querySelector('#ac-p1'), 'contraseñalarga');
  await tipear(container.querySelector('#ac-p2'), 'otradistinta');
  await clickTexto('button', 'Crear mi acceso');
  check('contraseñas distintas: tampoco llama a la edge function',
        FN_LOG.length === 0 && /no coinciden/.test(cuerpo()));

  await tipear(container.querySelector('#ac-p2'), 'contraseñalarga');
  await clickTexto('button', 'Crear mi acceso');
  check('★ el alta va por la edge function b2b_signup, NO por auth.signUp',
        FN_LOG.length === 1 && FN_LOG[0].nombre === 'b2b_signup', JSON.stringify(FN_LOG));
  check('b2b_signup recibe el token (el servidor lo valida de nuevo)',
        FN_LOG[0] && FN_LOG[0].body && FN_LOG[0].body.token === 'TOKEN-DE-PRUEBA');
  check('b2b_signup NO recibe rol ni email elegido por el usuario',
        FN_LOG[0] && !('role' in FN_LOG[0].body) && !('email' in FN_LOG[0].body),
        JSON.stringify(FN_LOG[0] && Object.keys(FN_LOG[0].body)));
  check('después del alta canjea la invitación con la sesión propia',
        rpcs().includes('b2b_rpc_canjear_invitacion'));

  console.log(`\n${pass}/${pass + fail} checks · fallos: ${fail}\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\nEXPLOTÓ: ' + e.stack); process.exit(1); });
