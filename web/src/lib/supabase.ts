import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en .env.local. Copiá .env.example y completá con los valores reales.'
  );
}

export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
});

/** Convención decisión B: username → email virtual */
export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@macario.local`;
}
