# Las OT atrasadas se ven y avisan

**Fecha:** 19/11/2026 · **Estado:** acordado, sin construir

## Qué se pidió y por qué

Textual: *«Necesito que las OT atrasadas se pinten de rojo en los calendarios,
como una alerta visual que te dice que hay que reprogramar. Además quiero
generar una notificación de 2 días antes a la OT programada que avise, OT dentro
de 2 días. Y también que si se atrasó una OT, te avise. Todo esto en notificación
push, no al mail.»*

Preguntado a quién: *«A los que administran Mantenimiento, que lo
reprogramen.»* Preguntado qué significa atrasada: *«Se pasó la fecha.»*
Preguntado por el fin de semana: *«Que el push sí salga los sábados, no el
domingo.»*

Tres cosas, con un solo propósito: que una orden vencida no pase inadvertida y
que alguien la corra de fecha.

## Lo que se midió antes de diseñar

Todo contra la base de producción el 19/11/2026, sólo lectura. Está acá porque
es lo que sostiene cada decisión de abajo.

### El hallazgo que cambió el alcance: `proxima_fecha` no tiene datos

`estaAtrasada` de [lib/mantenimiento/alertas.ts](../../../lib/mantenimiento/alertas.ts)
decide con `proxima_fecha`, y **esa columna está en null en las 2531 filas de
`ordenes_trabajo`**. La sincronización sí la lee —es la columna 20 del master,
la pareja de `frecuencia`— pero la planilla nunca la llena, porque el
preventivo vive en el SdG y no allá.

O sea que la rama de fecha de `estaAtrasada` **nunca fue verdadera en
producción**: hoy esa función se reduce a `estado === "ATRASADO"`, que es lo que
marca la planilla. Los dos números:

| Definición | Hoy | Dónde se ve |
|---|---|---|
| `estado = ATRASADO` (lo que marca la planilla) | **21** | el tablero, el badge del listado, la campana, el orden por prioridad |
| Se le pasó la fecha y sigue abierta | **35** | en ningún lado |
| …y además su ventana entera quedó atrás | **34** | la definición que se adopta |

**Las 21 están todas adentro de las 34**: ninguna que marque la planilla queda
afuera. La de fecha no pierde nada — ve trece más, y las ve el día que vencen en
vez de cuando la planilla se entera.

Y hay una señal de que esto es un arreglo y no una redefinición: **la consulta
del tablero ya dice `.or(estado.eq.ATRASADO, proxima_fecha.lt.${hoy})`**. La
intención de mirar la fecha estaba escrita desde el principio; lo que falló es
la columna elegida.

### La gente

16 usuarios activos, diez ven Mantenimiento. «Administran Mantenimiento»
—`nivelEnModulo(rol, grants, "mantenimiento") === "admin"`— son **cinco**:
Francisco Varela, Rocco Fernandez, Nicolás Lenzetti, Bernardo Strupp y Delfina
Puch. Los que **pueden** reprogramar (`puedeEditarMantenimiento`, o sea `edicion`
o `admin`) son **esos mismos cinco**: nadie tiene `edicion` sin ser además
admin, así que las dos lecturas dan la misma lista y no hubo nada que decidir
entre ellas. Delfina Puch entra sólo por ser `admin_sistema` —en el módulo tiene
`lectura` explícita—, que es lo que `nivelEnModulo` hace con todo admin del
sistema.

### El alcance real del push, que es el número incómodo

De esos cinco, **dos tienen alguna suscripción**: Nicolás y Bernardo, los dos
`admin_sistema`. Francisco y Rocco —los que administran Mantenimiento y no el
sistema— no tienen ninguna. En todo el sistema hay **2 suscripciones de 16
usuarios**.

Se le dijo al usuario antes de decidir y eligió push igual. Queda escrito porque
es la medida de lo que esto hace el día que se despliegue: **le llega a dos
personas**, y ninguna de las dos es la que más mira el módulo. Lo que lo cambia
no es código, es que entren a Mi cuenta → Notificaciones y lo prendan — y es por
aparato, porque la clave de `push_suscripciones` es `(usuario_id, endpoint)`.

