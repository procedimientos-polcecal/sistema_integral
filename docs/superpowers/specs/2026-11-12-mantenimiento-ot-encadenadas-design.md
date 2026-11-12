# Mantenimiento — OT encadenadas: una orden que nace del cierre de otra

**Fecha:** 12/11/2026
**Estado:** diseño acordado, sin empezar
**Primer caso:** el ciclo de martillos de las rompedoras y molinos

---

## Qué es esto

Una OT que al cerrarse genera la siguiente. Una **madre** arranca el ciclo; de
su cierre nace una **hija** con otra tarea, que se repite **x** veces; después
de la última hija, lo que nace es la madre de nuevo y el ciclo vuelve a empezar.

Siempre hay **una sola OT viva** del ciclo. La siguiente nace recién cuando se
cierra la anterior, así que nunca se acumulan y un ciclo parado se queda quieto
en vez de llenar el listado.

El primer caso —y el único que se carga en esta tanda— es el de los martillos:

> **Cambio de martillos** (madre) → **Rotación de martillos** × 3 (hijas) →
> Cambio de martillos → …

---

## Por qué, con lo que se midió

**Esto ya lo hacen a mano, y hace mucho.** Medido el 12/11/2026 contra
producción: **266 OT** tienen «martillo» en la descripción, 248 de ellas en los
cuatro equipos de este ciclo. La historia más larga, la del molino de
Hidratación, lleva **24 ciclos completos** de cambio a cambio.

**Y el ciclo que describe el usuario es el que muestran los datos.** 63 de esas
OT nombran la cara del martillo en el texto libre, y aparecen **la 2ª, la 3ª y
la 4ª — nunca la 1ª y nunca una 5ª**. Eso es exactamente un juego que entra
nuevo en 1ª cara, se rota tres veces y se cambia. La mediana medida de
rotaciones por ciclo da 3 en tres de los cuatro equipos.

Esa coincidencia entre lo que dice la gente y lo que dicen los datos es lo que
hace que este diseño no descanse sobre una conjetura.

**Lo que no se automatiza, no pasa.** Es la misma lección que dejó el
preventivo: había pantalla y botón para generar la orden de un mantenimiento
programado, y **nadie lo apretó nunca** —1 programado, vencido desde el
8/8/2026, cero OT nacidas de él en toda la historia—. Por eso esto vive en el
cron y no en un botón.

---

## Lo que el usuario decidió, como lo decidió

Estas son suyas y no mías. Van textuales donde importa.

**Los números, equipo por equipo.** Le propuse los que salían de la historia y
los corrigió a mano:

| Equipo | Sector | Rotar cada | Rotaciones antes del cambio |
|---|---|---|---|
| PO-C1-04 Molino a martillos | Hidratación | **3 días** | 3 |
| PY-B1-06 Molino a martillos | Planta filler 2 | **6 días** | 3 |
| PY-A1-05 Rompedora a martillos | Planta filler 1 | **6 días** | 3 |
| PY-C1-03 Molino a martillos | Planta 0-2 mm | **10 días** | 3 |

Lo que la corrección reveló: **x es 3 en los cuatro**. Eso ya no es un
parámetro por equipo sino una propiedad del martillo —cuatro caras—, y lo único
que varía de verdad es cada cuántos días, que es cuánto le pega a cada máquina
lo que muele. La tabla igual lo guarda por ciclo, porque el segundo caso que
aparezca no tiene por qué tener cuatro caras.

**Filler 3 queda afuera.** PY-D1-03 (Rompedora a martillos, Planta filler 3)
hace el mismo ciclo y tiene 10 OT de martillos; se lo ofrecí y lo sacó de la
tabla. No se carga.

**El disparador son los días que pasaron**, no las horas de marcha ni la
producción. Preguntado explícitamente: «Los días que pasaron».

**El ciclo no se reconoce por el texto.** Se lo planteé como el riesgo —hoy esas
OT las tipea una persona en el formulario, y la historia tiene «Cambio de
martillos», «Se cambian martillos», «Cambio de 20 grillas y cambio de
martillos», «Se colocan martillos nuevos»— y la respuesta fue que el problema
desaparece porque **la OT la va a crear el sistema**: «Siempre se va a llamar
"Cambio de martillos", una vez que quede acomodada la automatización».

