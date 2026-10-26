# Mantenimiento — disponibilidad del taller y programación semanal de turnos

Acordado el 22/10/2026 con el encargado. Medido contra la base real y cerrado el
23/10/2026. Construido entre el 23 y el 26/10/2026: lo que quedó
escrito del resultado está en la sección "La programación semanal del taller" de
[MANTENIMIENTO-INTEGRACION.md](../../MANTENIMIENTO-INTEGRACION.md).

## Qué problema resuelve

La programación semanal del taller mecánico y del taller eléctrico la arma hoy
el encargado de mantenimiento **y no se baja a ningún lado**. No hay planilla,
no hay pantalla, no hay papel: vive en su cabeza. Cuando falta alguien se entera
porque el operario le avisa, y ahí decide a mano si mueve a otro o deja el turno
corto.

Que esa programación exista escrita en algún lugar ya es la mitad del valor. La
otra mitad es el cruce: el SdG ya sabe quién está de vacaciones, con licencia
ART o suspendido, porque RRHH lo carga. Hoy ese dato y la programación del
taller no se tocan nunca, así que el encargado arma la semana sin que nada le
avise que uno de los suyos no va a estar.

## La rotación, tal como es

Hay tres turnos: **4 a 12**, **8 a 16** y **12 a 20**. Existe un cuarto, de 20 a
4, que **queda afuera de este diseño**: hoy no tiene operarios designados.

Nueve personas: **5 mecánicos, 1 lubricador y 3 electricistas**.

**Los mecánicos y el lubricador rotan en bloque.** Son dos grupos fijos:

| | Composición |
|---|---|
| Grupo A | 2 mecánicos |
| Grupo B | 3 mecánicos + 1 lubricador |

Cada semana los dos grupos se dan vuelta entre 4 a 12 y 12 a 20. El grupo entero
se mueve junto: no se rearma la composición, no rota la gente por separado. El
turno de 8 a 16 **no lleva mecánicos**.

**Los electricistas rotan aparte, y por los tres turnos.** Hay uno por turno —
4 a 12, 8 a 16 y 12 a 20— y cada semana cada uno avanza un turno.

Puesto uno al lado del otro:

| Semana | 4 a 12 | 8 a 16 | 12 a 20 |
|---|---|---|---|
| 1 | Grupo A · E1 | E2 | Grupo B · E3 |
| 2 | Grupo B · E3 | E1 | Grupo A · E2 |
| 3 | Grupo A · E2 | E3 | Grupo B · E1 |
| 4 | Grupo B · E1 | E2 | Grupo A · E3 |
| 5 | Grupo A · E3 | E1 | Grupo B · E2 |
| 6 | Grupo B · E2 | E3 | Grupo A · E1 |

**El cuadro entero recién se repite a las 6 semanas**, no a las 2 ni a las 3. Los
mecánicos cierran su vuelta cada 2 semanas y los electricistas cada 3, y el
mínimo común múltiplo es 6. Quien implemente esto va a tener la tentación de
modelar "la rotación" como un solo ciclo: son dos, con períodos distintos, y
conviene que el código lo diga así. El cuadro de arriba se validó con el
encargado contra esta misma tabla.

**La semana son siete días, no cinco.** Medido sobre `calculos_diarios` desde
agosto para la gente de Mantenimiento: trabajan **27 de 33 sábados** y 4 de 26
domingos. La rotación es semanal, pero las ausencias son por día, así que el
hueco es por día y la grilla tiene siete columnas por turno.

## Qué hace el sistema cuando falta alguien

El sistema **avisa el hueco y sugiere quién lo puede tapar**. No lo tapa solo.

El criterio de la sugerencia es corto, y es el que dio el encargado, completo:

1. que sea **del mismo oficio** que el que falta;
2. que **no esté ya trabajando ese turno**.

Nada más. En particular:

- **Que el turno del que se saca a esa persona quede corto no importa.** Se
  preguntó explícitamente y la respuesta fue que no. El sistema no equilibra, no
  puntúa candidatos y no se niega a sugerir a alguien porque dejaría otro turno
  flojo. Esa es decisión del encargado, que es el que sabe qué se va a hacer esa
  semana.
- **No hay noción de "anticipación suficiente"** adentro del sistema. En el
  taller esa es la regla real —si el aviso llega con tiempo se reacomoda, y si no
  el turno queda con un mecánico menos—, pero el sistema no la modela: muestra el
  hueco y las sugerencias, y el encargado decide. Modelar el plazo habría pedido
  inventar un número que nadie dijo.

