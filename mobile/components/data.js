/* ══ DATA.JS — Macario Lite real (Supabase backend) ══
   Reemplaza mock.js. Mantiene EXACTAMENTE la misma forma de
   window.MOCK / window.SKU_DB / window.CARRIERS / window.MOCK_ACTIONS / window.MOCK_BUS
   para que los .jsx originales funcionen sin tocarlos.
*/

const SUPABASE_URL      = 'https://ditmbqkvzreekqnkimqv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpdG1icWt2enJlZWtxbmtpbXF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0OTAyMDMsImV4cCI6MjA5MzA2NjIwM30.2hVZ3bJS_1vBe0rrR5BkYmg6-Fk5KHWwrLwG9gdaJE0';

/* ── Cliente Supabase (UMD lo provee como window.supabase) ── */
const supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'macario-auth' },
});
window.SUPA = supa;

/* ── Helpers expuestos ── */
window.usernameToEmail = (u) => {
  const v = (u || '').trim();
  return v.includes('@') ? v : `${v.toLowerCase()}@macario.local`;
};

/* SHA-256 hex (64 chars) — para file_hash de import_batches.
   Web Crypto solo está en HTTPS / localhost (secure context). Si no está
   disponible, fallback a un hash hex 64 chars derivado deterministicamente
   del input (no es SHA-256 real pero matchea el regex y mantiene
   idempotencia si el contenido no cambia). */
async function sha256Hex(input) {
  const text = typeof input === 'string' ? input : new TextDecoder().decode(input);

  // Camino feliz: Web Crypto disponible
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
    try {
      const buf = new TextEncoder().encode(text);
      const hash = await crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    } catch (e) {
      console.warn('[data.js] crypto.subtle.digest failed, using fallback:', e);
    }
  }

  // Fallback: hash determinístico (FNV-1a x4 → 64 hex chars). No es SHA-256
  // criptográfico pero pasa el regex ^[a-f0-9]{64}$ y es estable por contenido.
  return fnv64Quad(text);
}

function fnv64Quad(str) {
  // 4 hashes FNV-1a 32-bit con seeds distintos = 32 hex chars × ... + concat = 64 chars
  const seeds = [0x811c9dc5, 0x01000193, 0xdeadbeef, 0xcafebabe];
  let out = '';
  for (const seed of seeds) {
    let h = seed >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += h.toString(16).padStart(8, '0');
  }
  return out.padEnd(64, '0').slice(0, 64);
}

window.sha256Hex = sha256Hex;

window.skuName = (sku) => {
  const s = window.SKU_DB[sku];
  if (!s) return sku;
  return (!s.color || s.color === '—') ? s.modelo : `${s.modelo} ${s.color}`;
};
window.skuModel = (sku) => window.SKU_DB[sku]?.modelo || sku;

/* ── Override de nombres "cortos" de display (sin tocar la BD).
   La BD tiene nombres largos para uso oficial; en la UI mostramos
   estos cortos según pidió el cliente. Si un SKU no está acá, se
   usa el modelo/color de la BD tal cual.
   PARA AGREGAR/EDITAR: solo modificar este objeto y pushear. ── */
window.SKU_DISPLAY_NAMES = {
  MAD050: { modelo: 'Mesa Nórdica Petiribi',     color: 'Blanco' },
  MAD051: { modelo: 'Mesa Redonda',              color: 'Blanco' },
  MAD052: { modelo: 'Mesa Redonda',              color: 'Negro'  },
  MAD061: { modelo: 'Set Gota',                  color: 'Blanco' },
  MAD062: { modelo: 'Set Gota',                  color: 'Negro'  },
  MAD095: { modelo: 'Set Redonda',               color: 'Blanco' },
  MAD096: { modelo: 'Set Redonda',               color: 'Negro'  },
  MAD155: { modelo: 'Mesa Púas/Gota Madera',     color: 'Negro'  },
  MAD190: { modelo: 'Set Redonda Simil Marmol',  color: 'Blanco' },
  MAD191: { modelo: 'Set Redonda Simil Marmol',  color: 'Negro'  },
  MAD200: { modelo: 'Rectangular',               color: 'Negro'  },
  MAD201: { modelo: 'Rectangular',               color: 'Blanco' },
  MAD300: { modelo: 'Yori',                      color: '—'      },
  MAD301: { modelo: 'Bumerang',                  color: 'Blanco' },
  MAD302: { modelo: 'Boomerang',                 color: 'Negro'  },
  MAD303: { modelo: 'Set XL',                    color: 'Negro'  },
  MAD304: { modelo: 'Set XL',                    color: 'Blanco' },
  MAD401: { modelo: 'Hikari',                    color: '—'      },
};

/* ── State inicial vacío (para primer render antes del fetch) ── */
window.SKU_DB = {};

