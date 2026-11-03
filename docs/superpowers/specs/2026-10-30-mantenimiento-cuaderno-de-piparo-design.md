# Mantenimiento — el cuaderno de Piparo, leído de una foto

**30/10/2026.** Diseño acordado.

## Qué problema resuelve

Piparo es el contratista mecánico de la planta. Entrega su mes en **un cuaderno
manuscrito**: una hoja por página con varios días, y bajo cada día una lista de
tareas con sus horas. Hoy eso no entra al SdG desde el cuaderno. Alguien lo lee,
lo agrupa a ojo y carga en la planilla unas 35 OT por mes — mientras el cuaderno
tiene unos 118 renglones. **Lo que no entra no existe**: no se sabe qué se le
hizo a cada máquina ni cuántas horas se pagaron por tarea.

Lo que ya se venía haciendo, y que esto reemplaza: las fotos del cuaderno se le
pasaban a un modelo con un prompt largo que armaba **un Excel** de dos mitades
—detalle diario a la izquierda, resumen agrupado a la derecha, con fórmulas que
ataban una a la otra—. Ese Excel **se abandona**: lo pedido es que el cuaderno
se registre derecho en el sistema y que de ahí salgan las OT una vez chequeadas.

Lo que se quiere, en orden:

1. **Que cada tarea del cuaderno quede en el sistema**, con su fecha, su sector
   y su equipo.
2. **Chequear antes de generar.** La transcripción la hace un modelo y se
   equivoca; el papel está al lado para corregirla.
3. **Una OT por tarea**, ya realizada, con sus horas o su costo.

## Esto convive con Candia y no lo reemplaza

`/mantenimiento/partes-contratista` ya existe para **Candia**, que entrega
quince partes diarios preimpresos cada quince días, con un total escrito a mano
en una casilla. Ese diseño vive en
[el spec del 20/10](2026-10-20-mantenimiento-partes-de-contratista-design.md) y
**no se toca**.

**El desplegable de contratista decide la pantalla.** Con Candia se ve el
formulario del parte diario, como hasta hoy. Con Piparo se ve la carga por
fotos. Son dos papeles distintos y dos pantallas distintas sobre la misma ruta.

Lo que lo decide es **una columna nueva en `proveedores`** —`modo_de_carga`,
con `parte_diario` por defecto y `cuaderno` para Piparo— y no el id en una
constante ni el nombre. El costo es otra migración que corre una persona; lo
que se compra es que el tercer contratista con cuaderno sea un dato y no un
deploy, que es lo que el documento promete en «lo que queda afuera».
*(Decisión del sistema, no acordada.)*

Lo que **sí** comparten es el catálogo de equivalencias
`mant_contratista_lugares` —texto suelto → sector y equipo, único por
`(proveedor_id, texto)`—, que ya es por proveedor y por lo tanto sirve a los dos
sin cambios.

Y una diferencia que decide varias cosas de abajo: **el cuaderno no tiene con
qué cerrar.** El parte de Candia trae un total escrito, y la suma de sus
renglones tiene que darlo; ése es el control de la factura. El cuaderno no trae
total ni número de hoja. Acá **el control es la persona mirando la foto al lado
de los renglones**, y no una cuenta.

## Cómo es el cuaderno

Transcripción real de la hoja del 21 y 22 de septiembre de 2026:

```
Septiembre 26
21-09-26
 - Colocar cartelería P/Trit N°1                     = 8 Hs
 - Reparar rodillos 2/cinta 9 P/Trit N°3             = 6 Hs
 -    "        "     5 P/ "   " 1                    = 6 Hs
 - Trabajos en cinta 1 P/Trit N°1
   probar c/electricistas                            = 14 Hs
 - Tranqueras D6                                     = 2 Hs
 - Limpieza tolva de zaranda P/Trit N°3              = 4 Hs
22-09-26
 - Trabajos en cinta 5 Reparación       ⎫
 - Limpieza P/Trit N°1                  ⎬            = 46 Hs
 - 1 Parche metálico en descarga cono   ⎭
 - 1 Empalme cinta 5 P/Trit N°1                      = 920000
 - Tensar y alinear la misma                         = 4
 - Horno 4 Rastro                                    = 8 Hs
```

Seis cosas que esa hoja muestra y que el diseño tiene que contestar:

- **Una foto trae varios días.** El día es un encabezado dentro de la página, no
  una propiedad de la foto. Diez fotos cubren un mes.