### El volumen

De 2530 órdenes hay **63 abiertas** y **34 atrasadas**. Cruzan a atrasadas entre
**1 y 7 por día**, casi siempre 1 o 2. Hay **20 abiertas con inicio futuro
repartidas en 9 días**. O sea: dos notificaciones por día como mucho, y la
mayoría de los días una o ninguna. Nombrar las órdenes entra sin problema.

### Lo que el aviso no va a poder destrabar

De las 34 atrasadas, **24 no se pueden reprogramar desde el SdG**: entraron por
el formulario y `postergar` sólo mueve las que creó el sistema (`app_created`).
De las 20 futuras, 12. El aviso las nombra igual —saber que vencieron sirve—
pero quien las corra de fecha lo hace en la planilla. **No se filtran**: callarse
sobre el 70 % de las atrasadas para que el botón siempre esté sería peor.

### El color

La ficha del calendario se pinta con el relleno de la especialidad. El contraste
de un rojo `#dc2626` **sobre** esos rellenos, medido:

| Especialidad | Relleno | Contraste del rojo |
|---|---|---|
| MECÁNICO | `#d97706` | 1,52:1 |
| ELÉCTRICO | `#2563eb` | 1,07:1 |
| CIVIL | `#16a34a` | 1,47:1 |
| LUBRICACIÓN | `#9333ea` | 1,11:1 |
| sin especialidad | `#6b7280` | **1,00:1** |

Una franja roja encima del relleno **no se ve**, y contra el gris es exactamente
el mismo tono de luz. Y no es un caso de borde: de las 21 abiertas de noviembre,
veinte son MECÁNICO. Esto obligó a dar vuelta la forma elegida (ver
Aproximaciones).

## Objetivos

1. **«Atrasada» pasa a significar «se le pasó la fecha» en todo Mantenimiento**,
   con una sola definición que usan el calendario, el tablero, el listado, la
   campana y los avisos nuevos.
2. **En el calendario del mes una OT atrasada se distingue de un vistazo**, sin
   perder de qué especialidad es.
3. **Dos días antes de que una OT arranque**, los cinco que administran
   Mantenimiento reciben un push que la nombra.
4. **El día que una OT se atrasa**, reciben un push que la nombra.

## No-objetivos

- **El correo.** Se pidió push explícitamente y se confirmó después de ver que
  hoy llega a dos personas.
- **La Agenda.** Su grilla muestra eventos de Google —con invitados y horario—,
  no el estado de una orden. Un evento de una OT atrasada no se pinta.
- **Asignar un responsable a la OT.** No existe hoy: `operario_1..3` son texto
  de la planilla y `quien` es INTERNO/CONTRATADO/MIXTO. El aviso va al grupo.
- **Reprogramar desde la notificación.** Lleva a la lista; mover la orden es el
  camino de `postergar` que ya existe, con justificación y auditoría.
- **Tocar el umbral de dos días.** Es lo que se pidió y no hay histórico contra
  el cual calibrar otro.
- **Sacar `proxima_fecha` de la sincronización.** Se sigue leyendo de la
  planilla; simplemente deja de decidir quién está atrasada. Borrarla es otra
  tarea y no hace falta para ésta.

## Anti-objetivos

Lo que haría fracasar esto aunque funcione:

- **Que alguien apague las notificaciones.** Es el riesgo medido de este repo: de
  13 personas, las dos únicas que probaron las notificaciones en serio tenían los
  trece avisos descartados. Por eso cada orden se nombra **una sola vez** y hay
  como mucho dos notificaciones por día.
- **Que el mismo hecho avise dos veces diciendo cosas distintas.** Si
  `mant-atrasadas` sigue en el canal de quince minutos, una misma orden produce
  «1 más · Órdenes de trabajo atrasadas» y además «Se atrasó la OT 2926».
