# Cancelar una OT

**13/11/2026**

## Qué es y por qué

Hoy una orden de trabajo sólo sabe terminar de una manera: haciéndose. El
vocabulario tiene cinco palabras —`REALIZADO`, `EN_PROCESO`, `ATRASADO`,
`POR_HACER`, `SUSPENDIDA`— y ninguna es el lugar de la orden que **no se va a
hacer nunca**: el equipo se dio de baja, el trabajo lo absorbió otra OT, se
decidió que no va.

Sin ese lugar, esa orden queda abierta para siempre. Y «abierta para siempre»
no es neutro en este sistema: cuenta como atrasada en `estaAtrasada`, se trepa
al tope del tablero GUT con el +1000 de `gut_orden`, y entra en el aviso de la
campana y en el push de las 8:30. La OT abierta más vieja es del 11/12/2025.

La segunda mitad del pedido es la que le da sentido a la primera: **cancelar
sin decir por qué no se puede.** Una orden que desaparece del tablero sin
motivo escrito es peor que una atrasada, porque la atrasada por lo menos se ve.

## Lo medido, el 13/11/2026

Todo esto sale de la base de producción y de la planilla real, no de leer el
código:

- **2.453 OT en la base.** `REALIZADO` 2.402, `ATRASADO` 20, `POR_HACER` 17,
  `EN_PROCESO` 14. **`SUSPENDIDA`: cero.**
- **La columna M del master dice cuatro palabras y nada más:** «Realizado»
  2.402, «Atrasado» 20, «Por hacer» 16, «En proceso» 14, y una celda vacía.
  Ni una «Suspendida».
- **La M no tiene lista desplegable** —se comprobó la validación de datos celda
  por celda en dos tramos—, así que una palabra nueva entra sin pelear. Las
  celdas de las órdenes abiertas llevan la fórmula `=IF(J<fila>="","",L<fila>)`
  y las cerradas un literal.
- **51 órdenes abiertas** hoy: 20 atrasadas, 17 por hacer, 14 en proceso.
- **25 justificaciones** cargadas en `ordenes_trabajo_notas`, sobre 25 órdenes
  distintas.

El cero de `SUSPENDIDA` es el dato que gobierna el diseño entero. Ese estado
existe en el código desde la migración 005 y **nunca lo usó nadie**, ni desde
la app ni escribiendo en la planilla. Lo único que llevaba ahí es el resultado
«Cancelado» del modal de registrar el trabajo (`ESTADO_SEGUN.cancelado →
"SUSPENDIDA"`), y ese camino tampoco produjo una sola fila en 2.453 órdenes.

## Objetivos

1. Una OT se puede cancelar, y cancelada quiere decir **no se va a hacer
   nunca**.
2. No se puede cancelar sin escribir por qué. Obligatorio de verdad: lo exige
   el servidor y no el formulario. Por la puerta de la planilla, que no se
   puede cerrar, se exige lo más fuerte que queda: que una cancelación sin
   motivo **no pase inadvertida**.
3. Una OT cancelada deja de contar como abierta en todos lados: no está
   atrasada, no sube en el GUT, no aparece en los avisos.
4. El motivo se ve desde la planilla, que es de donde lee quien no entra al
   sistema.
5. La cancelación sobrevive a la sincronización. Que la planilla mande no puede
   significar que el próximo cron descancele la orden.

## No objetivos

- **No se audita con `auditar()`.** Cancelar es reversible —se vuelve a abrir
  cambiando el estado— y la nota ya deja escrito quién y cuándo (`creado_por`,
  `creado_en`) y, a diferencia de un registro de auditoría, se ve desde la
  propia orden. Las nueve rutas que auditan hacen cosas que no se deshacen.
- **No se toca el estado del equipo.** El trigger `sync_equipos_status_from_ot`
  sólo reacciona a `REALIZADO` y `EN_PROCESO` y devuelve sin hacer nada para
  todo lo demás; cancelar una orden no dice nada sobre si la máquina anda.
- **No se exporta el motivo a ninguna columna nueva.** Va a la X, que ya es la
  celda de «por qué no se hizo».
