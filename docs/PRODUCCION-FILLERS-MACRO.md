# Los botones de Filler 1 y 2 — qué hace esa macro y qué le pasa

Relevado el 20/10/2026 sobre `Botones de filler 1 y 2 (Alejandro).xlsm`
(última modificación: 20/10/2026 11:40, autora de origen: Paola), leyendo
además los CSV reales que la alimentan y tres de los archivos que generó.

Es la antesala de llevar esto al SdG. Acá queda lo que la macro hace, de dónde
saca los datos y **los cuatro errores que tiene**, medidos contra el dato real
y no deducidos del código.

## El libro no tiene datos: tiene dos botones

El `.xlsm` pesa 69 KB y está vacío. Una sola celda con texto —*BOTONES
GENERADOR DE PARTES DIARIO PARA FILLER 1 Y 2*— y dos botones de formulario
sobre `Hoja1`, cada uno atado a una macro:

| Botón | Macro | Vive en |
|---|---|---|
| Filler 1 | `filler1` | `Hoja1` |
| Filler 2 | `ConsolidarYOrdenarCSV_Excel2010_Resumen_Todo_Freeze` | `Hoja2` |

Las dos son independientes, no comparten una línea de código y **no hacen lo
mismo**, aunque el resultado se parezca. Son dos implementaciones distintas del
mismo informe, escritas en momentos distintos, y buena parte de lo que sigue
sale de ahí.

## De dónde salen los datos

De una carpeta de red, no de la planilla. Las rutas están **escritas a mano
dentro del código**:

```
Z:\01. PRODUCCIÓN\Parte diario\DATOS PC ROBOT\FILLER  1        (dos espacios)
Z:\01. PRODUCCIÓN\Parte diario\DATOS PC ROBOT\FILER 2 - CALERA ("FILER", sin la segunda L)
```

En esta máquina ese recurso está mapeado en `Y:` y no en `Z:` (`Y: =
\\server\general`, `Z: = \\server\EXTERIOR`), así que **la macro corre en una
PC y no en otra**, sin más aviso que un *"La carpeta no existe"*. Los dos
espacios de `FILLER  1` y la falta de una L en `FILER 2` no son erratas del
documento: son los nombres reales de las carpetas, y si alguien los corrige
la macro deja de encontrarlas.

Quien escribe ahí es `PCRobot.exe`, que vive en la misma carpeta y descarga
los contadores del PLC de cada molino. Deja varios CSV, separados por `;`,
sin encabezado, con fecha en **d/m/yyyy**:

### Filler 1

| Archivo | Qué es | Forma | Filas |
|---|---|---|---|
| `DAT00000001.CSV` | **el único que lee la macro** — un renglón por turno cerrado | `fecha;hora;kg₁;kg₂;kg₃;kg₄;minutos;"min";MATERIAL;MODO` | 809 (26/02→19/10/2026) |
| `DAT00000002.CSV` | horímetro, una fila por hora | `fecha;hora;horas;" HS";temperatura` | 4.879 |
| `DAT00000003..06.CSV` | **el desglose por material** del mismo turno, uno por corte horario | `fecha;hora;kg_membranero;kg_dolomita;kg_caliza` | ~202 c/u |

De las cuatro columnas de kilos de `DAT00000001` **sólo una trae valor**: la
que corresponde al turno que se cerró. El robot cierra cuatro veces por día y
los minutos lo confirman: 3:59 y 23:59 traen 239 minutos (bloques de 4 horas),
11:59 y 19:59 traen hasta 479 (bloques de 8). Los turnos reales son, entonces,
**20→00, 00→04, 04→12 y 12→20**, y el sello de hora es el **final** del turno.

### Filler 2 (Calera)

| Archivo | Qué es | Forma |
|---|---|---|
| `DAT00000001..04.CSV` | los que lee la macro, uno por corte horario | `fecha;hora;` y después **seis pares** `kg;minutos`: piedra membranero, piedra dolomita, piedra caliza, arena membranero, arena dolomita, arena caliza |
| `DAT00000005..08.CSV` | mismos cortes, cuatro columnas más sin identificar (hoy todas en cero) | |
| `DAT00000010.CSV` | horímetros de cinco equipos por hora | `...;h;FILLER 2;h;FILLER 1;h;CALERA;h;HIDRAT;h;FILLER3` |
| `DAT00000011.CSV` | registro de cambios de modo | `fecha;hora;MANUAL\|AUTOMATICO` — 24.098 filas |