- **Que dos pantallas vecinas digan números distintos.** El calendario pintando
  34 y el tablero diciendo 21 es la misma falla, adentro de un módulo. Es lo que
  obliga a unificar y no a agregar una definición más.
- **Que el rojo se confunda con el ámbar de MECÁNICO**, que es el 95 % de las
  abiertas.
- **Un push de estreno.** Las 34 atrasadas de hoy no se anuncian el primer día.
- **Un push el domingo.** Pedido explícito.

## Restricciones

- **Castellano** en todo: nombres, comentarios, mensajes.
- **El payload de un push es plano, `{title, body, url}`**, con la `url` en el
  primer nivel (`Aviso` de `lib/core/webpush.ts`).
- **Ventana 7:00–21:00 de Argentina** (`esHoraDeAvisar`), importada y no
  reescrita. Fuera de ella no se manda y no se encola.
- **Nada de leer el reloj del navegador**: el día de hoy sale de
  `hoyEnArgentina()`/`fechaEnArgentina`, UTC−3 fijo.
- **PostgREST corta en 1000 filas y no avisa**: `traerTodo()` donde la tabla
  pueda crecer (`ordenes_trabajo` tiene 2531).
- **Las utilidades de color pierden contra `globals.css`**: los colores van por
  `style`, que es lo que la ficha ya hace.
- **Sin migración.** Nada de esto necesita una columna nueva, a propósito: una
  migración la aplica una persona a mano y abre la ventana en la que el deploy
  ya salió y el SQL no corrió.
- **Hay un segundo despliegue** de este repo escribiendo en la misma base y
  programando los mismos crons (ver CLAUDE.md). Consecuencia asumida abajo.

## Aproximaciones

### Para el push

**A — Un cron propio, diario, que deriva todo de las fechas.** *(la elegida)*
Busca las órdenes abiertas que arrancan **en dos días** y las que **acaban de
cruzar** a atrasadas. Manda como mucho dos notificaciones, cada una nombrando
las órdenes.
*Gana:* no necesita acordarse de nada. La fecha es la memoria: una orden es
«en dos días» un solo día de su vida, y «cruzó» otro. Sin tabla, sin columna,
sin migración.
*Cuesta:* `mant-atrasadas` tiene que salir del canal de quince minutos.

**B — Un aviso por orden dentro del canal de quince minutos**, con ids
dinámicos tipo `mant-atraso-3145`, como ya hace `mant-ciclo-sospechoso-`.
*Gana:* el «una sola vez por orden» sale gratis de la memoria que ya existe
(`avisos_vistos`).
*Pierde:* la campana se llena de una entrada por orden —siete renglones de
«arranca en dos días»— donde hoy hay una que dice «7». La campana es un
inventario de pendientes, no un registro de eventos.

**Descartada — colgarlo del canal de quince minutos por conteo.** Era lo barato
y **no funciona para el de dos días**: ese canal manda sólo cuando el número
sube (`subio > 0` en `lib/home/novedadAlInstante.ts`) y compara contra el
vistazo anterior, que de mañana es el de las 20:56 de ayer. Si ayer arrancaban 7
órdenes «pasado mañana» y hoy arrancan 1, el delta es −6 y no sale nada. El
conjunto rota mientras el número no sube, y el recordatorio se queda mudo
justamente los días que tiene algo que decir.

**El usuario eligió A.**

### Para el rojo

Las tres que se le mostraron: la ficha entera roja perdiendo la especialidad;
una franja roja al costado conservándola; el fondo del día teñido. Eligió la
segunda, y al medirla se cayó (tabla de contraste arriba).

**La elegida es la segunda dada vuelta**, que conserva lo que se quería de ella
—leer las dos cosas a la vez— y además se ve: **el relleno pasa a ser rojo y la
especialidad se muda al borde**, que es la ranura que la ficha ya usa. Un
`#b91c1c` con texto blanco da **6,47:1**.

## Las decisiones tomadas

