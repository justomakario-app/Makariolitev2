/* ══ Las tarjetas por catálogo en "Alta y mod. clientes" ═════════════════
   Monta el ClientesB2BTab REAL (jsdom + React 18.3.1 + Babel 7.29.0) con
   clientes y canales de mentira, y verifica lo que la pantalla dice de cada
   cliente. El accidente que evita es concreto y ya pasó:

     la pantalla contaba `es_mayorista` —el tilde viejo del registro, que
     dice "es cliente B2B" y nada más— y titulaba la tarjeta "Mayoristas".
     Un distribuidor caía adentro de esa cuenta y no había forma de verlo,
     porque `b2b_canal` ni siquiera se traía de la base.

   Lo que ahora tiene que valer, y por qué:

     · una tarjeta por canal ACTIVO, sacada de b2b_canal — no escrita a mano.
       Apagar minorista (0165) o agregar un canal se refleja solo.
     · la cuenta es por `b2b_canal`, que es lo que fija el precio, no por
       `es_mayorista`.
     · el que no puede comprar se ve: sin canal, o parado en un canal
       apagado. Para b2b_fn_coeficiente_actual son el mismo caso —pide
       `ca.activo = true` y devuelve null en los dos— así que acá también.
     · si los canales no cargan, la pantalla sigue sirviendo y NO inventa
       que los clientes están sin catálogo.

   Uso: node clientes-canal-test.js <ROOT> [web|mobile]
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

const preamble = `
  const { useState, useEffect, useRef, useMemo, useCallback } = React;
  const Icon = ({ n, s, c }) => React.createElement('i', { 'data-icon': n });
  const useToast = () => ({ error(){}, success(){}, info(){} });
`;

const file = path.join(BASE, 'ventas.jsx');
new Function('React', 'window', 'document',
  Babel.transform(preamble + fs.readFileSync(file, 'utf8'),
                  { presets: ['react'], filename: file }).code)
  (React, dom.window, dom.window.document);

/* ── Los datos ────────────────────────────────────────────────────────────
   Los tres canales son los que existen de verdad después de 0165: mayorista
   0,70 y distribuidor 0,55 activos, minorista 1,00 apagado a propósito (es
   la referencia de precio_base, no un canal de venta).                     */
const CANALES = [
  { codigo:'mayorista',    nombre:'Mayorista',    coeficiente:0.70, activo:true,  orden:1 },
  { codigo:'distribuidor', nombre:'Distribuidor', coeficiente:0.55, activo:true,  orden:2 },
  { codigo:'minorista',    nombre:'Minorista',    coeficiente:1.00, activo:false, orden:0 },
];

const ESTE_MES = new Date().toISOString();

/* Siete clientes, uno por cada situación que la pantalla tiene que separar. */
const CLIENTES = [
  { id:'1', nombre:'Corralon Sur',        es_mayorista:true,  b2b_canal:'mayorista',    b2b_habilitado:true,  activo:true, created_at:ESTE_MES },
  { id:'2', nombre:'Distribuidora Norte', es_mayorista:true,  b2b_canal:'distribuidor', b2b_habilitado:true,  activo:true },
  { id:'3', nombre:'Pintureria Oeste',    es_mayorista:true,  b2b_canal:'distribuidor', b2b_habilitado:false, activo:true },
  { id:'4', nombre:'Ferreteria Centro',   es_mayorista:true,  b2b_canal:null,           b2b_habilitado:false, activo:true },
  { id:'5', nombre:'Kiosco Viejo',        es_mayorista:true,  b2b_canal:'minorista',    b2b_habilitado:true,  activo:true },
  { id:'6', nombre:'Juan Perez',          es_mayorista:false, b2b_canal:null,           b2b_habilitado:false, activo:true },
  { id:'7', nombre:'Baja Distribuidora',  es_mayorista:true,  b2b_canal:'distribuidor', b2b_habilitado:true,  activo:false },
];

const container = dom.window.document.getElementById('root');
let root;
const txt = (el) => (el.textContent || '').trim();

/* Las tarjetas se leen por su forma, no por una clase ni un data-* puesto
   para el test: VenKpi es <div><div>rótulo</div><div>número</div>[pista]</div>
   y la fila es su padre. Si alguien le cambia la estructura, esto se entera. */
function filaKpis() {
  const primera = Array.from(container.querySelectorAll('div'))
    .find(d => d.children.length >= 2 && txt(d.children[0]) === 'Clientes activos');
  return primera ? primera.parentElement : null;
}
function tarjetas() {
  const f = filaKpis();
  if (!f) return [];
  return Array.from(f.children).map(c => ({
    label: txt(c.children[0]),
    value: txt(c.children[1]),
    hint:  c.children[2] ? txt(c.children[2]) : null,
  }));
}
const etiquetas = () => tarjetas().map(t => t.label);
const kpi = (label) => tarjetas().find(t => t.label === label) || null;
/* Sin estos accesores, un chequeo que no encuentra su tarjeta tira TypeError
   y mata la corrida entera: se pierde el resto del diagnóstico justo cuando
   más sirve. Tiene que salir en rojo y dejar correr los demás. */
