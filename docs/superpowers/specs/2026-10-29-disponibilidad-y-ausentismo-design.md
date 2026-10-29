# Disponibilidad y ausentismo — el SdG como único lugar

Acordado el 29/10/2026. Medido contra la planilla real y la base. Sin empezar.

## Qué problema resuelve

Quien dirige un área necesita saber **quién no viene**, y hoy ese dato no está
donde se trabaja: está en una planilla de Google que lleva RRHH a mano y que
mira quien tiene acceso a ese libro. El resto del sistema no la ve.

Pero al ir a leerla apareció algo más grande que una pantalla que falta.

## Lo que la planilla tiene, medido el 29/10/2026

Ocho pestañas, y no son ocho vistas de lo mismo:

| Pestaña | Filas | Qué es |
|---|---|---|
| **NOVEDADES** | 218 | Las ausencias, una por fila: nombre, sector, empresa, desde, hasta, días, **motivo**, supervisor, observaciones |
| HORAS EXTRA | 107 | Horas al 50 y al 100 por persona y día, con supervisor |
| **INDICADORES** | 59 | % de ausentismo del mes **por sector × motivo**, agregado, sin nombres |
| **ANUALES** | 75 | El ausentismo del año **de cada persona**, mes a mes, con días hábiles y porcentaje |
| VACACIONES 2025 / 2026 | 69 c/u | Saldo de vacaciones por persona, con **CUIL**, legajo y fecha de ingreso |
| BASE | 76 | Operario → sector, empresa y **supervisor**. Es el organigrama |
| Hoja 6 | 13 | La lista de meses. Auxiliar de fórmulas |

### NOVEDADES es la tabla `ausencias`, llevada a mano, y va adelante

Sus motivos son **exactamente los doce del enum `tipo_ausencia`** del SdG. No se
parecen: son la misma lista. Lo que hay cargado:

```
 102  Vacaciones                        8  Exámen/estudio
  74  Enfermedad/accidente inculpable   5  Licencia gremial
  11  Permiso personal                  3  Licencia por ART
  10  Ausencia injustificada            3  Otra (aclarar)
                                        2  Fallecimiento familiar
```

Y los números que mandan en este diseño. **Ojo con la cuenta fácil, que está
mal**: la planilla tiene 207 novedades con fecha de 2026 y la tabla `ausencias`
tiene 147, pero `207 − 147` no da "las que faltan" — eso supondría que las 147
son un subconjunto de las 207, y no lo son. Cruzadas persona por persona con
rangos que se solapan:

- **60 filas de la planilla tienen su par en la base** (57 con el mismo tipo).
  Ése es el 60 que la primera versión de este documento confundió con "las que
  faltan": es justo al revés, son las que **sí** están en los dos lados.
- **147 filas de la planilla no tienen par**: 131 de enero a junio y 16 de julio
  a septiembre.
- **47 filas de la base no tienen par en la planilla** — 28 de ellas de julio,
  casi todas permisos de un día, exámenes y "otra".
- Y hay **11 novedades con fecha de 2025**, dos de las cuales terminan dentro de
  enero de 2026.

O sea que las dos listas divergieron **en las dos direcciones**, que es un
problema distinto de "a la base le faltan sesenta".

Eso vuelve a explicar algo que ya se había medido en otro proyecto —que las
ausencias se cargan con una mediana de 39 días de atraso, y que sólo 1 de 144
entró con anticipación—. **No es que RRHH no cargue: carga en el otro lado.**

## La decisión

**El SdG pasa a ser el único lugar donde se carga una ausencia.** NOVEDADES deja
de llenarse a mano.

Esto no es un espejo más, y la diferencia importa: no se sincroniza nada, no hay
`sheets_fila`, no hay pendientes de exportación. La planilla **muere** como
fuente. El proyecto ya tiene acordado dar vuelta los cinco espejos que existen
—`2026-10-19-las-planillas-las-llena-el-sistema-design.md`— justamente para no
tener más de éstos; sumar un sexto habría sido ir para el otro lado.

## Qué se muda, qué ya está y qué se pierde

- **Ya está, y no hay que hacer nada:** `SECTOR` y `EMPRESA` salen de
  `empleados.sector_id` y `empleados.empresa_id`. `LEGAJO` y `FECHA DE INGRESO`
  también están en `empleados`. `CANTIDAD DE DÍAS` se calcula del rango.
