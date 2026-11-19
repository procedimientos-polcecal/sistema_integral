# Mantenimiento — la reprogramación de una OT queda como dato, y una pantalla de Análisis

Diseño acordado el 19/11/2026. Nada de esto está construido.

---

## Para qué

Hoy se puede correrle la fecha a una orden de trabajo desde el botón
**Postergar**, y esa acción **ya escribe la fecha nueva**: la manda a la
planilla, la guarda en `ordenes_trabajo.fecha_ejecucion`, deja una nota en el
historial de la orden y escribe una fila de auditoría. Lo que no deja es un
**dato con el que se pueda analizar**: no hay forma de preguntarle al sistema
cuántas veces se corrió una OT, de qué fecha venía, ni cuáles son las que más
se corren.

Las tres cosas que se piden son una sola:

1. que la fecha nueva **quede como dato** y no sólo como efecto;
2. que una OT reprogramada **se vea distinta** en el listado, para poder
   atacarla primero;
3. una pantalla de **Análisis de OT** que siga la lógica de la hoja
   `Analisis de OT` de la planilla
   `1aCMQlLnigQnO32p-IxDGjsFLu-5hv8pnD8_-zTML8Jo`, y que además muestre las
   reprogramaciones y las OT que **necesitan** reprogramarse.

El porqué, en las palabras del pedido: *«este análisis en conjunto con las
reprogramaciones también sirve para analizar a futuro»*. O sea que el valor no
está en la fila de hoy sino en la serie: qué se corre, cuánto y por qué.

---

## Lo que hay hoy, medido

Todo lo de esta sección se midió contra producción entre el 18 y el 19/11/2026.
Está acá porque es lo que hace que las decisiones de abajo no sean opiniones.

| | |
|---|---|
| OT en total | **2.491** |
| Nacidas en el sistema (`app_created`) | **223** |
| Nacidas en el formulario de Google | **2.268** |
| Veces que se usó Postergar | **0** |
| Abiertas con la fecha de inicio ya vencida | **29** |
| …de ésas, con botón de Postergar | **8** |
| …de ésas, que sólo se cambian en la planilla | **21** |
| Filas en `mantenimiento_divergencias` ahora | **0** |

**Postergar nunca se usó.** Cero filas de auditoría con
`entidad = orden_trabajo`, cero notas que empiecen con `Postergada`, cero
`fecha_ejecucion_pendiente`. Eso quiere decir dos cosas: que no hay nada que
migrar, y que **no hay con qué calibrar ningún umbral** — ni un tope de días,
ni un corte de color por cantidad de reprogramaciones.

**`estado = 'ATRASADO'` no sirve para encontrar las vencidas.** De las 29
abiertas con fecha pasada, sólo **17** lo dicen; las otras doce son 8
`EN_PROCESO` y 4 `POR_HACER`. El valor lo calcula la planilla con un
`ARRAYFORMULA` contra el `TODAY()` de su último recálculo, así que envejece
solo. Cualquier conteo de este diseño pregunta **`abierta` y
`fecha_ejecucion < hoy`**, y **nunca el valor `ATRASADO`**.

**Y «abierta» es `estado` fuera de `REALIZADO` y `CANCELADA`, no
`fecha_cierre is null`.** Las dos definiciones dan números que no se parecen —
medido el 19/11/2026: **35** vencidas por la primera y **254** por la segunda—
y la segunda está documentada como poco fiable en
`lib/mantenimiento/trabajoDelAviso.ts`: de 40 órdenes abiertas, 34 tienen fecha
de cierre, así que «sin fecha = abierta» diría «abierta» sobre una de cada diez
órdenes ya hechas. Se usa la constante `CERRADAS` que ya comparten
`lib/mantenimiento/alertas.ts` y `lib/mantenimiento/gut.ts`, para no escribir el
mismo criterio en un tercer lugar. `CANCELADA` cuenta como cerrada: una orden
cancelada no es trabajo que haya que reprogramar.

