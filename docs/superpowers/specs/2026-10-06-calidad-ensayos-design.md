# Ensayos de calidad: la columna que cambió de escala sin avisar

Acordado el 6 de octubre de 2026. Es el tercer frente del módulo Calidad; los
dos primeros fueron el
[stock de envases](2026-09-15-produccion-envases-design.md) y el
[stock de carbonilla](2026-09-16-calidad-stock-de-carbonilla-design.md).

Reemplaza un archivo: `Determinaciones 2026.xlsx`, nueve hojas, tres años de
muestras. Lo que sigue se midió sobre ese archivo antes de decidir nada, porque
es lo que explica por qué no alcanza con copiarlo más prolijo.

## Lo que se midió (06/10/2026)

Cinco de las nueve hojas son tablas de verdad, con la misma forma:

| Hoja | Filas con fecha | Rango | Qué es la muestra |
|---|---|---|---|
| `Filler 1` | 189 | 14/11/2023 → 30/09/2026 | La línea 1 |
| `Filler 2` | 156 | 14/11/2023 → 30/09/2026 | La línea 2 |
| `Cal` | 206 | 06/11/2023 → 30/09/2026 | La cal, más **cal útil vial** |
| `Despacho a Kartonsec` | 44 | 02/06 → 28/09/2026 | Lo que sale para ese cliente |
| `Despacho a Emapi` | 28 | 02/06 → 28/09/2026 | Ídem |

Las otras cuatro no son tablas: `Calcio` tiene una tabla de humedad a la
izquierda y **once bloques de granulometría pegados a la derecha**, hasta la
columna `AB`; `Separadoras` y `Otros` son bloques sueltos donde entró lo que no
tenía dónde ir; `Despachos cal fillerizada` no tiene determinaciones, tiene
toneladas y clientes.

### Los cinco problemas que no se arreglan copiando

**1. La misma columna cambió de escala a mitad de archivo, y el encabezado no.**
`Ret #100 (%)` está guardada como fracción con formato `0.00%` hasta marzo de
2026 (`0,089`, que en pantalla dice 8,90%) y como número pelado desde junio
(`2,5`, que dice 2,5%). Un promedio o un gráfico sobre los tres años mezcla
valores que difieren en 100×. La única señal de en qué escala está cada celda es
**el formato de la celda**, que no es un dato: es una decoración.

**2. Hay 27 filas con las dos escalas en el mismo renglón.** De febrero a mayo de
2026, en `Filler 1`, `B` y `D` ya están en número pelado mientras `C` y `E`
siguen en fracción. En la fila 118 la cuenta cierra exacta —`0,14 + 4,23 + 16,68
= 21,05`, que es lo que dice `E`— y eso confirma que no es una lectura rara: es
una fila con dos unidades.

**3. El acumulado no se controla contra sus partes.** Debería ser la suma de lo
retenido hasta esa malla. No cierra en **32 filas**: 27 por lo anterior, y cinco
que son errores de tipeo sueltos. La más clara es `Filler 1` fila 178
(07/09/2026): `0 + 3,4 + 19,5 = 22,9`, y la celda dice `21,9`.

**4. "No se midió" está escrito de seis formas.** 162 celdas de las cinco hojas
no son números: `-`, `-%`, `#DIV/0!`, vacío, y espacios. El `#DIV/0!` de
`Despacho a Kartonsec` fila 27 es una humedad cuyo peso inicial era igual al del
recipiente.

**5. El mismo peso volumétrico se calculó con dos recipientes.** Once fórmulas
multiplican por 3 —un recipiente de 333,3 cc— y dos hacen `×1000/330`. Es un 1%
de diferencia sistemática entre hojas, y las otras ~600 filas tienen el número
tipeado a mano, así que no hay cómo saber con cuál se calculó. **El recipiente
real es de 330 cc**; las fórmulas `×3` estaban mal.

Y una que no es un error sino una señal: **`Calcio` usó seis juegos de tamices
distintos en diez semanas** (`4,7,10,12,18,20,50,60,100,200` el 31/07;
`4,6,10,12,18,20,50,100,200,325` el 28/08; `6,7,10,12,20,50,100,200` el 18/09…).
Cada juego nuevo abrió un bloque de columnas nuevo, porque la hoja no tenía dónde
poner un tamiz que no estuviera previsto.

## Las cuatro decisiones

**Una muestra se identifica por producto y fecha.** La lista es de ocho:
*Filler 1, Filler 2, Cal, Calcio 0-1, Calcio 0-2, Calcio 1-2, Despacho a Emapi,
Despacho a Kartonsec*. Lo que hoy parte las hojas por otro criterio —retorno,
producción, ingreso a separadora, rechazo, silo 3, silo 4, *"9 hs"*— **es una
observación de la muestra, no una dimensión**. `Separadoras` queda afuera.

