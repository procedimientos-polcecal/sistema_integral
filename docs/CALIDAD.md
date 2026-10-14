# Carbonilla — el stock deja de ser una transcripción

Diseñado y construido el 15 y 16 de septiembre de 2026, y **dado vuelta el
13/10/2026**: nació con Odoo como fuente y hoy la fuente es la planilla. Lo que
sigue abajo conserva las dos capas a propósito — el porqué del cambio no se
entiende sin lo que había antes.

El diseño original está en
[el spec](superpowers/specs/2026-09-16-calidad-stock-de-carbonilla-design.md) y
el paso a paso en
[el plan](superpowers/plans/2026-09-16-calidad-stock-de-carbonilla.md); la
inversión, en
[el spec del 13/10](superpowers/specs/2026-10-13-calidad-la-planilla-manda-design.md).
Acá quedan las decisiones y las trampas que no se deducen del código.

## La planilla manda, y Odoo controla

**Esto se dio vuelta el 13/10/2026.** El diseño original tenía a Odoo como fuente
de las entradas y a la planilla como espejo de salida. El problema no era de
código: **necesitaba que alguien cambiara de costumbre**. Calidad siguió
descargando los consumos en la planilla, como siempre, y el SdG —que sólo
escuchaba a Odoo— se quedó sin ver 925 toneladas de consumo y once camiones. Las
cantidades estaban mal **y nada avisaba**, que es lo peor de las dos cosas.

Ahora el libro entero —entradas y salidas— sale de la planilla, igual que en
[Envases](CALIDAD-ENVASES.md): la lee `lib/calidad/desdeLaPlanilla.ts`, una vez
por día y con el botón. Odoo pasó a **controlar**, no a crear: dice qué camión
entró sin orden de compra, que es plata que después no se puede facturar. Eso se
mira en `/calidad/conciliacion` y se calcula al abrir — es una vista, no un
estado.

### El ancla es el id del movimiento, en la columna `K`

Lo que evita el lazo —que la lectura vuelva a importar una fila que el SdG mismo
escribió— es **el id del movimiento, escrito en la columna `K` de la planilla**.
Al leer una fila y crear su movimiento, el SdG le pone ahí su id; en la corrida
siguiente esa fila ya no es nueva porque lleva su marca, esté en el número de
fila que esté.

**Empezó siendo `sheets_fila` y eso estaba mal.** Lo apoyé en una medición que
también estaba mal —una consulta sin `traerTodo()`, PostgREST cortando en 1.000
de 1.122 sin avisar, y el tramo que quedó afuera era justo donde estaba el
problema—. El número real eran **30 filas desalineadas**, por dos costumbres
distintas y las dos normales: tres filas insertadas en el medio para poner un
camión olvidado en su lugar cronológico, y cinco consumos editados después de
escritos. Una clave por número de fila se rompe con lo primero, una por contenido
con lo segundo.

`sheets_fila` sigue existiendo, pero ya no es la clave: es **dónde está hoy esa
fila**, y se refresca en cada corrida. La comparación de contenido tampoco se
fue: cambió de significado, de *"es la misma fila"* a *"a esta fila conocida le
cambiaron el número"*, que es un aviso y no una adivinanza.

Dos modos de falla nuevos, los dos informados y ninguno resuelto solo: **copiar y
pegar una fila duplica su id** (las dos van a la bandeja y no se toca ninguna), y
**borrar un movimiento deja el id huérfano allá** (esa fila no se relee: volvería
a entrar con otro id y el camión quedaría dos veces; para que entre hay que
borrar la celda `K`).

### Dos permisos que no se deducen de ningún lado

La pestaña `Entradas  Salidas` está protegida con el rango `ACTUALIZACIÓN DE
STOCK`, que cubre la hoja entera. **Tener permiso de edición sobre el documento
no alcanza**: la protección lo pisa, y la cuenta de servicio tiene que estar
entre sus editores. Hasta el 14/10/2026 no lo estaba, y **la mitad escritora del
espejo nunca había escrito nada** sin que se notara: los 1.128 movimientos
habían entrado por el script de importación, por el cron de Odoo o por la
lectura, y ninguno de los tres escribe. Por eso `sheets_pendiente` estaba en 0 en
las 1.128 filas, que leído de apuro parece *"ninguna escritura falló"* y en
realidad era *"ninguna escritura ocurrió"*.

