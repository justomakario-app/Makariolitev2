# ═══════════════════════════════════════════════════════════════════════════
# Macario Lite — Dockerfile multi-stage
# ───────────────────────────────────────────────────────────────────────────
# Stage 1 (builder): instala deps de monorepo + builda /web/ y /mobile/
# Stage 2 (nginx):   sirve ambos en paths distintos (/ y /m/) en mismo origin
# ═══════════════════════════════════════════════════════════════════════════

# ──────────────────────────────────────────────────────────────────────────
# STAGE 1 — builder
# ──────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# ARG → recibidos desde EasyPanel (sección "Build args" del service).
# Vite los embebe en el bundle JS en build time — son públicos.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

# Copiar SOLO los package.json para cachear el `npm install` mientras
# no cambien las deps. Si cambia el source pero no las deps, el cache
# de npm install se reusa.
COPY package.json ./
COPY shared/package.json ./shared/package.json
COPY web/package.json ./web/package.json
COPY mobile/package.json ./mobile/package.json

# Install de todos los workspaces de una.
# `--include=dev` porque vite/typescript están en devDependencies y
# son requeridos para el build.
RUN npm install --include=dev

# Copiar source completo de cada workspace (esto invalida el cache si
# cambia cualquier .ts/.tsx)
COPY shared ./shared
COPY web ./web
COPY mobile ./mobile

# Build ambos frontends.
# - web/ outputs a /app/web/dist/
# - mobile/ outputs a /app/mobile/dist/ (con base /m/ del vite.config.ts)
RUN npm run build:web && npm run build:mobile

# ──────────────────────────────────────────────────────────────────────────
# STAGE 2 — nginx production
# ──────────────────────────────────────────────────────────────────────────
FROM nginx:alpine

# Copiar los dos builds al document root, en paths separados
COPY --from=builder /app/web/dist     /usr/share/nginx/html
COPY --from=builder /app/mobile/dist  /usr/share/nginx/html/m

# Config de nginx con routing /, /m/ y headers correctos para SW + PWA
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Healthcheck: verifica que nginx responde
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost/ || exit 1

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
