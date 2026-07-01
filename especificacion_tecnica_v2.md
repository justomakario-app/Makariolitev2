# Especificación técnica — Gestión de estados de venta (A despachar / Canceladas / Reprogramadas)

**Proyecto:** Dashboard de producción — Justo Makario
**Módulo:** Importación de ventas Mercado Libre + clasificación de estados
**Tipo de documento:** Especificación funcional y técnica para implementación backend
**Versión:** 2 — actualizada con estructura real del Excel de ML

---

## 1. Contexto del negocio

El dashboard de producción gestiona pedidos de venta provenientes de Mercado Libre (ML), distribuidos en canales de logística: **Colecta, Flex, Tienda Nube, Distribuidores, No Flex, Correo Argentino y Stock**.

Actualmente **no existe integración directa con la API de Mercado Libre**. La carga es **manual**: el operador descarga un Excel desde ML y lo importa. Esta descarga **puede repetirse varias veces en la misma jornada**.

Problemas a resolver:

1. **Duplicación de registros** — cada importación no debe insertar filas repetidas de un pedido ya cargado.
2. **Pérdida de cambios de estado** — un pedido activo en una carga puede aparecer cancelado o reprogramado en una posterior. El sistema debe **detectar y reflejar ese cambio**.

---

## 2. Objetivo funcional

Implementar lógica de importación tipo **upsert** (update si existe, insert si no existe) usando el **número de venta de ML** como clave única, de forma que cada pedido exista una sola vez, los cambios de estado actualicen el registro existente y queden trazados en un historial, y el dashboard derive sus contadores siempre desde el estado consolidado.

---

## 3. ESTRUCTURA REAL DEL EXCEL DE MERCADO LIBRE (verificada)

> Esta sección reemplaza el mapeo tentativo de la versión 1. Los datos surgen del análisis del archivo real `Ventas_AR_Mercado_Libre_y_Mercado_Shops`.

### 3.1 Layout del archivo

- **Hoja:** `Ventas AR` (primera y única hoja con datos).
- **Filas 1 a 5:** texto descriptivo y agrupadores de sección de ML — **ignorar**.
- **Fila 6:** encabezados de columna reales.
- **Fila 7 en adelante:** datos de las ventas.
- El archivo analizado tenía 64 columnas y 137 filas de datos.

> Nota: las notas previas del proyecto mencionaban "headers en fila 5, datos desde fila 6". El archivo real tiene **headers en fila 6, datos desde fila 7**. El backend debe detectar dinámicamente la fila de encabezados buscando la fila que contiene el texto `# de venta` en la primera columna, en lugar de hardcodear el número de fila — distintos reportes de ML pueden tener una fila más o menos de preámbulo.

### 3.2 Columnas relevantes (nombre exacto → uso en el sistema)

| Col | Nombre exacto en el Excel | Uso en el sistema |
|-----|---------------------------|-------------------|
| 1 | `# de venta` | **Clave única de negocio.** Identifica el pedido de forma inmutable entre importaciones. |
| 2 | `Fecha de venta` | Fecha/hora de la venta. Formato texto: `"1 de abril de 2026 11:10 hs."` |
| 3 | `Estado` | **Campo principal para clasificar el estado** (ver sección 4). |
| 4 | `Descripción del estado` | Texto explicativo del estado. Útil para extraer el **motivo de cancelación**. |
| 7 | `Unidades` | Cantidad de unidades del pedido. Viene como float (`1.0`) — convertir a entero. |
| 22 | `SKU` | SKU del vendedor. **ATENCIÓN: viene vacío en muchas filas** (ver 3.3). |
| 24 | `Canal de venta` | Casi siempre "Mercado Libre". No sirve para distinguir Colecta/Flex. |
| 25 | `Título de la publicación` | Nombre del producto. |
| 26 | `Variante` | Color/variante, ej. `"Color : Blanco"`. |
| 42 | `Forma de entrega` | **Campo que distingue el canal** (Colecta vs Flex). Ver 3.4. |

### 3.3 PROBLEMA CRÍTICO: el SKU viene vacío en parte de las filas

En el archivo real, de 137 filas, **38 tenían la columna `SKU` vacía** (espacio en blanco). Las filas con SKU vacío sí tienen `Título de la publicación` y `Variante` cargados.

