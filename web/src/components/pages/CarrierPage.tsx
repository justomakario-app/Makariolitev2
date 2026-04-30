import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Icon } from '@/components/shared/Icon';
import { useToast } from '@/components/shared/Toast';
import { ConfirmModal } from '@/components/shared/Modal';
import { ProduceModal } from '@/components/modals/ProduceModal';
import { ImportModal } from '@/components/modals/ImportModal';
import { useChannel } from '@macario/shared/hooks/useChannels';
import {
  useCarrierTable, useCarrierOrders, useCarrierBatches,
  useCloseJornada,
} from '@macario/shared/hooks/useCarrier';
import { fmt, skuName } from '@macario/shared/lib/fmt';

export function CarrierPage() {
  const { canal } = useParams<{ canal: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const channelId = canal ?? 'colecta';
  const { data: channel } = useChannel(channelId);
  const { data: rows = [] } = useCarrierTable(channelId);
  const { data: orders = [] } = useCarrierOrders(channelId);
  const { data: batches = [] } = useCarrierBatches(channelId);
  const closeJ = useCloseJornada();

  const [produceCtx, setProduceCtx] = useState<{ open: boolean; sku?: string }>({ open: false });
  const [importOpen, setImportOpen] = useState(false);
  const [confirmCierre, setConfirmCierre] = useState(false);
  const [openOrders, setOpenOrders] = useState(false);
  const [openLotes, setOpenLotes] = useState(false);

  if (!channel) return <div className="page"><div className="empty"><span className="loader"/></div></div>;

  const totalUnidades = rows.reduce((s, r) => s + (r.pedido ?? 0), 0);
  const faltanteTotal = rows.reduce((s, r) => s + (r.faltante ?? 0), 0);
  const activos = rows.filter(r => (r.faltante ?? 0) > 0).length;
  const allDone = faltanteTotal === 0 && activos === 0;
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
    <div style={{background:'var(--paper-off)', minHeight:'100vh'}}>
      <div className="carrier-header" style={{borderTop:`3px solid ${channel.color}`}}>
        <button className="carrier-back" onClick={() => navigate('/')}>
          <Icon n="arrow-left" s={14}/> Dashboard
        </button>
        <div style={{flex:1, display:'flex', alignItems:'center', gap:14, minWidth:0}}>
          <div style={{
            width:36, height:36, background:channel.bg, color:channel.color,
            display:'flex', alignItems:'center', justifyContent:'center',
            borderRadius:8, flexShrink:0,
          }}>
            <Icon n={channelId==='colecta'?'truck':channelId==='flex'?'package':channelId==='tiendanube'?'box':'users'} s={18}/>
          </div>
          <div style={{minWidth:0}}>
            <div className="carrier-title">{channel.label}</div>
            <div style={{fontSize:11, color:'var(--ink-muted)', marginTop:2, fontWeight:600}}>
              {channel.sub}
            </div>
          </div>
        </div>
        <div className="carrier-actions">
          <button className="btn-ghost" onClick={() => setImportOpen(true)}>
            <Icon n="upload" s={13}/> Importar Excel
          </button>
          <button className="btn-primary" onClick={() => setProduceCtx({ open: true })}>
            <Icon n="plus" s={13}/> Producir
          </button>
        </div>
      </div>

      {allDone ? (
        <div className="carrier-banner green">
          <Icon n="check-circle" s={16}/>
          <span>Todos los pedidos de este canal están al día. Sin faltante para producir.</span>
        </div>
      ) : esHorario && vencida ? (
        <div className="carrier-banner" style={{background:'var(--red-bg)', borderColor:'rgba(220,38,38,.32)', color:'var(--red)'}}>
          <Icon n="alert" s={16}/>
          <span><strong>Jornada vencida</strong> — la hora de cierre era <strong>{channel.cierre_hora?.slice(0,5)}</strong>. Cerrá ahora para archivar y arrastrar el faltante.</span>
        </div>
      ) : esHorario && countdown ? (
        <div className="carrier-banner" style={{background:'#fff8e6', borderColor:'rgba(217,119,6,.32)', color:'#92400e'}}>
          <Icon n="clock" s={16}/>
          <span>La jornada cierra hoy a las <strong>{channel.cierre_hora?.slice(0,5)}</strong> — quedan <strong>{countdown}</strong>. Pendiente: <strong>{faltanteTotal} uds.</strong></span>
        </div>
      ) : !esHorario ? (
        <div className="carrier-banner" style={{background:'var(--paper-off)', borderColor:'var(--border)', color:'var(--ink-soft)'}}>
          <Icon n="info" s={16}/>
          <span>Canal sin cierre obligatorio diario — el faltante se arrastra automáticamente.</span>
        </div>
      ) : null}

      <div className="carrier-body">
        <div className="carrier-kpis">
          <div className="carrier-kpi" style={{borderLeft:`3px solid ${channel.color}`}}>
            <div className="carrier-kpi-label">Pedidos activos</div>
            <div className="carrier-kpi-value">{activos}</div>
          </div>
          <div className="carrier-kpi">
            <div className="carrier-kpi-label">Unidades totales</div>
            <div className="carrier-kpi-value">{totalUnidades}</div>
          </div>
          <div className="carrier-kpi" style={{borderLeft: faltanteTotal>0 ? '3px solid var(--red)' : '3px solid var(--green)'}}>
            <div className="carrier-kpi-label">Pendiente fabricar</div>
            <div className="carrier-kpi-value" style={{color: faltanteTotal>0?'var(--red)':'var(--green)'}}>
              {faltanteTotal}
            </div>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="card">
            <div className="empty">
              <Icon n="check-circle" s={32} c="var(--green)"/>
              <div style={{fontSize:14, fontWeight:700, color:'var(--ink)'}}>Sin pedidos activos</div>
              <div style={{fontSize:12, color:'var(--ink-muted)'}}>No hay nada que producir en este canal.</div>
              <button className="btn-ghost" onClick={() => setImportOpen(true)} style={{marginTop:8}}>
                <Icon n="upload" s={13}/> Importar Excel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="card">
              <div className="card-header">
                <div className="card-title">Pendiente por SKU</div>
                <div style={{fontSize:11, color:'var(--ink-muted)', fontWeight:600}}>{rows.length} productos</div>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Producto</th>
                    <th style={{textAlign:'right'}}>Pedido</th>
                    <th style={{textAlign:'right'}}>Producido</th>
                    <th style={{textAlign:'right'}}>Faltante</th>
                    <th style={{textAlign:'right'}}>Stock</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.sku ?? ''}>
                      <td><span className="order-num">{r.sku}</span></td>
                      <td>
                        <div style={{fontWeight:600, color:'var(--ink)', fontSize:12}}>{r.modelo}</div>
                        {r.color && r.color !== '—' && (
                          <div style={{fontSize:10, color:'var(--ink-muted)', marginTop:1, display:'flex', alignItems:'center', gap:5}}>
                            <span style={{
                              width:7, height:7, borderRadius:'50%',
                              background: r.color_hex ?? (r.color==='Negro'?'#1a1a1a':'#fff'),
                              border:'1px solid #d4cdc1', display:'inline-block',
                            }}/>
                            {r.color}
                          </div>
                        )}
                      </td>
                      <td style={{textAlign:'right'}}><span className="cell-color-num">{r.pedido}</span></td>
                      <td style={{textAlign:'right'}}>
                        <span className="cell-color-num" style={{color: (r.producido ?? 0) >= (r.pedido ?? 0) ? 'var(--green)' : 'var(--ink-soft)'}}>
                          {r.producido}
                        </span>
                      </td>
                      <td style={{textAlign:'right'}}>
                        {(r.faltante ?? 0) > 0
                          ? <span className="cell-faltante-red">{r.faltante}</span>
                          : <span className="cell-faltante-ok"><Icon n="check" s={12}/></span>}
                      </td>
                      <td style={{textAlign:'right'}}>
                        {(r.stock ?? 0) > 0
                          ? <span className="cell-stock-pos" title="Excedente disponible">+{r.stock}</span>
                          : <span style={{fontFamily:'var(--mono)', fontSize:11, color:'var(--ink-faint)'}}>—</span>}
                      </td>
                      <td style={{textAlign:'right', width:1}}>
                        <button
                          className="btn-ghost"
                          style={{padding:'5px 10px', fontSize:10}}
                          onClick={() => setProduceCtx({ open: true, sku: r.sku ?? undefined })}
                          disabled={(r.faltante ?? 0) <= 0}
                        >
                          <Icon n="plus" s={11}/> Registrar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="collapsible" style={{marginTop:14}}>
              <div className="collapsible-header" onClick={() => setOpenOrders(o => !o)}>
                <div className="collapsible-title">Pedidos individuales · {orders.length}</div>
                <span className={`collapsible-arrow ${openOrders ? 'open' : ''}`}><Icon n="chev-down" s={14}/></span>
              </div>
              {openOrders && (
                <div className="collapsible-body" style={{padding:0}}>
                  <table className="data-table">
                    <thead>
                      <tr><th>N°</th><th>Cliente</th><th>SKU</th><th>Producto</th><th style={{textAlign:'right'}}>Cant.</th><th>Fecha</th></tr>
                    </thead>
                    <tbody>
                      {orders.map(o => {
                        const meta = rows.find(r => r.sku === o.sku);
                        return (
                          <tr key={o.id}>
                            <td><span className="order-num">{o.order_number}</span></td>
                            <td style={{fontWeight:600, color:'var(--ink)'}}>{o.cliente ?? '—'}</td>
                            <td><span className="order-num" style={{fontSize:10}}>{o.sku}</span></td>
                            <td style={{fontSize:11, color:'var(--ink-soft)'}}>{skuName(o.sku, meta?.modelo ?? null, meta?.color ?? null)}</td>
                            <td style={{textAlign:'right'}}><span className="cell-color-num">{o.cantidad}</span></td>
                            <td style={{fontSize:11, color:'var(--ink-muted)'}}>{fmt.date(o.fecha_pedido)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {batches.length > 0 && (
              <div className="collapsible">
                <div className="collapsible-header" onClick={() => setOpenLotes(o => !o)}>
                  <div className="collapsible-title">Lotes importados · {batches.length}</div>
                  <span className={`collapsible-arrow ${openLotes ? 'open' : ''}`}><Icon n="chev-down" s={14}/></span>
                </div>
                {openLotes && (
                  <div className="collapsible-body" style={{padding:0}}>
                    <table className="data-table">
                      <thead><tr><th>Fecha</th><th>Archivo</th><th style={{textAlign:'right'}}>Pedidos</th><th style={{textAlign:'right'}}>Uds.</th></tr></thead>
                      <tbody>
                        {batches.map(b => (
                          <tr key={b.id}>
                            <td style={{fontSize:11}}>{fmt.dateTime(b.imported_at)}</td>
                            <td style={{fontSize:11, color:'var(--ink-muted)', fontFamily:'var(--mono)'}}>{b.filename}</td>
                            <td style={{textAlign:'right'}}><span className="cell-color-num">{b.pedidos_count}</span></td>
                            <td style={{textAlign:'right'}}><span className="cell-color-num">{b.unidades_count}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {esHorario && (
              <div style={{marginTop:20, display:'flex', justifyContent:'space-between', alignItems:'center', gap:12}}>
                <div style={{fontSize:11, color:'var(--ink-muted)', maxWidth:520, lineHeight:1.5}}>
                  <Icon n="info" s={12}/> Al cerrar: archivamos los pedidos completados y arrastramos el faltante al día siguiente como nueva línea.
                </div>
                <button
                  className="btn-success"
                  onClick={() => setConfirmCierre(true)}
                  disabled={closeJ.isPending}
                  style={vencida ? {background:'var(--red)', animation:'pulseDot 1.5s infinite'} : undefined}
                >
                  <Icon n="lock" s={13}/> {vencida ? 'Cerrar jornada (vencida)' : 'Cerrar jornada'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <ProduceModal
        open={produceCtx.open}
        defaultSku={produceCtx.sku}
        defaultChannelId={channelId}
        onClose={() => setProduceCtx({ open: false })}
      />
      <ImportModal
        open={importOpen}
        defaultChannelId={channelId}
        onClose={() => setImportOpen(false)}
      />
      <ConfirmModal
        open={confirmCierre}
        title={`Cerrar jornada — ${channel.label}`}
        message="Vas a archivar los pedidos completados y arrastrar el faltante al día siguiente como nuevas órdenes status='arrastrado'. Esta acción es atómica y no se puede deshacer."
        confirmText="Confirmar cierre"
        onConfirm={onCloseJornada}
        onClose={() => setConfirmCierre(false)}
      />
    </div>
  );
}
