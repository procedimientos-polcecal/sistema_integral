# Avisos al instante — diseño

**Fecha:** 18/10/2026
**Estado:** acordado
**Antecede:** la fase 2 de [la app instalable](2026-10-16-app-instalable-design.md),
que dejó el resumen diario de las 8:30.

## Qué problema resuelve

Hoy, cuando alguien carga un pedido de compra, las cuatro personas que pueden
aprobarlo se enteran **al otro día a las 8:30**, en el resumen diario. Si el
pedido entra un martes a las 9 de la mañana, la decisión que lo destraba no
puede llegar hasta el miércoles. Nadie está mirando la pantalla de aprobaciones
a propósito: es una pantalla a la que se entra cuando algo te dice que entres.

Esto es un push en el momento, para el único tipo de cosa que lo merece: **algo
que quedó parado esperando que una persona concreta decida**.

## Por qué esto es la excepción, y no la puerta a avisar de todo

El encabezado de `app/api/cron/avisos-diarios/route.ts` dejó escrito por qué la
fase 2 fue un resumen y no un aviso por evento, y nada de eso cambió. Lo que
cambia acá es que hay una clase de evento que no entraba en ese razonamiento.

Un evento merece interrumpir a alguien si cumple **las tres**:

1. **Hay una persona nombrada esperando.** No "el módulo", no "alguien del
   sector": una lista concreta de usuarios —`compras_aprobadores`,
   `os_aprobadores`—. Si no se puede decir a quién avisarle, no es un aviso al
   instante: es un cartel.
2. **Nada avanza hasta que esa persona decida.** El pedido está parado. No es
   "miralo hoy", es "hasta que vos no digas, esto no se mueve".
3. **Acaba de pasar.** El evento es la aparición. Un estado que lleva tres días
   igual no es noticia a ninguna hora, y ése es exactamente el trabajo del
   resumen.

Los dos que pasan el filtro:

- un **requerimiento de compra** que nace esperando aprobación;
- una **orden de servicio** que nace esperando aprobación.

Los que no pasan, y por qué —esto importa tanto como la lista de arriba, porque
es lo que evita que el próximo módulo sume el suyo—:

| Candidato | Por qué no |
|---|---|
| Avisos de ritmo ("hace 36 días que no se carga") | No hay nadie esperando, y su `cantidad` no cuenta cosas: cuenta umbrales. Interrumpir con eso es interrumpir con una estadística. |
| `sheets_pendiente` (movimientos que no llegaron a la planilla) | Lo reintenta la próxima sincronización sola. Avisar de algo que se arregla solo es enseñar a ignorar los avisos. |
| OT atrasadas | Es un estado, no un evento: lleva días así y va a seguir así mañana. |
| Facturas del buzón sin vincular | Es trabajo en cola, no una decisión que destraba a otro. |
| Ausencias sin clasificar | Ídem: cola de trabajo de una persona sobre su propio módulo. |

## Lo que se midió, y cómo cambió el diseño

Dos mediciones contra producción el 18/10/2026. Las dos dieron vuelta lo que
parecía obvio.

### 1. Casi nadie carga un pedido desde la app

De los **últimos 400 requerimientos, 397 entraron por la planilla** y 3 por la
app. El diseño obvio —enganchar el push en la ruta de alta de Compras— habría
sido código que no se dispara nunca.

El pedido de verdad llega por un formulario de Google, y la planilla le avisa al
sistema por el webhook de `app/api/compras/sheets/webhook/route.ts`, que corre
`importarDesdeSheets`. O sea: **el momento en que el SdG se entera de un pedido
nuevo es el momento en que una sincronización lo inserta**, no el momento en que
alguien aprieta un botón acá. Ahí es donde va el enganche. El alta desde la app
se engancha igual, porque es el camino que va a crecer, pero no es el principal.

### 2. Un push por ítem reproduce exactamente el problema de la fase 2

`compras_sincronizaciones` guarda `filas_nuevas` por corrida. En 27 días
(21/09 → 18/10):

