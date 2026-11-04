# La Agenda del SdG, espejada en Google Calendar

**Acordado el 30/10/2026.** Sección nueva, transversal: la ven los catorce
usuarios. Toca además Mantenimiento, por el camino que manda una OT al
calendario.

## Por qué

Los encargados se organizan administrativamente —reuniones, tareas puntuales,
seguir lo que viene en los próximos días— y ya miran Google Calendar todos los
días, con cuentas del dominio `@polcecal.com`. Hoy el SdG no llega hasta ahí: lo
que está cargado en el sistema sólo se ve entrando al sistema, y lo que alguien
se agenda sólo vive en su calendario. Son dos lugares que no se hablan.

Lo que se quiere es que **lo que el SdG sabe que va a pasar aparezca donde ya
miran**, y que crear una de esas cosas —para uno mismo o compartida— se pueda
hacer desde el SdG.

## Lo que se midió antes de diseñar, y por qué cambió el alcance

El pedido original nombraba los mantenimientos programados: que el taller los
vea en su calendario. Medido contra producción el 29/10/2026, eso hoy no tiene
de dónde salir:

| | |
|---|---|
| `mant_personal_taller` (la programación del taller) | **0 filas** — está construida y sin cargar |
| `mant_programacion_referencia` | **0 filas** |
| `mantenimientos_programados` activos | **1**, y con `next_date` futura: **0** |
| `planificacion_diaria` con fecha futura | **0** (4 planes en total) |
| `planificacion_diaria_items` con `assigned_to` | **0** de 9 |
| `ordenes_trabajo` con `fecha_ejecucion` futura | **15** |
| `ordenes_trabajo` en `POR_HACER` | 22 |

O sea: un volcado automático de "lo que viene de Mantenimiento" pondría 15 OT y
nada más. Por eso **se arranca por lo manual**, que es lo que funciona desde el
primer día, y el volcado automático queda como no-objetivo hasta que esos datos
existan. El spec
[2026-10-29-mantenimiento-ot-periodicas-y-reprogramacion-design.md](2026-10-29-mantenimiento-ot-periodicas-y-reprogramacion-design.md)
es justamente el que va a llenar esa tabla; cuando esté, vale la pena volver.

**Los catorce usuarios son casillas, no personas.** `mantenimiento@`, `compras@`,
`laboratorio@`, `soporte.mantenimiento@`… sólo dos tienen nombre propio
(`nicolaslenzetti@`, `maximilianolenzetti@`). No es un problema —el encargado de
Mantenimiento mira esa casilla— pero significa que "compartir con otro" es
compartir entre **roles**, y que dos personas sentadas en la misma casilla ven lo
mismo. Cualquier cosa que este diseño diga sobre "el dueño" o "cada uno" se lee
con eso en la cabeza.

## Qué se construye

### 1. La sección Agenda

Una sección nueva, visible para los catorce. Cada uno ve **lo que creó y aquello
a lo que lo invitaron** — nadie ve la agenda ajena.

Un evento tiene título, día, hora de inicio y hora de fin. **No hay eventos de
día completo**: todo lleva hora. Los invitados se eligen de los usuarios del SdG
o se escribe un mail cualquiera, incluido uno de afuera de la empresa (un
proveedor, un contratista); Google le manda a cada invitado la invitación por
correo, como con cualquier evento.

Crear, modificar y borrar se hace desde el SdG, y cada una de esas tres acciones
se refleja en Google.

### 2. Mandar una OT al calendario

Desde la OT misma. Al hacerlo se elige el **turno** —4-12, 8-16 o 12-20, los del
taller—; el evento arranca a la hora en que arranca ese turno (04:00, 08:00 o
12:00) y dura **1:30**. El día lo da la `fecha_ejecucion` de la OT.

Vienen puestos cinco invitados:

- `nicolaslenzetti@polcecal.com`
- `gerencia@polcecal.com`
- `produccion@polcecal.com`
- `mantenimiento@polcecal.com`
- `soporte.mantenimiento@polcecal.com`

y se puede **sumar** a quien sea antes de mandarla. El **dueño del evento es la
casilla que generó la OT**: si la cargó `mantenimiento@`, el evento le pertenece
a esa casilla y `soporte.mantenimiento@` queda como invitado; si la cargó
`soporte.mantenimiento@`, al revés.