Esto **rompe la tabla "Pendiente por SKU"** del dashboard si no se resuelve, porque esos 38 pedidos no se podrían agrupar por SKU. Hay que decidir una estrategia de resolución de SKU faltante (ver pregunta 1 para el developer en sección 11).

### 3.4 Cómo se distingue el canal (Colecta vs Flex)

El canal **no** está en una columna de "tipo de envío" como se asumió. Se deriva de la columna `Forma de entrega` (col 42), cuyos valores reales son:

| Valor en `Forma de entrega` | Canal del sistema |
|------------------------------|-------------------|
| `Colecta de Mercado Envíos` | **Colecta** |
| `Mercado Envíos Flex` | **Flex** |
| `Acuerdo con el comprador` | (caso especial — ver pregunta 3) |
| (vacío) | (caso especial — ver pregunta 3) |

La normalización debe hacerse por coincidencia parcial de texto (contiene "Colecta" → colecta; contiene "Flex" → flex), no por igualdad exacta, por si ML varía la redacción.

---

## 4. CLASIFICACIÓN DE ESTADO (basada en valores reales)

> Punto clave que cambió respecto a la versión 1: **el Excel NO tiene una columna de "fecha límite de envío"** que permita detectar reprogramación comparando fechas. La reprogramación se detecta por el **texto del campo `Estado`**.

Los valores reales encontrados en la columna `Estado` y su clasificación propuesta:

### A DESPACHAR
- `Listo para recolección`
- `Etiqueta impresa`
- `Etiqueta lista para imprimir`

### CANCELADA
- `Venta cancelada. No despaches.`
- `Cancelada. No despaches.`

El **motivo** se extrae de `Descripción del estado`, ej.: "La persona que compró canceló porque se arrepintió", "...canceló porque asegura no haber hecho la compra", etc.

### REPROGRAMADA
- `Listo para recolección. Está demorado 1 día pero no afectó tu reputación`

Este es el estado que en la operación equivale a "reprogramada / arrastrada de una jornada anterior". El texto indica que el paquete no se despachó en su jornada original y pasó a la siguiente.

### CASOS QUE NECESITAN DECISIÓN (no clasificar sin confirmar — ver sección 11)
- `Acordás la entrega` / `Acuerdo con el comprador` (2 filas) — entrega pactada directamente con el comprador.
- `Devolución para revisar hasta el jueves` (3 filas) — logística inversa.
- `Paquete de 2 productos` (2 filas) — el estado del paquete aparece como agrupador multi-producto.

**Regla de clasificación (orden de prioridad):**
1. Si el `Estado` contiene "cancel" → **Cancelada**.
2. Si el `Estado` contiene "demorado" (o el patrón de arrastre que se defina) → **Reprogramada**.
3. Si el `Estado` corresponde a uno de los casos especiales de la sección 11 → según se decida ahí.
4. En cualquier otro caso de pedido activo → **A despachar**.

La clasificación se recalcula **en cada importación**, basándose en el texto de `Estado` más reciente.

---

## 5. Lógica de importación (upsert)

**Clave de negocio:** columna `# de venta`.

| Condición | Acción |
|---|---|
| El `# de venta` **no existe** en el sistema | Insertar pedido nuevo, estado inicial según clasificación de sección 4 |
| El `# de venta` **existe** y el nuevo `Estado` clasifica como cancelado, y antes no lo estaba | Actualizar a `cancelada`. Registrar evento en historial con motivo (de `Descripción del estado`). |
| El `# de venta` **existe** y el nuevo `Estado` clasifica como reprogramado/demorado, y antes no lo estaba | Actualizar a `reprogramada`. Registrar evento en historial. |
| El `# de venta` **existe** y la clasificación **no cambió** | No modificar nada. No insertar fila nueva. |
| Un pedido del sistema **no aparece** en la nueva importación | **No tocar el registro.** Nunca borrar por ausencia. |

**Idempotencia obligatoria:** reimportar el mismo Excel debe producir cero cambios en la segunda corrida.

---

## 6. Persistencia del estado

Fuente de verdad persistente (BD o equivalente) con, por pedido, al menos:

