/* ══ PRESUPUESTO B2B EN PDF (window.B2B_PDF) ═════════════════════════════
   Dos documentos a partir del mismo pedido:

     · presupuesto(...)  → el que ve EL CLIENTE. Precios netos, IVA aparte,
       total con IVA, y los datos para transferir.
     · produccion(...)   → el que baja ADMINISTRACION y pasa a la planta.
       SKU, modelo, color y cantidad. SIN UN SOLO PRECIO: esa hoja termina en
       el taller y ahi no tiene por que estar lo que paga el cliente.

   ⚠ Este archivo lo cargan LAS DOS apps, igual que b2b-data.js:
     · el panel interno, por components/b2b-presupuesto-pdf.js
     · la tienda del cliente, por /components/b2b-presupuesto-pdf.js
   O sea que lo ve el cliente: nada de logica de administracion ni secretos.

   Por eso tambien es AUTOCONTENIDO. La tienda no carga data.js, asi que no
   existen alla window.pdfMakeMakarioHeader ni normalizeCompanySettings: el
   membrete se dibuja acá, con el mismo diseño, para que el PDF salga igual
   desde los dos lados.

   Y por eso pdfmake se carga A PEDIDO. El panel ya lo trae en el <head>
   (son ~2 MB entre la libreria y las fuentes) pero la tienda a proposito no
   carga nada de eso: el mayorista entra desde el celular con datos y no
   tiene por que bajar dos megas para mirar el catalogo. Se baja recien
   cuando aprieta "Descargar presupuesto", una vez por sesion.
   ═══════════════════════════════════════════════════════════════════════ */