- **Se mueve:** las **147 novedades de 2026 que no tienen par en la base** —131
  de enero a junio y 16 de julio a septiembre—. Es una importación **de una sola
  vez**, no un sync; después la planilla no se vuelve a leer.
  **Inserta sin disparar el recálculo** (decidido): no llama a
  `recalcularEmpleadoPeriodo()`. El motivo de peso es que importar enero–junio
  reescribiría `calculos_diarios` de medio año que hoy está **77% marcado como
  ausente sin motivo** —no hay fichadas antes de julio y el motor asume que sin
  fichada no se vino—, y eso es una reescritura masiva de la tabla diaria de
  RRHH que nadie pidió.
  **Esto es seguro porque los tres reportes se calculan desde `ausencias` y no
  desde `calculos_diarios`.** Quien toque esta importación después tiene que
  saberlo: si algún día un reporte pasa a leer la tabla diaria, los meses
  importados no van a estar ahí.
- **Los 47 que están en la base y no en la planilla quedan como están**
  (decidido). Son casi todos permisos de un día, exámenes y "otra", 28 de ellos
  de julio. No se borran ni se exportan: la planilla muere, así que no hay a
  dónde mandarlos.
- **Se pierde a propósito: `SUPERVISOR`.** Es el único dato de NOVEDADES que el
  SdG no tiene dónde guardar, y era la semilla natural de un organigrama. Queda
  afuera porque **nada de lo que se construye acá lo necesita**: se preguntó
  quién ve los reportes y la respuesta fue que todos los encargados ven todo, así
  que no hay que filtrar por área. *(Decisión mía: no se inventa una tabla de
  organigrama que nadie va a usar. Si algún día hace falta, la columna
  `SUPERVISOR` de BASE sigue estando en la planilla para sembrarla.)*
- **Fuera de alcance:** `HORAS EXTRA` y las dos de `VACACIONES`. Las vacaciones
  ya tienen su circuito en el SdG —una ausencia de tipo `VACACIONES` sincroniza
  la fila de `vacaciones`— y la pestaña además tiene **CUIL**, que es documento
  de identidad y no tiene por qué entrar acá. Las horas extra son otro proyecto.

## Los dos reportes que el SdG tiene que producir

Esto es lo que evita que el proyecto fracase. **RRHH no llena NOVEDADES para
archivarla: la llena para sacar estos dos números.** Si el SdG no los da, RRHH va
a seguir llenando la planilla igual y vamos a terminar con las dos cosas a
medias — que es exactamente lo que pasó con la carbonilla, donde la fuente
cambió, nadie cambió la costumbre, y el número estuvo mal sin avisar durante 925
toneladas.

Son **tres**, no dos — la pestaña `INDICADORES` tiene tres tablas y la primera
versión de este documento sólo describía una:

1. **El mensual por sector × motivo** (`INDICADORES`, filas 4–22): días de
   ausencia del mes, con totales por fila y por columna. Agregado, **sin
   nombres**.
2. **El anual por persona** (`ANUALES`): por cada empleado, los días de ausencia
   de cada mes, el total, los días hábiles del período y el porcentaje.
3. **El porcentaje de ausentismo** (`INDICADORES`, filas 44–62): personal por
   sector, horas a realizar, horas perdidas y el porcentual. **Es el titular**:
   en octubre dice 6,34% general y 18,6% en Cantera, y es el número por el que
   existe la planilla. Entra al alcance (decidido).

### Cómo se cuenta un día: se reproduce lo que la planilla hace hoy

**Decidido: los números que RRHH ya conoce no se mueven.** Eso obliga a copiar
las reglas tal como están, **aunque las dos no coincidan entre sí** — y no
coinciden:

| | Regla |
|---|---|
| Mensual por sector | **Inclusive** (`min(hasta, fin de mes) − max(desde, inicio de mes) + 1`) y **prorrateado** entre meses |
| Anual por persona | **Exclusive** (`hasta − desde`, sin el +1) y **todo el rango va al mes en que empieza**, nunca se parte |

Una licencia del 5 al 12 son 8 días en el primero y 7 en el segundo. Y lo que
más pesa: de las 147 ausencias que hay en la base, **97 son de un solo día**, y
con la regla del anual ésas valen **cero**. Medido sobre esas 147: 574 días con
la regla inclusive contra 427 con la del anual.

