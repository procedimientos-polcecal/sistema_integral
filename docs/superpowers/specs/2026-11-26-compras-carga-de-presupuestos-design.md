# Compras — cargar la respuesta de un proveedor en el SdG

**Acordado el 26/11/2026.** Primer paso concreto de «que el sistema mande y se
usen menos las planillas», acotado a un solo circuito: la comparativa de
proveedores.

## Qué se quiere, y por qué

Hoy el presupuesto llega **por WhatsApp**, y quien lo recibe lo baja en el acto
a la planilla del artículo en Drive. El SdG no está en ese camino: se entera
sólo si después alguien aprieta «vincular».

Lo que se pide es dar vuelta ese paso. El renglón se carga **en el SdG**, y la
planilla del artículo recibe **una copia de respaldo**, para el que no entra al
sistema. El sistema manda; la planilla mira.

No es una mejora de pantalla: es mover dónde ocurre el hecho.

### El punto de partida, medido el 26/11/2026

La comparativa del SdG está muerta, y conviene decirlo con números porque es lo
que justifica no limitarse a «destrabar lo que hay»:

| | |
|---|---|
| Presupuestos en `compras_cotizaciones` | 1.077 |
| …que entraron leyendo la planilla (`origen = 'drive'`) | **1.069** |
| …que se cargaron en el sistema (`origen = 'app'`) | **8** |
| Presupuestos marcados como elegidos, en toda la tabla | **1** |

Y por mes, contando RI distintos con movimiento de comparativa:

| Mes | RI | Filas |
|---|---|---|
| 2026-08 | 55 | 56 |
| 2026-09 | 974 | 1.010 |
| 2026-10 | **1** | 4 |
| 2026-11 | **1** | 7 |

Septiembre es una importación de una vez. Octubre y noviembre son la verdad: el
SdG tocó la comparativa **dos veces en dos meses**.

Del otro lado, la planilla está vivísima: **200 planillas** en la carpeta de
Drive, y las tres más recientes se editaron el mismo 26/11. No hay una por
pedido: hay **una por artículo** —BOLSONES, BULONES, DISCOS, RODAMIENTOS,
VÁLVULAS— que se va acumulando. RODAMIENTOS tiene 91 filas, BULONES 63.

O sea: **no es que la comparativa no se use. Es que el SdG no está en el
camino.**

### La unidad de trabajo real

Lo que decide la forma de la pantalla. Medido sobre 25 planillas, agrupando por
proveedor + fecha (una «respuesta de proveedor»), 224 respuestas:

| | |
|---|---|
| Respuestas que cubren **más de un RI** | **66 (29%)** |
| Respuestas que cruzan **más de un artículo** | **8 (4%)** |
| RI por respuesta | mediana 1 · media 1,5 · **máximo 7** |

El caso grande es real y reciente: el **18/11/2026 en RODAMIENTOS** hay tres
proveedores —BER IMPORT, OESTE TRANSMISIONES, TODO RULEMAN— con **6 filas y 6
RI cada uno**. Dieciocho renglones de una sentada.

Entonces la unidad es **un proveedor × un artículo × una fecha → de 1 a 7
filas, cada una de un RI distinto**. No es «un presupuesto para un pedido» —que
es como está modelado hoy— ni «un pedido con varios presupuestos».

### Qué columnas se llenan de verdad

De las 19 de la plantilla, **17 vienen completas**. Las dos que no:

- **`ENVÍO`**: vacía en 4 de las 5 planillas más recientes; en RODAMIENTOS la
  tienen 10 de 91 filas.
- **`PRECIO HASTA`**: aparece en 1 de cada 10 filas (8 de 26, 7 de 63, 1 de 91,
  0 de 27).

## Objetivos

- Que cargar la respuesta de un proveedor en el SdG sea **más rápido que
  tipearla en la planilla**, no sólo distinto. Si no es más rápido, no se
  adopta: ya lo probamos sin querer durante dos meses.
- Que la planilla del artículo siga recibiendo todo, como respaldo y como
  histórico de precios.
