# INFORME TÉCNICO — MACARIO LITE

**Documento de handoff para construcción de backend en Supabase.**
Generado a partir del código frontend completo. Cada sección está pensada para que Claude Code pueda actuar sin pedir clarificaciones.

---

## 1. RESUMEN EJECUTIVO DE LA APP

**Macario Lite** es un sistema interno de gestión de producción y embalaje para una fábrica de muebles de madera (Justo Makario). Resuelve el problema de coordinar múltiples canales de venta — Mercado Libre Colecta, Mercado Libre Flex, Tienda Nube y distribuidores mayoristas — contra una única operación de fabricación, donde cada canal tiene su propio horario de cierre, su propio formato de pedidos (archivos Excel exportados desde cada plataforma), y su propio nivel de urgencia.

El núcleo del sistema gira alrededor del **SKU como fuente de verdad**. Cada pedido entrante (de cualquier canal) se traduce a un SKU del catálogo interno, que resuelve automáticamente modelo, color y categoría. Los operarios de los distintos sectores (CNC, Melamina, Pino, Embalaje) registran producción contra ese SKU, y la app gestiona en tiempo real el faltante por canal, el stock excedente acumulado, y los cierres de jornada (Colecta cierra 12:00, Flex cierra 14:00 — al cerrar se archivan los completados y se arrastra el faltante al día siguiente).

Los usuarios son: **Propietarios** (Sebastián, Noe — vista 360°), **Encargado General** (Miqueas — vista de producción consolidada), y **operarios de sector** (Federico embalaje, Max CNC, Gabriel melamina, Matías pino, etc. — vista limitada a su trabajo). Hay también roles de **Logística**, **Administración**, **Ventas**, **Marketing** y **Carpintería** previstos.

---

## 2. STACK TÉCNICO Y ESTRUCTURA

### Frontend actual (artefacto HTML estático)

- **Framework UI**: React 18.3.1 (UMD development build, sin bundler)
- **Transpilación**: Babel Standalone 7.29.0 (in-browser, JSX → JS en cliente)
- **Tipografía**: Plus Jakarta Sans + JetBrains Mono (Google Fonts)
- **Sin gestor de paquetes ni build tool** — todos los scripts cargados con `<script>` directos desde la HTML raíz
- **Persistencia actual**: ninguna. Todo el estado vive en `window.MOCK` (objeto en memoria) y se pierde al recargar
- **Reactividad**: bus pub/sub propio (`window.MOCK_BUS`) que emite cambios y obliga a los componentes a re-renderizar via hook `useMockData()`

> **Nota para el backend**: el target es portar este frontend a una arquitectura React + Supabase manteniendo los mismos componentes, pero reemplazando `window.MOCK` y `MOCK_ACTIONS` por llamadas al cliente Supabase. El siguiente stack de migración es recomendado:
> - **Build**: Vite + React 18 + TypeScript
> - **Cliente Supabase**: `@supabase/supabase-js` v2
> - **Routing**: React Router v6 (la app ya tiene navegación por estado, fácil de portar)
> - **Estado server**: TanStack Query (React Query) para cache + invalidación
> - **Realtime**: canal `postgres_changes` de Supabase para `orders`, `production_logs`, `carrier_rows`

### Árbol de archivos del frontend actual

```
Macario Lite.html                  Entry point. Carga React, Babel, mock.js, todos los .jsx en orden.
components/
├── styles.css                     Design tokens (colores, tipografía, espaciado), estilos de todos los componentes.
├── mock.js                        Datos mock + SKU_DB + MOCK_BUS + MOCK_ACTIONS (mutaciones).
├── xlsx.js                        Parser de archivos .xlsx (descomprime zip + lee sharedStrings + sheet1).
├── shared.jsx                     Helpers globales (Icon, Modal, ToastProvider, useMockData, formatters fmt).
├── login.jsx                      Pantalla de login.
├── sidebar.jsx                    Navegación lateral con permisos por rol.
├── dashboard.jsx                  Pantalla Dashboard (hero, cards de canal, sparkline).
├── carrier.jsx                    Pantalla por canal (Colecta / Flex / Tienda Nube / Distribuidor).
├── produccion.jsx                 Pantalla de Producción unificada (todos los canales en una tabla).
├── modals.jsx                     Modales: Producir (3 pasos), Importar Excel, Cerrar jornada, Confirm.
├── pages.jsx                      Páginas restantes: QR, Histórico, Catálogo, Equipo, Notificaciones, Config.
└── app.jsx                        Componente raíz <App/>: maneja login + ruteo por estado.
```

### Convenciones de naming detectadas

- Componentes React en **PascalCase** (`DashboardPage`, `CarrierPage`).
- Variables y funciones en **camelCase** (`registrarProduccion`, `aplicarPedido`).
- Claves de SKU en **mayúsculas** con prefijo `MAD` (ej: `MAD050`).
- Identificadores de canal en **lowercase** (`colecta`, `flex`, `tiendanube`, `distribuidor`).
- Identificadores de rol en **lowercase** (`owner`, `admin`, `encargado`, `cnc`, etc.).
- Nombres de tablas SQL recomendados: **snake_case, plural** (`production_logs`, `sku_catalog`).

---

## 3. MAPA DE PANTALLAS / VISTAS / RUTAS

La app usa navegación por estado (no URLs). Para la migración a Supabase + React Router, se sugieren las rutas en la columna **Path sugerido**.

### 3.1 Login (`/login`)

- **Componente**: `LoginScreen` en `login.jsx`
- **Propósito**: autenticar usuario por username + password.
- **Campos visibles**: input username, input password (con toggle mostrar/ocultar), botón "Iniciar sesión", lista de usuarios mock para selección rápida (solo dev).
- **Acciones**: validar credenciales contra `MOCK.users`, setear `MOCK.user`, navegar a `landing` definida en `MOCK.ROLE_NAV[role].landing`.
- **Estados visuales**: idle, loading (durante validación), error (credenciales incorrectas).

### 3.2 Dashboard (`/`)

