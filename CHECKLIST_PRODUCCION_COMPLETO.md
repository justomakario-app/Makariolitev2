# Macario v2 — Módulo Producción en Línea · Checklist Maestro COMPLETO

> Plan de integración exhaustivo de los dos briefs (Lógica 2 + Producción en Línea v2.0).
> **Todo es aditivo** — nada de lo existente se toca. Una fase por vez, validando antes de avanzar.
> Este documento NO resume: incluye cada automatismo, trigger, cálculo, validación,
> estado, campo y micro-detalle de ambos briefs.

---

## Leyenda

- `[x]` Hecho y verificado en producción
- `[~]` En curso / parcial
- `[ ]` Pendiente
- 🔒 Bloqueante de lo que sigue
- ⚙️ **Automático** — corre solo (trigger / cálculo / cascada), sin intervención manual
- 📊 Solo lectura (vista — no guarda datos, los calcula)
- 🔴 Realtime (se actualiza en vivo sin recargar)
- ⚠️ Requiere decisión de negocio antes de construir
- 🔍 Validación obligatoria del sistema

---

# FASE 0 — CIMIENTOS Y DATOS MAESTROS

## 0.1 Backend base — tablas prod_* (migration 0071)

### Datos maestros (Capa 0)
- [x] `prod_pieza` — sku PK, nombre, created_at *(catálogo de tapas/TAP)*
- [x] `prod_placa` — sku PK, nombre, material, rendimiento (int >0), pieza_sku FK, combinada bool
- [x] `prod_placa_pieza_extra` — placa_sku, pieza_sku, rendimiento, PK(placa,pieza) *(2ª pieza de placas COM)*
- [x] `prod_producto` — sku PK, nombre, color, tipo(simple|combinado), patas_tipo, patas_cant, kit_embalaje jsonb, activo
- [x] `prod_receta` — producto_sku, pieza_sku, cantidad, PK(producto,pieza)
- [x] `prod_insumo` — sku PK, nombre, categoria, sector, stock_actual, stock_minimo, unidad, updated_at

### Operación diaria (Capas 2-4)
- [x] `prod_jornada` — id, fecha UNIQUE, estado(abierta|cerrada), abierta_por, abierta_at, cerrada_at
- [x] `prod_corte` — id, jornada_id, placa_sku, hojas, desperdicio, cargado_por, created_at, editable_hasta(+24h)
- [x] `prod_melamina` — id, jornada_id, pieza_sku, terminadas, fallas, cargado_por, editable_hasta(+24h)
- [x] `prod_pino` — id, jornada_id, tamano(chica|grande), terminadas, masilladas, cargado_por, editable_hasta(+24h)
- [x] `prod_embalaje` — id, jornada_id, producto_sku, unidades, canal, cargado_por *(sin editable_hasta)*

### Stock por eslabón (cada sector descuenta SOLO el propio)
- [x] `prod_stock_pieza` — pieza_sku PK, disponible, updated_at *(crudo de CNC → entrada Melamina)*
- [x] `prod_stock_melamina` — pieza_sku PK, disponible, updated_at *(terminado Melamina → entrada Embalaje)*
- [x] `prod_stock_patas` — tamano PK, disponible, masilladas, updated_at *(Pino → entrada Embalaje)*
- [x] `prod_stock_terminado` — producto_sku PK, disponible, updated_at *(Embalaje → cubre la venta)*

### Soporte
- [x] `prod_solicitud` — id, jornada_id, sector, items jsonb, estado, solicitado_por, aprobado_por
- [x] `prod_mantenimiento` — id, sector, tipo, urgencia, maquina, descripcion, estado, reportado_por, aprobado_por
- [x] `prod_remito` — id, proveedor, nro_remito, fecha, items jsonb, cargado_por
- [x] `prod_alerta` — id, insumo_sku, nivel(critico|bajo), stock_actual, stock_minimo, vista bool
- [x] `prod_auditoria` — id, tabla, registro_id, sector, campo, valor_anterior, valor_nuevo, motivo, modificado_por
- [x] `prod_pedido_estado` — tabla puente, referencia `orders` por id SIN tocar la tabla original

### Vistas de cálculo (📊 derivadas — no guardan datos)
- [x] 📊 `prod_v_cortes_dia` — JOIN corte+placa → generadas = hojas×rendimiento, totales = generadas−desperdicio
- [x] 📊 `prod_v_demanda_tap` — explota receta sobre pedidos pendientes → demanda en TAP
- [x] 📊 `prod_v_armables` — min sobre receta de floor(stock/cant) + floor(patas/patas_cant) → cuello de botella
- [x] 📊 `prod_v_prioridad_melamina` — demanda − stock propio melamina, muestra crudo de CNC
- [x] 📊 `prod_v_resumen_dia` — espejo vivo de pedidos por producto (demanda neta vía carrier_state)

### Automatismos de Fase 0 (⚙️ triggers)
- [x] ⚙️ Trigger `updated_at` en prod_insumo + los 4 prod_stock_*
- [x] ⚙️ Trigger alerta de stock bajo: si stock_actual < stock_minimo → INSERT prod_alerta (crítico si <50% del mínimo, bajo si <mínimo)
- [x] ⚙️ Trigger de auditoría: si modifica encargado/owner/admin → INSERT prod_auditoria (1 fila por campo cambiado, lee motivo de GUC de sesión)
- [x] Aislamiento total verificado — 0 cambios a tablas existentes

