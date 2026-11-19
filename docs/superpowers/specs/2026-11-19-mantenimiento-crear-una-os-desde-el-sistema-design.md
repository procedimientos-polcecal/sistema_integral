# Crear una orden de servicio desde el sistema, y enlazarla con su OT

Fecha: 19/11/2026 · Módulo: Mantenimiento

## Qué se pidió

Dos cosas, en las palabras del usuario:

> Quiero ver desde la OT qué OS la cubre o al revés. Desde una OS, que nazca una
> OT, o al revés.

Y, elegido el camino:

> Configuremos la sección de OS para que se pueda generar desde el sistema y se
> registre en el sheets, al mismo estilo de funcionamiento de las demás
> planillas.

O sea: **el enlace entre las dos órdenes**, y **el alta de una OS desde la app**,
que hoy no existe y es lo que hace posible la mitad «desde una OT nace una OS».

## Por qué

Una OS es trabajo que se le pide a un tercero; una OT es trabajo del personal
propio. Son el mismo problema visto desde dos lados, y hoy el sistema no sabe
que se tocan. Medido el 19/11/2026 sobre **2.531 OT y 280 OS**: ninguna de las
dos nombra a la otra en ningún campo de texto, ni una sola vez. Nadie lo está
llevando a mano, así que no hay un criterio existente que copiar — y tampoco hay
nada que migrar.

También hay **619 OT con contratista cargado**: trabajo de un tercero que ya vive
como OT. Ésa es la zona donde las dos cosas se pisan y donde el enlace empieza a
valer.

## Goals

- Desde una OT se ve qué OS la cubre; desde una OS, qué OT la ejecutan.
- Desde una OS se genera su OT con un botón, como ya se hace desde un aviso.
- Desde una OT se crea su OS, y queda enlazada sola.
- Una OS creada desde el sistema **existe en la planilla igual que una del
  formulario**: mismo número, misma fila, mismo circuito de aprobación.

## No-goals

- Reemplazar el formulario de Google. Sigue siendo por donde pide una OS quien
  no entra al sistema, y la mayoría de las OS van a seguir entrando por ahí.
- Enlazar automáticamente los pares que ya existen. Se midió: sólo 2 de 280 OS
  tienen una OT con la descripción idéntica, así que no hay nada que adivinar, y
  adivinar es peor que dejar en null.
- Tocar la aprobación. Ya funciona y no necesita una línea (ver abajo).

## Anti-goals

Qué haría fracasar esto aunque técnicamente ande:

- **Que una OS del sistema y una respuesta del formulario queden con el mismo
  número.** Dos OS con el mismo número dejan toda la escritura de vuelta
  apuntando a la fila equivocada. Es el modo de fallo más caro y el que gobierna
  todo el diseño.
- **Que el alta corra las filas de las demás.** El seguimiento de cada OS
  —proveedor, costo, fechas— está escrito a mano en las pestañas de área y no se
  corre con su fila.
- **Que el enlace exista sólo en una dirección** o que se vea en una pantalla y
  no en la otra.

## Lo relevado, medido el 19/11/2026

Contra las planillas de producción, con la cuenta de servicio
`sheets-reader@mantenimientopp.iam.gserviceaccount.com`.

### Los dos libros

| | |
|---|---|
| Master | `PEDIDO ORDEN DE SERVICIO` · `1KHrN3ImFWRKU14snQxvYfWoIw7K6M5W2MQOPKeVh_Dw` · la cuenta de servicio **puede editar** |
| Respuestas | `FORM PEDIDO DE SERVICIO POLCECAL- POLYSAN` · `1qEar7UpLUFQzjs-nmR-U_oKatNrMdcF8wawjulFw8CY` · **compartido el 19/11/2026**; hasta ese día daba 404 |

El permiso está **medido, no supuesto**: Drive devuelve `canEdit: true` para el
libro de respuestas, así que la cuenta de servicio es Editor y el alta va a
poder escribir. (`canAddChildren: false`, que no hace falta.) El master también
es editable. Dueño de los dos: `nicolaslenzetti@polcecal.com`.

