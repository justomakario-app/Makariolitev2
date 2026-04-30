/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.types';

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

/**
 * Resuelve el input del campo "Usuario" del login a un email.
 * - Si el input ya contiene '@', se usa tal cual (acepta emails reales como
 *   `justomakariotech@gmail.com`).
 * - Si no, se aplica la convención decisión B: `{username}@macario.local`.
 */
export function usernameToEmail(usernameOrEmail: string): string {
  const trimmed = usernameOrEmail.trim().toLowerCase();
  if (trimmed.includes('@')) return trimmed;
  return `${trimmed}@macario.local`;
}
