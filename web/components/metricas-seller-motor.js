/* ══ MÉTRICAS SELLER — EL MOTOR (0177) ═══════════════════════════════
   Plata pura. Sin React, sin DOM, sin Supabase, sin fetch. Todo lo que hay
   acá es aritmética, y por eso se puede probar con `node tests/run-all.js`
   sin abrir un navegador.

   ── Qué resuelve ──────────────────────────────────────────────────────

   Antes de comprarle un lote a un proveedor hay una sola pregunta que
   importa: "a este precio, ¿gano o pierdo?". La respuesta parece una resta
   y no lo es. Hay tres formas de equivocarse que se ven iguales en una
   planilla y terminan distinto en el banco:

     1 · Sumar los porcentajes al costo en vez de ponerlos en el
         denominador. Si la comisión, IIBB y publicidad se cobran SOBRE LA
         VENTA, no se pueden sumar al costo: cuando sube el precio, suben
         ellos también. Con 25% de cargos sobre la venta, una planilla que
         suma en vez de dividir promete 20% de margen y entrega −5%. El
         test lo reproduce al decimal.

     2 · Cargar el costo de una devolución sobre la venta devuelta. La
         devolución no tiene a quién cobrarle: la pagan las ventas que
         quedaron firmes. Por eso se DIVIDE por la tasa de éxito, nunca se
         multiplica.

     3 · Olvidarse de Ganancias, o meterlo con los otros porcentajes.
         Ganancias no se cobra sobre la venta, se cobra sobre la utilidad.
         Va después, no en el denominador.

   ── El número que importa ─────────────────────────────────────────────

   `techo_costo`: cuánto es lo máximo que se puede pagar por la unidad para
   que el negocio cierre al precio al que se puede vender. Es el número que
   se mira parado frente a la lista del proveedor. Todo lo demás en este
   archivo existe para calcularlo bien.

   ── La cascada ────────────────────────────────────────────────────────

   El motor no sabe de "devoluciones" ni de "confirmación": sabe de un
   embudo genérico de etapas con su tasa, y de costos que declaran en qué
   etapa se incurren. Un costo que se paga antes de una etapa se divide por
   todo lo que falta sobrevivir después de él.

   Eso hace que el mismo motor sirva para el modelo COD mexicano (dos
   etapas: confirmación y entrega) y para el argentino (una: devolución).
   La mecánica viaja; los números no. En México la tasa de entrega es 0.65;
   en Argentina, con Mercado Envíos y pago por adelantado, es 0.93–0.97. El
   test de degeneración en tests/metricas-seller-test.js prueba justamente
   eso: alimentado con el embudo mexicano, este motor reproduce los números
   de la planilla original al peso.

   ── IVA: todo se trabaja en NETO ──────────────────────────────────────

   Decisión de diseño, y es la que hace que las cuentas cierren para un
   Responsable Inscripto. El IVA débito no es ingreso y el IVA crédito no
   es costo: son plata de ARCA que pasa por la caja. Si se mezclan, el
   margen queda inflado ~21% y todas las decisiones salen mal.

   La ventaja de trabajar en neto es que los porcentajes no cambian:
   la comisión de ML se cobra sobre el precio publicado (con IVA) y ella
   misma lleva IVA recuperable, así que

       comisión_neta = (P × c) / 1.21 = (P / 1.21) × c = venta_neta × c

   Se cancela. El porcentaje sobre el bruto es el mismo porcentaje sobre el
   neto. Lo único que hay que acordarse de netear son los montos FIJOS
   (cargo fijo de ML, envío, empaque) y el costo del proveedor.

   IIBB es la excepción: se calcula sobre la base neta, pero NO es
   recuperable. Es costo puro.
   ═════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Redondeo de plata ──
     Dos decimales, sin el error de coma flotante que hace que
     0.1 + 0.2 no dé 0.3. Todo lo que sale del motor pasa por acá. */
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const num = (n, def) => {
    const v = Number(n);
    return Number.isFinite(v) ? v : (def === undefined ? 0 : def);
  };

  /* ═══ VALORES POR DEFECTO — ARGENTINA ═══════════════════════════════
     Todo lo que está acá es un SUPUESTO hasta que el dueño lo toque. La
     pantalla los muestra en ámbar por eso mismo: un default que se lee
     como dato confirmado es peor que un campo vacío, porque nadie lo
     revisa.

     Las alícuotas de impuestos son las de la ley y cambian poco. Las
     comisiones de los canales cambian seguido y por categoría — esas hay
     que ir a mirarlas en la cuenta real y escribirlas acá. */

  const DEFAULTS = {
    /* Fiscal — Responsable Inscripto */
    condicion:        'ri',
    iva_ventas:       0.21,
    iva_compra:       0.21,
    proveedor_factura_a: true,   /* si da factura A, el IVA de compra es crédito fiscal y NO es costo */
    iibb_pct:         0.035,     /* SUPUESTO: comercio mayorista CABA. Cambiar por la alícuota real de la provincia. */
    ganancias_pct:    0.35,      /* sociedades. Sobre la utilidad, no sobre la venta. */
    deb_cred_pct:     0.006,     /* imp. al cheque: 0.6% al debitar. El 0.6% del crédito se computa aparte. */

    /* Embudo */
    tasa_devolucion:      0.05,  /* SUPUESTO. Ley 24.240 art. 34: 10 días de arrepentimiento, irrenunciable. */
    tasa_reventa_devuelto: 0.80, /* de lo que vuelve, cuánto se puede volver a vender como nuevo */
    canal_reintegra_comision: 1, /* ML reintegra la comisión en una devolución. 0 = no la reintegra. */
    merma_pct:            0.01,  /* rotura/robo/obsolescencia de depósito */

    /* Umbrales de veredicto */
    margen_objetivo:        0.30,
    margen_minimo:          0.20,
    utilidad_minima_unidad: 3000,
    roi_minimo:             0.40,
  };

  /* ═══ CANALES ═══════════════════════════════════════════════════════
     ATENCIÓN: estos números son supuestos de arranque, NO están
     verificados contra la cuenta real. Las comisiones de Mercado Libre
     cambian por categoría, por precio y por tipo de publicación, y se
     actualizan varias veces al año. Antes de comprar un lote con esto,
     entrar a la publicación real y copiar el número que muestra ML.

     `_supuesto: true` es lo que hace que la pantalla los pinte en ámbar. */

  const CANALES = {
    mercadolibre_clasica: {
      label: 'Mercado Libre · Clásica',
      comision_pct: 0.135,
      cargo_fijo: 0,          /* ML cobra un cargo fijo por unidad debajo de cierto precio */
      cuotas_pct: 0,          /* la clásica no incluye cuotas sin interés */
      publicidad_pct: 0,
      _supuesto: true,
    },
    mercadolibre_premium: {
      label: 'Mercado Libre · Premium',
      comision_pct: 0.275,    /* incluye el costo de las cuotas sin interés */
      cargo_fijo: 0,
      cuotas_pct: 0,
      publicidad_pct: 0,
      _supuesto: true,
    },
    tiendanube: {
      label: 'Tienda Nube',
      comision_pct: 0,        /* TN no cobra comisión por venta en los planes pagos */
      pasarela_pct: 0.0499,   /* Mercado Pago checkout: eso sí se cobra */
      cargo_fijo: 0,
      cuotas_pct: 0,
      publicidad_pct: 0,
      _supuesto: true,
    },
    propio: {
      label: 'Venta directa',
      comision_pct: 0,
      cargo_fijo: 0,
      cuotas_pct: 0,
      publicidad_pct: 0,
      _supuesto: false,
    },
  };

  /* ═══ LA CASCADA ═════════════════════════════════════════════════════

     `embudo` es una lista ordenada de transiciones con su tasa de
     supervivencia:

         [ {id:'confirmacion', tasa:0.85}, {id:'entrega', tasa:0.65} ]

     Las etapas quedan numeradas por los huecos: la etapa 0 es "antes de
     confirmar", la 1 es "confirmado pero no entregado", la 2 (= largo del
     embudo) es "entregado y firme".

     `residual(i)` = cuánto sobrevive desde la etapa i hasta el final.

     Un costo que se incurre en la etapa i se divide por residual(i),
     porque por cada venta que llega al final hubo 1/residual(i) unidades
     que pasaron por esa etapa y pagaron ese costo.

         residual(2) = 1        → el costo se paga solo si la venta cierra
         residual(1) = 0.65     → flete: se paga en todo pedido confirmado
         residual(0) = 0.5525   → CPA: se paga en todo pedido generado

     Esto es lo que la planilla original hace a mano con dos divisiones
     escritas a dedo, y lo que se rompe apenas agregás una tercera etapa. */

  function residuales(embudo) {
    const e = Array.isArray(embudo) ? embudo : [];
    const out = new Array(e.length + 1);
    out[e.length] = 1;
    for (let i = e.length - 1; i >= 0; i--) {
      out[i] = out[i + 1] * num(e[i] && e[i].tasa, 1);
    }
    return out;
  }

  /* ═══ NÚCLEO ═════════════════════════════════════════════════════════

     Recibe el problema ya traducido a plata: una lista de costos fijos por
     unidad, una lista de cargos porcentuales sobre la venta, el embudo y
     los impuestos. No sabe si es un mueble, una lámpara o un pedido COD en
     Guadalajara.

       fijos:  [ {id, label, monto, etapa} ]   monto YA NETO de IVA
       pct:    [ {id, label, pct,   etapa} ]   fracción de la venta neta

     Devuelve las dos mitades del problema:

       C  — suma de los porcentuales, ya cascadeados. Va al DENOMINADOR.
       K  — suma de los fijos, ya cascadeados. Va al NUMERADOR.

     Con eso, las dos direcciones:

       dado el precio  →  utilidad = p − K − p·C
       dado el margen  →  p = K / (1 − C − m)

     Y la que importa de verdad, despejando K:

       techo de K = p · (1 − C − m)                                     */

  function nucleo(opts) {
    const fijos  = Array.isArray(opts.fijos) ? opts.fijos : [];
    const pcts   = Array.isArray(opts.pct)   ? opts.pct   : [];
    const res    = residuales(opts.embudo);
    const ult    = res.length - 1;

    const etapaOk = (et) => {
      const i = Math.round(num(et, ult));
      return Math.min(Math.max(i, 0), ult);
    };

    const detalle_fijos = fijos
      .filter(f => f && num(f.monto) !== 0)
      .map(f => {
        const i = etapaOk(f.etapa);
        const bruto = num(f.monto);
        return {
          id: f.id, label: f.label,
          base: r2(bruto),
          divisor: res[i],
          costeado: r2(bruto / res[i]),
          recargo: r2(bruto / res[i] - bruto),
        };
      });

    const detalle_pct = pcts
      .filter(p => p && num(p.pct) !== 0)
      .map(p => {
        const i = etapaOk(p.etapa);
        const base = num(p.pct);
        return {
          id: p.id, label: p.label,
          base,
          divisor: res[i],
          costeado: base / res[i],
        };
      });

    const K = detalle_fijos.reduce((a, f) => a + f.costeado, 0);
    const C = detalle_pct.reduce((a, p) => a + p.costeado, 0);

    return { K: r2(K), C, residuales: res, detalle_fijos, detalle_pct };
  }

  /* ── Las dos direcciones del núcleo ──

     `precioPara` es la que está mal en toda planilla que vi. Cuando los
     cargos porcentuales más el margen llegan a 1, no hay precio que
     alcance: cada peso que subís el precio se lo comen los porcentajes.
     No es que el precio sea "muy alto": es que NO EXISTE. Devolver null
     acá es lo que permite que la pantalla lo diga en vez de mostrar un
     número gigante y falso. */

  function precioPara(K, C, m) {
    const denom = 1 - C - m;
    if (denom <= 0) return null;
    return K / denom;
  }

  function utilidadCon(p, K, C) {
    return p - K - p * C;
  }

  /* ═══ TRADUCTOR ARGENTINO ════════════════════════════════════════════
     Toma la ficha como la carga una persona (precios con IVA, tasas en
     porcentaje, el canal por su nombre) y arma las dos listas que el
     núcleo entiende. Acá viven todas las decisiones sobre qué es costo y
     qué no lo es para un RI argentino. */

  function armar(ficha) {
    const f = Object.assign({}, DEFAULTS, ficha || {});
    const canal = CANALES[f.canal] || CANALES.propio;

    const iva_v = num(f.iva_ventas, 0.21);
    const iva_c = num(f.iva_compra, 0.21);
    const neto  = (montoConIva) => num(montoConIva) / (1 + iva_v);

    /* ── Embudo argentino ──
       Una sola transición, y no es la mexicana. Acá se cobra ANTES de
       despachar (Mercado Pago / Tienda Nube), así que la "tasa de entrega"
       del modelo COD no existe. Lo que sí existe, y es obligatorio, es el
       derecho de arrepentimiento de 10 días del art. 34 de la ley 24.240,
       con el flete de vuelta a cargo del vendedor y sin posibilidad de
       renunciar a él. Esa es la tasa de éxito argentina. */
    const d = Math.min(Math.max(num(f.tasa_devolucion), 0), 0.99);
    const S = 1 - d;
    const embudo = [{ id: 'sin_devolucion', tasa: S }];
    /* etapa 0 = despachado; etapa 1 = firme, ya pasaron los 10 días */

    /* ── Costo del producto ──
       Tres correcciones sobre el precio de lista, en este orden:

       1 · IVA. Si el proveedor da factura A y somos RI, el IVA de la
           compra es crédito fiscal: NO es costo. Si no da factura (o
           somos monotributo), queda pegado y sí lo es.

       2 · Merma. De cada 100 unidades compradas, `merma_pct` nunca se
           venden: se rompen, se pierden, quedan obsoletas. El costo de
           esas lo pagan las que sí se venden, así que se DIVIDE. Esto es
           lo que la planilla original multiplica, y por eso subestima.

       3 · Devoluciones. Lo que vuelve y se puede revender no se perdió;
           lo que vuelve roto, sí. Por cada venta firme se consume
           1 + d·(1−r)/S de producto. */
    const lista        = num(f.costo_proveedor);
    const conIvaEnLista = f.costo_incluye_iva !== false;
    const recuperaIva  = f.condicion === 'ri' && f.proveedor_factura_a !== false;
    const costo_base   = conIvaEnLista && recuperaIva ? lista / (1 + iva_c) : lista;

    const merma = Math.min(Math.max(num(f.merma_pct), 0), 0.99);
    const costo_por_merma = costo_base / (1 - merma);

    const rev = Math.min(Math.max(num(f.tasa_reventa_devuelto), 0), 1);
    const mult_devolucion = 1 + (d * (1 - rev)) / (S || 1);
    const costo_producto = costo_por_merma * mult_devolucion;

    /* Costos de entrada: flete del proveedor, despacho, acondicionado.
       Se cargan prorrateados por unidad del lote. Se netean igual que el
       producto si vienen con factura A. */
    const entrada_lote = num(f.costo_entrada_lote);
    const unidades     = Math.max(num(f.unidades_lote, 1), 1);
    const entrada_unit_bruto = entrada_lote / unidades + num(f.costo_entrada_unidad);
    const entrada_unit = recuperaIva ? entrada_unit_bruto / (1 + iva_c) : entrada_unit_bruto;

    /* ── Fijos por unidad ──────────────────────────────────────────── */
    const fijos = [
      /* El producto ya lleva merma y devolución adentro: entra en la etapa
         final para no volver a dividirlo por S. */
      { id: 'producto', label: 'Producto (neto, con merma y devoluciones)', monto: costo_producto, etapa: 1 },
      { id: 'entrada',  label: 'Flete de entrada y acondicionado',          monto: entrada_unit / (1 - merma), etapa: 1 },

      /* Envío de ida: se paga por CADA despacho, incluidos los que van a
         volver. Etapa 0 → se divide por S. */
      { id: 'envio_ida', label: 'Envío al comprador',
        monto: neto(num(f.costo_envio) * num(f.pct_envio_a_cargo, 1)), etapa: 0 },

      /* Envío de vuelta: solo en las devueltas, y lo paga el vendedor
         siempre (art. 34, irrenunciable). Por eso el monto ya viene
         multiplicado por d y entra en la etapa final. */
      { id: 'envio_vuelta', label: 'Envío de devolución (art. 34)',
        monto: neto(num(f.costo_envio_vuelta, num(f.costo_envio))) * d / (S || 1), etapa: 1 },

      { id: 'cargo_fijo', label: 'Cargo fijo del canal',
        monto: neto(num(f.cargo_fijo, canal.cargo_fijo)), etapa: 0 },

      { id: 'empaque', label: 'Empaque y preparación',
        monto: neto(num(f.costo_empaque)), etapa: 0 },

      /* Publicidad pagada por venta (ML Ads, Meta) cuando se factura por
         conversión y no como % del precio. Se paga por cada pedido
         generado, se devuelva o no: etapa 0. */
      { id: 'cpa', label: 'Publicidad por venta (CPA)',
        monto: neto(num(f.cpa)), etapa: 0 },

      { id: 'otros_fijos', label: 'Otros costos por unidad',
        monto: neto(num(f.otros_costos_unidad)), etapa: 1 },
    ];

    /* ── Porcentuales sobre la venta ────────────────────────────────
       Estos son los que NO se pueden sumar al costo. Van al denominador.

       La comisión del canal se cobra al vender y se reintegra si la venta
       se cae: con reintegro total entra en la etapa final (divisor 1); sin
       reintegro, en la etapa 0 (divisor S). El parámetro interpola. */
    const k_reint = Math.min(Math.max(num(f.canal_reintegra_comision, 1), 0), 1);
    const comision = num(f.comision_pct, canal.comision_pct) + num(f.pasarela_pct, canal.pasarela_pct || 0);

    const pct = [
      { id: 'comision', label: 'Comisión del canal',
        pct: comision * (1 + (1 - k_reint) * d / (S || 1)), etapa: 1 },

      { id: 'cuotas', label: 'Costo financiero (cuotas)',
        pct: num(f.cuotas_pct, canal.cuotas_pct), etapa: 1 },

      /* Publicidad: se gasta en toda venta generada, vuelva o no. */
      { id: 'publicidad', label: 'Publicidad (ACOS)',
        pct: num(f.publicidad_pct, canal.publicidad_pct), etapa: 0 },

      /* IIBB: sobre la base neta, y no es recuperable. Costo puro. */
      { id: 'iibb', label: 'Ingresos Brutos', pct: num(f.iibb_pct), etapa: 1 },

      { id: 'deb_cred', label: 'Impuesto al cheque', pct: num(f.deb_cred_pct), etapa: 1 },
    ];

    return {
      f, canal, iva_v, iva_c, embudo, d, S, merma,
      costo_base, costo_producto, mult_devolucion,
      fijos, pct,
      neto,
      recuperaIva,
    };
  }

  /* ═══ CALCULAR ═══════════════════════════════════════════════════════
     La entrada completa → el veredicto completo. Una sola pasada; la
     pantalla no calcula nada, solo lee campos. */

  function calcular(ficha) {
    const A = armar(ficha);
    const f = A.f;
    const n = nucleo({ fijos: A.fijos, pct: A.pct, embudo: A.embudo });

    const precio_bruto = num(f.precio_venta);
    const p = precio_bruto / (1 + A.iva_v);

    const g = f.condicion === 'ri' ? num(f.ganancias_pct) : 0;

    /* Ganancias va DESPUÉS, sobre la utilidad. No es un porcentaje de la
       venta y no puede ir en el denominador con los otros. */
    const utilidad_antes = utilidadCon(p, n.K, n.C);
    const ganancias = utilidad_antes > 0 ? utilidad_antes * g : 0;
    const utilidad = utilidad_antes - ganancias;

    const margen = p > 0 ? utilidad / p : 0;

    /* ROI = sobre la plata que queda inmovilizada en el depósito, no sobre
       el costo total. La comisión de ML no se adelanta: se descuenta de la
       cobranza. Lo que hay que poner de antemano es el producto más el
       flete de entrada, y eso es lo que el ROI tiene que medir. */
    const inversion = A.costo_producto + (n.detalle_fijos.find(x => x.id === 'entrada') || { costeado: 0 }).costeado;
    const roi = inversion > 0 ? utilidad / inversion : 0;

    /* ── Las tres inversas — el ADN de SellerAmp ──────────────────── */

    /* Si el margen objetivo se pide DESPUÉS de Ganancias, hay que
       agrandarlo antes de meterlo en el denominador: para que quede m
       limpio después de pagar g, hace falta m/(1−g) antes. */
    const mObj = num(f.margen_objetivo);
    const mMin = num(f.margen_minimo);
    const post = f.margen_post_ganancias !== false;
    const efectivo = (m) => (post && g < 1 ? m / (1 - g) : m);

    const precio_sugerido_neto = precioPara(n.K, n.C, efectivo(mObj));
    const precio_minimo_neto   = precioPara(n.K, n.C, efectivo(mMin));
    const precio_piso_neto     = precioPara(n.K, n.C, 0);   /* break-even */

    const conIva = (x) => (x === null ? null : r2(x * (1 + A.iva_v)));

    /* Techo de costo: el número héroe. Dado el precio al que se puede
       vender y el margen mínimo aceptable, ¿cuánto es lo máximo que se
       puede pagar por la unidad?

       De p = K/(1−C−m) despejamos K, le sacamos todo lo que no es el
       producto, y le deshacemos las tres correcciones (devolución, merma,
       IVA) para volver al precio de lista del proveedor, que es el número
       que está escrito en la lista que tenés en la mano. */
    const K_max = p > 0 ? p * (1 - n.C - efectivo(mMin)) : null;
    const otros_fijos = n.K - (n.detalle_fijos.find(x => x.id === 'producto') || { costeado: 0 }).costeado;
    let techo_costo = null;
    if (K_max !== null && K_max > otros_fijos) {
      const producto_max = K_max - otros_fijos;               /* costo ya con merma y devolución */
      let base = producto_max / (A.mult_devolucion || 1);     /* saco devoluciones */
      base = base * (1 - A.merma);                            /* saco merma */
      if (A.recuperaIva && f.costo_incluye_iva !== false) base = base * (1 + A.iva_c);
      techo_costo = r2(base);
    }

    /* CPA máximo: cuánto se puede pagar por traer una venta de afuera
       (ML Ads, Meta) sin bajar del margen mínimo.

       No es "la utilidad": si me gasto toda la utilidad en publicidad
       trabajo gratis. Es lo que sobra por encima del piso. Y como la
       publicidad se paga por cada venta GENERADA — también por las que
       después se devuelven — hay que multiplicar por S al final, que es
       el mismo divisor de la cascada visto al revés.

         (utilidad_antes − x/S) · (1−g) ≥ p · m_min
         x ≤ S · ( utilidad_antes − p·m_min/(1−g) )                      */
    const piso_utilidad_antes = (post && g >= 1) ? Infinity : p * efectivo(mMin);
    const cpa_max_venta = (p > 0 && utilidad_antes > piso_utilidad_antes)
      ? r2((n.residuales[0] || 1) * (utilidad_antes - piso_utilidad_antes))
      : 0;
    /* Por lead/clic: si de cada 100 visitas compran `conv`, el techo por
       visita es el techo por venta multiplicado por esa tasa. */
    const cpa_max_con_iva = r2(cpa_max_venta * (1 + A.iva_v));
    const conv = num(f.tasa_conversion, 0);
    const cpa_max_lead = conv > 0 ? r2(cpa_max_con_iva * conv) : null;

    /* ── Los tres ROAS de referencia ──────────────────────────────
       Mismo despeje, otra unidad. En vez de "cuánto puedo pagar por la
       venta" contestan "cuánto ingreso tengo que traer por cada peso de
       publicidad", que es el número que muestra el panel de ML.

       Ojo con la publicidad que la ficha ya declara como porcentaje: está
       adentro de C, así que hay que devolverla antes de despejar. El ROAS
       del panel se mide sobre el gasto TOTAL de la campaña, no sobre lo
       que gaste de más por encima de un ACOS ya presupuestado. Sin este
       reintegro, una ficha con 8% de publicidad da un objetivo cinco veces
       más alto del real — y el error va justo en la dirección que te hace
       apagar campañas que estaban bien.                                   */
    const pubRow = n.detalle_pct.find(x => x.id === 'publicidad');
    const u_sin_ads = utilidad_antes + p * (pubRow ? pubRow.costeado : 0);
    const res0 = n.residuales[0] || 1;
    const gastoPara = (pisoAntes) =>
      (p > 0 && u_sin_ads > pisoAntes) ? r2(res0 * (u_sin_ads - pisoAntes)) : 0;

    const gasto_ads_equilibrio = gastoPara(0);
    const gasto_ads_maximo     = gastoPara(piso_utilidad_antes);
    const gasto_ads_objetivo   = gastoPara(p * efectivo(mObj));

    /* bruto sobre neto: la mezcla exacta del panel de ML. Ver el bloque
       de campañas más abajo para por qué. */
    const roasDe = (gasto) => (gasto > 0 && precio_bruto > 0) ? r2(precio_bruto / gasto) : null;

    /* Cuánto le falta al producto para bancar un peso de publicidad.
       Sin esto, "no hay ROAS posible" no distingue estar a dos pesos del
       piso de estar quebrado, y son dos decisiones distintas. */
    const faltante_para_publicar = (p > 0 && u_sin_ads <= piso_utilidad_antes)
      ? r2(piso_utilidad_antes - u_sin_ads) : 0;

    /* ── Veredicto ──────────────────────────────────────────────────
       Cuatro estados, no tres. El gris es el que falta en todas las
       planillas y es el más importante: "no sé" no es "sí". Si falta un
       dato que mueve el resultado, el semáforo no puede dar verde. */
    const faltantes = [];
    if (!(precio_bruto > 0))        faltantes.push('Precio de venta');
    if (!(num(f.costo_proveedor) > 0)) faltantes.push('Costo del proveedor');
    if (f.costo_envio === undefined || f.costo_envio === null || f.costo_envio === '')
      faltantes.push('Costo de envío');
    if (!f.canal) faltantes.push('Canal de venta');

    const alertas = [];
    if (n.C + efectivo(mMin) >= 1) {
      alertas.push({
        nivel: 'rojo',
        texto: `Los cargos sobre la venta suman ${(n.C * 100).toFixed(1)}%. Con el margen mínimo pedido no existe ningún precio que cierre — subir el precio sube los cargos igual de rápido.`,
      });
    }
    if (A.d > 0.15) {
      alertas.push({ nivel: 'ambar', texto: `Devoluciones al ${(A.d * 100).toFixed(0)}%: cada venta firme está pagando ${r2(1 / A.S * 100 - 100)}% de envíos de más.` });
    }
    if (f.condicion === 'ri' && f.proveedor_factura_a === false) {
      alertas.push({ nivel: 'ambar', texto: 'El proveedor no da factura A: el IVA de la compra deja de ser crédito fiscal y pasa a ser costo. Son 21 puntos sobre el costo.' });
    }
    if (A.canal._supuesto) {
      alertas.push({ nivel: 'gris', texto: `La comisión de ${A.canal.label} es un supuesto, no está verificada contra tu cuenta. Confirmala en la publicación real antes de comprar.` });
    }
    if (techo_costo !== null && num(f.costo_proveedor) > 0 && num(f.costo_proveedor) > techo_costo) {
      alertas.push({ nivel: 'rojo', texto: `El proveedor pide ${r2(num(f.costo_proveedor))} y el techo es ${techo_costo}. Hay que negociar ${r2(num(f.costo_proveedor) - techo_costo)} o subir el precio.` });
    }

    let veredicto;
    if (faltantes.length)                              veredicto = 'gris';
    else if (precio_sugerido_neto === null)            veredicto = 'rojo';
    else if (utilidad <= 0 || margen < mMin)           veredicto = 'rojo';
    else if (margen < mObj
          || utilidad < num(f.utilidad_minima_unidad)
          || roi < num(f.roi_minimo))                  veredicto = 'ambar';
    else                                               veredicto = 'verde';

    return {
      veredicto, faltantes, alertas,

      /* el número héroe */
      techo_costo,

      /* la venta */
      precio_bruto: r2(precio_bruto),
      precio_neto:  r2(p),
      iva_debito:   r2(precio_bruto - p),

      /* los costos, ya cascadeados */
      costos_totales: n.K,
      cargos_pct:     n.C,
      detalle_fijos:  n.detalle_fijos,
      detalle_pct:    n.detalle_pct,

      /* el resultado */
      utilidad_antes_impuesto: r2(utilidad_antes),
      ganancias: r2(ganancias),
      utilidad:  r2(utilidad),
      margen,
      roi,
      inversion: r2(inversion),

      /* las inversas */
      precio_sugerido: conIva(precio_sugerido_neto),
      precio_minimo:   conIva(precio_minimo_neto),
      precio_piso:     conIva(precio_piso_neto),
      descuento_maximo: (precio_bruto > 0 && precio_piso_neto !== null)
        ? Math.max(0, 1 - (precio_piso_neto * (1 + A.iva_v)) / precio_bruto)
        : null,
      cpa_maximo: cpa_max_venta,              /* neto, para comparar contra la utilidad */
      cpa_maximo_con_iva: cpa_max_con_iva,    /* el que se tipea en el panel de anuncios */
      cpa_maximo_lead: cpa_max_lead,

      /* publicidad, en las unidades del panel de Mercado Libre */
      roas_equilibrio: roasDe(gasto_ads_equilibrio),
      roas_minimo:     roasDe(gasto_ads_maximo),
      roas_objetivo:   roasDe(gasto_ads_objetivo),
      gasto_ads_equilibrio, gasto_ads_maximo, gasto_ads_objetivo,
      acos_maximo: gasto_ads_maximo > 0 && precio_bruto > 0
        ? gasto_ads_maximo / precio_bruto : null,
      margen_contribucion: precio_bruto > 0 ? (res0 * u_sin_ads) / precio_bruto : 0,
      faltante_para_publicar,

      /* para auditar la cuenta a mano */
      _debug: {
        S: A.S, d: A.d, merma: A.merma,
        mult_devolucion: A.mult_devolucion,
        costo_base: r2(A.costo_base),
        costo_producto: r2(A.costo_producto),
        otros_fijos: r2(otros_fijos),
        margen_efectivo_objetivo: efectivo(mObj),
        residuales: n.residuales,
      },
    };
  }

  /* ═══ LOTE ═══════════════════════════════════════════════════════════
     El riesgo real de esta herramienta no es que la cuenta esté mal: es
     que nadie la use. Cargar 40 productos de a uno no lo hace nadie dos
     veces. Por eso la carga de una lista entera está desde el día uno y no
     en la v2.

     Recibe filas ya parseadas (del Excel del proveedor) más la
     configuración común, y devuelve cada fila con su veredicto. Ordenado:
     lo verde primero, que es lo que hay que comprar. */

  /* Estos cuatro campos son del producto, nunca de la configuración. Si la
     config los trajera, una fila a la que le falta el precio heredaría el
     precio de otra y saldría con un veredicto firme y equivocado: verde
     grande, número redondo, producto que nadie coteó. Un dato faltante que
     se disfraza de dato bueno es peor que la pantalla en blanco, porque
     nadie lo reporta. Se borran antes de mezclar. */
  const SOLO_DEL_PRODUCTO = ['costo_proveedor', 'precio_venta', 'sku', 'nombre'];

  function calcularLote(filas, config) {
    const base = Object.assign({}, config || {});
    for (const k of SOLO_DEL_PRODUCTO) delete base[k];
    return (Array.isArray(filas) ? filas : []).map((fila, i) => {
      const ficha = Object.assign({}, base, fila);
      let res;
      try {
        res = calcular(ficha);
      } catch (e) {
        res = { veredicto: 'gris', faltantes: ['Fila ilegible'], alertas: [], _error: String(e && e.message || e) };
      }
      return Object.assign({ _fila: i, sku: fila.sku, nombre: fila.nombre }, res);
    });
  }

  function resumenLote(resultados) {
    const r = Array.isArray(resultados) ? resultados : [];
    const cuenta = { verde: 0, ambar: 0, rojo: 0, gris: 0 };
    let utilidad_total = 0, inversion_total = 0;
    for (const x of r) {
      cuenta[x.veredicto] = (cuenta[x.veredicto] || 0) + 1;
      if (x.veredicto === 'verde' || x.veredicto === 'ambar') {
        utilidad_total  += num(x.utilidad);
        inversion_total += num(x.inversion);
      }
    }
    return {
      total: r.length,
      ...cuenta,
      utilidad_total: r2(utilidad_total),
      inversion_total: r2(inversion_total),
      roi_cartera: inversion_total > 0 ? utilidad_total / inversion_total : 0,
    };
  }

  /* ══════════════════════════════════════════════════════════════════
     CAMPAÑAS — el mismo despeje, del otro lado             (0177-b · ML)

     Todo lo de arriba contesta "cuánto puedo pagar por el producto".
     Esto contesta "cuánto puedo pagar por la venta". Es la misma
     ecuación; cambia qué se despeja.

     ── Por qué el ROAS objetivo no se escribe a mano ──
     Si el objetivo se tipea, alguien le pone 5x a un producto que
     necesita 6,7x, y entonces una campaña que "le gana al objetivo por
     30%" pierde plata igual, con la fila pintada de verde. Ese es el
     modo de falla que este bloque existe para hacer imposible: el
     objetivo sale del costo real del producto o no sale.

     ── UNIDADES: acá se rompe todo si se ignora ──
     El panel de Publicidad de Mercado Libre mezcla dos unidades y lo
     dice en su propio glosario:

       Inversión → SIN IVA · "No incluye IVA, se agrega directo en tu
                   factura"
       Ingresos  → CON IVA · es la sumatoria del precio publicado, sin
                   envío y antes de comisión

     Así que el ROAS del panel es bruto sobre neto. El objetivo tiene que
     estar en la MISMA mezcla o queda corrido 21%, que es más que
     cualquier desvío que se quiera medir. Por eso acá va
     precio_bruto / gasto_neto y no neto/neto.

     Y para un Responsable Inscripto el IVA de la factura de publicidad
     es crédito fiscal, no costo: el neto del panel ya es el costo real.
     Cargarle 21% encima sería contarlo dos veces.

     ── Y por qué hay estadística acá ──
     Con pocas ventas atribuidas el ROAS medido es ruido. Una campaña con
     3 ventas y ROAS 2x puede ser, sin nada raro, la misma campaña que
     otra con 8x. Pintarla de rojo es inventar un dato. Por eso el
     veredicto no compara el ROAS medido contra el umbral: compara el
     INTERVALO del ROAS verdadero, y cuando el intervalo cruza el umbral
     devuelve gris, que es el estado honesto.                            */

  /* Ventana de atribución de ML: 14 días post-clic + 1 post-impresión,
     last-click, no configurable. Una ventana que cerró hace menos que
     esto todavía está recibiendo ventas: colorearla es sesgo, no ruido,
     y ningún intervalo de confianza lo corrige. */
  const DIAS_ATRIBUCION_ML = 14;

  /* Función error, para la cola normal cuando λ es grande. A&S 7.1.26. */
  function erf(x) {
    const s = x < 0 ? -1 : 1;
    const a = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * a);
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t
                    - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
    return s * y;
  }

  /* P(X ≤ k) para un Poisson de media λ. */
  function poissonCDF(k, lam) {
    if (!(lam > 0)) return 1;
    if (k < 0) return 0;
    /* Arriba de ~400, exp(−λ) se hace cero en doble precisión y la suma
       devuelve 0 en vez de la probabilidad. Ahí la normal ya es exacta
       a más decimales de los que nos importan. */
    if (lam > 400) return 0.5 * (1 + erf((k + 0.5 - lam) / Math.sqrt(2 * lam)));
    let t = Math.exp(-lam), s = t;
    for (let i = 1; i <= k; i++) { t *= lam / i; s += t; }
    return s > 1 ? 1 : s;
  }

  /* Cotas del número de ventas verdadero a partir de las n observadas,
     cada lado al 95%. Son las de Poisson exactas, resueltas por bisección
     en vez de con una tabla, para que valgan también con n grande.

     ventasBajo(n): el λ más alto que todavía deja P(X ≤ n−1) = 0,95
     ventasAlto(n): el λ más bajo que todavía deja P(X ≤ n)   = 0,05

     Con n=0, ventasAlto da 2,996 = −ln(0,05). O sea: cero ventas no es
     "no sé". Si además se gastó plata, es la evidencia MÁS fuerte que
     existe de que la campaña no convierte. */
  function ventasBajo(n) {
    if (!(n > 0)) return 0;
    let lo = 0, hi = n + 10 * Math.sqrt(n) + 10;
    for (let i = 0; i < 70; i++) {
      const mid = (lo + hi) / 2;
      if (poissonCDF(n - 1, mid) > 0.95) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }
  function ventasAlto(n) {
    const k = n > 0 ? n : 0;
    let lo = 0, hi = k + 10 * Math.sqrt(k + 1) + 10;
    for (let i = 0; i < 70; i++) {
      const mid = (lo + hi) / 2;
      if (poissonCDF(k, mid) > 0.05) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /* ── Diagnóstico de una campaña ────────────────────────────────────
     `campania` son los números que se copian del panel de ML.
     `ref` es el resultado de calcular() del producto que se publicita:
     de ahí salen los tres ROAS de referencia. Sin ref no hay veredicto,
     solo descripción — y eso es exactamente lo que devuelve.             */
  function diagnosticarCampania(campania, ref) {
    const c = campania || {};
    const R = ref || {};
    const faltantes = [];
    const alertas   = [];

    const iva = (R.precio_neto > 0 && R.precio_bruto > 0)
      ? (R.precio_bruto / R.precio_neto - 1) : 0.21;

    /* Normalizo a la mezcla del panel: ingresos brutos, inversión neta.
       Los dos flags existen porque la definición de "Ingresos" está
       publicada en la página de atribución de ML, no en el glosario del
       panel de Product Ads. Es alta confianza, no certeza: el dueño
       tiene que poder declarar lo contrario en vez de comerse un
       supuesto mío hardcodeado. */
    let inv = num(c.inversion, 0);
    let ing = num(c.ingresos, 0);
    if (c.inversion_con_iva === true) inv = inv / (1 + iva);
    if (c.ingresos_con_iva === false) ing = ing * (1 + iva);

    const nv        = Math.max(0, Math.round(num(c.ventas, 0)));
    const nv_org    = num(c.ventas_sin_ads, 0);
    const ing_org   = num(c.ingresos_sin_ads, 0);
    const nv_indir  = num(c.ventas_indirectas, 0);

    if (!(inv > 0))                faltantes.push('Inversión');
    if (!(ing > 0) && !(nv === 0)) faltantes.push('Ingresos');
    if (c.ventas === undefined || c.ventas === null || c.ventas === '')
      faltantes.push('Ventas por publicidad');

    const roas  = inv > 0 ? r2(ing / inv) : null;
    const acos  = (roas && roas > 0) ? r2(1 / roas) : null;
    const cpa   = nv > 0 ? r2(inv / nv) : null;
    const ticket = nv > 0 ? r2(ing / nv) : null;

    /* El intervalo del ROAS verdadero. El ROAS escala con la cantidad de
       ventas, así que la incertidumbre del conteo se traslada tal cual.
       Se mide sobre el conteo y no sobre el ROAS directamente porque ahí
       la varianza del ticket no interviene. */
    const fBajo = nv > 0 ? ventasBajo(nv) / nv : 0;
    const fAlto = nv > 0 ? ventasAlto(nv) / nv : Infinity;
    let roas_bajo = null, roas_alto = null;
    if (inv > 0 && nv > 0) {
      roas_bajo = r2(roas * fBajo);
      roas_alto = r2(roas * fAlto);
    } else if (inv > 0 && nv === 0) {
      /* Cero ventas no deja calcular un ticket, pero sí una cota: como
         mucho podrían haber entrado ventasAlto(0) = 2,996 ventas del
         producto de referencia. Sin esto el caso más concluyente que
         existe —gastar mucho y no vender nada— quedaría sin veredicto. */
      roas_bajo = 0;
      roas_alto = R.precio_bruto > 0 ? r2(R.precio_bruto * ventasAlto(0) / inv) : null;
    }

    /* Contribución en pesos: la única variable con la que se decide.
       Un ROAS más bajo con más ganancia total es un éxito, y un ratio
       no lo puede decir. */
    const mc = num(R.margen_contribucion, 0);
    const contribucion = (ing > 0 && mc > 0) ? r2(ing * mc) : 0;
    const ganancia = inv > 0 ? r2(contribucion - inv) : null;

    const eq  = R.roas_equilibrio;
    const min = R.roas_minimo;
    const obj = R.roas_objetivo;
    const hayRef = Number.isFinite(eq) && eq > 0;
    const umbral_verde = Number.isFinite(obj) && obj > 0 ? obj
                       : (Number.isFinite(min) && min > 0 ? min : null);

    if (!hayRef) faltantes.push('Producto de referencia');

    /* Ventana caliente: ML sigue atribuyendo hasta 14 días después del
       clic. Un período que cerró ayer está incompleto hacia abajo, y el
       sesgo va siempre en la misma dirección — hacia el rojo. */
    const dias = c.dias_desde_fin;
    const caliente = dias !== undefined && dias !== null && dias !== ''
      && num(dias, 99) < DIAS_ATRIBUCION_ML;

    let veredicto, estado, decision;

    if (faltantes.length) {
      veredicto = 'gris';
      estado    = 'Falta un dato';
      decision  = 'Completar: ' + faltantes.join(', ').toLowerCase();
    } else if (caliente) {
      veredicto = 'gris';
      estado    = 'Ventana abierta';
      decision  = `Esperar ${Math.max(0, DIAS_ATRIBUCION_ML - Math.round(num(dias, 0)))} días más`;
      alertas.push({ nivel: 'gris', texto:
        `Este período cerró hace ${Math.round(num(dias, 0))} días y ML atribuye hasta ${DIAS_ATRIBUCION_ML} ` +
        'días después del clic. Todavía le faltan ventas por entrar, así que el ROAS que ves ' +
        'está bajo de verdad. No es ruido: es sesgo, y siempre hacia el rojo.' });
    } else if (roas_alto !== null && roas_alto < eq) {
      veredicto = 'rojo';
      estado    = 'No funcional';
      decision  = 'Apagar y rehacer';
    } else if (nv === 0) {
      /* Llegar acá con cero ventas significa que todavía no se gastó lo
         suficiente como para que "no vendió nada" quiera decir algo. El
         umbral es la inversión a la que ni 2,996 ventas del producto de
         referencia alcanzarían para empatar. */
      veredicto = 'gris';
      estado    = 'Sin evidencia';
      const umbral = R.precio_bruto > 0 && eq > 0
        ? Math.ceil(R.precio_bruto * ventasAlto(0) / eq) : null;
      decision = umbral ? `Gastar hasta ${umbral} o apagar` : 'Seguir midiendo';
    } else if (roas_bajo !== null && umbral_verde && roas_bajo >= umbral_verde) {
      veredicto = 'verde';
      estado    = 'Muy eficiente';
      decision  = 'Escalar';
    } else if (roas_bajo !== null && roas_bajo >= eq) {
      veredicto = 'ambar';
      estado    = roas >= (min || eq) ? 'Eficiente' : 'Ineficiente moderada';
      decision  = 'Optimizar antes de escalar';
    } else {
      veredicto = 'gris';
      estado    = 'Sin evidencia';
      decision  = 'Seguir midiendo';
    }

    /* ¿Cuántas ventas harían falta para que este mismo ROAS alcance para
       un veredicto firme? Es la única pregunta útil frente a un gris:
       ¿espero o apago? Sin este número, "seguir midiendo" es una forma
       educada de no decir nada. */
    let ventas_para_firmeza = null;
    if (veredicto === 'gris' && nv > 0 && !faltantes.length && !caliente && roas !== null && hayRef) {
      for (let k = Math.max(1, nv); k <= 5000; k++) {
        const f = ventasBajo(k) / k;
        const arriba = roas * f >= (umbral_verde || eq);   /* confirma verde */
        const gana   = roas * f >= eq;                     /* confirma ámbar */
        const abajo  = roas * (ventasAlto(k) / k) < eq;    /* confirma rojo  */
        if (arriba || gana || abajo) { ventas_para_firmeza = k; break; }
      }
    }

    /* ── Canibalización ──
       "Ventas sin Product Ads" es el nombre literal de la columna de ML
       y es el dato que delata el problema: si la publicación ya vendía
       sola, parte de lo que ML te atribuye iba a pasar igual. No se puede
       DIAGNOSTICAR con los datos del panel — solo se puede advertir. La
       única prueba concluyente es apagar 14 días y mirar el total. Decir
       más que eso sería inventar un número. */
    const cargoVentasOrg = c.ventas_sin_ads !== undefined
      && c.ventas_sin_ads !== null && c.ventas_sin_ads !== '';
    const ventas_totales = nv + nv_org;
    const share_organica = (cargoVentasOrg && ventas_totales > 0) ? nv_org / ventas_totales : null;
    const tacos = (ing + ing_org) > 0 && inv > 0 ? r2(inv / (ing + ing_org)) : null;

    if (share_organica !== null && share_organica >= 0.4 && (veredicto === 'verde' || veredicto === 'ambar')) {
      alertas.push({ nivel: 'ambar', texto:
        `El ${Math.round(share_organica * 100)}% de las ventas de esta publicación entró sin publicidad. ` +
        'Parte de lo que ML te atribuye iba a pasar igual, así que el ROAS real es más bajo que este. ' +
        'La única forma de saber cuánto es apagarla 14 días y comparar el total, no el atribuido.' });
    }
    if (nv > 0 && nv_indir / nv >= 0.4) {
      alertas.push({ nivel: 'ambar', texto:
        `${Math.round(nv_indir / nv * 100)}% de las ventas son indirectas: el anuncio de este producto ` +
        'vendió otro. El ROAS de esta fila es prestado, y el techo de costo contra el que lo comparás ' +
        'es el de este producto, no el del que se vendió.' });
    }
    const cargoOrganico = c.ingresos_sin_ads !== undefined
      && c.ingresos_sin_ads !== null && c.ingresos_sin_ads !== '';
    if (cargoOrganico && tacos !== null && acos !== null && tacos > 0
        && acos / tacos < 1.05 && veredicto !== 'gris') {
      alertas.push({ nivel: 'gris', texto:
        `TACOS ${revPctMotor(tacos)} contra ACOS ${revPctMotor(acos)}: la publicación casi no vende ` +
        'sola, todo pasa por la publicidad. No hay orgánico que se esté canibalizando, pero tampoco ' +
        'hay red abajo: el día que apagues la campaña, las ventas van a cero.' });
    }

    /* Una sola venta que explica casi todo el ingreso no es un promedio,
       es un pedido con maquillaje de estadística. */
    if (nv > 0 && nv <= 3 && ticket !== null && R.precio_bruto > 0 && ticket > R.precio_bruto * 1.8) {
      alertas.push({ nivel: 'ambar', texto:
        'El ticket promedio de esta campaña es mucho más alto que el precio del producto de ' +
        'referencia y son muy pocas ventas: probablemente haya un pedido grande solo que está ' +
        'sosteniendo todo el ROAS.' });
    }

    if (veredicto === 'verde' && hayRef) {
      alertas.push({ nivel: 'verde', texto:
        'Escalá de a escalones de ~15% del presupuesto diario, uno por vez, y volvé a medir recién ' +
        `después de ${DIAS_ATRIBUCION_ML} días. Saltos grandes reinician el aprendizaje de la subasta y ` +
        'te borran la comparación con el período anterior. El ROAS baja al escalar: la señal de frenar ' +
        'es que la contribución en pesos deje de subir, no que el ROAS deje de ser lindo.' });
    }

    return {
      nombre: c.nombre || '', id: c.id,
      inversion: r2(inv), ingresos: r2(ing), ventas: nv,
      roas, acos, cpa, ticket,
      roas_bajo, roas_alto,
      roas_equilibrio: hayRef ? eq : null,
      roas_minimo: hayRef ? min : null,
      roas_objetivo: hayRef ? obj : null,
      umbral_verde: hayRef ? umbral_verde : null,
      contribucion, ganancia,
      tacos, share_organica,
      escalon_sugerido: veredicto === 'verde' && inv > 0 ? r2(inv * 0.15) : null,
      ventas_para_firmeza,
      veredicto, estado, decision,
      faltantes, alertas,
    };
  }

  /* Porcentaje corto, solo para los textos de alerta del motor. */
  function revPctMotor(x) { return (Number(x) * 100).toFixed(1).replace('.', ',') + '%'; }

  function diagnosticarCampanias(lista, ref) {
    const filas = Array.isArray(lista) ? lista : [];
    return filas.map((c, i) => {
      try {
        return Object.assign({ _fila: i }, diagnosticarCampania(c, ref));
      } catch (e) {
        return {
          _fila: i, nombre: (c && c.nombre) || '', veredicto: 'gris',
          estado: 'Fila ilegible', decision: 'Revisar los datos',
          faltantes: ['Fila ilegible'], alertas: [], _error: String(e && e.message || e),
        };
      }
    });
  }

  function resumenCampanias(resultados) {
    const rs = Array.isArray(resultados) ? resultados : [];
    const out = {
      total: rs.length, verde: 0, ambar: 0, rojo: 0, gris: 0,
      inversion_total: 0, ingresos_total: 0, ganancia_total: 0, roas_cartera: null,
    };
    for (const r of rs) {
      if (out[r.veredicto] !== undefined) out[r.veredicto]++;
      out.inversion_total += num(r.inversion, 0);
      out.ingresos_total  += num(r.ingresos, 0);
      /* La ganancia suma también la negativa: una cartera donde las rojas
         no restan es una cartera que miente. */
      out.ganancia_total  += num(r.ganancia, 0);
    }
    out.inversion_total = r2(out.inversion_total);
    out.ingresos_total  = r2(out.ingresos_total);
    out.ganancia_total  = r2(out.ganancia_total);
    out.roas_cartera = out.inversion_total > 0 ? r2(out.ingresos_total / out.inversion_total) : null;
    return out;
  }

  /* ── Export ──
     Un solo objeto en window, para no chocar con nada. Todos los .jsx del
     bundle comparten un scope léxico, así que el archivo entero va dentro
     de esta IIFE: no hay ni un nombre suelto arriba de todo. */
  const API = {
    DEFAULTS, CANALES,
    calcular, calcularLote, resumenLote,
    nucleo, residuales, precioPara, utilidadCon, armar,
    diagnosticarCampania, diagnosticarCampanias, resumenCampanias,
    ventasBajo, ventasAlto, poissonCDF, DIAS_ATRIBUCION_ML,
    r2,
  };

  if (typeof window !== 'undefined') window.SELLER = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