**Cuidado con el nombre de ese estado, que este documento tuvo mal.** Hasta acá
decía `SUSPENDIDA`, y esa palabra **salió del vocabulario de OT el
16/11/2026**: `esEstadoDeOT("SUSPENDIDA")` da `false` y la migración
`20261116082742` la reemplazó por `CANCELADA`. Lo detectó, el primer día que
existió, el test que ata la constante nueva a `CERRADAS_GUT` — escrito
justamente para que las tres copias de esos dos valores no se separaran en
silencio. Escrito como decía este documento, el filtro habría dejado entrar
**toda OT cancelada** y no habría frenado nada. Vale como advertencia de dónde
salió el error: la constante se leyó del checkout principal, que estaba parado
en la rama de otra sesión y traía el valor viejo.

Dicho de otro modo, y porque es la trampa de este módulo: **el campo `estado`
sí se usa; el que no se usa es su valor `ATRASADO`.** Uno dice si la orden
sigue viva, que es dato del sistema; el otro es una fórmula de la planilla que
envejece sola.

**Un cambio de fecha hecho en la planilla ya se detecta, y se tira.**
`contrastar()` compara los quince campos de la orden contra la fila de la
planilla **antes** de pisarla, `fecha_ejecucion` incluido, y lo que encuentra
va a `mantenimiento_divergencias` — una tabla que **se borra y se rehace
entera en cada corrida a propósito**, porque su tamaño es lo que cuenta el
aviso y las filas viejas lo volverían inútil. O sea: hoy el sistema **se entera**
de que alguien movió una fecha allá, y lo olvida en la corrida siguiente.

**La fecha que sale del sistema tarda entre 3 y 53 horas en volver.** Postergar
escribe en la pestaña `Altas del sistema` del libro de respuestas
(`1BBudbUAGid1Ies-w6L60Di-VYpDFh5JljXsmFGmklPM`, columna `FECHA COMPROMETIDA`),
y el master la recibe por derrame de un `QUERY(IMPORTRANGE())`. En esa ventana
la `J` del master sigue diciendo la fecha vieja. `fecha_ejecucion_pendiente` es
lo que evita que la sincronización deshaga la postergación, y además saca a esa
OT del contraste mientras dura.

---

## Objetivos

- Que cada corrimiento de la fecha de inicio de una OT quede guardado con **de
  qué fecha a cuál**, y —cuando se sepa— con la razón, la justificación, quién
  y cuándo.
- Que el listado de OT **muestre la cadena completa de fechas** de una orden
  reprogramada, y cuántas veces se corrió, sin tener que abrirla.
- Que se pueda **filtrar** el listado por «reprogramadas» y por «necesitan
  reprogramarse», juntas o por separado.
- Que la pantalla de **Análisis de OT** conteste, por semana, las mismas seis
  preguntas que contesta la hoja, con las mismas cuatro listas, más las
  reprogramaciones de la semana y las OT que necesitan reprogramarse.
- Que el análisis cubra **las 2.491 órdenes** y no sólo las 223 que tienen
  botón.

## No objetivos

- **No se toca el flujo de Postergar.** La razón, los días y la justificación
  obligatoria ya están y funcionan; esto guarda lo que ese formulario ya pide.
- **No se agrega ningún aviso ni push.** Una reprogramación no cumple las tres
  condiciones del aviso al instante (`lib/core/avisoAlInstante.ts`): no hay una
  persona nombrada esperando y nada se frena hasta que alguien decida. Y no va
  a `lib/home/avisos.ts`, porque todo lo que entra ahí sale además por el push
  diario.
- **No se exporta nada nuevo a la planilla.** Postergar ya escribe la fecha y la
  observación; el historial es interno. Ningún archivo nuevo escribe en Sheets,
  así que `revisar-exportaciones.mjs` no necesita una entrada nueva.
- **No se edita una fecha desde la pantalla de Análisis.** Desde ahí se puede
  llegar a Postergar, pero la acción vive donde ya vive.
