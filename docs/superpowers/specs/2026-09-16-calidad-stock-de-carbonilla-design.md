# Calidad: el stock de carbonilla deja de ser una transcripción

Acordado el 15 y 16 de septiembre de 2026. Es el primer frente del módulo
**Calidad**, que nace con este diseño.

## El circuito que se quiere sacar

Llega un camión de carbonilla. Despacho lo pesa y genera en Odoo una **orden de
compra** —el spec de
[recepción de carbonilla](2026-09-11-despacho-recepcion-de-carbonilla-design.md)
cuenta ese tramo—. Después alguien transcribe ese camión a la **planilla de
recepción** (`1N5y09kg…`). Y después **Calidad lo vuelve a transcribir** a una
segunda planilla, la de **stock de carbonilla** (`1m9DwAcP…`), que es donde de
verdad se lleva cuánto carbón hay.

Dos transcripciones para el mismo camión, y la segunda es la que manda el stock
de la fábrica.

Lo que se saca es la segunda. **La entrada de stock la pone el sistema**, leída
de la orden de compra de Odoo o de la balanza del SdG, y Calidad se queda con lo
único que es suyo: el consumo del día, el conteo físico y el ajuste.

## Lo que se midió antes de diseñar (15 y 16/09/2026)

La planilla se sigue cargando todos los días, así que los números de abajo son
de esos dos días y no van a coincidir exactamente con los de hoy. Lo que no
cambia son las formas.

### La planilla de stock (`1m9DwAcPZ5OpEv5edk97ZtmeHNcOG2d4riVDk_XM4EKI`)

Cuatro pestañas; la que importa es `Entradas  Salidas` —con dos espacios—, con
`Listado articulos GRAL` de catálogo.

| | |
|---|---|
| Renglones con dato | **1.043**, del 07/01/2025 al 14/09/2026 |
| Entradas (camiones) | **612** |
| Salidas (consumos) | **430**: `CONSUMO VEGETAL` 283, `CONSUMO RESIDUAL` 82, `CONSUMO` a secas 65 |
| Días con consumo en 2026 | **224 de 256** |
| Consumo vegetal | mediana 30 t/día (1,8 a 55) |
| Conteos físicos | **34** en veinte meses, con desvíos de **−247 a +148 t** |
| Columnas | `CODIGO`, `DESCRIPCION`, `ENTRADAS`, `SALIDAS`, `TOTAL`, `VEGETAL`, `RESIDUAL`, `FECHA`, `STOCK FISICO`, `ERROR` |
| Proveedores en el catálogo | 16 códigos, con `TIPO DE CARBÓN` `VEGETAL`/`RESIDUAL` |

**`TOTAL`, `VEGETAL` y `RESIDUAL` son fórmulas por fila** que referencian la fila
anterior, y `DESCRIPCION` es un `VLOOKUP` contra el catálogo. Están precargadas
más abajo de la última fila con datos.

Las fórmulas tienen dos defectos que deciden cosas de este diseño:

- **Están cableadas a Membranex.** `RESIDUAL` sólo suma si el código es `00010` y
  sólo resta si es `00016`. Un segundo proveedor residual se contaría como
  vegetal.
- **No pueden representar un ajuste en más.** `VEGETAL` suma sólo por la columna
  `ENTRADAS` y con un código de proveedor.

### El libro tiene tres eras, no una

| | |
|---|---|
| 07/01 → 25/08/2025 | Sólo consumos. **Sin entradas y sin saldo.** No era un libro de stock todavía |
| 26/08 → 14/12/2025 | Entradas y consumos, **un solo saldo** (`TOTAL`). Acá viven los 65 `CONSUMO` a secas |
| 15/12/2025 → hoy | Los dos saldos. `VEGETAL` y `RESIDUAL` arrancan ese día en **208** y **169** |

### Los ajustes hoy se disfrazan de consumo

- El 20/04 hay un `CONSUMO VEGETAL 33` real y además un `CONSUMO VEGETAL 46` con
  la nota *"AJUSTE DE STOCK (-46 Tn.)"* escrita en la columna `STOCK FISICO`.
