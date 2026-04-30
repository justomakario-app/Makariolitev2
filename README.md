# Macario Lite — Monorepo

Sistema interno de gestión de producción y embalaje para **Justo Makario** (fábrica de muebles de madera). Stack: **Supabase + Vite + React + TypeScript**, organizado en monorepo con npm workspaces.

## Estructura

```
.
├── shared/                        # @macario/shared — código compartido web+mobile
│   ├── src/
│   │   ├── lib/                   # supabase, queryClient, fmt, sha256Hex
│   │   ├── types/                 # database.types.ts (generado por Supabase)
│   │   └── hooks/                 # useAuth, useDashboard, useChannels,
│   │                              # useCarrier, useCatalog, useNotifications
│   └── package.json
├── web/                           # Desktop SPA
│   └── src/                       # importa de @macario/shared/*
├── mobile/                        # PWA mobile-first (path /m/*)
│   ├── public/favicon.svg         # placeholder JM (TODO: reemplazar por logo real)
│   └── src/                       # importa de @macario/shared/*
├── supabase/                      # 10 migrations + seed.sql aplicadas
│   ├── migrations/0001..0010
│   └── seed.sql
├── app-makario-lite-nueva/        # frontend mock original (handoff bundle)
│   └── project/
│       ├── INFORME_TECNICO_BACKEND.md
│       └── components/
├── package.json                   # workspaces: [shared, web, mobile]
└── README.md
```

## Quickstart

```bash
# Instalar todas las deps (primera vez)
npm install

# Desktop dev server (puerto 5173)
npm run dev:web

# Mobile dev server (puerto 5174, base /m/)
npm run dev:mobile

# Type check de los 3 workspaces
npm run typecheck

# Build producción
npm run build:web
npm run build:mobile
```

## Crear el primer usuario owner

La app usa **username + password** mapeado a email virtual `{username}@macario.local` (decisión B). Para crear el primer owner:

1. Andar a https://supabase.com/dashboard/project/ditmbqkvzreekqnkimqv/auth/users
2. Click "Add user" → email `sebastian@macario.local` + password.
3. El trigger `handle_new_user()` crea automáticamente la fila en `public.profiles` con role `embalaje`.
4. SQL editor:
   ```sql
   UPDATE public.profiles
   SET role = 'owner', name = 'Sebastián'
   WHERE username = 'sebastian';
   ```
5. Login en cualquiera de los dos frontends:
   - Desktop: http://localhost:5173/login → `sebastian` + password.
   - Mobile: http://localhost:5174/m/login → mismo flow.

## Variables de entorno

Cada workspace tiene su propio `.env.local` (gitignored). El `.env.example` está commiteado.

```
VITE_SUPABASE_URL=https://ditmbqkvzreekqnkimqv.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key — pública, RLS la limita>
```

**Nunca commitear** `.env.local` ni `.mcp.json`. Ya están en `.gitignore`.

## Despliegue sugerido

Mismo dominio, dos paths:

- `macario.com/`         → desktop SPA (build de `web/dist/`)
- `macario.com/m/*`      → PWA mobile (build de `mobile/dist/`)

La sesión de Supabase se comparte automáticamente (mismo origin = mismo `localStorage`). Operario abre `macario.com/m/`, hace "Add to Home Screen", queda como app standalone con ícono.

## Test plan manual

### A — desktop (`npm run dev:web`)
- [ ] Login con username + password → redirige a Dashboard.
- [ ] Sidebar muestra solo items del rol logueado.
- [ ] Dashboard muestra KPIs reales y se refresca con realtime.
- [ ] Carrier de un canal muestra tabla de SKUs pendientes.
- [ ] Modal "Producir" funciona (3 pasos, RPC inserta log, faltante baja).
- [ ] Modal "Importar Excel" parsea + sube + idempotencia (re-import no duplica).
- [ ] Cerrar jornada genera snapshot y arrastra faltante al día siguiente.
- [ ] Catálogo: crear/editar SKU + generar QR PDF batch.
- [ ] Notificaciones: badge en sidebar, mark all read funciona.