- **42 corridas** trajeron filas nuevas: ~1,5 por día.
- Por corrida: **mediana 2, promedio 3,7, máximo 16**.
- 27 por el cron, 15 por el webhook.

Un push por ítem son picos de **16 notificaciones juntas**, que es palabra por
palabra lo que la fase 2 decidió no hacer. Un push por corrida son **1,5
interrupciones por día**, que es algo que una persona sostiene.

De ahí la regla que gobierna todo esto:

> **Una notificación por corrida, no una por ítem.**

Con uno solo, la notificación nombra el pedido. Con varios, dice cuántos son y
nombra los primeros. El freno contra una pegada de 200 filas en la planilla sale
gratis: siguen siendo un push.

### 3. Las horas

De esas 42 corridas, las que trajeron algo cayeron entre las **6:00 y las 20:00
de Argentina**, y de ésas una sola a las 6 (el cron diario) y una sola a las 20.

## Las decisiones

### Ventana horaria: 7:00 a 21:00 de Argentina

Fuera de esa franja **no se manda nada, y no se encola**. El repesque ya existe
y no hay que escribirlo: el resumen de las 8:30 cuenta los `PENDIENTE` sin mirar
cuándo entraron, así que un pedido que entra a las 2 de la mañana aparece ahí.
Mandar a las 3 de la mañana es cómo se pierde el permiso de notificar, y una
cola de pendientes nocturnos sería una tabla nueva para resolver un caso que en
27 días pasó una vez.

La hora se decide en Argentina y no en UTC: Vercel corre en UTC y el cron de
Compras es a las 09:00 UTC, que son las 6 de la mañana de acá.

### El instantáneo **convive** con el resumen, no lo reemplaza

No se toca `avisosDeUsuario()` ni el cron diario. Dicen cosas distintas:

- el instantáneo dice *"entró esto, ahora"*;
- el resumen dice *"tenés N esperando"*.

Y no se pisan de la forma molesta: si la persona aprobó lo que le avisaron, al
otro día el resumen no dice nada de Compras. El único solapamiento posible es
"entró algo ayer a la tarde y no lo aprobé", y ahí el recordatorio es correcto.

Filtrar el resumen por "lo que ya avisé" exigiría guardar qué se avisó a quién,
y el beneficio sería ahorrarle a alguien una línea de un push que igual iba a
llegar por otras cosas.

### A quién le llega

A quien pueda decidir y pueda recibir: `compras_aprobadores` (o
`os_aprobadores`) ∩ usuarios activos ∩ con suscripción en `push_suscripciones`,
**menos quien cargó el pedido**. Avisarle a alguien de algo que acaba de hacer
él es la clase de notificación que enseña a ignorarlas.

Son listas, no niveles: ser admin del sistema no alcanza para aprobar un gasto y
tampoco alcanza para que te interrumpan por uno. Ver el encabezado de
`puedeAprobarCompras` en `lib/compras/auth.ts`.

**El número de hoy:** 4 aprobadores de compras, 1 de órdenes de servicio, y
**una sola suscripción push en todo el sistema** (Bernardo Strupp, que sí está
en `compras_aprobadores`). O sea que esto hoy le llega a una persona. Eso no es
un motivo para no hacerlo —es la razón por la que la vara de "qué merece
interrumpir" tiene que estar alta desde el principio: la función se escribe una
vez y después se prende sola para los doce que faltan—, pero sí es lo que hay
que saber al medir si "funciona".

### Sin tabla nueva, y por qué alcanza

No hace falta recordar qué se avisó. **Se anuncia únicamente lo que esta corrida
insertó**: la sincronización ya distingue el alta de la actualización
(`!yaExiste` en `lib/compras/sheets.ts`), así que la corrida siguiente ve esas
filas como existentes y no las vuelve a nombrar. La idempotencia sale de la
forma del problema y no de un registro.

**El riesgo asumido:** si el envío falla —el push service caído, un 429—, esos
ítems no se reanuncian al instante nunca más. Los levanta el resumen de las
8:30. Es el intercambio correcto: la alternativa es una tabla de cola y un
reintento para recuperar una notificación cuyo valor es, justamente, ser
inmediata.