- Que una respuesta de varios RI se cargue **de una vez**, eligiendo el
  proveedor y la fecha una sola vez.

## No objetivos

- **No se toca la planilla a mano nunca más**: durante la transición se va a
  seguir cargando en Sheets, y el diseño tiene que tolerarlo sin duplicar.
- **No se bloquea ninguna planilla.** Eso es el spec del 19/10 y es otro
  trabajo; acá la planilla sigue abierta.
- **No se lee el mensaje de WhatsApp.** Sacar los datos de una foto o de un
  texto pegado es tentador —hay precedente en el cuaderno de Piparo— pero la
  mediana es **1 fila por respuesta**, así que tipear no es el cuello de
  botella. Es una capa posterior, no parte de esto.
- **No se inventa la entidad «artículo».** Las 200 planillas son archivos con
  nombre, no una tabla del sistema, y así quedan.
- No se toca la elección del presupuesto ganador ni el circuito de aprobación.

## Anti-objetivos

Qué volvería esto un fracaso aunque funcione:

- Que el SdG **duplique** filas en la planilla, o que una reimportación duplique
  presupuestos en la base. Un dato de precio duplicado es peor que no tenerlo:
  se compara contra sí mismo.
- Que una caída de Drive **pierda** la carga. El presupuesto tiene que quedar
  guardado aunque la planilla no se pueda escribir.
- Que cargar 6 renglones cueste 6 navegaciones. Eso es lo que hay hoy y es por
  lo que no se usa.

## Restricciones

- **La cuota de Sheets es `ReadRequestsPerMinutePerUser` = 60**, compartida por
  los siete módulos porque la cuenta de servicio es una sola. El 26/11 eso dejó
  al RI 2379 sin prioridad ni empresa y tiró una importación a los 76 ms. Una
  carga de 7 renglones **no puede costar 7 búsquedas de fila libre + 7
  escrituras**.
- **Una planilla que está calculando no se lee ni se escribe** (`estaCalculando`).
  Vale igual acá.
- **`USER_ENTERED`**: los números van como número, las fechas como serial
  (`serialDelDia`) y la prosa con `textoParaLaCelda()`.
- **La regla de `comparativaCongelada`** sigue valiendo por RI: una vez decidida
  la compra, no se cargan presupuestos.
- Migraciones: las aplica una persona a mano. Lo que necesite DDL se declara y
  se espera.

## Enfoques considerados

**1. Destrabar lo que ya existe.** `POST /api/compras/requerimientos/[id]/cotizaciones`
ya carga un presupuesto y lo escribe en la planilla; sólo está trabado —pide RI
aprobado y planilla adjunta— y no se encuentra. Lo más barato con diferencia.
**Descartado como solución completa**: para la respuesta de BER IMPORT del 18/11
hay que entrar a seis pedidos y elegir el mismo proveedor seis veces. Eso es el
29% de las respuestas y son justo las que más cuestan. Es, además, el
experimento que ya corrimos: ocho filas en dos meses.

**2. Una pantalla de «llegó la respuesta de un proveedor».** Proveedor y fecha
una vez, y después N renglones, cada uno con su RI. **Elegida.** Es la forma
exacta del evento medido y la única que hace la carga más rápida que la
planilla.

**3. La planilla del artículo, adentro del SdG.** Costo de aprendizaje cero,
pero es rehacer una planilla dentro de una web app —siempre peor que Sheets en
eso— y obliga a inventar la entidad «artículo». **Descartada.**

La 1 **no se tira**: queda adentro de la 2. Desde un RI suelto se sigue
cargando como hoy; la pantalla nueva es para cuando llega una respuesta con
varios.

## Cómo queda

### La pantalla

Nueva, en `app/(app)/compras/presupuestos`. Arriba, lo que se elige **una vez**:

```
  Proveedor  [ BER IMPORT                  ▾ ]
  Fecha      [ 18/11/2026 ]
  Planilla   [ RODAMIENTOS                 ▾ ]   (la del artículo)

  ── Renglones ──────────────────────────────────────────────
  RI [2301 ▾] Rodamiento 6204   $ [12.500] × [4] un  IVA [21%]  ⌫
  RI [2307 ▾] Rodamiento 6306   $ [31.200] × [2] un  IVA [21%]  ⌫
  [ + Agregar renglón ]

  [ Guardar los 2 presupuestos ]
```

Decisiones de la pantalla, cada una con su porqué:

- **El proveedor y la fecha son del encabezado**, no del renglón. Es lo que
  hace que esto sea más rápido que la planilla: en Sheets hay que repetirlos o
  arrastrarlos hacia abajo.
- **La planilla del artículo también es del encabezado**, porque sólo el **4%**
  de las respuestas cruzan más de un artículo. Para ese 4%: si un RI del
  renglón ya tiene `comparativa_drive_id` y es otro, **gana el del RI** y se
  avisa en el renglón. No se inventa una planilla nueva.
- **Los campos del renglón son los que se llenan de verdad.** A la vista:
  marca, unidad, precio unitario, cantidad, descuento, IVA, plazos, condiciones
  de pago, disponibilidad y comentario. **`ENVÍO` y `PRECIO HASTA` van detrás de
  un «más campos»**, porque están vacíos en 4 de 5 planillas y en 9 de cada 10
  filas respectivamente. Siguen existiendo; dejan de estorbar.
- **El desplegable del RI ofrece los ~102 pedidos** que hoy están aprobados y sin
  compra decidida (63 de los últimos 90 días). Con 100 opciones, `<Select>`
  renderiza el panel con buscador solo — no hay que elegir nada.
- Es `<Select>` y no `<select>`, y las grillas llevan breakpoint: la carga puede
  pasar desde el teléfono, que es donde llega el WhatsApp.

### Qué pasa al guardar

Una ruta nueva, `POST /api/compras/presupuestos`, que recibe el encabezado y los
renglones juntos. En orden:

1. **Valida todo antes de escribir nada.** Si algún RI está congelado, o no está
   aprobado, o no existe, **no se guarda ninguno** y el error nombra el renglón.
   Todo o nada: media carga guardada es peor que ninguna, porque nadie sabe
   cuál falta.
2. **Inserta una fila por renglón** en `compras_cotizaciones`, con
   `origen: 'app'` y `created_by`. Es la misma tabla y la misma forma que la
   carga por RI: no hay un modelo nuevo.
3. **Escribe el respaldo en la planilla**, todos los renglones de una vez.
4. **Si Drive falla, lo cargado queda.** Se anota el pendiente y se le dice a
   quien cargó, con **lo que dijo Google, sin traducir**. Es el criterio del
   resto del módulo.

### El respaldo en la planilla, en una sola escritura

Esto es la restricción de cuota hecha diseño. `agregarFila()` de
`lib/compras/drive.ts` busca la primera fila libre y escribe **una** fila: siete
renglones serían siete lecturas y siete escrituras, que es exactamente lo que el
26/11 agotó la ventana de 60.

Hace falta una hermana, `agregarFilas()`, que **busque la fila libre una vez** y
escriba el bloque entero en un rango contiguo (`A{n}:S{n+k}`). **Esa función**
queda en 1 lectura + 1 escritura para toda la respuesta.

Dos cosas que no se deducen de la firma y que hay que conservar de `agregarFila`:

- La fila libre se busca **por la columna A** y cortando si la planilla está
  calculando. Es la función con la forma exacta del accidente del 13/10/2026.
- Las fórmulas de cada fila se arman **con el número de fila que les toca**, no
  con uno calculado aparte. Ya pasó: la fórmula del total del RI 1865 quedó
  apuntando a la fila 1001 mientras el presupuesto se escribía en la 1003.

**El costo se cuenta por planilla y no por respuesta.** Como un RI que ya tiene
planilla vinculada gana sobre la del encabezado, una carga puede tener que
escribir en dos. Son el 4% de los casos, pero el costo se cuenta así.