La variable nueva es **`GOOGLE_SHEETS_OS_FORMULARIO_ID`**, con el id del libro de
respuestas, y va documentada en `docs/VARIABLES-VERCEL.md` junto a las otras dos
de formulario. Sin ella el alta no escribe y lo dice con el nombre de la
variable, como hace la de OT.

El libro de respuestas tiene **dos** pestañas: `Respuestas de formulario 1`
(280 respuestas, datos de la fila 4 a la 283) y **`Altas del sistema`, que ya
existe, está vacía y tiene el mismo encabezado**. El master **no la importa**,
así que hoy no hace nada. Quién la creó y cuándo, no consta.

### Cómo se numera una OS, que es lo que decide todo

La columna `A` de las respuestas, `ID SERVICIO`, **es una fórmula por fila**:

```
A2:  -1
A3:  =IF(B:B<>"";A2+1;"")     → 0
A4:  =IF(B:B<>"";A3+1;"")     → 1
…
A283: =IF(B:B<>"";A282+1;"")  → 280
```

Un contador que baja por esa pestaña. De ahí salen tres consecuencias que no son
opinables:

1. **Una fila escrita en `Altas del sistema` no recibe número**: la fórmula no
   está ahí.
2. **Si el sistema escribe un número literal con la fórmula viva, el formulario
   le va a dar el mismo a la próxima respuesta.** La fórmula no sabe nada de la
   otra pestaña.
3. Por lo tanto **la columna `A` tiene que dejar de ser fórmula** antes de que el
   sistema pueda escribir, y alguien tiene que numerar las respuestas nuevas en
   su lugar. Es exactamente lo que ya se hizo para las OT.

### Qué importa el master, columna por columna

`SERVICIOS` es la hoja maestra. Su encabezado es
`A N° OS · B FECHA · C ÁREA · D SECTOR · E EQUIPO · F DESCRIPCIÓN ·
G FECHA DE REQUERIMIENTO · H DETALLE EXTRA · I IMAGEN · J PRIORIDAD ·
K EMPRESA · L ESTADO`, y lo arman **tres** fórmulas:

- **`A2`** → derrama `A..D`:
  `=QUERY(IMPORTRANGE(FORM; "Respuestas de formulario 1!A4:V10000");
  "SELECT Col1, Col2, Col5, Col6 WHERE Col1 IS NOT NULL"; 0)`
  o sea las columnas `A` (nº), `B` (marca temporal), `E` (área), `F` (sector) de
  las respuestas.
- **`F2`** → derrama `F..I`:
  `=QUERY(IMPORTRANGE(FORM; "Respuestas de formulario 1!A4:X10000");
  "SELECT Col21, Col22, Col23, Col24 WHERE Col1 IS NOT NULL"; 0)`
  o sea `U` (descripción), `V` (para cuándo), `W` (detalles extra), `X` (imagen).
- **`E2`** → la columna `EQUIPO`, y es la trampa:
  `=FILTER(FLATTEN(IMPORTRANGE(FORM; "Respuestas de formulario 1!G2:T10000")); …)`

**`J`, `K` y `L` se escriben a mano.** `K` y `L` ya estaban documentadas;
**`J PRIORIDAD` no**, y el documento del módulo dice hoy que `A..J` son fórmula.
No lo es: en las filas 2 a 6 del master, `J` tiene literales (`"1 SEMANA"`, o
vacío) y ninguna fórmula. El formulario **no pregunta por la prioridad**: la pone
alguien después.

### La columna EQUIPO ya está corrida, y se puede ver

Las respuestas tienen **catorce columnas de equipo**, `G` a `T`, una por sector
—es el mismo patrón que el formulario de OT—. Qué sector usa cada una:

| | | | |
|---|---|---|---|
| G Cantera, Edificios, Otros | H Trituración 1 | I Trituración 2 | J Trituración 3 |
| K Calcinación, Hidratación | L Hidratación | M Molienda de cal | N Filler 1 |
| O Filler 2 | P Planta 0-2 mm | Q Despacho | R Equipos móviles |
| S Compresores (y otros) | T Otro, Laboratorio | | |

De las 280 respuestas, **278 tienen exactamente un valor** en `G:T`. Las otras
dos son las que rompen el supuesto:

- **OS 13** tiene **dos**: `N` = `PY-A1-08 – Molino de bolas` y `S` = `.`
  (alguien tipeó un punto).
- **OS 14** no tiene **ninguno**.

`FILTER(FLATTEN(...))` aplana catorce columnas por fila y tira las vacías: no
sabe de qué fila venía cada valor. Resultado, verificado contra el master y
contra la base:

| | master `SERVICIOS` | el formulario |
|---|---|---|
| OS 13 | `PY-A1-08 – Molino de bolas` | `PY-A1-08 – Molino de bolas` + `.` |
| OS 14 | `.` | *(nada)* |

**El punto de la 13 se le escurrió a la 14**, y así está hoy en
`ordenes_servicio`: la OS 14 tiene `equipo_raw = "."`. De la 15 en adelante todo
vuelve a alinear **por casualidad**, porque el sobrante y el faltante son filas
contiguas y se compensan. Si no lo hubieran sido, las 266 filas siguientes
estarían corridas una, sin que nada avisara.

Es el mismo error que el diseño de las altas de OT arregló para su columna `D`,
y la razón por la que la `E` **no se puede dejar como está** cuando se le apile
una segunda fuente.

### La columna Y no es un equipo

`Y` dice `ESPECIFIQUE EQUIPO` en el encabezado, pero sus 229 valores son
**correos** (229 de 229 traen `@`): es a quién se le avisa. El master hace bien
en no importarla, y **no hay que incluirla** en la fórmula nueva. Que el
encabezado mienta es de la planilla, no del sistema.

### La aprobación: el circuito sirve, pero no entero

Se decidió con el usuario que **la OS del sistema pasa por Compras →
Aprobaciones, igual que las del formulario.** La primera versión de este
documento decía que eso «no necesita nada». Es falso, y lo encontró la revisión:
lo que ya funciona es el circuito para la OS que entra **por el formulario**. Hay
dos piezas que no se heredan solas.

**Lo que sí se hereda.** `aprobarCorreriaFilas()` nunca va a frenar una OS nueva:
sólo se niega cuando el número es menor al máximo de la pestaña de su área, y una
OS recién creada es siempre el máximo. Y `ESTADO` vacío **ya es** «espera
decisión», así que no hay un estado nuevo que inventar.

**Lo que no.** `esperaDecision()` (`lib/mantenimiento/aprobacion.ts`) pregunta por
la **pestaña**, no por el estado: llama a `dondeSeEscribeElEstado()`
(`lib/mantenimiento/denegacion.ts:54`), que devuelve `null` con la pestaña vacía
y `"maestro"` sólo si dice `SERVICIOS`. Una OS recién creada tiene `sheets_tab`
en null hasta la próxima sincronización, así que **no aparecería en la bandeja**,
que filtra con esa misma función.

> **Mi decisión, no del usuario:** el alta escribe `sheets_tab = 'SERVICIOS'`
> junto con el resto de la fila, y deja `sheets_row` en null. Con eso entra a la
> bandeja en el acto. El `sheets_row` en null es además lo que la protege del
> borrado de espejo mientras la planilla todavía no la devolvió, igual que
> `app_created`.

**Y el aviso en el momento no sale.** Hoy, cuando una OS nueva aparece,
`lasOSQueNacenEsperando(registros, yaEstaban)` manda un push a `os_aprobadores`;
pero filtra con `!yaEstaban.has(os_number)`, y `yaEstaban` se arma leyendo los
`os_number` que **ya están en la base** antes del upsert
(`lib/mantenimiento/sincronizar.ts`). Una OS creada desde el sistema ya está en
la base, así que **nunca va a disparar ese push**. Tampoco sale el correo de la
columna `Y` del formulario, que el alta no escribe.