- **No se reemplaza la auditoría.** La fila de `auditoria` que Postergar ya
  escribe se queda como está. Son dos cosas distintas y conviene decirlo fuerte
  porque invita a «simplificar»: `auditoria` es inmutable, la lee sólo
  `admin_sistema` y existe para contestar *quién hizo esto que no se deshace*;
  el historial nuevo es dato operativo que tiene que leer cualquiera que entre a
  Mantenimiento.

## Anti-objetivos

Las tres cosas que harían fracasar esto aunque funcione:

- **Que el contador se vuelva un reproche.** Si postergar «queda mal», se deja
  de postergar y se corre la fecha en la planilla, que es exactamente donde el
  sistema deja de ver. El número está para analizar, no para retar: por eso no
  hay tope y por eso el cartel no cambia de color.
- **Que la pantalla de Análisis sea un segundo lugar donde se dice lo mismo.**
  Si repite el listado de OT con otro nombre, se desactualiza y nadie sabe cuál
  manda.
- **Que el historial se llene de ruido.** Una fila por cada corrección de tipeo
  en la planilla haría que la cadena de fechas de una OT cuente una historia
  falsa, y entonces nadie la miraría.

---

## Restricciones

- **La migración la corre una persona a mano** en el editor SQL de Supabase. Un
  agente puede escribirla y aplicar DML por PostgREST, pero **no puede correr
  DDL**. Hasta que la tabla exista, todo lo que la lea tiene que degradar sin
  romper, igual que hace hoy `anotarLasDivergencias`.
- **En Mantenimiento manda la planilla.** El historial no cambia eso: la fecha
  vigente sigue siendo la que resulta del ciclo de siempre.
- PostgREST corta en 1.000 filas sin avisar → `traerTodo()` en cualquier lectura
  que pueda crecer. Un `.in()` con muchos ids arma una URL que PostgREST
  rechaza con un 400 mudo → de a lotes, o por condición.
- Las policies nuevas van **envueltas**: `using ((select mant_puede_ver()))`.
- Un desplegable se escribe `<Select>`. Una grilla de tres columnas lleva
  breakpoint (`grid-cols-1 sm:grid-cols-3`). Un ancho al lado de `.input` no
  mide lo que dice: va en un `div` que lo envuelva.
- El ancho útil del teléfono es **343 px**. La fila de una OT da 342, y su línea
  de fechas en móvil ya mide ~217 de los 310 disponibles.
- Se escribe todo en castellano.
- Lo que se prueba con vitest son **funciones puras**. Las rutas y las pantallas
  no tienen tests, así que la lógica de la semana, del conteo y de la cadena se
  saca a `lib/` para poder probarla.

---

## Approaches

La decisión de fondo no fue la pantalla sino **dónde vive el registro de que
una OT se movió**. Se consideraron cuatro caminos y se descartaron dos antes de
llevarlos a la conversación.

### A — Dos columnas en `ordenes_trabajo` · descartado

`fecha_ejecucion_original` y `reprogramada_veces`. Es el camino más barato y el
que menos toca. **No sirve**: no puede dar la cadena de fechas intermedias ni
el detalle por movimiento (razón, justificación, quién), que es justamente lo
que se pidió ver.

### B — Derivarlo de `auditoria` · descartado

Postergar ya escribe una fila `corregir` con `valor_anterior` y `valor_nuevo`,
así que la cadena está ahí. **No sirve por dos razones**: `auditoria` la lee
sólo `admin_sistema` y la pantalla de Análisis la tiene que poder abrir
cualquiera de Mantenimiento; y su `contexto` es `jsonb` armado por cada ruta,
o sea prosa, no un esquema sobre el que se consulte. Además mezclaría el
registro de lo irreversible con dato operativo.

### C — Una tabla de historial, sólo para lo que pasa por el botón

Una fila por cada uso de Postergar, con de qué fecha a cuál, la razón, la
justificación, quién y cuándo. La cadena y el contador salen de contar sus
filas. Simple, siempre completo, y todas sus filas tienen autor.

