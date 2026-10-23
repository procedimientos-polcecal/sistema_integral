# Los molinos se cargan solos — el PC Robot entra a Producción

Acordado el 21/10/2026. Reemplaza las dos macros de
`Botones de filler 1 y 2 (Alejandro).xlsm`, relevadas el 20/10/2026 en
[docs/PRODUCCION-FILLERS-MACRO.md](../../PRODUCCION-FILLERS-MACRO.md) — ese
documento tiene el detalle del libro viejo y los cuatro errores que se le
encontraron, y conviene leerlo antes que éste.

Todo lo que acá se afirma con un número está medido contra los archivos reales
del 19 y 20/10/2026: 813 filas de Filler 1 y 998 de Filler 2, de febrero a
octubre de 2026.

## Qué problema resuelve

Hoy el rendimiento de los dos molinos sale de un botón en un Excel que corre en
una PC, con una letra de unidad, cuando alguien se acuerda. Produce un archivo
por corrida que queda tirado en la misma carpeta que los datos crudos —hay 123
de esos— y cuyos resúmenes están mal de tres maneras distintas, todas
silenciosas: el ton/h mensual de Filler 1 está dividido por 60, los tres
resúmenes de Filler 2 leen columnas que el propio código ya pisó, y el reparto
por material manda el turno entero al material que figura como etiqueta.

Nadie se enteró en ocho meses, porque un número mal nunca se distingue de un
número bien. El botón de Filler 2, además, dejó de usarse: el último archivo
guardado es de junio.

**Lo que se quiere es que no haya botón.** Que el dato entre solo, que los
indicadores se calculen en el sistema, y que la única intervención de una
persona sea explicar una parada.

## Intención

Un frente nuevo dentro de **Producción** que responde una pregunta que el parte
de fábrica no responde: **cuánto procesó cada molino a la entrada del proceso y
cuánto tiempo estuvo realmente andando.**

Los cinco indicadores, por molino:

| | De dónde sale |
|---|---|
| Toneladas procesadas | el robot |
| Horas de marcha | el robot |
| Horas no trabajadas | **se despejan**: duración teórica − horas de marcha |
| Utilización | horas de marcha / horas teóricas |
| Productividad | toneladas / horas de marcha |

**Las horas no trabajadas no se tipean.** Es la misma regla que ya rige en
Trituración (`lib/trituracion/horas.ts`): lo que se puede despejar de lo
cargado no se pisa con un número tipeado aparte, porque el tipeado es el que
queda viejo. El papel que hoy llenan los operarios pide, en su mayor parte,
cosas que el robot ya sabe; lo único que agrega es el porqué de una parada.

## Objetivos

- El dato entra **sin que nadie apriete nada**, desde una carpeta de Drive.
- Los cinco indicadores, por molino, por turno, por día y por mes.
- Una persona carga **sólo el motivo de una parada**, y sólo cuando la hubo.
- Reimportar el mismo archivo dos veces da el mismo resultado.
- Los cuatro errores de la macro quedan cerrados, y queda escrito cómo se
  comprueba que siguen cerrados.

## No objetivos

- **No reemplaza el parte de fábrica.** Son dos mediciones del mismo día que no
  se suman ni se restan. El robot mide la entrada del proceso; el capataz, el
  producto terminado.
- **No se reproducen las hojas del Excel.** El `.xlsx` generado no se emula.
- **No hay desglose por material en los indicadores.** Decidido: por molino.
- **No se toca `horas_marcha` de `equipos`** ni el MTBF de Mantenimiento.
- **No se escribe ninguna planilla de Google.** Este frente no tiene espejo.
- **No agrega avisos en la v1.** Ver "Por qué no hay aviso", abajo.

## Anti-objetivos

Cosas que harían fracasar esto aunque funcione:

- **Que un número salga sin que se sepa que es dudoso.** El dato del robot
  tiene cuatro patologías conocidas. Promediarlas es repetir el problema que se
  vino a resolver: un número que no se distingue de uno bueno.
- **Que haya que explicar un minuto.** El 47 % de los turnos de Filler 1 tiene
  una parada de entre 1 y 5 minutos, que juntas son el 0,8 % del tiempo
  perdido. Pedir motivo para eso convierte la pantalla en una cinta de desechar.
