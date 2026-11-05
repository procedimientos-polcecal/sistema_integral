# La Agenda — eventos del SdG espejados en Google Calendar

Acordada el 30/10/2026 y construida el 02 y 03/11/2026. El diseño está en
[docs/superpowers/specs/2026-10-30-agenda-y-google-calendar-design.md](superpowers/specs/2026-10-30-agenda-y-google-calendar-design.md)
y el plan en
[docs/superpowers/plans/2026-11-02-agenda-y-google-calendar.md](superpowers/plans/2026-11-02-agenda-y-google-calendar.md).
Acá quedan las decisiones y las trampas que no se deducen del código, y al final
**la lista de lo que sólo se puede comprobar en la primera corrida real**, que es
lo primero que tiene que leer quien despliegue.

**No es un módulo.** Es una sección que ven los catorce usuarios: la entrada de
`lib/core/nav.ts` no lleva `modulo`, a propósito, y no figura en `MODULOS_ORDEN`
de `lib/core/access.ts`. Vive en `app/(app)/agenda`, `lib/agenda`,
`app/api/agenda` y `app/api/cron/agenda`. Cada uno ve **lo que creó y aquello a
lo que lo invitaron**; nadie ve la agenda ajena.

## Qué hace, en dos líneas

Un evento se crea en el SdG (desde `/agenda`, o desde una OT con «Mandar al
calendario») y aparece en el Google Calendar del dueño y de cada invitado. Si
alguien lo borra o lo mueve desde Google, el SdG lo dice en el momento.

## El SdG manda y Google es el espejo, pero avisa en vez de pisar

Se parece a Producción —el sistema es la fuente y la otra punta es una
exportación— y se diferencia en lo único que importa: **Producción pisa la
planilla si alguien la edita a mano y no se entera; la Agenda no pisa, avisa.**
Un cambio hecho a mano en Google Calendar **alerta, no gana**: el SdG no importa
eventos creados del otro lado ni acepta como verdad una hora cambiada allá.

Esto es lo que se paga para evitar los dos anti-objetivos del diseño: que un
evento diverja sin que nadie se entere, y que el SdG le pise a alguien un
cambio hecho a mano sin decirlo.

## Divergencia son sólo borrado y movido

`queDivergio` (`lib/agenda/divergencia.ts`) mira cuatro cosas y nada más: que el
evento esté **cancelado**, que **no esté**, y que cambie el **inicio** o el
**fin** respecto de lo último que el SdG escribió. Título, lugar, descripción,
invitados que entran o salen: no son divergencia.

**Los RSVP quedan afuera a propósito, y es la decisión que más pesa.** Un invitado
que acepta o rechaza modifica el evento y dispara el aviso de Google. Una OT
lleva cinco invitados, así que ése sería **el cambio más frecuente de todos**:
cada OT mandada al calendario sonaría hasta cinco veces. No es un temor:
en este repo está medido que eso termina con la gente apagando las
notificaciones —de 13 personas, las dos únicas que probaron los avisos en serio
terminaron con los 13 descartados—. Una alerta que suena seguido es peor que no
tenerla.

Por lo mismo, lo que se guarda para comparar es **el inicio y el fin de lo
último que el SdG escribió** (`inicio_escrito`, `fin_escrito`), no el evento
entero. Y **`escrito` guarda lo que Google devolvió, no lo que se mandó**: es lo
que permite distinguir el eco de una escritura propia de un cambio ajeno.

El eco tiene su propia trampa: Google puede devolver `...-03:00` o `...Z` para el
mismo instante, y el SdG arma horas sin zona. `mismoMomento` compara siempre por
**instante** y lee una cadena sin zona como hora de pared de Argentina (−03:00
fijo); sin eso cada eco saldría «movido». Un evento que Google devuelve de día
completo no tiene instante y cuenta como movido.

## Lo que se midió contra Google el 02/11/2026

Impersonando `procedimientos@polcecal.com` sobre su calendario real, antes de
escribir código y después sobre eventos de prueba. Son los números que decidieron
el diseño:

| | |
|---|---|
| Crear, leer, mover y borrar impersonando | 200 / 200 / 200 / 204 |
| El dueño del evento es la casilla impersonada | sí: `organizer` y `creator` dieron `procedimientos@` |
| **Un evento borrado vuelve con 200 y `status: "cancelled"`, no con 404** | buscar un 404 —lo primero que uno escribe— no detecta nada. La divergencia por borrado se lee del `status` |
| Borrar uno que existe | 204 |
| Borrarlo de nuevo | **410** (`reason: "deleted"`) |
| Borrar un id que nunca existió | **404** (`reason: "notFound"`) |
| `GET` de un id que nunca existió | 404 |
| **`PATCH` sobre un evento borrado** | **200, acepta la hora nueva y el evento sigue `cancelled`**: invisible, con la hora cambiada |
| `PUT` con `status: "confirmed"` sobre un borrado | 200, y resucita |

Dos consecuencias que están en el código:

- **Resucitar un evento pide `PUT`, no `PATCH`** (`restaurarEvento` en
  `lib/core/calendar.ts`). `actualizarEvento` sobre un borrado **miente**: contesta
  200 sin resucitar. Quien lo llame tiene que mirar el `cancelado` de lo que
  devuelve.
- `borrarEvento` toma **404 y 410 como éxito**: lo que quiere es que el evento no
  esté, y el caso frecuente es que alguien ya lo borró a mano.

**Un `PATCH` y un `PUT` leen distinto lo que falta, y esa asimetría casi borra los
cinco invitados de una OT por dos caminos distintos.** En un `PATCH`, omitir
`attendees` significa «no los toques»; en un `PUT` significa **«no hay»**, y
reemplaza el recurso entero: pierde a los invitados y a cada uno le manda la
cancelación. Los dos caminos que estuvieron a punto de hacerlo:

- el `PATCH` de un evento con **cero filas** en `agenda_invitados` —esas filas
  existen por diseño— mandaba `attendees` vacío;
- la sincronización de una OT cuyo evento no tenía `google_event_id` cae en
  `crear`, que ante un 409 termina en un `PUT` (`restaurar`). Por eso
  `moverElEvento` **lee antes los invitados de Google** y los reusa, y si la
  lectura falla no escribe a ciegas: queda en `google_pendiente`.

Y `restaurar` (`escribirEnGoogle.ts`) es por donde pasan **todos** los `PUT` (la
carrera del 409, el reintento de pendientes y destrabar), así que el cuidado vive
ahí y no en cada llamador, donde sería una convención que alguien olvida repetir:
con `invitados` en `undefined`, **lee los de Google y los reusa** (pasados por
`invitadosLimpios`, que saca al organizador: Google lo devuelve entre los
`attendees` y reusarlo tal cual lo invitaría a su propia reunión). Si Google no
conoce el evento no hay nada que perder, y si la lectura falla **no escribe a
ciegas**: queda pendiente. El costo asumido: si alguien sacó a todos los invitados
y esa escritura quedó pendiente, el reintento no los saca de Google. Perder
invitados en silencio es peor que no sacarlos.

**El id del evento de Google es el `uuid` de la fila sin guiones**
(`idDeGoogleDe`), que cae dentro de lo que Google acepta (`a-v` y `0-9`; con
guiones o en mayúscula no sirve). Sale de la fila y no se guarda aparte, así que
reintentar crear —el alta que cortó a los 30 s, el `PATCH` de una fila sin
`google_event_id`, el `DELETE`— da siempre con el mismo evento. `crearEvento`
toma el 409 internamente y devuelve `yaEstaba: true`; `escribirEnGoogle("crear")`
pisa con `PUT` sólo en ese caso o si el evento está cancelado. No hay un verbo
que haya que **elegir**: hubo uno (`reintentar`) y se borró, porque una garantía
que depende de elegir bien el verbo la rompe `tsc` sin avisar.