**Lo que cuesta**: cubre **223 de 2.491** órdenes. Las otras 2.268 sólo se
corrigen en la planilla, y entre ellas están **las 21 vencidas que no tienen
botón**. Un análisis de reprogramaciones que ve el 9 % del universo no es el
análisis.

### D — La misma tabla, y además lo que cambia en la planilla · **elegido**

Igual que C, y además: cuando la sincronización ve que la fecha de inicio de una
OT cambió respecto de la que tenía el sistema, escribe también una fila, con
`origen = 'planilla'`, sin razón, sin justificación y sin persona — porque la
planilla no las guarda.

**Por qué se eligió**: el pedido es para análisis, y el 91 % de las órdenes
nunca podría registrar nada con C. El dato además ya se detecta hoy; lo único
que falta es no tirarlo.

**Lo que cuesta, dicho**: esas filas llegan mudas, así que la pantalla tiene que
distinguirlas y no prometer un porqué que no existe; y **una corrección de
tipeo hecha en la planilla entra como una reprogramación**. No hay forma de
distinguirlas desde este lado: lo que llega es una fecha distinta. Se recorta
dejando afuera las órdenes ya cerradas —que son el 97,5 % y donde vive casi
toda la corrección retroactiva, ver abajo— y se asume lo que quede sobre las
abiertas.

---

## El cómo, como se decidió

### 1 · El historial

Una tabla nueva, `mant_reprogramaciones_ot`. Una fila por cada vez que la fecha
de inicio de una OT se movió:

| columna | qué es |
|---|---|
| `id` | pk |
| `ot_id` | la orden, `on delete cascade` — el historial de una OT borrada no significa nada |
| `fecha_anterior` | de qué fecha venía (puede ser null: una OT sin fecha que recibe una) |
| `fecha_nueva` | a cuál fue |
| `origen` | `'sistema'` o `'planilla'` |
| `razon` | el código de `mant_razones_de_postergacion`; null si vino de la planilla |
| `razon_etiqueta` | el texto de esa razón **copiado al escribir**; null si vino de la planilla |
| `justificacion` | el texto que escribió la persona; null si vino de la planilla |
| `creado_por` | el usuario; null si vino de la planilla |
| `creado_en` | cuándo |

`ot_id` y no `ot_number` porque el resto del módulo enlaza por id, y porque el
cascade lo da la FK. RLS con las policies envueltas: lectura para
`mant_puede_ver()`, escritura sólo por el cliente admin de las rutas.

**`razon` no lleva foreign key, y la etiqueta se copia.** Las razones son una
tabla de configuración que se edita desde Mantenimiento → Configuración, o sea
que una razón se puede retirar o renombrar. Con FK, retirarla se vuelve
imposible o se lleva el historial por delante; sin FK y sin copia, la pantalla
tendría que mostrar un código que ya no resuelve a nada. Copiar la etiqueta al
escribir es lo que hace que **una reprogramación siga diciendo lo que decía el
día que se hizo**, que es lo que se consulta. El `codigo` se guarda igual, para
poder agrupar.

**Qué escribe la fila `sistema`**: la ruta `postergar`, en el mismo orden de
operaciones que ya tiene y **después** de que la escritura a la planilla salió
bien. Hoy esa ruta primero escribe en Sheets y devuelve 502 sin traducir si
falla; eso no cambia. La fila del historial va junto al `update` de la fecha.

**Qué escribe la fila `planilla`**: la sincronización de OT, en el mismo punto
donde ya corre el contraste — **antes del upsert**, que es el único momento en
que los dos lados todavía dicen cosas distintas. Se escribe sólo cuando
`contrastar()` ya decidió que es una divergencia de verdad, o sea que ya quedan
afuera las tres excusas normales (la cola de `sheets_pendiente`, el estado que
la planilla calcula sola, y vacío contra nulo) y también las OT con
`fecha_ejecucion_pendiente`, que es la ventana del derrame.