const valor = (label) => (kpi(label) || {}).value;
const pista = (label) => (kpi(label) || {}).hint;

function filaDe(nombre) {
  return Array.from(container.querySelectorAll('tbody tr'))
    .find(tr => tr.children.length > 1 && txt(tr.children[0]) === nombre) || null;
}
/* Columna "Tipo": la 6ta (Nombre, CUIT, Ubicación, Teléfono, Email, Tipo…). */
function badge(nombre) {
  const tr = filaDe(nombre);
  const span = tr && tr.children[5] && tr.children[5].querySelector('span');
  return span || null;
}
const tipo   = (n) => { const b = badge(n); return b ? txt(b) : null; };
const estilo = (n) => { const b = badge(n); return (b && b.getAttribute('style')) || ''; };
const titulo = (n) => { const b = badge(n); return (b && b.getAttribute('title')) || ''; };

async function montar({ clientes = CLIENTES, canales = CANALES, canalesRompe = false, sinB2BData = false } = {}) {
  dom.window.MOCK = { user: { role: 'owner' } };
  dom.window.ADMIN_DATA = {
    ARG_PROVINCIAS: [],
    loadCustomersB2B: async ({ includeInactive } = {}) =>
      includeInactive ? clientes : clientes.filter(c => c.activo !== false),
  };
  if (sinB2BData) delete dom.window.B2B_DATA;
  else dom.window.B2B_DATA = {
    canales: async () => { if (canalesRompe) throw new Error('42501 permiso denegado'); return canales; },
  };

  if (root) await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => { root.render(React.createElement(dom.window.ClientesB2BTab, {})); });
  await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
}

let pass = 0, fail = 0;
function check(nombre, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + nombre); }
  else { fail++; console.log('  FAIL ' + nombre + (extra ? '\n         → ' + extra : '')); }
}

