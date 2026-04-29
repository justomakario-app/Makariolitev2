/* ══ MOCK DATA v3 — TODO POR SKU (RESET A 0) ══ */

/* ── DICCIONARIO SKU → PRODUCTO (fuente de verdad) ── */
window.SKU_DB = {
  'MAD050': { modelo:'Mesa Nórdica Blanca Petiribi',     color:'Blanco', categoria:'Mesas',  es_fabricado:true, activo:true },
  'MAD051': { modelo:'Mesa Redonda Negra',               color:'Negro',  categoria:'Mesas',  es_fabricado:true, activo:true },
  'MAD052': { modelo:'Mesa Redonda Negra',               color:'Negro',  categoria:'Mesas',  es_fabricado:true, activo:true },
  'MAD061': { modelo:'Set Gota Blanco',                  color:'Blanco', categoria:'Mesas',  es_fabricado:true, activo:true },
  'MAD062': { modelo:'Set Gota Negra',                   color:'Negro',  categoria:'Mesas',  es_fabricado:true, activo:true },
  'MAD095': { modelo:'Set Redonda Blanco',               color:'Blanco', categoria:'Mesas',  es_fabricado:true, activo:true },
  'MAD096': { modelo:'Set Redonda Negra',                color:'Negro',  categoria:'Mesas',  es_fabricado:true, activo:true },
  'MAD155': { modelo:'Mesa Púas/Gota Madera Negro',      color:'Negro',  categoria:'Mesas',  es_fabricado:true, activo:true },
  'MAD190': { modelo:'Set Redonda Simil Marmol Blanco',  color:'Blanco', categoria:'Mesas',  es_fabricado:true, activo:true },
  'MAD191': { modelo:'Set Redonda Simil Marmol Negra',   color:'Negro',  categoria:'Mesas',  es_fabricado:true, activo:true },
  'MAD200': { modelo:'Rectangular Negra',                color:'Negro',  categoria:'Ratonas', es_fabricado:true, activo:true },
  'MAD201': { modelo:'Rectangular Blanco',               color:'Blanco', categoria:'Ratonas', es_fabricado:true, activo:true },
  'MAD300': { modelo:'Yori',                             color:'—',      categoria:'Recibidoras', es_fabricado:true, activo:true },
  'MAD301': { modelo:'Bumerang Blanco',                  color:'Blanco', categoria:'Ratonas', es_fabricado:true, activo:true },
  'MAD302': { modelo:'Boomerang Negra',                  color:'Negro',  categoria:'Ratonas', es_fabricado:true, activo:true },
  'MAD303': { modelo:'Set XL Negra',                     color:'Negro',  categoria:'Mesas',  es_fabricado:true, activo:true },
  'MAD304': { modelo:'Set XL Blanco',                    color:'Blanco', categoria:'Mesas',  es_fabricado:true, activo:true },
  'MAD401': { modelo:'Hikari',                           color:'—',      categoria:'Luz',    es_fabricado:true, activo:true },
};

/* Helpers SKU */
window.skuName = (sku) => {
  const s = window.SKU_DB[sku];
  if (!s) return sku;
  return s.color === '—' ? s.modelo : `${s.modelo} ${s.color}`;
};
window.skuModel = (sku) => window.SKU_DB[sku]?.modelo || sku;

