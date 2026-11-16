# Las vacaciones cargadas desde RRHH figuran en Disponibilidad

**Fecha:** 2026-11-16
**Estado:** diseño acordado, sin implementar

## Por qué

Las vacaciones figuran en `/disponibilidad` **sólo si se cargaron como una
ausencia**. Hay otras dos pantallas que cargan un período de vacaciones y que no
crean ninguna ausencia: **RRHH → Vacaciones → Balance por empleado** y el bloque
de vacaciones de la **ficha del empleado** (`/rrhh/empleados/[id]`). Las dos
postean a `/api/rrhh/vacaciones`, que inserta derecho en la tabla `vacaciones`.

Disponibilidad lee `ausencias` y nada más, así que esos períodos no existen para
ella. Medido contra producción el 16/11/2026:

- **41 períodos de vacaciones cargados. 21 nacieron de una ausencia; 20 no.**
- **4 de esos 20 tocan hoy o un día futuro**: hoy hay gente de vacaciones que la
  pantalla muestra como presente.

El agujero no es sólo la grilla de Disponibilidad. Esos 20 períodos tampoco
cuentan en el **mensual, el anual ni el porcentual** de ausentismo —que están en
la misma pantalla, en la pestaña Reportes— ni abren **hueco en la programación
del taller**.

**La liquidación, en cambio, nunca estuvo ciega a ellos, y conviene saberlo
antes de tocar nada.** `recalcular.ts` lee la tabla `vacaciones` **directo**, no
a través de la ausencia, y la vacación le gana a la ausencia cargada:

```ts
if (vacacion) { ausente = false; }
else if (ausenciaCargada) { ausente = true; … }
```

O sea que esos 20 períodos ya llegan a `calculos_diarios` —como días *no*
ausentes, que es lo correcto para una vacación paga— y después de este cambio
las filas salen **idénticas**, porque el período sigue existiendo y sigue
ganando. Una primera versión de este documento decía que la liquidación no los
veía y usaba eso como motivo; era falso y está corregido acá para que nadie
vuelva a usarlo como argumento para tocar el motor.

Que el problema ya era conocido se ve en otro lado: el correo diario de
novedades tiene una función llamada `vacacionesQueNoSonUnaAusencia()`
([lib/rrhh/novedadesDelDia.ts](../../../lib/rrhh/novedadesDelDia.ts)) que existe
justamente porque hay vacaciones que no son una ausencia. El agujero se parcheó
**en el correo** y no en el sistema.

El mecanismo que falta ya existe **en un solo sentido**:
`sincronizarPeriodoVacaciones()` de [lib/rrhh/vacacionesDeAusencia.ts](../../../lib/rrhh/vacacionesDeAusencia.ts)
crea, actualiza y borra el período de `vacaciones` cuando se carga una ausencia
tipo `VACACIONES`. Lo que no existe es el sentido inverso.

## Objetivos

- Que un período cargado desde **Balance por empleado** aparezca en
  `/disponibilidad`, sin que RRHH lo cargue dos veces.
- **Una sola puerta**: toda fila de `vacaciones` nace de una ausencia. El
  arreglo va en la **ruta** y no en la pantalla, así que la ficha del empleado
  —la tercera puerta, que el pedido no nombró— lo hereda.
- Que los 20 períodos ya cargados entren también.

## No objetivos

- **No se muestra el motivo del lado abierto.** `/disponibilidad` sigue diciendo
  *quién no viene y qué día*, nunca por qué. Las vacaciones no son la excepción:
  la pantalla la ve cualquiera con sesión y la regla que la protege es que la
  proyección pública tiene cuatro campos y ninguno es el tipo. Después de esto,
  un día de vacaciones se ve igual que cualquier otro hueco.
- **No se toca `lecturas.ts`, `ausentesPublicos()` ni la pantalla de
  Disponibilidad.** Con la ausencia creada, lo heredan sin cambios. Éste es el
  argumento central de la decisión: el código que ya está auditado para no
  filtrar el motivo no se vuelve a tocar.