**Esto hay que dejarlo escrito en el código, no sólo acá**, porque la primera
persona que vea las dos funciones juntas va a querer "arreglar" una para que
coincida con la otra. No es un error: es el requisito.

Las dos reglas cuentan **días de calendario**, sábados y domingos incluidos
—medido: el 26% de los días cae en fin de semana—. Eso también se reproduce.

### Los días hábiles: el único número que sí cambia, y a pedido

**Decidido: el denominador deja de ser 145 fijo.** Pasa a ser la suma de los
días hábiles **de los meses del año que ya pasaron**, acumulada mes a mes, para
que el porcentaje signifique algo a mitad de año en vez de compararse contra un
año entero que todavía no ocurrió.

*(Decisión mía sobre de dónde salen: se calculan del calendario y de la tabla
`feriados`, **no** de `calculos_diarios`. Esa tabla arranca en febrero de 2026 —
**enero no existe en ella**—, así que no puede dar el denominador del primer mes
del año. `feriados` tiene 17 filas, todas de 2026: el día que haga falta 2027
hay que cargarlas, y el reporte tiene que decirlo en vez de contar de menos en
silencio.)*

**Consecuencia asumida, y es grande:** el porcentaje anual **se va a mover**. La
mediana de días hábiles reales por empleado es 182 contra el 145 de la planilla,
así que los porcentajes bajan cerca de la mitad — el renglón que hoy dice 97,24%
va a decir algo del orden de 55%. Es lo que se pidió y es lo que hace que el
número signifique algo; pero conviene avisarle a RRHH **antes** de que lo vea.

### La tabla de horas a realizar, que hay que crear

El tercer reporte necesita, por sector, las horas que se deberían trabajar en el
mes. En la planilla eso es `(días hábiles + sábados) × 8` para los sectores de
planta y un **200 escrito a mano** para los de oficina. En el SdG no existe
nada parecido. *(Decisión mía: va como un catálogo chico y editable —sector y
horas por empleado al mes—, sembrado con lo que la planilla tiene hoy, y
editable desde la misma pantalla. Calcularlo "solo" reproduciría el 208 pero no
el 200, que es una decisión de RRHH y no una fórmula.)*

### La trampa del sector, que va a morder

La primera versión de este documento decía que los sectores duplicados del
catálogo iban a partir el reporte en dos. **Medido, eso no pasa**: `sectores`
tiene 41 filas y los nombres repetidos son **tres** de cada uno (Calidad,
Producción, Mantenimiento y también Administración), pero **sólo 15 `sector_id`
tienen algún empleado, y de cada nombre repetido sólo uno de los tres los
tiene**. Agrupar por `sector_id` hoy da 15 filas con 15 nombres distintos.

**La trampa de verdad es otra, y es más grande.** La columna `SECTOR` de
NOVEDADES es un vocabulario **más fino** y propio: `Despacho calera` (24 filas),
`Planta filler 2` (10), `Calcinación` (10), `Cantera` (9), `Molienda de cal`
(7), `Planta de trituración 1` (6), `Planta 0-2 mm` (4), `Planta filler 1` (4),
`Taller vial` (3), y una vacía. El reporte mensual de la planilla cruza esa
columna contra una lista fija de 17 nombres, así que **69 de las 207 filas de
2026 no coinciden con nada y hoy quedan afuera del reporte, en silencio**. Al
revés, esa lista de 17 incluye `Dirección` y `Administración`, que tienen **cero**
empleados en `empleados`.

O sea que mudar el sector a `empleados.sector_id` **no es gratis** como decía la
versión anterior: es un arreglo real, pero va a hacer que el número mensual del
SdG salga **bastante más alto** que el de la planilla para el mismo mes, y sin
una historia de duplicados que lo explique.

> **Acá hay un choque, y se resuelve así.** Se pidió que los números que RRHH
> conoce **no se muevan**, y éste se mueve. La alternativa era reproducir la
> lista fija de 17 nombres y **tirar las mismas 69 filas que la planilla tira**,
> o sea copiar el error para que el número quede igual.
>
> **Decisión mía: se agrupa por `empleados.sector_id` y el número sube.**
> Reproducir un conteo que pierde un tercio de las novedades sería construir a
> propósito un reporte que miente, que es el anti-objetivo de este documento y
> de todo el proyecto. Pero es la única cosa de este trabajo donde "que no mueva
> nada" no se pudo cumplir, y por eso:
>
> **La pantalla tiene que decirlo donde se ve el número**, no sólo acá: que el
> total incluye a todos los sectores y no a una lista fija, y que por eso no da
> igual que la planilla. Si el primer mes RRHH ve un número más alto sin
> explicación, van a pensar que el sistema cuenta mal y van a volver a abrir la
> planilla — que es exactamente como fracasa este proyecto.