## 0.2 Corrección de datos del Excel (Brief 1 · sección 12) — 🔒 ANTES DE CARGAR NADA
> Si se cargan los datos sin corregir esto, la explosión da números equivocados y todo lo que viene después sale mal.
> **Decisión (2026-06-12):** las correcciones mecánicas van en una **capa de normalización en `import-skus`** (mapa declarativo `SKU_FIXES`, versionado en el repo, **sin tocar el .xlsx de Seba**). Las que necesitan dato/decisión de Seba quedan pendientes y explícitas. Recon hecho fila por fila contra el Excel real.
- [x] 🔒 SKUs duplicados TOR005/006/007 (rectangular **Y** Yori/Hikari, confirmado filas 43-49 de INSUMOS) → la capa reasigna las variantes Yori/Hikari a **TOR009 (Yori), TOR010 (Hikari), TOR011 (Hikari x2)**; las rectangulares/set conservan TOR005/006/007. Validado en memoria: 0 colisiones, 50 piezas distintas.
- [x] 🔒 Cantidades guardadas como texto → el parser ya las castea a int (`toIntOrNull`) en todo lo que carga (rendimiento, cantidad de receta)
- [x] Corrección puntual: tornillos del Hikari → la pieza "Hikari x2" ahora existe única (TOR011). El re-cableado de KIT007 al sub-ensamble es Fase 5 (el árbol BOM todavía no se carga)
- [~] 🔒 Filo no modelado como consumo → insumo por metro (rollo 50m). **Datos de Seba (2026-06-13, confirmado = filo/perímetro de tapa):** filo en cm por modelo: redonda 30→110 · 40→130 · 50→160 · gota chica→140 · gota grande→180 · boomerang→210 · mesa xl→225 · rectangular→190 · hikari→140 · yori→240. **Falta:** SKU del filo + mapeo modelo→MAD. → Fase 5.0/6
- [~] 🔒 Varilla → material de corte (optimizador lineal). **Datos de Seba:** viene fraccionada en barras de **1 m**. **Hikari** 45 cm/pata → 2 patas por varilla → 4 patas = **2 varillas** (10 cm merma c/u). **Yori** 85 cm/pata → 1 pata por varilla → 4 patas = **4 varillas** (15 cm merma c/u). **Falta:** ¿qué varilla usa cada modelo (VAR001 14 mm / VAR002 25 mm)? → Fase 5b
- [~] 🔒 Patas: pieza de corte (las corta Pino, **no se compran**). **Datos de Seba:** `patas_cant` = **3 por mesa**, **4 en la rectangular**; hikari/yori usan 4 (pero de **varilla**, no Pino). **Falta:** ¿qué mesas usan PAT001 chica vs PAT002 grande? → Fase 5.0
- [~] Tapatornillos color AGU006/007/008. **Datos de Seba:** se usan **solo en hikari y yori, 12 unidades c/u**; hoy se vende **solo en blanco** (los SKU de color quedan definidos pero inactivos). **Falta:** SKU del tapatornillo blanco en uso.
- [ ] ⚠️ Caja del Hikari (MAD401 → Caja N°2): **Seba aún no respondió** — sigue pendiente.

## 0.3 Importación del Excel maestro (Edge Function)
- [x] Edge Function `import-skus` escrita (Deno + SheetJS)
  - [x] 🔍 Auth gate: valida rol owner/admin vía JWT → profiles.role (si no, 401/403)
  - [x] Lee .xlsx del filesystem local (`./sku para sistema.xlsx`)
  - [x] Mapeo pestaña "INSUMOS" → prod_pieza (PAT/SOP/sets, BOM compuesto multi-fila)
  - [x] Mapeo "SKU DE PLACAS DE CORTE CNC" → prod_placa (sección izq) + prod_pieza (sección der, TAPs)
  - [x] ⚙️ Placas combinadas: si >1 SKU HIJO → inserta extras en prod_placa_pieza_extra
  - [x] Mapeo "sku x producto" → prod_receta (multi-fila; solo complementos TAP/KIT/CAJ que existan como pieza)
  - [x] Mapeo "SKU DE PRODUCTOS" → prod_producto (tipo='simple' default, patas null/0)
  - [x] material = DETALLE en placas
  - [x] kit_embalaje = {caja: "N°X"}
  - [x] ⚙️ Upsert por SKU (ON CONFLICT DO UPDATE) — nunca duplica
  - [x] 🔍 Rechazo por fila: si viola FK/CHECK → rechaza esa fila, reporta {fila, motivo}, continúa
  - [x] Orden de FK respetado: piezas → placas → productos → recetas
  - [x] Respuesta: {insertados, actualizados, rechazados:[{fila,motivo}], por_tabla}
- [ ] 🔒 Ejecutar la función y poblar el catálogo
- [ ] 🔍 Verificar que todos los SKUs entraron correctos (revisar rechazados)

---

# FASE 1 — ROLES Y ACCESOS

- [x] Roles de producción en `profiles.role`: cnc, melamina, pino, embalaje, encargado, owner, admin
  - *(Adaptación: el brief pedía app_metadata; el sistema ya usa profiles.role — se respetó lo existente, sin tocar el flujo de login)*
- [x] RLS en las 21 tablas por rol:
  - [x] Coordinador (cnc/melamina/pino/embalaje): INSERT/SELECT en su tabla, UPDATE solo dentro de editable_hasta (24h)
  - [x] Encargado/owner/admin: SELECT + UPDATE en todas, ⚙️ todo UPDATE genera auditoría automática
  - [x] owner/admin: INSERT en tablas maestras
  - [x] prod_solicitud: coordinador INSERT+UPDATE propio; owner/admin aprueban *(ajuste post-Sebas)*
  - [x] prod_embalaje: coordinador embalaje puede INSERT+UPDATE+DELETE sin límite 24h *(ajuste post-Sebas, migration 0072)*