- **Que el dato aparezca repartido por el sistema.** Se almacena y se muestra
  **sólo en Producción**.
- **Que algo se enlace por parecido.** Ver "El molino no es un equipo".

## De dónde entra el dato

### El contrato del archivo

El `PCRobot.exe` de cada molino deja un **zip por día y por molino**. Hoy van a
una carpeta de red; van a pasar a ir a una carpeta de **Drive**. Adentro vienen
los CSV de la carpeta entera del robot, **acumulados desde febrero de 2026** —
no son las novedades del día, es una foto completa.

Eso es la propiedad central del diseño: **el último zip alcanza para
reconstruir todo**. No hay que llevar cuenta de qué se procesó; hay que
procesar el último y que el resultado sea el mismo. Comprobado comparando dos
zips separados por cinco semanas: ninguna fila cambió de valor y ninguna
desapareció — el robot sólo agrega al final.

### Cómo llega a Drive, y con qué nombre

Resuelto el 23/10/2026, con su propio documento:
[docs/PRODUCCION-FILLERS-SUBIDA.md](../../PRODUCCION-FILLERS-SUBIDA.md).

Una tarea programada de Windows, en cualquier PC de la red que esté prendida y
vea `\\server\EXTERIOR`, corre
[`scripts/pcrobot/subir-zips.mjs`](../../../scripts/pcrobot/subir-zips.mjs) a
las **09:30 de Argentina**, media hora después de que el robot exporta. El
script no tiene dependencias y sube el zip más nuevo de cada molino a una
carpeta de la unidad compartida **`Backups SdG`**, con la misma cuenta de
servicio que ya usa el resto del sistema.

Para el SdG eso significa un contrato de nombre **distinto** del que deja el
robot: el subidor normaliza y le saca la hora, de modo que en Drive hay **un
archivo por molino y por día**, y una segunda exportación del mismo día
reemplaza a la primera en vez de duplicarla.

```
en el servidor:   FILLER 1 2026-10-22 09;00;05.zip
en Drive:         Filler 1 2026-10-22.zip
```

El `Filler 1` de ese nombre sale de la configuración del subidor, no del
archivo: si alguien renombra la carpeta del robot, el contrato no cambia.

**El nombre del molino es la clave.** La importación empareja por ese prefijo
contra el catálogo de molinos; un archivo cuyo prefijo no coincida con ninguno
**no se importa y se informa**, no se adivina a cuál pertenece.

### Lo que se lee de adentro

Todos los CSV son `;` como separador, **sin encabezado**, fecha en **d/m/yyyy**
(no viene de Sheets, pero el criterio es el mismo: d/m, nunca m/d), números con
punto decimal, codificación cp1252.

**Filler 1** — se lee `DAT00000001.CSV`, un renglón por turno cerrado:

```
fecha;hora;kg₁;kg₂;kg₃;kg₄;minutos;"min";MATERIAL;MODO
```

De los cuatro campos de kilos **sólo uno trae valor**. La producción del turno
es la suma de los cuatro; cuál de los cuatro venga lleno **no dice el turno**.

Y se leen `DAT00000003..06.CSV` —3:59, 11:59, 19:59 y 23:59 respectivamente—
que traen el reparto real del mismo turno:

```
fecha;hora;kg_membranero;kg_dolomita;kg_caliza
```

**Filler 2 (Calera)** — se leen `DAT00000001..04.CSV`, uno por corte horario,
con seis pares `kg;minutos`: piedra membranero, piedra dolomita, piedra caliza,
arena membranero, arena dolomita, arena caliza. Producción = suma de los seis
kg; marcha = suma de los seis minutos. Sumar los minutos es correcto porque los
seis contadores son excluyentes en la práctica: de 721 filas con actividad, 720
tienen un solo canal activo.

**No se leen**: el horímetro horario (`DAT00000002` de Filler 1, `DAT00000010`
de Filler 2), el registro de cambios de modo (`DAT00000011`), los cuatro campos
sin identificar de `DAT00000005..08` de Filler 2 —hoy todos en cero—, ni los
`DATADAT*` y `.txt` sueltos, que son restos de febrero.

