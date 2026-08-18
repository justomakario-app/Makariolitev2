# tests/ — el chequeo antes de subir

```bash
npm install     # una sola vez
npm test        # corre las 10 suites
```

Verde = `10/10 suites en verde · 502 checks ok · 0 fail`. Si algo sale en rojo,
el runner imprime la salida completa de esa suite y devuelve código 1.

No hay build ni framework de testing: son scripts de Node que levantan los
mismos archivos que carga el navegador, con **las mismas versiones**
(React 18.3.1, Babel standalone 7.29.0). Por eso `package.json` las tiene
clavadas sin `^` — si acá se prueba con una versión y el HTML carga otra, el
chequeo deja de significar algo.

| Suite | Qué protege |
|---|---|
| `checkjsx.js` | Compila los 174 archivos de las 3 entradas (`web/`, `mobile/`, `tienda/`) y busca **declaraciones top-level repetidas**. Todos los `<script type="text/babel">` de una entrada comparten un solo scope léxico: un `const` duplicado tira `SyntaxError` y deja la pantalla **en blanco**. Compilar de a un archivo no lo detecta. |
| `b2b-render-test.js` | Las 5 pestañas del panel mayorista (solicitudes, catálogo, pedidos, **clientes**, tienda) por rol y con el flag `b2b` prendido y apagado. En Clientes, los **catálogos habilitados**: que el payload lleve `canales`, que el catálogo de arranque se corra solo cuando apuntaría a uno que se sacó, y que sin ningún catálogo no deje guardar (el backend lo rechaza con `22023`). |
| `tienda-render-test.js` | La tienda de `tienda/`: **alta abierta por link** (los dos pasos, el CUIT que valida y el que no, correo repetido, CUIT ya conocido → queda `pendiente`, y que el payload no lleve `role`, `token` ni `canal`), **elección de catálogo** (no pide precios antes de elegir, el cambio recarga cuenta **y** carrito, y con un solo canal se auto-elige), canje de invitación, **recuperar la contraseña** (que la respuesta no delate si el correo está registrado, que el token del mail se canjee por sesión y se borre de la barra de direcciones), carrito y alta de pedido, y que el pedido facturado muestre el **numero del comprobante** sin inventarle IVA a los pedidos anteriores a 0158. |
| `hub-render-test.js` | El hub de producción y sus pantallas de Línea Productiva. |
| `deeplink-test.js` | La campanita: que cada aviso abra la pantalla que dice, en web y en mobile. |
| `rol-ventas-test.js` | Que el rol `ventas` vea **una sola** pestaña en Ventas (la tienda mayorista) y que ningún otro rol pierda las suyas. |

Cada una corre suelta también:

```bash
node tests/checkjsx.js
node tests/b2b-render-test.js  "$PWD" mobile
node tests/rol-ventas-test.js  "$PWD" web
```

## Por qué existe `rol-ventas-test.js`

La base ya autorizaba a `ventas` en `b2b_rpc_admin_pedidos` y
`b2b_rpc_admin_clientes`, y en **nada más** (el resto le devuelve `42501`).
`VentasPage` le muestra por eso una única pestaña. Si alguien agranda el
`ROLE_NAV` de `ventas` sin tocar ese filtro, se le abren de golpe Cta cte,
Facturación, Presupuestos, Remitos y Base de productos — pantallas que no
puede leer y que van a fallar al abrirse. Esta suite se pone en rojo antes.

Se validó con dos mutaciones: sacar el filtro por rol tira **12 checks**;
sacar `'ventas'` del `ROLE_NAV`, **1**.

## Lo que estas suites NO cubren

Corren contra **jsdom con Supabase mockeado**: miden qué se renderiza y qué
pantalla se ofrece a cada rol, no que la base responda. Los permisos reales
(RLS, `security definer`, los `raise 42501`) se prueban contra la base, en un
bloque con `rollback` — ver `HANDOFF.md`.