## De dónde salen las ausencias, y por qué eso define la pantalla

**Sólo de lo que esté cargado en el SdG.** Se preguntó si el encargado debería
poder anotar aparte, en Mantenimiento, el aviso de palabra que le llega en el
taller, y la respuesta fue que no: hay una sola tabla de ausencias y es la de
RRHH. Mientras la ausencia no esté cargada ahí, para el sistema esa persona
trabaja. La carga **tanto RRHH como el encargado de mantenimiento**.

**Y acá está el número que define todo lo demás.** Medido sobre las 144
ausencias cargadas: la mediana entre el día en que empieza la ausencia y el día
en que alguien la carga es de **39 días tarde**. **Una sola de las 144** se
cargó con un día o más de anticipación. De las 17 ausencias de la gente de
Mantenimiento, todas entraron semanas después: una enfermedad del 03/10/2026 se
cargó el 16/10; una licencia ART del 08/08 al 18/08 se cargó el 28/08. La única
que sirve hacia adelante es una vacación larga.

O sea: con el dato como entra hoy, una pantalla que sólo lee lo que RRHH cargó
**no avisa nada**. Muestra la semana limpia y los huecos aparecen cuando ya
pasaron. Sería una reconstrucción del pasado vendida como una alerta.

> **Decisión (mía, 23/10).** La carga del encargado **es la puerta principal por
> la que entra el dato**, no un accesorio. La pantalla se diseña alrededor de
> eso: desde el hueco —o desde la persona, en la semana— se carga la ausencia en
> dos toques, y tiene que funcionar bien en el teléfono, porque el aviso del
> operario le llega al encargado en el taller y no en el escritorio. Si esto
> queda como un formulario escondido en otra pantalla, el dato no va a entrar a
> tiempo y el cruce no va a servir para lo que se pidió.

Las tres tablas que hay hoy y qué hacemos con cada una:

- **`ausencias`** — es la fuente. `empleado_id`, `fecha_desde`, `fecha_hasta`,
  `tipo` (doce valores del enum `tipo_ausencia`), `justificada`. Es un rango de
  fechas, así que una licencia de dos semanas es una fila.
- **`vacaciones`** — **no hay que leerla.** Las vacaciones entran como una
  `ausencia` de tipo `VACACIONES` y la ruta sincroniza la fila de `vacaciones`
  desde ahí (`sincronizarPeriodoVacaciones`, en `lib/rrhh/vacacionesDeAusencia.ts`).
  Leer las dos contaría la misma ausencia dos veces.
- **`francos`** — **queda afuera del cruce, y conviene entender por qué.**

### El franco: el agujero que queda abierto a propósito

Un franco tomado es un día que la persona no viene y **no genera fila en
`ausencias`**: vive en `francos`, con `estado = 'TOMADO'` y una fecha en
`fecha_tomado`. La primera versión de este documento decía que ese campo era el
día de descanso. **Es falso, y medirlo lo mostró.**

`app/(app)/rrhh/francos/FrancosClient.tsx:46` manda `fechaTomado: hoyEnArgentina()`
al marcar un franco como tomado: es **el día en que alguien apretó el botón**, no
el día que el operario descansó. En producción, de 217 francos hay 56 tomados y
sus fechas caen en **tres días**: 35 el 01/09/2026, 20 el 16/09/2026 y uno el
19/10/2026. Cruzarlo como si fuera el día de descanso pintaría 35 huecos
simultáneos un lunes cualquiera.

> **Decisión (mía, 23/10).** `francos` **no entra en el cruce**. Es la misma
> regla que el proyecto ya aplica en las planillas: *enlazar al que se le parece
> es peor que dejar en null*. Una fecha de trámite usada como fecha de descanso
> es exactamente ese error, y con la agravante de que acá el error es visible y
> enorme.
>
> **La consecuencia, dicha para que se sepa: un franco tomado no abre hueco.** El
> encargado puede ver programada a una persona que ese día no va a venir. Es una
> omisión, no una mentira —la pantalla no afirma que esté, simplemente no sabe—,
> y mientras la carga del encargado sea la puerta principal, él puede anotarlo
> como ausencia cuando se entere.
>
> **El arreglo de verdad es un trabajo aparte en RRHH**, y queda nombrado acá
> para que no se pierda: que al marcar un franco como tomado se pida el día real
> en vez de asumir hoy. Las 56 filas viejas no se pueden recuperar — su fecha
> verdadera no quedó registrada en ningún lado. Hasta que eso no esté, cruzar
> francos sólo puede empeorar la pantalla.