- [x] 🔒 Guard en frontend: usuario sin rol de producción ve la vista actual (vacía) sin cambios — el tab "Línea productiva" cae al `ProximamentePlaceholder` genérico para roles sin sector *(produccion-hub.jsx)*
- [x] Guard que decide qué pantalla de sector se muestra según profiles.role — router `LineaProductivaGuard` + `SECTOR_THEME` (cnc/melamina/pino/embalaje/encargado/owner-admin) con la paleta oficial; placeholders por sector listos para llenar en Fase 3. Espejo web + mobile, cache-buster `?v=2`

---

# FASE 2 — MOTOR DE CARGA POR SECTOR (RPCs)

## 2.1 Jornada
- [x] `prod_rpc_abrir_jornada` — solo owner/admin/encargado; 🔍 error si ya hay jornada abierta hoy
- [x] `prod_rpc_cerrar_jornada` — 🔍 valida abierta; devuelve resumen COUNT por sector
- [x] `prod_rpc_get_jornada_hoy` — todos los roles producción; devuelve jornada de hoy o null

## 2.2 CNC ⚙️
- [x] `prod_rpc_registrar_corte` — rol cnc/encargado/owner/admin; 🔍 valida jornada abierta
  - [x] ⚙️ Calcula piezas generadas = hojas × rendimiento(placa) − desperdicio
  - [x] ⚙️ UPSERT prod_stock_pieza: disponible += piezas generadas
- [x] `prod_rpc_editar_corte` — cnc si editable_hasta>now, o encargado/owner/admin siempre
  - [x] ⚙️ Recalcula delta de stock y ajusta prod_stock_pieza
  - [x] ⚙️ Si encargado/owner/admin → auditoría

## 2.3 Melamina ⚙️
- [x] `prod_rpc_registrar_melamina` — rol melamina/encargado/owner/admin; 🔍 valida jornada abierta
  - [x] 🔍 Valida stock_pieza ≥ (terminadas + fallas)
  - [x] ⚙️ UPDATE prod_stock_pieza: disponible −= (terminadas + fallas)
  - [x] ⚙️ UPSERT prod_stock_melamina: disponible += terminadas (solo terminadas, no fallas)
- [x] `prod_rpc_editar_melamina` — recalcula deltas en stock_pieza y stock_melamina

## 2.4 Pino ⚙️
- [x] `prod_rpc_registrar_pino` — rol pino/encargado/owner/admin; 🔍 valida jornada abierta
  - [x] ⚙️ UPSERT prod_stock_patas: disponible += terminadas, masilladas += masilladas del registro
- [x] `prod_rpc_editar_pino` — recalcula deltas en stock_patas

## 2.5 Embalaje ⚙️ (el más complejo — convergen las 2 líneas)
- [x] `prod_rpc_registrar_embalaje` — rol embalaje/encargado/owner/admin; 🔍 valida jornada abierta
  - [x] ⚙️ Lee prod_receta → calcula piezas necesarias (unidades × cantidad_receta)
  - [x] ⚙️ Lee prod_producto → calcula patas necesarias (unidades × patas_cant)
  - [x] 🔍 Valida stock suficiente en stock_melamina para cada pieza de la receta
  - [x] 🔍 Valida stock suficiente en stock_patas (según patas_tipo)
  - [x] ⚙️ UPDATE stock_melamina: −= piezas consumidas
  - [x] ⚙️ UPDATE stock_patas: −= patas consumidas
  - [x] ⚙️ UPSERT stock_terminado: += unidades
  - [x] ⚙️ Si tiene order_id → INSERT prod_pedido_estado (estado='listo_despacho')
- [x] `prod_rpc_editar_embalaje` — solo encargado/owner/admin; recalcula todos los stocks + auditoría

## 2.6 Solicitudes y mantenimiento
- [x] `prod_rpc_crear_solicitud` — roles producción → estado='pendiente'
- [x] `prod_rpc_gestionar_solicitud` — owner/admin/encargado → aprobada_coord / recepcionada_admin
- [x] `prod_rpc_reportar_mantenimiento` — roles producción
- [x] `prod_rpc_gestionar_mantenimiento` — owner/admin
- [x] `prod_rpc_get_stock` — snapshot de los 4 stocks

## 2.7 Smoke validado
- [x] Cadena end-to-end: corte 10h×50=500 → melamina 8+1 (pieza 491, mel 8) → pino chica 12/6 → embalaje 2u → armables=1 → cierre. Rollback, 0 datos.
- [ ] ⚠️ Acreditar pieza secundaria en placas combinadas (prod_placa_pieza_extra) — hoy acredita solo la primaria; diferido

---

# FASE 3 — FRONTEND POR SECTOR (tab "Línea productiva")

> Mobile-first ~390px, dark mode, color por sector. Construir CNC primero (valida patrón), replicar el resto.
> **Dónde vive:** `web/components/produccion-hub.jsx` + espejo `mobile/`. El hub tiene 4 tabs; hoy 2 son stub `Próximamente`:
> - **"Línea productiva"** → ES esta FASE 3 (frontend por sector). Hoy renderiza `ProximamentePlaceholder`.
> - **"De fábrica"** → ⚠️ stub sin definir. Pendiente: decidir con el negocio QUÉ va adentro (¿vista consolidada de lo fabricado/despachado? ¿pedidos de fábrica?) antes de construir. Anotado en CABOS ABIERTOS.