- **El número de la derecha no siempre son horas.** `= 920000` son pesos:
  los empalmes y los parches se cobran por trabajo y no por hora. Unos diez
  renglones por mes son así.
- **Hay renglones unidos por una llave** con un solo total: tres tareas y
  `= 46 Hs`.
- **Hay renglones que heredan del de arriba**: las comillas de
  `"  "  5 P/ " " 1` quieren decir «reparar rodillos 2/cinta 5 P/Trit N°1».
- **El sector y el equipo están en el texto, abreviados**: `P/Trit N°1`,
  `Molino cal`, `Idratación`, `Filer 02`, `D6`.
- **Hay renglones sin sector ninguno**: «Tranqueras D6», «Hormigonar Dep 05»,
  «Clasificar manganeso», «Alambrado». Son actividades generales y se repiten en
  varios días.

## Las decisiones

### 1. Una OT por tarea, y las sin sector se acumulan

- **Renglón con sector → su propia OT.** «Reparar rodillos 2/cinta 9 P/Trit N°3»
  es una orden y no se funde con nada.
- **Renglón sin sector → se propone acumular** los que son la misma tarea.
  «Tranqueras D6» aparece el 17, el 21 y el 23 de septiembre: salen como una
  sola orden con las horas sumadas y el rango de fechas.
- **Y la propuesta se corrige a mano.** Se seleccionan renglones y se los junta
  en una OT, o se los separa. Es la misma forma que el reparto de horas de
  Candia: el sistema propone, la persona que tiene el papel decide.

> **Por qué el sector decide y eso es una trampa.** Un renglón al que el
> catálogo no le reconoce el sector —y que sí lo tenía— deja de ser una orden
> propia y se va a fundir con otro que se llame parecido. Por eso los renglones
> sin sector **se muestran en rojo y tienen su propio filtro**: no son un
> detalle de carga, son los que cambian cuántas órdenes salen.

#### Y sin sector no hay OT, así que hay que conseguirle uno

`loQueFaltaParaCrear` exige `sector_id` desde el 19/10/2026. **Corrección del
01/11/2026, comprobada en el código:** esa función la llaman el modal, la ruta
`ordenes` y los dos formularios, pero **la generación de Candia no la llama** —
arma el registro y lo inserta. Así que la regla no se hereda: **la generación
del cuaderno tiene que negarse ella misma** a crear una OT sin sector, y hay
que escribirlo, no darlo por puesto. Una OT sin sector además entra en la
planilla con `SECTOR QUE SOLICITA` vacío, que es de donde lee quien no entra al
sistema.

Así que «Tranqueras D6» o «Hormigonar Dep 05» en rojo no generan nada. Se resuelve en tres escalones, y el orden importa:

1. **Si el renglón tiene equipo y no sector, el sector sale del equipo.** No es
   adivinar: `equipos.sector_id` es el catálogo. Medido — el equipo `D6` tiene
   sector `Cantera`, y las 380 OT de PIPARO ya usan Cantera 28 veces.
2. **Si no tiene ni equipo, la pantalla propone uno y hay que confirmarlo.** La
   propuesta se muestra **marcada como propuesta** y no se puede generar hasta
   que alguien la confirme o la cambie. Decidido a pedido, sabiendo el riesgo:
   confirmar sin mirar se vuelve automático, y por eso la propuesta se ve
   distinta de un sector enganchado y el filtro «sin sector» los junta.
3. **Lo que nadie confirmó no se genera.** Queda cargado y visible —el renglón
   existe, que era el punto— pero afuera de la corrida.

### 2. Las horas de una llave no se reparten

Las tres tareas de la llave entran como **tres renglones**, con las 46 h en el
que las tiene escritas y los otros dos en blanco. Decidido a pedido: «dejalo con
las horas que sacás de la hoja, no repartas».

Lo natural ahí es seleccionarlos y juntarlos en una sola OT de 46 h, que es lo
que la llave significa en el papel. Pero eso lo decide quien carga, no el
sistema: repartir 15,33 h a cada uno sería inventar una medición que nadie hizo.

### 3. El precio va en la OT, y a la planilla por la columna que ya se usa

Los renglones con precio y sin horas salen como **orden de trabajo**, con una
columna `costo` nueva en `ordenes_trabajo` —`numeric`, nullable—.

**Y se exporta a `REPUESTO UTILIZADO`, la columna I, porque es donde ya está.**
Esto no se eligió: se midió el 01/11/2026. De las 380 OT de PIPARO, **62 tienen
algo en `repuesto` y 58 de ésas son un monto**, escrito a mano de tres formas:

```
"$190,000"                               · hs = —  · Reparacion cinta 3 1 parche
"Empalme ($680000)"                      · hs = —  · Empalme cinta 5
"2 parches de 200 (vulcanizado $240000)" · hs = —  · Repasar cinta
```

Las 58 tienen **las horas vacías**, que es exactamente la forma del renglón con
precio del cuaderno. O sea que la práctica ya existía y lo que hace esto es
darle una columna estructurada en la base sin cambiar lo que ve quien mira la
planilla.

Dos cosas que eso obliga:

- **`repuesto` también lleva repuestos de verdad** —«Paño de zaranda según
  especificaciones (RI 230)», «Perfil C 160-60-20…»— así que el costo **se
  suma al texto en vez de pisarlo**, como hace la práctica («Empalme
  ($680000)»).
- **El costo es un campo que se exporta**, así que toda ruta que lo toque tiene
  que exportar o dejar el pendiente anotado, y el archivo tiene que declararse
  en `scripts/revisar-exportaciones.mjs`.

> **Lo que NO se hace, decidido a pedido: `costoEquipo.ts` no se toca.**
> Ese informe dice textual *«Las de contratista se cuentan como horas ajenas y
> no se costean»* y saltea toda OT que tenga contratista —y antes de eso saltea
> las que no tienen horas—. Así que **el costo nuevo no lo suma nadie**: se ve
> en la pantalla del cuaderno, en la OT y en la planilla, y no en el costo de la
> máquina.
>
> Riesgo asumido, y está medido: Piparo tiene **0 órdenes de servicio**, así que
> todo lo que se le pagó ya era invisible para ese informe y lo sigue siendo.
> Esto no empeora nada; tampoco lo arregla. Arreglarlo es cambiar esa regla, y
> se decidió no hacerlo ahora.
>
> Se evaluó la alternativa —que los renglones con precio salieran como **orden
> de servicio**, que ya tiene `costo` y que ese informe sí suma— y se descartó:
> todo lo de Piparo en un solo lugar.

### 4. La pantalla: la foto al lado, y filtros arriba

Validado contra bocetos el 30/10/2026.

```
┌──────────────────────────────────────────────────────────────────┐
│ PIPARO · 16 al 30 de septiembre · 59 renglones                   │
│ [Todos (118)] [Sin sector (11)] [Con costo (10)] [Dudosos (3)]   │
├────────────────────────┬─────────────────────────────────────────┤
│                        │ ☐ Fecha  Tarea      Sector  Equipo Hs $ │
│   la foto de la hoja   │ ☐ 21/9   Colocar…   Trit 1   —     8  — │
│   (fija, ampliable)    │ ☑ 21/9   Tranqueras  ROJO    D6    2  — │
│                        │ ☑ 23/9   Tranqueras  ROJO    D6   12  — │
│   el renglón en el     │ ☐ 22/9   1 empalme   Trit 1   —   — 920k│
│   que estás parado     │                                         │
│   se resalta acá       │ 3 seleccionados · 16 h                  │
│                        │ [Juntar en una OT] [Separar]            │
└────────────────────────┴─────────────────────────────────────────┘
```

- **La foto queda fija a la izquierda** y los renglones scrollean a la derecha.
  Chequear es comparar contra la hoja, así que la hoja no se va de pantalla.
  Al pararse en un renglón, la pantalla **dice de qué foto y de qué línea
  salió** y resalta el texto transcripto — no pinta una caja sobre la escritura.
  Para eso haría falta que el modelo devolviera coordenadas, y sobre manuscrito
  son poco confiables: una caja que señala el renglón equivocado es peor que no
  tener caja, porque confirma lo que no pasó. *(Decisión del sistema, no
  acordada.)*
- **Los filtros van arriba**, sobre los renglones de toda la carga y no sobre la
  foto: «sin sector», «con costo», «dudosos», «ya juntados».
- **Las seis columnas son editables**: Fecha · Tarea · Sector · Equipo · Horas ·
  Costo.
- **El rojo es «no le reconocí el sector»**, no «está mal».
- La selección de renglones y los botones de juntar/separar viven abajo, con la
  vista previa de lo que quedaría: «Tranqueras D6 · 16 h · del 17/9 al 23/9».

### 5. La misma hoja subida dos veces se avisa por fecha

