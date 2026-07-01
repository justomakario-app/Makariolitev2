/* ══ CASH FLOW PDF GENERATOR (S2.16 etapa 3)
   Helper sin JSX. Convierte un payload de rpc_admin_get_cash_flow
   + company_settings + imágenes de los charts (capturadas via
   canvas.toDataURL) en un PDF vía pdfmake (S2.12).

   API:
     window.CashFlowPDF.generate({
       payload,         // jsonb del RPC
       companySettings, // de S2.12 rpc_admin_get_company_settings
       period,          // { desde, hasta, modo, incluirProy }
       filas,           // array de filas ya combinadas (real+proy) y agrupadas
       chartImages,     // { saldo: 'data:image/png;base64,...', barras: idem }
     }, { open: bool });

   Estructura: header empresa + período + KPIs + 2 imágenes de
   gráficos + tabla + footer.

   Roboto vfs_fonts ya cargado por pdfmake (S2.12), soporta ñ/tildes.
   ══ */

(function () {

  function fmtMoney(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '$ 0,00';
    const signo = v < 0 ? '-' : '';
    const abs = Math.abs(v);
    return `${signo}$ ${abs.toLocaleString('es-AR', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    })}`;
  }

  function fmtDate(s) {
    if (!s) return '—';
    const str = String(s).slice(0, 10);
    const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return str;
    return `${m[3]}/${m[2]}/${m[1]}`;
  }

  function ensurePdfMake() {
    if (typeof window.pdfMake === 'undefined') {
      throw new Error('pdfmake no está cargado. Recargá la página.');
    }
  }

  function buildHeader(cs) {
    const out = [
      window.pdfMakeMakarioHeader
        ? window.pdfMakeMakarioHeader(cs, { logoSize: 15, logoSubSize: 9, margin: [0, 0, 0, 6] })
        : { text: window.getCompanyBrandName ? window.getCompanyBrandName(cs) : ((cs && cs.razon_social) || 'Justo Makario'), style: 'h1' },
    ];
    out.push({
      canvas: [{ type:'line', x1:0, y1:5, x2:515, y2:5, lineWidth:0.5, lineColor:'#666' }],
      margin: [0, 4, 0, 4],
    });
    return out;
  }

  function buildKpis(kpis, incluirProy) {
    const cell = (label, value, color) => ({
      stack: [
        { text: label, style: 'small', color: '#666' },
        { text: value, style: 'kpiValue', color },
      ],
      margin: [0, 4, 0, 4],
    });
    const ingreso = Number(kpis.total_ingresos_real || 0);
    const egreso  = Number(kpis.total_egresos_real  || 0);
    const saldoP  = Number(kpis.saldo_periodo_real  || 0);
    const saldoF  = Number(incluirProy ? (kpis.saldo_final_proyectado || saldoP) : saldoP);
    return {
      columns: [
        cell('Total ingresos',    fmtMoney(ingreso), '#16a34a'),
        cell('Total egresos',     fmtMoney(egreso),  '#dc2626'),
        cell('Saldo del período', fmtMoney(saldoP),  saldoP < 0 ? '#dc2626' : '#16a34a'),
        cell(incluirProy ? 'Saldo acum. (incl. proy.)' : 'Saldo acumulado',
             fmtMoney(saldoF),  saldoF < 0 ? '#dc2626' : '#16a34a'),
      ],
      columnGap: 12,
      margin: [0, 8, 0, 12],
    };
  }

  function buildCharts(chartImages) {
    const out = [];
    if (chartImages && chartImages.saldo) {
      out.push({
        text: 'Saldo acumulado',
        style: 'h3',
        margin: [0, 4, 0, 4],
      });
      out.push({
        image: chartImages.saldo,
        width: 515,
        margin: [0, 0, 0, 12],
      });
    }
    if (chartImages && chartImages.barras) {
      out.push({
        text: 'Ingresos vs egresos',
        style: 'h3',
        margin: [0, 4, 0, 4],
      });
      out.push({
        image: chartImages.barras,
        width: 515,
        margin: [0, 0, 0, 12],
      });
    }
    return out;
  }

  function buildTable(filas, modo) {
    const filasArr = Array.isArray(filas) ? filas : [];
    const header = [
      { text: modo === 'mes' ? 'Mes' : 'Fecha', style: 'th' },
      { text: 'Compras',      style: 'th', alignment: 'right' },
      { text: 'Sueldos',      style: 'th', alignment: 'right' },
      { text: 'Cheques',      style: 'th', alignment: 'right' },
      { text: 'Otros',        style: 'th', alignment: 'right' },
      { text: 'Total',        style: 'th', alignment: 'right' },
      { text: 'Saldo acum.',  style: 'th', alignment: 'right' },
    ];

    const body = [header];
    if (filasArr.length === 0) {
      body.push([{ text: '(Sin movimientos en el período)', italics: true, color: '#999', colSpan: 7, alignment: 'center' }, {}, {}, {}, {}, {}, {}]);
    } else {
      filasArr.forEach((r) => {
        const totalNeg  = Number(r.total_dia) < 0;
        const saldoNeg  = Number(r.saldo_acumulado) < 0;
        const esProy    = r.clase === 'proyectado';
        body.push([
          {
            text: modo === 'mes'
              ? String(r.ym || String(r.fecha || '').slice(0, 7))
              : fmtDate(r.fecha),
            italics: esProy,
            color: esProy ? '#92400e' : undefined,
          },
          { text: fmtCell(r.compras), alignment: 'right' },
          { text: fmtCell(r.sueldos), alignment: 'right' },
          { text: fmtCell(r.cheques), alignment: 'right' },
          { text: fmtCell(r.otros),   alignment: 'right' },
          { text: fmtMoney(r.total_dia || 0),       alignment: 'right', bold: true, color: totalNeg ? '#dc2626' : undefined },
          { text: fmtMoney(r.saldo_acumulado || 0), alignment: 'right', bold: true, color: saldoNeg ? '#dc2626' : undefined },
        ]);
      });
    }

    return {
      table: {
        widths: [70, '*', '*', '*', '*', '*', '*'],
        headerRows: 1,
        body,
      },
      layout: 'lightHorizontalLines',
    };
  }

  function fmtCell(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n === 0) return '—';
    return fmtMoney(n);
  }

  function generate(args, opts) {
    ensurePdfMake();
    const { payload, companySettings, period, filas, chartImages } = args || {};
    if (!payload) throw new Error('payload requerido');

    const modo = (period && period.modo) || 'dia';
    const incluirProy = !!(period && period.incluirProy);
    const desde = period && period.desde;
    const hasta = period && period.hasta;

    const content = [];
    content.push(...buildHeader(companySettings));

    /* Título + período */
    content.push({
      columns: [
        { text: 'CASH FLOW', style: 'h2' },
        { text: `Período: ${fmtDate(desde)} al ${fmtDate(hasta)}`, alignment: 'right', style: 'small' },
      ],
      margin: [0, 8, 0, 6],
    });
    if (incluirProy) {
      content.push({ text: 'Incluye proyectado (cheques pendientes)', style: 'small', color: '#92400e', margin: [0, 0, 0, 4] });
    }

    /* KPIs */
    content.push(buildKpis(payload.kpis || {}, incluirProy));

    /* Charts */
    content.push(...buildCharts(chartImages));

    /* Tabla */
    content.push(buildTable(filas, modo));

    /* Footer */
    content.push({
      text: `Generado: ${new Date().toLocaleString('es-AR')}`,
      style: 'footer',
      alignment: 'right',
      margin: [0, 18, 0, 0],
    });

    const fechaHoy = new Date().toISOString().slice(0, 10);
    const fileName = `cash_flow_${desde || ''}_${hasta || ''}_${fechaHoy}.pdf`
      .replace(/--+/g, '-');

    const docDefinition = {
      pageSize: 'A4',
      pageOrientation: 'portrait',
      pageMargins: [40, 40, 40, 50],
      defaultStyle: { fontSize: 9 },
      styles: {
        h1:       { fontSize: 18, bold: true },
        h2:       { fontSize: 14, bold: true },
        h3:       { fontSize: 11, bold: true, color: '#1f2937' },
        th:       { bold: true, fontSize: 9, fillColor: '#f5f5f5' },
        small:    { fontSize: 8, color: '#666' },
        kpiValue: { fontSize: 12, bold: true },
        footer:   { fontSize: 7, color: '#999' },
      },
      content,
    };

    const doc = window.pdfMake.createPdf(docDefinition);
    if (opts && opts.open === true) doc.open();
    else doc.download(fileName);
    return doc;
  }

  window.CashFlowPDF = { generate, fmtMoney, fmtDate };
})();
