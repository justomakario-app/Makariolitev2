/* Verificador de los 3 frontends estáticos.
   1. Compila cada archivo que el HTML carga, con el mismo Babel del navegador.
   2. Busca declaraciones top-level repetidas ENTRE archivos de la misma
      entrada: todos los <script type="text/babel"> comparten un solo scope
      léxico, asi que un const/let/class/function duplicado tira SyntaxError
      y deja la pantalla en blanco. Eso no lo detecta compilar de a uno. */
const fs   = require('fs');
const path = require('path');
const Babel = require('@babel/standalone');

const ROOT = process.argv[2] || path.join(__dirname, '..');

const ENTRADAS = [
  ['web',    'web/Macario Lite.html', 'web'],
  ['mobile', 'mobile/index.html',     'mobile'],
  ['tienda', 'tienda/index.html',     'tienda'],
];

let errores = 0, avisos = 0, compilados = 0;

for (const [nombre, html, base] of ENTRADAS) {
  const htmlPath = path.join(ROOT, html);
  if (!fs.existsSync(htmlPath)) { console.log(`\n[${nombre}] NO EXISTE ${html}`); errores++; continue; }
  const doc = fs.readFileSync(htmlPath, 'utf8');

  const srcs = [];
  const re = /<script[^>]*\bsrc\s*=\s*"([^"]+)"[^>]*>/g;
  let m;
  while ((m = re.exec(doc))) {
    const tag = m[0];
    if (!/type\s*=\s*"text\/babel"/.test(tag) && !/\.(jsx|js)\?/.test(m[1]) && !/\.(jsx|js)$/.test(m[1])) continue;
    if (/^https?:/.test(m[1])) continue;            // CDN: React, Babel, Supabase
    srcs.push({ url: m[1], babel: /type\s*=\s*"text\/babel"/.test(tag) });
  }

  console.log(`\n=== ${nombre} — ${srcs.length} archivos locales ===`);

  const declarado = new Map();   // nombre -> archivo donde se declaró primero

  for (const { url, babel } of srcs) {
    const limpio = url.split('?')[0];
    /* Las rutas absolutas (/components/...) las resuelve nginx contra la raiz
       del sitio, que es donde vive web/. Es como /tienda/ toma b2b-data.js. */
    const abs = limpio.startsWith('/')
      ? path.join(ROOT, 'web', limpio.slice(1))
      : path.join(ROOT, base, limpio);

    if (!fs.existsSync(abs)) {
      console.log(`  FALTA   ${url}`);
      errores++; continue;
    }
    const code = fs.readFileSync(abs, 'utf8');

    let out;
    try {
      out = Babel.transform(code, {
        presets: babel ? ['react'] : [],
        sourceType: 'script',
        filename: path.basename(abs),
      });
      compilados++;
    } catch (err) {
      console.log(`  ERROR   ${url}\n          ${String(err.message).split('\n')[0]}`);
      errores++; continue;
    }

    /* Declaraciones top-level: se leen del codigo YA compilado, que es JS
       plano, con un parseo de llaves a nivel 0. */
    const js = out.code;
    let nivel = 0, enStr = null, enCom = null;
    const lineas = [];
    let actual = '', nivelLinea = 0;
    for (let i = 0; i < js.length; i++) {
      const c = js[i], n = js[i + 1];
      if (enCom) { if (enCom === '//' && c === '\n') enCom = null;
                   else if (enCom === '/*' && c === '*' && n === '/') { enCom = null; i++; }
                   continue; }
      if (enStr) { if (c === '\\') { i++; continue; }
                   if (c === enStr) enStr = null;
                   continue; }
      if (c === '/' && n === '/') { enCom = '//'; i++; continue; }
      if (c === '/' && n === '*') { enCom = '/*'; i++; continue; }
      if (c === '"' || c === "'" || c === '`') { enStr = c; continue; }
      if (c === '{' || c === '(' || c === '[') nivel++;
      if (c === '}' || c === ')' || c === ']') nivel--;
      if (c === '\n') { lineas.push([actual, nivelLinea]); actual = ''; nivelLinea = nivel; continue; }
      actual += c;
    }
    lineas.push([actual, nivelLinea]);

    const DECL = /^\s*(?:var|let|const|function|class)\s+([A-Za-z_$][\w$]*)/;
    for (const [linea, niv] of lineas) {
      if (niv !== 0) continue;
      const d = linea.match(DECL);
      if (!d) continue;
      const id = d[1];
      if (/^_/.test(id)) continue;                 // helpers que inyecta Babel
      if (declarado.has(id)) {
        console.log(`  CHOQUE  ${id}  (${declarado.get(id)}  vs  ${url})`);
        avisos++;
      } else {
        declarado.set(id, url);
      }
    }
  }
}

console.log(`\n--------------------------------`);
console.log(`compilados: ${compilados} · errores: ${errores} · choques de scope: ${avisos}`);
process.exit(errores > 0 || avisos > 0 ? 1 : 0);