El parte de Candia trae número preimpreso, así que un repetido se detecta solo.
**El cuaderno no tiene número.** Si una foto trae renglones de un día que ya
tiene renglones cargados de ese contratista, **la pantalla lo dice y deja
elegir**: reemplazar los de ese día, o dejar los dos.

No bloquea a propósito: un día puede estar escrito en dos hojas.

**Pero sí se niega si alguno de esos renglones ya generó su OT.** Borrarlos
dejaría órdenes que nadie puede rastrear al papel, y generar las nuevas
duplicaría las que ya existen — y una OT escrita en la planilla se borra a
mano, fila por fila. Es la misma negativa que ya tiene el borrado de un parte
de Candia. *(Decisión del sistema, no acordada.)*

## Lo que se midió antes de elegir

Todo el 30/10/2026, contra la base de producción.

**Los valores de la OT no se eligieron: se midieron.** De las **380 OT de
PIPARO** que ya hay (del 04/12/2025 al 20/10/2026):

| | |
|---|---|
| especialidad | **MECÁNICO 282** · CIVIL 96 · ELÉCTRICO 2 |
| tipo | **PROGRAMADO 292** · CORRECTIVO 88 |
| quien | **CONTRATADO 373** · INTERNO 7 |
| estado | **REALIZADO 376** · POR_HACER 2 · EN_PROCESO 2 |
| horas | 311 con horas · **69 sin** |

Así que los valores por defecto son `MECÁNICO / PROGRAMADO / CONTRATADO /
REALIZADO`. **Ojo con el primero: Candia es CIVIL y Piparo es MECÁNICO.** Copiar
el default del otro contratista habría puesto 282 órdenes en la especialidad
equivocada.

**El catálogo de equipos resuelve el cuaderno mejor de lo esperado.** Hay **63
equipos llamados «Cinta transportadora N»**, con código por planta:
`PO-A1-15` es la Cinta 9 de Planta de trituración 1. Los sectores tienen el
mismo patrón —`PO-A1/A2/A3` las tres trituradoras, `PO-D1` Molienda de cal,
`PO-C1` Hidratación, `PY-A1/B1/D1` los filler—, y `D6` existe como equipo con
ese código. Entonces «Reparar rodillos 2/cinta 9 P/Trit N°3» tiene sector **y**
equipo exactos, no aproximados.

**Septiembre de 2026 ya está cargado a mano, y eso decide la primera corrida.**
Hay **29 OT de PIPARO fechadas en septiembre**, todas el día 01/09 y ya
agrupadas: «Limpieza general de la planta · 32 h», «Reparación sobre cinta ·
36 h». El cuaderno de ese mes tiene ~118 renglones. **Generar septiembre desde
el cuaderno duplicaría esas 29.** La primera corrida de verdad tiene que ser un
mes que todavía no se cargó, o alguien tiene que mirar esas 29 primero.

**El volumen se triplica.** Hoy entran ~35 OT por mes de Piparo (de 20 a 48
según el mes); una OT por tarea lleva eso a ~118. Es lo pedido, y queda escrito
para que el salto no sorprenda.

**Y 377 de las 380 vinieron de la planilla** (`app_created = false`): el camino
que hoy existe es el formulario de Google, no la app.

## Qué se construye

### La base

Tablas nuevas, con prefijo `mant_`. **No se reusan las de Candia**: aquéllas
tienen número de parte, total declarado y expresión de horas, que acá no
existen, y meter dos papeles distintos en una tabla obliga a que la mitad de las
columnas estén siempre en null.

- **`mant_cuadernos_contratista`** — una fila por carga: proveedor, quién la
  hizo, cuándo, y el estado (en chequeo / generada).
- **`mant_cuadernos_fotos`** — una fila por foto: a qué carga pertenece, el
  archivo en el bucket, el orden, y lo que el modelo devolvió **crudo**. Eso
  último no es decoración: cuando un renglón salga mal, la única forma de saber
  si lo leyó mal el modelo o lo editó una persona es tener lo que el modelo
  dijo.
- **`mant_cuadernos_renglones`** — fecha, tarea tal como está escrita, sector y
  equipo enganchados (y **si el sector es una propuesta sin confirmar**), horas,
  costo, de qué foto y de qué línea salió, el `grupo_id` con el que está
  juntado a otros, y a qué OT fue.
- **`mant_contratista_lugares`** — ya existe, se reusa tal cual: es la capa
  aprendida que pisa al intérprete.
- **`ordenes_trabajo.costo`** — columna nueva, `numeric`, nullable.
- **`proveedores.modo_de_carga`** — columna nueva, `parte_diario` por defecto.

