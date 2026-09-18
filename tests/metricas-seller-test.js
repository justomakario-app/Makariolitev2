/* El motor de Métricas Seller: que la cuenta cierre.

   Esto no prueba que la pantalla se dibuje. Prueba lo único que importa
   de esta herramienta: que el número que dice "pagá hasta $X" sea el
   número correcto. Si ese número está mal, no hay bug que reportar — hay
   un lote comprado a pérdida y nadie se entera hasta tres meses después,
   cuando el depósito está lleno y la caja vacía.

   Los cuatro chequeos que sostienen todo lo demás:

     · DEGENERACIÓN — alimentado con el embudo mexicano de la planilla
       original, este motor tiene que escupir los mismos números que ella:
       223, 164, 507, 563, 56. Si no los reproduce, la generalización está
       mal hecha y se rompió algo en el camino.

     · DENOMINADOR — que dividir dé 20% donde sumar da −5%. Es el error
       que hace que una planilla prometa ganancia y dé pérdida.

     · IDA Y VUELTA — el techo de costo y el techo de CPA se calculan
       despejando. La única forma de saber que el despeje está bien es
       meter el resultado de vuelta por la puerta de entrada y ver si sale
       exactamente el margen mínimo. Al decimal, no "parecido".

     · EL GRIS — que "falta un dato" nunca se lea como "sí". Un semáforo
       de tres colores miente: pinta de verde una cuenta a la que le falta
       el flete.                                                          */

const fs   = require('fs');
const path = require('path');

const ROOT = process.argv[2] || path.join(__dirname, '..');
let pass = 0, fail = 0;

function check(nombre, ok, detalle) {
  if (ok) { pass++; console.log('  ok   ' + nombre); }
  else {
    fail++;
    console.log('  MAL  ' + nombre);
    if (detalle) console.log('         → ' + String(detalle).replace(/\n/g, '\n         → '));
  }
}
/* Comparación de plata: al centavo. Nada de "más o menos". */
const cerca = (a, b, tol) => Math.abs(Number(a) - Number(b)) <= (tol === undefined ? 0.01 : tol);
const eq = (nombre, dio, esperado, tol) =>
  check(nombre, cerca(dio, esperado, tol), `dio ${dio}, esperaba ${esperado}`);

/* ══ Cargar el motor de verdad ═════════════════════════════════════════
   Del archivo real, no de una copia acá adentro. Una copia en el arnés
   puede quedar linda mientras la de producción se pudre. */
