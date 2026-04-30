import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { queryClient } from '@/lib/queryClient';
import type { Database } from '@/types/database.types';

type DashboardKpi = Database['public']['Views']['view_dashboard_kpis']['Row'];

export function useDashboardKpis() {
  // Subscribe to realtime updates on carrier_state and orders to invalidate
  useEffect(() => {
    const channel = supabase
      .channel('dashboard-kpis')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'carrier_state' }, () => {
        queryClient.invalidateQueries({ queryKey: ['dashboard-kpis'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        queryClient.invalidateQueries({ queryKey: ['dashboard-kpis'] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return useQuery({
    queryKey: ['dashboard-kpis'],
    queryFn: async (): Promise<DashboardKpi[]> => {
      const { data, error } = await supabase
        .from('view_dashboard_kpis')
        .select('*')
        .order('channel_id');
      if (error) throw error;
      return data ?? [];
    },
  });
}
