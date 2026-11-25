# Configurar las OT automáticas

**Fecha:** 24/11/2026
**Módulo:** Mantenimiento
**Pantalla:** `/mantenimiento/configuracion`, sección nueva «Lo que crea órdenes solo»

---

## Qué es

Una sección en la Configuración de Mantenimiento donde se ve y se toca todo lo
que hace que el sistema cree órdenes de trabajo por su cuenta: los **ciclos
encadenados** —editables ahí— y los **mantenimientos programados** —listados
ahí y editables en su pantalla, que vuelve al menú—.

## Por qué, y por qué ahora

Lo pidió el usuario el 24/11/2026, horas después de que un ciclo generara **426
órdenes en cuatro días**. Ese incidente no lo causó la falta de esta pantalla
—la causó un error de orden en `laUltimaEnRango`, ya corregido— pero sí dejó
cuatro cosas a la vista:

1. **Para frenarlo hubo que escribir `activo = false` en la base a mano.** No
   hay botón. El único freno de un mecanismo que escribe en la planilla de
   producción y manda invitaciones a cinco calendarios está fuera de la
   aplicación.
2. **Los cuatro ciclos los plantó la semilla de una migración.** Las
   repeticiones, la especialidad, las horas estimadas y el interruptor no
   tienen pantalla ninguna. Cambiar cualquiera de esas cosas, hoy, es una
   migración o un `UPDATE` a mano.
3. **El plazo —lo primero que nombró el usuario— no está en el ciclo.** Es el
   `periodo_dias` de la tarea hija, en `mant_tareas_preventivas`, y se edita
   desde `/mantenimiento/tareas-preventivas`, una pantalla cuyo propio cartel
   dice que *confirmar una tarea todavía no genera ninguna orden*. O sea: el
   número que sí manda sobre las OT automáticas vive en el lugar que declara no
   mandar nada.
4. **El otro motor es inalcanzable.** `/mantenimiento/mantenimientos` configura
   los programados (el motor `periodicas`) y está completo —alta, edición,
   pausa, próxima fecha—, pero **no está en el menú y nada en la app lo
   enlaza**: se llega sólo tipeando la URL.

## Lo que se midió antes de escribir esto

Todo contra producción, el 24/11/2026:

| Qué | Cuánto |
|---|---|
| `mantenimientos_programados` (motor `periodicas`) | **1 fila**: MENSUAL, próxima 2026-12-06, `active` |
| `mant_ciclos_de_ot` (motor `ciclos`) | **4 filas**, exactamente las de la semilla |
| …sus parámetros | las cuatro `MECÁNICO`, `repeticiones = 3`, `horas_estimadas` en null, plazos de **6 · 6 · 10 · 3** días |
| `mant_tareas_preventivas` | **8 filas, todas `CONFIRMADA`**, todas de esa misma semilla |
| `equipos` | **269**, los 269 activos |
| `equipos_componentes` | 491 filas · 50 nombres distintos · **207 de los 269 equipos tienen al menos uno** · mediana 2 por equipo, máximo 8 |
| `ACCIONES_PREVENTIVAS` | 16 claves (vocabulario cerrado del código) |

Dos lecturas de esa tabla que cambian el diseño:

- **«Las OT automáticas» del SdG son, en los hechos, estos cuatro ciclos.** El
  otro motor tiene una fila. Así que la sección se diseña para los ciclos, y
  los programados entran para que la pregunta quede contestada entera, no
  porque haya volumen que administrar.
- **Nadie usó nunca la pantalla de tareas preventivas.** Las 8 filas del
  catálogo son las que insertó la migración del ciclo; no hay ni una
  `DESCARTADA` ni una confirmada a mano. Eso quiere decir que el catálogo
  **todavía no es un lugar donde buscar nada**, y refuerza no mandar al usuario
  ahí para cambiar un plazo.
- **62 de los 269 equipos no tienen ni un componente relevado.** Eso es el 23 %,
  y decide la forma del formulario de alta: un desplegable estricto de
  componentes del equipo dejaría a esas 62 máquinas sin poder tener ciclo
  (ver 6.2).

