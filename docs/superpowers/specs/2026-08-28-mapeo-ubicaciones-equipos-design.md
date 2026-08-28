# Las ubicaciones de Compras son equipos y sectores de Mantenimiento

Diseño acordado el 28 de agosto de 2026.

## El problema

La migración 017 lo dejó escrito en un comentario, cuando Compras todavía no
existía en producción: "varias ubicaciones de la planilla son equipos del módulo
Mantenimiento (CAT 950G, Doosan 225 n°1), así que enlazarlas permite ver cuánto
se gastó por máquina". La 019 movió ese enlace del requerimiento al catálogo
—38 filas para mapear una vez, en vez de 1.825— y lo dejó en null con una nota:
se completa "cuando existan los sectores físicos y la flota real".

Las dos condiciones se cumplieron. La 033 separó los sectores de planta de los
organizativos y hoy hay 15 con su código de BD Equipos; la importación del libro
cargó 239 equipos. **Y las 38 ubicaciones siguen en cero: ninguna tiene
`equipo_id` ni `sector_id`.**

Mientras tanto Compras acumuló 1.900 requerimientos, 1.520 de ellos con costo.
Ese gasto está atado a un texto —"Doosan 300", "Planta Filler 2"— que
Mantenimiento no puede cruzar con nada.

## Por qué no lo resuelve la pantalla que ya existe

`/compras/ubicaciones` tiene desde la 019 un modal que enlaza una ubicación a un
equipo o a un sector. Nadie lo usó, y al intentarlo se ve por qué:

- El desplegable de equipos dice `EM3 — Retroexcavadora 3`. La planilla de
  Compras dice `Doosan 225 n°1`. **No hay una sola palabra en común**: Compras
  nombra por marca y modelo, Mantenimiento por función y número. La pantalla
  está pidiendo que se adivine.
- El desplegable de sectores lista los 41, con "Calidad", "Finanzas" y tres
  "Mantenimiento" distintos entre las opciones de dónde está una máquina. Es el
  sexto lugar donde faltó el filtro que `sectoresDePlanta()` existe para poner.

## La decisión

El emparejamiento lo hace una persona, una vez, y queda escrito en una
migración. No hay matcher automático.

Esto merece una aclaración porque roza lo que la 032 rechazó para proveedores
—"queda en null mientras nadie lo reconozca, que es más honesto que enlazarlo al
que se le parece"—. La diferencia es quién decide: acá alguien miró la marca y
el modelo de cada máquina y dijo cuál es cuál. La migración **registra una
decisión humana**, no la deduce. Escribir un algoritmo que vuelva a deducir esas
28 decisiones sería trabajo que rinde una vez cada varios meses, cuando la
planilla invente una ubicación nueva.

Para ese caso —que va a pasar: 16 de las 38 ubicaciones actuales las creó la
sincronización sola— alcanza con que la pantalla sea usable: que muestre de qué
marca y modelo es cada equipo, y que diga cuántas ubicaciones quedan sin
enlazar.

## 1. El mapeo — migración 042

Las 38 ubicaciones, resueltas contra `marca`, `modelo` y `descripcion_proceso` de
la ficha técnica, que es el vocabulario que comparte con Compras.

**A un equipo — 15 ubicaciones, ~204 RI**

| Ubicación | Equipo | Por qué |
|---|---|---|
| CAT 320B | `EM1` Retroexcavadora 1 | Caterpillar 320 B |
| CAT 320C | `EM2` Retroexcavadora 2 | Caterpillar 320 C |
| Doosan 225 n°1 | `EM3` Retroexcavadora 3 | Doosan 225 — convención |
| Doosan 225 n°2 | `EM4` Retroexcavadora 4 | Doosan 225 — convención |
| Doosan 300 | `EM5` Cargadora frontal 1 | Doosan SD 300 |
| CAT 950G | `EM6` Cargadora frontal 2 | Caterpillar 950 G |
| Liu Gong 856H | `EM7` Cargadora frontal 3 | Liu Gong 856 H |
| Scania 420 4x4 (2004) | `EM8` Camión volcador 1 | Scania 420 4x4 |
| Scania 420 8x4 (2011) | `EM9` Camión volcador 2 | Scania 420 8x4 |
| Autoelevador Toyota n°1 | `EM10` Autoelevador 1 | Toyota 628FD25 — convención |
| Autoelevador Toyota n°2 | `EM11` Autoelevador 2 | Toyota 628FD25 — convención |
| Autoelevador XCMG | `EM12` Autoelevador 3 | XCMG XCBDT25 |
| Autoelevador HCMG | `EM12` Autoelevador 3 | el mismo, con el tipeo de la planilla |
| Regador | `EM15` Camión regador | Mercedes Benz 1114 |
| Amarok | `EM16` Camioneta 1 | modelo Amarok |

