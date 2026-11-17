# Las OT van solas al calendario — diseño acordado

**Fecha:** 04/11/2026
**Estado:** acordado con el usuario, sin empezar
**Antecesor:** [2026-10-30-agenda-y-google-calendar-design.md](2026-10-30-agenda-y-google-calendar-design.md) ·
[docs/AGENDA.md](../../AGENDA.md)

---

## Por qué

La Agenda salió a producción el 03/11/2026 y funciona: catorce canales de Google
abiertos, el barrido corriendo, el primer evento creado desde la pantalla. Pero
una OT llega al calendario **sólo si alguien aprieta «Mandar al calendario» y
elige un turno**, de a una.

Eso fue una decisión de alcance, no un olvido: en octubre se midió que el
alimentador automático (programación del taller, mantenimientos programados,
planificación diaria) no tenía datos, y se arrancó por lo manual.

Lo que cambió es **para qué lo quiere el usuario**. No es «ver lo que ya decidí»
sino **decidir**: al cargar una OT nueva quiere ver el calendario de los días
que vienen, con lo que ya está asignado, para elegir dónde ponerla. Dicho por
él: «que no se superpongan tareas del mismo tipo el mismo día, ver dónde
ubicarlas».

Eso convierte al calendario en una herramienta de planificación, y una
herramienta de planificación que hay que llenar a mano, de a una, no se usa.
De ahí las dos mitades de este trabajo: **que las OT entren solas** y **que al
elegir la fecha se vea qué hay**.

---

## Lo que se midió, y que es lo que define el diseño

Todo contra producción el 04/11/2026. Estas mediciones no son color: cada una
mató o cambió una idea.

### 1. Las OT se cargan hacia atrás — el 73,6% documenta lo ya hecho

De las 780 órdenes de los últimos 90 días, la distancia entre la fecha de alta y
la de ejecución:

| | |
|---|---|
| **Ejecución anterior al alta** | **574 — 73,6%** |
| El mismo día | 123 — 15,8% |
| 1 a 3 días después | 43 — 5,5% |
| 4 a 7 días | 18 — 2,3% |
| 8 a 30 días | 16 — 2,1% |
| Más de 30 días | 6 — 0,8% |

Y mirando el **momento real de carga** de las 151 que se cargaron en el SdG
(`created_at_app` contra `fecha_ejecucion`): 121 tenían la ejecución ya pasada,
17 ese mismo día, 13 en el futuro.

**Mató la idea de «toda OT nueva genera evento».** Nueve de cada diez serían un
evento en el pasado, cada uno con invitación a cinco personas por algo que ya se
hizo. De ahí el freno del apartado «Cuándo nace un evento».

Y corrige lo que se creía: **las 780 tienen fecha de ejecución, el 100%**. Lo
raro no es que falte la fecha, es que apunte al futuro.

### 2. El sistema no puede mover la fecha de una OT del formulario

`app/api/mantenimiento/ordenes/[id]/postergar/route.ts` contesta **400** si
`app_created` es falso. No es un capricho: la fecha de esas OT vive en la
pestaña que maneja Google Forms, y escribir ahí **corrió la OT 2796 dos filas el
16/10/2026**.

| | |
|---|---|
| OT creadas en el SdG | 151 de 2410 — **6%** |
| Últimos 90 días | 151 contra 629 del formulario — **19%** |
| De las 21 futuras mandables hoy | **7 del SdG, 14 del formulario** |

**Cambió la regla de la planificación.** «El plan manda y le cambia la fecha a la
OT» sólo se puede cumplir en un tercio de los casos.

### 3. Casi todo es MECÁNICO

| especialidad | | tipo | | quien | |
|---|---|---|---|---|---|
| MECÁNICO | 1764 | PROGRAMADO | 1435 | INTERNO | 1792 |
| ELÉCTRICO | 358 | CORRECTIVO | 974 | CONTRATADO | 617 |
| CIVIL | 279 | *(vacío)* | 1 | *(vacío)* | 1 |
| LUBRICACIÓN | 8 | | | | |
| *(vacío)* | 1 | | | | |