### Los cuatro turnos

El sello de hora es el **final** del turno, y son siempre estos cuatro:

| Cierre | Turno | Duración teórica |
|---|---|---|
| 23:59 | 20→00 | 240 min |
| 3:59 | 00→04 | 240 min |
| 11:59 | 04→12 | 480 min |
| 19:59 | 12→20 | 480 min |

Medido sobre las 1.811 filas de los dos molinos: **no hay una sola fila con una
hora distinta de esas cuatro.** Una fila con otra hora es un dato que cambió y
tiene que avisar, no acomodarse.

Y ojo con esto, porque es la mitad del valor del módulo: los turnos 20→00 y
00→04 son justamente **las ocho horas que el parte de fábrica no registra**.

## Las cuatro patologías del dato

Las cuatro se encontraron midiendo, no leyendo código, y las cuatro tienen que
estar resueltas antes de mostrar un indicador.

### 1. Los rótulos de Filler 1 están corridos un lugar

La macro escribe los encabezados `Turno 00-04 / 04-12 / 12-20 / 20-00` sobre
las cuatro columnas de kilos **en el orden en que vienen**, sin mirar la hora.
Pero el orden real del robot es 20→00, 00→04, 04→12, 12→20. El renglón de las
19:59 —que cierra el turno de 12 a 20— aparece bajo *"Turno 20-00"*.

En la macro no cambia ningún total, porque las cuatro columnas se suman siempre
juntas. Acá sí importa, porque el turno es el grano que se guarda. **El turno lo
decide la hora de cierre, nunca la posición de la columna.** La macro de
Filler 2 ya lo hace así; es el mismo informe hecho de dos maneras y una de las
dos está mal.

### 2. Un día sin ninguna fila es un día que la planta no trabajó

Filler 1 tiene **22 días sin una sola fila** en ocho meses, y los 22 son domingo
o feriado nacional: 1/5, 25/5, 15/6, 20 y 21/6, 9/7, 17/8, 12/10, y quince
domingos.

No es un dato que falta: es `no_operó`, la misma distinción que Trituración ya
hace entre "no operó" y "operó y dio cero". Contarlo como parada inventaría
**528 horas** de molino detenido.

**Si el molino no tiene ninguna de las cuatro filas de ese día, ese día no
cuenta** — ni en el numerador ni en el denominador de ningún indicador.

### 3. Pero un turno en cero sí es una parada, y hay que explicarla

Ésta es la trampa que hace que la regla anterior no alcance, y hay que decirla
fuerte porque los dos robots dicen lo mismo de maneras distintas:

**Filler 2 nunca deja un día sin filas.** En 250 días no hay un solo hueco. Lo
que deja son **272 filas con kilos y minutos en cero**, y 34 días con las cuatro
en cero. El 12/10, feriado, Filler 1 no tiene ninguna fila —y queda bien
excluido— mientras Filler 2 tiene cuatro ceros.

La tentación es tratar "cuatro ceros" como "no operó". **Se decidió que no.**
Los 34 días en cero de Filler 2 no son domingos: hay 11 domingos, pero también
8 lunes, 4 martes, 4 jueves y 3 viernes. Si la Calera no muele un martes, eso
es una parada y alguien la tiene que explicar — no es la planta cerrada.

Entonces: **un turno en cero dentro de un día que tiene filas es una parada
normal**, con sus horas no trabajadas completas, que entra en la cola de
explicación como cualquier otra.

Y para el caso real que esa regla deja afuera —el domingo, el feriado, la
parada de planta programada— hay una salida explícita: **una persona marca el
día entero como "planta parada"**, de un clic, y eso cubre los cuatro turnos de
una vez. Es la misma carga manual que ya se acordó, a escala de día. El sistema
no lo infiere, porque no puede: Filler 1 trabajó la mitad de los domingos del
período.

### 4. Un turno que falta se acumula en el siguiente

Cuando el robot no corta un turno, **los minutos y los kilos se acumulan en la
fila siguiente**.

