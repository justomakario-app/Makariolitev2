/**
 * Edge Function: invite_user
 *
 * Crea un usuario nuevo con auth + profile en una sola operación.
 * Solo accesible para callers con role 'owner' o 'admin'.
 *
 * Body JSON:
 *   {
 *     username: string  // 3-32 chars [a-z0-9_]
 *     name:     string
 *     role:     role_enum (default 'embalaje')
 *     area:     string | null
 *     password: string (mín. 6 chars)
 *   }
 *
 * El email se genera como `{username}@macario.local`.
 * El trigger `handle_new_user` crea el row en `public.profiles` automáticamente.
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonRes({ error: 'Falta token de autorización' }, 401);
    }

    // Validar caller con su JWT
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return jsonRes({ error: 'Sesión inválida' }, 401);
    }

    // Cliente admin (bypassa RLS) para validar el rol del caller
    const admin = createClient(supabaseUrl, serviceRole);
    const { data: profile, error: profErr } = await admin
      .from('profiles')
      .select('role, active')
      .eq('id', userData.user.id)
      .single();

    if (profErr || !profile || !profile.active) {
      return jsonRes({ error: 'Profile no encontrado o inactivo' }, 403);
    }
    if (!['owner', 'admin'].includes(profile.role)) {
      return jsonRes({ error: 'Solo owner o admin pueden invitar usuarios' }, 403);
    }

    // Parse y validar body
    const { username, name, role, area, password } = await req.json();
    if (!username || !name || !password) {
      return jsonRes({ error: 'Faltan campos requeridos: username, name, password' }, 400);
    }
    if (!/^[a-z0-9_]{3,32}$/.test(username)) {
      return jsonRes({ error: 'Username inválido. Regla: 3-32 caracteres [a-z0-9_]' }, 400);
    }
    if (typeof password !== 'string' || password.length < 6) {
      return jsonRes({ error: 'Password debe tener al menos 6 caracteres' }, 400);
    }

    // Email virtual (decisión B del informe)
    const email = `${username}@macario.local`;

    // Verificar que el username no exista ya
    const { data: existing } = await admin
      .from('profiles')
      .select('id')
      .eq('username', username)
      .maybeSingle();
    if (existing) {
      return jsonRes({ error: `Username "${username}" ya existe` }, 409);
    }

    // Crear user con Auth Admin (el trigger handle_new_user crea el profile)
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        username,
        name,
        role: role || 'embalaje',
        area: area || null,
        created_by: userData.user.id,
      },
    });

    if (createErr) {
      return jsonRes({ error: createErr.message }, 400);
    }

    return jsonRes({
      ok: true,
      user_id: created.user!.id,
      username,
      email,
      name,
      role: role || 'embalaje',
    }, 200);
  } catch (e) {
    return jsonRes({ error: (e as Error).message }, 500);
  }
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