- **Path sugerido**: `/dashboard` — landing para roles `owner` y `admin`.
- **Propósito**: vista 360° de la operación.
- **Información mostrada**:
  - Header con título "Dashboard", subtítulo, badge "EN VIVO" con animación pulse y reloj HH:MM AM/PM (actualiza cada 30s).
  - Hero numérico oscuro: total de **ventas activas** (suma de unidades por canal), fecha en español, KPIs laterales "Pendientes" y "Producidos hoy".
  - Grid 2×2 de cards de canal con: color de marca, label, sub (ej. "ML · Retiro 12:00 hs"), conteo grande de unidades activas, click → navega al carrier.
  - Sparkline 7 días (LUN–DOM) con totales producidos.
  - Atajos rápidos: Importar Excel, Registrar producción, Scanner QR.
- **Acciones**: click en card de canal → carrier; click en atajos → modales o pantalla.

### 3.3 Carrier (`/canal/:canal`)

- **Path sugerido**: `/canal/colecta`, `/canal/flex`, `/canal/tiendanube`, `/canal/distribuidor`.
- **Componente**: `CarrierPage` en `carrier.jsx`.
- **Propósito**: vista por canal, con cierre de jornada para Colecta/Flex.
- **Información mostrada**:
  - Header con título del canal, sub, botón "Importar Excel", botón "Cerrar jornada" (rojo y parpadeando si vencido — solo Colecta/Flex).
  - **Banner contextual**:
    - Si `allDone` → verde "Todos los pedidos al día".
    - Si vencido → rojo "Jornada vencida — la hora de cierre era HH:MM".
    - Si en horario con countdown → "Cierra hoy a las HH:MM — quedan Xh Ym. Pendiente: N uds.".
    - Si flexible → gris "Canal sin cierre obligatorio diario".
  - **3 KPIs**: Pedidos activos, Unidades en pedido, Faltante.
  - **Tabla de Pendientes por SKU**: SKU · Producto · Pedido · Producido · Faltante · Stock · acción "+ Registrar".
  - **Colapsable Pedidos individuales**: N° pedido · Cliente · SKU · Producto · Cantidad · Fecha.
  - **Colapsable Lotes importados**: ID · Fecha · Pedidos · Archivo · Detectado.
  - **Colapsable Cierres anteriores**: Fecha · Pedidos · Faltante arrastrado · Snapshot.
- **Acciones**: importar Excel (abre modal), registrar producción (abre modal en paso 3 con SKU+canal preseleccionados), cerrar jornada (abre modal de confirmación).
- **Estados**: vacío (sin pedidos), normal, vencido (banner+botón rojos).

### 3.4 Producción (`/produccion`)

- **Componente**: `ProduccionPage` en `produccion.jsx`.
- **Path sugerido**: `/produccion` — landing para `encargado`, `cnc`, `melamina`, `pino`, `embalaje`, `logistica`.
- **Propósito**: vista unificada de producción (todos los canales en una sola tabla).
- **Información mostrada**:
  - Header + barra de progreso sticky (Producido vs Total).
  - Tabs por canal: Todos, Colecta, Flex, Tienda Nube, Distribuidor.
  - 4 KPIs: Faltante, Producido, Pedido total, Producido hoy.
  - Tabla SKU × Canal: SKU · Producto · Canal · Pedido · Producido · Faltante · Stock · acción "+ Registrar".
  - Logs del día (timeline).
- **Acciones**: registrar producción, filtrar por canal, ver detalle de log.

### 3.5 Scanner QR (`/qr`)

- **Componente**: `QRPage` en `pages.jsx`.
- **Propósito**: confirmación de embalado.
- **Información mostrada**: input de código (foco autom.), botón cámara (simulado), tabla de embalados recientes (Hora · Código · Producto · Cliente).
- **Acciones**: escanear / tipear código → registra como embalado.

### 3.6 Histórico (`/historico`)

- **Componente**: `HistoricoPage` en `pages.jsx`.
- **Propósito**: vista mensual de producción pasada.
- **Información mostrada**:
  - Filtros: canal, SKU, desde, hasta.
  - 4 KPIs: Total mes, Días activos, Promedio/día, Mejor día.
  - Calendario mensual (LUN–DOM) con badge de unidades por día. Click día → modal con detalle de logs.
  - Botón Exportar.

### 3.7 Catálogo (`/catalogo`)

- **Componente**: `CatalogoPage` en `pages.jsx`.
- **Propósito**: ABM de SKUs.
- **Información mostrada**: filtros (búsqueda, categoría), tabla con SKU · Modelo · Color (con swatch) · Categoría · Tipo (Fabricado/Reventa) · Estado (Activo/Inactivo) · acciones (Editar / QR).
- **Acciones**: crear producto, editar producto, generar QR individual o batch (PDF), filtrar.
- **Modal Editar/Crear**: SKU (editable solo en alta), categoría (con creación inline de nueva categoría), modelo, color libre + color picker + 6 atajos, toggle fabricado/reventa, toggle activo.

### 3.8 Equipo (`/equipo`)

- **Componente**: `EquipoPage` en `pages.jsx`.
- **Propósito**: ABM de usuarios.
- **Información mostrada**: filtros (búsqueda, rol), grid de cards (avatar+iniciales con color por rol, nombre, @username, área, badge de rol, acciones editar / activar-desactivar).
- **Acciones**: invitar usuario (con generación o definición manual de password), editar, resetear password, desactivar, eliminar.
- **Modal Invitar/Editar**: nombre, username (no editable después), rol, área, contraseña con dos modos (auto/manual) o reset de password (en edición).

### 3.9 Notificaciones (`/notificaciones`)

- **Componente**: `NotificacionesPage`.
- **Información mostrada**: lista de notificaciones con icono+color por tipo (`stock_critico`, `pedido_urgente`, `nuevo_pedido`, `produccion`, `sistema`), título, mensaje, "hace Xh", indicador no-leído.
- **Acciones**: marcar todo como leído.

### 3.10 Configuración / Perfil (`/config`)

- **Componente**: `ConfigPage`.
- **Información mostrada**: 4 cards (Seguridad, Notificaciones, Canales de venta, Sistema).
- **Acciones**: navegar a sub-pantallas (no implementadas aún).

