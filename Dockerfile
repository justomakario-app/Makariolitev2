# ═══════════════════════════════════════════════════════════════════════════
# Macario Lite — Dockerfile multi-stage
# ───────────────────────────────────────────────────────────────────────────
# Stage 1 (builder): instala deps + builda mobile (PWA Vite)
# Stage 2 (nginx):   sirve web/ directo (HTML+JSX estáticos) y mobile/dist
# ═══════════════════════════════════════════════════════════════════════════

# ──────────────────────────────────────────────────────────────────────────
# STAGE 1 — builder (solo mobile)
# ──────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Args públicos para mobile (Vite los embebe)
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

# package.json para cache layer (solo workspaces que necesita mobile)
COPY package.json ./
COPY shared/package.json ./shared/package.json
COPY mobile/package.json ./mobile/package.json

RUN npm install --include=dev --ignore-scripts

# Source
COPY shared ./shared
COPY mobile ./mobile

RUN npm run build:mobile

# ──────────────────────────────────────────────────────────────────────────
# STAGE 2 — nginx production
# ──────────────────────────────────────────────────────────────────────────
FROM nginx:alpine

# Web: HTML + JSX + CSS estáticos (no se compilan, los sirve nginx tal cual)
COPY web /usr/share/nginx/html

# Hacemos un index.html copia exacta de "Macario Lite.html" para que
# nginx sirva en `/` sin forzar la URL con espacio. El original queda
# intacto en el filesystem (el cliente quiso conservarlo así).
RUN cp "/usr/share/nginx/html/Macario Lite.html" /usr/share/nginx/html/index.html

# Mobile (PWA Vite)
COPY --from=builder /app/mobile/dist /usr/share/nginx/html/m

# Config
COPY nginx.conf /etc/nginx/conf.d/default.conf

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost/ || exit 1

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
