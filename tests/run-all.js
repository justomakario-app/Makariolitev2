/* ══ Corredor de todos los chequeos ═════════════════════════════════════
   node tests/run-all.js          (o: npm test)

   Corre las 12 suites, una atrás de otra, y devuelve código 1 si falla
   cualquiera. Cada suite se banca correr sola:

     node tests/checkjsx.js
     node tests/b2b-render-test.js  "<ROOT>" web|mobile
     ...

   Necesita las dependencias de desarrollo: npm install
   ═══════════════════════════════════════════════════════════════════════ */
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

const SUITES = [
  ['compilación + choques de scope (3 entradas)', 'checkjsx.js',          []],
  ['panel B2B — web',                             'b2b-render-test.js',   ['web']],
  ['panel B2B — mobile',                          'b2b-render-test.js',   ['mobile']],
  ['tienda mayorista',                            'tienda-render-test.js', []],
  ['hub de producción — web',                     'hub-render-test.js',   ['web']],
  ['hub de producción — mobile',                  'hub-render-test.js',   ['mobile']],
  ['deep-links de la campanita — web',            'deeplink-test.js',     ['web']],
  ['deep-links de la campanita — mobile',         'deeplink-test.js',     ['mobile']],
  ["rol 'ventas' en Ventas — web",                'rol-ventas-test.js',   ['web']],
  ["rol 'ventas' en Ventas — mobile",             'rol-ventas-test.js',   ['mobile']],
  ['catálogo por cliente en Ventas — web',        'clientes-canal-test.js', ['web']],
  ['catálogo por cliente en Ventas — mobile',     'clientes-canal-test.js', ['mobile']],
];

let fallaron = 0, checksOK = 0, checksFail = 0;
const resumen = [];

for (const [titulo, archivo, extra] of SUITES) {
  const r = spawnSync(process.execPath, [path.join(__dirname, archivo), ROOT, ...extra], {
    cwd: __dirname, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  const salida = (r.stdout || '') + (r.stderr || '');
  const ok = r.status === 0;
  if (!ok) fallaron++;

  /* Cada suite cierra con su propia línea de resumen; hay tres formatos. */
  const m = salida.match(/(\d+)\s+ok\s+·\s+(\d+)\s+fail/);              // deeplink / rol-ventas
  const n = salida.match(/(\d+)\/(\d+)\s+checks(?:\s+OK)?\s*·\s*fallos:\s*(\d+)/); // b2b / tienda / hub
  const c = salida.match(/compilados:\s*(\d+)\s*·\s*errores:\s*(\d+)\s*·\s*choques de scope:\s*(\d+)/);
  let detalle = '';
  if (m)      { checksOK += +m[1]; checksFail += +m[2]; detalle = `${m[1]} checks`; }
  else if (n) { checksOK += +n[1]; checksFail += +n[3]; detalle = `${n[1]}/${n[2]} checks`; }
  else if (c) { detalle = `${c[1]} archivos · ${c[2]} errores · ${c[3]} choques`; }

  console.log(`${ok ? '  OK  ' : ' FALLA'}  ${titulo}${detalle ? '  (' + detalle + ')' : ''}`);
  resumen.push([titulo, ok, salida]);
}

/* La salida completa solo de lo que falló: si está todo verde no ensucia. */
for (const [titulo, ok, salida] of resumen) {
  if (!ok) console.log(`\n═══ ${titulo} ═══\n${salida}`);
}

console.log('\n--------------------------------');
console.log(`${SUITES.length - fallaron}/${SUITES.length} suites en verde · ${checksOK} checks ok · ${checksFail} fail`);
process.exit(fallaron ? 1 : 0);
