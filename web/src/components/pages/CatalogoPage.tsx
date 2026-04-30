import { useState } from 'react';
import { Icon } from '@/components/shared/Icon';
import { useToast } from '@/components/shared/Toast';
import { ConfirmModal } from '@/components/shared/Modal';
import { ProductoEditModal } from '@/components/modals/ProductoEditModal';
import { QRBatchModal } from '@/components/modals/QRBatchModal';
import { useSkuCatalog, useToggleSkuActive } from '@macario/shared/hooks/useCatalog';
import { useCurrentProfile } from '@macario/shared/hooks/useAuth';
import type { Database } from '@macario/shared/types/database.types';

type Sku = Database['public']['Tables']['sku_catalog']['Row'];

export function CatalogoPage() {
  const { data: profileData } = useCurrentProfile();
  const { data: skus = [] } = useSkuCatalog({ activeOnly: false });
  const toggleActive = useToggleSkuActive();
  const toast = useToast();

  const [filter, setFilter] = useState('');
  const [cat, setCat] = useState('todas');
  const [editing, setEditing] = useState<{ open: boolean; sku: Sku | null }>({ open: false, sku: null });
  const [qrBatch, setQrBatch] = useState(false);
  const [confirmToggle, setConfirmToggle] = useState<Sku | null>(null);

  const role = profileData?.profile?.role;
  const canWrite = role === 'owner' || role === 'admin';

  const cats = [...new Set(skus.map(s => s.categoria))];

  const filtered = skus.filter(s => {
    if (cat !== 'todas' && s.categoria !== cat) return false;
    if (filter) {
      const q = filter.toLowerCase();
      if (!s.modelo.toLowerCase().includes(q)
        && !s.sku.toLowerCase().includes(q)
        && !(s.color ?? '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const onToggle = async (s: Sku) => {
    try {
      await toggleActive.mutateAsync({ sku: s.sku, activo: !s.activo });
      toast.success(`${s.sku} ${s.activo ? 'desactivado' : 'reactivado'}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Catálogo</div>
          <div className="page-sub">{skus.length} SKUs · {skus.filter(s => s.es_fabricado).length} fabricados</div>
        </div>
        <div style={{display:'flex', gap:8}}>
          <button className="btn-ghost" onClick={() => setQrBatch(true)} disabled={filtered.length === 0}>
            <Icon n="qr" s={13}/> Generar QR PDF ({filtered.length})
          </button>
          {canWrite && (
            <button
              className="btn-primary"
              onClick={() => setEditing({ open: true, sku: null })}
            >
              <Icon n="plus" s={13}/> Nuevo producto
            </button>
          )}
        </div>
      </div>

      <div className="filter-bar">
        <div>
          <Icon n="search" s={14} c="var(--ink-muted)"/>
          <input
            className="filter-input"
            placeholder="Buscar SKU, modelo o color..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{paddingLeft:30, minWidth:240}}
          />
        </div>
        <select className="filter-select" value={cat} onChange={e => setCat(e.target.value)}>
          <option value="todas">Todas las categorías</option>
          {cats.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="card">
        <table className="data-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Modelo</th>
              <th>Color</th>
              <th>Categoría</th>
              <th>Tipo</th>
              <th>Estado</th>
              {canWrite && <th></th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={canWrite ? 7 : 6} style={{textAlign:'center', padding:'40px 20px', color:'var(--ink-muted)', fontSize:12}}>
                  Sin productos que coincidan con el filtro.
                </td>
              </tr>
            ) : filtered.map(c => (
              <tr key={c.sku} style={{opacity: c.activo ? 1 : 0.55}}>
                <td><span className="order-num">{c.sku}</span></td>
                <td style={{fontWeight:600}}>{c.modelo}</td>
                <td>
                  {c.color && c.color !== '—' ? (
                    <span style={{display:'inline-flex', alignItems:'center', gap:6, fontSize:11, fontWeight:600}}>
                      <span style={{
                        width:10, height:10, borderRadius:'50%',
                        background: c.color_hex ?? (c.color==='Negro'?'#1a1a1a':c.color==='Blanco'?'#fff':'#888'),
                        border:'1px solid #d4cdc1', display:'inline-block',
                      }}/>
                      {c.color}
                    </span>
                  ) : <span style={{color:'var(--ink-faint)'}}>—</span>}
                </td>
                <td><span style={{fontSize:11, fontWeight:600, color:'var(--ink-muted)'}}>{c.categoria}</span></td>
                <td>{c.es_fabricado
                  ? <span style={{fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:10, background:'var(--green-bg)', color:'var(--green)'}}>FABRICADO</span>
                  : <span style={{fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:10, background:'var(--paper-dim)', color:'var(--ink-muted)'}}>REVENTA</span>}
                </td>
                <td>{c.activo
                  ? <span style={{display:'inline-flex', alignItems:'center', gap:5, fontSize:11, color:'var(--green)'}}>
                      <span style={{width:6, height:6, borderRadius:'50%', background:'var(--green)'}}/>Activo
                    </span>
                  : <span style={{fontSize:11, color:'var(--ink-muted)'}}>Inactivo</span>}
                </td>
                {canWrite && (
                  <td style={{textAlign:'right', width:1, whiteSpace:'nowrap'}}>
                    <button
                      className="btn-ghost"
                      style={{padding:'5px 10px', fontSize:10, marginRight:4}}
                      onClick={() => setEditing({ open: true, sku: c })}
                    >
                      <Icon n="edit" s={11}/> Editar
                    </button>
                    <button
                      className="btn-ghost"
                      style={{padding:'5px 10px', fontSize:10}}
                      onClick={() => setConfirmToggle(c)}
                      title={c.activo ? 'Desactivar' : 'Reactivar'}
                    >
                      <Icon n={c.activo ? 'x' : 'check'} s={11}/>
                      {c.activo ? ' Desactivar' : ' Activar'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!canWrite && (
        <div style={{
          marginTop:16, padding:14, background:'var(--paper-off)',
          border:'1px dashed var(--border-md)', borderRadius:6,
          fontSize:11, color:'var(--ink-soft)',
        }}>
          <Icon n="info" s={12}/> Solo owner / admin pueden crear o editar SKUs. Estás en modo lectura.
        </div>
      )}

      <ProductoEditModal
        open={editing.open}
        editing={editing.sku}
        onClose={() => setEditing({ open: false, sku: null })}
      />
      <QRBatchModal
        open={qrBatch}
        skus={filtered}
        onClose={() => setQrBatch(false)}
      />
      <ConfirmModal
        open={!!confirmToggle}
        title={confirmToggle?.activo ? `Desactivar ${confirmToggle.sku}` : `Reactivar ${confirmToggle?.sku ?? ''}`}
        message={confirmToggle?.activo
          ? `El SKU ${confirmToggle.sku} ya no aparecerá en producción ni en imports nuevos. Los registros históricos se preservan. Esta acción es reversible.`
          : `Reactivar ${confirmToggle?.sku ?? ''} — vuelve a estar disponible para producción e import.`}
        confirmText={confirmToggle?.activo ? 'Desactivar' : 'Reactivar'}
        danger={confirmToggle?.activo}
        onConfirm={() => confirmToggle && onToggle(confirmToggle)}
        onClose={() => setConfirmToggle(null)}
      />
    </div>
  );
}
