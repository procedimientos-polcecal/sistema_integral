# OT periódicas que se crean solas, y se postergan con justificación

**Acordado el 29/10/2026.** Módulo Mantenimiento.

## Por qué, y cuál es el estado real hoy

El preventivo de la planta no se está haciendo desde el sistema. No es una
impresión: está medido.

| | |
|---|---|
| Mantenimientos programados cargados | **1** — «Lubricación mensual de rodamientos» |
| Su próxima fecha | **8/8/2026**, vencida hace casi tres meses |
| OT nacidas de un programado, en toda la historia | **0** |
| Ejecuciones registradas | 13, y las últimas cuatro **sin atar** a ningún programado |

La pantalla de programados existe, y existe un botón que genera la OT. Lo que
no existe es que algo pase **sin que alguien entre y lo apriete**, y en tres
meses nadie lo apretó. Ésa es toda la razón de este trabajo: lo que depende de
que una persona se acuerde, no pasa.

El ejemplo que lo disparó es la lubricación de reductores **cada 500 horas de
marcha**. Eso queda afuera —ver *No-objetivos*— pero es el caso que hay que
tener en la cabeza: el día que toca, la orden tiene que estar.

## Qué se construye

1. **La OT periódica se crea sola.** El día que toca ya está en el listado,
   completa y lista para trabajar.
2. **Una OT se puede postergar desde el sistema, con justificación
   obligatoria**, eligiendo una razón de una lista configurable que trae
   puestos los días que esa razón suele correr.
3. **Un menú para configurar esas razones y sus días.**

## Objetivos

- Una OT periódica aparece sola, sin que nadie se acuerde.
- Postergar deja dicho **por qué** y **cuántos días**, en un lugar que se puede
  leer después.
- La fecha nueva llega a la planilla, no se queda sólo en el sistema.

## No-objetivos

- **La postergación automática.** Se diseñó y se sacó del alcance el
  29/10/2026, con el número delante: las dos razones que el sistema puede
  comprobar solo no se pueden disparar sobre lo que este diseño genera. Medido
  ese día en producción: **0 de 44 OT abiertas tienen operario cargado**,
  `mant_personal_taller` tiene **0 filas**, hay **18 renglones de repuesto en
  toda la base**, y la OT que arma `cuerpoDeLaOT` nace **sin repuestos y sin
  operario**. Se habría construido un mecanismo que no se activa nunca. Vuelve
  cuando haya datos que lo alimenten, y la §*Lo que queda abierto* dice qué
  dejar listo para que entonces sea agregar y no rehacer.
- **Periodicidad por horas de marcha.** `equipos.horas_marcha` existe en la
  ficha técnica desde siempre y está **vacío en los 269 equipos**. Agregar un
  campo no alcanzó: hace falta que el número se enganche a un momento que ya
  pasa. El camino está probado en otro módulo del mismo sistema —Taller Vial
  hace services por horómetro a 250/500/1000/2000 hs, y el horómetro se anota
  **en la carga de combustible**—, y copiarlo es un proyecto propio.
- **Postergar una OT que no creó el sistema.** Ver *Restricciones*.

## Anti-objetivos — qué haría fracasar esto aunque funcione

- **Que el sistema ensucie la planilla.** Crear una OT acá no es una fila en
  una base: consume un número de la serie y escribe en el libro que mira toda
  la planta. Un programado mal configurado no es ruido en una pantalla, son OT
  de más en la planilla de producción. **Si esto genera de más una vez, se
  apaga y no vuelve.**
- **Que una OT se corra y la planilla no se entere.** La fecha nueva en la base
  y la vieja en el libro es exactamente la divergencia que este módulo pasó
  tres semanas arreglando (las OT 2896-2898, el PATCH sin pendiente anotado,
  las ocho con el ESTADO en blanco).
- **Que la justificación se pueda saltear.** Si hay un camino que postergue sin
  escribir nada, en un mes no hay ninguna justificación.
- **Que un programado vencido genere una OT por corrida.** El cron no es
  diario; ver *Restricciones*.

## Restricciones

### La fecha de ejecución sólo se puede mover en las OT que creó el sistema

Medido el 29/10/2026. En el master (`ORDEN DE TRABAJO`, pestaña `OT`) las
columnas **A a J y la S son derrame** de cuatro `QUERY(IMPORTRANGE())` del
libro de respuestas: las filas de las OT 2896 y 2897 no tienen **ningún**
`userEnteredValue` en A:S. La fecha de ejecución es la **J**. Escribir ahí no
queda: o rompe el derrame con `#REF!`, o el derrame lo pisa al recalcular.

