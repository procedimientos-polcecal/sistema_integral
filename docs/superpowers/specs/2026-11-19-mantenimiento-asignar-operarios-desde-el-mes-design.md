# Asignar operarios a las OT desde el mes, con la rotación a la vista

**Fecha:** 19/11/2026
**Pantalla:** `/mantenimiento/programacion` — en el menú, **«Asignación RR.HH»** —,
pestaña **Mes**.

## Qué se pidió, y por qué

> «El calendario en asignación que además de mostrar la OT, muestre los
> operarios disponibles en cada semana del mes.»
> «Lo que quiero es poder asignar operarios a cada OT programada, en función de
> su disponibilidad.»

El objetivo no es la franja: es **poder asignar**. La franja existe para que al
asignar se vea contra qué.

### El primer pedido, literal, no servía — y por qué conviene saberlo

Se midió antes de diseñar nada: **un número de «operarios disponibles» por
semana sale constante**. Sobre las nueve semanas de noviembre y diciembre de
2026 da **4 mecánicos · 3 electricistas · 1 lubricador todas**, y tampoco varía
de lunes a domingo. El motivo es que las únicas dos ausencias y el único franco
de esa gente son **anteriores al 09/11**, el día en que se cargó el padrón, así
que no restan nada.

Lo que **sí** cambia cada semana es la **rotación**: los grupos A y B se dan
vuelta entre 4-12 y 12-20 (período 2) y los tres electricistas corren un turno
(período 3); el cuadro entero se repite recién a las seis semanas. Con los datos
reales:

```
semana del 30/11   4-12  grupo B: AGUIRRE, ECHEVERRIA · AGOSTA
                   8-16  GARCIA
                   12-20 grupo A: GALLASTEGUI, MENDIZABAL, PIPARO · PICART

semana del 07/12   4-12  grupo A: GALLASTEGUI, MENDIZABAL, PIPARO · PICART
                   8-16  AGOSTA
                   12-20 grupo B: AGUIRRE, ECHEVERRIA · GARCIA
```

**Esa medición es el porqué de que la franja muestre la rotación y no un
conteo.** Si alguien la reemplaza por un número, vuelve a quedar una columna que
dice lo mismo nueve semanas seguidas — y una superficie que repite el mismo
valor deja de mirarse, que es la lección ya pagada con el resumen diario de
avisos.

## Objetivos

1. En la pestaña **Mes** de «Asignación RR.HH», cada semana del calendario dice
   **quién está en cada turno esa semana**, y marca a quien ese día no viene.
2. Desde el panel de un día se le puede **poner operario a una OT de ese día**,
   eligiéndolo de una lista que muestra su turno de esa semana y si falta.
3. Lo asignado **llega a la planilla**, porque es el lugar desde donde lee quien
   no entra al sistema.

## No objetivos

- **No se toca el plan diario** (`planificacion_diaria`). Medido: **2 planes en
  toda su historia** —para el 2 y el 3 de noviembre, creados el 29 y el 30/10
  por una sola persona—, **4 ítems, 0 asignados**, y `planificacion_diaria_operarios`
  con 0 filas. Poner ahí la asignación es estrenarla en una pantalla que nadie
  abre. Su campo `assigned_to` sigue donde está y como está.
- **No se enlazan los textos históricos** de `operario_1/2/3` con personas. Son
  1.223 menciones en las últimas 1.000 OT y cuatro de los diez textos son
  ambiguos (abajo). Adivinarlos es exactamente lo que el repo prohíbe.
- **No se toca la pestaña Mes de «Programación»** (la ruta `/planificacion`). La
  rotación es del taller y la asignación vive donde se mira la rotación.
- **No se agrega una cuarta columna de operario.** La planilla tiene tres.
- **No se cambia quién puede asignar**: el mismo permiso de edición de
  Mantenimiento que ya exige el PATCH de órdenes.

## Anti-objetivos — qué sería un fracaso aunque funcione

