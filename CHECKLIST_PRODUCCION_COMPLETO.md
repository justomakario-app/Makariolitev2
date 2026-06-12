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
- [ ] 🔒 Filo no modelado como consumo → agregar como insumo por metro — **falta dato de Seba (metros por modelo) · Fase 5/6**
- [ ] 🔒 Varilla no modelada → material de corte — **Fase 5 (optimizador lineal Pino)**
- [ ] 🔒 Patas de los sets: insumo comprado pero las corta Pino → pasar a pieza de corte — **falta `patas_cant` por producto (no está en el Excel) · Fase 3/5**
- [ ] Tapatornillos de color: AGU006/007/008 existen pero **huérfanos** (Yori/Hikari son solo Blanco) — **¿qué productos negros los usan? dato de Seba**
- [ ] ⚠️ Corrección puntual: caja del Hikari → hoy MAD401 → Caja N°2 (consistente en ambas hojas) — **¿es correcto? confirmar con Seba**

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
- [ ] Badge numérico en nav cuando hay cargas pendientes
- [ ] Banners de stock/prioridad reutilizables (color por origen: azul CNC, violeta Melamina, coral Embalaje, verde Pino)
- [x] ⚙️ Vista previa en vivo: cada carga muestra qué genera y a quién alimenta antes de confirmar *(Scan CNC ✅)*
- [x] Mensajes de confirmación al enviar *(toast)*
- [x] 🔒 Guard de rol que decide qué sector renderiza *(Fase 1, produccion-hub)*
- [x] Áreas táctiles grandes, botones de cantidad amplios

## 3.1 CNC — azul #2563EB (4 tabs)
### Tab Inicio
- [x] 🔴📊 Resumen del día: espejo de pedidos por producto (lee `prod_v_resumen_dia`, best-effort: si RLS lo bloquea, se oculta) — sin separar canal, sin prioridades
- [x] Tabla Cortes del día: Placa | Hojas | Generadas | Netas *(lee prod_corte + prod_placa, join cliente)*
- [x] Al pie: total de piezas netas que van a Melamina
### Tab Scan
- [ ] Cámara escanea QR del SKU de placa (trae nombre, color, rendimiento automático) *(stub "próximamente"; Increment 2)*
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
- [ ] QR de pieza (TAP) — stub "próximamente" · carga manual ✅
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

## 3.3 Pino — verde #0F6E56 (4 tabs) — 2 tamaños, solo resultado final
### Tab Inicio
- [ ] 🔴📊 Banner "Prioridad del día · patas" (verde): por tamaño (chicas/grandes), falta = demanda − stock propio + stock actual
- [ ] Stock de patas terminadas: 2 contadores grandes (Chicas / Grandes)
- [ ] Tarjeta ámbar separada "Patas masilladas · pendientes" (reparadas, requieren otro proceso antes de servir)
- [ ] Tabla Producidas hoy: Tipo de pata | Terminadas | Masilladas + total terminadas → Embalaje
### Tab Scan (carga manual, sin QR — son a granel)
- [ ] Paso 1: tamaño chica/grande
- [ ] Paso 2: estado terminada/masillada
- [ ] Paso 3: cantidad (botones grandes o tecleado)
- [ ] ⚙️ Terminadas → stock para Embalaje; masilladas → contador pendientes
### Tab Solicitud
- [ ] Madera/varillas: Listón 2×1 · 2×2 · Varilla 25mm · 14mm
- [ ] Lijas: velcro · tambor · banda
- [ ] Masilla/terminación: Masilla · Enduido
- [ ] Clavos: 25 · 30 · 40 · 50mm
- [ ] Eléctrico/herrajes: Cable blanco/negro · Portalámpara blanco/negro · Rosca · Tuercas · Base 3D · Mecha
- [ ] Herramientas: Amoladora · Atornilladora · Clavadora
- [ ] Otro: texto libre + cantidad
### Tab Mantenimiento
- [ ] Máquinas: Ingletadora · Cepilladora · Caladora · Lijadora de tambor · Lijadora de banda · Compresor · Atornilladora · Amoladora + urgencia + descripción