Hay 16 filas de Filler 1 donde la marcha supera la duración teórica —una de
**1.013 minutos en un bloque de 480**— y en 15 de las 16 hay turnos faltantes
inmediatamente antes cuya duración acumulada explica el exceso. En Filler 2
pasa 4 veces.

Tratar esa fila como un turno normal da utilización arriba del 200 %. Tratar
los faltantes como parada inventa horas que no existieron. **Las dos cosas están
mal y ninguna avisa.**

Qué se hace, en este orden:

1. **Tolerancia de 10 minutos.** No todo exceso es una racha: hay tres casos de
   +1, +6 y +18 minutos que son deriva del reloj del PLC. Por debajo de 10
   minutos la duración teórica se toma como la marcha informada y no pasa nada.
2. Por encima, se mira hacia atrás hasta la última fila presente. Si los turnos
   faltantes de esa racha explican el exceso, **la fila se marca como acumulada
   y cubre todos esos turnos**: su duración teórica es la suma de la racha.
3. Si aun así el exceso no se explica, el turno queda **inconsistente**.

**Un turno inconsistente pierde sus horas de los indicadores de tiempo
—utilización, horas de marcha, horas no trabajadas— pero nunca sus toneladas.**
Las toneladas las midió una balanza y el problema es del reloj; descartarlas
sería perder producción real. Con la regla completa quedan **tres turnos
inconsistentes de 797** en Filler 1 y **ninguno** en Filler 2. Los tres son
rachas que cruzan un día no operativo, donde no hay manera honesta de decir
cuánto tiempo estuvo disponible el molino.

### Y el corolario: el turno huérfano

Queda un caso que ninguna de las cuatro cubre, y que el dato produce **todos los
días**: un turno que falta sin que ninguna fila posterior lo absorba. Filler 1
tiene 44; Filler 2, 3.

El más importante es el de hoy: **el zip se corta a las 09:00, así que el día en
curso siempre llega con un solo turno** y tres faltantes. Contarlos como parada
le pone al día de hoy una detención fija de dieciséis horas y dos o tres
"turnos sin explicar" falsos, para siempre.

Un turno huérfano **no cuenta como parada y no entra en ningún indicador**, pero
**se lista**: "el robot no informó este turno". Un día con un agujero de veinte
horas tiene que verse. Lo que no puede es inventarse como detención.

## Qué se guarda

El grano es **el turno**. Día y mes se suman a partir de ahí, no se guardan
calculados: misma decisión que `lib/trituracion/horas.ts`, y por el mismo motivo.

### El catálogo de molinos

Dos filas hoy —Filler 1 y Filler 2 (Calera)— con, por molino: el formato de
archivo que le corresponde (son distintos), el **umbral de minutos** a partir
del cual se pide motivo, y la **fecha de puesta en servicio** desde la que
corre la cola de explicación.

Tiene que admitir una tercera fila sin migración de código: los horímetros del
robot nombran un **FILLER3** que hoy no tiene botón y del que nadie sabe si
produce.

### El molino no es un equipo

**No se enlaza con `equipos`.** En el catálogo del núcleo hay siete equipos que
suenan a molino —`Molino a martillos` ×3, `Molino de bolas` ×2, `Molino
vertical`, `Alimentador hidratadora`— y **ninguno se llama Filler 1 ni
Filler 2**. No hay manera de decir cuál es cuál desde el dato, y enlazar al que
se le parece es peor que dejar en null: el dato aparecería en el lugar que no es
y nadie lo notaría.

Si algún día alguien sabe la correspondencia, se agrega una columna opcional que
**una persona** completa. No se deduce.

### Y cuidado con el nombre

En `/calidad/ensayos`, **"Filler 1" y "Filler 2" ya significan otra cosa**: son
productos, finuras, y hay un cartel en pantalla avisando que no son el catálogo
de productos del sistema. Acá son molinos. Son dos cosas distintas que se llaman
igual y las carga gente parecida.

En las pantallas de este frente la palabra va siempre acompañada: **"molino
Filler 1"**, nunca "Filler 1" solo. Es barato y es la única defensa que hay.

### Y "turno" ya significa otras tres cosas

