/* ══ CIERRE PDF GENERATOR (Fase 8 etapa 3)
   Helper sin JSX. Genera PDF profesional multi-página de un cierre
   contable usando pdfmake (S2.12).

   API:
     window.CierrePDF.generate({
       reporte,         // payload de rpc_admin_get_reporte_cierre
       companySettings, // de S2.12
     }, { open: bool });

   Estructura multi-página:
     P1 — Portada (empresa + título + período + cerrado por)
     P2 — KPIs + Comparativa con período anterior
     P3 — Top 5 proveedores + Top 5 empleados
     P4 — Breakdown por categoría

   Graceful fallback: empty arrays + null safe.
   ══ */

(function () {

  function fmtMoney(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '$ 0,00';
    const sgn = v < 0 ? '-' : '';
    const abs = Math.abs(v);
    return `${sgn}$ ${abs.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function fmtDate(s) {
    if (!s) return '—';
    const str = String(s).slice(0, 10);
    const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return str;
    return `${m[3]}/${m[2]}/${m[1]}`;
  }

  function fmtDateTime(s) {
    if (!s) return '—';
    try { return new Date(s).toLocaleString('es-AR'); }
    catch (_) { return String(s); }
  }

  function ensurePdfMake() {
    if (typeof window.pdfMake === 'undefined') {
      throw new Error('pdfmake no está cargado. Recargá la página.');
    }
  }

  function getCategoriaTotal(cierre, cat) {
    if (!cierre || !cierre.snapshot_jsonb) return 0;
    const bd = cierre.snapshot_jsonb.breakdown_categorias || {};
    if (cat === 'cheques') {
      return (Number(bd.cheques_cobrados_in)  || 0) - (Number(bd.cheques_cobrados_out) || 0);
    }
    if (cat === 'otros') {
      return (Number(bd.otros_ingreso) || 0) - (Number(bd.otros_egreso) || 0);
    }
    /* Compras y sueldos son egresos: el RPC los guarda como totales
       absolutos en breakdown_categorias. Acá los devolvemos con signo. */
    if (cat === 'compras' || cat === 'sueldos') {
      return -(Number(bd[cat]) || 0);
    }
    return Number(bd[cat]) || 0;
  }

  function calcVariacionTexto(actual, anterior) {
    const a = Number(actual)   || 0;
    const p = Number(anterior) || 0;
    if (p === 0 && a === 0) return '0%';
    if (p === 0 && a !== 0) return 'Nuevo';
    if (p !== 0 && a === 0) return '-100%';
    const pct = ((a - p) / Math.abs(p)) * 100;
    return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
  }

  function buildPortada(cierre, cs) {
    const out = [];
    out.push({ text: (cs && cs.razon_social) || 'MACARIO', style: 'h1', alignment: 'center', margin: [0, 40, 0, 6] });
    const linea2 = [];
    if (cs && cs.cuit)      linea2.push(`CUIT ${cs.cuit}`);
    if (cs && cs.domicilio) linea2.push(cs.domicilio);
    if (linea2.length) out.push({ text: linea2.join(' · '), style: 'small', alignment: 'center' });
    out.push({ canvas: [{ type:'line', x1:50, y1:5, x2:465, y2:5, lineWidth:0.5, lineColor:'#666' }], margin: [0, 10, 0, 30] });

    out.push({ text: 'REPORTE DE CIERRE CONTABLE', style: 'titulo', alignment: 'center', margin: [0, 30, 0, 30] });

    const tipoLabel = cierre.tipo === 'mensual' ? 'Cierre mensual' : 'Cierre anual';
    out.push({
      stack: [
        { text: [{ text: 'Tipo: ', bold: true }, tipoLabel] },
        { text: [{ text: 'Período: ', bold: true }, `${fmtDate(cierre.periodo_desde)} al ${fmtDate(cierre.periodo_hasta)}`] },
        { text: [{ text: 'Estado: ', bold: true }, cierre.estado === 'cerrado' ? 'Cerrado' : 'Reabierto'] },
        { text: [{ text: 'Cerrado el: ', bold: true }, fmtDateTime(cierre.cerrado_at)] },
        cierre.estado === 'reabierto'
          ? { text: [{ text: 'Reabierto el: ', bold: true }, fmtDateTime(cierre.reabierto_at)], color: '#b91c1c' }
          : null,
        cierre.estado === 'reabierto' && cierre.motivo_reapertura
          ? { text: [{ text: 'Motivo: ', bold: true }, cierre.motivo_reapertura], color: '#b91c1c', italics: true }
          : null,
      ].filter(Boolean),
      alignment: 'center',
      fontSize: 12,
      margin: [0, 0, 0, 40],
    });

    return out;
  }

  function buildKpis(cierre) {
    const fila = (label, val, color) => ({
      stack: [
        { text: label, style: 'small', color: '#666' },
        { text: fmtMoney(val), style: 'kpiValue', color, margin: [0, 2, 0, 0] },
      ],
      margin: [0, 4, 0, 4],
    });
    return {
      columns: [
        fila('Saldo apertura',  cierre.saldo_apertura),
        fila('Ingresos',        cierre.total_ingresos, '#16a34a'),
        fila('Egresos',         cierre.total_egresos,  '#dc2626'),
        fila('Saldo cierre',    cierre.saldo_cierre,   Number(cierre.saldo_cierre) < 0 ? '#dc2626' : '#16a34a'),
      ],
      columnGap: 10,
      margin: [0, 10, 0, 14],
    };
  }

  function buildComparativa(cierre, anterior) {
    if (!anterior) {
      return {
        stack: [
          { text: 'Comparativa con período anterior', style: 'h3', margin: [0, 8, 0, 4] },
          { text: 'Sin período anterior del mismo tipo para comparar.', italics: true, color: '#999' },
        ],
        margin: [0, 0, 0, 14],
      };
    }
    const cats = ['compras', 'sueldos', 'cheques', 'otros'];
    const body = [
      [
        { text: 'Categoría', style: 'th' },
        { text: 'Período actual', style: 'th', alignment: 'right' },
        { text: 'Período anterior', style: 'th', alignment: 'right' },
        { text: 'Variación', style: 'th', alignment: 'right' },
      ],
    ];
    cats.forEach(cat => {
      const a = getCategoriaTotal(cierre, cat);
      const p = getCategoriaTotal(anterior, cat);
      const v = calcVariacionTexto(a, p);
      const varColor = v === 'Nuevo' ? '#2563eb'
                     : v === '0%'    ? '#999'
                     : (v.indexOf('-') === 0 ? '#16a34a' : '#dc2626'); /* baja egresos = bueno; pero acá la heurística simple */
      body.push([
        cat[0].toUpperCase() + cat.slice(1),
        { text: fmtMoney(a), alignment: 'right', color: a < 0 ? '#dc2626' : (a > 0 ? '#16a34a' : undefined) },
        { text: fmtMoney(p), alignment: 'right', color: p < 0 ? '#dc2626' : (p > 0 ? '#16a34a' : undefined) },
        { text: v, alignment: 'right', color: varColor, bold: true },
      ]);
    });
    return {
      stack: [
        { text: 'Comparativa con período anterior', style: 'h3', margin: [0, 8, 0, 4] },
        { table: { widths: ['*', '*', '*', 70], headerRows: 1, body }, layout: 'lightHorizontalLines' },
      ],
      margin: [0, 0, 0, 14],
    };
  }

  function buildTopProveedores(cierre) {
    const snap = cierre.snapshot_jsonb || {};
    const lista = Array.isArray(snap.top_proveedores) ? snap.top_proveedores : [];
    if (lista.length === 0) {
      return {
        stack: [
          { text: 'Top 5 proveedores', style: 'h3', margin: [0, 6, 0, 4] },
          { text: '(Sin movimientos de compras en el período)', italics: true, color: '#999' },
        ],
        margin: [0, 0, 0, 12],
      };
    }
    const body = [
      [{ text: '#', style: 'th' }, { text: 'Proveedor', style: 'th' }, { text: 'Monto', style: 'th', alignment: 'right' }],
    ];
    lista.slice(0, 5).forEach((p, idx) => {
      body.push([
        String(idx + 1),
        String(p.nombre || 'Sin proveedor'),
        { text: fmtMoney(p.total), alignment: 'right', color: Number(p.total) < 0 ? '#dc2626' : undefined },
      ]);
    });
    return {
      stack: [
        { text: 'Top 5 proveedores', style: 'h3', margin: [0, 6, 0, 4] },
        { table: { widths: [25, '*', 100], headerRows: 1, body }, layout: 'lightHorizontalLines' },
      ],
      margin: [0, 0, 0, 12],
    };
  }

  function buildTopEmpleados(cierre) {
    const snap = cierre.snapshot_jsonb || {};
    const lista = Array.isArray(snap.top_empleados) ? snap.top_empleados : [];
    if (lista.length === 0) {
      return {
        stack: [
          { text: 'Top 5 empleados (sueldos)', style: 'h3', margin: [0, 6, 0, 4] },
          { text: '(Sin recibos en el período)', italics: true, color: '#999' },
        ],
        margin: [0, 0, 0, 12],
      };
    }
    const body = [
      [{ text: '#', style: 'th' }, { text: 'Empleado', style: 'th' }, { text: 'Monto', style: 'th', alignment: 'right' }],
    ];
    lista.slice(0, 5).forEach((e, idx) => {
      body.push([
        String(idx + 1),
        String(e.nombre || '—'),
        { text: fmtMoney(e.total), alignment: 'right' },
      ]);
    });
    return {
      stack: [
        { text: 'Top 5 empleados (sueldos)', style: 'h3', margin: [0, 6, 0, 4] },
        { table: { widths: [25, '*', 100], headerRows: 1, body }, layout: 'lightHorizontalLines' },
      ],
      margin: [0, 0, 0, 12],
    };
  }

  function buildBreakdown(cierre) {
    const cats = [
      { key: 'compras',  label: 'Compras',  isEgreso: true  },
      { key: 'sueldos',  label: 'Sueldos',  isEgreso: true  },
      { key: 'cheques',  label: 'Cheques',  isEgreso: false },
      { key: 'otros',    label: 'Otros',    isEgreso: false },
    ];
    const body = [
      [{ text: 'Categoría', style: 'th' }, { text: 'Monto', style: 'th', alignment: 'right' }],
    ];
    cats.forEach(c => {
      const v = getCategoriaTotal(cierre, c.key);
      body.push([
        c.label,
        { text: fmtMoney(v), alignment: 'right', color: v < 0 ? '#dc2626' : (v > 0 ? '#16a34a' : undefined), bold: true },
      ]);
    });
    return {
      stack: [
        { text: 'Detalle por categoría', style: 'h3', margin: [0, 6, 0, 4] },
        { table: { widths: ['*', 120], headerRows: 1, body }, layout: 'lightHorizontalLines' },
      ],
      margin: [0, 0, 0, 12],
    };
  }

  function generate(args, opts) {
    ensurePdfMake();
    const { reporte, companySettings } = args || {};
    if (!reporte || !reporte.cierre) throw new Error('Reporte requerido');

    const c   = reporte.cierre;
    const ant = reporte.periodo_anterior || null;

    const content = [];

    /* P1 Portada */
    content.push(...buildPortada(c, companySettings));
    content.push({ text: '', pageBreak: 'after' });

    /* P2 KPIs + Comparativa */
    content.push({ text: 'KPIs del cierre', style: 'h2', margin: [0, 4, 0, 4] });
    content.push(buildKpis(c));
    content.push({ text: `Saldo acumulado histórico: ${fmtMoney(c.saldo_acumulado_historico)}`, style: 'small', alignment: 'right', margin: [0, 0, 0, 8] });
    content.push({ text: `Movimientos en el período: ${c.count_movimientos || 0}`, style: 'small', margin: [0, 0, 0, 10] });
    content.push(buildComparativa(c, ant));
    content.push({ text: '', pageBreak: 'after' });

    /* P3 Top proveedores + Top empleados */
    content.push({ text: 'Detalle top', style: 'h2', margin: [0, 4, 0, 4] });
    content.push(buildTopProveedores(c));
    content.push(buildTopEmpleados(c));
    content.push({ text: '', pageBreak: 'after' });

    /* P4 Breakdown */
    content.push({ text: 'Categorías', style: 'h2', margin: [0, 4, 0, 4] });
    content.push(buildBreakdown(c));

    const fechaHoy = new Date().toISOString().slice(0, 10);
    const fname = `cierre_${c.tipo}_${String(c.periodo_desde).slice(0,10)}_${String(c.periodo_hasta).slice(0,10)}_${fechaHoy}.pdf`;

    const docDefinition = {
      pageSize: 'A4',
      pageMargins: [40, 40, 40, 50],
      defaultStyle: { fontSize: 10 },
      footer: function (currentPage, pageCount) {
        return {
          columns: [
            { text: `Generado: ${new Date().toLocaleString('es-AR')}`, style: 'footer', margin: [40, 10, 0, 0] },
            { text: `Página ${currentPage} de ${pageCount}`, style: 'footer', alignment: 'right', margin: [0, 10, 40, 0] },
          ],
        };
      },
      styles: {
        h1:       { fontSize: 20, bold: true },
        h2:       { fontSize: 14, bold: true, color: '#1f2937' },
        h3:       { fontSize: 11, bold: true, color: '#1f2937' },
        titulo:   { fontSize: 16, bold: true, color: '#1f2937' },
        small:    { fontSize: 9, color: '#666' },
        th:       { bold: true, fontSize: 9, fillColor: '#f5f5f5' },
        kpiValue: { fontSize: 13, bold: true },
        footer:   { fontSize: 7, color: '#999' },
      },
      content,
    };

    const doc = window.pdfMake.createPdf(docDefinition);
    if (opts && opts.open === true) doc.open();
    else doc.download(fname);
    return doc;
  }

  window.CierrePDF = { generate, fmtMoney, fmtDate };
})();
