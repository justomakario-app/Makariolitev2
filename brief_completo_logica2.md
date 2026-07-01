# Brief funcional completo · Lógica 2 — Producción y Optimización
### Justo Makario Home · Documento para desarrollo

> Este documento describe **todo lo que se diseñó**: qué es, para qué sirve, por qué se
> resolvió así y cómo tiene que funcionar. Está escrito en lenguaje funcional, sin código,
> para que un desarrollador lo tome y lo implemente en el stack de la app. No es una guía
> técnica de programación: es la especificación del negocio y de la lógica.

---

## 1. El problema y el objetivo

Justo Makario Home es una fábrica de mesas ratonas de diseño. Vende por varios canales
(Mercado Libre Colecta y Flex, Tienda Nube, distribuidores, etc.) y cada venta dispara un
proceso de producción que pasa por varias etapas y consume distintos materiales.

La app necesita resolver **dos mundos distintos** a partir de la misma venta:

- Un mundo **administrativo / contable**: quién compró, a qué precio, qué canal, facturación,
  cobranzas, caja.
- Un mundo **productivo**: qué hay que fabricar, qué piezas cortar, qué materiales consumir,
  cómo optimizar el corte y cómo repartir el trabajo entre los sectores de la fábrica.

Mezclar estos dos mundos en una sola lógica genera confusión y errores. Por eso el diseño
separa la app en **dos lógicas** que conviven sobre el mismo dato.

---

## 2. Las dos lógicas y por qué se separan

**Lógica 1 — Administración y contabilidad.** Lee la "cara comercial" de la venta: el producto
publicado que se vendió, su precio, el cliente, el canal, la factura, el cobro. No le interesa
de qué está hecha la mesa. Es la lógica que alimenta Ventas, Finanzas, Administración y RRHH.

**Lógica 2 — Producción y optimización.** Descarta todo lo comercial y se queda **solo** con
qué se vendió y cuánto. A partir de ahí *desglosa* cada producto hasta sus piezas y materiales,
y organiza la producción. Es la lógica nueva, la que describe este documento.

**Por qué se separan:** son dos preocupaciones independientes. El contador no necesita saber
cuántos tornillos lleva una mesa; el sector de corte no necesita saber el precio de venta.
Separarlas hace que cada una sea simple, y que un cambio en una no rompa la otra.

---

## 3. El concepto central: la venta como punto de unión

La clave de todo el diseño es que **no hay dos apps: hay una sola venta que se lee de dos
maneras**. La venta entra una sola vez, desde el canal correspondiente, y queda registrada con
su producto, cantidad, precio, cliente y canal.

- La Lógica 1 usa todo: precio, cliente, factura.
- La Lógica 2 usa **solamente** tres datos de cada línea de venta: el producto, la cantidad y
  el canal. Ignora el resto.

Esto evita duplicar información. La venta es el único punto de contacto entre las dos lógicas.
Si mañana cambia algo de facturación, la producción no se entera; si cambia un componente de
una mesa, la facturación no se entera.

---

## 4. El catálogo y el árbol de despiece (el corazón del modelo)

### 4.1 Todo es un SKU
En el catálogo, **absolutamente todo es un SKU**: las publicaciones que se venden (las mesas),
pero también las tapas, los kits, los tornillos, los soportes, las patas, las cajas, las placas,
los listones, etc. Cada SKU tiene atributos que definen su rol:

- **Tipo**: qué clase de cosa es (publicación, tapa, kit, soporte, tornillo, pata, caja, placa,
  tapatornillo, filo, varilla, listón).
- **Naturaleza**: cómo se obtiene. Cuatro posibilidades:
  - *Fabricado*: se arma en la fábrica.
  - *Reventa*: se compra ya hecho para incorporarlo.
  - *Corte*: es una pieza que se obtiene cortando un material (una tapa de una placa, una pata
    de un listón).
  - *Insumo*: materia prima que se compra y se consume.
- **¿Es vendible?**: marca si el SKU es una publicación (lo que el cliente ve y compra) o un
  componente interno.