window.MOCK = {
  bootstrapped: false,
  user: { name:'', initials:'', role:'owner', roleLabel:'', email:'', username:'' },

  carriers: {
    colecta:          { lastClosure:null, allDone:true, kpis:{activos:0,unidades:0,pendiente:0}, table:[], orders:[], lotes:[], cierres:[] },
    flex:             { lastClosure:null, allDone:true, kpis:{activos:0,unidades:0,pendiente:0}, table:[], orders:[], lotes:[], cierres:[] },
    tiendanube:       { lastClosure:null, allDone:true, kpis:{activos:0,unidades:0,pendiente:0}, table:[], orders:[], lotes:[], cierres:[] },
    distribuidor:     { lastClosure:null, allDone:true, kpis:{activos:0,unidades:0,pendiente:0}, table:[], orders:[], lotes:[], cierres:[] },
    no_flex:          { lastClosure:null, allDone:true, kpis:{activos:0,unidades:0,pendiente:0}, table:[], orders:[], lotes:[], cierres:[] },
    correo_argentino: { lastClosure:null, allDone:true, kpis:{activos:0,unidades:0,pendiente:0}, table:[], orders:[], lotes:[], cierres:[] },
  },

  prod: { todos: { producidoHoy:0, kpis:{ faltante:0, totalPedido:0, producido:0 }, table:[] } },

  prodLogs: [],
  notifications: [],
  users: [],

  historico: {
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
    days: {},
    kpis: { total:0, diasActivos:0 },
  },

  RL: {
    owner:'Propietario', admin:'Administración', encargado:'Encargado General',
    ventas:'Ventas', cnc:'Sector CNC', melamina:'Sector Melamina',
    pino:'Sector Pino', embalaje:'Sector Embalaje',
    carpinteria:'Carpintería', logistica:'Logística', marketing:'Marketing',
  },

  ROLE_NAV: {
    owner:     { landing:'dashboard',  items:['dashboard','colecta','flex','tiendanube','distribuidor','no_flex','correo_argentino','produccion','registrar','historico','catalogo','equipo','notificaciones','perfil'] },
    admin:     { landing:'dashboard',  items:['dashboard','colecta','flex','tiendanube','distribuidor','no_flex','correo_argentino','produccion','registrar','historico','catalogo','equipo','notificaciones','perfil'] },
    encargado: { landing:'produccion', items:['produccion','registrar','notificaciones','perfil'] },
    cnc:       { landing:'produccion', items:['produccion','registrar','perfil'] },
    melamina:  { landing:'produccion', items:['produccion','registrar','perfil'] },
    pino:      { landing:'produccion', items:['produccion','registrar','perfil'] },
    embalaje:  { landing:'produccion', items:['produccion','registrar','perfil'] },
    logistica: { landing:'produccion', items:['produccion','registrar','perfil'] },
    ventas:    { landing:'dashboard',  items:['dashboard','colecta','flex','tiendanube','distribuidor','catalogo','notificaciones','perfil'] },
    carpinteria:{landing:'produccion', items:['produccion','registrar','perfil'] },
    marketing: { landing:'dashboard',  items:['dashboard','catalogo','notificaciones','perfil'] },
  },
};

/* ── Channel config (visual) — sub/cierreHora se enriquecen desde DB ── */
window.CARRIERS = {
  colecta:          { label:'Colecta',         sub:'ML · Retiro 12:00 hs',     color:'#6366f1', bg:'#f1f0ff', tipo_cierre:'horario',  cierreHora:'12:00' },
  flex:             { label:'Flex',            sub:'ML · Retiro 14:00 hs',     color:'#15803d', bg:'#effaf1', tipo_cierre:'horario',  cierreHora:'14:00' },
  tiendanube:       { label:'Tienda Nube',     sub:'Web propia',               color:'#2563eb', bg:'#eff6ff', tipo_cierre:'flexible', cierreHora:null },
  distribuidor:     { label:'Distribuidores',  sub:'Mayoristas / bulto',       color:'#d97706', bg:'#fffbeb', tipo_cierre:'flexible', cierreHora:null },
  no_flex:          { label:'No Flex',         sub:'Logística inversa',        color:'#db2777', bg:'#fdf2f8', tipo_cierre:'flexible', cierreHora:null },
  correo_argentino: { label:'Correo Argentino',sub:'Logística inversa',        color:'#0891b2', bg:'#ecfeff', tipo_cierre:'flexible', cierreHora:null },
};

/* ── Bus reactivo ── */
window.MOCK_BUS = {
  listeners: new Set(),
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit() { this.listeners.forEach(fn => fn()); },
};

/* ─────────────────────────────────────────────────────────────────
   LOADERS
   ───────────────────────────────────────────────────────────────── */

