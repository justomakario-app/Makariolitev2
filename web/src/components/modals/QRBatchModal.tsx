import { useState } from 'react';
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import { Modal } from '@/components/shared/Modal';
import { Icon } from '@/components/shared/Icon';
import { useToast } from '@/components/shared/Toast';
import type { Database } from '@/types/database.types';

type Sku = Database['public']['Tables']['sku_catalog']['Row'];

interface Props {
  open: boolean;
  skus: Sku[];
  onClose: () => void;
}

/**
 * Genera un PDF con un QR por SKU. Layout: 4 columnas × 5 filas = 20 QRs por hoja A4.
 * El QR codifica el SKU directo (compatible con el scanner del modal Producir
 * y con el flujo de embalado).
 */
export function QRBatchModal({ open, skus, onClose }: Props) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    if (skus.length === 0) {
      toast.error('Sin SKUs para imprimir');
      return;
    }
    setBusy(true);
    try {
      const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
      const pageW = 210;
      const pageH = 297;
      const cols = 4;
      const rows = 5;
      const perPage = cols * rows; // 20 por hoja
      const margin = 12;
      const cellW = (pageW - margin * 2) / cols;
      const cellH = (pageH - margin * 2) / rows;
      const qrSize = Math.min(cellW, cellH) - 18; // dejar espacio para texto

      for (let i = 0; i < skus.length; i++) {
        const sku = skus[i];
        const idx = i % perPage;
        if (i > 0 && idx === 0) pdf.addPage();
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const x = margin + col * cellW;
        const y = margin + row * cellH;

        // Generar QR como dataURL
        const qrUrl = await QRCode.toDataURL(sku.sku, {
          width: 600,
          margin: 1,
          errorCorrectionLevel: 'M',
        });

        // Centrar QR en la celda
        const qrX = x + (cellW - qrSize) / 2;
        pdf.addImage(qrUrl, 'PNG', qrX, y + 4, qrSize, qrSize);

        // Texto debajo: SKU (mono) + modelo
        const textY = y + qrSize + 9;
        pdf.setFont('courier', 'bold');
        pdf.setFontSize(11);
        pdf.text(sku.sku, x + cellW / 2, textY, { align: 'center' });

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7);
        const label = sku.color && sku.color !== '—'
          ? `${sku.modelo} · ${sku.color}`
          : sku.modelo;
        // Truncar si es muy largo
        const truncated = label.length > 32 ? label.slice(0, 30) + '…' : label;
        pdf.text(truncated, x + cellW / 2, textY + 4, { align: 'center' });
      }

      const filename = `macario-qrs-${new Date().toISOString().slice(0, 10)}.pdf`;
      pdf.save(filename);
      toast.success(`PDF generado · ${skus.length} QRs`);
      onClose();
    } catch (e) {
      toast.error('Error generando PDF: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Generar QRs del catálogo" footer={
      <>
        <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn-primary" onClick={generate} disabled={busy || skus.length === 0}>
          {busy
            ? <><span className="loader" style={{borderColor:'rgba(255,255,255,.3)', borderTopColor:'#fff'}}/> Generando…</>
            : <><Icon n="download" s={14}/> Descargar PDF ({skus.length} QRs)</>}
        </button>
      </>
    }>
      <div style={{fontSize:12, color:'var(--ink-soft)', lineHeight:1.7}}>
        Vamos a generar un PDF con <strong>{skus.length} código{skus.length !== 1 ? 's' : ''} QR</strong>
        {' '}— uno por SKU del filtro actual, listos para imprimir y pegar en cada caja.
      </div>
      <div style={{
        marginTop:14, padding:14, background:'var(--paper-off)',
        border:'1px solid var(--border)', borderRadius:6, fontSize:11,
        color:'var(--ink-muted)', lineHeight:1.6,
      }}>
        <div><strong>Layout:</strong> 4 columnas × 5 filas = 20 QRs por página A4.</div>
        <div><strong>Contenido del QR:</strong> el SKU literal (ej: <code style={{fontFamily:'var(--mono)'}}>MAD061</code>).</div>
        <div><strong>Lectura:</strong> al escanear con el modal Producir o en embalaje, el sistema resuelve modelo + color + variante automáticamente desde el catálogo.</div>
      </div>
    </Modal>
  );
}