---

## 4. INVENTARIO DE FUNCIONALIDADES

### 4.1 Login con username + password
- **Pantalla**: Login.
- **Inputs**: username, password.
- **Output**: sesión activa, navegación a landing por rol.
- **Reglas**: landing depende de `ROLE_NAV[role].landing`.

### 4.2 Importar pedidos desde Excel
- **Pantalla**: Carrier (todos los canales).
- **Inputs**: archivo .xlsx.
- **Outputs**: parsea archivo → detecta canal por columna "Forma de entrega" o por nombre del archivo → muestra preview con SKU + cantidad + producto resuelto + badge OK/SKU desconocido → al confirmar, aplica cada pedido vía `aplicarPedido()` (consume stock disponible primero, genera faltante por lo que queda) → registra el lote.
- **Validaciones**: SKUs desconocidos se marcan en amarillo y se ignoran con toast.
- **Reglas de negocio**:
  - Detección de canal por columna `Forma de entrega`: "Colecta"→colecta, "Flex"→flex, default→tiendanube.
  - El header del Excel es la primera fila que tenga columnas "SKU" y "Unidades".
  - Stock excedente acumulado se consume antes de generar faltante.

### 4.3 Registrar producción
- **Pantalla**: Modal "Producir" (accesible desde Carrier, Producción, sidebar).
- **Inputs**: SKU, canal/subcanal, cantidad.
- **Pasos del wizard**: (1) Elegir SKU, (2) Elegir canal, (3) Cantidad. Si entrás desde una fila "+ Registrar" arranca en paso 3 con SKU+canal preseleccionados.
- **Outputs**:
  - Aumenta `producido` en la fila del carrier.
  - Aumenta `producido` en la tabla unificada.
  - Si `producido > pedido`: el excedente va a `stock` y `faltante = 0`.
  - Si `producido < pedido`: `faltante = pedido - producido`, `stock = 0`.
  - Aumenta `producidoHoy` global.
- **Validaciones**: SKU sin plan → advertencia; cantidad > faltante → toast warning de overflow.

### 4.4 Cerrar jornada (Colecta / Flex)
- **Pantalla**: Carrier (solo Colecta/Flex).
- **Inputs**: confirmación.
- **Outputs**:
  - Archiva los pedidos completados.
  - Arrastra el faltante al día siguiente (genera nueva línea de pedido para mañana).
  - Genera snapshot inmutable del cierre (fecha, pedidos, faltante arrastrado).
- **Reglas**: solo aplica a canales con `tipo_cierre: 'horario'`.

### 4.5 Scanner QR (embalado)
- **Pantalla**: QR.
- **Inputs**: código (texto o cámara simulada).
- **Outputs**: registra evento de embalado, agrega a "Embalados recientes".

### 4.6 Histórico mensual
- **Pantalla**: Histórico.
- **Inputs**: mes/año, filtros (canal, SKU, desde, hasta).
- **Outputs**: KPIs del mes + calendario clickeable + detalle de día seleccionado.

### 4.7 ABM Catálogo SKU
- **Pantalla**: Catálogo.
- **Inputs**: SKU, categoría, modelo, color (texto + hex), es_fabricado, activo.
- **Outputs**: insert/update en `SKU_DB`.
- **Validaciones**: SKU duplicado, modelo vacío, categoría vacía → toast error.

### 4.8 ABM Equipo
- **Pantalla**: Equipo.
- **Inputs**: name, username, role, area, password.
- **Outputs**: insert/update/delete en `MOCK.users`.
- **Reglas**: username único, password mín. 4 caracteres, modo auto vs manual al crear, opción reset al editar.

### 4.9 Generación de QR (PDF batch)
- **Pantalla**: Catálogo.
- **Inputs**: filtro actual.
- **Outputs**: PDF con un QR por SKU filtrado (codifica el SKU). Todavía mock — solo toast.

### 4.10 Notificaciones
- **Pantalla**: Notificaciones, badge en sidebar.
- **Inputs**: ninguno (creadas por backend).
- **Outputs**: lista visible, marcar como leído.

### 4.11 Permisos por rol
- **Componente**: `Sidebar`.
- **Inputs**: `MOCK.user.role`.
- **Outputs**: filtra los items del menú según `ROLE_NAV[role].items`.
- **Reglas**: lista de items por rol está en `mock.js`. Hay que portarla a una tabla `role_permissions` o similar.

---

## 5. FLUJOS DE USUARIO

### 5.1 Flujo: día típico de Colecta

1. **9:00 AM** — Encargado abre Carrier > Colecta. Banner amarillo: "Cierra hoy a las 12:00 — quedan 3h. Pendiente: 28 uds.".
2. **9:15** — Encargado descarga el Excel del día desde Mercado Libre y lo importa. Modal preview muestra 12 pedidos, 28 unidades, todos con SKUs reconocidos. Confirma → tabla actualizada.
3. **9:30 - 11:45** — Operarios de sectores registran producción: cada uno toca "+ Registrar" en una fila de su SKU asignado, ingresa cantidad, confirma. La tabla y los KPIs se actualizan en tiempo real.
4. **11:45** — Encargado revisa: Faltante = 0. Banner pasa a verde.
5. **12:00** — Encargado clickea "Cerrar jornada". Modal de confirmación lista los efectos. Confirma. Snapshot generado, pedidos archivados.
6. **12:01** — Si quedó faltante, se arrastra al día siguiente y aparece en el carrier de mañana.

### 5.2 Flujo: importar Excel

1. Click en "Importar Excel" (header del Carrier).
2. Modal abre con dropzone.
3. Usuario suelta archivo .xlsx.
4. xlsx.js descomprime, parsea sharedStrings + sheet1, detecta header.
5. Resuelve cada SKU contra `SKU_DB`. Marca desconocidos en amarillo.
6. Detecta canal automáticamente por columna "Forma de entrega" o nombre de archivo.
7. Muestra preview tabular con primeras 5 filas + total + badge de canal detectado.
8. Usuario confirma → loop sobre todos los pedidos llamando `aplicarPedido({sku, subcanal, cantidad})`.
9. Toast de éxito + cierre del modal.