**El otro riesgo asumido:** el webhook se dispara con cada edición de la
planilla. Diez ediciones en diez minutos que creen un pedido cada una son diez
pushes. Medido: 15 corridas del webhook trajeron filas en 27 días, así que hoy
no pasa. Si pasa, la salida es un intervalo mínimo entre envíos por persona, y
eso sí pide dónde guardar el último envío.

### No se audita

`auditar()` es para lo irreversible del negocio —ver el
[spec de auditoría](2026-09-22-auditoria-de-lo-irreversible-design.md)—.
Mandar una notificación no cambia ningún dato y no hay nada que reconstruir
después. El alta del pedido ya queda en `compras_historial`.

### El envío no puede voltear la acción que lo disparó

Todo el envío va **después** de que el dato está guardado, adentro de un
`try/catch` que no relanza. Si el push falla, la compra igual quedó pedida y la
sincronización igual terminó bien. Lo único que queda es un `console.error`.

Esto vale también para el conteo que devuelve la sincronización: un fallo de
envío **no** cuenta como fallo de la corrida.

## El texto de la notificación

Un solo ítem nombra el ítem; varios dicen cuántos. En los dos casos el link va a
`/compras/aprobaciones`, que es donde se ejerce la decisión —para las dos, porque
las órdenes de servicio se aprueban desde ahí aunque sean una entidad de
Mantenimiento—.

```
Un pedido espera tu aprobación
RI 1842 · Rodamiento SKF 6205 para la cinta 3
→ /compras/aprobaciones

3 pedidos esperan tu aprobación
RI 1842, RI 1843 y RI 1844
→ /compras/aprobaciones

Una orden de servicio espera tu aprobación
OS 231 · Reparación de bomba hidráulica
→ /compras/aprobaciones
```

Nunca se manda una notificación que diga que no pasa nada: cero ítems es no
mandar.

## Dónde se engancha

| Punto | Archivo | Qué sabe |
|---|---|---|
| La sincronización de Compras (cron y webhook) | `lib/compras/sheets.ts`, en `importarDesdeSheets` | Ya distingue `!yaExiste`, y ya calcula el `estado_aprobacion` con el que queda la fila. |
| El alta desde la app | `app/api/compras/requerimientos/route.ts` (POST) | Nace `PENDIENTE` siempre, y sabe quién lo cargó. |
| La sincronización de órdenes de servicio | `lib/mantenimiento/sincronizar.ts`, en `sincronizarOrdenesDeServicio` | Hoy hace un `upsert` sin saber cuáles son nuevas: hay que leer los `os_number` que ya están, antes. |

Qué cuenta como "esperando" no se inventa: es lo mismo que ya cuenta la campana.
Para Compras, `estado_aprobacion` en `PENDIENTE` o `EN_REVISION`
(`lib/home/avisosDeUsuario.ts`). Para las OS, `esperaDecision({ sheets_tab,
estado })` de `lib/mantenimiento/aprobacion.ts`, que ya existe y ya tiene tests.

## Goals / non-goals

**Goals**

- Que quien aprueba se entere en minutos, no al otro día.
- Que el costo de interrumpir se pague una vez por corrida y no una por ítem.
- Que la regla de qué merece interrumpir quede escrita y sea aplicable al
  próximo módulo que lo pida.
- Que la decisión de a quién avisarle y si es hora de avisar sean funciones
  puras con tests, porque es donde está el juicio.

**Non-goals**

- No se toca el resumen diario ni `lib/home/avisos.ts`.
- No se toca `public/sw.js`: el `notificationclick` ya lleva a `data.url`.
- No hay preferencia por tipo de aviso en Mi cuenta. Hoy la elección es
  "notificaciones sí o no", y partirla en seis casillas antes de que alguien se
  queje es inventar un problema. (Y la casilla que importa para que esto no
  moleste ya existe: apagarlas.)
- No hay migración: no hace falta ninguna tabla ni columna nueva.

**Anti-goals** — en qué se convierte esto si sale mal

