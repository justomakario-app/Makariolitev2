import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Icon } from '@/components/shared/Icon';
import { useToast } from '@/components/shared/Toast';
import { ConfirmModal } from '@/components/shared/Modal';
import { ProduceModal } from '@/components/modals/ProduceModal';
import { useChannel } from '@macario/shared/hooks/useChannels';
import { useCarrierTable, useCarrierOrders, useCloseJornada } from '@macario/shared/hooks/useCarrier';
import { fmt } from '@macario/shared/lib/fmt';

export function CarrierPage() {
  const { canal } = useParams<{ canal: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const channelId = canal ?? 'colecta';
  const { data: channel } = useChannel(channelId);
  const { data: rows = [] } = useCarrierTable(channelId);
  const { data: orders = [] } = useCarrierOrders(channelId);
  const closeJ = useCloseJornada();

  const [produceCtx, setProduceCtx] = useState<{ open: boolean; sku?: string }>({ open: false });
  const [confirmCierre, setConfirmCierre] = useState(false);
  const [showOrders, setShowOrders] = useState(false);

  if (!channel) {
    return <div className="page"><div className="empty"><span className="loader"/></div></div>;
  }

  const totalUnidades = rows.reduce((s, r) => s + (r.pedido ?? 0), 0);
  const faltanteTotal = rows.reduce((s, r) => s + (r.faltante ?? 0), 0);
  const activos = rows.filter(r => (r.faltante ?? 0) > 0).length;
  const allDone = faltanteTotal === 0 && activos === 0 && rows.length > 0;
  const esHorario = channel.tipo_cierre === 'horario';

  // Countdown
  let countdown: string | null = null;
  let vencida = false;
  if (esHorario && channel.cierre_hora) {
    const [h, m] = channel.cierre_hora.split(':').map(Number);
    const cierre = new Date();
    cierre.setHours(h, m, 0, 0);
    const diff = cierre.getTime() - Date.now();
    if (diff > 0) {
      const hh = Math.floor(diff / 3_600_000);
      const mm = Math.floor((diff % 3_600_000) / 60_000);
      countdown = `${hh}h ${mm}m`;
    } else {
      vencida = true;
    }
  }

  const onCloseJornada = async () => {
    try {
      await closeJ.mutateAsync({ channel_id: channelId });
      toast.success('Jornada cerrada · snapshot guardado');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="page">
      {/* Header */}
      <div style={{display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14}}>
        <button
          className="btn-ghost"
          onClick={() => navigate('/')}
          style={{padding: '8px 10px', minHeight: 38}}
          aria-label="Volver"
        >
          <Icon n="arrow-left" s={16}/>
        </button>
        <div style={{
          width: 36, height: 36, background: channel.bg, color: channel.color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 8, flexShrink: 0,
        }}>
          <Icon n={channelId === 'colecta' ? 'truck' : channelId === 'flex' ? 'package' : channelId === 'tiendanube' ? 'box' : 'users'} s={18}/>
        </div>
        <div style={{flex: 1, minWidth: 0}}>
          <div style={{fontSize: 18, fontWeight: 800, letterSpacing: '-.02em'}}>{channel.label}</div>
          <div style={{fontSize: 11, color: 'var(--ink-muted)', fontWeight: 600}}>{channel.sub}</div>
        </div>
      </div>

      {/* Banner contextual */}
      {allDone ? (
        <div style={{
          padding: '12px 14px', marginBottom: 14, borderRadius: 8,
          background: 'var(--green-bg)', border: '1px solid rgba(22,163,74,0.3)',
          color: 'var(--green)', fontSize: 12, fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Icon n="check-circle" s={16}/>
          Todos los pedidos están al día.
        </div>
      ) : esHorario && vencida ? (
        <div style={{
          padding: '12px 14px', marginBottom: 14, borderRadius: 8,
          background: 'var(--red-bg)', border: '1px solid rgba(220,38,38,0.32)',
          color: 'var(--red)', fontSize: 12, fontWeight: 600,
          display: 'flex', alignItems: 'flex-start', gap: 8,
        }}>
          <Icon n="alert" s={16}/>
          <span><strong>Vencida</strong> — el cierre era {channel.cierre_hora?.slice(0, 5)}. Cerrá ahora.</span>
        </div>
      ) : esHorario && countdown ? (
        <div style={{
          padding: '12px 14px', marginBottom: 14, borderRadius: 8,
          background: '#fff8e6', border: '1px solid rgba(217,119,6,0.32)',
          color: '#92400e', fontSize: 12, fontWeight: 600,
          display: 'flex', alignItems: 'flex-start', gap: 8,
        }}>
          <Icon n="clock" s={16}/>
          <span>Cierra <strong>{channel.cierre_hora?.slice(0, 5)}</strong> · faltan <strong>{countdown}</strong></span>
        </div>
      ) : null}

      {/* KPIs */}
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14}}>
        <div style={{background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, borderLeft: `3px solid ${channel.color}`}}>
          <div style={{fontSize: 9, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-muted)', marginBottom: 4}}>Activos</div>
          <div style={{fontSize: 20, fontWeight: 800, fontFamily: 'var(--mono)'}}>{activos}</div>
        </div>
        <div style={{background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 8, padding: 10}}>
          <div style={{fontSize: 9, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-muted)', marginBottom: 4}}>Unidades</div>
          <div style={{fontSize: 20, fontWeight: 800, fontFamily: 'var(--mono)'}}>{totalUnidades}</div>
        </div>
        <div style={{background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, borderLeft: faltanteTotal > 0 ? '3px solid var(--red)' : '3px solid var(--green)'}}>
          <div style={{fontSize: 9, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-muted)', marginBottom: 4}}>Faltante</div>
          <div style={{fontSize: 20, fontWeight: 800, fontFamily: 'var(--mono)', color: faltanteTotal > 0 ? 'var(--red)' : 'var(--green)'}}>{faltanteTotal}</div>
        </div>
      </div>

      {/* Lista de SKUs */}
      {rows.length === 0 ? (
        <div className="card" style={{padding: 32}}>
          <div className="empty">
            <Icon n="package" s={32} c="var(--ink-faint)"/>
            <div style={{fontSize: 13, fontWeight: 700}}>Sin pedidos activos</div>
            <div style={{fontSize: 11, color: 'var(--ink-muted)', textAlign: 'center'}}>Importá un Excel para empezar.</div>
            <button
              className="btn-ghost"
              onClick={() => navigate('/importar')}
              style={{marginTop: 8}}
            >
              <Icon n="upload" s={14}/> Importar Excel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '.1em',
            textTransform: 'uppercase', color: 'var(--ink-muted)',
            marginBottom: 8,
          }}>Pendiente por SKU</div>

          <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
            {rows.map(r => (
              <div
                key={r.sku ?? ''}
                style={{
                  background: 'var(--paper)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: 12,
                }}
              >
                <div style={{display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8}}>
                  <div style={{flex: 1, minWidth: 0}}>
                    <span className="order-num" style={{fontSize: 12}}>{r.sku}</span>
                    <div style={{fontSize: 13, fontWeight: 600, marginTop: 2}}>{r.modelo}</div>
                    {r.color && r.color !== '—' && (
                      <div style={{fontSize: 10, color: 'var(--ink-muted)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 5}}>
                        <span style={{width: 8, height: 8, borderRadius: '50%', background: r.color_hex ?? (r.color === 'Negro' ? '#1a1a1a' : '#fff'), border: '1px solid #d4cdc1'}}/>
                        {r.color}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{display: 'flex', gap: 12, fontSize: 11, marginBottom: 8}}>
                  <span><span style={{color: 'var(--ink-muted)'}}>Pedido:</span> <strong style={{fontFamily: 'var(--mono)'}}>{r.pedido}</strong></span>
                  <span><span style={{color: 'var(--ink-muted)'}}>Producido:</span> <strong style={{fontFamily: 'var(--mono)', color: 'var(--green)'}}>{r.producido}</strong></span>
                  <span style={{marginLeft: 'auto'}}>
                    <span style={{color: 'var(--ink-muted)'}}>Falta:</span>{' '}
                    <strong style={{fontFamily: 'var(--mono)', fontSize: 14, color: (r.faltante ?? 0) > 0 ? 'var(--red)' : 'var(--green)'}}>{r.faltante}</strong>
                  </span>
                </div>
                {(r.faltante ?? 0) > 0 && (
                  <button
                    className="btn-primary"
                    onClick={() => setProduceCtx({ open: true, sku: r.sku ?? undefined })}
                    style={{justifyContent: 'center', width: '100%'}}
                  >
                    <Icon n="plus" s={14}/> Producir {r.faltante} uds
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Pedidos individuales (collapsible) */}
          <div style={{marginTop: 14}}>
            <button
              onClick={() => setShowOrders(o => !o)}
              style={{
                width: '100%', padding: '12px 14px',
                background: 'var(--paper)', border: '1px solid var(--border)',
                borderRadius: 8, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                fontSize: 12, fontWeight: 700,
              }}
            >
              <span>Pedidos individuales · {orders.length}</span>
              <Icon n={showOrders ? 'chev-down' : 'chev-right'} s={14}/>
            </button>
            {showOrders && (
              <div style={{marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6}}>
                {orders.map(o => (
                  <div key={o.id} style={{
                    background: 'var(--paper-off)',
                    border: '1px solid var(--border)',
                    borderRadius: 6, padding: 10,
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <span className="order-num" style={{fontSize: 10, flexShrink: 0}}>{o.order_number}</span>
                    <div style={{flex: 1, minWidth: 0, fontSize: 11}}>
                      <div style={{fontWeight: 600}}>{o.cliente ?? '—'}</div>
                      <div style={{color: 'var(--ink-muted)', fontFamily: 'var(--mono)', marginTop: 1}}>{o.sku} · {fmt.date(o.fecha_pedido)}</div>
                    </div>
                    <div style={{fontSize: 14, fontWeight: 700, fontFamily: 'var(--mono)', flexShrink: 0}}>{o.cantidad}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Cerrar jornada */}
          {esHorario && (
            <button
              onClick={() => setConfirmCierre(true)}
              disabled={closeJ.isPending}
              className="btn-success"
              style={{
                width: '100%', justifyContent: 'center',
                marginTop: 16, minHeight: 50,
                background: vencida ? 'var(--red)' : undefined,
              }}
            >
              <Icon n="lock" s={14}/>
              {vencida ? 'Cerrar jornada (vencida)' : 'Cerrar jornada'}
            </button>
          )}
        </>
      )}

      <ProduceModal
        open={produceCtx.open}
        defaultSku={produceCtx.sku}
        defaultChannelId={channelId}
        onClose={() => setProduceCtx({ open: false })}
      />
      <ConfirmModal
        open={confirmCierre}
        title={`Cerrar jornada — ${channel.label}`}
        message="Vas a archivar pedidos completados y arrastrar el faltante al día siguiente. Acción atómica, no se deshace."
        confirmText="Confirmar cierre"
        onConfirm={onCloseJornada}
        onClose={() => setConfirmCierre(false)}
      />
    </div>
  );
}
