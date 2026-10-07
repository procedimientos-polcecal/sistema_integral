# Ensayos de calidad — la columna que cambió de escala sin avisar

Diseñado y construido el 6 de octubre de 2026. Es el tercer frente del módulo
Calidad, después del [stock de envases](CALIDAD-ENVASES.md) y el
[stock de carbonilla](CALIDAD.md). El diseño está en
[docs/superpowers/specs/2026-10-06-calidad-ensayos-design.md](superpowers/specs/2026-10-06-calidad-ensayos-design.md)
y el plan en
[docs/superpowers/plans/2026-10-06-calidad-ensayos.md](superpowers/plans/2026-10-06-calidad-ensayos.md).
Acá quedan las decisiones y las trampas que no se deducen del código.

## Qué reemplaza

`Determinaciones 2026.xlsx`, el archivo del laboratorio: nueve hojas, 623
muestras entre el 06/11/2023 y el 05/10/2026. Cuatro determinaciones —humedad,
peso volumétrico, cal útil vial y granulometría— sobre ocho productos.

**No es una copia más prolija de ese archivo**, y conviene saber por qué antes de
tocar cualquier cosa acá.

## Las cinco cosas que se midieron, y que decidieron el diseño

**1. La misma columna cambió de escala a mitad de archivo, y el encabezado no.**
`Ret #100 (%)` está guardada como fracción con formato `0.00%` hasta marzo de
2026 —`0,089`, que en pantalla dice 8,90%— y como número pelado desde junio
—`2,5`, que dice 2,5%—. Un promedio sobre los tres años mezcla valores que
difieren en 100×, y **la única señal de en qué escala está cada celda es el
formato**, que no es un dato: es una decoración.

**2. Hay 27 filas con las dos escalas en el mismo renglón.** De febrero a mayo de
2026 en `Filler 1`, `B` y `D` ya están en número pelado mientras `C` y `E` siguen
en fracción. En la fila 118 la cuenta cierra exacta —`0,14 + 4,23 + 16,68 =
21,05`, que es lo que dice `E`— y eso confirma que no es una lectura rara.

**3. El acumulado no cierra contra sus partes en 32 filas.** La más clara es
`Filler 1` fila 178 (07/09/2026): `0 + 3,4 + 19,5 = 22,9`, y la celda dice
`21,9`.

**4. "No se midió" está escrito de seis formas.** 162 celdas no son números: `-`,
`-%`, `#DIV/0!`, vacío y espacios.

**5. El peso volumétrico se calculó con dos recipientes.** Once fórmulas
multiplican por 3 —333,3 cc— y dos hacen `×1000/330`. Un 1% de diferencia
sistemática entre hojas, y en las otras ~600 filas el número está tipeado a mano.
**El real es 330 cc.**

## La decisión que sale de ahí: no se guarda ningún porcentaje

Se guardan los gramos, los ml y los centímetros cúbicos. La humedad, los
retenidos, los acumulados y el g/l **se despejan al leer**, en
`lib/calidad/ensayos/`.

**Una columna no puede tener dos escalas si no existe como columna**, y los 32
acumulados que no cerraban dejan de ser posibles porque el acumulado deja de ser
algo que alguien pueda tipear. Es la misma regla que el neto de la recepción de
carbonilla (`bruto − tara`) y la producción del turno.

La única excepción es `calidad_ensayos_limites`, que guarda números **en la
unidad de salida**: por ciento de 0 a 100, y g/l para el peso volumétrico. Es el
único lugar del módulo donde vive un porcentaje, y por eso no hay con qué
confundirlo.

| Determinación | Qué se tipea | Qué devuelve |
|---|---|---|
| Humedad | `P recipiente`, `P inicial`, `P final` | `(inicial − final) / (inicial − recipiente)`, en % |
| Peso volumétrico | gramos y **volumen del recipiente** | `gramos × 1000 / cc`, en g/l |
| Cal útil vial | ml de ácido y peso de muestra | `ml × 0,037 / peso`, en % |
| Granulometría | peso de muestra y los retenidos **en gramos** | retenido % y acumulado % por malla |

**El volumen del recipiente y el peso de la muestra titulada van guardados**, no
son constantes del código. Vienen propuestos en 330 cc y 3 g, que es lo que se
usa hoy; dejarlos fijos haría que el día que se titule sobre 5 g el número salga
mal en silencio. Es, además, la única forma de saber con qué recipiente se midió
cada muestra — cosa que del archivo viejo ya no se puede recuperar.

## Tres cosas se muestran en vez de recortarse