async function loadCatalog() {
  try {
    const { data, error } = await supa.from('sku_catalog').select('*').order('sku', { ascending: true });
    if (error) throw error;
    const map = {};
    for (const s of data || []) {
      // Override de nombres cortos para display. Si el SKU está en
      // SKU_DISPLAY_NAMES, usamos ese modelo/color; sino el de la BD.
      // El SKU mismo NUNCA cambia — toda la lógica del backend depende de él.
      const override = window.SKU_DISPLAY_NAMES?.[s.sku];
      map[s.sku] = {
        modelo: override?.modelo ?? s.modelo,
        color:  override?.color  ?? (s.color || '—'),
        colorHex: s.color_hex,
        categoria: s.categoria,
        es_fabricado: s.es_fabricado,
        activo: s.activo,
        modelo_oficial: s.modelo,
        color_oficial: s.color || '—',
      };
    }
    window.SKU_DB = map;
    // Cache offline: el operario en el depósito podría perder señal
    // momentáneamente — el catálogo cacheado permite que el scanner
    // siga reconociendo SKUs sin red.
    try { localStorage.setItem('makario_cache_skus', JSON.stringify(map)); } catch (e) {}
  } catch (e) {
    console.error('[data.js] catalog fail (intentando cache offline):', e?.message ?? e);
    // Fallback: hidratar SKU_DB desde localStorage si existe
    try {
      const cached = localStorage.getItem('makario_cache_skus');
      if (cached) {
        window.SKU_DB = JSON.parse(cached);
        console.warn('[data.js] catálogo cargado desde cache offline');
      }
    } catch (e2) {}
  }
}

async function loadChannels() {
  const { data, error } = await supa.from('channels').select('*');
  if (error) { console.error('channels', error); return; }
  for (const c of data || []) {
    const id = c.id;
    const cur = window.CARRIERS[id] || {};
    window.CARRIERS[id] = {
      label: c.label || cur.label || id,
      sub:   c.sub   || cur.sub   || '',
      color: cur.color || '#888',
      bg:    cur.bg    || '#f8f8f8',
      tipo_cierre: c.tipo_cierre || cur.tipo_cierre || 'flexible',
      cierreHora:  c.cierre_hora ? String(c.cierre_hora).slice(0,5) : (cur.cierreHora ?? null),
    };
  }
}

async function loadProfile() {
  const { data: { session } } = await supa.auth.getSession();
  if (!session) return false;
  const { data: profile, error } = await supa
    .from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  if (error || !profile) { console.error('profile', error); return false; }
  window.MOCK.user = {
    name:      profile.name,
    initials:  profile.name.split(' ').map(s => s[0]).join('').slice(0,2).toUpperCase(),
    role:      profile.role,
    roleLabel: window.MOCK.RL[profile.role] || profile.role,
    email:     session.user.email,
    username:  profile.username,
    id:        profile.id,
  };
  return true;
}

async function loadProfiles() {
  const { data, error } = await supa
    .from('profiles').select('*').order('role').order('name');
  if (error) { console.error('profiles', error); return; }
  window.MOCK.users = (data || []).map(p => ({
    id: p.id,
    name: p.name,
    username: p.username,
    role: p.role,
    area: p.area,
    active: p.active,
    avatar_color: p.avatar_color,
  }));
}

async function loadNotifications() {
  const { data: { session } } = await supa.auth.getSession();
  if (!session) return;
  const { data, error } = await supa
    .from('notifications').select('*')
    .order('created_at', { ascending: false }).limit(50);
  if (error) { console.error('notifications', error); return; }
  window.MOCK.notifications = (data || []).map(n => ({
    id: n.id,
    tipo: n.tipo,
    titulo: n.titulo,
    mensaje: n.mensaje,
    leida: n.leida,
    created_at: n.created_at,
  }));
}

async function loadCarriers() {
  const { data, error } = await supa.from('view_carrier_with_meta').select('*').order('sku', { ascending: true });
  if (error) { console.error('view_carrier_with_meta', error); return; }

  // reset
  for (const id of Object.keys(window.MOCK.carriers)) {
    window.MOCK.carriers[id].table = [];
    window.MOCK.carriers[id].kpis  = { activos:0, unidades:0, pendiente:0 };
    window.MOCK.carriers[id].allDone = true;
  }
  window.MOCK.prod.todos.table = [];

  for (const r of data || []) {
    const id = r.channel_id;
    if (!window.MOCK.carriers[id]) continue;

    const pedido    = r.pedido    || 0;
    const producido = r.producido || 0;
    const faltante  = r.faltante  || 0;
    const stock     = r.stock     || 0;

    // Filas "zombie": todo en 0 (típico tras eliminar un lote — el
    // carrier_state queda con la fila pero sin valores). No mostrarlas
    // en la UI para que la vista quede como si nunca se hubiera importado.
    if (pedido === 0 && producido === 0 && faltante === 0 && stock === 0) {
      continue;
    }

    const row = { sku: r.sku, pedido, producido, faltante, stock };
    window.MOCK.carriers[id].table.push(row);

    const C = window.CARRIERS[id] || { label: id };
    window.MOCK.prod.todos.table.push({
      sku: r.sku, canal: C.label, pedido, producido, faltante, stock,
    });
  }

  // KPIs por canal
  for (const id of Object.keys(window.MOCK.carriers)) {
    const c = window.MOCK.carriers[id];
    c.kpis.unidades  = c.table.reduce((s, r) => s + r.pedido,    0);
    c.kpis.pendiente = c.table.reduce((s, r) => s + r.faltante,  0);
    c.kpis.activos   = c.table.filter(r => r.faltante > 0).length;
    c.allDone        = c.kpis.pendiente === 0 && c.kpis.activos === 0;
  }

  // KPIs prod total
  const prod = window.MOCK.prod.todos;
  prod.kpis.totalPedido = prod.table.reduce((s, r) => s + r.pedido,    0);
  prod.kpis.producido   = prod.table.reduce((s, r) => s + r.producido, 0);
  prod.kpis.faltante    = prod.table.reduce((s, r) => s + r.faltante,  0);
}