## Quién ve qué

| Qué | Quién |
|---|---|
| **La disponibilidad**: quién no viene y qué día | Cualquiera que entre al sistema |
| **El mensual por sector** (agregado, sin nombres) | Cualquiera que entre al sistema |
| **El anual por persona** | Los `encargado`, los `admin_sistema` y quien tenga acceso a RRHH |
| El motivo de una ausencia | Sólo RRHH, como hasta ahora |

**La disponibilidad no dice por qué.** Dice que alguien no está, y nada más. Es
la misma regla que ya rige en la programación del taller, por el mismo motivo:
`ENFERMEDAD_ACCIDENTE_INCULPABLE`, `LICENCIA_ART` y `SUSPENSION` son dato médico
y disciplinario. De las 218 novedades, **74 son enfermedad y 3 son ART**: no es
un caso de borde, es un tercio del tablero.

**Pero el agregado por sector sí deja ver el motivo cuando el sector es chico, y
se acepta.** Hay sectores de **una sola persona** —RRHH y Producción-Hidratación—,
así que una celda que diga «Hidratación · Enfermedad/accidente inculpable · 12»
nombra la enfermedad de alguien a cualquiera que entre al sistema. Se preguntó
explícitamente si había que tapar las celdas por debajo de un umbral de
personal, y la respuesta fue que no. **No se suprime nada.** Lo que lo vuelve
tolerable, y conviene tenerlo a la vista si algún día cambia: hoy hay **14
usuarios en total**, así que "cualquiera que entre" son catorce personas de la
misma empresa. El día que el sistema se abra a más gente, esta decisión hay que
volver a tomarla.

**El anual por persona lo ven todos los encargados, no cada uno su área.** Se
preguntó y se decidió así. Hay 10 usuarios con rol `encargado`, 3
`admin_sistema` y 1 `operario`.

*(Corregido: la primera versión decía "los `encargado` y los `admin_sistema`", y
eso dejaba afuera justo a quien produce el reporte. El único `operario` del
sistema es la persona de RRHH que llena NOVEDADES y que cargó las 147 ausencias
que hay en la base. El permiso suma entonces "quien tenga acceso a RRHH".)* **Consecuencia asumida, dicha una vez:** el
ausentismo de cada una de las 70 personas, con nombre y porcentaje, queda
visible para esos trece. Es una decisión de gestión y está tomada.

*(Y conviene saber por qué no se filtró por área aunque suene razonable: el
sistema **no tiene** quién es encargado de qué. El rol `encargado` es global, y
lo único parecido es `usuario_areas_compras` —9 filas, el vocabulario de
Compras— que el propio proyecto ya dejó anotado que **no es el organigrama**.
Filtrar por área habría pedido construir ese organigrama primero.)*

## Dónde vive, y cómo NO se llama

**Transversal, fuera de todo módulo**, al lado de `/mis-avisos`, `/mis-pedidos`
y `/mi-cuenta`. El argumento es el mismo que ya está escrito en el encabezado de
`mis-avisos`: quien necesita saber si falta un operario trabaja en Producción, en
Cantera o en el taller, y la mayoría no tiene el módulo RRHH.

**No se llama "avisos".** Esa palabra ya está ocupada dos veces: los avisos de
Mantenimiento son las máquinas rotas, y `/mis-avisos` es esa misma cosa vista por
quien la reportó. Una tercera cosa con el mismo nombre es la trampa de "turnos"
otra vez, donde `/rrhh/turnos` significaba algo distinto de lo que todos
entendían. *(Decisión mía: se llama **Disponibilidad**, en `/disponibilidad`.
Los dos reportes cuelgan de ahí.)*

## Objetivos

- Que una ausencia se cargue **en un solo lugar**, el SdG, y que la planilla deje
  de llenarse a mano.
- Que cualquiera pueda ver quién no viene y cuándo, sin ver por qué.
- Que RRHH saque del SdG los dos números para los que hoy mantiene la planilla.
- Que las ~60 novedades que están sólo en la planilla entren una vez, para que el
  historial del sistema no mienta hacia atrás.