## Objetivos

1. Que **«¿qué crea órdenes solo, con qué plazo, y está prendido?»** se conteste
   en una pantalla.
2. Que **apagar un ciclo sea un botón**.
3. Que el **plazo** se edite donde se lo busca.
4. Que se pueda **armar un ciclo para otra máquina** sin una migración y sin
   que lo escriba un agente en la base.
5. Que antes de guardar un cambio se vea **qué va a generar y cuándo**.

## No objetivos

- **Mover el arranque y el botón «se cambiaron los martillos» fuera de la ficha
  del equipo.** Son actos operativos —registran un hecho físico— y la ficha
  argumenta explícitamente por qué el estado del ciclo tiene que estar donde
  alguien parado frente a la máquina lo pueda desmentir. La sección los
  **nombra y enlaza**; no los reemplaza.
- **Rehacer `/mantenimiento/mantenimientos`.** Funciona, y rehacerla para una
  fila es crear un segundo lugar donde editar lo mismo.
- **Enganchar el catálogo de tareas preventivas al motor de periódicas.** Sigue
  siendo el paso siguiente que ese catálogo declara, y no entra acá.
- **Borrar un ciclo.** Ver más abajo: se apaga.

## Anti-objetivos

Qué haría que esto fracase aunque técnicamente funcione:

1. **Que la pantalla sea una manera nueva de fabricar basura.** Es el riesgo
   central y es nuevo: hasta hoy nadie podía cambiar un plazo ni las
   repeticiones, y a partir de esto sí. Un `periodo_dias = 1` sobre un ciclo de
   tres vueltas, tipeado sin querer, produce exactamente la forma del incidente
   del 24/11 —órdenes de más, una detrás de otra— y esta vez con la firma de
   una persona. La defensa es la previsión en pantalla (abajo).
2. **Que el plazo quede guardado en dos lugares.** Si la sección se guarda su
   propia copia del período, el día que diverjan el sistema genera con uno y la
   pantalla muestra el otro, y nada avisa.
3. **Que se vuelva un segundo lugar donde editar los programados.** Mismo
   problema por la otra punta.
4. **Que un ciclo apagado parezca roto.** Un ciclo que no genera y no explica
   por qué es indistinguible de uno caído: ya está dicho en el encabezado de
   `CicloDeOT.tsx` y vale igual acá.
5. **Que esto necesite una migración.** No por elegancia: las corre una persona
   a mano, y una pantalla que espera un `ALTER TABLE` queda a medio desplegar.

## Restricciones

- **No hace falta ninguna migración.** Las columnas ya existen todas:
  `mant_ciclos_de_ot` tiene `repeticiones`, `especialidad`, `horas_estimadas`,
  `activo`, `creado_por`; `mant_tareas_preventivas` tiene `periodo_dias`,
  `estado`, `motivo`, `decidido_por`. Las policies de las dos tablas son
  `for all to authenticated` con `mant_puede_editar()`, así que insert, update
  y delete ya están cubiertos. **Si algo del diseño termina pidiendo una
  columna, eso es la señal de que se desvió.**
- `unique (equipment_id)` en `mant_ciclos_de_ot`: **un ciclo por equipo**.
- `unique (equipment_id, accion, componente)` en `mant_tareas_preventivas`.
- `check`: `repeticiones` entre 1 y 20 · `periodo_dias` entre 1 y 3650 ·
  `vuelta_desde` entre 0 y `repeticiones` · `tarea_madre_id <> tarea_hija_id` ·
  `desde` y `vuelta_desde` o los dos o ninguno.
- `tarea_madre_id` / `tarea_hija_id` son `on delete restrict`: una tarea que un
  ciclo usa **no se puede borrar**, y eso hay que decirlo en la pantalla del
  catálogo el día que alguien lo intente.
- **`repeticiones` no se puede bajar por debajo de `vuelta_desde`** sin violar
  el check. La pantalla tiene que impedirlo antes que la base.
