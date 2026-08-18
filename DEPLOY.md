# Despliegue en EasyPanel

Macario Lite se despliega como **un solo container** que sirve `web/` (desktop) y `mobile/` (PWA) bajo el mismo origin. La sesión de Supabase se comparte automáticamente.

## Arquitectura del deploy

```
┌────────────────────────────────────────────────────┐
│  Container Docker (nginx:alpine)                   │
├────────────────────────────────────────────────────┤
│  /usr/share/nginx/html/         ← web/dist         │
│      ├── m/                     ← mobile/dist      │
│      └── tienda/                ← tienda/ (B2B)    │
└────────────────────────────────────────────────────┘
         │
         ↓ nginx routing
   ┌───────────────┐
   │  /            │ → desktop SPA
   │  /m/*         │ → mobile PWA
   │  /tienda/*    │ → tienda mayorista (clientes externos)
   │  /assets/*    │ → cache 30d (immutable)
   │  /m/sw.js     │ → cache off (service worker)
   └───────────────┘
```

Las URLs finales:

- `https://tu-dominio.com/`        → desktop
- `https://tu-dominio.com/m/`      → mobile (instalable como PWA)
- `https://tu-dominio.com/tienda/` → tienda mayorista B2B (**no** es para el personal: es la que se le pasa al cliente)

## Paso a paso en EasyPanel

### 0. Antes de armar el ZIP — correr los chequeos

```bash
npm install     # una sola vez, en la máquina
npm test
```

Tiene que decir **`10/10 suites en verde · 508 checks ok · 0 fail`**. Si algo sale en rojo, **no se sube**: el runner imprime la salida de la suite que falló.

El que más importa acá es el primero, `checkjsx.js`: los tres frontends cargan sus `.jsx` como `<script type="text/babel">`, y **todos los archivos de una entrada comparten un solo scope**. Un `const` declarado dos veces en archivos distintos tira `SyntaxError` y deja **la pantalla en blanco** — sin error visible, sin nada. Eso no se ve compilando archivo por archivo ni abriendo la app por arriba, y ya pasó. Detalle de las 10 suites en `tests/README.md`.

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

### 3. Build args — **no hace falta ninguna**

Esto quedó escrito cuando el proyecto iba a usar Vite. **No lo usa.** No hay build: el Dockerfile arranca de `nginx:alpine` y copia los archivos tal cual (`npm run build` literalmente imprime *"No requiere build — todo es estático"*). El JSX lo compila el browser con Babel standalone.

La URL y la anon key de Supabase están **escritas adentro del código**, en dos lugares:

| Archivo | Para qué |
|---|---|
| `web/components/data.js` | el sistema interno (`/` y `/m/`) |
| `tienda/components/tienda-supa.js` | la tienda mayorista (`/tienda/`) |

**No es un descuido.** La anon key es pública por diseño — cualquiera que abra la tienda la ve en el código fuente del browser, con Vite o sin Vite. Lo que protege los datos no es esconderla, es **RLS** más el hecho de que todos los precios se calculan del lado del servidor. La que **nunca** se escribe en el código ni se sube a ningún lado es la `service_role`, que vive únicamente en las edge functions.

> Si algún día se cambia de proyecto de Supabase, se tocan **esos dos archivos**, no una variable de EasyPanel.

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

## Tienda mayorista (B2B) — pasos propios, aparte del deploy

La tienda va en el **mismo** container y el **mismo** ZIP: no hay nada extra que configurar en EasyPanel. Pero el módulo no funciona hasta completar estos pasos en Supabase, **en este orden**.

> **Estado al 2026-08-16: los pasos 1 a 3, 6 y 7 ya están hechos.** El flag `b2b` está **prendido**. Falta el **paso 4** (apagar el registro público — verificado el 15: sigue en ON) y el **paso 5** (cargar los precios), que es dato del dueño. Después: push, redeploy y smoke.

### 1. Aplicar las migraciones — ✅ **YA HECHO (última: `0161`, el 2026-08-16)**

`0151 → 0152 → 0153 → 0154 → 0155 → 0156 → 0157 → 0158 → 0159 → 0160 → 0161`, aplicadas una sola vez y en ese orden. **No hay que volver a correrlas.** `0154` era requisito para prender el flag: cierra agujeros de RLS que existían y que recién se vuelven peligrosos cuando aparece el primer usuario sin `profiles` (el cliente B2B). `0155` cierra el alta pública desde la base. `0158` corrige la auditoría del módulo completo (congelar el precio al enviar, bloquear el carrito mientras se envía, no anular lo despachado, facturación). `0159` permite publicar un producto que ya tenía precio sin volver a tipearlo. `0160` agrega el **precio propio por canal**. `0161` hace visible el pedido facturado y evita que el espejo lo degrade. El detalle está en `HANDOFF.md`, entradas del 2026-08-15 y del 2026-08-16.