El evento **sigue a la OT**:

- si la sincronización de la planilla cambia la `fecha_ejecucion`, el evento se
  mueve solo;
- si la OT se borra —y desde el 18/10/2026 se borra cuando desaparece de la
  planilla, por `borradoDeEspejo`—, el evento se borra también.

### 3. La alerta de divergencia, al instante

El SdG es el dueño del dato y Google el espejo. Pero a diferencia de Producción
con su planilla, acá **el espejo no se pisa en silencio**: si alguien borra o
mueve el evento desde Google Calendar, el SdG lo dice.

**Divergencia son exactamente dos cosas: borrado y movido** —que cambie el
inicio o el fin—. Y nada más. Esto importa más de lo que parece, porque
`events.watch` no dice qué cambió: notifica, y hay que releer el evento y
comparar. Eso trae cambios que **no** son divergencia y que hay que descartar a
propósito:

- que alguien edite el título, el lugar o la descripción;
- que alguien agregue o saque invitados;
- y sobre todo, **que un invitado acepte o rechace**. Un RSVP modifica el evento
  y dispara notificación, y con cinco invitados por OT ése va a ser el cambio
  más frecuente de todos. Si contara como divergencia, cada OT mandada al
  calendario sonaría hasta cinco veces y estaríamos construyendo el anti-objetivo
  número uno con nuestras manos.

Lo que se guarda para comparar es, entonces, el inicio y el fin de lo último que
el SdG escribió — no el evento entero.

Y lo dice **ni bien pasa**, no en la pasada del día siguiente. Eso obliga a que
Google avise al SdG (`events.watch` sobre cada calendario, con una ruta pública
que recibe la notificación) en vez de que el SdG le pregunte a Google cada tanto.

La alerta aparece en **dos lugares**: en la pantalla de Agenda, marcada sobre el
evento que divergió, y en la **campana** — y por la campana viaja también al
resumen diario por push.

**Le llega al dueño y a todos los invitados que sean usuarios del SdG**, y cada
uno la da por vista por su cuenta: la marca es por persona, no global. Decidido
el 30/10/2026 sabiendo el costo —un evento de OT tiene cinco invitados, así que
una divergencia puede sonar cinco veces—. Lo que lo hace sostenible son las dos
cosas de arriba: que divergencia sean **sólo** borrado y movido (y no los RSVP,
que serían el caso frecuente), y la regla de **una notificación por corrida**:
si alguien borra diez eventos de una vez en Google, es un push y no diez.

**Si el SdG tiene que mover el evento de una OT que ya divergió, no lo mueve.**
Lo deja como está y vuelve a alertar. El cambio que hizo una persona a mano se
respeta, y la OT y su evento quedan separados hasta que alguien decida; es el
anti-objetivo de "pisar en silencio" llevado hasta su consecuencia incómoda.
Eso obliga a que la fila tenga un estado que **bloquee la escritura automática**,
y a que la Agenda tenga cómo destrabarlo.

## Objetivos

- Un encargado crea una reunión desde el SdG y le aparece en su Google Calendar,
  y en el de cada invitado, sin que nadie haya conectado su cuenta a mano.
- Una OT con fecha de ejecución llega al calendario de los cinco de siempre en un
  clic, y se mantiene al día sola.
- Modificar o borrar desde el SdG se refleja en Google.
- Si alguien toca el evento del otro lado, el SdG lo dice en el momento, en vez
  de pisarlo callado.

## No-objetivos

- **Volcar al calendario la programación del taller, la planificación diaria o
  los mantenimientos programados.** No por falta de ganas: no hay datos (ver la
  medición). Se revisa cuando el preventivo esté cargado.
- **Que Google sea una entrada.** Un cambio hecho en Google Calendar **alerta**,
  no gana. El SdG no importa eventos creados del otro lado.
- **Eventos de día completo.** Decidido: todo lleva hora.
- **Un calendario dibujado adentro del SdG** que compita con el de Google. La
  Agenda es la pantalla donde se cargan y se listan las cosas; el calendario
  sigue siendo Google.
- **Elegir la hora puntual dentro del turno** para una OT. Se evaluó y se dejó
  afuera *por ahora*: hoy arranca con el turno.

## Anti-objetivos — qué haría que esto fracase aunque funcione