- Reglas de la casa que aplican: `<Select>` y nunca `<select>` (el vocabulario
  de acciones tiene 16 opciones, así que sale con buscador solo) ·
  `grid-cols-1 sm:grid-cols-3` · el ancho va en un `div` que envuelve al campo,
  nunca en el `input` · un formulario con algo que perder va en `<Modal>` con
  su `useBorrador` · `traerTodo()` si se lee una tabla que puede crecer.
- **Nada de esto escribe una planilla**, igual que la ruta de arranque que ya
  existe: configurar un ciclo no toca ninguna OT. Por eso no entra en
  `revisar-exportaciones` — y si algún día escribe, hay que declararla ahí.

## Los caminos que se consideraron

**A — Sólo los ciclos, en una sección de Configuración.**
Lista los cuatro, edición en el lugar al estilo de «Razones para postergar»,
botón para crear uno nuevo. Barato y encaja con lo que ya hay. Deja la pregunta
contestada a medias: el programado mensual sigue invisible y su pantalla sigue
fuera del menú.

**B — Una sección «Lo que crea órdenes solo», con los dos motores.** ← **elegida**
Lo de A, y abajo los programados listados con enlace a su pantalla, que vuelve
al menú. Cuesta un poco más. A cambio, Configuración contesta entera la
pregunta que después del incidente uno quiere poder hacerle al sistema.

**C — Una pantalla propia, `/mantenimiento/automaticas`, con todo junto**
—ciclos, programados, arranque y reinicio—. La más completa y la descartada:
mete en una pantalla de configuración un botón que es operativo —«se cambiaron
los martillos» es un hecho físico que registra el mecánico— y lo saca de donde
está la máquina. Además el pedido fue explícitamente *dentro de Configuración*.

El usuario eligió **B** el 24/11/2026.

---

## Las decisiones

### 1. Dónde va la sección

`ConfiguracionClient.tsx`, **primera de la página**, arriba de «Operarios».

El resto de esa pantalla son listas de nombres —operarios, contratistas, tipos
de equipo— que evitan que cada orden invente un texto nuevo. Esto es otra cosa:
es lo único de esa pantalla que hace que **el sistema actúe solo**. Va primero
porque es lo que más cuesta si está mal.

El título es «**Lo que crea órdenes solo**» y el subtítulo dice en una línea que
son las órdenes que nacen sin que nadie las cargue.

### 2. Qué se edita de un ciclo, y qué no

Cada ciclo se dibuja como una tarjeta con el equipo arriba y, debajo, la frase
que ya usa la ficha: *«Rotación de Martillos × 3, y después Cambio de
Martillos»*.

**Editable en el lugar** (al estilo de `RazonesDePostergacion`, cada campo
guarda solo):

| Campo | Dónde vive | Nota |
|---|---|---|
| El plazo de la hija | `mant_tareas_preventivas.periodo_dias` | ver punto 3 |
| `repeticiones` | el ciclo | 1 a 20, y nunca menor que `vuelta_desde` |
| `especialidad` | el ciclo | `<Select>` con el mismo vocabulario que usa el alta de una OT |
| `horas_estimadas` | el ciclo | opcional; hoy está en null en las cuatro |
| `activo` | el ciclo | ver punto 4 |

**Sólo de lectura, con enlace a la ficha del equipo**: el último trabajo
(`desde` + `vuelta_desde`), la cara en la que está, y la OT que está esperando.
Son el **estado**, no la configuración, y el lugar donde se corrigen es la
ficha —que ya lo hace bien—.

**Las dos tareas sí se pueden cambiar, y hacerlo resetea el ciclo.** La primera
versión de este diseño decía que no eran editables —«si hace falta otro par,
apagá ese ciclo y armá otro»—, y eso era un callejón sin salida:
`unique (equipment_id)` admite **un ciclo por equipo**, no hay botón de borrar
(punto 4) y el alta no ofrece equipos que ya tengan uno (punto 6). Un equipo
cuyo ciclo se apagó nunca más podría tener otro. En un sistema con cuatro
ciclos eso no se nota hasta el día que se nota, y ese día no hay arreglo desde
la aplicación.

