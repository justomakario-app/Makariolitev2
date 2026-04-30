import { useState } from 'react';
import { Icon } from '@/components/shared/Icon';
import { useSkuCatalog } from '@/hooks/useCatalog';

export function CatalogoPage() {
  const { data: skus = [] } = useSkuCatalog({ activeOnly: false });
  const [filter, setFilter] = useState('');
  const [cat, setCat] = useState('todas');

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

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Catálogo</div>
          <div className="page-sub">{skus.length} SKUs · {skus.filter(s => s.es_fabricado).length} fabricados</div>
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
          <thead><tr><th>SKU</th><th>Modelo</th><th>Color</th><th>Categoría</th><th>Tipo</th><th>Estado</th></tr></thead>
          <tbody>
            {filtered.map(c => (
              <tr key={c.sku}>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{marginTop:16, padding:14, background:'var(--paper-off)', border:'1px dashed var(--border-md)', borderRadius:6, fontSize:11, color:'var(--ink-soft)'}}>
        <Icon n="info" s={12}/> ABM completo (crear / editar / desactivar SKU) — pendiente de portar el modal del frontend mock al esquema TS+RLS. La data ya viene de Supabase con RLS policies activas.
      </div>
    </div>
  );
}