### 2. Tripwires — ya dieron 0 al aplicar; repetirlos cada tanto

Son **las mismas tres consultas** que la `0154` corre al final en su bloque `(D)`. Corrieron sin abortar el 2026-08-15, así que las tres dieron 0 en ese momento; quedan acá para volver a chequearlo más adelante, porque el perímetro se puede reabrir solo — `create view` **sin** `security_invoker` es el default de Postgres, y así se coló `prod_v_jornadas` en `0147`, tres migraciones después de que `0125` arreglara las 20 anteriores.

Las tres tienen que dar **0 filas**. Si alguna devuelve algo, **no prender el flag**.

```sql
-- (1) Policies SELECT con predicado literal `true`.
--     Las permisivas se suman con OR: una sola con qual='true' concede
--     lectura total a cualquier authenticated, incluido el cliente B2B.
select tablename, policyname
from pg_policies
where schemaname = 'public' and cmd = 'SELECT' and qual = 'true';

-- (2) Vistas sin security_invoker: corren con los permisos del dueño
--     (postgres, BYPASSRLS) y saltean la RLS de sus tablas base.
--     b2b_v_pedidos_admin queda excluida: es definer A PROPÓSITO y está
--     revocada a authenticated, así que no es un agujero.
select c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
  and (c.reloptions is null or c.reloptions::text not like '%security_invoker%')
  and c.relname <> 'b2b_v_pedidos_admin';

-- (3) Tablas sin RLS que authenticated igual puede leer.
--     La condición del privilegio importa: una tabla sin RLS a la que
--     authenticated no tiene acceso no es un agujero.
select c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false
  and has_table_privilege('authenticated', c.oid, 'SELECT');
```

### 3. Desplegar la edge function `b2b_signup` — ✅ **YA HECHO el 2026-08-15**

Está en `supabase/functions/b2b_signup/index.ts`. Desplegada como **v3, `ACTIVE`, `verify_jwt: true`**; el archivo del repo y lo desplegado son el mismo. (v3 = `0158`: la marca `b2b` viaja en `app_metadata`, que solo puede escribir el `service_role`.) Usa `SUPABASE_SERVICE_ROLE_KEY`, que en Edge Functions ya viene inyectada — **no** hay que cargarla a mano en ningún lado, y **nunca** va a EasyPanel ni al frontend.

**`verify_jwt` tiene que quedar en `true`.** Parece contradictorio para un alta sin sesión, pero la anon key **es** un JWT válido: eso es exactamente lo que le permite a la tienda invocarla antes de que el cliente tenga cuenta, sin abrirla a cualquiera sin credencial ninguna. Ponerla en `false` no habilita nada nuevo, solo saca una capa.

### 4. Tres cosas de Authentication — ⚠️ **PENDIENTE (son del dueño, son de Dashboard)**

**a) "Allow new users to sign up" = OFF.** Dashboard → Authentication → Providers → Email. **Verificado el 2026-08-15: sigue en ON.**

Es la pieza que sostiene todo lo demás: `handle_new_user` lee el rol desde `raw_user_meta_data`, y en un signup público ese metadata lo elige quien se registra. Con el registro abierto, cualquiera con la anon key pide `role='owner'` y entra al sistema de la planta.

> ⚠️ **No confundir con el alta abierta de la tienda.** Desde `0163` el mayorista se crea la cuenta solo, sin invitación — pero **el alta no la hace el browser**: la hace la edge function `b2b_signup` con `service_role` (Admin API), que no mira ese toggle. **Apagarlo NO rompe el alta por link.** Lo único que cierra es la creación de usuarios con la anon key, que es exactamente lo que sobra.

**`0155` ya cierra este agujero desde la base** — `handle_new_user` exige la marca `app_metadata.interno`, que solo puede poner el `service_role`, así que un alta por afuera queda sin `profile` y no ve nada, y se registra en `auth_alta_bloqueada`. Aun así **hay que apagarlo igual**: una defensa que depende de una sola pieza no es una defensa.

**b) Leaked-password protection = ON** (Authentication → Policies → *Prevent use of leaked passwords*). El advisor de Supabase lo marca como **WARN, sigue apagado** (verificado el 2026-08-17). Rechaza contraseñas que ya aparecieron en filtraciones conocidas, contra HaveIBeenPwned. Con el alta abierta y el cliente eligiendo su propia clave, esto pasó de "estaría bueno" a necesario.