## La delegación de dominio y las casillas

- **La delegación está autorizada** para el client ID `101499089090401417948` con
  el scope `https://www.googleapis.com/auth/calendar` (`SCOPE_CALENDAR` en
  `lib/core/google.ts`). Medido el 02/11/2026. Sin ella, el token que pide
  `obtenerToken(scopes, comoQuien)` no sale (`unauthorized_client` desde oauth2,
  que **falla antes y no llega a ser un 403 de Calendar**).
- **El token se cachea también por a quién se impersona**: la clave es
  `scopes + comoQuien`. Con la clave vieja, la casilla B usaría el token de la A
  y escribiría en su calendario. Hay un test que comprueba que el JWT lleva `sub`.
- **Las catorce direcciones son casillas de Workspace y no alias**: las catorce
  entregaron token impersonando y su calendario primario. Un usuario con alias
  fallaría todos los días en `agenda / canales`, nombrado, y habría que decidir
  qué hace el sistema con él.
- **El evento lo crea la casilla del dueño**, no la cuenta de servicio, y el
  `organizer` de un evento de Google **no se puede cambiar**. Por eso no se creó
  ni un evento antes de tener la delegación: salir con la cuenta de servicio como
  dueña y arreglarlo después significa borrar y recrear cada evento vivo, y
  reinvitar a todos.
- **Un 403 de Calendar se explica por motivo** (`fallo()` en `calendar.ts`):
  cuota (se reintenta), `forbiddenForNonOrganizer` (el evento es de otra persona),
  `SERVICE_DISABLED` (con el enlace para habilitar la API) o, para el resto,
  «conviene revisar la delegación» nombrando el client ID y el scope. Se guarda
  **lo que dijo Google, sin traducir**, a continuación de la frase propia.
  `mensajeDeGoogle` no se tocó: lo comparten siete módulos y su texto manda a
  mirar permisos de carpeta, que acá no es la causa.

## La zona horaria viaja explícita en cada evento

**Nueve de los catorce calendarios del dominio están en UTC** (`compras@`,
`gerencia@`, `laboratorio@`, `maximilianolenzetti@`, `nicolaslenzetti@`,
`produccion@`, `soporte.administracion@`, `soporte.cantera@`,
`soporte.laboratorio@`), cuatro en `America/Argentina/Buenos_Aires` y `despacho@`
en `America/Argentina/Cordoba`. Un evento mandado sin zona toma la del calendario,
y a esas nueve personas una OT del turno 4–12 les caería **a la una de la
mañana**. Por eso cada evento va con `America/Argentina/Buenos_Aires` escrita
(`ZONA_ARGENTINA`). **No es prolijidad y no se puede sacar.** El servidor de
Vercel también corre en UTC: ninguna cuenta se hace con `Date` y la zona del
servidor (`instanteDe` parsea con regex y `Date.UTC` sobre las partes, nunca
`Date.parse`).

## El evento de una OT

Se manda desde Mantenimiento (`app/api/mantenimiento/ordenes/[id]/calendario`).
Se elige el **turno** —4–12, 8–16 o 12–20—, el evento arranca a las 04:00, 08:00
o 12:00 y dura 1:30; el día lo da `fecha_ejecucion`. Vienen puestos cinco
invitados —`nicolaslenzetti@`, `gerencia@`, `produccion@`, `mantenimiento@`,
`soporte.mantenimiento@`— y se puede sumar a quien sea.

**El dueño es `mantenimiento@` cuando la orden no tiene autor.** El spec decía
«la casilla que generó la OT» y eso queda indefinido casi siempre: **de 2.349 OT,
sólo 91 tienen `created_by` (3,9 %), y de las 26 con fecha de ejecución futura,
sólo 8** (medido el 03/11/2026; los que crearon desde la app son
`soporte.mantenimiento@`, 78, y `procedimientos@`, 13). Sin el fallback, el evento
caería en el calendario personal de quien apretó el botón, y `gerencia@` podría
terminar siendo dueño de eventos de Mantenimiento. Si hay `created_by`, se
respeta. El usuario `mantenimiento@` se busca por correo, activo; si no hay uno,
la ruta contesta 409 diciéndolo. Una vez creado, **el dueño no cambia**: el evento
de una OT pertenece a la orden, no a nadie —mandarla a otra casilla lo
actualiza el cliente admin, fuera de RLS—.

**Una OT cerrada no lleva el botón, y el servidor también la rechaza.** «Cerrada»
es `fecha_cierre` **o** `estado = 'REALIZADO'` (`laOTEstaCerrada`, una sola
función): **168 de 986 OT `REALIZADO` no tienen `fecha_cierre`**, así que mirar
sólo la fecha dejaba pasar a una de cada seis. `SUSPENDIDA` queda afuera: es una
pausa, no una terminación.

**El evento sigue a la OT, pero sólo en el horario.** Si la sincronización de la
planilla cambia `fecha_ejecucion`, el evento se mueve solo; si la OT se borra
(desde el 18/10/2026 se borra cuando desaparece de la planilla), el evento se
borra primero. Título, lugar e invitados los reescribe volver a mandar la orden.
Dos detalles que no se deducen:

- **El borrado de espejo borra el evento aunque haya divergido o la OT esté
  cerrada**, porque ahí la orden ya no existe. Lo que se decidió no pisar es
  mover. El gancho (`antesDeBorrar` en `lib/core/borradoDeEspejo.ts`) corre
  **después del registro de auditoría y antes del `DELETE`**: borrar en Google
  primero y que después no entrara la auditoría dispararía una divergencia
  «borrado» falsa en cinco teléfonos. Si Google falla, esa OT **no se borra en
  esa corrida** y se reintenta; el freno del borrado no se tocó.
- **El cascade `ot_id … on delete cascade` es una red y no un mecanismo.** Si el
  borrado de una OT pasara sólo por la cascada, el evento quedaría vivo en el
  calendario de cinco personas sin nada que lo encuentre.

### Un evento con `ot_id` no se edita desde la Agenda

`PATCH` y `DELETE` contestan 409 nombrando la OT, y la pantalla no dibuja Editar ni
Borrar. **El porqué:** la sincronización lo reescribe cuando la planilla mueve la
fecha, así que un cambio hecho acá se guardaría, la persona lo vería guardado y
después desaparecería sin aviso: la misma mentira que este diseño evita en todo
lo demás. Para cambiarlo hay que ir a la OT. Lo mismo vale para **«Aceptar lo de
Google»** sobre un evento de OT: trae la hora de Google a una fila cuya verdad es
la orden, y la sincronización la volvería a pisar. «Reescribir» sí pasa, porque es
lo único que resucita un evento de OT borrado en Google. «Aceptar» tampoco se
ofrece sobre un `borrado` (no hay horario que traer): un botón que siempre falla
es peor que no tenerlo.

**Reenviar una OT cuyo evento divergió lo pisa, pero sabiendo.** Apretar el botón es
la decisión explícita de una persona, y mandarla a «destrabar» sería un callejón
sin salida porque destrabar es del dueño y el dueño es `mantenimiento@`. El modal
pregunta el estado al abrirse, muestra el horario que Google tiene contra el que
se va a escribir y exige marcar una casilla; el servidor lo exige también (409
`requiere_confirmacion` sin `pisar: true`).

## Un evento divergido deja de moverse solo