## No objetivos

- **No es un espejo.** No se sincroniza, no se vuelve a leer la planilla después
  de la importación inicial, no hay `sheets_fila` ni pendientes.
- **No se importan `HORAS EXTRA` ni las dos de `VACACIONES`.** Las vacaciones ya
  tienen circuito propio; la de horas extra es otro proyecto; y el CUIL no entra.
  *(Ojo: el tercer reporte necesita **horas a realizar**, que no es lo mismo que
  las horas extra trabajadas. Eso sí entra, como catálogo nuevo.)*
- **No se suprimen las celdas de los sectores chicos**, aunque dejen ver el
  motivo de una persona. Decidido a pedido; el porqué y el límite están arriba.
- **La importación no recalcula `calculos_diarios`.** Inserta y nada más.
- **No se construye un organigrama.** `SUPERVISOR` se pierde a propósito.
- **No se arregla el catálogo de sectores.** Se muestra como está, duplicados
  incluidos, y se deja dicho.
- **No se toca la liquidación.** Nada de esto cambia cómo se paga nada.
- **No manda notificaciones.** Un aviso nuevo sale por la campana y por el push a
  la vez, y acá no se cumple ninguna de las tres condiciones de
  `lib/core/avisoAlInstante.ts`.

## Anti-objetivos

- **Que la planilla siga viva en paralelo.** Si RRHH termina cargando en los dos
  lados, el proyecto empeoró las cosas: antes había una fuente mala, ahora hay
  dos que no coinciden. El entregable no es la pantalla: es que RRHH **deje** de
  llenar NOVEDADES, y eso sólo pasa si los dos reportes salen del SdG.
- **Que se filtre el motivo.** Un tercio de las novedades son enfermedad o ART.
  Que aparezcan en una pantalla abierta a todos es el peor resultado posible de
  este trabajo, peor que no haberlo hecho.
- **Que el reporte por sector mienta** por los duplicados del catálogo, sumando
  dos "Mantenimiento" como si fueran uno o mostrando sólo uno de los dos.
- **Que la importación de las 60 duplique lo que ya está.** Hay que reconocer lo
  que ya existe en `ausencias` antes de insertar, y por nombre, que es lo único
  que la planilla tiene — con la regla del proyecto: *enlazar al que se le parece
  es peor que dejar en null*. Lo que no se reconozca con certeza se informa y lo
  resuelve una persona; no se adivina.

## Restricciones

- **Next.js 16 + Supabase.** Lo transversal vive en `app/(app)/disponibilidad`,
  y la lógica pura en `lib/` — con tests, porque las rutas y las pantallas no los
  tienen.
- **La migración la corre una persona** a mano en el editor SQL de Supabase.
- **`ausencias` está cerrada con `tiene_acceso_rrhh()`.** Una pantalla abierta a
  cualquiera que entre no puede leerla con el cliente de sesión. O se lee con el
  cliente admin devolviendo **sólo lo que puede ser público**, o hace falta una
  vista. Lo que **no** se hace es abrirle la tabla entera a todo el mundo.
- **PostgREST corta en 1000 filas**: `traerTodo()` de `lib/core/paginado.ts`.
  `ausencias` tiene 147 hoy y crece todos los meses.
- **Las fechas de la planilla van en d/m**, y se leen con `fechaDeSheets()`. Leer
  al revés dio vuelta 885 fechas en Compras.
- **Los desplegables son `<Select>`**, la grilla lleva breakpoint
  (`grid-cols-1 sm:grid-cols-3`), una `<table>` va en un contenedor con scroll, y
  un ancho sobre un `.input` se pone en un `div` que lo envuelva.
- **Una policy nueva llama a su función envuelta**: `using ((select …))`.
- Todo en **castellano**. Conventional commits en castellano. **Nunca `git add -A`**.

## Lo que queda a criterio del que lo construya

- La forma de los dos reportes en pantalla, y si se exportan.
- Cómo se resuelve la lectura de `ausencias` desde una pantalla abierta: cliente
  admin con una proyección angosta, o una vista con su propia policy.
- Cómo se reconocen los empleados de la planilla por nombre en la importación, y
  cómo se le muestran a una persona los que no se reconocieron.
- El período que muestra la disponibilidad por defecto (hoy, la semana, el mes).
- Si el anual por persona se calcula al vuelo o se guarda por mes.
