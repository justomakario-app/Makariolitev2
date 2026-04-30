import { Icon } from '@/components/shared/Icon';
import { useNotifications, useMarkAllRead } from '@macario/shared/hooks/useNotifications';
import { fmt } from '@macario/shared/lib/fmt';

const ICONS = {
  stock_critico: 'alert',
  pedido_urgente: 'flame',
  nuevo_pedido: 'box',
  produccion: 'tools',
  sistema: 'info',
} as const;

const COLORS = {
  stock_critico: 'var(--red)',
  pedido_urgente: 'var(--amber)',
  nuevo_pedido: 'var(--blue)',
  produccion: 'var(--green)',
  sistema: 'var(--ink)',
} as const;

export function NotificacionesPage() {
  const { data: items = [] } = useNotifications();
  const markAll = useMarkAllRead();
  const unread = items.filter(n => !n.leida).length;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Notificaciones</div>
          <div className="page-sub">
            {unread > 0 ? `${unread} sin leer` : 'Todo leído'} · {items.length} en total
          </div>
        </div>
      </div>

      {unread > 0 && (
        <button
          className="btn-ghost"
          onClick={() => markAll.mutate()}
          disabled={markAll.isPending}
          style={{width: '100%', justifyContent: 'center', marginBottom: 12}}
        >
          <Icon n="check" s={14}/> Marcar todo como leído
        </button>
      )}

      {items.length === 0 ? (
        <div className="card" style={{padding: 32}}>
          <div className="empty">
            <Icon n="bell" s={32} c="var(--ink-faint)"/>
            <div style={{fontSize: 13, fontWeight: 700}}>Sin notificaciones</div>
            <div style={{fontSize: 11, color: 'var(--ink-muted)'}}>
              Te van a llegar acá cuando haya producción completada, nuevos lotes, o eventos del sistema.
            </div>
          </div>
        </div>
      ) : (
        <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
          {items.map(n => (
            <div
              key={n.id}
              style={{
                background: n.leida ? 'var(--paper)' : 'var(--paper-off)',
                border: `1px solid ${n.leida ? 'var(--border)' : COLORS[n.tipo]}33`,
                borderRadius: 10,
                padding: 14,
                display: 'flex',
                gap: 12,
              }}
            >
              <div style={{
                width: 36, height: 36, borderRadius: 8,
                background: `${COLORS[n.tipo]}1a`, color: COLORS[n.tipo],
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <Icon n={ICONS[n.tipo]} s={18}/>
              </div>
              <div style={{flex: 1, minWidth: 0}}>
                <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3}}>
                  <div style={{fontSize: 13, fontWeight: n.leida ? 500 : 700, flex: 1}}>
                    {n.titulo}
                  </div>
                  {!n.leida && (
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: COLORS[n.tipo], flexShrink: 0,
                    }}/>
                  )}
                </div>
                <div style={{fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.4}}>{n.mensaje}</div>
                <div style={{fontSize: 10, color: 'var(--ink-muted)', fontWeight: 600, marginTop: 6}}>
                  {fmt.agoSimple(n.created_at)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