## 3.0 Esqueleto común
- [x] 🔒 Topbar: pill del sector (color + indicador 🔴 "en vivo"), reloj, nombre sector, estado de jornada *(CNC ✅)*
- [x] Navegación inferior fija 4 ítems (Inicio · Scan · Solicitud · Mant.) con color del sector en activo *(CNC ✅)*
- [x] Badge numérico en nav (Inicio) cuando hay prioridades pendientes — CNC/Melamina/Embalaje
- [x] Banners de stock/prioridad reutilizables (color por origen) — implementados por sector
- [x] ⚙️ Vista previa en vivo: cada carga muestra qué genera y a quién alimenta antes de confirmar
- [x] Mensajes de confirmación al enviar *(toast)*
- [x] 🔒 Guard de rol que decide qué sector renderiza *(Fase 1, produccion-hub)*
- [x] Áreas táctiles grandes, botones de cantidad amplios
- [x] 🎨 Tokens dark + colores de sector alineados al **Brief Producción §15** (paleta exacta: bg #0C0C0E, superficie #1A1A1D, éxito #00D68F, alerta #FFB020, error #FF4060; CNC #2563EB · Melamina #534AB7 · Embalaje #993C1D · Pino #0F6E56). Totales netos en verde Éxito.
- [x] ✏️ **Edición de la carga propia dentro de 24h desde el frontend** (regla §17.5) — `LpEditModal` genérico; las filas "del día" dentro de la ventana muestran "✎ editar" y llaman `editar_corte/melamina/pino`. *(Embalaje: la corrección la hace el encargado, por diseño del 0073.)*
- [x] 📷 Scan por cámara (QR) — `LpQrScan` reusa `window.QrScanner` (lectura única) en CNC/Melamina/Embalaje; matchea el SKU y selecciona. Pino es a granel (sin QR). En web, si no hay lib, degrada con aviso.

## 3.1 CNC — azul #2563EB (4 tabs)
### Tab Inicio
- [x] 🔴📊 Resumen del día: espejo de pedidos por producto (lee `prod_v_resumen_dia`, best-effort: si RLS lo bloquea, se oculta) — sin separar canal, sin prioridades
- [x] Tabla Cortes del día: Placa | Hojas | Generadas | Netas *(lee prod_corte + prod_placa, join cliente)*
- [x] Al pie: total de piezas netas que van a Melamina
### Tab Scan
- [x] Cámara escanea QR del SKU de placa → selecciona la placa (`LpQrScan` + `window.QrScanner`)
- [x] Alternativa manual: selección agrupada (blancas / negras / mármol / combinadas)
- [x] Campos: hojas cortadas + desperdicios
- [x] ⚙️ Vista previa en vivo: piezas generadas (hojas×rend − desp), total neto para Melamina
- [x] Botón "Agregar al reporte" → `prod_rpc_registrar_corte` → refresca Cortes del día
### Tab Solicitud (→ aprueba coordinador → administración) ✅ `prod_rpc_crear_solicitud`
- [x] Fresas: Compresión (doble cara) · Filo horario (cara superior) + cantidad (stepper)
- [x] Esponja: limpieza de guías + cantidad
- [x] Lubricantes: Aceite · Grasa · WD-40 + cantidad
- [x] Refrigerante: Agua destilada + cantidad
- [x] Maquinaria/Otros: texto libre
### Tab Mantenimiento (→ aprueba coordinador → director) ✅ `prod_rpc_reportar_mantenimiento`
- [x] Tipo: Mecánico · Eléctrico · Software/CNC · Temperatura · Ruido/vibración · Preventivo
- [x] Urgencia: Alta/Media/Baja
- [x] Máquina afectada + descripción libre

## 3.2 Melamina — violeta #534AB7 (4 tabs) — trabaja por TAP individual ✅ `melamina-sector.jsx`
### Tab Inicio
- [x] 🔴 Banner "Piezas crudas · de CNC" (azul): stock vivo por TAP (`prod_rpc_get_stock.stock_pieza`), "Esperando CNC" si vacío
- [x] 🔴📊 Banner "Prioridad del día · por TAP" (violeta): pieza, falta, crudo CNC (`prod_v_prioridad_melamina`)
- [x] ⚙️ Si crudo alcanza → violeta; si no → "esperando CNC" en ámbar
- [x] ⚙️ Solo muestra lo que falta (filtra `falta > 0`)
- [x] Tabla Piezas terminadas: Pieza | Terminadas | Fallas | Netas + total para Embalaje
### Tab Scan
- [x] QR de pieza (TAP) → selecciona la pieza · carga manual ✅
- [x] Al elegir pieza, muestra crudo disponible de CNC
- [x] Campos: terminadas + fallas/roturas
- [x] 🔍 Valida que no exceda stock crudo (cliente + RPC)
- [x] ⚙️ Al confirmar: `prod_rpc_registrar_melamina` descuenta crudo CNC, suma netas a Embalaje
- [ ] Nota: 4 sub-procesos internos (Con filo→Desbaste→Terminación→Refilado) — solo se registra el resultado final *(diseño: 1 registro, ok)*
### Tab Solicitud ✅ (genérica `LpSolicitud`)
- [x] Filo 7 colores: Blanco · Negro · Teka Ártico · Kiri · Paraíso · Lino Chiaro · Seda Giorno
- [x] Herramientas/consumibles: Tiza · Espátula · Pistola de calor · Lijas · Mecha · Fibrón negro
- [x] Moldes: molde/detalle
### Tab Mantenimiento ✅ (genérica `LpMant`)
- [x] Tipos: Enchapadora · Pistola de calor · Eléctrico · Molde · Ruido/vibración · Preventivo + urgencia + descripción

## 3.3 Pino — verde #0F6E56 (4 tabs) — 2 tamaños, solo resultado final ✅ `pino-sector.jsx`
### Tab Inicio
- [ ] 🔴📊 Banner "Prioridad del día · patas" — diferido (no hay vista de prioridad de patas; se muestran los 2 contadores de stock)
- [x] Stock de patas terminadas: 2 contadores grandes (Chicas / Grandes) — `stock_patas.disponible`
- [x] Tarjeta ámbar "Patas masilladas · pendientes" (`stock_patas.masilladas`, total)
- [x] Tabla Producidas hoy: Tipo | Terminadas | Masilladas + total terminadas → Embalaje
### Tab Scan (carga manual, sin QR — son a granel)
- [x] Paso 1: tamaño chica/grande
- [x] Paso 2: estado terminada/masillada
- [x] Paso 3: cantidad (tecleado grande)
- [x] ⚙️ `prod_rpc_registrar_pino`: terminadas → stock Embalaje; masilladas → contador pendientes
### Tab Solicitud ✅ (genérica `LpSolicitud`)
- [x] Madera/varillas: Listón 2×1 · 2×2 · Varilla 25mm · 14mm
- [x] Lijas: velcro · tambor · banda
- [x] Masilla/terminación: Masilla · Enduido
- [x] Clavos: 25 · 30 · 40 · 50mm
- [x] Eléctrico/herrajes: Cable blanco/negro · Portalámpara blanco/negro · Rosca · Tuercas · Base 3D · Mecha
- [x] Herramientas: Amoladora · Atornilladora · Clavadora
- [x] Otro: texto libre
### Tab Mantenimiento ✅ (genérica `LpMant`)
- [x] Máquinas: Ingletadora · Cepilladora · Caladora · Lijadora de tambor · Lijadora de banda · Compresor · Atornilladora · Amoladora + urgencia + descripción

## 3.4 Embalaje — coral #993C1D (3 tabs, SIN Mantenimiento) — por producto MAD ✅ `embalaje-sector.jsx`
### Tab Inicio
- [x] 🔴📊 Banner "Prioridad · productos a embalar" (coral): falta (`prod_v_resumen_dia.pendiente`) + armables ahora *(sin separar canal — la vista agrega por producto)*
- [x] ⚙️ Si no hay armables → "esperando piezas / patas" en ámbar
- [x] 🔴 Stock "Piezas · de Melamina" (violeta) por TAP (`stock_melamina`)
- [x] 🔴 Stock "Patas · de Pino" (verde) (`stock_patas`)
- [x] Tabla "Embalados hoy": Producto | Canal | Embalados + total listos para despacho
### Tab Scan (armar producto)
- [x] QR del producto (MAD) → selecciona el producto · selección manual ✅
- [x] 🔍⚙️ VERIFICACIÓN DE COMPONENTES: checklist ✓/✗ por tapa (receta) + patas + kit (con stock have/need)
- [x] ⚙️ Armables automático (cuello de botella) desde `prod_v_armables`
- [x] Selector de cantidad a armar (stepper, tope = armables)
- [x] ⚙️ Al confirmar: `prod_rpc_registrar_embalaje` descuenta piezas + patas, marca "listo para despacho" (+ `prod_pedido_estado` si hay order_id)
- [x] NO registra fallas
### Tab Solicitud ✅ (genérica `LpSolicitud`)
- [x] Kit: Cajas · Film burbuja · Tornillos · Soportes · Bolsas
- [x] Otros: Cinta · Etiquetas/stickers · Fleje/precinto · Esquineros de cartón · Marcador/fibrón

---

# FASE 4 — ENCADENAMIENTO ENTRE SECTORES (⚙️ automático + 🔴 Realtime)

> 2 líneas que convergen en Embalaje. Al cerrar el día cada sector empuja datos netos al siguiente.

## 4.1 Triggers de encadenamiento ⚙️
> El encadenamiento NO vive en triggers separados: ocurre **dentro de cada RPC `registrar_*`** (Fase 2), que descuenta el stock propio y acredita el del siguiente eslabón en la misma transacción. Funcionalmente equivalente y validado en el smoke end-to-end de la Fase 2.
- [x] ⚙️ CNC → Melamina: `prod_rpc_registrar_corte` ⚙️ UPSERT prod_stock_pieza += piezas netas
- [x] ⚙️ Melamina → Embalaje: `prod_rpc_registrar_melamina` ⚙️ UPSERT prod_stock_melamina += terminadas (netas de fallas)
- [x] ⚙️ Pino → Embalaje: `prod_rpc_registrar_pino` ⚙️ UPSERT prod_stock_patas += terminadas por tamaño
- [x] ⚙️ Embalaje → sistema pedidos: `prod_rpc_registrar_embalaje` ⚙️ INSERT prod_pedido_estado='listo_despacho' (si hay order_id)
- [x] ⚙️ Dependencias como estados: las pantallas muestran "esperando CNC / piezas / patas" cuando el stock del eslabón previo es 0 (banners ámbar por sector)
- [x] CNC y Pino trabajan en paralelo desde el arranque (no comparten stock; convergen recién en Embalaje)

## 4.2 Realtime (🔴 sin polling) — **migration 0077 + suscripciones frontend**
> Habilitado vía `supabase_realtime` (0077, las 11 tablas operativas `prod_*`) + helper `LP_DATA.subscribe(tables, onChange)` (canal por pantalla, debounce 250ms, baja en el cleanup del effect). El refetch es **silencioso** (no muestra el loader). RLS filtra server-side: cada rol solo recibe lo que puede leer.
- [x] 🔴 Melamina escucha prod_stock_pieza (ve crudo que dejó CNC) + prod_melamina + prod_jornada
- [x] 🔴 Embalaje escucha prod_stock_melamina + prod_stock_patas + prod_embalaje + prod_jornada
- [x] 🔴 CNC escucha prod_corte + prod_jornada · Pino escucha prod_stock_patas + prod_pino + prod_jornada
- [x] 🔴 Encargado escucha los 4 sectores + 4 stocks + prod_alerta + prod_mantenimiento + prod_jornada (centro de control en vivo)
- [ ] 🔴 Director escucha prod_mantenimiento (estado recibido_director) → **Fase 8** (el panel del director aún no existe)
- [~] 🔴 Todos los sectores escuchan cambios en pedidos (resumen del día) — hoy el resumen se re-fetchea ante cualquier cambio `prod_*`; escuchar `orders`/`carrier_state` directo (tablas existentes) requiere revisar su RLS para los roles de sector → **refinamiento diferido**

---

# FASE 5 — MOTOR DE EXPLOSIÓN Y OPTIMIZACIÓN (**Brief Lógica 2** · secciones 4-7) ⚠️

> Lo más sofisticado y **el grueso del Brief Lógica 2**. El cálculo que convierte ventas en demanda de piezas/materiales, y los 2 optimizadores de corte. Hoy NO existe: las pantallas usan vistas simples (`prod_v_resumen_dia`, `prod_v_armables`) como primera aproximación; este motor las enriquece sin romperlas.

## 5.0 Enriquecer el catálogo (Brief Lógica 2 · §4.1, §8.1) — 🔒 prerequisito del motor
- [ ] 🔒 Atributos nuevos de SKU: **Naturaleza** (fabricado/reventa/corte/insumo), **vendible** (bool), **unidad de compra**, **contenido de compra**, **largo**. Hoy `prod_pieza`/`prod_producto` no los tienen → ampliar schema (aditivo).
- [ ] 🔒 **Cargar el árbol de despiece recursivo desde el Excel:** la hoja `INSUMOS` ya trae la estructura `TIPO PRODUCTO / CANTIDAD / SKU HIJO` (COMPUESTO→hijos), pero `import-skus` hoy **solo carga SKU+nombre** a `prod_pieza`. Falta una tabla `prod_componente (padre_sku, hijo_sku, cantidad)` y extender `import-skus` para poblarla.

## 5.1 Árbol de despiece recursivo (BOM) — **Fase 5a (migration 0074)**
- [x] 🔒 Estructura recursiva padre→hijo con cantidad, a cualquier profundidad → tabla **`prod_componente`** (+ RLS) · `import-skus` la puebla desde INSUMOS + "sku x producto"
- [x] ⚙️ Motor de explosión: ventas pendientes → baja por el árbol multiplicando → **`prod_v_explosion`** (recursiva, guarda de profundidad <20). Smoke validado (MAD×5 → TAP 5, KIT 5, TOR 20, PAT 30).
- [x] ⚙️ Suma demanda de cada SKU a través de TODAS las ventas pendientes (GROUP BY sku)
- [~] ⚙️ Clasifica por naturaleza (corte / insumo / producto) — derivada por prefijo + es_hoja en las vistas; atributos formales de SKU (Naturaleza/vendible/unidad compra) = **§5.0 pendiente**
- [ ] ⚙️ Se recalcula al abrir/recalcular jornada o cuando entran ventas nuevas (hoy es vista en vivo; el "foto de jornada" se decide en Fase 4)
- [x] El corte va aparte del despiece — `prod_v_demanda_corte` (TAP+patas) separado de `prod_v_materia_prima` (insumos a comprar)
- [ ] ⚠️ **Refs de KIT Yori/Hikari a TOR005/006/007** dependen de la corrección 0.2 #8 (Seba) para que la explosión dé exacto

## 5.2 Las dos salidas de la explosión
- [~] 📊 Producto final: cola de producción por modelo *(hoy `prod_v_resumen_dia`; por canal = refinamiento)*
- [x] 📊 Materia prima: rollup de insumos vs stock → qué falta → **`prod_v_materia_prima`** (0074)
- [x] ⚙️ Las piezas de corte (tapas + patas) se desvían a `prod_v_demanda_corte`, no se tratan como compra

## 5.3 Optimizador de placas (CNC)
- [ ] Rendimiento fijo por placa (ej. placa blanca rinde 18 redondas de 50)
- [ ] ⚙️ Lógica de combos: placa COM rinde 2 medidas en un corte (ej. 8 de 40 + 15 de 50)
- [ ] ⚙️ Algoritmo: agrupa tapas que comparten combo, prueba combinaciones (cuántos combos + cuántas placas simples), elige menos placas y a igualdad menos merma
- [ ] Encuentra el óptimo real (escala diaria chica)
- [ ] ⚙️ Produce plan de placas de la jornada

## 5.4 Optimizador lineal (Pino — cutting stock)
- [ ] Material en múltiples largos: varilla 1m; listón 1.8 / 2.1 / 2.4 / 2.7 / 3m
- [ ] ⚙️ Mezcla de medidas en una misma pieza (chicas 43cm + grandes 45cm combinadas)
- [ ] Material se compra y corta entero (lo que sobra es merma)
- [ ] ⚙️ Algoritmo: por cada largo calcula todas las formas de cortarlo, elige la combinación que cubre la demanda con menor largo total (minimiza merma)
- [ ] ⚙️ Produce plan de listones/varillas con su patrón
- [ ] ⚙️ Al confirmar el corte, el material se descuenta del stock

## 5.5 Las vistas/consultas que el sistema necesita (📊)
- [~] 📊 Cola de producción (producto final) — `prod_v_resumen_dia` (por canal = refinamiento)
- [x] 📊 Demanda explotada completa (todos los niveles del árbol) — **`prod_v_explosion`**
- [x] 📊 Demanda de piezas de corte (tapas + patas) — **`prod_v_demanda_corte`**
- [x] 📊 Materia prima a reponer (insumos vs stock) — **`prod_v_materia_prima`**
- [ ] 📊 Compras (materia prima convertida a unidades de compra) → **Fase 6** (unidad de compra)
- [ ] 📊 Orden por sector (demanda repartida en colas de cada sector) → derivable de la explosión (pendiente)

---

# FASE 6 — STOCK, MATERIA PRIMA Y COMPRAS (Brief 1 · sección 8)

## 6.1 Unidad de compra ≠ unidad de consumo
- [ ] Cada SKU guarda unidad de compra + cuántas unidades de consumo trae
- [ ] ⚙️ Conversión: filo metros→rollos (50m), listón unidad→palet (600-700), tornillos→cajas
- [ ] ⚙️ Redondeo para arriba (no se compra fraccionado): 120m de filo = 3 rollos

## 6.2 Flujo de stock
- [ ] Ingreso: encargado carga mercadería como materia prima → ⚙️ suma stock + registra movimiento de entrada
- [ ] ⚙️ Consumo: al producir/cortar, descuenta insumos + registra cada salida
- [ ] ⚙️ Reposición: compara necesidad de jornada vs stock → calcula faltante
- [ ] 📊 Faltante convertido a unidades de compra = lista de compras
- [ ] ⚙️ Trazabilidad: cada entrada/salida con su motivo (producción, consumo, compra, corte, ajuste)

## 6.3 Pantalla de ingreso de materia prima
- [ ] Pantalla "Producción → Ingreso de materia prima"

---

# FASE 7 — PANEL DEL ENCARGADO — slate #2E4057 (4 tabs) ✅ `encargado-panel.jsx`

> El encargado NO carga producción: es el centro de control que ve todo en vivo. Ruteado `encargado/owner/admin → EncargadoPanel`.

## Tab Inicio (estado general)
- [x] 🔴 KPIs (4 tarjetas): Producido hoy (4 sectores) · Listos para despacho (`stock_terminado`) · Falta despachar (de N productos) · Alertas activas
- [~] 🔴 Avance de pedidos del día — muestra "Pendiente por producto" (`prod_v_resumen_dia`); el desglose **por canal + horario** falta (la vista agrega sin canal) → refinamiento
- [x] 🔴 Cadena productiva en vivo: 2 líneas (L1 CNC→Melamina→Terminado, L2 Pino→Embalaje) con el stock actual de cada nodo
- [x] 🔴 Alertas activas: bajo mínimo ordenadas por criticidad (`prod_alerta`)

## Tab Sectores (detalle de cada uno)
- [x] Tarjeta por sector: estado (En curso/Cerrado) + hora última carga *(nombre del coordinador: pendiente — no se carga el perfil)*
- [x] Mini-métricas (CNC: Hojas/Piezas/Desperdicio · Melamina: Terminadas/Fallas · Pino: Chicas/Grandes/Masilladas · Embalaje: Embalados)
- [x] 🔍⚙️ Tocar cualquier carga → `LpEditModal` con **AUDITORÍA OBLIGATORIA** (motivo requerido) → `editar_*`; el trigger registra usuario/fecha/valor ant/nuevo

## Tab Stock
- [~] Botón ＋ Cargar remito — UI presente; el alta + suma de stock se habilita con **Fase 6** (no hay RPC de remito ni insumos cargados)
- [x] 🔴 Bajo mínimo: insumos críticos/bajos con barra de nivel (vacío hasta cargar insumos)
- [x] Stock general: nivel actual vs mínimo (estado vacío honesto hasta Fase 6)
- [ ] Últimos remitos cargados → **Fase 6**

## Tab Avisos
- [x] 🔴 Notificaciones en vivo: alertas stock crítico/bajo (`prod_alerta`)
- [~] 🔴 Jornadas cerradas por sector — hoy muestra el estado global de la jornada (no hay cierre por-sector individual en el modelo)
- [x] Aviso informativo de mantenimiento aprobado/derivado al director (`prod_mantenimiento`)
- [x] Recordatorio del ruteo al pie

## Capacidades transversales
- [x] ⚙️ Editar con registro: corrige cualquier carga de los 4 sectores, motivo obligatorio, queda auditado
- [~] Cargar remitos (encargado + administración) → **Fase 6**
- [x] NO gestiona solicitudes (van a admin) ni recibe el mantenimiento final (va al director) — solo informativo

---

# FASE 8 — FLUJOS DE APROBACIÓN

## 8.1 Solicitud de insumos
- [ ] Coordinador carga la solicitud (estado: pendiente)
- [ ] Coordinador aprueba (estado: aprobada_coord)
- [ ] ⚙️ ADMINISTRACIÓN recepciona y gestiona compra (estado: recepcionada_admin)
- [ ] NO aparece en el panel del encargado

## 8.2 Reporte de mantenimiento
- [ ] Coordinador reporta el problema (estado: pendiente)
- [ ] Coordinador aprueba (estado: aprobado_coord)
- [ ] ⚙️ DIRECTOR recibe en SU panel (estado: recibido_director)
- [ ] NO va al panel del encargado

## 8.3 Qué ve el encargado
- [ ] Solo notificación informativa de que fueron derivadas (no las gestiona)

---

# FASE 9 — HISTÓRICO, KPIs Y DASHBOARD DEL DIRECTOR (Capa 6)

- [ ] Reportes por período: día / semana / mes
- [ ] Exportación a Excel / PDF
- [ ] Dashboard del director con analítica histórica
- [ ] Comparativas por período
- [ ] ⚙️ Recepción de reportes de mantenimiento aprobados
- [ ] Producción por SKU/sector/jornada

---

# CABOS ABIERTOS (definir con el negocio) ⚠️

- [~] ⚠️ Filo: cuántos metros lleva cada modelo — **respondido por Seba (2026-06-13):** cm por modelo (ver 0.2). Se compra por rollo de 50 m. Falta SKU de filo + mapeo modelo→MAD.
- [ ] ⚠️ Melamina: ¿solo termina tapas de CNC o fabrica algún componente propio (soportes)?
- [ ] ⚠️ Palet de listones: cantidad real varía 600-700, cargar en cada ingreso (no fijar)
- [~] ⚠️ prod_producto: tipo (simple/combinado) y patas no vienen en el Excel — **patas_cant respondido por Seba (2026-06-13):** 3 por mesa, 4 rectangular; hikari/yori 4 (de varilla). Falta el split chica/grande por modelo + el tipo simple/combinado.

---

# REGLAS DE ORO (no-negociables — aplican a TODAS las fases)

1. No romper lo existente. Todo en tablas prod_*. Ninguna migración toca ventas.
2. El SKU es la única fuente de verdad (único e inmutable).
3. ⚙️ La lógica vive en el backend. El frontend nunca calcula piezas, armables, prioridad ni stock: solo muestra y captura.
4. 🔴 El resumen del día es espejo vivo (vista + Realtime).
5. Edición del coordinador limitada a 24h; después solo encargado/director.
6. ⚙️ Todo cambio de encargado/director se audita (usuario, fecha, valor anterior/nuevo, motivo).
7. Carga por hojas, no por piezas (el sistema deriva con el rendimiento).
8. Convergencia en Embalaje (las 2 líneas terminan ahí).
9. ⚙️ Stock siempre consistente: producción descuenta, remitos suman, mínimos disparan alertas.
10. Respetar branding (paleta oficial de marca).
11. ⚙️ Prioridad por cascada (pull): cada sector descuenta SOLO su propio stock. No hay empuje ni stock objetivo.
12. 🔍 Embalaje verifica los 3 componentes (piezas + patas + kit) antes de armar; no registra fallas.
13. Pino distingue terminadas (van a Embalaje) de masilladas (pendientes, contadas aparte).
14. Ruteo de aprobaciones: insumos → administración; mantenimiento → director. El encargado no gestiona ninguno.

---

# ESTADO GLOBAL

| Fase | Estado | Detalle |
|------|--------|---------|
| 0 — Cimientos + datos maestros | `[~]` | Backend ✅ · Excel pendiente de correr · 🔒 correcciones de datos pendientes |
| 1 — Roles y accesos | `[x]` | Roles ✅ · RLS ✅ · guards frontend (router por sector) ✅ |
| 2 — Motor de carga (RPCs) | `[x]` | 16 RPCs + cadena de stock + smoke ✅ |
| 3 — Frontend por sector | `[x]` | **4 sectores de operario completos** (CNC · Melamina · Pino · Embalaje) + edición 24h + badges + QR cámara + tokens §15 |
| 4 — Encadenamiento + Realtime | `[x]` | Encadenamiento ✅ (vive en las RPCs `registrar_*`, Fase 2) · Realtime ✅ (0077 publica 11 tablas `prod_*` + `LP_DATA.subscribe`; las 5 pantallas + encargado en vivo). Director (mantenimiento) → Fase 8 · `orders`/`carrier_state` directo = refinamiento |
| 5 — Explosión + optimizadores | `[~]` | **5a ✅** BOM recursivo (`prod_componente`) + explosión (`prod_v_explosion`) + corte/materia prima (0074, smoke ok, import-skus extendido) · **5b ⏳** 2 optimizadores de corte (combos / cutting-stock) + atributos SKU §5.0 + pantalla Optimización |
| 6 — Stock y compras | `[ ]` | — |
| 7 — Panel del encargado | `[~]` | Inicio (KPIs + cadena en vivo + alertas) ✅ · Sectores (detalle + edición auditada) ✅ · Stock/remitos = pendiente Fase 6 · avance por canal = refinamiento |
| 8 — Flujos de aprobación | `[ ]` | — |
| 9 — Histórico y director | `[ ]` | — |

> **Backend del esqueleto: sólido y aislado. Cero impacto en producción.**
> **Bloqueante crítico antes de poblar datos: las correcciones del Excel (Fase 0.2).**

---

# APÉNDICE — ÁREAS DE LA APP EN DESARROLLO / VACÍAS

> Inventario vivo de TODA la app (no solo Producción): secciones que hoy renderizan
> `Próximamente` / placeholder y todavía no tienen lógica. Se va achicando a medida
> que construimos. Verificado contra el código el 2026-06-12.
> `[x]` = ya construida · `[ ]` = falta · ⚠️ = falta definir qué va adentro.

## Dentro de Producción (foco actual)
- [ ] **Hub Producción → tab "Línea productiva"** — frontend por sector (= toda la FASE 3). Hoy stub.
- [ ] ⚠️ **Hub Producción → tab "De fábrica"** — stub sin definir alcance. Decidir contenido con el negocio.

## Otras áreas (módulo Gestión)
- [ ] **Marketing — falta construirla COMPLETA.** 2 tabs vacías: `Calendario de actividades`, `Reportes`. (`web/components/marketing.jsx`, solo owner.)
- [ ] **Ventas — faltan 3 de 9 tabs:** `Facturación`, `Ventas ML`, `Ventas tienda`. (Las otras 6 ✅: Alta clientes, Cta cte, Presupuestos, Remitos, Clientes mayoristas, Base de productos.)
- [ ] **Finanzas — falta 1 tab:** `Plan de cuentas`. (Cash Flow / Egresos / Cheques ✅.)
- [ ] **Sistema (Config) — `Backup y exportación`** próximamente (hoy se hace desde Supabase Studio).

## Ya construidas (no requieren trabajo — referencia)
- [x] Administración (Proveedores · Clientes · Cuentas Corrientes)
- [x] Recursos Humanos (Empleados · Recibos · Hs extras · Reportes salariales)
- [x] Dashboard · Stock · Registrar producción · Histórico · Catálogo · Equipo · Notificaciones · Mi Perfil

> Nota: este apéndice cataloga lo pendiente a nivel app. El plan de construcción
> detallado de Producción son las FASES 0–9 de arriba. Marketing / Ventas (tabs
> faltantes) / Finanzas → se planificarán en su propio momento, fuera de este sprint.