Y la columna `K` **no existía**, no es que estuviera vacía: la pestaña tenía diez
columnas de verdad, y escribir afuera de la grilla hace que Google rechace el
`batchUpdate` entero con `exceeds grid limits`. Ensancharla también la frena la
protección. `asegurarColumnas()` de `lib/core/sheets.ts` deja el diagnóstico
escrito; agregarla la tiene que hacer una persona.

## Qué reemplaza

La planilla de **stock de carbonilla** (`1m9DwAcP…`), donde Calidad transcribía
a mano lo que Despacho ya había transcrito a la planilla de recepción y que ya
estaba en Odoo. **Dos transcripciones para el mismo camión**, y la segunda era la
que mandaba el stock de la fábrica.

Lo que se sacó es la segunda: la entrada la pone el sistema y Calidad se queda
con lo que es suyo — el consumo del día, el conteo físico y el ajuste.

Cuánto costaba esa transcripción, medido: de 575 camiones apareados contra Odoo,
**60 llevaban un número distinto**. La mediana del desvío era 0 y el p90 veinte
kilos, pero hay saltos de toneladas enteras con forma de **corrimiento**: el
25/11 la planilla dice 20,16 y Odoo 16,86; el 26/11 la planilla dice **16,86** y
Odoo 13,74; el 28/11 la planilla dice **13,74**. Venía un camión atrasada, tres
días seguidos. Y el 04/09/2026 un Bruzzone de 19,58 está **dos veces**.

## El signo va guardado, no despejado

`calidad_movimientos.toneladas` es **siempre el efecto sobre el saldo**: entrada
`+`, consumo `−`, ajuste `±`. Con eso el saldo es `SUM(toneladas)` y no hay
consulta que pueda calcularlo mal.

La alternativa —guardar todo positivo y aplicar el signo al leer— pone la regla
en cada consulta, y la consulta que se olvida es la que nadie mira. Lo que sí es
función pura y testeada es la traducción al revés: `efectoEnElSaldo()` convierte
*"consumo de 37"* en `−37`, y los `CHECK` de la base dicen exactamente lo mismo.
**Si uno cambia, el otro también.**

## `sin_separar` es historia, no saldo

El libro viejo no distinguía vegetal de residual hasta el 15/12/2025. Los 385
movimientos anteriores se importaron con `carbon = 'sin_separar'`, y **no caen en
ninguna suma de saldo** — no porque alguien se acuerde de excluirlos, sino porque
no son ninguno de los dos tipos que se suman.

Marcarlos vegetal habría sido inventar: en esa época Membranex entró más de
veinte veces con carbón residual y hubo 82 consumos residuales desde el 13/10.

**El corte es el 16/12 y no el 15, y eso no es un detalle.** El corte real no es
una fecha sino **una fila**: el saldo por tipo aparece por primera vez en la fila
386 de la planilla —`VEGETAL` 208, `RESIDUAL` 169— y es el saldo *después* de esa
entrada. Las filas 385 y 386 son las dos del 15/12, así que cortar en el 15 las
deja del lado nuevo, donde el saldo inicial ya las contó, y el mismo camión entra
dos veces. Lo encontró correr la importación en seco: el saldo daba −230,48 t de
vegetal contra los 260,34 que mostraba la planilla.

`CORTE_DE_LOS_TIPOS` en `lib/calidad/movimientos.ts` y el `CHECK`
`calidad_mov_sin_separar` (migración `20260916101523`) son espejo uno del otro.

## El `TOTAL` de la planilla está 0,450 t arriba, y así se queda

La planilla no cuadra consigo misma: su columna `TOTAL` es 0,450 t más alta que
`VEGETAL + RESIDUAL`. **No es un error del SdG ni hay nada que arreglar**, y
conviene saberlo antes de salir a buscarlo, porque la diferencia aparece cada
vez que alguien compara los dos sistemas por el total.

