# Macario Lite

Sistema interno de gestión de producción y embalaje para **Justo Makario** (fábrica de muebles de madera). Stack: **Supabase + React (Vite + TS)**.

## Estructura

```
.
├── app-makario-lite-nueva/        # Frontend mock original (handoff bundle)
│   └── project/
│       ├── INFORME_TECNICO_BACKEND.md  ← blueprint del backend
│       └── components/                 ← React + Babel in-browser
├── supabase/
│   ├── migrations/                # 10 migrations SQL idempotentes
│   │   ├── 0001_initial_schema.sql
│   │   ├── 0002_auth_helpers.sql
│   │   ├── 0003_rls_catalog.sql
│   │   ├── 0004_rls_operations.sql
│   │   ├── 0005_rls_user.sql
│   │   ├── 0006_storage.sql
│   │   ├── 0007_triggers_carrier_state.sql
│   │   ├── 0008_rpcs.sql
│   │   ├── 0009_views.sql
│   │   └── 0010_realtime.sql
│   └── seed.sql                   # 18 SKUs demo (correr manual cuando quieras)
├── web/                           # Frontend nuevo (Vite + React + TS + Supabase)
│   ├── src/
│   │   ├── lib/                   # supabase client, queryClient, fmt
│   │   ├── types/database.types.ts # generado por Supabase CLI
│   │   ├── hooks/                 # useAuth, useCarrier, useDashboard, etc.
│   │   ├── components/
│   │   │   ├── shared/            # Icon, Logo, Toast, Modal
│   │   │   ├── layout/            # Sidebar, AppLayout, ProtectedRoute
│   │   │   ├── login/             # LoginScreen
│   │   │   ├── pages/             # Dashboard, Carrier, Produccion, etc.
│   │   │   └── modals/            # Produce, Import
│   │   └── router/routes.tsx      # React Router v6
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── .env.example
│   └── index.html
├── .gitignore                     # protege .mcp.json (token) y .env.local
├── .mcp.json                      # MCP de Supabase (gitignored)
└── README.md
```

## Setup local