## 3.4 Embalaje — coral #993C1D (3 tabs, SIN Mantenimiento) — por producto MAD
### Tab Inicio
- [ ] 🔴📊 Banner "Prioridad del día · productos a embalar" (coral): ordenados por canal (Colecta→Flex→resto), falta + armables ahora
- [ ] ⚙️ Si faltan piezas/patas → "esperando piezas/patas" en ámbar
- [ ] 🔴 Stock "Piezas terminadas · de Melamina" (violeta) por TAP
- [ ] 🔴 Stock "Patas · de Pino" (verde)
- [ ] Tabla "Embalados hoy · listos para despacho": SKU | Producto | Canal | Embalados + total
### Tab Scan (armar producto)
- [ ] QR del producto (MAD) o selección manual
- [ ] 🔍⚙️ VERIFICACIÓN DE COMPONENTES: checklist ✓/✗ por cada tapa + patas + kit
- [ ] ⚙️ Calcula armables automático (cuello de botella — ej. MAD301 arma 14 porque las patas limitan)
- [ ] Selector de cantidad a armar
- [ ] ⚙️ Al confirmar: descuenta piezas (Melamina) + patas (Pino) + insumos del kit, marca "listo para despacho"
- [ ] NO registra fallas
### Tab Solicitud
- [ ] Kit (checklist): Cajas (varios tamaños) · Film burbuja · Tornillos · Soportes · Bolsas
- [ ] Otros (checklist): Cinta · Etiquetas/stickers · Fleje/precinto · Esquineros de cartón · Marcador/fibrón
- [ ] Otro: texto libre + cantidad

---

# FASE 4 — ENCADENAMIENTO ENTRE SECTORES (⚙️ automático + 🔴 Realtime)

> 2 líneas que convergen en Embalaje. Al cerrar el día cada sector empuja datos netos al siguiente.

## 4.1 Triggers de encadenamiento ⚙️
- [ ] ⚙️ CNC → Melamina: al registrar corte, piezas crudas netas aparecen en stock_pieza automático
- [ ] ⚙️ Melamina → Embalaje: piezas terminadas (con filo + refilado, netas de fallas) a stock_melamina
- [ ] ⚙️ Pino → Embalaje: patas terminadas por tamaño a stock_patas
- [ ] ⚙️ Embalaje → sistema pedidos: unidades terminadas = "listo para despacho" en prod_pedido_estado
- [ ] ⚙️ Dependencias como estados: "esperando tapas y patas" hasta que CNC/Melamina y Pino tengan stock
- [ ] CNC y Pino pueden trabajar en paralelo desde el arranque

## 4.2 Realtime (🔴 sin polling)
- [ ] 🔴 Melamina escucha prod_stock_pieza (ve crudo que dejó CNC)
- [ ] 🔴 Embalaje escucha prod_stock_melamina + prod_stock_patas
- [ ] 🔴 Encargado escucha prod_corte/melamina/embalaje/pino (dashboard 4 sectores)
- [ ] 🔴 Encargado escucha prod_alerta (stock bajo)
- [ ] 🔴 Director escucha prod_mantenimiento (estado recibido_director)
- [ ] 🔴 Todos los sectores escuchan cambios en pedidos (resumen del día se actualiza solo)

---

# FASE 5 — MOTOR DE EXPLOSIÓN Y OPTIMIZACIÓN (Brief 1 · secciones 5 y 7) ⚠️

> Lo más sofisticado. El cálculo que convierte ventas en demanda de piezas, y los 2 optimizadores de corte.

## 5.1 Árbol de despiece recursivo (BOM)
- [ ] 🔒 Estructura recursiva padre→hijo con cantidad, a cualquier profundidad
- [ ] ⚙️ Motor de explosión: toma ventas pendientes → baja por el árbol multiplicando → demanda de cada pieza/material
- [ ] ⚙️ Suma demanda de cada pieza a través de TODAS las ventas pendientes
- [ ] ⚙️ Clasifica por naturaleza: fabricado / reventa / corte / insumo
- [ ] ⚙️ Se recalcula al abrir/recalcular jornada o cuando entran ventas nuevas (no en tiempo real — foto de la jornada)
- [ ] El corte va aparte del despiece (relación inversa: el material rinde piezas, no las contiene)