Nace en un solo lugar, medido sobre las 3.399 filas: la fila 386, la misma del
corte. Ahí el `TOTAL` venía en 377,450 y el saldo por tipo se escribió a mano en
números redondos —`VEGETAL` 208, `RESIDUAL` 169—, que suman 377. Los 450 kg que
sobraban no se asignaron a ningún tipo, y esa diferencia viene viajando desde
entonces sin un solo salto más.

**Mandan las cantidades por tipo, no el total.** El SdG coincide **exacto** con
`VEGETAL` y con `RESIDUAL` de la última fila; lo que no coincide es un total que
hace diez meses dejó de ser la suma de sus partes y se fue acomodando a mano.
Pasarle los 450 kg a vegetal para emparejar el total rompería justamente lo que
sí está bien.

Y por eso `Saldos.total` es **despejado y no guardado**: es `vegetal + residual`
y no puede no serlo. Un total guardado aparte es exactamente lo que pasó allá —
una tercera columna que deriva de las otras dos hasta que alguien la pisa, y
después nadie sabe cuál de las tres tiene razón.

## El carbonillero se identifica por el partner de Odoo

`calidad_carbonilleros` tiene clave `(odoo_partner_id, empresa_id)` y el
`proveedor_id` del núcleo es **opcional**.

No es rehacer el catálogo del núcleo desde un módulo: la tabla no guarda razón
social, CUIT ni domicilio — guarda el tipo de carbón y el nombre de planilla, que
son configuración de Calidad. Se identifica por lo que el dato realmente trae: la
línea de compra llega con un `partner_id`.

Exigir que el carbonillero exista primero en `proveedores` **con CUIT cargado y
vinculado** pondría entre el camión y el stock una tarea administrativa que hace
un mes no se hace: al 16/09/2026, seis de los diez carbonilleros con rubro
`CARBONILLA` no tienen CUIT, y `LA INVENCIBLE` —que trajo cinco camiones en
septiembre— no existe en el catálogo. Eso ya tiene parada la recepción de
Despacho.

La deuda **queda a la vista** en la columna *"En el núcleo"* de
`/calidad/carbonilleros`. Decía `falta` en nueve de trece; el 02/10/2026 se
cargaron cinco CUIT leídos del `vat` del propio partner de Odoo y el enganche
quedó hecho en nueve de trece (ver [DESPACHO.md](DESPACHO.md)). Los cuatro que
siguen sueltos son **Sosa** —cuyo CUIT no está en ningún lado, tampoco en
Odoo—, el registro viejo de Membranex (partner 2139) y **El Invencible,
Santucho y Corralón Rojas**, que no existen en el catálogo del núcleo. El stock funciona
igual; lo que no funciona sin ese enganche es cruzar ese carbón con Compras y con
Facturación.

## El tipo de carbón sale del proveedor y nunca del producto

Se midió: Membranex —el único residual— factura con `Carbonilla de coque` 58
veces, con `CARBON RESIDUAL` 4 y con `CARBONILLA ` **6**, que es el mismo
producto que usan todos los vegetales. Deducirlo del producto pondría carbón
residual en el saldo vegetal seis veces por año, sin que nada avise.

Es el único dato del módulo que no se puede deducir de ningún lado: se declara
una vez por carbonillero.

## La lista blanca de productos, por id

Estar en `calidad_productos_odoo` con `cuenta = true` es lo que hace que una
línea entre al stock. `cuenta = false` no es lo mismo que no estar: es *"ya lo
miré, es flete, no me lo muestres más en la bandeja"*.

**Se elige por id y nunca por nombre.** En esta base conviven `CARBONILLA` (6909)
y `CARBONILLA ` (4419) —con un espacio al final—, los dos buenos, con 947 líneas
entre ambos. Por eso la pantalla muestra el nombre entre comillas y el id al
lado en todas las filas.

Dos cosas que sorprenden al mirar esa tabla:

- **Siete de los diez productos están archivados en Odoo**, y hay que pedirlos
  con `active_test: false` o no vienen —el primer intento de cargarlos trajo 3 de
  10—. Sólo importan para la historia: hoy toda la carbonilla entra con
  `CARBONILLA` (6909) y `CARBON RESIDUAL` (7111).