async function loadOrders() {
  const { data, error } = await supa
    .from('orders').select('*')
    .in('status', ['pendiente','arrastrado'])
    .order('sku', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) { console.error('orders', error); return; }
  for (const id of Object.keys(window.MOCK.carriers)) window.MOCK.carriers[id].orders = [];
  for (const o of data || []) {
    const c = window.MOCK.carriers[o.channel_id];
    if (!c) continue;
    c.orders.push({
      numero:   o.order_number,
      cliente:  o.cliente || '—',
      sku:      o.sku,
      cantidad: o.cantidad,
      fecha:    (o.fecha_pedido || '').slice(0, 10),
    });
  }
}

async function loadBatches() {
  const { data, error } = await supa
    .from('import_batches').select('*')
    .order('imported_at', { ascending: false }).limit(50);
  if (error) { console.error('import_batches', error); return; }
  for (const id of Object.keys(window.MOCK.carriers)) window.MOCK.carriers[id].lotes = [];
  for (const b of data || []) {
    const c = window.MOCK.carriers[b.channel_id];
    if (!c) continue;
    c.lotes.push({
      id: b.id,
      fecha: b.imported_at,
      cantidad: b.unidades_count || 0,
      archivo: b.filename,
      detectado: '',
    });
  }
}

async function loadJornadas() {
  const { data, error } = await supa
    .from('jornadas').select('*')
    .order('closed_at', { ascending: false }).limit(50);
  if (error) { console.error('jornadas', error); return; }
  for (const id of Object.keys(window.MOCK.carriers)) {
    window.MOCK.carriers[id].cierres     = [];
    window.MOCK.carriers[id].lastClosure = null;
  }
  for (const j of data || []) {
    const c = window.MOCK.carriers[j.channel_id];
    if (!c) continue;
    if (!c.lastClosure) c.lastClosure = j.closed_at;
    c.cierres.push({
      fecha:    j.closed_at,
      pedidos:  j.pedidos_count,
      faltante: j.faltante_arrastrado,
      snapshot: 'Guardado',
    });
  }
}

async function loadProdLogs() {
  // JOIN con profiles para traer el nombre del operario (la tabla solo guarda operario_id)
  const { data, error } = await supa
    .from('production_logs')
    .select('*, operario:profiles!production_logs_operario_id_fkey(name,username)')
    .order('created_at', { ascending: false }).limit(200);
  if (error) { console.error('production_logs', error); return; }

  const today = new Date().toISOString().slice(0, 10);
  let producidoHoy = 0;

  window.MOCK.prodLogs = (data || []).map(l => {
    if (l.fecha === today) producidoHoy += l.cantidad;
    const C = window.CARRIERS[l.channel_id] || { label: l.channel_id };
    // Usar la columna `hora` canónica (time) — no `created_at`
    const horaStr = l.hora ? String(l.hora).slice(0, 5) : '';
    return {
      id: l.id,
      fecha: l.fecha,
      hora: horaStr,
      sku: l.sku,
      canal: C.label,
      subcanal: l.channel_id,
      sector: l.sector || '—',
      unidades: l.cantidad,
      operario: l.operario?.name || l.operario?.username || '—',
    };
  });

  window.MOCK.prod.todos.producidoHoy = producidoHoy;
}

async function loadHistorico(opts = {}) {
  const now = new Date();
  const year       = opts.year       ?? window.MOCK.historico.year       ?? now.getFullYear();
  const month      = opts.month      ?? window.MOCK.historico.month      ?? now.getMonth();
  const channelId  = opts.channelId  ?? window.MOCK.historico.filters?.channelId ?? 'todos';
  const skuF       = opts.sku        ?? window.MOCK.historico.filters?.sku       ?? 'todos';
  const desde      = opts.desde      ?? window.MOCK.historico.filters?.desde     ?? '';
  const hasta      = opts.hasta      ?? window.MOCK.historico.filters?.hasta     ?? '';

  const monthStart = `${year}-${String(month+1).padStart(2,'0')}-01`;
  const monthEnd   = new Date(year, month+1, 0).toISOString().slice(0, 10);
  const fromDate   = desde && desde >= monthStart ? desde : monthStart;
  const toDate     = hasta && hasta <= monthEnd   ? hasta : monthEnd;

  const days = {};
  let total = 0;

  if (skuF !== 'todos') {
    // Si hay filtro de SKU, queremos granularidad por sku — la view agrega
    // por (fecha, channel) sin sku, así que vamos directo a production_logs.
    let q = supa.from('production_logs').select('fecha, cantidad, channel_id, sku')
      .gte('fecha', fromDate).lte('fecha', toDate)
      .eq('sku', skuF);
    if (channelId !== 'todos') q = q.eq('channel_id', channelId);
    const { data, error } = await q;
    if (error) { console.error('historico (logs)', error); return; }
    for (const r of data || []) {
      const u = Number(r.cantidad) || 0;
      days[r.fecha] = (days[r.fecha] || 0) + u;
      total += u;
    }
  } else {
    let q = supa.from('view_historico_dia').select('*')
      .gte('fecha', fromDate).lte('fecha', toDate);
    if (channelId !== 'todos') q = q.eq('channel_id', channelId);
    const { data, error } = await q;
    if (error) { console.error('view_historico_dia', error); return; }
    for (const r of data || []) {
      const u = Number(r.unidades) || 0;  // bigint → number defensivo
      days[r.fecha] = (days[r.fecha] || 0) + u;
      total += u;
    }
  }

  const valores     = Object.values(days);
  const diasActivos = valores.filter(v => v > 0).length;
  const mejorDia    = valores.length ? Math.max(...valores) : 0;
  const promedio    = diasActivos > 0 ? Math.round(total / diasActivos) : 0;

  window.MOCK.historico = {
    year, month, days,
    kpis: { total, diasActivos, mejorDia, promedio },
    filters: { channelId, sku: skuF, desde, hasta },
  };
}

