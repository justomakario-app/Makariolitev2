# CAMBIO 2 — Jornadas como Día Completo

## 1. Resumen ejecutivo

Antes, cada canal de venta (Colecta, Flex, Tienda Nube, etc.) tenía su
propia jornada independiente. Eso obligaba a abrir y cerrar jornadas
canal por canal, y dificultaba ver "el día completo" de un vistazo.

El Cambio 2 unifica el modelo: **una jornada cubre todos los canales del
día**. El dashboard ahora tiene pestañas — una por jornada abierta — y
hacer click en una pestaña cambia toda la vista al día seleccionado.
Se pueden tener hasta 3 jornadas abiertas en paralelo (por ejemplo:
hoy + los 2 días siguientes), útil para planificar adelantado.

Estado actual: **deployado, validado funcionalmente y con la BD operativa
en estado virgen**, listo para arrancar producción.

## 2. Decisiones clave de negocio

Decisiones tomadas por el cliente durante el desarrollo:

- **Jornadas son globales**, no por canal. Una jornada = un día completo
  que abarca todos los canales.
- **Hasta 3 jornadas abiertas en paralelo**, máximo 3 días hacia adelante
  desde hoy.
- **Click en pestaña = "app nueva"** del día seleccionado: KPIs,
  cuadritos de canal y todo el dashboard se redibujan para esa jornada.
- **Pedidos se aíslan por jornada**: un pedido cargado en la jornada del
  15/05 solo aparece en la pestaña del 15/05, no en las demás.
- **La producción siempre va a la jornada ACTIVA** (la del punto verde),
  sin importar qué pestaña esté viendo el usuario. Si está mirando otra
  pestaña, aparece una confirmación antes de cargar.
- **Stock central compartido** entre todas las jornadas (no se segmenta).
- **Al cerrar una jornada**: los faltantes se arrastran al día siguiente
  como pedidos nuevos, y los sobrantes se transfieren automáticamente al
  Stock central.
- **Solo se puede cerrar la jornada del día actual** — no jornadas
  futuras ni pasadas.

## 3. Migrations aplicadas

| # | Migration | Qué hace |
|---|-----------|----------|
| 0028 | `jornada_dia_completo_schema` | Drop `channel_id` de `jornadas`, `UNIQUE(fecha)`, índice singleton para una sola jornada activa global. |
| 0029 | `jornada_dia_completo_rpcs` | 11 RPCs reescritos para el modelo global (ver §8). |
| 0030 | `fix_edit_order_jornada_global` | Fix de `rpc_edit_order`: su branch ELSE filtraba por `jornadas.channel_id` (columna ya inexistente post-0028). |
| 0031 | `cleanup_jornada_shims` | Drop del parámetro shim `p_channel_id` en `rpc_open_jornada` y `rpc_close_jornada` + drop de la view huérfana `view_dashboard_kpis`. |

## 4. Commits principales

| Hash | Fecha | Mensaje |
|------|-------|---------|
| `3705ee4` | 2026-05-13 | feat(jornada): cambio 2A backend — jornadas como día completo |
| `741b0ce` | 2026-05-13 | feat(jornada): cambio 2B frontend — dashboard pestañas + jornada global |
| `052aee1` | 2026-05-13 | fix(jornada): timezone date + UI app-nueva al cambiar pestaña |
| `dc13d2e` | 2026-05-13 | feat(jornada): micro-interacciones de transición + color de acento por día |
| `4e4f4f9` | 2026-05-13 | fix(modal): ManualOrderModal usa jornada seleccionada y pasa target_jornada_id |
| `5e3b563` | 2026-05-13 | fix(jornada): rpc_edit_order branch sin filtro de canal post-2A (migration 0030) |
| `2721798` | 2026-05-14 | fix(jornada): aislar pedidos por jornada en cómputo de cuadritos |
| `5db5c28` | 2026-05-14 | chore(housekeeping): limpieza post-Cambio 2 |

Estructura: **2A** (backend, `3705ee4`) → **2B** (frontend, `741b0ce`) →
**5 hot-fixes encadenados** (`052aee1`, `dc13d2e`, `4e4f4f9`, `5e3b563`,
`2721798`) → **housekeeping final** (`5db5c28`). La migration 0030 viajó
dentro del hot-fix `5e3b563`.

## 5. Estructura nueva del frontend

- **`MOCK.jornadas`** — estado global de jornadas en `data.js`:
  - `abiertas[]` — todas las jornadas con `status='abierta'`.
  - `activaId` — la jornada activa (el "punto verde"); singleton global.
  - `seleccionadaId` — la jornada que el usuario está VIENDO en el
    dashboard (local, no se persiste). Por defecto = `activaId`.
  - `historial[]` — últimas jornadas cerradas (para CarrierPage).
- **`computeCarriersForJornada(jornadaId)`** — motor único de los
  cuadritos del dashboard. Calcula `pedido / producido / faltante /
  stock` por canal+SKU, filtrando `orders` y `production_logs` por
  `jornada_id`. Replica la fórmula del snapshot de cierre.
- **`applySelectedJornadaToCarriers()`** — SIEMPRE recomputa
  `MOCK.carriers` y `MOCK.prod.todos` desde `computeCarriersForJornada`
  de la jornada seleccionada. Activa y no-activa siguen el mismo camino.
- **`loadCarriers()`** — tras el housekeeping quedó como wrapper async
  de `applySelectedJornadaToCarriers()`. Ya no consulta
  `view_carrier_with_meta` (era un "dead read"). Se conserva como punto
  de entrada para los callers de `MOCK_ACTIONS`.

## 6. Checklist operativo para mañana (Justo)

Qué esperar al abrir la app con la BD virgen:

- [ ] **Estado inicial vacío**: el dashboard muestra el CTA grande
      "Abrí tu primera jornada del día". No hay pestañas todavía.
- [ ] **Botón "+ Abrir jornada"**: abre un modal con selector de fecha.
      Permitido desde hoy hasta hoy+3 días. Máximo 3 jornadas abiertas
      a la vez (el botón se deshabilita al llegar a 3).
- [ ] **Pestañas en orden cronológico**: al abrir jornadas, aparecen
      como pestañas ordenadas por fecha. La activa lleva el punto verde.
- [ ] **Click en pestaña cambia TODO**: KPIs del hero, cuadritos de
      canal, todo se redibuja para la jornada seleccionada. Transición
      con slide+fade. Color de acento según el día de la semana.
- [ ] **Importar Excel / cargar pedido manual**: van a la jornada
      SELECCIONADA (la pestaña que se está viendo).
- [ ] **Producción (operarios)**: siempre va a la jornada ACTIVA. Si el
      usuario está parado en otra pestaña, aparece una confirmación
      antes de abrir el modal de producir.
- [ ] **Cerrar jornada**: solo se habilita para la jornada del día
      actual. Cierra el día completo (todos los canales); arrastra
      faltantes al día siguiente y manda sobrantes a Stock central.

## 7. Deuda técnica documentada

Cosas conscientemente postergadas (no bloquean producción):

| Ítem | Detalle | Riesgo |
|------|---------|--------|
| `view_carrier_with_meta` sigue en BD | Ya no se consulta desde el frontend, pero no se dropeó (podría tener usos internos futuros). | Bajo |
| `carrier_state` transversal | La tabla + sus triggers siguen agregando sin segmentar por jornada. El dashboard ya no la usa; queda como tabla interna para RPCs/cierres. | Bajo |
| Branch redundante en `seleccionarJornada` | El `if (jornadaId === activaId)` quedó con ambas ramas equivalentes tras el housekeeping. Cosmético. | Ninguno |
| Lints de seguridad de Supabase | 58 lints (security_definer_view, anon executable functions). Todos pre-existentes al Cambio 2. Hardening separado. | Bajo |
| RLS `jornadas` INSERT policy | `WITH CHECK` incluye `closed_by = auth.uid()` — semánticamente raro para apertura, pero inocuo (todos los INSERT van por RPCs `SECURITY DEFINER` que bypasean RLS). | Ninguno |

## 8. Tests SQL ejecutados

Todos corridos en transacciones `BEGIN/ROLLBACK` (sin impacto en datos
operativos):

- **Migration 0029 (Cambio 2A)** — 11/11 PASS. Cobertura de los 11 RPCs
  reescritos: `fn_resolve_active_jornada`, `rpc_open_jornada`,
  `rpc_set_active_jornada`, `rpc_close_jornada`, `rpc_register_production`,
  `rpc_assign_free_stock`, `rpc_send_to_free_stock`,
  `rpc_transfer_between_channels`, `recompute_carrier_state_for`,
  `rpc_import_batch`, `rpc_create_manual_order`.
- **Migration 0030 (`rpc_edit_order`)** — 3/3 PASS:
  - Test A: editar pedido con `jornada_id` seteado (camino normal).
  - Test B: editar pedido con `jornada_id=NULL` (caso del bug latente) —
    ya no falla con error de columna.
  - Test C: sin jornada activa → error claro, no error de columna.
- **`v_total_arrastres` en `rpc_close_jornada`** — 2/2 PASS:
  - Test 1: cierre normal (faltantes + sobrantes + SKU completo) —
    snapshot, arrastres, free_stock y jornada día+1 correctos.
  - Test 2: `ON CONFLICT DO NOTHING` previene duplicado de la order
    arrastrada. El contador `v_total_arrastres` es inocuo (solo se usa
    como flag `> 0`, nunca como conteo persistido).
- **Migration 0031 (cleanup shims)** — 3/3 PASS:
  - Test A: `rpc_open_jornada(p_fecha)` sin `p_channel_id` funciona.
  - Test B: `rpc_close_jornada(p_fecha)` sin `p_channel_id` funciona.
  - Test C: llamar con `p_channel_id` viejo falla con SQLSTATE 42883
    (función no existe), antes de ejecutar el body.

## 9. Pendientes manuales del cliente

Algunos hallazgos de seguridad no se arreglan con una migration —
requieren un cambio de configuración en el panel de Supabase que solo
el dueño de la cuenta puede hacer.

### 9.1 Activar "Leaked Password Protection"

**Qué es**: Supabase Auth puede chequear cada contraseña nueva contra la
base de datos pública de HaveIBeenPwned.org y rechazarla si ya apareció
en alguna filtración conocida. Viene **desactivado** por defecto.

**Por qué importa**: sin esto, un usuario podría registrarse o cambiar
su contraseña usando una clave que ya está comprometida públicamente.

**Pasos para activarlo** (1 minuto, lo hace Aarón):

1. Entrar al [dashboard de Supabase](https://supabase.com/dashboard)
   con la cuenta dueña del proyecto.
2. Seleccionar el proyecto **Macario Lite**
   (ref `ditmbqkvzreekqnkimqv`).
3. En el menú lateral: **Authentication → Policies**
   (o **Authentication → Sign In / Providers**, según versión del panel).
4. Buscar la sección **Password Security** /
   **Leaked password protection**.
5. Activar el toggle **"Prevent use of leaked passwords"**.
6. Guardar.

**Verificación**: tras activarlo, el lint
`auth_leaked_password_protection` desaparece de
**Advisors → Security** en el dashboard.

> Nota: este es un cambio de configuración de la plataforma, no del
> código. No hay migration ni archivo en el repo asociado — esta
> sección es el registro del pendiente.
