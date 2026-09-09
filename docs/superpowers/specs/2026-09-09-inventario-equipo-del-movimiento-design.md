# Inventario — el equipo del movimiento

**Fecha:** 2026-09-09
**Estado:** implementado el 9/9/2026 — migración `20260909111616` aplicada, plan
en `docs/superpowers/plans/2026-09-09-inventario-equipo-del-movimiento.md`.
Cuatro decisiones de este documento cambiaron durante la implementación y están
corregidas acá; el plan tiene el detalle de por qué.
**Módulo:** Inventario (`app/(app)/inventario`, `lib/inventario`, `app/api/inventario`)

## El problema

El formulario de movimientos no tiene campo de equipo, y el kardex de la
planilla sí: es su **columna K, `EQUIPO`**. Está viva —580 de las 4.174 filas la
traen cargada, incluidas las del 7 y el 8 de septiembre— y el SdG no la lee ni
la escribe.

Los siete movimientos que se cargaron desde la app quedaron con la K vacía
(filas 4169 a 4175 del kardex, todas del 9 de septiembre). Es la divergencia que
no avisa: la planilla la lee gente que no entra al sistema, y una fila sin equipo
no le dice a nadie para qué máquina salió el repuesto.

La base ya está preparada. `inventario_movimientos` tiene `equipo_raw` y
`equipment_id` desde la 046, y `inventario_registrar_movimiento` ya recibe
`p_equipment_id` y lo inserta. Lo único que falta es que alguien lo mande, que se
escriba en la planilla, y que la sincronización lo lea de vuelta.

## Cómo funciona la columna K en la planilla

**No es texto libre: es un desplegable dependiente del sector.** Lo arma un
`onEdit` de Apps Script que, cuando cambia la J, borra la K y le pone una
validación con los equipos de ese sector, leídos de la pestaña
**`Sectores/Equipos`** (columna A = sector, columna B = equipo).

Esa pestaña se midió y es sana:

- **255 pares, sin huecos**: no hay filas con sector y sin equipo ni al revés.
- **26 sectores.** Los 255 equipos son distintos: **ningún equipo aparece en dos
  sectores**. O sea que no es un producto cartesiano sino un equipo con su
  sector al lado, y eso permite guardarlo como una fila por equipo.
- Los 26 sectores están **todos** en la validación de la J
  (`Empleados!D2:D28`, 27 valores). El único de la validación sin equipos es
  `MANTENIMIENTO`: su desplegable nunca se abre.
- Once de los 26 "sectores" son oficios y lugares —`PAÑOL`, `MECÁNICO`,
  `ELECTRICISTA`, `LUBRICADOR`, `CONTRATISTA`, `OFICINAS`, `CONSTRUCTORA`,
  `CAPATACES`, `LABORATORIO`, `BALANZA`, `PRODUCCIÓN`— y su único "equipo" es
  otra vez ese nombre. Es el relleno para que el desplegable no quede vacío.

**La K es texto plano.** Se comprobó pidiendo el `userEnteredValue`: no es
fórmula, así que se puede escribir. La L (`¿STOCK ACTUAL<=S.S.?`) sí es fórmula
y no se toca, igual que la G.

## Lo que se decidió

### El texto sale de la planilla, no del núcleo

De los 255 equipos de la pestaña, **19 no tienen código en el núcleo**
—los once oficios más `PO-C1-11 - EDIFICIO`, `D1`, `D6`, `LA ALCANCIA` y
`GALPON 1/2/3/5`—, y **26 comparten el código con otro nombre**:

```
planilla: "EM8 - SCANIA 420 4x4"       núcleo: "EM8 - CAMIÓN VOLCADOR 1"
planilla: "EM5 - DOOSAN SD 300"        núcleo: "EM5 - CARGADORA FRONTAL 1"
planilla: "PY-A2-14 - EMBOLSADORA"     núcleo: "PY-A2-14 - FLUIDOR 7"
planilla: "PY-A2-15 - CINTA TRANSPORTADORA 1"  núcleo: "PY-A2-15 - ELEVADOR 2"
planilla: "PO-C1-04 - ROMPEDORA A MARTILLOS"   núcleo: "PO-C1-04 - MOLINO A MARTILLOS"
planilla: "PO-B1-25 - REFRACTARIO 6"   núcleo: "PO-B1-25 - REFRACTARIO HORNO 6"
```