**c) La URL de la tienda tiene que estar en "Redirect URLs"** (Authentication → URL Configuration). Agregar:

```
https://tu-dominio.com/tienda/
```

Sin eso, el link de "olvidé mi contraseña" **no vuelve a la tienda**: Supabase lo manda a la Site URL, que es el login del **personal**, y el cliente se queda mirando una pantalla que no es la suya con el token colgado en la URL. La tienda pide el link con `redirectTo` apuntando a su propia página, pero Supabase solo respeta un `redirectTo` que esté en esa lista.

**Los tres son del dueño y son de Dashboard.** No se pueden hacer desde acá: el MCP de Supabase tiene SQL, migraciones, edge functions y advisors, pero **ninguna herramienta de configuración de Auth**. La otra vía sería la Management API con un PAT, que en este proyecto está prohibido usar.

### 5. Cargar los precios de los SKU vendibles — ✅ **YA HECHO el 2026-08-17 (14 productos publicados)**

Están cargados los **14 productos** del catálogo de julio que existen en el sistema, **con precio propio en los dos canales** (28 filas en `b2b_precio_canal`), en orden 1–14 y publicados. Los números que ve el mayorista son **exactamente** los del catálogo, verificados leyendo por `b2b_fn_precio`. **"Set Mesas Gota XS" y "Lámpara de Pie" figuran sin stock: quedaron sin publicar**, como pidió el dueño.

**Por qué 14 y no 61.** De los 61 SKU del sistema, **34 son internos** (29 placas de CNC + 5 ACCESORIOS) y no van a la tienda. Quedan 27 terminados, y los 14 cargados cubren el **94,0% del volumen real de ventas**. Lo que falta —la **Línea 3D** entera (16 productos) y la **Línea Iluminación**— **no tiene SKU en el sistema**: no es que falte publicarlos, no existen. Cuando Seba los dé de alta en `sku_catalog`, recién ahí se pueden cargar y publicar.

**Para cargar los que falten**, desde `Ventas → Tienda mayorista → Catálogo y precios`. **Un SKU sin `precio_base` no se puede publicar** (el backend lo rechaza con `22023`). La solapa acepta **pegar desde Excel**: dos columnas (SKU y precio), una fila por producto, tanto en la columna de lista como en la de un canal. Tolera `$`, miles con punto y decimales con coma; lo que no reconoce lo deja anotado y no lo escribe.

**Cómo funcionan los precios desde `0160`:** cada canal muestra en gris (como *placeholder*) lo que da la fórmula `precio de lista × coeficiente` — distribuidor 0,55 · mayorista 0,70 · minorista 1,00. **Escribir un número arriba de ese gris crea un precio propio de ese canal**, y esa celda deja de seguir al coeficiente para siempre. **Vaciar la celda la devuelve a la fórmula.** Mover un coeficiente **no pisa** los precios propios.

**Cargar siempre las dos listas, no una sola.** Los catálogos de julio (`Catologo mayorista/`) tienen precio propio por producto, no un margen parejo: la razón distribuidor/mayorista va de 0,7545 a 1,0000. Dejar que el coeficiente calcule la de distribuidor le cobra mal **para los dos lados** — hasta 14,3% de menos (Organizador Yori, Hikari) y hasta $1.067 de más (Boomerang).

**El `precio_base` de estos 14 es derivado.** En la base **no hay lista minorista** (no existe en ninguna tabla), y publicar sin `precio_base` es imposible. Se usó `round(mayorista / 0,70; 2)`, que es el valor con el que el propio coeficiente reproduce exacto el precio mayorista. Si algún día aparece la lista minorista de verdad, se pisa `precio_base` y **no cambia nada** de lo que ve el mayorista: los dos canales tienen precio propio escrito.

### 6. Bucket de Storage para las fotos — ✅ **YA HECHO (`0156`)**

`b2b_fotos` ya está creado con sus políticas (lectura para clientes aprobados, escritura owner/admin). **Ya no es un paso manual del Dashboard.** Las fotos siguen siendo opcionales: sin fotos, las tarjetas muestran un recuadro vacío y la tienda funciona igual — a propósito, una tienda sin fotos se usa, una con fotos rotas no.

### 7. Recién ahí, prender el flag — ✅ **YA HECHO el 2026-08-15**

```sql
update app_flags set enabled = true where name = 'b2b';   -- ya ejecutado
```

Prenderlo **no expuso nada**: no hay ningún producto publicado, no existe ningún cliente y la URL pública no existe hasta el redeploy. El flag es fail-closed en los dos lados: con `enabled = false` (o si la fila no se puede leer) la tienda dice "cerrada", el panel interno dice "apagada", y `b2b_fn_guard()` rechaza todas las RPC.

