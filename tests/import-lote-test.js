/* ══ Lotes de importación — el número que decide un borrado irreversible ══
   node tests/import-lote-test.js "<ROOT>" web|mobile

   QUÉ ARREGLA ESTO Y POR QUÉ NECESITA UN TEST
   ───────────────────────────────────────────
   Dos bugs del mismo flujo, encontrados el 9-sept-2026 cuando el dueño no
   pudo importar el Excel de Mercado Libre.

   1) EL QUE PUEDE BORRAR PEDIDOS REALES
      `rpc_import_batch` inserta la fila de import_batches ARRIBA DE TODO,
      antes de recorrer un solo item, porque necesita el batch_id para
      colgárselo a cada orden. Después nunca vuelve a tocar esa fila: los
      contadores `pedidos_count` y `unidades_count` quedan en su default.
      En la base hay 310 lotes y los 310 están en cero.

      Ese cero se mostraba como si fuera el tamaño del lote:

        · la tabla "Lotes importados" de cada canal, columna "Pedidos"
        · y el cartel de confirmación del botón "Eliminar", que decía
          «Vas a eliminar el lote X y TODAS sus órdenes (0 pedidos)»

      El botón no borra solo el lote: borra el lote, TODAS sus órdenes y los
      registros de producción de esos SKU desde la fecha del lote. El lote de
      colecta del 9-sept tiene 186 pedidos y 189 unidades reales, y el cartel
      pedía permiso diciendo «0 pedidos». Una acción irreversible pidiendo
      autorización con el número equivocado — y el número equivocado es el
      que hace que parezca inofensiva.

      El arreglo NO depende de la migración: el front cuenta contra `orders`
      al mostrar y vuelve a contar, salteando el caché, antes de borrar. Si
      no puede contar, no deja borrar. La 0176 además arregla el dato
      guardado, para cualquier reporte que lo lea más adelante.

   2) EL QUE NO DEJA IMPORTAR Y NO EXPLICA NADA
      `file_hash` es UNIQUE desde la 0001 (idempotencia, decisión F). Cuando
      el archivo ya se importó, Postgres devuelve el nombre crudo de la
      restricción y `data.js` lo re-lanzaba tal cual al toast:

        duplicate key value violates unique constraint
        "import_batches_file_hash_key"

      El bloqueo está bien. El mensaje no dice qué pasó, ni cuándo, ni qué
      hacer. Ahora se pregunta antes y se dice en castellano: cuándo se
      importó, a qué canal, y por qué volver a importarlo no traería un solo
      pedido nuevo.

      OJO con "dejarlo importar igual en otra jornada": el hash se calcula
      sobre el nombre + los items YA normalizados, así que solo choca cuando
      el contenido es idéntico. Y `orders` ya deduplica por (channel_id,
      order_number, sku), así que la re-importación no insertaría nada. El
      permiso serviría para nada y ensuciaría el historial. Se explica, no se
      destraba.

   Cinco partes: A migración 0176 · B data.js estático · C los mensajes,
   evaluados de verdad · D la UI del borrado · E paridad web/mobile y ?v=.
   ═══════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2] || path.join(__dirname, '..');
const VARIANT = process.argv[3] || 'web';
const BASE = path.join(ROOT, VARIANT === 'web' ? 'web' : 'mobile', 'components');

let pass = 0, fail = 0;
function check(nombre, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + nombre); }
  else { fail++; console.log('  FAIL ' + nombre + (extra ? '\n         → ' + extra : '')); }
}

console.log(`\n═══ ${VARIANT.toUpperCase()} · lotes de importación\n`);

const leer = (p) => fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';

/* ══ A · la migración 0176 ══════════════════════════════════════════════ */
console.log('[A · migración 0176 — los contadores]');

const MIG76 = path.join(ROOT, 'supabase', 'migrations', '0176_import_batches_contadores.sql');
const MIG99 = path.join(ROOT, 'supabase', 'migrations', '0099_fix_import_bugs.sql');
const sql76 = leer(MIG76);
const sql99 = leer(MIG99);