De las 21 órdenes abiertas de noviembre, **veinte son MECÁNICO y una es CIVIL**.

**El color por especialidad pinta un mes casi monocromo.** Se construye igual
—lo pidió el usuario y es la dimensión correcta: misma especialidad es misma
gente—, pero el builder tiene que saber que **lo que distingue un día de otro es
la cantidad, no el color**, y por eso el conteo tiene que leerse sin contar
fichas.

### 4. El padrón del taller está vacío

`mant_personal_taller` tiene **0 filas**, `mant_programacion_referencia` **0** y
`mant_programacion_pisadas` **0**. La programación del taller se construyó en
octubre de 2026 y nadie la llenó.

**Define cómo se muestra la disponibilidad.** La cuenta de gente disponible daría
cero para todos los días y todos los oficios, **sin ningún error**. Hay que
distinguir «nadie» de «no sé», que es el mismo principio de «enlazar al que se le
parece es peor que dejar en null».

### 5. El vocabulario no coincide

El padrón tiene tres oficios —`mecanico`, `electricista`, `lubricador`— y la OT
cuatro especialidades. **CIVIL no tiene oficio en el taller**: son 279 órdenes
que se hacen con contratistas o albañilería.

### 6. La planificación diaria existe y casi no se usa

`planificacion_diaria` tiene **3 planes** (29/10 al 03/11/2026) y
`planificacion_diaria_items` **4 ítems**. Cada ítem copia de la OT el número, la
especialidad, el sector, el equipo, la descripción y **su propia copia editable
de `fecha_ejecucion`, que nunca vuelve a la OT**. Tiene además `assigned_to` /
`assigned_name`, hoy nulos en los cuatro.

`add_item` **no exige que la fecha del ítem coincida con la del plan**.

---

## Objetivos

1. Que una OT con fecha de ejecución futura llegue al calendario **sin que nadie
   apriete nada**, venga del SdG o del formulario.
2. Que al elegir la fecha de ejecución de una OT nueva **se vea qué hay esos
   días**, filtrable por especialidad, tipo y quién realiza.
3. Que dos órdenes de la misma especialidad **no caigan a la misma hora**.
4. Que una planificación diaria se pueda mandar al calendario, entera o por
   ítem.
5. Que las 21 órdenes abiertas con fecha futura que ya existen entren hoy.

## No objetivos

- **Alimentar el calendario desde los mantenimientos programados o desde la
  programación del taller.** Sigue fuera, como en octubre. **Esto quiere decir
  que no se leen `mantenimientos_programados` ni la programación como fuente de
  eventos** — no que una OT nacida de un mantenimiento programado sea distinta.
  Una OT es una OT venga de donde venga, y el enganche va en un solo lugar
  compartido para que ninguna puerta quede con otra regla. Medido el
  04/11/2026: hay **un** mantenimiento programado en todo el sistema y generó
  **una** orden, con la ejecución ya pasada. El riesgo de que esa puerta
  produzca una ráfaga es hoy nulo, y si mañana alguien carga cincuenta, que
  entren es lo correcto.
- **Cargar el padrón del taller.** Es trabajo del usuario, desde
  `/mantenimiento/programacion`. El sistema tiene que decir que falta, no
  llenarlo.
- **Asignar personas a una OT.** `assigned_to` de la planificación existe y está
  vacío; no se toca.
- **Cambiar qué es una divergencia.** Siguen siendo sólo borrado y movido.
- **Resolver la sexta orden de una especialidad en un día.** Dicho por el
  usuario: «por ahora olvidate».

## Anti-objetivos — esto sería un fracaso aunque funcione

- **Que la gente apague las notificaciones.** Es el riesgo central: pasar de ~1
  evento manual por semana a eventos automáticos con cinco invitados cada uno.
  El freno de la fecha pasada existe por esto.
- **Que el calendario y la OT digan cosas distintas sin avisar.** Es lo que el
  módulo pasó semanas arreglando. Ninguna parte de esto puede crear un evento
  que deje de seguir a su orden.
- **Que una cuenta dé cero porque no hay datos y parezca que no hay gente.**
- **Que escribir en la planilla del formulario corra filas.** Ya pasó con la
  2796.