**Y el costo de una planilla no es «1 lectura + 1 escritura»: son 3 o 4 lecturas
y de 1 a 3 escrituras.** Esto decía lo primero, y subestimarlo ~4× vuelve
inútil el número justo para lo que existe —razonar contra las **60 lecturas por
minuto** que comparten los siete módulos—. La cuenta real, medida contra el
código:

| | Lecturas | Escrituras |
|---|---|---|
| `leerComparativa` (cabecera + valores) | 2 | — |
| `asegurarLaColumnaDelId` → `asegurarColumnas` | 1 | 0 o 1 (ensanchar la hoja) |
| `asegurarLaColumnaDelId` → `escribirCelda` | — | 0 o 1 (el encabezado) |
| `agregarFilas` (columna A + el bloque) | 1 | 1 |

O sea **4 y 3** la primera vez que se escribe en una planilla, y **3 y 1** de
ahí en adelante, porque `asegurarColumnas` lee siempre aunque no tenga nada que
ensanchar. Lo que sí se cumple, y es lo que el diseño perseguía, es que **nada
de eso es por renglón**: siete renglones en una planilla cuestan lo mismo que
uno.

### El pedido que todavía no tiene planilla

De los **102 pedidos** que hoy ofrecería la pantalla —aprobados y sin compra
decidida—, **39 ya tienen `comparativa_drive_id` y 63 no**. El caso mayoritario
es el que no estaba escrito.

Decidido: **cargar un presupuesto le vincula la planilla al RI que no tenía
ninguna.** Sin eso el respaldo queda huérfano: la ficha del pedido no muestra
planilla, y el `DELETE` de un presupuesto no puede vaciar su fila, porque busca
la planilla en `ri.comparativa_drive_id`. Es, además, el arreglo del salteo
silencioso que hoy ocurre cuando no hay planilla adjunta.

Lo que esto implica y hay que aceptar a ojos abiertos: **esta pantalla pasa a
ser una segunda forma de «vincular»**. Cambia qué va a importar un «Volver a
traer» posterior y qué muestra la ficha. Es correcto —el presupuesto está de
verdad en esa planilla— pero deja de ser sólo una carga.

### Que la reimportación no duplique

**Éste es el punto que decide si «backup» quiere decir algo.**

Hoy «vincular» relee la planilla, borra los presupuestos de `origen = 'drive'` y
deja los de `origen = 'app'`. Eso protege contra perderlos, pero **no contra
duplicarlos**: la fila que el SdG acaba de escribir como respaldo se vuelve a
leer y entra como un presupuesto `drive` nuevo, al lado del `app` que la
originó. El mismo precio, dos veces, en la comparativa que después decide a
quién se le compra.

La solución tiene precedente en este repo y es la misma de carbonilla: **lo que
evita el lazo no es el número de fila sino el id**. Carbonilla escribe el id del
movimiento en la columna `K` de su planilla justamente porque el número de fila
no sirve cuando se insertan filas en el medio — y acá se insertan.

Decidido: el respaldo escribe el **id de la cotización en una columna propia,
`ID SISTEMA`**. Al releer, una fila que trae un id que el sistema ya tiene **se
saltea**: no es un presupuesto de la planilla, es el eco del propio sistema.

**La columna se busca por su nombre y nunca por su letra**, y esto no es
cosmético. Medido el 26/11/2026 sobre 30 planillas de la carpeta: los anchos son
**16, 19 y 20 columnas**, y **una —`REPUESTOS MÁQUINAS`— ya usa la `T` para
`EQUIPO`, con datos adentro** («Doosan 300»). O sea que «la primera libre
después de las 19» es falso en las dos puntas: en la de 16 columnas deja tres
vacías en el medio, y en la de 20 **pisa el equipo de alguien**. Es la misma
regla que ya gobierna este módulo —`mapearEncabezados` existe porque las 200
planillas son clones derivados, con cuatro formas de escribir `NRO RI` y algunas
sin `ENVÍO`— y la misma trampa que `asegurarColumnas` registró con la `K` de
carbonilla: escribir fuera del ancho real de la hoja se rechaza entero, no por
celda.