### La definición única de «atrasada»

En `lib/mantenimiento/alertas.ts`, `estaAtrasada` pasa a decidir así:

- **La orden está abierta**: su `estado` no es `REALIZADO` ni `CANCELADA`.
  (Igual que hoy.)
- **La marcó la planilla**: `estado === "ATRASADO"` sigue contando. (Igual que
  hoy, y hoy es lo único que cuenta.)
- **O su ventana entera quedó atrás**: `fecha_fin` —y si no la hay, la fecha de
  inicio efectiva— es anterior a hoy.

La **fecha de inicio efectiva** es `fechaParaElCalendario(o)`:
`fecha_ejecucion_pendiente` si la hay y si no `fecha_ejecucion`. Tiene que ser
esa función y no `fecha_ejecucion` a secas, porque una orden recién postergada
tiene la fecha nueva ahí y la vieja en la otra: mirar la vieja la daría por
vencida el mismo día en que alguien la corrió, y contradiría al calendario, que
pinta la pendiente.

**La ventana y no el inicio**, y esto resuelve dos cosas de un saque. Una orden
que arrancó ayer y termina el 25 está **en curso**, no vencida: hoy es una sola
(la OT 3108, `EN_PROCESO` hasta el 30/11). Y como `atrasada` se decide por orden
y viaja en cada día que ocupa —igual que `arrastre`—, mirar sólo el inicio
pintaría de rojo **celdas de días futuros**, diciendo «vencida» en un día que
todavía no llegó. Con la ventana eso no puede pasar: si el fin ya pasó, todos
sus días pasaron.

`proxima_fecha` **deja de decidir** y se sigue importando. Si algún día la
planilla la llena, no cambia nada acá: hay una sola fuente de fecha y es la de
ejecución.

**`diasDeAtraso` cuenta contra esa misma fecha de inicio efectiva.** Hoy devuelve
`null` siempre, porque lee `proxima_fecha`; el documento no puede prometer una
etiqueta con un número y entregar una constante.

### Lo que la unificación toca

Son cinco lugares que hoy dicen 21, más el enlace:

| Dónde | Qué cambia |
|---|---|
| `lib/mantenimiento/alertas.ts` | la definición, arriba. Sus tests cambian con ella: hoy las fixtures usan `proxima_fecha` |
| `app/(app)/mantenimiento/page.tsx` | la consulta `.or(estado.eq.ATRASADO, proxima_fecha.lt.…)` pasa a la fecha de ejecución, y el `select` tiene que traer `fecha_ejecucion`, `fecha_ejecucion_pendiente` y `fecha_fin` |
| `app/(app)/mantenimiento/ordenes/OrdenarTrabajo.tsx` | el badge «atrasada» pasa a verse en 34 filas; necesita los mismos campos |
| `lib/mantenimiento/prioridad.ts` | el desempate por atraso, que hereda la definición nueva sin tocarse |
| `app/(app)/mantenimiento/DashboardClient.tsx` | ahí `diasDeAtraso` empieza a dar un número en vez de `null` |
| `lib/home/avisosDeUsuario.ts` | el conteo `head("ordenes_trabajo").eq("estado","ATRASADO")` pasa a la condición nueva |

**El conteo de la campana necesita id nuevo.** Es la regla de CLAUDE.md: la
`cantidad` se compara contra la foto del día anterior y contra el vistazo
anterior, así que un salto de 21 a 34 con el id viejo sale como novedad falsa
del tamaño del salto, en la campana y en el push. El id pasa a ser
`mant-atrasadas-por-fecha`. El viejo queda huérfano en
`notificaciones_descartes`, que es inofensivo —nunca más coincide con nada— y
**no se reusa**.

**Y el enlace del aviso deja de ser verdad.** Hoy va a
`/mantenimiento/ordenes?estado=ATRASADO`, que muestra las 21. Si el aviso dice
34, el link tiene que mostrar 34, así que el listado necesita un filtro propio
—`?atrasada=1`, en `lib/mantenimiento/filtrosOt.ts`— y **no** un valor falso
dentro de `estado`, que es un vocabulario que espeja la planilla. Del lado de la
consulta se expresa sin inventar nada:

```
estado=not.in.(REALIZADO,CANCELADA)
and or(fecha_fin.lt.HOY,
       and(fecha_fin.is.null,fecha_ejecucion_pendiente.lt.HOY),
       and(fecha_fin.is.null,fecha_ejecucion_pendiente.is.null,fecha_ejecucion.lt.HOY),
       estado.eq.ATRASADO)
```

Es la pieza más grande de la unificación y la que conviene hacer primero, porque
es la que el push y la campana usan como destino.

### Quién recibe el push

Los cinco con `nivelEnModulo(...) === "admin"` en Mantenimiento, a **todos sus
aparatos**. Es la misma forma que `evaluaSyh` en `sinLoQueNoPuedeAtender`: lo
que decide es **quién puede hacer lo que el aviso pide**, y acá es reprogramar.

Se incluye a quien es `admin_sistema` con `lectura` explícita en el módulo
(Delfina Puch). Es lo que hace `nivelEnModulo` y lo que el repo ya decidió el
18/10/2026: «los administradores siguen recibiendo todo lo demás». Queda dicho
porque hay un precedente que empuja al revés —el destinatario del reclamo de
Compras sale del grant explícito y nunca de `nivelEnModulo()`— y la diferencia
es que aquél elige **una** persona a quien escribirle y esto es una difusión a
un grupo. Hoy no cambia nada: esa persona no tiene suscripción.

### Qué días y qué mira cada corrida

**El cron corre de lunes a sábado, nunca el domingo** (`0 11 * * 1-6`, o sea las
8:00 de Argentina). Pedido explícito, y además coherente con el anti-objetivo:
un push a las 8 de un domingo a dos personas que no van a reprogramar hasta el
lunes es exactamente cómo se pierde el permiso de notificar.

Saltear un día obliga a que las corridas de los bordes cubran lo que el domingo
no cubrió. **Las dos reglas siguen saliendo sólo de la fecha, sin memoria:**

| Corrida | «Se atrasó» mira el inicio en | «Arranca en dos días» mira el inicio en |
|---|---|---|
| martes a sábado | ayer | hoy + 2 |
| **lunes** | **sábado y domingo** | hoy + 2 |
| **sábado** | ayer (viernes) | **hoy + 2 y hoy + 3** (lunes y martes) |

El lunes cubre dos días porque el domingo no corrió y lo que cruzó el domingo
—las que arrancaban el sábado— no lo nombró nadie. El sábado cubre dos días
hacia adelante porque, si no, **el martes nunca recibe su aviso de dos días**: le
tocaría el domingo. Un aviso que sale tres días antes en vez de dos es aceptable;
uno que no sale, no.

La regla general, por si mañana se apaga otro día: cada corrida nombra lo que
cruzó desde la corrida anterior, y lo que arranca entre dentro de dos días y el
día siguiente a la próxima corrida.

### Qué es «se atrasó» y qué es «arranca en dos días»

Las dos se derivan de la misma fecha de inicio efectiva de arriba, sobre órdenes
**abiertas**.

- **Se atrasó** = su inicio efectivo cae en los días que la tabla de arriba dice,
  y no tiene `fecha_fin` futura. Una orden de varios días no «se atrasa» el día
  después de arrancar: se atrasa cuando su ventana termina.
- **Arranca en dos días** = su inicio efectivo cae en los días que la tabla dice.

**Lo que esta definición no ve, dicho:** una orden que la planilla marca
`ATRASADO` a mano sin que ninguna fecha haya cruzado no la nombra el push. Hoy
eso no existe —las 21 marcadas están todas adentro de las 34 por fecha—, pero
podría. Sigue contada en la campana. Y una orden creada hoy que arranca mañana
nunca recibe el aviso de dos días: no hubo un día en que faltaran dos.