---

## Lo que decidió el usuario

Diecisiete decisiones, en sus palabras donde se puede.

### Sobre la carga automática

1. **«Las que tengan fecha de ejecución, que se carguen ahora en el calendario.»**
   Las 21 abiertas con fecha de hoy en adelante entran de una vez.
2. **«Una vez generada una nueva OT, si tiene fecha de ejecución que se cargue
   automáticamente.»**
3. **«Las dos, también las del formulario.»** Preguntado explícitamente si valía
   sólo para las altas del SdG o también para las 629 de cada 90 días que entran
   por el formulario de Google: las dos.
4. Aceptó el freno propuesto: **el evento se crea sólo si la fecha de ejecución
   es hoy o más adelante.**
5. Avisado de que cargar las 21 manda ~100 invitaciones juntas, siguió adelante.

### Sobre el horario

6. **«Que arranque a las 8, ya que es lo más visual.»** Las órdenes automáticas
   no preguntan turno: van al de 8–16.
7. **«Que 2 de la misma especialidad arranquen y terminen a la misma hora»** es
   el problema a evitar. Dos de la misma especialidad se apilan en el tiempo: la
   segunda hora y media después de la primera.
8. Dos de **especialidades distintas sí van a la misma hora**, porque las hace
   otra gente.
9. **«Por la sexta especialidad, por ahora olvidate.»** Sin tope: la sexta se
   sigue apilando aunque pase el fin del turno.

### Sobre la planificación

10. **«Que el plan mande y le cambie la fecha a la OT.»**
11. Enfrentado con que eso está bloqueado para las del formulario, eligió la
    opción 2: **se mandan en la fecha de la OT, avisando de la diferencia.**

### Sobre el calendario al elegir la fecha

12. **«C, aunque b también me gusta.»** Fichas con el número de OT.
13. **«Si hago click en la OT o en el globo de cantidad de OT en el día, me abra
    un resumen de qué OT están programadas y en qué sectores.»**
14. **«Cada OT lleve un color distinto según la especialidad.»**
15. Filtros por **Especialidad, Tipo y Quién realiza**.
16. Lo que mira para decidir si un día está lleno: **«la cantidad de tareas y si
    hay gente disponible».**
17. Aceptó que la columna de disponibles aparezca recién cuando cargue el padrón.

### Las cuatro que contestó después de la revisión de constructor

18. **En la sincronización, genera evento cualquier OT con fecha futura y sin
    evento**, no sólo las que aparecen por primera vez. Elegida sabiendo que
    pide un freno en la primera corrida y un tope por corrida.
19. **Va una razón de postergación nueva, «Planificación del día»**, aun
    sabiendo que puede pedir que corra algo a mano. Descartó explícitamente usar
    «Falta de repuesto» prestada.
20. **«Gente disponible» es quién está ese día, en cualquier turno**, al saber
    que contar por turno daría cero mecánicos para siempre.
21. **`fecha_fin` se usa sólo en la grilla**: la OT se pinta en todos los días de
    su ventana, y el evento sigue siendo uno de 1:30. Sabiendo que eso pide
    traer esa fecha a la base.

---

## Lo que decidí yo

El usuario no las pidió; las marco aparte para que se puedan rechazar sin
desarmar lo acordado.

- **La justificación al correr la fecha desde el plan la escribe el sistema:**
  «Movida al plan del 06/11/2026». La ruta de postergar exige una nota y esa
  nota va a la planilla, a la columna de observación previa. Un texto automático
  es preferible a un campo libre que nadie va a llenar bien, pero deja prosa
  generada en la planilla de producción.
- **Un evento ya creado no cambia de hora** aunque después se agreguen otras
  órdenes del mismo día y especialidad. Reordenar le avisaría a cinco personas
  que algo cambió, por nada.
- **Una OT cerrada nunca genera evento**, igual que hoy el botón manual
  (`laOTEstaCerrada`: `fecha_cierre` **o** estado REALIZADO).
- **Para CIVIL la disponibilidad dice «no lleva gente del taller»** y no cero. Es
  la aplicación de «decirlo es mejor que inventarlo».
