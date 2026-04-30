/** Formatters compartidos (port de mock.js fmt.*) */

export const fmt = {
  date: (iso: string | null | undefined): string => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
  },
  dateTime: (iso: string | null | undefined): string => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('es-AR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  },
  agoSimple: (iso: string | null | undefined): string => {
    if (!iso) return '—';
    const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
    if (min < 1) return 'ahora';
    if (min < 60) return `hace ${min} min`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `hace ${hr}h`;
    const d = Math.floor(hr / 24);
    return `hace ${d}d`;
  },
};

/** Helper para devolver "modelo + color" para mostrar en UI. */
export function skuName(sku: string, modelo: string | null, color: string | null): string {
  if (!modelo) return sku;
  if (!color || color === '—') return modelo;
  return `${modelo} ${color}`;
}