Esto se cruzó con el spec de
[disponibilidad del taller](2026-10-22-mantenimiento-disponibilidad-y-turnos-design.md)
del 22/10/2026, que advierte lo mismo por su lado. Al 23/10/2026 la palabra
está ocupada cuatro veces, y **tres de ellas usan los mismos números de reloj
para cosas distintas**:

| Dónde | Qué es | Cuáles |
|---|---|---|
| `/rrhh/turnos` | catálogo de horarios con tolerancia; **deduce** qué turno hizo cada uno de su marcación | varios |
| Mantenimiento (sin empezar) | **asigna** gente del taller a un turno | 4-12, 8-16, 12-20 |
| Producción, parte de fábrica | el parte que firma el capataz | 4-12, 12-20 |
| **Acá** | el corte del contador del robot | **20-00, 00-04, 04-12, 12-20** |

El riesgo concreto: "el turno 4 a 12" de este frente y "el turno 4 a 12" del
parte de fábrica **son el mismo horario y miden cosas que no se pueden sumar**
—uno es piedra que entró al molino, el otro es producto terminado—. Y los dos
turnos de la noche sólo existen acá.

Nada de esto se enlaza ni se cruza. Si alguna pantalla llega a mostrar los dos,
la columna tiene que decir de cuál habla.

### El turno

Por molino y turno: la fecha, cuál de los cuatro turnos es, los kilos, los
minutos de marcha, la duración teórica aplicada (que puede ser la acumulada de
una racha) y un estado que distingue el turno **normal**, el **acumulado**, el
**inconsistente** y el **huérfano**.

Se guarda además, **sin mostrarse**, el reparto por material: para Filler 1 el
de `DAT00000003..06`, para Filler 2 el de los seis pares.

Esto último parece trabajo de más y conviene saber por qué está. La etiqueta de
material de `DAT00000001` es **confiable sólo cuando el turno molió un material
solo**: de 809 turnos, **127 (15,7 %) mezclaron dos**, y la macro manda el turno
entero al que figura en la etiqueta — **4.034 de 35.797 toneladas (11,3 %)
quedan en el material equivocado**, con caliza 21 % inflada. El reparto correcto
está en cuatro archivos chicos que la macro nunca abre. Guardarlo cuesta nada;
no guardarlo garantiza que el día que alguien lo pida lo reconstruya desde la
etiqueta y repita el error.

**La etiqueta cruda de `DAT00000001` no se guarda.** Tenerla al lado del reparto
bueno es ofrecerle a alguien el camino corto y equivocado.

### La parada

Una por turno, opcional, y es lo único que carga una persona: el motivo en texto
y, **opcionalmente, la OT de Mantenimiento** que la explica. Más la marca de
"planta parada" a nivel día, que es una parada de las cuatro de ese día a la vez.

La OT la elige una persona de una lista, nunca se adivina. Es el único puente a
otro módulo y va en esa dirección: Producción apunta a una OT, Mantenimiento no
se entera ni cambia.

**Y una trampa de permisos que hay que resolver explícitamente:** las tablas de
Mantenimiento están cerradas con su propia función de acceso. A quien cargue un
motivo sin acceso a Mantenimiento, la lista de OT le va a llegar **vacía y sin
error** — exactamente lo que pasa hoy con el valor hora en
`rrhh_empleados_datos`. Tiene que decir "no tenés acceso a Mantenimiento", no
una lista vacía que parece "no hay OT". Y una parada que ya tiene OT enlazada
tiene que mostrar al menos **el número** a quien no puede ver el detalle.

## Cuándo se pide el motivo

**A partir de 5 minutos de parada**, y **desde la fecha de puesta en servicio
del molino**.

El umbral está medido sobre Filler 1: el 47 % de los turnos tiene una parada de
entre 1 y 5 minutos, y todas juntas son el 0,8 % del tiempo perdido. Con el
corte en 5 se sigue cubriendo el **98,7 %** de las horas perdidas.