**Las migraciones las corre una persona**, así que hay que decirlo y quedar a la
espera.

### La lectura de la foto

Por el **AI Gateway de Vercel**, que ya está configurado
(`AI_GATEWAY_API_KEY`) y ya lo usa el Asistente con AI SDK 7. El modelo sale de
una variable de entorno con el bueno por defecto, igual que `ASISTENTE_MODELO`,
para poder cambiarlo sin tocar código.

- **Una llamada por foto, y van de a una.** Si la cuarta falla, las otras nueve
  ya están y se reintenta sólo ésa. Diez fotos en una sola llamada es una
  respuesta larguísima que se corta a la mitad sin que nadie sepa por dónde iba.
- **Lo que el modelo devuelve es una lista de renglones**, no prosa: fecha,
  tarea, lugar en el texto de Piparo, horas, costo, si venía en una llave, y la
  línea de la foto. El enganche a sector y equipo **lo hace el código**, no el
  modelo: es la regla de siempre —enlazar al que se le parece es peor que dejar
  en null— y además el modelo no tiene el catálogo.

#### Y el enganche son dos cosas, no una

El catálogo `mant_contratista_lugares` es **igualdad exacta sobre texto
normalizado**: sirve para lo que alguien ya enseñó una vez, y el primer día está
vacío. Con sólo eso, la primera carga serían 118 renglones en rojo y nadie la
usaría.

Así que son dos capas, y el orden es el que importa:

1. **Un intérprete de las abreviaturas de Piparo**, que es código con tests:
   `P/Trit N°1|2|3` → `PO-A1|A2|A3`, `Molino cal` → `PO-D1`, `Idratación` →
   `PO-C1`, `Filer 01|02|03` → `PY-A1|B1|D1`; y dentro del sector, `cinta N` →
   el equipo «Cinta transportadora N» de **esa** planta, que es lo que vuelve
   exacto el enganche (`PO-A1-15` es la Cinta 9 de Trituración 1).
2. **El catálogo aprendido encima, que gana.** Lo que alguien enganchó a mano
   pisa al intérprete, porque alguien ya contestó esa pregunta mirando el papel.

**Esto lo decidió el sistema y no quien pidió la función.** El documento decía
«el catálogo se reusa tal cual» y a la vez que el enganche salía exacto, y las
dos cosas no pueden ser ciertas a la vez. Queda anotado acá para que no se lea
como algo que se acordó. Y una corrección honesta del boceto: el «sin sector
(11)» que se mostró en pantalla **era una ilustración, no una medición** — con
cuántos rojos arranca de verdad se sabe recién la primera corrida.
- **Las comillas se resuelven al leer**: `"  "  5 P/ " " 1` hereda del renglón
  de arriba. Eso lo hace el modelo, que tiene la hoja entera, y queda marcado
  como «heredado» para que se pueda mirar.
- **Un renglón que el modelo no entendió entra igual, marcado «dudoso»**, con su
  texto crudo. No se descarta: se muestra.

### La pantalla

`/mantenimiento/partes-contratista`, con el desplegable en PIPARO. Los tres
pasos de arriba: subir, chequear, generar.

### La generación

Pasa por el alta de OT que ya existe, así que hereda lo que ésa sabe: toma el
número de la serie, escribe en «Altas del sistema» y deja el pendiente anotado
si la planilla no estaba.

- **Un renglón ya convertido no se vuelve a convertir**: guarda su
  `orden_trabajo_id`.
- **Un grupo que ya tiene orden suma, no crea.** Diez fotos no se chequean de
  una sentada, así que «Tranqueras D6» puede aparecer en la segunda tanda
  cuando la primera ya generó su OT. Acá el grupo **no es una clave calculada
  sino uno que armó una persona**, así que se guarda explícito —los renglones
  juntados comparten un `grupo_id`— y la pantalla ofrece sumarle las horas a la
  orden que ya existe en vez de crear otra. Las horas se reescriben con el total
  del grupo (no se suman sobre lo que haya en la base, que contaría dos veces lo
  de antes) y la descripción se rearma con el rango de fechas nuevo.
  *(Decisión del sistema: es el error que a Candia le apareció el 20/10/2026
  cargando el parte 1301 de verdad, y acá no hay clave que lo detecte sola.)*
- **Antes de crear hay vista previa**, que corre la misma cuenta que la
  generación y no una parecida. Generar no se deshace: una OT escrita en la
  planilla se borra a mano, fila por fila.