### Lo que sale del canal de quince minutos

El aviso de atrasadas se agrega a `YA_AVISA_SOLO` en
`app/api/cron/avisos-al-instante/route.ts`, exactamente como
`compras-por-aprobar`. **Sigue en la campana y en el resumen de los lunes**: lo
que se quita es el push de movimiento, que diría lo mismo con otro número.

`mant-divergencias` no se toca.

### Qué dicen las notificaciones

Una por corrida y por persona, nunca una por orden. Con una sola se la nombra
entera; con varias, las tres primeras y «y N más», que es la forma que ya usan
los otros emisores.

```
Se atrasó una orden de trabajo
OT 2926 · Planta filler 1 — Revisión sinfín de retorno

2 órdenes de trabajo se atrasaron
OT 2926 (Planta filler 1), OT 3074 (Planta filler 1)

Una orden de trabajo arranca en dos días
OT 3081 · Planta filler 2 — Realizar parches en ciclón

5 órdenes de trabajo arrancan en dos días
OT 3145 (Hidratación), OT 3147 (Planta filler 1), OT 2486 (Planta filler 1) y 2 más
```

El de atrasadas lleva `url: "/mantenimiento/ordenes?atrasada=1"`. El de dos días
lleva `/mantenimiento/ordenes`: la pestaña «Mes» del calendario **no es
direccionable por URL** —es estado local del cliente—, así que no hay a dónde
apuntar que muestre el día. **No se manda nada cuando no hay nada.**

### El rojo, con precisión

En la ficha del calendario (`CalendarioDeOT`), por `style`:

| | Relleno | Borde | Texto |
|---|---|---|---|
| normal | especialidad | `1.5px solid` especialidad | `textoSobreLaEspecialidad` |
| normal, arrastre | blanco | `1.5px dashed` especialidad | `#0f172a` |
| **atrasada** | **`#b91c1c`** | `1.5px solid` especialidad | blanco (6,47:1) |
| **atrasada, arrastre** | blanco | `1.5px dashed` `#b91c1c` | `#b91c1c` |

En la fila de arrastre atrasada se pierde la especialidad, a propósito: en una
ficha de 46 px no entran dos colores y una trama, y «está vencida» importa más
que «es mecánica».

En el **panel del día** —que se abre al tocar una celda y ahí sí hay lugar para
texto— la orden atrasada lleva una etiqueta roja con los días de atraso
(`diasDeAtraso`), o «Atrasada» a secas si no se sabe desde cuándo. La leyenda de
especialidades suma una entrada roja, «Atrasada».

El rojo aparece en **las tres pantallas** que usan el componente —el alta de una
OT, la pestaña «Mes» de Programación y la de Planificación—, y es deliberado: al
elegir la fecha de una orden nueva, ver qué hay vencido ese día es justamente lo
que ayuda a no amontonar.

**Dato que conviene saber antes de esperar mucho del rojo:** 18 de las 34
atrasadas tienen su inicio anterior al 26/10, así que **no caen en la grilla de
noviembre en ningún día**. El rojo alcanza a 16 de las 34 en el mes corriente;
las otras se ven en la lista, que es para lo que está el filtro nuevo.

### Dónde vive el cálculo

`atrasada` se calcula en `armarElCalendario` —función pura, con tests— y viaja
como un campo más de cada orden del día, igual que `arrastre`. Dos razones: se
decide contra la **ventana verdadera** y no contra el día de la celda, que es
distinto en las fichas de arrastre; y la pantalla no tiene que volver a razonar
sobre fechas. Esa función hoy no recibe `hoy`: pasa a recibirlo.

### El cron

Ruta nueva, `app/api/cron/mantenimiento-recordatorios`, con `revisarElSecreto`,
`maxDuration = 300` y `traerTodo()`, como las dieciséis que ya hay. En
`vercel.json`, `0 11 * * 1-6`.