- **El orden de apilado es el de creación del evento**, no el número de OT ni la
  prioridad. Es el único orden estable que no cambia al llegar una orden nueva.
- **La carga de las 21 es un script de una sola vez**, no una migración ni un
  cron: se corre, se mira, y no queda código vivo que pueda volver a dispararse.
- **El arranque se topea a las 20:00** y de ahí en adelante se comparte hora con
  un `aviso`, en vez de dejar que la cuenta pase de la medianoche y la orden se
  quede sin evento sin que nadie se entere.
- **La grilla cuenta órdenes y el apilado cuenta eventos.** Son dos conjuntos
  distintos y mezclarlos sería cómodo y falso.
- **Un enganche compartido para las cinco puertas** que insertan una OT, en vez
  de dos enganches en los dos lugares nombrados.
- **Si no se puede resolver el dueño en un proceso sin pantalla, se usa la
  casilla del área y se sigue**, en vez del 409 de la ruta manual.

---

## Cómo funciona

### Cuándo nace un evento

Un evento de OT se crea cuando se cumplen **todas**:

1. La orden tiene fecha de ejecución (`fechaParaElCalendario`, que prefiere
   `fecha_ejecucion_pendiente` cuando la hay).
2. Esa fecha es **hoy o posterior**, en hora de Argentina.
3. La orden **no está cerrada** (`laOTEstaCerrada`).
4. La orden **todavía no tiene evento**.

Da igual si entró por el SdG o por el formulario.

**Un solo enganche, llamado desde todas las puertas.** Hay cinco lugares que
insertan una OT: el alta del SdG (`lib/mantenimiento/altaDeOT.ts` y su ruta), la
sincronización del formulario (`lib/mantenimiento/sincronizar.ts`), el generador
de periódicas (`lib/mantenimiento/generarPeriodicas.ts`), el cuaderno de un
contratista y los partes de contratista. Las cinco pasan por la misma función,
y las cuatro condiciones de arriba deciden. Dos enganches con dos criterios es
cómo una puerta queda con otra regla sin que nada avise.

**En la sincronización, «nueva» no quiere decir «fila que apareció hoy.»** El
importador no distingue inserciones de actualizaciones: arma `registros` con
todas las filas de la planilla y hace `upsert` con `onConflict: "ot_number"` en
lotes de 500. Y aunque se pudiera distinguir, no alcanzaría: con el 73,6% de las
órdenes cargándose hacia atrás, la forma normal del caso que el usuario quiere
resolver es **una OT que ya existía y a la que después le ponen o le mueven la
fecha al futuro en la planilla**. El barrido nocturno no la rescata, porque sólo
mueve eventos que ya existen.

Así que la regla es, después de cada sincronización: **toda OT con fecha de
ejecución de hoy en adelante, no cerrada y sin evento, recibe uno.**

Eso necesita dos frenos, y son parte del diseño y no un detalle:

1. **La primera corrida no puede duplicar el script de arranque.** Las mismas 21
   órdenes son candidatas de los dos lados; ~200 invitaciones en vez de ~100.
   Correr el script primero y que la sincronización no encuentre nada es lo
   ordenado, pero depender del orden en que alguien hace dos cosas es
   exactamente lo que falla: la condición «sin evento» tiene que ser la
   garantía, comprobada contra la base en el momento, no una suposición.
2. **Un tope por corrida.** Una edición masiva en la planilla —o alguien que
   arrastra una columna de fechas— convertiría una tarde en una ráfaga de
   invitaciones. Es el mismo argumento que «una notificación por corrida, no una
   por ítem». Si en una corrida hay más candidatas que el tope, se mandan las
   primeras por fecha y **se dice cuántas quedaron**, que el cron retoma.

Lo que no puede pasar: que un fallo al crear el evento **haga fallar el alta de
la OT o la sincronización**. La orden es lo importante; el evento es el espejo.
Un fallo se anota como pendiente (`google_pendiente`, el mecanismo que ya existe)
y lo reintenta el cron de la Agenda.

**Si no se puede resolver el dueño**, la ruta manual contesta 409 — que en un
cron no lo lee nadie. Acá se usa la casilla del área y se sigue; quedarse sin
evento por no saber de quién es, en un proceso sin pantalla, es peor.