window.B2B_PDF = window.B2B_PDF || (function () {

  const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/';
  const GRIS = '#666666';
  const GRIS_CLARO = '#f5f5f5';

  /* ── Cargar pdfmake cuando hace falta ──────────────────────────────────
     vfs_fonts va DESPUES de pdfmake.min.js y no se puede paralelizar: se
     cuelga de window.pdfMake para registrar las fuentes. Sin el, pdfmake
     tira "File 'Roboto-Regular.ttf' not found in virtual file system".
     Se guarda la promesa (no un booleano) para que dos clicks seguidos
     esperen la misma carga en vez de disparar dos. */
  let cargando = null;

  function unScript(src) {
    return new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = function () { resolve(); };
      s.onerror = function () {
        s.remove();
        reject(new Error('No pudimos cargar el generador de PDF. Fijate la conexion y probá de nuevo.'));
      };
      document.head.appendChild(s);
    });
  }

  function listo() {
    return !!(window.pdfMake && window.pdfMake.createPdf && window.pdfMake.vfs);
  }

  function cargarPdfMake() {
    if (listo()) return Promise.resolve();
    if (cargando) return cargando;
    cargando = unScript(CDN + 'pdfmake.min.js')
      .then(function () { return unScript(CDN + 'vfs_fonts.min.js'); })
      .then(function () {
        if (!listo()) throw new Error('No pudimos cargar el generador de PDF. Probá recargar la página.');
      })
      .catch(function (e) {
        /* Si fallo, la proxima vez se vuelve a intentar: puede haber sido
           un tunel o el wifi del local, no algo permanente. */
        cargando = null;
        throw e;
      });
    return cargando;
  }

  /* ── Formato ──────────────────────────────────────────────────────── */
  function money(n) {
    const v = Number(n);
    if (!isFinite(v)) return '$ 0,00';
    return (v < 0 ? '-' : '') + '$ ' + Math.abs(v)
      .toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fecha(s) {
    if (!s) return '—';
    const str = String(s).slice(0, 10);
    const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? (m[3] + '/' + m[2] + '/' + m[1]) : str;
  }

  function hoy() {
    const d = new Date();
    const p = function (n) { return String(n).padStart(2, '0'); };
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
  }

  /* Para el nombre del archivo: sin tildes, sin ñ, sin espacios. Un nombre
     con acentos se baja distinto segun el navegador y en Windows a veces
     queda con caracteres raros. */
  function slug(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i')
      .replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u').replace(/ñ/g, 'n')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'pedido';
  }

  /* ── Membrete ─────────────────────────────────────────────────────────
     Copia deliberada de pdfMakeMakarioHeader (data.js). No se reusa aquel
     porque la tienda no carga data.js; se mantienen iguales a mano. */
  function logo(main) {
    const m = main || 16;
    return {
      stack: [
        { text: [{ text: 'JUSTO', bold: true },
                 { text: '  ®', bold: false, fontSize: Math.max(6, Math.round(m * 0.42)) }],
          bold: true, fontSize: m, margin: [0, 0, 0, -1] },
        { text: 'MAKARIO', bold: true, fontSize: m, margin: [0, 0, 0, 1] },
        { text: 'Home', italics: true, fontSize: Math.round(m * 0.62) },
      ],
    };
  }

  function membrete(emisor) {
    const e = emisor || {};
    const lineas = [];
    if (e.cuit) lineas.push('CUIT ' + e.cuit);
    if (e.domicilio) lineas.push(e.domicilio);
    const geo = [e.ciudad, e.provincia, e.codigo_postal ? '(' + e.codigo_postal + ')' : '']
      .filter(Boolean).join(', ');
    if (geo) lineas.push(geo);
    const cont = [e.telefono ? 'Tel: ' + e.telefono : '', e.email || ''].filter(Boolean).join(' · ');
    if (cont) lineas.push(cont);

    if (!lineas.length) return Object.assign(logo(16), { margin: [0, 0, 0, 6] });
    return {
      columns: [
        { width: 92, stack: [logo(16)] },
        { width: '*', margin: [0, 3, 0, 0],
          stack: lineas.map(function (t) {
            return { text: t, fontSize: 8, color: GRIS, margin: [0, 0, 0, 1] };
          }) },
      ],
      columnGap: 16,
      margin: [0, 0, 0, 6],
    };
  }

  const raya = {
    canvas: [{ type: 'line', x1: 0, y1: 5, x2: 515, y2: 5, lineWidth: 0.5, lineColor: GRIS }],
    margin: [0, 4, 0, 10],
  };

  /* Dos columnas de "Etiqueta: valor". Las filas vacias se caen solas para
     que no queden guiones sueltos cuando el pedido no trajo el dato. */
  function fichaDatos(pares) {
    const filas = pares.filter(function (p) { return p && p[1]; });
    if (!filas.length) return null;
    const cuerpo = [];
    for (let i = 0; i < filas.length; i += 2) {
      cuerpo.push([
        { text: [{ text: filas[i][0] + ': ', bold: true }, String(filas[i][1])], fontSize: 9 },
        filas[i + 1]
          ? { text: [{ text: filas[i + 1][0] + ': ', bold: true }, String(filas[i + 1][1])], fontSize: 9 }
          : { text: '' },
      ]);
    }
    return {
      table: { widths: ['*', '*'], body: cuerpo },
      layout: 'noBorders',
      margin: [0, 0, 0, 10],
    };
  }

  /* ── Cuentas ──────────────────────────────────────────────────────────
     El IVA se recalcula linea por linea con el iva_pct congelado en el
     pedido en vez de aplicarle 21% al total: si algun dia hay un producto
     con otra alicuota, el total del PDF tiene que seguir dando lo mismo que
     el de la pantalla. total_con_iva del backend manda cuando viene. */
  function totales(pedido) {
    const items = Array.isArray(pedido.items) ? pedido.items : [];
    let neto = 0, iva = 0, unidades = 0;
    const alicuotas = {};
    items.forEach(function (it) {
      const sub = Number(it.subtotal) || 0;
      const pct = Number(it.iva_pct);
      const p = isFinite(pct) ? pct : 21;
      neto += sub;
      iva += sub * p / 100;
      unidades += Number(it.cantidad) || 0;
      alicuotas[p] = true;
    });
    /* El total que congelo el backend manda sobre la suma de las lineas: es
       el que vio el cliente cuando confirmo y el que figura en el sistema. */
    if (pedido.total_neto != null && isFinite(Number(pedido.total_neto))) {
      neto = Number(pedido.total_neto);
    }
    let conIva = neto + iva;
    if (pedido.total_con_iva != null && isFinite(Number(pedido.total_con_iva))) {
      conIva = Number(pedido.total_con_iva);
      iva = conIva - neto;
    }
    const pcts = Object.keys(alicuotas);
    /* El tilde del carrito (0170). Sin IVA no se emite factura y lo que se
       cobra es el neto; el IVA se sigue calculando por si algun dia hace
       falta, pero este papel no lo muestra. `!== false` y no `=== true`:
       un pedido viejo llega sin la clave y esos siempre se facturaron. */
    const gravado = pedido.con_iva !== false;
    return {
      neto: neto,
      iva: iva,
      conIva: conIva,
      gravado: gravado,
      aPagar: gravado ? conIva : neto,
      unidades: unidades || Number(pedido.unidades) || 0,
      /* Con una sola alicuota se puede decir "IVA 21%"; con varias, solo
         "IVA" — poner un porcentaje que no es el de todas las lineas seria
         mentir en un papel que el cliente le muestra a su contador. */
      etiquetaIva: pcts.length === 1 ? ('IVA ' + Number(pcts[0]).toFixed(0) + '%') : 'IVA',
    };
  }

  /* ── Datos para transferir (punto 5 del cliente) ───────────────────────
     Solo se dibuja si hay CBU o alias. Una caja que dice "Banco: —" es peor
     que no tener caja: parece que el sistema se rompio. */
  function cajaTransferencia(emisor) {
    const pago = (emisor && emisor.pago) || {};
    const hay = String(pago.cbu || '').trim() || String(pago.alias || '').trim();
    if (!hay) return null;

    const filas = [];
    const push = function (k, v) {
      if (v && String(v).trim()) {
        filas.push([
          { text: k, fontSize: 9, color: GRIS, margin: [0, 1, 0, 1] },
          { text: String(v), fontSize: 9, bold: true, margin: [0, 1, 0, 1] },
        ]);
      }
    };
    push('Banco', pago.banco);
    push('Titular', pago.titular);
    push('CUIT', pago.cuit);
    push('CBU / CVU', pago.cbu);
    push('Alias', pago.alias);

    const dentro = [
      { text: 'DATOS PARA TRANSFERIR', bold: true, fontSize: 10, margin: [0, 0, 0, 6] },
      { table: { widths: [70, '*'], body: filas }, layout: 'noBorders' },
    ];
    if (pago.notas && String(pago.notas).trim()) {
      dentro.push({ text: String(pago.notas), fontSize: 8, color: GRIS, margin: [0, 6, 0, 0] });
    }
    dentro.push({
      text: 'Cuando transfieras, subí el comprobante desde "Mis pedidos" en la tienda '
          + 'y el equipo lo ve al instante.',
      fontSize: 8, color: GRIS, margin: [0, 6, 0, 0],
    });

    return {
      table: { widths: ['*'], body: [[{ stack: dentro, margin: [10, 9, 10, 9] }]] },
      layout: {
        hLineWidth: function () { return 0.7; },
        vLineWidth: function () { return 0.7; },
        hLineColor: function () { return '#cccccc'; },
        vLineColor: function () { return '#cccccc'; },
        fillColor: function () { return '#fafafa'; },
      },
      margin: [0, 14, 0, 0],
      unbreakable: true,
    };
  }

  function nombreProducto(it) {
    return [it.modelo || it.sku || '—', it.color].filter(Boolean).join(' · ');
  }

  /* ── Documento 1: el presupuesto del cliente ───────────────────────── */
  function contenidoPresupuesto(pedido, opts) {
    const o = opts || {};
    const emisor = o.emisor || {};
    const cliente = o.cliente || {};
    const items = Array.isArray(pedido.items) ? pedido.items : [];
    const t = totales(pedido);
    const numero = pedido.numero_mayorista || pedido.numero || '—';

    const cuerpo = [[
      { text: 'Código',   style: 'th' },
      { text: 'Producto', style: 'th' },
      { text: 'Cant.',    style: 'th', alignment: 'right' },
      { text: 'P. unit.', style: 'th', alignment: 'right' },
      { text: 'Subtotal', style: 'th', alignment: 'right' },
    ]];
    if (!items.length) {
      cuerpo.push([{ text: 'Sin productos', italics: true, color: '#999999', colSpan: 5 }, {}, {}, {}, {}]);
    } else {
      items.forEach(function (it) {
        cuerpo.push([
          { text: String(it.sku || '—'), fontSize: 9 },
          { text: nombreProducto(it), fontSize: 9 },
          { text: String(Number(it.cantidad) || 0), alignment: 'right', fontSize: 9 },
          { text: money(it.precio_unitario), alignment: 'right', fontSize: 9 },
          { text: money(it.subtotal), alignment: 'right', fontSize: 9 },
        ]);
      });
    }

    const content = [
      membrete(emisor),
      raya,
      { columns: [
          { text: t.gravado ? 'PRESUPUESTO' : 'PRESUPUESTO SIN IVA', style: 'h2' },
          { stack: [
              { text: 'N° ' + numero, alignment: 'right', bold: true, fontSize: 11 },
              { text: 'Emitido el ' + hoy(), alignment: 'right', style: 'small' },
            ] },
        ], margin: [0, 0, 0, 10] },
    ];

    const ficha = fichaDatos([
      ['Cliente', cliente.nombre],
      ['CUIT', cliente.cuit],
      ['Fecha del pedido', fecha(pedido.enviado_at || pedido.created_at || pedido.fecha_pedido)],
      ['Entrega deseada', fecha(pedido.fecha_entrega_deseada)],
      ['Dirección de entrega', pedido.direccion_entrega],
      ['Condición de pago', pedido.condicion_pago],
    ]);
    if (ficha) content.push(ficha);

    content.push({
      table: { headerRows: 1, widths: [58, '*', 34, 68, 74], body: cuerpo },
      layout: {
        hLineWidth: function (i, node) { return (i === 0 || i === 1 || i === node.table.body.length) ? 0.6 : 0.3; },
        vLineWidth: function () { return 0; },
        hLineColor: function () { return '#dddddd'; },
        paddingTop: function () { return 4; },
        paddingBottom: function () { return 4; },
      },
    });

    /* Con IVA van los dos totales: el neto para el que factura aparte y el
       total con IVA para el que quiere el numero final. Sin IVA va uno solo
       — mostrar un "total con IVA" que este pedido no cobra es exactamente
       lo que hace que el mayorista transfiera de mas. */
    const filasTotal = t.gravado
      ? [[{ text: 'Subtotal (neto)', fontSize: 10 },
           { text: money(t.neto), alignment: 'right', fontSize: 10 }],
         [{ text: t.etiquetaIva, fontSize: 10 },
           { text: money(t.iva), alignment: 'right', fontSize: 10 }],
         [{ text: 'TOTAL con IVA', style: 'total' },
           { text: money(t.conIva), alignment: 'right', style: 'total' }]]
      : [[{ text: 'TOTAL sin IVA', style: 'total' },
           { text: money(t.aPagar), alignment: 'right', style: 'total' }]];

    content.push({
      columns: [
        { width: '*', text: '' },
        { width: 230, table: { widths: ['*', 92], body: filasTotal },
          layout: {
            hLineWidth: function (i, node) { return i === node.table.body.length - 1 ? 0.8 : 0; },
            vLineWidth: function () { return 0; },
            hLineColor: function () { return '#999999'; },
            paddingTop: function () { return 3; },
            paddingBottom: function () { return 3; },
          } },
      ],
      margin: [0, 10, 0, 0],
    });

    content.push({
      text: t.unidades + (t.unidades === 1 ? ' unidad' : ' unidades')
          + (t.gravado
              ? ' · Los precios son NETOS, sin IVA. El total con IVA se detalla arriba.'
              : ' · Los precios son NETOS. Este pedido no lleva IVA.'),
      style: 'small', margin: [0, 8, 0, 0],
    });

    /* La leyenda va en el papel y no solo en la pantalla: este PDF es lo que
       el mayorista le muestra a su contador, y tiene que decir solo por que
       no va a llegar ninguna factura. */
    if (!t.gravado) {
      content.push({
        text: 'SIN IVA — no se emite factura. Este pedido se trabaja unicamente '
            + 'en formato presupuesto.',
        bold: true, fontSize: 9.5, color: '#8A4B08', margin: [0, 8, 0, 0],
      });
    }

    if (pedido.notas && String(pedido.notas).trim()) {
      content.push({ text: [{ text: 'Notas: ', bold: true }, String(pedido.notas)],
                     fontSize: 9, margin: [0, 10, 0, 0] });
    }

    const caja = cajaTransferencia(emisor);
    if (caja) content.push(caja);

    content.push({
      text: 'Presupuesto sujeto a confirmación de stock. Los precios pueden variar '
          + 'si el pedido no se confirma dentro de los plazos acordados.',
      style: 'footer', margin: [0, 16, 0, 0],
    });

    return content;
  }

  /* ── Documento 2: la hoja que va a produccion ──────────────────────────
     Sin precios, a proposito. Lleva casilleros vacios de "Preparó / Controló"
     porque es una hoja que se imprime, se firma y vuelve. */
  function contenidoProduccion(pedido, opts) {
    const o = opts || {};
    const cliente = o.cliente || {};
    const items = Array.isArray(pedido.items) ? pedido.items : [];
    const t = totales(pedido);
    const numero = pedido.numero_mayorista || pedido.numero || '—';

    const cuerpo = [[
      { text: 'Código', style: 'th' },
      { text: 'Modelo', style: 'th' },
      { text: 'Color',  style: 'th' },
      { text: 'Cantidad', style: 'th', alignment: 'right' },
      { text: 'Listo', style: 'th', alignment: 'center' },
    ]];
    if (!items.length) {
      cuerpo.push([{ text: 'Sin productos', italics: true, color: '#999999', colSpan: 5 }, {}, {}, {}, {}]);
    } else {
      items.forEach(function (it) {
        cuerpo.push([
          { text: String(it.sku || '—'), fontSize: 10 },
          { text: String(it.modelo || '—'), fontSize: 10 },
          { text: String(it.color || '—'), fontSize: 10 },
          { text: String(Number(it.cantidad) || 0), alignment: 'right', fontSize: 12, bold: true },
          { text: ' ', alignment: 'center' },
        ]);
      });
    }

    const content = [
      membrete(o.emisor),
      raya,
      { columns: [
          { text: 'ORDEN DE PRODUCCIÓN', style: 'h2' },
          { stack: [
              { text: 'Pedido ' + numero, alignment: 'right', bold: true, fontSize: 11 },
              { text: 'Impreso el ' + hoy(), alignment: 'right', style: 'small' },
            ] },
        ], margin: [0, 0, 0, 10] },
    ];

    const ficha = fichaDatos([
      ['Cliente', cliente.nombre],
      ['Canal', pedido.canal],
      ['Fecha del pedido', fecha(pedido.enviado_at || pedido.created_at || pedido.fecha_pedido)],
      ['Entrega deseada', fecha(pedido.fecha_entrega_deseada)],
      ['Dirección de entrega', pedido.direccion_entrega],
    ]);
    if (ficha) content.push(ficha);

    content.push({
      table: { headerRows: 1, widths: [64, '*', 84, 58, 40], body: cuerpo },
      layout: {
        hLineWidth: function () { return 0.4; },
        vLineWidth: function () { return 0.4; },
        hLineColor: function () { return '#cccccc'; },
        vLineColor: function () { return '#cccccc'; },
        paddingTop: function () { return 5; },
        paddingBottom: function () { return 5; },
      },
    });

    content.push({
      text: 'TOTAL: ' + t.unidades + (t.unidades === 1 ? ' unidad' : ' unidades'),
      style: 'total', alignment: 'right', margin: [0, 8, 0, 0],
    });

    if (pedido.notas && String(pedido.notas).trim()) {
      content.push({ text: [{ text: 'Notas del cliente: ', bold: true }, String(pedido.notas)],
                     fontSize: 10, margin: [0, 10, 0, 0] });
    }

    content.push({
      table: { widths: ['*', '*', '*'], body: [[
        { text: '\n\nPreparó', fontSize: 9, color: GRIS },
        { text: '\n\nControló', fontSize: 9, color: GRIS },
        { text: '\n\nFecha', fontSize: 9, color: GRIS },
      ]] },
      layout: {
        hLineWidth: function (i) { return i === 1 ? 0.5 : 0; },
        vLineWidth: function () { return 0; },
        hLineColor: function () { return '#999999'; },
      },
      margin: [0, 26, 0, 0],
    });

    return content;
  }

  const STYLES = {
    h2:     { fontSize: 14, bold: true },
    th:     { bold: true, fontSize: 9, fillColor: GRIS_CLARO },
    small:  { fontSize: 8, color: GRIS },
    total:  { fontSize: 12, bold: true },
    footer: { fontSize: 8, color: '#999999' },
  };

  function armar(content, nombre, opts) {
    const doc = window.pdfMake.createPdf({
      pageSize: 'A4',
      pageMargins: [40, 44, 40, 46],
      defaultStyle: { fontSize: 10 },
      styles: STYLES,
      content: content,
      footer: function (pagina, total) {
        return total > 1
          ? { text: pagina + ' / ' + total, alignment: 'center', fontSize: 8, color: '#999999', margin: [0, 12, 0, 0] }
          : null;
      },
    });
    /* En el celular `download` a veces no hace nada visible (el archivo
       aterriza en Descargas sin avisar), asi que ahi conviene abrirlo. Lo
       decide quien llama con opts.abrir. */
    if (opts && opts.abrir) doc.open(); else doc.download(nombre);
    return doc;
  }

  return {
    cargarPdfMake: cargarPdfMake,
    money: money,
    fecha: fecha,

    /* Traduce una fila de company_settings al 'emisor' que devuelve
       b2b_rpc_mi_cuenta, para que el panel y la tienda le pasen lo mismo. */
    emisorDeSettings: function (cs) {
      const c = cs || {};
      return {
        razon_social: c.razon_social, cuit: c.cuit, domicilio: c.domicilio,
        ciudad: c.ciudad, provincia: c.provincia, codigo_postal: c.codigo_postal,
        telefono: c.telefono, email: c.email,
        pago: {
          banco: c.banco, cbu: c.cbu, alias: c.alias_cbu,
          titular: c.titular_cuenta || c.razon_social,
          cuit: c.cuit_cuenta || c.cuit,
          notas: c.notas_pago,
          hay: !!(String(c.cbu || '').trim() || String(c.alias_cbu || '').trim()),
        },
      };
    },

    /* presupuesto(pedido, { emisor, cliente, abrir })
       pedido: lo que devuelve b2b_rpc_mis_pedidos (o el detalle del panel).
       Devuelve una promesa: adentro puede estar bajando pdfmake. */
    presupuesto: function (pedido, opts) {
      if (!pedido) return Promise.reject(new Error('Falta el pedido.'));
      return cargarPdfMake().then(function () {
        const numero = pedido.numero_mayorista || pedido.numero || 'pedido';
        return armar(contenidoPresupuesto(pedido, opts),
                     'presupuesto_' + slug(numero) + '.pdf', opts);
      });
    },

    /* produccion(pedido, { emisor, cliente, abrir }) — sin precios. */
    produccion: function (pedido, opts) {
      if (!pedido) return Promise.reject(new Error('Falta el pedido.'));
      return cargarPdfMake().then(function () {
        const numero = pedido.numero_mayorista || pedido.numero || 'pedido';
        return armar(contenidoProduccion(pedido, opts),
                     'produccion_' + slug(numero) + '.pdf', opts);
      });
    },
  };
})();