- **Que lo asignado no llegue a la planilla.** `operario_1/2/3` son columnas
  espejo (P, Q, R del master) y **la planilla manda**: un valor que se guarda en
  la tabla y no se exporta lo borra la sincronización siguiente, sin avisar.
- **Que se escriba un apellido ambiguo.** De los diez textos que hoy viven en
  esas columnas, **cuatro nombran a más de un empleado activo**. Escribir
  «Aguirre» deja la planilla diciendo algo que no identifica a nadie.
- **Que la franja repita lo mismo todas las semanas** (lo de arriba).
- **Que asignar quede trabado** porque la persona falta. Avisar sí; impedir, no.

## Restricciones

- `operario_1/2/3` **ya viajan a los dos lados**: están en `EN_LOS_DOS_LADOS` de
  `repartirRegistroDeOT` (`lib/mantenimiento/ordenes.ts`), así que el PATCH de
  `/api/mantenimiento/ordenes` los copia al `update` **y** al `registro` que
  escribe la planilla. **No hace falta ninguna migración.**
- **Nada impide ponerle operarios a una OT abierta.** `loQueFaltaParaCerrar`
  devuelve `[]` cuando no hay `fecha_cierre`: la regla exige operarios *al
  cerrar*, nunca los prohíbe antes. Medido: de las 46 OT abiertas, **0** tienen
  operario hoy, así que no hay dato previo que respetar ni que pisar.
- **El padrón del taller tiene 8 filas y está incompleto**: falta **Raúl
  Argentino López**, que con 220 menciones es el tercer nombre más cargado de
  todos. Cargarlo es tarea del usuario, no de este cambio; el diseño tiene que
  seguir siendo usable mientras no esté.
- **Las cuatro reglas de pantalla del repo**: `<Select>` y no `<select>`;
  `grid-cols-N` con breakpoint (el ancho útil es 343 px); `<Modal>` y no
  `fixed inset-0`; y `className="input w-20"` no mide 20 — el ancho va en un
  `div` que envuelva al campo.
- **PostgREST corta en 1000 filas sin avisar**: lo que pueda crecer va con
  `traerTodo()`.
- La lógica que decida algo va a `lib/` con tests: las rutas y las pantallas no
  se testean en este repo.

## Approaches

Se consideraron tres. Las tres se midieron antes de elegir.

### A — Sólo la franja de rotación en el Mes

Cada semana del calendario gana la franja; asignar sigue siendo lo que es hoy.

- **A favor:** sale sin tocar nada más, sin migración.
- **En contra:** no cumple el pedido. Ver la rotación no es poder asignar.
- **Descartada** por eso.

### B2 — Columna nueva en el plan diario, enlazada a `empleados`

`planificacion_diaria_items.assigned_empleado_id`, con el selector ofreciendo el
padrón del taller.

- **A favor:** dato limpio, enlazado, cruzable con la disponibilidad sin
  adivinar nombres.
- **En contra:** nace en la pantalla muerta (2 planes, 4 ítems, 0 asignados), y
  necesita una migración que corre una persona a mano — o sea una ventana en la
  que el código desplegado nombra una columna que no existe.
- **Descartada**, aunque es la que deja el mejor dato. Si el plan diario se
  empieza a usar, esto vuelve a ser la opción correcta.

### B1 — Llenar los tres campos que la OT ya tiene, pero al programar ← **la elegida**

Desde el panel de un día de la pestaña Mes, con la rotación de esa semana a la
vista, se le ponen operarios a una OT de ese día. Se escriben en
`operario_1/2/3`, que es donde ese dato ya vive.

- **A favor:** es donde el dato ya está —**643 de las últimas 1.000 OT** lo
  tienen—, ya exporta, ya lo vigila el contraste, y **no necesita migración**.
  El nombre libre sigue siendo posible, que hace falta mientras López no esté en
  el padrón.
- **En contra, y asumido:** esos tres campos hoy significan «quién lo hizo» y
  pasan a significar también «quién lo va a hacer». Una OT puede terminar
  cerrada con un operario distinto del asignado, y el sistema no va a saber que
  hubo un cambio — no guarda las dos cosas. Se acepta porque la alternativa es
  un campo paralelo que diga casi lo mismo, y dos campos para la misma pregunta
  es como se pudre un modelo. Las 46 abiertas con 0 operarios hacen que no haya
  ambigüedad histórica que resolver.