**La lista de tamices es variable.** Una granulometría es un conjunto de pares
*(malla, retenido)*, con un juego habitual por producto que la pantalla propone
ya puesto. Es lo que el Excel hace de hecho; lo que cambia es que agregar un
tamiz deja de abrir una columna.

**Se tipean los gramos.** En `Calcio` el retenido se anota en gramos sobre una
muestra de 20 g y el porcentaje sale de `=K4/20`; en las hojas de filler se
tipea el porcentaje ya convertido a mano. De acá en más, gramos y peso de la
muestra — así una muestra tamizada sobre 50 g sigue dando el porcentaje bien.

**Ningún porcentaje se guarda.** Ni la humedad, ni los retenidos, ni los
acumulados, ni el g/l. Se guarda lo que dicen la balanza y la bureta, y el resto
se despeja al leer. Es la misma regla que el neto de la recepción de carbonilla
y la producción del turno, y acá es además la corrección directa del problema 1:
**una columna no puede tener dos escalas si no existe como columna.**

## Qué guarda el SdG

### `calidad_ensayos_productos`

La lista de lo que se muestrea. No es el catálogo del núcleo y eso es deliberado.

| Campo | Por qué |
|---|---|
| `nombre`, `orden`, `activo` | La lista que ve quien carga |
| `grupo` | `produccion` para los ocho; `proceso` para los otros |
| `mallas` (`int[]`) | El juego habitual de tamices que la pantalla propone |

**Por qué no apunta a `productos`.** El catálogo del núcleo tiene las cosas
físicas que se despachan. *Filler 1* y *Filler 2* son el mismo material visto en
dos líneas, y *Despacho a Emapi* no es una cosa física: es un destino. Enlazar
cualquiera de los dos a un producto del catálogo sería la trampa contra la que
avisa todo el sistema —*enlazar al que se le parece es peor que dejar en null*—,
y acá el síntoma sería que el ensayo de una línea aparece como ensayo de la otra.
Nadie lo notaría nunca.

El grupo `proceso` es para lo que hoy vive en `Otros` y en la mitad izquierda de
`Calcio`: caliza de galpón, arena de dolomita P1, arena de caliza P3 (limpia y
descarte), acopio, chocolata de galpón, chocolata 0-2, dolomita 0-2, dolomita
6-20 P1. Diez materiales escritos con más nombres que materiales —`Caliza
galpón` y `Caliza Galpones`, `Arena caliza P3 limpia` y `Arena limpia`—, que es
exactamente lo que una lista cerrada deja de producir.

### `calidad_ensayos_muestras`

Una fila por muestra. Las cuatro determinaciones son columnas de la misma fila y
**todas son opcionales**, porque en el archivo hay muestras que son sólo humedad
y otras sólo granulometría.

| Campo | Qué es |
|---|---|
| `fecha`, `producto_id` | La identidad |
| `observaciones` | Texto libre: *retorno*, *producción*, *silo 3*, *600 Hz 4 agujeros*, *9 hs* |
| `humedad_p_recipiente`, `humedad_p_inicial`, `humedad_p_final` | Los tres pesos |
| `peso_vol_gramos`, `peso_vol_volumen_cc` | El recipiente se guarda: hoy 330, pero queda dicho cuál se usó |
| `cal_util_ml_acido`, `cal_util_peso_muestra_g` | Los ml de la titulación y el peso |
| `granulometria_peso_muestra_g` | El peso sobre el que se tamizó |
| `cargado_por` / `cargado_en` / `actualizado_por` / `actualizado_en` | Transcribir se equivoca |

**No hay índice único por `(fecha, producto_id)`.** Las 29 fechas repetidas de
`Cal`, las 4 de `Filler 2` y las 4 de Kartonsec son muestras de verdad: dos del
mismo día. El precio está escrito abajo, en riesgos.

**Las cuatro determinaciones son columnas y no filas de una tabla genérica.** Una
tabla `(muestra, tipo, valor1, valor2, valor3)` aceptaría una quinta
determinación sin migrar, pero a cambio nada ataría `ml_acido` a la cal útil
vial, cada lectura sería un pivot, y las funciones puras —que es donde este repo
pone lo que importa— perderían los tipos. Con cuatro columnas, agregar una quinta
determinación es una migración de una línea y el compilador dice dónde falta.

### `calidad_ensayos_retenidos`

Una fila por tamiz de una muestra: `muestra_id`, `malla` (int), `retenido_g`.
Único por `(muestra_id, malla)`.

El orden no se guarda: **se ordena por malla**, que es el orden físico del juego
de tamices. Guardar un orden aparte sería otro campo que puede quedar viejo.

### `calidad_ensayos_limites`

Mínimo, máximo o los dos. **Nace vacía.**