- El 02/05 el saldo sube de 783,59 a 961,09 con una fila de consumo 55 y la nota
  *"Ajuste por desvío cero y span balanza de carbón (232,5 tn.)"*. Ahí **alguien
  pisó la fórmula del saldo a mano**: es la fila que mejor explica por qué esta
  planilla se tiene que ir.
- El 23/07: *"Se ajustó el sobrante de carbón residual al stock de vegetal"*. Una
  operación que ni siquiera tiene columna.

Tres filas tienen **texto donde va un número**.

### Odoo

Líneas de compra con producto que nombra carbón, desde 2025-01: **1.077**, de
las cuales 1.069 en órdenes `purchase`, 7 `cancel` y 1 `draft`.

| | |
|---|---|
| Productos distintos | **12** |
| Los dos buenos | `CARBONILLA ` (id 4419, 853 líneas) y `CARBONILLA` (id 6909, 94) — **se ven idénticos y difieren en un espacio al final** |
| Los demás | `Carbonilla de coque` (5583), `Carbonilla (Archivado)` (4378), `Carbonillia` (4734), `Flete carbonilla` (4914), `Flete de Carbonilla` (4401), `97000kl de carbonilla` (5267), `CARBON RESIDUAL` (7111) |
| Unidades | 893 en Toneladas, 184 en "Unidades" — que también son toneladas |
| Empresas | Polcecal 1.055, Polysan 8 |
| Basura | `P02304` con **38.660** (son kilos) y `P02292` con **0** |

**Odoo se carga el mismo día**: 1.053 de 1.055 órdenes tienen `create_date`
igual a `date_order`; el máximo son 3 días.

**Pero Odoo está cortado.** La última orden de carbonilla es la `P02420`, del
04/09/2026. La planilla tiene **21 camiones más**, hasta el 15/09.

Y uno de esos camiones muestra el otro lado del mismo problema: el **Bruzzone de
19,58 del 04/09 está dos veces en la planilla**, y en Odoo hay una sola `P02420`
por esa cantidad. Transcribir de más y transcribir de menos son el mismo error.

### El producto de Odoo no dice el tipo de carbón

Membranex —el único residual— aparece con `Carbonilla de coque` 58 veces, con
`CARBON RESIDUAL` 4 y con `CARBONILLA ` **6**, que es el mismo producto que usan
todos los vegetales. Deducir el tipo del producto daría residual como vegetal
seis veces al año.

### El cruce planilla contra Odoo

De 612 entradas, 575 aparean por proveedor y fecha:

| | |
|---|---|
| Mismo número | **515 (90%)** |
| Distinto | **60**. Mediana del desvío 0, p90 **20 kg** |
| Sin orden en Odoo | **37** |

Los desvíos grandes no son error de balanza, son **corrimiento de
transcripción**: el 25/11 la planilla dice 20,16 y Odoo 16,86; el 26/11 la
planilla dice **16,86** y Odoo 13,74; el 28/11 la planilla dice **13,74**. La
planilla venía un camión atrasada, tres días seguidos.

### Los carbonilleros en el SdG

| | |
|---|---|
| Con rubro `CARBONILLA` | 10 |
| Vinculados a Odoo (`proveedores_odoo`) | **4** |
| **Sin CUIT cargado** | **6**, y son los que más traen: Bruzzone (302 líneas), Puricelli (192), Fillia (90), Sosa (87), Moyano, Carbonella |
| **Que no existen en el catálogo del núcleo** | `LA INVENCIBLE BORSI E HIJOS` —cinco camiones en septiembre—, `MARMOUGET`, `SANTUCHO`, `CORRALON ROJAS` y varios chicos |

Es el mismo faltante que el spec de recepción dejó anotado el 11/09 y que sigue
sin cargarse. Ya bloqueó un módulo: `despacho_recepciones` tiene **una** fila de
prueba, sin producto ni orden, y `despacho_recepcion_proveedores` está **vacía**.

## De dónde sale la entrada: de las dos, con Odoo de red

La entrada nace de la **recepción del SdG** cuando Despacho la carga ahí, y
además el SdG **sincroniza las órdenes de carbonilla de Odoo** para levantar las
que se cargaron directo en Odoo. Calidad ve un solo libro y, al lado de cada
entrada, de dónde vino.