- **No se toca el MTBF.** `mtbfDeLaPlanta` filtra por `tipo = 'CORRECTIVO'` y
  por la ventana de fechas, y **nunca mira el estado**: una OT cancelada va a
  seguir contando como falla. Queda así a propósito. Lo que el MTBF cuenta es
  **que algo se reportó roto**, y eso pasó igual —el correctivo existe porque
  la máquina falló, no porque alguien la haya arreglado—. Cancelarlo dice que
  el trabajo no se va a hacer, no que la falla no ocurrió. El caso que sí
  ensuciaría el número es el duplicado —«el trabajo lo absorbió otra OT»—, pero
  eso no se distingue del resto sin leer el texto de la nota, así que
  descontarlo automáticamente descontaría también las bajas de equipo. Hoy son
  3 correctivos de las 51 abiertas, así que el número no se mueve; lo que
  importa es que la regla queda escrita y no inferida del silencio. Cambiar la
  definición del MTBF es una tarea aparte y tiene su propio spec
  (`2026-10-16-mantenimiento-mtbf-design.md`). *(Decisión mía, a partir de la
  revisión.)*
- **El aviso del que salió la OT no se desenlaza, y el riesgo queda asumido.**
  Hoy 13 avisos abiertos apuntan a alguna de las 51 OT abiertas, y un aviso
  cuenta como atendido con sólo tener una OT asignada —`tieneOrden` en
  `app/api/home/resumen/route.ts` y la cuenta de `mantenimiento/page.tsx`—.
  Cancelar la OT lo entierra dos veces: la orden sale de todas las listas por
  diseño, y el aviso sale porque «ya tiene OT». **Decidido a pedido:** se queda
  así. Lo que se paga está medido y escrito acá para que el día que moleste se
  sepa qué pasó: una falla reportada puede dejar de verse sin que nadie la haya
  mirado. Desenlazarlo es una tarea aparte y no es chica —toca la columna
  `OT ASIGNADA` de la planilla de avisos, que tipeó una persona en 182 de 186
  filas, con su cola (`pendienteDelAviso.ts`) y la guarda
  `loQueImpideDesenlazar`—.
- No se cambia nada de cómo se registra el trabajo que **sí** se hizo.

## Anti-objetivos

Lo que haría fracasar esto aunque funcione:

- **Que queden dos palabras para lo mismo.** Un desplegable con «Suspendida» y
  «Cancelada» donde nada explica la diferencia es cómo se pudre un vocabulario;
  este repo ya tuvo `VALID_ESTADOS` contra `ESTADOS_DE_OT` y lo dejó escrito.
- **Que queden dos lugares donde se escribe el motivo**, uno en la W y otro en
  la X, según por qué puerta entraste a cancelar.
- **Que la cancelación se pierda sola.** Es el riesgo real y tiene nombre: si
  el sistema escribe «Cancelada» en la M y `estadoDeTexto()` no reconoce esa
  palabra, la próxima sincronización la lee como `POR_HACER` y **descancela la
  orden sin que nada avise**. Es exactamente la trampa de «la planilla manda».

## Enfoques considerados

### Decisión 1 — la palabra

- **(a) `CANCELADA` reemplaza a `SUSPENDIDA`. ← elegida**
  Cero filas, así que no hay nada que migrar en los datos. Queda un vocabulario
  de cinco palabras, cada una viva, y el botón «Cancelado» del modal de
  registrar por fin lleva a donde dice. Lo que se pierde: si algún día hace
  falta «pausada, se hace después», hay que volver a agregarla; y si alguien
  escribe «Suspendida» a mano en la planilla, cae en `POR_HACER` en vez de en
  `SUSPENDIDA` —hoy no hay ninguna, así que no cambia nada medible—.
- **(b) `CANCELADA` como sexto estado, `SUSPENDIDA` queda.**
  No saca nada, y por eso mismo deja las dos palabras conviviendo: el
  anti-objetivo de arriba, escrito.
- **(c) Reusar `SUSPENDIDA` cambiándole sólo la etiqueta a «Cancelada».**
  Descartada: el valor guardado diría una cosa y la pantalla otra, y la
  planilla escribiría «Cancelada» mientras `estadoDeTexto` busca «SUSPENDIDA».
  Dos verdades sobre el mismo dato.

### Decisión 2 — dónde vive la justificación

- **(a) La nota que ya existe. ← elegida**
  `ordenes_trabajo_notas` es exactamente esto —«por qué una OT todavía no se
  hizo»—: historial que no se edita, con autor y fecha, y la última viaja sola
  a la columna X. Sin migración, y el historial se lee derecho: «falta el
  repuesto» → «esperamos la parada» → «se dio de baja el equipo, se cancela».
  Lo que se pierde: la nota no queda marcada como «ésta es la de la
  cancelación», así que si después alguien agrega otra, la X muestra la nueva.
- **(b) Una columna `motivo_cancelacion` propia.**
  El motivo queda pegado al estado y no lo tapa nadie, pero cuesta otra
  migración y abre una segunda celda que exportar, mientras la X ya es la celda
  de «por qué no se hizo».