- **Que alguien apague las notificaciones.** Es el riesgo real y ya tiene
  antecedente medido: de 13 personas, las dos únicas que probaron las
  notificaciones en serio terminaron con los 13 avisos descartados. Una alerta de
  divergencia que suene seguido es peor que no tenerla.
- **Que un evento diverja sin que nadie se entere.** Es exactamente lo que este
  diseño paga caro para evitar; si la alerta se apaga sola —por ejemplo porque el
  canal de observación venció y nadie lo renovó—, el sistema vuelve a mentir sin
  avisar, y además se ve igual que cuando funciona.
- **Que el SdG le pise a alguien un cambio hecho a mano sin decirlo.**

## Restricciones y lo que hace falta de afuera

- **La credencial de Google ya existe y alcanza.** `lib/core/google.ts` firma un
  JWT de la cuenta de servicio y cachea el token por juego de scopes. Hace falta
  agregar `SCOPE_CALENDAR` y **habilitar la API de Calendar** en el proyecto de
  Google Cloud. `mensajeDeGoogle()` ya traduce el `SERVICE_DISABLED` a "habilitala
  acá", así que ese error va a venir legible.
- **La delegación a nivel dominio es un paso manual del usuario, y esto no sale
  sin ella.** Para que el dueño del evento sea la casilla que lo creó —y no la
  cuenta de servicio—, un administrador de Workspace tiene que autorizar una vez
  el *client ID* de la cuenta de servicio contra el scope de Calendar. **El
  usuario pidió ayuda con ese paso cuando se llegue.**

  Decidido el 30/10/2026: **se espera a tenerla; no se crea ni un evento antes.**
  El motivo no es prolijidad. El *organizer* de un evento de Google **no se
  puede cambiar**: salir antes con la cuenta de servicio como dueña y arreglarlo
  después significa borrar y recrear cada evento vivo, y cada invitado recibe la
  invitación por segunda vez. Es más barato esperar que deshacer.
- **Las catorce direcciones tienen que ser casillas de Workspace, no alias.**
  Impersonar un alias devuelve un error de autorización, así que ese usuario
  simplemente no podría crear nada. Está planteado al usuario y se comprueba en
  la consola de administración; **si alguna resulta ser un alias, hay que decidir
  qué hace el sistema con ese usuario antes de construir el alta.**
- **Las migraciones las corre una persona a mano** en el editor SQL de Supabase.
  Un agente escribe el archivo y queda a la espera.
- **La ruta que recibe el aviso de Google tiene que ser pública** —Google no
  inicia sesión—, y por lo tanto tiene que verificarse por otro lado (el token de
  canal que se declara al abrirlo).
- **Los canales de observación vencen.** Google les pone fecha; hay que
  renovarlos con un cron o la alerta se apaga sin ruido. *El plazo exacto hay que
  verificarlo contra la documentación de la API al construir: no está medido
  acá.*
- Next.js 16: leer la guía que corresponda en `node_modules/next/dist/docs/` antes
  de escribir código.

## Las decisiones que tomó el usuario

1. Se arranca por lo manual, no por el volcado automático.
2. Los eventos se crean **desde una pantalla del SdG**, no en Google.
3. El SdG es el dueño del dato: se puede **modificar desde el SdG** y el cambio
   baja a Google.
4. La Agenda es una **sección nueva** que ven los catorce, no algo adentro de
   Mantenimiento.
5. Cada uno ve **lo suyo**.
6. **Todo lleva hora**; no hay eventos de día completo.
7. Una OT se manda al calendario **desde la OT**, se elige el turno, arranca con
   el turno y dura **1:30**.
8. Los cinco invitados de una OT vienen puestos y **se puede sumar** a otros.
9. El **dueño** del evento de una OT es la casilla que la generó; la otra casilla
   de Mantenimiento va como invitada.
10. Si la planilla mueve la fecha de la OT, **el evento se mueve solo**.
11. Si la OT se borra, **el evento se borra**.
12. Un invitado puede ser **un mail externo**.
13. Un evento borrado o movido en Google **alerta**, y alerta **ni bien pasa**.
14. La alerta se ve **en la Agenda y en la campana**.
15. **No se construye nada hasta que esté la delegación de dominio**, sabiendo
    que eso demora el arranque: salir antes obligaría a borrar y recrear cada
    evento, reinvitando a todos.