**Apagarlo es el kill-switch:** ese `update` con `false` revierte el módulo entero al instante, sin tocar código ni redesplegar. Si algo sale mal en el smoke, ése es el botón.

### Verificación de la tienda después del deploy

- ✅ `https://tu-dominio.com/tienda/` → pantalla de acceso de la tienda, con la marca Justo Makario. **No** debe aparecer el login del personal.
- ✅ `https://tu-dominio.com/tienda/cualquier-cosa` → misma pantalla de la tienda (no el login interno).
- ✅ Entrar a la tienda con un cliente y al sistema interno con un empleado, **en el mismo browser**: las dos sesiones conviven. Si una pisa a la otra, el `storageKey` de `tienda/components/tienda-supa.js` se rompió.
- ✅ DevTools → Network, ya logueado como cliente: en ninguna respuesta debe aparecer `precio_base` ni `coeficiente`.
- ✅ **La pantalla de acceso ofrece "Crear mi cuenta"** (alta abierta) y, abajo, "Tengo un código de invitación". Si solo aparece el código, el browser está sirviendo la versión vieja de `tienda-acceso.jsx`: revisar el `?v=` en `tienda/index.html`.
- ✅ Con un cliente que tenga **dos catálogos habilitados**: al entrar aparece la pantalla **"¿Con qué catálogo querés comprar?"** antes del catálogo, y el header queda con el chip del canal elegido. Con **uno solo** no debe aparecer: entra derecho y el chip queda fijo.
- ✅ `https://tu-dominio.com/tienda/?codigo=XXXX` → abre directo el canje de invitación con el código puesto. Ése es el link que se le pasa a un **segundo** comprador de una empresa que ya compra.
- ✅ **"Olvidé mi contraseña"** aparece debajo del campo de contraseña. Pedir el link con un correo de prueba y abrir el mail: **el link tiene que caer en `/tienda/`**, no en el login del personal. Si cae en el login interno, falta la Redirect URL del paso 4c.
- ✅ Al abrir ese link, la barra de direcciones **no debe quedar con `#access_token=…`**: la tienda lo consume y lo borra con `replaceState`. Si el token queda a la vista, queda en el historial del browser y en cualquier captura de pantalla.

### Smoke del circuito completo (hacerlo con Seba, una sola vez)

Es el que confirma lo que pidió el dueño de punta a punta. El circuito ya se probó contra la base real con rollback (36 asserts en verde, ver `HANDOFF.md`), pero eso valida la **base**, no la operación con gente de verdad.

1. **Darse de alta solo** — abrir `/tienda/` en otro browser o ventana privada, "Crear mi cuenta", cargar empresa + CUIT y después los datos personales. **Tiene que quedar comprando en el momento**, sin aprobación de nadie: ésa fue la decisión del dueño. En la campanita del equipo tiene que caer el aviso del alta nueva.
2. **Probar el freno del CUIT** — repetir el alta con el **mismo CUIT** y otro correo: esa segunda cuenta tiene que quedar **"en revisión"**, NO entrar. Si entra, el circuito está abierto: cualquiera con el CUIT de un cliente (está en cualquier factura) ve el historial y los precios de esa empresa. Es el chequeo más importante de todos.
3. **Sumar un segundo comprador de esa misma empresa por invitación** — `Ventas → Tienda mayorista → Accesos → Nueva invitación`. Copiar el código **en ese momento**: en la tabla queda solo el hash, no se puede recuperar después. Canjearlo desde `/tienda/?codigo=XXXX`.
4. **Elegir qué catálogos ve** en la solapa *Clientes*: marcar **los dos** (mayorista y distribuidor), el de arranque y la condición de pago.
5. **Comprar**: al entrar tiene que aparecer la **elección de catálogo** con el mínimo de cada uno; el cliente ve **solo el precio del canal que eligió**, se respetan múltiplos y mínimos, y envía.
   - **Cambiar de canal desde el chip del header** y confirmar las dos cosas: cambian **todos** los precios, y el carrito es **otro** (el del canal anterior queda esperando intacto — hay un borrador por canal desde `0162`).
   - **Sacarle un catálogo desde el panel** mientras tiene un pedido armado ahí: el pedido **no se borra**, y **vuelve a aparecer** si se lo habilitan de nuevo.
