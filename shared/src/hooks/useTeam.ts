import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Database } from '../types/database.types';

type Profile = Database['public']['Tables']['profiles']['Row'];
type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];

export function useProfiles() {
  return useQuery({
    queryKey: ['profiles'],
    queryFn: async (): Promise<Profile[]> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('role')
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useInviteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      username: string;
      name: string;
      role: string;
      area?: string | null;
      password: string;
    }) => {
      const { data, error } = await supabase.functions.invoke('invite_user', {
        body: vars,
      });
      if (error) {
        // Si el error es FunctionsHttpError, leer el mensaje del body
        const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
        if (ctx?.json) {
          const body = await ctx.json();
          throw new Error(body.error ?? error.message);
        }
        throw error;
      }
      return data as {
        ok: boolean;
        user_id: string;
        username: string;
        email: string;
        name: string;
        role: string;
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profiles'] });
    },
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; data: ProfileUpdate }) => {
      const { error } = await supabase
        .from('profiles')
        .update(vars.data)
        .eq('id', vars.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profiles'] });
    },
  });
}

export function useToggleProfileActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; active: boolean }) => {
      const { error } = await supabase
        .from('profiles')
        .update({ active: vars.active })
        .eq('id', vars.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profiles'] });
    },
  });
}