La fecha de corte existe porque la primera importación trae ocho meses de una
vez: sin ella, el primer día aparecen cerca de **mil** turnos sin explicar en la
única pantalla que este frente le genera a alguien como trabajo, que es el
anti-objetivo de la cinta de desechar a otra escala. La historia entra completa
y se puede explicar si alguien quiere; simplemente no es el pendiente de nadie.

Los dos son **datos del catálogo, no constantes escondidas**: Filler 2 tiene
otra realidad —2.144 horas no trabajadas contra 737— y el día que alguien quiera
mover el umbral no tiene que ser un cambio de código.

Un turno con parada por encima del umbral y sin motivo es un **turno
incompleto**: el indicador se calcula igual —la parada existió, el robot la
midió— pero la pantalla lo señala. Lo que falta es el porqué, no el número.

## La importación

Un cron diario **después de las 12:00 UTC**, más un botón para correrla a mano.

La hora no es negociable y es fácil de errar: el robot sube a las **09:00 de
Argentina, que son las 12:00 UTC**. Un cron a las 10:00 UTC correría dos horas
antes de que el zip exista.

Lee la carpeta de Drive con la cuenta de servicio que ya existe
(`GOOGLE_SERVICE_ACCOUNT_JSON`, scope `SCOPE_DRIVE_LECTURA`), igual que
`lib/compras/drive.ts`: el id de la carpeta en una variable de entorno, los
archivos listados por fecha, el más reciente **por prefijo de molino**. Los zips
pesan unos 39 KB y traen 8.983 filas entre los dos: entra holgado en una
función. La carpeta está en una unidad compartida, así que las llamadas van con
`supportsAllDrives=true` — sin eso Drive contesta 404 y no explica por qué.

**Y el control de obsolescencia, que antes no existía:** si el archivo más nuevo
de un molino tiene más de un día, la importación lo dice. Es el único control
que mira el resultado y no el intento — una tarea programada que dejó de correr
se nota del lado del SdG aunque nadie abra el log de esa PC.

Como el zip es acumulativo, la importación **no acumula: reconcilia**. Procesa el
archivo entero y deja la base igual a lo que dice el zip. Correrla dos veces
seguidas no puede cambiar nada.

Dos frenos que no son opcionales:

- **Lo que una persona cargó no se pisa nunca.** El motivo de una parada, su OT
  y la marca de planta parada son lo único que no viene del robot; una
  reimportación que los borre es la peor falla posible de este módulo. Si un
  turno cambia de kilos o de minutos, lo cargado sigue ahí.
- **Un zip que trae menos días de los que el sistema ya tiene no se aplica.** Es
  el mismo freno que `laPlanillaEncogio` en `lib/core/sheets.ts` y existe por la
  misma razón: un archivo truncado o un robot reinstalado no puede borrar ocho
  meses. Corta, avisa con lo que encontró, y se levanta a mano.

Un fallo de lectura no es un `console.warn`: queda guardado **con lo que dijo
Google sin traducir** y se le dice a quien corrió la importación. Misma vara que
el resto del sistema.

### Por qué no hay aviso

El resumen diario por push sale a las **11:30 UTC** y escribe `avisos_fotos` al
final de esa misma corrida. La importación corre después de las 12:00. O sea que
cualquier aviso de este frente nacería estructuralmente **un día atrasado** en el
push.

En la v1 no se agrega ninguno. Cuando se agregue, la decisión es entre mover la
importación —no se puede, el zip no existe antes— o aceptar el día de atraso y
decirlo. Lo que no se puede es agregarlo sin mirar esto: un aviso en
`lib/home/avisos.ts` va a la campana **y al teléfono de alguien**.

## Las pantallas

Tres, todas bajo `/produccion`, y ninguna fuera de ahí.

- **El día**, por molino: los cuatro turnos con toneladas, marcha, parada y los
  indicadores; los turnos acumulados, inconsistentes y huérfanos señalados por lo
  que son; el botón para cargar el motivo donde falte y el de marcar el día como
  planta parada.
- **El mes**, por molino: toneladas, horas de marcha, horas no trabajadas,
  utilización y productividad, con los días no operativos contados aparte y no
  escondidos.
- **La cola**: los turnos con parada sobre el umbral y sin explicar, desde la
  puesta en servicio. Es el único trabajo que este frente le genera a alguien.