**Y sólo sobre órdenes abiertas.** Si la OT ya está cerrada, la fecha que
cambió en la planilla no se registra. Medido el 19/11/2026: **2.467 de 2.531
órdenes están `REALIZADO`**, o sea el 97,5 %, y quedan 64 abiertas. Con esa
proporción, la edición más probable de la columna de fecha de inicio no es
correr un trabajo futuro sino **corregirle la carga a algo que ya se hizo**, y
desde este lado las dos llegan iguales: una fecha distinta. Dejarlas entrar
llenaría la pestaña de Reprogramaciones —que existe para contestar *por qué se
corrió este trabajo*— de arreglos retroactivos, hasta que nadie la mire. El
freno de abajo no sirve para esto, porque esto no llega de a cuatrocientas sino
de a una.

Lo que se pierde con esta regla, dicho: **la OT que se postergó desde la
planilla y después cerró**. Si el movimiento y el cierre caen entre dos
corridas, ese corrimiento no queda registrado en ninguna parte. Se asume a
cambio de que la pestaña diga la verdad. Las postergadas desde el botón no
están afectadas: su fila se escribe en el momento, con la orden todavía
abierta.

**Una fila `planilla` no se escribe dos veces.** Antes de insertar se mira **la
última fila de esa OT**: si ya dice `fecha_nueva = ` la fecha que viene, no se
escribe nada. Hace falta porque hay tres caminos por los que la misma
transición se detecta de nuevo —dos corridas que se pisan, un upsert que falla
después de haber escrito el historial, y el botón «Traer de la planilla»
apretado encima del cron— y porque, a diferencia de
`mantenimiento_divergencias`, acá **nada borra**: un duplicado infla el
contador para siempre y en silencio, que es justo el anti-objetivo de arriba.

No va como índice único: la clave natural sería `(ot_id, fecha_anterior,
fecha_nueva)` y esa combinación **se repite de verdad** si una OT se mueve del
6/11 al 13/11 en marzo y otra vez en septiembre. La comparación contra la
última fila no tiene ese problema, porque para volver al 6/11 hubo que escribir
antes una fila que lo dice.

Lo que esto **no** cierra, dicho: dos corridas simultáneas que lean el mismo
estado antes de que ninguna escriba. La ventana se angosta mucho y no se cierra,
y no es acá donde se arregla: CLAUDE.md ya deja anotado que **no hay ningún
candado contra dos corridas simultáneas en todo el sistema** —ni
`pg_advisory_lock` ni `for update skip locked`, verificado el 05/11/2026—, y
que el segundo despliegue que escribe en esta base es un problema de otra escala
que se resuelve apagándolo.

**El freno.** Si en una corrida habría que escribir más de un puñado de filas
`planilla`, **no se escribe ninguna** y se informa por qué. Es la misma defensa
que `borradoDeEspejo` y que la fórmula del estado, y existe por lo mismo: una
planilla recalculando devuelve `Cargando…` en unas celdas y vacías las demás, y
eso es indistinguible de un cambio de fechas masivo. El número exacto queda al
constructor; hoy la tabla de divergencias está en **0**, así que cualquier
umbral razonable tiene todo el margen del mundo. **El cron no lo levanta
nunca.**

**Y se levanta con su propia llave, no con `sinFreno`.** Ese flag existe hoy
para autorizar el borrado masivo de lo que la planilla no trajo. Si lo
compartieran, quien confirma un borrado estaría aceptando además, sin verlo,
cuatrocientas reprogramaciones inventadas por una planilla que estaba
recalculando. Una confirmación autoriza una cosa.

**Nunca tira.** Si la tabla todavía no existe o la escritura falla, se devuelve
el motivo y la sincronización sigue. Importar las órdenes es lo que no puede
fallar.

### 2 · Cómo se ve una OT reprogramada en el listado

**Un renglón propio, debajo de `sector · equipo`**, con la cadena entera:

```
#2969  ●  Reacondicionar pasarela y barandas, limpiar sector para evitar caidas.
          Planta de trituración 1 · PO-A1 - Edificio
          Reprogramada  0̶6̶/̶1̶1̶ ̶→̶ ̶1̶3̶/̶1̶1̶ ̶→̶ ̶2̶0̶/̶1̶1̶  → 27/11/2026
                                    GUT 48  Atrasado  Reprog. ×3    Creación 28/10/2026
                                                                    Inicio   27/11/2026
```

Las decididas, y el porqué de cada una:

- **La cadena completa, con todas las fechas a la vista**, las corridas tachadas
  y la vigente entera. Fue pedido explícitamente contra mi recomendación de
  mostrar sólo `original → vigente`, y queda así.
- **En su propio renglón y no en la columna de fechas de la derecha.** Esa
  columna está declarada para no encogerse, así que lo que crece ahí se lo come
  la descripción: con tres fechas son ~135 px menos y con cinco ~250. Y en el
  teléfono la línea de fechas ya mide ~217 de 310, así que con tres fechas se
  parte. En su propio renglón una cadena de tres mide ~175 px y entra; con seis
  o más se parte en dos renglones y **se siguen viendo todas** — nunca se
  recorta ninguna.
- **El cartel `Reprog. ×N` se queda además de la cadena.** Dice de un vistazo
  cuántas veces, que es lo que ordena la lista.
- **El renglón sólo aparece en las OT reprogramadas.** Las demás se ven
  exactamente como hoy.
- **El cartel no cambia de color por cantidad.** «A partir de tres es grave»
  sería un umbral inventado: hay cero reprogramaciones en toda la base, así que
  no hay con qué calibrarlo. El número ya es la señal.
- **Las filas de origen `planilla` se distinguen** y no prometen un porqué que
  no existe. Decisión mía: la cadena se dibuja igual —una fecha que se movió es
  una fecha que se movió—, y es en el detalle de la pantalla de Análisis donde
  se dice «cambiada en la planilla» en lugar de una razón y un autor.

**El filtro.** Uno nuevo en el listado, que sigue la arquitectura que ya está en
`lib/mantenimiento/filtrosOt.ts`: una lista de valores, donde los valores de un
mismo filtro **suman**. Dos valores:

- `hechas` — tiene al menos una fila de historial;
- `necesitan` — abierta y con `fecha_ejecucion < hoy`.

Que sean dos valores del mismo filtro y no dos filtros es lo que hace que
elegirlos juntos dé la unión, que es lo que se pidió cuando se preguntó cuál de
las dos cosas significa «reprogramada»: **las dos**.

### 3 · La pantalla de Análisis de OT

Vive en `app/(app)/mantenimiento/analisis`. Se mueve **por semana**, de lunes a
domingo, con flechas para ir y volver.

**Las seis métricas**, con los números reales de la semana 45 (02/11 al
08/11/2026) que se usaron para diseñarla:

| | sem. 45 | qué es |
|---|---|---|
| Con inicio en la semana | 55 | OT cuya fecha de inicio cae en la semana |
| Cerradas dentro de la semana | 45 | de ésas, las que además cerraron dentro |
| Cumplimiento | 81,8 % | la división de las dos anteriores |
| No cerraron en su semana | 10 | la resta |
| Cerradas en la semana | 47 | cerraron en la semana, hayan empezado cuando sea |
| Correctivas cerradas | 9 | de esas 47, las de tipo correctivo |

Y el cuadro de **tipo de mantenimiento cerrado** (programado 38 / correctivo 9 /
sin clasificar 0, sobre las 47) con su diagnóstico en una línea, como en la
hoja.

**Esos números son una muestra, no una meta.** Se volvieron a medir el
19/11/2026 y la misma semana 45 dio 61 / 51 / 10 / 53 / 9: la planilla sigue
recibiendo cierres de semanas pasadas. Lo que se reproduce es la **forma** —las
correctivas son exactamente 9 y las que no cerraron exactamente 10—, así que
sirven como fixture de estructura. Ningún test afirma un número leído de
producción: se prueban las funciones contra un juego de órdenes congelado en el
test, o nace en rojo.

**Tres cosas que cambian respecto de la hoja, y por qué:**