Eso es lo que permite la decisión más importante del diseño: **el enlace entre
una OT y la siguiente es el id, nunca el texto.** Ninguna parte de este
mecanismo lee una descripción para decidir algo.

**El anti-objetivo, textual.** Preguntado qué lo haría dejar de confiar en esto
y volver a manejarlo a mano:

> «Que genere OT sobre martillos que ya se cambiaron»

Todo lo que sigue en «Las tres capas» existe por esa frase.

---

## Objetivos

- Que la OT siguiente del ciclo **exista sola** en el listado, con su fecha, sin
  que nadie se acuerde de crearla.
- Que la orden diga **en qué cara va** el martillo, que es dato que hoy se
  escribe a mano en 63 de 248 OT y que el sistema conoce sin esfuerzo.
- Que un segundo caso de ciclo encadenado cueste **una fila, no código**.

## No objetivos

- **Periodicidad por horas de marcha.** Ya estaba afuera del alcance anterior y
  sigue: `equipos.horas_marcha` está en cero en los 269 equipos.
- **Filler 3.** Decisión del usuario, arriba.
- **Un grafo de tareas arbitrario.** El ciclo es madre → hija × n → madre. Una
  cadena con ramas, condiciones o tres tareas distintas no entra acá.
- **Tocar las 248 OT históricas.** No se reconstruye nada hacia atrás.

## Anti-objetivos

Lo que haría fracasar esto aunque funcione:

1. **Generar una OT sobre martillos que ya se cambiaron.** El del usuario.
2. **Que un ciclo se pare sin que nadie se entere.** Es el modo de falla que
   este módulo pasó tres semanas arreglando en otras formas.
3. **Que la automatización empiece a decidir por el texto libre.** Un día
   alguien escribe distinto y el ciclo arranca cuando no debía, o no arranca
   cuando debía, sin ruido.

---

## Las tres capas contra el anti-objetivo

El botón solo no alcanza, **porque depende de que alguien se acuerde de
apretarlo**. Van las tres, de menos a más confiable:

### 1. El botón «Se cambiaron los martillos»

En la ficha del equipo. Reinicia el ciclo al día de hoy. Un clic, sin leer el
texto de ninguna descripción. Acordado con el usuario («Va así»).

Qué hace, exactamente:

- Pone `desde` = hoy y `vuelta_desde` = 0 (los martillos acaban de cambiarse).
- Si la OT viva del ciclo es una **hija**, queda **SUSPENDIDA** y se le saca el
  `ciclo_id`, con una nota automática que dice por qué. *(Decisión mía.)* Si se
  la dejara viva sería literalmente el anti-objetivo: una orden abierta que
  manda a rotar un juego nuevo.
- Si la OT viva es la **madre**, el botón **no la toca y lo explica**: «esta
  orden es justamente el cambio — cerrala y el ciclo arranca solo».
  *(Decisión mía.)* Es el momento más probable para apretarlo —el trabajo se
  hizo y la planilla todavía no se cerró— y en ese caso suspender estaría mal:
  el trabajo existió. Cerrarla desde un botón tampoco: sería el sistema
  registrando trabajo ajeno, escribiendo REALIZADO y la fecha de cierre en las
  columnas M y K del master por un camino que no es el de cerrar una OT.

### 2. El sistema pregunta cuando sospecha

Si se cierra una OT de un equipo con ciclo activo, su descripción habla de
cambiar martillos, y **no es la OT que el ciclo generó**, sale un aviso:
«Puede que se hayan cambiado los martillos de X sin avisar al ciclo».

Acá sí se mira el texto — y es la única parte que lo hace. La diferencia es que
**el texto nunca decide: sólo pregunta.** Un falso positivo cuesta una pregunta;
uno que no detecta deja todo como estaba. Eso es distinto de colgar el ciclo del
texto, que es lo que el usuario quería evitar.

**Se mira sólo lo cerrado después de `desde`, y eso no es un detalle de
rendimiento: es lo único que hace que este aviso se apague solo.** Sin ese
corte, el aviso cuenta un hecho histórico que nunca cambia, y eso en este
sistema termina de una de dos formas, las dos malas: `filtrarDescartadas` sólo
vuelve a mostrar un aviso cuando su cantidad **crece**, así que un conteo que
nunca baja es un globo permanente, y descartarlo una vez lo silencia para
siempre. Medido el 12/11/2026 sobre los cuatro equipos: las 250 OT de martillos
están **todas** en REALIZADO, y un regex deliberadamente angosto toca **56** de
ellas. O sea que sin corte el día uno este aviso sale con 56, por la campana y
por el push, para todo el que vea Mantenimiento.