### 5.3 Flujo: registrar producción desde Carrier

1. Operario abre Carrier > Colecta.
2. Ve fila MAD061 con Faltante=10.
3. Click "+ Registrar" → modal abre directo en paso 3, con SKU=MAD061 y canal=colecta.
4. Ingresa cantidad (ej. 8).
5. Confirma → fila actualiza: Producido +8, Faltante 2.
6. Si ingresó >10 → warning de overflow, pero permite. Excedente va a Stock.

### 5.4 Flujo: invitar usuario

1. Owner abre Equipo.
2. Click "Invitar usuario" → modal.
3. Completa nombre + username + rol + área.
4. Sistema genera password automática (ej. `Pino347!`). Owner puede regenerar, copiar, o cambiar a modo manual.
5. Confirma → user creado, mensaje toast con tip para copiar credenciales.

### 5.5 Flujo: crear/editar SKU

1. Owner abre Catálogo.
2. Click "Nuevo producto" → modal.
3. Completa SKU + categoría (puede crear nueva categoría inline) + modelo + color (texto libre + picker hex + 6 atajos).
4. Toggles fabricado/reventa, activo.
5. Confirma → insertado en SKU_DB. Si SKU duplicado → toast error.

---

## 6. MODELO DE DATOS INFERIDO

### 6.1 Entidades

#### `users`
Usuarios de la aplicación. Mapea 1:1 con `auth.users` de Supabase, con perfil extendido en tabla pública.

| Campo | Tipo PG | Null | Default | Constraints | Notas |
|---|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK | FK → auth.users.id |
| username | text | NO | — | UNIQUE, lowercase, ^[a-z0-9_]{3,32}$ | login handle |
| name | text | NO | — | length 1..80 | nombre completo |
| email | text | YES | — | UNIQUE | opcional |
| role | role_enum | NO | 'embalaje' | enum (ver abajo) | |
| area | text | YES | — | | sector libre |
| active | boolean | NO | true | | soft-toggle |
| avatar_color | text | YES | — | hex 7 chars | sobrescribe default por rol |
| created_at | timestamptz | NO | now() | | |
| updated_at | timestamptz | NO | now() | | |
| created_by | uuid | YES | — | FK → users.id | quién lo invitó |

**Enum `role_enum`**: `owner`, `admin`, `encargado`, `ventas`, `cnc`, `melamina`, `pino`, `embalaje`, `carpinteria`, `logistica`, `marketing`.

#### `sku_catalog`
Catálogo maestro de productos. SKU es la PK natural.

| Campo | Tipo PG | Null | Default | Constraints | Notas |
|---|---|---|---|---|---|
| sku | text | NO | — | PK, ^[A-Z]{2,4}[0-9]{2,5}$ | natural key |
| modelo | text | NO | — | length 1..120 | |
| color | text | YES | — | | "Blanco", "Negro", "Natural", null |
| color_hex | text | YES | — | hex 7 chars | swatch |
| categoria | text | NO | — | FK → sku_categories.name | |
| es_fabricado | boolean | NO | true | | true=fabricado / false=reventa |
| activo | boolean | NO | true | | |
| created_at | timestamptz | NO | now() | | |
| updated_at | timestamptz | NO | now() | | |

#### `sku_categories`
Categorías del catálogo (Mesas, Ratonas, Recibidoras, Luz, etc.). Permite ABM dinámico desde el modal de crear SKU.

| Campo | Tipo PG | Null | Default | Constraints |
|---|---|---|---|---|
| name | text | NO | — | PK, length 1..40 |
| sort_order | int | NO | 0 | |
| created_at | timestamptz | NO | now() | |

#### `channels`
Canales de venta (semilla — solo 4 filas iniciales: colecta, flex, tiendanube, distribuidor).

| Campo | Tipo PG | Null | Default | Constraints |
|---|---|---|---|---|
| id | text | NO | — | PK (`colecta`, `flex`, `tiendanube`, `distribuidor`) |
| label | text | NO | — | "Colecta", "Flex", "Tienda Nube", "Distribuidores" |
| sub | text | YES | — | "ML · Retiro 12:00 hs" |
| color | text | NO | — | hex |
| bg | text | NO | — | hex bg |
| tipo_cierre | cierre_enum | NO | 'flexible' | `horario` o `flexible` |
| cierre_hora | time | YES | — | "12:00", "14:00", null |
| sort_order | int | NO | 0 | |

#### `orders`
Pedido individual entrante. Cada fila importada del Excel se guarda acá.

| Campo | Tipo PG | Null | Default | Constraints |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| channel_id | text | NO | — | FK → channels.id |
| order_number | text | NO | — | "ML-8203", único por canal |
| cliente | text | YES | — | |
| sku | text | NO | — | FK → sku_catalog.sku |
| cantidad | int | NO | — | CHECK > 0 |
| fecha_pedido | date | NO | current_date | |
| import_batch_id | uuid | YES | — | FK → import_batches.id |
| status | order_status_enum | NO | 'pendiente' | `pendiente`, `completado`, `arrastrado`, `archivado` |
| jornada_id | uuid | YES | — | FK → jornadas.id si fue cerrado |
| created_at | timestamptz | NO | now() | |

UNIQUE (`channel_id`, `order_number`).

**Enum `order_status_enum`**: `pendiente`, `completado`, `arrastrado` (faltante de un cierre anterior), `archivado`.

#### `import_batches`
Lote de importación de Excel. Una fila por upload.

| Campo | Tipo PG | Null | Default | Constraints |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| channel_id | text | NO | — | FK → channels.id |
| filename | text | NO | — | |
| pedidos_count | int | NO | 0 | |
| unidades_count | int | NO | 0 | |
| skus_desconocidos | text[] | NO | '{}' | |
| storage_path | text | YES | — | path del archivo en Supabase Storage |
| imported_by | uuid | NO | — | FK → users.id |
| imported_at | timestamptz | NO | now() | |

#### `production_logs`
Cada registro individual de producción (cada vez que un operario tira "+ Registrar"). Es el ledger inmutable.