Entonces: al escribir el respaldo por primera vez en una planilla, el encabezado
`ID SISTEMA` se agrega **después de su última columna usada**, y a partir de ahí
se la ubica por nombre, con su entrada en `ALIAS`. Una planilla que todavía no
la tiene se lee exactamente como hasta hoy.

### Y que la relectura no borre lo que el sistema cargó

El reverso del mismo problema, y es el que puede perder datos en vez de
duplicarlos.

Las dos relecturas no se portan igual. La de tanda
(`app/api/compras/comparativas/vincular/route.ts`) borra sólo `origen = 'drive'`.
Pero **la que una persona aprieta** —«Volver a traer», en
`app/api/compras/requerimientos/[id]/comparativa/route.ts`— borra por número de
fila **sin mirar el origen**:

```ts
.delete().eq("requerimiento_id", id).not("drive_fila", "is", null);
```

y lo hace a propósito: su comentario cita el RI 1865, donde una fila `app` se
releía como `drive` y quedaban dos. O sea que hoy, en ese camino, no hay
duplicación: hay **reemplazo**.

Con la columna de id, esa defensa se vuelve el problema. La secuencia sería:
se borra la fila `app` → al leer se saltea su fila en la planilla porque trae un
id conocido → **el presupuesto desaparece del sistema y queda sólo en la
planilla**. Es el anti-objetivo con el signo cambiado, y nada lo informaría.

Decidido, y es un cambio de contrato que hay que hacer explícito: **la columna
de id ataca la causa que el borrado por fila atacaba de costado**, así que ese
borrado se angosta a las filas que **no** son el eco del sistema. Dicho de otro
modo: la relectura borra lo que vino de la planilla y deja lo que el sistema
escribió, por las dos puntas y por el mismo criterio.

Los presupuestos del sistema **sí guardan `drive_fila`**, aunque el número de
fila no sirva para identificarlos: lo necesita el `DELETE` de un presupuesto
para vaciar su fila, y lo necesitan las dos relecturas para conservar `elegida`.
El id es para *reconocer*; la fila, para *volver a tocar*. Son dos preguntas
distintas y cada una tiene su columna.

Queda un caso viejo que hay que mirar antes de desplegar: **los 8 presupuestos
que hoy tienen `origen = 'app'` y `drive_fila`** están en planillas sin columna
de id. Para el criterio nuevo son indistinguibles de una fila de la planilla.
Son ocho y ninguno está elegido, así que alcanza con escribirles el id en su
fila —o aceptar que la primera relectura de esas planillas los reemplace por su
propio eco—. Quien lo construya elige; lo que no vale es no mirarlos.

### La fecha de la respuesta necesita dónde vivir

La `FECHA` de la planilla **es la fecha en que contestó el proveedor, no la del
pedido**. Medido el 26/11/2026 sobre 323 filas cuyo RI existe en la base: el
**74% difiere** de `compras_requerimientos.fecha`, y cuando difiere la mediana
es **+3 días**, con **233 de 238 posteriores** al pedido. La agrupación de
«proveedor + fecha» con la que se midió la unidad de trabajo descansa en eso.

Dos consecuencias:

- **`compras_cotizaciones` no tiene columna de fecha** —sólo `created_at`— así
  que la fecha del encabezado necesita una. **Eso es DDL, lo aplica una persona
  a mano, y hay que declararlo y esperar**: está en el camino crítico. No sirve
  `created_at`: una respuesta de ayer que se carga hoy quedaría con la de hoy, y
  es exactamente la diferencia que el 74% mide.
- **Hay un error ya existente que esto destapa**: la carga por RI escribe en esa
  celda `ri.fecha`, la del pedido (`cotizaciones/route.ts`). O sea que los 8
  presupuestos cargados en el sistema pusieron ahí la fecha equivocada. Son 8 y
  se corrigen junto con lo de arriba; lo que importa es no repetirlo en la ruta
  nueva.