check('existe la migración 0176', sql76.length > 0, MIG76);
check('sigue existiendo la 0099, de la que sale el cuerpo', sql99.length > 0, MIG99);

check('la 0176 escribe los contadores del lote',
      /update public\.import_batches\s+set pedidos_count\s*=\s*v_inserted,\s*unidades_count\s*=\s*v_unidades\s+where id = v_batch_id;/i
        .test(sql76.replace(/--[^\n]*\n/g, '')), 'A1');

/* skus_desconocidos es text[], no un contador. Asignarle el int v_skipped_unknown
   rompe la función al crearla. El check existe porque el primer intento lo hizo. */
check('la 0176 NO le asigna un número a skus_desconocidos (es text[])',
      !/skus_desconocidos\s*=\s*v_skipped_unknown/i.test(sql76), 'A2');

check('la 0176 backfillea los lotes viejos contando contra orders',
      /update public\.import_batches b[\s\S]{0,400}from \([\s\S]{0,300}from public\.orders/i.test(sql76)
      && /group by import_batch_id/i.test(sql76), 'A3');
check('el backfill solo toca los que están en cero (no pisa un número cargado a mano)',
      /coalesce\(b\.pedidos_count, 0\) = 0/i.test(sql76)
      && /coalesce\(b\.unidades_count, 0\) = 0/i.test(sql76), 'A4');
check('la 0176 es atómica (begin/commit) y tiene rollback escrito',
      /^\s*begin;/im.test(sql76) && /^\s*commit;/im.test(sql76) && /rollback/i.test(sql76), 'A5');

/* EL CHECK QUE IMPORTA. La 0176 vuelve a emitir 280 líneas de rpc_import_batch que no
   se pueden probar contra la base desde acá. La única garantía posible es que sea copia
   literal de la 0099 salvo el bloque nuevo: se corta el cuerpo de las dos, se le saca al
   de la 0176 el UPDATE agregado, y tienen que quedar idénticas carácter por carácter. */
function cuerpoRpc(sql) {
  const i = sql.indexOf('CREATE OR REPLACE FUNCTION public.rpc_import_batch(');
  if (i < 0) return '';
  const f = sql.indexOf('$function$;', i);
  return f < 0 ? '' : sql.slice(i, f + '$function$;'.length);
}
const c76 = cuerpoRpc(sql76);
const c99 = cuerpoRpc(sql99);
check('las dos traen el cuerpo completo de rpc_import_batch', c76.length > 5000 && c99.length > 5000,
      c76.length + ' vs ' + c99.length);

/* El bloque agregado: desde su comentario hasta el punto y coma del UPDATE. */
const sinAgregado = c76.replace(
  /\n *-- 0176: los contadores del lote[\s\S]*?where id = v_batch_id;\n\n/i, '\n');
check('la 0176 es la 0099 MÁS el UPDATE, y nada más (diff carácter por carácter)',
      sinAgregado === c99,
      sinAgregado === c76 ? 'no se pudo recortar el bloque agregado'
        : 'difieren en ' + Math.abs(sinAgregado.length - c99.length) + ' caracteres');

/* Lo que la 0176 NO puede haber perdido en la copia. Si el diff de arriba pasa esto es
   redundante — y es a propósito: si alguien edita el archivo a mano y rompe el diff,
   estos siguen diciendo QUÉ se perdió. */
for (const marca of ['prod_fn_exigir_turno|ml_sku_map', 'orders_sin_sku', 'es_venta_cancelada',
                     'es_venta_reprogramada', 'free_stock', 'ON CONFLICT \\(channel_id, order_number, sku\\)']) {
  check('la 0176 conserva ' + marca.replace(/\\\\/g, ''), new RegExp(marca).test(c76), marca);
}

/* ══ B · data.js — de dónde sale el número ══════════════════════════════ */
console.log('\n[B · data.js — de dónde sale el número]');

const dataJs = leer(path.join(BASE, 'data.js'));
check('se lee data.js', dataJs.length > 0);

check('loadBatches ya no convierte el contador vacío en un 0 que parece un dato',
      !/cantidad: b\.unidades_count \|\| 0/.test(dataJs)
      && /cantidad: b\.unidades_count \|\| null/.test(dataJs), 'B1');
check('al recargar los lotes se tira lo contado (si no, un lote borrado deja su número)',
      /window\.MOCK\.loteConteos = \{\};/.test(dataJs), 'B2');

check('existe contarLote, que cuenta contra orders',
      /async contarLote\(batchId, fresco\)/.test(dataJs)
      && /from\('orders'\)\.select\('cantidad'\)\.eq\('import_batch_id', batchId\)/.test(dataJs), 'B3');
check('contarLote acepta saltear el caché (antes de borrar, el número tiene que ser de ahora)',
      /if \(!fresco && window\.MOCK\.loteConteos\[batchId\]\) return/.test(dataJs), 'B4');
check('contarLote suma unidades además de contar pedidos',
      /uds \+= \(r\.cantidad \|\| 0\)/.test(dataJs)
      && /pedidos: filas\.length, unidades: uds/.test(dataJs), 'B5');
check('contarLote propaga el error (no devuelve 0 cuando no pudo contar)',
      /if \(error\) throw new Error\(error\.message \|\| 'No se pudieron contar los pedidos del lote'\)/.test(dataJs), 'B6');

check('existe contarLotes, una sola consulta para toda la lista',
      /async contarLotes\(batchIds\)/.test(dataJs)
      && /\.in\('import_batch_id', faltan\)/.test(dataJs), 'B7');
check('contarLotes solo pregunta por los que faltan',
      /const faltan = \(batchIds \|\| \[\]\)\.filter\(id => id && !window\.MOCK\.loteConteos\[id\]\)/.test(dataJs), 'B8');
/* Un lote sin ninguna orden tiene que quedar en 0, no en "desconocido para siempre":
   si no, su fila se queda con el guion y nunca se puede borrar. */
check('un lote sin órdenes queda en 0 y no en desconocido',
      /for \(const id of faltan\) window\.MOCK\.loteConteos\[id\] = \{ pedidos: 0, unidades: 0 \};/.test(dataJs), 'B9');

check('antes de importar se pregunta si el archivo ya está',
      /from\('import_batches'\)[\s\S]{0,200}\.eq\('file_hash', p_file_hash\)/.test(dataJs), 'B10');
check('si ya está, el mensaje es el explicado y no el de Postgres',
      /if \(yaEsta\) throw new Error\(mensajeArchivoRepetido\(yaEsta\)\)/.test(dataJs), 'B11');
/* La consulta previa no es un candado: entre ella y el INSERT puede entrar otro. */
check('y si igual choca la restricción (dos importando a la vez), también se traduce',
      /esArchivoRepetido\(error\) \? mensajeArchivoRepetido\(null\) : error\.message/.test(dataJs), 'B12');
check('si la consulta previa falla, la importación sigue igual (no bloquea por eso)',
      /\.then\(r => \(r\.error \? null : \(r\.data \|\| \[\]\)\[0\]\), \(\) => null\)/.test(dataJs), 'B13');

/* ══ C · los mensajes, evaluados de verdad ══════════════════════════════ */
console.log('\n[C · el mensaje que ve el que importa]');

/* Las dos funciones son puras: se recortan del archivo y se evalúan. Un regex sobre el
   texto diría que "existen"; esto dice qué contestan. */
const iEs = dataJs.indexOf('function esArchivoRepetido(');
const iFin = dataJs.indexOf('async function loadBatches()');
const fuente = (iEs >= 0 && iFin > iEs) ? dataJs.slice(iEs, iFin) : '';
check('se pudieron recortar las dos funciones del mensaje', fuente.length > 0);

if (fuente) {
  const mod = new Function(fuente + '\nreturn { esArchivoRepetido, mensajeArchivoRepetido };')();

  check('reconoce el choque por el nombre de la restricción',
        mod.esArchivoRepetido({ message: 'duplicate key value violates unique constraint "import_batches_file_hash_key"' }), 'C1');
  check('lo reconoce aunque venga en el campo details',
        mod.esArchivoRepetido({ details: 'Key (file_hash)=(abc) already exists. duplicate key' }), 'C2');
  check('no confunde otro error de importación con un archivo repetido',
        !mod.esArchivoRepetido({ message: 'No hay jornadas abiertas. Abri una antes de importar.' })
        && !mod.esArchivoRepetido({ message: 'Jornada destino no existe o no esta abierta.' })
        && !mod.esArchivoRepetido(null), 'C3');

  const msg = mod.mensajeArchivoRepetido({
    filename: '20260909_Ventas.xlsx',
    imported_at: '2026-09-09T12:41:30.567Z',
    channel_id: 'colecta',
  });
  check('el mensaje dice CUÁNDO se importó', /9 de septiembre/i.test(msg), msg);
  check('el mensaje dice A QUÉ CANAL fue', /COLECTA/.test(msg), msg);
  check('el mensaje dice que los pedidos ya están y no se duplican',
        /ya est[aá]n cargados/i.test(msg) && /no se duplican/i.test(msg), msg);
  check('el mensaje dice qué hacer si esperaba pedidos nuevos',
        /export nuevo de Mercado Libre/i.test(msg), msg);
  check('el mensaje NO le muestra el nombre de la restricción al operario',
        !/import_batches_file_hash_key/.test(msg) && !/duplicate key/i.test(msg), msg);

  /* El caso de la carrera: se sabe que está repetido pero no se sabe de cuándo. */
  const msgPelado = mod.mensajeArchivoRepetido(null);
  check('sin datos del import anterior sigue siendo una frase entendible',
        msgPelado.length > 40 && /ya se import/i.test(msgPelado)
        && !/undefined|null|NaN|Invalid Date/.test(msgPelado), msgPelado);
  /* Una fecha rota no puede escribir "Invalid Date" en la cara del operario. */
  const msgRoto = mod.mensajeArchivoRepetido({ imported_at: 'no-es-fecha', channel_id: 'flex' });
  check('una fecha ilegible se omite en vez de imprimirse rota',
        !/Invalid Date|NaN/.test(msgRoto) && /FLEX/.test(msgRoto), msgRoto);
}

/* ══ D · la UI del borrado ══════════════════════════════════════════════ */
console.log('\n[D · el cartel que pide permiso para borrar]');

const carrier = leer(path.join(BASE, 'carrier.jsx'));
const modals  = leer(path.join(BASE, 'modals.jsx'));
check('se leen carrier.jsx y modals.jsx', carrier.length > 0 && modals.length > 0);

check('el cartel de borrado ya NO usa el contador que nadie escribe',
      !/loteAEliminar\.cantidad/.test(carrier), 'D1');
check('la lista de lotes tampoco lo usa',
      !/\{l\.cantidad\}/.test(carrier), 'D2');
check('el cartel usa el número contado en el momento',
      /conteoBorrar\.pedidos/.test(carrier) && /conteoBorrar\.unidades/.test(carrier), 'D3');
check('antes de borrar se cuenta de nuevo salteando el caché',
      /contarLote\(loteAEliminar\.id, true\)/.test(carrier), 'D4');
check('mientras cuenta, el cartel lo dice',
      /conteoBorrar === null/.test(carrier) && /Contando los pedidos del lote/.test(carrier), 'D5');
check('si no pudo contar, lo dice y no deja borrar a ciegas',
      /conteoBorrar === false/.test(carrier)
      && /No se pudieron contar los pedidos del lote/.test(carrier), 'D6');
check('el botón queda deshabilitado hasta tener el número',
      /confirmDisabled=\{borrando \|\| !conteoBorrar\}/.test(carrier), 'D7');
/* El botón deshabilitado es la puerta; esto es la cerradura. Sin el guard, cualquier
   camino que dispare onConfirm borra igual. */
check('y el propio onConfirm se planta sin el número verificado',
      /if \(!conteoBorrar\) return;/.test(carrier), 'D8');
check('el cartel avisa que también borra los registros de producción',
      /registros de producci[oó]n de esos SKU/.test(carrier), 'D9');
check('el aviso de "listo" dice cuántos pedidos se borraron',
      /Lote eliminado · \$\{conteoBorrar\.pedidos\} pedidos/.test(carrier), 'D10');

check('la lista muestra el número contado, y un guion mientras no lo sepa',
      /conteos\[l\.id\]/.test(carrier), 'D11');
check('los lotes visibles se cuentan de una sola vez',
      /contarLotes\(lotesIds\.split\(','\)\)/.test(carrier), 'D12');

check('ConfirmModal acepta confirmDisabled',
      /function ConfirmModal\(\{ open, onClose, onConfirm, title, message, confirmText, danger, confirmDisabled \}\)/.test(modals), 'D13');
check('ConfirmModal deshabilita el botón de verdad, no solo lo pinta',
      /disabled=\{!!confirmDisabled\}/.test(modals)
      && /if \(confirmDisabled\) return;/.test(modals), 'D14');

/* ══ E · paridad y cache-busting ════════════════════════════════════════ */
console.log('\n[E · paridad web/mobile y ?v=]');

const WEB = path.join(ROOT, 'web', 'components');
const MOB = path.join(ROOT, 'mobile', 'components');

/* data.js y modals.jsx llevan el mismo arreglo en los dos árboles; carrier.jsx no se
   compara entero (la pantalla del celular es otra) pero sí las marcas del arreglo. */
for (const f of ['data.js', 'modals.jsx']) {
  const a = leer(path.join(WEB, f)), b = leer(path.join(MOB, f));
  const marcas = ['contarLote', 'contarLotes', 'esArchivoRepetido', 'mensajeArchivoRepetido',
                  'confirmDisabled', 'loteConteos'];
  const enA = marcas.filter(m => a.includes(m)).join(','), enB = marcas.filter(m => b.includes(m)).join(',');
  check(`${f}: web y mobile llevan el mismo arreglo`, enA === enB, enA + '  ≠  ' + enB);
}
for (const m of ['conteoBorrar', 'contarLote(loteAEliminar.id, true)', 'confirmDisabled',
                 'if (!conteoBorrar) return;', 'contarLotes']) {
  const a = leer(path.join(WEB, 'carrier.jsx')), b = leer(path.join(MOB, 'carrier.jsx'));
  check(`carrier.jsx: "${m}" está en los dos`, a.includes(m) && b.includes(m),
        'web:' + a.includes(m) + ' mobile:' + b.includes(m));
}

const htmlW = leer(path.join(ROOT, 'web', 'Macario Lite.html'));
const htmlM = leer(path.join(ROOT, 'mobile', 'index.html'));
for (const f of ['data.js', 'carrier.jsx', 'modals.jsx']) {
  /* El lookbehind evita que "data.js" matchee dentro de "admin-data.js" y "b2b-data.js". */
  const re = new RegExp('(?<![\\w-])' + f.replace('.', '\\.') + '\\?v=(\\d+)', 'g');
  const vW = [...htmlW.matchAll(re)].map(m => m[1]);
  const vM = [...htmlM.matchAll(re)].map(m => m[1]);
  check(`${f}: los dos HTML piden la misma versión`,
        vW.length > 0 && vM.length > 0 && new Set([...vW, ...vM]).size === 1,
        'web:' + vW.join('/') + ' mobile:' + vM.join('/'));
}

console.log(`\n${pass} ok · ${fail} fail\n`);
process.exit(fail ? 1 : 0);