(async () => {
  console.log(`\n=== ${VARIANT} — catálogo por cliente en "Alta y mod. clientes" ===\n`);

  /* ── 1. La columna tiene que llegar de la base ─────────────────────────── */
  const adminData = fs.readFileSync(path.join(BASE, 'admin/admin-data.js'), 'utf8');
  const cols = (adminData.match(/const COLS_CUSTOMER = '([^']+)'/) || [])[1] || '';
  const pedidas = cols.split(',').map(s => s.trim());
  check('★ loadCustomersB2B trae b2b_canal (sin esto no hay nada que contar)',
        pedidas.includes('b2b_canal'), cols);
  check('y trae b2b_habilitado (para saber si además puede comprar)',
        pedidas.includes('b2b_habilitado'), cols);

  /* ── 2. Las tarjetas ──────────────────────────────────────────────────── */
  await montar();
  check('★ hay una tarjeta "Distribuidores"',
        !!kpi('Distribuidores'), etiquetas().join(' | '));
  check('★ cuenta b2b_canal, no es_mayorista (5 tienen el tilde, 1 es mayorista)',
        valor('Mayoristas') === '1', JSON.stringify(tarjetas()));
  check('★ los dos distribuidores activos caen en su tarjeta',
        valor('Distribuidores') === '2', JSON.stringify(tarjetas()));
  check('el cliente inactivo no entra en ninguna cuenta',
        valor('Clientes activos') === '6', JSON.stringify(tarjetas()));
  check('★ el canal apagado (minorista) no genera tarjeta',
        !etiquetas().some(l => /Minorista/i.test(l)), etiquetas().join(' | '));
  check('el plural sale bien: "Distribuidores", no "Distribuidors"',
        etiquetas().includes('Distribuidores'), etiquetas().join(' | '));
  check('cada tarjeta dice el coeficiente que paga ese catálogo',
        pista('Mayoristas') === 'paga el 70% de la lista' &&
        pista('Distribuidores') === 'paga el 55% de la lista',
        JSON.stringify([pista('Mayoristas'), pista('Distribuidores')]));
  check('el orden es: total, un canal por catálogo, alertas, altas del mes',
        etiquetas().join(' | ') === 'Clientes activos | Mayoristas | Distribuidores | Sin catálogo | Nuevos este mes',
        etiquetas().join(' | '));
  check('"Nuevos este mes" sigue contando por created_at',
        valor('Nuevos este mes') === '1', JSON.stringify(tarjetas()));

  /* ── 3. Los que entran a la tienda y no ven precios ───────────────────── */
  check('★ "Sin catálogo" junta al que no tiene canal Y al del canal apagado',
        valor('Sin catálogo') === '2', JSON.stringify(tarjetas()));
  check('y avisa qué significa',
        pista('Sin catálogo') === 'entran a la tienda y no ven precios',
        String(pista('Sin catálogo')));

  await montar({ clientes: CLIENTES.filter(c => ['1', '2', '6'].includes(c.id)) });
  check('★ si no hay ninguno, la tarjeta no ocupa lugar (es alerta, no métrica)',
        !kpi('Sin catálogo'), etiquetas().join(' | '));
  check('las tarjetas de catálogo siguen aunque el canal tenga pocos clientes',
        valor('Mayoristas') === '1' && valor('Distribuidores') === '1',
        JSON.stringify(tarjetas()));

  /* ── 4. El badge de cada fila ─────────────────────────────────────────── */
  await montar();
  check('el mayorista habilitado se ve como mayorista',
        tipo('Corralon Sur') === 'Mayorista', String(tipo('Corralon Sur')));
  check('★ el distribuidor ya no dice "Mayorista"',
        tipo('Distribuidora Norte') === 'Distribuidor', String(tipo('Distribuidora Norte')));
  check('★ el que tiene catálogo pero no está habilitado lo dice',
        tipo('Pintureria Oeste') === 'Distribuidor · sin habilitar', String(tipo('Pintureria Oeste')));
  check('y se distingue de un vistazo (punteado, no sólido)',
        /dashed/.test(estilo('Pintureria Oeste')) && !/dashed/.test(estilo('Distribuidora Norte')),
        estilo('Pintureria Oeste'));
  check('el mismo catálogo se pinta del mismo color, habilitado o no',
        /109, 40, 217|#6D28D9/i.test(estilo('Distribuidora Norte')) &&
        /109, 40, 217|#6D28D9/i.test(estilo('Pintureria Oeste')),
        estilo('Distribuidora Norte') + ' /// ' + estilo('Pintureria Oeste'));
  check('★ el cliente de tienda sin canal avisa que no ve precios',
        tipo('Ferreteria Centro') === 'Tienda · sin catálogo', String(tipo('Ferreteria Centro')));
  check('★ el parado en un canal apagado avisa igual (para la base es lo mismo)',
        tipo('Kiosco Viejo') === 'Tienda · sin catálogo', String(tipo('Kiosco Viejo')));
  check('el cliente común sigue siendo "Cliente"',
        tipo('Juan Perez') === 'Cliente', String(tipo('Juan Perez')));
  check('el badge explica en el title qué implica cada estado',
        titulo('Ferreteria Centro').includes('no ve precios'),
        titulo('Ferreteria Centro'));

  /* ── 5. Si los canales no cargan, no se rompe ni miente ───────────────── */
  await montar({ canalesRompe: true });
  check('★ la lista de clientes carga igual aunque falle b2b_rpc_admin_canales',
        !!filaDe('Corralon Sur') && !!filaDe('Distribuidora Norte'),
        txt(container).slice(0, 140));
  check('sin canales no hay tarjetas de catálogo (no se inventan)',
        etiquetas().join(' | ') === 'Clientes activos | Sin catálogo | Nuevos este mes',
        etiquetas().join(' | '));
  check('★ y NO acusa de "sin catálogo" al que sí tiene uno guardado',
        valor('Sin catálogo') === '1', JSON.stringify(tarjetas()));
  check('★ el badge muestra el canal guardado en vez de mentir',
        tipo('Distribuidora Norte') === 'distribuidor', String(tipo('Distribuidora Norte')));
  check('el que de verdad no tiene canal se sigue viendo',
        tipo('Ferreteria Centro') === 'Tienda · sin catálogo', String(tipo('Ferreteria Centro')));

  await montar({ sinB2BData: true });
  check('un bundle viejo sin B2B_DATA tampoco la rompe',
        !!filaDe('Corralon Sur') && !etiquetas().includes('Mayoristas'),
        etiquetas().join(' | '));

  /* ── 6. El filtro no puede seguir diciendo "mayoristas" ───────────────── */
  await montar();
  const labels = Array.from(container.querySelectorAll('label')).map(txt);
  check('el filtro dejó de llamarle "mayoristas" a todos los de la tienda',
        !labels.some(l => /Solo mayoristas/i.test(l)), labels.join(' | '));
  check('y sigue habiendo un filtro para ellos',
        labels.some(l => /Solo clientes de la tienda/i.test(l)), labels.join(' | '));

  console.log(`\n--------------------------------\n${VARIANT}: ${pass} ok · ${fail} fail\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('EXPLOTÓ:', e); process.exit(1); });