La razón por la que parecían no editables sigue siendo cierta y se resuelve
distinto: **`desde` y `vuelta_desde` describen el par viejo**. «El último
trabajo fue la 2ª rotación el 14/11» no quiere decir nada si la hija pasó a ser
otra tarea. Así que cambiar la madre o la hija **pone `desde` y `vuelta_desde`
en null**, o sea devuelve el ciclo a «sin arrancar», y pide confirmación
diciendo exactamente eso. Es honesto —el estado anterior no se puede traducir—
y reusa el mecanismo que ya existe en vez de inventar uno.

Las OT viejas conservan su `ciclo_id` y **no molestan**: el corte las deja
afuera, porque un ciclo sin arrancar no cuenta ninguna y, cuando arranque,
contará sólo desde esa fecha hacia adelante. Es la misma propiedad de `desde`
que protege a los cuatro ciclos de hoy.

### 3. El plazo se edita ahí, pero no se copia

El campo escribe `mant_tareas_preventivas.periodo_dias` de la **tarea hija** del
ciclo. No hay una columna nueva y no hay copia: es el mismo número que muestra
`/mantenimiento/tareas-preventivas` y el mismo del que lee el generador.

Al lado del campo, en letra chica: de qué tarea es ese número y un enlace al
catálogo. Que el plazo sea de la tarea y no del ciclo no es un detalle de
implementación que se pueda esconder — es por qué el mismo número cambia en dos
pantallas a la vez, y alguien lo va a notar.

Si la hija no tiene período, el ciclo **no puede calcular la fecha siguiente y
está detenido**: eso ya lo dice la ficha y la tarjeta lo repite.

### 4. El interruptor

Un switch «Genera órdenes» por ciclo, que escribe `activo`.

**Apagar es reversible y por eso no pide justificación ni se audita.** La regla
de la casa —«lo que no se deshace se audita»— no alcanza acá: apagar no
destruye nada, no toca ninguna OT existente y se deshace con el mismo clic. Lo
que sí se audita en este módulo —cancelar una OT, postergarla, borrar un
renglón— cambia o elimina un registro.

**Un ciclo apagado se sigue viendo**, en gris, diciendo «apagado, no genera
órdenes» y desde cuándo si se pudiera saber. Esconderlo lo volvería
indistinguible de uno que no existe.

**No hay botón de borrar.** Borrar un ciclo deja en null el `ciclo_id` de todas
sus órdenes —`on delete set null`— y con eso se pierde para siempre qué OT
salieron de él; apagarlo conserva todo y hace lo mismo. Si alguna vez hace
falta borrar de verdad, eso sí es irreversible y ahí sí va con auditoría.

Esto se sostiene **porque las tareas de un ciclo sí se pueden cambiar**
(punto 2). Sin esa salida, «un ciclo por equipo» + «no se borra» + «no se
editan las tareas» dejaba a un equipo con el ciclo apagado sin poder tener
nunca otro. Las tres reglas sólo cierran juntas.

### 5. La previsión: qué va a generar y cuándo

Son **dos líneas y no una**, y la distinción es todo el punto. La primera
versión de este diseño las confundía y por eso prometía algo falso.

#### 5.1 «Qué va a hacer en la próxima corrida»

«Crea *Rotación de Martillos* — a 2ª cara — para el 27/11», «espera la OT
3166», «no arrancó» o «trabado: *motivo*».

**Tiene que salir del mismo lugar del que decide el generador, y ese lugar no
es `queSigueEnElCiclo()` sola.** `generarEncadenadas.ts` —y el script
`que-haria-el-ciclo.mts`, que es como se mira esto hoy— corren **tres pasos en
orden**, y los dos primeros reescriben `desde`/`vuelta_desde` en memoria antes
de que el tercero mire nada:

1. `elArranqueDeUnCambio()` para un ciclo sin arrancar,
2. `elCorteQueSigue()`,
3. `queSigueEnElCiclo()`.