### 1. Backend (Supabase)
Ya está aplicado en el proyecto **`ditmbqkvzreekqnkimqv`** (justomakario-app's Project). Las 10 migrations están en `supabase/migrations/` y registradas en `supabase_migrations.schema_migrations`.

Para reaplicar a otro proyecto:
1. Crear proyecto Supabase nuevo, anotar `<PROJECT_REF>`.
2. Aplicar las 10 migrations en orden con `supabase db push` o vía Management API:
   ```bash
   for f in supabase/migrations/*.sql; do
     curl -X POST "https://api.supabase.com/v1/projects/<PROJECT_REF>/database/migrations" \
       -H "Authorization: Bearer <PAT>" \
       -H "Content-Type: application/json" \
       -d "$(jq -n --arg q "$(cat $f)" --arg n "$(basename $f .sql | cut -d_ -f2-)" \
              --arg v "$(date +%Y%m%d%H%M%S)" \
              '{version: $v, name: $n, query: $q}')"
   done
   ```
3. (Opcional) `supabase/seed.sql` → 18 SKUs demo, aplicar manual desde el SQL editor.

### 2. Frontend (web/)
```bash
cd web
cp .env.example .env.local
# Editar .env.local con la VITE_SUPABASE_ANON_KEY real
npm install
npm run dev
```

Abrir `http://localhost:5173`. La app va a redirigir a `/login`.

### 3. Crear el primer usuario owner

La app usa autenticación por **username + password** mapeada a email virtual `{username}@macario.local` (decisión B). Para crear el primer usuario:

**Opción A — desde Supabase Studio (recomendado primera vez):**
1. Andá a https://supabase.com/dashboard/project/ditmbqkvzreekqnkimqv/auth/users
2. Click "Add user" → ingresá:
   - Email: `sebastian@macario.local`
   - Password: el que quieras
3. El trigger `handle_new_user()` automáticamente crea el row en `public.profiles` con role `embalaje` (default).
4. Para promover a owner, abrí el SQL editor y corré:
   ```sql
   UPDATE public.profiles
   SET role = 'owner', name = 'Sebastián'
   WHERE username = 'sebastian';
   ```

**Opción B — vía Edge Function `invite_user`** (no implementada todavía).

Después de crear el primer owner, podés:
- Loguear desde la app (`http://localhost:5173/login` → username `sebastian` + password).
- Invitar al resto del equipo desde la pantalla **Equipo** (UI completa pendiente — por ahora desde Studio o SQL editor).

## Comandos útiles

```bash
# Dev server
cd web && npm run dev

# Type check (sin compilar)
cd web && npm run typecheck

# Build producción
cd web && npm run build

# Regenerar tipos TS del schema actualizado
cd web && npm run gen:types
# (alternativa con curl)
curl "https://api.supabase.com/v1/projects/ditmbqkvzreekqnkimqv/types/typescript" \
  -H "Authorization: Bearer <PAT>" \
  | jq -r '.types' > web/src/types/database.types.ts
```

## Variables de entorno

| Var | Dónde | Para qué |
|---|---|---|
| `VITE_SUPABASE_URL` | `web/.env.local` | URL del proyecto Supabase. Va al cliente. |
| `VITE_SUPABASE_ANON_KEY` | `web/.env.local` | Anon (publishable) key. Va al cliente. RLS la limita. |
| `SUPABASE_ACCESS_TOKEN` | `.mcp.json` (gitignored) | PAT para MCP/Management API. **Nunca al cliente.** |

**Nunca commitear** `.env.local` ni `.mcp.json`. Ya están en `.gitignore`.

## Decisiones técnicas tomadas

Documentadas en el INFORME_TECNICO_BACKEND.md y discutidas en sesión:

- **A** Tabla principal: `profiles` (linkado a `auth.users`).
- **B** Username → email virtual `{username}@macario.local` (decisión preserva UX).
- **C** Stock excedente: por canal (no global por SKU).
- **D** Borrado de SKUs: soft-delete (`activo=false`), FK `ON DELETE RESTRICT`.
- **E** Multi-tenant: NO en v1 (monolítico).
- **F** Idempotencia import: SHA-256 hex del archivo, UNIQUE en `import_batches.file_hash`.
- **G** `orders` UNIQUE compuesto por `(channel_id, order_number, sku)` — un order_number puede tener varios SKUs como filas separadas.
- **H** `production_logs.cantidad` permite negativos (correcciones); sector derivado del rol del operario en RPC.
- **I** `area` del usuario: texto libre nullable.
- **L** Race condition en register_production: encapsulada en RPC con UPSERT atomic en carrier_state.
- **M** Cierre automático: NO en v1 (cierre manual obligatorio con badge "vencida").
- **N** Notificaciones automáticas: faltante=0 → owner+encargado; nuevo lote → encargado.
- **Q-T** TanStack Query, React Router v6, TS strict, Realtime por tabla con filtros.

## Realtime habilitado en

- `carrier_state` (tabla principal de UI)
- `orders` (nuevos pedidos al instante)
- `production_logs` (timeline en vivo)
- `notifications` (badge sidebar)

## Pendientes para v1.1+

- ABM completo de Catálogo (modal de crear/editar SKU portado al esquema TS).
- ABM completo de Equipo + Edge Function `invite_user` para crear users desde la UI.
- Histórico calendario mensual.
- QR scanner (Html5Qrcode + insert qr_scans).
- Generación de QR PDFs batch (jsPDF + qrcode).
- Edge Function `edge_export_historico_pdf`.
- (Opcional v2) Regla R9 — operarios no ven `orders.cliente`.

## Stack

- **DB:** Postgres 17 (Supabase)
- **Auth:** Supabase Auth (email + password, mapeo username → email virtual)
- **Realtime:** Supabase Realtime (`postgres_changes` channel por tabla)
- **Storage:** Supabase Storage (3 buckets — imports, qr-pdfs, avatars)
- **Frontend:** Vite + React 18 + TypeScript strict + TanStack Query 5 + React Router 6
- **Excel parsing:** SheetJS (`xlsx` npm) — reemplaza el parser custom del mock

## Costos estimados (plan FREE Supabase)

- DB: 500 MB (sobra para v1)
- Storage: 1 GB
- Egress: 5 GB/mes
- Realtime: 200 conexiones concurrentes peak
- Edge Functions: 500K invocaciones/mes
- Auth: 50K usuarios activos/mes

Con ~10-15 operarios concurrentes, FREE alcanza. Si se acerca al límite, upgrade a Pro ($25/mo).