- **`FLETE` (6954) existe y la medición original no podía verlo.** LA INVENCIBLE
  le agrega una línea de flete a todas sus órdenes —seis en treinta días— y el
  filtro de la medición era `product_id.name ilike 'carbon'`. Sin la lista
  blanca, seis fletes por mes se habrían sumado al stock como toneladas de
  carbón, y no se notaría hasta el conteo.

## La ventana de la sincronización va por `create_date`

Y no por `date_order`. Se midió: 1.053 de 1.055 órdenes del año se cargan el
mismo día, pero el máximo son 3 días — y el 16/09/2026 Odoo llevaba **once días
sin cargar**. Una orden fechada el 05/09 y cargada el 20/09 **la ventana de
`date_order` no la ve nunca**: se la pasa por atrás mientras el cron avanza.

El margen son 30 días fijos contra hoy, y no contra la última corrida: una
corrida que se saltó no abre un hueco.

## `odoo_purchase_line_id`, que ya no evita lo que evitaba

**Esto era, hasta el 13/10/2026, lo único que frenaba los duplicados.** Una
entrada llegaba por dos caminos —la sincronización con Odoo y la recepción de
Despacho— y los dos guardaban el id de la línea de la orden de compra; el índice
`UNIQUE` frenaba al segundo. Sigue estando y sigue sirviendo, pero ahora Odoo no
crea nada, así que el camino que podía chocar es uno solo.

Lo que evita el lazo hoy es **el id del movimiento en la columna `K`**, y lo que
aparea un camión con su orden para el control es `desviosContraOdoo`, que exige
**el mismo partner** — aparear por fecha y cantidad entre proveedores distintos
es justamente el cruce difuso que este módulo existe para eliminar.

Es **la línea y no la orden**: 7 de las 577 órdenes de carbonilla del año tienen
dos líneas —la segunda es `FLETE`—, así que la orden no identifica un camión y la
línea sí.

Y es `UNIQUE` **completo, no parcial**: es el destino de un `ON CONFLICT`, y un
índice parcial ahí no sirve. Los `NULL` de los consumos y los ajustes no chocan
entre sí.

Eso reemplaza al cruce por fecha, proveedor y cantidad — que es justo el cruce
que en la planilla vieja se corrió un camión tres días seguidos.

## El espejo pisa las fórmulas de la planilla, a propósito

Es una excepción deliberada a *"pisar una fórmula la convierte en dato muerto"*,
con tres razones medidas:

1. La fórmula de `RESIDUAL` está **cableada al código `00010`** (Membranex), así
   que un segundo proveedor residual lo contaría como vegetal.
2. **No puede representar un ajuste en más**: suma sólo por la columna `ENTRADAS`
   y sólo con un código de proveedor. Por eso el 02/05/2026 alguien pisó la celda
   del saldo a mano.
3. Acá manda el sistema. Dejar la fórmula viva sería sostener dos saldos que
   discrepan.

**Nada se manda como texto.** La escritura va con `USER_ENTERED`: un `"19,58"` lo
interpreta la planilla según su locale, que es la misma trampa que leyendo m/d en
vez de d/m dio vuelta 885 fechas en Compras. La fecha va como **serial**
(`serialDelDia()`) y las toneladas como **número**. Para eso se ensanchó
`escribirCeldas()` de `lib/core/sheets.ts` a `string | number`.

**La columna que manda para `agregarFila` es la `A` y no la `B`.** La `B` tiene
un `VLOOKUP` precargado cientos de filas más abajo de lo cargado, así que por ahí
la "última fila con algo" sale muy pasada y la escritura dejaría un hueco enorme
en el medio del libro.

Y una divergencia que existe y es **conocida y visible**: corregir un movimiento
viejo mueve el saldo de todo lo que vino después, y la planilla lo lleva en tres
columnas. No se reescriben cientos de filas contra Google por una corrección: se
marcan con `sheets_pendiente` en un solo `UPDATE` y cada una queda con su botón
de reintentar.

## La secuencia de la corrida: leer primero, controlar después