Es la consecuencia incómoda del diseño, y **es deliberada**: el cambio que alguien
hizo a mano se respeta. Mientras la fila lleva `divergencia`, **ni la
sincronización de OT, ni el cron de pendientes, ni una edición hecha desde la
Agenda escriben en Google**; el SdG sigue guardando en su lado (y la respuesta lo
dice), y la OT y su evento quedan separados hasta que **el dueño**
decida, desde la pantalla:

- **Reescribir** lo del SdG en Google (usa `restaurarEvento` si Google lo tiene
  borrado);
- **Aceptar** lo de Google (no está para una OT ni para un borrado).

Si la fecha de una OT cambia mientras su evento está divergido, **no se mueve y
vuelve a alertar** una sola vez por cambio (refresca `divergencia_el` y escribe
`aviso` con las dos fechas; la corrida siguiente compara contra ese aviso y no
repite). Una segunda postergación sí vuelve a alertar, porque el texto cambia.

**«Ya lo vi» no destraba.** Son dos acciones separadas: «Ya lo vi» (cualquiera que
vea el evento, apaga la campana sólo para quien aprieta, por
`agenda_divergencias_vistas`) y las salidas del dueño. Un no-dueño ve quién puede
destrabar. Un evento divergido **puede tener `google_pendiente`** —el `PATCH` lo
anota si falla guardar invitados antes de llegar a la rama de divergencia—, y el
cron mira `divergencia` **antes** de reintentar: con divergencia puesta no se
reintenta.

## `aviso` no es `google_pendiente`

Son dos columnas y dos ideas distintas, y confundirlas hacía que el cron
resucitara eventos que se quisieron borrar:

- **`google_pendiente`** = «**falta escribir**». El cron de las 5 UTC lo reintenta.
- **`aviso`** = «**algo que mirar**». **Este cron no lo lee nunca y no se levanta
  solo.**

Un borrado que Google rechazó —el de una OT que salió de la planilla, o el que
una persona pidió desde la Agenda— va a `aviso`, **no** a `google_pendiente`. Si
fuera pendiente, el cron lo leería como «falta escribir» y **recrearía** el evento
que se quería borrar, mandando a los invitados una modificación (o la
invitación de nuevo). El reintento del borrado no necesita cola: en el caso de la
OT, la próxima sincronización la encuentra otra vez como candidata, y la ruta
`DELETE` contesta 502 y deja la fila. Por la misma razón, un `DELETE` rechazado
**limpia también el `google_pendiente` anterior**: dejarlo vivo era la misma
resurrección por la otra puerta (`columnasDeUnBorradoFallido`). El aviso de
borrado (`AVISO_DE_BORRADO`) no lo limpia ningún proceso: `seguirALasOT` corre
justo después del borrado y lo habría borrado en la misma corrida que lo escribió.

Las dos columnas, además, son **pares atados** con su fecha (`divergencia` y
`divergencia_el`, `google_pendiente` y `google_pendiente_el`, `inicio_escrito` y
`fin_escrito`): un `check` de la base exige que estén las dos o ninguna. **Limpiar
una de un par tiene que poner a null las dos juntas**, y por eso hay **una sola
función por par** (`parPendiente`, `parDivergencia`, `parEscrito` en
`escribirEnGoogle.ts`) y ninguna ruta los arma a mano. El `update` que guarda un
pendiente corre cuando Google ya falló, o sea es el camino menos ejercitado: si
escribiera medio par, la violación del `check` se comería el diagnóstico original.

## El canal, el webhook y el barrido

Para enterarse **al instante**, la Agenda abre un canal `events.watch` por usuario
activo. Google avisa por `POST` a `https://www.polcecalpolysan.app/api/agenda/google`
(sale de `NEXT_PUBLIC_APP_URL`; ver [VARIABLES-VERCEL.md](VARIABLES-VERCEL.md)).

- **El endpoint es público y tiene que estar en la lista de endpoints de máquina
  de `lib/supabase/middleware.ts`.** Sin esa línea el login le contesta 307 a
  Google y la Agenda no se entera de nada, **sin ningún error**.
- Se verifica por `X-Goog-Channel-ID` + `X-Goog-Channel-Token` (el `secreto` de
  `agenda_canales`). Token que no coincide o canal que no está es 401, y no se
  mira nada más.
- **Google no dice qué cambió.** No hay `syncToken` ni `events.list`: el SdG
  relee sus propias filas futuras de esa casilla y las compara con `queDivergio`
  (`revisarLaCasilla`). La decisión y lo que cuesta están en el encabezado de
  `lib/agenda/canales.ts`; no se «mejora» sin leerlo.
- **Las propias escrituras también avisan** (el eco). Con 26 OT de fecha futura,
  una sincronización que mueva veinte son ~20 avisos que releen ~20 eventos cada
  uno: unas 400 lecturas contra una cuota del orden del millón diario. **No hay
  debounce y no hay que ponerlo «por las dudas»**: uno en memoria podría saltear un
  cambio real que llegue justo después, y un cambio que no se detecta no vuelve a
  detectarse. Si la cuota muerde lo va a decir `sincronizaciones`
  (`agenda / aviso_de_google`, con la casilla).
- La anotación de una divergencia es **condicional** (`divergencia is null` y los
  mismos `inicio_escrito`/`fin_escrito` que se leyeron): cubre la carrera entre
  una escritura propia y su eco. Y `revisarLaCasilla` devuelve sólo las
  divergencias **nuevas**; una ya divergida no se vuelve a tocar, porque cambiar
  su `divergencia_el` haría reaparecer una alerta ya dada por vista.
- El primer mensaje de un canal recién abierto es `sync` y no es un cambio.

**El margen de renovación es de 48 h y no de 24** (`ANTICIPO_DE_RENOVACION_MS`).
Con un cron diario, 24 h deja morir un canal que vence a las 25: a la corrida
siguiente ya lleva una hora muerto. Con 48 h, aun una corrida que falle entera
deja otra oportunidad. **Eso descansa en que Google dé un plazo bastante mayor que
dos días**, y ese plazo no está medido (ver la lista de abajo).

### Un canal muerto no se distingue de uno sano

Es el anti-objetivo central: un canal que venció deja de avisar **sin error y sin
ruido**, y desde afuera se ve igual que un calendario donde nadie toca nada. Hoy
lo cubren **tres cosas** y conviene saber cuáles son:

1. **El barrido diario** (`agenda / barrido`, en el cron de las 5 UTC): recorre
   `revisarLaCasilla` para todas las casillas activas, como si cada una hubiera
   avisado. **El webhook es el movimiento y el barrido es la red**: un canal
   recién abierto o ya vencido no revisa lo que pasó mientras no estaba, y sin el
   barrido ese cambio no se detectaría nunca más. Es la misma idea del resumen
   diario de avisos, que los lunes manda los totales: contando sólo movimiento, lo
   que dejó de moverse no se nombra nunca más. Una divergencia que encuentra el
   barrido va a la campana y a `/agenda`, **pero no manda push**: el cron corre a
   las 2:00 de Argentina, siempre fuera de la ventana 7:00–21:00.
2. **El aviso de salud en la campana**, sólo para `admin_sistema`:
   `agenda-pasos-caidos` cuenta los pasos `canales` y `barrido` cuya última corrida
   fue `ok = false`, **o que no corrieron en 50 horas, o que nunca corrieron**. El
   caso «el cron no corrió» es el que lo justifica: no deja ninguna fila de fallo.
   Se calcula leyendo `ultima_sincronizacion` y **no** `agenda_canales`, que no
   tiene policy y desde la sesión de quien mira leería 0 sin error —el fallo
   silencioso que se quiere evitar—. Y es un aviso aparte,
   `agenda-salud-sin-comprobar`, cuando la lectura misma falla: **un aviso de salud
   no devuelve 0 cuando no pudo mirar**, porque apagaría la única luz que avisa que
   lo demás dejó de funcionar. `aviso_de_google` queda afuera a propósito: sólo
   escribe cuando hay algo que decir, así que su última fila roja quedaría clavada
   aunque todo ande.