| Campo | Tipo PG | Null | Default | Constraints |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| sku | text | NO | — | FK → sku_catalog.sku |
| channel_id | text | NO | — | FK → channels.id |
| cantidad | int | NO | — | CHECK > 0 |
| operario_id | uuid | NO | — | FK → users.id |
| sector | text | NO | — | "CNC", "Melamina", "Pino", "Embalaje" — espejo de role del operario |
| fecha | date | NO | current_date | |
| hora | time | NO | current_time | |
| notas | text | YES | — | |
| created_at | timestamptz | NO | now() | |

Índices: `(fecha)`, `(sku, channel_id)`, `(operario_id)`.

#### `carrier_state`
Estado por (canal, SKU) — denormalización para que las KPIs y la tabla de pendientes lean rápido sin agregar.

| Campo | Tipo PG | Null | Default | Constraints |
|---|---|---|---|---|
| channel_id | text | NO | — | FK → channels.id, parte de PK |
| sku | text | NO | — | FK → sku_catalog.sku, parte de PK |
| pedido | int | NO | 0 | suma `orders.cantidad` con status pendiente/arrastrado |
| producido | int | NO | 0 | suma `production_logs.cantidad` desde último cierre |
| faltante | int | NO | 0 | max(0, pedido - producido) |
| stock | int | NO | 0 | max(0, producido - pedido) |
| updated_at | timestamptz | NO | now() | |

PK compuesta `(channel_id, sku)`.

> Mantener consistencia con triggers en `orders` y `production_logs` (ver sección 10).

#### `jornadas`
Cierres de jornada (solo canales con `tipo_cierre='horario'`: Colecta y Flex).

| Campo | Tipo PG | Null | Default | Constraints |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| channel_id | text | NO | — | FK → channels.id |
| fecha | date | NO | — | |
| pedidos_count | int | NO | 0 | |
| unidades_pedidas | int | NO | 0 | |
| unidades_producidas | int | NO | 0 | |
| faltante_arrastrado | int | NO | 0 | |
| snapshot | jsonb | NO | — | Foto inmutable del estado al cerrar |
| closed_by | uuid | NO | — | FK → users.id |
| closed_at | timestamptz | NO | now() | |

UNIQUE (`channel_id`, `fecha`).

#### `notifications`
Notificaciones por usuario.

| Campo | Tipo PG | Null | Default | Constraints |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| user_id | uuid | NO | — | FK → users.id |
| tipo | notif_type_enum | NO | — | enum |
| titulo | text | NO | — | |
| mensaje | text | NO | — | |
| leida | boolean | NO | false | |
| link | text | YES | — | path interno |
| created_at | timestamptz | NO | now() | |

**Enum `notif_type_enum`**: `stock_critico`, `pedido_urgente`, `nuevo_pedido`, `produccion`, `sistema`.

#### `qr_scans`
Eventos de escaneo de QR durante embalado.

| Campo | Tipo PG | Null | Default | Constraints |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| code | text | NO | — | |
| sku | text | YES | — | FK → sku_catalog.sku |
| order_id | uuid | YES | — | FK → orders.id |
| operario_id | uuid | NO | — | FK → users.id |
| scanned_at | timestamptz | NO | now() | |

#### `role_permissions` (opcional / semilla)
Para portar `MOCK.ROLE_NAV`:

| Campo | Tipo PG | Null | Default | Constraints |
|---|---|---|---|---|
| role | role_enum | NO | — | PK |
| landing | text | NO | — | |
| items | text[] | NO | '{}' | |

### 6.2 Diagrama de relaciones

```
auth.users  ─1:1─  users
                    │
                    ├──< production_logs (operario_id)
                    ├──< import_batches (imported_by)
                    ├──< jornadas (closed_by)
                    ├──< notifications (user_id)
                    └──< qr_scans (operario_id)

sku_categories ──1:N── sku_catalog ──1:N── orders
                                      ├──── production_logs
                                      └──── carrier_state

channels ──1:N── orders
            ├──── production_logs
            ├──── import_batches ──1:N── orders
            ├──── carrier_state
            └──── jornadas
```

### 6.3 Enums consolidados

```sql
CREATE TYPE role_enum AS ENUM ('owner','admin','encargado','ventas','cnc','melamina','pino','embalaje','carpinteria','logistica','marketing');
CREATE TYPE cierre_enum AS ENUM ('horario','flexible');
CREATE TYPE order_status_enum AS ENUM ('pendiente','completado','arrastrado','archivado');
CREATE TYPE notif_type_enum AS ENUM ('stock_critico','pedido_urgente','nuevo_pedido','produccion','sistema');
```

---

## 7. AUTENTICACIÓN Y ROLES

- **Login obligatorio** para todas las pantallas excepto `/login`.
- **Método**: la app actualmente usa **username + password**. Supabase Auth nativo es email + password. Recomendación: crear emails internos virtuales (`username@macario.local`) y mostrar solo username al usuario, o agregar columna `username` única en `users` y un endpoint `signInWithUsername` que resuelve username → email antes de llamar a `signInWithPassword`.
- **Roles**: 11 roles definidos en `role_enum`. Cada rol tiene una `landing` y un array `items` que controlan navegación visible.
- **Permisos**:
  - `owner`, `admin` → acceso total.
  - `encargado` → producción, registrar, notificaciones, perfil.
  - `cnc`, `melamina`, `pino`, `embalaje`, `logistica` → producción, registrar, perfil.
- **Pantallas públicas**: solo `/login`.
- **Pantallas privadas**: todas las demás. El sidebar ya filtra ítems por rol, pero el backend debe enforcear con RLS (sección 8).

---

## 8. REGLAS DE ACCESO A DATOS (RLS)

> Convención: `is_owner_or_admin()` = `auth.role IN ('owner','admin')`. Implementar como function `SECURITY DEFINER` que lee `users.role` por `auth.uid()`.