## Las decisiones

### El vocabulario

`ESTADOS_DE_OT` pasa a ser `REALIZADO`, `EN_PROCESO`, `ATRASADO`, `POR_HACER`,
`CANCELADA`. En la planilla la palabra es **«Cancelada»**.

El valor guardado es `CANCELADA` y no `CANCELAR` —así lo pidió el pedido, que
nombraba la acción— porque lo que guarda la columna es el estado de la orden,
no el verbo: concuerda con «la orden», igual que concordaba `SUSPENDIDA`.
*(Decisión mía; si preferís la otra palabra es cambiar una constante.)*

**`estadoDeTexto()` reconoce «CANCELADA» y también «CANCELADO».** Esa celda la
tipea una persona, y la tolerancia al género es la misma que la función ya
tiene con `v.includes("PROCESO")`. Sin esto, un «Cancelado» escrito a mano cae
en `POR_HACER` y la orden revive sin que nada avise.

### Cuándo se puede cancelar

**Sólo desde los estados abiertos**: `POR_HACER`, `EN_PROCESO`, `ATRASADO`. Una
orden realizada no se cancela, se hizo.

Esto no es una restricción de más: evita el único choque serio del diseño. Una
OT `REALIZADO` tiene `fecha_cierre`, y `estadoSegunElCierre()` dice que *la
fecha manda* —cualquier orden con cierre es `REALIZADO`—. Dejar cancelar una
orden cerrada crearía una fila que se contradice a sí misma.

**Y tampoco se nace cancelada.** El POST de `/api/mantenimiento/ordenes`
valida el estado con `esEstadoDeOT`, así que en cuanto `CANCELADA` entre al
vocabulario el alta la aceptaría —y una orden creada así nacería sin nota,
porque la nota la exige el PATCH—. El alta tiene que rechazarla con el mismo
mensaje concreto que usa para un estado inválido. Es la misma regla que ya
cumplen a mano los dos formularios de alta, que excluyen `SUSPENDIDA` de su
lista «porque una OT no nace suspendida»; ahora la regla baja a la ruta, que
es donde tiene que estar: el formulario no es el único que llama. *(Decisión
mía, a partir de la revisión.)*

### Cancelar no pone `fecha_cierre`

Una fecha de cierre quiere decir «el trabajo se hizo tal día», y todo el
sistema la lee así: `estadoSegunElCierre()` la convierte en `REALIZADO`,
`loQueFaltaParaCerrar()` exige horas y al menos un operario en cuanto aparece,
y `costoEquipo` la usa como la fecha del gasto (`fecha_ejecucion ??
fecha_cierre ?? fecha`). Ponérsela a una orden que nunca se hizo mete un
trabajo fantasma en el costo por equipo y pelea con dos reglas escritas.

«Cerrada», para una OT cancelada, quiere decir que **deja de contar como
abierta** —en las alertas, en el GUT, en los avisos—, que es lo que el pedido
busca. No que tenga fecha de cierre.

### Las dos listas de «cerradas», que son dos y no una

`CERRADAS` en `alertas.ts` y `CERRADAS_GUT` en `gut.ts` tienen hoy los mismos
dos valores y **dueños distintos**: la segunda espeja la migración de
`gut_orden` y la primera no espeja nada. El comentario de `alertas.ts` ya lo
anticipó: «si un día aparece un estado nuevo, hay que mirar las dos y decidir
en cada una».

La decisión es la misma en las dos —`["REALIZADO", "CANCELADA"]`— pero **se
escribe dos veces, no se unifican.** Y `CERRADAS_GUT` tiene que terminar
diciendo exactamente lo que diga la migración: hay un test que las ata.

También lo dice el prompt del asistente (`lib/asistente/notas.ts`), que le
explica qué cuenta como abierta: `estado not in ('REALIZADO','SUSPENDIDA')`.

### Cancelar es un movimiento solo, y la nota va primero

El PATCH de `/api/mantenimiento/ordenes` acepta una `justificacion` junto al
estado. Si el estado que viene es `CANCELADA`:

1. Se valida el texto con `validarNota()` —el mismo tope de 1.000 y los mismos
   mensajes—. Si no hay texto, **400 y no se toca nada**.
2. Se inserta la nota.
3. Recién entonces se cambia el estado.

**El orden importa y es la regla de la casa:** el registro de auditoría se
escribe antes del borrado, «si no entra, no se borra». Acá igual: si la nota no
entra, la orden no se cancela. Al revés quedarían órdenes canceladas sin motivo
—justo lo que el pedido vino a impedir— y nadie se enteraría.

