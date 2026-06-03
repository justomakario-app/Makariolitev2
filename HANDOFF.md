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