### B — mobile (`npm run dev:mobile`, abrir `/m/`)
- [ ] Login mobile funciona con el mismo user del desktop.
- [ ] Bottom tabs muestran solo items del rol (max 5).
- [ ] HomePage: hero numérico + grid 2x2 canales + reloj live.
- [ ] Tap en card de canal → CarrierPage.
- [ ] Producción: tabs scrollables + lista mobile + FAB para Producir.
- [ ] ProduceModal abre como bottom sheet, 3 pasos, registra OK.
- [ ] CarrierPage: countdown live para Colecta/Flex, banner vencida si pasó la hora.
- [ ] Cerrar jornada: ConfirmModal + RPC + snapshot.
- [ ] Importar Excel desde celular: file picker → SheetJS → SHA-256 → RPC.
- [ ] QR Scanner: pide permiso de cámara, detecta QR, inserta en `qr_scans`.
- [ ] Notificaciones: lista + mark all read + realtime.
- [ ] Perfil: avatar + role badge + logout.

### C — cross-tab realtime
- [ ] Abrir desktop en una tab + mobile en otra tab del mismo browser.
- [ ] Login en ambos con el mismo user.
- [ ] Registrar producción desde mobile → contador del desktop baja al instante.
- [ ] Importar Excel desde desktop → Carrier mobile muestra los nuevos pedidos.

### D — PWA
- [ ] Chrome DevTools → Application → Manifest sin errores.
- [ ] Service Worker registrado y activo.
- [ ] "Add to Home Screen" disponible en mobile.
- [ ] Instalada, abre en standalone (sin barras del browser).
- [ ] Offline: con WiFi cortado, los assets ya cargados se sirven del cache.

## Decisiones técnicas (todas en código + docs)

- **A** Tabla principal: `profiles` linkado a `auth.users`.
- **B** Username → email virtual `{username}@macario.local`.
- **C** Stock excedente: por canal.
- **D** SKUs: soft-delete (`activo=false`), FK `ON DELETE RESTRICT`.
- **E** Multi-tenant: NO en v1.
- **F** Idempotencia import: SHA-256 hex del archivo, UNIQUE en `import_batches.file_hash`.
- **G** `orders` UNIQUE compuesto por `(channel_id, order_number, sku)`.
- **H** Sector derivado del rol del operario (server-side en RPC).
- **L** RPCs SECURITY DEFINER con UPSERT atómico en `carrier_state`.
- **M** Cierre de jornada manual (no cron en v1).
- **N** Notificaciones automáticas: faltante=0 → owner+encargado; nuevo lote → encargado+owner.
- **Q-T** TanStack Query, React Router v6, TS strict, Realtime por tabla.

## Backend Supabase

10 migrations aplicadas y registradas:

| # | Migration | Qué hace |
|---|---|---|
| 0001 | initial_schema | 12 tablas + 4 enums + RLS habilitado + seeds (channels, sku_categories, role_permissions) |
| 0002 | auth_helpers | Trigger `handle_new_user` + `is_owner_or_admin`, `current_user_role`, etc. |
| 0003 | rls_catalog | Policies de catálogo (channels, sku_*, role_permissions) |
| 0004 | rls_operations | Policies de orders, production_logs, carrier_state, jornadas, qr_scans |
| 0005 | rls_user | Policies de profiles, notifications |
| 0006 | storage | 3 buckets: imports (privado), qr-pdfs (privado), avatars (público) |
| 0007 | triggers_carrier_state | Triggers de mantenimiento de carrier_state |
| 0008 | rpcs | rpc_register_production, rpc_import_batch, rpc_close_jornada |
| 0009 | views | view_dashboard_kpis, view_historico_dia, view_carrier_with_meta |
| 0010 | realtime | Publication para carrier_state, orders, production_logs, notifications |

## Costos (Supabase plan FREE)

- DB: 500 MB · Storage: 1 GB · Egress: 5 GB/mes
- Realtime: 200 conexiones concurrentes peak
- Auth: 50K usuarios activos/mes

Con ~10-15 operarios concurrentes en la fábrica, FREE alcanza. Upgrade a Pro ($25/mo) si crece.

## Pendientes documentados

### Mobile (post-v1)
- Catálogo / Equipo / Histórico full mobile (por ahora redirige a usar `/web`).
- Iconos PWA reales en PNG 192/512 (placeholder actual: `mobile/public/favicon.svg`).

### Backend (post-v1)
- Edge Function `invite_user` (crear usuarios con role custom desde la UI).
- Edge Function `edge_export_historico_pdf`.
- (Opcional) Regla R9: ocultar `orders.cliente` a operarios via column-level RLS.

## Branches

- `master` — desktop completo + backend funcional.
- `feature/mobile-pwa` — agrega `shared/` workspace + mobile PWA.

Para mergear mobile a master: PR con todos los commits de `feature/mobile-pwa` después de validar test plan A+B+C+D arriba.