Y al revés también: una `justificacion` que llega con cualquier otro estado es
un error del que llama, no algo para ignorar en silencio.

### Y la nota de una OT cancelada no se borra

Hoy `DELETE /api/mantenimiento/ordenes/[id]/notas?nota=` deja que el autor
borre la suya, y después reescribe la X con la que quedó siendo la última —o la
vacía—. Con una orden cancelada eso abre la puerta de atrás al requisito
entero: cancelo con motivo, borro la nota, y queda una OT cancelada sin razón
en ningún lado, con la celda X mostrando una justificación vieja que habla de
otra cosa.

Así que **mientras la orden esté cancelada, sus notas no se borran**: 409 con
el motivo dicho. No se pierde nada, porque la forma de corregir sigue estando:
se escribe otra nota, que pasa a ser la última y va a la X. Lo único que deja
de poder hacerse es quedarse con cero.

Se eligió esto sobre las otras dos salidas. Marcar la nota de la cancelación
contradice la Decisión 2, que justamente eligió no marcar ninguna. Y auditar
con `auditar()` pide un décimo verbo en `ACCIONES` —`lib/core/auditoria.ts`—,
o sea una segunda migración, para registrar algo que la nota ya dice mejor y en
el lugar donde se lo busca. *(Decisión mía, a partir de la revisión.)*

### La puerta que el servidor no puede cerrar, y cómo se vigila

La exigencia del motivo vive en el PATCH, pero **el PATCH no es la única
puerta**: la M la edita gente a mano, y en cuanto `estadoDeTexto()` reconozca
la palabra —que tiene que reconocerla, si no la sincronización descancela lo
que el sistema cancela— cualquiera puede cancelar una de las 51 órdenes
abiertas escribiendo «Cancelada» en una celda. Sin nota, sin autor y sin fecha.
Eso no se puede impedir sin romper la regla del módulo.

Entonces no se impide: **se detecta.** Una OT en `CANCELADA` **sin ninguna nota**
es un defecto, y va al contraste que ya corre dentro de la sincronización de
órdenes desde el 29/10/2026.

La forma es la de `laCeldaDelEstadoEstaVacia`, su hermana exacta: no es una
diferencia entre los dos lados —los dos dicen «cancelada»— sino un problema que
sólo el sistema puede ver, así que se informa **con el nombre del problema y no
con el de un campo**. Dos cosas que hay que saber al construirlo:

- **`contrastar()` hoy no sabe si una orden tiene notas.** Recibe
  `OrdenDelSistema[]` y `OrdenLeida[]`, y ninguno lo trae. Hay que sumarle el
  dato a `OrdenDelSistema` y que la sincronización lo cargue: son 25 notas en
  total, una consulta chica aparte y no un embed del listado —por lo mismo que
  explica `ordenes/justificadas/route.ts`—.
- **No puede sonar por lo que no importa**, que es la vara escrita de
  `divergencias.ts`. Acá no puede: el sistema **nunca** produce una cancelada
  sin nota —el PATCH no lo permite y el alta la rechaza—, así que toda la que
  aparezca entró por la planilla y es exactamente lo que se quiere ver. Y el
  `TOPE_DE_DIVERGENCIAS` de 200 ya la cubre si alguien pega una columna entera.

Lo que esto consigue no es el «sí o sí» absoluto —no existe mientras la
planilla mande— sino que una cancelación sin motivo **no pueda pasar
inadvertida**, que es la misma vara con la que se resolvieron las ocho OT sin
estado del 29/10.

### La planilla: dos celdas en una sola escritura

Cancelar toca la **M** (el estado) y la **X** (la última justificación). Van en
la misma llamada a `escribirEnLaFilaDeLaOT`: `celdasParaRegistrar` arma la M y
`celdaDeObservacionPrevia` la X.

Lo que la M escribe para una orden cancelada es **el literal «Cancelada»**, no
la fórmula: `celdaDeEstado` ya devuelve la fórmula sólo para `POR_HACER`. Es lo
correcto —una orden cancelada no tiene que volver a decir «Atrasado» el día que
la fecha se pase—.