**El usuario decidió que avise**, igual que en Compras. El alta llama a
`avisarAQuienDecide()` —el portón que ya existe, no un emisor nuevo— y la
sincronización no lo duplica. El porqué, y las tres condiciones que esa llamada
cumple, están en «Las tres que preguntó la revisión».

## Los caminos que se consideraron

Los tres daban las dos vistas y la generación OS→OT; se diferencian en qué pasa
con «desde una OT nace una OS» y en dónde vive el enlace.

- **A — sólo en el SdG.** El enlace vive en la base; «que nazca una OS» se
  resuelve abriendo el formulario de Google precargado y enlazando después la OS
  cuando aparece. Barato y sin dependencias. Deja el enlace invisible para quien
  no entra al sistema, y deja el alta de OS fuera del sistema.
- **B — A, más una columna en cada planilla.** Lo ve quien no entra. Cuesta que
  alguien cree `N° OS` en la planilla de OT y `OT ASIGNADA` en la de OS, y esta
  última cae en la zona de seguimiento de nueve pestañas de área.
- **C — A, más crear la OS de verdad**, replicando lo que ya se hizo con las
  altas de OT: escribir en el libro de respuestas del formulario, en una pestaña
  propia, y que el master apile las dos fuentes.

**El usuario eligió C**, con el argumento de que la sección de OS funcione «al
mismo estilo de las demás planillas». Es el más caro de los tres y el único que
cumple el pedido entero.

C **no excluye a B**: las columnas cruzadas en las planillas se pueden agregar
después sin rehacer nada, y quedan fuera de este diseño.

## Lo que hay que construir

### 1. La pestaña `Altas del sistema`

**Ya existe**, vacía y con el mismo encabezado que `Respuestas de formulario 1`.
La creó el usuario para esto y **nadie más inserta ahí**; el formulario sigue
entregando en la primera pestaña. Hay que verificar el encabezado columna por
columna antes de escribirle —se leyó hasta la `Y` y coincide—. Los datos
arrancan en la fila 2.

### 2. Congelar la numeración, y numerar en su lugar

Es el paso que ordena a todos los demás.

1. La columna `A` de `Respuestas de formulario 1` pasa de fórmula a **valores
   literales** (hoy son 280, de la fila 4 a la 283).
2. Un **Apps Script** en el libro de respuestas numera cada respuesta nueva
   tomando **el máximo de las dos pestañas más uno**. Es lo mismo que ya hace
   `docs/mantenimiento-formulario-apps-script.gs` para las OT, y conviene
   partir de ese archivo.
3. El alta del sistema **se niega a escribir si la columna `A` todavía tiene una
   fórmula por fila**. El código de OT ya hace esa comprobación y hay que
   copiarla: con la fórmula viva, una OS del sistema y una respuesta del
   formulario pueden quedar con el mismo número.

**El orden importa y es irreversible a medias**: entre congelar la columna e
instalar el script, las respuestas nuevas del formulario quedan sin número. Las
dos cosas van en la misma sentada.

### 3. Las tres importaciones del master

Pasan a apilar las dos pestañas y a ordenar por N° de OS. El `ORDER BY` no es
cosmético: sin él, el bloque del sistema queda debajo y cada respuesta nueva del
formulario lo corre entero un lugar.

- **`A2`** y **`F2`** son `QUERY` y salen directo: apilar los dos rangos con
  `{…;…}` y agregar `ORDER BY Col1`.
