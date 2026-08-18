/**
 * Edge Function: b2b_signup  ·  v4
 *
 * Da de alta la cuenta de un CLIENTE MAYORISTA. Es el único camino de alta de
 * la tienda: el registro público de Supabase tiene que quedar APAGADO
 * ("Allow new users to sign up" = OFF). Que esté apagado NO impide el alta
 * abierta: acá se crea el usuario con la Admin API y service_role, que pasa
 * por encima de ese switch. Lo que el switch apaga es que cualquiera se
 * registre directo con la anon key, sin pasar por las validaciones de acá.
 *
 * ─── Dos caminos ─────────────────────────────────────────────────────────
 *   A. REGISTRO ABIERTO (v4, el normal). El dueño manda un link, el comprador
 *      completa sus datos y los de su empresa, y queda comprando en el
 *      momento. Sin código y sin aprobación: decisión del dueño.
 *      body: { email, password, nombre, telefono?, empresa, cuit,
 *              localidad?, provincia?, canal? }
 *
 *   B. INVITACIÓN (el de antes, sigue vivo). Sirve para sumar un SEGUNDO
 *      comprador a un cliente que ya existe, que es justo lo que el registro
 *      abierto no puede hacer solo (ver más abajo).
 *      body: { token, password, nombre?, telefono? }
 *
 * El camino lo decide la presencia de `token`.
 *
 * ─── Por qué esto existe y no un supabase.auth.signUp() ──────────────────
 * El trigger handle_new_user() decide con el metadata si el usuario nuevo es
 * interno (y le crea un profile) o no. En un signup público ese metadata lo
 * controla quien se registra: cualquiera con la anon key podría pedir
 * role='owner' y quedar adentro del sistema de la planta. Por eso el alta pasa
 * por acá, con service_role, que fija el metadata a mano — marcado b2b:'true'
 * en app_metadata, sin 'role' y sin 'interno' — para que handle_new_user NO le
 * cree un profile. Sin profile, is_active_user() da false y el usuario no ve
 * absolutamente nada del sistema interno: solo existe para las RPC b2b_*.
 *
 * (0158) La marca b2b viaja en **app_metadata**, no en user_metadata.
 * user_metadata lo escribe quien se registra: mientras el trigger lo leía de
 * ahí, un signup público con {"data":{"b2b":"true"}} salía por la puerta del
 * B2B sin quedar registrado en auth_alta_bloqueada. app_metadata solo lo puede
 * escribir el service_role, o sea únicamente esta función.
 *
 * ─── El alta abierta y el CUIT ajeno ─────────────────────────────────────
 * La empresa y el comprador los crea b2b_rpc_alta_publica (0163), que es
 * service_role-only. Ahí está la regla importante: si el CUIT ya pertenece a
 * un cliente existente, el que se registra NO entra a esa cuenta — queda
 * 'pendiente'. El CUIT de una empresa está en cualquier factura suya; si
 * alcanzara para entrar, cualquiera vería el historial de pedidos y la lista
 * de precios de otro. Para ese caso está el camino B, la invitación.
 *
 * ─── Si el alta se corta por la mitad ────────────────────────────────────
 * Crear la credencial y crear la empresa son dos sistemas distintos (auth y la
 * base) y no comparten transacción. Si lo segundo falla, acá se BORRA el
 * usuario de auth recién creado: si no, el comprador queda con una credencial
 * que entra a ningún lado y que además le bloquea reintentar con su propio
 * mail ("ese correo ya tiene una cuenta").
 *
 * Respuestas:
 *   200 { ok: true, email, estado, cliente, empresa_nueva }
 *   400 { error }   datos inválidos / token vencido
 *   403 { error }   tienda apagada
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

const txt = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

/** Ese correo ya existe. Los dos caminos lo tratan igual y la tienda lo lee. */
const YA_EXISTE = /already|exists|registered|duplicate/i;

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

    const token = txt(body.token, 200);
    const password = String(body.password || '');
    const nombre = txt(body.nombre, 120);
    const telefono = txt(body.telefono, 40);

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

    /* ══ CAMINO B — invitación ══════════════════════════════════════════
       Sin cambios respecto de v3. El canje (crear el b2b_usuario y pegarlo
       al cliente) lo sigue haciendo b2b_rpc_canjear_invitacion con la sesión
       del propio comprador, que además chequea que el correo de la sesión sea
       el de la invitación. Acá solo se crea la credencial. */
    if (token) {
      const { data: inv, error: invErr } = await admin
        .from('b2b_invitacion')
        .select('id, email, estado, expira_at')
        .eq('token_hash', await sha256Hex(token))
        .maybeSingle();

      // Un mensaje único para "no existe", "ya se usó", "revocada" y
      // "vencida": distinguirlos convierte esto en un oráculo de códigos.
      const invalido = { error: 'Ese código no existe, ya se usó o venció.' };
      if (invErr) return jsonRes({ error: 'No se pudo validar el código.' }, 500);
      if (!inv || inv.estado !== 'pendiente') return jsonRes(invalido, 400);
      if (new Date(inv.expira_at).getTime() <= Date.now()) return jsonRes(invalido, 400);

      const email = String(inv.email || '').trim().toLowerCase();
      if (!email) return jsonRes({ error: 'La invitación no tiene correo asociado.' }, 400);

      // email_confirm: true porque la invitación YA es la verificación del
      // correo — se lo mandó el equipo a esa dirección.
      const { error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: { b2b: 'true' },
        user_metadata: { nombre: nombre || null, telefono: telefono || null, invitacion_id: inv.id },
      });

      if (createErr) {
        const msg = String(createErr.message || '');
        // Es el caso normal del segundo comprador del mismo cliente: la
        // tienda lo detecta por este texto y le ofrece entrar con su clave.
        if (YA_EXISTE.test(msg)) return jsonRes({ error: 'Ese correo ya tiene una cuenta.' }, 409);
        return jsonRes({ error: msg || 'No se pudo crear la cuenta.' }, 400);
      }
      return jsonRes({ ok: true, email }, 200);
    }

    /* ══ CAMINO A — registro abierto ════════════════════════════════════ */
    const email = txt(body.email, 200).toLowerCase();
    const empresa = txt(body.empresa, 120);
    const localidad = txt(body.localidad, 80);
    const provincia = txt(body.provincia, 80);
    const canal = txt(body.canal, 40);
    const cuitDigitos = txt(body.cuit, 40).replace(/[^0-9]/g, '');

    // Validaciones de forma. Las de fondo (CUIT duplicado, canal habilitado)
    // las hace la RPC: son las que necesitan mirar la base y tienen que ser
    // las mismas se llame desde donde se llame.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return jsonRes({ error: 'Revisá el correo: no parece una dirección válida.' }, 400);
    }
    if (nombre.length < 2) return jsonRes({ error: 'Poné tu nombre y apellido.' }, 400);
    if (empresa.length < 2) return jsonRes({ error: 'Poné el nombre de tu empresa o comercio.' }, 400);
    if (cuitDigitos.length !== 11) {
      return jsonRes({ error: 'El CUIT tiene que tener 11 números.' }, 400);
    }

    // (2) La credencial.
    //     email_confirm: true — el dueño eligió que se entre y se compre
    //     directo, así que no hay paso de "confirmá tu mail". El correo
    //     igual queda registrado y sale en el aviso interno.
    const { data: creado, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { b2b: 'true' },
      user_metadata: { nombre, telefono: telefono || null },
    });

    if (createErr) {
      const msg = String(createErr.message || '');
      if (YA_EXISTE.test(msg)) return jsonRes({ error: 'Ese correo ya tiene una cuenta.' }, 409);
      return jsonRes({ error: msg || 'No se pudo crear la cuenta.' }, 400);
    }

    const uid = creado?.user?.id;
    if (!uid) return jsonRes({ error: 'No se pudo crear la cuenta.' }, 500);

    // (3) La empresa y el comprador, ya aprobados. Ver 0163.
    const { data: alta, error: altaErr } = await admin.rpc('b2b_rpc_alta_publica', {
      p_payload: {
        auth_uid: uid,
        email,
        nombre,
        telefono: telefono || null,
        empresa,
        cuit: cuitDigitos,
        localidad: localidad || null,
        provincia: provincia || null,
        canal: canal || null,
      },
    });

    if (altaErr) {
      // Se deshace la credencial: ver "Si el alta se corta por la mitad".
      // Si el borrado también falla no hay nada más que hacer desde acá —
      // se le dice al comprador que escriba, en vez de dejarlo tocando un
      // botón que nunca va a andar.
      const { error: delErr } = await admin.auth.admin.deleteUser(uid);
      if (delErr) {
        return jsonRes({
          error: 'Creamos tu usuario pero no pudimos terminar el alta. Escribinos y lo destrabamos en el momento.',
        }, 500);
      }
      return jsonRes({ error: altaErr.message || 'No se pudo completar el alta.' }, 400);
    }

    return jsonRes({
      ok: true,
      email,
      estado: alta?.estado || 'aprobado',
      cliente: alta?.cliente || empresa,
      empresa_nueva: alta?.empresa_nueva !== false,
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