**La eligió el usuario** el 19/11/2026, sobre la mesa de las tres.

## Las decisiones ya tomadas

### 1. El vocabulario sale del catálogo `operarios`, con sus posiciones

**Ya existe un catálogo curado para estas tres columnas** y lo descubrió la
revisión del diseño: la tabla `operarios` —`(slot, nombre)`, su ruta
`app/api/mantenimiento/operarios`, y el `<Select>` cerrado de
`RegistrarOTModal`—. Tiene **10 nombres repartidos en tres posiciones**:

| Columna | Quiénes pueden ir ahí |
|---|---|
| `operario_1` | Agosta · Aguirre · Ambos · Lopez · Lucas |
| `operario_2` | Echeverria · Garcia · Mendizabal |
| `operario_3` | Picart · Piparo |

**Y los datos lo respetan sin una sola excepción: 1.223 menciones de 1.223 están
en la columna que el catálogo les asigna.** No es una preferencia del
formulario; es cómo se llenó la planilla siempre.

**El panel de asignación lee ese catálogo, con sus posiciones.** Lo que se
escribe en la celda es exactamente el `nombre` del catálogo, sin tocarlo: un
vocabulario y no dos para las mismas tres columnas. Si una posición resulta ser
un artefacto de cómo se sembró el catálogo y no una regla del taller, **se
arregla moviendo la fila de slot desde la pantalla de administración que ya
existe** — el panel lee el dato, así que lo sigue solo y no hay código que
cambiar. Por eso esta decisión no necesitó respuesta.

*(Una versión anterior de este documento inventaba un formato propio —`Aguirre,
Gabriel`— para desambiguar apellidos contra los 71 empleados. Se descartó: habría
creado un segundo vocabulario para las mismas celdas, y el desplegable del cierre
no habría ofrecido lo que el panel asignó.)*

**Lo histórico no se reescribe.** Las 1.223 menciones ya cargadas quedan como
están.

### 1b. Cómo se sabe la disponibilidad de un nombre del catálogo

Resolviendo cada `nombre` contra el padrón del taller. Medido: **8 de los 10
resuelven a exactamente una persona**. Los otros tres casos **no se adivinan**:

| | |
|---|---|
| **«Ambos»** | no es una persona — se ofrece sin dato de disponibilidad |
| **«Lopez»** | es Raúl Argentino López, que **no está en el padrón** — se ofrece y dice «no está en el padrón del taller» |
| **«Lucas»** | cae en GALLASTEGUI y en MENDIZABAL, los dos del taller — ambiguo, se ofrece sin dato |

Los tres se ofrecen igual y **dicen por qué no se sabe**, que es la regla del
repo: enlazar al que se le parece es peor que dejar en null. Los dos últimos se
cierran con datos y no con código —cargar a López en el padrón, desambiguar
«Lucas» en el catálogo—, y el día que eso pase la pantalla mejora sola.

### 2. Faltar avisa, no impide — y nunca dice de qué

Si la persona tiene ausencia o franco ese día, la lista la muestra **marcada
como «falta» o «de franco», y nada más**. El `tipo` de la ausencia **no sale
nunca**, y eso no es una omisión: `/api/mantenimiento/programacion` ya lo deja
afuera con el argumento escrito de que «es dato médico y disciplinario», y
Disponibilidad sacó el desglose por motivo cuando midió que con grupos chicos
quedaba atribuido a una persona. Tres pantallas decidiendo lo mismo no pueden
decidirlo distinto.

Marcada o no, **se deja asignar igual**. Dos razones: las
ausencias se cargan tarde —la mediana entre que una empieza y que alguien la
carga es de **33 días**—, así que un bloqueo basado en ese dato frenaría trabajo
real por un dato que todavía no llegó; y quien programa sabe cosas que el
sistema no.

