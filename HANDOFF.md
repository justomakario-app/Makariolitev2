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
