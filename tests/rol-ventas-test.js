/* ══ Qué puede ver el rol 'ventas' en la sección Ventas ══════════════════
   Monta el VentasPage REAL (jsdom + React 18.3.1 + Babel 7.29.0) y verifica
   que la lista de pestañas coincida con lo que la base autoriza:

     b2b_rpc_admin_pedidos  → owner | admin | ventas
     b2b_rpc_admin_clientes → owner | admin | ventas
     el resto (catalogo, canales, facturar, set_*) → owner | admin

   O sea: 'ventas' entra a Ventas SOLO por la tienda mayorista. Si alguien
   agranda ROLE_NAV sin filtrar TABS, este test se pone en rojo — que es
   justamente el accidente que hay que evitar (Cta cte, Facturación, Remitos
   y Base de productos quedarían abiertos de golpe).

   Uso: node rol-ventas-test.js <ROOT> [web|mobile]
   ═══════════════════════════════════════════════════════════════════════ */
const fs = require('fs'), path = require('path');
const ROOT = process.argv[2], VARIANT = process.argv[3] || 'web';
if (!ROOT) { console.error('falta ROOT'); process.exit(1); }
const BASE = path.join(ROOT, VARIANT === 'web' ? 'web/components' : 'mobile/components');

const { JSDOM } = require('jsdom');
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = require('react');
const Babel = require('@babel/standalone');

const dom = new JSDOM('<div id="root"></div>', { url: 'https://x.test/' });
global.window = dom.window; global.document = dom.window.document;
global.navigator = dom.window.navigator; global.IS_REACT_ACT_ENVIRONMENT = true;

/* Supabase no se toca: el UMD se reemplaza por un cliente falso que devuelve
   vacío a todo. Cualquier pestaña que intente leer datos recibe [] en vez de
   explotar — acá se mide qué pestañas se OFRECEN, no qué traen. */
const VACIO = { data: [], error: null, count: 0 };
function cadena() {                       // imita el query builder de PostgREST
  return new Proxy(function () {}, {
    get(_, k) {
      if (k === 'then')    return (ok, no) => Promise.resolve(VACIO).then(ok, no);
      if (k === 'catch')   return () => cadena();
      if (k === 'finally') return (f) => { if (f) f(); return cadena(); };
      return () => cadena();
    },
    apply: () => cadena(),
  });
}
const sinRuido = { unsubscribe() {}, subscribe: () => sinRuido, on: () => sinRuido };
const CLIENTE_FALSO = {
  from: () => cadena(),
  rpc: () => cadena(),
  channel: () => sinRuido,
  removeChannel: () => {},
  storage: { from: () => cadena() },
  auth: {
    getUser: async () => ({ data: { user: null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => ({ error: null }),
  },
};
dom.window.supabase = { createClient: () => CLIENTE_FALSO };

const preamble = `
  const { useState, useEffect, useRef, useMemo, useCallback } = React;
  const Icon = ({ n, s, c }) => React.createElement('i', { 'data-icon': n });
  const useToast = () => ({ error(){}, success(){}, info(){} });
`;

/* ROLE_NAV vive adentro de window.MOCK, en data.js (JS plano). */
new Function('window', 'navigator', fs.readFileSync(path.join(BASE, 'data.js'), 'utf8'))
  (dom.window, dom.window.navigator);
const MOCK_REAL = dom.window.MOCK;
const NAV = MOCK_REAL.ROLE_NAV;

const file = path.join(BASE, 'ventas.jsx');
new Function('React', 'window', 'document',
  Babel.transform(preamble + fs.readFileSync(file, 'utf8'),
                  { presets: ['react'], filename: file }).code)
  (React, dom.window, dom.window.document);

/* La tienda mayorista se stubea: su propio filtro por rol ya lo cubre
   b2b-render-test.js. Acá importa que VentasPage la ofrezca. */
dom.window.B2BTiendaTab = () => React.createElement('div', { 'data-b2b': '1' }, 'TIENDA MAYORISTA');
dom.window.ProximamentePlaceholder = ({ nombre }) =>
  React.createElement('div', { 'data-placeholder': '1' }, 'Próximamente ' + nombre);

/* Las pestañas del dueño leen por window.ADMIN_DATA (admin/admin-data.js, que
   acá no se carga): las constantes (ARG_PROVINCIAS…) salen lista vacía y
   cualquier otra cosa es una función que resuelve vacío. */
dom.window.ADMIN_DATA = new Proxy({}, {
  get: (_, k) => (typeof k === 'string' && /^[A-Z0-9_]+$/.test(k) ? [] : async () => []),
});

const container = dom.window.document.getElementById('root');
let root;
const txt  = (el) => (el.textContent || '').trim();
const tabs = () => Array.from(container.querySelectorAll('[role="tab"]')).map(txt);
const activa = () => {
  const t = container.querySelector('[role="tab"][aria-selected="true"]');
  return t ? txt(t) : null;
};
const cuerpo = () => container.textContent || '';

async function montar(rol, intent) {
  /* Se cambia el rol sin perder el resto del MOCK real (ROLE_NAV incluido). */
  dom.window.MOCK = Object.assign(Object.create(null), MOCK_REAL, { user: { role: rol } });
  dom.window.NAV_INTENT = intent || null;
  if (root) await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => { root.render(React.createElement(dom.window.VentasPage)); });
  await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
}

let pass = 0, fail = 0;
function check(nombre, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + nombre); }
  else { fail++; console.log('  FAIL ' + nombre + (extra ? '\n         → ' + extra : '')); }
}