Con el corte, en cambio: un ciclo sin arrancar (`desde` en null) no sospecha
nada, y cada vez que el ciclo avanza —una OT suya que se cierra, o el botón—
`desde` se mueve y lo viejo cae solo. El conteo real queda en 0 ó 1.

**Un aviso por ciclo, con id propio**, como ya hacen `avisosDeRitmo` y
`avisosDeSalud`: así el texto puede nombrar el equipo y el enlace puede ir a su
ficha, que es donde está el botón que lo resuelve. Un aviso único con un número
no tendría a dónde mandar a nadie — la configuración vive en cada ficha y no hay
pantalla de ciclos.

Los ids son nuevos (`mant-ciclo-sospechoso-<equipo>`): la cantidad de un aviso se
compara contra la foto del día anterior, y un id reusado con otro conteo saca una
novedad falsa el día del cambio.

### 3. La OT dice en qué se basa

La que de verdad protege, y la que no cuesta nada. La descripción generada
lleva la fecha del último cambio:

> **Rotación de martillos — a 3ª cara. Martillos cambiados el 23/10/2026.**

Si los cambiaron el 05/11, el que abre la orden lo ve en el acto, sin tener que
confiar en el estado interno de nada. **Una orden que dice lo que el sistema
cree es una orden que se puede desmentir** — y la desmiente la persona que está
parada frente a la máquina, que es la única que sabe.

La cara sale del contador: rotación n → cara n+1. Las tres rotaciones dan 2ª, 3ª
y 4ª, que es exactamente lo que dicen las 63 OT que la nombran.

---

## Cómo funciona

### Esto vive en el cron, no en el botón de cerrar

**Las OT se cierran en la planilla.** De las 248 medidas, **225 ni siquiera
nacieron en el sistema** (`app_created = false`): entraron por el formulario y
se cierran escribiendo en la columna ESTADO del master. Un enganche en la ruta
PATCH vería una minoría de los cierres.

Así que esto no es un hook de evento sino una **reconciliación**: después de
cada sincronización, el cron mira qué ciclos tienen su OT cerrada y todavía no
tienen la siguiente, y la crea. Es la misma forma que `generarLasPeriodicas` y
es la única que ve los cierres que entran por la planilla.

Entra como una entrada más de `SINCRONIZACIONES` en `lib/mantenimiento/sincronizar.ts`,
**después de `ordenes`** y por el mismo motivo que las periódicas: una OT recién
creada todavía no está en el master —su fila llega por `IMPORTRANGE`—, así que
no tiene sentido crearla y leer la planilla sin eso adentro en la misma corrida.

### La idempotencia la da el dato, no el reloj

El cron de Mantenimiento **no es diario**: `vercel.json` lo agenda 06:00 UTC
pero el reloj real es Actions, que declara cada 15 minutos y corre cada 3 a 5
horas. Esto puede correr diez veces por día.

Lo que lo hace idempotente es que el estado del ciclo **se deriva de las OT
mismas**: la OT actual del ciclo es la última con ese `ciclo_id`. Si está
abierta, no se hace nada. Si está cerrada y no hay otra más nueva, se crea la
siguiente. Correr dos veces seguidas no genera dos órdenes, porque la primera
corrida deja una OT abierta que la segunda ve.

**Una sola fuente de verdad.** No hay un «puntero a la OT actual» en la tabla
del ciclo que pueda desincronizarse del dato real.

### La máquina de estados, y el corte que la hace funcionar

El ciclo guarda **dos campos y nada más de estado**:

- `desde` — la fecha del último trabajo del ciclo que ya está hecho.
- `vuelta_desde` — qué vuelta era ése: 0 = la madre, n = la hija nº n.

Y cada OT suya guarda su `ciclo_vuelta`: **0 = madre, 1..n = hija nº n**.

