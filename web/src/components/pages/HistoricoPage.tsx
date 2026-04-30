import { useState } from 'react';
import { Icon } from '@/components/shared/Icon';
import { useToast } from '@/components/shared/Toast';
import { useChannels } from '@macario/shared/hooks/useChannels';
import { useSkuCatalog } from '@macario/shared/hooks/useCatalog';
import { useHistoricoMes, useHistoricoDia } from '@macario/shared/hooks/useHistorico';

const WEEKDAYS = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'];

export function HistoricoPage() {
  const toast = useToast();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [canal, setCanal] = useState('todos');
  const [skuF, setSkuF] = useState('todos');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [selDay, setSelDay] = useState<string | null>(null);

  const { data: channels = [] } = useChannels();
  const { data: skus = [] } = useSkuCatalog();
  const { data: histRows = [] } = useHistoricoMes({ year, month, channelId: canal, sku: skuF });
  const { data: detalleLogs = [] } = useHistoricoDia(selDay, skuF);

  // Agregar por fecha (sumando todos los canales del día si filtro = 'todos')
  const daysMap = new Map<string, number>();
  for (const r of histRows) {
    if (!r.fecha) continue;
    if (desde && r.fecha < desde) continue;
    if (hasta && r.fecha > hasta) continue;
    daysMap.set(r.fecha, (daysMap.get(r.fecha) ?? 0) + (r.unidades ?? 0));
  }

  // KPIs con guards
  const totalMes = Array.from(daysMap.values()).reduce((s, n) => s + n, 0);
  const diasActivos = daysMap.size;
  const promedio = diasActivos > 0 ? Math.round(totalMes / diasActivos) : 0;
  const mejorDia = daysMap.size > 0 ? Math.max(...daysMap.values()) : 0;

  // Construir grid de calendario
  const first = new Date(year, month, 1);
  const startW = first.getDay() === 0 ? 6 : first.getDay() - 1;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const days: ({ d: number; key: string; prod: number } | null)[] = [];
  for (let i = 0; i < startW; i++) days.push(null);
  for (let d = 1; d <= lastDay; d++) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    days.push({ d, key, prod: daysMap.get(key) ?? 0 });
  }

  const monthName = new Date(year, month, 1).toLocaleDateString('es-AR', {
    month: 'long',
    year: 'numeric',
  });

  const prevMonth = () => {
    if (month === 0) {
      setYear(y => y - 1);
      setMonth(11);
    } else {
      setMonth(m => m - 1);
    }
    setSelDay(null);
  };
  const nextMonth = () => {
    if (month === 11) {
      setYear(y => y + 1);
      setMonth(0);
    } else {
      setMonth(m => m + 1);
    }
    setSelDay(null);
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Histórico de producción</div>
          <div className="page-sub">Vista mensual · clic en un día para ver detalle</div>
        </div>
        <button className="btn-ghost" onClick={() => toast.info('Generando reporte...')}>
          <Icon n="download" s={13}/> Exportar
        </button>
      </div>

      {/* Filtros */}
      <div className="filter-bar">
        <select className="filter-select" value={canal} onChange={e => setCanal(e.target.value)}>
          <option value="todos">Todos los canales</option>
          {channels.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <select className="filter-select" value={skuF} onChange={e => setSkuF(e.target.value)}>
          <option value="todos">Todos los SKU</option>
          {skus.map(s => <option key={s.sku} value={s.sku}>{s.sku} — {s.modelo}</option>)}
        </select>
        <input type="date" className="filter-select" value={desde} onChange={e => setDesde(e.target.value)} placeholder="Desde"/>
        <input type="date" className="filter-select" value={hasta} onChange={e => setHasta(e.target.value)} placeholder="Hasta"/>
      </div>

      {/* KPIs */}
      <div className="kpi-grid">
        <div className="stat-card">
          <div style={{fontSize:9, fontWeight:700, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--ink-muted)', marginBottom:6}}>Total mes</div>
          <div style={{fontFamily:'var(--mono)', fontSize:32, fontWeight:700, letterSpacing:'-.04em', lineHeight:1}}>{totalMes}</div>
          <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:6, fontWeight:500}}>unidades producidas</div>
        </div>
        <div className="stat-card">
          <div style={{fontSize:9, fontWeight:700, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--ink-muted)', marginBottom:6}}>Días activos</div>
          <div style={{fontFamily:'var(--mono)', fontSize:32, fontWeight:700, letterSpacing:'-.04em', lineHeight:1}}>{diasActivos}</div>
          <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:6, fontWeight:500}}>con producción</div>
        </div>
        <div className="stat-card">
          <div style={{fontSize:9, fontWeight:700, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--ink-muted)', marginBottom:6}}>Promedio/día</div>
          <div style={{fontFamily:'var(--mono)', fontSize:32, fontWeight:700, letterSpacing:'-.04em', lineHeight:1}}>{promedio}</div>
          <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:6, fontWeight:500}}>uds. promedio</div>
        </div>
        <div className="stat-card">
          <div style={{fontSize:9, fontWeight:700, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--ink-muted)', marginBottom:6}}>Mejor día</div>
          <div style={{fontFamily:'var(--mono)', fontSize:32, fontWeight:700, letterSpacing:'-.04em', lineHeight:1}}>{mejorDia}</div>
          <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:6, fontWeight:500}}>uds. en un día</div>
        </div>
      </div>

      {/* Calendario */}
      <div className="card" style={{marginTop:14}}>
        <div className="card-header">
          <div className="card-title" style={{textTransform:'capitalize'}}>{monthName}</div>
          <div style={{display:'flex', gap:6}}>
            <button className="btn-ghost" style={{padding:'5px 10px'}} onClick={prevMonth}><Icon n="arrow-left" s={12}/></button>
            <button className="btn-ghost" style={{padding:'5px 10px'}} onClick={nextMonth}><Icon n="arrow-right" s={12}/></button>
          </div>
        </div>
        <div style={{padding:'18px 22px 22px'}}>
          <div className="cal-grid">
            {WEEKDAYS.map(w => <div key={w} className="cal-header-cell">{w}</div>)}
            {days.map((d, i) => d === null ? (
              <div key={`e-${i}`} className="cal-day empty"/>
            ) : d.prod > 0 ? (
              <div
                key={d.d}
                className={`cal-day has-prod ${selDay === d.key ? 'sel' : ''}`}
                onClick={() => setSelDay(d.key)}
                style={{cursor: 'pointer'}}
              >
                <span className="cal-day-num">{d.d}</span>
                <span className="cal-day-units">{d.prod}</span>
              </div>
            ) : (
              <div key={d.d} className="cal-day"><span className="cal-day-num">{d.d}</span></div>
            ))}
          </div>
        </div>
      </div>

      {/* Detalle del día */}
      {selDay && (
        <div className="card" style={{marginTop:14}}>
          <div className="card-header">
            <div className="card-title">Detalle del {selDay}</div>
            <button className="btn-ghost" style={{padding:'5px 10px', fontSize:10}} onClick={() => setSelDay(null)}>
              <Icon n="x" s={11}/> Cerrar
            </button>
          </div>
          {detalleLogs.length === 0 ? (
            <div className="empty" style={{padding:32}}>
              <Icon n="package" s={26} c="var(--ink-faint)"/>
              <div style={{fontSize:12, color:'var(--ink-muted)'}}>Sin registros para este día</div>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr><th>Hora</th><th>SKU</th><th>Canal</th><th>Sector</th><th style={{textAlign:'right'}}>Uds.</th></tr>
              </thead>
              <tbody>
                {detalleLogs.map(l => {
                  const ch = channels.find(c => c.id === l.channel_id);
                  return (
                    <tr key={l.id}>
                      <td style={{fontFamily:'var(--mono)', fontSize:11, color:'var(--ink-muted)'}}>{l.hora.slice(0, 5)}</td>
                      <td><span className="order-num">{l.sku}</span></td>
                      <td style={{fontSize:11}}>{ch?.label ?? l.channel_id}</td>
                      <td style={{fontSize:11, color:'var(--ink-soft)'}}>{l.sector}</td>
                      <td style={{textAlign:'right'}}><span className="cell-color-num">{l.cantidad}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
