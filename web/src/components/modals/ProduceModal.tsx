import { useEffect, useState } from 'react';
import { Modal } from '@/components/shared/Modal';
import { Icon } from '@/components/shared/Icon';
import { useToast } from '@/components/shared/Toast';
import { useChannels } from '@macario/shared/hooks/useChannels';
import { useSkuCatalog } from '@macario/shared/hooks/useCatalog';
import { useRegisterProduction } from '@macario/shared/hooks/useCarrier';

interface Props {
  open: boolean;
  defaultSku?: string;
  defaultChannelId?: string;
  onClose: () => void;
}

export function ProduceModal({ open, defaultSku, defaultChannelId, onClose }: Props) {
  const toast = useToast();
  const { data: skus = [] } = useSkuCatalog();
  const { data: channels = [] } = useChannels();
  const register = useRegisterProduction();

  const [step, setStep] = useState(1);
  const [sku, setSku] = useState(defaultSku ?? '');
  const [search, setSearch] = useState('');
  const [channelId, setChannelId] = useState(defaultChannelId ?? '');
  const [cantidad, setCantidad] = useState(1);
  const [notas, setNotas] = useState('');

  useEffect(() => {
    if (open) {
      const hasSku = !!defaultSku;
      const hasCh = !!defaultChannelId;
      setStep(hasSku && hasCh ? 3 : hasSku ? 2 : 1);
      setSku(defaultSku ?? skus[0]?.sku ?? '');
      setSearch('');
      setChannelId(defaultChannelId ?? channels[0]?.id ?? '');
      setCantidad(1);
      setNotas('');
    }
  }, [open, defaultSku, defaultChannelId, skus, channels]);

  const filtered = skus.filter(s => {
    if (!search) return true;
    const q = search.toLowerCase();
    return s.sku.toLowerCase().includes(q)
      || s.modelo.toLowerCase().includes(q)
      || (s.color ?? '').toLowerCase().includes(q);
  });

  const skuInfo = skus.find(s => s.sku === sku);

  const submit = async () => {
    try {
      await register.mutateAsync({
        sku, channel_id: channelId, cantidad, notas: notas.trim() || null,
      });
      const ch = channels.find(c => c.id === channelId);
      toast.success(`${cantidad} × ${sku} → ${ch?.label ?? channelId} registrado`);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Registrar producción" size="lg" footer={
      <>
        {step > 1 && <button className="btn-ghost" onClick={() => setStep(step-1)}>Atrás</button>}
        <button className="btn-ghost" onClick={onClose}>Cancelar</button>
        {step < 3 && (
          <button className="btn-primary" onClick={() => setStep(step+1)} disabled={!sku || (step===2 && !channelId)}>
            Siguiente
          </button>
        )}
        {step === 3 && (
          <button className="btn-primary" onClick={submit} disabled={register.isPending || cantidad < 1}>
            {register.isPending
              ? <span className="loader" style={{borderColor:'rgba(255,255,255,.3)', borderTopColor:'#fff'}}/>
              : <><Icon n="check" s={14}/> Confirmar registro</>}
          </button>
        )}
      </>
    }>
      {/* Stepper */}
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24, padding:'0 4px'}}>
        {['Producto','Canal','Cantidad'].map((lbl, i) => {
          const n = i+1;
          const active = step === n;
          const done = step > n;
          return (
            <div key={lbl} style={{display:'flex', alignItems:'center', flex: i===2?0:1, gap:8}}>
              <div style={{
                width:24, height:24, borderRadius:'50%',
                background: done ? 'var(--green)' : active ? 'var(--ink)' : 'var(--paper-dim)',
                color: done || active ? '#fff' : 'var(--ink-muted)',
                fontSize:11, fontWeight:800, display:'flex',
                alignItems:'center', justifyContent:'center', flexShrink:0,
              }}>{done ? <Icon n="check" s={12}/> : n}</div>
              <div style={{fontSize:11, fontWeight:700, color: active||done?'var(--ink)':'var(--ink-muted)', textTransform:'uppercase', letterSpacing:'.08em'}}>{lbl}</div>
              {i < 2 && <div style={{flex:1, height:1, background: done?'var(--green)':'var(--border)', margin:'0 8px'}}/>}
            </div>
          );
        })}
      </div>

      {/* Paso 1: SKU */}
      {step === 1 && (
        <div>
          <label className="field-label">Identificá el producto</label>
          <div style={{position:'relative', marginBottom:10}}>
            <input
              className="field-input"
              placeholder="Buscar por SKU, modelo o color…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{paddingLeft:36}}
            />
            <span style={{position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', pointerEvents:'none', display:'flex'}}>
              <Icon n="search" s={14} c="var(--ink-muted)"/>
            </span>
          </div>
          <div style={{maxHeight:240, overflowY:'auto', border:'1px solid var(--border)', borderRadius:6, background:'var(--paper-off)'}}>
            {filtered.length === 0 ? (
              <div style={{padding:20, textAlign:'center', fontSize:12, color:'var(--ink-muted)'}}>Sin resultados</div>
            ) : filtered.map(s => {
              const sel = sku === s.sku;
              return (
                <button
                  key={s.sku}
                  onClick={() => setSku(s.sku)}
                  style={{
                    display:'flex', alignItems:'center', gap:12, width:'100%',
                    padding:'12px 14px', border:'none',
                    borderLeft: sel ? '3px solid var(--ink)' : '3px solid transparent',
                    borderBottom:'1px solid var(--border)',
                    background: sel ? 'var(--ink)' : 'transparent',
                    color: sel ? '#fff' : 'var(--ink)',
                    cursor:'pointer', textAlign:'left',
                  }}
                >
                  <span style={{
                    minWidth:64, fontFamily:'var(--mono)', fontSize:11, fontWeight:700,
                    color: sel ? 'rgba(255,255,255,.8)' : 'var(--ink-muted)',
                  }}>{s.sku}</span>
                  <div style={{flex:1, minWidth:0}}>
                    <div style={{fontSize:12, fontWeight:600}}>{s.modelo}</div>
                    {s.color && s.color !== '—' && (
                      <div style={{fontSize:10, color: sel?'rgba(255,255,255,.7)':'var(--ink-muted)', marginTop:1}}>
                        {s.color} · {s.categoria}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Paso 2: canal */}
      {step === 2 && (
        <div>
          <label className="field-label">Canal de destino</label>
          <div className="radio-card-group">
            {channels.map(c => (
              <label
                key={c.id}
                className={`radio-card ${channelId===c.id?'selected':''}`}
                style={{ ['--sel-color' as string]: c.color, ['--sel-bg' as string]: `${c.color}1a` }}
              >
                <input type="radio" checked={channelId===c.id} onChange={() => setChannelId(c.id)}/>
                <div className="radio-card-dot"/>
                <div className="radio-card-info">
                  <div className="radio-card-label">{c.label}</div>
                  <div className="radio-card-sub">{c.sub ?? ''}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Paso 3: cantidad + notas */}
      {step === 3 && (
        <div>
          <label className="field-label">Cantidad producida</label>
          <div style={{display:'flex', gap:6, alignItems:'center'}}>
            <button onClick={() => setCantidad(Math.max(1, cantidad-1))} className="btn-ghost" style={{padding:'10px 14px', fontSize:18, lineHeight:1}}>−</button>
            <input
              type="number" min="1" value={cantidad}
              onChange={e => setCantidad(Math.max(1, parseInt(e.target.value)||1))}
              className="qty-input"
            />
            <button onClick={() => setCantidad(cantidad+1)} className="btn-ghost" style={{padding:'10px 14px', fontSize:18, lineHeight:1}}>+</button>
          </div>

          <div style={{marginTop:14}}>
            <label className="field-label">Nota interna (opcional)</label>
            <input
              className="field-input"
              placeholder="Ej: lote especial"
              value={notas}
              onChange={e => setNotas(e.target.value)}
            />
          </div>

          <div style={{marginTop:16, padding:14, background:'var(--paper-off)', border:'1px solid var(--border)', borderRadius:6}}>
            <div style={{fontSize:9, fontWeight:700, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--ink-muted)', marginBottom:8}}>Resumen</div>
            <div style={{fontSize:12, lineHeight:1.7}}>
              <div><strong style={{fontFamily:'var(--mono)'}}>{cantidad}×</strong> {sku} — {skuInfo?.modelo} {skuInfo?.color && skuInfo.color !== '—' ? skuInfo.color : ''}</div>
              <div>Canal: <strong>{channels.find(c => c.id === channelId)?.label}</strong></div>
              <div>Operario y sector: <em>auto-asignados desde tu sesión.</em></div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
