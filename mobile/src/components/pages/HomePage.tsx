import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/shared/Icon';
import { useDashboardKpis } from '@macario/shared/hooks/useDashboard';
import { useCurrentProfile } from '@macario/shared/hooks/useAuth';

const CHANNEL_ICONS = {
  colecta: 'truck',
  flex: 'package',
  tiendanube: 'box',
  distribuidor: 'users',
} as const;

export function HomePage() {
  const { data: kpis, isLoading } = useDashboardKpis();
  const { data: profileData } = useCurrentProfile();
  const navigate = useNavigate();
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (isLoading) {
    return <div className="page"><div className="empty"><span className="loader"/></div></div>;
  }

  const total = (kpis ?? []).reduce((acc, k) => acc + (k.unidades_activas ?? 0), 0);
  const faltanteTotal = (kpis ?? []).reduce((acc, k) => acc + (k.faltante_total ?? 0), 0);
  const producidoHoy = (kpis ?? []).reduce((acc, k) => acc + (k.producido_hoy ?? 0), 0);

  const fechaTxt = now.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
  const horaTxt = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: true });

  const profile = profileData?.profile;
  const greeting = profile ? `Hola, ${profile.name.split(' ')[0]}` : 'Macario Lite';

  return (
    <div className="page">
      {/* Header con saludo + reloj live */}
      <div style={{marginBottom: 14}}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 4,
        }}>
          <div style={{fontSize: 18, fontWeight: 800, letterSpacing: '-.02em'}}>{greeting}</div>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '4px 8px', background: 'var(--green-bg)',
            border: '1px solid rgba(22,163,74,.25)', borderRadius: 4,
            color: 'var(--green)', fontSize: 9, fontWeight: 700,
            letterSpacing: '.08em', fontFamily: 'var(--mono)',
          }}>
            <span style={{
              width: 5, height: 5, borderRadius: '50%', background: 'var(--green)',
              animation: 'live-pulse 1.4s ease-in-out infinite',
            }}/>
            EN VIVO
          </span>
        </div>
        <div style={{fontSize: 11, color: 'var(--ink-muted)', textTransform: 'capitalize'}}>
          {fechaTxt} · {horaTxt}
        </div>
      </div>

      {/* Hero compacto */}
      <div style={{
        background: '#080808',
        borderRadius: 14,
        padding: 22,
        marginBottom: 14,
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: `
            linear-gradient(rgba(255,255,255,.02) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,.02) 1px, transparent 1px)
          `,
          backgroundSize: '24px 24px',
          pointerEvents: 'none',
        }}/>
        <div style={{position: 'relative', zIndex: 1}}>
          <div style={{
            fontSize: 9, fontWeight: 800, letterSpacing: '.18em',
            textTransform: 'uppercase', color: 'rgba(255,255,255,.4)',
            marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%', background: '#6366f1',
              animation: 'heroPulse 2s infinite',
            }}/>
            Ventas activas
          </div>
          <div style={{
            fontSize: 'clamp(48px, 14vw, 72px)',
            fontWeight: 800, letterSpacing: '-.045em',
            color: '#fff', lineHeight: 1,
            textShadow: '0 0 40px rgba(99,102,241,.25)',
          }}>{total}</div>
          <div style={{
            display: 'flex', gap: 16, marginTop: 14,
            color: 'rgba(255,255,255,.7)',
          }}>
            <div>
              <div style={{fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,.42)'}}>Pendientes</div>
              <div style={{fontSize: 18, fontWeight: 800, color: '#fff', marginTop: 2, fontFamily: 'var(--mono)'}}>{faltanteTotal}</div>
            </div>
            <div>
              <div style={{fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,.42)'}}>Producidos hoy</div>
              <div style={{fontSize: 18, fontWeight: 800, color: '#fff', marginTop: 2, fontFamily: 'var(--mono)'}}>{producidoHoy}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Grid 2x2 de canales (con touch targets grandes) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 10,
      }}>
        {(kpis ?? []).map(k => {
          const empty = (k.unidades_activas ?? 0) === 0;
          const channelKey = (k.channel_id ?? '') as keyof typeof CHANNEL_ICONS;
          const iconName = CHANNEL_ICONS[channelKey] ?? 'box';
          return (
            <button
              key={k.channel_id ?? ''}
              onClick={() => navigate(`/canal/${k.channel_id}`)}
              style={{
                background: 'var(--paper)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: '16px 14px',
                textAlign: 'left',
                cursor: 'pointer',
                position: 'relative',
                overflow: 'hidden',
                minHeight: 130,
                display: 'flex', flexDirection: 'column',
                gap: 8, justifyContent: 'space-between',
              }}
            >
              <div style={{position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: k.color ?? '#888'}}/>
              <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4}}>
                <div style={{fontSize: 9, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: k.color ?? '#888'}}>
                  {k.label}
                </div>
                <Icon n={iconName} s={14} c={k.color ?? '#888'}/>
              </div>
              <div>
                <div style={{
                  fontSize: 32, fontWeight: 900, letterSpacing: '-.04em',
                  color: empty ? 'var(--ink-faint)' : 'var(--ink)',
                  fontFamily: 'var(--mono)',
                }}>
                  {empty ? '—' : k.unidades_activas}
                </div>
                <div style={{fontSize: 10, color: 'var(--ink-muted)', marginTop: 2}}>
                  {k.tipo_cierre === 'horario' && k.cierre_hora
                    ? `Cierra ${k.cierre_hora.slice(0, 5)}`
                    : 'Sin cierre'}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