- `numero_venta` (clave única)
- `sku` (puede requerir resolución — ver 3.3)
- `producto` (de `Título de la publicación`)
- `variante`
- `cantidad` (de `Unidades`, convertido a entero)
- `estado` → `a_despachar` | `cancelada` | `reprogramada`
- `canal` → derivado de `Forma de entrega`
- `fecha_venta`
- `jornada` (ver sección 9 — pregunta de jornada)
- `historial` → lista de eventos: timestamp de importación, estado anterior, estado nuevo, motivo si aplica

El `historial` embebido en cada pedido es la base del informe mensual; no requiere tabla de log aparte.

---

## 7. Cálculo de totales para el dashboard

El dashboard **nunca lee el Excel ni suma archivos importados**. Todos los contadores salen del estado consolidado, filtrando por jornada:

- **A despachar** = suma de `cantidad` con estado `a_despachar` en la jornada.
- **Canceladas** = suma de `cantidad` con estado `cancelada` en la jornada.
- **Reprogramadas** = suma de `cantidad` con estado `reprogramada` en la jornada.

A nivel global (banner principal) y desglosado por canal (tarjetas Colecta/Flex y dashboard secundario).

---

## 7-BIS. DEFINICIÓN DE JORNADA (RESUELTA — verificada en código real)

> Esta sección reemplaza la "Pregunta 2" de la versión anterior. La regla quedó confirmada revisando `rpc_import_batch` y `data.js:1107`.

**Regla inequívoca: la app asigna la jornada, el Excel NO la decide.**

Al importar, el frontend envía el parámetro `p_target_jornada_id` = la jornada que el operador está viendo en el dashboard (`seleccionadaId`), con fallback a la activa:

```
jornadaDestino = targetJornadaId || seleccionadaId || activaId
```

La RPC estampa esa **misma** `jornada_id` a **todos** los pedidos del Excel de forma uniforme. Validaciones existentes: si no se manda jornada y hay una sola abierta, la usa; si hay cero, error ("Abrí una antes de importar"); si hay varias, error ("Elegí a cuál importar").

**Consecuencia para la lógica de estados (importante):**
- El campo `jornada` de cada pedido NO se calcula desde ninguna fecha del Excel.
- La columna `Fecha de venta` del Excel se guarda en `fecha_pedido` solo como dato **informativo** (se muestra en tablas), no interviene en la jornada.
- Por lo tanto, la **clave de deduplicación del upsert** debe ser `# de venta` (evaluar si conviene `# de venta` + `jornada_id` según cómo esté modelada la tabla).

**Sub-decisión para el developer (rápida, se responde mirando el mismo código):**
Cuando se reimporta el Excel a la **misma** jornada, ¿`rpc_import_batch` ya hace upsert por `# de venta`, o actualmente inserta duplicados? Si la tabla ya tiene constraint único sobre `# de venta`, gran parte de la deduplicación ya existe y solo falta sumarle la **detección de cambio de estado** (cancelada/reprogramada) descrita en la sección 5.

**Riesgo operativo conocido (FUERA del alcance de este desarrollo):**
La app importa a la jornada que se está *viendo*, no necesariamente la activa. El chip "Viendo jornada · no es la activa" ya advierte esto. Blindarlo (forzar confirmación al importar a una jornada no-activa) es una mejora **separada**; no se mezcla con la lógica de estados para no agrandar el alcance ni complicar las pruebas. Especificar aparte si se desea.

---

## 8. Impacto en la interfaz (ya definida — solo conectar datos, no rediseñar)

**Dashboard principal:** banner con tres contadores numéricos (A despachar / Canceladas / Reprogramadas) sin detalle; tarjetas Colecta y Flex con el mismo desglose por canal.

**Dashboard secundario (por canal):**
- Tabla "Pendiente por SKU": solo pedidos `a_despachar` del canal.
- Sección "Canceladas" (debajo de "Lotes importados"): listado con SKU, # de venta, motivo. Etiqueta *Informativo · acumulable*. Botón de exportar propio.
- Sección "Reprogramadas" (debajo de "Lotes importados"): listado con SKU, # de venta. Etiqueta *Informativo · acumulable*. Botón de exportar propio.

---

## 9. Informe mensual