**A un sector de planta — 13 ubicaciones, ~787 RI**

| Ubicación | Sector | | Ubicación | Sector |
|---|---|---|---|---|
| Planta de trituración 1 | `PO-A1` Trituración 1 | | Planta Filler 1 | `PY-A1` Filler 1 |
| Planta de trituración 2 | `PO-A2` Trituración 2 | | Molienda filler 1 | `PY-A1` Filler 1 |
| Planta de trituración 3 | `PO-A3` Trituración 3 | | Planta Filler 2 | `PY-B1` Filler 2 |
| Calcinación | `PO-B1` Calcinación | | Molienda filler 2 | `PY-B1` Filler 2 |
| Hidratación | `PO-C1` Hidratación | | Planta 0-2mm | `PY-C1` Planta 02 |
| Molienda de cal | `PO-D1` Molienda cal | | Molienda 0-2mm | `PY-C1` Planta 02 |
| Compresores | `AMB-C1` Compresores | | | |

Las moliendas van al sector y no a una máquina porque **no existe ningún equipo
llamado "Molienda"**: el molino es una máquina adentro del sector
(`PY-A1-08 Molino de bolas`, `PY-B1-09 Molino vertical`). Que dos ubicaciones
caigan en el mismo sector no es un problema: el gasto se agrega igual.

**Sin enlazar — 10 ubicaciones, ~909 RI.** Pañol (306), Taller Eléctrico (150),
Taller de mantenimiento (145), OTRA (115), Oficinas (89), Taller de equipos
móviles (37), Cantera (36), Laboratorio (23), Vigilancia (8), Taller eléctrico
(0). No son una máquina ni un sector de planta: son depósitos y lugares de
trabajo. **Casi la mitad del gasto no se va a atribuir nunca**, y eso es un
hecho del negocio —lo que entra al pañol es stock, no es de nadie todavía—, no
una falla del mapeo.

Cantera queda sin enlazar aunque tenga 36 RI: no está entre los 15 sectores de
planta de BD Equipos y no tiene equipos cargados. Inventarle un sector sin
código dejaría un sector de planta que la próxima importación del libro no
reconoce.

El enlace se hace **por nombre y no por id**, para que la migración se pueda
correr en cualquier copia de la base. Es idempotente: sólo escribe donde el
enlace está en null.

De paso completa el `tipo` de las 16 filas que la sincronización creó sin él y
que hoy se muestran como "Otra": 15 son los equipos móviles y la restante es
`Taller Eléctrico`, que con sus 150 RI queda marcada como taller aunque no se
enlace a nada.

### El riesgo asumido

Cuatro ubicaciones van por convención, no por dato: `Doosan 225 n°1/n°2` contra
`EM3`/`EM4`, y `Autoelevador Toyota n°1/n°2` contra `EM10`/`EM11`. Las dos
Doosan tienen modelos exactos distintos (DX 225 CLK y DX225CLA-7M) que la
planilla no menciona; los dos Toyota son idénticos hasta en el número de serie.
La convención es **n°1 = el código de equipo más bajo**.

Si están cruzadas, el gasto de una cae en su gemela y nada lo denuncia. Son ~60
RI. Se corrige desde la pantalla, sin migración.

## 2. La pantalla, arreglada — no reconstruida

