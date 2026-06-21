# HANDOFF — Macario Lite (Justo Makario)

> Documento vivo. Se actualiza después de CADA tarea completada, sin excepción.
> Propósito: cualquier developer que tome este proyecto tiene todo el contexto técnico, metodológico y decisional para continuar sin fricción.

---

## Stack & Proyecto

| Item | Detalle |
|---|---|
| **App** | Macario Lite — sistema operativo interno de Justo Makario |
| **Frontend** | HTML + JSX (mock como source of truth visual) — React+TS+Vite en proceso |
| **Backend** | Supabase (Postgres + RLS + RPCs SECURITY DEFINER + Storage) |
| **Supabase project ref** | `ditmbqkvzreekqnkimqv` |
| **Repo** | `justomakario-app` en GitHub |
| **Branch activa** | `master` |
| **Migrations** | `supabase/migrations/` — 64 migrations al inicio de este handoff |

---

## Metodología de trabajo

- **Backend-first con RLS + RPCs:** toda la lógica de negocio vive en Supabase (RPCs `SECURITY DEFINER`). El frontend nunca escribe directo a tablas — siempre vía RPC.
- **Mock HTML como source of truth visual:** el mock `Macario Lite.html` define el diseño aprobado. No se re-porta a React desde cero — se reemplaza solo la data layer.
- **Migrations idempotentes:** cada `.sql` usa `IF NOT EXISTS`, `CREATE OR REPLACE`, `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$` para poder re-ejecutar sin romper.
- **Nombres cosméticos en frontend:** los labels de UI (nombres de canales, botones, etc.) van en el frontend. La BD guarda IDs y datos, no strings de presentación.
- **Frontend ↔ backend en pareja:** cualquier cambio de schema requiere verificar/migrar el frontend correspondiente, y viceversa.

---

## Estructura de la base de datos

### Tablas de configuración (nunca se borran)
| Tabla | Descripción |
|---|---|
| `sku_catalog` | Catálogo maestro de productos (SKU = PK natural, ej. MAD050) |
| `sku_categories` | Categorías: Mesas, Ratonas, Recibidoras, Luz |
| `channels` | Canales de venta: colecta, flex, tiendanube, distribuidor |
| `role_permissions` | Mapping rol → landing + items visibles en sidebar |
| `profiles` | Usuarios del sistema (extiende auth.users) |
| `company_settings` | Configuración de la empresa |

### Tablas operativas (flujo de producción/ventas)
| Tabla | Descripción |
|---|---|
| `orders` | Pedidos individuales por canal + SKU |
| `import_batches` | Lotes de importación de Excel (idempotencia por file_hash SHA-256) |
| `jornadas` | Cierres de jornada (snapshot inmutable) |
| `jornada_audit` | Auditoría de cambios en jornadas |
| `production_logs` | Ledger inmutable de producción (negativo = corrección) |
| `carrier_state` | Estado denormalizado (pedido/producido/faltante/stock) por canal+SKU |
| `free_stock` | Stock central desvinculado de canal |
| `order_edit_log` | Log de ediciones sobre pedidos |
| `qr_scans` | Eventos de escaneo QR en embalaje |
| `notifications` | Notificaciones por usuario |
| `agent_conversations` | Conversaciones del agente IA |

### Módulo Admin / Finanzas (Noe — jefa admin)
| Tabla | Descripción |
|---|---|
| `suppliers` | Proveedores (CUIT, email, teléfono) |
| `expenses` | Egresos/compras con OCR opcional |
| `checks_issued` | Cheques emitidos |
| `checks_received` | Cheques recibidos |
| `cash_flow_manual` | Flujo de caja manual |
| `recibos` | Recibos generados |
| `cierres_periodo` | Cierres contables de período |
| `employees` | Legajo de empleados (CUIL, sueldo, CBU, etc.) |
| `customers_b2b` | Clientes mayoristas/B2B |
| `customers_credit` | Cuenta corriente de clientes |
| `customers_credit_movements` | Movimientos de cuenta corriente |
| `suppliers_credit` | Cuenta corriente de proveedores |
| `suppliers_credit_movements` | Movimientos de cuenta corriente proveedores |
| `admin_audit_log` | Log de auditoría del módulo admin |

---

## Registro de tareas

---

### [2026-06-21] Ventas — fix de 2 bugs del import (auditoría de producción) · 0099

Investigación de bugs (pedido del Jefe). 2 bugs **reproducidos empíricamente** en `rpc_import_batch` (smokes en transacción) y corregidos.

**`0099_fix_import_bugs.sql` (APLICADA + verificada en prod):**
- **BUG 1 — pérdida silenciosa en la cola de revisión:** el marcado `resuelto=true` en `orders_sin_sku` matcheaba solo por `(channel, order_number)` → al resolver UNA línea marcaba como resueltas a las **hermanas no resueltas** de la misma orden → se perdían de la cola. Fix: marcar SOLO la entrada exacta `(channel, order_number, titulo, variante)`, para cualquier fila con título que ya tenga SKU (resuelto u original).
- **BUG 2 — doble conteo cancelada+reprogramada:** al cancelar no se limpiaba `reprogramada_at`, y se podía flaguear una orden ya cancelada → contada en canceladas Y reprogramadas. Fix: al cancelar limpiar el flag reprogramada; `WHERE status <> 'cancelado'` en la rama reprogramada; + **limpieza one-shot** de datos existentes (`UPDATE ... WHERE status='cancelado' AND reprogramada_at IS NOT NULL`).
- **Frontend (defensa extra):** `getReprogramadasForJornada` (web+mobile) excluye `status='cancelado'`.
- **Verificado:** smokes confirman ambos fixes (A resuelto / B sigue en cola; cancelada con flag limpio). Prod: fix1 ✓ fix2 ✓ · 0 canceladas-con-flag-reprog restantes. Cache web data v47 / mobile v46.
- **Verificado OK (sin bug):** cancelar siempre gana sin importar el orden de filas; cancelada con SKU irresoluble → cola, no entra como pendiente. *Faltante (no bug):* la cola `orders_sin_sku` aún no tiene pantalla de revisión (solo contador en el toast).

---

### [2026-06-21] Ventas — estados ML · FASE C: resolución de SKU vacío

**Bug que resuelve:** el parser descartaba en silencio ~28% de filas del Excel de ML (SKU vacío pero con Título+Variante). Decisión del Jefe: opción (a) mapeo Título+Variante→SKU exacto.

**`0098_sku_vacio_resolucion.sql` (APLICADA + verificada en prod):**
- `ml_norm(text)` (lower+trim+colapsa espacios). `ml_sku_map (titulo_norm, variante_norm)→sku` PK, **autoaprendido**. `orders_sin_sku` (cola de revisión, UNIQUE channel/order/titulo/variante, `resuelto` bool). RLS owner/admin/encargado SELECT.
- `rpc_import_batch` (CREATE OR REPLACE): **PASS 1** aprende mapeos de las filas con SKU activo → **PASS 2** resuelve los SKU vacíos por Título+Variante; si no resuelve, inserta en `orders_sin_sku` (no se pierde) + `CONTINUE`; al resolver una que estaba en cola la marca `resuelto`. Devuelve `sku_resueltos_count` + `sin_sku_count`. Todo lo previo (canceladas robustas, reprog, idempotencia) intacto.
- **Smoke:** fila vacía del mismo producto que una con SKU → resuelta a su SKU (pedido normal); desconocida → cola; contadores ok.

**Frontend (web+mobile):**
- `xlsx.js`: parser captura **Título de la publicación** + **Variante**; **deja de descartar** filas sin SKU (solo salta si no hay ni SKU ni título; antes exigía SKU).
- `modals.jsx`: filtro pasa filas con SKU conocido O (sin SKU + título); pasa `titulo`/`variante`; toast muestra "N SKU resueltos por título · M sin SKU (en revisión)".
- `data.js` normalizedItems: incluye `titulo`/`variante`, filtro `(sku || titulo)`.
- Cache: web data v46/xlsx v13/modals v32 · mobile data v45/xlsx v13/modals v32.

**Plan de 3 fases COMPLETO** (A dashboard + B reprogramada + C SKU vacío). **Pendiente acordado:** contabilizar **devoluciones** (logística inversa) para que tampoco generen producción — próximo paso.

---

### [2026-06-21] Ventas — detección ROBUSTA de canceladas (crítico) · 0097

**Por qué:** una cancelada NO detectada entra como `pendiente` → demanda fantasma → rompe el sistema (pedido del Jefe: "las canceladas nunca pasen, busquen todas las maneras"). La detección anterior (`%cancelada%`) se quedaba corta (no agarraba "cancelado" masculino, ni "No despaches" sin "cancelada", ni "anulado").

**`0097_canceladas_deteccion_robusta.sql` (APLICADA + verificada en prod):**
- **`es_venta_cancelada(text)`** (IMMUTABLE): detecta `'%cancel%'` (cancelada/cancelado/cancelación/cancelar) · `'%no despaches%'` (instrucción ML, exacto para NO chocar con "no despachado"=activo) · `'%anulad%'`. + `es_venta_reprogramada(text)` (`'%demorado%'`) por simetría.
- **`estado_ml`** columna nueva en `orders` (texto crudo de ML por trazabilidad — ante un "se coló", se ve qué dijo ML). Se guarda en todos los paths del import.
- `rpc_import_batch` (CREATE OR REPLACE) usa los clasificadores; toda la lógica previa intacta.
- **Smoke (batería + funcional):** "Pedido cancelado"/"anulado"/"No despaches." → cancelada ✓; "Listo para recolección"/"Aún no despachado" → NO cancelada (sin falso positivo) ✓; import de "Pedido cancelado" → status=cancelado, 0 insertadas como pendiente ✓. Verificación prod: columna + RPC usa el clasificador.
- **Forward-looking:** clasifica bien en cada import nuevo; si una se coló antes, al reaparecer queda agarrada. **Devoluciones** (logística inversa) quedan FUERA a propósito (Q3 del spec, decisión separada). Solo backend.

---

### [2026-06-21] Ventas — estados ML · FASE B (backend reprogramada + motivo cancelación)

**`0096_ventas_reprogramada_y_motivo.sql` (APLICADA + verificada en prod):**
- `orders` += `reprogramada_at`, `reprogramada_motivo`, `reprogramada_in_jornada_id`, `cancelacion_motivo` (aditivas, nullable).
- `rpc_import_batch` (CREATE OR REPLACE, preserva TODA la lógica previa) ahora clasifica 3 ramas: cancelada (`%cancelada%`, ya existía) → guarda `cancelacion_motivo` de "Descripción del estado"; **reprogramada (`%demorado%`, NUEVO) → flag** `reprogramada_at`+motivo (texto ML completo)+jornada, la orden **sigue `pendiente`** (no sale de producción); a despachar (resto). Devuelve `reprogramada_count`.
- **Idempotencia preservada:** reprogramada usa `ON CONFLICT DO UPDATE ... WHERE reprogramada_at IS NULL` → reimport = 0 cambios. Smoke (rolled back): reprogramada flag+pendiente, cancelación motivo, reimport 0 nuevos.

**Frontend (web+mobile):**
- `xlsx.js`: parser manda `estado` + `descripcion` ("Descripción del estado"). **El mobile estaba viejo (no mandaba ni `estado`) → puesto a la par.**
- `modals.jsx` + `data.js` (normalizedItems): pasan `descripcion` al RPC.
- `data.js` loadOrders: mapea `reprogramadaAt/Motivo/InJornadaId` + `cancelacionMotivo`. `getCancellationsForJornada` ahora devuelve `motivo` → la sección Canceladas muestra el motivo real; la de Reprogramadas + su contador se prenden con datos reales (Fase A ya tenía la UI lista).
- Cache-busters: web data v45/xlsx v12/modals v31 · mobile data v44/xlsx v12/modals v31.

**Decisión:** `reprogramada` (ML "demorado") ≠ `arrastrado` (carry-over interno) — separados a propósito. Historial embebido (jsonb) = refinamiento futuro; el flag+motivo+jornada ya sirve para el informe mensual.

**Pendiente:** Fase C (resolución de SKU vacío con tabla mapeo Título+Variante — el parser hoy descarta ~28% de filas sin SKU).

---

### [2026-06-20] Ventas — estados ML (A despachar / Canceladas / Reprogramadas) · FASE A (frontend)

**Contexto:** spec `especificacion_tecnica_v2.md` + mock `dash_principal_vs_secundario_estados.html`. Plan por fases aprobado por el Jefe. **Fase A = solo frontend, riesgo cero, mismo branding** (no rediseñar; conectar datos existentes). Decisiones cerradas: SKU vacío→tabla mapeo Título+Variante (Fase C); reprogramada→**flag** (no enum nuevo); detección por substring "demorado".

**Qué se hizo (Fase A, sin migración):**
- **`data.js` (web+mobile):** nuevo `getReprogramadasForJornada(jornadaId)` — espeja `getCancellationsForJornada` pero por flag `reprogramadaAt`. Hasta Fase B los orders no traen el flag → devuelve `[]` (contadores en 0, sin romper). `reprogramada` (ML "demorado") ≠ `arrastrado` (carry-over interno).
- **`dashboard.jsx` (web+mobile):** hero ahora muestra **A despachar · Canceladas · Reprogramadas · Producido** (antes Pendientes/Producido). Canceladas/Reprogramadas = suma de unidades de la jornada vía los helpers. Mismo componente `dash-hero-stat`/`m-hero-stat`, acentos `#f87171`/`#fbbf24`.
- **`carrier.jsx` (web+mobile):** 2 secciones nuevas por canal debajo de "Lotes importados" — **Canceladas** (SKU/orden/cant/motivo) y **Reprogramadas** (SKU/orden/cant/fecha), etiqueta "Informativo · acumulable" + botón Exportar (XLSX). Filtradas al canal+jornada. Mismo estilo (`collapsible` web / `m-prod-card` mobile).
- **NO se tocó** lo que funciona: canceladas backend, idempotencia, derivación de canal, la sección "Cancelaciones del día" existente.

**Verificación:** 6 archivos transpilando/parseando OK; web/mobile con su layout propio (divergentes, cambios equivalentes en cada uno); cache-busters bumpeados (web data v44/dash v20/carrier v25 · mobile data v43/dash v10/carrier v10). *Nota:* hoy hay 0 `cancelado` en prod → los contadores muestran 0 con datos reales hasta que entre una cancelación.

**Pendiente (decisiones ya cerradas):** Fase B (backend: detectar "demorado" en `rpc_import_batch` → flag `reprogramada_at` + motivo + historial; mapear `reprogramadaAt` en loadOrders; guardar motivo de cancelación de `Descripción del estado`). Fase C (resolución de SKU vacío con tabla mapeo Título+Variante — hoy el parser descarta ~28% de filas sin SKU).

---

### [2026-06-18] Producción — notificaciones de la cadena de mantenimiento (Fase 8)

**Qué se hizo:** cerrar el cabo "Director escucha prod_mantenimiento (recibido_director)". El panel del director (owner/admin → Panel del Encargado) ya escuchaba `prod_mantenimiento` en vivo, pero **no le llegaba notificación** al escalársele. Se agregó la cadena.

**`0095_prod_mantenimiento_notificaciones.sql` (APLICADA + verificada, aditivo sobre las RPCs existentes):**
- `prod_rpc_reportar_mantenimiento`: al reportar (cualquier sector) → INSERT en `notifications` (tipo `produccion`) a **owner+admin+encargado** (menos el que reporta). Título con urgencia + sector; link `produccion-hub`.
- `prod_rpc_gestionar_mantenimiento`: al pasar a `aprobado_coord` (encargado aprueba) → notifica a **owner/admin (director)** que hay un mantenimiento para recibir.
- Smoke (rolled back): reporte → 9 notificaciones (3 owner + 5 admin + 1 encargado); aprobar coord → +8 al director. Verificación prod: ambas RPCs contienen el INSERT.
- Sin frontend: usa la campanita/Notificaciones existente.

---

### [2026-06-17] Producción — tab "De fábrica" (panorama operativo)

**Qué se hizo:** la tab "De fábrica" del Hub de Producción era un stub sin definir. Los 2 briefs NO la especificaban (lo confirmé), así que el alcance se definió por lógica: **panorama operativo de la fábrica hoy**, que además surfacea las 2 vistas de §5.5 que estaban construidas pero sin pantalla.

**Frontend (`produccion-hub.jsx` web v7→v8 + mobile; componente `DeFabrica`):**
- **KPIs del día:** Listos para despacho (`stock_terminado`), Pendiente de producir (`prod_v_resumen_dia`), Ítems a comprar (`prod_v_compras`), Alertas (`prod_alerta`).
- **Orden por sector:** `prod_v_orden_sector` agrupado por CNC/Melamina/Pino/Embalaje (qué le toca producir hoy a cada uno) con total por sector.
- **Lista de compras:** `prod_v_compras` (necesita/stock/falta, en unidades).
- Read-only, **realtime** (subscribe a prod_corte/melamina/pino/embalaje/stock_terminado/alerta/insumo), tema claro integrado a la plataforma. Reusa `window.LP_DATA` (helpers `ordenSector()`/`compras()` ya existían sin consumidor).
- Verificación: ambos hub transpilando; las vistas ya verificadas en prod (orden_sector cnc 22/melamina 34/pino 2/embalaje 16 · compras 10 ítems). Cache-buster v8.

**Nota:** la tab es web (el mobile rutea `produccion`→`ProduccionPage`, no el hub), pero se mirroreó el componente a mobile por consistencia.

---

### [2026-06-17] MARKETING — Módulo completo (5 sub-áreas, cockpit futurista)