**El orden importa y no es arbitrario.** El cron y el botón hacen lo mismo y en
este orden: primero `leerLaPlanilla`, que es lo que mueve el stock; después
`controlarContraOdoo`, que mira el libro ya actualizado. Controlar un libro a
medias inventa desvíos.

Y si la lectura falla, **el control no corre**: la corrida se anota `ok: false` y
se devuelve el error. Una lectura que falla a mitad y se anota bien deja el libro
incompleto sin que nada avise.

Las dos quedan por separado en `sincronizaciones`: `carbonilla-planilla` y
`carbonilla-odoo`. Que Odoo no conteste no es una falla del stock, y mezclarlas
haría que una cosa tapara a la otra.

**`CALIDAD_DESDE` se borró el 13/10/2026** y hay que sacarla de Vercel. Existía
para que el cron de Odoo no pisara lo importado; con la planilla como fuente, una
fila marcada es una fila marcada. Una variable de entorno que ya no defiende nada
es una trampa para el próximo que la lea.

## Qué dejó la importación (16/09/2026)

| | |
|---|---|
| Movimientos | **1.049** — 615 entradas, 427 consumos, 7 ajustes |
| Por tipo | 574 vegetal · 91 residual · **385 `sin_separar`** |
| Conteos físicos | 13 |
| Sin importar | **0** |
| Saldo | vegetal **204,24** · residual **55,647** |

**El saldo recalculado arrancó en −206,26 de vegetal**, y eso no era un error: la
diferencia contra la planilla eran **283 toneladas**, literalmente la suma de lo
que se hizo pisando celdas a mano en veinte meses. El grueso es el **+232,5 del
02/05/2026**, que no está en ninguna columna — esa fila tiene `SALIDAS 55` y el
número vive sólo en el texto.

Y **no estaba repartida parejo**: el residual quedaba 128 t de más y el vegetal
410 de menos, lo que apunta al ajuste del 23/07 —*"se ajustó el sobrante de
carbón residual al stock de vegetal"*— que la planilla aplicó pisando celdas y la
importación no pudo reproducir.

**Se cerró igualando a la planilla**, a pedido y contra la recomendación, con dos
ajustes del 16/09 de `+410,50` y `−128,00`. El motivo de los dos dice de dónde
sale el número y, textual, que **no es un conteo físico**: nadie midió el carbón.
El stock arranca en lo que la planilla quedó mostrando después de veinte meses de
correcciones a mano, que es un valor **no verificado**.

La recomendación era un conteo físico, y sigue en pie: cuando alguien mida, el
conteo de `/calidad/carbonilla` calcula el desvío contra estos 204,24 y 55,647 y deja su
propio ajuste. Recién ahí el stock va a estar parado sobre una medición.

Un detalle de la planilla que quedó a la vista al hacer esa cuenta: **su propio
`TOTAL` no es la suma de sus dos columnas**. La fila 1046 dice `TOTAL` 260,337 y
`VEGETAL` + `RESIDUAL` 259,887 — **450 kilos** de desfasaje entre tres celdas del
mismo renglón. (Acá decía "cuarenta y cinco kilos", mal por diez.) Se igualó
contra las dos columnas por tipo, que son las que el SdG lleva, y el porqué está
arriba: son siempre los mismos 450 kg, de la fila 386.

Dos cosas más que la importación dejó anotadas:

- **`00014 RODRIGUES` y `00011 EL TIGRE SERGIO RODRIGUEZ` son la misma persona.**
  Las dos filas del `00014` aparean exacto contra el partner `999` de Odoo. El
  alias vive en el script y muere con él: es una deuda de la planilla vieja.
- **Las tres filas con texto en la columna del conteo se importaron como
  ajustes**, que es lo único que preserva ese texto —un consumo no puede llevar
  motivo, por el `CHECK`—. Pero el texto no siempre dice que esa fila sea un
  ajuste: en la del 23/07 la nota habla de algo que pasó el 4/7. El informe del
  script las imprime las tres para que se vea cuándo el número y el texto no
  coinciden.

## Dónde vive cada cosa