**Las OT del ciclo que cuentan son las creadas en `desde` o después.** Ése es el
corte, y es lo único que hace que esto no se rompa. Sin él, el botón de reinicio
no alcanza: la primera versión de este diseño decía «la OT actual es la última
con ese `ciclo_id`» y que el reinicio suspendía la hija que esperaba — pero
entonces la última con `ciclo_id` pasaba a ser la **hija anterior, ya cerrada**,
y la corrida siguiente volvía a crear exactamente la orden recién suspendida,
fechada sobre un cierre viejo (o sea, nacida atrasada), sobre martillos recién
cambiados. El anti-objetivo, palabra por palabra, producido por el mecanismo que
existía para evitarlo.

Con el corte, el reinicio no necesita tocar nada más: mover `desde` a hoy deja
afuera todo lo anterior de una sola vez.

| La última OT del ciclo **en `desde` o después** | Qué se crea | Con qué fecha | Vuelta |
|---|---|---|---|
| no hay ninguna, y `vuelta_desde` < `repeticiones` | la hija `vuelta_desde`+1 | `desde` + `periodo_dias` | `vuelta_desde`+1 |
| no hay ninguna, y `vuelta_desde` = `repeticiones` | **la madre** | `desde` + `periodo_dias` | 0 |
| hija n < `repeticiones`, cerrada | la hija n+1 | cierre + `periodo_dias` | n+1 |
| hija n = `repeticiones`, cerrada | **la madre** | cierre + `periodo_dias` | 0 |
| madre, cerrada | — | — | — |
| cualquiera, abierta | nada | — | — |
| cualquiera, SUSPENDIDA | **nada, y se informa** | — | — |

`periodo_dias` es el de la **tarea hija** (`mant_tareas_preventivas`), y es el
mismo tanto para una rotación como para el cambio que viene después de la
última: el ritmo lo marca el desgaste de la cara, no qué se le hace al final.
Si el día de mañana el cambio necesitara el suyo, sale del `periodo_dias` de la
tarea madre sin tocar este diseño.

**La madre cerrada no genera nada por sí misma: lo que hace es mover el corte.**
Al cerrarse, `desde` ← su `fecha_cierre` y `vuelta_desde` ← 0, y con eso ella
misma queda afuera del rango y la corrida siguiente cae en la primera fila de la
tabla. Es la misma regla, no una excepción: por eso `desde` es la fecha en que
los martillos se cambiaron **de verdad** y no en que se pidió cambiarlos.

Igual que la madre, cada hija que se cierra mueve `desde` y `vuelta_desde` a lo
suyo. Así el par siempre describe el último trabajo hecho, venga de donde venga
—de una OT cerrada, del botón, o de la carga inicial— y la tabla de arriba es
una sola regla con tres entradas, no tres mecanismos.

**Cerrada quiere decir REALIZADO con `fecha_cierre`.** Si está REALIZADO sin
fecha de cierre —pasa: 168 de 986 REALIZADO históricas no la tienen— se usa la
fecha de ejecución, y si tampoco está, el ciclo se informa como trabado en vez
de inventar una fecha.

**Una OT del ciclo en SUSPENDIDA detiene el ciclo y se dice.** No se adivina si
había que seguir o no. Un ciclo detenido que lo informa es aceptable; uno que
genera a partir de una orden suspendida, no.

### Un ciclo parado ya está cubierto

Si nadie cierra la OT, el ciclo espera —es lo acordado— y esa orden se vuelve
ATRASADO sola, así que entra en el aviso `mant-atrasadas` que ya existe y ya
sale por la campana y por el push. **No se agrega un aviso nuevo para eso**: ya
hay quien lo diga, y un aviso de más es cómo se termina con los 13 descartados
de siempre.

Lo que sí va: la corrida informa los ciclos trabados en su resultado, igual que
`periodicas` informa los `incompletos`.

### Cómo nace la orden

Exactamente por donde nacen las periódicas, componiendo las mismas cinco reglas
que ya viven en `lib/` (`loQueFaltaParaCrear`, `altaEnLaPlanilla`,
`estadoSegunElCierre`, `celdasParaRegistrar`, `elPendienteDelIntento`), más
`alNacerLaOT` para el calendario. No se duplica el alta de la ruta.

Lo que **no** se puede olvidar, porque ya mordió dos veces en este módulo:
después del insert hay que escribir la columna **M (ESTADO)** del master aparte
y, si falla —y falla casi siempre, porque la fila del master llega por
`IMPORTRANGE` segundos después—, anotar el `sheets_pendiente`. Esa marca es lo
único que encola el reintento **y** lo que evita que la importación siguiente
pise el estado con la celda vacía.