### `TARDANZA` no es una falta

Está en el mismo enum que `VACACIONES` y `LICENCIA_ART`, con el mismo rango de
fechas, pero el que llega tarde **viene a trabajar**. Pintarlo como hueco haría
que el encargado vea un agujero donde hay una persona, y la primera vez que eso
pase va a dejar de confiar en la pantalla.

> **Decisión (mía).** `TARDANZA` se excluye del cruce. Los otros once tipos
> cuentan como ausencia del día, justificada o no: al taller le da igual el
> motivo, lo que importa es que no está. *(Hoy no hay ni una fila de `TARDANZA`
> en las 144 ausencias, así que excluirla no cambia nada todavía — es una
> defensa contra el día en que alguien cargue la primera.)*

## El permiso

Acá hay trabajo real que no es el cruce.

Hoy cargar una ausencia pasa por `POST /api/rrhh/ausencias`, que exige
`puede_editar_check` — el permiso de edición de RRHH, el mismo que abre sueldos,
liquidaciones y la ficha completa de cualquier empleado. Darle eso al encargado
de mantenimiento para que pueda anotar que faltó un mecánico es desproporcionado,
y además choca con una regla que el proyecto ya aprendió: el valor hora se mudó
de `empleados` a `rrhh_empleados_datos` justamente porque RLS no sabe tapar una
columna sola.

> **Decisión (mía), y el punto donde más conviene que alguien me contradiga.** El
> encargado carga la ausencia **desde Mantenimiento**, por una ruta propia del
> módulo, que escribe en `ausencias` con el cliente admin después de comprobar
> dos cosas: que tenga nivel de edición en Mantenimiento, y que el empleado esté
> en el padrón del taller. O sea: puede anotar la falta de uno de sus nueve, y de
> nadie más. No se le toca el permiso de RRHH, y la ausencia queda indistinguible
> de una cargada por RRHH — `cargado_por_id` ya guarda quién fue.

Tres cosas que esa ruta tiene que hacer bien, y que no son obvias:

- **Tiene que correr los efectos, no sólo insertar la fila.** La ruta de RRHH no
  se limita a un `insert`: llama a `sincronizarPeriodoVacaciones()` y a
  `recalcularEmpleadoPeriodo()`, que recalcula `calculos_diarios` del período. Si
  la ruta nueva se saltea el recálculo, la fila existe pero la liquidación no la
  ve, y eso es "indistinguible" sólo mirando la tabla. *(Decisión mía: el cuerpo
  de la ruta de RRHH se saca a `lib/rrhh/` y lo comparten las dos puntas. Es
  trabajo que toca código de RRHH y hay que contarlo.)*
- **Un período ya liquidado no se toca.** No hay hoy ningún guardián de
  `estado_liquidacion = 'CERRADA'` en `lib/rrhh/engine/recalcular.ts`. *(Decisión
  mía: la ruta de Mantenimiento rechaza con un 400 en castellano una ausencia que
  caiga en un período cerrado, y le dice al encargado que eso lo tiene que ver
  RRHH. No se arregla el agujero del lado de RRHH en este proyecto, pero no se lo
  agranda.)*
- **No todos los tipos son suyos.** `VACACIONES` exige `anio_correspondiente` y
  crea una fila en `vacaciones`; `SUSPENSION`, `LICENCIA_ART` y
  `LICENCIA_GREMIAL` son decisiones de RRHH, no del taller. *(Decisión mía: el
  encargado elige entre cuatro — `PERMISO_PERSONAL`,
  `ENFERMEDAD_ACCIDENTE_INCULPABLE`, `INJUSTIFICADA` y `OTRA` —, y puede corregir
  o borrar sólo lo que cargó él, y sólo mientras el período siga abierto. Lo
  demás lo carga RRHH como siempre.)*

## Quién la ve

El encargado pidió que **no la vea nadie más**: ni los operarios, ni RRHH, ni
producción.

Eso no existe hoy como permiso. En el modelo el `rol` es global
(`admin_sistema | encargado | operario`) y el acceso al módulo es
`lectura | edicion | admin` en `usuario_modulos`. No hay una marca de "encargado
de mantenimiento".

> **Decisión (mía).** La pantalla y las tablas nuevas se cierran a **nivel `admin`
> de Mantenimiento**, que es el nivel que ya existe para "configurar el catálogo:
> tipos, contratistas, operarios" — y el padrón del taller es exactamente un
> catálogo. Las policies van envueltas: `using ((select mant_es_admin()))`.
>
> Lo que esto quiere decir, dicho sin vueltas: lo ve **todo el que tenga admin de
> Mantenimiento**, que hoy incluye a cualquier `admin_sistema`. Si mañana hay dos
> personas con admin y una no tiene que ver la programación, hace falta una marca
> en el padrón o un nivel nuevo. Inventar hoy un permiso para una sola persona
> sería construir un mecanismo que nadie pidió.