### `users`
- **SELECT**: todos los autenticados (necesario para mostrar nombres en logs, listas, etc.).
- **INSERT**: solo `owner`, `admin`.
- **UPDATE**: el propio usuario sobre sus campos `name`, `avatar_color`. `owner`/`admin` sobre todos los campos excepto `id`.
- **DELETE**: solo `owner`. Soft-delete recomendado (toggle `active`).

### `sku_catalog`, `sku_categories`
- **SELECT**: todos los autenticados.
- **INSERT/UPDATE**: `owner`, `admin`.
- **DELETE**: `owner`. Recomendación: soft-delete con `activo=false`.

### `channels`
- **SELECT**: todos los autenticados.
- **INSERT/UPDATE/DELETE**: `owner` solamente. (Datos semilla — raramente cambian.)

### `orders`
- **SELECT**: todos los autenticados.
- **INSERT**: `owner`, `admin` (al importar Excel).
- **UPDATE**: solo cambios de `status` por `owner`, `admin`, `encargado`.
- **DELETE**: `owner` solamente.

### `import_batches`
- **SELECT**: todos los autenticados.
- **INSERT**: `owner`, `admin`.
- **UPDATE/DELETE**: `owner`.

### `production_logs`
- **SELECT**: todos los autenticados.
- **INSERT**: cualquier autenticado, **siempre con `operario_id = auth.uid()`** (chequeo en policy o en function RPC).
- **UPDATE**: prohibido (es ledger inmutable). Para correcciones, insertar log negativo.
- **DELETE**: prohibido por RLS. Solo `owner` puede via Edge Function explícita.

### `carrier_state`
- **SELECT**: todos los autenticados.
- **INSERT/UPDATE/DELETE**: solo via triggers internos. Bloquear acceso directo desde clientes (revoke + RLS deny-all).

### `jornadas`
- **SELECT**: todos los autenticados.
- **INSERT**: `owner`, `admin`, `encargado`.
- **UPDATE/DELETE**: prohibido (snapshots inmutables).

### `notifications`
- **SELECT**: solo el propio usuario (`user_id = auth.uid()`).
- **UPDATE**: solo el propio usuario, solo `leida`.
- **INSERT**: el sistema (Edge Function o trigger).
- **DELETE**: el propio usuario.

### `qr_scans`
- **SELECT**: todos los autenticados.
- **INSERT**: cualquier autenticado, con `operario_id = auth.uid()`.
- **UPDATE/DELETE**: prohibido.

### `role_permissions`
- **SELECT**: todos los autenticados.
- **INSERT/UPDATE/DELETE**: solo `owner`.

---

## 9. ARCHIVOS Y MEDIA

La app maneja:

1. **Archivos Excel importados** (.xlsx).
   - Tamaño esperado: < 1 MB.
   - Bucket: `imports` (privado).
   - Path: `imports/{channel_id}/{YYYY-MM-DD}/{batch_id}.xlsx`.
   - Conservar para auditoría de origen de pedidos.

2. **PDFs de QR generados** (a futuro).
   - Bucket: `qr-pdfs` (privado, signed URLs).
   - Path: `qr-pdfs/{user_id}/{timestamp}.pdf`.

3. **Avatares de usuarios** (opcional, no implementado aún — solo iniciales).
   - Bucket: `avatars` (público).
   - Path: `avatars/{user_id}.png`.

> Recomendación: bucket `imports` privado con policy de SELECT para `owner`/`admin`/`encargado`. `avatars` público.

---

## 10. LÓGICA QUE DEBERÍA VIVIR EN EL BACKEND

### Triggers (PL/pgSQL)

#### Trigger: `recalc_carrier_state_on_order`
Después de INSERT/UPDATE/DELETE en `orders`:
- Recalcula la fila correspondiente en `carrier_state` (suma `pedido` por `(channel_id, sku)`).

#### Trigger: `recalc_carrier_state_on_log`
Después de INSERT en `production_logs`:
- Recalcula `producido`, `faltante`, `stock` en `carrier_state` para el `(channel_id, sku)` del log.
- Inserta notificación `produccion` para roles relevantes.

#### Trigger: `auto_consume_stock_on_order_insert`
Antes de INSERT en `orders`:
- Si hay `stock` en `carrier_state` para ese `(channel_id, sku)`, descuenta del stock disponible y marca el pedido como parcialmente cubierto.

### RPCs / Edge Functions

#### `rpc_close_jornada(channel_id, fecha)`
Atómico:
1. Crea fila en `jornadas` con snapshot del `carrier_state` para ese canal.
2. Marca `orders` con `status='completado'` los que ya tienen `producido >= cantidad`.
3. Para los pedidos con faltante, los duplica con `status='arrastrado'` y `fecha_pedido = fecha + 1`.
4. Marca los originales con `status='archivado'` y `jornada_id = nueva`.
5. Resetea `producido` en `carrier_state` para ese canal.

#### `rpc_import_batch(channel_id, filename, rows[])`
Atómico:
1. Crea `import_batches` row.
2. Inserta `orders` en bulk.
3. Trigger del paso anterior dispara recalculo + auto-consumo de stock.
4. Devuelve `{batch_id, inserted_count, unknown_skus[]}`.

#### `rpc_register_production({sku, channel_id, cantidad, sector, notas?})`
Atómico:
1. Inserta `production_logs` con `operario_id = auth.uid()`.
2. Trigger recalcula `carrier_state`.
3. Si `faltante` llega a 0 → insert notification `produccion`.

#### `edge_send_notification_email(user_id, type, payload)` (opcional)
Manda email vía Resend / SES cuando hay notificación crítica.

#### `edge_export_historico_pdf(month, year, filters)` (opcional)
Genera PDF del histórico para descarga.

#### Cron / Scheduled
- **Cierre automático de Colecta a las 12:05** y **Flex a las 14:05** si nadie cerró manualmente — opcional, pendiente de decisión del usuario (ver sección DECISIONES PENDIENTES).
- **Reset diario de `production_logs.fecha=hoy`** para los KPIs de "Producido hoy" (no es reset, es solo filtro por fecha — no necesita cron).

### Vistas (postgres views)

#### `view_dashboard_kpis`
Suma por canal de unidades activas. La usa el Dashboard.

#### `view_historico_dia`
Por fecha y canal, total producido. Calendario del histórico.

