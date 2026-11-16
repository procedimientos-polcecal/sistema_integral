# Linkear un RI a mano, y la descripción estandarizada del pañol

*Acordado el 13/11/2026.*

## Qué problema resuelve

La descripción de un requerimiento la escribe cada uno a mano, así que el cruce
por texto entre el repuesto de una OT y los RI en curso falla seguido. Cuando
falla, quien mira la orden **ya tiene el número del RI** —se lo trae el aviso de
Compras o se lo pasa quien pidió— y lo busca a mano en la planilla de Compras.

Lo que falta, entonces, no es un buscador mejor: es **un lugar donde escribir un
número que ya está en la mano**, y que quede pegado para no volver a buscarlo.
Por más que el cruce por texto mejore, nunca va a poder adivinar un RI que dice
algo distinto a lo que dice el pañol.

Y pegado a eso, lo segundo que se pidió: que al armar el pedido desde el
repuesto de una OT, el sistema ofrezca **la descripción estandarizada del
artículo del pañol** en vez del texto libre.

## Lo que se midió antes de diseñar

Con `scripts/medir-cruce-de-repuestos.mts` contra producción, el 13/11/2026.
No es una muestra: es la población entera.

- **`ordenes_trabajo_repuestos` tiene 26 filas**, en 20 OT — y de esas veinte
  **sólo 4 están abiertas** (3 `EN_PROCESO` y 1 `POR_HACER`), con **7 de los 26
  repuestos**. Las otras 16 están realizadas.
  *Esto decía «todas abiertas» hasta que lo revisó alguien con ojos frescos: el
  script calculaba «abiertas» con la lista de `--todas`, que incluye
  `REALIZADO`, así que la etiqueta decía una cosa y la cuenta hacía otra. Ya
  está arreglado, y vale anotarlo porque el número equivocado llegó a un diseño.*
- **El código es lo que decide**: los 4 repuestos con código anotado reconocen
  su artículo; de los 22 sin código, **fallan 19**.
- Las 19 fallas **no son la misma cosa**, y esa división es la que ordena el
  trabajo:
  - **6 están en el pañol y el cruce las pierde.** La OT dice
    `Niple galvanizado ø 3 " x 300 mm` y el pañol tiene
    `01221 NIPLE GALVANIZADO 3" X 300MM`. Medido corriendo `normalizar`: deja
    pasar el `ø`, el espacio antes de la comilla y el de `300 mm`, así que el
    `includes` de `buscarEnInventario` falla. **Es la misma familia que el bug
    de la pulgada del 12/11/2026, pero en el otro cruce** —aquél se arregló en
    `riDelRepuesto.ts` y éste vive en `stock.ts`—.
  - **12 no están en el pañol**: «grilla» da **0** artículos activos,
    «reflector» 0, «balde» 0. Ahí no hay artículo que elegir ni descripción que
    estandarizar.
  - 1 es basura de prueba (`2232323232…`).
- **Entre las OT abiertas hay una sola competencia real, y es un empate.** Dos
  artículos los piden dos o más órdenes abiertas —el niple y la tapa—, y las
  dos veces es **el mismo trío: 2896, 2897 y 2898**, que además tienen las tres
  `fecha = 2026-10-26`. O sea que el reparto por antigüedad **no es hipotético,
  pero hoy gobierna tres órdenes y dos artículos**, y lo primero que encuentra
  es un empate a tres.
- Contando también las realizadas son 5 artículos compartidos. Las grillas
  —el ejemplo de las cinco grafías— están **todas en OT cerradas**.
- Cuatro de esos cinco se agrupan **por texto y no por artículo**, y el texto
  está escrito de cinco formas distintas: «Grillas de 2mm», «Grillas de 2 mm»,
  «Grillas 4mm», «Grillas 4 mm», «grillas de 4mm».
  *Corrección del 16/11/2026: esto decía que **cuatro** de los cinco se agrupaban
  por texto, y dejó de ser cierto cuando se arregló el cruce con el pañol (la
  tarea 1). Medido de nuevo contra producción: el cruce pasó de **7 a 13 de 26
  reconocidos, sin perder ninguno**, y el niple que piden 2896, 2897 y 2898
  resuelve ahora al código **01221**. Esas tres, la única competencia real que
  hay hoy, comparten entonces un **artículo** y su link es **global** y no del
  renglón —que es justo lo que el diseño quería—. Lo que sigue agrupándose por
  texto son los que no están en el pañol, como las grillas.*