**El hueco no dice por qué.** `ausencias` y `francos` están cerradas con
`tiene_acceso_rrhh()`, y `ENFERMEDAD_ACCIDENTE_INCULPABLE`, `LICENCIA_ART` o
`SUSPENSION` son dato médico y disciplinario. Mostrarlos del lado de Mantenimiento
cruzaría el mismo borde que el proyecto ya cuidó una vez con el valor hora.

> **Decisión (mía).** La pantalla dice **que no está**, no por qué. El cruce lee
> con el cliente admin y devuelve un booleano por persona y día. **No se abre
> ninguna policy nueva sobre `ausencias`** — hacerlo expondría las 70 fichas, no
> las nueve. Lo que el encargado cargó él mismo sí lo puede ver, porque lo
> escribió él.

## El padrón del taller

No existe hoy. Hace falta una tabla nueva en Mantenimiento con las nueve
personas: el enlace a `empleados`, el **oficio** (mecánico / electricista /
lubricador) y, para los que lo tienen, el **grupo** (A o B).

**El oficio no va en `empleados`.** El proyecto ya tomó esta decisión una vez y
está escrita en el encabezado de la migración `20260903090920`: mecánico,
electricista y lubricador **no son sectores, son oficios**, y meterlos en el
núcleo sería meterlos en RRHH, Mantenimiento, Remises y Compras, que comparten
esas tablas. El vocabulario del pañol vive en Inventario por ese motivo. Lo mismo
vale acá.

**El padrón lleva vigencia (`desde` / `hasta`), y eso no es opcional.** Si alguien
entra, se va o cambia de grupo, una semana pasada recalculada con el padrón de
hoy **reescribiría lo que el encargado vio en su momento**. Es semántica, no
forma, y se decide antes de escribir la migración.

Dos cosas más que el implementador va a querer saber:

- **El lubricador está en el Grupo B y no rota solo.** No es un tercer oficio con
  su propia rotación: viaja con los tres mecánicos de B.
- **Los `operario_1/2/3` de las OT son texto libre**, copiados del master de la
  planilla, y no están enlazados a `empleados`. Este padrón **no** los arregla y
  no debe intentarlo — ver no-objetivos. *(Dato útil para la carga inicial: hay
  13 empleados en los sectores "Mantenimiento" y "Mantenimiento de Equipos", con
  apellidos que coinciden con los nombres de esas columnas, así que el enlace es
  posible; cuál es cuál lo resuelve la carga a mano.)*

## Qué se ve en pantalla

Una sola pantalla, en **Mantenimiento**, con la semana: los tres turnos por los
siete días, quién está en cada uno, los huecos marcados y las sugerencias al
lado. Desde el hueco se carga la ausencia.

*(Decisiones mías sobre la forma, chicas y discutibles: abre en la semana en
curso y se puede ir adelante y atrás; la rotación se calcula sola hacia adelante
desde una semana de referencia que se carga una vez; y el encargado puede pisar a
mano la asignación de un día sin que eso desarme las semanas siguientes, que se
siguen calculando del ciclo. Los feriados no reciben trato especial en esta
versión: el taller trabaja sábados de forma rutinaria y nadie dijo que cierre los
feriados, así que inventar un cierre sería el mismo error que el franco.)*

**Ojo con la palabra "turnos": ya está ocupada y significa otra cosa.**
`/rrhh/turnos` existe y es un catálogo de horarios con tolerancia (`jornadas`)
que el motor de RRHH usa para **adivinar qué turno hizo cada uno a partir de su
marcación en el reloj**. Va al revés que esto: deduce el turno del fichaje, no
asigna gente a turnos. Las dos cosas van a convivir y no se deben llamar igual.
*(Decisión mía: esto se llama **programación** —`/mantenimiento/programacion`— y
no toca `jornadas`.)*

## Objetivos

- Que la semana del taller exista escrita y se pueda mirar.
- Que el encargado pueda anotar la falta de uno de los suyos en el momento en que
  se entera, desde el teléfono, sin que eso le abra RRHH entero.
- Que esa ausencia —y la que cargue RRHH— aparezca como hueco en la semana, sin
  que nadie tenga que acordarse de cruzarlo.