### Dónde cae en el día

- Arranca a las **08:00** y dura **1:30** (`DURACION_OT_MINUTOS`, ya existe).
- Si ya hay **N** eventos de OT de **la misma especialidad** ese mismo día, el
  nuevo arranca a las `08:00 + N × 1:30`: 08:00, 09:30, 11:00, 12:30, 14:00…
- Órdenes de **especialidades distintas comparten hora** sin problema.
- Sin tope de cantidad, pero **sí un tope de reloj**: el arranque no pasa de las
  **20:00**, el fin del último turno. De la décima en adelante comparten esa
  hora y el evento se marca con un `aviso` para que alguien lo vea. El motivo
  es que `08:00 + N × 1:30` llega a 24:30 en la undécima, y ahí `instanteDe` la
  rechaza y `problemasDelEvento` la convierte en error: la orden se quedaría
  **sin evento, en silencio**. «Por la sexta, olvidate» era no resolver el
  desborde, no dejar una OT sin su espejo.
- El cálculo se hace **una sola vez, al crear**. Si después se borra una del
  medio queda un hueco, y está bien.
- Cuando el barrido nocturno mueve un evento porque cambió la fecha de la OT
  (`seguirALasOT`, ya existe), **recalcula el hueco en la fecha nueva**.

`horarioDeLaOT(fecha, turno)` hoy devuelve una hora fija por turno. Necesita
aceptar un desplazamiento, o nace una función al lado. La que quede tiene que
seguir armando las cadenas **sin `Date`**, por lo que ya dice su docstring: el
servidor corre en UTC y una `Date` metería su zona en una hora de pared.

### Dueño e invitados

Sin cambios respecto del botón manual: el dueño es la casilla que generó la
orden y si no se puede saber —las del formulario no tienen autor— cae en la
casilla del área (`elegirElDuenoDeLaOT`, `CASILLA_DE_MANTENIMIENTO`). Los cinco
invitados de `INVITADOS_DE_UNA_OT`.

### Desde la planificación

Dos acciones en `/mantenimiento/planificacion/[id]`: un botón para **el plan
entero** y uno **por ítem**.

Para cada ítem, comparando la fecha del plan con la `fecha_ejecucion` de la
orden de verdad (no la copia del ítem):

| Caso | Qué pasa |
|---|---|
| Coinciden | Se manda, sin más. |
| El plan es **posterior** y la OT es `app_created` | **El plan manda**: se le corre la fecha a la OT por la ruta de postergar —que escribe primero la planilla, anota `fecha_ejecucion_pendiente` y lo audita— y después se manda el evento. |
| El plan es **anterior** a la fecha de la OT | **Se manda en la fecha de la OT**, avisando. Postergar sólo va hacia adelante y adelantar una fecha no es postergarla. |
| Difieren y la OT vino del formulario | **Se manda en la fecha de la OT**, y la pantalla dice que el plan decía otro día y por qué no se pudo mover. |
| La OT está cerrada | No se manda; se dice. |

**Hace falta una razón de postergación nueva.** `loQueFaltaParaPostergar` exige
una `razon` del catálogo `mant_razones_de_postergacion`, que hoy tiene **una
sola fila**: `falta_repuesto` / «Falta de repuesto en planta». Usarla acá
escribiría un motivo falso en la auditoría y en la columna de observación previa
de la planilla de producción. Va una fila nueva, `planificacion_del_dia` /
«Planificación del día». Es DML sobre un catálogo, así que se puede aplicar por
PostgREST sin migración — **hay que comprobar antes que `razon` no esté además
atada por un enum o un check**, en cuyo caso sí la necesita y la corre una
persona.

Y la justificación que acompaña, que también exige la ruta, la escribe el
sistema: «Movida al plan del 06/11/2026».

Mandar el plan entero informa **por ítem** qué pasó con cada uno. Un fallo en uno
no cancela los demás.

### El calendario al elegir la fecha

Vive donde hoy está el campo de fecha de ejecución del alta de OT, y se abre al
tocarlo.

