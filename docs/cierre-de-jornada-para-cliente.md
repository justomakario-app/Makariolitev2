# Cómo va a funcionar el sistema de cierre de jornada

> Documento para entender el día a día de la operación con el nuevo sistema.
> Pensado para Justo y el equipo, sin tecnicismos.

---

## 1. ¿Qué es una jornada y por qué la usamos?

**Una jornada es una caja donde guardamos todo lo que pasa con un canal en un día.**

Pensá en cada canal como una pista de despacho: Colecta es una pista, Flex es otra, Tienda Nube es otra, etc. Cada día, en cada pista, hay pedidos que entran, hay producción que se carga y, al final, alguien tiene que cerrarla y hacer el balance.

La "jornada" es esa caja. Adentro vive todo lo que corresponde a ese canal en ese día:
- Los pedidos que llegaron.
- Lo que se produjo (cuántas mesas, de qué modelo, en qué color).
- Lo que faltó.
- Lo que sobró.

Cuando termina el día, esa caja se cierra: queda guardada, no se puede modificar, y se genera un reporte. Al día siguiente se abre una caja nueva.

**¿Por qué nos importa?**
Hoy, cuando termina el día y querés saber cuánto se produjo para Colecta, tenés que sumar a mano y no hay garantía de que el número esté limpio. Con jornadas, el cierre te da el número exacto en un click — y no se mezcla nunca con lo de mañana.

---

## 2. ¿Cómo se abre una jornada?

**Una jornada se abre cuando el encargado o admin la declara, y el sistema la marca como "lista para recibir cargas".**

Hay dos formas en que aparece una jornada:

**Manual (lo más común):** Sofía (encargada) abre la app, va al canal Colecta, y aprieta el botón "Abrir jornada del martes 5". El sistema crea la caja vacía. A partir de ese momento, todo lo que se cargue a Colecta para ese día va a esa caja.

**Automática (caso de respaldo):** Si Martín (operario) intenta cargar producción a un canal que no tiene ninguna jornada abierta, el sistema crea una de hoy automáticamente y le avisa al encargado. Así nunca se pierde una carga por descuido.

**Ejemplo concreto:**
> Lunes 4 de mayo, 14hs. Sofía planifica el martes. Entra a Colecta y abre la jornada del martes 5. La app le confirma: "Jornada Colecta · Martes 5 · Abierta". Listo, ya existe la caja. Vacía, esperando producción y pedidos.

**Reglas duras del sistema:**
- No se puede tener dos jornadas abiertas del mismo canal el mismo día. Si Sofía intenta abrir "Martes 5" y ya existe, el sistema le dice "esa jornada ya está abierta".
- No se puede abrir una jornada que ya fue cerrada. Si el lunes ya quedó cerrado y firmado, esa caja queda intocable.

---

## 3. ¿Qué es la "jornada activa para producción"?

**Es la jornada donde van a parar las cargas nuevas de los operarios cuando ellos no eligen ninguna a mano.**

Este concepto es nuevo y es la pieza más importante del sistema. Lo explicamos con un ejemplo:

Imaginate que es lunes 4 a las 21hs. Sofía planificó el día y ya tiene **dos jornadas de Colecta abiertas al mismo tiempo**:
- La del lunes 4 (que se va a cerrar mañana a la mañana).
- La del martes 5 (que está esperando producción).

Martín entra al galpón a la noche y arranca a producir mesas para el despacho de mañana. Carga 60 unidades del modelo MAD050 (Mesa Nórdica Petiribi Blanco) a Colecta.

**¿A cuál de las dos jornadas tiene que ir esa carga?**

Sin el concepto de "jornada activa", el sistema tendría que adivinar — y se equivocaría. Si elige la del lunes 4 (la más vieja), Martín vería su producción contada para hoy cuando en realidad es para mañana. Sería un quilombo.

**La solución:** una de las dos jornadas (y solo una) está marcada como "activa para producción". Ese flag lo controla Sofía o cualquier admin. En la práctica, lo que va a pasar es:

> El lunes a la tarde, Sofía abre la jornada del martes 5 y al hacerlo, el sistema automáticamente la marca como **activa para producción**. La del lunes 4 queda abierta también (porque todavía falta cerrarla con el balance del día), pero ya no recibe cargas nuevas.

Cuando Martín a las 21hs carga 60 unidades de MAD050, el sistema mira "¿cuál es la jornada activa de Colecta?" → la del martes 5 → ahí va la carga. Sin que Martín tenga que pensar en eso.

**¿Quién puede cambiar la jornada activa?**
Solo encargados, admins y dueños. Tienen un botón "Marcar como activa para producción" tanto en el dashboard del canal como en el histórico.

**¿Qué pasa si están abiertas dos pero ninguna está marcada activa?**
Nunca debería pasar (al abrir una nueva, se marca activa de movida). Pero si ocurre por algún motivo (ej. alguien la desmarcó a mano), cuando un operario intenta cargar el sistema lo bloquea con un mensaje claro: *"Hay 2 jornadas abiertas en Colecta y ninguna está marcada como activa. Pedíle al encargado que defina cuál es la jornada activa."* Así nadie carga al lado equivocado por error.

---

## 4. ¿Cómo carga producción el operario?

**El operario abre la app, escanea o elige el modelo, pone la cantidad, y listo. El sistema decide a qué jornada va sin que él tenga que pensarlo.**

El flujo desde el cel/tablet:

1. Martín entra a la app, va a la pestaña "Scan".
2. Escanea el QR del modelo MAD050 (que está pegado en el banner del depósito) o lo elige a mano de la lista.
3. Elige el canal: Colecta.
4. Pone la cantidad: 60.
5. Confirma.

El sistema, por atrás, hace tres cosas que Martín no ve:
- Mira cuál es la jornada activa de Colecta → la del martes 5.
- Registra los 60 MAD050 ahí adentro.
- Le muestra a Martín un mensaje: "60 × MAD050 → Colecta · Martes 5 ✔".

**¿Cuándo aparece un selector de jornada al cargar?**
Solo si hay 2 o más jornadas abiertas del mismo canal. En ese caso, debajo del canal aparece un menú "Jornada: [Martes 5 (activa) ▾]" con la opción de cambiar a otra jornada abierta. **El default ya viene correcto** — el selector está solo por si excepcionalmente alguien quiere cargar a otra.

Si solo hay una jornada abierta, el selector no aparece. Menos clicks, menos confusión.

---

## 5. ¿Qué pasa si el operario se equivoca?

**Tiene 24 horas (o hasta que se cierre la jornada, lo que pase primero) para corregir su propio error sin pedirle a nadie.**

Los 4 errores típicos y qué hacer:

**a) Se equivocó de cantidad** (puso 50 cuando eran 60, o 60 cuando eran 50)
> Martín carga 50 de MAD050. Se da cuenta que eran 60. Va a "Mis cargas de hoy", aprieta Editar en esa carga, cambia la cantidad a 60 y confirma. El sistema deja registro: en el histórico se ve la carga vieja de 50 anulada y la nueva de 60. Nada se borra, todo queda trazable.

**b) Se equivocó de modelo** (escaneó MAD050 cuando era MAD300)
> Martín se da cuenta. Anula la carga de MAD050 y registra una nueva de MAD300. Misma mecánica.

**c) Se equivocó de destino** (cargó a Colecta cuando era Flex)
> Edita la carga, cambia el canal de Colecta a Flex, confirma. Listo. (Ojo: si la jornada original era de Colecta y la nueva tiene que ir a Flex, el sistema arma la corrección en la jornada activa de Flex.)

**d) Se equivocó de color**
> Como cada color tiene su propio SKU (MAD061 es Set Gota Blanco, MAD062 es Set Gota Negro), corregir color es lo mismo que corregir modelo: anula y re-registra.