Llamar sólo al tercero **discrepa del generador justo en los dos estados que
importan después del incidente**: con la madre recién cerrada diría «espera la
OT 3166» mientras el generador mueve el corte en esa misma corrida y crea la
hija siguiente; y con un ciclo sin arrancar cuyo cambio ya se cerró diría «no
arrancó» mientras el generador lo arranca. Además dos de los motivos de
`trabado` —equipo inactivo, y le falta la tarea madre o la hija— los produce
`generarEncadenadas.ts` y no la función pura, así que las cuatro formas de
`Decision` no los cubren.

Entonces: **se extrae la decisión completa a una función pura** que reciba el
ciclo, sus OT y las cerradas que necesita el arranque, y devuelva la `Decision`
—incluidos esos dos `trabado`—. `generarEncadenadas` pasa a llamarla y la
previsión también. Es un refactor de código recién tocado (el arreglo de las
426 OT es del mismo día), así que va con los tests de `cicloDeOT.test.ts` en
verde antes y después, y sin cambiar ni una decisión.

Eso obliga a que la previsión se calcule **en el servidor**: necesita las OT del
ciclo y, para los sin arrancar, las cerradas del equipo — las dos lecturas de
tamaño `traerTodo`. No es un recálculo por tecla en el cliente.

#### 5.2 «Y cuándo cae la siguiente con estos parámetros»

La segunda línea existe porque la primera **no se mueve al editar el plazo**, y
sin decirlo la defensa contra el anti-objetivo 1 no existe: `queSigueEnElCiclo`
devuelve `esperar` apenas la última OT del ciclo está abierta, **antes** de usar
el valor de `periodo_dias`. Los cuatro ciclos de hoy tienen una OT viva, así que
hoy bajar el plazo de 6 a 1 no cambiaría una sola palabra de la pantalla.

Así que debajo va una línea explícitamente condicional: «al cerrarse la OT 3166,
la siguiente sería **N días** después». Ésa sí reacciona a lo que se tipea, y es
la que ve quien está por guardar un 1 donde iba un 6.

**No es una segunda definición de la decisión**: es la misma aritmética que
`crearLaSiguiente` —`sumarDias(cierre, periodo_dias)`— sobre la misma columna.
Lo que no hace es decidir *qué* vuelta viene ni *si* viene; eso lo dice 5.1.

Y lo que ninguna de las dos hace, dicho: **no proyectan el ciclo entero hacia
adelante**. Dicen el próximo paso, que es lo que el generador decide en cada
corrida.

### 6. Armar un ciclo nuevo

Un botón «Armar un ciclo» abre un `<Modal>` con `useBorrador` —hay bastante que
perder— y pide **equipo**, **componente**, y para cada una de las dos tareas su
**acción** (`<Select>` de las 16 de `ACCIONES_PREVENTIVAS`) y su **nombre**; más
**cada cuántos días la hija**, **cuántas veces** antes de que vuelva la madre,
**especialidad** y **horas estimadas**.

#### 6.1 Qué equipos se ofrecen

Los que no tienen ciclo —`unique (equipment_id)` lo prohíbe y enterarse por un
409 es peor que no verlo en la lista—. Un equipo **cuyo ciclo está apagado sí
tiene ciclo**: no aparece acá, y lo que corresponde ahí es prenderlo y, si hace
falta otro par de tareas, cambiárselas desde su tarjeta (punto 2).

#### 6.2 El componente: lista del equipo, con salida

`<Select>` con los componentes **de ese equipo** —mediana 2, máximo 8, así que
es una lista corta y útil, muy superior a los 50 nombres globales que ofrece
hoy la pantalla del catálogo—, **más una opción «otro…» que deja escribirlo**.

La salida no es un adorno: **62 de los 269 equipos no tienen ni un componente
relevado**, y un desplegable estricto los dejaría sin poder tener ciclo nunca.
`mant_tareas_preventivas.componente` es texto libre —el nombre, no el id—, así
que escribirlo es legítimo y es lo que ya permite el modelo.