- **No se toca el motor de liquidación.** La precedencia de `recalcular.ts`
  —vacación gana sobre ausencia— se deja como está. Cambiarla movería lo que
  cobra alguien, y hacerlo adentro de una tarea sobre una pantalla de
  disponibilidad es la peor forma de cambiarlo.
- **No se toca la pantalla de RRHH → Ausencias.** Su pestaña «Licencias» filtra
  las vacaciones a propósito (`excluirTipo=VACACIONES`), así que **las 20
  ausencias nuevas no se van a ver ahí**, y está bien: las vacaciones tienen su
  propia pantalla. Decidido con el usuario el 16/11/2026. Está escrito porque
  una versión anterior de este documento afirmaba lo contrario, y quien vaya a
  buscarlas ahí no las va a encontrar.
- **No se agrega el freno de liquidación cerrada a RRHH.**
  `periodoEstaCerrado()` existe y hoy **no la llama RRHH** a propósito (ver el
  docstring de `altaDeAusencia.ts`): agregárselo acá sería cambiarle el
  comportamiento dentro de otra tarea. Medido: hoy no hay **ninguna**
  liquidación cerrada en la base, así que no cambia nada ahora.
- **No se unifican el conteo del mensual y el del anual.** Siguen contando
  distinto a propósito (ver `diasDeAusencia.ts`).
- No se agrega control de solapamiento entre ausencias. Hoy el formulario de
  Ausencias tampoco lo tiene.

## Anti-objetivos (qué sería un fracaso aunque funcione)

- **Que quede un cuarto camino de escritura a `vacaciones` que no cree la
  ausencia.** Si mañana alguien suma otra pantalla que postea a
  `/api/rrhh/vacaciones`, tiene que heredar la ausencia sin acordarse de nada.
  Por eso el cambio va en la ruta.
- **Que el número de «Días» que RRHH tipea se guarde y después lo pise la
  sincronización sin avisar.** Sería cambiar una divergencia callada por otra.
- **Que el relleno de los 20 duplique una ausencia** o mueva un balance de
  vacaciones como efecto colateral.
- Que los números de los reportes se muevan y nadie sepa por qué.

## Restricciones

- `ausencias.cargado_por_id` es **not null** y referencia `usuarios(id)`.
- `vacaciones.ausencia_id` es **unique** y `on delete cascade` sobre
  `ausencias(id)`: borrar la ausencia se lleva el período.
- `sincronizarPeriodoVacaciones()` escribe `dias_tomados` como **días de
  calendario** entre las dos fechas, los dos extremos incluidos.
- `altaDeAusencia()` ya es el cuerpo compartido por las dos puntas que crean una
  ausencia: valida, inserta, sincroniza el período y llama a
  `recalcularEmpleadoPeriodo()`.
- Esto es **DML, no DDL**: no hay migración que alguien tenga que correr en el
  editor SQL. El relleno de los 20 se aplica por PostgREST, pero escribe en
  producción.
- Las rutas de este repo no tienen tests. Lo que tenga que comprobarse va a
  `lib/` como función pura.

## Lo medido, el 16/11/2026, contra producción

Todo esto decide partes del diseño; está acá para no volver a medirlo.

| Qué | Cuánto |
|---|---|
| Períodos de vacaciones | 41 |
| …nacidos de una ausencia (`ausencia_id` no nulo) | 21 |
| …**huérfanos** (`ausencia_id` nulo) | **20** |
| Huérfanos que tocan hoy o el futuro | 4 |
| Huérfanos que **pisan** una ausencia ya cargada | **0 de 20** |
| Huérfanos con `dias_tomados` distinto del calendario | 2 de 20 |
| Con ausencia, con `dias_tomados` distinto del calendario | 1 de 21 |
| Huérfanos con `observaciones` | 7 |
| Empleados distintos involucrados | 15 (1 del padrón del taller) |
| Liquidaciones **cerradas** en la base | 0 |

Que **0 de 20 pisen una ausencia** es lo que hace seguro el relleno: no hay un
solo caso donde crear la ausencia duplique un día que ya está contado.

Las tres filas con `dias_tomados` a mano distinto del calendario:

| Período | Dice | Calendario |
|---|---|---|
| 24/09/2026 → 01/10/2026 (huérfano) | 7 | 8 |
| 11/11/2026 → 25/11/2026 (huérfano) | 14 | 15 |
| 13/10/2026 → 19/10/2026 (con ausencia) | 8 | 7 |

La tercera es la que importa para el diseño: **ese período nació de una ausencia
y aun así tiene el número a mano**, o sea que alguien lo editó después por el
`PUT`, y la sincronización no volvió a pasar. Es la prueba de que un número
tipeado al lado de un número calculado diverge solo.

### Lo que se mueve en los reportes

Los 215 días de los 20 períodos empiezan a contar en el mensual:

| Mes | Hoy | Después |
|---|---|---|
| 2026-07 | 172 | 232 |
| 2026-08 | 161 | 186 |
| 2026-09 | 119 | 136 |
| 2026-10 | 116 | 136 |
| 2026-11 | 35 | **128** |

**Noviembre casi se cuadruplica.** No es un error del nuevo número: son 20
períodos de vacaciones que faltaban. Pero es un salto que alguien va a notar, y
por eso está escrito acá y va en el commit.

Las 20 ausencias nuevas **no aparecen** en RRHH → Ausencias, por el filtro de
esa pantalla (ver No objetivos). Se ven en `/disponibilidad`, en RRHH →
Vacaciones y en la ficha del empleado.

### El correo diario de novedades, el día del relleno

`/api/cron/rrhh-novedades` corre a las 18:50 UTC, corta el día por `created_at`
y manda **un correo a cada encargado** —hoy doce— con las ausencias cargadas ese
día y el nombre de quien las cargó. Las 20 ausencias del relleno nacen todas con
el `created_at` del momento en que se corra, así que **ese correo sale con las
veinte de golpe**.

Decidido con el usuario el 16/11/2026: **que salga, avisando antes.** El relleno
se corre en un momento acordado y el usuario avisa a los encargados; el correo
queda como rastro público de la carga. No se le pone una excepción al cron: un
cron que a veces esconde cosas es peor que una ráfaga explicada.

Efecto colateral conocido y correcto: después de esto
`vacacionesQueNoSonUnaAusencia()` devuelve siempre la lista vacía, así que la
sección «Vacaciones» del correo queda permanentemente en cero y las vacaciones
salen por la sección de ausencias. La función **no se borra**: es la que evita
que una licencia salga dos veces si mañana vuelve a aparecer un período
huérfano.

## Las formas que se consideraron

**A — Una sola puerta: la carga de vacaciones crea la ausencia, y la ausencia
crea el período.** *(elegida)*
Es la simétrica de lo que ya existe. Disponibilidad, el taller y los tres
reportes lo heredan sin tocarlos, y el código que proyecta lo público no se
vuelve a tocar. Cuesta: los 215 días se suman a reportes que RRHH ya vio, y
editar o borrar un período tiene que arrastrar la ausencia —y su auditoría—.

**B — Que Disponibilidad lea además la tabla `vacaciones`.**
Sólo cambian `lecturas.ts` y la proyección pública. No mueve ningún número
histórico y no necesita relleno. Se descartó porque deja **dos fuentes de verdad
para «quién no viene»** y la misma pantalla se contradice: la grilla muestra a
alguien de vacaciones y la pestaña Reportes, a un clic, no lo cuenta. Y el
taller sigue ciego. (La liquidación no entra en este argumento: ya los ve.)

**C — Sacar el formulario de carga de Balance y mandar a Ausencias.**
Es el menos código de los tres y cierra la puerta de raíz. Se descartó porque le
cambia el flujo de trabajo a RRHH, que carga desde ahí justamente porque tiene
el balance del empleado a la vista mientras carga.

## El diseño

### 1. El `POST` de `/api/rrhh/vacaciones` deja de insertar en `vacaciones`

Pasa por `altaDeAusencia()` con:

- `tipo: "VACACIONES"`
- `justificada: true` — es lo que `sincronizarPeriodoVacaciones()` exige para
  que el período exista; una vacación «no justificada» no es una cosa.
- `anioCorrespondiente`, que los dos formularios ya mandan.
- `observaciones`, lo que venga.
- `cargadoPorId`, el usuario de la sesión.