### Qué dice la OT generada

Medido sobre las 248 OT de martillos de estos cuatro equipos. Tres campos
salieron unánimes, así que no hay nada que elegir:

| Campo | Valor | Por qué |
|---|---|---|
| `especialidad` | **MECÁNICO** | 248 de 248 |
| `quien` | **INTERNO** | 248 de 248 |
| `contratista` | vacío | 248 de 248 |
| `prioridad` | vacío | 222 de 248 lo están; un preventivo no tiene de dónde sacar urgencia |
| `tipo` | **PROGRAMADO** | *Decisión mía*: hoy están 146 CORRECTIVO contra 102 PROGRAMADO, pero las correctivas son las roturas. Una rotación programada con días de anticipación es programada por definición |
| operarios | ninguno | el trabajo se reparte parejo entre Piparo, López, Mendizabal, Aguirre y Echeverría (107/104/98/95/77): poner uno sería inventar |
| `horas` | lo que diga el ciclo, o vacío | la mediana histórica es 2 h (n=210), pero es un dato que se carga al cerrar |
| equipo y sector | los del equipo del ciclo | |
| `app_created` | `true`, con `created_at_app` | es lo que la protege del borrado de espejo mientras su fila no llegó al master |

La fila de la planilla la firma **«SdG (automático)»**, igual que las
periódicas: poner ahí a una persona que no pidió nada sería peor que decir la
verdad.

---

## El vecino, y por qué cambia el modelo

**Esto no nace en terreno vacío, y eso se descubrió al ponerse a construir.** El
mismo día 12/11/2026, otra sesión dejó en `main` el **catálogo de tareas
preventivas**: `lib/mantenimiento/tareasPreventivas.ts`, su pantalla, y la tabla
`mant_tareas_preventivas` —**ya aplicada en producción y vacía**—. Una fila suya
es una tarea decidida por una persona: `(equipment_id, accion, componente)`
único, más `nombre` y `periodo_dias`.

Su encabezado nombra este caso por su nombre:

> «Rotación de martillos» se hace en seis equipos con ritmos distintos —cada ~4
> días en PO-C1-04 y cada ~22 en PY-C1-03—, así que un plan es por máquina.

O sea que **«Rotación de Martillos en PO-C1-04 cada 3 días» es una fila de esa
tabla**, no un campo de texto de la mía. Y «Cambio de Martillos» es otra.
Medido: el componente `Martillos` existe en `equipos_componentes` para los
cuatro equipos del ciclo, así que la clave natural de esa tabla cierra sin
inventar nada.

**La primera versión de este documento guardaba los dos nombres como texto
libre en la tabla del ciclo. Eso se cambia.** Dos razones, y la segunda es la
grave:

1. Dos lugares nombrando el mismo trabajo derivan, y «cada 3 días» escrito dos
   veces se contradice en cuanto alguien corrija uno.
2. **El catálogo existe para generar OT** —es su frase: «lo que no existe es el
   catálogo que permitiría generarlo en vez de escribirlo»—. El día que alguien
   lo enganche al generador, «Rotación de martillos» en esos cuatro equipos se
   generaría **dos veces**: una por su plan y otra por este ciclo, en la
   planilla que mira la planta. Con la referencia, quien escriba ese enganche
   contesta «¿esta tarea la maneja un ciclo?» con un join. Sin ella, tendría que
   cruzarlas por texto, que es justo lo que los dos diseños prohíben.

Así que **el ciclo apunta a dos filas de `mant_tareas_preventivas`** y no copia
sus nombres ni sus períodos. El `periodo_dias` de la tarea hija **es** el «cada
cuántos días»: no hay un segundo campo que lo repita.

Lo que esto cuesta: las ocho filas (4 equipos × {ROTACION, CAMBIO} sobre
`Martillos`) tienen que existir antes de que el ciclo exista. Las siembra esta
migración, con el motivo escrito, porque **la decisión ya está tomada**: el
usuario confirmó los cuatro ciclos y sus ritmos por escrito, y eso es exactamente
lo que esa tabla guarda. No es el sistema decidiendo por nadie.

