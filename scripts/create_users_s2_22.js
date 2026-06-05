/* ════════════════════════════════════════════════════════════════════
   S2.22 — Creación de las 5 cuentas + seed de permisos por módulo
   ════════════════════════════════════════════════════════════════════
   Crea (o reutiliza si ya existen) las 5 cuentas de auth.users vía la
   Admin API, y siembra sus permisos en user_module_permissions.

   IMPORTANTE:
   - El profile se AUTO-CREA por el trigger handle_new_user() (migration
     0002) leyendo user_metadata {username, name, role}. Por eso este
     script NO inserta en public.profiles manualmente.
   - username debe matchear el CHECK ^[a-z0-9_]{3,32}$ → sin puntos
     (usamos guión bajo). El login real es por EMAIL completo.
   - El seed de permisos se hace por INSERT directo con la service role
     key (bypassa RLS). NO se usa rpc_admin_upsert_user_permissions porque
     bajo service_role auth.uid() es NULL y el RPC (owner-only) lo rechaza.
   - Idempotente: si una cuenta ya existe, la reutiliza; si ya tiene
     permisos, los reemplaza por el set de este script.

   USO:
     cd scripts
     npm install            # instala @supabase/supabase-js (ver package.json)
     # PowerShell:
     $env:SUPABASE_URL="https://ditmbqkvzreekqnkimqv.supabase.co"
     $env:SUPABASE_SERVICE_ROLE_KEY="<service_role_key>"
     node create_users_s2_22.js
   ════════════════════════════════════════════════════════════════════ */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('✗ Faltan env vars SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PASSWORD = 'Makario2026';

/* Las 5 cuentas. `modules` = permisos por módulo (vacío para owner).
   username sin puntos (CHECK de profiles). Login = email completo. */
const USERS = [
  {
    email: 'noelia.castillo@justomakario.app',
    username: 'noelia_castillo',
    name: 'Noelia Castillo',
    role: 'owner',
    modules: [], // owner ve todo por rol — sin filas de permisos
  },
  {
    email: 'esteban.fernandez@justomakario.app',
    username: 'esteban_fernandez',
    name: 'Esteban Fernandez',
    role: 'admin',
    modules: ['administracion', 'ventas', 'produccion'],
  },
  {
    email: 'romina.puscama@justomakario.app',
    username: 'romina_puscama',
    name: 'Romina Puscama',
    role: 'admin',
    // finanzas_egresos => ve Finanzas pero SOLO la tab Egresos/Compras
    modules: ['administracion', 'ventas', 'produccion', 'finanzas_egresos'],
  },
  {
    email: 'mikeas.romero@justomakario.app',
    username: 'mikeas_romero',
    name: 'Mikeas Romero',
    role: 'admin',
    modules: ['produccion'],
  },
  {
    email: 'dobleclick@justomakario.app',
    username: 'dobleclick',
    name: 'Doble Click',
    role: 'admin',
    modules: ['marketing'],
  },
];

/* Busca un usuario por email paginando admin.listUsers (no hay getByEmail). */
async function findUserByEmail(email) {
  let page = 1;
  const perPage = 200;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const found = (data?.users || []).find(
      (u) => (u.email || '').toLowerCase() === email.toLowerCase()
    );
    if (found) return found;
    if (!data || !data.users || data.users.length < perPage) return null;
    page += 1;
  }
}

async function ensureUser(u) {
  // 1) ¿Ya existe?
  const existing = await findUserByEmail(u.email);
  let userId;

  if (existing) {
    userId = existing.id;
    console.log(`  • ${u.email} ya existe (${userId}) — reutilizo.`);
    // Refrescar metadata por si cambió name/role/username (no toca password).
    await supabase.auth.admin.updateUserById(userId, {
      user_metadata: { username: u.username, name: u.name, role: u.role },
    });
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: u.email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { username: u.username, name: u.name, role: u.role },
    });
    if (error) throw new Error(`createUser ${u.email}: ${error.message}`);
    userId = data.user.id;
    console.log(`  ✓ ${u.email} creado (${userId}) role=${u.role}`);
  }

  return userId;
}

async function seedPermissions(userId, modules) {
  // Reemplazo total: borrar y reinsertar.
  const { error: delErr } = await supabase
    .from('user_module_permissions')
    .delete()
    .eq('user_id', userId);
  if (delErr) throw new Error(`delete perms ${userId}: ${delErr.message}`);

  if (!modules || modules.length === 0) return;

  const rows = modules.map((m) => ({ user_id: userId, module: m, can_access: true }));
  const { error: insErr } = await supabase
    .from('user_module_permissions')
    .insert(rows);
  if (insErr) throw new Error(`insert perms ${userId}: ${insErr.message}`);
  console.log(`    ↳ permisos: [${modules.join(', ')}]`);
}

(async function main() {
  console.log('S2.22 — creando/actualizando 5 cuentas + permisos…\n');
  for (const u of USERS) {
    try {
      const userId = await ensureUser(u);
      await seedPermissions(userId, u.modules);
    } catch (e) {
      console.error(`  ✗ ${u.email}: ${e.message}`);
      process.exitCode = 1;
    }
  }
  console.log('\nListo. Login: con el EMAIL completo (ej: esteban.fernandez@justomakario.app) + Makario2026');
})();