## Objetivos

1. Poder **pegar el número de un RI** a un repuesto, escribiéndolo.
2. Poder **elegir a mano el artículo del pañol** de un repuesto, cuando el
   cruce no lo reconoció o lo reconoció mal.
3. Que cada OT lea **su parte de la cuenta**: cuántas de las que pidió están
   cubiertas por lo que viene y cuántas falta pedir.
4. Que el pedido armado desde el repuesto de una OT salga con la **descripción
   del artículo del pañol** cuando hay artículo.
5. Que el cruce deje de perder los artículos que **sí están** en el pañol.

El 2 entró al pedirlo el usuario sobre el final, y **no es un objetivo de
adorno**: la regla «elegido a mano, cambia solo» lo presuponía sin que
existiera, y mientras no exista lo único que el sistema tiene para saber si
alguien eligió es que haya código escrito — un campo que también se tipea a
mano, así que un código mal puesto cambiaría la descripción en silencio, que es
justo lo que esa regla prohíbe. Además **se lleva puesto casi todo el costo del
link suelto**: un repuesto con artículo elegido queda enganchado, y su link pasa
a ser global.

## No objetivos

- **Agrupar repuestos sueltos por texto parecido.** Es la forma obvia de que el
  link valga para varias OT, y está descartada a propósito: con cinco maneras
  de escribir «grillas», el RI de las de 2 aparecería en la orden que pide las
  de 4. Es la regla de la casa —*enlazar al que se le parece es peor que dejar
  en null*— y un enlace equivocado no se nota nunca.
- **Un libro de reservas guardado.** El reparto se calcula; ver abajo.
- **Obligar a dar de alta el artículo en el pañol** para poder linkear. Se
  evaluó y se descartó: 12 de 26 repuestos no están en el inventario y pedirlo
  dejaría el link inalcanzable justo donde más falta hace.
- **Rehacer cómo se cargan los repuestos de una OT.** El objetivo 2 agrega
  elegir el artículo de uno que ya está cargado; el alta sigue siendo la que
  es, con su nombre, su código y su cantidad en texto libre.

## Anti-objetivo

**Que un RI aparezca en la orden equivocada.** Es peor que no mostrarlo: quien
mira se queda tranquilo con un pedido que no es el suyo, y nada lo desmiente.

## Las decisiones, como se tomaron

### El link

- **Se escribe el número del RI.** No se busca por descripción: el número es lo
  que la persona ya tiene.
- **Lo escribe Mantenimiento**, que conoce el número por sus propios pedidos.
  Vale decir por qué se preguntó: la regla medida de la casa es que *quien
  compra no entra a Mantenimiento* —es la razón por la que existe toda la
  función de preguntarle a Compras por un repuesto—, así que si el que tuviera
  el número fuese alguien de Compras, el campo quedaría donde no puede
  escribirlo. **No lo es**, y por eso esto no necesita una segunda pantalla en
  la bandeja de Compras ni aflojar `mant_puede_editar()`.
- **Un mismo destino puede tener varios RI pegados**, porque el propio diseño
  los produce: la OT que lee «faltan 30 por pedir» genera un segundo RI que
  alguien va a querer pegar al mismo artículo. Con uno solo, el segundo pisaría
  al primero y una OT que estaba cubierta volvería a estar descubierta sin que
  nadie lo relacione con eso. **Tener más de uno se marca y no es mudo**: la
  pantalla lo dice.
- **Si el repuesto reconoce un artículo del pañol, el link va al artículo y es
  global**: vale para toda OT que pida ese artículo, no sólo para la que lo
  cargó.