Dependencia en una sola dirección: esto **referencia** su tabla y no toca su
`lib/` ni su pantalla.

## Los datos

### Tabla nueva: `mant_ciclos_de_ot`

Un ciclo por equipo. Configuración y nada de estado derivable.

| Columna | Para qué |
|---|---|
| `id` | |
| `equipment_id` | el equipo, → `equipos` |
| `tarea_madre_id` | → `mant_tareas_preventivas`, la acción CAMBIO |
| `tarea_hija_id` | → `mant_tareas_preventivas`, la acción ROTACION |
| `repeticiones` | 3 — es del ciclo, no de la tarea |
| `especialidad` | MECÁNICO |
| `horas_estimadas` | nullable |
| `desde` | la fecha del último trabajo **hecho** del ciclo |
| `vuelta_desde` | qué vuelta era ése: 0 = madre, n = hija nº n |
| `activo` | |
| `creado_en`, `creado_por` | |

El par `desde` / `vuelta_desde` es **todo** el estado, y lo escriben las tres
puntas por igual: una OT del ciclo que se cierra, el botón de reinicio, y la
carga inicial. Que las tres usen los mismos dos campos es lo que evita tener
tres mecanismos que se contradigan — que fue el error que el revisor encontró en
la primera versión.

La leyenda de la cara («a 2ª cara») **no se configura**: sale de la vuelta. Si
un segundo caso no tuviera caras, se resuelve cuando exista, no antes.

RLS envuelta: `using ((select mant_puede_ver()))`, y la de escritura contra
`mant_puede_editar()` o la que corresponda. **Envuelta**, no pelada: una policy
pelada no rompe nada y no avisa, sólo hace que la tabla cueste proporcional a
sus filas.

### Dos columnas en `ordenes_trabajo`

- `ciclo_id uuid references mant_ciclos_de_ot(id) on delete set null`
- `ciclo_vuelta smallint` — 0 = madre, 1..n = hija

`on delete set null` y no cascade: borrar la configuración de un ciclo no puede
llevarse las órdenes de trabajo que ya existieron.

**Cuidado con el tipo de TypeScript.** Agregar un campo a `OrdenLeida` que no
sea columna de la tabla fue lo que dejó la importación de OT en cero durante
diecinueve horas el 29/10/2026 — PostgREST corta el lote entero con «Could not
find the column». Acá es al revés (columnas nuevas, el tipo que las ignora), que
es seguro; pero el día que haya que leerlas, van por `paraLaBase()`.

### La semilla

Dos cosas, y se distinguen porque una está decidida y la otra no.

**Lo que sí se siembra: las ocho tareas y los cuatro ciclos.** Las ocho filas de
`mant_tareas_preventivas` (4 equipos × {ROTACION, CAMBIO} sobre `Martillos`,
con el `periodo_dias` de cada equipo) y los cuatro ciclos que las enlazan, con
`repeticiones` = 3. Eso el usuario lo confirmó por escrito, número por número, y
es exactamente lo que esas tablas guardan.

### El punto de arranque, en cambio, no puede salir de la historia

`desde` y `vuelta_desde` van en **null**, y **lo confirma una persona**, equipo
por equipo.

El motivo no es prudencia genérica: se intentó deducirlo y no da. Contando las
rotaciones cerradas posteriores al último cambio de cada equipo, dos de los
cuatro dan **6 rotaciones de un ciclo de 3**, porque el texto libre mezcla
rotaciones con revisiones («Revisión de rompedora y ver si es necesario rotar
martillos») y con trabajos que sólo nombran los martillos de paso. La cara que
el texto nombra sí es confiable y directa —en Filler 2 la OT 3067 del 11/11 dice
«a 4ta cara»—, pero no todas las OT la nombran. Arrancar cuatro ciclos sobre esa
mezcla es exactamente el anti-objetivo.

**Y un ciclo sin arrancar no se nota solo.** No genera OT, así que `mant-atrasadas`
—que es lo que cubre un ciclo *parado*— no puede verlo: no hay ninguna orden que
se atrase. Si los cuatro quedan esperando, la función se despliega inerte y
nada lo anuncia, que es la forma de fallar que este módulo ya pagó con la
bandeja de carbonilla. Las defensas, en orden:

1. **Lo primero es no necesitarlas**: conseguir los cuatro puntos de arranque
   antes de desplegar, y sembrarlos con la migración. Es una conversación de
   cinco minutos contra una función que puede quedar dormida.
2. Si alguno queda en null igual, se informa en cada corrida —como los
   `incompletos` de las periódicas— y la ficha del equipo lo dice con todas las
   letras y ofrece cargarlo.

---

## La pantalla

En la ficha del equipo (`/mantenimiento/equipos/[id]`), una sección **«Ciclo de
órdenes»**. Es donde tiene que estar el botón de reinicio, así que poner también
la configuración ahí evita una segunda pantalla para cuatro filas.

Tiene que mostrar, sin que haya que deducirlo:

- la configuración (tarea madre, tarea hija, cada cuántos días, cuántas
  repeticiones);
- **en qué vuelta va y de cuántas**, y desde cuándo;
- **cuál es la OT viva** del ciclo, enlazada;
- el botón **«Se cambiaron los martillos»**, que pide confirmación porque
  suspende la orden que esté esperando.

Si el ciclo está esperando su `desde`, lo dice con todas las letras y ofrece
cargarlo. Un ciclo activo que no hace nada y no explica por qué es
indistinguible de uno roto.

El layout queda a quien lo construya, dentro de lo que ya manda el repo: `<Select>`
y no `<select>`, `grid-cols-1 sm:grid-cols-3` y no `grid-cols-3`, y el ancho de
un campo en un `div` que lo envuelva y nunca en el `className` del `.input`.

---

## Restricciones

- **Las migraciones las corre una persona**, a mano, en el editor SQL de
  Supabase. Un agente escribe el archivo y queda a la espera; el DML sí puede ir
  por PostgREST.
- **Escribir en la planilla es escribir en producción.** Leerla desde local está
  bien; escribirla no se prueba a mano.
- **El cron corre cada 3 a 5 horas**, no cada 15 minutos como declara.
- **PostgREST corta en 1000 filas y no avisa.** Son cuatro ciclos hoy, pero las
  OT que se leen para resolver el estado no: va `traerTodo()`.
- **Una planilla que está calculando no se lee ni se escribe.** `leerValores()`
  corta solo; quien arme su propia lectura usa `estaCalculando()`.
- **Toda ruta que toque un campo que se exporta tiene que exportar**, o dejar el
  pendiente anotado. El botón de reinicio cambia un estado a SUSPENDIDA, así que
  exporta o encola — y se declara en `scripts/revisar-exportaciones.mjs`, que si
  no sale ROMPE.
- **Esto se corta de `main`, no de la rama donde se escribió este documento.**
  Parte de lo que hay que componer vive sólo allá: `lib/agenda/alNacerLaOT.ts`,
  la versión de `generarPeriodicas.ts` que lo llama, y el registro de salud de
  `sincronizaciones` donde hay que declarar un `recurso` nuevo.

---

## Lo que queda a criterio de quien construya

- El layout exacto de la sección de la ficha, y si el listado de OT muestra algo
  del ciclo (por ejemplo la vuelta) o no.
- Los nombres finales de columnas y del archivo de migración.
- Cómo se arma el regex de la capa 2. Lo único que no es negociable es que **no
  decida**: que de ahí salga un aviso y nunca un reinicio.
- Si la configuración de un ciclo se puede editar desde la ficha o sólo
  sembrarse. Cuatro filas no justifican un ABM completo, pero `desde` y `activo`
  sí tienen que poder tocarse.
- Si vale la pena un test que fije que las tres rotaciones dan 2ª, 3ª y 4ª cara.
  (Diría que sí: es la única parte del diseño que la historia confirma número por
  número, y es barata de romper sin darse cuenta.)

---

## Lo que esto no resuelve y conviene saber

**La OT de la madre la sigue cerrando una persona**, y el ciclo depende de ese
cierre. Si en la planta cambian los martillos y nadie cierra la orden, el ciclo
espera. Para eso están la capa 2 y el aviso de atrasadas, pero ninguna de las
dos es un cierre automático y no se pretende que lo sean.

**El primer ciclo de cada equipo arranca con una fecha que alguien tipea.** Es
el único dato del mecanismo que no sale de otro dato, y es por diseño: cuatro
fechas una sola vez es más barato y más honesto que deducirlas de 248
descripciones en texto libre.
