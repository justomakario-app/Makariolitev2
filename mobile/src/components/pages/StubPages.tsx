import { Icon } from '@/components/shared/Icon';
import { useLogout, useCurrentProfile } from '@macario/shared/hooks/useAuth';

interface StubProps {
  title: string;
  hint: string;
}

function Stub({ title, hint }: StubProps) {
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">{title}</div>
          <div className="page-sub">Pantalla mobile en construcción</div>
        </div>
      </div>
      <div className="card" style={{padding: 32, marginTop: 12}}>
        <div className="empty">
          <Icon n="info" s={32} c="var(--ink-muted)"/>
          <div style={{fontSize: 14, fontWeight: 700, color: 'var(--ink)'}}>{title}</div>
          <div style={{
            fontSize: 12, color: 'var(--ink-muted)',
            textAlign: 'center', maxWidth: 320, lineHeight: 1.5,
          }}>{hint}</div>
        </div>
      </div>
    </div>
  );
}

// Stubs restantes — los Tier 1 (Home, Producción, Notificaciones) ya están
// implementados en archivos propios. Resto se completa en Fase 6 Tier 2-3.

export function ScanPage() {
  return <Stub title="Escáner QR" hint="Cámara fullscreen + viewfinder con @yudiel/react-qr-scanner. Insert en qr_scans con operario_id auto. Fase 7."/>;
}

export function PerfilPage() {
  const { data } = useCurrentProfile();
  const logout = useLogout();
  const profile = data?.profile;

  if (!profile) return null;

  const initials = profile.name.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Mi Perfil</div>
          <div className="page-sub">Sesión activa</div>
        </div>
      </div>

      <div className="card" style={{padding: 24, display: 'flex', gap: 16, alignItems: 'center', marginTop: 8}}>
        <div style={{
          width: 64, height: 64,
          background: profile.avatar_color ?? 'var(--ink)',
          color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 22, fontWeight: 800,
          borderRadius: 8, flexShrink: 0,
        }}>{initials}</div>
        <div style={{flex: 1, minWidth: 0}}>
          <div style={{fontSize: 16, fontWeight: 700}}>{profile.name}</div>
          <div style={{fontSize: 12, color: 'var(--ink-muted)', fontFamily: 'var(--mono)', marginTop: 2}}>
            @{profile.username}
          </div>
          <div style={{
            marginTop: 6,
            display: 'inline-flex', alignItems: 'center',
            fontSize: 10, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '.08em',
            padding: '3px 10px', borderRadius: 10,
            background: 'var(--paper-dim)', color: 'var(--ink-soft)',
          }}>
            {profile.role}{profile.area ? ' · ' + profile.area : ''}
          </div>
        </div>
      </div>

      <div className="card" style={{marginTop: 12}}>
        <div className="card-header">
          <div className="card-title">Sesión</div>
        </div>
        <div style={{padding: 14}}>
          <button
            className="btn-ghost"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            style={{width: '100%', borderColor: 'var(--red)', color: 'var(--red)', justifyContent: 'center'}}
          >
            <Icon n="logout" s={14}/>
            {logout.isPending ? 'Cerrando…' : 'Cerrar sesión'}
          </button>
        </div>
      </div>

      <div style={{marginTop: 16, padding: 14, fontSize: 11, color: 'var(--ink-muted)', textAlign: 'center'}}>
        Macario Lite Mobile · v 0.1.0
      </div>
    </div>
  );
}

export function CarrierPage() {
  return <Stub title="Canal" hint="Vista por canal con cierre de jornada (Colecta/Flex). Backend listo via useCarrierTable + rpc_close_jornada. Próxima fase."/>;
}

export function HistoricoPage() {
  return <Stub title="Histórico" hint="Calendario mensual + filtros + KPIs. Backend listo via view_historico_dia. Fase 6 Tier 3."/>;
}

export function CatalogoPage() {
  return <Stub title="Catálogo" hint="Lista de SKUs read-only en mobile. Edición via /web. Fase 6 Tier 3."/>;
}

export function EquipoPage() {
  return <Stub title="Equipo" hint="Lista de usuarios read-only. Backend: profiles. Fase 6 Tier 3."/>;
}

export function ImportarPage() {
  return <Stub title="Importar Excel" hint="File picker + SheetJS + sha256 + rpc_import_batch. Sebastián importa desde el celular. Fase 8."/>;
}