No se eligió sólo la recepción del SdG porque la pantalla lleva cinco días sin
adopción, y no se eligió sólo Odoo porque entonces un camión pesado en el SdG
viajaría SdG → Odoo → SdG y heredaría el atraso de Odoo.

## Qué guarda el SdG

Cinco tablas: el libro, dos catálogos que se declaran a mano, los conteos y la
bandeja de lo que no se pudo reconocer.

### `calidad_movimientos` — el libro

Una fila por movimiento. Es lo que hoy es un renglón de `Entradas  Salidas`.

| Campo | Por qué |
|---|---|
| `fecha` | El día. La planilla lleva fecha, no instante, y el consumo es de un día entero |
| `tipo` | `entrada`, `consumo`, `ajuste`. **Tres, no cuatro** |
| `carbon` | `vegetal`, `residual`, `sin_separar` |
| `toneladas` | **Con signo, y el signo es siempre el efecto sobre el saldo**: entrada `+`, consumo `−`, ajuste `±` |
| `motivo` | Obligatorio en `ajuste`, prohibido en los otros. Un `CHECK`, no una costumbre |
| `carbonillero_id` | Quién trajo el camión. **Obligatorio en `entrada`**, prohibido en los otros dos |
| `proveedor_id` | El mismo camión visto desde el catálogo del núcleo. **Nullable siempre**: ver el enganche de abajo |
| `origen` | `odoo`, `recepcion`, `manual`, `importacion` |
| `odoo_purchase_line_id`, `odoo_purchase_name` | El rastro, y **la clave de idempotencia** |
| `despacho_recepcion_id` | Cuando la entrada nació de la balanza del SdG |
| `sheets_fila`, `sheets_pendiente`, `sheets_pendiente_en` | El espejo, igual que Producción y las órdenes de carga |
| `cargado_por` / `cargado_en` / `actualizado_por` / `actualizado_en` | Transcribir se equivoca, y acá ya sabemos que se equivocó |

**El signo va guardado, no despejado.** Con esto `saldo = SUM(toneladas)` y no
hay forma de calcularlo mal. La alternativa —guardar todo positivo y aplicar el
signo al leer— pone la regla en cada consulta, y la consulta que se olvida es la
que nadie mira. Lo que sí es función pura y testeada es la traducción al revés:
*"consumo de 37"* → `−37`. Un `CHECK` la respalda: entrada `> 0`, consumo `< 0`,
ajuste `<> 0`.

**No existe el tipo `reclasificación`.** El 23/07 se pasó el sobrante de residual
a vegetal, una vez en veinte meses. Son **dos ajustes con el mismo motivo** —uno
`−X` en residual, otro `+X` en vegetal— y el rastro queda idéntico. Una cuarta
operación con su propia maquinaria para un caso al año es la definición de lo
que no se construye.

**La clave de idempotencia es la línea de Odoo, no la orden.** Siete de 577
órdenes del año tienen dos líneas —la segunda es `FLETE`—, así que la orden no
identifica un camión y la línea sí. Índice `UNIQUE` **completo** sobre
`odoo_purchase_line_id`, no parcial, porque es el destino de un `ON CONFLICT`:
la trampa del README de migraciones. Los `NULL` de los consumos y los ajustes no
chocan entre sí.

### `calidad_carbonilleros` — qué proveedor es carbonillero, y de qué tipo

| Campo | Por qué |
|---|---|
| `odoo_partner_id` + `empresa_id` | **La identidad.** Es lo que trae la línea de compra |
| `proveedor_id` | Al catálogo del núcleo, **opcional**. Se completa cuando existe |
| `carbon` | `vegetal` / `residual`. **Lo único que no se puede deducir de ningún lado** |
| `nombre_planilla`, `codigo_planilla` | `BRUZZONE JUAN ALBERTO` y `00003`. Lo que el espejo escribe, no la razón social de Odoo |
| `activo` | Los que dejaron de traer no ensucian los desplegables |