- **El tope de 25 por corrida se mantiene.** Cada alta son cinco llamadas a
  Google en serie, y una quincena de Piparo son ~47 órdenes: van a hacer falta
  dos corridas y van a tardar minutos. El tope existe justamente para que un
  pedido no se corte a la mitad sin que nadie sepa por dónde iba.

## Lo que queda afuera

- **El Excel.** Se abandona; no se genera ni se exporta.
- **La factura.** Esto dice qué se hizo y cuánto costó; no la carga ni la cruza
  con Odoo.
- **Las 29 OT de septiembre que ya están cargadas.** No se tocan ni se
  concilian: lo que se decide es no correr septiembre, o mirarlas a mano.
- **Otros contratistas con cuaderno.** La estructura es por proveedor, así que
  serviría; la forma del cuaderno es de Piparo y vive en un solo lugar.

## Los riesgos que quedan asumidos

- **La transcripción se equivoca**, y por eso la foto va al lado y no detrás de
  un click. El sistema no tiene cómo saber que leyó «6 Hs» donde decía «8 Hs».
- **El sector decide cuántas OT salen**, así que un sector que el catálogo no
  reconoce no es sólo un campo vacío: funde dos órdenes en una.
- **El costo no entra en el informe de costo de máquina**, porque
  `costoEquipo.ts` saltea las OT de contratista y se decidió no tocarlo. La
  plata queda en la OT, en la pantalla del cuaderno y en la columna
  `REPUESTO UTILIZADO` de la planilla — que es donde ya se la lee.
- **El monto va a vivir en dos lugares**: `costo` como número en la base y
  dentro del texto de `repuesto` en la planilla. Si alguien edita uno y no el
  otro, divergen. Es el precio de exportar por una columna que ya existe en vez
  de pedir una nueva.
- **Nada ata el total del cuaderno contra la factura.** Candia tiene esa
  comprobación y Piparo no, porque el papel no la permite.

---

## Agregado el 02/11/2026, rehecho el 03/11: el mes también puede entrar por un Excel

**El problema que apareció al usarlo.** No todos los meses vienen en el
cuaderno: a veces quien carga arma él mismo la planilla. Fotografiar lo que ya
está tipeado para que un modelo lo vuelva a leer es dar una vuelta entera para
perder exactitud, y además mete los dudosos de la letra manuscrita en un dato
que nunca fue manuscrito.

**Qué es y qué no es.** Es **una alternativa a las fotos, no otro modo**. Las
dos conviven: una carga entra por fotos o por planilla, nunca por las dos. Todo
lo que viene después —el enganche a sector y equipo, juntar y separar, confirmar
el sector, el freno de duplicados, generar— es el mismo código y no se entera
de por dónde entraron los renglones.

### Lo que cambió el 03/11, y por qué importa contarlo

La primera versión leía un archivo de **dos mitades**: el detalle día por día a
la izquierda y, a la derecha, un resumen cuyas fórmulas (`=C47+C50+C51`) decían
qué renglones iban juntos en una OT. Un día después, quien arma el archivo lo
reemplazó por **una sola tabla**: el resumen, ya consolidado, con el rango de
días escrito en vez de deducido.

Eso dejó una lección que vale más que el código que se tiró: **la tabla cambió
de columnas (`K:O` → `A:E`) de un día para el otro.** Un lector que busca por
letra de columna se rompe con ese movimiento y no puede decir por qué. Por eso
ahora **las columnas se buscan por el texto del encabezado**, que es el contrato
que la persona que arma el archivo ve y controla.

### Las cinco columnas

`Tarea · Fecha Desde · Fecha Hasta · Hs · Precio ($)`

`Tarea` y `Hs` son las únicas obligatorias: sin tarea no hay qué hacer y sin
horas no hay qué cargarle a la OT. Se aceptan los sinónimos razonables
(`Descripción`, `Desde`, `Hasta`, `Horas`, `Importe`) y una sola columna `Fecha`
se toma como el día en que empieza. **Una fila es una tarea y una tarea es una
orden**: no hay nada que agrupar.

### Las cuatro decisiones

1. **El control es la fila de TOTALES.** Al desaparecer el detalle desapareció
   la comprobación de «las horas del resumen dan las del detalle». Lo que queda
   es el total declarado contra la suma de las filas, y sirve porque **ese total
   está escrito a mano y no es una fórmula**: compararlo detecta una fila de
   más, una de menos o un dígito cambiado. Si no da, **los renglones entran
   igual** —no hay nada que retener, la tabla es el dato— y se dice con los dos
   números y la fila del total. Si no hay TOTALES, también se avisa.