3. **La línea de salud en `/agenda`** (`SaludDeLaAgenda`, sólo `admin_sistema`):
   por cada paso, cuándo corrió por última vez y si está caído, con el error que
   dejó el cron. Si no pudo leerlo, dice que no pudo comprobarlo. Es adonde llevan
   los dos avisos.

El umbral de 50 h está elegido con las horas reales del cron: una corrida salteada
no suena, la segunda seguida sí (a las 07:00 UTC del segundo día).

**Falsa alarma el primer día, y es comportamiento correcto:** «nunca corrió»
cuenta como caído, así que el día del despliegue le suena a `admin_sistema` hasta
la primera corrida del cron. Un cron mal configurado que nunca arranca es justo lo
que este aviso tiene que ver. Se cura solo.

Los canales de un usuario que ya no está activo no se cierran: se dejan vencer.

## Los presupuestos de tiempo

Vercel mata la función a los 300 s sin dejar rastro, y **el corte sólo se puede
mirar entre una iteración y la siguiente**, así que lo que cuesta de más es lo que
tarde la iteración que arrancó justo antes del límite. Cada llamada a Google se
corta sola a los **30 s** (`CORTE_MS` en `calendar.ts` y `CORTE_DEL_TOKEN_MS` en
`google.ts`: el canje del token también, que antes era el único tramo sin tope).

### El cron `/api/cron/agenda` (`maxDuration = 300`)

**Un solo presupuesto de 140 s** (`PRESUPUESTO_DE_LA_CORRIDA_MS`), contado desde que
arranca y repartido entre las tres fases, cada una por su cuenta:

| Fase | Deja de empezar trabajo a los | Peor caso de lo que arrancó justo antes | Termina como tarde a los |
|---|---|---|---|
| `canales` | 80 s | token + `abrirCanal` + un `cerrarCanal`: 90 s | 170 s |
| `barrido` | 110 s | token + una lectura de evento: 60 s | 170 s |
| `pendientes` | 140 s | `POST`, el 409, el `leerEvento` interno de `crearEvento`, y leer + `PUT` de `restaurar`: cinco llamadas con token frío, 150 s | **290 s** |

Quedan **10 s para registrar** la fila de `sincronizaciones`. **Por qué 140 y no
170**: con 170 los pendientes cerrarían a 320 s, y la fila `agenda / pendientes` no
llegaría a escribirse, que es justo lo que el presupuesto existe para evitar. Y la
premisa «el token ya está en el caché» **no vale en la fase 3**: una fila encolada
por un alta fallida tiene `inicio_escrito` en null y queda fuera del `select` del
barrido, así que la casilla típica de un pendiente es la que llega fría. Con
140 s, la cuenta es 140 + 150 = 290 < 300. Con 80 s para canales entran las
catorce casillas con holgura en un día normal (unos 30 s) y un corte parcial no
mata ningún canal, porque el margen de 48 h deja dos corridas más.

**El piso que se le reserva al barrido (60 s) y a los pendientes (30 s) es de
mejor esfuerzo y no es una garantía.** Una casilla de canales empezada en su límite
puede costar 90 s y la reserva que le sigue es de 30; una lectura del barrido puede
costar 60 y su reserva es de 30. Si Google cuelga, la fase que se pasa se come el
piso de la siguiente y esa corta en la primera iteración. Se ve —las filas quedan
`ok: false` y nombran lo que no se alcanzó—, pero no se evita. **Una garantía de
verdad no entra en 300 s**: haría falta que el límite de los canales fuera **cero**
(140 − 150 < 0). La única salida sería cortar *adentro* de una iteración, con un
`AbortSignal` común a todas las llamadas, que es otro diseño y no se hizo. Escribirlo
es la diferencia entre una limitación conocida y una que se descubre el día malo.

El barrido registra en `filas` los **eventos que miró**, y es la señal de salud:
«14 casillas, 0 eventos mirados» es lo que se vería si el `select` de
`revisarLaCasilla` no encontrara nada, y de otro modo se vería idéntico a un día
sano. Un cero con filas que sí cumplen el criterio es **rojo**
(`veredictoDeCeroEventos`); un cero con nada que revisar es verde.

### La sincronización de OT (`sincronizarOrdenes`, dentro de `mantenimiento-sync`)

`mantenimiento-sync` corre **cinco** sincronizaciones en la misma invocación de 300
s: si la Agenda se cuelga, las otras cuatro (entre ellas órdenes de servicio y
comparativas) se quedan sin correr. Por eso hay **un solo presupuesto de Google**
(`LIMITE_DE_GOOGLE_MS = 30 s`) compartido entre borrar y mover: el borrado se agota a
la **mitad** (15 s) y el movimiento cuenta con el resto y, **como mínimo, con la mitad
contada desde que empieza**. Esa reserva existe porque el borrado corre primero: una
OT cuyo `DELETE` da timeout siempre vuelve a ser la primera de la lista, y sin
reserva sus 30 s agotarían todo y no se movería ningún evento, **nunca**.

**El peor caso es de ~180 s de los 300**: 45 s de borrado (empieza a lo sumo a los 15 y
termina a los 45) y 135 s de movimiento (mover un evento sin `google_event_id` son
cuatro llamadas: leer los invitados, el `POST`, el `leerEvento` interno del 409 y el
`PUT`, 4 × 30 s). Quedan ~120 s para las otras cuatro, que son lecturas de Sheets de
uno o dos segundos. Con Google colgado de verdad es mucho menos. La palanca para bajar
el número es `LIMITE_DE_GOOGLE_MS`.

Lo que no se alcanza **no se pierde en silencio**: llega al registro de
`sincronizaciones` como texto (`sinAlcanzar`; con sólo eso queda `ok: true` y con
fallos queda `ok: false`), y el primer evento que se intenta mover deja un
`google_pendiente` que sí se ve en la Agenda. Una OT cuyo `DELETE` siempre da
timeout consume sus 15 s en cada corrida y las de atrás no se borran: se dejó así,
porque pide un timeout **permanente** de un evento concreto y el borrado de espejo
reintenta todos los días.

### El webhook (`maxDuration = 60`)

Corta a los **25 s** (`Date.now() + 25_000`): con hasta 30 s por lectura, dos eventos
lentos sin el corte matan la función sin dejar rastro.

## El aviso al instante, y por qué es una excepción

Cuando Google avisa que alguien movió o borró un evento, el SdG manda **un push** a
quien corresponda (dueño e invitados con `usuario_id`). Lo hace
`avisarDeLasDivergencias` (`lib/agenda/avisoDeDivergencia.ts`), con el payload plano
`{title, body, url}`, ventana 7:00–21:00 de Argentina y **sin encolar** lo que cae
afuera: el resumen de las 8:30 y la campana lo cubren.

**No pasa por `avisarAQuienDecide()`**: cumple las condiciones 1 (hay personas
nombradas) y 3 (acaba de pasar) del portón de `lib/core/avisoAlInstante.ts`, pero
**no la 2**: nada se frena hasta que alguien decida. Se mandó igual porque se pidió
instantáneo. **Es un precedente y no un permiso**: «ya hay uno que cumple sólo dos» no
vuelve válido al siguiente.

