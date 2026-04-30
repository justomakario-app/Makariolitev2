import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Database } from '../types/database.types';

type HistDia = Database['public']['Views']['view_historico_dia']['Row'];
type ProdLog = Database['public']['Tables']['production_logs']['Row'];

interface UseHistoricoMesArgs {
  year: number;
  month: number; // 0-indexed (Jan=0)
  channelId?: string; // 'todos' o id del canal
  sku?: string;       // 'todos' o sku
}

/** Devuelve registros agrupados por (fecha, channel_id) del mes pedido. */
export function useHistoricoMes({ year, month, channelId, sku }: UseHistoricoMesArgs) {
  // Calcular primer y último día del mes
  const firstDay = new Date(year, month, 1).toISOString().slice(0, 10);
  const lastDay = new Date(year, month + 1, 0).toISOString().slice(0, 10);

  return useQuery({
    queryKey: ['historico-mes', year, month, channelId ?? 'todos', sku ?? 'todos'],
    queryFn: async (): Promise<HistDia[]> => {
      let q = supabase
        .from('view_historico_dia')
        .select('*')
        .gte('fecha', firstDay)
        .lte('fecha', lastDay);
      if (channelId && channelId !== 'todos') q = q.eq('channel_id', channelId);
      const { data, error } = await q;
      if (error) throw error;
      // Filtrado por SKU se hace via prod_logs si aplica — la vista no incluye sku.
      // Si filtran por SKU, reagrupamos desde production_logs.
      if (sku && sku !== 'todos') {
        const { data: logs, error: errLogs } = await supabase
          .from('production_logs')
          .select('fecha, channel_id, cantidad')
          .gte('fecha', firstDay)
          .lte('fecha', lastDay)
          .eq('sku', sku);
        if (errLogs) throw errLogs;
        // Reagrupar
        const byKey = new Map<string, { fecha: string; channel_id: string; unidades: number; registros: number }>();
        for (const l of logs ?? []) {
          const k = `${l.fecha}|${l.channel_id}`;
          const existing = byKey.get(k) ?? { fecha: l.fecha, channel_id: l.channel_id, unidades: 0, registros: 0 };
          existing.unidades += l.cantidad;
          existing.registros += 1;
          byKey.set(k, existing);
        }
        return Array.from(byKey.values()).map(v => ({
          fecha: v.fecha,
          channel_id: v.channel_id,
          channel_label: null,
          channel_color: null,
          registros: v.registros,
          unidades: v.unidades,
          skus_distintos: 1,
          operarios_distintos: null,
        })) as HistDia[];
      }
      return data ?? [];
    },
  });
}

/** Detalle de logs de un día específico. */
export function useHistoricoDia(fecha: string | null, sku?: string) {
  return useQuery({
    queryKey: ['historico-dia', fecha, sku ?? 'todos'],
    enabled: !!fecha,
    queryFn: async (): Promise<ProdLog[]> => {
      let q = supabase
        .from('production_logs')
        .select('*')
        .eq('fecha', fecha!)
        .order('created_at', { ascending: false });
      if (sku && sku !== 'todos') q = q.eq('sku', sku);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}