- **`E2`** es la que hay que diseñar. No alcanza con apilar: un `FLATTEN` no
  lleva el número al lado, así que no se puede ordenar, y ordenar las otras dos
  y ésta no es desalinear la columna EQUIPO — el error que ya está vivo en la
  OS 14. La forma que se escribió para la `D` de OT se adapta trayendo la clave
  junto al dato:

  ```
  =LET(
    d, {IMPORTRANGE(FORM; "Respuestas de formulario 1!A4:T10000");
        IMPORTRANGE(FORM; "Altas del sistema!A2:T10000")},
    k, CHOOSECOLS(d; 1),
    e, BYROW(CHOOSECOLS(d; SEQUENCE(1;14;7)); LAMBDA(f; TEXTJOIN(""; TRUE; f))),
    SORT(FILTER(e; k<>""); FILTER(k; k<>""); TRUE)
  )
  ```

  `SEQUENCE(1;14;7)` toma las columnas 7 a 20 —`G` a `T`—, y deja afuera la `Y`,
  que son correos.

  **Esta forma arregla sola la OS 14**: el equipo queda pegado a su número, así
  que una fila sin equipo da vacío en su lugar en vez de robarle el valor a la
  de abajo. Lo que no arregla es la OS 13, que seguiría diciendo
  `PY-A1-08 – Molino de bolas.` con el punto pegado — `TEXTJOIN` concatena. **El
  punto suelto en `S13` hay que borrarlo a mano en el formulario**, y es una
  línea del plan, no una decisión.

- **Probarlas antes de ponerlas**, en pestañas temporales del libro, como se hizo
  el 16/10/2026 con las de OT. Una fórmula del master que falla deja las once
  pestañas en blanco: ya pasó en Compras el 19/10/2026.

**El `ORDER BY` no mueve nada hoy, y eso hay que mirarlo antes de ponerlo.** Si
reordenara, las 280 filas del master se correrían **debajo** de los literales de
`J`, `K` y `L`, que están escritos a mano y no se corren con ellas: sería el
anti-objetivo de este diseño cumplido de un saque. No pasa, porque la serie es
estrictamente creciente por construcción —`A_n = A_{n-1} + 1`, y se midió: 280
números del 1 al 280 en 280 filas de datos, sin huecos ni repetidos—. Aun así, el
plan lo comprueba **sobre la planilla, el día que se haga**, y no sobre este
párrafo: es una lectura de una columna y cuesta nada.

### 4. El alta, en el código

- `POST /api/mantenimiento/ordenes-servicio` — **hoy no existe**, y el documento
  del módulo dice que no puede existir. Ese párrafo se reemplaza por este
  diseño.
- Escribe **primero en la planilla y después en la base**, como todo el módulo.
- Pide **nivel de edición en Mantenimiento**, el mismo que crear una OT.
- Si la planilla rechaza la escritura, no se guarda nada: una OS que existe sólo
  en el sistema no llega nunca a la pestaña de su área, nadie del área la ve, y
  el sistema diría que sí mientras la planilla la muestra sin cargar. Es la misma
  excepción al best-effort que ya rige para aprobar una OS.
- El equipo se escribe **en la columna del sector**, una de `G` a `T`. El mapa
  está en «Lo relevado». Un sector que no tenga columna propia es un caso a
  resolver en el plan: hoy las catorce cubren lo que el formulario ofrece.

### 5. Las tres columnas a mano, y la espera

`J PRIORIDAD`, `K EMPRESA` y `L ESTADO` no vienen del formulario: se escriben
directo en el master. `L` tiene que quedar **vacía** —vacío es «espera
decisión»—, y `J` y `K` las carga quien da el alta.

Pero esa fila del master **no existe hasta que el `IMPORTRANGE` derrame**, y eso
no es inmediato. Medido en las altas de OT el 03/11/2026: **48 de 48 OT quedaron
con sus columnas a mano vacías** por escribirlas a medio segundo de crear la
orden, contra **12 de 12 resueltas a los 21 segundos** por la ruta que sí
reintenta. Así que el alta **drena con `after()`** desde el arranque, con las
esperas recortadas a lo que queda de `maxDuration`, igual que
`esperasQueEntran`. Lo que no entre queda anotado como pendiente, no se pierde
en silencio.