Humedad negativa, peso inicial que no supera al del recipiente, y retenidos que
superan el peso de la muestra. Las tres salen del archivo real —el `#DIV/0!` de
`Despacho a Kartonsec` fila 27 es exactamente la segunda— y las tres se muestran
con el aviso al lado.

Es la regla de la producción negativa en Producción: **recortar esconde justo lo
que hay que corregir.** Por eso `ValorEvaluado` tiene `valor` y `problema` a la
vez, y `problema` acompaña al valor en vez de reemplazarlo.

## Cuántos tamices muestra el listado (07/10/2026)

El listado tiene cuatro columnas de acumulado —**#50, #100, #200 y #325**— y
cuáles de ellas se llenan **lo decide el producto**:

| Mallas declaradas | Productos | Qué muestra |
|---|---|---|
| `[50, 100, 200, 325]` | Filler 1, Filler 2, Cal, Despacho a Emapi, Despacho a Kartonsec | las cuatro |
| `[6, 7, 10, 12, 20, 50, 100, 200]` | Calcio 0-1, 0-2, 1-2 | **sólo #200** |
| `[]` | los de grupo `proceso` | ninguna |

**Los Calcios tienen #50 y #100 medidos y aun así no se muestran.** Es a
propósito: su juego arranca en #6 y lo que interesa de un Calcio es cuánto quedó
retenido en total, no el reparto entre los tamices finos. Mostrarle cuatro
columnas sería dar a entender que esos cuatro números significan lo mismo que en
un Filler, y no es así: el acumulado a #200 de un Filler es la suma de tres
tamices, y el de un Calcio es la de ocho.

**La regla se deduce de las mallas declaradas y no de una lista de nombres.** Un
producto que se tamiza hasta #325 es un fino y muestra las cuatro; el resto
muestra una. Si mañana se le agrega la #325 a un Calcio, el listado le abre las
cuatro columnas solo, que es lo que corresponde — si alguien se tomó el trabajo
de tamizarlo a 325, el reparto fino pasó a ser la pregunta.

Dos detalles que están en los tests y conviene no romper:

- **Lo decide el producto, no la muestra.** A una muestra de Filler a la que le
  falte cargar la #325 se le siguen mostrando las cuatro columnas, con el hueco
  a la vista. Decidirlo por lo medido convertiría una muestra incompleta en otro
  producto.
- **Nunca cae a la malla de al lado.** Si a un Calcio le falta la #200, la
  columna queda vacía en vez de mostrar la #100. Un número en la columna que no
  es, es el error que no se nota — la misma regla que *enlazar al que se le
  parece*.

De paso, esto arregla algo que el listado no podía mostrar: antes sólo se veía
el acumulado de la última malla, así que **un desvío en el acumulado de #100 no
se veía**, aunque el contador de "fuera de límite" sí lo contara. Los límites ya
se evalúan malla por malla (`evaluarMuestra`), así que ahora cada columna marca
su propio rojo.

## La lista de productos no es el catálogo del núcleo

`productos` tiene las cosas físicas que se despachan. Acá *Filler 1* y *Filler 2*
son **el mismo material visto en dos líneas**, y *Despacho a Emapi* no es una
cosa: es un destino.

Enlazarlos sería la trampa contra la que avisa todo el sistema —*enlazar al que
se le parece es peor que dejar en null*— y el síntoma sería que el ensayo de una
línea aparece como el de la otra. **Eso no se nota nunca.**

`calidad_ensayos_productos` nace sembrada con los ocho de producción y diez de
proceso (caliza de galpón, arenas, chocolata, acopio, dolomitas), que en el Excel
se escribían con más nombres que materiales: `Caliza galpón` y `Caliza Galpones`,
`Arena caliza P3 limpia` y `Arena limpia`.

## Los límites nacen vacíos, y eso se ve

`calidad_ensayos_limites` arranca sin una fila. Mientras esté vacía **el sistema
no marca nada**, que es correcto y no es estar roto.

La diferencia está escrita en las dos pantallas, porque es la que se presta a
confusión: el listado dice *"sin límites cargados: nada se marca"* en vez de
*"0 fuera de límite"*, y la pantalla de límites dice, por producto, *"no tiene
límites cargados, así que ninguna muestra se va a marcar"*. Un listado sin nada
en rojo puede significar que todo salió bien o que nadie configuró nada, y esas
dos cosas no se parecen.

El retenido y el acumulado de la misma malla son **dos límites distintos**: un
retenido correcto en #200 con el acumulado alto es un problema de clasificación y
no de molienda.

## No hay planilla

Es el primer frente de Calidad sin espejo a Google Sheets. **El SdG es el único
lugar.** No hay `sheets_fila` ni `sheets_pendiente` en ninguna de las cuatro
tablas.