Acá sí la macro nombra los seis materiales, y la hora se interpreta por rango
en vez de por posición de columna.

**Los archivos son acumulativos y se archivan a mano.** Los dos juegos arrancan
en febrero de 2026, y al lado hay carpetas `2025`, `2026`, `DATOS POST
12-2-2026` y `subida de datos 27 de feb` con los tramos anteriores. Nada rota
solo.

## Qué produce cada botón

### Filler 1 — `filler1`

1. Busca en la carpeta **el primer archivo cuyo nombre contenga
   `dat00000001`** y lo abre. Nada más; los otros cinco CSV no los mira.
2. Crea un libro nuevo con la hoja `Datos Consolidados`: copia `A:I`, divide
   las cuatro columnas de kilos por 1000 y ordena por fecha y hora.
3. `Resumen`: agrupa por **(día, material)**. Producción = suma de las cuatro
   columnas de turno. Tiempo = suma de la columna de minutos **dividida por
   60**. Y la razón ton/h.
4. `Resumen Mensual`: agrupa por **(mes, material)** sobre los tres materiales
   fijos `dolomita`, `membranero`, `caliza`, más una columna de total.
5. Guarda solo, pisando lo que haya, como
   **`Filler 1 relevo(mm-yyyy-dd).xlsx`** en la misma carpeta de entrada —
   mes-año-día, en ese orden. Hay 123 de esos archivos conviviendo con los CSV.

### Filler 2 — `ConsolidarYOrdenarCSV...`

1. Exige los **cuatro** archivos por nombre exacto; si falta uno, corta.
2. Consolida `A:N` en `Datos Consolidados` y guarda una copia intacta en
   `Datos Crudos`.
3. Después **pisa `Datos Consolidados` en el lugar** con otra cosa: suma los
   seis pares en un total de toneladas y un total de minutos, borra las
   columnas originales y escribe el total en una de cuatro columnas de turno
   según la hora, más minutos, horas, toneladas y ton/h.
4. `Resumen` diario, `Resumen Mensual` y `Resumen Anual`, los tres con una
   columna por cada uno de los seis materiales.
5. **No guarda nada.** Deja el libro abierto y avisa *"Proceso completado con
   éxito para el filler 2"*; el archivo lo guarda una persona, a mano. De ahí
   los nombres: `Filler2relevo( 08 -2025).xlsx`, `Filler 2 relevo
   (01-2026).xlsx`, uno suelto en la raíz de `Y:`. **El último es de junio de
   2026**, guardado el 8 de julio: hace más de tres meses que ese botón no
   deja rastro, mientras el de Filler 1 corrió hoy.

## Los cuatro errores

Ninguno avisa. Los cuatro están medidos contra el dato real.

### 1. El resumen mensual de Filler 1 está 60 veces mal

La columna de minutos se divide por 60 en el resumen diario y **no** se divide
en el mensual —el código lo dice en un comentario: *"SE ASUME HORAS"*, sobre
la misma columna que el bloque de arriba trató como minutos—. Se ve en el
archivo generado hoy, `Filler 1 relevo(10-2026-20).xlsx`:

| | Producción | Tiempo | ton/h |
|---|---|---|---|
| Resumen diario, 26/02 | 83,55 ton | 11,5 h | **7,27** |
| Resumen mensual, 02/2026 | 444,33 ton | 3.507 "hora" | **0,127** |

3.507 son minutos. El ton/h mensual que se lee en todos esos archivos está
dividido por 60.

### 2. El resumen de Filler 2 no significa nada

Es el más grave, porque el número *parece* un número. Las hojas `Resumen`,
`Resumen Mensual` y `Resumen Anual` leen las columnas 3 a 14 creyendo que
siguen teniendo los seis pares `kg;minutos` del CSV — pero el paso anterior
**ya las pisó** con el formato de turnos. Entonces:

- *"Piedra membranero (hora)"* es, en realidad, **las toneladas del turno
  04→12**.
- *"Piedra caliza (ton/h)"* da **0,06 en todas las filas de todos los meses**,
  porque la cuenta terminó siendo `(minutos/1000) ÷ (minutos/60)` = 60/1000.
  Es exacto, constante, y está ahí desde el primer archivo.
- Las columnas de arena dan todas cero, porque esas celdas se borraron antes
  de leerlas.

En `Filler 2 relevo (06-2026).xlsx` el total de piedra de un mes entero da
**21,87 toneladas**. La hoja `Datos Crudos`, que sí es fiel, tiene los kilos de
verdad. Nada de las tres hojas de resumen de Filler 2 es usable.

### 3. Filler 1 atribuye el turno entero a un solo material

`DAT00000001` trae **un** material por turno. Pero `DAT00000003..06` traen el
desglose, y los turnos se mezclan: el 01/03/2026 a las 3:59 el robot registró
17.682 kg de membranero **y** 15.961 de dolomita; `DAT00000001` dice 33.643 kg
y, como material, `DOLOMITA`. La macro le cree.

Medido sobre los 809 turnos del archivo de hoy:

- **127 turnos (15,7 %) produjeron más de un material.**
- **4.034 toneladas de 35.797 — el 11,3 % — quedan atribuidas al material
  equivocado.**

| Material | Según la macro | Según el desglose real | Diferencia |
|---|---|---|---|
| Membranero | 29.678 t | 30.419 t | −741 t |
| Dolomita | 3.290 t | 3.047 t | +243 t |
| Caliza | 2.829 t | 2.331 t | **+498 t (+21 %)** |

El total general está bien. La apertura por material, no. Y el dato correcto
**ya está en la carpeta**, en cuatro archivos que la macro nunca abre.

### 4. Los turnos de Filler 1 están rotulados corridos un lugar

La macro de Filler 1 no mira la hora: escribe los encabezados `Turno 00-04`,
`04-12`, `12-20`, `20-00` sobre las cuatro columnas en el orden en que vienen.
Pero el robot usa ese orden: 20→00 primero, después 00→04, 04→12 y 12→20. El
renglón de las 19:59 —que cierra el turno de 12 a 20— aparece bajo *"Turno
20-00"*.

Hoy no cambia ningún total, porque las cuatro columnas se suman siempre
juntas. Importa el día que alguien quiera producción por turno. La macro de
Filler 2 **sí** mira la hora y rotula bien: es el mismo informe hecho de dos
maneras, y una de las dos está mal.

## Lo que hay que resolver antes de escribir código

- **"Filler 1" y "Filler 2" ya significan otra cosa en el SdG.** En
  `/calidad/ensayos` son *productos* —finuras—, con un cartel en pantalla
  advirtiendo que no son el catálogo. Acá son *molinos*. `DAT00000010` los
  nombra junto a `CALERA`, `HIDRAT` y `FILLER3`, que son equipos. Si esto entra
  al sistema con el mismo nombre, el próximo que lea una pantalla va a enlazar
  el que se le parece. Hay que decidir el nombre antes, no después.
- **Hay un `FILLER3` en los horímetros y no hay botón para él.** Conviene
  saber si produce y nadie lo informa, o si está parado.
- **El modo `MANUAL`/`AUTOMATICO` existe y se tira.** 23 de 809 turnos de
  Filler 1 corrieron en manual, y hay un registro de 24.098 cambios de modo en
  Filler 2. Ninguna de las dos macros lo mira.
- **Las cuatro columnas sin identificar** de `DAT00000005..08` de Filler 2 hoy
  están en cero; hay que preguntar qué son antes de ignorarlas para siempre.
- **El archivo mensual de Filler 2 se guarda a mano y se dejó de guardar en
  julio.** Antes de reemplazar la macro conviene saber si ese informe se sigue
  usando o si ya nadie lo mira.

## Dónde está lo relevado

El código VBA extraído, los CSV de muestra y los tres archivos generados que
se usaron para medir quedaron fuera del repo, en el directorio temporal de la
sesión. Lo reproducible es esto: las rutas de arriba y
`python -m oletools.olevba` sobre el `.xlsm`.
