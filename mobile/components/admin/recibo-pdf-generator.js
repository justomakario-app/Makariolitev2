/* ══ RECIBO PDF GENERATOR (S2.12)
   Helper sin JSX. Convierte un recibo (snapshot) + company_settings
   en un PDF via pdfmake (CDN cargado en HTML).

   API:
     window.ReciboPDF.generate(recibo, companySettings, { open: bool })
       → genera 1 PDF (abre en nueva pestaña si open=true, descarga si false).
     window.ReciboPDF.generateLote(recibos[], companySettings)
       → genera 1 PDF con pageBreak entre cada recibo.

   pdfmake usa Roboto vfs_fonts por default (UTF-8 nativo, soporta
   ñ y tildes argentinas).
   ══ */

(function () {

  /* ── Helpers de formato ─────────────────────────────────────────── */
  function fmtMoney(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '$ 0,00';
    const signo = v < 0 ? '-' : '';
    const abs = Math.abs(v);
    const txt = abs.toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `${signo}$ ${txt}`;
  }

  function fmtDate(s) {
    if (!s) return '—';
    const str = String(s).slice(0, 10);
    const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return str;
    return `${m[3]}/${m[2]}/${m[1]}`;
  }

  function tipoLabel(t) {
    const map = { adelanto: 'ADELANTO', quincena: 'QUINCENA', sueldo: 'SUELDO' };
    return map[t] || (t || '').toUpperCase();
  }

  function shortId(id) {
    if (!id) return '—';
    return String(id).split('-')[0].toUpperCase();
  }

  /* ── Construye el content[] de pdfmake para 1 recibo ────────────── */
  function buildReciboContent(recibo, cs) {
    const items = Array.isArray(recibo.items) ? recibo.items : [];
    const valorDia = Number(recibo.sueldo_basico) > 0
      ? Number(recibo.sueldo_basico) / 30
      : 0;
    const totalNegativo = Number(recibo.total) < 0;
    const anulado = recibo.estado === 'anulado';

    /* Header empresa */
    const headerEmpresa = [
      {
        text: (cs && cs.razon_social) || 'MACARIO',
        style: 'h1',
      },
    ];

    const linea2Parts = [];
    if (cs && cs.cuit) linea2Parts.push(`CUIT ${cs.cuit}`);
    if (cs && cs.domicilio) linea2Parts.push(cs.domicilio);
    if (linea2Parts.length) {
      headerEmpresa.push({ text: linea2Parts.join(' · '), style: 'small' });
    }

    const linea3Parts = [];
    if (cs && cs.ciudad) linea3Parts.push(cs.ciudad);
    if (cs && cs.provincia) linea3Parts.push(cs.provincia);
    if (cs && cs.codigo_postal) linea3Parts.push(`(${cs.codigo_postal})`);
    if (linea3Parts.length) {
      headerEmpresa.push({ text: linea3Parts.join(', '), style: 'small' });
    }

    const linea4Parts = [];
    if (cs && cs.telefono) linea4Parts.push(`Tel: ${cs.telefono}`);
    if (cs && cs.email) linea4Parts.push(cs.email);
    if (linea4Parts.length) {
      headerEmpresa.push({ text: linea4Parts.join(' · '), style: 'small' });
    }

    /* Tabla de items */
    const itemsBody = [
      [
        { text: 'Concepto',  style: 'th' },
        { text: 'Cant.',     style: 'th', alignment: 'right' },
        { text: 'Vlr. Unit.', style: 'th', alignment: 'right' },
        { text: 'Subtotal',  style: 'th', alignment: 'right' },
      ],
    ];
    if (items.length === 0) {
      itemsBody.push([
        { text: '(Sin items)', italics: true, color: '#999', colSpan: 4 },
        {}, {}, {},
      ]);
    } else {
      items.forEach((it) => {
        const esDescuento = it && it.tipo === 'descuento';
        const subColor = (esDescuento || Number(it.subtotal) < 0) ? '#b91c1c' : undefined;
        itemsBody.push([
          { text: String((it && it.concepto) || '—') },
          { text: String((it && it.cantidad) != null ? it.cantidad : ''), alignment: 'right' },
          { text: fmtMoney(it && it.valor_unitario), alignment: 'right' },
          { text: fmtMoney(it && it.subtotal), alignment: 'right', color: subColor },
        ]);
      });
    }

    const content = [];

    /* Banner anulado al tope si aplica */
    if (anulado) {
      content.push({
        text: '⚠ RECIBO ANULADO',
        style: 'anuladoBanner',
        alignment: 'center',
        margin: [0, 0, 0, 8],
      });
    }

    content.push(...headerEmpresa);
    content.push({
      canvas: [{ type: 'line', x1: 0, y1: 5, x2: 515, y2: 5, lineWidth: 0.5, lineColor: '#666' }],
      margin: [0, 4, 0, 4],
    });

    /* Título recibo + ID */
    content.push({
      columns: [
        { text: `RECIBO DE ${tipoLabel(recibo.tipo)}`, style: 'h2' },
        { text: `N° ${shortId(recibo.id)}`, alignment: 'right', style: 'small' },
      ],
      margin: [0, 10, 0, 8],
    });

    /* Datos empleado */
    content.push({
      columns: [
        { text: [{ text: 'Empleado: ', bold: true }, String(recibo.empleado_nombre || '—')] },
        { text: [{ text: 'CUIL: ', bold: true }, String(recibo.empleado_cuil || '—')], alignment: 'right' },
      ],
      margin: [0, 0, 0, 3],
    });
    content.push({
      columns: [
        { text: [{ text: 'Categoría: ', bold: true }, String(recibo.empleado_categoria || '—')] },
        { text: [{ text: 'F. ingreso: ', bold: true }, fmtDate(recibo.empleado_fecha_ingreso)], alignment: 'right' },
      ],
      margin: [0, 0, 0, 3],
    });
    content.push({
      columns: [
        { text: [{ text: 'Período: ', bold: true }, `${fmtDate(recibo.periodo_desde)} al ${fmtDate(recibo.periodo_hasta)}`] },
        { text: [{ text: 'F. pago: ', bold: true }, fmtDate(recibo.fecha_pago)], alignment: 'right' },
      ],
      margin: [0, 0, 0, 6],
    });

    /* Básico + valor del día */
    content.push({
      columns: [
        { text: [{ text: 'Sueldo básico: ', bold: true }, fmtMoney(recibo.sueldo_basico)] },
        { text: [{ text: 'Valor del día: ', bold: true }, fmtMoney(valorDia)], alignment: 'right' },
      ],
      margin: [0, 0, 0, 10],
    });

    /* Tabla items */
    content.push({
      table: {
        widths: ['*', 50, 80, 80],
        headerRows: 1,
        body: itemsBody,
      },
      layout: 'lightHorizontalLines',
    });

    /* Total */
    content.push({
      text: `TOTAL A PAGAR: ${fmtMoney(recibo.total)}`,
      style: 'total',
      alignment: 'right',
      color: totalNegativo ? '#b91c1c' : undefined,
      margin: [0, 12, 0, 25],
    });

    /* Notas si hay */
    if (recibo.notas) {
      content.push({
        text: [{ text: 'Notas: ', bold: true }, String(recibo.notas)],
        style: 'small',
        margin: [0, 0, 0, 15],
      });
    }

    /* Firma */
    content.push({
      canvas: [{ type: 'line', x1: 0, y1: 0, x2: 220, y2: 0, lineWidth: 0.5 }],
      margin: [0, 18, 0, 2],
    });
    content.push({ text: 'Firma del empleado', style: 'small' });
    content.push({ text: ' ', margin: [0, 8] });
    content.push({
      canvas: [{ type: 'line', x1: 0, y1: 0, x2: 220, y2: 0, lineWidth: 0.5 }],
      margin: [0, 6, 0, 2],
    });
    content.push({ text: 'Aclaración / DNI', style: 'small' });

    /* Footer (fecha generación) */
    content.push({
      text: `Generado: ${new Date().toLocaleString('es-AR')}`,
      style: 'footer',
      alignment: 'right',
      margin: [0, 20, 0, 0],
    });

    return content;
  }

  const PDF_STYLES = {
    h1:    { fontSize: 18, bold: true },
    h2:    { fontSize: 13, bold: true },
    th:    { bold: true, fontSize: 10, fillColor: '#f5f5f5' },
    small: { fontSize: 9, color: '#666' },
    total: { fontSize: 13, bold: true },
    footer:{ fontSize: 8, color: '#999' },
    anuladoBanner: {
      fontSize: 14, bold: true, color: '#b91c1c',
      background: '#fef2f2',
    },
  };

  function ensurePdfMake() {
    if (typeof window.pdfMake === 'undefined') {
      throw new Error('pdfmake no está cargado. Recargá la página.');
    }
  }

  function buildFileName(recibo) {
    const nombre = String(recibo.empleado_nombre || 'empleado')
      .toLowerCase()
      .replace(/[áä]/g, 'a').replace(/[éë]/g, 'e').replace(/[íï]/g, 'i')
      .replace(/[óö]/g, 'o').replace(/[úü]/g, 'u').replace(/ñ/g, 'n')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const tipo = recibo.tipo || 'recibo';
    const fecha = String(recibo.fecha_pago || '').slice(0, 10);
    return `recibo_${tipo}_${nombre}_${fecha}.pdf`;
  }

  function generate(recibo, companySettings, opts) {
    ensurePdfMake();
    if (!recibo) throw new Error('Recibo requerido');
    const open = opts && opts.open === true;
    const docDefinition = {
      pageSize: 'A4',
      pageMargins: [40, 50, 40, 50],
      defaultStyle: { fontSize: 10 },
      styles: PDF_STYLES,
      content: buildReciboContent(recibo, companySettings),
    };
    const doc = window.pdfMake.createPdf(docDefinition);
    if (open) doc.open();
    else doc.download(buildFileName(recibo));
    return doc;
  }

  function generateLote(recibos, companySettings) {
    ensurePdfMake();
    if (!Array.isArray(recibos) || recibos.length === 0) {
      throw new Error('No hay recibos para generar el lote');
    }
    const content = [];
    recibos.forEach((r, idx) => {
      content.push(...buildReciboContent(r, companySettings));
      if (idx < recibos.length - 1) {
        content.push({ text: '', pageBreak: 'after' });
      }
    });
    const fechaHoy = new Date().toISOString().slice(0, 10);
    const fileName = `recibos_lote_${fechaHoy}.pdf`;
    const docDefinition = {
      pageSize: 'A4',
      pageMargins: [40, 50, 40, 50],
      defaultStyle: { fontSize: 10 },
      styles: PDF_STYLES,
      content,
    };
    const doc = window.pdfMake.createPdf(docDefinition);
    doc.download(fileName);
    return doc;
  }

  window.ReciboPDF = { generate, generateLote, fmtMoney, fmtDate };
})();