Lo que **no** llevan: nada por material, ni el modo MANUAL/AUTOMATICO, ni los
horímetros.

Todo con `<Select>` y no `<select>`, y `grid-cols-1 sm:grid-cols-N` — las dos
reglas del CLAUDE.md que no rompen nada y por eso se olvidan. Esto se va a mirar
desde el teléfono.

## Qué queda a criterio de quien construya

- La forma exacta de las tablas y los nombres de columna.
- Si el catálogo de molinos es una tabla o un enum con su configuración al lado,
  con la condición de que el umbral, la fecha de puesta en servicio y el formato
  de archivo se puedan cambiar sin tocar código.
- Cómo se presenta el turno acumulado: una fila que cubre varios turnos, o varias
  filas marcadas. Lo que no se negocia es que **no se promedie**.
- El reparto de la pantalla, mientras los días no operativos y los turnos
  inconsistentes y huérfanos se vean y no se diluyan.

## Cómo se comprueba que quedó bien

La lógica pura —turno según la hora de cierre, día no operativo, racha
acumulada, tolerancia, los cinco indicadores— va a `lib/produccion/` con tests de
vitest, que es donde este repo pone las decisiones.

Los casos reales que tienen que estar fijados como tests, porque son los que la
macro erró o los que el dato ya produjo:

1. **2026-03-09 11:59**, 631 minutos en un bloque de 480, con cinco turnos
   faltantes antes: se cubre con la racha, no se recorta.
2. **2026-06-04 11:59** de Filler 2, 486 minutos en 480: cae dentro de la
   tolerancia, es un turno normal.
3. **2026-06-04 11:59** de Filler 1, 498 minutos en 480 sin turnos faltantes
   antes: inconsistente. Pierde sus horas, **conserva sus toneladas**.
4. **2026-10-12** (lunes, feriado): Filler 1 no tiene filas → día no operativo.
   Filler 2 tiene cuatro filas en cero → cuatro paradas a explicar, salvo que
   alguien marque el día como planta parada.
5. **El último día del zip** llega con un solo turno: los otros tres son
   huérfanos, no paradas de dieciséis horas.
6. **2026-03-01 3:59**: 33.643 kg que son 17.682 de membranero y 15.961 de
   dolomita, etiquetados `DOLOMITA`. El reparto guardado tiene que ser el real.

Y el control de orden de magnitud, con la regla completa, sobre el archivo del
19/10/2026 y sin ningún día marcado a mano como planta parada:

| | Filler 1 | Filler 2 (Calera) |
|---|---|---|
| Toneladas | 36.028 | 23.217 |
| Horas de marcha | 4.243 | 3.852 |
| Horas no trabajadas | 737 | 2.144 |
| **Utilización** | **85,2 %** | **64,2 %** |
| **Productividad** | **8,49 t/h** | **6,03 t/h** |
| Días no operativos | 22 | 0 |
| Turnos acumulados / inconsistentes / huérfanos | 14 / 3 / 44 | 2 / 0 / 3 |

Un resultado lejos de eso es un error de la importación, no una novedad de la
planta. **La utilización de Filler 2 sube a 87 % si alguien marca sus 34 días en
cero como planta parada**, y eso es correcto: la diferencia entre los dos
números es exactamente la decisión humana que el sistema no puede tomar solo.

## Lo que falta decidir fuera de este documento

- ~~**Cómo llegan los zips a Drive.**~~ Resuelto el 23/10/2026:
  [docs/PRODUCCION-FILLERS-SUBIDA.md](../../PRODUCCION-FILLERS-SUBIDA.md). Falta
  elegir en qué PC corre y si usa la cuenta de servicio que ya existe o una
  nueva con permiso sólo sobre esa carpeta — las dos son decisiones de
  instalación, no de diseño.
- **Si FILLER3 produce.** Aparece en los horímetros del robot y no tiene archivo
  propio ni botón.
- **Si el informe mensual de Filler 2 todavía se usa.** El último se guardó el 8
  de julio de 2026. Si nadie lo mira, el mes de Filler 2 puede esperar.