Si el texto se armara con `code || ' - ' || upper(name)` del núcleo, el SdG
escribiría en la K **26 nombres que la validación de la planilla rechaza**. Por
eso el nombre se siembra tal cual está en la columna B, sin normalizar, y el
núcleo se usa nada más que para el enganche por código. Es el mismo criterio que
`inventario_destinos` con la J y que la nota de la 20260903090920 sobre
`"STRUPP , Bernardo Miguel"`: lo que la app escribe tiene que ser una palabra
que la planilla acepte, aunque esté mal escrita.

### Faltan seis destinos, y entran acá

`inventario_destinos` tiene 21 nombres y la validación de la J acepta 27. Faltan
**`PLANTA TRITURACIÓN 2`, `FILLER 3`, `COMPRESORES`, `CAPATACES`, `BALANZA` y
`GALPONES`**, que entre los seis tienen **23 equipos** en la pestaña. Sin ellos
esos 23 no tienen a qué destino colgarse y el select nunca los ofrece.

Es exactamente la contra que la 20260903090920 dejó anotada —"si el pañol agrega
a alguien a la validación de la planilla y nadie lo carga acá, la app no se
entera"— cobrada por primera vez. Los seis se agregan en esta migración.

### La lista se sincroniza; no se administra

La lista del pañol (`inventario_solicitantes`, `inventario_destinos`) se decidió
como catálogo del SdG: se siembra una vez y se edita en una pantalla, porque la
planilla no la publica en ningún lado legible, sólo en un rango de validación.

**`Sectores/Equipos` es distinta: es una pestaña hecha para leerse.** Así que
esta lista se espeja en cada sincronización, y por eso **no hay pantalla de
ABM**: un equipo nuevo lo agrega el pañol en la pestaña —que es donde tiene que
agregarlo igual, o el desplegable de la planilla no lo ofrece— y el SdG lo
levanta solo. Una lista que no se puede quedar vieja es mejor que una pantalla
para desatrasarla.

**La reconciliación nunca borra.** Un equipo que desaparece de la pestaña queda
con `activo = false`; uno que vuelve, en `true`. Si la pestaña no se puede leer,
la sincronización lo informa —con lo que dijo Google, sin traducir— y la lista
queda como estaba. Borrar filas dejaría los movimientos históricos apuntando a
la nada, y un error de lectura vaciaría el select sin que nadie se entere.

### El select es dependiente, como en la planilla

Filtra por el destino resuelto: el elegido a mano si hay uno, y si no el de quien
retira, que es la regla que ya tiene `sectorDelMovimiento`. Sin destino no se
puede ofrecer nada, así que dice qué falta en vez de mostrar un select vacío. Con
un destino que no tiene equipos —hoy `MANTENIMIENTO`— dice eso mismo.

**El campo es opcional.** Hoy sólo el 14% de las filas del kardex trae equipo:
exigirlo sería pedir un dato que el pañol muchas veces no tiene. No entra en
`loQueFalta`.

## Las tablas

```sql
inventario_equipos
  id           uuid primary key
  nombre       text not null unique   -- literal la columna B: es lo que va a la K
  destino_id   uuid references inventario_destinos(id) on delete restrict
  equipment_id uuid references equipos(id) on delete set null
  activo       boolean not null default true
  created_at   timestamptz
  updated_at   timestamptz

inventario_movimientos
  + equipo_id  uuid references inventario_equipos(id) on delete set null
```

`nombre` es único y es la clave contra la que reconcilia la sincronización: la
pestaña no tiene ids.

`destino_id` va **`on delete restrict`** y no `set null`: un equipo sin destino no
lo puede ofrecer nadie, así que borrar un destino con equipos colgados tiene que
fallar y no dejar 23 filas mudas.