- En que alguien apague las notificaciones. Si eso pasa, el sistema entero deja
  de poder avisar de nada, incluido el resumen diario. Es el motivo de la
  ventana horaria, del push por corrida y de la lista corta de eventos.
- En una lista que crece. La prueba de las tres condiciones es el portón, y está
  escrita arriba para poder decirle que no al siguiente.

## Lo que queda a criterio de quien lo implemente

- Cómo se parte el código entre lo puro y lo que toca la base, mientras lo que
  decide —a quién, si es hora, qué dice el texto— sea puro y tenga tests.
- Si el envío a varios aparatos va en serie o en paralelo. Son pocos; en serie
  está bien y copia el molde del cron.
- El recorte de la descripción en el cuerpo de la notificación.

---

## Cómo terminó (18/10/2026)

Probado de punta a punta en producción, con pedidos reales cargados por el
formulario de Google y sincronizados desde la app. **Llegó el push y llevó a
`/compras/aprobaciones`.**

Lo que se midió al verificarlo, y que no estaba en el diseño:

| | |
|---|---|
| Aprobadores de compras | 4 |
| Con notificaciones prendidas | **1** (Bernardo Strupp, que sí está en la lista) |
| Aprobadores de OS | 1 (Nicolás Lenzetti), **sin** notificaciones |

O sea que el lado de las órdenes de servicio está escrito y probado por tests
pero **hoy no le llega a nadie**. No es un defecto del diseño: es que la
función se escribe una vez y se prende sola cuando alguien active las
notificaciones.

### Los dos bugs que aparecieron, que no eran de esto

Hicieron falta tres intentos en producción, y los dos primeros fallaron por
cosas preexistentes. Las dos valen más que la funcionalidad que las destapó.

**1. El payload del push nunca se leyó.** El handler de `push` de
`public/sw.js` guardaba `data: data.data`, un nivel que ningún emisor escribe:
el `Aviso` de `lib/core/webpush.ts` es plano. Así que
`event.notification.data` llegaba `undefined` y **toda notificación abría el
inicio** — el resumen diario de la fase 2 y el aviso de Remises incluidos.
El test no lo vio porque le pasaba al handler un payload anidado que nadie
produce: inventaba la forma en vez de copiarla del contrato. Y los dos
handlers por separado estaban bien; lo roto era el empalme, que no lo prueba
ningún test de a uno.

**2. Ningún arreglo a `public/sw.js` llegaba a un aparato.** El archivo no
tenía `skipWaiting` ni `clients.claim`, así que un worker nuevo quedaba en
espera hasta que se cerraran todas las ventanas del dominio mientras el viejo
seguía atendiendo los `push`. Se desplegó el arreglo del payload y el teléfono
siguió cayendo en el inicio: el arreglo estaba servido y no corría. Mirando
para atrás, **ningún arreglo hecho a ese archivo desde la fase 1 llegó nunca a
un aparato con la app instalada**, y nadie lo habría notado, porque un service
worker en espera no se distingue de uno que funciona.

El segundo tuvo que superar al problema que arregla: hizo falta cerrar la app
instalada **y** la pestaña del dominio una última vez para salir del worker
viejo. De ahí en adelante se activa solo. Un aparato que hoy tenga la app
instalada y nunca la cierre sigue con el worker de antes hasta que la cierre
una vez.

`skipWaiting` es seguro **mientras `public/sw.js` no cachee nada**. El día que
cachee —fases 3 y 4— hay que volver a decidirlo; la advertencia está en el
encabezado del propio archivo, con la fecha.

### Lo que cambió respecto del diseño

Nada de las decisiones. Sí un detalle de dónde vive el código: el envío **no
puede vivir en `lib/compras/sheets.ts`**, porque ese módulo termina en el
bundle del cliente por `empresaParaPlanilla` y `web-push` es sólo de Node.
Hacía fallar `next build` sin que `tsc` ni los tests lo vieran. La
sincronización ahora sólo **calcula** quiénes nacieron esperando y los
devuelve en `nacen_esperando`; avisa `lib/compras/avisoDeAprobacion.ts`, desde
las rutas.