- **Una notificación por persona y por invocación**, no por evento: un borrado masivo
  de diez eventos en Google es un push. Pero el agrupamiento vale **dentro de un
  webhook**: diez borrados de a uno son diez pushes, y webhooks concurrentes pueden
  repartirse los eventos. Si resultara ruidoso, la palanca es un freno por casilla
  (último push); no está construido.
- **A quien movió el evento también se le avisa**: Google no dice quién lo tocó.
- La marca de «visto» es **por persona**: el aviso va al dueño y a cada invitado
  usuario del SdG, y cada uno lo da por visto por su cuenta.
- **La campana cuenta por persona, filtrando explícito y no por RLS**: el cron del
  resumen usa el cliente admin, y sin el filtro le contaría a cada uno los eventos de
  todos. La Agenda es la primera tabla del sistema que filtra por fila.
- **`agenda-divergencias` no entra en la foto diaria** (`avisos_fotos` es global): un
  aviso por persona se leería como «subió desde cero» todos los días. Por eso
  `loQueSeMovio` lo saltea (`ES_POR_PERSONA`). Queda en la campana y en los totales del
  lunes. `agenda-salud-sin-comprobar` no imprime el número (`ES_BANDERA`).
- El cron de la Agenda **no** engancha el push: corre a las 2:00 de Argentina, siempre
  fuera de la ventana.

## Las OT que entran solas al calendario

Desde el 04/11/2026 una OT con fecha de ejecución futura **no espera que alguien
apriete «Mandar al calendario»**: entra sola, con el dueño y los cinco invitados
de siempre. El diseño y el plan están en
[el spec](superpowers/specs/2026-11-04-agenda-ot-automatica-design.md) y
[el plan](superpowers/plans/2026-11-04-agenda-ot-automatica.md); la grilla del mes
que se ve al elegir la fecha tiene los suyos
([spec](superpowers/specs/2026-11-04-agenda-vista-de-calendario-design.md),
[plan](superpowers/plans/2026-11-04-agenda-vista-de-calendario.md)). Las puertas son
cuatro enganches que llaman a **una sola función** (`alNacerLaOT`: el alta, los
periódicos y las dos generaciones desde el cuaderno y los partes de contratista), el
**barrido de después de cada sincronización** para lo que entra por la planilla y
no distingue un alta de una actualización (25 por corrida, `TOPE_POR_CORRIDA`), y el
plan del día. Lo que sigue es lo que **no se deduce de ese código**; cada número se
midió contra producción el 04/11/2026.

- **El evento nace sólo si la fecha no pasó, y el número es lo que impide sacar el
  freno.** De las 780 órdenes de los últimos 90 días, **574 (73,6 %) tienen la
  ejecución anterior al alta**: la OT documenta trabajo ya hecho. De las 151 que se
  cargaron en el SdG, **121 ya tenían la fecha pasada en el momento de cargarlas**, 17
  eran de ese mismo día y 13 del futuro. Sin el freno, **nueve de cada diez eventos
  serían del pasado**, cada uno con una invitación a cinco personas por algo
  terminado. Y se corrige una creencia: **las 780 tienen fecha de ejecución**; lo
  raro no es que falte sino que apunte hacia adelante. El filtro es por día y no por
  hora: una orden cargada a las 15:00 para hoy entra.
- **El apilado agrupa por especialidad y no por sector.** La misma especialidad es la
  misma gente, que no puede estar en dos lugares a la vez; especialidades distintas
  comparten hora porque las hacen personas distintas. Una especialidad vacía es su
  propio grupo (`claveDeApilado`): hay una OT así en producción y no puede reventar ni
  caer entre las mecánicas. La clave completa es día, especialidad **y turno**
  (`claveDelHueco`), definida **una sola vez** porque con dos claves el mismo evento
  recibía un hueco distinto según cuál de las dos pasadas lo tocó último. **Lo que eso
  deja abierto** —dos turnos vecinos que se solapan en el borde— **está escrito, con
  sus tres razones, en el encabezado de `lib/agenda/elEventoSigueALaOT.ts`**
  (punto 6): no se copia acá para que haya una sola versión.
- **El arranque se topea a las 20:00.** Sin tope, `08:00 + N × 1:30` llega a las 24:30
  en la undécima orden de una especialidad, `instanteDe` rechaza ese horario y la orden
  queda **sin evento y sin que nada lo diga**. Entran nueve sin tocarlo; de la décima
  en adelante comparten las 20:00 y llevan un `aviso`.
- **`yaTomados` se sacó y no hay que volver a ponerlo.** El plan creía que la segunda
  orden de una corrida no podía ver a la primera, porque el bucle estaría dentro de una
  transacción. **No lo está**: el insert de la primera ya está confirmado y la lectura
  de la segunda lo ve. Adelantar los huecos encima de eso los contaba dos veces —medido:
  **08:00 y 11:00 en vez de 08:00 y 09:30**—.
- **El `aviso` de un evento de OT tiene tres escritores y cada uno limpia sólo lo
  suyo; el del borrado gana siempre.** Son el aviso de un **borrado que Google
  rechazó** (`AVISO_DE_BORRADO`, que se reconoce por **prefijo** porque le agrega lo
  que dijo Google), el del **tope** (`AVISO_DE_TOPE`, por **igualdad**) y los que escribe
  el barrido de OT cuando la fecha se vació o el evento divergió. El del borrado es el
  único registro de que **quedó un evento vivo en cinco calendarios que ninguna fila
  nombra**, y no se recupera de ningún lado: el del tope se deduce de nuevo mirando el
  horario. Por eso `mandarLaOTAlCalendario` y `avisoDeUnMovimiento` no lo pisan ni lo
  limpian, topee o no. Dónde está cada mitad de la regla: `limpiable` y
  `avisoDeUnMovimiento` en `elEventoSigueALaOT.ts`, `delTope` en `mandarLaOT.ts`. **Si
  agregás un cuarto aviso, definí si es por prefijo o por igualdad y decile a
  `limpiable` que no es suyo.**
- **`fecha_fin` vacía quiere decir «duró un día»**, no que el dato falte: es la misma
  convención que `fecha_hasta` en el cuaderno del contratista. Las órdenes anteriores
  al 04/11/2026 la tienen vacía **y no hay backfill**, porque hasta entonces el valor
  vivía sólo en la planilla; leerlas como de un día es lo correcto y no una pérdida.
  Existe en la base porque la grilla pinta una orden **en cada día de su ventana**: una
  que va de lunes a miércoles y aparece sólo el lunes hace parecer vacío el martes, que
  es justo lo que se mira para decidir.
- **La grilla del mes cuenta órdenes y el apilado cuenta eventos, a propósito.** La
  grilla muestra el trabajo planificado, esté cerrado o no (para decidir dónde poner la
  próxima importa todo lo que hay ese día); el apilado sólo mira lo que puede chocar en
  el calendario. Son dos conjuntos distintos y unirlos sería cómodo y falso.
- **«Gente disponible» se cuenta por día y no por turno.** Los grupos A y B alternan
  entre 4–12 y 12–20 y **no pasan nunca por 8–16**: sólo los tres electricistas.
  Como los eventos caen a las 08:00, contar por turno daría **cero mecánicos para
  siempre**, y el mecánico es **1.764 de las 2.410 órdenes**. Distingue **cero**
  («el padrón está cargado y ese día no viene nadie») de **no sé** («el padrón está
  vacío»), y para CIVIL, INSTRUMENTACIÓN y OTRO dice «no lleva gente del taller» y no un
  número. Qué falta cargar para que diga algo útil está en la sección de la
  primera corrida, más abajo.
