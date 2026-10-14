# Carbonilla: la planilla manda, y Odoo pasa a controlar

Acordado el 13 de octubre de 2026. **Invierte una decisión del
[spec del 16/09](2026-09-16-calidad-stock-de-carbonilla-design.md)**, que
sacaba la planilla de stock y ponía al SdG a mandar. Lo que sigue en pie de
aquel diseño es casi todo; lo que cambia es de dónde sale el libro.

## Por qué se da vuelta

Un mes después de la importación, el SdG decía **863,27 t** y la planilla
**62,56**. Ochocientas toneladas, y la causa no era un error de cálculo:

| | |
|---|---|
| Consumos en el SdG desde el 16/09 | **cero** |
| Consumos en la planilla en el mismo período | **28 días, 925 t** (883,25 vegetal · 41,75 residual) |
| Entradas en el SdG | 33, todas de Odoo |
| Entradas en la planilla | 42 — faltan **11 camiones, 199,82 t**, del 02 al 10/10 |

El diseño de septiembre suponía que Calidad iba a cargar el consumo del día en
el SdG. No pasó: lo siguen anotando en la planilla, que es donde siempre
estuvo. Y el stock del SdG quedó sumando entradas sin restar nada.

**La lección, que es la que vale para el resto del sistema:** un diseño que
necesita que alguien cambie de costumbre para que el número sea correcto es un
diseño que va a dar el número incorrecto hasta que la costumbre cambie, y
mientras tanto nadie va a saber que está mirando algo mal. La planilla no se
saca pidiendo que dejen de usarla; se saca cuando el SdG sea mejor lugar para
cargar, y hasta entonces conviene leer de donde la gente efectivamente escribe.

## Lo que se decide

**La planilla manda sobre el libro de carbonilla entero** —entradas y salidas—,
en espejo de ida y vuelta como [Envases](../../CALIDAD-ENVASES.md). El SdG lee
las filas que no tiene y escribe las que se cargan desde la app.

**Odoo deja de ser la fuente y pasa a ser el control.** Sigue leyéndose todos
los días, pero para decir qué camión no tiene orden de compra —que es plata sin
facturar— en vez de para crear movimientos.

Con eso, Calidad queda con sus tres frentes del mismo lado: en envases y en
carbonilla manda la planilla, y en ensayos no hay planilla. Se termina la
excepción que obligaba a preguntarse en cuál de las dos mitades estaba uno
parado.

## Lo que ya se hizo (13/10/2026)

**Se borraron las 33 entradas que la sincronización con Odoo había creado**
desde el 16/09 — 603,38 t. Treinta y uno de esos camiones están también en la
planilla, así que dejarlas era contarlos dos veces en cuanto se encendiera la
lectura.

Se identificaron sin ambigüedad (`origen = 'odoo'` y `fecha >= '2026-09-16'`,
ninguna con `sheets_fila` ni con recepción), se guardaron enteras a un archivo
antes de tocarlas, y el libro volvió exacto al estado en que quedó la
importación: **1.049 movimientos, 204,24 vegetal y 55,647 residual**.

No se intentó aparearlas con las filas de la planilla: ese cruce por fecha y
cantidad es el que este módulo existe para eliminar, y ya está medido que los
dos lados difieren por decenas de kilos.

## La lectura

Una sincronización trae `Entradas  Salidas` entera y procesa **sólo las filas
que no son de ningún movimiento**. Qué filas están ocupadas sale de una
consulta: el conjunto de `sheets_fila` en uso.

La conversión no se escribe de nuevo: es **`movimientoDesdeElRenglon`**, la
misma que leyó 1.045 filas en la importación. Sabe las tres eras del libro,
sabe que un `CONSUMO VEGETAL` es un consumo con el signo dado vuelta, y sabe
que un código sin declarar se informa en vez de enlazarse al que se le parece.
Lo único que cambia es que deja de correr una vez y pasa a correr todos los
días.

### ~~`sheets_fila` es lo único que evita el lazo~~ — corregido el 14/10/2026