/* ─────────────────────────────────────────────────────────────────
   BOOTSTRAP
   ───────────────────────────────────────────────────────────────── */

async function bootstrap() {
  await Promise.all([loadCatalog(), loadChannels()]);
  const has = await loadProfile();
  if (!has) { window.MOCK_BUS.emit(); return; }
  await Promise.all([
    loadProfiles(),
    loadNotifications(),
    loadCarriers(),
    loadOrders(),
    loadBatches(),
    loadJornadas(),
    loadProdLogs(),
    loadHistorico(),
  ]);
  window.MOCK.bootstrapped = true;
  window.MOCK_BUS.emit();
}

window.bootstrap = bootstrap;

/* ─────────────────────────────────────────────────────────────────
   MUTATIONS
   ───────────────────────────────────────────────────────────────── */

window.MOCK_ACTIONS = {
  async registrarProduccion({ sku, subcanal, cantidad, nota }) {
    // El RPC NO acepta p_fecha — production_logs.fecha tiene default CURRENT_DATE.
    // Retorna el log creado completo (para soportar Undo en frontend).
    const params = { p_sku: sku, p_channel_id: subcanal, p_cantidad: cantidad };
    if (nota) params.p_notas = nota;
    const { data, error } = await supa.rpc('rpc_register_production', params);
    if (error) throw new Error(error.message);
    await Promise.all([loadCarriers(), loadProdLogs(), loadHistorico()]);
    window.MOCK_BUS.emit();
    return data; // production_logs row
  },

  async cerrarJornada({ channelId }) {
    const { error } = await supa.rpc('rpc_close_jornada', { p_channel_id: channelId });
    if (error) throw new Error(error.message);
    await Promise.all([loadCarriers(), loadOrders(), loadJornadas()]);
    window.MOCK_BUS.emit();
  },

  async importarLote({ channelId, filename, items, fileHash }) {
    // 1) Normalizar items antes del RPC: el campo `fecha_pedido` debe ser
    //    ISO date (YYYY-MM-DD) o null. El parser de Excel lo deja como
    //    string crudo (ej "20 de abril de 2026 21:24 hs.") que Postgres
    //    rechaza con "invalid input syntax for type date".
    const normalizedItems = (items || []).map(it => {
      const fecha = window.parseFechaAR ? window.parseFechaAR(it.fecha_pedido) : null;
      const cleaned = {
        sku: (it.sku || '').toString().trim().toUpperCase(),
        cantidad: parseInt(it.cantidad, 10) || 0,
      };
      if (it.order_number) cleaned.order_number = String(it.order_number).trim();
      if (it.cliente)      cleaned.cliente      = String(it.cliente).trim();
      if (fecha)           cleaned.fecha_pedido = fecha;  // omit si null → RPC usa current_date
      return cleaned;
    }).filter(it => it.sku && it.cantidad > 0);

    // 2) Hash idempotente — sobre los items YA normalizados.
    let p_file_hash = (fileHash || '').toString().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(p_file_hash)) {
      p_file_hash = await sha256Hex(filename + '|' + JSON.stringify(normalizedItems));
    }
    if (!/^[a-f0-9]{64}$/.test(p_file_hash)) {
      p_file_hash = fnv64Quad(filename + '|' + JSON.stringify(normalizedItems));
    }

    const { data, error } = await supa.rpc('rpc_import_batch', {
      p_channel_id: channelId,
      p_filename: filename,
      p_file_hash,
      p_items: normalizedItems,
    });
    if (error) throw new Error(error.message);
    await Promise.all([loadCarriers(), loadOrders(), loadBatches()]);
    window.MOCK_BUS.emit();
    return data;
  },

  /* Editar / Anular un log de producción.
       - Si p_anular=true → solo inserta entrada compensatoria (-cantidad).
       - Si p_anular=false y p_new_cantidad → compensatoria + nuevo log con
         la cantidad corregida (y opcionalmente nuevo channel_id).
     El RPC valida permisos: operario solo sus logs y dentro de 24h o antes
     del cierre de jornada. Encargado/admin/owner cualquiera, sin tope. */
  async corregirLog({ logId, nuevaCantidad, nuevoChannelId, motivo, anular }) {
    const { data, error } = await supa.rpc('rpc_correct_log', {
      p_log_id: logId,
      p_new_cantidad: anular ? null : (nuevaCantidad ?? null),
      p_new_channel_id: nuevoChannelId ?? null,
      p_motivo: motivo ?? null,
      p_anular: !!anular,
    });
    if (error) throw new Error(error.message);
    await Promise.all([loadCarriers(), loadProdLogs(), loadHistorico()]);
    window.MOCK_BUS.emit();
    return data;
  },

  /* "Mis cargas" del operario actual — últimas N de hoy + las
     compensaciones que afectan a esos logs (aunque haya hecho la
     compensación un admin distinto). El frontend usa esto para detectar
     qué logs originales están "ya anulados" sin tener que volver a
     consultar la BD por cada fila. */
  async getMisCargasHoy(limit = 20) {
    const { data: { session } } = await supa.auth.getSession();
    if (!session) return [];
    const today = new Date().toISOString().slice(0, 10);

    // 1) Mis cargas del día
    const { data: misLogs, error: e1 } = await supa
      .from('production_logs')
      .select('*')
      .eq('operario_id', session.user.id)
      .eq('fecha', today)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (e1) throw new Error(e1.message);

    // 2) Compensaciones de hoy que referencian alguno de mis logs.
    //    Aunque las haya hecho un admin distinto, las traemos para que
    //    el frontend pueda marcar el original como anulado.
    const misIds = (misLogs || []).map(l => l.id);
    let compensaciones = [];
    if (misIds.length) {
      const { data: comps, error: e2 } = await supa
        .from('production_logs')
        .select('*')
        .eq('fecha', today)
        .lt('cantidad', 0)
        .like('notas', '[ANULADO] log_id=%');
      if (!e2 && comps) {
        compensaciones = comps.filter(c => {
          const m = (c.notas || '').match(/^\[ANULADO\] log_id=([0-9a-f-]+)/);
          return m && misIds.includes(m[1]);
        });
      }
    }

    // Combinar y ordenar por created_at desc
    return [...(misLogs || []), ...compensaciones]
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  },

  async eliminarLote(batchId) {
    // RPC backend con SECURITY DEFINER: borra orders + production_logs
    // de los SKUs del lote (desde su fecha) + el batch + las filas
    // zombie del carrier_state. Resultado: estado vuelve a "como si
    // el lote nunca se hubiera subido" — sin requerir SQL manual.
    const { data, error } = await supa.rpc('rpc_delete_batch_full', { p_batch_id: batchId });
    if (error) throw new Error(error.message || 'No se pudo eliminar el lote');
    await Promise.all([loadCarriers(), loadOrders(), loadBatches(), loadProdLogs(), loadHistorico()]);
    window.MOCK_BUS.emit();
    return data;  // {batch_id, channel_id, orders_deleted, production_logs_deleted, skus_affected}
  },

  async recargarHistorico(opts) {
    await loadHistorico(opts || {});
    window.MOCK_BUS.emit();
  },

  async getDetalleDia(fecha, channelId) {
    // Query directa a production_logs (no usa el cache de MOCK.prodLogs
    // que tiene LIMIT 200) — útil para días viejos con muchos logs.
    let q = supa.from('production_logs')
      .select('*, operario:profiles!production_logs_operario_id_fkey(name,username)')
      .eq('fecha', fecha)
      .order('created_at', { ascending: true });
    if (channelId && channelId !== 'todos') q = q.eq('channel_id', channelId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data || []).map(l => {
      const C = window.CARRIERS[l.channel_id] || { label: l.channel_id };
      return {
        id: l.id,
        fecha: l.fecha,
        hora: l.hora ? String(l.hora).slice(0,5) : '',
        sku: l.sku,
        canal: C.label,
        subcanal: l.channel_id,
        sector: l.sector || '—',
        unidades: l.cantidad,
        operario: l.operario?.name || l.operario?.username || '—',
      };
    });
  },

  async marcarNotificacionLeida(id) {
    await supa.from('notifications').update({ leida: true }).eq('id', id);
    await loadNotifications();
    window.MOCK_BUS.emit();
  },

  async marcarTodasLeidas() {
    const ids = window.MOCK.notifications.filter(n => !n.leida).map(n => n.id);
    if (!ids.length) return;
    await supa.from('notifications').update({ leida: true }).in('id', ids);
    await loadNotifications();
    window.MOCK_BUS.emit();
  },

  async toggleProfileActive({ id, active }) {
    const { error } = await supa.from('profiles').update({ active }).eq('id', id);
    if (error) throw new Error(error.message);
    await loadProfiles();
    window.MOCK_BUS.emit();
  },

  async invitarUsuario({ username, name, role, area, password }) {
    const { data, error } = await supa.functions.invoke('invite_user', {
      body: { username, name, role, area: area || null, password },
    });
    if (error) {
      const ctx = error.context;
      if (ctx?.json) {
        const body = await ctx.json();
        throw new Error(body.error || error.message);
      }
      throw error;
    }
    await loadProfiles();
    window.MOCK_BUS.emit();
    return data;
  },

  async actualizarPerfil({ id, data }) {
    const { error } = await supa.from('profiles').update(data).eq('id', id);
    if (error) throw new Error(error.message);
    await loadProfiles();
    window.MOCK_BUS.emit();
  },

  async crearOActualizarSku(sku, payload, isNew) {
    if (isNew) {
      const { error } = await supa.from('sku_catalog').insert({ sku, ...payload });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supa.from('sku_catalog').update(payload).eq('sku', sku);
      if (error) throw new Error(error.message);
    }
    await loadCatalog();
    window.MOCK_BUS.emit();
  },

  async login({ username, password }) {
    const email = window.usernameToEmail(username);
    const { error } = await supa.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    await bootstrap();
  },

  async logout() {
    await supa.auth.signOut();
    // Vaciar state
    window.MOCK.user = { name:'', initials:'', role:'owner', roleLabel:'', email:'', username:'' };
    window.MOCK_BUS.emit();
  },

  /* ── Compat: lo dejamos para que el JSX original que llama aplicarPedido
        no rompa, pero el flujo real es importarLote ── */
  aplicarPedido() { /* no-op: usa importarLote */ },
};