| Campo | Por qué |
|---|---|
| `producto_id` | El límite es del producto |
| `determinacion` | `humedad`, `peso_volumetrico`, `cal_util_vial`, `retenido`, `acumulado` |
| `malla` | Sólo para `retenido` y `acumulado`; `null` en las otras tres |
| `minimo`, `maximo` | Los dos opcionales: hay determinaciones con techo y sin piso |

**Las unidades de esta tabla, dichas una vez:** porcentaje como número de 0 a 100
para humedad, cal útil vial, retenido y acumulado; g/l para el peso volumétrico.
Es el único lugar del módulo donde se guarda un porcentaje, y por eso no hay con
qué confundirlo.

## Los cálculos

En `lib/calidad/ensayos/`, funciones puras con tests.

| | |
|---|---|
| `humedad` | `(inicial − final) / (inicial − recipiente)` |
| `pesoVolumetrico` | `gramos × 1000 / volumen_cc` |
| `calUtilVial` | `ml × 0,037 / peso_muestra` |
| `granulometria` | Retenido % por malla, y el acumulado de cada una |

El **acumulado** de una malla es la suma de todo lo retenido hasta ella
inclusive, de mayor a menor abertura. Comprobado contra el archivo: `Filler 1`
fila 150 da `0 + 2,5 + 16,6 = 19,1`, y el acumulado a #325 es `19,1 + 18,8 =
37,9`. Los dos exactos. **Las 32 filas donde hoy no cierra dejan de ser
posibles**, porque el acumulado deja de ser algo que alguien pueda tipear.

La cal útil vial queda `ml × 0,037 / peso`, con el peso cargado y propuesto en
3 g. Las tres filas que existen se titularon sobre 3 g, pero dejarlo como
constante escondida haría que el día que se titule sobre 5 g el número salga mal
en silencio. En el archivo esa columna tiene `57,5`, `60,4` y una fórmula que da
`0,5057` con formato `0%` —o sea 51%—: la misma enfermedad de las dos escalas, en
una columna de tres datos.

### Los casos feos salen del archivo, no de la imaginación

Los tres **se muestran, no se recortan ni se bloquean**. Es la regla de la
producción negativa en Producción: recortar esconde justo lo que hay que
corregir.

- `p_inicial = p_recipiente` — el `#DIV/0!` real de Kartonsec fila 27.
- `p_final > p_inicial` — la muestra "ganó" peso: error de tipeo o de balanza.
- La suma de retenidos supera el peso de la muestra.

## Los límites, y por qué nacen vacíos

Hoy el Excel no tiene ninguno. La fila 184 de `Filler 1` (15/09/2026) marca
`Ret #100 = 15,3%` cuando las cincuenta filas que la rodean están entre 1,1 y
5,4 —cinco veces el valor habitual— y está escrita igual que todas las demás, en
negro, sin una nota.

La tabla existe desde el primer día y el módulo ya la usa; mientras esté vacía
**el sistema no dice nada**. Cuando calidad cargue un valor, la muestra fuera de
límite se ve en rojo en el listado y el encabezado dice cuántas hubo en el
período. Es lo mismo que hizo Producción con los renglones del parte: no hay que
migrar ni volver a tocar pantallas el día que se decidan los valores.

## Las pantallas

Un tercer subgrupo **Ensayos** en el menú de Calidad, al lado de Carbonilla y
Envases. **Las cinco son responsive**: la carga se hace tanto desde la PC del
laboratorio como desde un teléfono parado al lado de la balanza, y la
granulometría son diez renglones de números — en el teléfono eso es una lista de
filas, no una tabla que se sale de la pantalla.

| | |
|---|---|
| `/calidad/ensayos` | El listado. Filtro por producto y por fechas; una fila por muestra, los valores calculados, lo que está fuera de límite en rojo |
| `/calidad/ensayos/nueva` | La carga. Al elegir el producto, la granulometría viene con sus mallas habituales puestas; se agrega o se saca una sin tocar configuración |
| `/calidad/ensayos/[id]` | Ver y corregir, con quién la cargó y quién la modificó |
| `/calidad/ensayos/productos` | La lista y el juego habitual de mallas de cada uno (sólo admin) |
| `/calidad/ensayos/limites` | Los límites (sólo admin) |

Los desplegables van con `components/Select.tsx`, no con `<select>` nativo: la
lista de productos arranca en dieciocho y crece.

## No hay planilla

**El SdG es el único lugar.** El Excel es un archivo del laboratorio y nadie
fuera de calidad lo abre, así que esta mitad del módulo no espeja a Sheets — ni
en la dirección de Envases, donde manda la planilla, ni en la de carbonilla,
donde manda el sistema. No hay `sheets_fila` ni `sheets_pendiente` en ninguna de
las cuatro tablas.

Conviene que quede escrito porque el módulo Calidad ya tiene las dos direcciones
conviviendo, y un tercer frente sin ninguna es justo el tipo de cosa que se
supone mal al retomarlo.

