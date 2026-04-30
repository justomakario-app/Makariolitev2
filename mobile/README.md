# Macario Lite — Mobile (PWA)

PWA mobile-first construida sobre el mismo backend de Supabase que `/web/`.
Comparte hooks, tipos y cliente Supabase via `@macario/shared` (npm workspace).

## Quickstart

```bash
# Desde la raíz del monorepo:
npm install                     # primera vez — instala todo (shared/web/mobile)
npm run dev:mobile              # arranca en http://localhost:5174/m/
```

Para que la PWA sea instalable:
- Abrir en Chrome mobile o desktop.
- DevTools → Application → Manifest debe mostrar el manifest sin errores.
- En mobile: menú → "Add to Home Screen". Queda como app standalone.

## Variables de entorno

`mobile/.env.local` (copiá de `.env.example`):

```
VITE_SUPABASE_URL=https://ditmbqkvzreekqnkimqv.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key — la misma del web>
```

## TODO (post-v1)

### 🎨 Iconos PWA

Actualmente `public/favicon.svg` es un placeholder con el texto **"JM"** sobre fondo negro. Para producción hay que reemplazar por el logo real de Justo Makario en formato PNG en estos tamaños:

```
public/icon-192.png       → 192×192 (purpose: any)
public/icon-512.png       → 512×512 (purpose: any)
public/icon-512-maskable.png → 512×512 (purpose: maskable, con padding seguro 10%)
```

Después actualizar `vite.config.ts` (sección `manifest.icons`) para apuntar a los PNG.

Generar los PNG desde un SVG fuente:

```bash
# Con sharp-cli (npm i -g sharp-cli):
sharp -i logo.svg -o public/icon-192.png resize 192 192
sharp -i logo.svg -o public/icon-512.png resize 512 512

# O con una herramienta web tipo: realfavicongenerator.net
```

### 📱 Componentes / pantallas

- Routing y bottom tabs — Fase 5
- Login mobile — Fase 6 Tier 1
- Producción + ProduceModal mobile (FAB) — Fase 6 Tier 1
- QR Scanner full-screen — Fase 7
- Importar Excel desde celular — Fase 8
- Carrier / Histórico / Catálogo / Equipo — Fase 6 Tier 2-3

## Estructura

```
mobile/
├── public/
│   └── favicon.svg            ← placeholder JM
├── src/
│   ├── components/
│   │   ├── shared/            ← Icon, Logo, Toast, Modal (portados de /web)
│   │   ├── layout/            ← MobileLayout, BottomTabs, ProtectedRoute
│   │   ├── pages/             ← una por ruta
│   │   └── modals/            ← ProduceModal, ImportModal, etc.
│   ├── hooks/                 ← hooks específicos de mobile (los de Supabase vienen de @macario/shared)
│   ├── router/routes.tsx      ← React Router con basename="/m"
│   ├── styles/global.css      ← copia del web + overrides mobile-first
│   ├── App.tsx
│   └── main.tsx
├── index.html
├── vite.config.ts             ← Vite + PWA + base /m/
├── tsconfig.json
├── package.json
└── .env.local                 ← gitignored
```

## Comandos

```bash
npm run dev          # dev server (puerto 5174)
npm run build        # build producción + service worker generado
npm run preview      # preview del build
npm run typecheck    # tsc --noEmit
```

## Despliegue

La PWA se sirve bajo el path `/m/*` del mismo dominio que `/web/`. La sesión de auth se comparte automáticamente (mismo origin = mismo `localStorage`).

Build artifacts van a `mobile/dist/` con:
- `index.html` (entry)
- `assets/*.{js,css}`
- `sw.js` (service worker generado por vite-plugin-pwa)
- `manifest.webmanifest` (generado del config)
- `favicon.svg` (placeholder, reemplazar por iconos reales)