- Que el encargado vea, al lado del hueco, quién lo puede tapar.

## No objetivos

- **No programa el turno de 20 a 4.** No tiene operarios designados hoy.
- **No decide nada solo.** No tapa huecos, no reasigna, no manda avisos. Sugiere.
- **No equilibra la carga** entre turnos ni entre personas, y no le importa el
  hueco que deja el que se mueve.
- **No lo ve nadie más que quien tenga admin de Mantenimiento**, así que no hay
  publicación, impresión, exportación a planilla ni notificaciones a los
  operarios.
- **No arregla `francos` del lado de RRHH.** Queda nombrado como trabajo aparte.
- **No toca `jornadas` ni el motor de fichadas de RRHH.** Que el SdG sepa de
  antemano en qué turno iba cada uno podría mejorar el emparejamiento de la
  marcación, y es tentador: queda afuera a propósito, porque tocar el motor de
  RRHH desde Mantenimiento es otro proyecto y otro riesgo.
- **No le pone padrón a los `operario_1/2/3` de las OT.** Son texto libre del
  master de la planilla, y lo que la app escribe ahí tiene que seguir siendo
  exactamente lo que la planilla acepta.
- **No hay planilla de Google de ningún lado.** Esto nace adentro del SdG y se
  queda adentro, como Ensayos.

## Anti-objetivos

Qué haría que esto fracase aunque funcione:

- **Que la pantalla mienta sobre quién está.** Un hueco donde hay una persona
  —una tardanza pintada como falta, 35 francos de trámite pintados un lunes— y el
  encargado vuelve a su cabeza, que al menos no le miente. Es el motivo por el
  que `TARDANZA` sale y `francos` queda afuera.
- **Que el cruce no avise nada** porque el dato llega 39 días tarde. Es el riesgo
  central de este proyecto y la razón de que la carga del encargado sea la puerta
  principal y no un formulario escondido.
- **Que para usarlo haya que cargar las ausencias dos veces**, una en RRHH y otra
  en Mantenimiento. Hay una sola tabla de ausencias y las dos puntas escriben
  ahí.
- **Que el encargado termine con acceso a sueldos** por el camino de poder anotar
  una falta.
- **Que se vuelva un planificador.** Pedía dos cosas: ver la semana y que le
  sugieran quién tapa el hueco. Un motor que optimiza la cobertura es un sistema
  que el encargado no va a poder contradecir, y contradecirlo es justamente lo
  que hace bien.

## Restricciones

- **Next.js 16 + Supabase**, en el módulo Mantenimiento: `app/(app)/mantenimiento`,
  `lib/mantenimiento`, `app/api/mantenimiento`. Todo en castellano.
- **La migración la corre una persona a mano** en el editor SQL de Supabase. El
  padrón del taller, su vigencia, la semana de referencia y las pisadas a mano son
  tablas nuevas: hay que escribir la migración, avisar y quedarse esperando. Antes
  de escribirla, las ocho trampas del README de migraciones.
- **Los desplegables van con `<Select>`**, no `<select>` nativo.
- **La grilla es de tres turnos por siete días y se mira en el teléfono.** El
  ancho útil es 343 px: `grid-cols-3` sin breakpoint no entra, y una tabla de
  siete columnas necesita contenedor con scroll. Lo revisa
  `node scripts/revisar-responsive.mjs`.
- **`className="input w-20"` no mide 20**: el ancho va en un `div` que envuelva al
  campo.
- **Una policy nueva llama a su función envuelta**: `using ((select mant_es_admin()))`.
- **La lógica se saca a `lib/mantenimiento/` para poder testearla.** Las rutas y
  las pantallas no tienen tests en este repo; el cálculo de la rotación, el cruce
  con las ausencias y el filtro de candidatos son funciones puras y ahí es donde
  van los tests. El cuadro de seis semanas de arriba es un test.
- **Nunca `git add -A`**: suele haber otra sesión en el mismo árbol.

## Lo que queda a criterio del que lo construya

- La forma de las tablas nuevas y sus nombres.
- Cómo se representa el ciclo: dos ciclos con períodos distintos (2 y 3, que dan
  6) es lo que el dominio dice; el cálculo concreto es suyo.
- Cómo se carga por primera vez el padrón y la semana de referencia.
- El layout de la pantalla, dentro de las reglas responsive del proyecto.
- Si el cruce se calcula al vuelo en cada carga o se guarda. Al vuelo parece
  natural —son nueve personas y una semana—, pero una pisada a mano sí hay que
  guardarla, y por día.