- **Si el repuesto es suelto** —sin artículo, ni reconocido ni elegido— **el
  link va a ese renglón de esa OT y no se propaga.** Con el objetivo 2 esto
  queda para lo que **no está en el pañol**: las grillas, el reflector, los
  baldes — 12 de los 26 medidos, donde no hay artículo que elegir. Para todo lo
  demás alcanza con elegirlo una vez y el link se vuelve global.
  El costo que queda está medido y aceptado: si dos OT piden la misma grilla,
  alguien pega el mismo número dos veces. A cambio, ningún RI aparece donde no
  corresponde.

### La cuenta

- **El sistema da por sentado que cada OT abierta se lleva lo que pidió.** No
  se declara a mano cuánto de un RI es para cada orden.
- **La más vieja primero.**
- **El stock que ya está en el pañol no descuenta.** Si la OT pide 80 y hay 61,
  igual se lleva 80 de lo que viene; *cuando se usan de verdad para esa OT,
  Compras se encarga de reponer*. Es coherente con la decisión del 12/11/2026
  de que el RI sugerido salga por lo que pide la orden y no por el faltante,
  porque pedir sólo el faltante deja el pañol en cero apenas se hace el trabajo.
- Entonces, con un RI de 100 y la OT 2970 llevándose 80, **la siguiente OT que
  pida 50 no lee «hay un RI en curso»** —eso la dejaría tranquila y no lo
  está—: lee que de sus 50 hay 20 cubiertas y 30 que alguien todavía tiene que
  pedir.
- **El reparto no se guarda: se calcula** cada vez, a partir de los RI pegados y
  de las OT abiertas que piden ese artículo. Es la misma forma que ya tiene
  «pregunta abierta» en este repo —se calcula en TypeScript y nunca en SQL,
  para que no haya dos definiciones— y evita el problema de un libro guardado:
  una OT que se cierra o que cambia de cantidad dejaría reservas viejas que
  nadie limpia.

### Cinco decisiones que tomó quien escribió esto, no el usuario

Están acá y no en «lo que queda al builder» porque cambian lo que el sistema
dice, no cómo se construye. Si alguna está mal, se discute antes de planificar.

- **La cuenta mira sólo los RI pegados a mano, y nunca los que el cruce adivina
  por nombre.** Sale del anti-objetivo: el cruce por nombre es la mitad incierta
  —es la que pierde el niple y la que podría traer otra cosa—, y alimentando la
  cuenta con un falso positivo una OT leería «cubierta» por un pedido que no es
  suyo. Lo que el cruce encuentra se sigue mostrando como hasta hoy («Ya
  pedido»), separado de la cuenta.
- **El empate se rompe por número de OT, de menor a mayor.** No es un detalle
  de implementación: es la única competencia real que hay hoy —2896, 2897 y
  2898 tienen las tres `fecha = 2026-10-26`—, así que sin regla de desempate el
  orden lo decide PostgREST y la misma pantalla puede decirles cosas distintas
  a dos personas. `ordenes_trabajo` no tiene `created_at`, y de los campos que
  hay el número es el único que no se reescribe solo.
- **Una OT cerrada no reclama nada.** La cuenta es de las abiertas: una orden ya
  hecha que siguiera reclamando se comería lo que viene y dejaría a la abierta
  leyendo «cubierta», que es el anti-objetivo por la puerta de al lado. Hoy
  **16 de las 20 OT con repuestos están realizadas**, así que no es un caso de
  borde.
- **Lo que «viene» es lo pedido menos lo que ya llegó.** Medido: de 2.304 RI,
  **1.653 tienen `cantidad_recibida` mayor que cero**. Contar un RI ya recibido
  como «en camino» lo contaría dos veces —una en el stock del pañol y otra como
  lo que viene—, y es la misma línea que ya traza `risDelRepuesto` al mirar sólo
  los que están en curso.
- Y una que es cautela y no cuenta: **un RI sin cantidad legible no alimenta la
  cuenta**, igual que un repuesto sin cantidad legible no se compara. Son **90
  de 2.304**. Decir «cubierta» sin saber cuánto viene es inventar.