#### `view_carrier_with_meta`
JOIN `carrier_state` + `sku_catalog` para tabla del carrier (ahorra round-trip).

---

## 11. REALTIME / SUSCRIPCIONES

Tablas que **deben** estar expuestas via `postgres_changes`:

- **`carrier_state`** — Carrier y Producción dependen de esto. Cualquier registro de producción debe reflejarse en pantalla en tiempo real para todos los conectados.
- **`orders`** — para que cuando alguien importe Excel, otros operarios vean los nuevos pedidos al instante.
- **`production_logs`** — para feed en vivo de "Logs del día".
- **`notifications`** — badge del sidebar y pantalla de notificaciones.

Filtrado client-side por `channel_id` cuando aplique para no hacer broadcast innecesario.

---

## 12. INTEGRACIONES EXTERNAS DETECTADAS

Hoy:
- **Mercado Libre**: indirecta — el usuario exporta archivos .xlsx desde la web de ML y los sube. **No hay API directa.**
- **Tienda Nube**: misma lógica.

A futuro (no implementado, mencionado por contexto del negocio):
- **API de Mercado Libre** para traer pedidos sin Excel manual.
- **API de Tienda Nube** ídem.
- **WhatsApp Business** para notificaciones de pedidos urgentes.
- **Facturación** (AFIP / TusFacturasAPP).

Ninguna está implementada en el frontend actual.

---

## 13. PUNTOS DE CONEXIÓN FRONTEND → BACKEND

Listado exhaustivo de cada lugar del código que hoy usa mock y debe reemplazarse.

| Archivo | Función / lugar | Operación | Tabla / RPC |
|---|---|---|---|
| `mock.js` | `window.MOCK.user` | `auth.getUser()` + `select users` | `users` |
| `mock.js` | `window.SKU_DB` | `select * from sku_catalog where activo=true` | `sku_catalog` |
| `mock.js` | `MOCK.users` | `select * from users` | `users` |
| `mock.js` | `MOCK.dash` | `select * from view_dashboard_kpis` | view |
| `mock.js` | `MOCK.sales7` | `select date_trunc('day', fecha), sum(cantidad) from production_logs group by 1 limit 7` | `production_logs` |
| `mock.js` | `MOCK.carriers[*]` | `select * from carrier_state where channel_id = ?` + JOIN sku_catalog | `carrier_state` |
| `mock.js` | `MOCK.carriers[*].orders` | `select * from orders where channel_id = ? and status in ('pendiente','arrastrado')` | `orders` |
| `mock.js` | `MOCK.carriers[*].lotes` | `select * from import_batches where channel_id = ?` | `import_batches` |
| `mock.js` | `MOCK.carriers[*].cierres` | `select * from jornadas where channel_id = ? order by fecha desc limit 30` | `jornadas` |
| `mock.js` | `MOCK.prod.todos.table` | view: select sku, channel_id, pedido, producido, faltante, stock from carrier_state | view |
| `mock.js` | `MOCK.prod.todos.kpis` | aggregate de carrier_state | view |
| `mock.js` | `MOCK.prodLogs` | `select * from production_logs where fecha = current_date` | `production_logs` |
| `mock.js` | `MOCK.notifications` | `select * from notifications where user_id = auth.uid() order by created_at desc` | `notifications` |
| `mock.js` | `MOCK.historico.days` | `select fecha, sum(cantidad) from production_logs group by fecha` | `production_logs` |
| `mock.js` | `MOCK_ACTIONS.registrarProduccion` | `rpc('rpc_register_production', {sku, channel_id, cantidad})` | RPC |
| `mock.js` | `MOCK_ACTIONS.aplicarPedido` | parte de `rpc_import_batch` | RPC |
| `modals.jsx` | Modal Importar Excel — al confirmar | `rpc('rpc_import_batch', {channel_id, rows})` + upload del archivo a Storage `imports/` | RPC + Storage |
| `modals.jsx` | Modal Producir — al confirmar | `rpc('rpc_register_production', ...)` | RPC |
| `modals.jsx` | Modal Cerrar jornada — al confirmar | `rpc('rpc_close_jornada', {channel_id, fecha})` | RPC |
| `pages.jsx` | `CatalogoPage.onSave` | `insert/update sku_catalog` | `sku_catalog` |
| `pages.jsx` | `EquipoPage.onSave` (alta) | `auth.signUp` + `insert users` (vía Edge Function `invite_user`) | `users` |
| `pages.jsx` | `EquipoPage.onSave` (edit) | `update users` | `users` |
| `pages.jsx` | `EquipoPage.onRemove` | `update users set active=false` | `users` |
| `pages.jsx` | `EquipoPage` reset password | `auth.admin.updateUserById` (vía Edge Function) | auth |
| `pages.jsx` | `QRPage.submit` | `insert qr_scans` | `qr_scans` |
| `pages.jsx` | `NotificacionesPage` "Marcar todo leído" | `update notifications set leida=true where user_id=auth.uid()` | `notifications` |
| `login.jsx` | submit | `auth.signInWithPassword({email: resolveEmail(username), password})` | auth |
| `app.jsx` | `handleLogout` | `auth.signOut()` | auth |
| `sidebar.jsx` | filtro de items | `select items from role_permissions where role = ?` | `role_permissions` |

---

## 14. VARIABLES DE ENTORNO NECESARIAS

