# ═══════════════════════════════════════════════════════════════════════════
# Macario Lite — Dockerfile (single-stage, static)
# ───────────────────────────────────────────────────────────────────────────
# web/ y mobile/ son HTML+JSX puros (Babel-standalone compila en el browser),
# así que no requieren builder. Sólo copiamos los archivos a nginx.
# ═══════════════════════════════════════════════════════════════════════════

FROM nginx:alpine

# Web (desktop) — sirve en /
COPY web /usr/share/nginx/html

# index.html: copia exacta de "Macario Lite.html" para que nginx sirva en /
# sin URL con espacio. El original queda intacto (cliente quiso conservarlo).
RUN cp "/usr/share/nginx/html/Macario Lite.html" /usr/share/nginx/html/index.html

# Mobile (PWA) — sirve en /m/*
COPY mobile /usr/share/nginx/html/m

# Limpiar archivos pesados que no son parte del deploy
RUN rm -rf /usr/share/nginx/html/uploads \
           /usr/share/nginx/html/screenshots \
           /usr/share/nginx/html/INFORME_TECNICO_BACKEND.md

# Config de nginx
COPY nginx.conf /etc/nginx/conf.d/default.conf

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost/ || exit 1

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
