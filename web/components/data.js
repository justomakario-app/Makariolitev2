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

  /* Cambio 2A/2B: jornadas son globales (día completo, no por canal).
     - abiertas:       todas las jornadas con status='abierta'.
     - activaId:       la marcada is_active=true (singleton global enforced en BD).
     - seleccionadaId: la que el usuario está VIENDO en el dashboard (local, no BD).
                       Por defecto = activaId. Cambia con seleccionarJornada(id). */
  jornadas: { abiertas:[], activaId:null, seleccionadaId:null, historial:[] },

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
  freeStock: {}, // {sku: cantidad_total}
  categories: [], // listado completo desde sku_categories (incluye categorías sin SKUs)

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
    owner:     { landing:'dashboard',  items:['dashboard','colecta','flex','tiendanube','distribuidor','no_flex','correo_argentino','stock','produccion','registrar','historico','catalogo','equipo','notificaciones','perfil','admin','cash-flow'] },
    admin:     { landing:'dashboard',  items:['dashboard','colecta','flex','tiendanube','distribuidor','no_flex','correo_argentino','stock','produccion','registrar','historico','catalogo','equipo','notificaciones','perfil','admin','cash-flow'] },
    encargado: { landing:'produccion', items:['produccion','registrar','stock','notificaciones','perfil'] },
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

/* Carga el listado completo de categorías de la maestra sku_categories,
   incluyendo las que aún no tienen SKUs asociados. Se usa para
   alimentar el dropdown del modal de SKU (paridad web/mobile). */
async function loadCategories() {
  const { data, error } = await supa
    .from('sku_categories')
    .select('name, sort_order')
    .order('sort_order', { ascending: true });
  if (error) { console.error('sku_categories', error); return; }
  window.MOCK.categories = (data || []).map(c => c.name);
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
  // Housekeeping post-Cambio 2: loadCarriers YA NO consulta
  // view_carrier_with_meta. Esa view es transversal por canal (no
  // segmenta por jornada); desde el fix "aislar pedidos por jornada"
  // el dashboard se alimenta EXCLUSIVAMENTE de
  // applySelectedJornadaToCarriers (compute local sobre orders +
  // prodLogs filtrados por jornada_id). La query a la view era un
  // "dead read" — su resultado se sobrescribía de inmediato.
  // Se conserva la función como punto de entrada para los callers
  // de MOCK_ACTIONS (Promise.all([loadCarriers(), loadOrders(), ...])).
  applySelectedJornadaToCarriers();
}