`sincronizarPeriodoVacaciones()` escribe la fila de `vacaciones` con su
`ausencia_id`, y `recalcularEmpleadoPeriodo()` corre dentro de `altaDeAusencia`,
así que el `recalcular` suelto que hoy tiene la ruta se va (hoy correría dos
veces).

La ruta **sigue devolviendo el período** y no la ausencia: es lo que devuelve
hoy, y aunque ninguna de las dos pantallas lee el cuerpo, cambiarlo sería un
cambio de contrato gratis.

Los errores que devuelva `altaDeAusencia` se pasan tal cual: son mensajes en
castellano que ya conoce quien usa RRHH.

### 2. El `PUT` de `/api/rrhh/vacaciones/[id]` edita la ausencia, no el período

Si el período tiene `ausencia_id`, los cambios van a la **ausencia**
(`fecha_desde`, `fecha_hasta`, `observaciones`, y el empleado si cambió) y
después corre `sincronizarPeriodoVacaciones()`, que reescribe el período —
incluido `anio_correspondiente`, que viaja como parámetro.

Si no lo tiene, se comporta como hoy. Después del relleno no debería quedar
ninguno, pero la ruta no lo da por sentado: una fila escrita a mano en la base
no tiene por qué romper la edición.

### 3. El `DELETE` borra la ausencia, y la cascada se lleva el período

Si tiene `ausencia_id`, borra la **ausencia**; `on delete cascade` se lleva la
fila de `vacaciones`. Si no, borra el período como hoy. En los dos casos
recalcula el rango.

### 3 bis. Las dos puntas se auditan igual

`/api/rrhh/ausencias/[id]` **audita los dos verbos**: `corregir` en el `PUT` y
`borrar` en el `DELETE`, con el registro escrito **antes** del cambio y un 500
que bloquea la escritura si el registro no entra (`problemaDeAuditoria`). Está
en la lista de llamadores de `auditar()` de CLAUDE.md.

Una versión anterior de este documento afirmaba que esa ruta **no** auditaba y
concluía que no auditar acá «mantenía la simetría». Era al revés, y la
conclusión correcta es la contraria: **corregir o borrar un período de
vacaciones que tiene ausencia tiene que dejar el mismo rastro que hacerlo desde
la pantalla de Ausencias.** Es exactamente el mismo acto irreversible sobre la
misma fila, y la regla del repo es explícita: si agregás una acción
irreversible, agregás la llamada.

Así que el `PUT` y el `DELETE` de `/api/rrhh/vacaciones/[id]`, **cuando el
período tiene `ausencia_id`**, llevan el mismo contrato: registro primero,
verbos `corregir` y `borrar`, y si el registro no entra no se escribe nada. El
`corregir` necesita `valor_anterior` y `valor_nuevo` —sin el par, el registro
dice que alguien corrigió algo y no qué—.

Un período **sin** `ausencia_id` se borra como hoy, sin registro: no es una
ausencia y nunca lo fue.

El ayudante `problemaDeAuditoria` hoy está **duplicado** entre la punta de RRHH
y la de Mantenimiento, con un comentario que explica por qué no se compartió.
Esta tarea sería la tercera copia. Mudarlo a `lib/` o copiarlo una vez más es
del que implemente; lo que no es negociable es el contrato de arriba.

Las **20 ausencias que crea el relleno no se auditan**: `auditar()` no tiene un
verbo para crear, y crear no es irreversible. Lo que queda de rastro es la línea
en `observaciones` y el correo de novedades de ese día.

### 4. El campo «Días» sale de los dos formularios

Hoy RRHH lo tipea a mano, en Balance y en la ficha del empleado. Pasa a
**mostrarse calculado**: los días corridos entre desde y hasta, los dos extremos
incluidos, que es exactamente lo que `sincronizarPeriodoVacaciones()` escribe.

El porqué no es de prolijidad: con una sola puerta, un número tipeado **se
guarda y lo pisa la sincronización en la primera edición, sin avisar**. Eso ya
pasó —el período del 13/10 al 19/10 dice 8 y son 7— y es la misma clase de
divergencia callada que esta tarea viene a cerrar. Un campo que acepta lo que le
escriban y después lo descarta es peor que no tenerlo.