Tres cambios en `/compras/ubicaciones`:

- **El desplegable de equipos muestra la marca y el modelo**:
  `EM3 — Retroexcavadora 3 · Doosan 225`. Es el arreglo del que depende que
  alguien pueda decidir; sin eso la pantalla pide adivinar.
- **El desplegable de sectores usa `sectoresDePlanta()`**, que ya existe
  exactamente para esto.
- **Un contador de ubicaciones sin enlazar** en el encabezado, al lado de "sin
  usar". Es lo que hace visible la próxima que aparezca sola.

No se toca el bloque de pares parecidos ni la fusión. Las sugerencias actuales
son falsos positivos —"Planta de trituración 1" y "2" difieren en un caracter y
son lugares distintos— y no hace falta fusionar ninguna: `Autoelevador HCMG` y
`Autoelevador XCMG` apuntan al mismo equipo, así que los 2 RI del tipeo caen
igual en la máquina correcta.

## 3. Filtrar por equipo y por sector en Requerimientos

Dos filtros nuevos en `/compras/requerimientos`, con la forma que ya tienen los
otros siete en `FiltrosCompras`.

El enlace vive en el catálogo, no en el requerimiento, así que el filtro resuelve
primero qué ubicaciones corresponden a ese equipo o a ese sector y consulta
`.in("ubicacion_id", …)`. La lista es de una o dos ubicaciones por equipo, muy
lejos del `.in()` con mil ids que arma una URL que PostgREST rechaza.

Un equipo sin ninguna ubicación enlazada no aparece en el desplegable. Ofrecer
las 239 máquinas cuando 15 pueden devolver algo es prometer un filtro que da
vacío.

## 4. El bloque "Compras para este equipo" en la ficha

En `/mantenimiento/equipos/[id]`, debajo de las órdenes de trabajo: los
requerimientos enlazados a esa máquina, el gasto por año sumando `costo_iva`, y
el acumulado al pie.

Tres decisiones sobre qué número se muestra:

- **Se corta por año** y no se muestra sólo un total. Sumar pesos de 2024 con
  pesos de 2026 da un número que no significa nada; al pie se aclara que son
  pesos de cada momento.
- **Los RI sin costo se cuentan aparte**, no suman cero. Son 380 de 1.900.
  Esconderlos haría parecer barata una máquina que no lo es.
- **El año sale de `fecha_pedido`**, que es cuándo se gastó, con respaldo en
  `fecha` para los que no lo tienen.

**Lo que el bloque no hace, y dice en pantalla:** muestra sólo lo enlazado
directo a esa máquina. El gasto de un sector no se reparte entre sus equipos
—atribuirle al `Molino vertical` una fracción de lo que se compró para Filler 2
sería inventar un número—. Ese gasto se ve en Compras filtrando por sector.

En la práctica el bloque aplica a 15 máquinas de 239. Las otras 224 no muestran
nada, y las que están en un sector con compras muestran el cartel que explica
dónde mirar.

## Lo que este spec no incluye

**El costo total del equipo** —materiales, terceros y mano de obra propia— es el
spec siguiente. Las tres fuentes existen: Compras vía este mapeo,
`ordenes_servicio.costo` (148 de 221 con equipo y costo) y
`ordenes_trabajo.horas` (959 de 1.753 con equipo y horas, 14.808 horas). Lo
único que falta es cuánto vale una hora: `operarios` tiene `id, slot, nombre` y
nada de costo, así que la tarifa es un dato nuevo en Configuración de
Mantenimiento.

Si este mapeo no se hace, ese spec muestra el costo de la máquina sin los
materiales, que es el pedazo más grande.

## Tests

- El agregado por año: RI sin costo contados aparte y no sumados, corte por
  `fecha_pedido` con respaldo en `fecha`, y el orden de los años.
- Los filtros nuevos contra un valor que no está en la lista, que es el contrato
  que `siEstaEnLaLista` ya sostiene para los otros siete.
- La resolución de equipo o sector a la lista de `ubicacion_id`, incluido el
  caso de dos ubicaciones que caen en el mismo sector.
