# Despliegue en EasyPanel

Macario Lite se despliega como **un solo container** que sirve `web/` (desktop) y `mobile/` (PWA) bajo el mismo origin. La sesión de Supabase se comparte automáticamente.

## Arquitectura del deploy

```
┌────────────────────────────────────────────────────┐
│  Container Docker (nginx:alpine)                   │
├────────────────────────────────────────────────────┤
│  /usr/share/nginx/html/         ← web/dist         │
│      └── m/                     ← mobile/dist      │
└────────────────────────────────────────────────────┘
         │
         ↓ nginx routing
   ┌─────────────┐
   │  /          │ → desktop SPA
   │  /m/*       │ → mobile PWA
   │  /assets/*  │ → cache 30d (immutable)
   │  /m/sw.js   │ → cache off (service worker)
   └─────────────┘
```

Las URLs finales:

- `https://tu-dominio.com/`        → desktop
- `https://tu-dominio.com/m/`      → mobile (instalable como PWA)

## Paso a paso en EasyPanel

### 1. Preparar el ZIP del repo

Desde la raíz del proyecto (`App makario lite nueva-handoff/`):

**En PowerShell** (Windows):
```powershell
# Excluye node_modules, .git, .env.local, .mcp.json, dist y otros
$exclude = @('node_modules','.git','dist','build','.env','.env.local','.mcp.json','.vscode','.idea','*.log')
Compress-Archive -Path * -DestinationPath ..\macario-lite-deploy.zip -Force
```

**En Bash / Git Bash**:
```bash
# Genera macario-lite-deploy.zip un nivel arriba
zip -r ../macario-lite-deploy.zip . \
    -x "node_modules/*" "**/node_modules/*" \
       ".git/*" "**/dist/*" "**/build/*" \
       ".env" ".env.local" "**/.env" "**/.env.local" \
       ".mcp.json" ".vscode/*" ".idea/*" "*.log"
```

El ZIP debería pesar entre 2-10 MB. Si pesa más, algo de `node_modules/` se coló.

### 2. En EasyPanel — configurar el Service

1. Ir al proyecto `app_gestion_interna` → service `makario_lite_nueva`.
2. **Tab "Subir"** → arrastrar `macario-lite-deploy.zip`.
3. **NO usar** las opciones GitHub / Git por ahora (a menos que tengas el repo subido a GitHub).

EasyPanel detecta automáticamente el `Dockerfile` en la raíz del ZIP y lo usa como instrucciones de build.

### 3. Configurar Build args (variables que Vite necesita en build time)

EasyPanel suele tener una sección "Build args" o "Environment > Build" en el service. Agregá:

| Variable | Valor |
|---|---|
| `VITE_SUPABASE_URL` | `https://ditmbqkvzreekqnkimqv.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | (la anon key — copiala de `web/.env.local`) |

⚠️ **Estas son `ARG`, no `ENV` runtime.** Vite las inlinea en el bundle al hacer `npm run build`. Si EasyPanel solo te ofrece "Environment Variables" runtime, fijate si hay un toggle "build-time" o "Docker ARG". Si no, configuralas igual como env y debería funcionar (Docker las pasa como ARG si están seteadas como ENV durante build).

### 4. Configurar el dominio + HTTPS

⚠️ **CRÍTICO para que ande la PWA y el QR scanner.**

- En EasyPanel → service → "Domains" o similar.
- Si tenés un dominio (ej. `macario.tu-empresa.com`), apuntalo a `72.62.15.150` con un A record.
- Activá **Let's Encrypt SSL** desde el panel (suele ser un toggle).
- Sin HTTPS:
  - ❌ El QR scanner no funciona (`getUserMedia` requiere secure context).
  - ❌ El service worker no se registra (PWA no instalable).
  - ❌ Algunos browsers bloquean Supabase Auth en HTTP.

Si momentáneamente no tenés dominio, podés probar en `localhost` localmente o usar un túnel tipo ngrok para HTTPS.

### 5. Deploy

Click en **"Deploy"** o **"Rebuild"** en EasyPanel. El primer build tarda **3-5 minutos** (npm install + 2 builds de Vite). Builds posteriores son más rápidos por el cache de Docker.

### 6. Verificación post-deploy

Cuando termine el build, abrí estos URLs en el browser:

- ✅ `https://tu-dominio.com/` → debe cargar el login del desktop.
- ✅ `https://tu-dominio.com/m/` → debe cargar el login mobile.
- ✅ `https://tu-dominio.com/m/manifest.webmanifest` → debe devolver JSON con name "Macario Lite".
- ✅ DevTools mobile → Application → Service Worker → debe estar "activated and running".
- ✅ Login con un usuario owner → redirige a Dashboard / HomePage según el frontend.
- ✅ Realtime cross-tab: abrir desktop + mobile en dos tabs, registrar producción en una, ver actualización en la otra.

## Variables de entorno completas

Solo 2 vars son requeridas. Ambas son **públicas** (van al cliente, RLS las limita):

```
VITE_SUPABASE_URL=https://ditmbqkvzreekqnkimqv.supabase.co
VITE_SUPABASE_ANON_KEY=<eyJhbGc...>
```

**Nunca subir** el `service_role` key ni el PAT del MCP a EasyPanel. Esos son del backend admin, no del frontend.

## Re-deploys (cuando hagas cambios)

Cada vez que pushees cambios al código:

1. Re-zippear el repo (mismo comando de paso 1).
2. EasyPanel → Service → "Subir" → reemplazar ZIP.
3. Click "Rebuild" → tarda 1-3 min.
4. Service worker autodetecta la nueva versión y la actualiza en el browser del operario al refrescar.

Si querés automatizar esto (CI/CD), conectá el repo a GitHub y EasyPanel puede hacer auto-deploy en cada push a main.

## Troubleshooting

### Build falla con "tsc: not found" o "vite: not found"

→ El `npm install` no incluyó devDependencies. El Dockerfile usa `--include=dev` para evitar esto. Si pasa igual, verificá que `NODE_ENV` no esté en `production` durante el build.

### "Failed to fetch" o "CORS error" en login

→ La `VITE_SUPABASE_URL` o `VITE_SUPABASE_ANON_KEY` no se inyectó correctamente. Verificá los Build args en EasyPanel y rebuild.

### QR scanner muestra "Permiso denegado" o no abre la cámara

→ Estás en HTTP. Volvé al paso 4 y configurá HTTPS.

### `/m/` da 404

→ Verificá que el `nginx.conf` se copió correctamente. En el container, `/usr/share/nginx/html/m/index.html` debe existir. Conectate al container con EasyPanel logs/shell para confirmar.

### El operario instaló la PWA y no se actualiza

→ Forzar refresh: en el celular, Settings → Apps → Macario → Clear Cache. O bien esperar que el SW detecte la nueva versión (suele tardar hasta 24h).