> **Lo que sigue en esta sección estaba mal, y se deja escrito porque el error
> es la parte que enseña.** El ancla pasó a ser el id del movimiento, escrito en
> la columna `K` de la planilla. El porqué está abajo, en "Lo que el número de
> fila no sabía hacer".

Cuando alguien carga un consumo en la app, `exportarMovimiento` escribe la fila
en la planilla y guarda el número que Google devolvió. La próxima lectura ve esa
fila ocupada y no la vuelve a crear.

**No hace falta nada más:** ni una marca de "esto lo escribió el sistema", ni
comparar contenidos, ni una ventana de fechas. Es el mismo papel que cumplía
`odoo_purchase_line_id` entre la sincronización y la recepción de Despacho.

Queda una ventana chica y conviene saberla: entre que `agregarFila` escribe y
que se guarda el `sheets_fila` pasan milisegundos en los que una sincronización
concurrente leería esa fila como nueva. El cron corre una vez por día a las
cinco de la mañana, así que no se cruzan; si alguna vez molesta, se cierra
escribiendo la fila y exportándola en la misma transacción lógica.

### ~~Que la fila sirva como clave está medido~~

- **0 filas fuera de orden cronológico** en 3.399: la planilla se escribe
  siempre al final, nunca en el medio.
- ~~**1.000 de 1.000 filas importadas siguen diciendo lo mismo** que el SdG
  guardó de ellas.~~ **Esta medición era falsa.** La consulta no usaba
  `traerTodo()`, así que PostgREST devolvió 1.000 de 1.122 y cortó sin avisar
  —exactamente la trampa que el `CLAUDE.md` documenta en su primera regla de
  base—, y el tramo que quedó afuera era justo donde estaba el problema. El
  número real: **1.092 de 1.122**, o sea **30 desalineadas**.

~~Si algún día alguien insertara una fila en el medio, los números se correrían y
la lectura traería duplicados. No se diseña contra eso porque no pasó nunca en
veinte meses; lo que sí hay que hacer es dejarlo escrito, y queda acá.~~

Pasó. Pasó antes de que yo lo escribiera, y pasó tres veces.

### Lo que el número de fila no sabía hacer

Con las 1.122 a la vista, las 30 desalineadas se explican por **dos costumbres
distintas, y las dos son normales**:

- Entre el 04 y el 08/09 se insertaron **tres filas en el medio** —un camión
  que se había olvidado, puesto en su lugar cronológico— y todo lo de abajo se
  corrió. Los desfasajes son +1, +2 y +3, uno por inserción.
- A **cinco consumos ya escritos** les cambiaron la cantidad en el lugar.

Una clave por número de fila se rompe con lo primero. Una clave por contenido se
rompe con lo segundo. No hay forma de elegir bien entre las dos: hacen falta las
dos cosas, y para tenerlas hace falta una marca que viaje con la fila.

**El ancla es el id del movimiento, en la columna `K`.** Al leer una fila y
crear su movimiento, el SdG escribe ahí el id. En la corrida siguiente esa fila
ya no es nueva porque lleva su marca, esté en el número que esté, y
`sheets_fila` pasa a ser lo que de verdad es —dónde está hoy— y se refresca en
cada corrida en vez de ser una promesa que se rompe.

El guard de contenido **no se va, cambia de significado**: ya no decide si es la
misma fila, sino que avisa que a una fila conocida le cambiaron el número. Es un
aviso y no una adivinanza.

Lo que trae de nuevo, y por eso se informa en vez de resolverse solo:

- **Copiar y pegar una fila duplica su id.** Las dos filas van a la bandeja y no
  se toca ninguna mientras estén en disputa.
- **Borrar un movimiento del SdG deja el id huérfano** en la planilla. Esa fila
  no se relee —volvería a entrar con otro id y el camión quedaría dos veces— y
  se informa con el texto de qué hacer: borrar la celda `K`.

Y dos del otro lado del alambre, que aparecieron recién al ejercitar la
escritura de verdad y no al razonar sobre ella.