- **El guardián de la fecha ilegible no se puede disparar desde la base hoy.**
  `fecha_ejecucion` y `fecha_ejecucion_pendiente` son columnas `date` **según sus
  migraciones** (el tipo real de producción no se leyó: punto 9), y Postgres no
  devuelve un valor mal formado. Está en `esCandidataAlCalendario` porque la función
  es pura y recibe lo que le den, no por un caso observado. **El riesgo real está
  aguas arriba**: una celda mal escrita en el master hace fallar el `upsert` de las
  ~2.300 órdenes de una vez, y eso es ruidoso pero es otro problema.
- **`RAZON_DEL_PLAN` es un código de sistema y `mant_razones_de_postergacion` es la
  tabla del menú manual.** Mandar un plan al calendario corre la fecha por la ruta de
  postergar, que pide una `razon` pero **nunca la valida contra esa tabla** (es texto
  libre que va a la nota y a la auditoría). Se llegó a cargar una fila
  `planificacion_del_dia` ahí y se **sacó**: Configuración lista las razones inactivas
  con un botón «Ofrecerla», y un clic la volvía una opción manual que escribía un
  motivo falso en la auditoría y en la celda de la planilla de producción. La migración
  `20261104165733_mant_razones_de_postergacion_sin_planificacion_del_dia.sql` está sólo para que
  el repo y producción digan lo mismo (ya se aplicó por PostgREST). **No se vuelve a
  poner la fila.**
- **`scripts/revisar-exportaciones.mjs` cuenta también como escritor a quien importa y
  llama al handler de una ruta** (`POST`, `PATCH`, `PUT` o `DELETE`) **de un archivo
  ya registrado.** La regla existe porque el envío del plan al calendario escribe la
  planilla **a través del `POST` de postergar**, sin llamar a ninguna primitiva, y el
  script no lo veía: era exactamente el agujero que vino a buscar. Tiene su entrada
  (`aborta`) en el registro. La propagación es sólo desde handlers, no desde cualquier
  módulo registrado, para no volver escritor a quien importa algo de un archivo que
  casualmente escribe.

## Lo que se decidió no hacer, y lo que queda abierto

- **No se audita.** `auditoria` está para lo irreversible del negocio (postear un
  asiento, cerrar una recepción que mueve stock, mover permisos). Borrar una entrada de
  agenda no está en esa vara, **pero conviene saber que borrar manda cancelaciones por
  correo a los invitados, y eso no se deshace**. Si se quiere auditar es una línea y una
  migración para el verbo.
- **Borrar a un usuario deja sus eventos vivos en Google.** `dueno_id … on delete
  cascade` se lleva la fila y con ella el `google_event_id`; la ruta de borrado de
  usuarios (`app/api/administracion/usuarios/[id]`) no lo contempla hoy. Documentado y
  sin arreglar: es otro módulo y otro alcance.
- **El directorio de usuarios se lee con el cliente admin** en `/agenda`
  (nombre, apellido y correo de los activos), porque `usuarios_select_self` deja a un
  no-admin leerse sólo a sí mismo: el selector de invitados vendría con una fila y el
  nombre del dueño de un evento ajeno, vacío. Cualquier logueado lee así el directorio
  de los catorce. Hallazgo ajeno sin tocar: `seguridad-higiene/condiciones/page.tsx`
  parece tener el mismo problema.
- **Un evento es de un solo día en el modal** (un día, dos horas). La ruta acepta
  cualquier par y un evento que cruza la medianoche se muestra bien si viene de Google,
  pero no se puede crear desde acá. Al editar uno que cruza, el fin se corre los mismos
  días que el inicio y conserva la duración.
- **No hay eventos de día completo** (todo lleva hora) ni un calendario dibujado adentro
  del SdG. Un cambio hecho en Google **alerta, no gana**.
- **No se vuelca la programación del taller ni los mantenimientos programados.** No por
  falta de ganas: medido el 29/10/2026, `mant_personal_taller` tenía 0 filas, y las OT con
  fecha futura eran 15. Se revisa cuando el preventivo esté cargado.
- **Incógnita conocida: ¿el `PATCH` resetea los RSVP?** El `PATCH` manda siempre la lista
  completa de invitados. No está medido si eso borra las respuestas de los que siguen
  invitados, ni si el `PUT` conserva las `responseStatus` de un evento vivo. Medirlo pide
  meter un evento de prueba en el calendario de otra persona y eso lo decide el usuario. Si
  las resetea, el costo es que alguien vuelva a confirmar: molesto, no incorrecto.
- **`usuarioIdsDe` busca `usuarios.email` en minúscula**: si hay correos guardados con
  mayúsculas, ese invitado queda con `usuario_id` null y no recibe el aviso.
- **Una divergencia que anota el cron** (un reintento que descubre un borrado) no manda
  push: sólo la anota; la campana la ve.

## Qué corre y dónde

| | |
|---|---|
| Cron `/api/cron/agenda` | 5 UTC (2:00 de Argentina): canales, barrido, pendientes. Registra en `sincronizaciones` (módulo `agenda`, recursos `canales`, `barrido`, `pendientes`) |
| Webhook `/api/agenda/google` | público, lo llama Google; registra `aviso_de_google` sólo cuando falla |
| Sincronización de OT | `sincronizarOrdenes` → `seguirALasOT` y el gancho `antesDeBorrar` |
| Tablas | `agenda_eventos`, `agenda_invitados`, `agenda_canales` (sin policy: sólo el cliente admin), `agenda_divergencias_vistas` |
| Migraciones | `supabase/migrations/20261102102403_agenda_schema.sql` y, para las OT automáticas, `20261104161017_ot_fecha_fin.sql` — **las aplica una persona a mano** |

La migración depende además de la `20261018134754` (el verbo `borrar` de la auditoría):
**sin ella el borrado de espejo no borra nada y lo dice**, porque el registro de
auditoría se escribe antes y es lo que lo habilita.

Dos trampas de la migración que no se ven en el código: **la tabla puente
`agenda_divergencias_vistas` obliga a `usuarios!dueno_id(nombre)` en cualquier embed**
(`PGRST201` si se escribe sin la clave), y **una función que recibe una columna de la
fila no se envuelve en `(select …)`** —`agenda_veo_evento(id)`—, igual que en el resto
del sistema. `agenda_eventos_ver` lleva **`dueno_id = (select auth.uid()) or
agenda_veo_evento(id)`** y el disyunto del dueño **no es redundante**: con `RETURNING`
Postgres aplica la policy de `select` como `with check`, y la función `STABLE` no ve la
fila recién insertada, así que sola tumbaba todo alta hecha con la sesión de una persona
(`42501`). No «simplificarlo».

## Lo que sólo se puede comprobar en la primera corrida real

**Todo lo que sigue se razonó o se probó contra dobles de prueba, y ninguna de estas
cosas se ejercitó contra la base ni contra Google.** No había base local (la migración
no está aplicada), Google valida el dominio del endpoint antes de abrir un canal, y
las rutas y la pantalla no tienen tests en este repo. En cada punto va qué mirar y qué
se vería si estuviera mal. **Ordenados por lo que más duele si falla en silencio**, salvo los dos primeros, que
son de orden de despliegue y van arriba porque se hacen antes que todo lo demás.