Es el mismo criterio que la pantalla ya aplica en otro lado: la OT que no se
puede mover **dice por qué** en vez de quedarse sin botón.

### 3. Los nombres no viajan por la ruta del calendario

**La franja y la lista necesitan una ruta propia, con
`esAdminMantenimiento`.** `/api/mantenimiento/calendario` está abierta a
cualquier nivel de Mantenimiento —incluidos los seis de sólo lectura— y su
encabezado dice textualmente que de ahí sale «sólo cuántas personas hay por
oficio —ni quién, ni el motivo—». Y `CalendarioDeOT` lo montan **tres**
pantallas contra esa misma ruta: el alta de una OT, la pestaña Mes de
`/planificacion` y la de `/programacion`. Meter nombres y faltas en ese payload
los saca por las tres, para los catorce usuarios.

Así que la franja y la lista de asignación piden su propio endpoint, guardado
como el de `/api/mantenimiento/programacion`, que es el que ya manda nombres.
**Esto no lo pidió nadie y es el hallazgo más caro de la revisión**: hacerlo al
revés se nota recién cuando alguien con lectura ve quién faltó.

**El oficio sugerido sale de la especialidad de la OT** con
`oficioDeLaEspecialidad()`, que ya existe: MECANICO → mecánico, ELECTRICO →
electricista, LUBRICACION → lubricador. Las otras tres especialidades (CIVIL,
INSTRUMENTACIÓN, OTRO) devuelven `null`, y ahí **no se sugiere a nadie** y se
muestra el padrón entero: inventarles un oficio es enlazar al que se le parece.

### 4. Dónde va la franja

**Arriba de cada fila de semana del calendario del Mes**, en la pantalla de
Asignación RR.HH y no en la otra. En un teléfono (343 px útiles) la franja
colapsa a una línea por turno; los tres turnos no entran en columnas.

### 5. Tres y no más

La planilla tiene tres columnas, así que la asignación admite **hasta tres**
personas por OT. El cuarto intento lo dice en vez de pisar al tercero.

### 6. Quién no tiene turno

Alguien del padrón sin grupo y que no sea uno de los tres electricistas de la
referencia **no tiene turno calculable esa semana**. La franja y la lista lo
dicen («sin turno asignado») en vez de esconderlo: una persona que no aparece se
lee como que no está.

### 7. Sin semana de referencia no hay rotación

`mant_programacion_referencia` puede estar vacía. En ese caso la franja dice que
falta cargar la semana de referencia y **la asignación sigue andando** sin el
dato de turno: lo que no se sabe no se inventa, y asignar no depende del turno.

### 8. La franja es el ciclo; el día es la verdad

La pestaña «Semana» **no muestra el ciclo puro**: muestra el ciclo y encima las
**pisadas** (`mant_programacion_pisadas`, la etiqueta «Movido»), que son de un
día y no de una semana. Una franja semanal calculada con el ciclo va a diferir
justo en los días que el encargado tocó a mano.

Entonces: **la franja de la semana muestra el ciclo**, y dice en una línea
cuántos días de esa semana tienen a alguien movido. **La lista de asignación,
que es de un día, muestra el turno real de ese día, pisadas incluidas** — porque
ahí es donde se decide.

Eso corrige el criterio de comprobación del documento: la franja se contrasta
contra **el ciclo** que calcula la pestaña Semana, no contra su grilla final.

### 9. Se puede sacar y se puede cambiar

Una asignación sin vuelta atrás, con nombres que se pueden equivocar, es peor
que no tenerla. **Cambiar** ya funciona: escribe un valor nuevo y no vacío.
**Sacar** tiene un agujero real y hay que taparlo:

`loQueHayQueExportar` arma el registro **sólo con lo que está `cargado()`**, así
que un `operario_2` vaciado no entra. El pendiente igual queda anotado —porque
el `estado` siempre viaja—, pero **el reintento no lleva el vaciado**: escribe
el estado, la celda conserva el nombre viejo y la sincronización siguiente lo
devuelve. O sea que sacar a alguien sólo pega si la escritura en vivo anduvo.