**La columna `K` no existía**, no es que estuviera vacía. La pestaña tenía 10
columnas de verdad, y escribir afuera de la grilla hace que Google rechace el
`batchUpdate` entero con `exceeds grid limits`. La agregó una persona, y es un
paso que hay que repetir si alguna vez se rehace el libro.

**Y la mitad escritora del espejo nunca había escrito nada.** La pestaña entera
está protegida con el rango `ACTUALIZACIÓN DE STOCK`, sin rangos liberados, y la
cuenta de servicio no está entre sus editores: tiene permiso de edición sobre el
documento, que es lo que la protección pisa. Escribir un vacío en la `J` —una
columna que el espejo usa desde el 16/09— da el mismo `protected cell or object`
que la `K`.

Lo que lo escondió durante un mes es que **nadie cargó todavía un movimiento
desde la app**: los 1.128 entraron por el script de importación, por el cron de
Odoo o por la lectura de la planilla, y ninguno de esos tres escribe. Por eso
`sheets_pendiente` está en 0 en las 1.128 filas, que leído de apuro parece
"ninguna escritura falló" y en realidad es "ninguna escritura ocurrió". El
primer consumo cargado a mano habría fallado, con su aviso, y recién ahí se
habría visto.

Es exactamente la lección de ejercitar la operación final en vez de leer el
modelo: el diseño decía "acá el SdG también escribe" y el permiso para hacerlo
nunca existió.

El escritor también cambia: `filaDeLaPlanilla` devuelve **once** celdas y no
diez. Una fila que el SdG agrega sin su marca la vuelve a importar la lectura
siguiente, y el consumo entra dos veces.

### Tres decisiones más

- **La ventana es la planilla entera, no los últimos N días.** Son 3.399 filas y
  una sola lectura. Filtrar por fecha agregaría un corte que `sheets_fila` ya
  resuelve mejor, y además así se ve si alguien corrigió una fila vieja.
- **`CALIDAD_DESDE` se borra.** Existía para que el cron de Odoo no pisara lo
  importado. Con la planilla como fuente, una fila ocupada es una fila ocupada.
  Una variable de entorno que ya no defiende nada es una trampa para el próximo
  que la lea.
- **Lo que no se puede convertir va a la bandeja con su número de fila**, no se
  saltea en silencio. Hoy serían cero —la importación terminó con 0 sin
  importar— pero el día que aparezca un código nuevo en la planilla, ese camión
  no entra y tiene que verse.

### El espejo sigue escribiendo las diez columnas

Saldos incluidos, aunque ahora la planilla mande. Suena contradictorio y la
razón es la de siempre: **la fórmula de la planilla no sabe representar un
ajuste en más** —es lo que obligó a pisar una celda a mano el 02/05/2026— así
que si el SdG escribe un ajuste y deja que la planilla lo calcule, lo calcula
mal.

## Odoo como control

La sincronización sigue corriendo y sigue leyendo las mismas líneas de orden de
compra. `movimientoDesdeLaLineaDeOdoo` y la lista blanca de productos **no se
tiran**: siguen siendo lo que decide qué línea de Odoo es un camión de
carbonilla y cuál es un flete. Lo que cambia es qué se hace con el resultado.

| Desvío | Qué significa | Hoy |
|---|---|---|
| **Camión en la planilla sin orden en Odoo** | **No se le puede facturar** | 11 camiones, 199,82 t |
| Orden en Odoo sin camión en la planilla | Se cargó una compra que no llegó al libro | — |
| Mismo camión, cantidad distinta | Lo medido: 60 de 575 en el año | — |

**La conciliación se calcula, no se guarda.** Es una vista, no un estado: se
arma al abrir la pantalla de control, cruzando el libro contra Odoo. Guardarla
sería el error que este repo ya tiene escrito — un derivado guardado se
desincroniza y nada avisa. El cruce ya existe, además: es el que el script de
importación hace al final de cada corrida.

El cron entonces no inserta nada: **cuenta los desvíos y los deja en
`sincronizaciones`**, donde ya guarda su marca. Así la tarjeta del tablero puede
decir *"11 camiones sin orden de compra"* sin llamar a Odoo.