**Atajo: el "Deshacer" de 5 segundos**
Apenas Martín confirma una carga, le aparece un cartelito verde abajo con un botón **Deshacer**. Si en los primeros 5 segundos se da cuenta del error, un toque al botón borra la carga sin pasar por el menú de "Mis cargas". Una vez tocado, el botón cambia a "Hecho" para que no vuelva a apretar y deshaga dos veces.

**¿Qué pasa si pasaron más de 24 horas o se cerró la jornada?**
El operario ya no puede corregir solo. La app le muestra un mensaje claro: *"Pasaron más de 24 horas desde que cargaste — pedíle al encargado."* O *"No podés corregir esta carga: el canal Colecta ya tiene un cierre del 04/05. Pedíle al encargado."* En esos casos, el encargado o admin sí puede.

---

## 6. ¿Cómo se cierra una jornada?

**Cuando Sofía o un admin decide que ya no hay más cargas para esa jornada, la cierra. Eso le saca una foto al estado, archiva los pedidos completados y arrastra los faltantes al día siguiente.**

Paso a paso:

1. Sofía entra al canal Colecta y aprieta "Cerrar jornada del lunes 4".
2. La app le muestra un **preview**: cuántos pedidos tenía esa jornada, cuánto se produjo, cuánto faltó, qué SKUs sobraron.
3. Si todo cuadra, confirma.
4. El sistema:
   - Saca una **foto fija** del estado (no se puede tocar nunca más).
   - Marca los pedidos del día como archivados.
   - Si quedó faltante (pedido pero no producido), genera **pedidos arrastrados** automáticamente para la próxima jornada del mismo canal.
   - Genera dos reportes (Excel y PDF) y los guarda.

**¿Quién puede cerrar?**
Solo encargados, admins y dueños. Operarios no.

**¿Qué canales se pueden cerrar?**
Todos. Colecta y Flex tienen cierre por horario (12hs y 14hs respectivamente, lo decide el sistema y avisa al encargado). Tienda Nube, Distribuidores, No Flex y Correo Argentino se cierran cuando el encargado lo decida — no tienen horario fijo. La regla es: el cierre lo decide la persona, no el reloj.

**Reglas duras del sistema:**
- No se puede cerrar dos veces la misma jornada. Si alguien aprieta dos veces el botón, el segundo click avisa "esta jornada ya está cerrada".
- No se puede modificar una jornada cerrada (la foto es inmutable).
- Si la jornada cerrada todavía tenía la marca de "activa para producción", el sistema la pasa automáticamente a la siguiente jornada abierta del mismo canal — para que el rolling siga sin huecos.

---

## 7. ¿Qué pasa con el stock que sobra al cerrar?

**Por defecto, lo que sobra se "arrastra" a la próxima jornada del mismo canal. Si querés moverlo a otro canal o dejarlo libre, hay un botón para cambiar la disposición.**

Ejemplo concreto:

> Lunes 4. Colecta tenía 100 pedidos de MAD050. Se produjeron 110. Sobran 10.

Cuando Sofía cierra el lunes, el sistema le muestra:
```
MAD050 · Sobrante: 10 unidades  →  Arrastrar a próxima Colecta  ✔
                                    [Cambiar disposición]
```

Si Sofía no toca nada, las 10 unidades quedan **pre-producidas para la próxima jornada de Colecta**. Cuando llegan los pedidos del martes, esas 10 ya están listas, no hay que volver a producirlas.

Si toca "Cambiar disposición", aparecen 3 opciones:
- **Arrastrar a próxima Colecta** (default).
- **Mover a stock libre**: las 10 unidades quedan en una bolsa común del SKU, sin canal asignado. Sirve para asignarlas después a cualquier canal o para entregar a un cliente walk-in (alguien que vino al galpón y se las llevó).
- **Mover a otro canal**: ej. mover las 10 a Flex porque Flex todavía tiene faltante de ese SKU.

**¿Cómo se ve el stock libre?**
En la pestaña Catálogo, cada SKU tiene una columna "Stock libre". Si MAD050 tiene 10 en stock libre, ahí los ves. Click en el número y se abre un modal "Asignar a canal" donde elegís a qué canal mandarlos. También se pueden "consumir" sin canal (registrar la salida de las 10 sin que vayan a una jornada).