**La grilla muestra órdenes, no eventos.** Es una vista del trabajo
planificado: se lee de `ordenes_trabajo` por fecha, y los filtros son atributos
de la orden. Una OT sin evento —cerrada, pasada, anterior a esta función—
aparece igual, porque para decidir dónde poner la próxima importa el trabajo que
hay, no lo que llegó a Google. **El apilado de horarios, en cambio, cuenta
eventos**, que es lo único que puede chocar en el calendario. Son dos conteos
distintos a propósito y la pantalla no tiene que insinuar que son el mismo.

**Cada día muestra hasta tres fichas** con el número de OT, pintadas por
especialidad; la cuarta en adelante se agrupa en **«+N más»**. El corte en tres
es por el teléfono: con 343 px de ancho útil cada día mide 46 px, y cinco fichas
empujan la grilla entera.

**Una OT con ventana ocupa todos sus días.** Desde el 04/11/2026 el alta pide
`fecha_fin`, la fecha de fin estimada. Una orden que va del lunes al miércoles
aparece en los tres días de la grilla, porque si sólo se pintara el lunes el
martes se vería vacío y la decisión que el usuario toma es justamente «cuántas
hay ese día». **El evento de Google sigue siendo uno solo, de 1:30, el día de
inicio**: la ventana es para mirar, no para reservar.

Eso tiene una dependencia que hay que resolver antes: **`fecha_fin` no es
columna de `ordenes_trabajo`**. Hoy la ruta de alta la manda sólo a la planilla,
con un comentario que dice que mandársela a PostgREST corta el insert entero.
Para pintarla hay que traerla a la base: una columna nueva, el alta
escribiéndola también ahí, y el importador leyéndola de la planilla. Las órdenes
viejas quedan sin ella, y una ventana vacía quiere decir «dura un día» —no que
falte—, que es la misma convención que el `fecha_hasta` del cuaderno.

**Los filtros**, arriba: especialidad, tipo y quién realiza. Filtran lo que se
pinta, no lo que existe.

**El día abierto.** Click en una ficha, en el «+N más» o en el día abre el
resumen: la cuenta de órdenes, **la cuenta por sector** arriba de todo, y después
cada orden con su número, su descripción, su equipo, su sector y sus etiquetas
de tipo y quién. Abajo, el botón que elige ese día.

La cuenta por sector está arriba porque es lo que salta: el viernes 6 tiene cinco
órdenes, y lo que importa es que **dos caen en Planta de trituración 1**.

**La columna de gente disponible.** Sale de la programación del taller
(`lib/mantenimiento/programacion.ts` y `disponibilidad.ts`, ya construidas y con
tests), cruzando el oficio con la especialidad:

| especialidad de la OT | oficio del padrón |
|---|---|
| MECÁNICO | `mecanico` |
| ELÉCTRICO | `electricista` |
| LUBRICACIÓN | `lubricador` |
| CIVIL | **ninguno** — dice «no lleva gente del taller» |

**Cuenta quién está ese día, en cualquier turno** — no quién está en el turno
del evento. La diferencia no es cosmética: los grupos A y B rotan entre 4–12 y
12–20 y **nunca van a 8–16** (está escrito en el encabezado de
`programacion.ts`); sólo los tres electricistas pasan por ese turno, de a uno.
Como los eventos caen a las 08:00 por decisión del usuario, contar por turno
daría **cero mecánicos para siempre** — y mecánico son 1764 de 2410 órdenes y 20
de las 21 abiertas de noviembre. Sería el anti-objetivo de este diseño escrito
por su propia cuenta.

Ninguna de las dos funciones que ya existen devuelve esto: `disponibilidad.ts`
contesta «quién puede tapar *este* hueco en *este* turno»
(`candidatosParaElHueco`). Hace falta una cuenta nueva por día y oficio, armada
con las mismas piezas: el padrón vigente, el ciclo, las pisadas, las ausencias y
los francos por `fecha_descanso`.

Y mientras `mant_personal_taller` esté vacío, **dice que el padrón está sin
cargar**. Nunca cero.

### Las 21 de arranque

