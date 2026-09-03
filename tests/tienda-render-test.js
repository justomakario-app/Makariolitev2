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

const dom = new JSDOM('<!doctype html><div id="root"></div>',
  { url:'http://localhost/tienda/', pretendToBeVisual: true });
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
  /* Con tilde a propósito: en la base se llama exactamente así. Un cliente
     escribió "lampara" el 2026-09-01, la tienda le contestó que no había
     nada y el pedido de 25 unidades no entró. El catálogo estaba bien —
     el buscador no. Este producto está acá para que eso no se pueda
     volver a romper sin que el arnés se ponga rojo. */
  { sku:'MAD133', modelo:'Lámpara De Pie Nórdica', color:'Yute', color_hex:'#C8A97E',
    categoria:'Luz', descripcion:'Lámpara de pie tejida', foto_path:null,
    unidad_venta:'unidad', bulto_cantidad:1, multiplo_venta:1, minimo_sku:0,
    moneda:'ARS', iva_pct:21, precio:33613, precio_con_iva:40672, orden:3 },
];

const MIS_PEDIDOS = [
  { pedido_id:'p1', numero:'B2B-0002', estado:'enviado', enviado_at:'2026-08-14T12:00:00Z',
    fecha_entrega_deseada:'2026-08-25', total_neto:210000, unidades:3,
    items:[{ sku:'MAD100', cantidad:3, precio_unitario:70000, subtotal:210000 }] },
  { pedido_id:'p2', numero:'B2B-0001', estado:'en_produccion', enviado_at:'2026-08-01T12:00:00Z',
    fecha_entrega_deseada:null, total_neto:54000, unidades:6,
    items:[{ sku:'MAD200', cantidad:6, precio_unitario:9000, subtotal:54000 }] },
  { pedido_id:'p3', numero:'B2B-0003', estado:'facturado', enviado_at:'2026-07-20T12:00:00Z',
    fecha_entrega_deseada:null, total_neto:100000, total_con_iva:121000, unidades:2,
    factura_nro:'A 0001-00012345',
    items:[{ sku:'MAD100', cantidad:2, precio_unitario:50000, subtotal:100000 }] },
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
/* Qué contesta b2b_signup. Se cambia por escenario: el alta abierta tiene tres
   finales distintos (entra, queda pendiente por CUIT ajeno, o el correo ya
   tiene cuenta) y los tres se deciden del lado del servidor. */
const FN_OK = () => ({ data:{ ok:true, estado:'aprobado', cliente:'Corralon Sur', empresa_nueva:true }, error:null });
let FN_RESPUESTA = FN_OK;
let SESION = null;
let AUTH_CB = null;
let ENVIADOS = 0;
/* Todo lo que la tienda le pide a auth que no sea entrar/salir. Se mira el
   log en vez de espiar cada método: lo que importa es QUÉ se le mandó a
   Supabase (el correo en minúsculas, el redirectTo, la contraseña nueva). */
const AUTH_LOG = [];
let RESET_ERROR   = null;   // lo que devuelve resetPasswordForEmail
let SESSION_ERROR = null;   // lo que devuelve setSession (link vencido)
let UPDATE_ERROR  = null;   // lo que devuelve updateUser

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
    signOut: async () => { AUTH_LOG.push({ m:'signOut' }); SESION = null; if (AUTH_CB) AUTH_CB('SIGNED_OUT', null); return { error:null }; },
    resetPasswordForEmail: async (email, opts) => {
      AUTH_LOG.push({ m:'reset', email, redirectTo: opts && opts.redirectTo });
      return { data:{}, error: RESET_ERROR };
    },
    setSession: async ({ access_token, refresh_token }) => {
      AUTH_LOG.push({ m:'setSession', access_token, refresh_token });
      if (SESSION_ERROR) return { data:{ session:null }, error: SESSION_ERROR };
      SESION = { user:{ id:'u1', email:'ana@corralon.com' } };
      if (AUTH_CB) AUTH_CB('PASSWORD_RECOVERY', SESION);
      return { data:{ session:SESION }, error:null };
    },
    updateUser: async ({ password }) => {
      AUTH_LOG.push({ m:'updateUser', password });
      return { data:{}, error: UPDATE_ERROR };
    },
  },
  storage: {
    from: () => ({ getPublicUrl: (p) => ({ data:{ publicUrl:'https://cdn/' + p } }) }),
  },
  functions: {
    invoke: async (nombre, opts) => {
      FN_LOG.push({ nombre, body: opts && opts.body });
      return FN_RESPUESTA();
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
      /* Cambiar de catálogo cambia la cuenta (canal vigente y mínimo) y el
         carrito: desde 0162 hay un borrador por canal, así que el que estaba
         en pantalla es el del catálogo anterior. Acá se imita eso vaciando
         ITEMS, que es lo que hace que el test note si la tienda se olvida de
         recargar el carrito. */
      case 'b2b_rpc_set_canal': {
        const cans = (CUENTA && CUENTA.cliente && CUENTA.cliente.canales) || [];
        const ca = cans.find(x => x.codigo === p.canal);
        if (!ca) return Promise.resolve({ data:null,
          error:{ message:'Ese catalogo no esta habilitado para tu cuenta.', code:'42501' } });
        CUENTA = Object.assign({}, CUENTA, { canal:ca.codigo, canal_elegido:true,
          cliente: Object.assign({}, CUENTA.cliente,
            { canal:ca.codigo, minimo_pedido:ca.minimo_pedido, minimo_unidades:ca.minimo_unidades }) });
        ITEMS = [];
        return Promise.resolve({ data:{ ok:true, canal:ca.codigo, nombre:ca.nombre,
          minimo_pedido:ca.minimo_pedido, minimo_unidades:ca.minimo_unidades }, error:null });
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

const ORDEN = ['tienda-ui.jsx', 'tienda-acceso.jsx', 'tienda-canal.jsx', 'tienda-catalogo.jsx',
               'tienda-carrito.jsx', 'tienda-facturas.jsx', 'tienda-pedidos.jsx',
               'tienda-resumen.jsx', 'tienda-app.jsx'];

/* El orden de arriba tiene que ser EL MISMO que sirve nginx. Si no, el test
   monta una tienda que no existe: un archivo nuevo puede compilar y renderizar
   perfecto acá y no estar en el <script> del HTML, o sea no llegar nunca al
   browser del cliente. Ya pasó al agregar tienda-canal.jsx. */
const HTML_TIENDA = fs.readFileSync(path.join(ROOT, 'tienda', 'index.html'), 'utf8');
const RE_SCRIPT = new RegExp(String.raw`src="components/(tienda-[a-z-]+.jsx)`, "g");
const EN_HTML = [...HTML_TIENDA.matchAll(RE_SCRIPT)].map(m => m[1]);
if (EN_HTML.join('|') !== ORDEN.join('|')) {
  console.error('El orden de los componentes NO coincide con tienda/index.html');
  console.error('  test: ' + ORDEN.join(', '));
  console.error('  html: ' + EN_HTML.join(', '));
  process.exit(1);
}
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
  RPC_LOG.length = 0; FN_LOG.length = 0; AUTH_LOG.length = 0; ENVIADOS = 0;
  FN_RESPUESTA = o.signup || FN_OK;
  RESET_ERROR = o.resetError || null;
  SESSION_ERROR = o.sessionError || null;
  UPDATE_ERROR = o.updateError || null;
  /* El hash se lee UNA vez, al cargar el archivo de acceso, así que acá se
     pisa el resultado en vez de tocar la URL: es lo mismo que ve la app. */
  dom.window.TiendaAcceso.RECUPERACION = o.recuperar || null;
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

/* Los dos catálogos que puede elegir un mismo comprador. El de distribuidor
   con OTRO mínimo a propósito: el mínimo es del canal, no del cliente. */
const CANALES = [
  { codigo:'mayorista',    nombre:'Mayorista',    minimo_pedido:MINIMO_PEDIDO, minimo_unidades:0 },
  { codigo:'distribuidor', nombre:'Distribuidor', minimo_pedido:900000,        minimo_unidades:0 },
];

const APROBADO = {
  ok:true, usuario_id:'u1', nombre:'Ana Perez', email:'ana@corralon.com',
  estado:'aprobado', es_titular:true, canal:'mayorista', canal_elegido:true,
  cliente:{ id:'c1', nombre:'Corralon Sur', cuit:'30-11111111-1', habilitado:true,
            condicion_pago:'30 dias', minimo_pedido:MINIMO_PEDIDO, minimo_unidades:0,
            canal:'mayorista', canales:CANALES },
};

/* La misma cuenta, pero todavía sin elegir catálogo: es lo que devuelve
   mi_cuenta después de un alta nueva (0163 deja canal_activo en NULL). */
const SIN_ELEGIR = Object.assign({}, APROBADO, { canal_elegido:false });

/* ── Corrida ───────────────────────────────────────────────────────────── */
(async () => {
  console.log('\n══ Tienda mayorista · storefront del cliente ══\n');

  /* (1) La escalera de acceso ------------------------------------------- */
  console.log('— Quién puede comprar —');

  await montar(null, { sinSesion:true });
  check('sin sesión: aparece la pantalla de acceso',
        !!container.querySelector('.t-acceso') && /MAKARIO/.test(cuerpo())
        && /mayorista/i.test(cuerpo()));
  check('sin sesión: no se llamó NINGUNA RPC', RPC_LOG.length === 0, rpcs().join(','));
  /* Desde 0163 el alta es abierta: el dueño manda un link y del otro lado se
     registran solos. La invitación NO desapareció — es el único camino para
     sumar un segundo comprador a un cliente que ya existe — así que los dos
     tienen que estar a la vista en la primera pantalla. */
  check('sin sesión: ofrece crear la cuenta Y canjear un código',
        /Crear mi cuenta/i.test(cuerpo()) && /código de invitación/i.test(cuerpo()));
  check('sin sesión: no se ve ningún precio antes de entrar',
        !/70\.000|100\.000/.test(cuerpo()));

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
  check('muestra los 3 productos', container.querySelectorAll('.t-prod').length === 3);
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

  /* ── Buscar como escribe el cliente ──────────────────────────────────
     Nadie escribe los acentos, ni acierta el género, ni pone las palabras
     en el mismo campo en que están guardadas. Todo esto daba cero
     resultados antes del 2026-09-01, y cero resultados en una tienda se
     lee como "no lo tienen": el cliente no vuelve a intentar, se va. */
  const buscar = async (q) => {
    await tipear(container.querySelector('.t-buscador-input'), q);
    return Array.from(container.querySelectorAll('.t-prod')).map(txt).join(' | ');
  };

  check('★ sin acento encuentra lo que está con acento ("lampara" → "Lámpara")',
        /Lámpara/.test(await buscar('lampara')));
  check('★ las palabras pueden estar en campos distintos ("lampara yute")',
        /Lámpara/.test(await buscar('lampara yute')));
  check('★ el género no tiene que coincidir ("nordico" → "Nórdica")',
        /Lámpara/.test(await buscar('nordico')));
  check('★ el plural tampoco ("lamparas" → "Lámpara")',
        /Lámpara/.test(await buscar('lamparas')));
  check('lo que de verdad no está sigue sin aparecer',
        (await buscar('belador')) === '', await buscar('belador'));
  check('el código de SKU sigue encontrando', /Lámpara/.test(await buscar('MAD133')));

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
  await clickTexto('.t-tab', 'Pedidos');
  check('lista los 3 pedidos', container.querySelectorAll('.t-pedido').length === 3);
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

  /* La factura: el numero baja en b2b_rpc_mis_pedidos desde 0158 y hasta el
     2026-08-18 no se mostraba en ningun lado. Es lo unico que le permite al
     cliente atar su pedido con el comprobante que recibio por afuera — el
     sistema no emite facturas. */
  const pedFact = Array.from(container.querySelectorAll('.t-pedido')).find(p => txt(p).includes('B2B-0003'));
  await click(pedFact.querySelector('.t-pedido-head'));
  check('★ un pedido facturado muestra el numero del comprobante',
        /A 0001-00012345/.test(txt(pedFact)), txt(pedFact).slice(0, 200));
  check('el facturado muestra neto, IVA y total',
        /IVA/.test(txt(pedFact)) && /121\.000/.test(txt(pedFact)) && /21\.000/.test(txt(pedFact)),
        txt(pedFact).slice(0, 300));
  /* Ojo con lo que se afirma acá: la palabra "comprobante" SÍ aparece desde
     0170 — es el botón "Adjuntar comprobante de pago", que es una función, no
     un IVA inventado. Lo que se comprueba es lo único que importaba: que sin
     total_con_iva no salga un renglón de IVA y que el Total no se infle. */
  const tEnviado = txt(pedEnviado).replace(/\s+/g, ' ');
  check('★ un pedido sin total_con_iva (anterior a 0158) no inventa un IVA',
        !/IVA/.test(tEnviado) && /Total\$210\.000,00/.test(tEnviado),
        tEnviado.slice(0, 400));

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


  /* (7) Alta abierta por link ------------------------------------------- */
  console.log('\n— Alta abierta por link —');

  /* 30-71234567-1 valida el dígito verificador; el mismo terminado en 9, no.
     Los dos tienen que poder registrarse: el CUIT mal tipeado se avisa y se
     arregla desde el panel, rebotar a un comprador real lo pierde. */
  const CUIT_OK  = '30712345671';
  const CUIT_MAL = '30712345679';

  async function completarAlta(o) {
    const d = o || {};
    await clickTexto('button', 'Crear mi cuenta');
    await tipear(container.querySelector('#rg-empresa'), d.empresa || 'Corralon Norte');
    await tipear(container.querySelector('#rg-cuit'), d.cuit || CUIT_OK);
    await clickTexto('button', 'Continuar');
    await tipear(container.querySelector('#rg-nombre'), d.nombre || 'Pedro Lopez');
    await tipear(container.querySelector('#rg-email'), d.email || 'pedro@corralonnorte.com');
    await tipear(container.querySelector('#rg-p1'), d.pass || 'contraseñalarga');
    await tipear(container.querySelector('#rg-p2'), d.pass2 || d.pass || 'contraseñalarga');
    await clickTexto('button', 'Crear mi cuenta y entrar');
  }

  await montar(null, { sinSesion:true });
  await clickTexto('button', 'Crear mi cuenta');
  await tipear(container.querySelector('#rg-empresa'), 'Corralon Norte');
  check('el alta arranca por la empresa, no por la persona',
        !!container.querySelector('#rg-empresa') && !container.querySelector('#rg-email'));

  await tipear(container.querySelector('#rg-cuit'), CUIT_OK);
  check('el CUIT se escribe solo con guiones, como lo guarda la base',
        container.querySelector('#rg-cuit').value === '30-71234567-1',
        container.querySelector('#rg-cuit').value);
  check('CUIT que valida: palomita verde', !!container.querySelector('.t-vfy-ok'));

  await tipear(container.querySelector('#rg-cuit'), CUIT_MAL);
  check('★ CUIT que no valida: avisa pero NO traba el alta',
        !!container.querySelector('.t-vfy-warn') && /no valida/i.test(cuerpo())
        && !boton('Continuar').disabled);

  await tipear(container.querySelector('#rg-cuit'), '3071234');
  check('CUIT incompleto: no deja avanzar', boton('Continuar').disabled);

  /* Paso 2: las validaciones son de este lado ANTES de gastar una llamada. */
  await montar(null, { sinSesion:true });
  await completarAlta({ pass:'corta' });
  check('★ contraseña corta: ni siquiera llama a la edge function',
        FN_LOG.length === 0 && /al menos 8/.test(cuerpo()), JSON.stringify(FN_LOG));

  await tipear(container.querySelector('#rg-p1'), 'contraseñalarga');
  await tipear(container.querySelector('#rg-p2'), 'otradistinta');
  await clickTexto('button', 'Crear mi cuenta y entrar');
  check('contraseñas distintas: tampoco llama a la edge function',
        FN_LOG.length === 0 && /no coinciden/.test(cuerpo()));

  await tipear(container.querySelector('#rg-email'), 'esto-no-es-un-mail');
  await tipear(container.querySelector('#rg-p2'), 'contraseñalarga');
  await clickTexto('button', 'Crear mi cuenta y entrar');
  check('correo inválido: tampoco llama a la edge function',
        FN_LOG.length === 0 && /correo/i.test(cuerpo()));

  /* El alta que sale bien. */
  await montar(APROBADO, { sinSesion:true });
  await completarAlta({});
  const alta = FN_LOG[0];
  check('★ el alta va por la edge function b2b_signup, NO por auth.signUp',
        FN_LOG.length === 1 && alta && alta.nombre === 'b2b_signup', JSON.stringify(FN_LOG));
  check('manda la empresa y el CUIT sin guiones (los pone la base)',
        alta && alta.body.empresa === 'Corralon Norte' && alta.body.cuit === CUIT_OK,
        JSON.stringify(alta && alta.body));
  check('★ NO manda rol ni token: el alta abierta no es una invitación',
        alta && !('role' in alta.body) && !('token' in alta.body),
        JSON.stringify(alta && Object.keys(alta.body)));
  check('★ NO manda canal: el catálogo se elige adentro, no en el formulario',
        alta && !('canal' in alta.body), JSON.stringify(alta && Object.keys(alta.body)));
  check('entra con la cuenta recién creada, sin pedirle que vuelva a loguearse',
        rpcs().includes('b2b_rpc_mi_cuenta'));

  /* CUIT de una empresa que ya es cliente: 0163 lo deja pendiente. Que no se
     lo expliquen es lo que hace que el comprador reintente con otro mail. */
  await montar(null, { sinSesion:true, signup: () => ({
    data:{ ok:true, estado:'pendiente', cliente:'Corralon Sur', empresa_nueva:false }, error:null }) });
  await completarAlta({});
  /* Desde 0166 esto YA NO es una espera: entra en el momento y se lo suma a la
     empresa que ya existía. Lo que hay que garantizar es que se lo digan — es
     el único momento en que puede darse cuenta de que puso mal el CUIT, antes
     de estar mirando los pedidos de otra empresa. */
  check('★ CUIT ajeno: entra en el momento, no queda esperando aprobación',
        /ya podés comprar/i.test(cuerpo()) && !/esperando|aprobación pendiente/i.test(cuerpo()),
        cuerpo().replace(/\s+/g, ' ').slice(0, 300));
  check('★ CUIT ajeno: le dice a qué empresa lo sumaron',
        /Corralon Sur/.test(cuerpo()), cuerpo().replace(/\s+/g, ' ').slice(0, 300));
  check('★ CUIT ajeno: le da la salida si se equivocó de CUIT',
        /¿No es tu empresa\?/i.test(cuerpo()) && /escribinos/i.test(cuerpo()));

  /* Correo que ya tiene cuenta: no es un error del alta, es alguien que ya
     está. Se lo manda a entrar, con el mail puesto. */
  await montar(null, { sinSesion:true, signup: () => ({
    data:null, error:{ message:'Ese correo ya tiene una cuenta.' } }) });
  await completarAlta({ email:'ana@corralon.com' });
  check('★ correo repetido: lo lleva a entrar con el correo ya cargado',
        !!container.querySelector('#ac-email')
        && container.querySelector('#ac-email').value === 'ana@corralon.com',
        container.querySelector('#ac-email') && container.querySelector('#ac-email').value);

  /* (8) Elegir catálogo -------------------------------------------------- */
  console.log('\n— Elegir catálogo —');

  await montar(SIN_ELEGIR);
  check('alta nueva: primero pregunta con qué catálogo va a comprar',
        !!container.querySelector('.t-elegir'));
  check('muestra los dos catálogos habilitados',
        container.querySelectorAll('.t-canal').length === 2);
  check('★ no pide el catálogo antes de saber qué precios corresponden',
        !rpcs().includes('b2b_rpc_catalogo'), rpcs().join(','));
  check('cada catálogo muestra su propio mínimo de compra',
        /250\.000/.test(cuerpo()) && /900\.000/.test(cuerpo()));

  const tarjDistri = Array.from(container.querySelectorAll('.t-canal'))
    .find(c => txt(c).includes('Distribuidor'));
  await click(tarjDistri);
  const canal1 = ultimo('b2b_rpc_set_canal');
  check('elegir manda el canal elegido', !!canal1 && canal1.payload.canal === 'distribuidor',
        JSON.stringify(canal1 && canal1.payload));
  check('después de elegir entra a la tienda', !!container.querySelector('.t-app'));

  const iSet = rpcs().lastIndexOf('b2b_rpc_set_canal');
  check('★ al cambiar recarga la cuenta Y el carrito (hay un borrador por canal)',
        rpcs().indexOf('b2b_rpc_mi_cuenta', iSet) > iSet
        && rpcs().indexOf('b2b_rpc_carrito', iSet) > iSet, rpcs().join(','));
  check('el header dice en qué catálogo está parado',
        /Distribuidor/.test(txt(container.querySelector('.t-header'))));

  /* Cambiar de catálogo desde el header. */
  await click(container.querySelector('.t-canal-chip'));
  check('el chip abre las mismas tarjetas para cambiar',
        !!container.querySelector('.t-modal') && container.querySelectorAll('.t-canal').length === 2);
  check('marca cuál es el que está usando ahora',
        !!container.querySelector('.t-canal-on')
        && txt(container.querySelector('.t-canal-on')).includes('Distribuidor'));
  const tarjMayo = Array.from(container.querySelectorAll('.t-canal'))
    .find(c => txt(c).includes('Mayorista'));
  await click(tarjMayo);
  const canal2 = ultimo('b2b_rpc_set_canal');
  check('cambiar desde el header manda el otro canal',
        !!canal2 && canal2.payload.canal === 'mayorista');
  check('vuelve al catálogo con el canal nuevo',
        !container.querySelector('.t-modal') && !!container.querySelector('.t-app')
        && /Mayorista/.test(txt(container.querySelector('.t-header'))));

  /* Un solo catálogo habilitado: no hay nada que elegir. */
  await montar(Object.assign({}, SIN_ELEGIR, {
    cliente: Object.assign({}, APROBADO.cliente, { canales:[CANALES[0]] }) }));
  await flush();
  check('★ con un solo catálogo no pregunta: lo abre solo',
        !container.querySelector('.t-elegir') && !!container.querySelector('.t-app'));
  const setSolo = ultimo('b2b_rpc_set_canal');
  check('y lo deja fijado igual, para no volver a preguntar mañana',
        !!setSolo && setSolo.payload.canal === 'mayorista');
  check('el chip queda como cartel, no como botón',
        !!container.querySelector('.t-canal-chip-fijo'));

  /* El que ya eligió no vuelve a pasar por la pantalla. */
  await montar(APROBADO);
  check('el que ya eligió entra derecho al catálogo',
        !container.querySelector('.t-elegir') && rpcs().includes('b2b_rpc_catalogo'));


  /* (9) Olvidé mi contraseña ------------------------------------------
     Con el alta abierta nadie le manda la clave al cliente: si se la olvida
     y no puede recuperarla solo, deja de comprar. */
  console.log('\n— Olvidé mi contraseña —');

  const leerUrl = () => dom.window.TiendaAcceso.leerRecuperacionDeUrl();
  const authUlt = (m) => [...AUTH_LOG].reverse().find(x => x.m === m);
  const TOKENS = { access_token:'tok-abc', refresh_token:'ref-xyz' };

  await montar(APROBADO, { sinSesion:true });
  check('★ el login ofrece recuperar la contraseña', !!boton('Olvidé mi contraseña'));

  /* Se lleva el correo tipeado: volver a escribirlo es justo lo que molesta
     cuando ya venís peleando con la clave. */
  await tipear(container.querySelector('#ac-email'), 'Ana@Corralon.com');
  await click(boton('Olvidé mi contraseña'));
  check('★ arrastra el correo que ya había escrito',
        !!container.querySelector('#ol-email')
        && container.querySelector('#ol-email').value === 'Ana@Corralon.com',
        container.querySelector('#ol-email') && container.querySelector('#ol-email').value);
  check('no pide la contraseña vieja ni ningún otro dato',
        container.querySelectorAll('.t-form input').length === 1);

  await click(boton('Mandame el link'));
  const reset = authUlt('reset');
  check('★ pide el link con el correo en minúsculas',
        !!reset && reset.email === 'ana@corralon.com', JSON.stringify(reset));
  check('★ el link del mail vuelve a ESTA misma tienda, no a una URL escrita a mano',
        !!reset && typeof reset.redirectTo === 'string'
        && reset.redirectTo === dom.window.location.origin + dom.window.location.pathname,
        reset && reset.redirectTo);
  check('★ la confirmación NO revela si esa cuenta existe',
        /Si\s+ana@corralon\.com\s+tiene una cuenta/i.test(cuerpo()), cuerpo().slice(0, 200));
  check('avisa cuánto dura el link', /una hora/i.test(cuerpo()));

  /* Un error cualquiera del servidor tampoco puede convertir esta pantalla en
     un detector de clientes. */
  await montar(APROBADO, { sinSesion:true, resetError:{ message:'User not found' } });
  await click(boton('Olvidé mi contraseña'));
  await tipear(container.querySelector('#ol-email'), 'quien@sea.com');
  await click(boton('Mandame el link'));
  check('★ un error del servidor tampoco delata si el correo está registrado',
        /tiene una cuenta/i.test(cuerpo()) && !/not found/i.test(cuerpo()));

  /* El límite de envíos SÍ se muestra: ahí la solución es esperar. */
  await montar(APROBADO, { sinSesion:true, resetError:{ message:'For security purposes, you can only request this after 47 seconds' } });
  await click(boton('Olvidé mi contraseña'));
  await tipear(container.querySelector('#ol-email'), 'ana@corralon.com');
  await click(boton('Mandame el link'));
  check('★ el límite de envíos sí se explica, para que no reintente al pedo',
        /esperá unos minutos/i.test(cuerpo()) && !/tiene una cuenta/i.test(cuerpo()),
        cuerpo().slice(0, 200));

  /* ── Lo que llega del mail ─────────────────────────────────────────── */
  dom.window.location.hash = '';
  check('sin hash no hay recuperación', leerUrl() === null);

  dom.window.location.hash = '#access_token=tok-abc&refresh_token=ref-xyz&type=recovery';
  const leido = leerUrl();
  check('★ lee los tokens del link del mail',
        !!leido && leido.access_token === 'tok-abc' && leido.refresh_token === 'ref-xyz',
        JSON.stringify(leido));
  check('★ y BORRA el token de la barra de direcciones (no queda en el historial ni en un screenshot)',
        (dom.window.location.hash || '') === '', dom.window.location.hash);

  dom.window.location.hash = '#access_token=t&type=signup';
  check('un link que no es de recuperación no abre esta pantalla', leerUrl() === null);

  dom.window.location.hash = '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
  const vencido = leerUrl();
  check('★ el link vencido se reconoce y se explica (no queda en blanco)',
        !!vencido && !!vencido.error && /venció/i.test(vencido.error), JSON.stringify(vencido));
  dom.window.location.hash = '';

  /* ── La pantalla de contraseña nueva ───────────────────────────────── */
  await montar(APROBADO, { recuperar: TOKENS });
  check('★ el link de recuperación gana incluso si ya había sesión abierta en ese browser',
        /contraseña nueva/i.test(cuerpo()) && !container.querySelector('.t-app'),
        cuerpo().slice(0, 120));
  check('★ canjea el token del mail por una sesión antes de dejar cambiar nada',
        !!authUlt('setSession') && authUlt('setSession').access_token === 'tok-abc');
  check('no pide la contraseña vieja: el link ya prueba que tiene el correo',
        !/actual/i.test(cuerpo()));

  const guardarNueva = () => boton('Guardar y entrar');
  check('con los campos vacíos no deja guardar', !!guardarNueva() && guardarNueva().disabled);

  await tipear(container.querySelector('#np-p1'), 'corta');
  await tipear(container.querySelector('#np-p2'), 'corta');
  check('★ contraseña corta: avisa y no deja guardar',
        /al menos 8/i.test(cuerpo()) && guardarNueva().disabled);

  await tipear(container.querySelector('#np-p1'), 'clavenueva123');
  await tipear(container.querySelector('#np-p2'), 'clavenueva124');
  check('★ si las dos no coinciden, avisa y no deja guardar',
        /no coinciden/i.test(cuerpo()) && guardarNueva().disabled);
  check('y no llegó ninguna escritura a auth', !authUlt('updateUser'));

  await tipear(container.querySelector('#np-p2'), 'clavenueva123');
  check('con las dos iguales y largas, recién ahí habilita', !guardarNueva().disabled);
  await click(guardarNueva());
  check('★ guarda la contraseña nueva',
        !!authUlt('updateUser') && authUlt('updateUser').password === 'clavenueva123');
  check('★ y lo deja adentro de la tienda, sin volver a pedirle que entre',
        !!container.querySelector('.t-app') && !/contraseña nueva/i.test(cuerpo()),
        cuerpo().slice(0, 120));

  /* Link ya usado o vencido: el token no abre sesión. */
  await montar(APROBADO, { recuperar: TOKENS, sessionError:{ message:'Invalid Refresh Token' } });
  check('★ link vencido: lo dice y ofrece pedir otro, no una pantalla rota',
        /no sirve más/i.test(cuerpo()) && !!boton('Pedir uno nuevo'), cuerpo().slice(0, 160));
  check('y no ofrece escribir una contraseña que no va a poder guardar',
        !container.querySelector('#np-p1'));

  /* El hash con error ni siquiera intenta abrir sesión. */
  await montar(APROBADO, { recuperar:{ error:'Ese link ya venció. Pedí uno nuevo, dura una hora.' } });
  check('★ un link roto no gasta un intento contra el servidor', !authUlt('setSession'));

  /* Arrepentirse tiene que cerrar la sesión de recuperación, no dejarla viva. */
  await montar(APROBADO, { recuperar: TOKENS });
  await click(boton('Cancelar'));
  check('★ cancelar cierra la sesión que abrió el link', !!authUlt('signOut'));
  check('y vuelve a la pantalla de entrar',
        !!container.querySelector('#ac-email'), cuerpo().slice(0, 120));

  /* Que la pantalla exista no sirve si el archivo no se sirve. */
  const HTML_RECU = fs.readFileSync(path.join(ROOT, 'tienda', 'index.html'), 'utf8');
  check('★ tienda-ui.jsx cambió de versión (los iconos nuevos)',
        /tienda-ui\.jsx\?v=([2-9]|\d\d)/.test(HTML_RECU));
  check('★ tienda-acceso.jsx y tienda-app.jsx también',
        /tienda-acceso\.jsx\?v=([4-9]|\d\d)/.test(HTML_RECU)
        && /tienda-app\.jsx\?v=([5-9]|\d\d)/.test(HTML_RECU));
  check('★ tienda-pedidos.jsx y tienda.css también (el número de factura)',
        /tienda-pedidos\.jsx\?v=([3-9]|\d\d)/.test(HTML_RECU)
        && /tienda\.css\?v=([6-9]|\d\d)/.test(HTML_RECU));

  console.log(`\n${pass}/${pass + fail} checks · fallos: ${fail}\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\nEXPLOTÓ: ' + e.stack); process.exit(1); });