/* ─────────────────────────────────────────────────────────────────
   REALTIME
   ───────────────────────────────────────────────────────────────── */

let _refreshTimer = null;
function scheduleRefresh() {
  if (_refreshTimer) return;
  _refreshTimer = setTimeout(async () => {
    _refreshTimer = null;
    try { await bootstrap(); } catch (e) { console.error('refresh', e); }
  }, 600);
}

function subscribeRealtime() {
  const tables = [
    'orders','carrier_state','production_logs','jornadas',
    'import_batches','sku_catalog','profiles','notifications',
  ];
  for (const t of tables) {
    supa.channel(`rt-${t}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: t }, scheduleRefresh)
      .subscribe();
  }
}

/* ─────────────────────────────────────────────────────────────────
   BOOT
   ───────────────────────────────────────────────────────────────── */

/* Boot defensivo: si una query rompe, las demás siguen y la app
   igual se renderiza. Nunca queda colgado el loader. */
const _safe = (p, label) => p.catch(e => {
  console.error(`[data.js] ${label} fail:`, e?.message ?? e);
});

(async function boot() {
  try {
    // Public: catálogo + canales (no requieren auth)
    await Promise.allSettled([_safe(loadCatalog(), 'catalog'), _safe(loadChannels(), 'channels')]);

    // Sesión / perfil
    let has = false;
    try { has = await loadProfile(); }
    catch (e) { console.error('[data.js] profile fail:', e?.message ?? e); }

    if (has) {
      await Promise.allSettled([
        _safe(loadProfiles(),      'profiles'),
        _safe(loadNotifications(), 'notifications'),
        _safe(loadCarriers(),      'carriers'),
        _safe(loadOrders(),        'orders'),
        _safe(loadBatches(),       'batches'),
        _safe(loadJornadas(),      'jornadas'),
        _safe(loadProdLogs(),      'prodLogs'),
        _safe(loadHistorico(),     'historico'),
      ]);
    }

    try { subscribeRealtime(); } catch (e) { console.error('[data.js] realtime fail:', e); }
  } catch (e) {
    console.error('[data.js] Bootstrap fatal:', e);
  } finally {
    // SIEMPRE marcar bootstrapped — si algo falló, igual mostramos Login.
    window.MOCK.bootstrapped = true;
    window.MOCK_BUS.emit();
    console.log('[data.js] Bootstrap done. user=', window.MOCK.user.name || '(no session)');
  }
})();

/* Failsafe: si el boot tarda más de 8s por algún motivo (red lenta),
   forzamos que la app se renderice igual. */
setTimeout(() => {
  if (!window.MOCK.bootstrapped) {
    console.warn('[data.js] Bootstrap timeout (8s) — forzando render');
    window.MOCK.bootstrapped = true;
    window.MOCK_BUS.emit();
  }
}, 8000);

/* ═══════════════════════════════════════════════════════════════════
   QR UTILITIES — generación de etiquetas para imprimir
   ───────────────────────────────────────────────────────────────────
   Cada QR codifica el SKU PLANO (ej: "MAD050"). Cuando lo escaneás
   con la app, el ScanPage parsea el texto, valida contra SKU_DB y
   abre el modal de Registrar Producción con el SKU prellenado.
   ═══════════════════════════════════════════════════════════════════ */

window.QR_UTILS = {
  /* Genera un dataURL PNG del QR puro (sin texto). Para usar en PDFs o
     componer canvases más grandes con texto. */
  async generarQRDataUrl(sku, opts = {}) {
    if (typeof window.QRCode === 'undefined') {
      throw new Error('Librería QRCode no cargada — refrescá la página.');
    }
    return await window.QRCode.toDataURL(sku, {
      errorCorrectionLevel: opts.errorCorrectionLevel || 'M', // 15% redundancia, soporta logo si querés
      margin: opts.margin ?? 1,
      width: opts.width || 512,
      color: { dark: '#000000', light: '#FFFFFF' },
    });
  },

  /* Descarga PNG individual con QR + SKU + modelo + color
     debajo, listo para imprimir como etiqueta única. */
  async descargarQRIndividual(sku) {
    const info = window.SKU_DB[sku] || {};
    const dataUrl = await this.generarQRDataUrl(sku, { width: 512 });

    // Componer canvas final (640×800: cuadrado QR + bloque de texto debajo)
    const final = document.createElement('canvas');
    final.width = 640;
    final.height = 800;
    const ctx = final.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, 640, 800);

    // QR centrado horizontalmente, margen 64px arriba
    const qrImg = new Image();
    await new Promise((res, rej) => { qrImg.onload = res; qrImg.onerror = rej; qrImg.src = dataUrl; });
    ctx.drawImage(qrImg, 64, 64, 512, 512);

    // SKU grande mono
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 56px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(sku, 320, 660);

    // Modelo (truncado si excede ancho)
    ctx.font = '32px Plus Jakarta Sans, sans-serif';
    ctx.fillStyle = '#3A3A3A';
    let modelo = info.modelo || '';
    const maxW = 600;
    while (modelo.length > 0 && ctx.measureText(modelo).width > maxW) {
      modelo = modelo.slice(0, -1);
    }
    if ((info.modelo || '').length > modelo.length) modelo += '…';
    ctx.fillText(modelo, 320, 715);

    // Color (si aplica, gris claro)
    if (info.color && info.color !== '—') {
      ctx.font = '26px Plus Jakarta Sans, sans-serif';
      ctx.fillStyle = '#888888';
      ctx.fillText(info.color, 320, 760);
    }

    // Disparar descarga
    return new Promise(resolve => {
      final.toBlob(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `qr-${sku}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        resolve();
      }, 'image/png');
    });
  },

  /* Genera un PDF A4 con grilla 4×5 (20 etiquetas/hoja) de los SKUs
     pasados. Cada celda lleva: QR + SKU + modelo + color. Se descarga
     como `makario-qrs-{fecha}.pdf`. */
  async descargarPDFCatalogo(skus) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      throw new Error('Librería jsPDF no cargada — refrescá la página.');
    }
    if (typeof window.QRCode === 'undefined') {
      throw new Error('Librería QRCode no cargada — refrescá la página.');
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });

    const PAGE_W = 210, PAGE_H = 297;
    const MARGIN = 8;
    const COLS = 4, ROWS = 5;
    const PER_PAGE = COLS * ROWS;
    const cellW = (PAGE_W - 2 * MARGIN) / COLS;   // 48.5 mm
    const cellH = (PAGE_H - 2 * MARGIN) / ROWS;   // 56.2 mm
    const QR_SIZE = 35;                            // mm — escaneable desde 30-50cm

    let i = 0;
    for (const sku of skus) {
      const info = window.SKU_DB[sku] || {};
      if (i > 0 && i % PER_PAGE === 0) doc.addPage();
      const idx = i % PER_PAGE;
      const col = idx % COLS;
      const row = Math.floor(idx / COLS);
      const x = MARGIN + col * cellW;
      const y = MARGIN + row * cellH;

      // QR
      const dataUrl = await this.generarQRDataUrl(sku, { width: 256 });
      const qrX = x + (cellW - QR_SIZE) / 2;
      const qrY = y + 4;
      doc.addImage(dataUrl, 'PNG', qrX, qrY, QR_SIZE, QR_SIZE);

      // SKU bold
      doc.setFont('courier', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(0, 0, 0);
      doc.text(sku, x + cellW / 2, qrY + QR_SIZE + 5, { align: 'center' });

      // Modelo (puede ser 2 líneas si es largo)
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(58, 58, 58);
      const modelo = info.modelo || '';
      const lines = doc.splitTextToSize(modelo, cellW - 4);
      const linesToShow = lines.slice(0, 2);
      let textY = qrY + QR_SIZE + 9;
      linesToShow.forEach((line, idx2) => {
        doc.text(line, x + cellW / 2, textY + idx2 * 3.5, { align: 'center' });
      });

      // Color (si aplica)
      if (info.color && info.color !== '—') {
        doc.setFontSize(7);
        doc.setTextColor(140, 140, 140);
        const colorY = textY + linesToShow.length * 3.5 + 1;
        doc.text(info.color, x + cellW / 2, colorY, { align: 'center' });
      }

      // Borde de corte (línea fina gris)
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.1);
      doc.rect(x, y, cellW, cellH);

      i++;
    }

    doc.save(`makario-qrs-${new Date().toISOString().slice(0, 10)}.pdf`);
  },
};