El número calculado se muestra mientras se completan las fechas, para que no sea
una sorpresa al guardar.

**Las 3 filas que hoy no coinciden no se tocan.** Decidido con el usuario el
16/11/2026, sabiendo lo que implica: quedan como están, y **la primera vez que
alguien edite una de ellas desde la pantalla, su `dias_tomados` pasa al
calendario y el balance de esa persona se mueve un día**. Son las tres de la
tabla de arriba. La alternativa era normalizarlas ahora, que mueve tres
balances de una vez sin que nadie lo haya pedido; se prefirió que el cambio
ocurra cuando alguien esté mirando ese período. El relleno las **lista** para
que queden nombradas.

Después de esto no hay ninguna pantalla por la que `dias_tomados` pueda
apartarse del calendario, y eso es a propósito: es el número que
`/api/rrhh/vacaciones/[id]/balance` suma para descontar del balance anual.

### 5. El relleno de los 20 huérfanos

Un script de una sola vez, `scripts/vacaciones-huerfanas-a-ausencias.mts`. Por
cada período con `ausencia_id` nulo:

1. Crea la ausencia: mismas fechas, `tipo: VACACIONES`, `justificada: true`.
2. Le pega el `ausencia_id` al período que ya existe — **no crea un período
   nuevo**, porque el que está tiene el `anio_correspondiente` que alguien eligió.
3. **No toca `dias_tomados`.** Los 2 que están a mano se quedan como están y el
   script los **lista**, junto con el tercero que ya tiene ausencia (ver la
   sección 4: no se normalizan, por decisión del usuario).

**No recalcula `calculos_diarios`**, y eso es un cambio respecto de la primera
versión de este documento. El recálculo sería un no-op: `recalcular.ts` lee
`vacaciones` directo y la vacación ya ganaba, así que las filas salen idénticas
antes y después. Un paso que no cambia nada pero que parece que sí es peor que
no tenerlo, porque la próxima persona lo lee como prueba de que algo se movió.

El `POST` de la ruta sí recalcula, porque ahí la vacación es nueva: lo hace
`altaDeAusencia` por dentro, **después** de que `sincronizarPeriodoVacaciones`
creó el período, que es el orden que da el resultado correcto. Por eso el
`recalcular` suelto que hoy tiene la ruta se va: hoy correría dos veces.

Corre **en seco por defecto** e imprime lo que haría; escribe con `--aplicar`.
Antes de escribir vuelve a comprobar que el período no pise una ausencia
existente —hoy son 0 de 20, pero el script corre después de esto y alguien pudo
cargar una—; si pisa, lo saltea y lo informa en vez de duplicar un día.

El script **no puede reusar `altaDeAusencia()`** tal cual: esa función llama a
`sincronizarPeriodoVacaciones()`, que busca por `ausencia_id` y, al no
encontrar nada, insertaría un **segundo** período en vez de enganchar el que ya
existe — y además rechaza un alta de `VACACIONES` sin `anioCorrespondiente`. El
script inserta la ausencia y después le pega el id al período que ya está.

**`cargado_por_id` y la honestidad del dato.** La columna es not null y no hay
forma de saber quién cargó esos períodos. Va **Bernardo** (`admin_sistema`),
elegido por el usuario el 16/11/2026, como parámetro del script y no como un id
escrito en el código. La ausencia lleva en `observaciones` una línea al final:

```
Vacaciones cargadas desde Balance por empleado. La ausencia se creó el 16/11/2026 al unificar las dos puertas de carga.
```

Así `cargado_por_id` no se lee como una afirmación sobre quién la cargó. Los 7
períodos que ya tienen observaciones conservan las suyas y la línea va debajo.

### 6. Qué va a `lib/` para poder probarse

Las rutas no tienen tests, así que las decisiones que importan salen a funciones
puras en `lib/rrhh/periodoDeVacaciones.ts`:

- `datosDeAusenciaDeVacaciones(cuerpo, cargadoPorId)` → el `DatosDeAusencia` que
  recibe `altaDeAusencia`. Fija el `tipo`, el `justificada: true` y que el
  `anioCorrespondiente` viaje.