**Por qué se identifica por el partner de Odoo y no por el proveedor del
núcleo.** No es rehacer el catálogo del núcleo desde un módulo: esta tabla no
guarda razón social, CUIT ni domicilio — guarda el tipo de carbón y el nombre de
planilla, que son configuración de Calidad. Lo que hace es identificarse por lo
que el dato realmente trae. Exigir que el carbonillero exista primero en
`proveedores` **con CUIT cargado y vinculado** pondría entre el camión y el
stock una tarea administrativa que hace un mes que no se hace, y que ya tiene un
módulo parado esperándola.

La pantalla del catálogo muestra en una columna **cuáles carbonilleros no están
enganchados al núcleo**: la deuda queda a la vista en vez de tapada.

### `calidad_productos_odoo` — qué producto cuenta como carbonilla

`odoo_product_id` (clave), `odoo_product_nombre` cacheado, y `cuenta` booleano.
Estar con `cuenta = true` es lo que hace que una línea entre al stock; con
`cuenta = false` es *"ya lo miré, es flete, no me lo muestres más"*.

**Se elige por id y nunca por nombre**: en esta base conviven `CARBONILLA`
(6909) y `CARBONILLA ` (4419), los dos buenos, con 947 líneas entre ambos y un
espacio de diferencia.

### `calidad_conteos` — el conteo físico

`fecha`, `carbon`, `toneladas_contadas`, `teorico_al_contar`, `ajuste_id` —el
movimiento que lo cerró, o `null` si se dejó abierto—, `notas` y auditoría.

`teorico_al_contar` **se guarda a propósito**, y no contradice la regla de no
guardar derivados: no es el saldo de hoy, es el que el sistema decía *ese día*.
Si después se corrige un movimiento viejo —y se van a corregir— el teórico de
entonces cambia, y el desvío que una persona miró y explicó dejaría de poder
reconstruirse.

### `calidad_odoo_sin_reconocer` — la bandeja

Una fila por línea de Odoo que la sincronización no pudo convertir en
movimiento, con la línea como vino y **el motivo del rechazo**. Se borra cuando
se resuelve. Son cuatro por año, pero existe como tabla para que la pantalla no
dependa de que Odoo conteste.

## La sincronización con Odoo

### Qué lee, y por qué por `create_date`

Líneas de `purchase.order.line` con la orden en estado `purchase` —los 7
`cancel` y el `draft` del año quedan afuera— y `partner_id` entre los
carbonilleros declarados.

La ventana va sobre **`create_date`, no sobre `date_order`**, y eso sale de la
medición: las órdenes se cargan el mismo día, pero el máximo son 3 días y ahora
mismo hay ocho sin cargar. Una orden fechada el 05/09 y cargada el 20/09 **la
ventana de `date_order` no la ve nunca**: se la pasa por atrás mientras el cron
avanza. Con `create_date` eso no puede pasar — la orden entra el día en que
aparece, con la fecha que dice el papel. El dominio es
`create_date >= hoy − 30 días`, el mismo margen que `facturacion-sync`: es fijo
y no depende de cuándo corrió la vez anterior, así que una corrida que se saltó
no abre un hueco.

**Y nunca mira antes de la fecha de corte de la importación** —`CALIDAD_DESDE`,
el día en que corrió el script—, que es lo que impide que el histórico importado
se duplique.

### Qué entra, qué no

Entra la línea cuyo producto está en `calidad_productos_odoo` con
`cuenta = true`. Se crea el movimiento con
`ON CONFLICT (odoo_purchase_line_id) DO NOTHING`.

Va a la bandeja, **sin tocar el stock** y con el motivo escrito:

| Motivo | Cuántos por año |
|---|---|
| Producto sin resolver — ni en la lista ni descartado | los nuevos; hoy serían `Carbonillia`, `97000kl de carbonilla`, `Carbonilla (Archivado)` |
| Proveedor de Odoo sin declarar como carbonillero | los chicos: Garelli, Scerbo, Albornoz, Cuéllar, el Gringo |
| Cantidad imposible: `≤ 0` o `> 60 t` | **2** — la `P02304` con 38.660 y la `P02292` con 0 |

Es la regla de siempre: **enlazar al que se le parece es peor que dejar en
null**.

### Lo que la sincronización nunca hace: pisar