### Avanzar el estado no puede costar siete exportaciones

Las dos rutas de hoy, al cargar un presupuesto, pasan el RI de `SIN_INICIAR` a
`EN_COMPARATIVA` y **lo exportan al master** acto seguido. Siete renglones serían
hasta siete exportaciones, cada una con sus lecturas y escrituras contra el
master de Compras — justo el costo por fila que `agregarFilas()` existe para
evitar, y contra la misma cuota de 60 por minuto que se agotó el 26/11.

Decidido: **el estado se avanza igual** —no hacerlo deja al master divergiendo en
silencio, que es lo que `revisar-exportaciones.mjs` existe para atrapar— pero las
exportaciones **se drenan con `after()`, una sola pasada para toda la carga**.
Es el patrón del cuaderno de contratista, por el mismo motivo y con la misma
restricción: las esperas se recortan a lo que queda de `maxDuration`.

### Lo que no cambia

- La carga por RI sigue existiendo, con su ruta y su pantalla, y **no está
  trabada por falta de planilla**: lo que hoy pasa sin planilla adjunta es que
  el respaldo en Drive **se saltea en silencio** —un `if` sin `else`, sin aviso
  y sin pendiente—. Eso sí se arregla, y es la misma decisión de más abajo sobre
  `comparativa_drive_id`.
- `vincular` sigue existiendo: es como entra el histórico de una planilla que
  nunca pasó por el sistema.
- Elegir el presupuesto ganador no se toca.

## Lo que queda a criterio de quien lo construya

- Dónde cuelga la pantalla del menú de Compras y cómo se llama el botón. «Cargar
  presupuestos» describe mejor que «respuesta de proveedor», pero mirar el resto
  del menú antes.
- Si el desplegable de planilla del artículo recuerda la última usada. Parece
  obvio que sí; no está medido.
- La forma exacta del pendiente cuando Drive falla. `compras_cotizaciones` no
  tiene hoy una columna de pendiente; puede ser una columna nueva (migración) o
  colgarse del requerimiento. **Quien lo construya decide, pero lo decide
  mirando `lib/mantenimiento/pendienteDelAviso.ts`**, que explica por qué las
  tres colas del sistema no son iguales.
- El orden de los renglones en la pantalla.
- **La moneda va detrás de «más campos»**, como `ENVÍO` y `PRECIO HASTA`: de
  1.077 presupuestos, **1 está en dólares**. Sigue existiendo; no ocupa lugar en
  el camino rápido.
- Qué hacer con los **8 presupuestos viejos** de `origen = 'app'` que están en
  planillas sin columna de id: escribirles el id en su fila, o aceptar que la
  primera relectura los reemplace por su propio eco. Las dos son defendibles;
  no mirarlos, no.

## Lo que no se va a saber hasta la primera corrida real

- **Si se adopta.** Es lo único que importa y no lo contesta ningún test. La
  medida es la de arriba: presupuestos con `origen = 'app'` por mes. Hoy son 8
  en total. Conviene mirarla a las dos semanas y a las ocho.
- **Si la columna `ID SISTEMA` molesta a alguien** que mire la planilla. No rompe
  fórmulas —ninguna de las 19 de la plantilla la referencia— pero se ve, y cae
  en un lugar distinto en cada planilla porque se agrega después de la última
  columna usada.
- **Si el desplegable de ~102 RI alcanza.** Si alguien busca por descripción y no
  por número, el buscador de `<Select>` ya ignora acentos y acepta palabras en
  cualquier orden; si no alcanza, el problema es qué texto se muestra en cada
  opción, no el componente.
- **Si «proveedor + fecha» es la agrupación correcta para quien carga.** Es la
  que se deduce de la planilla, no la que alguien describió. Un proveedor que
  contesta dos veces el mismo día son dos respuestas y acá serían una sola
  carga; nadie dijo que eso esté mal, pero tampoco que esté bien.