2. **El rango de días se guarda, no se deduce.** 18 de las 63 filas del archivo
   real abarcan más de un día; una va del 24 al 31. Sin guardarlo, la OT diría
   «El 24/10». Es una columna nueva, `fecha_hasta`, **nullable para siempre**:
   null quiere decir que no hay segunda fecha, que es lo que pasa con todos los
   renglones que entran por foto. Sin check de `fecha_hasta >= fecha`: un rango
   dado vuelta hay que mostrárselo a quien tipeó, no hacer fallar el insert de
   las 63 filas por una.

   **Corregido el 03/11, el mismo día**: la primera versión guardaba null cuando
   «Fecha Hasta» era igual a «Fecha Desde» —«duró un día», más prolijo—. En
   pantalla eso dejó **45 de 63 campos vacíos**, que es indistinguible de un dato
   que se perdió, y quien había tipeado las 63 fechas lo notó al primer vistazo.
   La lección general: **una optimización de almacenamiento que cambia lo que la
   persona ve no es una optimización.** Lo que está en el archivo se guarda como
   está.
3. **La procedencia no lleva columna nueva.** El archivo va al mismo bucket y a
   la misma tabla que las fotos (`mant_cuadernos_fotos`, con `orden: 1`), y lo
   único que lo distingue es la extensión de la ruta. Eso dejó intactos el
   borrado de la carga, el reintento y el vínculo de cada renglón con su origen.
   La migración que sí hizo falta es la del bucket: `allowed_mime_types` sólo
   tenía los cinco tipos de imagen.
4. **En pantalla no va el panel de la foto.** No hay hoja contra la cual
   comparar: la transcripción la escribió la misma persona que carga. Van las
   cinco columnas que se leyeron, de qué fila salió cada renglón, y dos campos
   de fecha en vez de uno. **El filtro de «dudosos» se dejó** —el plan decía
   sacarlo—: el Excel también produce dudosos y esconderlos sería tapar
   problemas reales.

### Lo que se midió (03/11/2026, `Tareas_Octubre_2026 2.xlsx`)

Una hoja, 63 tareas, 1074 horas, y la fila de TOTALES dice 1074: **cierra
exacto**. La tarea más larga son 106 h; 18 de las 63 duran más de un día; 0
precios. **Un solo dudoso: la fila 24 trae `#REF!` en «Fecha Desde»**, una
referencia que quedó rota al sacar el detalle — entra igual, marcada, usando su
«Fecha Hasta». El tope de horas por fila quedó en **500**, no en los 200 de un
renglón manuscrito: allá una fila es un día, acá es una tarea entera a lo largo
del mes, y lo que hay que atrapar es el dígito de más (106 → 1060).

### Los riesgos que quedan asumidos

- **El control es más débil que el que reemplazó.** Antes se cruzaban dos
  representaciones de lo mismo; ahora se compara un total contra la suma de las
  filas que lo componen, y las dos las tipeó la misma persona en el mismo rato.
  Un error de concepto —una tarea que se olvidó de anotar— no lo ve nadie.
- **Si no hay fila de TOTALES no hay control ninguno**, y eso es lo más probable
  en un archivo armado a las apuradas. Se avisa, pero avisar no es comprobar.
- **Un rango de días no se puede verificar.** Que una tarea diga del 24 al 31 es
  palabra de quien la anotó; el sistema sólo puede ver que el orden sea el
  correcto.

## Generar de a una, y sacar lo que ya está cargado (03/11/2026)

Dos pedidos que llegaron juntos al estrenar el Excel con el mes real, y que
salen del mismo lugar: **con el Excel casi todo sale solo**, y el módulo estaba
armado para el cuaderno manuscrito, donde casi nada sale solo.

Medido sobre la carga real de octubre: de los 63 renglones, **46 ya salían como
su propia OT y ninguno estaba juntado**; los otros 17 esperan el sector.

### «No tengo la opción de generar una OT sin juntar»

El malentendido que revela es el que había que cerrar: **juntar no es el camino
para generar una sola**. Juntar existe para cuando dos renglones son la misma
tarea de días distintos; usarlo como el botón de «generá éste» mete horas de
tareas distintas en una orden, que es lo que el módulo evita. Lo que faltaba no
era poder juntar de a uno: era poder **generar** de a uno.