| | |
|---|---|
| El signo, los saldos y el saldo corrido | `lib/calidad/movimientos.ts` |
| El desvío del conteo y el ajuste que propone | `lib/calidad/conteos.ts` |
| **Qué filas de la planilla hay que leer, y la corrida que las lee** | **`lib/calidad/desdeLaPlanilla.ts`** |
| **Los desvíos del libro contra Odoo** | **`lib/calidad/conciliacion.ts`** |
| De una línea de Odoo a un movimiento, o a la bandeja | `lib/calidad/reconocer.ts` |
| Las once celdas de una fila de la planilla — la `K` es el id | `lib/calidad/planilla.ts` |
| De un renglón de la planilla vieja a un movimiento | `lib/calidad/importar.ts` |
| El control contra Odoo | `lib/calidad/sincronizar.ts` |
| La escritura a Google | `lib/calidad/espejo.ts` |
| Que la recepción de Despacho escriba el movimiento | `lib/calidad/desdeLaRecepcion.ts` |
| Los tres niveles de permiso | `lib/calidad/auth.ts` |
| Rutas | `app/api/calidad/{movimientos,movimientos/[id],conteos,carbonilleros,productos,sincronizar}` |
| El cron diario, 8 UTC | `app/api/cron/calidad-sync` |
| Pantallas | `app/(app)/calidad/{carbonilla,movimientos,conciliacion,carbonilleros,productos}` |
| La importación, una sola vez | `scripts/importar-stock-carbonilla.mts` |

## Lo que falta de una persona

- **El conteo físico.** Ya no bloquea —el saldo se igualó a la planilla— pero es
  lo único que va a poner el stock sobre un número medido en vez de uno heredado.
- **Borrar `CALIDAD_DESDE` de Vercel.** Ya no la lee nadie desde el 13/10/2026.
- **`GOOGLE_SHEETS_STOCK_CARBONILLA_ID` en Vercel**, en los tres entornos. En
  `.env.local` ya está, pero el 14/10 a las 08:21 una corrida falló con
  *"Falta GOOGLE_SHEETS_STOCK_CARBONILLA_ID"*, así que en al menos uno de allá
  no está. **Sin eso la lectura no corre y el stock se queda quieto sin que se
  note**, porque el libro sigue mostrando lo último que leyó.
- **`00019 AJUSTE VEGETAL` y `00020 AJUSTE RESIDUAL`** en
  `Listado articulos GRAL`, para que el espejo pueda escribir un ajuste.
- **Los 21 camiones del 04 al 15/09 que no están en Odoo.** El stock ya los tiene
  desde la planilla, pero **sin orden de compra no se les puede facturar**.
- **El CUIT de Sosa**, el único de los grandes que sigue sin enganche: 55 líneas
  y 997 toneladas en el año. No se puede leer de Odoo porque el `Sosa Pablo`
  (partner 1120) tiene el `vat` vacío. Los de Bruzzone, Puricelli, Fillia y
  Moyano se cargaron el 02/10/2026.
- **Declarar a Carbonella SRL como carbonillero.** Ya tiene CUIT y vínculo con
  Odoo, así que su recepción cierra; lo que falta es el tipo de carbón, que es
  lo único que no se deduce. Lo mismo para **La Invencible**, que trajo camiones
  en septiembre y no está ni en el núcleo ni acá.

## Riesgos asumidos

- **`sin_separar` queda en el enum para siempre**, por once meses que ya pasaron.
  Lo contiene el `CHECK` de fecha y que no caiga en ninguna suma, pero toda
  pantalla futura del módulo se lo va a cruzar.
- **El espejo pisa las fórmulas.** Si alguien las vuelve a poner, el SdG las pisa
  de nuevo sin enterarse.
- **Odoo se puede atrasar y el stock queda viejo.** Ya pasó: once días. Lo mitiga
  que la pantalla diga la fecha del último movimiento y la de la última
  sincronización, no que no pueda pasar.
- **Un peso mal tipeado en Odoo entra al stock.** El filtro de rango (`≤ 0` o
  `> 60 t`) atrapa los absurdos —la `P02304` con 38.660, que son kilos— y no los
  verosímiles.
- **Un carbonillero puede quedar sin enganchar al núcleo** indefinidamente. La
  columna lo muestra; nada lo obliga.
