import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { Modal } from '@/components/shared/Modal';
import { Icon } from '@/components/shared/Icon';
import { useToast } from '@/components/shared/Toast';
import { useChannels } from '@/hooks/useChannels';
import { useSkuCatalog } from '@/hooks/useCatalog';
import { useImportBatch } from '@/hooks/useCarrier';
import { sha256Hex } from '@/lib/queryClient';

interface Props {
  open: boolean;
  defaultChannelId: string;
  onClose: () => void;
}

interface ParsedRow {
  sku: string;
  cantidad: number;
  order_number?: string;
  cliente?: string;
  fecha_pedido?: string;
}

export function ImportModal({ open, defaultChannelId, onClose }: Props) {
  const toast = useToast();
  const { data: channels = [] } = useChannels();
  const { data: catalog = [] } = useSkuCatalog();
  const importMut = useImportBatch();

  const [channelId, setChannelId] = useState(defaultChannelId);
  const [file, setFile] = useState<File | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setChannelId(defaultChannelId);
      setFile(null); setHash(null); setRows([]);
      setParseError(null); setParsing(false);
    }
  }, [open, defaultChannelId]);

  const knownSkus = new Set(catalog.map(c => c.sku));
  const ignored = rows.filter(r => !knownSkus.has(r.sku)).map(r => r.sku);
  const ignoredUnique = [...new Set(ignored)];
  const aplicables = rows.filter(r => knownSkus.has(r.sku));
  const totalUds = aplicables.reduce((s, r) => s + r.cantidad, 0);

  const onPickFile = async (f: File | null) => {
    setFile(f);
    setRows([]); setHash(null); setParseError(null);
    if (!f) return;
    setParsing(true);
    try {
      const fileHash = await sha256Hex(f);
      setHash(fileHash);

      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '', raw: false });

      // Detectar header buscando columna "SKU" / "Unidades"
      // SheetJS ya nos da JSON con la primera fila como headers automáticamente.
      // Si las claves no son "SKU"/"Unidades", sniff y mapear.
      if (!data.length) {
        setParseError('Hoja vacía o sin datos.');
        setParsing(false);
        return;
      }

      const sample = data[0];
      const keys = Object.keys(sample);
      const skuKey = keys.find(k => /^sku$/i.test(k.trim())) ?? keys.find(k => /sku/i.test(k));
      const cantKey = keys.find(k => /^unidades?$|^cantidad$/i.test(k.trim())) ?? keys.find(k => /unidades|cantidad/i.test(k));
      const numKey = keys.find(k => /(# de venta|n[uú]mero)/i.test(k));
      const cliKey = keys.find(k => /comprador|cliente/i.test(k));
      const fechaKey = keys.find(k => /fecha de venta|^fecha$/i.test(k));

      if (!skuKey || !cantKey) {
        setParseError('No se encontraron columnas "SKU" y "Unidades" en la primera hoja.');
        setParsing(false);
        return;
      }

      const parsed: ParsedRow[] = [];
      for (const row of data) {
        const skuRaw = String(row[skuKey] ?? '').trim().toUpperCase();
        const qty = parseInt(String(row[cantKey] ?? '0'), 10);
        if (!skuRaw || !qty || qty <= 0) continue;
        parsed.push({
          sku: skuRaw,
          cantidad: qty,
          order_number: numKey ? String(row[numKey] ?? '').trim() || undefined : undefined,
          cliente: cliKey ? String(row[cliKey] ?? '').trim() || undefined : undefined,
          fecha_pedido: fechaKey ? String(row[fechaKey] ?? '').trim() || undefined : undefined,
        });
      }
      setRows(parsed);
      if (parsed.length === 0) {
        setParseError('Se detectaron columnas SKU/Unidades pero todas las filas estaban vacías o con cantidad 0.');
      }
    } catch (e) {
      setParseError('No se pudo leer el archivo: ' + (e as Error).message);
    }
    setParsing(false);
  };

  const submit = async () => {
    if (!file || !hash || aplicables.length === 0) return;
    try {
      const result = await importMut.mutateAsync({
        channel_id: channelId,
        filename: file.name,
        file_hash: hash,
        items: aplicables,
      });
      if (result.existed) {
        toast.warning(`Este archivo ya fue importado antes (no se duplicó).`);
      } else {
        const ch = channels.find(c => c.id === channelId);
        const msg = `${file.name} importado · ${result.inserted_count} pedidos a ${ch?.label}`
                  + (ignoredUnique.length ? ` · ${ignoredUnique.length} SKUs desconocidos ignorados` : '');
        toast.success(msg);
      }
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const C = channels.find(c => c.id === channelId);

  return (
    <Modal open={open} onClose={onClose} title="Importar ventas desde Excel" size="lg" footer={
      <>
        <button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button
          className="btn-primary"
          onClick={submit}
          disabled={!file || aplicables.length === 0 || importMut.isPending || parsing}
        >
          {importMut.isPending
            ? <span className="loader" style={{borderColor:'rgba(255,255,255,.3)', borderTopColor:'#fff'}}/>
            : <><Icon n="upload" s={14}/> Importar {aplicables.length>0 ? `${aplicables.length} pedidos` : ''} a {C?.label}</>}
        </button>
      </>
    }>
      <label className="field-label">Canal de destino</label>
      <div className="radio-card-group" style={{marginBottom:14}}>
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
            </div>
          </label>
        ))}
      </div>

      <label htmlFor="file-input" style={{
        display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
        padding:'28px 20px', border:'2px dashed var(--border-str)', borderRadius:8, cursor:'pointer',
        background:'var(--paper-off)', textAlign:'center', gap:8,
      }}>
        <Icon n={parsing?'loader':file?'check-circle':'upload'} s={28} c={file?'var(--green)':'var(--ink-muted)'}/>
        <div style={{fontSize:13, fontWeight:700}}>{parsing ? 'Leyendo archivo…' : file ? file.name : 'Seleccionar archivo .xlsx / .csv'}</div>
        <div style={{fontSize:11, color:'var(--ink-muted)'}}>{file ? `${Math.round(file.size/1024)} KB · hash: ${hash?.slice(0,12)}…` : 'Arrastrá o hacé clic'}</div>
        <input
          id="file-input" type="file" accept=".xlsx,.xls,.csv"
          style={{display:'none'}}
          onChange={e => onPickFile(e.target.files?.[0] ?? null)}
        />
      </label>

      {parseError && (
        <div style={{marginTop:12, padding:'10px 12px', background:'var(--red-bg)', border:'1px solid rgba(220,38,38,.3)', borderRadius:6, fontSize:12, color:'var(--red)'}}>
          <Icon n="alert" s={14}/> {parseError}
        </div>
      )}

      {rows.length > 0 && ignoredUnique.length > 0 && (
        <div style={{marginTop:12, padding:'10px 12px', background:'var(--amber-bg)', border:'1px solid rgba(217,119,6,.3)', borderRadius:6, fontSize:12, color:'var(--amber)'}}>
          <Icon n="alert" s={14}/>
          <strong> {ignoredUnique.length} SKU{ignoredUnique.length>1?'s':''} no reconocido{ignoredUnique.length>1?'s':''}:</strong> {ignoredUnique.slice(0,5).join(', ')}{ignoredUnique.length>5?'…':''}. Se ignorarán al importar.
        </div>
      )}

      {rows.length > 0 && (
        <div style={{marginTop:14}}>
          <div style={{fontSize:11, fontWeight:700, color:'var(--ink-muted)', textTransform:'uppercase', letterSpacing:'.1em', marginBottom:8}}>
            Preview · {Math.min(rows.length, 8)} de {rows.length} pedidos · {totalUds} uds. aplicables
          </div>
          <table className="data-table" style={{borderRadius:6, overflow:'hidden', border:'1px solid var(--border)'}}>
            <thead><tr><th>SKU</th><th>Producto (resuelto)</th><th style={{textAlign:'right'}}>Cant.</th><th></th></tr></thead>
            <tbody>
              {rows.slice(0,8).map((r, i) => {
                const known = knownSkus.has(r.sku);
                const meta = catalog.find(c => c.sku === r.sku);
                return (
                  <tr key={i} style={{opacity: known ? 1 : .55}}>
                    <td><span className="order-num">{r.sku}</span></td>
                    <td style={{fontSize:11}}>{known ? `${meta?.modelo}${meta?.color && meta.color !== '—' ? ' ' + meta.color : ''}` : <em style={{color:'var(--amber)'}}>SKU no reconocido</em>}</td>
                    <td style={{textAlign:'right'}}><span className="cell-color-num">{r.cantidad}</span></td>
                    <td style={{width:1, textAlign:'right'}}>
                      {known ? <Icon n="check-circle" s={14} c="var(--green)"/> : <Icon n="alert" s={14} c="var(--amber)"/>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