El arreglo es chico y acotado: esa función necesita poder distinguir **«vacío
porque no hay dato»** de **«vacío porque se borró»**. Es una función pura con
tests; los dos generadores que la llaman nunca vacían nada, así que no cambian.
Va como tarea propia del plan, con sus tests.

### 10. A qué órdenes se les puede asignar

**Sólo a las abiertas.** En una `REALIZADO` o `CANCELADA` esos campos ya dicen
«quién lo hizo» —643 de las últimas 1.000 los tienen— y pisarlos sería reescribir
historia. Las demás **dicen por qué no se puede**, igual que hace hoy
`porQueNoSePuedeMover` con las órdenes que no se pueden correr de fecha.

El panel del día muestra también las órdenes de **arrastre** (que sólo continúan
ese día). Se les puede asignar igual, y **el turno y la falta se calculan contra
el día que se está mirando**, no contra el inicio de la orden: es el día en que
esa persona va a estar ahí.

### 11. Lo que esta entrega NO va a saber

- **Cuántas OT tiene ya esa persona ese día.** Mostrarlo pediría volver del
  texto de `operario_1/2/3` a una persona para todas las órdenes del rango, que
  es justo el no objetivo de arriba. Nada impide poner a la misma persona en
  cinco órdenes del martes, y la pantalla no lo va a decir. Queda anotado como
  límite conocido, no como olvido.
- **Que postergar una OT ya asignada la manda a otra semana**, donde la rotación
  es otra y la persona asignada puede estar en otro turno. Nada lo revisa ni lo
  avisa. Es el mismo riesgo asumido que el doble sentido de los tres campos, y
  es el camino más probable de que una asignación termine mintiendo.

## Lo que queda al builder

- Dónde cortar entre `lib/` y la pantalla. La regla del repo: lo que decide algo
  va a `lib/` con tests. Como mínimo son decisiones: el texto que se escribe en
  la celda (con la ambigüedad), quién está disponible un día, y la rotación de
  una semana con nombres.
- Si la rotación por semana la calcula el cliente con lo que ya trae
  `/api/mantenimiento/calendario`, o si esa ruta devuelve la franja ya armada.
  Hoy esa ruta ya lee el padrón, las ausencias y los francos **una sola vez para
  todo el rango**, así que el dato está del lado del servidor.
- La forma exacta del panel de asignación (modal propio o sección dentro del
  panel del día que ya existe), respetando `<Modal>` y `useBorrador` si lleva
  algo escrito a mano.
- El texto exacto de los mensajes, en castellano.

## Cómo se comprueba

- `npm test` — las funciones nuevas de `lib/`.
- `npm run tipos`, `npm run build`.
- `node scripts/revisar-responsive.mjs` — el piso de hoy es **ROMPE 0 ·
  APRETADO 0 · MIRAR 1**, y ese 1 es una tabla de Calidad que ya estaba.
- `node scripts/revisar-modales.mjs` — ROMPE 0 · MIRAR 0.
- `node scripts/revisar-exportaciones.mjs` — **el que importa acá**: se toca un
  campo que se exporta.
- `node scripts/revisar-arbol-commiteado.mjs HEAD`.
- Contra producción, con el `SUPABASE_SERVICE_ROLE_KEY` de `.env.local`: que la
  rotación que dibuja la franja coincida con **el ciclo** que calcula la pestaña
  «Semana» para la misma semana — no con su grilla final, que lleva las pisadas
  encima (decisión 8). Son dos caminos al mismo cálculo y es lo único que ata
  uno al otro.
- Que los nombres **no** salgan por `/api/mantenimiento/calendario`: esa ruta
  tiene que seguir devolviendo sólo conteos por oficio (decisión 3).

## Lo que no se puede comprobar desde acá

Todo está detrás del login, así que **ninguna de estas pantallas se abre en un
navegador sin una sesión real**. Queda para quien lo use: que la franja diga lo
mismo que la pestaña «Semana», y que un operario asignado aparezca en las
columnas P/Q/R del master en la sincronización siguiente.