> **Mi decisión, no del usuario:** el reintento escribe `J` y `K` **sólo si la
> celda está vacía**. En esa ventana de minutos una persona puede haber cargado
> la prioridad a mano, que es literalmente lo que hace hoy —el formulario no
> pregunta por la prioridad, «la pone alguien después»—, y el maestro es de la
> gente del área: la regla del módulo es que `SERVICIOS` no se escribe salvo el
> estado al denegar, y abrirla para dos columnas no la convierte en tierra de
> nadie. El costo de esta decisión es real y hay que decirlo en pantalla: si
> alguien se adelantó, la prioridad que eligió quien dio el alta **no entra**, y
> hay que avisarle con las dos, la que puso y la que quedó.

### 6. `sheets_row` pasa de cuenta a búsqueda

Con dos fuentes apiladas y ordenadas, la fila del master ya no se puede calcular:
se busca por número de OS. Es el mismo cambio que hicieron las altas de OT.

### 7. El enlace OS ↔ OT

- Una columna **`os_id`** en `ordenes_trabajo`, FK a `ordenes_servicio`,
  nullable y **`on delete set null`**: la OS puede desaparecer de la planilla y
  el borrado de espejo se la lleva, y eso no es razón para llevarse la OT, que
  es trabajo que se hizo. Con una sola columna se ven los dos lados: desde la
  OT, su OS; desde la OS, las OT que la cubren, que pueden ser varias. Es la
  forma del `work_order_id` del aviso, que ya funciona.
- **Desde la OS**: botón «Generar OT», igual que el de un aviso, y «Enlazar una
  OT que ya existe» para el caso en que la orden se cargó antes.
- **Desde la OT**: botón «Crear la OS», que abre el alta de la parte 4 precargada
  con el equipo, el sector y la descripción de esa OT, y deja la OT enlazada sola
  al volver.
- **Desenlazar** tiene que existir: el enlace lo hace una persona y se puede
  equivocar.
- **El enlace no se exporta a ninguna planilla.** Ninguna de las dos tiene
  columna para el número de la otra; es un dato nuevo que el Sheets no conoce,
  así que no hay divergencia posible — nadie lo va a escribir del otro lado. Es
  la misma situación que el puntaje GUT, que tampoco se exporta. Si más adelante
  se quiere allá, es el camino B y se agrega sin rehacer nada.

### 8. Qué se audita

Nada de esto es irreversible, así que **no hay llamada a `auditar()`**: crear una
OS se puede denegar, y un enlace se puede desenlazar. Se dice acá porque la
pregunta se la hace cualquiera que lea la regla del repo, y la respuesta es «se
miró y no corresponde», no «se olvidó».

## El orden, porque hay pasos que los hace una persona

1. **(persona)** Borrar el `.` de `S13` en `Respuestas de formulario 1`.
2. **(agente)** Probar las tres fórmulas nuevas en pestañas temporales.
3. **(persona, en una sentada)** Congelar la columna `A` e instalar el Apps
   Script que numera contando las dos pestañas.
4. **(persona)** Reemplazar las tres fórmulas del master.
5. **(agente)** La migración de `os_id` — la aplica el usuario a mano.
6. **(agente)** La ruta, la pantalla, el enlace, los tests.
7. **(los dos)** La primera alta de verdad, mirando los dos lados: que la fila
   caiga en `Altas del sistema` con su número, y que la OS aparezca en Compras →
   Aprobaciones. Consume un número de producción y eso está aceptado; si algo
   sale mal, la salida es denegarla.

Los pasos 1 a 4 tocan planillas de producción. Mientras no estén, el alta no
puede escribir y el código tiene que decirlo con el nombre de lo que falta, no
fallar en silencio.

## Las tres que preguntó la revisión, y cómo las contestó el usuario

### El aviso: sí, igual que en Compras

> «Deben aprobarse por gerencia, como las compras.»

En Compras, un requerimiento que queda esperando decisión manda un push en el
momento a quien tiene que decidir. Una OS que entra por el formulario también.
Que la creada desde el sistema fuera la única muda sería una diferencia que
nadie podría predecir.

