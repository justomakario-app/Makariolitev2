/**
 * Edge Function: b2b_signup
 *
 * Da de alta la cuenta de un CLIENTE MAYORISTA a partir de un código de
 * invitación. Es el único camino de alta de la tienda: el registro público de
 * Supabase tiene que quedar APAGADO ("Allow new users to sign up" = OFF).
 *
 * ─── Por qué esto existe y no un supabase.auth.signUp() ──────────────────
 * El trigger handle_new_user() lee el rol del usuario desde
 * raw_user_meta_data. En un signup público ese metadata lo controla quien se
 * registra: cualquiera con la anon key podría pedir role='owner' y quedar
 * adentro del sistema de la planta. Por eso el alta pasa por acá, con
 * service_role, que:
 *   1. valida el código CONTRA LA BASE antes de crear nada, y
 *   2. fija el metadata a mano — marcado b2b:'true' en app_metadata, sin
 *      'role' — para que handle_new_user NO le cree un profile.
 *
 * Sin profile, is_active_user() da false y el usuario no ve absolutamente
 * nada del sistema interno: solo existe para las RPC b2b_*.
 *
 * (0155) Desde esa migración el trigger ademas exige app_metadata.interno
 * para crear un profile, y acá nunca se manda: aunque alguien cambiara este
 * archivo para colar un 'role', el alta seguiría sin dar acceso interno.
 *
 * (0158) La marca b2b viaja en **app_metadata**, no en user_metadata.
 * user_metadata lo escribe quien se registra: mientras el trigger lo leía de
 * ahí, un signup público con {"data":{"b2b":"true"}} salía por la puerta del
 * B2B y no quedaba registrado en auth_alta_bloqueada — se apagaba solo el
 * aviso de "alguien intentó registrarse". app_metadata solo lo puede escribir
 * el service_role, o sea únicamente esta función.
 * ⚠ Esta versión y la migración 0158 van juntas: primero se despliega esto.
 *
 * ─── Lo que esta función NO hace ─────────────────────────────────────────
 * NO canjea la invitación ni crea el b2b_usuario. Eso lo hace
 * b2b_rpc_canjear_invitacion con la sesión ya iniciada del propio cliente,
 * que además valida que el correo de la sesión coincida con el de la
 * invitación. Acá solo se crea la credencial. Si el alta se corta entre los
 * dos pasos, la invitación queda 'pendiente' y el cliente puede volver a
 * canjearla entrando con la contraseña que acaba de elegir.
 *
 * Body JSON:
 *   { token: string, password: string, nombre?: string, telefono?: string }
 *
 * Respuestas:
 *   200 { ok: true, email }
 *   400 { error }   token/contraseña inválidos
 *   403 { error }   módulo B2B apagado
 *   409 { error }   ese correo ya tiene una cuenta  ← la tienda lo maneja
 *   500 { error }
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Mismo hash que guarda la base: encode(digest(token,'sha256'),'hex'). */
async function sha256Hex(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonRes({ error: 'Método no permitido' }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const body = await req.json().catch(() => null);
    if (!body) return jsonRes({ error: 'Body inválido' }, 400);

    const token = String(body.token || '').trim();
    const password = String(body.password || '');
    const nombre = String(body.nombre || '').trim().slice(0, 120);
    const telefono = String(body.telefono || '').trim().slice(0, 40);

    if (!token) return jsonRes({ error: 'Falta el código de invitación.' }, 400);
    if (password.length < 8) {
      return jsonRes({ error: 'La contraseña tiene que tener al menos 8 caracteres.' }, 400);
    }

    // service_role: pasa por encima de RLS. Este cliente NUNCA sale de acá.
    const admin = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // (1) Kill-switch. Si el equipo apagó la tienda, tampoco se dan altas.
    //     Mismo flag que consulta b2b_fn_guard() en todas las RPC, y falla
    //     cerrado igual que allá: si no se puede leer, no se da de alta.
    const { data: flag, error: flagErr } = await admin
      .from('app_flags')
      .select('enabled')
      .eq('name', 'b2b')
      .maybeSingle();
    if (flagErr || !flag || !flag.enabled) {
      return jsonRes({ error: 'La tienda está cerrada en este momento.' }, 403);
    }

    // (2) Validar el código contra la base ANTES de crear nada.
    //     En la tabla vive el hash, no el token: se compara hasheando.
    const { data: inv, error: invErr } = await admin
      .from('b2b_invitacion')
      .select('id, email, estado, expira_at')
      .eq('token_hash', await sha256Hex(token))
      .maybeSingle();

    // Un mensaje único para "no existe", "ya se usó", "revocada" y "vencida":
    // distinguirlos convertiría este endpoint en un oráculo de códigos.
    const invalido = { error: 'Ese código no existe, ya se usó o venció.' };
    if (invErr) return jsonRes({ error: 'No se pudo validar el código.' }, 500);
    if (!inv || inv.estado !== 'pendiente') return jsonRes(invalido, 400);
    if (new Date(inv.expira_at).getTime() <= Date.now()) return jsonRes(invalido, 400);

    const email = String(inv.email || '').trim().toLowerCase();
    if (!email) return jsonRes({ error: 'La invitación no tiene correo asociado.' }, 400);

    // (3) Crear la credencial.
    //     email_confirm: true porque la invitación YA es la verificación del
    //     correo — se lo mandó el equipo a esa dirección. Pedirle además que
    //     confirme un mail sería un paso de más para el mismo control.
    //     app_metadata.b2b es lo que lee handle_new_user() para NO crear un
    //     profile interno; va ahí y no en user_metadata porque user_metadata
    //     lo controla el que se registra (ver cabecera, 0158). Nunca se manda
    //     'role' ni 'interno'.
    const { error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: {
        b2b: 'true',
      },
      user_metadata: {
        nombre: nombre || null,
        telefono: telefono || null,
        invitacion_id: inv.id,
      },
    });

    if (createErr) {
      const msg = String(createErr.message || '');
      // El correo ya tiene cuenta: es el caso normal del segundo comprador
      // del mismo cliente. La tienda lo detecta por este texto y le ofrece
      // entrar con su contraseña en vez de crear otra cuenta.
      if (/already|exists|registered/i.test(msg)) {
        return jsonRes({ error: 'Ese correo ya tiene una cuenta.' }, 409);
      }
      return jsonRes({ error: msg || 'No se pudo crear la cuenta.' }, 400);
    }

    // El canje lo hace el cliente con su propia sesión (ver cabecera).
    return jsonRes({ ok: true, email }, 200);
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