- `cambiosParaLaAusencia(periodoAnterior, cuerpo)` → qué campos de la ausencia
  toca un `PUT` parcial. Lo que prueba es que **un campo que no vino no se pisa
  con undefined** y que `anio_correspondiente`, que vive en el período y no en la
  ausencia, llega igual a la sincronización.

- `hayAlgoQueCambiar(cuerpo)` → si un `PUT` tiene algo que hacer. Es la que
  distingue el cuerpo vacío —que no debe escribir una fila de auditoría
  permanente por nada— del cuerpo que trae **sólo el año**, que no toca ninguna
  columna de la ausencia pero sí tiene que reescribir el período.
- `rangoAlReves(desde, hasta)` → nadie validaba que `fechaHasta` fuera posterior
  a `fechaDesde`, y el `z.number().min(0)` de `diasTomados` que tapaba a medias
  esa consecuencia desaparece junto con el campo.

Para el número de días **no se escribe ninguna función nueva**: se reusa
`diasEntre()` de `vacacionesDeAusencia.ts`, que es la misma cuenta que hace la
sincronización. Dos cuentas para el mismo número es cómo nacen los tres
`dias_tomados` divergentes de arriba.

El plan de implementación está en
[docs/superpowers/plans/2026-11-16-vacaciones-en-disponibilidad.md](../plans/2026-11-16-vacaciones-en-disponibilidad.md).

## Cómo se comprueba

```bash
npm test
npx tsc --noEmit
npm run build
node scripts/revisar-arbol-commiteado.mjs
node scripts/revisar-responsive.mjs
npx tsx scripts/probar-rutas-de-disponibilidad.mts --mes=2026-11
```

El último es el que importa para el objetivo: después del relleno, los 4
períodos vigentes o futuros tienen que aparecer en el JSON de
`/api/disponibilidad`, y **el motivo no** — ese script ya busca los motivos que
hay en la tabla dentro del JSON y sale 1 si alguno se filtró.

Lo que **ningún test de este repo puede atrapar**: que las tres rutas de
`/api/rrhh/vacaciones` queden consistentes entre sí. No tienen tests y el
comportamiento depende de PostgREST y de la cascada del otro lado del cable. Lo
que lo reemplaza es correr el relleno en seco y mirar la salida, y ejercitar las
tres operaciones a mano en la pantalla después de desplegar.

## Lo que queda a criterio del que implemente

- Dónde exactamente muestra cada formulario el número de días calculado, y con
  qué texto. La restricción es que se vea antes de guardar.
- Si `problemaDeAuditoria` se muda a `lib/` o se copia una tercera vez. El
  contrato de la sección 3 bis no se negocia; dónde vive el ayudante, sí.
- El nombre exacto del parámetro del script para el usuario de
  `cargado_por_id`, y si el `PUT` rechaza un `diasTomados` que venga en el
  cuerpo o lo ignora (las dos pantallas van a dejar de mandarlo).

## Riesgo asumido

**Los reportes se mueven mucho.** De julio a noviembre suben 215 días, y
noviembre pasa de 35 a 128. Es un número correcto que antes faltaba, pero
alguien que compare contra lo que vio la semana pasada va a creer que el sistema
se rompió. Va dicho en el commit y en
[docs/RRHH-ACTUALIZACION.md](../../RRHH-ACTUALIZACION.md).

**Tres balances de vacaciones van a cambiar un día, en algún momento, sin que
nadie lo provoque a propósito.** Son las tres filas con `dias_tomados` a mano
que no se normalizan (sección 4): la primera edición de cada una la pasa al
calendario. Está asumido y las tres están nombradas arriba.

**Doce encargados reciben un correo con veinte ausencias el día del relleno.**
Asumido, con aviso previo.

**Una fila escrita a mano en `vacaciones` vuelve a ser invisible.** Nada en la
base impide insertar un período sin `ausencia_id`; lo que se cierra son las tres
puertas de la aplicación. Un `check` que lo prohíba sería DDL y rompería el
relleno mientras corre, así que no se pone.
