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

### `sheets_fila` es lo único que evita el lazo

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

### Que la fila sirva como clave está medido

- **0 filas fuera de orden cronológico** en 3.399: la planilla se escribe
  siempre al final, nunca en el medio.
- **1.000 de 1.000 filas importadas siguen diciendo lo mismo** que el SdG
  guardó de ellas.

Si algún día alguien insertara una fila en el medio, los números se correrían y
la lectura traería duplicados. No se diseña contra eso porque no pasó nunca en
veinte meses; lo que sí hay que hacer es dejarlo escrito, y queda acá.

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