window.MOCK = {

  user: { name:'Sebastián', initials:'SE', role:'owner', roleLabel:'Propietario', email:'sebastian@justomakario.com', username:'sebastian' },

  /* ── Dashboard ── */
  dash: { colecta:0, flex:0, tiendanube:0, distribuidor:0 },

  /* ── Sparkline ── */
  sales7: [0, 0, 0, 0, 0, 0, 0],
  salesLabels: ['LUN','MAR','MIÉ','JUE','VIE','SÁB','DOM'],

  /* ── Carrier pages — todo a 0 ── */
  carriers: {
    colecta: {
      lastClosure: null, allDone: true,
      kpis: { activos:0, unidades:0, pendiente:0 },
      table: [], orders: [], lotes: [], cierres: [],
    },
    flex: {
      lastClosure: null, allDone: true,
      kpis: { activos:0, unidades:0, pendiente:0 },
      table: [], orders: [], lotes: [], cierres: [],
    },
    tiendanube: {
      lastClosure: null, allDone: true,
      kpis: { activos:0, unidades:0, pendiente:0 },
      table: [], orders: [], lotes: [], cierres: [],
    },
    distribuidor: {
      lastClosure: null, allDone: true,
      kpis: { activos:0, unidades:0, pendiente:0 },
      table: [], orders: [], lotes: [], cierres: [],
    },
  },

  /* ── Producción unificada — vacía ── */
  prod: {
    todos: {
      producidoHoy: 0,
      kpis: { faltante:0, totalPedido:0, producido:0 },
      table: [],
    },
  },

  /* ── prod_logs vacíos ── */
  prodLogs: [],

  /* ── Notificaciones vacías ── */
  notifications: [],

  /* ── Equipo ── */
  users: [
    { name:'Sebastián', username:'sebastian', role:'owner',     area:'Dirección',    active:true  },
    { name:'Noe',       username:'noe',       role:'owner',     area:'Finanzas',     active:true  },
    { name:'Miqueas',   username:'miqueas',   role:'encargado', area:'Producción',   active:true  },
    { name:'Federico',  username:'federico',  role:'embalaje',  area:'Embalaje',     active:true  },
    { name:'Max',       username:'max',       role:'cnc',       area:'CNC',          active:true  },
    { name:'Gabriel',   username:'gabriel',   role:'melamina',  area:'Melamina',     active:true  },
    { name:'Matías',    username:'matias',    role:'pino',      area:'Pino/Armado',  active:true  },
    { name:'Flor',      username:'flor',      role:'logistica', area:'Logística',    active:true  },
    { name:'Romy',      username:'romy',      role:'admin',     area:'Facturación',  active:true  },
  ],

  /* ── Histórico vacío ── */
  historico: {
    year: 2026, month: 3,
    days: {},
    kpis: { total:0, diasActivos:0 },
  },

  RL: {
    owner:'Propietario', admin:'Administración', encargado:'Encargado General',
    ventas:'Ventas', cnc:'Sector CNC', melamina:'Sector Melamina',
    pino:'Sector Pino', embalaje:'Sector Embalaje',
    carpinteria:'Carpintería', logistica:'Logística', marketing:'Marketing',
  },

  /* ── Permisos por rol — landing y secciones visibles ── */
  ROLE_NAV: {
    owner:     { landing:'dashboard', items:['dashboard','colecta','flex','tiendanube','distribuidor','produccion','registrar','historico','catalogo','equipo','notificaciones','perfil'] },
    admin:     { landing:'dashboard', items:['dashboard','colecta','flex','tiendanube','distribuidor','produccion','registrar','historico','catalogo','equipo','notificaciones','perfil'] },
    encargado: { landing:'produccion', items:['produccion','registrar','notificaciones','perfil'] },
    cnc:       { landing:'produccion', items:['produccion','registrar','perfil'] },
    melamina:  { landing:'produccion', items:['produccion','registrar','perfil'] },
    pino:      { landing:'produccion', items:['produccion','registrar','perfil'] },
    embalaje:  { landing:'produccion', items:['produccion','registrar','perfil'] },
    logistica: { landing:'produccion', items:['produccion','registrar','perfil'] },
  },
};

/* ── Channel config ── */
window.CARRIERS = {
  colecta:    { label:'Colecta',         sub:'ML · Retiro 12:00 hs', color:'#6366f1', bg:'#f1f0ff', tipo_cierre:'horario',  cierreHora:'12:00' },
  flex:       { label:'Flex',            sub:'ML · Retiro 14:00 hs', color:'#15803d', bg:'#effaf1', tipo_cierre:'horario',  cierreHora:'14:00' },
  tiendanube: { label:'Tienda Nube',     sub:'Web propia',           color:'#2563eb', bg:'#eff6ff', tipo_cierre:'flexible', cierreHora:null },
  distribuidor:{ label:'Distribuidores', sub:'Mayoristas / bulto',   color:'#d97706', bg:'#fffbeb', tipo_cierre:'flexible', cierreHora:null },
};

/* ── Mini bus reactivo ── */
window.MOCK_BUS = {
  listeners: new Set(),
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit() { this.listeners.forEach(fn => fn()); },
};