const ARCHIVO = 'web/components/metricas-seller-motor.js';
const abs = path.join(ROOT, ARCHIVO);
if (!fs.existsSync(abs)) {
  console.log(`  MAL  existe ${ARCHIVO}`);
  console.log('\n0 ok · 1 fail');
  process.exit(1);
}
const w = {};
new Function('window', 'module', fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n'))(w, undefined);
const M = w.SELLER;
check(`${ARCHIVO} exporta window.SELLER`, !!M && typeof M.calcular === 'function');
if (!M) { console.log(`\n${pass} ok · ${fail + 1} fail`); process.exit(1); }


/* ══ A · DEGENERACIÓN — la planilla mexicana ═══════════════════════════

   La planilla que originó todo esto es de dropshipping COD en México.
   Seis números en una columna:

     precio proveedor        120
     flete costeado          223     (145 de flete ÷ 0.65 de tasa de entrega)
     CPA costeado            164     (90 de CPA  ÷ 0.55 acumulada)
     costos totales          507
     precio de venta         563     (507 con 10% de margen SOBRE LA VENTA)
     ganancia                 56

   Ese modelo no sirve para Argentina: acá se cobra antes de despachar, no
   hay contra-reembolso, y la "tasa de entrega" de 0.65 no existe. Pero la
   MECÁNICA sí sirve, y es la misma que usamos para devoluciones. Este
   bloque prueba que la generalización no rompió nada: apagando todo lo
   argentino (IVA 0, IIBB 0, Ganancias 0) y poniendo el embudo mexicano,
   el motor tiene que dar la planilla clavada.                          */

console.log('\n[A · degeneración: el embudo mexicano]');

/* La planilla divide el CPA por 0.55 escrito a mano. 0.85 × 0.65 da
   0.5525, no 0.55 — la planilla redondeó su propio embudo. Usamos las
   tasas que reproducen lo que la planilla MUESTRA, que es contra lo que
   se compara. La diferencia se mide más abajo, porque es en sí misma un
   hallazgo: una planilla que redondea el embudo se equivoca un peso por
   unidad, y en un lote de 500 son 500 pesos que nadie ve. */
const MX = [{ id: 'confirmacion', tasa: 0.55 / 0.65 }, { id: 'entrega', tasa: 0.65 }];

const nMX = M.nucleo({
  embudo: MX,
  fijos: [
    { id: 'producto', label: 'Precio proveedor', monto: 120, etapa: 2 },
    { id: 'flete',    label: 'Flete',            monto: 145, etapa: 1 },
    { id: 'cpa',      label: 'CPA',              monto:  90, etapa: 0 },
  ],
  pct: [],
});

const dFlete = nMX.detalle_fijos.find(x => x.id === 'flete');
const dCpa   = nMX.detalle_fijos.find(x => x.id === 'cpa');

eq('flete costeado = 223', Math.round(dFlete.costeado), 223, 0);
eq('CPA costeado = 164',   Math.round(dCpa.costeado),   164, 0);
eq('costos totales = 507', Math.round(nMX.K),           507, 0);

const precioMX = M.precioPara(nMX.K, nMX.C, 0.10);
eq('precio de venta = 563', Math.round(precioMX), 563, 0);
eq('ganancia = 56', Math.round(M.utilidadCon(precioMX, nMX.K, nMX.C)), 56, 0);

/* El margen del 10% es SOBRE LA VENTA, no sobre el costo. Multiplicar el
   costo por 1.10 daría 557 y un margen real de 9.1%. La planilla esto lo
   hace bien; muchas no. */
check('el margen del 10% es sobre la venta, no sobre el costo',
  Math.round(nMX.K * 1.10) === 557 && Math.round(precioMX) === 563,
  `costo×1.10 = ${Math.round(nMX.K * 1.10)} · correcto = ${Math.round(precioMX)}`);

/* El hallazgo: la planilla dice que la confirmación es 0.85, pero divide
   por 0.55. Con el 0.85 de verdad el acumulado es 0.5525 y el CPA da 163,
   no 164. Un peso por unidad, siempre para el mismo lado. */
const nMXreal = M.nucleo({
  embudo: [{ tasa: 0.85 }, { tasa: 0.65 }],
  fijos: [{ id: 'cpa', monto: 90, etapa: 0 }],
  pct: [],
});
check('con el 0.85 declarado (no el 0.55 escrito) el CPA da 163: la planilla redondea su propio embudo',
  Math.round(nMXreal.K) === 163,
  `0.85×0.65 = 0.5525 → 90/0.5525 = ${nMXreal.K}`);


/* ══ B · EL DENOMINADOR ════════════════════════════════════════════════

   El error caro. Los cargos que se cobran como porcentaje DE LA VENTA
   (comisión, IIBB, publicidad, cuotas) no se pueden sumar al costo:
   cuando subís el precio para cubrirlos, suben ellos también.

     mal:  precio = costos / (1 − margen)              → y después cobran
     bien: precio = costos / (1 − margen − cargos)

   Con 25% de cargos y 20% de margen pedido, la cuenta mal hecha entrega
   −5%. No "menos margen": pérdida.                                     */

console.log('\n[B · los porcentajes van al denominador]');

const K = 5000, C = 0.25, m = 0.20;

const precioMal = K / (1 - m);                       /* lo que hace la planilla */
const margenMal = M.utilidadCon(precioMal, K, C) / precioMal;
eq('sumando: promete 20% y entrega −5%', margenMal, -0.05, 0.0001);

const precioBien = M.precioPara(K, C, m);
const margenBien = M.utilidadCon(precioBien, K, C) / precioBien;
eq('dividiendo: entrega exactamente el 20% prometido', margenBien, 0.20, 1e-9);
eq('el precio correcto es 9090.91 y no 6250', precioBien, 9090.91);

/* Y el caso que ninguna planilla contempla: cuando los cargos más el
   margen llegan a 1, no hay precio que alcance. No es "caro": no existe.
   Devolver un número acá sería mentir. */
check('con cargos + margen ≥ 1 no devuelve un precio inventado, devuelve null',
  M.precioPara(5000, 0.85, 0.20) === null);


/* ══ C · IDA Y VUELTA — los despejes ═══════════════════════════════════

   `techo_costo` y `cpa_maximo` salen de despejar la ecuación. Un despeje
   mal hecho no se nota mirándolo: se nota metiendo el resultado de vuelta
   por la entrada. Si el techo dice "pagá hasta 12.500" y pagando 12.500
   el margen no da EXACTAMENTE el mínimo, el techo está mal.

   Esto es lo que evita el bug más caro posible en esta herramienta.     */

console.log('\n[C · el techo, verificado al revés]');

const FICHA = {
  nombre: 'Lámpara de pie',
  costo_proveedor: 40000, costo_incluye_iva: true, proveedor_factura_a: true,
  costo_entrada_lote: 180000, unidades_lote: 60,
  precio_venta: 129900,
  canal: 'mercadolibre_clasica',
  costo_envio: 12000, pct_envio_a_cargo: 1, costo_envio_vuelta: 12000,
  costo_empaque: 1500,
  condicion: 'ri', iibb_pct: 0.035, ganancias_pct: 0.35,
  tasa_devolucion: 0.06, tasa_reventa_devuelto: 0.8, merma_pct: 0.02,
  margen_objetivo: 0.30, margen_minimo: 0.20,
  utilidad_minima_unidad: 3000, roi_minimo: 0.40,
};

const base = M.calcular(FICHA);
check('la ficha base calcula sin romperse', typeof base.techo_costo === 'number',
  JSON.stringify({ techo: base.techo_costo, veredicto: base.veredicto }));

/* EL chequeo. Pagando exactamente el techo, el margen tiene que ser el
   mínimo exigido — ni un centésimo más ni uno menos. */
const alTecho = M.calcular(Object.assign({}, FICHA, { costo_proveedor: base.techo_costo }));
eq('pagando el techo exacto, el margen da el mínimo pedido (20%)',
   alTecho.margen, FICHA.margen_minimo, 0.0002);

/* Un peso más que el techo tiene que caer abajo del mínimo. Si no cae, el
   techo no es un techo. */
const sobreTecho = M.calcular(Object.assign({}, FICHA, { costo_proveedor: base.techo_costo + 500 }));
check('500 pesos por encima del techo, el margen ya no llega al mínimo',
  sobreTecho.margen < FICHA.margen_minimo,
  `margen ${(sobreTecho.margen * 100).toFixed(2)}%`);

/* Lo mismo con el CPA: gastando exactamente el techo de publicidad, el
   margen tiene que quedar clavado en el mínimo. El plan original publicó
   un CPA máximo que no se reproducía desde sus propios datos; esto es lo
   que hace que no vuelva a pasar. */
const conCpa = M.calcular(Object.assign({}, FICHA, { cpa: base.cpa_maximo_con_iva }));
eq('gastando el CPA máximo exacto, el margen queda en el mínimo',
   conCpa.margen, FICHA.margen_minimo, 0.0002);

/* Y el precio sugerido: vendiendo al precio que sugiere, el margen tiene
   que ser el objetivo. */
const alSugerido = M.calcular(Object.assign({}, FICHA, { precio_venta: base.precio_sugerido }));
eq('vendiendo al precio sugerido, el margen da el objetivo (30%)',
   alSugerido.margen, FICHA.margen_objetivo, 0.0002);

/* Y el piso: al precio piso, la utilidad es cero. Un peso menos, pérdida. */
const alPiso = M.calcular(Object.assign({}, FICHA, { precio_venta: base.precio_piso }));
eq('al precio piso la utilidad es exactamente cero', alPiso.utilidad, 0, 1);


/* ══ D · LO ARGENTINO ══════════════════════════════════════════════════

   Las cuatro reglas que no están en ninguna planilla mexicana y que en
   Argentina mueven el resultado más que el precio del proveedor.       */

console.log('\n[D · las reglas argentinas]');

/* 1 · IVA. Para un RI con factura A, el IVA de la compra es crédito
   fiscal: NO es costo. Si el proveedor no da factura, esos 21 puntos se
   pegan al costo y el margen se desploma. */
const conFactura = M.calcular(FICHA);
const sinFactura = M.calcular(Object.assign({}, FICHA, { proveedor_factura_a: false }));
check('sin factura A el costo del producto sube 21%',
  cerca(sinFactura._debug.costo_base, conFactura._debug.costo_base * 1.21, 1),
  `con factura ${conFactura._debug.costo_base} · sin factura ${sinFactura._debug.costo_base}`);
check('sin factura A el techo de costo baja',
  sinFactura.techo_costo < conFactura.techo_costo);
check('avisa que el proveedor sin factura A convierte el IVA en costo',
  sinFactura.alertas.some(a => /factura A/i.test(a.texto)));

/* 2 · Ganancias va DESPUÉS, sobre la utilidad, no sobre la venta. Si
   estuviera en el denominador con los otros, el precio saldría distinto.
   La prueba: el margen objetivo se cumple DESPUÉS de pagarlo. */
eq('el margen objetivo se cumple después de pagar Ganancias',
   alSugerido.margen, 0.30, 0.0002);
check('Ganancias es el 35% de la utilidad antes de impuesto, no de la venta',
  cerca(base.ganancias, base.utilidad_antes_impuesto * 0.35, 1),
  `ganancias ${base.ganancias} · 35% de ${base.utilidad_antes_impuesto}`);
const monotributo = M.calcular(Object.assign({}, FICHA, { condicion: 'monotributo' }));
check('en monotributo no se descuenta Ganancias', monotributo.ganancias === 0);

/* 3 · Devoluciones (ley 24.240 art. 34). El flete de vuelta lo paga el
   vendedor SIEMPRE — es irrenunciable, no se puede poner en los términos
   que lo pague el comprador. Por eso subir la tasa de devolución encarece
   la unidad aunque todo lo devuelto se pueda revender intacto. */
const sinDev  = M.calcular(Object.assign({}, FICHA, { tasa_devolucion: 0,    tasa_reventa_devuelto: 1 }));
const conDev  = M.calcular(Object.assign({}, FICHA, { tasa_devolucion: 0.15, tasa_reventa_devuelto: 1 }));
check('con 15% de devoluciones el costo sube aunque todo se revenda intacto (el flete de vuelta es del vendedor)',
  conDev.costos_totales > sinDev.costos_totales,
  `sin devoluciones ${sinDev.costos_totales} · con 15% ${conDev.costos_totales}`);
check('el costo de la devolución lo pagan las ventas firmes: se divide, no se multiplica',
  cerca(conDev.detalle_fijos.find(x => x.id === 'envio_ida').divisor, 0.85, 0.001),
  `divisor ${conDev.detalle_fijos.find(x => x.id === 'envio_ida').divisor}`);

/* 4 · Merma. De cada 100 compradas, algunas no se venden nunca. Su costo
   lo pagan las que sí se venden: DIVIDE. Multiplicar (costo × 1.10)
   subestima — es el error que tenía el plan original. */
const sinMerma = M.calcular(Object.assign({}, FICHA, { merma_pct: 0 }));
const conMerma = M.calcular(Object.assign({}, FICHA, { merma_pct: 0.10 }));
eq('merma del 10%: el costo se divide por 0.90, no se multiplica por 1.10',
   conMerma._debug.costo_base / sinMerma._debug.costo_base, 1, 0.0001);
check('la merma divide (÷0.90 = +11.1%), no multiplica (×1.10 = +10%)',
  cerca(conMerma._debug.costo_producto / sinMerma._debug.costo_producto, 1 / 0.9, 0.001),
  `subió ×${(conMerma._debug.costo_producto / sinMerma._debug.costo_producto).toFixed(4)}`);


/* ══ E · EL GRIS ═══════════════════════════════════════════════════════

   El estado que falta en todas las planillas. Un semáforo de tres colores
   está obligado a elegir, y termina pintando de verde una cuenta a la que
   le falta el costo de envío. "No sé" no es "sí".                      */

console.log('\n[E · falta un dato ≠ está bien]');

const sinEnvio = M.calcular(Object.assign({}, FICHA, { costo_envio: undefined }));
check('sin costo de envío el veredicto es gris, no verde', sinEnvio.veredicto === 'gris',
  `dio ${sinEnvio.veredicto}`);
check('y dice exactamente qué dato falta',
  sinEnvio.faltantes.some(x => /env[ií]o/i.test(x)), sinEnvio.faltantes.join(', '));

const sinPrecio = M.calcular(Object.assign({}, FICHA, { precio_venta: 0 }));
check('sin precio de venta también es gris', sinPrecio.veredicto === 'gris');

const carisimo = M.calcular(Object.assign({}, FICHA, { costo_proveedor: 200000 }));
check('un costo muy por encima del techo da rojo', carisimo.veredicto === 'rojo',
  `dio ${carisimo.veredicto}, margen ${(carisimo.margen * 100).toFixed(1)}%`);
check('y dice cuánto hay que negociar',
  carisimo.alertas.some(a => a.nivel === 'rojo' && /techo/i.test(a.texto)));
check('y lo dice en plata, no en un número pelado',
  carisimo.alertas.some(a => a.nivel === 'rojo' && /pide \$ [\d.]+ y el techo es \$ [\d.]+/.test(a.texto)),
  carisimo.alertas.filter(a => a.nivel === 'rojo').map(a => a.texto).join(' | '));

/* Cargos imposibles: comisión premium + IIBB + publicidad alta. El motor
   no puede devolver un precio, y el veredicto tiene que ser rojo. */
const imposible = M.calcular(Object.assign({}, FICHA, {
  canal: 'mercadolibre_premium', publicidad_pct: 0.30, iibb_pct: 0.05, margen_minimo: 0.45,
}));
check('cuando no existe precio posible, el veredicto es rojo y no hay número inventado',
  imposible.veredicto === 'rojo' && imposible.precio_minimo === null,
  `veredicto ${imposible.veredicto} · precio mínimo ${imposible.precio_minimo}`);

/* Los defaults de comisión son supuestos míos, no datos verificados de la
   cuenta real. La pantalla tiene que avisarlo hasta que alguien los
   confirme. Un supuesto que se lee como dato es peor que un campo vacío. */
check('avisa que la comisión del canal es un supuesto sin verificar',
  base.alertas.some(a => /supuesto/i.test(a.texto)));


/* ══ F · EL LOTE ═══════════════════════════════════════════════════════

   El riesgo real no es que la cuenta esté mal: es que nadie la use.
   Nadie carga 40 productos de a uno dos veces. Por eso la lista entera
   tiene que funcionar desde el día uno.                                */

console.log('\n[F · la lista del proveedor entera]');

const LISTA = [
  { sku: 'A1', nombre: 'Barato',    costo_proveedor: 20000,  precio_venta: 129900 },
  { sku: 'A2', nombre: 'Justo',     costo_proveedor: 62000,  precio_venta: 129900 },
  { sku: 'A3', nombre: 'Caro',      costo_proveedor: 200000, precio_venta: 129900 },
  { sku: 'A4', nombre: 'Sin precio', costo_proveedor: 30000 },
];
const lote = M.calcularLote(LISTA, FICHA);
check('devuelve una fila por producto', lote.length === 4);
check('cada fila trae su veredicto y su techo',
  lote.every(x => x.veredicto && (x.techo_costo !== undefined)),
  lote.map(x => `${x.sku}:${x.veredicto}`).join(' '));
check('el barato da verde y el caro da rojo',
  lote[0].veredicto === 'verde' && lote[2].veredicto === 'rojo',
  lote.map(x => `${x.sku}:${x.veredicto}`).join(' '));
check('al que le falta el precio le da gris, no lo tira',
  lote[3].veredicto === 'gris');
check('cada fila trae lo que pide el proveedor, para la columna Diferencia',
  lote.every(x => Number.isFinite(x.costo_proveedor)) && lote[0].costo_proveedor === LISTA[0].costo_proveedor,
  lote.map(x => x.costo_proveedor).join(' '));

const res = M.resumenLote(lote);
check('el resumen cuenta los cuatro estados',
  res.total === 4 && res.verde + res.ambar + res.rojo + res.gris === 4,
  JSON.stringify(res));
check('el ROI de cartera sale de lo comprable, no de todo',
  res.roi_cartera > 0, JSON.stringify(res));

/* Una fila rota no puede tumbar las otras 39. */
const conBasura = M.calcularLote([{ sku: 'X', costo_proveedor: 'abc', precio_venta: null }], FICHA);
check('una fila ilegible sale gris y no rompe el lote',
  conBasura.length === 1 && conBasura[0].veredicto === 'gris');



/* ═══════════════════════════════════════════════════════════════════════
   CAMPAÑAS — el despeje del lado de la publicidad                (0177-b)

   Lo que se prueba acá no es "el número da bien". Es que el número sirva
   para decidir: que el objetivo salga de los costos y no se pueda tipear,
   que esté en las unidades del panel de ML, y que con pocas ventas el
   veredicto sea gris en vez de inventado.
   ═══════════════════════════════════════════════════════════════════════ */

console.log('\n── Campañas / ROAS ──');

/* ── Las cotas de Poisson ──
   Son la diferencia entre "esta campaña no funciona" y "todavía no sé".
   Si se corren, el módulo empieza a pintar de rojo el ruido. */
eq('con 0 ventas la cota alta es −ln(0,05) = 2,996', M.ventasAlto(0), 2.9957, 0.001);
eq('n/L con 10 ventas = 1,84', 10 / M.ventasBajo(10), 1.84, 0.01);
eq('n/U con 10 ventas = 0,59', 10 / M.ventasAlto(10), 0.59, 0.01);
eq('n/L con 3 ventas = 3,67',  3 / M.ventasBajo(3),  3.67, 0.01);
eq('n/U con 50 ventas = 0,79', 50 / M.ventasAlto(50), 0.79, 0.01);
check('el intervalo se angosta cuando hay más ventas',
  (3 / M.ventasBajo(3)) > (50 / M.ventasBajo(50)));
check('la acumulada de Poisson no se rompe con lambda grande',
  Number.isFinite(M.poissonCDF(900, 1000)) && M.poissonCDF(900, 1000) < 0.01,
  String(M.poissonCDF(900, 1000)));

/* ── Los tres ROAS salen de los costos ── */
/* La ficha de arriba ni sin publicidad llega al margen objetivo, así que
   su ROAS objetivo es null con toda razón. Para probar el orden de los
   tres hace falta un producto con aire. */
const holgadaF = (pub) => Object.assign({}, FICHA, { precio_venta: 180000, publicidad_pct: pub });
const holgada = M.calcular(holgadaF(0));
check('hay tres ROAS y están ordenados: equilibrio < mínimo < objetivo',
  holgada.roas_equilibrio < holgada.roas_minimo && holgada.roas_minimo < holgada.roas_objetivo,
  holgada.roas_equilibrio + ' / ' + holgada.roas_minimo + ' / ' + holgada.roas_objetivo);

/* Null es la respuesta correcta cuando el objetivo no se alcanza:
   cualquier número sería inventado, y un cero haría dividir por cero. */
check('sin aire para el margen objetivo, el ROAS objetivo es null',
  base.margen < FICHA.margen_objetivo && base.roas_objetivo === null,
  'margen ' + base.margen.toFixed(4) + ', objetivo ' + base.roas_objetivo);

eq('ROAS de equilibrio es 1 / margen de contribución',
  base.roas_equilibrio, 1 / base.margen_contribucion, 0.01);

/* La identidad que amarra los dos submódulos: el gasto máximo en pauta es
   el mismo CPA máximo del techo de costo, más la publicidad que la ficha
   ya declaraba como porcentaje. Sin ese reintegro el objetivo sale cinco
   veces más alto, y el error va justo en la dirección que te hace apagar
   campañas que estaban bien. */
const conPub = M.calcular(holgadaF(0.08));
eq('gasto máximo = CPA máximo + la publicidad ya presupuestada',
  conPub.gasto_ads_maximo, conPub.cpa_maximo + conPub.precio_neto * 0.08, 0.02);
check('sin ese reintegro el objetivo daría casi el doble de alto',
  (conPub.precio_bruto / conPub.cpa_maximo) > conPub.roas_minimo * 1.5,
  (conPub.precio_bruto / conPub.cpa_maximo).toFixed(2) + ' vs ' + conPub.roas_minimo);

/* ── Ida y vuelta ──
   Gastar exactamente el máximo tiene que aterrizar en el margen mínimo.
   El campo `cpa` se tipea con IVA, por eso el (1+iva) al volver. */
const ivaV = base.precio_bruto / base.precio_neto - 1;
const ida = (gasto) => M.calcular(Object.assign({}, FICHA, {
  publicidad_pct: 0, cpa: gasto * (1 + ivaV),
}));
eq('gastando hasta el equilibrio el margen queda en cero',
  ida(base.gasto_ads_equilibrio).margen, 0, 0.0001);
eq('gastando el máximo el margen aterriza en el mínimo',
  ida(base.gasto_ads_maximo).margen, FICHA.margen_minimo, 0.0001);
const idaH = (gasto) => M.calcular(Object.assign(holgadaF(0), {
  cpa: gasto * (holgada.precio_bruto / holgada.precio_neto),
}));
eq('gastando el del objetivo aterriza en el objetivo',
  idaH(holgada.gasto_ads_objetivo).margen, FICHA.margen_objetivo, 0.0001);

/* Y cuando la publicidad ya declarada se comió todo el margen, el CPA
   máximo se clampea en cero pero el presupuesto total de pauta no: son
   dos preguntas distintas. "Cuánto MÁS puedo gastar" es cero; "cuánto
   puedo gastar en total" sigue siendo el 8% que ya estaba presupuestado.
   Es la razón de que la identidad de arriba solo valga mientras hay techo. */
const ahogada = M.calcular(Object.assign({}, FICHA, { publicidad_pct: 0.08 }));
check('con la publicidad comiéndose el margen, el CPA extra es 0 pero el presupuesto no',
  ahogada.cpa_maximo === 0 && ahogada.gasto_ads_maximo > 0,
  ahogada.cpa_maximo + ' / ' + ahogada.gasto_ads_maximo);
check('y el ROAS mínimo sigue siendo un número, no Infinity',
  Number.isFinite(ahogada.roas_minimo), String(ahogada.roas_minimo));

/* ── Unidades: bruto sobre neto, como el panel de ML ──
   ML muestra la inversión SIN IVA y los ingresos CON IVA. Si el objetivo
   se calculara todo en neto quedaría 21% corrido, que es más que
   cualquier desvío que uno quiera medir. */
eq('el ROAS objetivo usa el precio BRUTO en el numerador',
  base.roas_minimo, base.precio_bruto / base.gasto_ads_maximo, 0.01);
check('usar el neto daría 21% menos: ese es el error de unidades',
  cerca((base.precio_neto / base.gasto_ads_maximo) / base.roas_minimo, 1 / (1 + ivaV), 0.001));

/* ── Un producto que no banca publicidad ── */
const flaco = M.calcular(Object.assign({}, FICHA, { precio_venta: 62000 }));
check('si no da para publicitar el ROAS es null, nunca Infinity',
  flaco.roas_minimo === null || Number.isFinite(flaco.roas_minimo),
  String(flaco.roas_minimo));
check('y dice cuánto falta por unidad, no solo que no se puede',
  flaco.roas_minimo !== null || flaco.faltante_para_publicar > 0,
  String(flaco.faltante_para_publicar));

/* ── El veredicto ── */
/* Un producto con márgenes alcanzables: eq 2,61x · mínimo 3,79x ·
   objetivo 6,94x. La ficha base pide 30% post-Ganancias sobre algo que
   da 23,77%, así que su ROAS mínimo es 22x y ninguna campaña real lo
   alcanza — buena para probar el null, mala para probar el veredicto. */
const REF = M.calcular(Object.assign({}, FICHA,
  { precio_venta: 180000, margen_objetivo: 0.20, margen_minimo: 0.10 }));
const diag = (o) => M.diagnosticarCampania(Object.assign({ dias_desde_fin: 30 }, o), REF);

const muchas = diag({ nombre: 'ok', inversion: 120000, ingresos: 1200000, ventas: 40 });
check('con muchas ventas y buen ROAS: verde',
  muchas.veredicto === 'verde', muchas.veredicto + ' / ' + muchas.estado);
/* La fila dice lo mismo que la leyenda: si la leyenda promete "Para
   escalar" y la fila dice "Muy eficiente", el dueño busca cuál es cuál. */
check('el estado verde usa la misma palabra que la leyenda: "Para escalar"',
  muchas.estado === 'Para escalar', muchas.estado);
const alLimite = diag({ nombre: 'límite', inversion: 120000, ingresos: 600000, ventas: 40 });
check('el estado ámbar usa la misma palabra que la leyenda: "Al límite"',
  alLimite.veredicto === 'ambar' && alLimite.estado === 'Al límite',
  alLimite.veredicto + ' / ' + alLimite.estado);

const pocas = diag({ nombre: 'pocas', inversion: 9000, ingresos: 90000, ventas: 3 });
check('el MISMO ROAS con 3 ventas ya no es verde: el ruido no se pinta',
  pocas.roas === muchas.roas && pocas.veredicto !== 'verde',
  'roas ' + pocas.roas + ' vs ' + muchas.roas + ', veredicto ' + pocas.veredicto);

const malo = diag({ nombre: 'malo', inversion: 400000, ingresos: 300000, ventas: 10 });
check('con evidencia suficiente y ROAS bajo el equilibrio: rojo',
  malo.veredicto === 'rojo', malo.veredicto + ' / ' + malo.estado);

/* Cero ventas con plata gastada NO es falta de evidencia: es la evidencia
   más fuerte que existe. Es el caso que toda planilla manda a "sin datos". */
const ceroAlto = diag({ nombre: 'cero', inversion: 900000, ingresos: 0, ventas: 0 });
check('cero ventas con mucho gasto es rojo, no gris',
  ceroAlto.veredicto === 'rojo', ceroAlto.veredicto + ' / ' + ceroAlto.estado);
const ceroBajo = diag({ nombre: 'cero', inversion: 2000, ingresos: 0, ventas: 0 });
check('cero ventas con poco gasto sí es gris, y dice cuánto gastar',
  ceroBajo.veredicto === 'gris' && /Gastar hasta/.test(ceroBajo.decision),
  ceroBajo.veredicto + ' / ' + ceroBajo.decision);
check('y ese tope está en plata, con separador de miles',
  /Gastar hasta \$ [\d.]+ o apagar/.test(ceroBajo.decision), ceroBajo.decision);

/* La ventana de atribución: sesgo, no ruido. Ningún intervalo lo corrige. */
const caliente = M.diagnosticarCampania(
  { nombre: 'x', inversion: 400000, ingresos: 300000, ventas: 10, dias_desde_fin: 3 }, base);
check('un período que cerró hace 3 días no se colorea',
  caliente.veredicto === 'gris' && /Esperar/.test(caliente.decision),
  caliente.veredicto + ' / ' + caliente.decision);

/* Sin producto de referencia no hay veredicto. El objetivo no se inventa. */
const huerfana = M.diagnosticarCampania({ nombre: 'x', inversion: 1000, ingresos: 5000, ventas: 2 }, {});
check('sin producto de referencia da gris, no un objetivo inventado',
  huerfana.veredicto === 'gris' && huerfana.roas_objetivo === null,
  huerfana.veredicto + ' / ' + huerfana.roas_objetivo);

/* Faltar un dato y estar mal son cosas distintas. */
const sinInv = diag({ nombre: 'x', ingresos: 5000, ventas: 2 });
check('sin inversión: gris con la lista de lo que falta',
  sinInv.veredicto === 'gris' && sinInv.faltantes.indexOf('Inversión') >= 0,
  JSON.stringify(sinInv.faltantes));

/* ── Las alertas no afirman sobre datos que nadie cargó ── */
const sinOrg = diag({ nombre: 'x', inversion: 120000, ingresos: 1200000, ventas: 40 });
check('sin cargar el orgánico no se afirma nada sobre canibalización',
  !sinOrg.alertas.some(a => /canibaliz|vende sola/i.test(a.texto)),
  JSON.stringify(sinOrg.alertas.map(a => a.texto.slice(0, 40))));
const conOrg = diag({ nombre: 'x', inversion: 60000, ingresos: 600000, ventas: 20,
                   ventas_sin_ads: 30, ingresos_sin_ads: 900000 });
check('con el orgánico cargado y alto, sí avisa de canibalización',
  conOrg.alertas.some(a => /sin publicidad/i.test(a.texto)),
  JSON.stringify(conOrg.alertas.map(a => a.texto.slice(0, 40))));
check('y calcula el TACOS contra el ingreso total de la publicación',
  cerca(conOrg.tacos, 60000 / 1500000, 0.001), String(conOrg.tacos));

/* ── La contribución va en pesos ── */
check('la ganancia es contribución menos inversión, en pesos',
  cerca(muchas.ganancia, muchas.contribucion - muchas.inversion, 0.02),
  muchas.ganancia + ' vs ' + muchas.contribucion + ' - ' + muchas.inversion);
check('una campaña roja resta en el resumen de cartera',
  M.resumenCampanias([malo]).ganancia_total < 0,
  String(M.resumenCampanias([malo]).ganancia_total));

/* ── Unidades declaradas al revés ── */
const netos = diag({ nombre: 'x', inversion: 120000, ingresos: 1200000, ventas: 40,
                  ingresos_con_iva: false });
check('si el dueño declara los ingresos en neto, se los lleva a bruto',
  netos.ingresos > muchas.ingresos, netos.ingresos + ' vs ' + muchas.ingresos);

/* ── Un gris tiene que decir cuánto falta ── */
/* Un gris tiene que decir hasta cuándo. "Seguir midiendo" sin un número
   es la forma educada de no decir nada, y deja la campaña prendida. */
const dosVentas = diag({ nombre: 'x', inversion: 6000, ingresos: 60000, ventas: 2 });
check('con 2 ventas el intervalo cruza el equilibrio: gris',
  dosVentas.veredicto === 'gris', dosVentas.veredicto + ' / ' + dosVentas.roas_bajo);
check('y dice con cuántas ventas alcanzaría para afirmar algo',
  dosVentas.ventas_para_firmeza > dosVentas.ventas,
  String(dosVentas.ventas_para_firmeza));

/* El umbral del verde cae al mínimo cuando el objetivo es inalcanzable.
   Si no, un producto que ni sin publicidad llega al margen objetivo deja
   la columna Estado clavada en ámbar para siempre, por buena que esté la
   campaña: el verde se vuelve imposible por algo ajeno a la campaña. */
const contraBase = M.diagnosticarCampania(
  { nombre: 'x', inversion: 120000, ingresos: 1200000, ventas: 40, dias_desde_fin: 30 }, base);
check('sin ROAS objetivo, el verde se juzga contra el mínimo',
  contraBase.umbral_verde === base.roas_minimo && base.roas_objetivo === null,
  contraBase.umbral_verde + ' / ' + base.roas_minimo);

/* Una fila rota no puede tumbar la tabla. */
const rotas = M.diagnosticarCampanias(
  [null, { nombre: 'ok', inversion: 1000, ingresos: 5000, ventas: 2, dias_desde_fin: 30 }], base);
check('una fila ilegible no tumba las demás',
  rotas.length === 2 && rotas[1].nombre === 'ok');
console.log('\n--------------------------------');
console.log(`${pass} ok · ${fail} fail`);
process.exit(fail ? 1 : 0);