---

## 8. ¿Qué pasa si hay que corregir algo después del cierre?

**El cierre congela la foto del día, pero la operación no se rompe — los admins pueden registrar ajustes posteriores que no tocan la foto vieja.**

Tres escenarios:

**Operario detecta un error suyo después del cierre.**
Ejemplo: el martes a la mañana Martín se da cuenta que el lunes cargó 60 cuando eran 50. Como la jornada del lunes ya cerró, él no puede corregir solo. Le avisa a Sofía.

**Sofía o admin corrige.**
Sofía entra al histórico, busca la carga del lunes, aprieta "Corregir" y registra el ajuste. El sistema:
- **NO toca la foto del cierre del lunes** (esa queda como prueba de lo que se reportó al cerrar).
- Registra el ajuste en la jornada vigente con una etiqueta "[CORREGIDO POST-CIERRE]".
- Suma o resta del stock libre según corresponda.

Así, el reporte del lunes sigue diciendo "se produjeron 60", pero el stock real ya tiene el descuento de los 10 que estaban de más.

**¿Y si se hizo un cierre completo equivocado?**
Por ejemplo, Sofía cerró Colecta del lunes pero olvidó incluir las 80 unidades que Martín cargó después. Para esa cobertura existe la **reapertura de jornada**, pero **no entra en la primera versión** del sistema. La razón: es una operación destructiva, hay que hacerla con mucho cuidado y los casos donde realmente se necesita son muy raros. Si en los primeros meses de uso aparece la necesidad, lo agregamos como una etapa nueva.

**Mientras tanto:** el 95% de los casos se cubren con los ajustes post-cierre. Solo si pasa algo realmente grave habría que abrir un ticket y resolverlo manual.

---

## 9. ¿Qué reportes salen?

**Cada cierre genera dos reportes automáticos: un Excel para auditoría y un PDF para imprimir o mandar por WhatsApp.**

Contenido de los reportes:

**Encabezado:**
- Canal (ej. Colecta).
- Fecha de la jornada (ej. lunes 4 de mayo).
- Quién cerró y a qué hora.

**Cuerpo:**
- Lista de SKUs con: pedido, producido, faltante, sobrante.
- Lista de pedidos individuales cubiertos en esta jornada.
- Lista de pedidos arrastrados al día siguiente.
- Disposición de los sobrantes (arrastre, stock libre, otro canal).

**Pie:**
- Totales del día.
- Quién hizo cada carga (operario y sector).
- Notas si las hubo.

Los reportes quedan **archivados automáticamente**. En el histórico, cada jornada cerrada tiene dos íconos: "Descargar Excel" y "Descargar PDF". Los podés bajar el día del cierre, una semana después o un año después — siguen ahí.

**¿El reporte diario que bajás hoy se mantiene?**
Sí. Esto es algo distinto: el reporte de cierre es una foto de cómo terminó el día en ese canal. El reporte continuo que ya tenés sigue funcionando exactamente igual.

---

## 10. Un día típico de la planta — línea de tiempo

Para que se entienda todo junto, así se ve un lunes-martes con jornadas, carga adelantada y cierre.

**Lunes 4 — 08:00**
Sofía llega y mira el dashboard. Ve: "Colecta · Lunes 4 · Activa". Es la jornada del día corriendo desde el viernes (cuando la abrió antes de irse).
Martín y Lucía ya están produciendo. Las cargas que hacen van a la jornada del lunes 4.

**Lunes 4 — 12:00**
Hora del despacho de Colecta. El courier de Mercado Libre pasa a las 12. Sofía revisa el preview del cierre, ve que se completaron 95 de 100 pedidos, faltan 5. Cierra la jornada del lunes. El sistema:
- Saca la foto del lunes para Colecta.
- Archiva los 95 pedidos completados.
- Arrastra los 5 faltantes a la próxima jornada de Colecta.
- Genera los reportes.

