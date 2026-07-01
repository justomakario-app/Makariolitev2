# Brief técnico — Módulo de Producción en Línea

> **Documento maestro de especificación funcional y técnica para el equipo de desarrollo.**
> Expansión del sistema de gestión existente (Supabase + PostgreSQL), implementada por capas incrementales sin romper la lógica ya en producción.
>
> **Versión 2.0 — Documento final completo.** Incluye los 4 sectores productivos con sus pantallas definitivas, el panel del encargado, los flujos de aprobación, el modelo de datos SQL, la lógica de cascada y el plan de implementación.

| | |
|---|---|
| **Producto** | App de gestión — nueva sección *Producción en línea* |
| **Stack backend** | Supabase (PostgreSQL + Auth + RLS + Realtime + Storage + Edge Functions) |
| **Tipo de entrega** | Expansión modular sobre la app existente — mismo equipo, misma base de datos |
| **Estrategia** | Implementación por capas. Cada capa se despliega y valida de forma independiente. |
| **Sectores** | CNC · Melamina · Embalaje · Pino (Patas) + Panel del Encargado + Panel del Director |
| **Versión** | 2.0 (final) |

---

## Tabla de contenido

0. [Resumen ejecutivo](#0)
1. [Contexto: la app existente y cómo encastra el módulo](#1)
2. [Glosario de dominio](#2)
3. [Arquitectura por capas](#3)
4. [Modelo de datos (SQL para Supabase)](#4)
5. [Importación del Excel maestro de SKUs](#5)
6. [Lógica de negocio crítica](#6)
7. [Roles, RLS y seguridad](#7)
8. [Flujos de aprobación (insumos y mantenimiento)](#8)
9. [La cadena productiva y el encadenamiento entre sectores](#9)
10. [Especificación completa por sector](#10)
    - 10.1 [CNC](#10-1)
    - 10.2 [Melamina](#10-2)
    - 10.3 [Embalaje](#10-3)
    - 10.4 [Pino (Patas)](#10-4)
11. [Panel del Encargado de Producción](#11)
12. [Realtime: los espejos en vivo](#12)
13. [Capa de servicios / Edge Functions](#13)
14. [Frontend y UX — patrón común de los sectores](#14)
15. [Branding y sistema de diseño](#15)
16. [Plan de implementación por capas (roadmap)](#16)
17. [Reglas de oro y no-negociables](#17)
18. [Cómo NO romper lo existente](#18)
19. [Pendientes para etapas futuras](#19)
20. [Prompt para el equipo de desarrollo](#20)

---

<a name="0"></a>
## 0. Resumen ejecutivo

La empresa fabrica muebles (mesas, sets, banquetas, gotas, boomerang, etc.) y los vende por múltiples canales (Colecta, Flex, Tienda Nube, Distribuidores, No Flex, Correo Argentino, Stock). Ya existe una app de gestión, construida sobre **Supabase**, que administra esos pedidos por canal y tiene una sección **"Producción"** todavía vacía, además de un botón **"Scan"** en la navegación inferior.

Este documento especifica cómo convertir esa sección vacía en un **sistema de trazabilidad de fábrica en tiempo real**, donde cada sector productivo carga su trabajo diario desde el celular y la información fluye automáticamente sector a sector hasta cerrar el ciclo en el despacho.

### El problema que resuelve

- Hoy no hay forma de saber, en un momento dado, **cuántas piezas hay en la línea de producción**, cuánto se desperdició ni qué materia prima falta.
- La información entre sectores (**CNC → Melamina → Embalaje**, y **Pino → Embalaje**) se pasa de forma manual e informal.
- No existe un **cruce automático** entre los pedidos de venta y lo que la fábrica tiene que cortar y producir.
- No hay visibilidad gerencial en vivo del estado de la fábrica.

### Lo que entrega el módulo

- **Carga descentralizada:** cada coordinador de sector carga su producción desde su celular, con su propio login.
- **Flujo encadenado (pull):** las ventas netas son la demanda; cada sector produce solo lo que falta, descontando su propio stock.
- **SKU como núcleo:** un Excel maestro (ya provisto) define cada producto, las piezas que lo componen, cuántas piezas rinde cada placa de corte y qué insumos lleva su embalaje.
- **Visibilidad total:** el encargado de producción ve el estado de los cuatro sectores en vivo y el avance de los pedidos del día.
- **Gestión de stock:** descuento automático al producir, alertas de mínimos y carga de remitos.

### Principio rector

> **El módulo se construye POR CAPAS, sin tocar ni romper la lógica que ya está en producción.** Cada capa es desplegable de forma independiente y aporta valor por sí sola. Ninguna capa posterior es requisito para que la anterior funcione. Todo se construye en tablas y esquemas **nuevos**, prefijados, que conviven con lo existente sin modificarlo.

---

<a name="1"></a>
## 1. Contexto: la app existente y cómo encastra el módulo

La app ya en producción tiene estas características confirmadas que el módulo **debe respetar y reutilizar**, no reemplazar:

| Elemento existente | Estado | Cómo lo usa el módulo de producción |
|---|---|---|
| Supabase Auth (login por usuario) | ✓ Existe | Se agregan roles vía `app_metadata`, sin tocar el flujo de login |
| Navegación inferior (5 ítems) | ✓ Existe | El contenido de "Producción" cambia según el rol logueado |
| Sección "Producción" | ✓ Existe (vacía) | Es el contenedor donde vive todo este módulo |
| Botón "Scan" | ✓ Existe | Se reutiliza para escanear el QR de las placas/piezas/productos |
| Pedidos por canal (tablas existentes) | ✓ Existe | Se **leen** para el resumen del día y la prioridad de cada sector |
| Dashboard de canales | ✓ Existe | Es la fuente del "Resumen del día" que ve cada sector |
| Dark mode / cards por canal | ✓ Existe | El módulo respeta el mismo sistema visual |

> **Dato clave:** Es el **mismo sistema** y el **mismo equipo**. No hay integración con apps externas ni sincronización vía API de terceros. Los pedidos por canal ya viven en PostgreSQL; el módulo los consume con un `JOIN` o una vista. La "integración" es interna a la misma base de datos.

### Convención de aislamiento

Todo lo nuevo vive bajo el prefijo `prod_` (o un schema dedicado `produccion`). Esto garantiza que:

- Ninguna migración del módulo toca tablas existentes.
- Si hay que revertir, se elimina el schema/prefijo sin afectar ventas.
- El equipo distingue de un vistazo qué es nuevo y qué es legacy.

---

<a name="2"></a>
## 2. Glosario de dominio

Antes de la lógica, hay que hablar el mismo idioma. Estos términos vienen del negocio real de la fábrica:

| Término | Qué significa |
|---|---|
| **SKU** | Código único que identifica cualquier ítem (producto, placa, pieza o insumo). Es la columna vertebral del sistema. |
| **Producto / MAD** | Lo que se vende. Ej: `MAD301 Bumerang Blanco`. Aparece en los pedidos. |
| **Placa / Hoja** | La plancha de melamina que CNC corta. Ej: `PLB007 Boomerang Blanca`. De una placa salen varias piezas. |
| **Rendimiento** | Cuántas piezas (tapas) salen de cortar **una** placa. Ej: la placa `PLB007` rinde **16** piezas. |
| **Pieza / Tapa / TAP** | La pieza que resulta de cortar una placa. Ej: `TAP011 Tapa Boomerang`. |
| **Receta** | Las piezas que componen un producto. Un producto lleva 1, 2 o 3 piezas. Ej: `MAD301 = TAP011 + TAP001`. |
| **Placa combinada / COM** | Una placa que en un solo corte produce **dos tipos** de tapas distintas. |
| **Con filo** | Primer sub-proceso de Melamina: se coloca el filo a la pieza. (Antes lo llamábamos "filado".) |
| **Refilado** | Último sub-proceso de Melamina: orificios con molde de marca. (Antes "moldeado".) |
| **Pieza cruda** | Pieza cortada por CNC que todavía no pasó por Melamina. Es la entrada de Melamina. |
| **Pieza terminada** | Pieza que ya pasó por Melamina (con filo + refilado), lista para Embalaje. |
| **Pata** | Pieza de madera de pino que produce el sector Pino. Hay **chicas** y **grandes**. |
| **Pata masillada** | Pata con defecto reparado con masilla. Sirve, pero requiere otro proceso antes de estar disponible. |
| **Kit de embalaje** | Conjunto de insumos que lleva un producto para embalarse: caja, film, tornillos, soportes, bolsas. Definido por SKU. |
| **Cortes del día** | El reporte que genera CNC al cerrar: placas cortadas, piezas generadas, desperdicio y total neto por modelo. |
| **Productos armables** | Cuántas unidades completas de un producto se pueden ensamblar según el stock de piezas + patas disponibles. |
| **Listo para despacho** | Estado final de un pedido cuando Embalaje termina de empaquetarlo. |
| **Prioridad del día** | Lo que cada sector debe producir, calculado como demanda − stock propio del eslabón. |
| **Jornada** | El turno diario de trabajo. Se abre, se carga producción y se cierra (empuja datos al siguiente sector). |

---

<a name="3"></a>
## 3. Arquitectura por capas

El sistema se piensa en **7 capas**. Cada una se apoya en la anterior pero es desplegable de forma independiente.

```
┌─────────────────────────────────────────────────────────┐
│  CAPA 6 · HISTÓRICO Y KPIs                                │
│  Reportes día/semana/mes · exportación · analítica        │
├─────────────────────────────────────────────────────────┤
│  CAPA 5 · PANEL DE CONTROL (encargado / director)         │
│  Dashboard en vivo · alertas de stock · carga de remitos  │
├─────────────────────────────────────────────────────────┤
│  CAPA 4 · ENCADENAMIENTO ENTRE SECTORES                   │
│  CNC → Melamina → Embalaje    ·    Pino → Embalaje        │
├─────────────────────────────────────────────────────────┤
│  CAPA 3 · MOTOR DE CÁLCULO                                │
│  hojas × rendimiento = piezas · receta → armables         │
│  prioridad por cascada · descuento de stock               │
├─────────────────────────────────────────────────────────┤
│  CAPA 2 · CAPTURA POR SECTOR (coordinadores)              │
│  CNC · Melamina · Embalaje · Pino — carga diaria          │
├─────────────────────────────────────────────────────────┤
│  CAPA 1 · ROLES Y ACCESOS (sobre Supabase Auth)           │
├─────────────────────────────────────────────────────────┤
│  CAPA 0 · DATOS MAESTROS — Excel de SKUs importado        │
└─────────────────────────────────────────────────────────┘
         ▲ todo se apoya en el catálogo de SKUs ▲
```

| Capa | Nombre | Qué contiene | Depende de |
|---|---|---|---|
| **0** | Datos maestros | Importación del Excel: productos, placas, piezas, recetas, insumos | — |
| **1** | Roles y accesos | Perfiles de coordinador/encargado/director sobre Supabase Auth + RLS | 0 |
| **2** | Captura por sector | Pantallas de carga de cada coordinador (CNC primero) | 0, 1 |
| **3** | Motor de cálculo | Corte→piezas, cruce de recetas, productos armables, prioridad, stock | 0, 2 |
| **4** | Encadenamiento | Flujo automático CNC→Melamina→Embalaje y Pino→Embalaje | 2, 3 |
| **5** | Panel de control | Dashboard del encargado y director, alertas, remitos | 3, 4 |
| **6** | Histórico y KPIs | Reportes por período, exportación, analítica | 5 |

---

<a name="4"></a>
## 4. Modelo de datos (SQL para Supabase)

Todo gira alrededor de un catálogo maestro de SKUs. Hay cuatro familias de SKU que se relacionan entre sí.

### 4.1 Las cuatro familias de SKU

| Familia | Prefijo | Qué representa | Ejemplo |
|---|---|---|---|
| Productos terminados | `MAD` | Lo que se vende (aparece en los pedidos) | `MAD301` Bumerang Blanco |
| Placas de corte | `PLB / PLN / PMB / PMN / COM` | Lo que CNC corta. Cada placa rinde N tapas | `PLB007` Boomerang Blanca |
| Piezas / tapas | `TAP` | Las piezas que salen de cortar una placa | `TAP011` Tapa Boomerang B. |
| Insumos | *(varios)* | Patas, soportes, tornillos, film, cajas, fresas | film burbuja, fresa compresión |

**Prefijos de placa explicados:** `PLB` = Placa Blanca · `PLN` = Placa Negra · `PMB` = Placa Mármol Blanca · `PMN` = Placa Mármol Negra · `COM` = Placa Combinada (rinde 2 tipos de tapa en un corte).

### 4.2 La relación crítica que el modelo debe capturar

```
1 PLACA (PLxxx)    → rinde N piezas → de tipo TAP (su pieza hija)
1 PRODUCTO (MADxxx) → se compone de 1-3 piezas TAP (su RECETA)
1 PRODUCTO (MADxxx) → tiene un KIT de insumos de embalaje
1 PRODUCTO (MADxxx) → puede llevar PATAS (chicas o grandes) del sector Pino
```

**Ejemplo real:** `MAD301` (Bumerang Blanco) = `TAP011` (Tapa Boomerang) + `TAP001` (Tapa Redonda 30) + 4 patas.
`TAP011` sale de `PLB007` (rinde 16 por placa) · `TAP001` sale de `PLB001` (rinde 50 por placa).

### 4.3 Esquema SQL (migración inicial — Capa 0)

```sql
-- ════════════════════════════════════════════════════════════
-- MÓDULO DE PRODUCCIÓN — schema aislado, no toca lo existente
-- ════════════════════════════════════════════════════════════

-- ── Catálogo de piezas (tapas) ──
create table prod_pieza (
  sku          text primary key,              -- 'TAP011'
  nombre       text not null,                 -- 'Tapa Boomerang Blanca'
  created_at   timestamptz default now()
);

-- ── Catálogo de placas de corte ──
create table prod_placa (
  sku           text primary key,             -- 'PLB007'
  nombre        text not null,                -- 'Boomerang'
  material      text not null,                -- 'Blanca' | 'Negra' | 'Mármol B.' | 'Mármol N.'
  rendimiento   int  not null check (rendimiento > 0),  -- piezas por hoja
  pieza_sku     text references prod_pieza(sku),        -- qué pieza produce
  combinada     boolean default false,        -- COM: produce 2 tipos de tapa
  created_at    timestamptz default now()
);

-- En placas combinadas (COM), la segunda pieza se modela acá:
create table prod_placa_pieza_extra (
  placa_sku    text references prod_placa(sku),
  pieza_sku    text references prod_pieza(sku),
  rendimiento  int not null check (rendimiento > 0),
  primary key (placa_sku, pieza_sku)
);

-- ── Catálogo de productos terminados ──
create table prod_producto (
  sku          text primary key,              -- 'MAD301'
  nombre       text not null,                 -- 'Bumerang'
  color        text not null,                 -- 'Blanco' | 'Negro' | 'Mármol B.' ...
  tipo         text not null check (tipo in ('simple','combinado')),
  patas_tipo   text,                          -- 'chica' | 'grande' | null (si no lleva)
  patas_cant   int default 0,                 -- cuántas patas por unidad
  kit_embalaje jsonb default '{}',            -- {caja, film, tornillos, soportes, bolsas}
  activo       boolean default true,
  created_at   timestamptz default now()
);

-- ── Receta: qué piezas componen cada producto ──
create table prod_receta (
  producto_sku text references prod_producto(sku),
  pieza_sku    text references prod_pieza(sku),
  cantidad     int not null default 1 check (cantidad > 0),
  primary key (producto_sku, pieza_sku)
);

-- ── Insumos (con stock) ──
create table prod_insumo (
  sku            text primary key,
  nombre         text not null,
  categoria      text not null,               -- 'fresa'|'lubricante'|'filo'|'pata'|'caja'...
  sector         text,                        -- 'cnc'|'melamina'|'embalaje'|'pino'|'general'
  stock_actual   numeric not null default 0,
  stock_minimo   numeric not null default 0,  -- dispara alerta
  unidad         text not null default 'u',   -- 'u'|'rollos'|'L'|'m'...
  updated_at     timestamptz default now()
);
```

### 4.4 Esquema SQL (operación diaria — Capas 2-4)

```sql
-- ── Jornada productiva (un registro por día) ──
create table prod_jornada (
  id           uuid primary key default gen_random_uuid(),
  fecha        date not null,
  estado       text not null default 'abierta',  -- 'abierta' | 'cerrada'
  abierta_por  uuid references auth.users(id),
  abierta_at   timestamptz default now(),
  cerrada_at   timestamptz,
  unique (fecha)
);

-- ── Registro de cortes de CNC ──
create table prod_corte (
  id            uuid primary key default gen_random_uuid(),
  jornada_id    uuid references prod_jornada(id),
  placa_sku     text references prod_placa(sku),
  hojas         int  not null check (hojas >= 0),
  desperdicio   int  not null default 0 check (desperdicio >= 0),
  -- piezas_generadas y netas se calculan; no se escriben a mano
  cargado_por   uuid references auth.users(id),
  created_at    timestamptz default now(),
  editable_hasta timestamptz default (now() + interval '24 hours')
);

-- ── Registro de Melamina (piezas terminadas por TAP) ──
create table prod_melamina (
  id            uuid primary key default gen_random_uuid(),
  jornada_id    uuid references prod_jornada(id),
  pieza_sku     text references prod_pieza(sku),
  terminadas    int default 0,                 -- TAP finalizados
  fallas        int default 0,                 -- roturas en el proceso
  cargado_por   uuid references auth.users(id),
  created_at    timestamptz default now(),
  editable_hasta timestamptz default (now() + interval '24 hours')
);

-- ── Registro de Embalaje (productos armados) ──
create table prod_embalaje (
  id            uuid primary key default gen_random_uuid(),
  jornada_id    uuid references prod_jornada(id),
  producto_sku  text references prod_producto(sku),
  unidades      int not null check (unidades >= 0),
  canal         text,                          -- de qué canal era la prioridad
  cargado_por   uuid references auth.users(id),
  created_at    timestamptz default now()
);

-- ── Registro de Pino (patas por tamaño y estado) ──
create table prod_pino (
  id            uuid primary key default gen_random_uuid(),
  jornada_id    uuid references prod_jornada(id),
  tamano        text not null check (tamano in ('chica','grande')),
  terminadas    int default 0,                 -- van a Embalaje
  masilladas    int default 0,                 -- pendientes de otro proceso
  cargado_por   uuid references auth.users(id),
  created_at    timestamptz default now(),
  editable_hasta timestamptz default (now() + interval '24 hours')
);

-- ════════════════════════════════════════════════════════════
-- STOCK POR ESLABÓN — cada sector descuenta SOLO el propio
-- prod_stock_pieza      = piezas CRUDAS de CNC      (entrada Melamina)
-- prod_stock_melamina   = piezas TERMINADAS Melamina (entrada Embalaje)
-- prod_stock_patas      = patas terminadas de Pino   (entrada Embalaje)
-- prod_stock_terminado  = PRODUCTOS terminados Embalaje (cubren la venta)
-- ════════════════════════════════════════════════════════════
create table prod_stock_pieza (
  pieza_sku    text references prod_pieza(sku) primary key,
  disponible   int not null default 0,
  updated_at   timestamptz default now()
);

create table prod_stock_melamina (
  pieza_sku    text references prod_pieza(sku) primary key,
  disponible   int not null default 0,
  updated_at   timestamptz default now()
);

create table prod_stock_patas (
  tamano       text primary key check (tamano in ('chica','grande')),
  disponible   int not null default 0,
  masilladas   int not null default 0,        -- pendientes, no disponibles aún
  updated_at   timestamptz default now()
);

create table prod_stock_terminado (
  producto_sku text references prod_producto(sku) primary key,
  disponible   int not null default 0,
  updated_at   timestamptz default now()
);

-- ── Solicitudes de insumos (aprueba coordinador, recepciona administración) ──
create table prod_solicitud (
  id           uuid primary key default gen_random_uuid(),
  jornada_id   uuid references prod_jornada(id),
  sector       text not null,                  -- 'cnc'|'melamina'|'embalaje'|'pino'
  items        jsonb not null,                 -- [{categoria, detalle, cantidad}]
  estado       text default 'pendiente',       -- 'pendiente'|'aprobada_coord'|'recepcionada_admin'
  solicitado_por uuid references auth.users(id),
  aprobado_por   uuid references auth.users(id),
  created_at   timestamptz default now()
);

-- ── Reportes de mantenimiento (aprueba coordinador, recepciona director) ──
create table prod_mantenimiento (
  id           uuid primary key default gen_random_uuid(),
  sector       text not null,
  tipo         text,                           -- según máquinas del sector
  urgencia     text,                           -- 'alta'|'media'|'baja'
  maquina      text,
  descripcion  text,
  estado       text default 'pendiente',       -- 'pendiente'|'aprobado_coord'|'recibido_director'
  reportado_por uuid references auth.users(id),
  aprobado_por  uuid references auth.users(id),
  created_at   timestamptz default now()
);

-- ── Remitos de mercadería (suman stock; encargado o administración) ──
create table prod_remito (
  id           uuid primary key default gen_random_uuid(),
  proveedor    text,
  nro_remito   text,
  fecha        date,
  items        jsonb not null,                 -- [{insumo_sku, cantidad}]
  cargado_por  uuid references auth.users(id),
  created_at   timestamptz default now()
);

-- ── Alertas de stock bajo (las ve el encargado) ──
create table prod_alerta (
  id           uuid primary key default gen_random_uuid(),
  insumo_sku   text references prod_insumo(sku),
  nivel        text not null,                  -- 'critico'|'bajo'
  stock_actual numeric,
  stock_minimo numeric,
  vista        boolean default false,
  created_at   timestamptz default now()
);

-- ── Auditoría de modificaciones (encargado/director) ──
create table prod_auditoria (
  id           uuid primary key default gen_random_uuid(),
  tabla        text not null,
  registro_id  uuid not null,
  sector       text,
  campo        text,
  valor_anterior text,
  valor_nuevo  text,
  motivo       text,                           -- razón de la corrección
  modificado_por uuid references auth.users(id),
  created_at   timestamptz default now()
);
```

> **Nota sobre el cálculo:** Las columnas `piezas_generadas`, `netas`, `productos_armables` y los faltantes **no se almacenan como datos editables a mano** — se calculan. Pueden materializarse como **columnas generadas**, **vistas** o resultados de funciones. La regla es: la fuente de verdad es `hojas`, `desperdicio`, `rendimiento`, `terminadas`; el resto se deriva.

---

<a name="5"></a>
## 5. Importación del Excel maestro de SKUs

El director carga un Excel con **4 pestañas** (ya provisto: `sku_para_sistema.xlsx`). El backend lo importa y puebla las tablas de catálogo. Solo el rol **Director** puede hacerlo.

| Pestaña del Excel | Puebla la(s) tabla(s) | Contenido |
|---|---|---|
| Insumos generales | `prod_insumo` | Patas, soportes, tornillos, kits, con su stock inicial |
| SKU placas de corte CNC | `prod_placa` + `prod_pieza` | Cada placa con su rendimiento y su pieza hija (SKU hijo) |
| Composición x SKU | `prod_receta` | Qué piezas componen cada producto (la receta) |
| SKU de productos | `prod_producto` | Catálogo de productos terminados (los MAD) |

### Reglas de importación

- El **SKU es único e inmutable**. Reimportar **actualiza** datos pero **nunca duplica** (`upsert` por SKU).
- Un producto `combinado` obliga a tener ≥2 piezas en su receta.
- El `rendimiento` debe ser entero positivo.
- Si una fila viola una regla, **se rechaza esa fila y se reporta**, sin abortar toda la importación.
- Implementar como **Edge Function** que recibe el archivo desde Supabase Storage, lo parsea (`xlsx`) y hace los `upsert` dentro de una transacción por pestaña.

> **Detalle de parsing del CSV/Excel argentino:** los archivos vienen en formato semicolon-delimited, encoding Latin-1, números con punto como separador de miles y coma decimal. El parser debe contemplar esto. (Si se exporta a CSV: `names` + `skiprows=1` con columnas explícitas para manejar los punto y coma finales.)

```
POST /functions/v1/import-skus
  body: { storage_path: "imports/sku_para_sistema.xlsx" }
  → valida rol director (JWT)
  → parsea 4 pestañas
  → upsert por SKU en cada tabla
  → devuelve { insertados, actualizados, rechazados: [{fila, motivo}] }
```

---

<a name="6"></a>
## 6. Lógica de negocio crítica

Esta es la lógica más importante del sistema. **Vive en el backend** (funciones PostgreSQL o Edge Functions), nunca en el frontend.

### 6.1 De placas cortadas a piezas (CNC)

El operario no carga piezas: carga **hojas** (placas) cortadas. El sistema deriva las piezas con el rendimiento.

```
piezas_generadas = hojas × rendimiento
piezas_netas     = piezas_generadas − desperdicio
```

**Ejemplo:** `PLB007` Boomerang Blanca, rendimiento 16
hojas = 4 → generadas = 4 × 16 = 64 · desperdicio = 4 → **netas = 60** (van a Melamina)

```sql
-- Vista que arma el reporte "Cortes del día"
create view prod_v_cortes_dia as
select
  c.jornada_id,
  c.placa_sku,
  pl.nombre              as modelo,
  pl.material            as color,
  c.hojas,
  c.hojas * pl.rendimiento                       as generadas,
  c.desperdicio,
  greatest(c.hojas * pl.rendimiento - c.desperdicio, 0) as totales
from prod_corte c
join prod_placa pl on pl.sku = c.placa_sku;
```

La tabla "Cortes del día" se muestra con este formato exacto:

| SKU | Modelo | Color | Hojas | Generadas | Desperdicio | Totales |
|---|---|---|---|---|---|---|
| PLB007 | BOOMERANG | BLANCO | 4 | 64 | 4 | 60 |
| PLN007 | BOOMERANG | NEGRO | 1 | 16 | 0 | 16 |

### 6.2 De piezas a productos armables (Embalaje)

Un producto puede necesitar piezas de **distintas** placas **más patas**. El sistema cruza el stock de piezas + patas con la receta y calcula cuántas unidades completas se pueden armar. **El cuello de botella es el componente que menos alcanza.**

```
productos_armables(MAD) = MÍNIMO sobre cada componente de su receta de:
    floor( stock_pieza[tap]  / cantidad_requerida[tap] )   para cada pieza
    floor( stock_patas[tipo] / patas_cant )                si lleva patas
```

**Ejemplo:** `MAD301` = 1×`TAP011` + 1×`TAP001` + 4 patas grandes
stock `TAP011` = 56 · stock `TAP001` = 50 · stock patas grandes = 56
→ armables = min( 56, 50, floor(56/4)=14 ) = **14 unidades** (las patas son el cuello de botella).

```sql
create view prod_v_armables as
select
  p.sku as producto_sku,
  least(
    coalesce(min(floor(sm.disponible / r.cantidad)), 999999),
    case when p.patas_cant > 0
         then floor(coalesce(sp.disponible,0) / p.patas_cant)
         else 999999 end
  )::int as armables
from prod_producto p
left join prod_receta r       on r.producto_sku = p.sku
left join prod_stock_melamina sm on sm.pieza_sku = r.pieza_sku
left join prod_stock_patas sp on sp.tamano = p.patas_tipo
group by p.sku, p.patas_cant, sp.disponible;
```

> **Por qué importa:** sin este cruce, Embalaje no sabe cuántos productos completos puede realmente armar y se generan faltantes invisibles. Por eso Embalaje, antes de armar, hace una **verificación de componentes** que muestra ✓/✗ por cada pieza, las patas y el kit.

### 6.3 Prioridad del día por cascada (pull / demanda) — EL CORAZÓN DEL SISTEMA

El sistema **no produce por empuje** (no fabrica contra un plan). Produce **por demanda (pull)**: las ventas netas entran como demanda de productos, y cada sector calcula su prioridad real **descontando el stock de su propio eslabón**. La prioridad fluye hacia atrás en la cadena.

**El flujo de negocio completo:**

```
1. Entran VENTAS NETAS → demanda de productos del día
2. EMBALAJE chequea su stock terminado:
      falta_embalaje = pedidos − stock_terminado(Embalaje)
3. Lo que falta se le pide a MELAMINA:
      falta_melamina = falta_embalaje(en piezas) − stock_piezas(Melamina)
4. Lo que falta se le pide a CNC:
      falta_cnc = falta_melamina(en piezas) − stock_crudo(CNC)
5. CNC corta SOLO lo que realmente falta.
   Cuando termina lo urgente → arranca los pedidos del día siguiente.
   (los demás sectores hacen lo mismo en cadena)
```

**Regla de oro del cálculo:** cada sector descuenta **solo el stock de su propio eslabón**, no el de los demás. Esto evita doble conteo y hace que cada coordinador vea exactamente lo que le toca producir.

```
prioridad_sector = demanda_recibida − stock_propio_del_sector
                   (solo se muestra lo que da > 0)
```

**Traducción producto → pieza (TAP):** la demanda llega en productos (MAD) pero CNC y Melamina trabajan en piezas (TAP). El sistema explota cada producto pedido contra su **receta** para obtener la demanda en TAP:

```sql
-- Demanda de piezas (TAP) derivada de los pedidos pendientes
create view prod_v_demanda_tap as
select
  r.pieza_sku,
  sum( (p.cantidad - coalesce(p.producido,0)) * r.cantidad )::int as demanda
from pedidos p                          -- ← tabla EXISTENTE de pedidos
join prod_receta r on r.producto_sku = p.producto_sku
where p.estado <> 'despachado'
group by r.pieza_sku;

-- Prioridad de MELAMINA = demanda_tap − stock terminado de Melamina
create view prod_v_prioridad_melamina as
select
  d.pieza_sku,
  d.demanda,
  coalesce(sm.disponible,0)                          as stock_propio,
  greatest(d.demanda - coalesce(sm.disponible,0),0)  as falta,
  coalesce(sc.disponible,0)                          as crudo_cnc
from prod_v_demanda_tap d
left join prod_stock_melamina sm on sm.pieza_sku = d.pieza_sku
left join prod_stock_pieza sc    on sc.pieza_sku = d.pieza_sku
where greatest(d.demanda - coalesce(sm.disponible,0),0) > 0
order by falta desc;
```

**Cómo se muestra en la app de cada sector:** la "Prioridad del día" se presenta con el mismo formato visual que el stock disponible (banner compacto), pero **en el color del sector**, para diferenciarla de un vistazo. Cada fila muestra:

- La pieza/producto que falta y cuánto falta (ordenado por mayor faltante = mayor prioridad).
- El stock del **eslabón anterior** disponible para avanzar. Si alcanza → en el color del sector; si no alcanza → en ámbar con la leyenda **"esperando [sector anterior]"**.

Ejemplo en Melamina: si faltan 56 tapas Boomerang y CNC ya dejó 60 crudas, el sector puede avanzar (violeta). Si CNC solo dejó 20, muestra "esperando CNC" en ámbar — Melamina no puede cubrir hasta que CNC priorice ese corte.

**Producción contra pedido puro:** no hay stock objetivo ni mínimo de productos terminados. Se produce exclusivamente contra pedido real. Cuando la demanda del día queda cubierta, el sector pasa automáticamente a los pedidos del día siguiente (que recién entonces aparecen en pantalla).

### 6.4 Descuento y suma de stock

- Al **registrar producción** → se descuentan placas/piezas/insumos consumidos.
  - CNC corta → **suma** a `prod_stock_pieza` (crudo).
  - Melamina termina → **descuenta** de `prod_stock_pieza` (consume crudo) y **suma** a `prod_stock_melamina`.
  - Embalaje arma → **descuenta** de `prod_stock_melamina` + `prod_stock_patas` + insumos del kit, y **suma** a `prod_stock_terminado`.
  - Pino termina patas → **suma** a `prod_stock_patas.disponible`; las masilladas suman a `prod_stock_patas.masilladas` (no disponibles aún).
- Al **cargar un remito** (encargado/administración) → se **suma** al stock de insumos.
- Cuando un insumo cae **bajo su mínimo** → se inserta en `prod_alerta` y el panel del encargado la muestra por Realtime.

Implementar con **triggers** sobre las tablas de registro, o con funciones llamadas desde las Edge Functions de carga.

### 6.5 El resumen del día es un espejo vivo

> El **"Resumen del día"** que ve cada sector **NO es una copia estática**: refleja los pedidos del sistema de ventas y se actualiza automáticamente cada vez que cambia el original. Si entra o se modifica un pedido, el resumen de todos los sectores se actualiza.

Se implementa como una **vista** que une los pedidos existentes por canal (unificando Colecta + Flex + resto) agrupados por producto/pieza. El frontend la consume vía Realtime o re-fetch ante cambios.

```sql
-- Ajustar nombres a las tablas reales de pedidos existentes
create view prod_v_resumen_dia as
select
  p.producto_sku,
  pr.nombre as modelo,
  pr.color,
  sum(p.cantidad - coalesce(p.producido,0)) as pendiente
from pedidos p                          -- ← tabla EXISTENTE de pedidos
join prod_producto pr on pr.sku = p.producto_sku
where p.estado <> 'despachado'
group by p.producto_sku, pr.nombre, pr.color
having sum(p.cantidad - coalesce(p.producido,0)) > 0;
```

---

<a name="7"></a>
## 7. Roles, RLS y seguridad

El módulo define **3 niveles de acceso** construidos sobre Supabase Auth. El rol se guarda en `app_metadata.rol` del usuario (no en metadata editable por el cliente).

| Rol | Puede hacer | Ve | Edición |
|---|---|---|---|
| **Coordinador** (`cnc`/`melamina`/`embalaje`/`pino`) | Cargar producción de su sector, solicitar insumos, reportar mantenimiento, aprobar solicitudes/mantenimiento de su sector | Solo su sector + prioridad del día | Su carga hasta 24 hs post-cierre |
| **Encargado** | Ver los 4 sectores en vivo, avance de pedidos, stock con alertas, cargar remitos, modificar cantidades | Panel de control de los 4 sectores | Cualquier dato, con auditoría |
| **Director** (dueño) | Todo lo del encargado + configuración, usuarios, carga del Excel de SKUs, recepción de reportes de mantenimiento | Dashboard total + módulo de SKUs | Total + configuración |

### RLS (Row Level Security)

```sql
alter table prod_corte enable row level security;

-- Coordinador CNC: inserta/lee cortes, edita solo dentro de la ventana de 24h
create policy cnc_insert on prod_corte
  for insert with check (
    (auth.jwt() -> 'app_metadata' ->> 'rol') = 'cnc'
  );

create policy cnc_update on prod_corte
  for update using (
    (auth.jwt() -> 'app_metadata' ->> 'rol') = 'cnc'
    and now() < editable_hasta
  );

-- Encargado y director: lectura/escritura total (auditoría por trigger)
create policy encargado_all on prod_corte
  for all using (
    (auth.jwt() -> 'app_metadata' ->> 'rol') in ('encargado','director')
  );
```

> Replicar el patrón en cada tabla de registro. La **auditoría** se aplica con un trigger `after update` que escribe en `prod_auditoria` cuando el que modifica es encargado o director, guardando además el `motivo` de la corrección.

---

<a name="8"></a>
## 8. Flujos de aprobación (insumos y mantenimiento)

Dos circuitos distintos, definidos por el negocio. Es importante respetarlos porque determinan quién recibe qué.

### 8.1 Solicitud de insumos

```
Coordinador del sector  →  carga la solicitud (Scan/Solicitud)
        ↓
Coordinador  →  APRUEBA la solicitud
        ↓
ADMINISTRACIÓN  →  recepciona y gestiona la compra
```

La solicitud de insumos **NO aparece en el panel del encargado**. Una vez aprobada por el coordinador, la recepciona administración. Estado: `pendiente → aprobada_coord → recepcionada_admin`.

### 8.2 Reporte de mantenimiento

```
Coordinador del sector  →  reporta el problema de máquina
        ↓
Coordinador  →  APRUEBA el reporte
        ↓
DIRECTOR (dueño)  →  recibe el reporte en SU panel
```

El reporte de mantenimiento, una vez aprobado por el coordinador, **va al panel del director (dueño)**, no al del encargado. Estado: `pendiente → aprobado_coord → recibido_director`.

### 8.3 Qué sí ve el encargado

El panel del encargado se enfoca en supervisión de producción pura: estado de los 4 sectores, avance de pedidos, **alertas de stock bajo** y carga de remitos. Las dos cadenas de aprobación de arriba quedan fuera de su panel (se muestran como notificación informativa de que fueron derivadas, pero no las gestiona él).

---

<a name="9"></a>
## 9. La cadena productiva y el encadenamiento entre sectores

Son **dos líneas** que convergen en Embalaje.

```
LÍNEA 1:   CNC  ───►  MELAMINA  ───►  EMBALAJE
           corta       con filo        arma y
           placas      + refilado      embala

LÍNEA 2:   PINO  ──────────────────►  EMBALAJE
           produce patas               (convergen)
```

Al **cerrar el día**, cada sector empuja sus datos netos al siguiente:

| Origen | Destino | Información que viaja |
|---|---|---|
| Sistema de pedidos | CNC, Melamina, Embalaje | Resumen del día / prioridad (qué se vende) |
| CNC | Melamina | Piezas crudas netas por modelo/color (cortes del día) |
| Melamina | Embalaje | Piezas terminadas (con filo + refilado), netas de fallas |
| Pino | Embalaje | Patas terminadas por tamaño (chicas / grandes) |
| Embalaje | Sistema de pedidos | Unidades terminadas = "listo para despacho" |
| Todos | Encargado | Estado en vivo, stock, alertas |

El encadenamiento se implementa con **triggers** que, al registrarse producción en un sector, actualizan los stocks por eslabón. El siguiente sector escucha por Realtime (no hay polling).

---

<a name="10"></a>
## 10. Especificación completa por sector

Los cuatro sectores comparten el mismo patrón de navegación inferior (con variaciones), el mismo dark mode y el color identificatorio propio. A continuación, el detalle definitivo de cada uno tal como quedó prototipado.

**Resumen de tabs por sector:**

| Sector | Inicio | Scan | Solicitud | Mantenimiento | Color |
|---|---|---|---|---|---|
| CNC | ✓ | ✓ | ✓ | ✓ | Azul `#2563EB` |
| Melamina | ✓ | ✓ | ✓ | ✓ | Violeta `#534AB7` |
| Embalaje | ✓ | ✓ | ✓ | ✗ (no requiere) | Coral `#993C1D` |
| Pino | ✓ | ✓ | ✓ | ✓ | Verde `#0F6E56` |

> **Nota:** Embalaje **no lleva** pestaña de Mantenimiento (no opera máquinas críticas). Los demás sí.

<a name="10-1"></a>
### 10.1 CNC

**Rol:** primer eslabón de la Línea 1. Corta placas que se convierten en piezas crudas para Melamina.

#### Tab Inicio
- **Resumen del día** (Colecta + Flex unificados, espejo vivo): tabla simple con SKU, Modelo, Color y Total pendiente. Sin separar por canal, sin prioridades — solo lo que hay que producir.
- **Cortes del día**: tabla que se va llenando a medida que el operario carga desde Scan. Formato exacto: `SKU | Modelo | Color | Hojas | Generadas | Desperdicio | Totales`. Al pie, el total de piezas netas que van a Melamina.

#### Tab Scan
- Abre la cámara para escanear el **QR del SKU de placa** (reutiliza el botón Scan existente). El QR trae nombre, color y rendimiento automáticamente.
- Alternativa manual: selección del SKU desde lista agrupada (placas blancas / negras / mármol / combinadas).
- Campos a cargar: **hojas cortadas** + **desperdicios**.
- Vista previa en vivo: piezas generadas (hojas × rendimiento), desperdicio y total neto para Melamina.
- Botón "Agregar al reporte" → alimenta la tabla Cortes del día.

#### Tab Solicitud (genera reporte → aprueba coordinador → administración)

| Categoría | Opciones |
|---|---|
| **Fresas** | 2 tipos: **Compresión** (corte limpio doble cara) · **Filo horario** (corte cara superior) + cantidad + observación |
| **Esponja** | Para limpieza de guías + cantidad |
| **Lubricantes** | Aceite · Grasa · WD-40 + cantidad |
| **Refrigerante** | Agua destilada + cantidad |
| **Maquinaria / Otros** | Campo de texto libre |

#### Tab Mantenimiento
Tipo de problema (Mecánico, Eléctrico, Software/CNC, Temperatura, Ruido/vibración, Preventivo), urgencia (Alta/Media/Baja), máquina afectada y descripción libre. → aprueba coordinador → director.

<a name="10-2"></a>
### 10.2 Melamina

**Rol:** segundo eslabón de la Línea 1. Toma piezas crudas de CNC, las procesa y deja piezas terminadas para Embalaje. Trabaja **por pieza (TAP) individual**, ordenado por prioridad de pedidos.

**Sub-procesos:** internamente son 4 (Con filo → Desbaste → Terminación → Refilado), pero **solo se registra el resultado final** (TAP terminados + fallas). No se registra cada sub-proceso por separado.

#### Tab Inicio
- **Piezas crudas disponibles · de CNC** (banner azul): stock vivo de piezas que dejó CNC, por TAP. Se descuenta a medida que Melamina procesa.
- **Prioridad del día · por pieza (TAP)** (banner violeta, mismo formato que el de crudas pero en color de Melamina): cada fila muestra la pieza, cuánto falta (demanda − stock propio de Melamina) y el crudo disponible de CNC. Si el crudo alcanza → violeta; si no → "esperando CNC" en ámbar. Solo muestra lo que realmente falta; cuando se cubre, desaparece.
- **Piezas terminadas hoy**: tabla `SKU | Pieza | Color | Terminadas | Fallas | Netas`. Al pie, total para Embalaje.

#### Tab Scan
- Cámara para escanear el **QR de la pieza (TAP)** o carga manual.
- Al elegir la pieza, muestra cuánto crudo hay disponible de CNC.
- Campos: **terminadas** + **fallas/roturas**.
- Valida que no se exceda el stock crudo. Al confirmar: **descuenta** del crudo de CNC y **suma** las netas a Embalaje.

#### Tab Solicitud (insumos propios de Melamina)

| Categoría | Opciones |
|---|---|
| **Filo** | 7 colores: Blanco · Negro · Teka Ártico · Kiri · Paraíso · Lino Chiaro · Seda Giorno (+ rollos) |
| **Herramientas y consumibles** | Tiza · Espátula · Pistola de calor · Lijas · Mecha · Fibrón negro (checklist) |
| **Moldes** | Molde / detalle + cantidad |

#### Tab Mantenimiento
Tipos propios: Enchapadora, Pistola de calor, Eléctrico, Molde, Ruido/vibración, Preventivo. Misma mecánica de urgencia + descripción.

<a name="10-3"></a>
### 10.3 Embalaje

**Rol:** punto de convergencia de las dos líneas. Arma productos completos y cierra el ciclo. Trabaja **por producto terminado (MAD)** — arma el producto completo, no piezas sueltas. **No registra fallas** (solo productos terminados). **No lleva Mantenimiento.**

#### Tab Inicio
- **Prioridad del día · productos a embalar** (banner coral): productos ordenados **por canal** (Colecta primero, luego Flex, luego el resto). Cada fila muestra cuánto falta y cuántos son armables ahora. Si faltan piezas o patas → "esperando piezas/patas" en ámbar.
- **Stock disponible para armar**, de dos fuentes:
  - Piezas terminadas · de Melamina (banner violeta), por TAP.
  - Patas · de Pino (banner verde).
- **Embalados hoy · listos para despacho**: tabla `SKU | Producto | Canal | Embalados`. Al pie, total listos para despacho.

#### Tab Scan (armar producto)
- Escanea el **QR del producto (MAD)** o selección manual.
- **Verificación de componentes** (clave): muestra un checklist con cada tapa que necesita, las patas y el kit de embalaje, con ✓ verde (hay stock) o ✗ rojo (falta).
- Calcula automáticamente cuántas unidades son **armables** (el cuello de botella — ej. MAD301 puede armar 14 porque las patas limitan, aunque sobren tapas).
- Selector de cantidad a armar. Al confirmar: **descuenta** piezas (Melamina) + patas (Pino) + insumos del kit, y marca el producto como **"listo para despacho"**, informando al sistema de pedidos.

#### Tab Solicitud (insumos de embalaje)

| Categoría | Opciones |
|---|---|
| **Insumos de kit** | Cajas (varios tamaños) · Film burbuja · Tornillos · Soportes · Bolsas (checklist) |
| **Otros insumos** | Cinta de embalar · Etiquetas/stickers · Fleje/precinto · Esquineros de cartón · Marcador/fibrón (checklist) |
| **Otro** | Texto libre + cantidad |

<a name="10-4"></a>
### 10.4 Pino (Patas)

**Rol:** Línea 2. Trabaja madera de pino en bruto y produce patas. **Dos tamaños:** chicas y grandes. El proceso interno tiene 6 etapas pero **solo se registra el resultado final** (no se muestra el proceso al operario).

**Dos estados de pata:**
- **Terminadas:** listas → van directo a Embalaje como stock utilizable.
- **Masilladas:** reparadas con masilla; **requieren otro proceso antes de servir**, así que se cuentan **aparte** (pendientes, no disponibles para Embalaje todavía).

#### Tab Inicio
- **Prioridad del día · patas a producir** (banner verde): por tamaño (chicas/grandes), faltante = demanda − stock propio. Muestra el stock actual de cada tamaño.
- **Stock de patas terminadas**: dos contadores grandes (Chicas / Grandes).
- **Patas masilladas · pendientes** (tarjeta ámbar separada): reparadas, requieren otro proceso antes de servir.
- **Producidas hoy**: tabla `Tipo de pata | Terminadas | Masilladas`. Al pie, total terminadas → Embalaje.

#### Tab Scan (carga manual, sin QR — son a granel)
Carga en 3 pasos: (1) **tamaño** chica/grande, (2) **estado** terminada/masillada, (3) **cantidad** (botones grandes o tecleado). Las terminadas suman al stock para Embalaje; las masilladas al contador de pendientes.

#### Tab Solicitud (insumos de Pino)

| Categoría | Opciones |
|---|---|
| **Madera y varillas** | Listón 2×1 · Listón 2×2 · Varilla 25mm · Varilla 14mm |
| **Lijas** | Lijas con velcro · Lija para tambor · Lija para lijadora de banda |
| **Masilla y terminación** | Masilla · Enduido |
| **Clavos** | Clavo 25mm · 30mm · 40mm · 50mm |
| **Eléctrico / herrajes** | Cable blanco · Cable negro · Portalámpara blanco · Portalámpara negro · Rosca · Tuercas · Base 3D · Mecha |
| **Herramientas** | Amoladora · Atornilladora · Clavadora |
| **Otro** | Texto libre + cantidad |

#### Tab Mantenimiento
M�quinas reales del sector: **Ingletadora · Cepilladora · Caladora · Lijadora de tambor · Lijadora de banda · Compresor de aire · Atornilladora · Amoladora** + urgencia + descripción.

> **Pendiente futuro:** el sub-sector **Carpintería** de Pino (ensamble de productos completos) se desarrolla en una etapa posterior. Por ahora solo Sector Patas.

---

<a name="11"></a>
## 11. Panel del Encargado de Producción

A diferencia de los coordinadores, el encargado **no carga producción**: es el centro de control que ve todo lo que generan los 4 sectores en vivo. Navegación de 4 tabs: **Inicio · Sectores · Stock · Avisos**.

### Tab Inicio (estado general)
- **KPIs del día** (4 tarjetas): Producido hoy (total 4 sectores), Listos para despacho, Falta despachar (de N pedidos), Alertas de stock activas.
- **Avance de pedidos del día**: barra de progreso global (ej. 47/119 unidades) + desglose por canal (Colecta, Flex) con su barra y horario de retiro.
- **Cadena productiva en vivo**: las 2 líneas (L1: CNC→Melamina→Embalaje, L2: Pino→Embalaje) con las cantidades actuales de cada nodo.
- **Alertas activas**: lista de insumos bajo mínimo, ordenadas por criticidad (crítico/bajo).

### Tab Sectores (detalle de cada uno)
Una tarjeta por sector (CNC, Melamina, Embalaje, Pino) con:
- Estado (Cerrado / En curso) + nombre del coordinador + hora de cierre o última carga.
- Mini-métricas del día (ej. CNC: Piezas / Placas / Desperdicio; Pino: Chicas / Grandes / Masilladas).
- Botón **✎ Editar** que abre un modal de corrección **con auditoría obligatoria** (campo + motivo de la corrección; queda registrado usuario, fecha, hora, valor anterior y nuevo).

### Tab Stock (e insumos)
- Botón **＋ Cargar remito de mercadería** → modal (proveedor, N° remito, insumo, cantidad) que **suma al stock**.
- **Bajo mínimo**: insumos críticos/bajos con barra de nivel y mínimo.
- **Stock general**: materia prima e insumos con su nivel actual vs mínimo.
- **Últimos remitos** cargados.

### Tab Avisos
Notificaciones en vivo: alertas de stock crítico/bajo, jornadas cerradas por sector (con lo que pasó al siguiente), y aviso informativo de que un reporte de mantenimiento fue aprobado y derivado al director. Al pie, recordatorio del ruteo: *las solicitudes de insumos las recepciona administración; los reportes de mantenimiento, una vez aprobados por el coordinador, van al panel del director.*

### Capacidades transversales del encargado
- **Editar con registro:** puede modificar cualquier cantidad cargada por los coordinadores, pero cada cambio exige un motivo y queda auditado.
- **Cargar remitos:** tanto el encargado como administración pueden hacerlo.
- **No gestiona** solicitudes de insumos (van a administración) ni recibe los reportes de mantenimiento finales (van al director).

---

<a name="12"></a>
## 12. Realtime: los espejos en vivo

Supabase Realtime es el mecanismo que hace que todo esté "en vivo" sin polling.

| Lo que escucha | Quién escucha | Para qué |
|---|---|---|
| Cambios en pedidos (tabla existente) | Todos los sectores | Actualizar el "Resumen / prioridad del día" automáticamente |
| `prod_stock_pieza` | Melamina | Ver las piezas crudas que dejó CNC |
| `prod_stock_melamina`, `prod_stock_patas` | Embalaje | Ver piezas terminadas y patas disponibles |
| `prod_corte`, `prod_melamina`, `prod_embalaje`, `prod_pino` | Encargado | Dashboard en vivo de los 4 sectores |
| `prod_alerta` | Encargado | Alertas de stock bajo |
| `prod_mantenimiento` (estado recibido_director) | Director | Reportes de mantenimiento aprobados |

```js
// Ejemplo: Melamina escucha lo que CNC dejó disponible
supabase
  .channel('stock-piezas')
  .on('postgres_changes',
      { event: '*', schema: 'public', table: 'prod_stock_pieza' },
      payload => refrescarPiezasDisponibles(payload.new))
  .subscribe();
```

---

<a name="13"></a>
## 13. Capa de servicios / Edge Functions

Toda la lógica de cálculo vive del lado servidor. Endpoints sugeridos (adaptar a la convención del sistema):

```
// ── Catálogo (capa 0) ──
POST  /functions/v1/import-skus        // importa Excel (solo director)
GET   /rest/v1/prod_producto           // catálogo (PostgREST nativo)

// ── Captura por sector (capa 2) ──
POST  /rest/v1/prod_corte              // CNC: {placa_sku, hojas, desperdicio}
POST  /rest/v1/prod_melamina           // {pieza_sku, terminadas, fallas}
POST  /rest/v1/prod_embalaje           // {producto_sku, unidades, canal}
POST  /rest/v1/prod_pino               // {tamano, terminadas, masilladas}

// ── Solicitudes / mantenimiento (con flujo de aprobación) ──
POST  /rest/v1/prod_solicitud
PATCH /rest/v1/prod_solicitud?id=...   // aprobar (coordinador)
POST  /rest/v1/prod_mantenimiento
PATCH /rest/v1/prod_mantenimiento?id=... // aprobar (coordinador) → director

// ── Cierre de jornada (capa 4 — dispara encadenamiento) ──
POST  /functions/v1/cerrar-jornada     // {sector} → recalcula stocks y notifica

// ── Stock / remitos (capa 3/5) ──
GET   /rest/v1/prod_v_stock            // estado con alertas (vista)
POST  /rest/v1/prod_remito             // suma stock (encargado/admin)

// ── Panel encargado (capa 5) ──
GET   /rest/v1/prod_v_dashboard        // estado en vivo de los 4 sectores
PATCH /rest/v1/prod_corte?id=...       // ajuste con auditoría (encargado)

// ── Vistas de cálculo (capa 3) ──
GET   /rest/v1/prod_v_cortes_dia
GET   /rest/v1/prod_v_armables
GET   /rest/v1/prod_v_prioridad_melamina
GET   /rest/v1/prod_v_demanda_tap
GET   /rest/v1/prod_v_resumen_dia
```

**Cálculos que viven en el servidor (no en el frontend):**

- `piezas = hojas × rendimiento − desperdicio`
- `productos_armables = min de la receta (piezas + patas) vs stock`
- `prioridad = demanda − stock propio del eslabón` (cascada)
- descuento/suma de stock + verificación de mínimos + disparo de alertas
- agregación del resumen del día desde los pedidos por canal

> **Regla de arquitectura:** El frontend solo muestra y captura. Esto garantiza que los celulares de los coordinadores, el panel del encargado y el dashboard del director lean **la misma fuente de verdad**.

---

<a name="14"></a>
## 14. Frontend y UX — patrón común de los sectores

Todos los sectores comparten el mismo esqueleto, lo que reduce el trabajo de desarrollo: se construye un sector (CNC) y los demás replican el patrón cambiando datos y color.

**Estructura común:**
- **Topbar**: pill del sector (con color e indicador "en vivo"), reloj, nombre del sector, estado de jornada.
- **Contenido scrolleable** por tab.
- **Navegación inferior** fija de 4-5 ítems (Inicio · Scan · Solicitud · [Mant.] · Perfil), con el color del sector en el ítem activo y un badge numérico cuando hay cargas pendientes.
- **Banners de stock/prioridad**: formato compacto reutilizable, cambia de color según el sector y el origen (azul=CNC, violeta=Melamina, coral=Embalaje, verde=Pino).
- **Vista previa en vivo**: cada carga muestra qué genera y a quién alimenta antes de confirmar.
- **Mensajes de confirmación**: al enviar solicitud/mantenimiento o cerrar carga.

**Mobile-first**: los coordinadores usan celular. Ancho objetivo ~390px, áreas táctiles grandes, botones de cantidad amplios.

---

<a name="15"></a>
## 15. Branding y sistema de diseño

El módulo debe verse como parte **nativa** de la app. Se respeta el dark mode actual. Cada sector tiene un color identificatorio.

### Colores por sector

| Sector | Color | Hex | Uso |
|---|---|---|---|
| CNC | Azul | `#2563EB` | Acentos, banners, badge del sector |
| Melamina | Violeta | `#534AB7` | Acentos del sector |
| Embalaje | Coral/Tierra | `#993C1D` | Acentos del sector |
| Pino | Verde | `#0F6E56` | Acentos del sector |
| Encargado | Slate | `#2E4057` | Panel de control |

### Sistema base (dark)

| Token | Hex | Uso |
|---|---|---|
| Fondo base | `#0C0C0E` | Background general |
| Superficie | `#1A1A1D` | Cards y contenedores |
| Superficie 2 | `#222226` | Inputs, celdas internas |
| Borde | `#28282E` | Separadores |
| Texto primario | `#EFEFEF` | Títulos y datos |
| Texto secundario | `#9898A6` | Subtítulos |
| Texto terciario | `#55555F` | Labels, hints |
| Éxito | `#00D68F` | Confirmaciones, totales netos |
| Alerta | `#FFB020` | Stock bajo, en curso, "esperando" |
| Error | `#FF4060` | Fallas, stock crítico |

**Tipografía (placeholder):** Inter para UI, JetBrains Mono para números/SKU. Reemplazar por la tipografía oficial de la app.

> **Instrucción de branding:** reemplazar los colores de sector por la paleta oficial de la marca, manteniendo contraste y jerarquía. Íconos y logo deben alinearse con el manual de marca. Los prototipos entregados usan placeholders.

---

<a name="16"></a>
## 16. Plan de implementación por capas (roadmap)

Orden recomendado. Cada fase es desplegable y validable **sin romper lo anterior**.

| Fase | Capa | Entregable | Criterio de aceptación |
|---|---|---|---|
| **1** | 0 | Migración de tablas `prod_*` + Edge Function de importación del Excel | El director carga el Excel y ve todos los SKUs en el catálogo |
| **2** | 1 | Roles en `app_metadata` + políticas RLS | Cada rol entra y ve su vista vacía correcta |
| **3** | 2+3 | CNC completo (4 tabs) + vistas de cálculo de cortes | CNC carga cortes y ve piezas netas calculadas correctamente |
| **4** | 4 | Encadenamiento CNC→Melamina (trigger + Realtime) | Melamina ve automático las piezas crudas que dejó CNC |
| **5** | 2+3 | Melamina completo (prioridad TAP por cascada) | Melamina carga terminadas/fallas y alimenta a Embalaje |
| **6** | 2+3 | Pino completo (patas chicas/grandes + masilladas) | Pino carga patas y alimenta a Embalaje |
| **7** | 2+3+4 | Embalaje + verificación de componentes + armables + "listo para despacho" | Embalaje arma productos y marca pedidos como listos |
| **8** | 5 | Panel del encargado (4 tabs) + alertas + remitos + auditoría | Encargado ve los 4 sectores en vivo y edita con registro |
| **9** | 5 | Flujos de aprobación (insumos→admin, mantenimiento→director) | Las solicitudes y reportes rutean correctamente |
| **10** | 6 | Histórico, KPIs y dashboard del director | Reportes por período y exportación |

> **Por qué este orden:** CNC es el primer eslabón y valida toda la lógica de SKU→corte→piezas. Si CNC funciona bien, el resto de los sectores replican el mismo patrón. El panel del encargado se construye recién cuando hay datos reales fluyendo de al menos 2 sectores.

---

<a name="17"></a>
## 17. Reglas de oro y no-negociables

1. **No romper lo existente.** Todo vive en tablas `prod_*` / schema aislado. Ninguna migración toca tablas de ventas.
2. **El SKU es la única fuente de verdad.** Todo producto, placa, pieza e insumo se identifica por su SKU único e inmutable.
3. **La lógica vive en el backend.** El frontend nunca calcula piezas, armables, prioridad ni stock: solo muestra y captura.
4. **El resumen del día es un espejo vivo.** Refleja los pedidos reales (vista) y se actualiza vía Realtime.
5. **Edición con ventana de 24 hs.** El coordinador corrige su carga hasta 24 hs; después, solo encargado/director.
6. **Todo cambio se audita.** Usuario, fecha, dato anterior, dato nuevo y motivo quedan en `prod_auditoria`.
7. **Carga por hojas, no por piezas.** CNC carga hojas cortadas; el sistema deriva las piezas con el rendimiento.
8. **Convergencia en Embalaje.** Las 2 líneas (CNC→Melamina y Pino) terminan en Embalaje, que cierra el ciclo.
9. **Stock siempre consistente.** Producción descuenta, remitos suman, mínimos disparan alertas.
10. **Respetar el branding.** El módulo se ve como parte nativa de la app, con la paleta oficial.
11. **Prioridad por cascada (pull).** Se produce contra pedido real. Cada sector calcula su prioridad como `demanda − stock propio del eslabón` y muestra contra el stock del eslabón anterior si puede avanzar o si está "esperando" al sector previo. No hay producción por empuje ni stock objetivo.
12. **Embalaje arma productos completos** verificando los 3 componentes (piezas + patas + kit) antes de armar; no registra fallas.
13. **Pino distingue terminadas de masilladas.** Las terminadas van a Embalaje; las masilladas quedan pendientes de otro proceso, contadas aparte.
14. **Ruteo de aprobaciones.** Insumos: coordinador aprueba → administración recepciona. Mantenimiento: coordinador aprueba → director recibe. El encargado no gestiona ninguno de los dos.

---

<a name="18"></a>
## 18. Cómo NO romper lo existente

Esta sección es la diferencia entre integrar bien y generar deuda técnica.

### Aislamiento de datos
- **Todo lo nuevo bajo prefijo `prod_`** o un schema `produccion`. Ninguna tabla existente se altera, solo se **lee** (pedidos) mediante vistas o JOIN.
- No se agregan columnas a tablas de ventas. Si Embalaje necesita marcar "listo para despacho", se hace en una tabla puente `prod_pedido_estado` que referencia el pedido por id, **sin tocar la tabla original**.

### Aislamiento de UI
- El módulo vive **solo** dentro de la sección "Producción". No se modifican las otras pestañas.
- El contenido de "Producción" se decide por rol con un *guard*: si el usuario no tiene rol de producción, ve la vista actual (vacía) sin cambios.

### Aislamiento de auth
- Los roles se agregan en `app_metadata` (servidor), no se cambia el flujo de login ni el registro de usuarios existente.

### Despliegue seguro
- Cada fase se mergea detrás de un **feature flag** (`feature.produccion`). Si algo falla, se apaga el flag y el sistema vuelve al estado anterior sin redeploy.
- Las migraciones son **aditivas** (solo `create`, nunca `drop`/`alter` sobre lo existente). Cada migración tiene su `down` que elimina solo lo que creó.

### Validación entre fases
- No avanzar de fase sin validar la anterior en un entorno de staging con datos reales.
- Cada fase tiene su criterio de aceptación (sección 16). Si no se cumple, no se promueve a producción.

---

<a name="19"></a>
## 19. Pendientes para etapas futuras

Cosas que quedaron definidas conceptualmente pero se construyen más adelante:

- **Dashboard del Director (dueño):** vista ampliada con analítica, KPIs históricos, comparativas por período, y recepción de los reportes de mantenimiento aprobados. (Capa 6.)
- **Sub-sector Carpintería de Pino:** ensamble de productos de madera completos. Por ahora Pino solo cubre Sector Patas.
- **Módulo de artículos / ficha de producto completa:** ficha detallada navegable de cada SKU (más allá del catálogo de importación).
- **Histórico y reportes exportables:** producción por día/semana/mes, con exportación a Excel/PDF. (Capa 6.)

---

<a name="20"></a>
## 20. Prompt para el equipo de desarrollo

> Copiá y pegá el siguiente bloque a tu equipo (o a un asistente de IA de código). Entregalo junto con: (1) el Excel maestro de SKUs `sku_para_sistema.xlsx`, (2) los prototipos HTML de las 5 pantallas (CNC, Melamina, Embalaje, Pino, Encargado), (3) este brief completo.

```
CONTEXTO
Tenemos una app de gestión en producción, construida sobre Supabase (PostgreSQL + Auth +
RLS + Realtime). Administra pedidos de venta por canal (Colecta, Flex, Tienda Nube,
Distribuidores, No Flex, Correo Argentino, Stock). Ya tiene login por usuario, navegación
inferior, una sección "Producción" vacía y un botón "Scan". Hay que expandir esa sección
para convertirla en un sistema de trazabilidad de fábrica en tiempo real, SIN romper nada
de lo existente.

OBJETIVO
Implementar un módulo de Producción en Línea, por capas incrementales, sobre la misma app
y la misma base de datos. Cada capa debe ser desplegable de forma independiente. Todo lo
nuevo vive bajo el prefijo prod_ (o schema "produccion"); ninguna migración toca tablas de
ventas — solo se leen mediante vistas/JOIN. Usar feature flag "feature.produccion".
Migraciones aditivas (create, nunca alter/drop sobre lo existente).

MODELO DE DATOS (núcleo: el SKU)
- prod_producto (MADxxx): sku, nombre, color, tipo(simple|combinado), patas_tipo(chica|
  grande|null), patas_cant, kit_embalaje jsonb.
- prod_receta: producto_sku, pieza_sku, cantidad. (qué piezas componen cada producto)
- prod_placa (PLB/PLN/PMB/PMN/COM): sku, nombre, material, rendimiento int, pieza_sku,
  combinada bool. (+ prod_placa_pieza_extra para placas COM que rinden 2 piezas)
- prod_pieza (TAP): sku, nombre.
- prod_insumo: sku, nombre, categoria, sector, stock_actual, stock_minimo, unidad.
- Operación: prod_jornada, prod_corte, prod_melamina, prod_embalaje, prod_pino.
- Stock por eslabón: prod_stock_pieza (crudo CNC), prod_stock_melamina (terminado Melamina),
  prod_stock_patas (chicas/grandes + masilladas), prod_stock_terminado (productos Embalaje).
- Soporte: prod_solicitud, prod_mantenimiento, prod_remito, prod_alerta, prod_auditoria.
El catálogo se importa de un Excel de 4 pestañas (insumos, placas+tapas, composición x
producto, productos) vía Edge Function. Solo el rol director. SKU único e inmutable; upsert,
nunca duplica. El Excel es semicolon-delimited, Latin-1, número AR (punto miles, coma decimal).

LÓGICA DE NEGOCIO (en el backend: vistas/funciones SQL o Edge Functions, NUNCA en frontend)
1) Corte: piezas_generadas = hojas × rendimiento; netas = generadas − desperdicio.
2) Productos armables = min sobre la receta de floor(stock_pieza/cant) Y floor(stock_patas/
   patas_cant). El cuello de botella manda.
3) PRIORIDAD POR CASCADA (pull): se produce contra pedido real. Cada sector calcula
   prioridad = demanda_recibida − stock_propio_del_eslabón (solo muestra lo que da > 0).
   Flujo: ventas netas → Embalaje (− su stock terminado) → Melamina (− su stock piezas) →
   CNC (− su stock crudo). CNC corta solo lo que falta; al terminar, pasa al día siguiente.
   Traducir producto→pieza explotando la receta (prod_v_demanda_tap).
4) Descuento/suma de stock entre eslabones por trigger; alerta bajo mínimo → prod_alerta.
5) "Resumen del día" = vista viva que agrega los pedidos por canal (espejo, no copia) +
   Realtime.

CADENA PRODUCTIVA (2 líneas que convergen en Embalaje)
Línea 1: CNC (corta placas) → Melamina (con filo + refilado) → Embalaje.
Línea 2: Pino (produce patas chicas/grandes) → Embalaje.
Al cerrar el día, cada sector actualiza los stocks del siguiente vía trigger; el siguiente
escucha por Realtime. Embalaje, al cerrar un artículo, marca el pedido "listo para despacho"
en una tabla puente (sin tocar la tabla de pedidos).

ROLES (sobre Supabase Auth, en app_metadata.rol)
- Coordinador (cnc/melamina/embalaje/pino): carga su sector, solicita insumos, reporta
  mantenimiento, aprueba solicitudes/mantenimiento de su sector; edita su carga hasta 24 hs
  post-cierre; ve solo su sector. RLS por rol.
- Encargado: ve los 4 sectores en vivo + avance de pedidos, modifica con auditoría, carga
  remitos, ve alertas de stock. NO gestiona insumos ni recibe mantenimiento.
- Director (dueño): todo + configuración, usuarios, carga del Excel, recibe reportes de
  mantenimiento aprobados.
Toda modificación de encargado/director se audita (trigger → prod_auditoria, con motivo).

FLUJOS DE APROBACIÓN
- Insumos: coordinador carga → coordinador aprueba → ADMINISTRACIÓN recepciona. (No va al
  encargado.)
- Mantenimiento: coordinador reporta → coordinador aprueba → DIRECTOR recibe en su panel.

SECTOR CNC (implementar primero, 4 tabs: Inicio, Scan, Solicitud, Mantenimiento)
- Inicio: "Resumen del día" (Colecta+Flex unificados, espejo vivo: SKU, modelo, color, total)
  + tabla "Cortes del día" (SKU | Modelo | Color | Hojas | Generadas | Desperdicio | Totales).
- Scan: QR del SKU de placa (trae rendimiento) o manual; carga hojas + desperdicios; vista
  previa de piezas netas → Melamina.
- Solicitud: fresas (Compresión|Filo horario), esponja (limpieza guías), lubricantes (aceite|
  grasa|WD-40), refrigerante (agua destilada), maquinaria (texto libre).
- Mantenimiento: tipo, urgencia, máquina, descripción.

SECTOR MELAMINA (4 tabs) — trabaja por TAP individual
- Inicio: banner "Piezas crudas disponibles de CNC" (azul) + banner "Prioridad del día por
  TAP" (violeta, mismo formato, faltante = demanda − stock propio Melamina, muestra crudo de
  CNC y "esperando CNC" si no alcanza) + tabla "Piezas terminadas" (SKU|Pieza|Color|Terminadas
  |Fallas|Netas).
- Scan: QR de pieza (TAP) o manual; carga terminadas + fallas/roturas; descuenta crudo de CNC,
  suma a Embalaje. Solo se registra el resultado final (no los 4 sub-procesos).
- Solicitud: filo (7 colores: Blanco, Negro, Teka Ártico, Kiri, Paraíso, Lino Chiaro, Seda
  Giorno), tiza, espátula, pistola de calor, lijas, mecha, fibrón negro, moldes.
- Mantenimiento: enchapadora, pistola de calor, eléctrico, molde, etc.

SECTOR EMBALAJE (3 tabs: Inicio, Scan, Solicitud — SIN Mantenimiento) — trabaja por producto MAD
- Inicio: "Prioridad del día" (coral, productos ordenados por canal: Colecta→Flex→resto,
  faltante + armables, "esperando piezas/patas" si falta) + stock de Melamina (violeta) y de
  Pino (verde) + tabla "Embalados hoy" (SKU|Producto|Canal|Embalados) marcados listos para
  despacho.
- Scan: QR del producto (MAD) o manual; VERIFICACIÓN DE COMPONENTES (checklist ✓/✗ de cada
  tapa + patas + kit); calcula armables (cuello de botella); al confirmar descuenta piezas +
  patas + kit y marca "listo para despacho". NO registra fallas.
- Solicitud: kit (cajas, film, tornillos, soportes, bolsas) + otros (cinta, etiquetas, fleje,
  esquineros, marcador) + texto libre.

SECTOR PINO (4 tabs) — 2 tamaños de pata, solo se registra resultado final
- Inicio: "Prioridad del día" (verde, por tamaño chica/grande) + stock de patas terminadas
  (2 contadores) + tarjeta aparte "patas masilladas pendientes" (ámbar) + tabla "Producidas
  hoy" (Tipo | Terminadas | Masilladas).
- Scan: carga MANUAL (sin QR) en 3 pasos: tamaño (chica/grande) → estado (terminada/masillada)
  → cantidad. Terminadas → stock para Embalaje; masilladas → contador pendiente.
- Solicitud: listón 2x1/2x2, varilla 25/14mm, lijas (velcro/tambor/banda), masilla, enduido,
  clavos (25/30/40/50mm), cable blanco/negro, portalámpara blanco/negro, rosca, tuercas, base
  3D, mecha, herramientas (amoladora, atornilladora, clavadora), texto libre.
- Mantenimiento: ingletadora, cepilladora, caladora, lijadora de tambor, lijadora de banda,
  compresor de aire, atornilladora, amoladora.

PANEL DEL ENCARGADO (4 tabs: Inicio, Sectores, Stock, Avisos)
- Inicio: KPIs (producido hoy, listos despacho, falta despachar, alertas) + avance de pedidos
  del día (global + por canal con horario) + cadena productiva en vivo (2 líneas) + alertas.
- Sectores: tarjeta por sector (estado, coordinador, hora, mini-métricas) + botón Editar que
  abre modal con AUDITORÍA OBLIGATORIA (campo + motivo).
- Stock: botón cargar remito (suma stock) + insumos bajo mínimo + stock general + últimos
  remitos.
- Avisos: alertas de stock, jornadas cerradas, aviso de mantenimiento derivado al director.

FRONTEND / UX
Mobile-first (~390px). Dark mode, sistema visual de la app. Color por sector: CNC #2563EB,
Melamina #534AB7, Embalaje #993C1D, Pino #0F6E56, Encargado #2E4057 (reemplazar por paleta de
marca). Patrón común: topbar con pill del sector, contenido por tab, nav inferior con color
del sector activo. Banners de stock/prioridad reutilizables (color por origen). Cada carga
muestra vista previa en vivo. Usar Realtime para los espejos (resumen del día, stock entre
sectores, dashboard, alertas). Tipografía placeholder Inter + JetBrains Mono.

PLAN DE IMPLEMENTACIÓN POR CAPAS (respetar el orden, no avanzar sin validar la anterior)
Fase 1: migración tablas prod_* + Edge Function de importación del Excel.
Fase 2: roles en app_metadata + políticas RLS.
Fase 3: CNC completo + vistas de cálculo de cortes.
Fase 4: encadenamiento CNC → Melamina (trigger + Realtime).
Fase 5: Melamina completo (prioridad TAP por cascada).
Fase 6: Pino completo (patas chicas/grandes + masilladas).
Fase 7: Embalaje + verificación de componentes + armables + "listo para despacho".
Fase 8: panel del encargado (4 tabs) + alertas + remitos + auditoría.
Fase 9: flujos de aprobación (insumos→admin, mantenimiento→director).
Fase 10: histórico, KPIs y dashboard del director.

NO-NEGOCIABLES
- No romper ninguna área existente. Migraciones aditivas. Feature flag para apagar todo.
- Toda la lógica de cálculo en el backend; el frontend solo muestra y captura.
- El SKU es la única fuente de verdad.
- El resumen/prioridad del día se actualiza solo cuando cambian los pedidos (vista + Realtime).
- Prioridad por cascada: cada sector descuenta SOLO su propio stock.
- Edición del coordinador limitada a 24 hs; todo cambio posterior se audita con motivo.
- Embalaje verifica los 3 componentes antes de armar; Pino separa terminadas de masilladas.
- Ruteo: insumos → administración; mantenimiento → director.

ENTREGABLE ESPERADO
Implementar de la Fase 1 hacia adelante, UNA fase por vez, con migraciones SQL, políticas RLS,
Edge Functions, vistas de cálculo y pantallas mobile. Validar cada fase en staging con datos
reales antes de promover a producción. Empezar por la Fase 1.
```

---

*Fin del brief — Módulo de Producción en Línea · v2.0 (final completo)*
