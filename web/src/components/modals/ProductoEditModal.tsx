import { useState } from 'react';
import { Modal } from '@/components/shared/Modal';
import { Icon } from '@/components/shared/Icon';
import { useToast } from '@/components/shared/Toast';
import { useSkuCategories, useUpsertSku, useUpsertCategory } from '@/hooks/useCatalog';
import type { Database } from '@/types/database.types';

type Sku = Database['public']['Tables']['sku_catalog']['Row'];

const SKU_REGEX = /^[A-Z]{2,4}[0-9]{2,5}$/;
const HEX_REGEX = /^#[0-9a-fA-F]{6}$/;

const PRESETS = [
  { n: 'Blanco',  h: '#ffffff' },
  { n: 'Negro',   h: '#1a1a1a' },
  { n: 'Natural', h: '#d4a574' },
  { n: 'Roble',   h: '#8b6f47' },
  { n: 'Nogal',   h: '#5c3a21' },
  { n: 'Gris',    h: '#888888' },
];

interface Props {
  open: boolean;
  /** Si viene un sku existente → modo edición. Si es null → modo creación. */
  editing: Sku | null;
  onClose: () => void;
}

export function ProductoEditModal({ open, editing, onClose }: Props) {
  const isNew = !editing;
  const toast = useToast();
  const { data: categories = [] } = useSkuCategories();
  const upsert = useUpsertSku();
  const upsertCat = useUpsertCategory();

  const [sku, setSku] = useState(editing?.sku ?? '');
  const [modelo, setModelo] = useState(editing?.modelo ?? '');
  const [color, setColor] = useState(editing?.color ?? '');
  const [colorHex, setColorHex] = useState(editing?.color_hex ?? '#cccccc');
  const [categoria, setCategoria] = useState(editing?.categoria ?? categories[0]?.name ?? 'Mesas');
  const [esFab, setEsFab] = useState(editing?.es_fabricado ?? true);
  const [activo, setActivo] = useState(editing?.activo ?? true);
  const [nuevaCat, setNuevaCat] = useState(false);
  const [catCustom, setCatCustom] = useState('');

  const submit = async () => {
    const skuFinal = sku.trim().toUpperCase();
    const modeloFinal = modelo.trim();
    const colorFinal = color.trim();
    const finalCat = nuevaCat ? catCustom.trim() : categoria;

    // Validaciones cliente (las RLS+CHECK del backend son el enforce real)
    if (isNew && !SKU_REGEX.test(skuFinal)) {
      toast.error('SKU inválido. Formato: 2-4 letras + 2-5 dígitos (ej: MAD500)');
      return;
    }
    if (!modeloFinal) { toast.error('Falta nombre del modelo'); return; }
    if (!finalCat) { toast.error('Falta categoría'); return; }
    if (colorFinal && colorFinal !== '—' && !HEX_REGEX.test(colorHex)) {
      toast.error('Color hex inválido (formato #RRGGBB)');
      return;
    }

    try {
      // Si es nueva categoría, crearla primero (idempotente — ignora si existe)
      if (nuevaCat) {
        await upsertCat.mutateAsync(finalCat);
      }

      const data = {
        sku: skuFinal,
        modelo: modeloFinal,
        color: colorFinal && colorFinal !== '—' ? colorFinal : null,
        color_hex: colorFinal && colorFinal !== '—' && HEX_REGEX.test(colorHex) ? colorHex : null,
        categoria: finalCat,
        es_fabricado: esFab,
        activo,
      };

      await upsert.mutateAsync({ sku: skuFinal, data, isNew });
      toast.success(isNew ? `SKU ${skuFinal} creado` : `SKU ${skuFinal} actualizado`);
      onClose();
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === '23505') {
        toast.error(`El SKU ${skuFinal} ya existe`);
      } else {
        toast.error(err.message);
      }
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={isNew ? 'Nuevo producto' : `Editar ${editing!.sku}`} size="lg" footer={
      <>
        <button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" onClick={submit} disabled={upsert.isPending}>
          {upsert.isPending
            ? <span className="loader" style={{borderColor:'rgba(255,255,255,.3)', borderTopColor:'#fff'}}/>
            : <><Icon n="check" s={14}/> {isNew ? 'Crear producto' : 'Guardar cambios'}</>}
        </button>
      </>
    }>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
        <div>
          <label className="field-label">SKU</label>
          <input
            className="field-input"
            value={sku}
            onChange={e => setSku(e.target.value.toUpperCase())}
            disabled={!isNew}
            placeholder="Ej: MAD500"
            style={{fontFamily:'var(--mono)', textTransform:'uppercase'}}
          />
          {!isNew && <div style={{fontSize:10, color:'var(--ink-muted)', marginTop:4}}>El SKU no se puede cambiar después de creado.</div>}
          {isNew && <div style={{fontSize:10, color:'var(--ink-muted)', marginTop:4}}>Formato: 2-4 letras + 2-5 dígitos.</div>}
        </div>
        <div>
          <label className="field-label">Categoría</label>
          {!nuevaCat ? (
            <div style={{display:'flex', gap:6}}>
              <select
                className="field-input"
                value={categoria}
                onChange={e => setCategoria(e.target.value)}
                style={{flex:1}}
              >
                {categories.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
              <button
                type="button"
                className="btn-ghost"
                style={{padding:'8px 10px', fontSize:10}}
                onClick={() => setNuevaCat(true)}
                title="Nueva categoría"
              >
                <Icon n="plus" s={12}/>
              </button>
            </div>
          ) : (
            <div style={{display:'flex', gap:6}}>
              <input
                className="field-input"
                value={catCustom}
                onChange={e => setCatCustom(e.target.value)}
                placeholder="Nueva categoría..."
                style={{flex:1}}
              />
              <button
                type="button"
                className="btn-ghost"
                style={{padding:'8px 10px', fontSize:10}}
                onClick={() => { setNuevaCat(false); setCatCustom(''); }}
              >
                <Icon n="x" s={12}/>
              </button>
            </div>
          )}
        </div>
      </div>

      <div style={{marginTop:14}}>
        <label className="field-label">Nombre del modelo</label>
        <input
          className="field-input"
          value={modelo}
          onChange={e => setModelo(e.target.value)}
          placeholder="Ej: Mesa Nórdica Redonda 50cm"
          maxLength={120}
        />
      </div>

      <div style={{marginTop:14}}>
        <label className="field-label">Color / variante (opcional)</label>
        <div style={{display:'flex', gap:8, alignItems:'center', marginBottom:10}}>
          <input
            className="field-input"
            value={color}
            onChange={e => setColor(e.target.value)}
            placeholder="Ej: Blanco, Negro, Natural..."
            style={{flex:1}}
          />
          <input
            type="color"
            value={colorHex}
            onChange={e => setColorHex(e.target.value)}
            disabled={!color || color === '—'}
            style={{width:48, height:38, border:'1px solid var(--border)', borderRadius:4, padding:2, cursor: color ? 'pointer':'not-allowed', background:'#fff'}}
          />
        </div>
        <div style={{display:'flex', flexWrap:'wrap', gap:5}}>
          <span style={{fontSize:10, fontWeight:700, color:'var(--ink-muted)', textTransform:'uppercase', letterSpacing:'.08em', alignSelf:'center', marginRight:4}}>Atajos:</span>
          {PRESETS.map(p => (
            <button
              key={p.n}
              type="button"
              onClick={() => { setColor(p.n); setColorHex(p.h); }}
              style={{
                display:'flex', alignItems:'center', gap:5, padding:'3px 8px',
                fontSize:10, fontWeight:600,
                background: color===p.n?'var(--ink)':'var(--paper-off)',
                color: color===p.n?'#fff':'var(--ink-soft)',
                border:'1px solid var(--border)', borderRadius:10, cursor:'pointer',
              }}
            >
              <span style={{width:9, height:9, borderRadius:'50%', background:p.h, border:'1px solid #d4cdc1'}}/>
              {p.n}
            </button>
          ))}
        </div>
        <div style={{fontSize:10, color:'var(--ink-muted)', marginTop:6}}>
          Dejar vacío si el producto no tiene variantes de color.
        </div>
      </div>

      <div style={{marginTop:18, display:'flex', gap:24}}>
        <label style={{display:'flex', alignItems:'center', gap:8, fontSize:12, fontWeight:600, cursor:'pointer'}}>
          <input type="checkbox" checked={esFab} onChange={e => setEsFab(e.target.checked)}/>
          Producto fabricado
        </label>
        <label style={{display:'flex', alignItems:'center', gap:8, fontSize:12, fontWeight:600, cursor:'pointer'}}>
          <input type="checkbox" checked={activo} onChange={e => setActivo(e.target.checked)}/>
          Activo en catálogo
        </label>
      </div>
    </Modal>
  );
}