Frontend (Vite — usar prefijo `VITE_`):

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
```

Edge Functions / Backend:

```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...   # solo en Edge Functions, NUNCA en frontend
SUPABASE_DB_URL=postgresql://... # para migraciones / scripts
RESEND_API_KEY=...               # opcional, para emails de notificación
```

Configuración cliente Supabase: `src/lib/supabase.ts` →

```ts
import { createClient } from '@supabase/supabase-js';
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);
```

---

## 15. CHECKLIST FINAL PARA CLAUDE CODE

### Fase 1 — Schema y datos base

- [ ] Crear proyecto Supabase nuevo.
- [ ] Crear extensiones: `pgcrypto` (para `gen_random_uuid()`).
- [ ] Crear los 4 enums: `role_enum`, `cierre_enum`, `order_status_enum`, `notif_type_enum`.
- [ ] Crear tablas en este orden: `sku_categories`, `channels`, `users`, `sku_catalog`, `import_batches`, `orders`, `production_logs`, `carrier_state`, `jornadas`, `notifications`, `qr_scans`, `role_permissions`.
- [ ] Crear índices recomendados (sección 6.1).
- [ ] Seed `channels` con las 4 filas (colecta, flex, tiendanube, distribuidor) usando los valores exactos de `window.CARRIERS`.
- [ ] Seed `sku_categories` con: Mesas, Ratonas, Recibidoras, Luz.
- [ ] Seed `sku_catalog` con los 18 SKUs de `window.SKU_DB`.
- [ ] Seed `role_permissions` con los datos de `MOCK.ROLE_NAV`.

### Fase 2 — Auth y usuarios

- [ ] Configurar Supabase Auth en modo email+password.
- [ ] Decidir estrategia username → email (recomendado: `{username}@macario.local`).
- [ ] Crear Edge Function `invite_user(name, username, role, area, password)` — usa service_role para crear en auth + perfil en `users`.
- [ ] Crear los 9 usuarios iniciales del equipo (Sebastián, Noe, Miqueas, Federico, Max, Gabriel, Matías, Flor, Romy) con sus roles.

### Fase 3 — RLS

- [ ] Habilitar RLS en todas las tablas.
- [ ] Crear function helper `is_owner_or_admin()`.
- [ ] Aplicar policies de la sección 8.
- [ ] Probar como cada rol que solo ve lo que debe.

### Fase 4 — Lógica de backend

- [ ] Crear triggers `recalc_carrier_state_on_order` y `recalc_carrier_state_on_log`.
- [ ] Crear RPCs `rpc_register_production`, `rpc_import_batch`, `rpc_close_jornada`.
- [ ] Crear vistas `view_dashboard_kpis`, `view_historico_dia`, `view_carrier_with_meta`.

### Fase 5 — Storage

- [ ] Crear buckets: `imports` (privado), `qr-pdfs` (privado), `avatars` (público).
- [ ] Aplicar policies de Storage (solo owner/admin/encargado leen `imports`).

### Fase 6 — Realtime

- [ ] Habilitar Realtime en `carrier_state`, `orders`, `production_logs`, `notifications`.

### Fase 7 — Frontend rewire

- [ ] Inicializar proyecto Vite + React + TS.
- [ ] Copiar todos los componentes del HTML actual (.jsx a .tsx).
- [ ] Reemplazar `window.MOCK` por hooks que llaman a Supabase + TanStack Query.
- [ ] Reemplazar `MOCK_ACTIONS.*` por llamadas RPC.
- [ ] Reemplazar `MOCK_BUS` por suscripciones Realtime.
- [ ] Implementar `LoginScreen` con `signInWithPassword`.
- [ ] Implementar context de usuario activo + protección de rutas.
- [ ] Configurar React Router con las rutas de la sección 3.

### Fase 8 — Testing

- [ ] Test del flujo completo: login → importar Excel → registrar producción → cerrar jornada.
- [ ] Test de RLS: que un operario `embalaje` no pueda ver/modificar usuarios.
- [ ] Test de Realtime: dos pestañas abiertas, una registra producción, la otra ve actualización.
- [ ] Test de cierre de jornada: faltante se arrastra correctamente al día siguiente.

### Fase 9 — Despliegue

- [ ] Variables de entorno en Vercel/Netlify.
- [ ] Hostear frontend.
- [ ] Configurar dominio.
- [ ] Backup automático de Supabase.

---

## DECISIONES PENDIENTES

Estas son ambigüedades del frontend que el usuario debe resolver antes de pasarle esto a Claude Code:

1. **Username vs Email**: la app usa username para login. ¿Mantenemos esa UX y resolvemos username→email internamente, o cambiamos a email directo? **Recomendación**: mantener username, generar email virtual `{username}@macario.local`.

2. **Cierre automático de jornada**: ¿Si nadie cierra Colecta a las 12:00, el sistema cierra solo a las 12:05? ¿O queda eternamente abierto hasta que alguien lo haga manual? Hoy el frontend solo muestra "vencido" pero nadie lo cierra solo.

3. **Stock excedente entre canales**: Hoy si Colecta produce de más, el stock queda asignado a `carrier_state(colecta, sku)`. ¿Ese stock debería poder consumirlo Flex u otro canal del mismo SKU? **Decidir**: ¿stock por canal (actual) o stock global por SKU?

4. **Pedidos arrastrados — visibilidad**: Cuando un pedido se arrastra al día siguiente, ¿debe mostrarse separado en la tabla con un badge "ARRASTRADO" o se mezcla con los nuevos? Hoy no está marcado en UI.

5. **Borrado vs soft-delete de SKUs**: Si elimino un SKU que ya tiene `production_logs` históricos, ¿qué pasa con los logs? **Recomendación**: solo soft-delete (`activo=false`); la FK debe ser `ON DELETE RESTRICT`.

6. **Edición de password por el propio usuario**: la pantalla `Configuración > Seguridad` está stubbed. ¿Implementamos cambio de password por el propio user en esta primera versión?

7. **Notificaciones automáticas**: ¿Qué eventos disparan notificaciones a qué roles? Sugerencia inicial:
   - Stock crítico → owner, admin.
   - Pedido urgente (cierre <30min y faltante>0) → encargado, sectores.
   - Nuevo lote importado → encargado.
   - Producción completada (faltante=0) → owner.
   - Confirmar/ajustar con el usuario.

8. **QR PDF generation**: ¿es prioridad para v1 o se deja como botón "Próximamente"?

9. **Multi-tenant**: ¿la app va a soportar múltiples fábricas en el futuro, o es siempre una sola? Si es multi-tenant, agregar `tenant_id` a todas las tablas desde ahora.

10. **Idempotencia de import**: Si subo el mismo Excel dos veces, ¿se duplican los pedidos? **Recomendación**: hash del archivo + UNIQUE para impedir doble import.