**Si la escritura falla**, el estado se encola en `sheets_pendiente` como
siempre (`elPendienteDelIntento`) y el `after()` reintenta a los cuatro
minutos; ese reintento tiene que llevar **las dos celdas**, porque las dos
salen del mismo pedido. Lo que el drenaje y la sincronización no pueden rehacer
es la X: `exportarLoPendiente` arma el registro desde la fila de
`ordenes_trabajo` con `loQueHayQueExportar`, y la observación previa no tiene
columna ahí. Esa limitación **ya existe y está medida y escrita** en el
encabezado de `app/api/mantenimiento/ordenes/[id]/notas/route.ts`: de las 2.291
filas del master, las 13 que tenían texto en la X eran exactamente las 13 notas
del sistema. No empeora con esto, y la salida es la misma —volver a guardar la
justificación reescribe la celda—.

Importa para `revisar-exportaciones.mjs`: el registro de ese script tiene una
entrada por archivo que escribe una planilla, y la ruta de órdenes ya está
declarada como `cola`. Hay que releer la entrada y, si cambia, contestar por
qué sigue siendo la estrategia correcta.

### El modal de registrar el trabajo pierde «Cancelado»

`RESULTADOS` queda en «Completado» y «Parcial».

Ese modal es «se fue a hacer el trabajo y salió así»: registra una ejecución,
horas, operarios y fecha de cierre, y pide una explicación que va a la **W**
—qué se encontró— y no a la X. Cancelar, con la definición acordada, no es el
resultado de una visita: es que la orden no se va a hacer nunca. Dejar las dos
puertas sería el segundo anti-objetivo —dos lugares donde se escribe el motivo,
según por dónde entraste— y además ese camino manda `fecha_cierre`, que acá
quedó decidido que una cancelación no pone.

Que no se pierde nada está medido: es el único camino que llevaba a
`SUSPENDIDA`, y en 2.453 órdenes nunca produjo una fila.

*(Decisión mía, por la definición que acordamos. Si querés conservar el caso
«fuimos y se canceló el trabajo» como algo distinto de «no se va a hacer
nunca», decímelo: son dos estados, no uno, y cambia el diseño.)*

### La migración, que la corrés vos

Una sola, y es inevitable por donde vaya el diseño: `gut_orden` es una **columna
generada** con `estado in ('REALIZADO', 'SUSPENDIDA')` escrito adentro. Sin
tocarla, una OT cancelada cuenta como abierta y se trepa al tope del tablero
GUT con el +1000.

Una columna generada no se altera en su lugar: hay que dropearla y volver a
crearla, y con ella el índice `ordenes_trabajo_gut_orden_idx`. La migración
nueva conserva el `coalesce(..., 27)` tal cual —el 27 de «sin puntaje» está
escrito en dos lugares, acá y en `lib/mantenimiento/gut.ts`, con un test que
los ata—.

Como toda migración acá: va con marca de tiempo (`npm run migracion`), la
aplicás vos a mano en el editor SQL, y **hasta que no esté aplicada el tablero
GUT muestra las canceladas arriba de todo**. Es el único pedazo que queda
colgando de una persona.

## Qué se prueba

Vitest sobre las funciones puras, que es donde están las decisiones:

- `estadoDeTexto()` reconoce «Cancelada» y «Cancelado», y ya no reconoce
  «Suspendida».
- El viaje de ida y vuelta completo: `CANCELADA` → `EN_LA_PLANILLA` →
  `estadoDeTexto` → `CANCELADA`. Es el test que impide que la sincronización
  descancele una orden, que es el anti-objetivo principal.
- `celdaDeEstado("CANCELADA", fila)` devuelve el literal y no la fórmula.
- `estaAtrasada()` dice que no para una cancelada, con `proxima_fecha` vencida.
- `CERRADAS_GUT` dice lo mismo que la migración —el test que ya existe—.
- El detector: una `CANCELADA` sin notas es un defecto; una `CANCELADA` con
  nota no suena; y una abierta sin nota tampoco, que es el caso normal de las
  51 de hoy y el ruido que hundiría al contraste.
- Que `SUSPENDIDA` no quedó suelto en ningún lado.

## Lo que queda a criterio de quien lo construya

- La forma exacta del modal de cancelar y dónde cuelga del listado y del
  kanban, respetando `grid-cols-1 sm:grid-cols-3` y que el ancho va en un `div`
  que envuelva al campo, no en el `className` del campo.
- Las etiquetas, el color y el orden de «Cancelada» en los seis lugares que
  pintan estados (`DashboardClient`, `OrdenesClient`, `EquipoDetalle`,
  `MantenimientosClient`, `PlanDetalle`, `page.tsx`).
- Si la cancelación entra en el kanban como columna propia o sólo como acción.
- El texto de los mensajes, con la vara de las rutas que ya validan a mano
  —«Falta quién lo pidió», «El ajuste no puede ser negativo»—: concretos y en
  castellano, no genéricos.