## La bandeja cambia de dueño

`calidad_odoo_sin_reconocer` guardaba líneas de Odoo que no se pudieron
convertir en movimiento. Con Odoo sin crear nada, eso deja de existir.

Lo que sí hay que ver ahora son **filas de la planilla** que no se pudieron
convertir, y ésas se identifican por número de fila. Va una tabla nueva
—`calidad_planilla_sin_reconocer`, con la fila como clave— y **la vieja se borra
en la misma migración**. Tiene 0 filas, y dejar una tabla muerta con un nombre
que suena vigente es de las trampas que más caro salen de encontrar meses
después.

## La recepción de Despacho tiene que exportar

Cuando se cierra una recepción, `anotarLaRecepcionEnElStock` crea un movimiento
con `origen = 'recepcion'` y **sin `sheets_fila`**. Con la planilla mandando,
ese mismo camión va a entrar otra vez en cuanto alguien lo anote allá.

Así que la recepción tiene que **exportar a la planilla en el mismo paso** y
quedarse con el número de fila, que es exactamente lo que `exportarMovimiento`
ya hace. Es poco código, y sin eso el circuito que se cerró en septiembre
empieza a duplicar en silencio.

## Qué se testea

Vitest sobre funciones puras, como siempre:

- `filasPorLeer(ocupadas, filasDeLaPlanilla)`: cuáles filas hay que procesar.
  Incluido el caso que importa: una fila cuyo `sheets_fila` ya existe **no se
  vuelve a leer**, que es lo único que evita el lazo.
- `desviosContraOdoo(libro, lineasDeOdoo)`: los tres desvíos, con los casos
  reales — un camión sin orden, una orden sin camión, y la diferencia de
  decenas de kilos que ya sabemos que existe en 60 de 575.
- `movimientoDesdeElRenglon` ya tiene sus 14 tests y no se toca.

## La migración

Un archivo: crear `calidad_planilla_sin_reconocer` con sus índices y RLS
—calcadas de las que ya tiene el módulo— y borrar
`calidad_odoo_sin_reconocer`, que queda sin uso.

No hace falta tocar `calidad_movimientos`: `sheets_fila` ya existe y ya tiene
los 1.047 valores de la importación.

## Lo que falta de una persona

- **Correr la migración**, como siempre.
- **Borrar `CALIDAD_DESDE` de Vercel** cuando esto esté desplegado.
- **Los 11 camiones del 02 al 10/10 en Odoo.** El stock los va a tener apenas
  corra la lectura, porque están en la planilla; lo que sigue faltando es la
  orden de compra, y sin ella no se les puede facturar.
- **El conteo físico**, que sigue pendiente desde septiembre: el saldo arranca
  de los 204,24 y 55,647 que se igualaron a la planilla el 16/09, y ése es un
  número heredado, no uno medido.

## Riesgos asumidos

- **El SdG deja de ser la fuente de su propio stock.** Si alguien edita la
  planilla a mano y se equivoca, el SdG lo copia. Es el mismo riesgo que
  Envases, Compras, Mantenimiento e Inventario ya tienen; la diferencia es que
  acá lo estábamos evitando a propósito y ahora no.
- **Una fila insertada en el medio de la planilla duplicaría todo lo que viene
  después.** No pasó en 3.399 filas, y por eso no se diseña contra eso — pero
  si alguna vez el libro se reordena, hay que mirar esto primero.
- **La planilla no cierra consigo misma.** Su `TOTAL` no es la suma de sus dos
  columnas por tipo: el 16/09 difería en 45 kg. El SdG va a leer las
  cantidades, que son el dato, y a despejar su propio saldo — así que los dos
  números pueden no coincidir exactamente, y el del SdG es el que cierra.
- **Esto es "por ahora".** El día que Calidad cargue en el SdG, la dirección se
  da vuelta de nuevo. Lo que lo hace barato es que las dos mitades ya existen:
  el espejo escribe y la lectura lee, y apagar la lectura es sacar un cron.