async function loadOrders() {
  // Incluye 'cancelado' para que getCancellationsForJornada las pueda
  // mostrar en la seccion "Cancelaciones del dia" del dashboard.
  // computeCarriersForJornada filtra las canceladas en su loop, asi que
  // no afectan los cuadritos.
  const { data, error } = await supa
    .from('orders').select('*')
    .in('status', ['pendiente','arrastrado','cancelado'])
    .order('sku', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) { console.error('orders', error); return; }

  // Lookup de edits_count por (channel_id, order_number) en una sola query.
  // Si la tabla todavia no existe (pre-migration), el catch deja el map vacio.
  const editsMap = {};
  try {
    const { data: logRows } = await supa
      .from('order_edit_log')
      .select('channel_id, order_number');
    for (const r of logRows || []) {
      const k = r.channel_id + '|' + r.order_number;
      editsMap[k] = (editsMap[k] || 0) + 1;
    }
  } catch (_) { /* tabla no existe → no badges, comportamiento idéntico al pre-feature */ }

  for (const id of Object.keys(window.MOCK.carriers)) window.MOCK.carriers[id].orders = [];
  for (const o of data || []) {
    const c = window.MOCK.carriers[o.channel_id];
    if (!c) continue;
    const editsKey = o.channel_id + '|' + o.order_number;
    c.orders.push({
      numero:    o.order_number,
      cliente:   o.cliente || '—',
      sku:       o.sku,
      cantidad:  o.cantidad,
      fecha:     (o.fecha_pedido || '').slice(0, 10),
      origen:    o.origen || 'excel',
      version:   o.version || 1,
      jornadaId: o.jornada_id || null,
      editsCount: editsMap[editsKey] || 0,
      status:                o.status,
      cancelledAt:           o.cancelled_at || null,
      cancelledInJornadaId:  o.cancelled_in_jornada_id || null,
    });
  }

  // computeCarriersForJornada lee de carriers[c].orders, así que recomputar acá.
  applySelectedJornadaToCarriers();
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

/* Carga el stock libre por SKU. Se acumula desde free_stock (PK por
   (sku, source_jornada_id)) — agregamos la suma para el display. */
async function loadFreeStock() {
  const { data, error } = await supa.from('free_stock').select('sku, cantidad');
  if (error) { console.error('free_stock', error); return; }
  const map = {};
  for (const r of data || []) {
    map[r.sku] = (map[r.sku] || 0) + (r.cantidad || 0);
  }
  window.MOCK.freeStock = map;
}

/* ─────────────────────────────────────────────────────────────────
   loadJornadas (Cambio 2B) — modelo global "una jornada por día".
   Tras migration 0028 la tabla jornadas YA NO tiene columna channel_id;
   el snapshot inmutable se agrupa por (channel_id, sku) DENTRO del jsonb.
   ─────────────────────────────────────────────────────────────────── */
async function loadJornadas() {
  const { data, error } = await supa
    .from('jornadas').select('*')
    .order('fecha', { ascending: false }).limit(50);
  if (error) { console.error('jornadas', error); return; }

  window.MOCK.jornadas.abiertas  = [];
  window.MOCK.jornadas.activaId  = null;
  window.MOCK.jornadas.historial = [];

  for (const j of data || []) {
    if (j.status === 'cerrada') {
      window.MOCK.jornadas.historial.push({
        id: j.id,
        fecha:    j.closed_at,       // momento del cierre
        fechaJornada: j.fecha,       // día que cubre
        pedidos:  j.pedidos_count,
        unidadesProducidas: j.unidades_producidas,
        unidadesPedidas:    j.unidades_pedidas,
        faltante: j.faltante_arrastrado,
        snapshot: j.snapshot || [],  // [{channel_id, sku, modelo, color, pedido, producido, faltante, stock}]
        closedBy: j.closed_by,
      });
    } else {
      window.MOCK.jornadas.abiertas.push({
        id: j.id, fecha: j.fecha, isActive: j.is_active, abiertaAt: j.abierta_at,
      });
      if (j.is_active) window.MOCK.jornadas.activaId = j.id;
    }
  }

  // Ordenar abiertas por fecha asc (la más vieja primero) para tabs consistentes
  window.MOCK.jornadas.abiertas.sort(
    (a, b) => (a.fecha || '').localeCompare(b.fecha || '')
  );

  // Reconciliar seleccionadaId: si quedó huérfana (jornada cerrada o eliminada),
  // volver a la activa. Default inicial también cae acá.
  const validIds = window.MOCK.jornadas.abiertas.map(j => j.id);
  if (!window.MOCK.jornadas.seleccionadaId || !validIds.includes(window.MOCK.jornadas.seleccionadaId)) {
    window.MOCK.jornadas.seleccionadaId = window.MOCK.jornadas.activaId;
  }

  // Derivar cierres + lastClosure POR CANAL (compat con header de CarrierPage y
  // tab "Historial de cierres"). Filtra snapshot por channel_id del item.
  for (const id of Object.keys(window.MOCK.carriers)) {
    const cierresCanal = [];
    for (const c of window.MOCK.jornadas.historial) {
      const itemsCanal = (c.snapshot || []).filter(r => r.channel_id === id);
      if (itemsCanal.length === 0) continue;
      cierresCanal.push({
        id: c.id,
        fecha: c.fecha,
        fechaJornada: c.fechaJornada,
        // pedidos count no se puede derivar del snapshot agrupado por sku.
        // El modal "Historial de cierres" en CarrierPage mostrará 0; las
        // métricas reales viven en unidadesPedidas/Producidas/faltante.
        pedidos: 0,
        unidadesProducidas: itemsCanal.reduce((s,r) => s + (r.producido||0), 0),
        unidadesPedidas:    itemsCanal.reduce((s,r) => s + (r.pedido||0), 0),
        faltante:           itemsCanal.reduce((s,r) => s + (r.faltante||0), 0),
        snapshot: itemsCanal,
        closedBy: c.closedBy,
      });
    }
    window.MOCK.carriers[id].cierres = cierresCanal;
    window.MOCK.carriers[id].lastClosure = cierresCanal[0]?.fecha || null;
  }

  // Si la jornada seleccionada cambió respecto a la activa, recomputar carriers.
  applySelectedJornadaToCarriers();
}

/* ─────────────────────────────────────────────────────────────────
   computeCarriersForJornada (Cambio 2B) — replica la fórmula del
   snapshot del RPC rpc_close_jornada v6 para mostrar en vivo el
   estado de una jornada NO activa. Lee de:
     - MOCK.carriers[c].orders (pedidos pendientes/arrastrados — transversales)
     - MOCK.prodLogs filtrados por jornada_id
   y devuelve un mapa { channel_id → { table, kpis, allDone } } compatible
   con el shape que ya consumen los .jsx.
   ─────────────────────────────────────────────────────────────────── */
function computeCarriersForJornada(jornadaId) {
  const out = {};
  for (const id of Object.keys(window.MOCK.carriers)) {
    out[id] = { table: [], kpis: { activos:0, unidades:0, pendiente:0 }, allDone:true };
  }

  // Sin jornada seleccionada → todo vacío (no hay segmentación posible).
  if (!jornadaId) return out;

  // pedido[channel|sku] = SUM orders.cantidad WHERE jornada_id = jornadaId.
  // Aislado por jornada (Cambio 2B hot-fix final): un pedido cargado en la
  // jornada 15-may solo aparece en la pestaña 15-may. Defensivo: orders
  // con jornadaId=null (estado legacy/inesperado) NO se incluyen.
  const pedidoMap = {};
  for (const cid of Object.keys(window.MOCK.carriers)) {
    for (const o of window.MOCK.carriers[cid].orders || []) {
      if (o.jornadaId !== jornadaId) continue;
      if (o.status === 'cancelado') continue;   // canceladas no cuentan como pedido
      const k = cid + '|' + o.sku;
      pedidoMap[k] = (pedidoMap[k] || 0) + (o.cantidad || 0);
    }
  }
  // producido[channel|sku] = SUM production_logs.cantidad WHERE jornada_id = jornadaId
  const prodMap = {};
  for (const l of window.MOCK.prodLogs || []) {
    if (l.jornadaId !== jornadaId) continue;
    const k = l.subcanal + '|' + l.sku;
    prodMap[k] = (prodMap[k] || 0) + (l.unidades || 0);
  }

  const allKeys = new Set([...Object.keys(pedidoMap), ...Object.keys(prodMap)]);
  for (const k of allKeys) {
    const [cid, sku] = k.split('|');
    if (!out[cid]) continue;
    const pedido    = pedidoMap[k] || 0;
    const producido = prodMap[k]   || 0;
    const faltante  = Math.max(0, pedido - producido);
    const stock     = Math.max(0, producido - pedido);
    if (pedido === 0 && faltante === 0 && stock === 0) continue;
    out[cid].table.push({ sku, pedido, producido, faltante, stock });
  }

  for (const id of Object.keys(out)) {
    const c = out[id];
    c.table.sort((a,b) => a.sku.localeCompare(b.sku));
    c.kpis.unidades  = c.table.reduce((s,r) => s + r.pedido,    0);
    c.kpis.pendiente = c.table.reduce((s,r) => s + r.faltante,  0);
    c.kpis.activos   = c.table.filter(r => r.faltante > 0).length;
    c.allDone        = c.kpis.pendiente === 0 && c.kpis.activos === 0;
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────────
   getCancellationsForJornada(jornadaId) — devuelve las cancelaciones
   REGISTRADAS en la jornada indicada (cancelled_in_jornada_id ===
   jornadaId), agrupadas para la seccion "Cancelaciones del dia" del
   dashboard y el listado en el modal de cierre.
   Una cancelacion puede haberse REGISTRADO en una jornada distinta a
   la jornada ORIGINAL del pedido (caso: pedido del 14-may que se
   cancela en el Excel del 15-may → cancelled_in_jornada_id=15-may).
   ─────────────────────────────────────────────────────────────────── */
function getCancellationsForJornada(jornadaId) {
  if (!jornadaId) return [];
  const out = [];
  for (const cid of Object.keys(window.MOCK.carriers)) {
    for (const o of window.MOCK.carriers[cid].orders || []) {
      if (o.status !== 'cancelado') continue;
      if (o.cancelledInJornadaId !== jornadaId) continue;
      out.push({
        canal:       cid,
        numero:      o.numero,
        sku:         o.sku,
        modelo:      window.skuName(o.sku),
        cantidad:    o.cantidad,
        fecha:       o.fecha,
        cliente:     o.cliente,
        cancelledAt: o.cancelledAt,
      });
    }
  }
  out.sort((a,b) => {
    if (a.canal !== b.canal) return a.canal.localeCompare(b.canal);
    return a.sku.localeCompare(b.sku);
  });
  return out;
}
window.getCancellationsForJornada = getCancellationsForJornada;

/* ─────────────────────────────────────────────────────────────────
   applySelectedJornadaToCarriers — SIEMPRE recomputa table/kpis/allDone
   de MOCK.carriers + MOCK.prod.todos desde orders+prodLogs filtrados por
   la jornada SELECCIONADA. Activa y no-activa siguen el mismo camino:
   los cuadritos del dashboard reflejan EXACTAMENTE los pedidos y la
   producción ATADOS a esa jornada. carrier_state (backend) queda como
   tabla interna para cierres y RPCs — el frontend ya no la consume
   para alimentar el dashboard.
   Preserva orders, lotes, cierres, lastClosure (datos no agregados).
   ─────────────────────────────────────────────────────────────────── */
function applySelectedJornadaToCarriers() {
  const selId = window.MOCK.jornadas.seleccionadaId;

  const computed = computeCarriersForJornada(selId);
  for (const id of Object.keys(window.MOCK.carriers)) {
    window.MOCK.carriers[id].table   = computed[id].table;
    window.MOCK.carriers[id].kpis    = computed[id].kpis;
    window.MOCK.carriers[id].allDone = computed[id].allDone;
  }

  // Recompute MOCK.prod.todos (hero del dashboard)
  const todos = window.MOCK.prod.todos;
  todos.table = [];
  todos.kpis = { totalPedido:0, producido:0, faltante:0 };
  for (const id of Object.keys(window.MOCK.carriers)) {
    const cInfo = window.CARRIERS[id] || { label: id };
    for (const r of window.MOCK.carriers[id].table) {
      todos.table.push({ sku: r.sku, canal: cInfo.label, pedido: r.pedido, producido: r.producido, faltante: r.faltante, stock: r.stock });
      todos.kpis.totalPedido += r.pedido;
      todos.kpis.producido   += r.producido;
      todos.kpis.faltante    += r.faltante;
    }
  }
  // "Producidos hoy" → producido de la jornada seleccionada (0 si no hay).
  todos.producidoHoy = selId
    ? (window.MOCK.prodLogs || [])
        .filter(l => l.jornadaId === selId)
        .reduce((s,l) => s + (l.unidades || 0), 0)
    : 0;
}

async function loadProdLogs() {
  // JOIN con profiles para traer el nombre del operario.
  // Limit 1000 (antes 500, Cambio 2B) — computeCarriersForJornada filtra
  // estos logs por jornada_id para construir tablas en vivo. Con 3 jornadas
  // abiertas máx, sobra hasta ~300 logs/jornada.
  const { data, error } = await supa
    .from('production_logs')
    .select('*, operario:profiles!production_logs_operario_id_fkey(name,username)')
    .order('created_at', { ascending: false }).limit(1000);
  if (error) { console.error('production_logs', error); return; }

  const today = new Date().toISOString().slice(0, 10);
  let producidoHoy = 0;

  window.MOCK.prodLogs = (data || []).map(l => {
    if (l.fecha === today) producidoHoy += l.cantidad;
    const C = window.CARRIERS[l.channel_id] || { label: l.channel_id };
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
      jornadaId: l.jornada_id || null,
      notas: l.notas || null,
    };
  });

  window.MOCK.prod.todos.producidoHoy = producidoHoy;

  // Si la jornada seleccionada ≠ activa, recomputar tablas/KPIs con esta data fresca.
  applySelectedJornadaToCarriers();
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
  await Promise.all([loadCatalog(), loadCategories(), loadChannels()]);
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

/* Mapea errores de rpc_correct_log a mensajes mostrables al operario.
   El RPC v3 ya devuelve mensajes humanos para todos los casos de
   negocio (jornada cerrada, ventana 24h, ya anulado, etc.); acá solo
   capturamos errores de transporte (auth expirada, red) que vienen
   crudos de PostgREST y no son legibles. */
function humanizeCorrectError(err) {
  const raw = (err && err.message) || '';
  const low = raw.toLowerCase();
  if (low.includes('jwt') || low.includes('not authenticated') || low.includes('invalid token')) {
    return 'Tu sesion expiro. Volve a iniciar sesion.';
  }
  if (low.includes('failed to fetch') || low.includes('network') || low.includes('typeerror')) {
    return 'Sin conexion. Reintenta en unos segundos.';
  }
  return raw || 'No se pudo aplicar la correccion.';
}

window.MOCK_ACTIONS = {
  async registrarProduccion({ sku, subcanal, cantidad, nota, jornadaId }) {
    // p_jornada_id es opcional — si no se pasa, el RPC busca la jornada
    // activa del canal y la usa (o crea/marca según el caso).
    const params = { p_sku: sku, p_channel_id: subcanal, p_cantidad: cantidad };
    if (nota) params.p_notas = nota;
    if (jornadaId) params.p_jornada_id = jornadaId;
    const { data, error } = await supa.rpc('rpc_register_production', params);
    if (error) throw new Error(error.message);
    await Promise.all([loadCarriers(), loadProdLogs(), loadJornadas(), loadHistorico()]);
    window.MOCK_BUS.emit();
    return data; // production_logs row
  },

  /* Abre una jornada nueva del día indicado (o de hoy si no se pasa fecha).
     Cambio 2A/2B: las jornadas son GLOBALES — no se pasa channelId.
     Validaciones de cliente (max 3 abiertas, fecha ≤ today+3) se hacen
     en el modal antes de invocar este action. Solo owner/admin/encargado. */
  async abrirJornada({ fecha } = {}) {
    const params = {};
    if (fecha) params.p_fecha = fecha;
    const { data, error } = await supa.rpc('rpc_open_jornada', params);
    if (error) throw new Error(error.message);
    await Promise.all([loadCarriers(), loadJornadas()]);
    // Autoseleccionar la jornada recién creada (UX: aparece en la tab que
    // el usuario acaba de abrir, no en otra).
    if (data?.id) window.MOCK.jornadas.seleccionadaId = data.id;
    window.MOCK_BUS.emit();
    return data;
  },

  /* Cambia LOCALMENTE la jornada que el usuario está mirando (la "pestaña
     seleccionada"). No toca BD. Recomputa tablas/KPIs en el acto y emite. */
  seleccionarJornada(jornadaId) {
    if (!jornadaId) return;
    if (!window.MOCK.jornadas.abiertas.some(j => j.id === jornadaId)) return;
    if (window.MOCK.jornadas.seleccionadaId === jornadaId) return;
    window.MOCK.jornadas.seleccionadaId = jornadaId;
    // Recomputar tablas/KPIs de la jornada seleccionada. loadCarriers()
    // es el wrapper async de applySelectedJornadaToCarriers() — ambas
    // ramas recomputan lo mismo; la async preserva el await del refresh.
    if (jornadaId === window.MOCK.jornadas.activaId) {
      loadCarriers().finally(() => window.MOCK_BUS.emit());
    } else {
      applySelectedJornadaToCarriers();
      window.MOCK_BUS.emit();
    }
  },

  /* Cambia la jornada ACTIVA en BD (el "punto verde", la que recibe las
     nuevas cargas). Singleton global. Solo owner/admin/encargado. */
  async setActiveJornada({ jornadaId }) {
    const { data, error } = await supa.rpc('rpc_set_active_jornada', { p_jornada_id: jornadaId });
    if (error) throw new Error(error.message);
    await Promise.all([loadCarriers(), loadJornadas()]);
    window.MOCK_BUS.emit();
    return data;
  },

  /* Cerrar jornada con disposiciones opcionales para los sobrantes.
     Cambio 2A/2B: cierra TODOS los canales del día — sin channelId.
     disposiciones: [{sku, accion: 'free_stock', cantidad?}] — opcional.
     Si se omite, todos los sobrantes se auto-disponen a Stock central (RPC v6). */
  async cerrarJornada({ fecha, disposiciones } = {}) {
    const params = {};
    if (fecha) params.p_fecha = fecha;
    if (disposiciones && disposiciones.length) params.p_disposiciones = disposiciones;
    const { error } = await supa.rpc('rpc_close_jornada', params);
    if (error) throw new Error(error.message);
    await Promise.all([loadCarriers(), loadOrders(), loadJornadas(), loadFreeStock()]);
    window.MOCK_BUS.emit();
  },

  /* Mueve cantidad del stock libre del SKU al canal target (genera
     production_log positivo en la jornada destino). Si no se pasa
     jornada destino, usa la activa del canal o crea una de hoy.
     motivo opcional — desde migration 0026 queda en la nota del log
     ([FROM_FREE_STOCK] cantidad=N motivo=...). */
  async assignFreeStock({ sku, cantidad, channelId, jornadaId, motivo }) {
    const params = { p_sku: sku, p_cantidad: cantidad, p_target_channel_id: channelId };
    if (jornadaId) params.p_target_jornada_id = jornadaId;
    if (motivo)    params.p_motivo = motivo;
    const { data, error } = await supa.rpc('rpc_assign_free_stock', params);
    if (error) throw new Error(error.message);
    await Promise.all([loadCarriers(), loadProdLogs(), loadFreeStock(), loadJornadas()]);
    window.MOCK_BUS.emit();
    return data;
  },

  /* Walk-in: consumir stock libre sin generar production_log. */
  async consumeFreeStock({ sku, cantidad, motivo }) {
    const params = { p_sku: sku, p_cantidad: cantidad };
    if (motivo) params.p_motivo = motivo;
    const { data, error } = await supa.rpc('rpc_consume_free_stock', params);
    if (error) throw new Error(error.message);
    await loadFreeStock();
    window.MOCK_BUS.emit();
    return data;
  },

  /* ── Stock central (Cambio 1, Step 2) ──────────────────────────────
     Wrappers de los 2 RPCs nuevos de migration 0025 + loader del log
     de movimientos para la tab "Movimientos" de StockPage. Permisos:
     solo owner/admin/encargado (el backend lo enforza). */

  /* Mueve N unidades de un SKU desde un canal hacia el almacen central.
     El stock del canal baja, el agregado de stock central sube. */
  async enviarAStock({ sku, cantidad, sourceChannelId, motivo }) {
    const params = {
      p_sku: sku,
      p_cantidad: cantidad,
      p_source_channel_id: sourceChannelId,
    };
    if (motivo) params.p_motivo = motivo;
    const { data, error } = await supa.rpc('rpc_send_to_free_stock', params);
    if (error) throw new Error(error.message);
    await Promise.all([loadCarriers(), loadFreeStock(), loadProdLogs(), loadJornadas()]);
    window.MOCK_BUS.emit();
    return data;
  },

  /* Transferencia directa canal A -> canal B. Atomica en BD. */
  async transferirEntreCanales({ sku, cantidad, sourceChannelId, targetChannelId, motivo }) {
    const params = {
      p_sku: sku,
      p_cantidad: cantidad,
      p_source_channel_id: sourceChannelId,
      p_target_channel_id: targetChannelId,
    };
    if (motivo) params.p_motivo = motivo;
    const { data, error } = await supa.rpc('rpc_transfer_between_channels', params);
    if (error) throw new Error(error.message);
    await Promise.all([loadCarriers(), loadProdLogs(), loadJornadas()]);
    window.MOCK_BUS.emit();
    return data;
  },

  /* Lista de movimientos de stock para la tab "Movimientos" de StockPage.
     Filtra production_logs por notas tipadas. JOIN con profiles para
     el nombre del usuario. Limit 200 por default. */
  async loadStockMovimientos({ limit = 200 } = {}) {
    const { data, error } = await supa
      .from('production_logs')
      .select('*, operario:profiles!production_logs_operario_id_fkey(name,username)')
      .or('notas.ilike.[TO_FREE_STOCK]%,notas.ilike.[FROM_FREE_STOCK]%,notas.ilike.[FREE_STOCK]%,notas.ilike.[TRANSFER_OUT%,notas.ilike.[TRANSFER_IN%')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data || []).map(l => {
      // Parsear tipo de movimiento desde notas para que la UI no tenga
      // que conocer la convencion de etiquetas.
      const notas = l.notas || '';
      let tipo = 'otro';
      let detalle = null;
      if (notas.startsWith('[TO_FREE_STOCK]'))      { tipo = 'canal_a_stock'; }
      else if (notas.startsWith('[FROM_FREE_STOCK]')) { tipo = 'stock_a_canal'; }
      else if (notas.startsWith('[FREE_STOCK]'))    { tipo = 'auto_cierre_a_stock'; }
      else if (notas.startsWith('[TRANSFER_OUT')) {
        tipo = 'transfer_out';
        const m = notas.match(/^\[TRANSFER_OUT to=([a-z_]+)\]/);
        if (m) detalle = m[1];
      } else if (notas.startsWith('[TRANSFER_IN')) {
        tipo = 'transfer_in';
        const m = notas.match(/^\[TRANSFER_IN from=([a-z_]+)\]/);
        if (m) detalle = m[1];
      }
      const motMatch = notas.match(/motivo=(.+)$/);
      return {
        id: l.id,
        at: l.created_at,
        fecha: l.fecha,
        hora: l.hora ? String(l.hora).slice(0,5) : '',
        sku: l.sku,
        cantidad: l.cantidad,
        channel_id: l.channel_id,
        tipo,             // canal_a_stock | stock_a_canal | auto_cierre_a_stock | transfer_out | transfer_in
        contraparte: detalle, // channel_id del otro lado (solo transfer)
        motivo: motMatch ? motMatch[1].trim() : null,
        operario: l.operario?.name || l.operario?.username || '—',
        notas_raw: notas,
      };
    });
  },

  /* Total agregado de stock central (suma global). Para el cuadrito del
     dashboard. Lectura sincrónica de MOCK.freeStock. */
  getStockTotal() {
    return Object.values(window.MOCK.freeStock || {}).reduce((s, n) => s + (n || 0), 0);
  },

  /* Lista por SKU con cantidad para la tabla de StockPage. Sincrónico. */
  getStockAgregado() {
    const map = window.MOCK.freeStock || {};
    return Object.entries(map)
      .filter(([, c]) => c > 0)
      .map(([sku, cantidad]) => {
        const info = window.SKU_DB[sku] || {};
        return {
          sku,
          cantidad,
          modelo: info.modelo || sku,
          color: info.color || null,
          colorHex: info.colorHex || null,
          categoria: info.categoria || null,
        };
      })
      .sort((a, b) => a.sku.localeCompare(b.sku));
  },

  async importarLote({ channelId, filename, items, fileHash, targetJornadaId }) {
    // 1) Normalizar items antes del RPC. El RPC v3 (migration 0043) ahora
    //    PROCESA cancelaciones — ya no se filtran pre-RPC. Cada item se
    //    manda con su `estado` intacto y el RPC decide la accion segun los
    //    4 casos (cancelled_new / cancelled_existing /
    //    cancelled_post_produced / cancelled_already). Tambien queda
    //    resuelto el bug latente del v2: el filtro startsWith('cancelada')
    //    no matcheaba "Venta cancelada..." porque empieza con "venta" —
    //    el RPC v3 usa LIKE '%cancelada%' (includes).
    //    `fecha_pedido` debe ser ISO YYYY-MM-DD o null. El parser de
    //    Excel lo deja como string crudo (ej "20 de abril de 2026 21:24
    //    hs.") que Postgres rechaza con "invalid input syntax for type
    //    date".
    const normalizedItems = (items || []).map(it => {
      const fecha = window.parseFechaAR ? window.parseFechaAR(it.fecha_pedido) : null;
      const cleaned = {
        sku: (it.sku || '').toString().trim().toUpperCase(),
        cantidad: parseInt(it.cantidad, 10) || 0,
      };
      if (it.order_number) cleaned.order_number = String(it.order_number).trim();
      if (it.cliente)      cleaned.cliente      = String(it.cliente).trim();
      if (it.estado)       cleaned.estado       = String(it.estado).trim();  // el RPC decide
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

    // Resolver jornada destino: 1) la pasada por parámetro, 2) la seleccionada,
    // 3) la activa. Si no hay ninguna, el RPC fallará con mensaje claro.
    const jornadaDestino = targetJornadaId
      || window.MOCK.jornadas.seleccionadaId
      || window.MOCK.jornadas.activaId
      || null;
    const rpcParams = {
      p_channel_id: channelId,
      p_filename: filename,
      p_file_hash,
      p_items: normalizedItems,
    };
    if (jornadaDestino) rpcParams.p_target_jornada_id = jornadaDestino;
    const { data, error } = await supa.rpc('rpc_import_batch', rpcParams);
    if (error) throw new Error(error.message);
    await Promise.all([loadCarriers(), loadOrders(), loadBatches(), loadFreeStock()]);
    window.MOCK_BUS.emit();
    // El RPC v3 devuelve 4 contadores de cancelacion. Los sumamos para
    // exponer cancelled_count_local (mantiene compat con ImportModal,
    // que ya leia ese campo para el toast post-import).
    const d = data || {};
    const cancelledTotal = (d.cancelled_new || 0) + (d.cancelled_existing || 0) +
                           (d.cancelled_post_produced || 0) + (d.cancelled_already || 0);
    return { ...d, cancelled_count_local: cancelledTotal };
  },

  /* Editar / Anular un log de producción.
       - Si p_anular=true → solo inserta entrada compensatoria (-cantidad).
       - Si p_anular=false y p_new_cantidad → compensatoria + nuevo log con
         la cantidad corregida (y opcionalmente nuevo channel_id).
     El RPC valida permisos: operario solo sus logs, ventana hasta cierre
     del canal o 24h (lo que ocurra primero). Encargado/admin/owner sin tope.
     Los errores del RPC (rpc_correct_log v3) ya vienen con mensaje humano
     listo para mostrar — solo mapeamos errores de transporte (auth/red). */
  async corregirLog({ logId, nuevaCantidad, nuevoChannelId, motivo, anular }) {
    const { data, error } = await supa.rpc('rpc_correct_log', {
      p_log_id: logId,
      p_new_cantidad: anular ? null : (nuevaCantidad ?? null),
      p_new_channel_id: nuevoChannelId ?? null,
      p_motivo: motivo ?? null,
      p_anular: !!anular,
    });
    if (error) throw new Error(humanizeCorrectError(error));
    await Promise.all([loadCarriers(), loadProdLogs(), loadHistorico()]);
    window.MOCK_BUS.emit();
    return data;
  },

  /* Cargas de hoy con JOIN al profile del operario.
     scope='mias'  → solo del usuario actual (vista operario)
     scope='todas' → toda la planta (admin/encargado/owner)
     scope='auto'  → decide segun rol del profile en cache.
     Las RLS de production_logs hacen el corte real en BD; el scope solo
     determina si el frontend pide el filtro o no.
     Tambien trae las compensaciones de los logs visibles, para poder
     marcar los originales como "ya anulados" sin N+1. */
  async getCargasHoy({ limit = 100, scope = 'auto' } = {}) {
    const { data: { session } } = await supa.auth.getSession();
    if (!session) return [];
    const today = new Date().toISOString().slice(0, 10);

    let effectiveScope = scope;
    if (scope === 'auto') {
      const role = (window.MOCK?.user?.role || '').toLowerCase();
      effectiveScope = ['owner', 'admin', 'encargado'].includes(role) ? 'todas' : 'mias';
    }

    // 1) Cargas del dia (con o sin filtro de operario, segun scope)
    let q = supa
      .from('production_logs')
      .select('*, operario:profiles!production_logs_operario_id_fkey(name,username)')
      .eq('fecha', today)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (effectiveScope === 'mias') q = q.eq('operario_id', session.user.id);
    const { data: logs, error: e1 } = await q;
    if (e1) throw new Error(e1.message);

    // 2) Compensaciones del dia que referencian alguno de los logs visibles.
    const ids = (logs || []).map(l => l.id);
    let comps = [];
    if (ids.length) {
      const { data: c, error: e2 } = await supa
        .from('production_logs')
        .select('*, operario:profiles!production_logs_operario_id_fkey(name,username)')
        .eq('fecha', today)
        .lt('cantidad', 0)
        .like('notas', '[ANULADO] log_id=%');
      if (!e2 && c) {
        comps = c.filter(x => {
          const m = (x.notas || '').match(/^\[ANULADO\] log_id=([0-9a-f-]+)/);
          return m && ids.includes(m[1]);
        });
      }
    }

    return [...(logs || []), ...comps]
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  },

  /* Alias por compatibilidad. Mobile/scan.jsx puede seguir usandolo. */
  async getMisCargasHoy(limit = 20) {
    return this.getCargasHoy({ limit, scope: 'auto' });
  },

  /* Carga manual de pedido (carrito atomico).
     items: [{sku, cantidad}]. orderNumber/cliente/motivo opcionales.
     forceMerge: true → permite agregar items a un order_number existente.
     targetJornadaId: jornada destino (RPC v2 lo requiere si hay 2+ abiertas);
       fallback a la seleccionada y luego a la activa. */
  async crearPedidoManual({ channelId, orderNumber, cliente, items, motivo, forceMerge, targetJornadaId }) {
    const params = { p_channel_id: channelId, p_items: items || [] };
    if (orderNumber) params.p_order_number = orderNumber;
    if (cliente) params.p_cliente = cliente;
    if (motivo) params.p_motivo = motivo;
    if (forceMerge) params.p_force_merge = true;
    const jornadaDestino = targetJornadaId
      || window.MOCK.jornadas.seleccionadaId
      || window.MOCK.jornadas.activaId
      || null;
    if (jornadaDestino) params.p_target_jornada_id = jornadaDestino;
    const { data, error } = await supa.rpc('rpc_create_manual_order', params);
    if (error) throw new Error(error.message);
    await Promise.all([loadCarriers(), loadOrders(), loadJornadas()]);
    window.MOCK_BUS.emit();
    return data;
  },

  /* Edicion de pedido con optimistic locking.
     cambios: {modificar:[{sku,cantidad_nueva,version}], agregar:[...], quitar:[{sku,version}]} */
  async editarPedido({ channelId, orderNumber, cambios, motivo }) {
    const params = {
      p_channel_id: channelId,
      p_order_number: orderNumber,
      p_cambios: cambios || {},
    };
    if (motivo) params.p_motivo = motivo;
    const { data, error } = await supa.rpc('rpc_edit_order', params);
    if (error) throw new Error(error.message);
    await Promise.all([loadCarriers(), loadOrders(), loadJornadas()]);
    window.MOCK_BUS.emit();
    return data;
  },

  /* Historial de ediciones de un pedido (para el modal de log) */
  async getOrderEditLog({ channelId, orderNumber }) {
    const { data, error } = await supa
      .from('order_edit_log')
      .select('*, profile:profiles!order_edit_log_by_user_fkey(name,username)')
      .eq('channel_id', channelId)
      .eq('order_number', orderNumber)
      .order('at', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
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
    // Usa rpc_upsert_sku (SECURITY DEFINER) para atomicidad:
    // si la categoría no existe en sku_categories, se crea ANTES del
    // INSERT del SKU. Si el SKU falla, la categoría también rollback.
    const { data, error } = await supa.rpc('rpc_upsert_sku', {
      p_sku:          sku,
      p_modelo:       payload.modelo,
      p_color:        payload.color === '—' ? null : payload.color,
      p_color_hex:    payload.color_hex || null,
      p_categoria:    payload.categoria,
      p_es_fabricado: payload.es_fabricado,
      p_activo:       payload.activo,
      p_incompleto:   payload.incompleto || false,
      p_is_new:       !!isNew,
    });
    if (error) throw new Error(error.message);
    await loadCatalog();
    // Refrescar lista de categorías por si se creó una nueva
    await loadCategories();
    window.MOCK_BUS.emit();
    return data; // {sku, category_created, category}
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
    'import_batches','sku_catalog','profiles','notifications','free_stock',
  ];
  for (const t of tables) {
    supa.channel(`rt-${t}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: t }, scheduleRefresh)
      .subscribe();
  }
}

/* ─────────────────────────────────────────────────────────────────
   FEATURE FLAGS — controlados desde frontend
   ───────────────────────────────────────────────────────────────── */
/* CARGA MANUAL + EDICION DE PEDIDOS.
   Cuando false: ningun boton, badge ni modal de la feature aparece.
   Sistema visualmente identico al pre-feature. Para activar: cambiar
   a true + redeploy. Para desactivar: cambiar a false + redeploy.
   Los RPCs y la tabla order_edit_log existen en BD pero nadie los
   invoca con flag OFF.
   Activado 2026-05-06 tras validacion visual con flag OFF. */
window.FEATURE_PEDIDOS_MANUALES = true;

/* CARGA MANUAL DE EGRESOS, CHEQUES, CLIENTES, PROVEEDORES, CTAS CTES.
   Cuando false: el nav-item "Admin" no aparece, el routing fallback
   manda a dashboard, ningun componente admin se renderiza. Sistema
   visualmente identico al pre-feature. Para activar: cambiar a true
   + redeploy.
   NOTA: el deploy de la Edge Function agent_admin y el seteo del
   secret ANTHROPIC_API_KEY estan diferidos a B.5+. Esta sub-fase B.1
   no consume IA. */
window.FEATURE_ADMIN = true;

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
    // Public: catálogo + canales + categorías (no requieren auth)
    await Promise.allSettled([
      _safe(loadCatalog(),    'catalog'),
      _safe(loadCategories(), 'categories'),
      _safe(loadChannels(),   'channels'),
    ]);

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
        _safe(loadFreeStock(),     'free_stock'),
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

/* ═══════════════════════════════════════════════════════════════════
   REPORT_UTILS — generación on-demand de reportes de cierre
   ───────────────────────────────────────────────────────────────────
   El snapshot inmutable está en jornadas.snapshot (jsonb). Generamos
   Excel y PDF al vuelo cuando el usuario los pide. Nada se sube a
   Storage en V1 — los datos están a una query de distancia.
   ═══════════════════════════════════════════════════════════════════ */
window.REPORT_UTILS = {
  async descargarReporteCierre(cierre, channel, format) {
    // cierre: row de jornadas (snapshot, fecha, pedidos_count, etc.)
    // channel: id del canal (colecta, flex, ...)
    // format: 'xlsx' | 'pdf'
    const C = window.CARRIERS[channel] || { label: channel };
    const fechaJornada = cierre.fechaJornada || cierre.fecha;
    const fechaStr = (fechaJornada || '').slice(0, 10);
    const filename = `cierre-${channel}-${fechaStr}`;
    const snapshot = Array.isArray(cierre.snapshot) ? cierre.snapshot : [];

    if (format === 'xlsx') {
      if (typeof window.XLSX === 'undefined') {
        throw new Error('Librería de Excel no cargada — refrescá la página');
      }
      const filas = snapshot.map(r => ({
        SKU: r.sku,
        Modelo: r.modelo || '',
        Color: r.color || '',
        Pedido: r.pedido || 0,
        Producido: r.producido || 0,
        Faltante: r.faltante || 0,
        Sobrante: r.stock || 0,
      }));
      const meta = [
        { Campo: 'Canal', Valor: C.label },
        { Campo: 'Fecha jornada', Valor: fechaStr },
        { Campo: 'Cerrada el', Valor: cierre.fecha || '' },
        { Campo: 'Pedidos', Valor: cierre.pedidos || 0 },
        { Campo: 'Unidades pedidas', Valor: cierre.unidadesPedidas || 0 },
        { Campo: 'Unidades producidas', Valor: cierre.unidadesProducidas || 0 },
        { Campo: 'Faltante arrastrado', Valor: cierre.faltante || 0 },
      ];
      const wb = window.XLSX.utils.book_new();
      const wsMeta = window.XLSX.utils.json_to_sheet(meta);
      wsMeta['!cols'] = [{ wch: 24 }, { wch: 32 }];
      window.XLSX.utils.book_append_sheet(wb, wsMeta, 'Resumen');
      const wsDet = window.XLSX.utils.json_to_sheet(filas);
      wsDet['!cols'] = [{ wch: 12 }, { wch: 36 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
      window.XLSX.utils.book_append_sheet(wb, wsDet, 'Detalle por SKU');
      window.XLSX.writeFile(wb, `${filename}.xlsx`);
      return;
    }

    if (format === 'pdf') {
      if (!window.jspdf || !window.jspdf.jsPDF) {
        throw new Error('Librería jsPDF no cargada — refrescá la página');
      }
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      const PAGE_W = 210;
      let y = 18;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text(`Cierre ${C.label}`, 12, y); y += 7;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text(`Fecha jornada: ${fechaStr}`, 12, y); y += 5;
      doc.text(`Cerrada el: ${cierre.fecha ? new Date(cierre.fecha).toLocaleString('es-AR') : '—'}`, 12, y); y += 5;
      y += 2;
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text('Resumen', 12, y); y += 5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(`Pedidos: ${cierre.pedidos || 0}    Unidades pedidas: ${cierre.unidadesPedidas || 0}    Unidades producidas: ${cierre.unidadesProducidas || 0}    Faltante arrastrado: ${cierre.faltante || 0}`, 12, y);
      y += 8;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('Detalle por SKU', 12, y); y += 6;
      doc.setFontSize(8);
      // Tabla simple
      const headers = ['SKU', 'Modelo', 'Color', 'Pedido', 'Producido', 'Faltante', 'Sobrante'];
      const colW = [22, 60, 22, 18, 22, 20, 20];
      let x = 12;
      doc.setFillColor(240, 240, 240);
      doc.rect(12, y - 4, PAGE_W - 24, 6, 'F');
      headers.forEach((h, i) => { doc.text(h, x + 1, y); x += colW[i]; });
      y += 4;
      doc.setFont('helvetica', 'normal');
      for (const r of snapshot) {
        if (y > 280) { doc.addPage(); y = 18; }
        x = 12;
        const row = [
          r.sku || '',
          (r.modelo || '').slice(0, 32),
          r.color || '',
          String(r.pedido || 0),
          String(r.producido || 0),
          String(r.faltante || 0),
          String(r.stock || 0),
        ];
        row.forEach((cell, i) => { doc.text(cell, x + 1, y); x += colW[i]; });
        y += 5;
      }
      doc.save(`${filename}.pdf`);
      return;
    }

    throw new Error('Formato desconocido: ' + format);
  },
};

window.QR_UTILS = {
  /* Genera un dataURL PNG del QR puro (sin texto). Usa qrcode-generator
     (UMD, expone window.qrcode minúscula). La lib retorna GIF — lo
     redibujamos en canvas y lo exportamos como PNG porque jsPDF.addImage
     no soporta GIF directo. */
  async generarQRDataUrl(sku, opts = {}) {
    if (typeof window.qrcode === 'undefined') {
      throw new Error('Librería QRCode no cargada — refrescá la página.');
    }
    const qr = window.qrcode(0, opts.errorCorrectionLevel || 'M'); // typeNumber=0 = autodetect
    qr.addData(sku);
    qr.make();

    // Tamaño: queremos ~512px de QR. Calculamos cellSize en función del
    // número de módulos (variará entre 21x21 y 33x33 según el largo del SKU).
    const moduleCount = qr.getModuleCount(); // ej. 21 para SKUs cortos
    const targetPx = opts.width || 512;
    const margin = opts.margin ?? 1;
    const cellSize = Math.max(2, Math.floor(targetPx / (moduleCount + margin * 2)));

    // qrcode-generator escribe directo en canvas si le pedimos createImgTag,
    // pero más limpio dibujar nosotros para tener PNG en vez de GIF.
    const canvas = document.createElement('canvas');
    const size = (moduleCount + margin * 2) * cellSize;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000000';
    for (let r = 0; r < moduleCount; r++) {
      for (let c = 0; c < moduleCount; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect((c + margin) * cellSize, (r + margin) * cellSize, cellSize, cellSize);
        }
      }
    }
    return canvas.toDataURL('image/png');
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