Proceso on-demand que, dado mes y año, genera un Excel con hoja **Canceladas**, hoja **Reprogramadas** (ambas derivadas del `historial` de cada pedido) y hoja **Resumen** con totales del período.

---

## 10. Criterios de aceptación (casos de prueba obligatorios)

1. **Detección correcta de fila de encabezados** — el sistema ubica la fila con `# de venta` aunque el preámbulo de ML cambie de tamaño.
2. **Importación inicial** — N pedidos nuevos → N registros con estado correcto según sección 4.
3. **Reimportación idéntica** — segunda carga del mismo Excel → cero nuevos, cero cambios, totales del dashboard sin variación.
4. **Detección de cancelación** — pedido que pasa a estado "cancelada" se actualiza, no se duplica, queda evento con motivo en historial.
5. **Detección de reprogramación** — pedido que pasa a estado "demorado/reprogramada" se actualiza, queda evento en historial.
6. **Pedido ausente en nueva carga** — registro permanece sin cambios, no se elimina.
7. **Múltiples cargas en la jornada** — 3-4 importaciones sucesivas → estado final correcto, sin duplicados.
8. **Resolución de SKU vacío** — los pedidos con SKU vacío en origen quedan correctamente agrupables en la tabla por SKU (según la estrategia que se decida en pregunta 1).
9. **Distinción de canal** — los pedidos se asignan a Colecta o Flex correctamente según `Forma de entrega`.
10. **Cálculo de totales por canal** — los tres contadores de cada canal coinciden con conteo manual sobre el estado consolidado.
11. **Informe mensual** — las hojas de Canceladas y Reprogramadas contienen exactamente los eventos esperados, sin duplicados ni omisiones.

---

## 11. PREGUNTAS PARA EL DEVELOPER (resolver antes de implementar)

Estas son las decisiones que el archivo real dejó abiertas y que conviene cerrar antes de programar:

**Pregunta 1 — SKU vacío (la más importante):**
En el Excel de ML, ~28% de las filas vienen con la columna `SKU` vacía, pero sí tienen `Título de la publicación` y `Variante`. ¿Cómo resolvemos el SKU faltante para que la tabla "Pendiente por SKU" no pierda esos pedidos?
Opciones a evaluar: (a) mantener una tabla de mapeo interna Título+Variante → SKU; (b) usar el `# de publicación` (col 23) como puente al SKU; (c) agrupar esos pedidos por Título+Variante cuando no haya SKU. ¿Cuál se ajusta a cómo ya tenés cargados los SKU en el sistema?

**Pregunta 2 — definición de jornada: ✅ RESUELTA.**
Verificado en código real (`rpc_import_batch` + `data.js:1107`): la app asigna la jornada al importar (`p_target_jornada_id`), el Excel no la decide. Ver sección 7-BIS para el detalle completo. Queda una sub-decisión menor para el developer: confirmar si el upsert por `# de venta` ya existe en la RPC o si hoy inserta duplicados.

**Pregunta 3 — casos especiales de estado:**
¿Cómo se clasifican estos estados que aparecen en el Excel?
- `Acordás la entrega` / `Forma de entrega: Acuerdo con el comprador` → ¿es un canal aparte (No Flex / acuerdo directo), o se cuenta como "a despachar"?
- `Devolución para revisar hasta el jueves` → ¿va a un estado de logística inversa, se ignora en producción, o cuenta en algún canal?
- `Paquete de 2 productos` apareciendo en la columna `Estado` → ¿cómo se maneja un pedido multi-producto? ¿Se desglosa en sus SKU componentes o se trata como una unidad?

**Pregunta 4 — patrón de detección de reprogramada:**
Hoy el único estado de arrastre encontrado fue "Listo para recolección. Está demorado 1 día...". ¿Hay otras redacciones posibles de demora (2 días, 3 días, etc.) que ML use y que el sistema deba reconocer como reprogramada? Conviene detectar por la palabra "demorado" en el `Estado` en vez de por el texto exacto.

---

## 12. Fuera de alcance

- Integración directa con la API de Mercado Libre (la carga sigue siendo manual vía Excel).
- Edición manual de estados desde la interfaz.
- Notificaciones automáticas.
- Cambios visuales al dashboard (el diseño de UI ya está aprobado).