Si una orden que ya entró al stock cambia de cantidad en Odoo, **el movimiento no
se reescribe**. Aparece en la bandeja como *"la `P02412` pasó de 16,50 a 16,60
después de haber entrado al stock"* y una persona decide. Es la misma decisión
que el spec de recepción tomó con el pesaje corregido, y por el mismo motivo: un
saldo que se mueve solo hacia atrás no se nota hasta el conteo.

### Por qué no hace falta nada más contra los duplicados

Cuando Despacho cierre una recepción, `pushRecepcion` ya crea la orden en Odoo:
sólo tiene que **leer de vuelta el id de la línea que creó** y guardar el
movimiento con ese `odoo_purchase_line_id` y `origen = 'recepcion'`. Cuando el
cron pase por esa misma línea, el `ON CONFLICT` la frena.

**Ése es todo el mecanismo.** No hay cruce por fecha, proveedor y cantidad — que
es justo el cruce que en la planilla vieja se corrió un camión tres días
seguidos en noviembre.

### Cuándo corre

Cron diario `/api/cron/calidad-sync` a las `0 8 * * *` —cinco de la mañana acá,
el hueco libre entre los cinco que ya hay— más un botón **Sincronizar ahora** en
la pantalla. Cada corrida deja su marca con `registrarSincronizacion`, **también
cuando falla**: la pantalla dice cuándo fue la última y qué dijo Odoo, sin
traducir.

## La pantalla

`/calidad` es **el stock**: los dos saldos en grande, vegetal y residual, con el
total y la fecha del último movimiento. Debajo, el libro del mes.

Un solo botón grande: **Cargar consumo del día**, porque es lo que se hace 224
días de 256. Elige tipo y toneladas; nada más. Al lado, en letra chica, *"el
último consumo cargado es del …"* — que es el aviso que sirve, en vez de un
cartel rojo los 32 días que no hubo.

El libro muestra fecha, tipo, proveedor o concepto, toneladas, saldo y
**origen** (`Odoo`, `Balanza`, `A mano`, `Importado`). El saldo corrido se
despeja al leer, con `traerTodo()` de `lib/core/paginado.ts`: son mil
movimientos por año y PostgREST corta en mil sin avisar.

Dentro de un día los movimientos se muestran en el orden en que se cargaron. El
saldo que significa algo es **el del cierre de cada día**: inventar un orden
intradiario que el circuito real no tiene sería inventar precisión.

**Contar stock** abre el conteo: vegetal y residual, el SdG muestra el desvío
contra el teórico y ofrece el ajuste por esa diferencia exacta. El motivo es
obligatorio y el ajuste queda como movimiento propio — no disfrazado de consumo,
que es lo que pasó el 20/04.

**La bandeja aparece sólo cuando tiene algo.** 361 días al año no está.

Y dos pantallas de catálogo, `soloAdmin`: **Carbonilleros** —tipo de carbón,
nombre y código de planilla, y la columna que dice cuáles no están enganchados al
núcleo— y **Productos de Odoo**, con los que llegaron sin resolver arriba.

```
Calidad
  El stock        /calidad
  Movimientos     /calidad/movimientos
  Carbonilleros   /calidad/carbonilleros    soloAdmin
  Productos       /calidad/productos        soloAdmin
```

## La importación de los veinte meses

Corre como script de una vez —`scripts/importar-stock-carbonilla.mts`, como los
de Cantera y Despacho—, no como pantalla.

**El cron nunca mira antes de la fecha de corte.** Eso, y sólo eso, es lo que
evita que el histórico importado se duplique cuando la sincronización pase por
las mismas órdenes de Odoo.

### `sin_separar`: historia, no saldo

Los once meses anteriores al 15/12/2025 se importan con `carbon = 'sin_separar'`,
porque el libro **no distinguía** los dos tipos todavía y marcarlos vegetal sería
inventar: en esa época Membranex entró más de veinte veces con carbón residual y
hubo 82 consumos residuales desde el 13/10.

La era 1 —siete meses de consumo sin un solo camión— hace que la suma de los
`sin_separar` sea un número enorme y negativo que no es el stock de nada. Por eso:

- Los dos saldos son `SUM(toneladas)` **filtrando por `carbon`**, y los
  `sin_separar` no caen en ninguno de los dos. No porque alguien se acuerde de
  excluirlos: porque no son ninguno de los dos tipos.