**Lunes 4 — 14:00**
Sofía planifica el martes. Aprieta "Abrir jornada Colecta · Martes 5". El sistema crea la caja y la marca como activa para producción. Listo, ya pueden cargar para el martes.

**Lunes 4 — 18:00**
Martín y Lucía siguen produciendo. Las cargas van a la jornada del martes 5 (porque es la activa de Colecta). En el dashboard aparece "Colecta · Martes 5 · 0/100 (faltan 100)" y van bajando los faltantes a medida que producen.

**Lunes 4 — 21:00**
Justo (dueño) abre la app desde su casa. Ve cómo va el martes: "Colecta · Martes 5 · 60/100". Sabe que estamos al 60% antes del cierre del día. Sin sistema viejo, no podía saber esto sin llamar a Sofía.

**Lunes 4 — 23:30**
Martín cierra el galpón. Carga 80 unidades más antes de irse. Total del martes hasta ahora: 80/100. Le sobra completar 20 unidades mañana a primera hora.

**Martes 5 — 08:00**
La gente entra a producir lo último. A las 11:50 ya están las 100 listas para Colecta del martes.

**Martes 5 — 12:00**
Sofía cierra Colecta del martes. Faltante 0. Arrastrados ninguno. Reporte limpio.

Y el ciclo se repite.

---

## 11. Preguntas frecuentes

**¿Qué pasa si me olvido de abrir la jornada del día?**
Cuando un operario intenta cargar a un canal que no tiene jornada abierta, el sistema crea una de hoy automáticamente. No se pierden cargas. Pero te llega una notificación "Se abrió la jornada de Colecta automáticamente" para que estés al tanto.

**¿Y si abro dos jornadas del mismo día por error?**
No se puede. El sistema rechaza la segunda con el mensaje "Ya existe una jornada para este canal y fecha".

**¿Puedo cargar producción para un día que ya pasó?**
Sí, pero solo si la jornada de ese día sigue abierta. Si ya se cerró, no — porque la foto está fija. Si necesitás meter algo en una jornada cerrada, eso es un ajuste post-cierre y solo puede hacerlo un admin.

**¿Cómo sé qué jornada está activa en cada canal?**
En el dashboard de cada canal, arriba a la izquierda, aparece un chip: "Jornada activa: Martes 5". También en la home de los operarios. Cualquiera lo ve.

**¿Si un operario nuevo no entiende el sistema, qué pasa?**
Mientras solo haya una jornada abierta por canal, él no necesita saber nada de jornadas — el flujo es idéntico al actual: escaneá, elegí canal, poné cantidad, confirmá. La complejidad del rolling solo aparece cuando hay 2+ jornadas abiertas, y ahí el sistema le muestra el selector para que elija (con default ya correcto).

---

## Glosario rápido

- **Jornada**: caja virtual que guarda todo lo que pasa con un canal en un día (pedidos, producción, faltantes, sobrantes).
- **Jornada abierta**: caja que está recibiendo cargas y pedidos. Se puede modificar.
- **Jornada cerrada**: caja a la que ya se le sacó la foto y no se modifica más.
- **Jornada activa para producción**: la jornada (de un canal) donde van a parar las cargas nuevas cuando el operario no elige a mano.
- **Cierre**: acción de cerrar una jornada. Saca la foto, archiva pedidos, arrastra faltantes, genera reportes.
- **Arrastre**: cuando un faltante o un sobrante de una jornada cerrada se traslada automáticamente a la siguiente jornada del mismo canal.
- **Stock libre**: unidades de un SKU que están listas pero no asignadas a ningún canal. Se reasignan a mano.
- **Disposición**: lo que se decide hacer con un sobrante al cerrar (arrastrar, stock libre, otro canal).
- **Ajuste post-cierre**: corrección hecha después de que la jornada cerró. No toca la foto del cierre, se aplica a la jornada vigente con etiqueta especial.
- **Foto del cierre** (técnicamente "snapshot"): registro inmutable del estado de la jornada al momento de cerrarla. Sirve como prueba histórica.

---

*Cualquier duda sobre algún punto, marcalo y lo aclaramos antes de implementar.*