## 5.2 Las dos salidas de la explosión
- [ ] 📊 Producto final: cola de producción por modelo y canal *(ya existe el primer paso hoy)*
- [ ] 📊 Materia prima: rollup de insumos vs stock → qué falta
- [ ] ⚙️ Las piezas de corte (tapas + patas) se desvían a los optimizadores, no se tratan como compra

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
- [ ] 📊 Cola de producción (producto final por canal)
- [ ] 📊 Demanda explotada completa (todos los niveles del árbol)
- [ ] 📊 Demanda de piezas de corte (tapas + patas)
- [ ] 📊 Materia prima a reponer (insumos vs stock)
- [ ] 📊 Compras (materia prima convertida a unidades de compra)
- [ ] 📊 Orden por sector (demanda repartida en colas de cada sector)

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

# FASE 7 — PANEL DEL ENCARGADO — slate #2E4057 (4 tabs)

> El encargado NO carga producción: es el centro de control que ve todo en vivo.

## Tab Inicio (estado general)
- [ ] 🔴 KPIs (4 tarjetas): Producido hoy (total 4 sectores) · Listos para despacho · Falta despachar (de N pedidos) · Alertas de stock activas
- [ ] 🔴 Avance de pedidos del día: barra global (ej. 47/119) + desglose por canal (Colecta, Flex) con barra y horario de retiro
- [ ] 🔴 Cadena productiva en vivo: 2 líneas (L1 CNC→Melamina→Embalaje, L2 Pino→Embalaje) con cantidades actuales de cada nodo
- [ ] 🔴 Alertas activas: insumos bajo mínimo ordenados por criticidad

## Tab Sectores (detalle de cada uno)
- [ ] Tarjeta por sector: estado (Cerrado/En curso) + nombre coordinador + hora cierre/última carga
- [ ] Mini-métricas (CNC: Piezas/Placas/Desperdicio; Pino: Chicas/Grandes/Masilladas; etc.)
- [ ] 🔍⚙️ Botón ✎ Editar → modal con AUDITORÍA OBLIGATORIA (campo + motivo; registra usuario, fecha, hora, valor anterior y nuevo)

## Tab Stock
- [ ] Botón ＋ Cargar remito → modal (proveedor, N° remito, insumo, cantidad) → ⚙️ suma al stock
- [ ] 🔴 Bajo mínimo: insumos críticos/bajos con barra de nivel y mínimo
- [ ] Stock general: materia prima e insumos, nivel actual vs mínimo
- [ ] Últimos remitos cargados

## Tab Avisos
- [ ] 🔴 Notificaciones en vivo: alertas stock crítico/bajo
- [ ] 🔴 Jornadas cerradas por sector (con lo que pasó al siguiente)
- [ ] Aviso informativo de mantenimiento aprobado y derivado al director
- [ ] Recordatorio del ruteo al pie

## Capacidades transversales
- [ ] ⚙️ Editar con registro: modifica cualquier cantidad, cada cambio exige motivo y queda auditado
- [ ] Cargar remitos (encargado + administración)
- [ ] NO gestiona solicitudes de insumos (van a admin) ni recibe mantenimiento final (va al director)

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

- [ ] ⚠️ Filo: cuántos metros lleva cada modelo (se consume por metro, se compra por rollo de 50m)
- [ ] ⚠️ Melamina: ¿solo termina tapas de CNC o fabrica algún componente propio (soportes)?
- [ ] ⚠️ Palet de listones: cantidad real varía 600-700, cargar en cada ingreso (no fijar)
- [ ] ⚠️ prod_producto: tipo (simple/combinado) y patas no vienen en el Excel actual → cargar a mano o ampliar Excel

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
| 3 — Frontend por sector | `[~]` | **CNC ✅ · Melamina ✅** (+ data layer compartida `lp-data`/`lp-ui` con Solicitud/Mant genéricas) · faltan Pino · Embalaje · Panel Encargado |
| 4 — Encadenamiento + Realtime | `[ ]` | — |
| 5 — Explosión + optimizadores | `[ ]` | ⚠️ lo más complejo |
| 6 — Stock y compras | `[ ]` | — |
| 7 — Panel del encargado | `[ ]` | — |
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