- El saldo inicial del 15/12/2025 —vegetal **208**, residual **169**— entra como
  **dos ajustes** con motivo *"saldo inicial según la planilla al 15/12/2025"*.
- Un `CHECK` impide que `sin_separar` aparezca con fecha posterior al corte, así
  que no puede filtrarse a datos nuevos.

El saldo único de la era 2 (26/08 → 14/12/2025) sí se puede mostrar en el
histórico, y nunca se mezcla con los dos saldos de hoy.

### Las filas rotas, con nombre y apellido

- Las **3 con texto donde va un número** se importan como ajuste con ese texto de
  motivo.
- El salto de **+232,5 t** del 02/05 se importa como un ajuste explícito con el
  motivo escrito.
- Los **34 conteos** van a `calidad_conteos`.
- El saldo recalculado **no va a dar igual** al de la planilla en esos puntos. El
  informe dice cuánto y dónde.

### La conciliación que sale gratis

El informe cruza las 612 entradas contra Odoo **como verificación, sin enlazar
nada**: 515 coinciden exactamente, 60 difieren, 37 no tienen orden. Es una
conciliación que nadie hizo nunca en veinte meses.

## El espejo de la planilla

Espejo de una sola vía: **manda el sistema**, como Producción y las órdenes de
carga.

El SdG escribe **las diez columnas con valores, fórmulas incluidas**. Es una
excepción deliberada a *"pisar una fórmula la convierte en dato muerto"*, y tiene
tres razones medidas: la fórmula de `RESIDUAL` está cableada al código `00010`,
así que un segundo proveedor residual lo contaría como vegetal; **no puede
representar un ajuste en más**, que es por qué el 02/05 alguien la pisó a mano;
y ya quedó decidido que manda el sistema. Dejarla viva sería sostener dos saldos
que discrepan.

`sheets_fila` para que una corrección reescriba la misma fila — y la importación
lo completa con la fila original de cada renglón, así los movimientos importados
nacen sabiendo dónde viven.

Si Google falla, queda `sheets_pendiente` con **lo que dijo Google sin
traducir**, y se le dice a quien hizo la acción.

**Nada se manda como texto.** Las celdas del libro guardan números, y la
escritura va con `USER_ENTERED`: un `"19,58"` lo interpreta la planilla según su
locale, que es la misma trampa que dio vuelta 885 fechas en Compras. La fecha va
como **serial** con `serialDelDia()` y las toneladas como **número**. Eso pide
ensanchar `escribirCeldas()` de `lib/core/sheets.ts` para que acepte
`string | number`, como ya hace `agregarFila()`.

## Qué se testea

Vitest sobre funciones puras, que es donde están las decisiones:

- `efectoEnElSaldo(tipo, toneladas)` — el signo, con los `CHECK` de la base como
  espejo exacto.
- `saldosDelLibro(movimientos)` — los dos saldos; que `sin_separar` no caiga en
  ninguno; y el caso feo: un ajuste que deja el saldo **negativo**, que tiene que
  verse y no bloquearse (el residual llegó a −0,47 el 19/08 y era real).
- `desvioDelConteo` — el desvío y el ajuste que propone, en una sola función
  porque son el mismo cálculo. Incluido contado igual a teórico, donde no se
  propone ajuste ninguno, y el conteo negativo, que no existe.
- `movimientoDesdeLaLineaDeOdoo` — qué movimiento sale de una línea y **los tres
  motivos de rechazo**, con los casos reales: la `P02304` de 38.660, la `P02292`
  de 0 y el `Flete carbonilla`.
- `filaDeLaPlanilla` — las diez celdas: la fecha como serial, las toneladas como
  número, el código y la descripción que le tocan a cada tipo, y el ajuste en más
  cayendo en `ENTRADAS` y el ajuste en menos en `SALIDAS`.
- `movimientoDesdeElRenglon` — la importación: las tres eras y las tres filas que
  tienen texto donde va un número.

## Las migraciones

**Dos archivos.**