El envío vive en `lib/mantenimiento/recordatorioDeOT.ts` y **no** se le agrega un
caso a `lib/core/avisoAlInstante.ts`. Ese archivo es el portón de las tres
condiciones, dice «hoy las cumplen dos cosas y nada más», y eso tiene que seguir
siendo verdad; es la misma razón por la que `lib/agenda/avisoDeDivergencia.ts`
vive aparte. Igual que aquél, este emisor **no cumple la condición 2** —nada se
frena hasta que alguien reprograme— y se manda porque se pidió. **Hay que
anotarlo en el renglón de `avisoAlInstante.ts` que lleva la cuenta de los
emisores de afuera**, y en la sección de avisos de CLAUDE.md, donde el payload
pasa a tener seis emisores.

### Riesgos asumidos

- **Le llega a dos personas.** Medido arriba. No es un defecto del diseño.
- **El segundo despliegue programa este cron también**, así que un día puede
  salir el push dos veces. Es la misma exposición que ya tienen `avisos_fotos` y
  `avisos_vistos`, y no se frena con `esLaCorridaCanonica()` por lo mismo que
  decidió el cron de las novedades: un falso negativo ahí lo dejaría mudo para
  siempre y en silencio, que es peor. La defensa de verdad es apagar ese
  despliegue.
- **Si el cron se muere, nadie se entera.** Los cuatro crons de push de este
  repo —el semanal, el de las novedades, Remises y novedades de RRHH— **no
  escriben en `sincronizaciones`**, así que ninguno está en el `REGISTRO` de
  salud. Éste sigue la convención en vez de monitorearse solo, que sería
  arreglar un quinto del problema y dejar la inconsistencia. Lo que amortigua:
  el aviso de atrasadas sigue en la campana y en los lunes. **Monitorear los
  cinco es trabajo aparte y queda anotado.**
- **El día del cambio, el badge «atrasada» aparece en trece filas más y el
  tablero sube de 21 a 34.** Es el objetivo, pero alguien lo va a notar: el id
  nuevo del aviso evita que además salga como un push de «13 más».
- **La primera corrida no anuncia las 34 atrasadas de hoy**, por construcción:
  mira sólo las que cruzaron ayer. Es lo que se quería.

## Lo que queda a criterio de quien lo construya

- Cómo se recorta la descripción y el sector en el cuerpo del push (hay
  precedente: 60 caracteres en los otros emisores).
- Si las dos notificaciones del día salen como dos envíos o uno combinado cuando
  caen juntas. El diseño dice dos, por ser acciones distintas —«reprogramá» y
  «prepará»—; juntarlas es aceptable siempre que el texto distinga las dos
  listas.
- El tono exacto del rojo de la etiqueta del panel, mientras pase 4,5:1.
- Si el filtro `?atrasada=1` se dibuja como un botón del encabezado del listado
  o como una opción más del panel de filtros.

## Cómo se comprueba

- `npm test` — la definición nueva de `estaAtrasada` (la ventana, la pendiente
  que le gana a la de la planilla, la que sigue en curso), `armarElCalendario`
  marcando atrasada contra la ventana y no contra el día de la celda, las dos
  selecciones por fecha **con los tres casos de día** (martes a sábado, lunes,
  sábado), y los textos de las notificaciones con una, con varias y con ninguna.
- `npm run tipos` y `NODE_OPTIONS=--max-old-space-size=8192 npm run build`.
- `node scripts/revisar-responsive.mjs` — hoy da ROMPE 0 · APRETADO 0 · MIRAR 1,
  y ese 1 es la tabla de `calidad/ensayos/reporte` que ya estaba en `main`.
- `node scripts/revisar-arbol-commiteado.mjs` antes de dar la tarea por buena.
- Contra producción, sin mandar nada: correr las dos selecciones por fecha y
  comprobar que al 19/11/2026 dan lo que dice la medición de arriba —34
  atrasadas, 21 de ellas marcadas por la planilla, y los catorce inicios de los
  próximos cinco días—.
