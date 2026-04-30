import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database.types';

type Channel = Database['public']['Tables']['channels']['Row'];

export function useChannels() {
  return useQuery({
    queryKey: ['channels'],
    queryFn: async (): Promise<Channel[]> => {
      const { data, error } = await supabase
        .from('channels')
        .select('*')
        .order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000, // los channels casi no cambian
  });
}

export function useChannel(channelId: string | undefined) {
  return useQuery({
    queryKey: ['channel', channelId],
    enabled: !!channelId,
    queryFn: async (): Promise<Channel | null> => {
      const { data, error } = await supabase
        .from('channels')
        .select('*')
        .eq('id', channelId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