1. `…_calidad_enum_del_modulo.sql`: `alter type modulo add value 'calidad'` y
   **nada más**. Un valor nuevo de enum no se puede usar en la misma transacción
   en que se agrega (`55P04`), y es la trampa que ya mordió dos veces.
   Precedentes: 015 (compras), 045 (inventario), `20260907154332` (producción),
   `20260908104728` (despacho).
2. `…_calidad_schema.sql`: los tres enums nuevos —`calidad_movimiento_tipo`,
   `calidad_tipo_carbon`, `calidad_origen`—, que sí van en el mismo archivo
   porque se crean enteros y no se les agrega nada; las cinco tablas; los
   índices; las funciones de permiso `tiene_acceso_calidad`,
   `puede_editar_calidad` y `es_admin_calidad`; y RLS, calcadas de Despacho.

El índice sobre `odoo_purchase_line_id` es **`UNIQUE` completo, no parcial**: es
el destino de un `ON CONFLICT`, y un índice parcial ahí no sirve. Si algún índice
llegara a necesitar `date_trunc('month', fecha)`, va con el cast explícito
(`fecha::timestamp`) o Postgres devuelve `42P17`.

`lib/core/access.ts` suma `calidad` a `MODULOS_ORDEN`, y `lib/core/nav.ts` el
bloque de navegación.

## Lo que falta de una persona

- **Permiso de EDITOR** para la cuenta de servicio sobre la planilla de stock.
  Hoy está compartida como lectora, y el espejo escribe.
- `GOOGLE_SHEETS_STOCK_CARBONILLA_ID` en Vercel y en `.env.local`.
- **Declarar los carbonilleros** (~16): partner de Odoo, tipo de carbón, nombre y
  código de planilla.
- **Resolver la lista blanca de productos**: `CARBONILLA ` (4419) y `CARBONILLA`
  (6909) cuentan seguro; los dos fletes no; hay que decidir `Carbonilla de coque`
  (5583), `CARBON RESIDUAL` (7111), `Carbonilla (Archivado)` (4378),
  `Carbonillia` (4734) y `97000kl de carbonilla` (5267).
- Agregar `AJUSTE VEGETAL` y `AJUSTE RESIDUAL` a `Listado articulos GRAL`.
- **Los once días de Odoo sin cargar**: los 21 camiones del 04 al 15/09 que están
  en la planilla y no en Odoo. O se cargan en Odoo, o se cargan a mano en el SdG
  con origen `A mano`. Y de paso, decidir cuál de los dos Bruzzone de 19,58 del
  04/09 es el bueno.

## Riesgos asumidos

- **`sin_separar` queda en el enum para siempre**, por once meses que ya pasaron.
  Lo contiene el `CHECK` de fecha y que no caiga en ninguna suma de saldo, pero
  toda pantalla futura del módulo se lo va a cruzar. Fue una decisión explícita:
  la alternativa era importar sólo desde el 15/12/2025.
- **El espejo pisa las fórmulas de la planilla.** Si alguien las vuelve a poner,
  el SdG las pisa de nuevo sin enterarse.
- **Odoo se puede atrasar y el stock queda viejo.** Ya pasó: ocho días. Lo mitiga
  que la pantalla diga la fecha del último movimiento y la de la última
  sincronización, no que no pueda pasar.
- **Un peso mal tipeado en Odoo entra al stock.** El filtro de rango (`≤ 0` o
  `> 60 t`) atrapa los absurdos, no los verosímiles.
- **Un carbonillero puede quedar sin enganchar al núcleo** indefinidamente, y
  entonces su carbón no se cruza con Compras ni con Facturación. La columna del
  catálogo lo muestra; nada lo obliga.

## Lo que queda afuera a propósito

- **El precio.** Como en la recepción: no se sabe cuando el camión está en la
  balanza y aparece con la factura.
- **Avisar por stock bajo.** El catálogo de la planilla tiene un
  `STOCK DE SEGURIDAD` de 200 en todas las filas, que es un valor de relleno y no
  una decisión. Si hace falta, se diseña cuando alguien diga cuál es el número.
- **Los otros frentes de Calidad** —ensayos, análisis, controles—. Este módulo
  nace con uno.
- **Conectar la balanza.** El peso se tipea, igual que en la recepción.