**Qué se hizo:** el módulo de Marketing entero, de cero, en un "command center" oscuro/futurista con los acentos de marca (violeta #7C3AED + azul #2563EB). Pedido del Jefe: manual ahora pero **API-ready**, 4 plataformas (Meta Ads/IG/TikTok/YouTube), moderno/premium.

**Cuenta creada:** `marketing@justomakario.app` / `Makario2026` (rol `marketing`) — ver [[reference-cuentas-produccion]].

**Backend (migraciones 0090-0094, aplicadas + verificadas en prod — 7 tablas, 3 vistas, 14 RPCs):**
- **0090 Ángulos:** `mkt_angulo`, `mkt_video`, `mkt_video_metrica` (snapshots con `fuente` manual/api + `externo_id` → API-ready). Vistas `mkt_v_video_resumen` (ER%, hook rate calculados) y `mkt_v_angulo_resumen` (agregados). `security_invoker` + RLS owner/admin/marketing. RPCs upsert/delete ángulo+video, cargar_metrica.
- **0091 Calendario:** `mkt_evento` (fecha, plataforma, formato, objetivo, **angulo_id**, material/copy/arte/notas, estado pipeline idea→publicado). RPCs upsert/delete.
- **0092 Publicidad:** `mkt_campania` + `mkt_campania_metrica`; vista `mkt_v_campania_resumen` calcula **CPM/CPC/CTR/CPR/ROAS**. RPCs upsert/delete campaña + cargar_metrica.
- **0093 Prioridades:** `mkt_prioridad`; `mkt_rpc_crear_prioridad` inserta + **notifica** (tabla `notifications`, tipo 'sistema') al owner + encargado de marketing. RPCs gestionar/delete.
- **0094 Dashboard:** RPC `mkt_rpc_dashboard` agrega orgánico + pago + ángulos (KPIs + top ángulos/videos).
- Smoke (rolled back): ER%/hook/CPM/CPC/CTR/CPR/ROAS exactos, notificados=3 (owners), dashboard ok.

**Frontend (web+mobile, espejo salvo padding; transpila con babel standalone):**
- **`mkt-data.jsx` (v1, nuevo):** `window.MKT_DATA` — helpers de los 5 módulos.
- **`marketing.jsx` (v2, reescrito):** cockpit oscuro tokenizado `MKT_UI`. Hub con 5 tabs pill (glow). **Dashboard** (KPI hero + top ángulos/videos), **Calendario** (grilla mensual real con chips por estado/plataforma + modal de contenido), **Ángulos** (drill-down ángulo→video→métricas con 3 niveles + modales + mini-chart de evolución), **Publicidad** (campañas + CPM/CPC/CTR/CPR/ROAS + modales), **Prioridades** (tablero 3 columnas + crear/notificar).
- **Acceso:** `data.js` ROLE_NAV del rol `marketing` → landing `marketing` + item `marketing` (web+mobile). app.jsx web ya ruteaba por `canSee('marketing')`; **mobile app.jsx** ahora rutea `marketing` (owner/admin/marketing).
- Verificación: 6 archivos transpilando; dashboard RPC live ok; backend smoke completo.

**Ajustes post-feedback (2026-06-17, marketing.jsx v3):** (1) **full-height** — el cockpit pasó de tarjeta recortada a `min-height:100vh` edge-to-edge (gradiente de fondo cubre toda `.main-content`, se fue la franja blanca). (2) **Dashboard enriquecido** — agenda del calendario (próximos), pipeline de contenido por estado (barras), mix por plataforma (donut conic-gradient), top ángulos/videos, resumen de publicidad + más KPIs (CTR/CPM/CPR en hero). (3) **Publicidad** ahora muestra TODO: hero con 10 KPIs (inversión/impresiones/alcance/clicks/CTR/CPM/resultados/CPR/ingresos/ROAS) y por campaña 13 métricas (+ frecuencia, CPC, conv. rate). (4) **Toggle claro/oscuro solo en Marketing** — paletas `MKT_DARK`/`MKT_LIGHT` (mismos acentos), estado `tema` persistido en localStorage `mkt_tema`, segmented control en el header; todo tokenizado por `U`.

**Pendiente/futuro:** integración real por API (el schema ya lo soporta vía `fuente`/`externo_id`); QA visual en navegador (login marketing@justomakario.app).

---

### [2026-06-14] Producción — Fase 6.2: consumo de insumos al embalar (cierre del loop de stock)

**Qué se hizo:** el descuento automático de insumos al embalar, único pendiente real de Fase 6 (el resto ya estaba o lo resolvió la llamada de Seba: 6.1 conversión a cajas = NO se hace).

**`0089_prod_fase6_consumo_insumos.sql` (APLICADA + verificada):**
- TRIGGER `prod_embalaje_consumo` AFTER INSERT en `prod_embalaje` → función `prod_tg_embalaje_consumo` (SECURITY DEFINER). Explota el BOM del producto (CTE recursiva, guarda lvl<20) a sus **hojas atómicas**, las junta con `prod_insumo` y descuenta `stock_actual -= qty × unidades`.
- **No toca la RPC core** (`prod_rpc_registrar_embalaje`): es aditivo. El join a `prod_insumo` deja afuera tapas/patas (viven en `prod_stock_*`) → sin doble descuento. El trigger `prod_insumo_alerta` existente dispara las alertas solo. Permite stock negativo (déficit honesto).
- **Smoke (rolled back):** embalar 10× MAD061 (SET GOTA) descontó CAJ001 −10, SOP001 −60, TOR001 −40, TOR002 −100 (exacto vs BOM). Patas intactas. Verificación prod: función + trigger existen.
- **Limitación conocida:** descuento solo al INSERT (la edición de unidades no reajusta el consumo — raro, dentro de 24h; se concilia aparte si hace falta).

**Cierre Fase 6:** remito suma (0084) → embalaje descuenta (0089). 6.1 conversión a cajas = no se hace (Seba); schema unidad_compra/contenido_compra en 0086; reposición/faltante via prod_v_materia_prima + prod_v_compras. **Fase 6 cerrada de punta a punta.**

---

### [2026-06-14] Producción — Fase 5.5: vistas Compras + Orden por sector (cierre capa de vistas)

**Qué se hizo:** las 2 vistas que faltaban de §5.5 (las demás ya existían).

**`0088_prod_fase5_vistas_compras_orden_sector.sql` (APLICADA + verificada):**
- **`prod_v_compras`** — lista de compras en **unidades de consumo** (Seba: NO se convierte a cajas/rollos; "qué se necesita y listo"). Es `prod_v_materia_prima` con `falta > 0`. Prod: 10 ítems (TOR002 33.324, TOR001 14.804, SOP001 14.268…). Los números reflejan el BOM ya completo (kits + patas + varilla).
- **`prod_v_orden_sector`** — cola de cada sector hoy, derivada de la explosión (reusa las vistas por sector, sin recalcular): CNC corta tapas · Melamina termina (falta vs su stock) · Pino patas · Embalaje productos finales. Prod: cnc 22 · melamina 34 · pino 2 · embalaje 16.
- Ambas solo lectura, derivadas, GRANT SELECT anon+authenticated (igual que el resto de prod_v_*).

**Frontend — `lp-data.jsx` (web+mobile, v10→v11):** helpers `compras()` y `ordenSector()` para consumir las vistas. *(Todavía ninguna pantalla las muestra — pendiente de decisión: surfacearlas en el panel del Encargado.)*

**Estado:** la capa de vistas de §5.5 queda cerrada. El desglose de la cola por canal es refinamiento, no pendiente.

---

### [2026-06-14] Producción — Fase 5.0: atributos de SKU + fix de KITs (Yori/Hikari) + causa raíz

**Qué se hizo:** los dos puntos pendientes de §5.0 del checklist + un fix de integridad del BOM.

**`0086_prod_fase5_atributos_sku.sql` (APLICADA + verificada):** atributos de SKU del Brief Lógica 2 §4.1/§8.1.
- `prod_pieza` += `naturaleza` (text), `vendible` (bool def false), `unidad_compra` (bool def false), `contenido_compra` (numeric), `largo` (numeric, cm). `prod_producto` += `naturaleza` (def 'fabricado'), `vendible` (def true). Todo aditivo (`ADD COLUMN IF NOT EXISTS`).
- Poblado por derivación de prefijo: **naturaleza** = corte 28 (TAP + PAT001/002), fabricado 12 (PAT003/004/005 + 9 KIT), insumo 35 (SOP/TOR/AGU/CAJ/FIL/VAR). **unidad_compra** = los 35 insumos. **contenido_compra** = 50 para FIL (rollo 50 m). **largo** = 100 para VAR (barra 1 m). Los 26 productos quedan vendible=true. → habilita que el módulo **Ventas B2B** filtre por `vendible`.
- El "árbol de despiece recursivo + tabla prod_componente" (otro ítem §5.0) **ya estaba hecho** (es el motor de Fase 5); esa línea del checklist estaba vieja.

**`0087_prod_fix_kits_yori_hikari.sql` (APLICADA + verificada):** corrige refs de KIT que hacían que la explosión NO diera exacto (cabo 0.2 #8).
- KIT005 (Yori, MAD300): `TOR005` (rectangular) → **`TOR009`** "TORNILLOS DE YORI". KIT006 (Hikari, MAD401): `TOR006` → **`TOR010`** "TORNILOS HIKARI". KIT007 (Hikari x2, sin uso hoy): → `TOR011` + `AGU005`.
- KIT003 (rectangular blanco, MAD201) recupera `TOR005`+`TOR006` (estaba incompleto vs KIT004 negro).
- **Causa raíz:** una pieza fantasma con SKU `'1'` (fila del Excel mal parseada, nombre NULL) se había quedado como "padre" de `TOR005`+`TOR006` — eran justo los del rectangular blanco. Se borró el fantasma (y sus 2 aristas) tras devolverle los tornillos a KIT003.
- **Verificación prod:** 75 piezas (era 76), 0 naturaleza NULL, 0 fantasma, **0 aristas huérfanas** (ningún componente apunta a un SKU inexistente — BOM consistente).

**Nota de decisión diferida:** "recalcula al abrir jornada / foto de jornada" es decisión de diseño de Fase 4 (hoy demanda = vista en vivo, funciona). No bloqueante.

---

### [2026-06-14] Producción — Fase 5: patas + varilla al BOM (cierre del motor) · llamada Seba

**Contexto:** llamada con Seba que resolvió los 3 puntos abiertos. Lo descifrado:
- **Varilla:** solo 25 mm (VAR002) para Yori/Hikari; la de 14 mm (VAR001) es de veladores (fuera del sistema todavía).
- **Tornillos:** NO se convierte a cajas — "trabajamos sobre los tornillos ingresados, no por desglose de cajas; que diga qué se necesita y listo". → La **lista de compras (Fase 6.1) NO se construye**: la vista materia prima (necesita/falta en unidades) + el remito YA es lo pedido. Fase 6 cerrada.
- **KITs:** los productos usan KITs de instalación (KIT001-009 = soportes + tornillos + tapatornillos), ya cargados y explotando bien.

**HALLAZGO (verificado en base):** `prod_v_demanda_corte` saca la demanda de patas de los **componentes PAT del BOM** (`es_hoja AND sku ~~ 'PAT%'`), **NO** del atributo `prod_producto.patas_cant` cargado en 0081. Resultado: casi ningún producto generaba demanda de patas (no estaban en el BOM). El `patas_cant` de 0081 quedaba muerto. **Corrección:** las patas/varilla tienen que vivir como componentes en `prod_componente`.

**Lógica aplicada (regla validada por el único dato dado, SET REDONDA = PAT005): cada SET = 2 mesas; sus patas = suma de las patas de esas 2 mesas (3 c/u).** Estructura PAT ya cargada: PAT001=1 chica, PAT002=1 grande, PAT003=3 chicas, PAT004=3 grandes, PAT005=PAT003+PAT004.

**Backend — `0085_prod_fase5_patas_varilla_bom.sql` (APLICADA en prod 2026-06-14 + verificada):**
- Mesas: redonda 30/50 → PAT004 · redonda 40/boomerang/gota XL → PAT003 · rectangular → PAT002 ×4.
- Sets: SET REDONDA MARMOL → PAT005 (=40+50) · BUMERANG → PAT005 (redonda30 grande + boomerang chica) · SET GOTA/SET XL/DOBLE BOOM → PAT003 ×2 (6 chicas). SET REDONDA (095/096) ya tenía PAT005, no se tocó.
- Yori → VAR002 ×4 (85 cm/pata, 1 pata/barra) · Hikari → VAR002 ×2 (45 cm/pata, 2 patas/barra). Dato de Seba: 4 patas c/u.
- Aditivo, idempotente (`ON CONFLICT (padre_sku,hijo_sku) DO UPDATE`).
- **Verificación prod:** 30 componentes PAT/VAR en BOM · demanda patas chicas (PAT001)=10.560, grandes (PAT002)=8.736 · varilla VAR002=408 barras. Como Yori es 1 pata/barra (forzado) y Hikari 2/barra (óptimo), el conteo de barras YA es óptimo → no hace falta optimizador de varilla aparte.

**Nota:** `patas_cant` (0081) queda como dato informativo; la fuente real del motor son estos componentes. **Producción queda 100% cerrada** salvo veladores (producto futuro, fuera de alcance).

---

### [2026-06-14] Producción — Fase 6 (parcial, no-Seba): ingreso de materia prima

**Qué se hizo:** la base de Stock/compras que no depende de Seba — poblar insumos + cargar remitos que suman stock. (Lo Seba-dependiente queda fuera: lista de compras con conversión a cajas/rollos, optimizador de varilla, patas de SETs.)

**Backend (aplicado en prod 2026-06-14 + verificado):**
- **`0083_prod_fase6_poblar_insumos.sql`** — `prod_insumo` estaba **vacío** → la vista `prod_v_materia_prima` calculaba la necesidad pero sin nombre/unidad y la pestaña Stock no mostraba nada. Se **derivó** desde `prod_pieza` (los SKUs ya existían con nombre): **35 insumos** (Tornillería 11 · Tapatornillos/AGU 8 · Soportes 8 · Cajas 4 · Filo 2 metro · Varilla 2 barra), categoría/sector/unidad por prefijo, stock 0 / mínimo 0. Aditivo, idempotente (`ON CONFLICT DO NOTHING`). NO toca el .xlsx ni a Seba.
- **`0084_prod_fase6_remito_ingreso.sql`** — RPC **`prod_rpc_ingresar_remito(p_payload)`** SECURITY DEFINER, gate owner/admin/encargado. Valida todo-o-nada (SKU∈prod_insumo, cantidad>0), inserta cabecera en `prod_remito` (ya existía) y **suma `prod_insumo.stock_actual`**. NO usa factores de conversión (carga unidad de consumo; la conversión a unidad de compra es Fase 6.1 = Seba). Suma `prod_insumo`+`prod_remito` a la publicación realtime.
- **Verificación prod:** 35 insumos · 6 categorías · RPC existe · realtime=[prod_insumo, prod_remito]. Smoke funcional (rolled back) como encargado: remito 2 ítems → TOR001 +5000, CAJ001 +200, `{items:2, total_unidades:5200}`; error paths (SKU inexistente / sin ítems) OK.

**Frontend (web+mobile, espejo salvo padding; transpila con babel standalone):**
- **`lp-data.jsx` (v9→v10):** `remitos()` (historial, RLS encargado/owner/admin) + `ingresarRemito(p)`.
- **`encargado-panel.jsx` (v8→v9):** el botón **"Cargar remito de mercadería"** (Stock) abre el modal real **`EncRemitoModal`** (proveedor/N°/fecha + selector de insumo agrupado por categoría + cantidad → lista con total → `ingresarRemito` → suma stock + refetch). **"Stock general"** lista los 35 insumos reales (se quitó el copy "se habilita con Fase 6"). Nueva sección **"Últimos remitos"** (historial). Realtime suscribe también `prod_insumo`+`prod_remito` → la carga aparece en vivo.

**Por qué:** la fábrica necesita cargar la mercadería que entra y ver su stock; era el último bloque grande de Producción que no dependía de Seba. Con esto la pestaña Stock del Encargado deja de estar vacía y el motor de materia prima tiene datos reales.

---

### [2026-06-14] Producción — Fase 5b: pantalla "Optimización" (frontend CNC + Encargado)

**Qué se hizo:** la pantalla que consume el RPC `prod_rpc_plan_corte` (0082) para que CNC y Encargado vean el plan de corte óptimo en vivo.

**Cómo:**
- **`lp-data.jsx` (web+mobile, v8→v9):** nuevo helper `planCorte()` → `rpc('prod_rpc_plan_corte')`.
- **`cnc-sector.jsx` (web+mobile, v7→v8):** nueva tab **"Optimizar"** (icono `spark`, entre Inicio y Scan) + componente `CncOptimizacion`. Carga `planCorte()` + `piezas()` (para nombrar las tapas). Muestra 2 KPIs (placas a cortar / merma en piezas), botón **Recalcular**, y una tarjeta por placa: nombre, SKU·material, cantidad grande, badge "Combinada", y chips de qué tapas produce (`nombre tapa → qty`). Combinadas primero (ahorran placas), luego simples. Estados loading/error/sin-demanda honestos. 100% tokenizado (`U.*`), light/premium, integrado a la plataforma.
- **`encargado-panel.jsx` (web+mobile, v7→v8):** nueva tab **"Optimizar"** (entre Sectores y Aprobar) que **reusa** `CncOptimizacion` (global, cnc-sector carga antes) con `U=ENC_UI` (slate) — el componente está 100% tokenizado, re-tematiza solo.

**Por qué:** el RPC ya calculaba el plan, pero CNC no tenía cómo verlo. Ahora el operario abre "Optimizar" y ve exactamente cuántas placas de cada tipo cortar y qué rinde cada una, sin pedir nada a nadie.

**Verificación (antes del push):**
- RPC `prod_rpc_plan_corte` **aplicado en prod** (0082) y smoke funcional como owner: **245 placas · 229 merma · 21 ítems**. Forma del ítem confirmada: `{placa:COM001, material:"PLACA BLANCA", tipo:combinada, cantidad:12, produce:{TAP003:96, TAP005:180}}` → casa 1:1 con el render.
- Los 6 archivos JSX/data modificados **transpilan limpio** con `@babel/standalone@7.29.0` (preset react). Sin sintaxis prohibida (`??`, `<>`, object-spread).
- web/mobile **espejo exacto** salvo padding (verificado con diff).

---

### [2026-06-13] Producción — Fase 5b: Optimizador de placas (CNC)

**Qué se hizo:** el **optimizador de corte de placas** (Brief Lógica 2 §7.2) — calcula el plan de corte que minimiza la cantidad de placas (y a igualdad, la merma) aprovechando las placas combinadas. No depende de Seba (usa el catálogo ya cargado).

**Backend — `0082_prod_fase5b_plan_corte.sql` (APLICADA en prod 2026-06-14 + smoke funcional como owner OK: 245 placas · 229 merma · 21 ítems):**
- RPC **`prod_rpc_plan_corte()`** — solo lectura, gate cnc/encargado/owner/admin. Lee `prod_v_demanda_corte` (demanda de tapas) y devuelve `{ total_placas, total_merma, plan:[{placa, material, tipo:'combinada'|'simple', cantidad, produce:{tap:qty}}] }`.
- **Algoritmo:** las 4 placas COM vinculan un par 40/50 por color (ej. COM001 = TAP003×8 + TAP005×15). Para cada par, **búsqueda exacta** del nº de combos que minimiza (placas, luego merma); residuos + tapas sin combo → placa simple `ceil(demanda/rendimiento)`. Escala diaria chica → la búsqueda 1D es barata.
- **Smoke (rolled back, demanda real):** 245 placas · 229 merma · 21 ítems · 3 combos. Ej. blanca: COM001×12 (96 TAP-40 + 180 TAP-50) + PLB002×2 + PLB003×5 para el residuo. Coherente y óptimo.

**Pendiente:** (1) ~~pantalla "Optimización" en el frontend~~ → **HECHA** (ver entrada 2026-06-14 arriba); (2) optimizador de **varilla** (Fase 5b, cutting-stock lineal) — ese sí necesita la respuesta de Seba (14 vs 25mm hikari/yori).

**Técnico:** NUEVO `0082`. Sin frontend aún. **Pendiente: aplicar 0082** (backend-only).

---

### [2026-06-13] Producción — Fase 5.0 parcial: patas de mesas simples + caja (deducido)

**Qué se hizo:** se **dedujo del catálogo** (receta→tapa→placa) el modelo/tamaño de cada producto, lo que permitió cargar las **patas de las mesas simples** sin preguntarle a Seba, + corregir la caja del Hikari. Análisis que destrabó esto:
- **MAD051/052 "MESA REDONDA" = REDONDA 50** (su receta usa TAP005/006, las tapas de 50).
- Composición de los SETs deducida (SET GOTA = gota grande+chica, SET REDONDA = 40+50, SET XL = 2 gota XL, SET DOBLE BOOM = 2 boomerang, etc.).
- **FIL001/FIL002 (filo) y VAR001/VAR002 (varilla 14/25mm) ya existen** como SKU en el catálogo.

**Backend — `0081_prod_fase5_patas_simples_caja.sql` (escrita + smoke ok, NO aplicada — espera OK):**
- `patas_tipo`/`patas_cant` (las corta Pino; tipo 'chica'/'grande' casa con `prod_stock_patas.tamano`): redonda 30/50→grande×3 · redonda 40/boomerang/gota xl→chica×3 · rectangular→grande×4.
- Caja Hikari (MAD401): N°2 → **N°1**.
- **Smoke (rolled back):** valores verificados; Hikari/Yori/SETs quedan en patas_cant=0 (pendiente Seba).

**Pendiente de Seba (reducido a 2 críticas + 3 de compras):** patas de los SETs (la suma simple no cierra por la contradicción del SET XL), varilla de hikari/yori (14 vs 25mm). Mensaje armado para pedirle todo de una vez.

**Técnico:** NUEVO `0081`; doc HANDOFF + checklist. **Pendiente: aplicar 0081** (backend-only, sin frontend).

---

### [2026-06-13] RRHH — DNI editable (sacar la inmutabilidad)

**Qué se hizo:** los DNI de empleados ya cargados **no se podían corregir** (al pasar de CUIL→DNI en 0076 se arrastró la regla vieja de que el CUIL era inmutable post-alta). El Jefe pidió que se puedan **editar/corregir**. Se quitó esa inmutabilidad en backend y frontend.

**Backend — `0080_rrhh_dni_editable.sql` (escrita + smoke validado, NO aplicada aún — espera OK):**
- `rpc_admin_update_employee`: se eliminó el bloque `dni_immutable`; ahora el `UPDATE` incluye `dni = CASE WHEN payload ? 'dni' THEN … ELSE dni END`. El **índice único** `employees_dni_unique_idx` sigue evitando duplicados (→ `duplicate_dni`) y el CHECK de formato sigue.
- `rpc_admin_bulk_update_employees`: ídem (se quitó el rechazo `dni_immutable`; el bulk ahora puede corregir DNI).
- **Smoke (rolled back, impersonando owner):** editó el DNI de un empleado real `40.914.074` → `99.888.777`, devolvió `updated:true`, y revirtió (prod intacto). ✅

**Frontend — `employee-modal.jsx`:**
- El campo **DNI ya no es readonly en edición** (se sacó `readOnly`, el tooltip y el help "es inmutable"). Valida formato (`normalizeDni`) y unicidad.
- El submit ahora **manda el DNI del form** (antes lo pisaba con `initial.dni` para no disparar `dni_immutable`).
- Se quitó el branch de error `dni_immutable` (ya no aplica). El `duplicate_dni` sigue avisando "Ya existe otro empleado con ese DNI".

**Técnico:** NUEVO `supabase/migrations/0080_rrhh_dni_editable.sql`; `web|mobile/components/admin/employee-modal.jsx` (byte-idéntico, compila OK). Cache-buster employee-modal v5 (ambos HTML). **Pendiente: aplicar 0080 + push** (frontend y backend juntos). *(El bulk-import ya mandaba DNI; con esto deja de rechazarlo.)*

---

### [2026-06-13] Producción — Datos de Seba (2da tanda) + verificación del catálogo

**Qué se hizo:** Seba respondió los 4 puntos pendientes. Se **capturaron en el checklist** (0.2 + cabos abiertos) y se **verificó el catálogo cargado** contra sus respuestas. **No se hizo ningún UPDATE a la BD** (el Jefe rechazó el cambio suelto — las correcciones van por la capa de normalización + re-carga).

**Respuestas de Seba (capturadas):**
- **Caja del Hikari (MAD401): va en Caja N°1** (hoy cargado N°2 — corregir vía normalización).
- **Tapatornillo blanco = AGU001** (AGU002 = color). Los AGU003-008 son compuestos ya cargados OK (AGU003=AGU001×12, AGU005=AGU001×2, etc.). ✅ verificado en `prod_componente`.
- **Patas por modelo:** redonda 30→PAT002 · 40→PAT001 · 50→PAT002 · boomerang→PAT001 · gota xl/chica→PAT001 · gota grande→PAT002 · rectangular→PAT002 · **set xl→PAT001+PAT002**.
- **Varilla:** VAR001 (14 mm) → **veladores** (materia prima). Hikari/Yori → implícito VAR002 (25 mm), no explícito.
- **BOM "cada insumo genera un hijo"** (TOR003=TOR001×4, etc.) → **confirmado cargado** y la explosión lo recorre bien.

**Hallazgo importante (gap a cerrar antes de poblar patas / Fase 5b):** la lista de modelos de Seba **NO mapea 1:1** con los 26 productos del catálogo. Los productos tienen SETs y variantes que Seba no mapeó:
- `MAD051/052` "MESA REDONDA" (sin tamaño) → ¿es redonda 50? (su receta apunta a TAP005, así parece).
- SETs sin pata definida: `SET GOTA`, `SET REDONDA`, `SET REDONDA SIMIL MÁRMOL`, `SET DOBLE BOOM` (un set = varias mesas → patas = suma de sus componentes, a confirmar).
- "gota chica/grande" de la lista de Seba no existen como producto suelto (hay GOTA XL y SET GOTA).

→ Para poblar `patas_tipo`/`patas_cant` y armar el optimizador de varilla (5b) faltan **3 aclaraciones**: (1) patas de los SETs, (2) tamaño de "MESA REDONDA" (MAD051/052), (3) confirmar varilla 25 mm para hikari/yori.

**Técnico:** solo docs (checklist + HANDOFF). Sin código/BD. Catálogo base intacto (cargado el 2026-06-13).

---

### [2026-06-13] Producción — Carga base del catálogo (Fase 0.3)

**Qué se hizo:** se pobló el catálogo de producción desde `sku para sistema.xlsx` (el Excel verificado como correcto: 4 hojas, datos reales). El módulo pasa de "esqueleto vacío" a **usable con datos reales**.

**Cargado (verificado por conteo, coincide exacto con el dry-run):** prod_pieza **76** · prod_placa **29** · prod_placa_pieza_extra **4** · prod_producto **26** · prod_receta **86** · prod_componente (BOM) **137**. **0 rechazos.**

**Cómo (importante para reproducir):** el Edge Function `import-skus` **NO está deployado** (solo `invite_user` y `agent_admin` lo están) y correrlo requería la service_role key o un JWT de owner que no tengo. Se **replicó su lógica fielmente** en un script node (mismo SheetJS, mismos índices de columna, misma normalización `SKU_FIXES` Yori/Hikari→TOR009/010/011, mismas FK):
1. **Dry-run** (read-only) → reportó las 358 filas + 0 rechazos antes de tocar nada.
2. **Apply** vía Management API: `INSERT … ON CONFLICT DO UPDATE` en orden FK-seguro (pieza → producto → placa → placa_extra → receta → componente). Idempotente.
3. **Verificación post-apply:** conteos OK + el motor (`prod_v_resumen_dia` + `prod_v_explosion`) ya produce demanda real contra los pedidos pendientes (ej. explosión TOR002 = 26.150).

**Para re-importar** (si Seba manda un Excel nuevo): deployar `import-skus` con el xlsx bundleado, o re-correr el script replicado. Las correcciones 0.2 ya están en la capa de normalización; los 4 datos de Seba afectan 5b/6, no la carga base.

**Nota:** los números de demanda altos (ej. 1443 pendientes de un producto) reflejan los **pedidos pendientes existentes** en `carrier_state` (dato de ventas, no del catálogo) — a revisar con el negocio si parece inflado, pero el motor explota correcto.

**Técnico:** solo datos (no código/migraciones). Docs: checklist (0.3 + ESTADO GLOBAL Fase 0 → `[x]`) + este HANDOFF. El `sku para sistema.xlsx` NO se commitea (fuente de datos, no código).

---

### [2026-06-13] Producción — Botón Abrir/Cerrar jornada (faltaba el cableado)

**Qué se hizo:** se agregó el control **Abrir / Cerrar jornada de producción** en el **Panel del Encargado** (owner/admin/encargado). Faltaba: las RPCs existían desde Fase 2 (`prod_rpc_abrir_jornada` / `prod_rpc_cerrar_jornada`) pero **nunca se cablearon** al frontend, así que `prod_jornada` quedaba vacía y todas las pantallas mostraban "Sin jornada" — el módulo era inusable.

**Por qué surgió:** el Jefe entró a Producción y vio "Sin jornada" aunque había una jornada de **ventas** abierta (Seba). Aclaración importante del diseño (decisión: mantener la lógica del brief):
- **Jornada de VENTAS** (`jornadas`, Dashboard) y **jornada de PRODUCCIÓN** (`prod_jornada`) son **independientes** por diseño del brief (prod_* aislado, no toca ventas).
- La **demanda** sí fluye de ventas a cada sector (explosión/`prod_v_resumen_dia`) — eso ya andaba, aun con la jornada de producción cerrada. La jornada de producción solo habilita **registrar** lo producido (ledger del turno).

**Cómo:**
- `lp-data.jsx`: +`abrirJornada()` / `cerrarJornada()` (RPCs existentes).
- `encargado-panel.jsx`: botón en el header — "Abrir jornada" (acento) si no hay/está cerrada; "Cerrar jornada" (outline) si está abierta. Al cerrar, el toast muestra el resumen por sector (cortes/melamina/pino/embalaje). Refresca en vivo. Los sectores **no** abren jornada (ya dicen "el encargado la gestiona").
- **Smoke (rolled back, impersonando owner):** abrir→cerrar devuelven `ok:true` + resumen, sin escribir. No se dejó ninguna jornada abierta en prod (el intento de abrir una "para probar" lo bloqueó el clasificador con razón — lo abre el Jefe desde el botón).

**Técnico:** `web|mobile/components/lp-data.jsx` (byte-idéntico) + `encargado-panel.jsx` (difiere solo en padding 32/16). Compilan con Babel 7.29.0. Cache-busters: lp-data v8, encargado v7 (ambos HTML). Sin migraciones. **Para usarlo:** el encargado/owner entra a Producción → Panel del Encargado → "Abrir jornada"; ahí los sectores pueden registrar.

---

### [2026-06-13] Producción — Integración visual a la plataforma (sacar el "teléfono dentro de la app")

**Qué se hizo:** las 5 pantallas de Producción (4 sectores + Panel del Encargado) se veían como un **celular dark flotando** dentro de la plataforma clara (tarjeta 430px centrada + sombra + esquinas de dispositivo + bottom-nav). Se reencuadraron para que se vean **nativas de la plataforma**, en **todas las cuentas** (cada rol entra y ve su área integrada).

**Por qué:** pedido explícito del Jefe — "todo tiene que verse como si fuese de la plataforma, diferentes segmentos, no como un teléfono dentro de la app", y aplica a **cada cuenta de empleado** (cnc, melamina, pino, embalaje) además del dueño.

**Cómo (clave):** las pantallas ya estaban **tokenizadas** (todo el render usa un objeto `U` de colores), así que la integración fue de bajo riesgo y sin reescribir estructura:
- **Paleta `U` dark → clara/plataforma** (tarjetas blancas `#FFFFFF`, texto `#0A0A0A`, bordes sutiles, `ok/warn/danger` alineados a `--green/--amber/--red`). Cada sector conserva **su color como acento** (CNC azul, Melamina violeta, Pino verde, Embalaje rust, Encargado slate).
- **Sin marco de teléfono**: fuera `maxWidth:430` + `margin:auto` + `boxShadow` + `borderRadius` de dispositivo → ocupa el ancho del área de contenido con el padding del hub.
- **Bottom-nav de teléfono → tabs arriba** estilo plataforma (borde inferior + acento del sector en la activa).

**Web + mobile:** ambos integrados (mismo diseño claro). Única divergencia: el **padding** del contenedor (web `0 32px 32px`, mobile `0 16px 24px`) — verificado por diff que es la **única línea distinta** entre cada par web/mobile. Mobile sigue siendo cómodo en celular (full-width, tabs scrolleables).

**Verificación:** los 10 archivos (5 web + 5 mobile) **compilan** con el Babel 7.29.0 del browser; **0 restos** de hex dark o del marco de teléfono; diff web↔mobile = 1 línea (padding) c/u. *(La lógica/datos no se tocó — sigue todo igual, solo el encuadre visual.)*

**Técnico:** `web|mobile/components/{cnc,melamina,pino,embalaje}-sector.jsx` + `encargado-panel.jsx`. Cache-busters: cnc v7, melamina v5, pino v5, embalaje v5, encargado v6 (ambos HTML). Sin migraciones. **Pendiente: verificación visual del Jefe** (no puedo renderizar desde acá).

---

### [2026-06-13] Producción — Fase 9: Histórico y Dashboard del Director

**Qué se hizo:** el **dashboard analítico del director** — una tab **"Histórico"** en el Panel del Encargado, **visible solo para owner/admin** (el director; no hay rol `director`), con KPIs por período, comparativa, tendencia por día, top productos, mantenimientos recibidos y export a Excel.

**Backend — `0079_prod_fase9_director_historico.sql` (escrita + smoke FUNCIONAL validado, NO aplicada — espera OK):**
- RPC **`prod_rpc_director_historico(p_payload {desde, hasta})`** — solo lectura, gate owner/admin, `SECURITY DEFINER`. Agrega por **fecha de jornada**. Devuelve:
  - `kpis`: jornadas, piezas cortadas (netas, con rendimiento de placa), melamina terminada/fallas, patas terminadas, embalado, mantenimientos recibidos.
  - `comparativa`: embalado del período vs el **período anterior de igual longitud** (delta).
  - `por_dia`: serie por día (cortes/melamina/pino/embalaje).
  - `top_productos`: embalaje agrupado por producto (top 15).
  - `mantenimientos`: los `recibido_director` del período (cierra el ciclo con Fase 8).
- REVOKE anon/public + GRANT authenticated. 100% aditivo (no toca nada).
- **Smoke funcional (rolled back):** se creó la RPC en una transacción, se la llamó **impersonando a un owner** (`request.jwt.claims`), devolvió el JSON con la forma correcta (KPIs en 0 con tablas vacías, rango por defecto 30 días 2026-05-15→06-13, comparativa 2026-04-15→05-14 bien calculada) y revirtió. Toda la SQL de agregación corre sin error. Confirmado que no quedó en prod.

**Frontend:**
- **`lp-data.jsx`:** +`directorHistorico({desde, hasta})`.
- **`encargado-panel.jsx`:** tab **"Histórico"** (6ª, **solo si owner/admin** — `canDirector`) con `EncHistorico`: presets (Hoy/7/30/90 días) + rango libre, grilla de KPIs, tarjeta de comparativa (delta %), **mini-barras de embalado por día**, top productos, lista de mantenimientos recibidos, y botón **export a Excel** (`window.XLSX`, ya cargado). El nav suma el ítem solo para el director (ícono `history`).

**Cómo / decisiones:**
- El "director" = **owner** (no existe rol `director`); también lo ve admin (oversight). Vive en el hub de Producción (coherente con la decisión de Fase 8).
- Hoy renderiza casi todo en cero porque el sistema todavía no tiene historia cargada; la estructura se llena sola a medida que se use. No está bloqueado por Seba.
- **PDF** quedó diferido (Excel cubre el export; pdfMake ya está cargado si se quiere sumar). Desglose fino sector×SKU = refinamiento.

**Técnico:** NUEVO `supabase/migrations/0079_prod_fase9_director_historico.sql`; `lp-data.jsx` + `encargado-panel.jsx` (web→mobile byte-idénticos; compilados con Babel 7.29.0 OK). Cache-busters: lp-data v7, encargado-panel v4 (ambos HTML). **Pendiente: OK explícito del Jefe para aplicar 0079 + push.** *(Sin la migración: la tab Histórico muestra error al pedir datos; el resto del panel anda igual.)*

---

### [2026-06-13] Producción — Fase 8: Flujos de aprobación

**Qué se hizo:** se cerró el loop que quedaba colgado — los coordinadores ya cargaban solicitudes de insumos y reportes de mantenimiento, pero **nadie los recibía**. Ahora el **Panel del Encargado** tiene una tab **"Aprobar"** donde se gestiona todo, con acciones según el rol.

**Decisiones del Jefe (vía AskUserQuestion):** (1) los inboxes viven **dentro del hub de Producción** (no en un área nueva); (2) el **encargado** es quien aprueba (el "coordinador" del brief). Además: no existe rol `director` → el **owner** es el director.

**Flujo resultante:**
- **Insumos:** sector carga (pendiente) → **encargado** aprueba (aprobada_coord) → **admin/owner** recepciona (recepcionada_admin).
- **Mantenimiento:** sector reporta (pendiente) → **encargado** aprueba (aprobado_coord) → **owner/admin = director** recibe (recibido_director).

**Backend — `0078_prod_fase8_aprobaciones.sql` (escrita + smoke validado, NO aplicada aún — espera OK):**
- `CREATE OR REPLACE prod_rpc_gestionar_mantenimiento`: antes solo owner/admin; ahora **encargado** puede marcar `aprobado_coord` (y `pendiente`), pero `recibido_director` queda **restringido a owner/admin** (el director). `gestionar_solicitud` ya admitía encargado, no se tocó.
- Publica **`prod_solicitud`** en `supabase_realtime` (idempotente) para que el panel vea las solicitudes nuevas en vivo (Fase 4.2). 100% aditivo.

**Frontend:**
- **`lp-data.jsx`:** +`solicitudes()`, +`gestionarSolicitud()`, +`gestionarMantenimiento()`; `mantenimientos()` ahora trae `descripcion`/`reportado_por`.
- **`encargado-panel.jsx`:** nueva tab **"Aprobar"** (5ª) con `EncAprobaciones` — secciones Solicitudes de insumos + Reportes de mantenimiento; **botones por rol** (encargado: "Aprobar"; admin/owner: "Recepcionar"/"Recibir (director)"); resto ve "Esperando…". Badge en el nav con lo accionable por el rol. El panel toma el rol de `window.useMockData().user.role`. Suscripción Realtime extendida con `prod_solicitud`. El backend igual valida server-side (la UI solo guía).

**Cómo / decisiones:**
- Esto **revisa** el brief original (8.3 decía que el encargado solo veía info y no gestionaba). El Jefe decidió que el encargado aprueba — se documentó en el checklist. La tab Avisos sigue mostrando el mantenimiento derivado como informativo; la tab Aprobar es la accionable.
- Las acciones se muestran/ocultan por rol pero la autorización real está en las RPCs `SECURITY DEFINER` (defensa en profundidad).

**Técnico:** NUEVO `supabase/migrations/0078_prod_fase8_aprobaciones.sql`; `lp-data.jsx` + `encargado-panel.jsx` (web→mobile byte-idénticos, verificado por hash; compilados con Babel 7.29.0 OK). Cache-busters: lp-data v6, encargado-panel v3 (ambos HTML). **Pendiente: OK explícito del Jefe para aplicar 0078 + push.** *(Sin la migración: el encargado no podría aprobar mantenimiento y las solicitudes no llegarían en vivo; el resto del panel anda igual.)*

---

### [2026-06-13] Producción — Datos de Seba para Fase 0.2 / 5 / 6 (captura)

**Qué se hizo:** Seba respondió varios de los cabos abiertos que bloqueaban la Lógica 2 (Fase 5/6). Se **capturaron en el checklist** (0.2 + cabos abiertos), sin construir nada todavía (decisión del Jefe: "capturar y pedir lo que falta" — fiel a "no construir a ciegas").

**Datos recibidos (2026-06-13):**
- **Filo** (confirmado por el Jefe = perímetro de tapa, en cm por modelo): redonda 30→110 · 40→130 · 50→160 · gota chica→140 · gota grande→180 · boomerang→210 · mesa xl→225 · rectangular→190 · hikari→140 · yori→240. Se compra por **rollo de 50 m**.
- **Varilla** (barras de 1 m): **Hikari** 45 cm/pata → 2 patas/varilla → 4 patas = **2 varillas** (10 cm merma c/u). **Yori** 85 cm/pata → 1 pata/varilla → 4 patas = **4 varillas** (15 cm merma c/u). Insumo del optimizador lineal (Fase 5b).
- **Patas** (las corta Pino, no se compran): `patas_cant` = **3 por mesa, 4 en la rectangular**; hikari/yori usan 4 (de varilla).
- **Tapatornillos color** (AGU006/007/008): solo hikari/yori, **12 unidades c/u**; hoy solo se vende **blanco** (los SKU de color quedan inactivos).

**Pendiente de Seba (relayado al Jefe):**
1. Caja del Hikari (MAD401 = Caja N°2, ¿correcto?) — Seba no respondió.
2. ¿Qué varilla usa cada modelo (VAR001 14 mm / VAR002 25 mm)?
3. ¿Qué mesas usan PAT001 chica vs PAT002 grande? (son 3 patas, falta el tamaño por modelo)
4. SKU del tapatornillo blanco en uso.

**Por qué importa:** estos datos + el catálogo cargado (import-skus, aún gated) habilitan Fase 5.0 (atributos SKU: largo/naturaleza/unidad de compra/patas_cant), Fase 5b (optimizadores de placa y varilla) y Fase 6 (filo/varilla como insumo por metro/rollo). Se construyen como bloque conectado una vez cerrados los 4 puntos + corrido import-skus.

**Técnico:** solo doc — `CHECKLIST_PRODUCCION_COMPLETO.md` (0.2 #4/#6/#7 + cabos abiertos filo/patas_cant) + este HANDOFF. Sin código ni migraciones.

---

### [2026-06-13] Producción — Fase 4.2: Realtime (🔴 sin polling)

**Qué se hizo:** las 5 pantallas de sector + el panel del encargado ahora se actualizan **en vivo** ante cualquier cambio de producción, sin recargar ni polling. Cumple la promesa 🔴 que cruza todo el brief (cada sector "ve" lo que dejó el anterior al instante).

**Por qué:** hasta ahora las pantallas solo refrescaban al montar o tras una carga propia. El encargado es un "centro de control en vivo" y Melamina/Embalaje dependen de ver el stock del eslabón previo apenas se produce.

**Backend — `0077_prod_fase4_realtime.sql` (escrita + smoke BEGIN/ROLLBACK validado, NO aplicada aún — espera OK):**
- Agrega las **11 tablas operativas `prod_*`** (jornada, los 4 sectores, los 4 stocks, alerta, mantenimiento) a la publicación **`supabase_realtime`**.
- **100% aditivo y reversible:** no toca schema ni datos, solo la membresía de la publicación. **Idempotente** (chequea `pg_publication_tables` antes de cada `ADD`). No necesita `REPLICA IDENTITY FULL` (el frontend re-fetchea, no usa valores viejos).
- **Smoke (rolled back):** la publicación existe; las 11 tablas se agregarían (hoy ninguna está); el `ALTER PUBLICATION … ADD TABLE` corre en transacción y revierte limpio. (`production_logs` ya estaba en realtime de antes — no es nuestra, no se tocó.)

**Frontend — helper + suscripciones:**
- **`lp-data.jsx` → `LP_DATA.subscribe(tables, onChange)`**: crea un canal Realtime, escucha `postgres_changes` (`event:'*'`) de las tablas indicadas, **debounce 250ms**, y devuelve la **función de baja** para el cleanup del `useEffect`. Si Realtime no está disponible → **no-op** (la pantalla sigue andando, solo sin vivo). RLS filtra server-side: cada rol recibe únicamente lo que puede leer.
- **Refetch silencioso:** cada `cargar` ahora acepta `{ silent:true }` → el tick en vivo **no muestra el loader** (evita parpadeo). El montaje inicial sigue mostrando el spinner.
- **Suscripciones por pantalla** (lo mínimo que cada una necesita): CNC `[corte, jornada]` · Melamina `[stock_pieza, melamina, jornada]` · Pino `[stock_patas, pino, jornada]` · Embalaje `[stock_melamina, stock_patas, embalaje, jornada]` · Encargado `[4 sectores + 4 stocks + alerta + mantenimiento + jornada]`.

**Cómo / decisiones:**
- El **encadenamiento** (4.1) ya vivía dentro de las RPCs `registrar_*` (descuentan el stock propio y acreditan el siguiente en la misma transacción) — se marcó hecho en el checklist; Realtime es lo que faltaba para que se **vea** en vivo.
- **Director escuchando mantenimiento** y **escuchar `orders`/`carrier_state` directo** quedan fuera: el primero es Fase 8 (panel del director aún no existe); el segundo tocaría tablas existentes (revisar su RLS para roles de sector) → refinamiento. Hoy el resumen del día igual se re-fetchea ante cualquier cambio `prod_*`.

**Técnico:** NUEVO `supabase/migrations/0077_prod_fase4_realtime.sql`; `lp-data.jsx` (+`subscribe`) y los 5 archivos de pantalla (`cnc/melamina/pino/embalaje-sector.jsx` + `encargado-panel.jsx`) web→mobile byte-idénticos (verificado por hash). Cache-busters: lp-data v5, cnc v6, melamina v4, pino v4, embalaje v4, encargado v2 (ambos HTML). **Pendiente: OK explícito del Jefe para aplicar 0077 + push.** *(Sin la migración el frontend no rompe: las suscripciones simplemente no reciben eventos hasta que se publique.)*

---

### [2026-06-13] RRHH — Empleados: CUIL → DNI (pedido de Seba)

**Qué se hizo:** se cambió la identificación de empleados de **CUIL** a **DNI** en todo el módulo de RRHH (BD + ambos frontends), con formato **DNI con puntos** (`12.345.678`). El **CUIT de proveedores NO se tocó** (es otro dominio).

**Por qué:** Seba pidió expresamente manejar a los empleados por DNI en vez de CUIL.

**Backend — `0076_rrhh_cuil_a_dni.sql` (escrita + smoke BEGIN/ROLLBACK validado, NO aplicada aún — espera OK):**
- `employees.cuil` → **`dni`** (RENAME COLUMN). Se dropea `employees_cuil_check` + `employees_cuil_unique_idx`.
- **Migración del dato existente:** el CUIL guardado (`XX-DDDDDDDD-V`) se convierte al DNI tomando los **8 dígitos del medio** y se formatea con puntos. (El único empleado real `20-40914074-3` → `40.914.074`.)
- Nuevo **`employees_dni_check`** `CHECK (dni ~ '^\d{1,2}\.\d{3}\.\d{3}$')` + `employees_dni_unique_idx`.
- **Snapshot de recibos:** `recibos.empleado_cuil` → **`empleado_dni`**.
- **8 RPCs** vía `CREATE OR REPLACE` (cero downtime): create/update/bulk_create/bulk_update employee, create_recibo (snapshot `empleado_dni`), historial, reportes_global — todas leen `p_payload->>'dni'`. HINTs renombrados (`duplicate_cuil`→`duplicate_dni`, `cuil_immutable`→`dni_immutable`). DNI sigue **inmutable post-alta**.
- `rpc_admin_check_cuils_exist(text[])` se **DROPea** y se crea **`rpc_admin_check_dnis_exist(p_dnis text[])`** (REVOKE anon/public + GRANT authenticated).

**Smoke (rolled back, 0 datos):** la extracción CUIL→DNI da `12.345.678` / `1.234.567`; el CHECK acepta DNI con puntos y rechaza sin-puntos/CUIL; el empleado existente convierte a `40.914.074`. ✅

**Frontend (10 archivos admin, web→mobile byte-idénticos):**
- `admin-data.js`: nuevo **`normalizeDni`** (acepta DNI 7-8 díg con/sin puntos, o CUIL/CUIT de 11 → toma 8 del medio; devuelve con puntos). `checkCuilsExist`→**`checkDnisExist`** (rpc + `p_dnis`). `EMPLOYEE_HEADER_SYNONYMS`: clave `cuil`→`dni` (sinónimos `documento`/`cuil`/`cuit`…). Validación, template Excel (header `dni`, ejemplo `12.345.678`, notas), reporte bulk (`DNI`), PDFs/Excel históricos (`DNI:`), exports.
- `employee-modal.jsx`: campo `dni`, label/placeholder `12.345.678`, validación, payload, readonly+tooltip en edición, hints `duplicate_dni`/`dni_immutable`.
- `employees-tab.jsx` (búsqueda/placeholder/th/celda), `historial-empleado-modal.jsx` (snapshot), `recibos-tab.jsx` (agrupado/filtro/búsqueda/th/option), `recibo-modal.jsx` (dropdown + snapshot select y locked), `recibo-row.jsx` (celda), `recibo-pdf-generator.js` (label `DNI:`), `bulk-import-employees-modal.jsx` (dnisToCheck/existingByDni/payload/headers/th/errores), `bulk-import-employee-row.jsx` (celda).
- **Compatibilidad de carga masiva:** si pegan un CUIL/CUIT de 11 dígitos, `normalizeDni` toma los 8 del medio automáticamente (no rompe planillas viejas).

**Técnico:** NUEVO `supabase/migrations/0076_rrhh_cuil_a_dni.sql`; 10 archivos `web|mobile/components/admin/*` (copia byte-idéntica verificada por hash); cache-busters bumpeados en ambos HTML (admin-data web v22/mobile v21, employee-modal v4, employees-tab/recibo-row/recibo-modal/recibos-tab/recibo-pdf-generator/historial-empleado-modal/bulk-import-employee-row/bulk-import-employees-modal v2). Migraciones históricas (0059/0060/0064/0068) **no se tocan** (son inmutables; 0076 es el forward-fix). **Pendiente: OK explícito del Jefe para aplicar 0076 en prod + push** (frontend y backend van juntos).

---

### [2026-06-12] Producción — Verificación completa (frontend + backend + lógica) + hardening

**Qué se hizo:** auditoría integral del módulo de producción y resolución de lo accionable.

**Frontend:**
- **Contrato frontend↔data layer:** cada `window.LP_DATA.x` de los 5 archivos de pantalla usa un método existente — **0 referencias colgadas**.
- **Sin código muerto:** los únicos "placeholder" son atributos `placeholder=""` de inputs y los stubs intencionales ("De fábrica", roles sin producción). No hay TODO/FIXME/dummy.
- **Paridad web/mobile:** los 7 archivos autocontenidos son **byte-idénticos**; `produccion-hub` difiere solo en padding (32px/16px) + comentario — el guard (routing por rol) es idéntico. Sin drift.

**Backend (introspección + advisors de Supabase):**
- **Contrato:** las 19 tablas/vistas que lee el frontend existen y `authenticated` tiene SELECT; las 12 RPCs existen (1 c/u). Sin typos ni faltantes. Las vistas `prod_v_*` corren como owner → los roles de sector pueden leer demanda/prioridad/armables sin bloqueo de RLS.
- **Advisors (141 lints):** la gran mayoría (128) son el **patrón deliberado** de RPCs `SECURITY DEFINER` con gate interno por rol (exigido por las reglas). Las 5 `security_definer_view` son intencionales (exponen demanda agregada, no datos crudos). Las 4 policies UPDATE con `WITH CHECK true` **no son hueco**: su `USING` ya restringe por rol + ventana 24h (el `WITH CHECK true` solo permite valores nuevos en filas que ya podés tocar).
- **Hardening real aplicado → migration 0075 (escrita, pendiente de aplicar):** `prod_fn_alerta_stock` y `prod_fn_auditoria` (trigger functions SECURITY DEFINER) estaban ejecutables por `anon`/`public` sin necesidad → `REVOKE EXECUTE`. Los triggers siguen funcionando igual.

**Lógica:** el motor de explosión (0074) y la cadena de stock (0073) están smoke-validados. Refinamientos honestos anotados en checklist (avance por canal, `prod_v_armables` con producto sin receta→0, nombre del coordinador, Realtime Fase 4).

**Conclusión:** el módulo de producción está **consistente y profesional**; lo pendiente es funcional/de-datos (no hay genéricos rotos). **Pendiente: OK del Jefe para aplicar 0074 + 0075 en prod + push.**

---

### [2026-06-12] Producción — Fase 5a (BOM recursivo + motor de explosión) · Brief Lógica 2

**Qué se hizo:** el **corazón de la Lógica 2** — el árbol de despiece recursivo y el motor de explosión que convierte ventas pendientes en demanda de cada pieza/material a todos los niveles.

**Migration 0074** (escrita + **smoke BEGIN/ROLLBACK validado**, NO aplicada aún — espera OK):
- **`prod_componente (padre_sku, hijo_sku, cantidad)`** + RLS — el BOM unificado padre→hijo a cualquier profundidad (reemplaza las 4 hojas del Excel por una estructura recursiva, §4.2).
- **`prod_v_explosion`** — vista RECURSIVA: demanda neta por producto (pedidos no despachados − producido, igual base que `prod_v_demanda_tap`) explotada por `prod_componente` multiplicando cantidades. **Guarda de profundidad <20** anti-ciclos. Devuelve `sku, demanda, nivel_max, es_hoja`.
- **`prod_v_demanda_corte`** (TAP + patas hoja) y **`prod_v_materia_prima`** (insumos hoja vs `prod_insumo` → falta) — las dos salidas de la explosión (§6.2).

**Smoke (rolled back, 0 datos):** mini-BOM MADTEST→TAP/KIT/SET, base ×5 → TAP=5, KIT=5, TOR=20 (5×4), PAT=30 (5×6) ✅ exacto; la vista compila contra `orders`/`carrier_state` reales (18 productos pendientes hoy).

**`import-skus` extendido:** ahora puebla `prod_componente` desde **INSUMOS** (padre COMPUESTO → hijos×cantidad, con `fixSku`) y desde **"sku x producto"** (producto → cualquier complemento). Así la explosión tiene el árbol completo cuando se corra. *(Gated: import-skus sigue sin ejecutarse hasta el OK + cierre de 0.2 con Seba.)*

**Cómo / decisiones:**
- Naturaleza (corte/insumo/producto) se deriva por prefijo + `es_hoja` en las vistas. Los atributos formales de SKU (Naturaleza/vendible/unidad de compra/largo, §5.0) y las **unidades de compra** son Fase 6.
- ⚠️ **Refs de KIT Yori/Hikari → TOR005/006/007**: la explosión será exacta cuando se cierre la corrección **0.2 #8** con Seba (hoy las refs quedan crudas).

**Fase 5b (pendiente, comunicado):** los **2 optimizadores de corte** (placas con combos §7.2 / lineal cutting-stock §7.3) y la **pantalla "Optimización"** — son algoritmos dedicados (Edge Functions) que necesitan el catálogo real cargado para validarse; no se construyen a ciegas.

**Técnico:** NUEVO `supabase/migrations/0074_prod_fase5_bom_explosion.sql`; `supabase/functions/import-skus/index.ts` (+`prod_componente`). Sin frontend en este paso. **Pendiente: OK del Jefe para aplicar 0074 en prod + push.**

---

### [2026-06-12] Producción — Fase 7: Panel del Encargado

**Qué se hizo:** **`encargado-panel.jsx`** (slate `#2E4057`, 4 tabs: Inicio · Sectores · Stock · Avisos). Centro de control: el encargado NO carga, ve los 4 sectores en vivo y corrige con auditoría. Ruteado en el guard: `encargado/owner/admin → EncargadoPanel`.

**Cómo / decisiones:**
- **Tab Inicio:** 4 KPIs (producido hoy = cortes netas+melamina+pino+embalaje; listos = `stock_terminado`; falta despachar = `prod_v_resumen_dia`; alertas = `prod_alerta`), **cadena productiva en vivo** (2 líneas con el stock de cada nodo: CNC→Melamina→Terminado y Pino→Embalaje), alertas activas y pendiente por producto.
- **Tab Sectores:** una tarjeta por sector con estado de jornada + última carga + mini-métricas, y **cada carga es tappable → `LpEditModal` con `motivoRequerido=true`** → `editar_corte/melamina/pino/embalaje`. La auditoría la genera el trigger existente porque el editor es encargado/owner/admin. (Embalaje sí se edita acá porque `editar_embalaje` es encargado-only.)
- **Tab Stock:** botón cargar remito + bajo mínimo + stock general — **estructura lista pero depende de insumos/remitos de la Fase 6** (estado vacío honesto; el botón avisa que se habilita en Fase 6). No se inventó alta de remito sin la lógica de stock.
- **Tab Avisos:** alertas, mantenimiento derivado al director (`prod_mantenimiento` estados aprobado_coord/recibido_director) y el recordatorio del ruteo (insumos→admin, mantenimiento→director).
- **`lp-data`:** +`alertas`, `mantenimientos`, `insumos`, `editarEmbalaje`. **`lp-ui` `LpEditModal`:** +`motivoRequerido` (deshabilita guardar sin motivo; label en ámbar).
- **Tokens:** slate `#2E4057` como identidad (fills/bordes); para texto/íconos sobre fondo casi negro se usa un slate claro `#9FB0C9` y los números en blanco/verde (legibilidad, igual criterio que los sectores).

**Pendiente (anotado en checklist):** desglose de avance **por canal + horario** (la vista agrega sin canal), **Stock/remitos reales** (Fase 6), y nombre del coordinador por sector (no se carga el perfil). Realtime sigue siendo Fase 4 (hoy refresca al montar/editar).

**Técnico:** NUEVO `web|mobile/components/encargado-panel.jsx`; `lp-data.jsx` (+métodos), `lp-ui.jsx` (LpEditModal), `produccion-hub.jsx` (guard) + ambos HTML. Cache-busters: lp-data v4, lp-ui v4, produccion-hub v6, encargado-panel v1. Sin migraciones (usa RPCs 0073 + vistas 0071). **Con esto el frontend de producción queda completo** (4 sectores + panel del encargado); falta el motor de Lógica 2 (Fase 5) y Fase 6/8/9.

---

### [2026-06-12] Producción — Cierre de Fase 3 (edición 24h + badges + QR cámara)

**Qué se hizo:** se cerró Fase 3 al 100% sumando los 3 gaps que faltaban en los sectores de operario.

**1. Edición de carga propia (24h) — regla §17.5:**
- `lp-data`: `editarCorte/editarMelamina/editarPino` (wrappers de las RPCs `editar_*` de 0073) + `editable_hasta` agregado a las lecturas `*Dia`.
- `lp-ui`: **`LpEditModal`** genérico (campos numéricos + motivo opcional, dark).
- CNC/Melamina/Pino: las filas "del día" dentro de la ventana de 24h muestran "✎ editar" y son tappables → abren el modal → `editar_*` → refresh. Auditoría: si lo edita encargado/owner/admin la genera el trigger; el coordinador dentro de 24h no audita (por diseño).
- **Embalaje NO tiene auto-edición**: `editar_embalaje` (0073) es solo encargado/owner/admin porque el undo/redo de stock es complejo y `prod_embalaje` no tiene `editable_hasta`. Las correcciones de embalaje las hace el encargado. *(Si se quiere auto-edición de embalaje, es un follow-up de backend: 0074 con `editable_hasta` + RPC para el coordinador.)*

**2. Badge de pendientes en nav:** el ítem "Inicio" muestra un badge con la cantidad de prioridades pendientes (CNC: productos del resumen; Melamina: TAPs con falta>0; Embalaje: productos con pendiente>0). Pino no tiene vista de prioridad → sin badge.

**3. Scan por QR (cámara):** `lp-ui` **`LpQrScan`** reusa `window.QrScanner` (ya cargado en el mobile) con **lectura única** (detecta, para la cámara, devuelve el SKU). CNC/Melamina/Embalaje: el botón "Escanear QR" abre el scanner; al detectar, matchea el SKU (parsing tipo ML: split por `·`/espacio) contra placas/piezas/productos y selecciona. Pino es a granel → sin QR (correcto). En **web** (que no carga la lib) el botón degrada con aviso `toast.info`.

**Técnico:** `lp-data.jsx`, `lp-ui.jsx`, `cnc-sector.jsx`, `melamina-sector.jsx`, `pino-sector.jsx`, `embalaje-sector.jsx` (web + mobile), cache-busters bumpeados (lp-data v3, lp-ui v3, cnc v5, melamina/pino/embalaje v3). Sin cambios de backend (usa RPCs de 0073). Verificado: 0 sintaxis no probada, llaves/paréntesis balanceados, espejo web/mobile.

**Resultado: FASE 3 cerrada.** Los 4 sectores de operario quedan completos (Inicio+prioridad, Scan+QR, registrar, editar 24h, Solicitud, Mantenimiento) con tokens §15. Lo único de "frontend de producción" que falta es el **Panel del Encargado (Fase 7)**.

---

### [2026-06-12] Producción — Verificación contra los 2 briefs + fix de discrepancias

**Qué se hizo:** se leyeron **completos** los dos briefs (`BRIEF_FINAL_modulo_produccion.md` y `brief_completo_logica2.md`) y se contrastó todo lo construido. Se corrigieron las discrepancias reales y se actualizó el checklist con lo que falta.

**Resultado de la verificación:** la capa operativa (Brief Producción: 4 sectores + cadena de stock + RPCs) **respeta los briefs**. La corrección 0.2 (TOR009/010/011) coincide textual con Brief Lógica §12.1.

**Discrepancia corregida (la única que era una desviación propia):**
- **Design tokens → alineados al Brief Producción §15 exacto** en los 4 sectores + `lp-ui`:
  - Base dark: bg `#0C0C0E`, superficie `#1A1A1D`, superficie2 `#222226`, borde `#28282E`, texto `#EFEFEF`/`#9898A6`/`#55555F`.
  - Semánticos: éxito `#00D68F`, alerta `#FFB020`, error `#FF4060` (urgencias y rgbas hardcodeados también actualizados).
  - Colores de sector EXACTOS: CNC `#2563EB` · Melamina `#534AB7` · Pino `#0F6E56` · Embalaje `#993C1D`. (Antes los había aclarado por contraste.)
  - Para legibilidad sobre fondo casi negro, los **totales netos** pasan a verde Éxito (`#00D68F`) como indica §15 ("Éxito = totales netos"), y los contadores grandes de Pino a texto primario.
  - `SECTOR_THEME` (produccion-hub) ya tenía los hexes exactos. Cache-busters bumpeados (cnc v4, melamina/pino/embalaje/lp-ui v2).

**Gaps agregados al checklist (a trabajar por el checklist, NO se construyen ahora):**
- FASE 3.0: **edición de carga propia 24h en el frontend** (RPCs `editar_*` listas, falta UI) y **Scan por cámara/QR** (hoy stub).
- FASE 4: Realtime (ya estaba) — los sectores hoy cargan al montar + refrescan tras cada acción, sin suscripción en vivo.
- FASE 5 (Brief Lógica 2): nueva **§5.0** — enriquecer catálogo (Naturaleza/vendible/unidad de compra/largo) + **cargar el árbol de despiece recursivo** (la hoja INSUMOS ya lo trae; `import-skus` hoy no lo carga → falta tabla `prod_componente` + extender el parser).
- FASE 3.4 Embalaje: orden por canal (la vista agrega por producto, sin canal) — limitación anotada.

**Decisión metodológica (Jefe):** primero arreglar discrepancias (hecho), lo grande/lo que falta queda en el checklist y se trabaja desde ahí. Roles `profiles.role` vs `app_metadata` = adaptación justificada (no romper login), no es defecto.

---

### [2026-06-12] Producción en Línea — Fase 3 · Sector Embalaje (cierra los 4 operarios)

**Qué se hizo:** **Sector Embalaje** completo (`embalaje-sector.jsx`, coral, **3 tabs sin Mantenimiento**). Es donde convergen las 2 líneas (Melamina + Pino) y se produce el producto "listo para despacho".

**Cómo / decisiones:**
- **Data:** se amplió `lp-data.jsx` — `productos()` ahora trae `kit_embalaje`, y se agregó `recetaProducto(sku)` (lee `prod_receta`). `lp-data?v=2`.
- **Tab Inicio:** banner "Prioridad · productos a embalar" (coral) desde `prod_v_resumen_dia` (pendiente) cruzado con `prod_v_armables`; si no hay armables → "esperando piezas/patas" en ámbar. Stocks de origen lado a lado: "Piezas · Melamina" (violeta, `stock_melamina`) y "Patas · Pino" (verde, `stock_patas`). Tabla "Embalados hoy" + total listos para despacho.
- **Tab Armar (Scan):** picker de producto con "arma N" (armables); al elegir, carga la receta y muestra la **verificación de componentes** ✓/✗ (cada tapa de la receta + patas, con `have/need` según unidades; kit informativo desde `kit_embalaje`). Selector de cantidad con tope = armables (cuello de botella del backend). Confirmar → `prod_rpc_registrar_embalaje` (descuenta melamina+patas, produce terminado, marca pedido si hay order_id). **No registra fallas** (por diseño).
- **Solicitud** (kit + otros) vía `LpSolicitud`. Sin tab Mantenimiento (3 ítems de nav).
- **Wiring:** guard enruta `role === 'embalaje' → window.EmbalajeSector`. `produccion-hub?v=5`. Espejo web/mobile, 0 sintaxis no probada, llaves balanceadas.

**Resultado:** **los 4 sectores de operario quedan completos** (CNC azul · Melamina violeta · Pino verde · Embalaje coral), todos sobre la data/UI compartida (`lp-data`/`lp-ui`). La cadena de stock completa es operable desde el celular.

**Técnico:** NUEVO `web|mobile/components/embalaje-sector.jsx`; edición `lp-data.jsx`, `produccion-hub.jsx` + ambos HTML. Sin backend. **Falta de Fase 3:** QR de cámara (diferido en los 4) y el **Panel del Encargado (Fase 7, slate)**.

---

### [2026-06-12] Producción en Línea — Fase 3 · Sector Pino

**Qué se hizo:** **Sector Pino** completo (`pino-sector.jsx`, verde, 4 tabs). Trabaja con 2 tamaños de pata (chica/grande), carga manual a granel (sin QR).

**Cómo / decisiones:**
- **Tab Inicio:** 2 contadores grandes de stock terminado (Chicas / Grandes, `stock_patas.disponible`), tarjeta ámbar "Patas masilladas · pendientes" (`stock_patas.masilladas`), tabla "Producidas hoy" (`pinoDia`) y neto terminadas → Embalaje.
- **Tab Cargar (Scan sin QR):** 3 pasos — tamaño (chica/grande) → estado (terminada/masillada) → cantidad. Una sola llamada `prod_rpc_registrar_pino` mapeando estado→campo (`terminadas` o `masilladas`).
- **Banner "prioridad de patas" diferido:** no existe vista de prioridad de patas (no hay `prod_v_prioridad_patas`); se priorizó mostrar los contadores de stock. Anotado en checklist.
- Solicitud (madera/varillas, lijas, masilla, clavos, eléctrico/herrajes, herramientas) y Mantenimiento (ingletadora, cepilladora, etc.) vía genéricos `LpSolicitud`/`LpMant`.
- **Wiring:** guard enruta `role === 'pino' → window.PinoSector`. Script registrado, `produccion-hub?v=4`. Espejo web/mobile, 0 sintaxis no probada, llaves balanceadas.

**Técnico:** NUEVO `web|mobile/components/pino-sector.jsx`; edición `produccion-hub.jsx` + ambos HTML. Sin backend. **Siguiente:** Embalaje (coral, 3 tabs, armables + verificación de componentes), luego Panel del Encargado (Fase 7).

---

### [2026-06-12] Producción en Línea — Fase 3 · Sector Melamina + refactor a data/UI compartida

**Qué se hizo:** (1) se **centralizó** la data layer y la UI repetida de los sectores en dos archivos compartidos; (2) se construyó el **Sector Melamina** completo (violeta, 4 tabs).

**Por qué:** antes de replicar CNC ×4 sectores, factorizar lo común evita 4 copias divergentes y reduce el rework. La data layer (`window.LP_DATA`) y las tabs Solicitud/Mantenimiento son idénticas entre sectores salvo catálogo/color.

**Cómo / decisiones:**
- **`lp-data.jsx`** (nuevo): `window.LP_DATA` completo para los 4 sectores (jornada, maestros, stock/vistas, registrar+leer de cada sector, solicitud, mantenimiento). Se quitó el bloque LP_DATA que estaba inline en cnc-sector.
- **`lp-ui.jsx`** (nuevo): primitivas compartidas `LpClock`, `LP_URGENCIAS`, `lpStepBtn`, y **`LpSolicitud`/`LpMant` genéricos** (parametrizados por `sector`, `catalogo`/`tipos`, `U`). Se cargan antes de los `*-sector.jsx`.
- **`cnc-sector.jsx`** refactorizado: usa `LpSolicitud`/`LpMant` y la data compartida (se eliminaron `CncSolicitud`/`CncMant` locales). Sin cambios funcionales para el usuario. Cache-buster `?v=3`.
- **`melamina-sector.jsx`** (nuevo): Inicio (banner crudo de CNC en azul desde `stock_pieza`; banner prioridad por TAP desde `prod_v_prioridad_melamina` con violeta/ámbar según crudo alcance; tabla terminadas + neto a Embalaje), Scan (picker TAP con crudo disponible, terminadas+fallas, validación cliente de no exceder crudo, `prod_rpc_registrar_melamina`), Solicitud (filo 7 colores + herramientas + moldes) y Mantenimiento (enchapadora/pistola/etc.) vía genéricos.
- **Colisiones de scope** (Babel-in-browser, script scope compartido): cada sector usa nombres únicos (`MEL_UI`, `MelaminaSector`, …) y reusa los helpers de `lp-ui` sin redeclararlos. Verificado: 0 sintaxis no probada, llaves balanceadas.
- **Wiring:** `LineaProductivaGuard` ahora enruta `role === 'melamina' → window.MelaminaSector`. Scripts nuevos registrados en ambos HTML (orden: lp-data, lp-ui, antes de los sectores). `produccion-hub?v=3`.

**Para qué:** dejar listo el patrón replicable (Pino/Embalaje quedan chicos) y entregar la segunda pantalla de operario funcional.

**Técnico:** NUEVOS `web|mobile/components/lp-data.jsx`, `lp-ui.jsx`, `melamina-sector.jsx`; refactor `cnc-sector.jsx`; edición `produccion-hub.jsx` + ambos HTML. Sin cambios de backend. **Siguiente:** Pino (verde, sin QR, 2 tamaños) y Embalaje (coral, 3 tabs, armables + verificación de componentes).

---

### [2026-06-12] Producción en Línea — Fase 3 · Sector CNC (Increment 2: Solicitud + Mantenimiento + demanda)

**Qué se hizo:** se completó el **Sector CNC** — se sumaron las tabs **Solicitud** y **Mantenimiento** (funcionales) y el panel **"Resumen del día"** (demanda) en Tab Inicio. Con esto el sector CNC queda entero (4 tabs).

**Cómo / decisiones:**
- **`window.LP_DATA`** ampliada: `resumenDia` (lee `prod_v_resumen_dia`), `crearSolicitud` (`prod_rpc_crear_solicitud`), `reportarMantenimiento` (`prod_rpc_reportar_mantenimiento`).
- **Tab Solicitud:** catálogo de la brief CNC (Fresas: compresión / filo horario · Esponja · Lubricantes: aceite/grasa/WD-40 · Refrigerante: agua destilada) con stepper de cantidad por ítem + textarea "Maquinaria/Otros". Arma `items[]` y crea UNA solicitud `sector='cnc'` estado pendiente → coordinador → administración.
- **Tab Mantenimiento:** tipo (6 chips: Mecánico/Eléctrico/Software-CNC/Temperatura/Ruido-vibración/Preventivo), urgencia (Alta/Media/Baja con color), máquina afectada + descripción → `reportar_mantenimiento` (urgencia validada `alta|media|baja` por el RPC) → coordinador → director.
- **Panel "Resumen del día"** en Inicio: lee `prod_v_resumen_dia` (producto, color, pendiente) **best-effort** — si la RLS de la vista bloquea al rol cnc, se captura el error y el panel simplemente no se muestra (no rompe la pantalla).
- Mantiene la disciplina anti-Babel (sin `<>`/`??`/spread; `Object.assign` para merge de estilos). Espejo web/mobile byte-idéntico (`cp`). Cache-buster `cnc-sector.jsx?v=2`.

**Para qué:** el operario CNC ya tiene su herramienta completa: ve demanda + lo cortado, carga cortes, pide insumos y reporta máquinas — todo desde el celular, con la lógica en el backend.

**Técnico:** reescritura de `web/components/cnc-sector.jsx` + espejo `mobile/` (componentes `CncSolicitud`, `CncMant`, helper `stepBtn`, catálogos `CNC_SOLICITUD_CAT`/`CNC_MANT_TIPOS`/`LP_URGENCIAS`). Sin cambios de backend. **Siguiente:** replicar el patrón a Melamina (violeta), Pino (verde), Embalaje (coral) y Panel del Encargado (slate).

---

### [2026-06-12] Producción en Línea — Fase 3 · Sector CNC (Increment 1: esqueleto + Inicio + Scan)

**Qué se hizo:** primera pantalla real de operario — **Sector CNC** (`cnc-sector.jsx`, web + mobile). Mobile-first ~430px, **dark mode**, azul `#2563EB`. Increment 1 entrega el esqueleto común + Tab Inicio + Tab Scan funcional (registrar corte de punta a punta contra las RPCs).

**Por qué:** es el primer sector de la Fase 3 y el que **valida el patrón** a replicar en Melamina/Pino/Embalaje/Encargado. Se eligió partir CNC en 2 incrementos para validar el diseño antes de replicarlo ×5.

**Cómo / decisiones:**
- **Data layer aislada** en `window.LP_DATA` (definida en el archivo del sector, reutilizable por los demás): `jornadaHoy`, `placas`, `registrarCorte`, `cortesDia`. Usa `window.SUPA` (cliente que ya expone data.js). El JWT de sesión resuelve `auth.uid()` en el backend → no se pasa user id. **No toca `data.js` ni el store del resto de la app** (respeta el aislamiento del módulo prod_).
- **Topbar:** pill CNC (icono + "EN VIVO"), reloj vivo (intervalo 30s), chip de estado de jornada (abierta/cerrada/sin jornada).
- **Bottom nav** 4 ítems (Inicio/Scan/Solicitud/Mant), activo en azul. Solicitud/Mant = placeholder interno (Increment 2).
- **Tab Inicio:** tabla "Cortes del día" (lee `prod_corte` + join cliente con `prod_placa` para nombre/rendimiento), columnas Placa/Hojas/Generadas/Netas, y card al pie "Piezas netas → Melamina" (suma de netas = hojas×rend−desp). Banner si la jornada no está abierta.
- **Tab Scan:** selección **manual agrupada** de placa (Blancas/Negras/Mármol/Combinadas por prefijo de SKU PLB/PLN/PMB-PMN/COM), campos hojas+desperdicio, **vista previa en vivo** (piezas = hojas×rend−desp), botón "Agregar al reporte" → `prod_rpc_registrar_corte` → toast + refresh + vuelve a Inicio. QR de cámara = stub "próximamente". Gating: si la jornada no está abierta, no deja registrar (coincide con el RPC).
- **Wiring:** `produccion-hub.jsx` (`LineaProductivaGuard`) renderiza `window.CncSector` cuando `role === 'cnc'`; el resto de roles siguen con su placeholder de sector. Script `cnc-sector.jsx?v=1` agregado a `web/Macario Lite.html` y `mobile/index.html` después de produccion-hub.
- **Compatibilidad Babel-in-browser:** se evitaron features que el codebase no usa (fragmentos `<>`, `??`, object-spread `{...}`) y se reemplazaron por equivalentes seguros (`?.` sí está probado). Verificado: 0 ocurrencias residuales, JSX balanceado, sin colisión de nombres en el scope compartido, espejo web/mobile idéntico.

**Para qué:** que el operario CNC pueda, desde su celular, ver lo cortado del día y cargar cortes que alimentan el stock de piezas (cadena → Melamina), con el cálculo en el backend (el frontend solo muestra y captura). Es el molde de los demás sectores.

**Técnico:** `web/components/cnc-sector.jsx` + `mobile/components/cnc-sector.jsx` (NUEVOS), edición de `produccion-hub.jsx` (web+mobile) y de ambos HTML (script tag). Sin cambios de backend (usa las RPCs de 0073). Datos reales aparecen recién cuando se corra `import-skus` y se abra una jornada; hasta entonces, empty states.

**⚠️ Pendiente Increment 2:** Tab Solicitud (catálogo fresas/esponja/lubricantes/refrigerante → `prod_rpc_crear_solicitud`), Tab Mantenimiento (tipo/urgencia/máquina → `prod_rpc_reportar_mantenimiento`), panel "Resumen del día / demanda", badge de nav. Después: replicar a Melamina/Pino/Embalaje/Encargado.

---

### [2026-06-12] Producción en Línea — Fase 1 (guards de rol en frontend · router por sector)

**Qué se hizo:** el tab **"Línea productiva"** del hub de producción dejó de ser un `Próximamente` genérico y pasó a ser un **router por rol**. Cada rol de producción ve la identidad de SU sector; los roles sin producción ven el placeholder de siempre (sin cambios). Cierra los 2 ítems de guards de la Fase 1 del checklist.

**Por qué:** era el prerrequisito de la Fase 3 (frontend por sector) y un guard pedido explícitamente: "qué pantalla de sector se muestra según `profiles.role`". Sin esto, no hay punto de entrada por sector y la Fase 3 no tiene dónde colgar cada pantalla.

**Cómo / decisiones:**
- Implementado **inline en `produccion-hub.jsx`** (web + mobile) para no tocar los includes del HTML ni agregar archivos nuevos. Cambio 100% aditivo.
- `SECTOR_THEME`: mapa rol → `{label, color, icon, desc}` con la **paleta oficial de la brief** (CNC azul `#2563EB`, Melamina violeta `#534AB7`, Pino verde `#0F6E56`, Embalaje coral `#993C1D`, Encargado/owner/admin slate `#2E4057`).
- `LineaProductivaGuard({ role })`: si el rol está en el mapa → panel de sector (badge con color de marca + icono + nombre + "En construcción · Fase 3"); si no → `ProximamentePlaceholder` genérico (guard: rol sin producción no ve nada nuevo).
- Los paneles por sector son **placeholders premium listos para llenar en Fase 3** (no son las pantallas finales — esas se construyen sector por sector, CNC primero).
- Verificado: JSX balanceado, sin colisión de nombres en el scope compartido de scripts clásicos (Babel-in-browser), espejo web/mobile idéntico salvo el padding del contenedor.

**Para qué:** dar el esqueleto de navegación por rol del módulo productivo, de modo que cuando se construya cada pantalla de sector (Fase 3) solo haya que reemplazar el placeholder correspondiente, sin tocar el ruteo ni los guards.

**Técnico:** `web/components/produccion-hub.jsx` + `mobile/components/produccion-hub.jsx` (helper `SECTOR_THEME` + `LineaProductivaGuard`, branch `tab === 'linea-prod'`). Cache-buster `produccion-hub.jsx?v=1 → ?v=2` en `web/Macario Lite.html` y `mobile/index.html`. Sin cambios de backend.

---

### [2026-06-12] Producción en Línea — Fase 0.2 (capa de normalización de datos del Excel)

**Qué se hizo:** se agregó una **capa de normalización declarativa en `import-skus`** (`SKU_FIXES` + helper `fixSku`) que corrige al vuelo, durante la importación, los **SKUs duplicados del Excel** sin tocar el archivo original de Seba. Resuelve los ítems #1, #2 y #8 de la sección 0.2 del checklist.

**Por qué:** en la hoja `INSUMOS`, los códigos **TOR005/TOR006/TOR007 estaban definidos dos veces** (filas 43-49): una vez como herrajes rectangulares/set y otra como tornillos de Yori/Hikari. Como `import-skus` hace upsert por SKU, la 2ª definición pisaba a la 1ª → se **perdían 3 piezas** (los tornillos rectangulares desaparecían como pieza y los KIT que los referencian quedaban ambiguos). Esto rompe la futura explosión de BOM (Fase 5).

**Cómo / decisiones (Jefe, 2026-06-12):**
- **Dónde corregir:** capa de normalización en `import-skus` (no editar el .xlsx de Seba) → versionado, reversible, auditable en git. La fuente queda intacta.
- **Códigos nuevos** (elegidos siguiendo la secuencia existente, último real = TOR008): variante **Yori → TOR009**, **Hikari → TOR010**, **Hikari x2 → TOR011**. Las rectangulares/set conservan TOR005/006/007.
- `fixSku(sku, nombre)` reasigna solo cuando el SKU coincide **y** el nombre contiene `YORI`/`HIKARI` (identifica la 2ª definición sin ambigüedad). Se aplica únicamente en el loader de INSUMOS (es la única hoja con la colisión).
- Ítem #2 (cantidades como texto): ya cubierto por `toIntOrNull` del parser, sin cambios.
- Ítem #8 (tornillos Hikari): la pieza "Hikari x2" ahora existe única (TOR011); el re-cableado de KIT007 al sub-ensamble se difiere a Fase 5 (el árbol BOM `TIPO/CANTIDAD/HIJO` todavía no se carga — `import-skus` carga solo SKU+nombre).

**Para qué:** dejar el catálogo de piezas consistente y único **antes** de poblar datos, para que el motor de explosión (Fase 5) y la cadena de stock no calculen sobre piezas perdidas o ambiguas.

**Resultado — validación en memoria (SOLO LECTURA, sin tocar BD ni Excel):** réplica de `fixSku` corrida sobre el INSUMOS real → **0 colisiones remanentes**, 50 piezas distintas, TOR005/006/007 conservan las rectangulares/set y aparecen TOR009=Yori, TOR010=Hikari, TOR011=Hikari x2.

**⚠️ Pendiente de Seba (no ejecutable sin su input):** ítems #3 filo (metros por modelo), #4 varilla, #5 patas como pieza de corte (falta `patas_cant`), #6 tapatornillos color huérfanos, #7 caja del Hikari (¿N°2 correcto?). Anotados en el checklist 0.2 con su motivo. `import-skus` sigue **sin ejecutarse** (espera OK del Jefe + cierre de las decisiones de Seba antes de poblar).

---

### [2026-06-11] Producción en Línea — Fase 2 (RPCs de carga por sector, 0073)

**Qué se hizo:** Migration 0073 — **16 RPCs `prod_rpc_*`** (`SECURITY DEFINER`, `SET search_path = public, pg_temp`, auth gate por `profiles.role`, `REVOKE anon/public` + `GRANT authenticated`). Todas reciben `p_payload jsonb` y devuelven `jsonb`. Aplicada en prod (Management API). **NO toca datos ni tablas existentes** (solo `CREATE OR REPLACE FUNCTION`).

**RPCs por sector:**
- **Jornada:** `abrir_jornada` (owner/admin/encargado; 1 por día, error si ya existe), `cerrar_jornada` (devuelve resumen de conteos), `get_jornada_hoy` (todos los roles prod).
- **CNC:** `registrar_corte` (cnc/encargado/owner/admin; `piezas = GREATEST(hojas×rendimiento − desperdicio, 0)`; acredita `stock_pieza` de `placa.pieza_sku`; `editable_hasta = now()+24h`), `editar_corte` (cnc dentro de 24h, si no encargado/owner/admin; recalcula deltas, audita vía trigger).
- **Melamina:** `registrar_melamina` (valida `stock_pieza ≥ terminadas+fallas`; consume `stock_pieza`, produce `stock_melamina`), `editar_melamina`.
- **Pino:** `registrar_pino` (`tamano ∈ {chica,grande}`; suma `stock_patas.disponible/masilladas`), `editar_pino`.
- **Embalaje:** `registrar_embalaje` (valida `stock_melamina` por receta + `stock_patas` por `patas_tipo/patas_cant`; consume ambos, produce `stock_terminado`; si `order_id` → `prod_pedido_estado` `listo_despacho`), `editar_embalaje` (solo encargado/owner/admin; deshace-viejo-aplica-nuevo).
- **Solicitudes:** `crear_solicitud` (sectores+encargado), `gestionar_solicitud` (owner/admin/encargado; `aprobada_coord`/`recepcionada_admin`).
- **Mantenimiento:** `reportar_mantenimiento` (todos; `urgencia ∈ {alta,media,baja}`), `gestionar_mantenimiento` (owner/admin).
- **Stock:** `get_stock` (todos los roles prod; devuelve 4 arrays jsonb).

**Cómo / decisiones (flags):**
1. `jornada_id`: se toma de `p_payload`; si no viene, se resuelve la jornada **abierta** de hoy (error si no hay).
2. Auditoría de `editar_*`: la genera el **trigger existente** `prod_fn_auditoria` (1 fila por campo); el RPC solo setea motivo/sector vía `set_config('prod.audit_motivo'/'prod.audit_sector', …, true)`. Sin INSERT manual (evita duplicados).
3. Corte de placa **combinada**: acredita stock solo a la pieza primaria (`prod_placa.pieza_sku`); las de `prod_placa_pieza_extra` no se acreditan (brief: una sola).
4. Deltas de `editar_*` aplicados crudos (pueden dejar stock negativo si ya se consumió).

**Resultado — smoke BEGIN/ROLLBACK (0 datos commiteados):** maestros mínimos sembrados en la misma transacción (TAP001 / PLB001 rend 50 / MADZZ1 patas chica×4 / receta 1×TAP001), corrido como owner Noelia. Cadena verificada: corte 10 hojas → **500 piezas** → melamina 8+1 → `stock_pieza=491`, `stock_melamina=8` → pino chica 12/6 → `patas disp=12 mas=6` → embalaje 2u → `melamina=6`, `patas=4`, `terminado=2` → **`prod_v_armables=1`** (LEAST(6/1, 4/4)) → cerrar_jornada resumen 1 c/u. `RAISE EXCEPTION` forzó rollback; verificado **0 filas** en las 14 tablas `prod_*` post-rollback. Las 16 RPCs confirmadas por `pg_proc`.

**⚠️ Nota:** aplicada vía Management API → **no** queda registrada en `supabase_migrations.schema_migrations` (igual que 0071/0072). El archivo `.sql` es la fuente de verdad en el repo.

---

### [2026-06-10] Producción en Línea — Fase 1b (Edge Function import-skus)

**Qué se hizo:** `supabase/functions/import-skus/index.ts` — Edge Function (Deno) que importa `sku para sistema.xlsx` a las tablas `prod_*`. **Escrita y pusheada, NO ejecutada todavía** (pendiente OK del Jefe para servirla/correrla).

**Mapeo real del Excel (confirmado por Jefe):**
- `INSUMOS` (SKU PADRE) → `prod_pieza`.
- `SKU DE PLACAS DE CORTE CNC`: sección derecha (cols 6-7) → `prod_pieza` (TAPs); sección izquierda (cols 0-4) → `prod_placa` (`material`=DETALLE, `combinada` si >1 hijo) + `prod_placa_pieza_extra`.
- `SKU DE PRODUCTOS` → `prod_producto` (tipo `simple`, patas null/0, `kit_embalaje={caja:…}`).
- `sku x producto` → `prod_receta` (multi-fila; complementos TAP/KIT/CAJ que existan como pieza → en la práctica solo TAP).

**Cómo / decisiones:**
- **Lee el archivo del FILESYSTEM LOCAL** (`Deno.readFile`, default `./sku para sistema.xlsx`) — Storage aún no configurado. → Pensada para `supabase functions serve` desde la raíz del repo; **una función en Cloud no vería el archivo**.
- Auth: JWT → `profiles.role` owner/admin. Upserts con service-role (bypass RLS). Upsert por SKU; fila que viola FK/CHECK se rechaza `{fila, motivo}` y sigue. Respuesta `{insertados, actualizados, rechazados, por_tabla}`.
- piezas (2 fuentes) cargadas antes que placas/recetas (orden de FK). SheetJS vía CDN (`cdn.sheetjs.com/.../xlsx.mjs`), `@supabase/supabase-js` vía esm.sh.

**⚠️ PENDIENTE:** OK del Jefe para servir/ejecutar la función (la 1ª corrida escribe datos reales en `prod_*` — no hay smoke con rollback para una Edge Function). Reusa la base de datos creada en 0071/0072.

---

### [2026-06-10] Producción en Línea — Fase 1, patch RLS (0072)

**Qué se hizo:** Migration 0072 — 2 correcciones de RLS sobre tablas de 0071 (solo policies nuevas, aditivas, sin tocar las existentes):
1. `prod_solicitud_upd_admin`: owner/admin pueden UPDATE cualquier solicitud (aprobar/gestionar). Antes solo SELECT.
2. `prod_embalaje_upd_coord` + `prod_embalaje_del_coord`: el coordinador `embalaje` puede UPDATE y DELETE sus propios registros (`cargado_por = auth.uid()`), **sin tope de 24h** (prod_embalaje no tiene `editable_hasta`).

**Por qué:** resuelve los 2 flags que quedaron de la Fase 1 (owner/admin no gestionaban solicitudes; embalaje no editaba lo propio).

**Cómo:** policies separadas permisivas (se OR-ean con las de 0071), patrón `current_user_role()`. Sin cambios de datos ni tablas.

**Resultado:** aplicada en prod (Management API), 3 policies verificadas. Sin smoke de datos (cambio solo de RLS).

---

### [2026-06-10] Producción en Línea — Fase 1 (tablas maestras + vistas)

**Qué se hizo:**
**Migration 0071** — base del módulo "Producción en Línea" (brief Sebas v2.0), todo bajo prefijo `prod_`, aislamiento total:
- **21 tablas** `prod_*`: maestras (pieza, placa, placa_pieza_extra, producto, receta, insumo), operación diaria (jornada, corte, melamina, embalaje, pino), stock por eslabón (stock_pieza/melamina/patas/terminado), soporte (solicitud, mantenimiento, remito, alerta, auditoria, pedido_estado).
- **5 vistas**: `prod_v_cortes_dia`, `prod_v_demanda_tap`, `prod_v_armables`, `prod_v_prioridad_melamina`, `prod_v_resumen_dia`.
- **Triggers**: updated_at (insumo + 4 stock), alerta de stock bajo, auditoría de UPDATE por encargado/owner/admin.
- **RLS** en las 21 tablas (70 policies) por `profiles.role`.

**Por qué / decisiones (validadas con Jefe):**
- **Roles vía `profiles.role`** (`current_user_role()`), NO app_metadata (adaptación al repo).
- **`producido` no existe en `orders`** → las vistas de demanda lo toman de **`carrier_state`** (LEFT JOIN channel_id+sku) = demanda NETA. Solo lectura.
- `orders.status` no tiene `'despachado'` → comparación `status::text <> 'despachado'` (segura).
- **Edge Function `import-skus` DIFERIDA a Fase 1b**: el Excel real (`sku para sistema.xlsx`) NO coincide con el parser del brief (pestañas "INSUMOS"/"sku x producto"/"SKU DE PLACAS DE CORTE CNC"/"SKU DE PRODUCTOS", y `prod_insumo` sin datos de stock/categoría/sector en el Excel). Pendiente alinear mapeo real.

**Detalles técnicos / interpretaciones:**
- CERO ALTER/DROP sobre tablas existentes (verificado). FKs a orders/auth.users no las modifican.
- Auditoría: `motivo`/`sector` se leen de GUC de sesión (`set_config('prod.audit_motivo',…,true)`); 1 fila por campo cambiado. Alerta: `critico` si stock < 50% del mínimo, `bajo` si < mínimo.
- `prod_embalaje` sin `editable_hasta` → el coordinador embalaje no hace UPDATE (solo encargado/owner/admin). `prod_solicitud`: encargado/owner/admin solo SELECT (tal cual el brief — pendiente confirmar si owner/admin debería gestionar).
- Vistas devuelven filas recién cuando haya datos en `prod_producto`/`prod_receta` (Fase 1b).

**Para qué sirve / resultado:**
- Migration 0071 **aplicada en prod** (Management API; no en `schema_migrations`).
- **Smoke OK** (owner Noelia, rollback, **0 datos sintéticos**): maestras + jornada + corte → `prod_v_cortes_dia` totales=498 → `prod_v_armables`=5 (LEAST 30 vs 20/4) → UPDATE corte dispara auditoría (`hojas:10>12`) → UPDATE insumo dispara alerta `critico`. Todo revertido.

**⚠️ PENDIENTE:** Fase 1b = Edge Function `import-skus` (alinear mapeo del Excel real). Push pendiente de OK del Jefe. (Frontend de Producción en Línea = fases siguientes.)

---

### [2026-06-10] S2.27 — Remitos B2B

**Qué se hizo:**
Módulo Remitos completo en Ventas → tab Remitos (nota de entrega B2B).
- **Migration 0070**: enum `remito_estado` (borrador/confirmado/anulado) + seq/`fn_next_numero_remito` (REM-xxxx) + tablas `remitos` (cliente_id, **pedido_id nullable**, fechas, condicion_entrega, transportista) y `remitos_items` (cantidad_remitida, precio_unitario ref, subtotal GENERATED) + triggers + RLS + **6 RPCs owner+admin**: list (items+cliente+pedido+progreso), create (valida SKU∈pedido), **update (solo borrador)**, confirmar (**cierre auto** del pedido a `entregado` al 100%), anular (**revierte** a `listo`), soft_delete.
- **Frontend** (`ventas.jsx`, `RemitosTab`): lista con KPIs/filtros/cards, modal con vínculo a pedido + pre-carga de pendiente (entrega parcial), vista detalle con **barra de progreso** + PDF (jsPDF + company_settings, "Recibí conforme"). Editar borradores. Foco a MayoristasTab.

**Por qué / decisiones:**
- RPCs **owner+admin** + period-check (consistente con S2.26).
- **Cierre automático**: al confirmar un remito con pedido_id, si la suma de remitido (todos los remitos confirmados del pedido) cubre cada ítem → pedido `entregado`. Al anular, si deja de estar 100% → vuelve a `listo`.
- `rpc_remitos_update` agregado a pedido del Jefe (editar borradores).

**Detalles técnicos:**
- RPCs vía `presRpc` (`window.SUPA.rpc`) desde ventas.jsx → **no toca admin-data.js** (solo ventas.jsx + HTMLs). Reusa `rpc_mayoristas_list_pedidos` (selector de pedidos), `getCompanySettings` (PDF), patrón `presupuestoPDF`.
- Over-delivery: cap client-side (backend valida SKU∈pedido, no cantidad). precio_unitario referencial (no toca stock — no hay stock en sku_catalog).
- Cache busters: ventas v6 (web+mobile). Validado: Babel transpila, espejos idénticos, 0 archivos admin/pages.

**Para qué sirve / resultado:**
- Migration 0070 **aplicada en prod** (Management API; no en `schema_migrations`).
- **Smoke OK** (owner Noelia, rollback, **0 datos sintéticos**): pedido 'listo' (sku1=10, sku2=5) → remito1 parcial (editado 3→4 vía update) → confirmar (NO cierra) → remito2 completa → confirmar (**pedido → entregado**) → anular remito2 (**pedido → listo**). Secuencias REM/MAY reseteadas.

**⚠️ PENDIENTE:** redeploy EasyPanel. Push pendiente de OK del Jefe.

---

### [2026-06-10] S2.26 — Presupuestos B2B

**Qué se hizo:**
Módulo Presupuestos completo en Ventas → tab Presupuestos.
- **Migration 0069**: enum `presupuesto_estado` (borrador/enviado/aceptado/rechazado/vencido) + seq/`fn_next_numero_presupuesto` (PRES-xxxx) + tablas `presupuestos` (fecha_validez GENERATED = emisión+dias_validez, descuento_global, pedido_id) y `presupuestos_items` (descuento_pct, subtotal GENERATED) + triggers + RLS + **5 RPCs owner+admin**: list (auto-vence + items + totales), create, update (solo borrador), update_estado (al aceptar genera pedido_mayorista), soft_delete.
- **Frontend** (`ventas.jsx`, `PresupuestosTab`): lista con KPIs + filtros + cards, modal con ítems y cálculo live (subtotal/descuentos/total), vista detalle con acciones por estado y **PDF** (jsPDF + company_settings). Foco a `MayoristasTab` para "Ver pedido generado".

**Por qué / decisiones (validadas con Jefe):**
- **RPCs owner+admin** (Ventas operado por admins con permiso 'ventas'). RLS SELECT owner+admin / write owner-only (mismo patrón que pedidos_mayoristas).
- **Al aceptar**, el pedido generado usa **precio efectivo** = precio × (1-dto_item/100) × (1-dto_global/100) → **TOTAL pedido == TOTAL presupuesto** (el pedido no tiene campos de descuento).

**Detalles técnicos:**
- Las RPCs se llaman con `window.SUPA.rpc(...)` desde ventas.jsx → **no se tocó admin-data.js** (solo ventas.jsx + HTMLs). Funciones reusadas: set_updated_at, trg_audit_log, _admin_check_periodo_cerrado, fn_next_numero_pedido_mayorista, getCompanySettings.
- "Ver pedido generado": abre la ficha en MayoristasTab solo si el cliente es mayorista; si no, toast (el detalle igual muestra `pedido_numero`). Pedido nace en estado `confirmado`. Period-check en create (emisión) y accept (hoy).
- Cache busters: ventas v5 (web+mobile). Validado: Babel transpila, espejos idénticos, 0 archivos admin/pages tocados.

**Para qué sirve / resultado:**
- Migration 0069 **aplicada en prod** (Management API; no en `schema_migrations`, igual que 0065-0068).
- **Smoke OK** (owner Noelia, `DO`+`RAISE EXCEPTION` → rollback, **0 datos sintéticos**): cliente+presupuesto (2 ítems, dto item 20% + dto global 10%) → subtotal 18000, total 16200 → aceptar → pedido MAY con total 16200 (**match con el presupuesto**). Secuencias PRES/MAY reseteadas a 1.

**⚠️ PENDIENTE:** redeploy EasyPanel. Push pendiente de OK del Jefe.

---

### [2026-06-10] S2.25 — Ventas: Alta clientes B2B + Cta cte + Base de productos

**Qué se hizo:**
3 tabs reales en `VentasPage` (reemplazan los placeholders), todos con estilo premium MAY_UI (igual que Mayoristas):
1. **Alta y mod. clientes** (`ClientesB2BTab`): KPIs (activos/mayoristas/nuevos del mes), search + filtro provincia + toggles (solo mayoristas / inactivos), tabla con badges Mayorista/Cliente + Activo/Inactivo, acciones Editar / Ver cta cte (cross-tab) / Desactivar. Modal = `CustomerModal`.
2. **Cta cte clientes** (`CtaCteClientesTab`): KPIs (cuentas/a favor/en contra), cards por cliente con saldo (verde/rojo), expand → tabla de movimientos con badges por tipo + alta/edición/baja. Modal = `CtaCteMovementModal`.
3. **Base de productos** (`BaseProductosTab`): KPIs (activos/incompletos/fabricados/comprados) + badges por categoría, search + filtros, toggle Tabla/Galería, chip de color (color_hex), editar / activar-desactivar. Modal = `ProductoEditModal`.

**Por qué / decisión clave:**
El brief pedía "reusar CustomersTab/CuentasCorrientesTab" pero a la vez un UI premium (KPIs, MAY_UI, Ver-cta-cte) que esos componentes no tienen. Se resolvió (validado con Jefe): **construir tabs nuevos en ventas.jsx reusando la CAPA DE DATOS (`ADMIN_DATA`/`SUPA`/`MOCK_ACTIONS`) y los MODALES existentes, sin tocar los componentes admin.**

**Cómo (detalles técnicos / desvíos):**
- **NO se modificó** ningún archivo `admin/` ni `pages.jsx` (solo `ventas.jsx` web+mobile + cache busters). Cero migration, cero RPC nuevo.
- Tab 2 tipos reales `cargo/pago/ajuste/devolucion` (el modal no tiene `nota_credito`). **"Nueva cuenta" omitida** (cada cliente B2B ya recibe su cta cte al crearse). `referencia_externa` se muestra pero el modal reusado no la setea. "Último movimiento" → se muestra `updated_at` en la card y los movimientos al expandir (evita N+1); localidad traída con un load extra de clientes.
- Tab 3 lee `sku_catalog` fresco vía `window.SUPA` (no `SKU_DB`, que no expone `incompleto` y tiene nombres de display). El toggle activo usa valores oficiales de la fila para no corromper modelo/color. Alta/edición vía `ProductoEditModal` + `crearOActualizarSku` (mismo path que CatalogoPage).
- Desactivar cliente: se pasan los campos completos (el RPC update setea email/telefono/notas incondicionalmente).
- "Ver cta cte" levanta estado en VentasPage (`ctaCteFocus`) → cambia a tab cta-cte y expande esa cuenta.
- Cache busters: ventas v4 (web+mobile). Validado: Babel transpila, espejos idénticos.

**Para qué sirve / resultado:** Ventas pasa a tener 4 tabs funcionales (Mayoristas + estos 3). Requiere redeploy. Smoke visual pendiente del Jefe (no se hizo smoke con datos sintéticos).

**⚠️ PENDIENTE:** redeploy EasyPanel.

---

### [2026-06-09] S2.24b — Dashboard de producción para Esteban y Romina (per-usuario)

**Qué se hizo:**
Dar acceso al **Dashboard de producción + canales + producción + histórico** a los admins **Esteban Fernandez** y **Romina Puscama** únicamente (no a Mikeas ni Doble Click).

**Por qué (y qué NO era el problema):**
El supuesto inicial (falta `dashboard` en ROLE_NAV admin / hay guard owner-only) era falso: `dashboard` ya estaba en `ROLE_NAV.admin`, no hay guard owner-only en [app.jsx](web/components/app.jsx) y `dashboard.jsx` ya habilita admin (`puedeAdmin = ['owner','admin','encargado']`). El verdadero freno es el modelo S2.22 "reemplazo total": un admin permisionado solo ve `allowedNavSet()` = `PERM_ALWAYS_VISIBLE` ∪ módulos mapeados.

**Cómo (per-usuario, sin tocar a los otros admins):**
1. **BD** — INSERT en `user_module_permissions` de los módulos `dashboard, colecta, flex, tiendanube, distribuidor, no_flex, correo_argentino, produccion-hub, registrar, historico` para los `user_id` de Esteban (`cbc2491d…`) y Romina (`cd85b4a8…`) **solamente** (`ON CONFLICT DO UPDATE` idempotente). Mikeas/DobleClick intactos.
2. **Frontend** — `allowedNavSet()` (data.js web+mobile) ahora tiene un **fallback genérico**: si un módulo no está en `MODULE_TO_NAV`, el nombre del módulo **es** el navId. Sin esto, los módulos nuevos (dashboard/canales/historico) eran inertes. **NO se tocó `PERM_ALWAYS_VISIBLE`** (descartado porque es global = afectaría a TODOS los admins).

**Detalles técnicos:**
- Se descartó el primer enfoque (agregar producción a `PERM_ALWAYS_VISIBLE`) porque aplica a todos los admins.
- El fallback es future-proof: cualquier módulo cuyo nombre coincida con un navId se habilita por usuario vía la tabla, sin tocar el mapa.
- Cache busters: data.js web v43, mobile v42. Sin migration, sin RPC nuevo.
- Estado intermedio seguro: con la BD lista pero el frontend viejo deployado, el `allowedNavSet` anterior ignora los módulos no mapeados → nadie ve nada roto hasta el redeploy.

**Resultado:** Esteban y Romina ven y operan el dashboard igual que owner (jornada/+producir/exportar/entrar a canales). Mikeas (solo produccion) y DobleClick (solo marketing) sin cambios. Requiere redeploy.

---

### [2026-06-08] Carga masiva de SKUs desde Excel

**Qué se hizo:**
Se cargaron 77 SKUs nuevos al catálogo (`sku_catalog`) desde el archivo `sku para sistema.xlsx` (4 hojas). También se creó la categoría `CNC` en `sku_categories`.

**Conteo post-carga:**
| Categoría | SKUs |
|---|---|
| ACCESORIOS | 72 |
| CNC | 29 |
| Mesas | 17 |
| Ratonas | 8 |
| Luz | 1 |
| Recibidoras | 1 |
| **TOTAL** | **128** |

**Nuevos SKUs por grupo:**
- **Mesas individuales nuevas**: MAD010–MAD041 (redonda 30/40, boomerang, gota XL — blanco y negro)
- **Ratonas nuevas**: MAD350–MAD351 (SET DOBLE BOOM blanco y negro)
- **TAP nuevas**: TAP013–TAP026 (todas las tapas faltantes: gota grande/chica/XL, yori, hikari, rectangular, marmol)
- **SOP nuevos**: SOP003–SOP008 (soportes x3/x4/x6 blanco y negro)
- **KIT nuevos**: KIT006–KIT009 (hikari x1/x2 + M50 blanco/negro)
- **AGU nuevas**: AGU004–AGU008 (tapas tornillos hikari y yori variantes color)
- **FIL nuevos**: FIL001–FIL002 (filos blanco y negro)
- **CAJ nuevas**: CAJ001–CAJ004 (cajas N°1 a N°4, `es_fabricado=false`)
- **VAR nuevas**: VAR001–VAR002 (varillas 14mm y 25mm, `es_fabricado=false`)
- **TOR nuevos**: TOR005–TOR008 (variantes rectangulares y set)
- **CNC Placas Blancas**: PLB001–PLB010
- **CNC Placas Negras**: PLN001–PLN010
- **CNC Mármol Blanco**: PMB001, PMB002, PMB005
- **CNC Mármol Negro**: PMN001, PMN002
- **CNC Combinadas**: COM001–COM004

**Cómo se hizo:**
Se leyó el `.xlsx` vía Node.js con la librería `xlsx` (instalada en `C:\Temp\xlsxtmp`). Se cruzó contra el contenido actual de `sku_catalog` para identificar los 77 SKUs nuevos. Se ejecutó un `INSERT ... ON CONFLICT (sku) DO NOTHING` para ser idempotente.

**Decisiones tomadas:**
- MAD350/351 → categoría `Ratonas` (igual que MAD301-304 que son sets de boomerang)
- KIT006/007 agregados aunque KIT004/005 tienen el mismo nombre (el usuario lo confirmó)
- CNC plates agregados (el usuario lo confirmó)
- `es_fabricado=false` para CAJ y VAR (son insumos comprados, no fabricados)
- TOR005-008 usan las primeras definiciones del Excel (variantes rectangular/set) ya que TOR005/006/007 aparecen duplicados con nombres distintos en el documento fuente — revisar con Seba si hace falta corregir alguno

---

### [2026-06-03] Reset operativo completo — "app como nueva"

**Qué se hizo:**
Se borró toda la data operativa de la base de datos de producción (`ditmbqkvzreekqnkimqv`), dejando la app en estado "día 0" como si acabara de lanzarse.

**Por qué se hizo:**
Sebastián (dueño de Justo Makario) lo solicitó explícitamente para hacer un estreno limpio de la aplicación.

**Cómo se hizo:**
SQL ejecutado directamente vía MCP de Supabase en una sola transacción (`BEGIN ... COMMIT`). El orden de DELETE respetó las FK constraints:

```sql
BEGIN;
-- Leafs primero (referencian orders/jornadas)
DELETE FROM public.agent_conversations;
DELETE FROM public.notifications;
DELETE FROM public.qr_scans;
DELETE FROM public.order_edit_log;
DELETE FROM public.jornada_audit;
-- Operación independiente
DELETE FROM public.production_logs;
DELETE FROM public.carrier_state;
DELETE FROM public.free_stock;
-- Después de limpiar dependencias
DELETE FROM public.orders;
DELETE FROM public.import_batches;
DELETE FROM public.jornadas;
COMMIT;
```

**Para qué sirve / resultado:**
- Todas las tablas operativas quedaron en 0 filas (verificado con COUNT post-ejecución).
- SKUs, channels, profiles, role_permissions y todo el módulo Admin (Noe) quedaron **intactos**.
- La app está lista para que Seba importe el primer lote del día y empiece desde cero.

**Decisiones tomadas:**
- Se mantuvo el módulo Admin completo (suppliers, employees, expenses, etc.) porque Seba aclaró que el reset era solo de la parte operativa (producción/ventas), no de finanzas/RRHH.
- No se tocó Storage (archivos Excel de importaciones anteriores permanecen en bucket — no afectan la operación nueva).

---

### [2026-06-03] Sprint S2.21b — Sidebar completo según diagrama Sebas

**Qué se hizo:**
1. **Contabilidad → Finanzas**: renombrado `ContabilidadPage` a `FinanzasPage`, alias retro-compat `window.ContabilidadPage = FinanzasPage`. Tab "Plan de cuentas" (Próximamente) agregado. Orden: [Cash Flow] [Plan de cuentas] [Egresos/Compras] [Cheques].
2. **RRHH**: tab "Gestión hs extras" (Próximamente) en posición 3. Orden: [Empleados] [Recibos] [Gestión hs extras] [Reportes salariales].
3. **Ventas**: módulo nuevo (`ventas.jsx`) con 9 tabs todos Próximamente. Ícono: `store` (SVG nuevo).
4. **Marketing**: módulo nuevo (`marketing.jsx`) con 2 tabs Próximamente. Ícono: `megaphone` (SVG nuevo).
5. **ProximamentePlaceholder**: componente reutilizable en `shared.jsx` (`window.ProximamentePlaceholder`).
6. **Sidebar** sección Gestión reordenada: Administración → Ventas → Finanzas → RRHH → Marketing.
7. **FEATURE_ADMIN gate** extendido a todos los ítems de Gestión (antes solo `administracion`).
8. **ROLE_NAV owner** actualizado: `contabilidad` → `finanzas`, + `ventas` + `marketing`.
9. **app.jsx**: routing `finanzas`/`ventas`/`marketing` + compat legacy `contabilidad` y `cash-flow`.

**Por qué se hizo:**
Sebastián mandó diagrama de la estructura completa del sistema. El sprint anterior S2.21 había creado Administración + Contabilidad + RRHH. Este sprint completa la visión.

**Cómo se hizo:**
Cambios puramente frontend. Cero BD, cero RPCs. Archivos tocados:
- `web/components/shared.jsx` → íconos `store`/`megaphone` + `ProximamentePlaceholder`
- `web/components/styles.css` → `.proximamente-placeholder` CSS
- `web/components/contabilidad.jsx` → rename FinanzasPage + tab nuevo
- `web/components/rrhh.jsx` → tab hs extras
- `web/components/ventas.jsx` → NUEVO (9 tabs)
- `web/components/marketing.jsx` → NUEVO (2 tabs)
- `web/components/sidebar.jsx` → nuevo orden + íconos
- `web/components/app.jsx` → routing + compat legacy
- `web/components/data.js` → ROLE_NAV owner
- `web/Macario Lite.html` → cache busters + nuevos script tags
- Paridad bit-perfect en todos los equivalentes `mobile/`

**Para qué sirve / resultado:**
La sección Gestión del sidebar tiene los 5 módulos del diagrama de Seba. Ventas y Marketing son placeholders visuales listos para rellenar en sprints futuros. El alias retro-compat garantiza que ningún bookmark viejo rompa.

**Decisiones tomadas:**
- `store` y `megaphone` no existían como íconos → SVGs nuevos mínimos en shared.jsx.
- `FEATURE_ADMIN` gate extendido a todos los ítems de Gestión para consistencia.
- Mobile `app.jsx` NO se tocó: no tiene routing a páginas admin (estructura BottomBar diferente). Los `.jsx` de los módulos son idénticos en web y mobile.
- Commit: `dc9243c`

---

### [2026-06-03] Sprint S2.21b addendum — ProduccionHub

**Qué se hizo:**
- Módulo `ProduccionHubPage` (`produccion-hub.jsx`): wrapper con 4 tabs que agrupa la sección Producción del diagrama de Seba.
  - Tab 1: **Producción** → renderiza `window.ProduccionPage` sin tocarlo
  - Tab 2: **Stock** → renderiza `window.StockPage` sin tocarlo. **Solo visible para owner/admin/encargado** (guard de rol en cliente). Operarios ven 3 tabs.
  - Tab 3: **Fe fábrica** → Próximamente
  - Tab 4: **Línea productiva** → Próximamente
- Sidebar: reemplaza `produccion` y elimina `stock` standalone → 1 ítem `produccion-hub`. `Registrar producción` se mantiene como shortcut separado.
- ROLE_NAV: todos los roles con `produccion` → `produccion-hub`. Landing de encargado/operarios: `produccion` → `produccion-hub`. `stock` eliminado de todos los items.
- app.jsx: case `produccion-hub` + compat legacy `produccion` y `stock` → hub.

**Por qué se hizo:**
Jefe aclaró que Producción del diagrama de Sebas tiene 4 sub-items. Se agregó después del commit S2.21b inicial.

**Cómo se hizo:**
El hub NO tiene su propio `<div className="page">` header — renderiza los componentes existentes directamente sin wrapper de página, para evitar header duplicado. El guard de rol se implementa filtrando el array TABS antes de renderizar.

**Decisiones clave (validadas con Jefe antes de implementar):**
- Tab Stock oculto para operarios (cnc, melamina, pino, embalaje, logistica, carpinteria) por diferencia de permisos en ROLE_NAV.
- `Registrar producción` se mantiene como ítem separado en sidebar (shortcut directo a ProduccionPage).
- `StockPage` tiene prop `onBack` opcional — dentro del hub se omite (no se pasa), por lo que el botón "← Volver" no aparece (React conditional `{onBack && ...}`).
- Commit: `11aab2a`

---

### [2026-06-05] Sprint S2.22 — Cuentas de usuario con permisos por módulo

**Qué se hizo:**
1. **Tabla `user_module_permissions`** (migration 0065): `(user_id, module, can_access)` con UNIQUE(user_id, module), RLS, trigger de audit y 2 RPCs.
2. **2 RPCs nuevos**: `rpc_admin_get_user_permissions(payload)` (owner+admin, lee permisos de un usuario) y `rpc_admin_upsert_user_permissions(payload)` (owner-only, reemplaza el set de permisos de un usuario).
3. **5 cuentas nuevas** (`@justomakario.app`, pass `Makario2026`): Noelia Castillo (owner), Esteban Fernandez / Romina Puscama / Mikeas Romero / Doble Click (admin). Creadas vía `scripts/create_users_s2_22.js` (Admin API + service role).
4. **Seed de permisos**: Esteban→[administracion,ventas,produccion]; Romina→[administracion,ventas,produccion,finanzas_egresos]; Mikeas→[produccion]; DobleClick→[marketing]; Noelia→sin filas (owner ve todo por rol).
5. **Frontend — modelo "reemplazo total"**: un admin CON filas de permisos ve EXCLUSIVAMENTE sus módulos + Perfil/Notificaciones. Sidebar (web) y BottomBar (mobile) filtran por `effectiveNavSet()`. Guards de routing en ambos `app.jsx` usan `canSeeNav()`. Landing del admin permisionado → su primer módulo (`firstAllowedNav()`), no dashboard.
6. **FinanzasPage egresos-only**: Romina (permiso `finanzas_egresos` sin `finanzas` full) ve SOLO la tab Egresos/Compras (`finanzasEgresosOnly()`).

**Por qué se hizo:**
Sebas/Jefe necesitan cuentas reales con acceso acotado por área: cada admin solo ve los módulos de su responsabilidad. Owner (Noelia) sin restricciones.

**Cómo se hizo:**
- Toda la lógica de permisos vive en `data.js` (compartida web/mobile, expuesta en `window`): `isPermissionedAdmin()`, `allowedNavSet()`, `effectiveNavSet()`, `canSeeNav()`, `firstAllowedNav()`, `finanzasEgresosOnly()`, `loadMyPermissions()`, `MODULE_TO_NAV`, `PERM_ALWAYS_VISIBLE`.
- `loadMyPermissions()` se llama en bootstrap()/boot() tras loadProfile() (solo si role==='admin'); guarda en `MOCK.userPermissions` + `window.userPermissions`. `logout()` los limpia.
- **Mapeo módulo→nav**: `produccion`→(produccion-hub, registrar, produccion); `finanzas`/`finanzas_egresos`→finanzas; resto 1:1.
- **Fail-open**: admin SIN filas (o si el RPC falla) → ve todo su ROLE_NAV (comportamiento previo intacto). El filtro solo aplica con ≥1 fila.
- Archivos: `supabase/migrations/0065_*.sql`, `scripts/create_users_s2_22.js` + `seed_permissions_s2_22.sql` + `package.json`, `web|mobile/components/{data.js,contabilidad.jsx}`, `web/components/{sidebar.jsx,app.jsx}`, `mobile/components/{bottombar.jsx,app.jsx}`, cache busters en ambos HTML.

**Para qué sirve / resultado:**
Noelia ve todo; Esteban Admin+Ventas+Producción; Romina lo mismo + Finanzas (solo Egresos); Mikeas solo Producción; DobleClick solo Marketing. Migration aplicada y usuarios creados en prod (verificado a nivel data). **Login con EMAIL completo** (no username).

**Decisiones técnicas (divergencias del brief, validadas con Jefe):**
- Trigger de audit real es `trg_audit_log()` (no `fn_audit_log()` del brief).
- **RLS de ESCRITURA = owner-only** (no owner+admin del brief): evita que un admin se auto-asigne módulos vía PostgREST. SELECT queda owner+admin. Único path de escritura: RPC owner-only + seed por service_role.
- `username` con guión bajo (`esteban_fernandez`) por CHECK `^[a-z0-9_]{3,32}$`; el profile se auto-crea por trigger `handle_new_user` desde user_metadata (el script NO inserta profiles).
- Noelia = 3er owner (ya había 2 en la BD) — confirmado por Jefe.
- **Mobile**: los 5 son usuarios web. El filtro funciona en mobile, pero módulos sin pantalla mobile (administracion/finanzas/ventas) hacen caer al admin permisionado a Producción/Avisos/Perfil. Documentado, fuera de scope.

**⚠️ PENDIENTE (acción del Jefe):**
- **Redeploy de EasyPanel**: el frontend con permisos NO está live hasta redeploy. Hasta entonces los nuevos admins ven el ROLE_NAV de admin completo (incluida Administración). El backend (migration + usuarios) YA está en prod.
- **Sin push** todavía (commit pendiente de OK).

---

### [2026-06-06] Sprint S2.23 — Módulo Mayoristas

**Qué se hizo:**
1. **Migration 0066**: columnas `es_mayorista`/`localidad`/`provincia` en `customers_b2b`; enum `pedido_mayorista_estado` (cotizacion→confirmado→en_produccion→listo→entregado→cancelado); tablas `pedidos_mayoristas` + `pedidos_mayoristas_items`; secuencia + `fn_next_numero_pedido_mayorista()` (MAY-0001…); triggers updated_at + audit; RLS; 4 RPCs mayoristas; y **extensión** de `rpc_admin_create_customer_b2b` / `rpc_admin_update_customer_b2b`.
2. **Ventas → Clientes mayoristas** (`ventas.jsx`): `MayoristasTab` con 2 vistas — lista de mayoristas (cards, búsqueda, "+ Nuevo mayorista") → ficha (datos + "+ Nuevo pedido" con modal de ítems/total + lista de pedidos con badges de estado y cambio de estado).
3. **Producción** (`produccion.jsx`): `MayoristasEnProduccion` — card en el tab **Distribuidores** (solo owner/admin) con pedidos `confirmado`/`en_produccion` y botón "Marcar como listo" (owner).
4. **Administración → Clientes** (`admin/customers-tab.jsx` + `admin/customer-modal.jsx`): badge **MAYORISTA** + toggle "Es mayorista" + localidad + provincia (dropdown ARG_PROVINCIAS).
5. **admin-data.js**: `COLS_CUSTOMER` ampliado + 4 wrappers (`loadMayoristas`, `createPedidoMayorista`, `updateEstadoPedidoMayorista`, `listPedidosMayoristas`).
6. Espejos mobile bit-perfect + cache busters en ambos HTML.

**Por qué se hizo:**
Conectar Ventas (gestión de mayoristas + pedidos) → Producción (qué fabricar) en un flujo de estados. (Stock/descuento al entregar = S2.23b.)

**Cómo se hizo (detalles técnicos / decisiones):**
- **Permisos**: list/list_pedidos = owner+admin; create_pedido/update_estado = **owner-only**. RLS de pedidos: SELECT owner+admin, escritura **owner-only** (un admin no crea pedidos por PostgREST directo). Mismo criterio que S2.22.
- **Gap del brief corregido**: los RPCs de cliente listan columnas explícitas → se extendieron (aditivo) para persistir es_mayorista/localidad/provincia. En el UPDATE se usa el operador `?` (existencia de key) para que `desactivar`/`reactivar` (que no mandan esos campos) **no los pisen**.
- **`set_updated_at()`** (no `fn_set_updated_at` del brief, inexistente).
- **Producción**: la card sólo fetchea para owner/admin (la RPC es owner+admin; un operario daría "Sin permiso"). `MayoristasEnProduccion` es autocontenida (mapa de estados local) para no depender de `ventas.jsx` (carga después).
- **MayoristasTab/pedido-modal viven inline en `ventas.jsx`** (no nuevos archivos → menos script tags). El SKU dropdown sale de `window.SKU_DB` (activos). "Nuevo mayorista" reusa `CustomerModal` con prop `defaultMayorista`.
- Cache busters: web admin-data v17, customer-modal v2, customers-tab v4, ventas v2, produccion v16 · mobile: admin-data v17, customer-modal v2, customers-tab v4, ventas v2, produccion v4.

**Para qué sirve / resultado:**
- Migration 0066 **aplicada en prod** (vía Management API; igual que 0065, **no figura en `supabase_migrations.schema_migrations`** — DB tiene los objetos, el registro CLI no).
- **Smoke OK** (como owner Noelia, en bloque `DO` con `RAISE EXCEPTION` → rollback total, **0 datos sintéticos commiteados**): crear mayorista → list lo incluye → pedido 2 ítems (total 12500) → cotización→confirmado→en_producción→listo → visible en Producción. Secuencia reseteada a MAY-0001.

**⚠️ PENDIENTE:**
- **Descuento de stock al entregar → S2.23b** (sku_catalog sin columna de stock).
- **Redeploy EasyPanel** para activar el frontend.
- **Push** pendiente de OK del Jefe.

---

### [2026-06-06] S2.23 patch1 — Rediseño UI MayoristasTab + soft delete

**Qué se hizo:**
1. **Migration 0067**: `rpc_mayoristas_delete(jsonb)` — owner-only, soft delete (`activo=false`) de un mayorista (solo si `es_mayorista`). No borra físico (preserva pedidos/cta cte).
2. **Rediseño completo de MayoristasTab** (`ventas.jsx`, web + espejo mobile):
   - **Lista**: grilla responsive de cards (auto 2-col/1-col vía `minmax(320px,1fr)`), fondo `#F9FAFB`, cards blancas borde `#E5E7EB` radius 12, **sombra en hover** (estado React + transición 0.15s), badge "N pedidos", botones "Ver ficha" + "Eliminar" (ghost rojo, owner), search, empty state.
   - **Eliminar**: `window.ConfirmModal` → `rpc_mayoristas_delete` → **fade-out** (opacity+scale, 180ms) → quita la card del state.
   - **Ficha**: header card limpio (nombre 24px + Volver/Editar) + chips 📍📞✉️🪪 + pedidos como cards full-width (número + badge estado + fecha / resumen / total + "Ver detalle" expandible / "Cambiar estado" owner).
   - **Badges de estado** recoloreados (entregado = verde sólido `#065F46` texto blanco).
3. **admin-data.js** (web+mobile): wrapper `deleteMayorista()` + export.

**Por qué se hizo:**
Patch de UX sobre S2.23 ya deployado: look premium/moderno + poder dar de baja mayoristas.

**Cómo se hizo (detalles técnicos / decisiones):**
- **Hover/fade/transiciones inline** (estado React + `transition`), sin tocar CSS files → bit-perfect web/mobile sin cache buster de CSS.
- **Badge "N pedidos" client-side**: 1 fetch de `listPedidosMayoristas({})` al cargar la lista, agrupado por `cliente_id` (cuenta todos los pedidos del mayorista). El brief no extendió `rpc_mayoristas_list`, así que no se tocó backend.
- `deleteMayorista` agregado en admin-data (el brief solo listaba ventas.jsx).
- Cache busters: web ventas v3, admin-data v18 · mobile ventas v3, admin-data v18.
- Validación: 8/8 JSX transpilan con Babel; props de `ConfirmModal` verificadas contra `modals.jsx`.

**Para qué sirve / resultado:**
- Migration 0067 **aplicada en prod** (Management API; no figura en `schema_migrations`, igual que 0065/0066).
- **Smoke OK** (owner Noelia, `DO`+`RAISE EXCEPTION` → rollback, 0 datos sintéticos): crear mayorista → `activo` true → `rpc_mayoristas_delete` → `activo=false` → desaparece de `rpc_mayoristas_list`. Dato real intacto (1 mayorista real activo creado por el Jefe vía app post-redeploy).

**⚠️ PENDIENTE:** redeploy EasyPanel para activar el frontend nuevo.

---

### [2026-06-06] S2.23 patch2 — Fix: cliente borrado seguía en Cuentas Corrientes

**Qué se hizo:**
`loadCustomersWithCredit` (admin-data.js, web+mobile) ahora **excluye clientes inactivos** (`customers_b2b.activo=false`).

**Por qué:**
Bug reportado por el Jefe: al borrar un mayorista en Ventas (soft delete `activo=false`), la pestaña **Administración → Cuentas Corrientes → Clientes B2B** lo seguía mostrando (era la única vista que no filtraba por `activo`; la lista de Mayoristas y la pestaña Clientes ya lo ocultaban). Caso: "Aaron Leal" (activo=false, saldo 0) seguía visible.

**Cómo:**
Se agrega `activo` al embed `customers_b2b(...)` y se filtra client-side `r.customers_b2b.activo !== false` (robusto, sin cambiar la semántica del join). Sin migration. Cache busters: admin-data v19 (web+mobile).

**Resultado:** un cliente dado de baja desaparece de TODAS las vistas. El soft delete se preserva en BD (recuperable con "Reactivar" en la pestaña Clientes; el saldo de cta cte, si lo hubiera, queda registrado). Requiere redeploy.

---

### [2026-06-07] Sprint S2.24 — Gestión de horas extras

**Qué se hizo:**
1. **Migration 0068**: `employees.valor_hora_extra numeric(10,2)`; tabla `horas_extras` (con `total`/`periodo_mes`/`periodo_anio` GENERATED STORED, `liquidado`, `recibo_id`, soft delete `activo`) + índices + triggers (updated_at + audit) + RLS; **5 RPCs** (list/create/delete/reporte/update_valor_hora) + **extensión de `rpc_admin_create_employee` y `rpc_admin_update_employee`** para persistir `valor_hora_extra`.
2. **RRHH → Gestión hs extras** (`rrhh.jsx`, `HsExtrasTab`): reemplaza el placeholder. Dos paneles responsive — **Registro** (selector empleado con badge de valor/hora + mini-modal "Editar valor/hora", fecha, horas, valor editable, total en vivo verde, descripción) y **Historial** (filtros mes/año/empleado/solo-pendientes, lista con badge Pendiente/Liquidado, eliminar con ConfirmModal solo si no liquidada, totalizador). **Reporte mensual** (tabla por empleado expandible + totales + export PDF jsPDF + volver).
3. **RRHH → Empleados**: campo "Valor hora extra ($)" en la sección Liquidación del modal (`employee-modal.jsx`).
4. **admin-data.js**: 5 wrappers (`listHorasExtras`, `createHoraExtra`, `deleteHoraExtra`, `reporteHsExtras`, `updateValorHoraEmpleado`) + exports.
5. Espejos mobile bit-perfect + cache busters.

**Por qué se hizo:**
Reemplazar el placeholder de hs extras con gestión real (registro, historial, reporte mensual liquidable).

**Cómo se hizo (detalles técnicos / decisiones):**
- Funciones reales verificadas: `set_updated_at`, `trg_audit_log`, `_admin_check_periodo_cerrado` (el brief acertó los nombres esta vez).
- **valor_hora**: del payload (editable por registro) con **fallback** al `valor_hora_extra` del empleado si no se pasa. No se deriva del sueldo.
- **Extendí create_employee además de update** (el brief solo mencionaba update) — necesario para que el campo persista en alta.
- RLS owner+admin (helper `is_owner_or_admin()`). RRHH es owner-only en la nav → en la práctica solo el owner usa el tab.
- `HsExtrasTab` inline en `rrhh.jsx` (sin archivos nuevos); estándar visual premium (cards, total verde, badges, hover).
- Cache busters: rrhh v3, admin-data v20, employee-modal v3 (web+mobile).
- Validado: 4/4 JSX transpilan con Babel; admin-data `node --check`; espejos mobile idénticos.

**Para qué sirve / resultado:**
- Migration 0068 **aplicada en prod** (Management API; no figura en `schema_migrations`, igual que 0065-0067).
- **Smoke OK** (owner Noelia, `DO`+`RAISE EXCEPTION` → rollback, **0 datos sintéticos**): empleado con valor 1500 → he1 3×2000=6000, he2 2×(fallback 1500)=3000 → list=2 → reporte 5hs/$9000 → delete he1 → list=1. Todo revertido.

**⚠️ PENDIENTE:** redeploy EasyPanel para activar el frontend nuevo. (Liquidación de hs extras → recibos: `recibo_id`/`liquidado` ya están en el modelo, la UI de liquidar queda para sprint futuro.)

---
