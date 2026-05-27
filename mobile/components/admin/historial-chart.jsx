/* ══ HISTORIAL CHART (S2.15)
   Wrapper React de Chart.js v4 (CDN). Renderiza barras stacked con
   breakdown por tipo (adelanto/quincena/sueldo).

   Props:
     - mode: 'monthly' (modal individual: 12 barras de meses)
           | 'comparative' (tab Reportes: barras horizontales por empleado)
     - data: shape depende del mode (ver abajo)
     - height: opcional (default 240)

   data shape 'monthly':
     [{ mes: 1..12, total_adelanto, total_quincena, total_sueldo }, ...]

   data shape 'comparative':
     [{ nombre, total_adelanto, total_quincena, total_sueldo }, ...]

   useEffect destruye el chart antes de re-crearlo para evitar
   memory leaks al cambiar filtros.
   ══ */

function HistorialChart({ mode, data, height }) {
  const canvasRef = React.useRef(null);
  const chartRef  = React.useRef(null);
  const A = window.ADMIN_DATA;

  React.useEffect(() => {
    if (typeof window.Chart === 'undefined') {
      console.warn('[HistorialChart] Chart.js no está cargado.');
      return;
    }
    if (!canvasRef.current) return;

    /* Cleanup chart previo (evita leaks al cambiar filtros) */
    if (chartRef.current) {
      try { chartRef.current.destroy(); } catch (_) {}
      chartRef.current = null;
    }

    const COLORS = {
      sueldo:   '#16a34a', /* verde */
      quincena: '#2563eb', /* azul */
      adelanto: '#f59e0b', /* naranja */
    };

    const fmtMoneyShort = (v) => {
      const n = Number(v) || 0;
      if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
      if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
      return `$${n.toFixed(0)}`;
    };
    const fmtMoneyFull = (v) => {
      const n = Number(v) || 0;
      return `$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    let cfg;

    if (mode === 'comparative') {
      const items = Array.isArray(data) ? data : [];
      cfg = {
        type: 'bar',
        data: {
          labels: items.map(it => it.nombre || '—'),
          datasets: [
            { label: 'Sueldo',   data: items.map(it => Number(it.total_sueldo)   || 0), backgroundColor: COLORS.sueldo },
            { label: 'Quincena', data: items.map(it => Number(it.total_quincena) || 0), backgroundColor: COLORS.quincena },
            { label: 'Adelanto', data: items.map(it => Number(it.total_adelanto) || 0), backgroundColor: COLORS.adelanto },
          ],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { stacked: true, beginAtZero: true, ticks: { callback: (v) => fmtMoneyShort(v) } },
            y: { stacked: true },
          },
          plugins: {
            tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtMoneyFull(ctx.raw)}` } },
            legend:  { position: 'bottom' },
          },
        },
      };
    } else {
      /* mode === 'monthly' (default) */
      const items = Array.isArray(data) ? data : [];
      const labels = items.map(it => A ? A.getMonthName(it.mes) : `M${it.mes}`);
      cfg = {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Sueldo',   data: items.map(it => Number(it.total_sueldo)   || 0), backgroundColor: COLORS.sueldo },
            { label: 'Quincena', data: items.map(it => Number(it.total_quincena) || 0), backgroundColor: COLORS.quincena },
            { label: 'Adelanto', data: items.map(it => Number(it.total_adelanto) || 0), backgroundColor: COLORS.adelanto },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { stacked: true },
            y: { stacked: true, beginAtZero: true, ticks: { callback: (v) => fmtMoneyShort(v) } },
          },
          plugins: {
            tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtMoneyFull(ctx.raw)}` } },
            legend:  { position: 'bottom' },
          },
        },
      };
    }

    try {
      chartRef.current = new window.Chart(canvasRef.current.getContext('2d'), cfg);
    } catch (err) {
      console.error('[HistorialChart] error:', err);
    }

    return () => {
      if (chartRef.current) {
        try { chartRef.current.destroy(); } catch (_) {}
        chartRef.current = null;
      }
    };
  }, [mode, data]);

  return (
    <div className="historial-chart-container" style={{ height: height || 240 }}>
      <canvas ref={canvasRef}/>
    </div>
  );
}

window.HistorialChart = HistorialChart;