16. Si el evento ya divergió, el SdG **no lo pisa**: lo deja quieto y vuelve a
    alertar.
17. La alerta de divergencia le llega **al dueño y a todos los invitados que
    sean usuarios del SdG**, y cada uno la da por vista por su cuenta.

## Las decisiones que tomé yo

Van marcadas como mías para que se puedan discutir leyendo:

- **Campos del evento**: título obligatorio; descripción y lugar opcionales. Es
  lo mínimo que hace útil una reunión y lo máximo que no estorba.
- **Quién edita y borra**: sólo quien lo creó. Un invitado lo ve y no lo toca.
- **Zona horaria**: `America/Argentina/Buenos_Aires`, escrita explícita en cada
  evento. El servidor de Vercel corre en UTC y el sistema ya tiene
  `horaEnArgentina()` en `lib/core/fechas.ts`; dejar que la zona se infiera es
  cómo se pierden tres horas.
- **Recordatorios**: los que trae Google por defecto. El SdG no los configura.
- **Fallo de escritura**: la misma regla que las planillas —se guarda **lo que
  dijo Google, sin traducir**, y se le dice a quien hizo la acción. Nunca un
  `console.warn`.
- **El evento de una OT cerrada no se borra.** Cerrar no es desaparecer: el
  evento ya pasado queda como registro de lo que se planificó.
- **No se audita.** `auditoria` está para lo irreversible del negocio —postear un
  asiento, cerrar una recepción, mover permisos—. Borrar una entrada de agenda no
  está en esa vara. *Si al leer esto te parece que sí, es una línea de código y
  una migración para el verbo.*
- **La alerta de divergencia no usa `avisarAQuienDecide()` tal cual.** Ese portón
  pide tres condiciones y ésta cumple dos: hay una persona nombrada (el dueño) y
  acaba de pasar, pero **no es cierto que nada avance hasta que decida**. Se
  manda igual, porque el usuario la pidió instantánea, pero **conviene que la
  excepción quede escrita al lado del código** y no que alguien la lea como
  permiso para la próxima. Mantener la ventana 7:00–21:00 y la regla de **una
  notificación por corrida** —si un borrado masivo en Google toca diez eventos,
  es un push, no diez—.
- **Dos columnas de divergencia, no una.** Que la fila diga *qué* pasó (borrado /
  movido) y *cuándo* se detectó, para que la Agenda pueda mostrarlo y para que la
  campana pueda contar. Y que **una divergencia se pueda dar por vista**, o la
  campana queda encendida para siempre.
- **El evento que el propio SdG acaba de mover no es una divergencia.** Google va
  a notificar también los cambios que escribió el SdG. Hace falta distinguirlos
  (comparar contra lo último que el SdG escribió, o ignorar las notificaciones
  que llegan inmediatamente después de una escritura propia) o el sistema se
  alerta a sí mismo cada vez que la planilla mueve una OT.
- **Un evento por OT, 1:1.** Volver a mandar una OT al calendario **reemplaza**
  el evento que ya tenía —se mueve al turno nuevo—, no crea un segundo. Si la
  mandó una casilla y después la manda la otra, sigue siendo el mismo evento y
  el dueño no cambia. Es la decisión de esquema más barata de tomar ahora y la
  más cara de cambiar después: con 1:N, "el evento se mueve solo" pasa a ser
  "se mueven todos" y el borrado de la OT tiene que llevárselos todos.
- **Una OT sin `fecha_ejecucion` no se puede mandar**: el botón queda
  deshabilitado, diciendo por qué. La columna es nullable y hoy 15 de 22 OT
  abiertas tienen fecha futura, así que el caso es real y frecuente.
- **El evento se crea con la fecha que la OT tiene en el SdG**, incluida la
  `fecha_ejecucion_pendiente` —la que el SdG fijó y todavía espera que la
  planilla devuelva por el derrame—. Si el derrame vuelve con otra, el evento se
  mueve una segunda vez, y eso es correcto: es una escritura propia, no una
  divergencia.
- **Si la planilla vacía la `fecha_ejecucion` de una OT que ya tiene evento, se
  alerta y el evento queda.** No es el caso "la OT se borró" ni el caso "cambió
  de fecha": es un dato que desapareció, y borrar el evento por eso sería
  adivinar. Que lo decida una persona mirando la Agenda.