Conviene tenerlo presente porque el módulo ya tiene las otras dos direcciones
conviviendo —en envases manda la planilla, en carbonilla manda el sistema—, y un
tercer frente sin ninguna es justo el tipo de cosa que se supone mal al
retomarlo.

## Las trampas que quedaron escritas en el código

- **El único de los límites sin malla necesita un índice parcial.** En Postgres
  dos filas con `malla` nula no chocan entre sí, así que
  `unique (producto_id, determinacion, malla)` no protege a humedad, peso
  volumétrico ni cal útil vial. Y como **un índice parcial no sirve como destino
  de `ON CONFLICT`**, la ruta de límites hace `select` y después `insert` o
  `update`, nunca un upsert.
- **El alta de una muestra escribe dos tablas sin transacción.** PostgREST no da
  transacciones multi-sentencia, así que si el `insert` de retenidos falla, la
  ruta **borra la muestra recién creada**. Una muestra sin sus retenidos se lee
  como una granulometría que dio cero.
- **Los retenidos se reemplazan enteros al corregir**, no fila por fila: una
  malla vieja que quedara suelta corre todos los acumulados de ahí para abajo.
- **El `CHECK` de las mallas no existe.** Validar que sean enteros positivos
  necesita `unnest`, y un `CHECK` de Postgres no admite subconsultas. Lo valida
  `normalizarMallas()`, en la ruta.
- **No hay único por `(fecha, producto_id)`.** 28 de las 29 fechas repetidas de
  la hoja `Cal` son dos muestras del mismo día, de verdad. El precio está
  asumido: dos filas idénticas no se pueden frenar.

## Dónde está cada cosa

| | |
|---|---|
| Frente | `app/(app)/calidad/ensayos`, `lib/calidad/ensayos`, `app/api/calidad/ensayos` |
| Las tres cuentas de una línea | `lib/calidad/ensayos/determinaciones.ts` |
| Retenidos y acumulados | `lib/calidad/ensayos/granulometria.ts` |
| Límites y la muestra evaluada | `lib/calidad/ensayos/limites.ts` — `evaluarMuestra` |
| Validación de lo que llega | `lib/calidad/ensayos/cuerpoDeLaMuestra.ts` |
| El juego de tamices | `lib/calidad/ensayos/mallas.ts` |
| Las lecturas | `lib/calidad/ensayos/consultas.ts`, todas con `traerTodo()` |
| El formulario, compartido | `app/(app)/calidad/ensayos/FormularioDeMuestra.tsx` |
| Pantallas | `/calidad/ensayos` (listado), `/nueva` (carga), `/[id]` (detalle), `/productos` y `/limites` (admin) |
| Migración | `20261006110617_calidad_ensayos.sql` |

Las cuatro determinaciones se calculan **con las mismas funciones puras en el
servidor y en el cliente**: el listado las corre una vez en el Server Component,
y el formulario las corre mientras se tipea. Son puras, así que no hay dos
criterios de "fuera de límite" — quien carga ve el 0,91% al poner el tercer peso
y se da cuenta en el momento si se equivocó de columna.

## Lo que queda afuera a propósito

- **`Separadoras`** y **`Despachos cal fillerizada`**, las dos hojas que no son
  muestras de un producto. La segunda —cliente, toneladas de cal y de filler, y
  el porcentaje de la mezcla— se parece mucho más a las órdenes de carga de
  Despacho.
- **Los tres años de historia.** La pestaña arranca vacía. Las 1.064 celdas de
  333 filas anteriores a junio de 2026 están en la escala vieja y 27 de esas
  filas tienen las dos escalas en el mismo renglón, así que importarlas necesita
  una regla por época — y cualquier regla sería una interpretación de qué quiso
  decir cada número. Un histórico mal escalado es peor que no tenerlo: se grafica
  igual.
- **Los promedios como fila guardada.** `Calcio` tiene seis filas que son
  `=AVERAGE(...)` metidas entre las muestras. Acá el promedio se calcula al leer.
- **Certificados de calidad al cliente**, firma o aprobación del ensayo.

## Lo que falta de una persona

1. **Correr la migración** `20261006110617_calidad_ensayos.sql`.
2. **Cerrar los nombres de los diez productos de proceso**, que la migración
   siembra con los que salieron del Excel.
3. **Confirmar el juego de mallas de cada producto.** Los de proceso nacen sin
   ninguno, y la pantalla lo dice (*"sin juego habitual"*).
4. **Cargar los límites.** Hasta entonces nada se marca, y las dos pantallas lo
   dicen.