- **«OTs Programadas» se llama «Con inicio en la semana».** La hoja no filtra
  por `tipo = PROGRAMADO` en ese conteo —cuenta todo lo que arranca esa
  semana— y el nombre hacía creer otra cosa.
- **Las 10 se abren en las tres cosas distintas que son**: siguen abiertas (2),
  cerraron después del domingo (6), cerraron antes del lunes (2). En la hoja el
  «10» de arriba queda peleado con el «2» de la lista de abajo, y son dos
  preguntas distintas: 10 es incumplimiento de programación, 2 es trabajo que
  todavía está sin hacer.
- **Las listas tampoco filtran por tipo ni por estado.** Dos de los cuatro
  `FILTER` de la hoja sí lo hacen: «requieren reprogramación» pide además
  `tipo = PROGRAMADO` y estado distinto de Realizado, y «cerradas fuera de
  fecha» pide `tipo = PROGRAMADO` y estado Realizado. Acá se sacan los dos
  filtros y las listas quedan siendo pura aritmética de fechas, por una razón
  que es la misma que arregló el 10 contra el 2: **las pestañas son el desglose
  de los números de arriba, así que tienen que sumar lo que ellos dicen.** Con
  el filtro de tipo puesto, el desglose de las 10 no da 10 y la pantalla vuelve
  a contradecirse sola. Es una decisión mía y es la departida más grande
  respecto de la hoja.

«Cerraron antes del lunes» se queda como número en el panel y **no tiene
pestaña**: son órdenes que cerraron antes de su propia fecha de inicio, o sea
una rareza del dato y no trabajo sobre el que haya que hacer algo. Si alguna vez
hay que mirarlas de a una, es una pestaña más y nada se opone.

**Las listas son pestañas y no columnas.** La hoja pone cuatro `FILTER` lado a
lado; cuatro tablas juntas necesitan ~3.000 px y en un teléfono de 375 no hay
forma. Son las mismas listas con las mismas columnas (N° OT, sector, equipo,
tipo, descripción, fecha de inicio, fecha de cierre, estado). Seis pestañas:

```
Con inicio en la semana 55 │ Sin cerrar 2 │ Cerradas fuera de fecha 6 │
Cerradas en la semana 47 │ Reprogramaciones 3 │ Necesitan reprogramarse hoy 35
```

**La pestaña de Reprogramaciones** es la sección donde viven los detalles que
se decidió **no** poner dentro de la orden: por cada OT movida en la semana, la
cadena, cuántos días se corrió en total, y por cada movimiento la razón, la
justificación entre comillas, quién y cuándo. Las de origen `planilla` dicen
«cambiada en la planilla» donde las otras dicen la razón.

Entran por **`creado_en`**, o sea por cuándo quedó registrado el movimiento. Y
hay que decirlo donde se lee: para una fila de origen `planilla` eso es **cuándo
lo vio la sincronización**, no cuándo alguien editó la celda. La diferencia es
de horas, pero cae en la semana de al lado si el cambio se hizo un domingo.

**Las dos últimas pestañas no se mueven con las flechas, y lo dicen.** Las
cuatro primeras son de la semana que se está mirando; «Necesitan reprogramarse»
es contra **hoy** y no contra la semana, porque una orden vencida lo está ahora,
no en noviembre pasado. Un número que no se mueve al lado de cuatro que sí se
mueven se lee como un error, así que la pestaña lo dice en su rótulo. La de
Reprogramaciones sí es de la semana.

**La pestaña «Necesitan reprogramarse»** son las abiertas con la fecha vencida
—29 el 18/11 y 35 el 19/11, porque el número sube solo con cada día que pasa—,
ordenadas por días vencida, con tres chips arriba: `N en total`, `N se pueden
postergar desde el sistema`, `N hay que cambiarlas en la planilla`. Al
19/11/2026 son 35, 11 y 24. Las primeras traen el botón **Postergar**; el resto
trae, en lugar del
botón, el texto **«Entró por el formulario — se cambia en la planilla»**. Eso
fue decidido así explícitamente: listarlas y decir por qué no hay botón es
honesto, no rompe nada, y deja el trabajo a mano donde ya está.

