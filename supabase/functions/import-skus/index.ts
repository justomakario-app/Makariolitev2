// ════════════════════════════════════════════════════════════════════
// Edge Function: import-skus  (Producción en Línea — Fase 1b)
// ════════════════════════════════════════════════════════════════════
// Importa "sku para sistema.xlsx" a las tablas prod_* (migration 0071).
// Mapeo confirmado por Jefe:
//   Hoja "INSUMOS"                  → prod_pieza  (SKU PADRE)
//   Hoja "SKU DE PLACAS DE CORTE CNC"
//        · sección derecha (cols 6+)→ prod_pieza  (TAPs)
//        · sección izquierda (0-4)  → prod_placa (+ prod_placa_pieza_extra)
//   Hoja "SKU DE PRODUCTOS"         → prod_producto
//   Hoja "sku x producto"          → prod_receta (complementos TAP/KIT/CAJ
//                                     que existan como pieza)
//   INSUMOS + "sku x producto"     → prod_componente (BOM recursivo · Fase 5):
//                                     padre→hijo×cantidad, todo el árbol.
//
// IMPORTANTE: lee el .xlsx del FILESYSTEM LOCAL (Storage aún no configurado).
// Pensada para correr con `supabase functions serve` desde la raíz del repo:
//   curl -X POST http://localhost:54321/functions/v1/import-skus \
//        -H "Authorization: Bearer <JWT owner/admin>"
// Opcional body: { "path": "./sku para sistema.xlsx" }
//
// Upsert por SKU (nunca duplica). Una fila que viola FK/CHECK se rechaza y
// se reporta {fila, motivo}, sin abortar el resto.
//
// Normalización (Brief 1 · sección 12): correcciones de datos del Excel se
// aplican en código (ver SKU_FIXES más abajo), sin tocar el .xlsx original.
// ════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const cell = (row: any[], i: number) => String(row?.[i] ?? "").trim();
const toIntOrNull = (s: string) => {
  const n = parseInt(String(s).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
};

// ── Normalización de datos del Excel (Brief 1 · sección 12) ──────────
// Correcciones declarativas y VERSIONADAS — el .xlsx original de Seba NO se toca.
// #1/#8: en la hoja INSUMOS, TOR005/006/007 están definidos DOS veces (una vez
//   como herrajes rectangulares/set y otra como tornillos de Yori/Hikari). Como
//   el upsert es por SKU, la 2ª fila pisaría a la 1ª y se perdería una pieza.
//   Se reasigna un código único a la variante Yori/Hikari (identificada por su
//   nombre); las rectangulares/set conservan el SKU original.
//     TOR005 + "YORI"   → TOR009     TOR006 + "HIKARI" → TOR010
//     TOR007 + "HIKARI" → TOR011 (Hikari x2)
const SKU_FIXES: { sku: string; nombreIncluye: string; nuevoSku: string }[] = [
  { sku: "TOR005", nombreIncluye: "YORI",   nuevoSku: "TOR009" },
  { sku: "TOR006", nombreIncluye: "HIKARI", nuevoSku: "TOR010" },
  { sku: "TOR007", nombreIncluye: "HIKARI", nuevoSku: "TOR011" },
];
const fixSku = (sku: string, nombre: string): string => {
  const up = String(nombre).toUpperCase();
  const f = SKU_FIXES.find((x) => x.sku === sku && up.includes(x.nombreIncluye));
  return f ? f.nuevoSku : sku;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // ── 1. Validar rol owner/admin vía JWT → profiles.role ──────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Falta el token de autorización" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return json({ error: "Sesión inválida" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: prof } = await admin
    .from("profiles").select("role, active").eq("id", user.id).single();
  if (!prof || prof.active === false || !["owner", "admin"].includes(prof.role)) {
    return json({ error: "Solo owner/admin pueden importar" }, 403);
  }

  // ── 2. Leer el Excel del filesystem local ───────────────────────────
  let path = "./sku para sistema.xlsx";
  try {
    const body = await req.json().catch(() => ({}));
    if (body && typeof body.path === "string" && body.path.trim()) path = body.path.trim();
  } catch (_) { /* sin body, usar default */ }

  let wb: any;
  try {
    const bytes = await Deno.readFile(path);
    wb = XLSX.read(bytes, { type: "array" });
  } catch (e) {
    return json({ error: `No se pudo leer el archivo "${path}": ${String(e)}` }, 400);
  }

  const sheetRows = (name: string): any[][] => {
    const ws = wb.Sheets[name];
    if (!ws) return [];
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: true }) as any[][];
  };

  // ── 3. Acumuladores ─────────────────────────────────────────────────
  const result = {
    insertados: 0,
    actualizados: 0,
    rechazados: [] as { fila: string; motivo: string }[],
    por_tabla: {} as Record<string, { ins: number; upd: number }>,
  };
  const reject = (fila: string, motivo: string) => result.rechazados.push({ fila, motivo });
  const bump = (tabla: string, isNew: boolean) => {
    result.por_tabla[tabla] ??= { ins: 0, upd: 0 };
    if (isNew) { result.insertados++; result.por_tabla[tabla].ins++; }
    else { result.actualizados++; result.por_tabla[tabla].upd++; }
  };

  // Sets de claves ya existentes (para clasificar insert vs update) — también
  // sirven para validar FKs en memoria antes de intentar el upsert.
  const loadKeys = async (tabla: string, cols: string[]): Promise<Set<string>> => {
    const set = new Set<string>();
    const { data } = await admin.from(tabla).select(cols.join(","));
    for (const r of (data ?? [])) set.add(cols.map((c) => (r as any)[c]).join("|"));
    return set;
  };
  const piezaSet    = await loadKeys("prod_pieza", ["sku"]);
  const placaSet    = await loadKeys("prod_placa", ["sku"]);
  const placaExtraSet = await loadKeys("prod_placa_pieza_extra", ["placa_sku", "pieza_sku"]);
  const productoSet = await loadKeys("prod_producto", ["sku"]);
  const recetaSet   = await loadKeys("prod_receta", ["producto_sku", "pieza_sku"]);
  const componenteSet = await loadKeys("prod_componente", ["padre_sku", "hijo_sku"]);

  const upsert = async (
    tabla: string, row: Record<string, unknown>, onConflict: string, key: string,
    set: Set<string>, fila: string,
  ) => {
    const { error } = await admin.from(tabla).upsert(row, { onConflict });
    if (error) { reject(fila, error.message); return; }
    bump(tabla, !set.has(key));
    set.add(key);
  };

  // ── 4. HOJA "INSUMOS" → prod_pieza (SKU PADRE) + prod_componente (BOM) ─
  // Cada fila padre (col0) define una pieza; las filas COMPUESTO + sus
  // continuaciones (col4=SKU HIJO, col3=CANTIDAD) arman el árbol recursivo.
  {
    const rows = sheetRows("INSUMOS");
    if (rows.length === 0) reject("INSUMOS", "Pestaña no encontrada");
    let padreActual = "";
    for (let i = 1; i < rows.length; i++) {
      const rawSku = cell(rows[i], 0);
      const nombre = cell(rows[i], 1);
      if (rawSku) {
        padreActual = fixSku(rawSku, nombre); // normalización #1/#8 (duplicados Yori/Hikari)
        await upsert("prod_pieza", { sku: padreActual, nombre: nombre || null },
          "sku", padreActual, piezaSet, `INSUMOS:${i + 1}`);
      }
      // BOM: hijo del padre vigente (Brief Lógica 2 §4.2). Nota: las refs de
      // KIT Yori/Hikari a TOR005/006/007 dependen de la corrección 0.2 #8.
      const hijoRaw = cell(rows[i], 4);
      if (hijoRaw && padreActual) {
        const hijo = fixSku(hijoRaw, "");
        const cant = toIntOrNull(cell(rows[i], 3)) ?? 1;
        await upsert("prod_componente", { padre_sku: padreActual, hijo_sku: hijo, cantidad: cant },
          "padre_sku,hijo_sku", `${padreActual}|${hijo}`, componenteSet, `INSUMOS(BOM):${i + 1}`);
      }
    }
  }

  // ── 5. HOJA "SKU DE PLACAS DE CORTE CNC" (header fila 2) ─────────────
  {
    const rows = sheetRows("SKU DE PLACAS DE CORTE CNC");
    if (rows.length === 0) reject("SKU DE PLACAS DE CORTE CNC", "Pestaña no encontrada");

    // 5a. Sección DERECHA (cols 6=SKU,7=NOMBRE) → prod_pieza (TAPs).
    for (let i = 3; i < rows.length; i++) {
      const sku = cell(rows[i], 6);
      if (!sku) continue;
      await upsert("prod_pieza", { sku, nombre: cell(rows[i], 7) || null },
        "sku", sku, piezaSet, `PLACAS(der):${i + 1}`);
    }

    // 5b. Sección IZQUIERDA (cols 0-4) → prod_placa (+ extras). Agrupar por placa.
    type Placa = { sku: string; nombre: string; material: string | null; rendimiento: number | null; hijos: { sku: string; rend: number | null; fila: number }[] };
    const placas: Placa[] = [];
    for (let i = 3; i < rows.length; i++) {
      const padre = cell(rows[i], 0);
      const hijo = cell(rows[i], 4);
      const rend = toIntOrNull(cell(rows[i], 3));
      if (padre) {
        placas.push({ sku: padre, nombre: cell(rows[i], 1) || "", material: cell(rows[i], 2) || null, rendimiento: rend, hijos: hijo ? [{ sku: hijo, rend, fila: i + 1 }] : [] });
      } else if (hijo && placas.length > 0) {
        placas[placas.length - 1].hijos.push({ sku: hijo, rend, fila: i + 1 }); // continuación: más SKU HIJO
      }
    }
    for (const p of placas) {
      const primero = p.hijos[0];
      // Validar que el primer hijo (pieza_sku) exista como pieza
      if (primero && !piezaSet.has(primero.sku)) {
        reject(`PLACAS(izq):${primero.fila}`, `pieza_sku "${primero.sku}" no existe en prod_pieza`);
        continue;
      }
      await upsert("prod_placa", {
        sku: p.sku, nombre: p.nombre || null, material: p.material,
        rendimiento: p.rendimiento, pieza_sku: primero?.sku ?? null,
        combinada: p.hijos.length > 1,
      }, "sku", p.sku, placaSet, `PLACAS(izq):${p.sku}`);
      // Extras (hijos 2..n) → prod_placa_pieza_extra
      for (const h of p.hijos.slice(1)) {
        if (!piezaSet.has(h.sku)) { reject(`PLACAS(izq):${h.fila}`, `pieza_sku "${h.sku}" no existe en prod_pieza`); continue; }
        const key = `${p.sku}|${h.sku}`;
        await upsert("prod_placa_pieza_extra", { placa_sku: p.sku, pieza_sku: h.sku, rendimiento: h.rend },
          "placa_sku,pieza_sku", key, placaExtraSet, `PLACAS(izq):${h.fila}`);
      }
    }
  }

  // ── 6. HOJA "SKU DE PRODUCTOS" → prod_producto (header fila 1) ───────
  {
    const rows = sheetRows("SKU DE PRODUCTOS");
    if (rows.length === 0) reject("SKU DE PRODUCTOS", "Pestaña no encontrada");
    for (let i = 2; i < rows.length; i++) {
      const sku = cell(rows[i], 0);
      if (!sku) continue;
      await upsert("prod_producto", {
        sku, nombre: cell(rows[i], 1) || null, color: cell(rows[i], 2) || null,
        tipo: "simple", patas_tipo: null, patas_cant: 0, activo: true,
        // "Caja" → kit_embalaje (preserva el dato sin contradecir el mapeo)
        kit_embalaje: cell(rows[i], 3) ? { caja: cell(rows[i], 3) } : {},
      }, "sku", sku, productoSet, `SKU DE PRODUCTOS:${i + 1}`);
    }
  }

  // ── 7. HOJA "sku x producto" → prod_receta (header fila 2) ───────────
  {
    const rows = sheetRows("sku x producto");
    if (rows.length === 0) reject("sku x producto", "Pestaña no encontrada");
    let prodActual = "";
    for (let i = 3; i < rows.length; i++) {
      const skuCell = cell(rows[i], 0);
      if (skuCell) prodActual = skuCell;          // nuevo producto
      if (!prodActual) continue;
      const comp = cell(rows[i], 4).toUpperCase();
      if (!comp) continue;
      const cant = toIntOrNull(cell(rows[i], 3)) ?? 1;
      // BOM completo: producto → CUALQUIER complemento (Brief Lógica 2 §4.2).
      await upsert("prod_componente", { padre_sku: prodActual, hijo_sku: comp, cantidad: cant },
        "padre_sku,hijo_sku", `${prodActual}|${comp}`, componenteSet, `sku x producto(BOM):${i + 1}`);
      // Receta (capa simple existente): solo TAP/KIT/CAJ que existan como pieza.
      if (!/^(TAP|KIT|CAJ)/.test(comp)) continue;
      if (!piezaSet.has(comp)) continue;
      const key = `${prodActual}|${comp}`;
      await upsert("prod_receta", { producto_sku: prodActual, pieza_sku: comp, cantidad: cant },
        "producto_sku,pieza_sku", key, recetaSet, `sku x producto:${i + 1}`);
    }
  }

  return json(result);
});