- Atributos para compra y corte (explicados más abajo): unidad de compra, contenido de compra,
  largo.

### 4.2 El árbol de despiece (BOM)
Una mesa se compone de piezas; cada pieza se puede componer de otras piezas más simples; y así
hasta llegar a la materia prima base. Eso es un **árbol de despiece** (en la industria se llama
*BOM*, "bill of materials").

En el Excel original, este árbol estaba repartido en cuatro hojas distintas (productos,
componentes, insumos, placas). El diseño lo unifica en **una sola estructura recursiva**: una
relación que dice "el SKU padre se compone de tal cantidad del SKU hijo". Con esa única
estructura se arma todo el árbol, a cualquier profundidad.

**Ejemplo concreto:** una mesa "Set Redonda Blanco" se compone de una tapa redonda 50, una tapa
redonda 40, un set de patas, un kit de instalación y una caja. A su vez, el set de patas se
compone de 3 patas chicas y 3 patas grandes; el kit se compone de tornillos y soportes; y los
soportes se componen de soportes base. La estructura recursiva captura todos esos niveles sin
límite.

**Por qué así:** unificar en una sola estructura recursiva hace que el cálculo de "qué necesito
para producir X" sea un único algoritmo genérico (la explosión, sección 5), en vez de cuatro
procesos distintos. También obliga a tener SKUs únicos y bien definidos, lo que destapó errores
del Excel (sección 12).

### 4.3 El corte: una relación distinta
Hay una relación que **no** va en el árbol de despiece, porque es de naturaleza inversa: el corte.
Una placa no "contiene" tapas; una placa *rinde* tapas cuando se la corta. Lo mismo un listón
*rinde* patas. Por eso el corte se modela aparte, como una relación que dice "de tal material se
obtiene tal pieza, con tal rendimiento".

Esta distinción es importante: el despiece baja (una mesa necesita una tapa), pero el corte sube
(para conseguir esa tapa hay que cortar una fracción de placa). Son dos mecanismos diferentes y
el sistema los trata por separado.

---

## 5. La explosión: el motor de la Lógica 2

La **explosión** es el proceso que toma las ventas pendientes y las "estalla" hacia abajo por el
árbol de despiece, multiplicando cantidades, hasta saber exactamente cuánto se necesita de cada
pieza y de cada material.

**Cómo funciona, paso a paso:**
1. Toma todas las líneas de venta que están en estado *pendiente*.
2. Por cada producto vendido, baja por el árbol de despiece multiplicando: si una mesa lleva 3
   patas y se vendieron 5 mesas, son 15 patas; si cada pata lleva 1 tornillo, son 15 tornillos;
   y así sucesivamente hasta las hojas del árbol.
3. Suma la demanda de cada pieza a través de **todas** las ventas pendientes (la misma tapa
   puede ser necesaria para varios productos distintos).
4. Clasifica el resultado según la naturaleza de cada pieza.

**Cuándo se ejecuta:** no es en tiempo real. La explosión se recalcula cuando se abre o
recalcula la jornada de producción, o cuando entran ventas nuevas. El encargado trabaja sobre
una "foto" de la jornada.

**Por qué importa:** la explosión es lo que convierte "vendí 37 mesas surtidas" en "necesito 71
tapas, 138 patas, 208 tornillos, 24 cajas…". Sin ella, alguien tendría que calcular eso a mano
cada día, que es justamente lo que hoy hacen con el Excel.

---

## 6. Las dos salidas de la explosión

La explosión produce dos grandes resultados, que son las dos áreas que pediste para la Lógica 2:

### 6.1 Producto final
Es la **cola de producción**: qué productos terminados hay que armar y entregar, agrupados por
modelo y por canal. Esto es lo que la pantalla de Producción **ya muestra hoy** ("faltan 14
unidades de Set Redonda Blanco en Colecta"). O sea, la app ya tiene implementado el primer paso
de la Lógica 2; lo que falta es todo lo que viene debajo.

### 6.2 Materia prima
Es el **rollup de insumos**: cuánto se necesita de cada material base (tornillos, soportes,
cajas, tapatornillos, filo), comparado contra el stock disponible, para saber qué falta. Esto es
lo nuevo y lo más valioso desde el punto de vista de compras y abastecimiento.

Las **piezas de corte** (tapas y patas) son un caso especial: no se "compran", se producen
cortando. Por eso la explosión las desvía a los optimizadores de corte (sección 7), en lugar de
tratarlas como materia prima a comprar.

---

## 7. El corte y la optimización

Acá está la parte más sofisticada del sistema. Hay dos tipos de corte muy distintos, y cada uno
necesita su propia lógica de optimización.

### 7.1 Por qué optimizar
Cada placa y cada listón cuesta plata. Cortarlos mal genera desperdicio (merma). El objetivo del
optimizador es cubrir la demanda de piezas usando **la menor cantidad de material posible**, con
la menor merma. A escala de ~250 unidades por día, una optimización buena ahorra material real
todos los días.

### 7.2 Corte de placas (sector CNC)
Las tapas se cortan de placas de melamina. Cada placa rinde una cantidad fija de tapas de una
medida (por ejemplo, una placa blanca rinde 18 tapas redondas de 50). Eso es un **rendimiento
fijo**.

La vuelta de tuerca son los **combos**: hay placas pensadas para cortar dos medidas distintas en
la misma placa (por ejemplo, una placa que rinde 8 tapas redondas de 40 *más* 15 redondas de 50).
A veces conviene usar un combo aunque sobren algunas tapas de una medida, porque ahorra cortar
una placa entera de la otra.

**Cómo decide el optimizador:** agrupa las tapas que comparten un combo, y para cada grupo prueba
las combinaciones posibles (cuántos combos usar, y cuántas placas simples para completar el
resto), quedándose con la que usa menos placas y, a igualdad, menos merma. Como la escala diaria
es chica, encuentra el óptimo real, no una aproximación.

**Ejemplo medido:** para un pedido chico, sin combos hacían falta 10 placas; con combos, 8. Dos
placas menos en un solo pedido.

### 7.3 Corte lineal: varillas y listones (sector Pino)
Las patas se cortan de materiales lineales: las patas hikari y yori de una varilla de 25 mm, y
las patas de los sets redondos de un listón de pino 2×1. Esto es un problema distinto y más
complejo, llamado **corte lineal** (cutting stock).

Las diferencias con las placas:
- El material viene en **uno o varios largos**. La varilla viene en 1 metro. El listón viene en
  cinco largos distintos: 1,8 / 2,1 / 2,4 / 2,7 y 3 metros.
- De un mismo material se pueden sacar **piezas de medidas distintas mezcladas**. Por ejemplo, de
  un listón se pueden cortar patas chicas (43 cm) y grandes (45 cm) en la misma pieza, combinándolas
  para aprovechar mejor el largo.
- El material se compra y se corta **entero**: no se puede comprar 1,6 metros de varilla; se
  compra por metro entero, y lo que sobra es merma.

**Cómo decide el optimizador lineal:** para cada largo de material, calcula todas las formas
posibles de cortarlo (cuántas chicas y cuántas grandes entran), y después elige la combinación de
cortes que cubre toda la demanda usando el menor largo total de material (que es lo mismo que
minimizar la merma, porque el largo de piezas necesario es fijo).

**Ejemplo medido:** para 114 patas de set, el optimizador descubrió que el listón de 1,8 m corta
exactamente 4 patas grandes sin desperdicio. Resultado: 27 listones de 1,8 m + 1 de 2,7 m, con
apenas 114 cm de merma total (alrededor del 2 %). Una persona difícilmente encuentre esa
combinación a ojo.

### 7.4 Lo que el optimizador produce
El resultado es un **plan de corte** para la jornada: cuántas placas de cada tipo, cuántas
varillas y cuántos listones de cada largo hay que cortar, y con qué patrón. Ese plan se guarda y
se le entrega a los sectores correspondientes (CNC y Pino). Al confirmar el corte, el material se
descuenta del stock.

---

## 8. Stock, materia prima y compras

### 8.1 Consumir en una unidad, comprar en otra
Un concepto importante que el sistema tiene que manejar: muchos insumos **se consumen en una
unidad pero se compran en otra**.
- El filo se *consume* por metro (cada modelo lleva ciertos metros de canto), pero se *compra*
  por rollo de 50 metros.
- El listón se *corta* por unidad, pero se *compra* por palet de 600 a 700 listones.
- Los tornillos se consumen de a uno, pero podrían comprarse en cajas.

Por eso cada SKU guarda su **unidad de compra** y cuántas unidades de consumo trae esa unidad de
compra. Así, cuando el sistema calcula que faltan 120 metros de filo, sabe que eso son 3 rollos
(redondeando para arriba, porque no se compra fraccionado).

### 8.2 El flujo de stock
- **Ingreso:** cuando entra mercadería a la fábrica (un palet de listones, rollos de filo,
  tornillos), el encargado de producción la **carga al sistema como materia prima**. Eso suma al
  stock y queda registrado como movimiento de entrada.
- **Consumo:** cuando se produce o se corta, el sistema descuenta los insumos del stock,
  registrando cada salida.
- **Reposición:** el sistema compara lo que necesita la jornada contra el stock disponible, y
  calcula qué falta. Ese faltante, convertido a unidades de compra, es la lista de compras.

**Por qué trazabilidad:** cada entrada y salida de stock queda registrada con su motivo
(producción, consumo, compra, corte, ajuste). Eso permite auditar y entender por qué el stock
está como está.

---

## 9. Los 5 sectores de la línea de producción

Este es el punto que conecta toda la Lógica 2 con la realidad de la fábrica. La producción pasa
por **cinco sectores**, y cada uno recibe su trabajo ya calculado por la explosión. No son
pantallas sueltas: son **consumidores** de la explosión.

| Sector | Qué recibe | Qué produce / hace |
|--------|------------|--------------------|
| **Encargado de producción** | La jornada completa | Recibe las órdenes, carga la materia prima al ingresar, despacha el trabajo a cada sector y coordina la entrega |
| **CNC** | El plan de corte de placas | Corta las placas y genera las tapas (materia prima TAP) |
| **Melamina** | Las tapas cortadas | Termina las tapas *(a confirmar el alcance exacto, ver sección 13)* |
| **Pino** | El plan de corte lineal | Corta listones y varillas, produciendo todas las patas |
| **Embalaje** | El producto final + los componentes | Ensambla todos los componentes y genera los productos terminados (MAD) para entregar |

**La lógica del ruteo:** la explosión clasifica cada pieza por su tipo y la manda a la cola del
sector que corresponde. Las tapas van a CNC, las patas a Pino, los productos a ensamblar a
Embalaje. El encargado ve el panorama completo y reparte.

**Las dependencias marcan el orden de la línea:** Embalaje no puede empezar hasta que CNC/Melamina
tengan las tapas y Pino tenga las patas. El tablero del encargado muestra esas dependencias como
estados ("esperando tapas y patas"). CNC y Pino pueden trabajar en paralelo desde el arranque.

**Por qué modelar los sectores así:** porque le da a cada sector una pantalla con exactamente lo
que tiene que hacer hoy, calculado automáticamente, sin que nadie traduzca a mano la venta en
trabajo. Y le da al encargado un tablero único para coordinar la línea.

---

## 10. El modelo de datos (descripción funcional)

Esto describe **qué información hay que guardar y cómo se relaciona**, sin entrar en cómo se
programa. Está agrupado en bloques.

### Núcleo compartido (lo usan las dos lógicas)
- **Canales**: los puntos de venta (Colecta, Flex, Tienda Nube, distribuidores, etc.), con su
  horario de cierre y tipo de logística.
- **Catálogo de SKUs**: todos los SKUs con sus atributos (tipo, naturaleza, si es vendible,
  color, categoría, unidad de compra, contenido de compra, largo). Es el maestro de todo.
- **Componentes (árbol de despiece)**: la relación padre→hijo con cantidad. Es la estructura
  recursiva que arma todo el BOM.
- **Corte**: la relación material→pieza con su rendimiento (para placas) o por largo (para
  varillas y listones), marcando si es un combo.

### Lógica 1 (administración)
- **Clientes** y **Proveedores**.
- **Ventas** (cabecera: canal, cliente, fecha, estado, total) y **Líneas de venta** (qué producto
  y cuánto). Las líneas son el punto de contacto con la Lógica 2.
- **Facturas**, **Movimientos de caja** (cash flow), **Cuentas corrientes**, **Empleados**.

### Lógica 2 (producción)
- **Sectores**: los cinco sectores de la línea, con su orden en la secuencia.
- **Jornadas**: el día de producción (una abierta por fecha).
- **Producción**: el registro de cuánto se fabricó de cada SKU, en qué jornada, en qué sector y
  por quién.
- **Stock**: la cantidad actual de cada SKU y su punto de reposición.
- **Movimientos de stock**: cada entrada y salida, con motivo, para trazabilidad.
- **Plan de corte**: el resultado del optimizador para la jornada (cuántas placas, varillas y
  listones cortar).

### Las consultas / vistas que el sistema necesita
Estas son cálculos derivados (no guardan datos nuevos, los calculan a partir de lo anterior):
- Cola de producción (producto final por canal).
- Demanda explotada completa (todos los niveles del árbol).
- Demanda de piezas de corte (tapas + patas).
- Materia prima a reponer (insumos vs stock).
- Compras (materia prima convertida a unidades de compra).
- Orden por sector (la demanda repartida en las colas de cada sector).

---

## 11. El flujo completo, de punta a punta

1. Entra una **venta** desde un canal (lo que ya pasa hoy).
2. La Lógica 1 la registra con su info comercial.
3. La Lógica 2 toma solo el producto, la cantidad y el canal.
4. Al abrir/recalcular la **jornada**, la **explosión** estalla todas las ventas pendientes.
5. La explosión produce: la **cola de producto final**, la **demanda de piezas de corte** y la
   **materia prima**.
6. Los **optimizadores** convierten la demanda de corte en un **plan de placas** y un **plan de
   listones/varillas**.
7. El **encargado** recibe la jornada, carga la materia prima que haya ingresado, y **despacha**
   el trabajo: el plan de corte a CNC y Pino, el producto final a Embalaje.
8. Cada **sector** produce lo suyo y registra su avance, lo que **descuenta el stock** de los
   materiales consumidos.
9. La **materia prima** se compara contra el stock y genera la lista de **compras** en unidades
   de compra.
10. Embalaje ensambla los productos terminados y el encargado coordina la **entrega**.

---

## 12. Correcciones de datos detectadas (importante)

Al revisar el Excel original aparecieron problemas que **hay que corregir antes de cargar los
datos**, porque rompen la explosión:

1. **SKUs duplicados con doble definición.** Tres códigos de tornillo (TOR005, TOR006, TOR007)
   estaban usados para dos cosas distintas a la vez (tornillos rectangulares y tornillos
   Yori/Hikari). Como un mismo código significaba dos cosas, la explosión tomaba la definición
   equivocada. Se resolvió asignando códigos nuevos y únicos a las variantes Yori/Hikari.
2. **Cantidades guardadas como texto** en vez de número: hay que normalizarlas.
3. **Filo y varilla no estaban modelados** como consumo de los productos: se agregaron (el filo
   como insumo por metro, la varilla como material de corte).
4. **Patas de los sets:** estaban como insumo comprado, pero en realidad las corta el sector Pino
   del listón de pino. Pasaron a ser piezas de corte.
5. **Tapatornillos de color** definidos pero no enganchados a los productos negros.
6. Un par de correcciones puntuales de despiece (la caja del Hikari, los tornillos del Hikari).

**Por qué importa:** si se cargan los datos sin corregir esto, la explosión da números
equivocados y todo lo que viene después (compras, plan de corte) sale mal.

---

## 13. Reglas de negocio y decisiones clave (el "por qué")

- **Una sola venta, dos lecturas:** evita duplicar datos y desacopla las dos lógicas.
- **Un árbol de despiece recursivo unificado:** convierte cuatro hojas de Excel en una estructura
  y un único algoritmo de explosión.
- **El corte va aparte del despiece:** porque es una relación inversa (el material rinde piezas,
  no las contiene).
- **Dos optimizadores distintos:** las placas son rendimiento fijo + combos; los materiales
  lineales son corte por largo con mezcla de piezas. Son problemas matemáticamente distintos.
- **Unidad de consumo distinta de unidad de compra:** el sistema convierte (metros→rollos,
  unidades→palets) y redondea para arriba porque no se compra fraccionado.
- **Los sectores consumen la explosión:** cada sector recibe su trabajo calculado, no traducido a
  mano.
- **El encargado es quien ingresa la materia prima:** el stock entra por él cuando llega la
  mercadería.

---

## 14. Plan de integración por fases (sin romper lo existente)

El principio es que **todo es aditivo**: no se borra ni reemplaza nada de lo que ya funciona. Las
pantallas actuales siguen igual; la Lógica 2 se monta encima.

- **Fase 0 — Corregir los datos del Excel** (sección 12) antes de cargar nada.
- **Fase 1 — Enriquecer el catálogo** con los atributos nuevos y cargar el árbol de despiece y el
  corte. La app sigue funcionando idéntica; solo la base se enriquece.
- **Fase 2 — La explosión** (las consultas de cálculo). Son de solo lectura: no cambian nada para
  el usuario todavía.
- **Fase 3 — Los optimizadores** de corte (placas y lineal).
- **Fase 4 — Los sectores**: el tablero del encargado y las vistas internas de cada sector.
- **Fase 5 — Stock, materia prima y compras**, con la pantalla de ingreso de materia prima.
- **Fase 6 — Encender las pantallas nuevas** en el menú de Producción.

Cada fase es verificable por separado; si una falla, las anteriores siguen funcionando.

**Pantallas nuevas (todas cuelgan del menú Producción que ya existe):**
- Producción → Optimización: producto final, plan de corte, materia prima, compras.
- Producción → Tablero de sectores (vista del encargado).
- Producción → vista interna de cada sector.
- Producción → Ingreso de materia prima.

---

## 15. Cabos abiertos (a definir con el negocio antes de cerrar)

1. **Filo:** falta cargar cuántos metros de filo lleva cada modelo. Se consume por metro y se
   compra por rollo de 50 metros.
2. **Melamina:** confirmar si el sector solo termina las tapas que corta CNC, o si además fabrica
   algún componente propio (por ejemplo soportes).
3. **Palet de listones:** la cantidad real varía entre 600 y 700 por palet; conviene cargarla en
   cada ingreso, no fijarla.

---

## 16. Glosario

- **SKU:** código único de cualquier ítem del catálogo (producto, pieza, insumo, material).
- **Publicación / MAD:** el producto que se vende, lo que el cliente ve.
- **BOM / árbol de despiece:** la estructura que dice de qué se compone cada producto, nivel por
  nivel.
- **Explosión:** el cálculo que estalla las ventas en demanda de piezas y materiales.
- **Pieza de corte (TAP / pata):** lo que se obtiene cortando un material (tapa de placa, pata de
  listón o varilla).
- **Combo:** una placa que rinde dos medidas de tapa en la misma placa.
- **Corte lineal / cutting stock:** el problema de cortar materiales de largo (varillas, listones)
  minimizando la merma.
- **Merma:** el desperdicio de material que sobra al cortar.
- **Materia prima:** los insumos que se consumen y eventualmente se compran.
- **Jornada:** el día de producción.
- **Sector:** cada una de las 5 áreas de la línea de producción.