/* ── Mutaciones de producción ── */
window.MOCK_ACTIONS = {
  registrarProduccion({ sku, subcanal, cantidad }) {
    const M = window.MOCK;
    const canalLabel = (window.CARRIERS[subcanal] || {}).label || subcanal;

    const carrier = M.carriers[subcanal];
    if (carrier) {
      let row = carrier.table.find(r => r.sku === sku);
      if (!row) {
        row = { sku, pedido: 0, producido: 0, faltante: 0, stock: 0 };
        carrier.table.push(row);
      }
      if (row.stock == null) row.stock = 0;
      row.producido += cantidad;
      const diferencia = row.producido - row.pedido;
      if (diferencia >= 0) { row.faltante = 0; row.stock = diferencia; }
      else                 { row.faltante = -diferencia; row.stock = 0; }
      const k = carrier.kpis;
      k.pendiente = carrier.table.reduce((s, r) => s + r.faltante, 0);
      k.unidades  = carrier.table.reduce((s, r) => s + r.pedido, 0);
      k.activos   = carrier.table.filter(r => r.faltante > 0).length;
      carrier.allDone = k.pendiente === 0;
    }

    const prod = M.prod.todos;
    let prodRow = prod.table.find(r => r.sku === sku && r.canal === canalLabel);
    if (!prodRow) {
      prodRow = { sku, canal: canalLabel, pedido: 0, producido: 0, faltante: 0, stock: 0 };
      prod.table.push(prodRow);
    }
    if (prodRow.stock == null) prodRow.stock = 0;
    prodRow.producido += cantidad;
    const dif2 = prodRow.producido - prodRow.pedido;
    if (dif2 >= 0) { prodRow.faltante = 0; prodRow.stock = dif2; }
    else           { prodRow.faltante = -dif2; prodRow.stock = 0; }
    prod.kpis.faltante    = prod.table.reduce((s, r) => s + r.faltante, 0);
    prod.kpis.totalPedido = prod.table.reduce((s, r) => s + r.pedido, 0);
    prod.kpis.producido   = prod.table.reduce((s, r) => s + r.producido, 0);
    prod.producidoHoy     = (prod.producidoHoy || 0) + cantidad;

    if (subcanal in M.dash) M.dash[subcanal] = Math.max(0, M.dash[subcanal] - cantidad);

    window.MOCK_BUS.emit();
  },

  aplicarPedido({ sku, subcanal, cantidad }) {
    const M = window.MOCK;
    const canalLabel = (window.CARRIERS[subcanal] || {}).label || subcanal;
    const carrier = M.carriers[subcanal];
    if (!carrier) return;
    let row = carrier.table.find(r => r.sku === sku);
    if (!row) {
      row = { sku, pedido: 0, producido: 0, faltante: 0, stock: 0 };
      carrier.table.push(row);
    }
    if (row.stock == null) row.stock = 0;
    row.pedido += cantidad;
    const stockUsado = Math.min(row.stock, cantidad);
    row.stock -= stockUsado;
    row.producido += stockUsado;
    const dif = row.producido - row.pedido;
    if (dif >= 0) { row.faltante = 0; row.stock = dif; }
    else          { row.faltante = -dif; row.stock = 0; }

    const prod = M.prod.todos;
    let prodRow = prod.table.find(r => r.sku === sku && r.canal === canalLabel);
    if (!prodRow) {
      prodRow = { sku, canal: canalLabel, pedido: 0, producido: 0, faltante: 0, stock: 0 };
      prod.table.push(prodRow);
    }
    prodRow.pedido = row.pedido;
    prodRow.producido = row.producido;
    prodRow.faltante = row.faltante;
    prodRow.stock = row.stock;

    const k = carrier.kpis;
    k.pendiente = carrier.table.reduce((s, r) => s + r.faltante, 0);
    k.unidades  = carrier.table.reduce((s, r) => s + r.pedido, 0);
    k.activos   = carrier.table.filter(r => r.faltante > 0).length;
    carrier.allDone = k.pendiente === 0;
    prod.kpis.faltante    = prod.table.reduce((s, r) => s + r.faltante, 0);
    prod.kpis.totalPedido = prod.table.reduce((s, r) => s + r.pedido, 0);
    prod.kpis.producido   = prod.table.reduce((s, r) => s + r.producido, 0);

    window.MOCK_BUS.emit();
  },
};
