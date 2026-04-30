import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { queryClient } from '../lib/queryClient';
import type { Database } from '../types/database.types';
import { useSession } from './useAuth';

type Notification = Database['public']['Tables']['notifications']['Row'];

export function useNotifications() {
  const { user } = useSession();

  // Realtime: escuchar inserts de notificaciones del propio user
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`notifications-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        () => queryClient.invalidateQueries({ queryKey: ['notifications', user.id] })
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user]);

  return useQuery({
    queryKey: ['notifications', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Notification[]> => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  const { user } = useSession();
  return useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Sin usuario activo');
      const { error } = await supabase
        .from('notifications')
        .update({ leida: true })
        .eq('user_id', user.id)
        .eq('leida', false);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}
