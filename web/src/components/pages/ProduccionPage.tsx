import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '@/components/shared/Icon';
import { ProduceModal } from '@/components/modals/ProduceModal';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { useChannels } from '@/hooks/useChannels';
import { queryClient } from '@/lib/queryClient';
import type { Database } from '@/types/database.types';

type CarrierMeta = Database['public']['Views']['view_carrier_with_meta']['Row'];
type ProdLog = Database['public']['Tables']['production_logs']['Row'];

function useAllCarriers() {
  useEffect(() => {
    const ch = supabase.channel('all-carriers')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'carrier_state' },
        () => queryClient.invalidateQueries({ queryKey: ['all-carriers'] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  return useQuery({
    queryKey: ['all-carriers'],
    queryFn: async (): Promise<CarrierMeta[]> => {
      const { data, error } = await supabase
        .from('view_carrier_with_meta')
        .select('*')
        .order('channel_id')
        .order('sku');
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useTodayLogs() {
  const today = new Date().toISOString().slice(0,10);
  return useQuery({
    queryKey: ['production-logs', today],
    queryFn: async (): Promise<ProdLog[]> => {
      const { data, error } = await supabase
        .from('production_logs')
        .select('*')
        .eq('fecha', today)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function ProduccionPage() {
  const [params] = useSearchParams();
  const { data: rows = [] } = useAllCarriers();
  const { data: channels = [] } = useChannels();
  const { data: logs = [] } = useTodayLogs();
  const [tab, setTab] = useState('todos');
  const [showProduce, setShowProduce] = useState(params.get('registrar') === '1');

  const filtered = tab === 'todos' ? rows : rows.filter(r => r.channel_id === tab);

  const totalPedido = rows.reduce((s, r) => s + (r.pedido ?? 0), 0);
  const totalProd = rows.reduce((s, r) => s + (r.producido ?? 0), 0);
  const totalFalt = rows.reduce((s, r) => s + (r.faltante ?? 0), 0);
  const producidoHoy = logs.reduce((s, l) => s + l.cantidad, 0);
  const pct = totalPedido > 0 ? Math.round((totalProd / totalPedido) * 100) : 0;
  const barColor = pct >= 80 ? 'var(--green)' : pct >= 50 ? '#6366f1' : pct >= 30 ? 'var(--amber)' : 'var(--red)';

  return (
    <div style={{background:'var(--paper-off)', minHeight:'100vh'}}>
      <div className="prod-header">
        <div className="prod-progress-bar">
          <div className="prod-progress-fill" style={{width: `${pct}%`, background: barColor}}/>
        </div>
        <div className="prod-header-inner">
          <div>
            <div style={{fontSize:18, fontWeight:800, letterSpacing:'-.02em'}}>Producción</div>
            <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:2, fontWeight:600}}>
              {totalProd} de {totalPedido} unidades · {producidoHoy} producidas hoy
            </div>
          </div>
          <div style={{display:'flex', alignItems:'center', gap:14}}>
            <button className="btn-primary" onClick={() => setShowProduce(true)}>
              <Icon n="plus" s={13}/> Registrar producción
            </button>
          </div>
        </div>
        <div className="prod-tabs-row">
          <button className={`prod-tab ${tab==='todos'?'active-todos':''}`} onClick={() => setTab('todos')}>
            Todos los canales
          </button>
          {channels.map(c => (
            <button
              key={c.id}
              className={`prod-tab ${tab===c.id?'active-todos':''}`}
              onClick={() => setTab(c.id)}
            >
              <span style={{width:6, height:6, borderRadius:'50%', background: c.color, display:'inline-block', marginRight:6, verticalAlign:'middle'}}/>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{padding:'20px 40px 48px'}}>
        <div className="kpi-grid" style={{marginBottom:18}}>
          <div className="stat-card" style={{borderLeft:'3px solid var(--red)'}}>
            <div style={{fontSize:9, fontWeight:700, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--ink-muted)', marginBottom:6}}>Faltante total</div>
            <div style={{fontFamily:'var(--mono)', fontSize:32, fontWeight:700, color:'var(--red)'}}>{totalFalt}</div>
          </div>
          <div className="stat-card" style={{borderLeft:'3px solid var(--green)'}}>
            <div style={{fontSize:9, fontWeight:700, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--ink-muted)', marginBottom:6}}>Producido</div>
            <div style={{fontFamily:'var(--mono)', fontSize:32, fontWeight:700, color:'var(--green)'}}>{totalProd}</div>
          </div>
          <div className="stat-card" style={{borderLeft:'3px solid var(--ink)'}}>
            <div style={{fontSize:9, fontWeight:700, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--ink-muted)', marginBottom:6}}>Pedido total</div>
            <div style={{fontFamily:'var(--mono)', fontSize:32, fontWeight:700}}>{totalPedido}</div>
          </div>
          <div className="stat-card">
            <div style={{fontSize:9, fontWeight:700, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--ink-muted)', marginBottom:6}}>Hoy</div>
            <div style={{fontFamily:'var(--mono)', fontSize:32, fontWeight:700}}>{producidoHoy}</div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">{tab === 'todos' ? 'Producción · todos los canales' : `Producción · ${tab}`}</div>
            <div style={{fontSize:11, color:'var(--ink-muted)', fontWeight:600}}>{filtered.length} líneas</div>
          </div>
          {filtered.length === 0 ? (
            <div className="empty">
              <Icon n="check-circle" s={28} c="var(--green)"/>
              <div style={{fontSize:13, fontWeight:700}}>Sin producción pendiente</div>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>SKU</th><th>Producto</th><th>Canal</th>
                  <th style={{textAlign:'right'}}>Pedido</th>
                  <th style={{textAlign:'right'}}>Producido</th>
                  <th style={{textAlign:'right'}}>Faltante</th>
                  <th style={{textAlign:'right'}}>Stock</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const ch = channels.find(c => c.id === r.channel_id);
                  return (
                    <tr key={`${r.sku}-${r.channel_id}-${i}`}>
                      <td><span className="order-num">{r.sku}</span></td>
                      <td style={{fontWeight:600, fontSize:12}}>{r.modelo}</td>
                      <td>
                        <span style={{
                          display:'inline-flex', alignItems:'center', gap:6,
                          padding:'3px 9px', borderRadius:10,
                          background: `${ch?.color}1a`, color: ch?.color ?? '#888',
                          fontSize:10, fontWeight:700, textTransform:'uppercase',
                        }}>
                          <span style={{width:5, height:5, borderRadius:'50%', background: ch?.color ?? '#888'}}/>
                          {ch?.label}
                        </span>
                      </td>
                      <td style={{textAlign:'right'}}><span className="cell-color-num">{r.pedido}</span></td>
                      <td style={{textAlign:'right'}}><span className="cell-color-num" style={{color: (r.producido ?? 0) >= (r.pedido ?? 0) ? 'var(--green)' : 'var(--ink-soft)'}}>{r.producido}</span></td>
                      <td style={{textAlign:'right'}}>
                        {(r.faltante ?? 0) > 0
                          ? <span className="cell-faltante-red">{r.faltante}</span>
                          : <span className="cell-faltante-ok"><Icon n="check" s={12}/></span>}
                      </td>
                      <td style={{textAlign:'right'}}>
                        {(r.stock ?? 0) > 0
                          ? <span className="cell-stock-pos">+{r.stock}</span>
                          : <span style={{fontFamily:'var(--mono)', fontSize:11, color:'var(--ink-faint)'}}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <ProduceModal open={showProduce} onClose={() => setShowProduce(false)} />
    </div>
  );
}