### La descripción

- **Elegido a mano, cambia solo.** Si la persona eligió el artículo, está claro
  que quiere su descripción y volver a preguntar es estorbo.
- **Reconocido solo por el sistema, se ofrece y la persona acepta.** Ahí no
  eligió nada, y sustituirle el texto sin avisar puede cambiarle lo que quiso
  decir.
- Esto **ya existe a medias**: `pedidoSugerido` (`lib/mantenimiento/pedirRepuesto.ts`)
  ya completa la descripción con la del artículo cuando lo reconoció, y cae al
  texto libre cuando no. Lo que falta es el ofrecimiento, y que lo reconozca más
  seguido.

## Restricciones

- **La migración la aplica una persona** en el editor SQL de Supabase. Lo que
  dependa de una tabla o columna nueva queda a la espera, y el orden de
  despliegue hay que decirlo.
- **PostgREST corta en 1.000 filas sin avisar.** `ordenes_trabajo` tiene 2.453:
  el primer intento de la medición leyó 1.000 y el número redondo fue lo único
  que lo delató. Va `traerTodo()`, y un `.in()` de a lotes de 200.
- Si el link o la cuenta tocan un campo que se exporta a la planilla, vale la
  regla de siempre: exportar o dejar el pendiente anotado.
- Todo en castellano.

## Lo que queda a criterio de quien lo construya

- **Dónde vive el link**: una tabla propia o una columna, y cómo se expresa que
  el mismo mecanismo cuelga de dos cosas distintas (un artículo del pañol o un
  renglón de una OT). Las dos puntas tienen que poder borrarse sin dejar
  huérfano al otro lado.
- **Cómo se arregla el cruce de `buscarEnInventario`.** El caso medido es el
  `ø` y los espacios, pero conviene mirar antes qué pasó con el arreglo gemelo
  de `riDelRepuesto.ts` el 12/11/2026: ahí, tocar sólo lo obvio cambiaba un
  falso negativo por falsos positivos, y la medición lo destapó. **Medir antes
  y después con el script, y mirar también qué deja de reconocer.**
- **Si pegar un link se audita.** No es irreversible, así que por la regla de
  la casa no lo necesita; pero decide a quién le aparece un pedido, y eso es un
  juicio.
- La pantalla: dónde entra el número, dónde se elige el artículo, cómo se ve la
  cuenta de cada OT, **cómo se marca que hay más de un RI pegado** y cómo se
  ofrece la descripción.
- **En qué orden se consumen varios RI pegados al mismo destino.** Para la
  aritmética **no hace falta**: la cuenta usa el total de lo que viene, y cuál
  RI cubre a cuál OT no cambia el resultado. Sólo hay que decidirlo si la
  pantalla quiere decir «tus 50 salen del RI 2231».
- **Qué pasa cuando un RI pegado se anula o se deniega.** Lo recibido ya está
  resuelto más arriba; la anulación no se habló.
- Si el repuesto de una **OT cerrada** sigue mostrando su link y su número, o
  si sólo deja de contar. Lo segundo ya está decidido; lo primero parece mejor
  —lo que se pidió no deja de haberse pedido— pero no se habló.
- **Qué pasa con un link pegado antes de que el cruce mejore.** El arreglo del
  cruce va primero, justamente para que casi no haya: un repuesto que hoy no
  reconoce artículo y mañana sí, con el link ya pegado al renglón, se queda
  donde está hasta que alguien lo vuelva a pegar. Se aceptó así; si resultara
  molesto, el camino es volver a resolverlo en cada lectura y no migrar filas.

## Lo que sólo se puede comprobar con datos reales

El cruce se mide con `scripts/medir-cruce-de-repuestos.mts`, que lee producción
y no toca nada. Daba 7 de 26 reconocidos antes del arreglo del cruce (hoy da 13); cualquier cambio al cruce se juzga
contra ese número **y contra la lista de los que deja de reconocer**, que es la
mitad que un porcentaje solo no muestra.