## Qué se testea

Vitest sobre las funciones puras, con los casos tomados del archivo real:

- `humedad`: el caso normal, `inicial = recipiente`, y `final > inicial`.
- `pesoVolumetrico`: `299,668 g` en 330 cc → `908,08 g/l`, que es la fila 19 de
  Kartonsec, la única donde la fórmula quedó escrita.
- `calUtilVial`: 41 ml sobre 3 g → 50,57%.
- `granulometria`: la fila 150 de `Filler 1` completa, con sus dos acumulados; y
  la suma de retenidos mayor al peso de la muestra.
- `fueraDeLimite`: dentro, fuera por arriba, fuera por abajo, y **sin límite
  cargado**, que es el estado en el que nace el módulo y tiene que ser silencioso.

Las pantallas y las rutas no tienen tests, como en todo el repo; la lógica que
importa vive en `lib/` para poder probarla.

## Las migraciones

**Un solo archivo**: los dos tipos nuevos
(`calidad_ensayos_grupo` y `calidad_ensayos_determinacion`), las cuatro tablas,
sus índices, y RLS con `tiene_acceso_calidad()` / `puede_editar_calidad()` /
`es_admin_calidad()`, que ya existen. Los límites y la lista de productos, sólo
admin.

**No van en archivos separados**, aunque la regla del repo hable de enums que
viajan solos: el `55P04` es sólo para **agregar un valor a un enum que ya
existe**, y estos dos se crean enteros. Es lo que ya dice el encabezado de
`20260916090409_calidad_schema.sql`, que creó sus tres tipos en el mismo
archivo. El que sí viajó solo fue el valor `'calidad'` del enum `modulo`, y ése
ya está corrido.

Las corre una persona a mano en el editor SQL de Supabase. Hasta que se corran,
el módulo no tiene dónde escribir.

## Lo que queda afuera a propósito

- **`Separadoras`.** Son bloques de comparación entre separadora 1 y 2, retorno e
  ingreso; no son muestras de un producto y no entran en este modelo.
- **`Despachos cal fillerizada`.** 40 filas con cliente, toneladas de cal, de
  filler y el porcentaje de la mezcla. No es un ensayo: es la composición de lo
  que salió, y se parece mucho más a las órdenes de carga de Despacho. Si algún
  día entra, entra como pantalla propia — mezclarla con las muestras es
  literalmente lo que hizo que `Calcio` terminara con once bloques a la derecha.
- **Los tres años de historia.** La pestaña arranca vacía. Importar se puede
  —con la misma forma que los otros importadores del repo—, pero las **1.064
  celdas de 333 filas** anteriores a junio de 2026 están en la escala vieja, y 27
  de esas filas tienen las dos escalas en el mismo renglón, así que la importación necesita una regla por época. Cualquier
  regla sería **una interpretación mía de qué quiso decir cada número**, y un
  histórico mal escalado es peor que no tenerlo: se grafica igual.
- **Los promedios como fila guardada.** `Calcio` tiene seis filas que son
  `=AVERAGE(...)` metidas entre las muestras, así que la tabla tiene renglones
  que no son muestras. Acá el promedio se calcula al leer.
- **Certificados de calidad al cliente**, firma o aprobación del ensayo. No
  existen hoy en papel; agregarlos es otro spec.

## Lo que falta de una persona

1. **Correr las dos migraciones.**
2. **Cerrar la lista de productos de proceso** — los diez de `Otros` y `Calcio`,
   con un nombre cada uno.
3. **Confirmar el juego habitual de mallas de cada producto.** Para los ocho sale
   del archivo; para los de proceso hay seis juegos distintos en diez semanas y
   lo decide calidad.
4. **Cargar los límites**, cuando estén decididos. Hasta entonces el módulo no
   avisa nada, y eso es visible: la pantalla de límites está vacía, no
   silenciosa.

## Riesgos asumidos

- **Dos muestras idénticas del mismo producto el mismo día no se pueden frenar.**
  Las filas 195 y 196 de `Cal` son idénticas y probablemente sean una sola
  cargada dos veces, pero las otras 28 fechas repetidas son muestras de verdad.
  Un único por `(fecha, producto)` rompería el caso bueno para atrapar el malo.
- **El histórico queda en el Excel.** Durante un tiempo va a haber dos lugares
  donde mirar: el archivo para lo viejo y el SdG para lo nuevo. Es el precio de
  no inventar una escala para 900 celdas.
- **Un valor absurdo entra igual** mientras no haya límites cargados. El sistema
  avisa de lo imposible —división por cero, peso negativo, retenidos que superan
  la muestra— pero no de lo improbable. El `Ret #100 = 15,3%` de la fila 184
  entraría sin una palabra, igual que hoy.
