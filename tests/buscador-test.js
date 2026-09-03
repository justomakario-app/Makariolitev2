/* El buscador: que encuentre lo que está escrito con tildes.

   El 2026-09-01 un mayorista escribió "lampara de pie" en la tienda y le
   contestó que no había nada. El producto estaba publicado, con precio y
   con foto: se llama "Lámpara De Pie Nórdica". `toLowerCase()` no toca los
   acentos, así que la palabra sin tilde nunca entra en la palabra con
   tilde. El catálogo estaba bien escrito — y por eso mismo no lo
   encontraba nadie que escriba rápido. No entró un pedido de 25 unidades.

   Es el mismo agujero que el de la jornada, con otra ropa: la pantalla no
   miente ni se rompe, simplemente muestra vacío, y el vacío se lee como
   "no lo tienen". Nadie reporta un bug, se pierde la venta y listo.

   Este arnés cubre dos cosas distintas:

     A · el helper de verdad (window.buscaEn) hace lo que promete, y las
         tres copias del repo — web, mobile y tienda — se comportan igual.
         Están duplicadas por convención del proyecto, así que la que se
         puede pudrir en silencio es cualquiera de las tres.

     B · estático: ningún buscador quedó (ni vuelve a nacer) con el patrón
         viejo `algo.toLowerCase().includes(consulta)`. Esa línea es la
         firma exacta del bug. Si aparece una nueva, esto se pone rojo
         antes de que la vea un cliente.                                  */

const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2];
let pass = 0, fail = 0;

function check(nombre, ok, detalle) {
  if (ok) { pass++; console.log('  ok   ' + nombre); }
  else {
    fail++;
    console.log('  MAL  ' + nombre);
    if (detalle) console.log('         → ' + String(detalle).replace(/\n/g, '\n         → '));
  }
}

const leer = (rel) => {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : null;
};

/* ══ A · EL HELPER DE VERDAD ═══════════════════════════════════════════
   No se copia el código acá: se saca de cada archivo tal cual y se
   evalúa. Una copia en el arnés puede quedar bien mientras la de verdad
   se rompe — que es justo el agujero por el que se coló esto. */

console.log('\n[A · el helper, sacado de cada bundle]');

const FUENTES = [
  ['web',    'web/components/data.js'],
  ['mobile', 'mobile/components/data.js'],
  ['tienda', 'tienda/components/tienda-ui.jsx'],
];

const helpers = {};
for (const [nombre, rel] of FUENTES) {
  const src = leer(rel);
  if (src === null) { check(`${nombre}: existe ${rel}`, false); continue; }
  const w = {};
  let completo = true;
  for (const fn of ['sinTildes', 'buscaEn']) {
    const m = src.match(new RegExp('window\\.' + fn + ' = function[\\s\\S]*?\\n};'));
    if (!m) { completo = false; break; }
    new Function('window', m[0])(w);
  }
  check(`${nombre}: ${rel} exporta sinTildes y buscaEn`, completo && typeof w.buscaEn === 'function');
  if (completo) helpers[nombre] = w;
}

/* Las fichas son las de la base, escritas exactamente como están ahí.
   Si alguien las "arregla" sacándoles el acento, el test deja de probar
   lo que tiene que probar — por eso van con tilde a propósito. */
const FICHAS = [
  ['MAD132', 'Lámpara De Pie Nórdica', 'Crudo',  'Luz'],
  ['MAD133', 'Lámpara De Pie Nórdica', 'Yute',   'Luz'],
  ['MAD134', 'Lámpara De Pie Nórdica', 'Negro',  'Luz'],
  ['MAD131', 'Velador Bali',           null,     'Luz'],
  ['MAD300', 'Mesa Recibidora Organizadora Auxiliar Nordica Escandinava', 'Blanco', 'Recibidoras'],
  ['MAD096', 'Set De Mesas Nórdicas X2 Melamina+ Patas De Madera 12c',    'Negro',  'Mesas'],
];