`equipo_raw` y `equipment_id` ya existen. `equipo_raw` guarda el texto —el de la
planilla cuando viene de allá, el de la lista cuando lo carga la app— y es de
donde el kardex de la app lee el equipo, igual que `sector_raw` con el destino.

La migración es **una sola** y no toca ningún enum: crea la tabla, agrega la
columna, y siembra los seis destinos que faltan. No siembra los 255 equipos: los
trae la primera sincronización. La contra, dicha: entre que se aplica la
migración y que alguien aprieta "Traer de la planilla", el select no tiene nada
que ofrecer.

## Los cambios, por archivo

**`lib/inventario/planilla.ts`** — `ALIAS_KARDEX` suma
`equipo: ["EQUIPO", "MAQUINA", "EQUIPO/MAQUINA"]`, `MovimientoLeido` suma
`equipo_raw`, y `filaDeMovimiento` lo lee con `campo()`, que ya trata el guión
como vacío.

**`lib/inventario/equipos.ts`** (nuevo) — el espejo de la pestaña, en dos
funciones puras y una que escribe:

- `filaDeSectorYEquipo(fila)` — un par de la pestaña, o `null` si le falta
  alguna de las dos columnas.
- `equiposQueCambian(pestaña, listaActual, destinos)` — qué hay que insertar,
  qué actualizar y qué marcar inactivo. Devuelve también los pares cuyo sector
  no es un destino conocido, para poder informarlos en vez de tragárselos.
- `sincronizarEquipos(admin)` — aplica lo que la anterior decidió.

**`lib/inventario/enlaces.ts`** — `indiceDeEquipos(equipos)` y
`reconocerEquipo(indice, texto)`. Matchea por el **código**, que es lo que está
antes del primer `" - "`: así los 26 nombres divergentes se enganchan igual, y
también cualquier valor que la K traiga y la pestaña ya no ofrezca. Si no hay
código, prueba el nombre completo
normalizado. Lo que no reconoce queda en `null` y se informa — la regla de la
032, la misma que ya aplica `reconocer()` para empleados.

**`lib/inventario/sincronizar.ts`** — corre `sincronizarEquipos` antes del
kardex (la lista tiene que existir para poder enganchar), lee la pestaña nueva
con `GOOGLE_SHEETS_INVENTARIO_TAB_EQUIPOS` —default `"Sectores/Equipos"`— y
guarda tres cosas por fila del kardex, que se resuelven distinto y conviene no
confundir:

- **`equipo_raw`**: el texto de la K, sin interpretar.
- **`equipo_id`**: la fila de `inventario_equipos` que se llama así, con la
  misma normalización que ya usan destinos y solicitantes (`indicePorNombre`:
  sin acentos, sin mayúsculas, espacios colapsados). No matchea por código: la
  lista se acaba de espejar de la misma pestaña, así que si el nombre no está es
  porque el valor no está en la pestaña, y ahí queda en null. Son los dos
  huérfanos `PO-D1-10`.
- **`equipment_id`**: el equipo del núcleo, por `reconocerEquipo`. Es el único
  de los tres que matchea por código, y por eso los dos huérfanos igual quedan
  colgados de la máquina correcta aunque no tengan `equipo_id`.

**`app/api/inventario/movimientos/route.ts`** — resuelve `equipo_id`
**contra la lista** y no contra el cuerpo del pedido, por la misma razón que
solicitante y destino: alcanza una pestaña vieja abierta para escribir en la K
una palabra que la validación rechaza. Además **comprueba que el equipo sea del
destino resuelto** y devuelve 400 si no lo es: es la comprobación que hace el
desplegable de la planilla, y sin ella una lista desactualizada en el cliente
mete un equipo de otro sector. De ahí salen `equipo_raw` (el nombre) y
`p_equipment_id` (el fk al núcleo).

**`lib/inventario/espejo.ts`** — `COL.equipo = 10` (la K) y una celda más en
`celdasDelMovimiento`. `MovimientoAEspejar` suma `equipo`.

**`app/(app)/inventario/movimientos/nuevo/`** — la página pasa la lista de
equipos con su `destino_id`; el cliente suma un select opcional debajo de "Para
qué sector", filtrado por el destino resuelto y ordenado por nombre —que empieza
con el código, así que agrupa por planta solo.

