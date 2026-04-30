import { useState, useEffect } from 'react';
import { Icon } from '@/components/shared/Icon';
import { ProduceModal } from '@/components/modals/ProduceModal';
import { supabase } from '@macario/shared/lib/supabase';
import { queryClient } from '@macario/shared/lib/queryClient';
import { useChannels } from '@macario/shared/hooks/useChannels';
import { useQuery } from '@tanstack/react-query';
import type { Database } from '@macario/shared/types/database.types';

type CarrierMeta = Database['public']['Views']['view_carrier_with_meta']['Row'];

function useAllCarriers() {
  useEffect(() => {
    const ch = supabase.channel('mobile-all-carriers')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'carrier_state' },
        () => queryClient.invalidateQueries({ queryKey: ['mobile-all-carriers'] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);
  return useQuery({
    queryKey: ['mobile-all-carriers'],
    queryFn: async (): Promise<CarrierMeta[]> => {
      const { data, error } = await supabase
        .from('view_carrier_with_meta')
        .select('*')
        .order('faltante', { ascending: false })
        .order('sku');
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function ProduccionPage() {
  const { data: rows = [] } = useAllCarriers();
  const { data: channels = [] } = useChannels();
  const [tab, setTab] = useState<string>('pendientes');
  const [produceCtx, setProduceCtx] = useState<{ open: boolean; sku?: string; channelId?: string }>({ open: false });

  // Tabs: "Pendientes" (todos los con faltante>0) + uno por canal
  const filtered = rows.filter(r => {
    if (tab === 'pendientes') return (r.faltante ?? 0) > 0;
    return r.channel_id === tab;
  });

  const totalPendiente = rows.reduce((s, r) => s + (r.faltante ?? 0), 0);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Producción</div>
          <div className="page-sub">
            {totalPendiente > 0 ? `${totalPendiente} unidades pendientes` : 'Todo al día ✓'}
          </div>
        </div>
      </div>

      {/* Tabs scroll horizontal */}
      <div style={{
        display: 'flex',
        gap: 6,
        overflowX: 'auto',
        marginBottom: 14,
        paddingBottom: 4,
      }}>
        <button
          onClick={() => setTab('pendientes')}
          style={{
            padding: '8px 14px',
            background: tab === 'pendientes' ? 'var(--ink)' : 'var(--paper)',
            color: tab === 'pendientes' ? '#fff' : 'var(--ink-soft)',
            border: `1px solid ${tab === 'pendientes' ? 'var(--ink)' : 'var(--border)'}`,
            borderRadius: 20,
            fontSize: 12, fontWeight: 700,
            whiteSpace: 'nowrap',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          Pendientes
        </button>
        {channels.map(c => (
          <button
            key={c.id}
            onClick={() => setTab(c.id)}
            style={{
              padding: '8px 14px',
              background: tab === c.id ? c.color : 'var(--paper)',
              color: tab === c.id ? '#fff' : 'var(--ink-soft)',
              border: `1px solid ${tab === c.id ? c.color : 'var(--border)'}`,
              borderRadius: 20,
              fontSize: 12, fontWeight: 700,
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              flexShrink: 0,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            <span style={{width: 6, height: 6, borderRadius: '50%', background: c.color, opacity: tab === c.id ? 0 : 1}}/>
            {c.label}
          </button>
        ))}
      </div>

      {/* Lista de SKUs */}
      {filtered.length === 0 ? (
        <div className="card" style={{padding: 32}}>
          <div className="empty">
            <Icon n="check-circle" s={32} c="var(--green)"/>
            <div style={{fontSize: 14, fontWeight: 700, color: 'var(--ink)'}}>
              {tab === 'pendientes' ? '¡Todo al día!' : 'Sin pedidos en este canal'}
            </div>
            <div style={{fontSize: 12, color: 'var(--ink-muted)'}}>
              {tab === 'pendientes' ? 'No hay nada que producir.' : 'Sin SKUs activos.'}
            </div>
          </div>
        </div>
      ) : (
        <div style={{display: 'flex', flexDirection: 'column', gap: 8}}>
          {filtered.map((r, i) => {
            const ch = channels.find(c => c.id === r.channel_id);
            return (
              <div
                key={`${r.sku}-${r.channel_id}-${i}`}
                style={{
                  background: 'var(--paper)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: 14,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                {/* Header del card */}
                <div style={{display: 'flex', alignItems: 'flex-start', gap: 10}}>
                  <div style={{flex: 1, minWidth: 0}}>
                    <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4}}>
                      <span className="order-num" style={{fontSize: 12}}>{r.sku}</span>
                      {ch && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '2px 7px',
                          borderRadius: 10,
                          background: `${ch.color}1a`, color: ch.color,
                          textTransform: 'uppercase', letterSpacing: '.06em',
                        }}>{ch.label}</span>
                      )}
                    </div>
                    <div style={{fontSize: 13, fontWeight: 600, color: 'var(--ink)'}}>{r.modelo}</div>
                    {r.color && r.color !== '—' && (
                      <div style={{
                        fontSize: 11, color: 'var(--ink-muted)', marginTop: 2,
                        display: 'flex', alignItems: 'center', gap: 5,
                      }}>
                        <span style={{
                          width: 8, height: 8, borderRadius: '50%',
                          background: r.color_hex ?? (r.color === 'Negro' ? '#1a1a1a' : '#fff'),
                          border: '1px solid #d4cdc1', display: 'inline-block',
                        }}/>
                        {r.color}
                      </div>
                    )}
                  </div>
                </div>

                {/* Métricas inline */}
                <div style={{display: 'flex', gap: 14, fontSize: 11}}>
                  <div>
                    <span style={{color: 'var(--ink-muted)'}}>Pedido: </span>
                    <strong style={{fontFamily: 'var(--mono)'}}>{r.pedido}</strong>
                  </div>
                  <div>
                    <span style={{color: 'var(--ink-muted)'}}>Producido: </span>
                    <strong style={{fontFamily: 'var(--mono)', color: 'var(--green)'}}>{r.producido}</strong>
                  </div>
                  <div style={{marginLeft: 'auto'}}>
                    <span style={{color: 'var(--ink-muted)'}}>Falta: </span>
                    <strong style={{
                      fontFamily: 'var(--mono)', fontSize: 14,
                      color: (r.faltante ?? 0) > 0 ? 'var(--red)' : 'var(--green)',
                    }}>
                      {r.faltante}
                    </strong>
                  </div>
                </div>

                {/* CTA */}
                {(r.faltante ?? 0) > 0 && (
                  <button
                    className="btn-primary"
                    onClick={() => setProduceCtx({ open: true, sku: r.sku ?? undefined, channelId: r.channel_id ?? undefined })}
                    style={{justifyContent: 'center', width: '100%'}}
                  >
                    <Icon n="plus" s={14}/> Producir {r.faltante} uds
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* FAB para abrir Modal Producir genérico */}
      <button
        className="m-fab"
        onClick={() => setProduceCtx({ open: true })}
        aria-label="Registrar producción"
      >
        <Icon n="plus" s={26}/>
      </button>

      <ProduceModal
        open={produceCtx.open}
        defaultSku={produceCtx.sku}
        defaultChannelId={produceCtx.channelId}
        onClose={() => setProduceCtx({ open: false })}
      />
    </div>
  );
}