1. **El código y la migración van en la misma ventana, y la migración no puede llegar
   después.** Si el código llega antes, `seguirALasOT` no puede leer `agenda_eventos` y deja
   un fallo, y la sincronización de OT escribe **una segunda fila `mantenimiento / ordenes`
   con `ok: false`**: la pantalla va a decir que la sincronización de OT falló aunque haya
   importado bien. Y peor: `antesDeBorrar` contesta «no se pudo mirar si la orden tiene un
   evento en la Agenda» para **todas** las OT candidatas, así que **el borrado de espejo de
   OT deja de borrar** mientras tanto. Ninguna de las dos cosas dice que la causa es la
   migración que falta: el mensaje es un error de PostgREST sobre una tabla, y se lee como
   un problema de la planilla.
2. **La campana consulta la Agenda en cada carga de página de todo el sistema**
   (`contarDivergenciasSinVer` y `leerLaSaludDeLaAgenda`, desde `avisosDeUsuario`), así que
   antes de la migración tira un error de PostgREST **por cada vista de cada usuario**. Está
   atrapado y devuelve 0, de modo que nadie ve nada roto, pero el log se llena de
   `agenda: no se pudieron contar las divergencias sin ver` y `agenda: no se pudo comprobar
   la salud de la Agenda`. **Eso no es síntoma de otra cosa**: es la migración que falta, y
   se va solo al aplicarla.
3. **La pantalla nunca se abrió en un navegador.** Se verificó con `tsc`, el build,
   `revisar-responsive` y las funciones puras, no con la migración corrida. Lo primero
   que hay que mirar:
   - que `/agenda` cargue para alguien **sin Mantenimiento** (ni la lectura del número de
     OT ni la de eventos pueden tumbarla);
   - que un **invitado** vea el nombre del dueño (viene del directorio admin; el embed
     `usuarios!dueno_id` es `null` para él por RLS);
   - que `.or("fin.gte.corte,divergencia.not.is.null")` combinado con `traerTodo` traiga lo
     que no terminó, el último mes y **todo lo divergido sin importar la fecha**;
   - el flujo completo de crear, editar y borrar, y que la pantalla se vea bien en el
     teléfono (donde la va a abrir la mitad del equipo).
4. **Las tres comprobaciones de RLS, con sesiones reales y no en el editor SQL** (donde
   RLS no corre): crear un evento con la sesión del dueño **con `RETURNING`**; un `select`
   de cada tabla con un usuario ajeno al evento (no debe ver nada); y uno invitado (debe ver
   el evento y sus invitados). La ausencia de recursión (`42P17`) depende de que las
   funciones corran como el dueño de las tablas; **con `force row level security` la
   recursión vuelve**, y sin detección en planificación termina en `54001`. Si algo falla,
   falla en el primer `select`.
5. **El `eq` sobre `timestamptz` de la anotación condicional** (`revisarLaCasilla`):
   compara `inicio_escrito` y `fin_escrito` contra el texto que se leyó. **Si el formato de
   fecha no resuelve, ni el barrido ni el webhook anotan nunca una divergencia, y el sistema
   se ve exactamente igual que si funcionara: todo verde, la campana en cero.** Es el
   anti-objetivo del diseño cumplido por un detalle de formato. Por eso el conteo distingue
   cuatro casos —anotadas, carrera legítima, error de base y **sin explicación**— y el
   último deja la corrida **roja** nombrando el `eq`. Primera cosa a mirar en
   `agenda / barrido`: «N divergencias detectadas, 0 anotadas». Para probarlo, borrar a
   mano un evento en Google y mirar si la fila queda con `divergencia`.
6. **El plazo real que Google le da a un canal de `events.watch`.** `abrirCanal` devuelve
   el `vence` real y es el que manda, pero **no se midió** (no se puede desde local). El
   margen de renovación de 48 h y la frecuencia diaria del cron **descansan en que ese
   plazo sea bastante mayor que dos días**. Si un día Google devuelve uno más corto, el
   cron diario ya no alcanza y hay que cambiar la frecuencia. Mirar la columna `vence` de
   `agenda_canales` después de la primera corrida.
7. **`abrirCanal` y `cerrarCanal` contra Google.** Sus tests fijan la lectura de la API
   (forma del cuerpo, `expiration` en ms), no una medición. Y **Google valida que el
   dominio esté verificado en el proyecto de Google Cloud** antes de abrir el canal: si no
   lo está, el mensaje queda anotado en `agenda / canales` tal cual, con la casilla. Con una
   `NEXT_PUBLIC_APP_URL` que no sea `https` pública, el cron lo anota diciendo qué casillas
   quedaron sin abrir (no cae en `VERCEL_URL`). Comprobar también que el endpoint recibe lo
   de Google y no un 307: un `POST` sin headers a `/api/agenda/google` tiene que dar **401**,
   no 307.
8. **El embed `ordenes_trabajo!ot_id(ot_number, fecha_ejecucion, fecha_ejecucion_pendiente,
   fecha_cierre, estado)`** del `select` de `seguirALasOT`. Por el `unique` de `ot_id`
   debería volver un objeto, y el código acepta objeto o arreglo; pero no se vio. Si el
   embed no resolviera, ningún evento seguiría a su OT y nada lo diría.
9. **El formato de `fecha_ejecucion`.** El código asume `AAAA-MM-DD` (la columna es `date`
   en la migración `005`, pero varias tablas de Mantenimiento las creó un delta aplicado a
   mano, así que el tipo real de producción no se leyó). Una fecha mal formada se avisa en
   `aviso` y no se escribe; mirar los `aviso` de la primera sincronización.
10. **Que los `aviso` y los `google_pendiente` de la primera sincronización sean cero o
   se expliquen.** La primera corrida de `sincronizarOrdenes` con eventos de OT existentes
   es la que ejercita `seguirALasOT` y el borrado de espejo con Google real.
11. **El horario que Google devuelve contra el que se escribió.** `mismoMomento` está
   probado con los formatos que se *esperan* (`-03:00`, `Z`, sin zona). Si Google devolviera
   otro (fracciones, otra zona del calendario), cada eco saldría «movido» y cada OT
   mandada sonaría: **mirar que la primera OT mandada al calendario no produzca una
   divergencia sola** a los pocos segundos.
12. **El push de la divergencia** —que llegue, que la `url` abra `/agenda` y no el inicio,
    y que no suene dos veces por el mismo cambio—. Se probó con el payload plano contra el
    contrato (`lib/core/sw.test.ts` es el que tiene que seguir en verde), no en un
    teléfono.
13. **La falsa alarma del primer día de `agenda-pasos-caidos`.** Es comportamiento correcto
    (ver arriba), pero conviene avisarle a quien administra para que no la tome por un
    fallo.
14. **La cuota de Calendar con la tormenta de ecos.** El cálculo (~400 lecturas) está
    medido sobre 26 OT, no observado. Si muerde, aparece en `agenda / aviso_de_google`.
15. **Si el `PATCH` resetea los RSVP** (ver arriba): sólo se ve con un evento de prueba en
    el calendario de otra persona.
16. **El estado «pendiente + divergencia»**: una fila de `agenda_eventos` con `google_pendiente`
    **y** `divergencia` puestas a la vez. Se llega así si `moverElEvento` escribió horario +
    pendiente, Google aceptó, y `anotarEnLaFila` falló las dos veces: queda `escrito` viejo,
    Google nuevo y el pendiente. Esa noche el barrido compara viejo contra nuevo, da
    `movido` y manda un push por un movimiento que nadie hizo. **Qué significa: esa escritura
    ya no se reintenta nunca**, porque `quePendientesReintentar` salta lo divergido (a
    propósito, para no pisar lo que una persona hizo en Google). Desde el 03/11/2026
    `revisarLaCasilla` lo nombra en `fallos` —la fila de `agenda / barrido` o `agenda /
    aviso_de_google` sale en rojo con el id del evento y la casilla— y la tarjeta de la
    Agenda dice que no se reintenta. **No se arregla filtrando `google_pendiente` fuera del
    `select` de la revisión**: abriría el agujero por el otro lado (si además una persona
    movió el evento, el reintento la pisaría). Es un estado que merece su propia vuelta de
    diseño, no un parche: acá sólo se dejó de ocultarlo. Para mirarlo a mano:
    `select id, casilla, divergencia, google_pendiente from agenda_eventos where
    google_pendiente is not null and divergencia is not null;`