Un script en `scripts/`, de una sola vez, que manda las órdenes abiertas con
fecha de ejecución de hoy en adelante, aplicando las mismas reglas de horario.
Tiene que poder **correrse en seco** primero, imprimiendo qué haría, porque la
corrida de verdad manda ~100 invitaciones.

---

## Restricciones

- **Castellano** en todo: nombres, comentarios, pantallas, commits.
- **PostgREST corta en 1000 filas**: `traerTodo()` en cualquier lectura de
  órdenes.
- **Una policy nueva llama a su función envuelta**, salvo que reciba una columna
  de la fila.
- **`<Select>` y no `<select>`**; `grid-cols-1 sm:grid-cols-3`; el ancho va en un
  `div` que envuelva al campo y no en el `.input`.
- **La migración la corre una persona** a mano en el editor SQL de Supabase. Si
  hace falta una, hay que decirlo y esperar.
- **Nunca `git add -A`**: puede haber otra sesión en el mismo árbol.
- **Toda ruta que toque un campo que se exporta tiene que exportar**, o dejar el
  pendiente anotado. Correr la fecha de ejecución toca la planilla.
- **El presupuesto de Google del cron** ya está repartido entre cinco
  sincronizaciones; lo que se agregue no puede comerse el de las otras cuatro.

---

## Lo que depende de una persona, y bloquea

Hay que decirlo al empezar, no al chocarse:

1. **La columna `fecha_fin` en `ordenes_trabajo`.** Es DDL: la escribe un agente
   y **la corre el usuario a mano en el editor SQL de Supabase**. Sin ella la
   grilla no puede pintar la ventana, que es la decisión 21. Todo lo demás se
   puede construir y probar sin esto.
2. **La razón `planificacion_del_dia`.** Probablemente DML aplicable por
   PostgREST; si `razon` está atada por un enum o un check, es DDL y la corre el
   usuario. **Comprobarlo es el primer paso de esa tarea**, no una sorpresa de
   la última.
3. **El padrón del taller.** `mant_personal_taller` está vacío. No bloquea nada
   —la columna de disponibles dice que falta—, pero hasta que el usuario cargue
   las personas y la semana de referencia, la mitad de la decisión 16 no se
   puede ver funcionando ni comprobar contra datos reales.

## Qué queda para quien lo construya

- **Dónde exactamente vive el selector de fecha** en el alta de OT, y si se
  reusa en el PATCH de la fecha o sólo en el alta.
- **Si hace falta una columna** para el hueco del día o alcanza con derivarlo de
  `inicio`. Derivarlo es menos estado; una columna es más fácil de depurar.
- **Qué pasa si dos OT se crean en el mismo instante** y toman el mismo hueco.
  Con ~1 evento por día el riesgo es bajo, pero hay que decidirlo a propósito y
  no por omisión.
- **Cuál es el tope por corrida** de la sincronización. Tiene que ser más alto
  que un día normal (hoy ~8,7 altas diarias, de las que pocas son futuras) y más
  bajo que una pegada de columna.
- **Cómo se lee la disponibilidad desde el selector** sin pagar una consulta
  pesada por cada mes que se mira.
- **Cuánto del presupuesto de Google** (`LIMITE_DE_GOOGLE_MS`, 30 s hoy
  repartidos entre borrado y movido) puede tomar el paso de creación dentro de
  la sincronización de Mantenimiento, que ya reparte su tiempo entre cinco.
- **El texto exacto** de cada aviso de pantalla.
- **Si el botón manual «Mandar al calendario» sobrevive** ahora que las OT
  entran solas. Probablemente sí, para elegir turno y sumar invitados.

---

## Cómo se verifica

```bash
npm test
npx tsc --noEmit
npm run build
node scripts/revisar-arbol-commiteado.mjs
node scripts/revisar-responsive.mjs
node scripts/revisar-exportaciones.mjs
```

`revisar-exportaciones` importa especialmente acá: correr la fecha de ejecución
desde el plan es una escritura a la planilla y tiene que quedar declarada.

Lo que **no** se puede verificar sin una persona: que el selector se vea bien en
un teléfono de verdad, y que las ~100 invitaciones de la carga inicial lleguen
donde tienen que llegar.