El único botón que había genera todo lo que puede salir. Con 46 órdenes listas
contra un mes que ya tiene 91 OT de PIPARO cargadas a mano, eso no es una
opción que alguien vaya a apretar.

La ruta acepta `claves` —la `clave` de cada orden: el `grupo_id`, o `solo:<id>`
si es un renglón suelto— y la barra de la selección tiene su propio botón. Las
decisiones:

- **El filtro cae sobre los grupos y no sobre los renglones.** `enOrdenes` corre
  con la carga entera y las claves se eligen después. Elegir un renglón juntado
  saca su grupo entero: una orden con la mitad de las horas de su grupo sería
  peor que no tener el botón. Los compañeros que entran sin haber sido elegidos
  se cuentan en el cartel antes de escribir.
- **El tope de 25 y el freno de duplicados se cuentan después del filtro.**
  Generar de a uno pasa por el mismo freno que generar de a 46; lo que cambia es
  cuántas órdenes mira ese freno.
- **La comparación pantalla-contra-servidor sigue en pie**, porque las dos
  puntas filtran con la misma lista de claves. Era la defensa que impedía
  confirmar un número que ya no es el que se ve, y un filtro aplicado de un solo
  lado la habría roto sin romper nada visible.
- **Se dice cuántos de los elegidos no salen todavía.** Un botón que dijera
  «Generar 3» con 8 elegidos y no explicara los otros 5 es la clase de número
  que nadie vuelve a creer.

### «Que pueda borrar una línea, porque alguna capaz ya tiene OT creada»

Es el caso real de octubre. Hasta ahora no había qué hacer con esas filas:
dejarlas sin generar deja la carga eternamente en `EN_CHEQUEO` con renglones que
nadie sabe por qué no salieron, y el freno de duplicados avisa que el período
está cargado pero avisar no alcanza.

- **Ruta propia (`cuaderno/renglones/[id]`), no el `DELETE` de `/renglones`**,
  que saca el `grupo_id` y deja el renglón vivo. Un `DELETE` que según el cuerpo
  desagrupa o destruye es la clase de ambigüedad que se paga una sola vez y
  cara.
- **No se saca el que ya es una orden del sistema**, ni el que está en un grupo
  que ya generó. Lo segundo lo decide `sePuedeSeparar` —la misma función que usa
  separar, no una copia—: sacarlo le cambiaría el total a una orden ya escrita
  en la planilla.
- **Se audita con `borrar`, y es el primero que escribe una persona.** Hasta acá
  ese verbo lo escribían sólo las sincronizaciones. El argumento no es «borrar
  es grave» sino cuál pregunta queda sin respuesta: el archivo de origen sigue
  en el bucket, así que **qué decía** se contesta sin la tabla; **quién lo sacó
  y cuándo** no. Y estas filas son con lo que se le paga al contratista: una que
  desaparece es una hora que no se factura por el criterio de una persona. El
  registro va **antes** del borrado —si no entra, no se borra—, que es el orden
  que fijó `borradoDeEspejo.ts`.
- **El estado de la carga se recalcula al sacar**, no sólo al generar: sacar el
  último pendiente puede dejarla `GENERADA`. Por eso `actualizarElEstado` se
  mudó de la ruta de generación a `lib/mantenimiento/cuadernoEstado.ts`.

### Lo que se comprobó

- `enOrdenes` sobre los 63 renglones reales: 46 órdenes, **las 46 sueltas**, 0
  grupos, 17 pendientes y todos por `sin_sector`. Es lo que hace necesario el
  botón.
- El check vivo de `auditoria.accion` incluye `borrar`, y `filaDeAuditoria` acepta
  el evento tal como lo arma la ruta: no hace falta ninguna migración.
- `node scripts/que-cuelga-de.mjs mant_cuadernos_renglones` → **nada apunta a esa
  tabla por clave foránea**, así que borrar una fila no se lleva nada en cascada.
- El camino entero del borrado, sobre una carga de mentira creada y limpiada para
  eso: el `delete` con la guarda `orden_trabajo_id is null` borra 1, el estado
  queda `EN_CHEQUEO` con un pendiente y pasa a `GENERADA` cuando no queda ninguno.

### El riesgo que queda asumido

**Sacar un renglón es palabra de quien lo saca.** El sistema no puede comprobar
que la OT cargada a mano cubra de verdad esa tarea: no hay nada que las ate, y
el cruce por fecha y contratista es justo lo que el freno de duplicados ya hace
sin poder decidir. Lo que queda es el registro de quién lo decidió.