**Y no es un emisor nuevo.** Es `avisarAQuienDecide()` de
`lib/core/avisoAlInstante.ts`, el mismo portón, con un segundo lugar desde donde
se lo llama: el alta. Pasa las tres condiciones que ese archivo exige, y por eso
no hace falta ninguna excepción:

1. **hay una persona nombrada esperando** — `os_aprobadores`, la lista que ya
   recibe las del formulario;
2. **nada avanza hasta que decida** — la OS no pasa a comparativa;
3. **acaba de pasar** — se creó recién.

**La duplicación se evita sola**, y por la misma razón que el push no salía: la
sincronización filtra con `!yaEstaban.has(os_number)` y la OS ya está en la
base, así que cuando después la importe no va a volver a avisar. El filtro que
era el problema es la defensa.

### El libro de respuestas: lo administra el usuario

> «La generé la pestaña `Altas del sistema` para vos. Y vive el formulario de
> Google en la primer pestaña todavía.»

O sea: la pestaña la creó el usuario para esto, **no hay un tercero escribiendo
ahí**, y el formulario sigue entregando en `Respuestas de formulario 1`. Es la
misma repartición que la planilla de OT, y el usuario pidió explícitamente que
se trate igual: *«Tenés que tener en cuenta lo mismo que hacés con la planilla
de OT.»* Eso vuelve cierto el «máximo de las dos pestañas más uno» del paso 2.

### La primera prueba: una OS de verdad, mirando los dos lados

> «Generamos una OS desde el sistema, y si cae en `Altas del sistema` está
> perfecto, y debería aparecer en el modal de aprobaciones para gerencia.»

La primera prueba **consume un número de producción y se asume**. Se da por
buena cuando las dos cosas pasan: la fila cae en `Altas del sistema` con su
número, y la OS aparece en Compras → Aprobaciones. Si algo falla en el medio, la
salida es denegarla, que es lo único que el sistema sabe escribir en el maestro.

## Las decisiones que tomé yo

Están marcadas en el cuerpo y se pueden revisar sin leerlo entero:

- El alta escribe `sheets_tab = 'SERVICIOS'` y `sheets_row` en null.
- El aviso sale por `avisarAQuienDecide()`, llamado desde el alta, y no por un
  emisor propio.
- El reintento escribe `J PRIORIDAD` y `K EMPRESA` **sólo si están vacías**, y la
  pantalla lo dice cuando no pudo.
- `os_id` es `on delete set null`.
- La variable nueva se llama `GOOGLE_SHEETS_OS_FORMULARIO_ID`.
- El área se precarga con la del usuario y se puede cambiar.
- No se audita, con el argumento de más arriba.

## Lo que queda afuera

- Las columnas cruzadas en las dos planillas (camino B).
- Enlazar los pares históricos: no hay con qué, y adivinar es peor.
- Tocar el formulario de Google. Sigue como está, columna `Y` incluida.
- Arreglar la OS 14 en la base: se arregla sola cuando la fórmula nueva entre y
  la sincronización vuelva a leer.

## Riesgos asumidos

- **La ventana del paso 3.** Entre congelar la columna `A` e instalar el script,
  una respuesta del formulario queda sin número. Se acota haciéndolo de una y
  fuera del horario de carga.
- **El master es una sola fórmula por bloque.** Si una de las tres queda mal, las
  once pestañas se vacían a la vez, porque las de área son `FILTER` de
  `SERVICIOS`. Por eso se prueban en pestañas temporales antes.
- **El `TEXTJOIN` concatena** si alguna vez una fila vuelve a tener dos equipos.
  No rompe ni avisa: devuelve los dos pegados. Es mejor que el error de hoy
  —que se los roba a otra fila— pero no es gratis, y conviene que
  `npm run planillas` o la sincronización lo note.
- **El número lo sigue dando la planilla**, no la base. Es a propósito: tomar el
  máximo de la base daría un número que ya existe si alguien cargó por el
  formulario desde la última sincronización.