/* [consulta, SKUs que TIENEN que salir, SKUs que NO pueden salir] */
const CASOS = [
  ['lampara',        ['MAD132', 'MAD133', 'MAD134'], ['MAD131']],
  ['Lampara de pie Nordico YUTE', ['MAD133'],        ['MAD132', 'MAD134']],
  ['lampara yute',   ['MAD133'],                     ['MAD132']],
  ['nordico',        ['MAD132', 'MAD300', 'MAD096'], []],
  ['lamparas',       ['MAD133'],                     []],
  ['recibidoras',    ['MAD300'],                     []],
  ['velador',        ['MAD131'],                     ['MAD132']],
  ['MAD134',         ['MAD134'],                     ['MAD133']],
  ['belador',        [],                             ['MAD131']],
  ['',               ['MAD131', 'MAD132'],           []],
];

for (const [nombre, w] of Object.entries(helpers)) {
  const busca = (q) => FICHAS.filter(f => w.buscaEn(q, ...f)).map(f => f[0]);
  const malos = [];
  for (const [q, deben, noDeben] of CASOS) {
    const r = busca(q);
    const faltan = deben.filter(s => !r.includes(s));
    const sobran = noDeben.filter(s => r.includes(s));
    if (faltan.length) malos.push(`"${q}" no encontró ${faltan.join(', ')} (dio: ${r.join(', ') || 'nada'})`);
    if (sobran.length) malos.push(`"${q}" encontró de más ${sobran.join(', ')}`);
  }
  check(`${nombre}: las ${CASOS.length} búsquedas dan lo esperado`, malos.length === 0, malos.join('\n'));
}

/* Deriva entre copias: las tres tienen que contestar lo mismo, siempre.
   Están duplicadas a mano, así que esto es lo único que las mantiene
   juntas cuando alguien toca una sola. */
const nombres = Object.keys(helpers);
if (nombres.length === FUENTES.length) {
  const firma = (w) => CASOS.map(([q]) =>
    FICHAS.filter(f => w.buscaEn(q, ...f)).map(f => f[0]).join(',')).join(' | ');
  const base = firma(helpers[nombres[0]]);
  const distintas = nombres.filter(n => firma(helpers[n]) !== base);
  check('★ las tres copias del helper se comportan igual', distintas.length === 0,
        distintas.length ? `difieren de ${nombres[0]}: ${distintas.join(', ')}` : '');
}

/* ══ B · ESTÁTICO — que no vuelva a nacer un buscador roto ═════════════
   `algo.toLowerCase().includes(consulta)` es la firma del bug. Comparar
   así deja afuera todo lo que tenga tilde o ñ. Las comparaciones que NO
   son búsquedas (normalizar un mail, mapear una clave de estado, leer el
   encabezado de un Excel) usan `===` o un regex, no `.includes()`, así
   que no caen acá. Si alguna llegara a necesitarlo, va a EXENTOS con el
   motivo escrito — nunca borrando el check.                             */

console.log('\n[B · estático — buscadores con el patrón viejo]');

const EXENTOS = {
  /* 'ruta/archivo.jsx': 'por qué esta comparación no es una búsqueda' */
};

const CARPETAS = ['web/components', 'mobile/components', 'tienda/components'];
const PATRON = /\.toLowerCase\(\)\s*\.\s*(?:includes|indexOf|startsWith)\s*\(/;

function archivos(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) out.push(...archivos(rel));
    else if (/\.(jsx|js)$/.test(e.name)) out.push(rel);
  }
  return out;
}

const todos = CARPETAS.flatMap(archivos);
check(`hay archivos que revisar (${todos.length})`, todos.length > 20);

const crudos = [];
for (const rel of todos) {
  if (EXENTOS[rel]) continue;
  const src = leer(rel);
  if (!src) continue;
  src.split('\n').forEach((linea, i) => {
    if (PATRON.test(linea)) crudos.push(`${rel}:${i + 1} · ${linea.trim().slice(0, 90)}`);
  });
}
check('★ ningún buscador compara sin sacar las tildes', crudos.length === 0, crudos.join('\n'));

/* Y que los que hay pasen por el helper: si nadie llama a buscaEn es que
   alguien lo sacó de circulación sin que nada se ponga rojo. */
const llamadores = todos.filter(rel => (leer(rel) || '').includes('window.buscaEn('));
check(`los buscadores usan window.buscaEn (${llamadores.length} archivos)`, llamadores.length >= 15,
      llamadores.join('\n'));

console.log('\n--------------------------------');
console.log(`${pass}/${pass + fail} checks OK · fallos: ${fail}`);
process.exit(fail ? 1 : 0);
