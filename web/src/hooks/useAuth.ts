import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { User, Session } from '@supabase/supabase-js';
import { supabase, usernameToEmail } from '@/lib/supabase';
import type { Database } from '@/types/database.types';

type Profile = Database['public']['Tables']['profiles']['Row'];
type RolePerm = Database['public']['Tables']['role_permissions']['Row'];

/** Suscripción al estado de auth de Supabase. */
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, user: session?.user ?? null, loading };
}

/** Profile del usuario actual + role permissions. */
export function useCurrentProfile() {
  const { user } = useSession();
  return useQuery({
    queryKey: ['current-profile', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<{ profile: Profile; perms: RolePerm | null }> => {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user!.id)
        .single();
      if (error) throw error;

      const { data: perms } = await supabase
        .from('role_permissions')
        .select('*')
        .eq('role', profile.role)
        .maybeSingle();

      return { profile, perms };
    },
  });
}

/** Login mutation: username + password → signInWithPassword con email virtual. */
export function useLogin() {
  return useMutation({
    mutationFn: async (vars: { username: string; password: string }): Promise<User> => {
      const email = usernameToEmail(vars.username);
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password: vars.password,
      });
      if (error) {
        // Mejor mensaje de error
        if (error.message.toLowerCase().includes('invalid')) {
          throw new Error('Usuario o contraseña incorrectos.');
        }
        throw error;
      }
      if (!data.user) throw new Error('No se pudo iniciar sesión.');
      return data.user;
    },
  });
}

/** Logout — limpia sesión + cache de queries. */
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
    onSuccess: () => {
      qc.clear();
    },
  });
}