Antes de todo eso, el orden es: **aplicar `20261102102403_agenda_schema.sql`** (y la
`20261018134754` si falta) **en la misma ventana que el despliegue del código** (puntos 1
y 2), hacer las comprobaciones de RLS, correr el cron a mano
(`/api/cron/agenda` con el `CRON_SECRET`) y leer las tres filas de `sincronizaciones`.

### Lo que dejan sin comprobar las OT automáticas, y lo que tiene que hacer una persona

**Antes de desplegar: `20261104161017_ot_fecha_fin.sql` tiene que estar corrida.** Es una
columna nullable y se puede correr dos veces. Si el código llega antes, **el alta de una
OT falla en el insert**: PostgREST rechaza una columna que no existe con un 400 —el mismo
que dio `estado_raw` el 29/10/2026— y falla **después de escribir la planilla**, así que
la orden queda cargada allá y acá no. Es el peor orden posible porque el error se lee como
un problema de la persona que la cargó. (La otra migración de esta tanda, la de
`mant_razones_de_postergacion`, ya se aplicó por PostgREST y es sólo para que el repo y
producción coincidan.)

**Después de desplegar: la columna de gente disponible no dice nada hasta que se cargue
el padrón, y además subcuenta ausencias porque hay francos tomados sin día.** Ninguna de
las dos cosas se arregla con código de la Agenda:

- **`mant_personal_taller` está vacía**: cero personas, cero semanas de referencia, cero
  excepciones. Con el padrón vacío la grilla dice «no sé» y no cero, que es lo honesto,
  pero tampoco da ningún dato. **Es lo único que hay que cargar.**
- **Los francos sin `fecha_descanso` son 258 de 259: 256 se explican (200 pendientes y 56 viejos) y dos no.**
  Se desglosa porque un «258 de 259» suelto se lee como que el arreglo del 26/10 no anda, y
  no es tan simple. Medido el 04/11/2026, fila por fila (el hallazgo con su detalle está en
  [docs/MANTENIMIENTO-INTEGRACION.md](MANTENIMIENTO-INTEGRACION.md), sección de la
  programación del taller, el párrafo «Las dos fotos del dato»). **Se sabe:**
  - **200 `PENDIENTE` sin fecha, y es correcto**: un franco pendiente todavía no tiene día,
    y `estaDeFranco` pide `TOMADO` **y** la fecha exacta.
  - **56 `TOMADO` antes del 26/10/2026, sin fecha**: los viejos, de cuando la pantalla no
    pedía el día. No hay cómo saber cuándo descansaron, y esos días **ya pasaron**.
  - **1 `TOMADO` el 02/11/2026, con su fecha** (se creó el 14/10, así que **no es uno de los
    40 creados desde el 26/10**).
  - **2 `TOMADO` el 02/11/2026, sin fecha** (se crearon ese mismo día). **O sea que de los
    tres francos tomados el 02/11, dos quedaron sin fecha de descanso** (medido el
    04/11/2026), y un franco tomado puede quedar sin día incluso después del 26/10. **Qué
    camino de código los escribió no se sabe.**
  - **De dónde sale cada número:** los **40** francos creados desde el 26/10 y los **2**
    `TOMADO` entre ellos son **medidos**; los **38** pendientes salen de **restarlos**.
  - **Una diferencia sin explicar, que no hace falta rehacer:** 259 − 40 = 219 y la foto
    del 26/10 decía 217. **El conteo del 04/11/2026 y esa foto difieren en dos francos y la causa no
    se averiguó**; no hay evidencia de que alguna de las dos esté mal.

  **Conjetura, sin confirmar:** que lo que distingue al que funcionó de los dos que no sea
  haberse creado **y** tomado el mismo día. Es lo único visible en los datos, con dos casos:
  **no se afirma como causa.**

  **Lo que significa para la Agenda:** cada franco tomado sin fecha es una ausencia que la
  cuenta de disponibles **no ve**, y **eso no se arregla desde acá**. Lo observado es que un
  franco tomado quedó sin día; por qué (un defecto del flujo, otra puerta de entrada, un
  dato viejo, el flujo nuevo) **no se sabe**, porque no se leyó el flujo de francos, y no se tocó. **Esos 2
  no son históricos como los 56**: su día de descanso podría estar adelante, así que sí
  pueden restarle gente a un día que todavía no llegó. Los 200 pendientes **no son una tarea
  manual**: la pantalla pide el día al marcar el franco como tomado, y lo que no se sabe es
  si lo guarda siempre. Cruzar por `fecha_tomado` en vez de `fecha_descanso` era el bug ya
  corregido (pintaba 35 huecos un lunes cualquiera) y no es la salida.

**Lo que esta tanda deja sin verificar:**

- **Desplegar ES el disparador, y es lo único irreversible y con reloj de toda la tanda.**
  `barrerLasQueFaltan` corre **al final de cada `sincronizarOrdenes`**, y esa
  sincronización la dispara el reloj sola, cada 3 a 5 horas. `TOPE_POR_CORRIDA` es 25 y la
  corrida en seco midió **23 candidatas**, así que **la primera sincronización posterior al
  despliegue las manda a las 23, todas, en una sola pasada** —no «algunas»—: **92
  invitaciones por correo**, incluidas las **cuatro de 2027** y las **seis de hoy, de las
  que algunas ya pasaron de hora**. Está dentro de lo diseñado y es lo que se pidió; lo que no se puede es
  enterarse después. Tres consecuencias prácticas:
  1. **Sacar del conjunto una orden concreta tiene que pasar antes del despliegue**, no
     después: una invitación mandada no se retira, y borrar el evento sólo avisa de la
     cancelación a quienes ya lo recibieron.
  2. **La corrida en seco del script sólo sirve si alguien la mira antes de la primera
     sincronización posterior al despliegue.** Corrida después, muestra lo que queda y no
     lo que se mandó.
  3. **No hay un interruptor**: ninguna variable de entorno apaga el barrido. Si no se
     quiere que salgan solas, el cambio no se despliega (o se saca el barrido del código
     antes), y mergear a `main` despliega.
- **Ninguna pantalla nueva se abrió en un navegador** —la grilla del mes con la gente del
  taller, el selector de fecha, el envío del plan al calendario—. Se verificaron con
  `tsc`, el build, `revisar-responsive` y las funciones puras. Es lo mismo que el punto 3
  de arriba, ahora con más superficie.
- **`--mandar` de `scripts/mandar-las-ot-futuras.mts` nunca se ejecutó.** Sólo corrió en
  seco contra producción: **23 órdenes y 92 invitaciones**, y no 21 y unas cien como
  decía el plan. Son **cuatro invitaciones por evento y no cinco**, porque el dueño es una
  de las cinco casillas fijas y no se invita a su propio evento. **Una invitación mandada
  no se deshace**, y de las 23 hay seis que son de hoy (algunas ya pasaron de hora) y
  cuatro de 2027. Entre la corrida en seco y la de verdad conviene que pase poco tiempo,
  pero **en la práctica la «de verdad» la hace el primer barrido después del despliegue**
  (ver el punto de arriba): el script con `--mandar` es para forzarlo antes o para un
  reintento, no la única puerta.