6. **Perder la contraseña a propósito** — cerrar sesión, "Olvidé mi contraseña", abrir el mail, poner una clave nueva y **entrar con ella**. Con el alta abierta nadie del lado de Makario puede darle la clave a un cliente: si esto no funciona, el cliente que se la olvida deja de comprar y no hay forma de rescatarlo sin tocar la base.
6. **Verificar el aviso**: la campanita del owner/admin/ventas tiene que sumar un "Pedido B2B nuevo: <cliente>" con el número `MAY-XXXX`, y el pedido tiene que estar ya cargado en `Ventas → Mayoristas` como **cotización**, con sus ítems.
7. **Mover el estado** desde Mayoristas (confirmado → en producción → entregado) y ver que en la tienda del cliente cambie solo (`entregado` se le muestra como **despachado**).
8. **Repetir el pedido** desde *Mis pedidos* del cliente: tiene que cargarse en el carrito a precio de hoy, avisando si algo dejó de estar disponible.
9. **Facturar** desde *Pedidos de la tienda* (número + fecha): el cliente tiene que ver **Facturado**, y corregir el estado interno **no** puede volverlo atrás.
10. **Despublicar un producto que el cliente tenga en el carrito**: la línea tiene que quedar marcada como caída, salir de los totales y del mínimo, y el pedido no se puede enviar hasta sacarla.
11. **Exportar a Excel** desde *Pedidos de la tienda*: el archivo tiene que abrir en columnas de una (separador `;`), con los acentos bien y los importes como número.

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

### `/tienda/` muestra el login del PERSONAL

→ Se perdió el bloque `location /tienda/` del `nginx.conf`, así que la ruta cae en el `try_files` genérico y termina sirviendo el `index.html` del sistema interno. Es el peor de los 404 posibles: el cliente ve la puerta de la planta. Revisar que estén los dos bloques (`location = /tienda` con el redirect y `location /tienda/` con su propio `try_files`).

### La tienda queda en blanco, sin ningún error visible

→ Casi siempre es una **redeclaración entre archivos**. Los `<script type="text/babel">` comparten el scope global: si dos archivos declaran el mismo `const` de primer nivel, el browser corta con *"Identifier 'X' has already been declared"* al evaluar el segundo y no renderiza nada. Mirar la consola. Se previene corriendo `scope-check.js` antes de zippear.

### El link de "olvidé mi contraseña" no lleva a la tienda

→ Falta la Redirect URL (paso 4c). Supabase acepta el `redirectTo` **solo si está en la lista**; si no está, usa la Site URL en silencio, sin error. Agregar `https://tu-dominio.com/tienda/` en Authentication → URL Configuration → Redirect URLs.

Si el link llega pero dice **"El link no sirve más"**: o ya se usó, o pasó una hora, o se abrió en un browser distinto del que lo pidió. Se pide otro y listo. Y si el cliente dice que **nunca le llegó**, mirar Authentication → Logs: el SMTP que trae Supabase de fábrica tiene un límite bajo de correos por hora y es lo primero que se agota cuando alguien aprieta el botón cinco veces.

### El cliente entra y ve el catálogo entero sin precios

→ Se quedó **sin canal**. `b2b_fn_precio` se llama con el canal, así que sin canal no hay precio y el catálogo queda sin valuar. Desde `0164` no debería pasar: `b2b_fn_canal_actual()` cae al **primero de los catálogos habilitados** cuando el comprador todavía no eligió y el cliente no tiene canal de arranque. Si pasa igual, mirar `select b2b_canal, b2b_canales, b2b_habilitado, activo from customers_b2b where id = '<cliente>';` — lo más probable es que **no tenga ningún catálogo habilitado**, o que los que tiene estén `activo = false` en `b2b_canal`. Se arregla desde *Clientes* en el panel, sin redeploy.

### El alta nueva queda "en revisión" y el dueño no quería aprobación

→ **No es un bug: es el freno del CUIT.** Si el CUIT que cargó ya es de un cliente existente, el alta queda `pendiente` a propósito (ver `0163`). El camino correcto para esa persona es una **invitación** emitida por alguien que ya compra en esa empresa. Si el CUIT era distinto y aun así quedó pendiente, ahí sí revisar la edge function.

### La tienda dice "cerrada en este momento" pero el flag está en true

→ La edge function `b2b_signup` y las RPC leen `app_flags` por separado. Confirmar con `select * from app_flags where name = 'b2b';` que la fila existe (la crea `0151`) y que `enabled` es `true`. Si la fila no existe, la lectura da false: **es fail-closed a propósito**.

### El operario instaló la PWA y no se actualiza

→ Forzar refresh: en el celular, Settings → Apps → Macario → Clear Cache. O bien esperar que el SW detecte la nueva versión (suele tardar hasta 24h).
