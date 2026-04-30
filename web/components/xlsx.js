/* ══ XLSX PARSER (puro JS) — extrae filas de la primera hoja ══ */

window.parseXLSX = async function(file) {
  const buf = await file.arrayBuffer();
  const u8 = new Uint8Array(buf);

  // 1) Encontrar EOCD (end of central directory) del zip
  function findEOCD(d) {
    for (let i = d.length - 22; i >= 0; i--) {
      if (d[i] === 0x50 && d[i+1] === 0x4b && d[i+2] === 0x05 && d[i+3] === 0x06) return i;
    }
    return -1;
  }

  // 2) Inflate raw deflate usando DecompressionStream
  async function inflate(deflated) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([deflated]).stream().pipeThrough(ds);
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
  }

  const eocd = findEOCD(u8);
  if (eocd < 0) throw new Error('Archivo no es un .xlsx válido');
  const dvE = new DataView(buf);
  const cdOffset = dvE.getUint32(eocd + 16, true);
  const cdEntries = dvE.getUint16(eocd + 10, true);

  // 3) Leer central directory y data de cada entrada
  let off = cdOffset;
  const files = {};
  for (let i = 0; i < cdEntries; i++) {
    const dv = new DataView(buf, off);
    const cm = dv.getUint16(10, true);
    const cs = dv.getUint32(20, true);
    const nl = dv.getUint16(28, true);
    const el = dv.getUint16(30, true);
    const cl = dv.getUint16(32, true);
    const lo = dv.getUint32(42, true);
    const name = new TextDecoder().decode(u8.slice(off + 46, off + 46 + nl));
    const lh = new DataView(buf, lo);
    const lhNl = lh.getUint16(26, true);
    const lhEl = lh.getUint16(28, true);
    const start = lo + 30 + lhNl + lhEl;
    files[name] = { cm, data: u8.slice(start, start + cs) };
    off += 46 + nl + el + cl;
  }
  async function readAs(n) {
    const f = files[n];
    if (!f) return null;
    if (f.cm === 0) return new TextDecoder().decode(f.data);
    return await inflate(f.data);
  }

  const ssXml = await readAs('xl/sharedStrings.xml') || '';
  // Buscar primera hoja
  const sheetName = Object.keys(files).find(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)) || 'xl/worksheets/sheet1.xml';
  const sheet = await readAs(sheetName);
  if (!sheet) throw new Error('No se encontró hoja en el archivo');

  // 4) Parsear sharedStrings
  const strings = [];
  const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  const siRe = /<si[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(ssXml))) {
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let txt = ''; let mt;
    while ((mt = tRe.exec(m[1]))) txt += mt[1];
    strings.push(decode(txt));
  }

  // 5) Parsear filas y celdas
  const rows = [];
  const rowRe = /<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  while ((m = rowRe.exec(sheet))) {
    const rowNum = parseInt(m[1]);
    const cells = {};
    const cellRe = /<c[^>]*r="([A-Z]+)\d+"(?:[^>]*t="([^"]+)")?[^>]*>(?:<v>([^<]*)<\/v>|<is><t[^>]*>([^<]*)<\/t><\/is>)?<\/c>/g;
    let mc;
    while ((mc = cellRe.exec(m[2]))) {
      const col = mc[1];
      const t = mc[2];
      const v = mc[3];
      const inline = mc[4];
      let val;
      if (t === 's' && v != null) val = strings[parseInt(v)];
      else if (inline != null) val = decode(inline);
      else val = v;
      cells[col] = val;
    }
    rows.push({ rowNum, cells });
  }
  return rows;
};

/**
 * Detecta el tipo de planilla y extrae pedidos como [{sku, cantidad, numero, fecha, cliente, canal}].
 * Soporta:
 *   - ML "ventas" (con headers en fila 6): SKU=V, Unidades=G, Canal=AC, Forma de entrega=AO
 *   - Genérico: cualquier hoja donde la primera fila con "SKU" en alguna celda sea el header
 */
window.extractOrders = function(rows) {
  if (!rows || !rows.length) return { orders: [], canalDetectado: null, tipo: 'desconocido' };

  // Buscar fila header — la que tenga celda con texto "SKU"
  let headerRow = null;
  for (const r of rows) {
    const vals = Object.values(r.cells || {});
    if (vals.some(v => typeof v === 'string' && /^sku$/i.test(v.trim()))) {
      headerRow = r;
      break;
    }
  }
  if (!headerRow) return { orders: [], canalDetectado: null, tipo: 'desconocido' };

  // Mapear columnas → letra
  const colMap = {};
  for (const [letra, val] of Object.entries(headerRow.cells)) {
    if (typeof val !== 'string') continue;
    const norm = val.trim().toLowerCase();
    if (norm === 'sku') colMap.sku = letra;
    else if (/unidades?$/.test(norm) || norm === 'cantidad' || norm === 'cant.') {
      if (!colMap.cantidad) colMap.cantidad = letra; // tomar la primera "Unidades"
    }
    else if (norm === '# de venta' || norm === 'numero' || norm === 'número') colMap.numero = letra;
    else if (/fecha de venta|^fecha$/i.test(val)) colMap.fecha = letra;
    else if (norm === 'comprador' || norm === 'cliente') colMap.cliente = letra;
    else if (/forma de entrega/i.test(val)) colMap.entrega = letra;
    else if (/canal de venta/i.test(val)) colMap.canalVenta = letra;
  }
  if (!colMap.sku || !colMap.cantidad) return { orders: [], canalDetectado: null, tipo: 'desconocido' };

  // Extraer pedidos (filas posteriores al header)
  const orders = [];
  let canalDetectado = null;
  for (const r of rows) {
    if (r.rowNum <= headerRow.rowNum) continue;
    const sku = (r.cells[colMap.sku] || '').toString().trim();
    const cantStr = (r.cells[colMap.cantidad] || '').toString().trim();
    if (!sku || !cantStr) continue;
    const cantidad = parseFloat(cantStr);
    if (!cantidad || isNaN(cantidad)) continue;

    const entrega = colMap.entrega ? (r.cells[colMap.entrega] || '').toString().toLowerCase() : '';
    let canal = null;
    if (/colecta/.test(entrega)) canal = 'colecta';
    else if (/flex/.test(entrega)) canal = 'flex';
    if (canal && !canalDetectado) canalDetectado = canal;

    orders.push({
      sku,
      cantidad: Math.round(cantidad),
      numero: colMap.numero ? (r.cells[colMap.numero] || '').toString() : '',
      fecha:  colMap.fecha  ? (r.cells[colMap.fecha]  || '').toString() : '',
      cliente:colMap.cliente? (r.cells[colMap.cliente]|| '').toString() : '',
      canal,
    });
  }

  const tipo = colMap.entrega ? 'mercadolibre' : 'generico';
  return { orders, canalDetectado, tipo };
};
