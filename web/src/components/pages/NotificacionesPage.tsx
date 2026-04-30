import { Icon } from '@/components/shared/Icon';
import { useNotifications, useMarkAllRead } from '@/hooks/useNotifications';
import { fmt } from '@/lib/fmt';

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
          <div className="page-sub">{unread} sin leer · {items.length} en total</div>
        </div>
        <button
          className="btn-ghost"
          onClick={() => markAll.mutate()}
          disabled={markAll.isPending || unread === 0}
        >
          <Icon n="check" s={13}/> Marcar todo como leído
        </button>
      </div>

      <div className="card">
        {items.length === 0 ? (
          <div className="empty">
            <Icon n="bell" s={26} c="var(--ink-faint)"/>
            <div style={{fontSize:12, color:'var(--ink-muted)'}}>No tenés notificaciones todavía.</div>
          </div>
        ) : items.map(n => (
          <div key={n.id} style={{
            display:'flex', gap:14, padding:'16px 22px', borderBottom:'1px solid var(--border)',
            background: n.leida ? 'var(--paper)' : 'var(--paper-off)',
          }}>
            <div style={{
              width:32, height:32, borderRadius:6,
              background: `${COLORS[n.tipo]}1a`, color: COLORS[n.tipo],
              display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
            }}>
              <Icon n={ICONS[n.tipo]} s={16}/>
            </div>
            <div style={{flex:1, minWidth:0}}>
              <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:3}}>
                <div style={{fontSize:13, fontWeight: n.leida?500:700}}>{n.titulo}</div>
                {!n.leida && <span style={{width:7, height:7, borderRadius:'50%', background: COLORS[n.tipo]}}/>}
              </div>
              <div style={{fontSize:12, color:'var(--ink-soft)', marginBottom:4}}>{n.mensaje}</div>
              <div style={{fontSize:10, color:'var(--ink-muted)', fontWeight:600}}>{fmt.agoSimple(n.created_at)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
