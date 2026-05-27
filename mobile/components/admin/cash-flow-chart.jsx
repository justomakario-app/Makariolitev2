/* ══ CASH FLOW CHART (S2.16 etapa 3)
   Wrapper React de Chart.js v4 para 2 modos del dashboard cash flow:

   mode='line':  Saldo acumulado en el tiempo (1 dataset, area fill).
   mode='bars':  Ingresos vs egresos por fecha (2 datasets, no stacked).

   Props:
     - mode: 'line' | 'bars'
     - data: array de filas combinadas (real + proyectado si aplica)
             Cada fila: { fecha, total_dia, saldo_acumulado, ym? }
     - title: string opcional (etiqueta en card)
     - height: opcional (default 220)
     - onCanvasReady: opcional callback (canvas) — para export PDF
       (permite capturar el canvas via toDataURL desde el padre)

   Cleanup CRITICAL en useEffect: destruye chart anterior antes de
   crear nuevo, evita memory leaks al cambiar filtros.

   Reusa pattern de S2.15 historial-chart.jsx.
   ══ */

function CashFlowChart({ mode, data, title, height, onCanvasReady }) {
  const canvasRef = React.useRef(null);
  const chartRef  = React.useRef(null);

  React.useEffect(() => {
    if (typeof window.Chart === 'undefined') {
      console.warn('[CashFlowChart] Chart.js no está cargado.');
      return;
    }
    if (!canvasRef.current) return;

    /* Cleanup chart previo */
    if (chartRef.current) {
      try { chartRef.current.destroy(); } catch (_) {}
      chartRef.current = null;
    }

    const COLORS = {
      saldo:    '#2563eb',  /* azul */
      saldoBg:  'rgba(37, 99, 235, 0.10)',
      ingreso:  '#16a34a',  /* verde */
      egreso:   '#dc2626',  /* rojo */
    };

    const fmtMoneyShort = (v) => {
      const n = Number(v) || 0;
      const abs = Math.abs(n);
      const sign = n < 0 ? '-' : '';
      if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
      if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
      return `${sign}$${abs.toFixed(0)}`;
    };
    const fmtMoneyFull = (v) => {
      const n = Number(v) || 0;
      return `$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const items = Array.isArray(data) ? data : [];
    const labels = items.map(it => String(it.fecha || it.ym || '').slice(0, 10));

    let cfg;

    if (mode === 'bars') {
      const ingresos = items.map(it => {
        const t = Number(it.total_dia) || 0;
        return t > 0 ? t : 0;
      });
      const egresos = items.map(it => {
        const t = Number(it.total_dia) || 0;
        return t < 0 ? Math.abs(t) : 0;
      });

      cfg = {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Ingresos', data: ingresos, backgroundColor: COLORS.ingreso },
            { label: 'Egresos',  data: egresos,  backgroundColor: COLORS.egreso  },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          scales: {
            x: { stacked: false },
            y: { beginAtZero: true, ticks: { callback: (v) => fmtMoneyShort(v) } },
          },
          plugins: {
            tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtMoneyFull(ctx.raw)}` } },
            legend:  { position: 'bottom' },
          },
        },
      };
    } else {
      /* mode 'line' (default) */
      const saldos = items.map(it => Number(it.saldo_acumulado) || 0);
      cfg = {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Saldo acumulado',
              data: saldos,
              borderColor: COLORS.saldo,
              backgroundColor: COLORS.saldoBg,
              fill: true,
              tension: 0.2,
              pointRadius: 2,
              pointHoverRadius: 4,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          scales: {
            y: { ticks: { callback: (v) => fmtMoneyShort(v) } },
          },
          plugins: {
            tooltip: { callbacks: { label: (ctx) => `Saldo: ${fmtMoneyFull(ctx.raw)}` } },
            legend:  { display: false },
          },
        },
      };
    }

    try {
      chartRef.current = new window.Chart(canvasRef.current.getContext('2d'), cfg);
      if (typeof onCanvasReady === 'function') {
        /* Notificar al padre el canvas listo (para export PDF) */
        try { onCanvasReady(canvasRef.current); } catch (_) {}
      }
    } catch (err) {
      console.error('[CashFlowChart] error:', err);
    }

    return () => {
      if (chartRef.current) {
        try { chartRef.current.destroy(); } catch (_) {}
        chartRef.current = null;
      }
    };
  }, [mode, data]);

  return (
    <div className="cf-chart-container" style={{ height: height || 220 }}>
      {title && <div className="cf-chart-title">{title}</div>}
      <div style={{ position:'relative', height: (height || 220) - (title ? 28 : 0) }}>
        <canvas ref={canvasRef}/>
      </div>
    </div>
  );
}

window.CashFlowChart = CashFlowChart;