#### 6.3 Si la tarea ya existe, se muestra: no se pisa ni se ignora

La clave única es `(equipment_id, accion, componente)`, así que al elegir esos
tres puede haber ya una fila, con **otro nombre, otro plazo y hasta
`estado = 'DESCARTADA'`**. Las dos salidas fáciles son malas: pisarla edita una
decisión que alguien tomó en el catálogo, y conservarla calla deja al ciclo
generando con un plazo que el formulario nunca mostró —el anti-objetivo 2
entrando por el alta—.

Así que **el formulario la carga en cuanto se completan los tres campos** y
muestra lo que hay: «ya existe *Rotación de Martillos*, cada 10 días». El plazo
y el nombre quedan editables y lo que se guarde es lo que esté a la vista. Si
estaba `DESCARTADA`, lo dice y avisa que armar el ciclo la vuelve a confirmar
—un ciclo generando desde una tarea que el catálogo descartó es una
contradicción que hoy nada detecta—.

Y si la acción y el componente de la madre y de la hija coinciden, «reusar»
daría `tarea_madre_id = tarea_hija_id` y reventaría contra el check
`mant_ciclos_de_ot_tareas_distintas`. **Lo rechaza el formulario**, no la base.

#### 6.4 Las tareas se crean sin `motivo`

La ruta del catálogo pone `motivo` en null en todo lo `CONFIRMADA`, y lo
argumenta donde está: *«el motivo sólo tiene sentido en una descartada»*.
Escribir ahí la procedencia iría contra esa regla **y se borraría sola** la
primera vez que alguien tocara esa tarea desde el catálogo.

No hace falta: de qué ciclo salió una tarea lo contesta
`mant_ciclos_de_ot` apuntándola, que es un join y no un texto. Es el mismo
argumento con el que la migración del ciclo eligió FKs en vez de copiar los
nombres.

#### 6.5 Nace sin arrancar, y puede no arrancar nunca solo

`desde` y `vuelta_desde` en null, `activo` en true. Es la decisión de la
semilla y por su misma razón: un ciclo que arranca del historial pide rotar
piezas que ya se rotaron.

**Pero «arranca con el próximo cierre de su tarea madre» no es cierto en
general, y eso hay que decirlo en el formulario.** El arranque automático no
mira `tarea_madre_id`: `elArranqueDeUnCambio()` (en `sospechaDeCambio.ts`)
busca descripciones donde el texto diga que **pusieron piezas nuevas** de ese
componente —`cambi· reemplaz· recambi· coloca· pone· instal·`— y descarta a
propósito las que hablan de rotarlas. De las 16 acciones del vocabulario, sólo
una madre que la gente escriba como un reemplazo va a disparar eso.

Un ciclo cuya madre sea `LIMPIEZA` o `REVISION` nace **dormido para siempre**, y
la dormidera es invisible: una orden que nunca nace nunca se atrasa, así que
`mant-atrasadas-por-fecha` tampoco puede nombrarla. Es exactamente el modo de
fallo que el diseño de los ciclos llamó «se habría desplegado dormido».

La respuesta es avisar, no restringir —prohibir acciones cerraría casos
legítimos, y la casa prefiere decir la verdad antes que adivinar—: si la acción
de la madre no es una que el detector pueda ver, el formulario lo dice al
guardar y la tarjeta del ciclo lo repite mientras siga sin arrancar: **«este
ciclo no arranca solo: hay que arrancarlo desde la ficha del equipo cuando se
haga el primer *{madre}*»**, con el enlace.

Y acá la sección se gana su lugar: hasta hoy un ciclo dormido no se veía en
ninguna parte. Ahora los cuatro —o los que haya— están en una pantalla que dice
cuál no arrancó.

### 7. Los programados: listados y enlazados, no absorbidos

Debajo de los ciclos, una lista chica de `mantenimientos_programados`: equipo,
cada cuánto, próxima fecha, estado. **Sólo lectura**, con un enlace a
`/mantenimiento/mantenimientos`, que es donde se editan.