Para una OT nacida en el SdG sí se puede: su fila original vive en `Altas del
sistema`, columna **FECHA COMPROMETIDA**, **índice 26 (columna AA)**, y esa
pestaña la escribe el sistema. Para una del formulario, **no**: su fila está en
`Respuestas de formulario`, que Forms maneja insertando dentro de su propio
rango — escribir ahí fue lo que corrió la OT 2796 dos lugares el 16/10/2026.

**Consecuencia para la pantalla:** el botón de postergar existe sólo en las OT
con `app_created`. En las demás no se muestra, y se dice por qué.

### Entre que se escribe la fecha y que llega al master pasan horas

Es la restricción que más forma le da a este diseño. `sincronizarOrdenes` hace
`upsert` con el `fecha_ejecucion` leído de la **J del master**, y el derrame
tarda: las cinco OT medidas el 21/10/2026 tardaron **de 3 a 53 horas**. Sin
protección, la sincronización siguiente pisa la fecha nueva con la vieja.

Y hay un segundo filo, nuevo desde el 29/10/2026: esa diferencia la detecta
`contrastar`, que la cuenta como divergencia y alimenta el aviso
`mant-divergencias`. O sea que cada postergación dispararía además **ese** push
— lo contrario del anti-objetivo de arriba.

**La solución está decidida** y es la única parte de este diseño que pide una
migración: una columna `fecha_ejecucion_pendiente` en `ordenes_trabajo`.
Mientras tenga valor:

- la importación **no pisa** `fecha_ejecucion` de esa OT;
- `contrastar` la trata como lo que es —algo en camino, no una divergencia—,
  igual que ya hace con `sheets_pendiente`;
- cuando la J del master llega a ese valor, la columna se limpia sola.

**No se reusa `sheets_pendiente`**, y el motivo está escrito en
`lib/mantenimiento/pendienteDeLaOT.ts`: la cola rearma el registro desde la
fila con `loQueHayQueExportar`, que sólo sabe de estado, cierre, horas,
contratista y operarios. Un pendiente que esa función no puede rehacer **se
limpia solo en el primer drenaje**, dejando la OT desprotegida sin que nada lo
diga.

### Las reglas del repo que aplican

- **Las migraciones las corre una persona.** La columna de arriba hay que
  pedirla y esperar.
- **Toda ruta que toque un campo que se exporta tiene que exportar**, y si no
  puede, anotar el pendiente. Lo comprueba `scripts/revisar-exportaciones.mjs`,
  que **falla si aparece una escritura a planilla sin declarar**: la escritura
  a `Altas del sistema` hay que declararla ahí con su estrategia.
- **Lo que no se deshace se audita.** Mover una fecha es el paso de un valor a
  otro, que es textualmente el verbo `corregir` de `lib/core/auditoria.ts`, y
  ése **exige** `valor_anterior` y `valor_nuevo`. Va auditado.
- **Una policy nueva va envuelta**: `using ((select mant_puede_ver()))`.
- **Un `<select>` se escribe `<Select>`**, y una grilla de tres columnas lleva
  breakpoint.

## Cómo funciona

### 1. La generación

Un paso nuevo que, para cada programado activo cuya `next_date` ya llegó, crea
la OT, la ata al programado (`ordenes_trabajo.schedule_id`) y corre la
`next_date`.

Decisiones tomadas:

- **De un programado vencido hace varios ciclos sale UNA sola OT**, la del
  ciclo actual. Lo perdido se saltea: tres ciclos viejos son tres números de la
  serie y tres filas en el libro de la planta por un trabajo que no se va a
  hacer tres veces. La `next_date` se adelanta hasta la primera futura.
- **La idempotencia no la da el reloj, la da el dato.** El cron de Mantenimiento
  **no es diario**: `vercel.json` lo agenda 06:00 UTC pero el que marca la
  frecuencia real es Actions, que declara cada 15 minutos y corre cada 3 a 5
  horas (medido, `lib/mantenimiento/reintentoDePendientes.ts`). El paso tiene
  que poder correr diez veces por día sin generar diez OT, y eso se consigue
  porque sólo mira programados **cuya `next_date` ya llegó** y lo primero que
  hace al crear es correrla. No alcanza con «ya hay una OT abierta de este
  programado»: eso deja de proteger apenas alguien la cierra.