## Qué se testea

Vitest sobre las funciones puras, que es donde están las decisiones:

- `mapearKardex` encuentra `EQUIPO`, y lo encuentra igual si la planilla lo
  llama `MAQUINA`.
- `filaDeMovimiento` lee el equipo, y devuelve `null` cuando la celda tiene un
  guión.
- `filaDeSectorYEquipo` descarta las filas a medias.
- `equiposQueCambian`: inserta lo nuevo, no toca lo igual, marca inactivo lo que
  desapareció, **no borra nunca**, y separa los pares con un sector desconocido.
- `reconocerEquipo`: engancha `EM8 - SCANIA 420 4x4` con `EM8` del núcleo aunque
  el nombre no coincida; engancha los dos huérfanos `PO-D1-10`; devuelve `null`
  para `PAÑOL` y para `GALPON 5`, que no son equipos del núcleo.
- `celdasDelMovimiento` escribe la K **y sigue sin escribir la G**. Esto último
  es una prueba de regresión, no una redundancia.

## Lo que queda a la espera

La migración la aplica una persona en el editor SQL de Supabase. Hasta que esté
corrida, el resto no funciona: la ruta va a fallar al resolver `equipo_id` y el
select va a estar vacío. Se avisa y se espera.

## Riesgos asumidos

**El script puede borrar lo que escribe el SdG.** El `onEdit` hace
`clearContent()` sobre la K cuando alguien edita la I o la J de esa fila. No se
dispara con escrituras de la API —así que lo que carga la app entra sin pasar por
`setAllowInvalid(false)`, y por eso el texto tiene que salir de la lista y no del
cliente—, pero si después una persona toca esa fila a mano, el equipo se pierde y
la sincronización siguiente lo lee vacío y lo pisa en la base. No se arregla del
lado del SdG: se arregla en el script.

**Un sector nuevo en la pestaña deja sus equipos afuera.** Si el pañol agrega un
sector que no está en `inventario_destinos`, sus equipos no se pueden colgar de
ningún destino. La sincronización los informa en vez de inventarles uno, y lo que
hay que hacer es agregar el destino. Es el mismo trato que la lista del pañol le
da a un nombre que no reconoce.

## Fuera de alcance, pero encontrado

Tres cosas que se midieron haciendo esto y que no se tocan en este cambio:

1. **El espejo se come la fórmula de la J.** La J es
   `=IFERROR(XLOOKUP(F; Empleados!A:A; Empleados!B:B); "")` —la planilla deduce
   el sector de quién retira— y el SdG le escribe un literal. Las filas 4172 a
   4175, las que cargó la app, tienen texto ahí; las 4170 y 4171, cargadas a
   mano, conservan la fórmula. Es la trampa de la G en otra columna. Escribir la
   J es a propósito —el destino elegido puede no ser el de quien retira—, así que
   hay que decidir qué se prefiere, no arreglarlo de una.
2. **`COL_DISPARO = 9` apunta a la I (`PROVEEDOR`).** Lo que en realidad cambia
   la J es la **F** (`QUIEN LO PIDIÓ`), que es la 6. Tal como está, el
   desplegable de la K se rearma cuando alguien edita el proveedor y no cuando
   cambia el sector.
3. **Dos valores del kardex no están en la pestaña**:
   `PO-D1-10 - SEPARADOR DINÁMICO 3` y `4`, contra un `PO-D1-10 - SEPARADOR
   DINÁMICO 2` en la pestaña y en el núcleo. Alguien tiene que decidir cuál de
   los tres nombres es el bueno.

   Y una aclaración que costó una revisión entera: **esas dos filas no llegan a
   la base**. Las dos tienen entrada y salida cargadas al mismo tiempo, y
   `filaDeMovimiento` descarta esas filas desde siempre porque nadie mueve un
   artículo para los dos lados a la vez. Así que no sirven para comprobar el
   enganche por código —buscarlas en `inventario_movimientos` no las encuentra—
   y tampoco son un problema abierto del enlace: son dos filas mal cargadas.
