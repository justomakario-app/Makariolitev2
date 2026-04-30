import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { queryClient } from '../lib/queryClient';
import type { Database, Json } from '../types/database.types';

type CarrierMeta = Database['public']['Views']['view_carrier_with_meta']['Row'];
type Order = Database['public']['Tables']['orders']['Row'];
type ImportBatch = Database['public']['Tables']['import_batches']['Row'];
type Jornada = Database['public']['Tables']['jornadas']['Row'];

/** Tabla del carrier con join al catálogo. Suscrita a realtime. */
export function useCarrierTable(channelId: string) {
  useEffect(() => {
    const ch = supabase
      .channel(`carrier-${channelId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'carrier_state', filter: `channel_id=eq.${channelId}` },
        () => queryClient.invalidateQueries({ queryKey: ['carrier-table', channelId] })
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [channelId]);

  return useQuery({
    queryKey: ['carrier-table', channelId],
    queryFn: async (): Promise<CarrierMeta[]> => {
      const { data, error } = await supabase
        .from('view_carrier_with_meta')
        .select('*')
        .eq('channel_id', channelId)
        .order('sku');
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Pedidos individuales activos del canal. */
export function useCarrierOrders(channelId: string) {
  useEffect(() => {
    const ch = supabase
      .channel(`carrier-orders-${channelId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `channel_id=eq.${channelId}` },
        () => queryClient.invalidateQueries({ queryKey: ['carrier-orders', channelId] })
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [channelId]);

  return useQuery({
    queryKey: ['carrier-orders', channelId],
    queryFn: async (): Promise<Order[]> => {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('channel_id', channelId)
        .in('status', ['pendiente', 'arrastrado'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCarrierBatches(channelId: string) {
  return useQuery({
    queryKey: ['carrier-batches', channelId],
    queryFn: async (): Promise<ImportBatch[]> => {
      const { data, error } = await supabase
        .from('import_batches')
        .select('*')
        .eq('channel_id', channelId)
        .order('imported_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCarrierJornadas(channelId: string) {
  return useQuery({
    queryKey: ['carrier-jornadas', channelId],
    queryFn: async (): Promise<Jornada[]> => {
      const { data, error } = await supabase
        .from('jornadas')
        .select('*')
        .eq('channel_id', channelId)
        .order('fecha', { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });
}

// ─── Mutations: RPCs ─────────────────────────────────────────────────────

export function useRegisterProduction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      sku: string;
      channel_id: string;
      cantidad: number;
      notas?: string | null;
    }) => {
      const { data, error } = await supabase.rpc('rpc_register_production', {
        p_sku: vars.sku,
        p_channel_id: vars.channel_id,
        p_cantidad: vars.cantidad,
        p_notas: vars.notas ?? undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['carrier-table'] });
      qc.invalidateQueries({ queryKey: ['dashboard-kpis'] });
      qc.invalidateQueries({ queryKey: ['production-logs'] });
    },
  });
}

type ImportItem = {
  sku: string;
  cantidad: number;
  order_number?: string;
  cliente?: string;
  fecha_pedido?: string;
};

export function useImportBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      channel_id: string;
      filename: string;
      file_hash: string;
      items: ImportItem[];
      storage_path?: string | null;
    }) => {
      const { data, error } = await supabase.rpc('rpc_import_batch', {
        p_channel_id: vars.channel_id,
        p_filename: vars.filename,
        p_file_hash: vars.file_hash,
        p_items: vars.items as unknown as Json,
        p_storage_path: vars.storage_path ?? undefined,
      });
      if (error) throw error;
      return data as {
        batch_id: string;
        inserted_count: number;
        unidades_count?: number;
        ignored_skus: string[];
        existed: boolean;
        message?: string;
      };
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['carrier-table', vars.channel_id] });
      qc.invalidateQueries({ queryKey: ['carrier-orders', vars.channel_id] });
      qc.invalidateQueries({ queryKey: ['carrier-batches', vars.channel_id] });
      qc.invalidateQueries({ queryKey: ['dashboard-kpis'] });
    },
  });
}

export function useCloseJornada() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { channel_id: string; fecha?: string }) => {
      const { data, error } = await supabase.rpc('rpc_close_jornada', {
        p_channel_id: vars.channel_id,
        p_fecha: vars.fecha ?? undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['carrier-table', vars.channel_id] });
      qc.invalidateQueries({ queryKey: ['carrier-orders', vars.channel_id] });
      qc.invalidateQueries({ queryKey: ['carrier-jornadas', vars.channel_id] });
      qc.invalidateQueries({ queryKey: ['dashboard-kpis'] });
    },
  });
}