const OCULTAS = ['Alta y mod. clientes', 'Cta cte clientes', 'Facturación',
                 'Presupuestos', 'Remitos', 'Base de productos'];

(async () => {
  console.log(`\n=== ${VARIANT} — qué ve el rol 'ventas' en Ventas ===\n`);

  /* ── 1. ROLE_NAV ──────────────────────────────────────────────────────── */
  const itemsVentas = (NAV && NAV.ventas && NAV.ventas.items) || [];
  check("★ el rol 'ventas' llega a la sección Ventas",
        itemsVentas.includes('ventas'), itemsVentas.join(','));
  check('no se le coló ningún módulo de más',
        !['administracion', 'finanzas', 'rrhh', 'marketing', 'equipo'].some(m => itemsVentas.includes(m)),
        itemsVentas.join(','));
  check('el dueño sigue viendo todo',
        (NAV.owner.items || []).includes('ventas') && (NAV.owner.items || []).includes('administracion'));
  check('un operario sigue sin entrar',
        !(NAV.cnc.items || []).includes('ventas') && !(NAV.embalaje.items || []).includes('ventas'));
  /* Hoy 'admin' no llega a Ventas (nunca llegó: Cta cte, Facturación, Remitos y
     Presupuestos son del dueño). Si algún día se le abre, hay que filtrarle las
     pestañas igual que a 'ventas' — si no, se le abren las 10 de una. */
  check("'admin' hoy no llega a Ventas (nota en HANDOFF)",
        !(NAV.admin.items || []).includes('ventas'));

  /* ── 2. Las pestañas que se ofrecen ───────────────────────────────────── */
  await montar('ventas');
  check("★ 'ventas' ve una sola pestaña, la tienda mayorista",
        tabs().length === 1 && tabs()[0] === 'Tienda mayorista', tabs().join(' | '));
  for (const t of OCULTAS) {
    check(`no ve "${t}"`, !tabs().includes(t), tabs().join(' | '));
  }
  check('★ abre directo en la tienda, no en una pestaña que no tiene',
        activa() === 'Tienda mayorista', String(activa()));
  check('y la tienda realmente se renderiza (no cae al placeholder)',
        !!container.querySelector('[data-b2b]') && !container.querySelector('[data-placeholder]'),
        cuerpo().slice(0, 120));

  await montar('owner');
  check('el dueño sigue viendo las 10 pestañas', tabs().length === 10, tabs().join(' | '));
  check('y entre ellas la tienda mayorista', tabs().includes('Tienda mayorista'));
  check('el dueño abre donde abría siempre', activa() === 'Alta y mod. clientes', String(activa()));
  /* El filtro es por 'ventas', no una lista blanca: cualquier otro rol que
     llegue acá ve la sección completa, como antes de este cambio. */
  await montar('encargado');
  check('ningún otro rol perdió pestañas', tabs().length === 10, tabs().join(' | '));

  /* ── 3. Deep-link de la campanita ─────────────────────────────────────── */
  await montar('ventas', { ventasTab: 'tienda-b2b', b2bSub: 'pedidos' });
  check('un aviso de pedido le abre la tienda', activa() === 'Tienda mayorista', String(activa()));

  /* Un aviso viejo (o inventado) que apunte a una pestaña que su rol no tiene
     no puede colarlo adentro: TABS ya está filtrada cuando se valida. */
  await montar('ventas', { ventasTab: 'remitos' });
  check('★ un aviso a Remitos no lo mete en Remitos',
        activa() === 'Tienda mayorista' && !tabs().includes('Remitos'),
        String(activa()) + ' / ' + tabs().join(' | '));
  check('y no queda ninguna pantalla ajena renderizada',
        !!container.querySelector('[data-b2b]'), cuerpo().slice(0, 120));

  await montar('owner', { ventasTab: 'remitos' });
  check('al dueño el mismo aviso sí le abre Remitos', activa() === 'Remitos', String(activa()));

  /* El rol viene de la base y podría llegar con mayúsculas. */
  await montar('VENTAS');
  check("'VENTAS' en mayúsculas se filtra igual",
        tabs().length === 1 && tabs()[0] === 'Tienda mayorista', tabs().join(' | '));

  console.log(`\n--------------------------------\n${VARIANT}: ${pass} ok · ${fail} fail\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('EXPLOTÓ:', e); process.exit(1); });