### 4 · El tope de días

**No se pone ninguno acumulado.** Hoy `MAXIMO_DE_DIAS = 90` es por vez, así que
tres corridas de siete días no lo tocan nunca y una OT se puede empujar
indefinidamente de a poco. Se decidió que el sistema **muestre y no frene**:
cualquier número acumulado que se eligiera ahora sería inventado —hay cero
reprogramaciones con las que calibrarlo— y un freno empuja a corregir la fecha
en la planilla, que es donde el sistema deja de ver. El contador de la fila y la
pestaña de Reprogramaciones son lo que lo delata.

---

## Lo que queda a quien lo construya

- El nombre exacto de las columnas y el número del freno.
- **Cómo filtra el listado por «reprogramadas»** era la única decisión técnica
  con filo, y se resolvió al escribir el plan: **una columna
  `reprogramada_veces` en `ordenes_trabajo`, mantenida por un trigger sobre la
  tabla del historial.** Hace falta porque el filtro tiene que correr sobre las
  2.531 órdenes y no sobre una página: con una lista de ids, un `.in()` con
  muchos arma una URL que PostgREST rechaza con un 400 mudo, y con un embebido
  `!inner` no se puede expresar la unión con «necesitan reprogramarse», que es
  el otro valor del mismo filtro.

  **Va por trigger y no por código de la aplicación**, que es lo contrario de
  lo que hace `auditar()`, y la diferencia importa: un contador que escriben
  dos rutas es un valor en dos lugares que nada ata —la trampa del 27 del GUT,
  que allá se resolvió con un test que los ata y que acá ningún test puede
  atar, porque el otro lado del cable es Postgres—. Un trigger no se puede
  olvidar. El upsert de la sincronización no la pisa: PostgREST sólo escribe
  las columnas que van en el payload, y `paraLaBase()` no la incluye.

  La **cadena** de cada fila no se cachea: sale de una segunda consulta acotada
  a los ids de la página, muy por debajo del lote de 200.
- Dónde exactamente cae el enganche dentro de `sincronizar.ts`: tiene que ser
  después de `contrastar()` y antes del upsert, y no puede hacer una lectura más
  de Google.
- El cálculo de la semana, el de los seis números y el armado de la cadena van a
  `lib/mantenimiento/` con tests. Los números de la semana 45 de este documento
  sirven de fixture.
- La migración: una sola, con la tabla, sus índices y sus policies envueltas.
  **La corre el usuario a mano**; hasta entonces todo lo que la lea degrada sin
  romper.
- Mirar `node scripts/que-cuelga-de.mjs ordenes_trabajo` antes de dar por buena
  la cascada: varias tablas de Mantenimiento las creó un delta aplicado a mano y
  sus `on delete` no están en ninguna migración.
- El umbral del freno, y el rótulo exacto de las dos pestañas que no se mueven
  con las flechas.

Y una cosa que se encontró de paso y **no es de este diseño**: el renglón de
`GOOGLE_SHEETS_OT_ID` en [docs/VARIABLES-VERCEL.md](../../VARIABLES-VERCEL.md)
apunta al libro de respuestas, cuando el id que tiene esa variable es el del
libro que lleva la hoja `Analisis de OT`. Quien construya esto va a leer esa
tabla para encontrar la planilla; conviene arreglar el renglón, en su propio
cambio.

---

## Lo que sólo se puede comprobar en la primera corrida real

- **La primera fila de origen `planilla` todavía no existe**, porque la tabla de
  divergencias está en cero. Hasta que alguien mueva una fecha allá, ese camino
  está escrito y no ejercitado.
- **Postergar nunca se usó**, así que la primera fila `sistema` va a ser también
  la primera prueba real del formulario entero.
- Los seis números de la pantalla se calcularon contra producción, pero la
  pantalla **no se abrió nunca en un navegador**.