Y **esa pantalla vuelve al menú de Mantenimiento** (`lib/core/nav.ts`), debajo
de «Tareas preventivas». Hoy no está y nada la enlaza: una pantalla que
configura un generador de órdenes y a la que sólo se llega tipeando la URL es,
en la práctica, una que no existe.

Por qué no se absorbe: tiene alta, edición, filtros, pausa y un botón de
generar, todo andando, para **una** fila. Rehacerlo adentro de Configuración es
el anti-objetivo 3.

### 8. Permisos

**Nivel de edición en Mantenimiento** (`puedeEditarMantenimiento`), el mismo que
ya pide la ruta de arranque de un ciclo y el botón de reinicio.

Es deliberado no subirlo a `admin`: los dos actos que ya existen —arrancar un
ciclo y declarar que se cambiaron los martillos— son más consecuentes que
cambiar unas horas estimadas, y piden edición. Pedir admin acá dejaría a quien
puede arrancar el ciclo sin poder apagarlo, que es el peor reparto posible.

Quien no tiene edición **ve la sección entera**, sin campos ni botones. Saber
qué está generando órdenes no es un privilegio.

---

## Lo que queda al constructor

- La forma exacta de las rutas (`POST /api/mantenimiento/ciclos`, `PATCH` sobre
  la que ya existe o una nueva para los parámetros) y si el plazo va por la
  ruta del ciclo o por la del catálogo. Lo único cerrado es que **no se duplica
  el número**.
- Dónde vive la función pura que decide (5.1): dentro de `cicloDeOT.ts` o en un
  archivo propio. Lo cerrado es que **sea una sola** y que la llamen el
  generador y la previsión.
- Si la previsión se pide al pintar, al abrir la tarjeta o al cambiar un campo.
  Lo cerrado es que se calcula en el servidor.
- El desglose de componentes de `ConfiguracionClient.tsx`, que ya tiene 739
  líneas: lo más probable es que la sección sea su propio archivo.
- Los tests. La vara de la casa: la lógica pura a `lib/` —qué se puede editar de
  un ciclo según su estado, qué rechaza el formulario de alta, cómo se arma el
  par de tareas, y que la función extraída en 5.1 dé lo mismo que daba el
  generador— y un test de ruta sólo si aparece un cableado que no se puede
  sacar a `lib/`.

## Riesgos asumidos

- **Se abre una puerta que estaba cerrada.** Hasta hoy nadie podía cambiar el
  plazo ni las repeticiones de un ciclo. A partir de esto sí, y un número mal
  tipeado genera órdenes de más. Lo que lo hace aceptable es la previsión antes
  de guardar y que el daño sea del mismo tipo que ya sabemos limpiar; lo que
  **no** lo cubre es un cambio hecho a conciencia con un número equivocado.
- **La función que decide se refactoriza, y es código de ayer.** 5.1 obliga a
  sacar los tres pasos del generador a una función sola. Ese generador se
  arregló el 24/11/2026 después de producir 426 órdenes, así que tocarlo tiene
  el riesgo evidente. Lo acota que `cicloDeOT.test.ts` ya tiene 34 tests y que
  el refactor no cambia ninguna decisión — pero el riesgo de que un refactor
  silencioso mueva una de las dos mitades del arreglo (el orden de
  `laUltimaEnRango` y el corte de `elCorteQueSigue`) es real y no es teórico.
- **El monitor sigue sin mirar lo que se genera.** `avisosDeSalud` vigila que el
  generador corra, no que lo que produce tenga sentido: las 426 del 24/11
  salieron con `ok = true` y `filas = 1` en cada corrida, y el tablero estuvo en
  verde todo el tiempo. Esta pantalla no lo arregla y no pretende hacerlo.
- **Un ciclo apagado no avisa de nada.** Si alguien lo apaga para frenar algo y
  se olvida de prenderlo, la máquina deja de recibir sus rotaciones y el único
  rastro es el gris de la tarjeta. No hay aviso de la campana para eso, y
  agregarlo es otro trabajo.