- **Un fallo de escritura en un camino automático va a una cola con reintento**,
  igual que `sheets_pendiente`. Los dos caminos sin nadie en pantalla son la
  sincronización que mueve el evento de una OT y el borrado por
  `borradoDeEspejo`; ahí "se le dice a quien hizo la acción" no aplica porque no
  hay quien. Es exactamente el agujero que el repo ya pagó dos veces con las
  planillas, y la respuesta del repo a ese agujero es una cola.
- **El caché de tokens hay que tocarlo.** `obtenerToken()` hoy guarda por juego
  de scopes y nada más (`lib/core/google.ts`). Con impersonación, la clave tiene
  que incluir también a quién se está impersonando, o a un usuario se le entrega
  el token de otro — y eso no falla con un error: escribe en el calendario
  equivocado.
- **Los catorce pueden crear e invitar, incluidos el operario y hacia afuera.**
  El usuario pidió que la función la tenga cada usuario y que la sección la vean
  todos; distinguir por rol sería agregar una restricción que nadie pidió.

## Lo que queda al constructor

- **La forma de la tabla.** Hace falta al menos: el evento del SdG (título,
  descripción, lugar, inicio, fin, dueño), su `google_event_id`, en qué
  calendario vive, los invitados, el enlace opcional a la OT, y el estado de
  divergencia. Si los invitados van en una tabla aparte o en un `jsonb` es juicio
  del constructor; pesa que hay que poder preguntar "qué eventos tengo", que es
  "los que creé **o** en los que figuro".
- **Dónde vive el evento del lado de Google.** Con delegación, lo natural es
  crearlo en el calendario principal del dueño e invitar al resto. Revisar qué
  pasa cuando el dueño es una casilla compartida y alguien declina.
- **Cómo se verifica el llamado de Google** a la ruta pública.
- **La renovación de los canales**, y qué pasa si falla: un canal muerto no se
  distingue de uno sano, que es el anti-objetivo de más arriba.
- **Si la sección Agenda necesita un valor en el enum `modulo`.** Como la ven los
  catorce, probablemente no —se parece más a "Mi cuenta" que a un módulo—, pero
  la RLS de la tabla sí hay que escribirla, y va con la función envuelta:
  `using ((select ...))`, nunca pelada.
- **Cómo se destraba un evento divergido.** Ya no se puede dejar del todo
  abierto: como el SdG deja de escribirlo, tiene que haber una forma de volver a
  atarlo. Lo mínimo es "reescribir lo del SdG encima" y "aceptar lo de Google
  como la verdad nueva"; cuál de las dos existe, o si existen las dos, es juicio
  del constructor, pero **alguna tiene que existir** o un evento divergido queda
  muerto para siempre.
- **Cómo se cuenta la divergencia en la campana.** `ConteosParaAvisos` está
  pensado por módulo y la Agenda no es un módulo; además el conteo depende de
  quién mira, y `avisos_fotos` compara contra la foto del día anterior con un id
  estable. Id nuevo para conteo nuevo, y el cálculo por usuario.

## Cómo se verifica

Lo de siempre, y lo que importa acá:

```bash
npm test
npx tsc --noEmit
npm run build
node scripts/revisar-arbol-commiteado.mjs
node scripts/revisar-responsive.mjs
```

- La lógica que decide algo —a qué hora cae una OT según el turno, si una
  notificación de Google es una divergencia o un eco de lo que el SdG escribió,
  quién ve qué evento— **va en `lib/` con tests**, no adentro de la ruta. Es la
  regla del repo y acá es especialmente barata de cumplir.
- Las pantallas nuevas: `<Select>` y no `<select>`; `grid-cols-1 sm:grid-cols-3`
  y no `grid-cols-3`; el ancho en un `div` que envuelva al campo y no en el
  `input`.
- `revisar-exportaciones.mjs` cuenta las escrituras a **planillas**. Google
  Calendar no es una planilla, así que no debería tocarlo — pero conviene
  correrlo y confirmarlo en vez de suponerlo.
- No se puede probar en el navegador sin login. Lo que sí se puede, y conviene:
  **escribir un evento de prueba en un calendario real desde local**, porque la
  credencial de Google está en `.env.local`. A diferencia de las planillas, donde
  escribir es tocar producción, acá se puede crear un evento en un calendario de
  prueba y borrarlo.
