import { useState } from 'react';
import * as XLSX from 'xlsx';
import { Icon } from '@/components/shared/Icon';
import { useToast } from '@/components/shared/Toast';
import { useChannels } from '@macario/shared/hooks/useChannels';
import { useSkuCatalog } from '@macario/shared/hooks/useCatalog';
import { useImportBatch } from '@macario/shared/hooks/useCarrier';
import { sha256Hex } from '@macario/shared/lib/queryClient';

interface ParsedRow {
  sku: string;
  cantidad: number;
  order_number?: string;
  cliente?: string;
  fecha_pedido?: string;
}

export function ImportarPage() {
  const toast = useToast();
  const { data: channels = [] } = useChannels();
  const { data: catalog = [] } = useSkuCatalog();
  const importMut = useImportBatch();

  const [channelId, setChannelId] = useState('colecta');
  const [file, setFile] = useState<File | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

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
        setParseError('Falta columna "SKU" o "Unidades" en la primera hoja.');
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
        setParseError('Columnas detectadas pero todas las filas estaban vacías.');
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
        toast.warning('Este archivo ya fue importado antes.');
      } else {
        const ch = channels.find(c => c.id === channelId);
        toast.success(`${result.inserted_count} pedidos importados a ${ch?.label}`);
      }
      // Reset
      setFile(null); setHash(null); setRows([]); setParseError(null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const C = channels.find(c => c.id === channelId);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Importar Excel</div>
          <div className="page-sub">Subí el archivo exportado de ML o Tienda Nube</div>
        </div>
      </div>

      {/* Selector de canal */}
      <div style={{marginBottom: 14}}>
        <label className="field-label">Canal de destino</label>
        <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
          {channels.map(c => (
            <label
              key={c.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: 12,
                border: `2px solid ${channelId === c.id ? c.color : 'var(--border)'}`,
                background: channelId === c.id ? `${c.color}1a` : 'var(--paper)',
                borderRadius: 8, cursor: 'pointer',
                minHeight: 56,
              }}
            >
              <input
                type="radio"
                checked={channelId === c.id}
                onChange={() => setChannelId(c.id)}
                style={{width: 18, height: 18, accentColor: c.color}}
              />
              <div style={{flex: 1}}>
                <div style={{fontSize: 13, fontWeight: 700}}>{c.label}</div>
                <div style={{fontSize: 11, color: 'var(--ink-muted)', marginTop: 2}}>{c.sub ?? ''}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* File picker */}
      <label
        htmlFor="mobile-file-input"
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: '24px 16px', border: '2px dashed var(--border-str)',
          borderRadius: 10, cursor: 'pointer',
          background: 'var(--paper-off)', textAlign: 'center', gap: 8,
          marginBottom: 12, minHeight: 130,
        }}
      >
        <Icon n={parsing ? 'loader' : file ? 'check-circle' : 'upload'} s={32} c={file ? 'var(--green)' : 'var(--ink-muted)'}/>
        <div style={{fontSize: 13, fontWeight: 700}}>
          {parsing ? 'Leyendo archivo…' : file ? file.name : 'Tocá para seleccionar archivo'}
        </div>
        <div style={{fontSize: 11, color: 'var(--ink-muted)'}}>
          {file ? `${Math.round(file.size / 1024)} KB · hash ${hash?.slice(0, 10)}…` : '.xlsx, .xls o .csv'}
        </div>
        <input
          id="mobile-file-input"
          type="file"
          accept=".xlsx,.xls,.csv"
          style={{display: 'none'}}
          onChange={e => onPickFile(e.target.files?.[0] ?? null)}
        />
      </label>

      {parseError && (
        <div style={{
          padding: '10px 12px', marginBottom: 12,
          background: 'var(--red-bg)', border: '1px solid rgba(220,38,38,.3)',
          borderRadius: 6, fontSize: 12, color: 'var(--red)',
          display: 'flex', gap: 8, alignItems: 'flex-start',
        }}>
          <Icon n="alert" s={14}/> {parseError}
        </div>
      )}

      {rows.length > 0 && ignoredUnique.length > 0 && (
        <div style={{
          padding: '10px 12px', marginBottom: 12,
          background: 'var(--amber-bg)', border: '1px solid rgba(217,119,6,.3)',
          borderRadius: 6, fontSize: 11, color: 'var(--amber)',
        }}>
          <Icon n="alert" s={14}/>
          <strong> {ignoredUnique.length} SKU{ignoredUnique.length > 1 ? 's' : ''} no reconocido{ignoredUnique.length > 1 ? 's' : ''}:</strong>
          {' ' + ignoredUnique.slice(0, 3).join(', ') + (ignoredUnique.length > 3 ? '…' : '')}. Se ignorarán.
        </div>
      )}

      {rows.length > 0 && (
        <div style={{
          padding: 14, marginBottom: 12,
          background: 'var(--paper-off)', border: '1px solid var(--border)',
          borderRadius: 8, fontSize: 12,
        }}>
          <div style={{fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-muted)', marginBottom: 8}}>
            Resumen
          </div>
          <div style={{lineHeight: 1.7}}>
            <div>📄 <strong>{file?.name}</strong></div>
            <div>📦 <strong>{aplicables.length}</strong> pedidos aplicables · <strong>{totalUds}</strong> uds.</div>
            {ignoredUnique.length > 0 && <div>⚠️ {ignoredUnique.length} SKUs ignorados</div>}
            <div>🎯 Destino: <strong>{C?.label}</strong></div>
          </div>
        </div>
      )}

      <button
        className="btn-primary"
        onClick={submit}
        disabled={!file || aplicables.length === 0 || importMut.isPending || parsing}
        style={{width: '100%', justifyContent: 'center', minHeight: 52, fontSize: 13}}
      >
        {importMut.isPending
          ? <span className="loader" style={{borderColor: 'rgba(255,255,255,.3)', borderTopColor: '#fff'}}/>
          : <><Icon n="upload" s={16}/> Importar {aplicables.length > 0 ? `${aplicables.length} pedidos` : ''}</>}
      </button>
    </div>
  );
}