- **Si el alta falla, la `next_date` no se mueve.** Mover la fecha sin haber
  creado nada es perder el ciclo en silencio.
- **Un programado cuyo tipo no resuelve una especialidad no genera, y se
  informa.** `loQueFaltaParaCrear` exige especialidad y `especialidadDeTipo`
  sólo la sabe para `Lubricacion` y `Revision_electrica`; para los otros cinco
  devuelve vacío **a propósito**, porque enlazar al que se le parece es peor que
  dejar en null. Así que **el programado gana un campo de especialidad propio**,
  y mientras esté vacío ese programado no genera y aparece en la pantalla como
  incompleto.
- **`FECHA_FIJA` y `PERSONALIZADO` sin `interval_days` no tienen próxima
  fecha.** Generan su OT una vez y el programado pasa a `completed` en lugar de
  quedar generando para siempre.

### 2. Postergar, con justificación

Desde la orden. Pide **razón** (de la lista configurada) y **texto
obligatorio**, trae puestos los días de esa razón y permite cambiarlos.

Al confirmar, en este orden:

1. se escribe la fecha nueva en `Altas del sistema`;
2. recién si eso salió, se guarda en la base junto con
   `fecha_ejecucion_pendiente`;
3. se deja la justificación como nota (que ya viaja a la columna X del master);
4. se audita con `corregir`, con la fecha vieja y la nueva.

**Si la escritura en la planilla falla, no se mueve nada** y se le dice a quien
lo hizo, con lo que dijo Google sin traducir.

### 3. El menú de razones

Razón + días que sugiere. Valor de arranque acordado: **falta de repuesto, 3
días**. Las demás las carga el usuario.

Las razones son **un vocabulario cerrado del lado del código**, porque de cada
una va a colgar una comprobación el día que la postergación automática entre.
El menú define cuáles están activas y con cuántos días, no inventa razones
nuevas.

## Lo que queda a criterio de quien construya

- Dónde viven las razones y los días (tabla propia o fila de configuración), y
  qué pantalla las edita.
- Si la justificación de una postergación se distingue de una justificación
  común, y cómo.
- Qué pasa con un programado cuyo equipo se dio de baja.
- Si el alta se extrae de `app/api/mantenimiento/ordenes/route.ts` a `lib/`
  —que es lo que hace falta para que un cron pueda crear sin sesión— o si el
  cron llama a la ruta. **Ojo con el presupuesto**: la ruta usa `after()` para
  reintentar cuatro minutos y el cron de Mantenimiento ya gasta su `maxDuration`
  en cuatro sincronizaciones.

## Lo que queda abierto, a propósito

**La postergación automática**, que sale de este alcance pero vuelve. Para que
entonces sea agregar y no rehacer, este diseño pide dos cosas: que las razones
ya sean un vocabulario cerrado con sus días configurables —que es lo que se
construye ahora—, y que **postergar sea una función y no un handler de un
botón**, para que el día que un proceso quiera llamarla no haya que
desarmar la pantalla.

**La periodicidad por horas de marcha.** El modelo de hoy (`schedule_type`,
`interval_days`, `next_date`) es puro calendario. Lo que se pide es que decidir
«¿toca?» esté detrás de una función, para que una fuente de horas se pueda
sumar sin rehacer el resto.

Y la pregunta que hay que contestar antes, que es de planta y no de software:
**en qué momento que ya ocurre alguien podría anotar las horas de un
reductor.** Mientras no haya respuesta, `horas_marcha` va a seguir en 0 de 269.

## Cómo se sabe que salió bien

- Un programado con fecha de ayer produce **una** OT, y las siguientes cinco
  corridas del cron **no producen ninguna más** —ni siquiera después de cerrar
  esa OT—.
- El programado real, vencido desde el 8/8/2026, produce **una** y su próxima
  fecha queda en el futuro.
- Una OT postergada tres días aparece con la fecha nueva **en la planilla y en
  el sistema**, con su justificación, y `contrastar-ot` **no** la cuenta como
  divergencia mientras el derrame está en camino.
- Una OT que no creó el sistema **no ofrece** el botón de postergar.
- `revisar-exportaciones` sigue en ROMPE 0 con la escritura nueva declarada.
