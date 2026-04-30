import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/shared/Icon';
import { useDashboardKpis } from '@macario/shared/hooks/useDashboard';

export function DashboardPage() {
  const { data: kpis, isLoading } = useDashboardKpis();
  const navigate = useNavigate();

  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (isLoading) return <div className="page"><div className="empty"><span className="loader"/></div></div>;

  const total = (kpis ?? []).reduce((acc, k) => acc + (k.unidades_activas ?? 0), 0);
  const faltanteTotal = (kpis ?? []).reduce((acc, k) => acc + (k.faltante_total ?? 0), 0);
  const producidoHoyTotal = (kpis ?? []).reduce((acc, k) => acc + (k.producido_hoy ?? 0), 0);

  const fechaTxt = now.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
  const horaTxt = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: true });

  return (
    <div className="page">
      <div className="page-header" style={{marginBottom:18}}>
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-sub">Vista general de canales y producción</div>
        </div>
        <div style={{
          display:'flex', alignItems:'center', gap:10,
          fontFamily:'var(--font-mono)', fontSize:11, fontWeight:700,
          letterSpacing:'.08em', color:'var(--ink-soft)',
        }}>
          <span style={{
            display:'inline-flex', alignItems:'center', gap:6,
            padding:'5px 10px', background:'var(--green-bg)',
            border:'1px solid rgba(22,163,74,.25)', borderRadius:4, color:'var(--green)',
          }}>
            <span style={{
              width:6, height:6, borderRadius:'50%', background:'var(--green)',
              animation:'live-pulse 1.4s ease-in-out infinite',
            }}/>
            EN VIVO
          </span>
          <span>{horaTxt.toUpperCase()}</span>
        </div>
      </div>

      <div className="dash-hero">
        <div className="dash-hero-grid"/>
        <div className="dash-hero-glow"/>
        <div className="dash-hero-left">
          <div className="dash-hero-number">{total}</div>
          <div className="dash-hero-meta">
            <div className="dash-hero-label"><span className="dash-hero-dot"/>Ventas activas</div>
            <div className="dash-hero-date">{(`${fechaTxt} · ${horaTxt}`).toUpperCase()}</div>
          </div>
        </div>
        <div className="dash-hero-right">
          <div className="dash-hero-stat">
            <span className="dash-hero-stat-label">Pendientes</span>
            <span className="dash-hero-stat-val">{faltanteTotal}</span>
          </div>
          <div className="dash-hero-stat">
            <span className="dash-hero-stat-label">Producidos hoy</span>
            <span className="dash-hero-stat-val">{producidoHoyTotal}</span>
          </div>
        </div>
      </div>

      <div className="channel-grid">
        {(kpis ?? []).map(k => {
          const empty = (k.unidades_activas ?? 0) === 0;
          return (
            <div
              key={k.channel_id ?? ''}
              className="channel-card"
              onClick={() => navigate(`/canal/${k.channel_id}`)}
              style={{cursor:'pointer'}}
            >
              <div style={{position:'absolute', top:0, left:0, right:0, height:3, background: k.color ?? '#888'}}/>
              <div className="channel-card-label" style={{color: k.color ?? '#888'}}>
                {k.label ?? k.channel_id}
              </div>
              <div className="channel-card-num" style={{color: empty ? 'var(--ink-faint)' : 'var(--ink)'}}>
                {empty ? <Icon n="package" s={48} c="var(--ink-faint)"/> : k.unidades_activas}
              </div>
              <div className="channel-card-sub">
                {k.tipo_cierre === 'horario' && k.cierre_hora
                  ? `Cierre ${k.cierre_hora.slice(0,5)} hs`
                  : 'Sin cierre obligatorio'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
