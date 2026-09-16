# Carbonilla — el stock deja de ser una transcripción

Diseñado y construido el 15 y 16 de septiembre de 2026. Es la otra mitad de
Calidad; la de envases está en [CALIDAD-ENVASES.md](CALIDAD-ENVASES.md) y **va
para el lado contrario**, así que conviene saber en cuál se está parado antes de
tocar una ruta.

El diseño está en
[el spec](superpowers/specs/2026-09-16-calidad-stock-de-carbonilla-design.md) y
el paso a paso en
[el plan](superpowers/plans/2026-09-16-calidad-stock-de-carbonilla.md). Acá
quedan las decisiones y las trampas que no se deducen del código.

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
`/calidad/carbonilleros`, que dice `falta` en nueve de trece. El stock funciona
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

## Lo único que evita los duplicados: `odoo_purchase_line_id`

Una entrada llega por dos caminos —la sincronización con Odoo y la recepción de
Despacho— y **los dos guardan el id de la línea de la orden de compra**. El
índice `UNIQUE` frena al segundo.

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

## La secuencia: importar y después sincronizar

**La importación corre antes que el cron, y no al revés.** El cron nunca mira
antes de `CALIDAD_DESDE`, que es el día en que corrió el script; mientras el
libro esté vacío, la sincronización lee 45 líneas de Odoo y escribe **cero**, y
eso es correcto, no una falla.

Adelantar el corte para que la sincronización "haga algo" antes de importar deja
a los camiones que están en la planilla y todavía no en Odoo **fuera de los dos
lados**: el 16/09 eran 21 camiones, unas 400 toneladas.

## Qué dejó la importación (16/09/2026)

| | |
|---|---|
| Movimientos | **1.047** — 615 entradas, 427 consumos, 5 ajustes |
| Por tipo | 572 vegetal · 90 residual · **385 `sin_separar`** |
| Conteos físicos | 13 |
| Sin importar | **0** |
| Saldo | vegetal **−206,26** · residual **183,65** |

**El saldo arranca negativo y es lo esperado.** La diferencia contra los 260,34
que mostraba la planilla son **283 toneladas**, y son literalmente la suma de lo
que se hizo pisando celdas a mano en veinte meses. El grueso es el **+232,5 del
02/05/2026**, que no está en ninguna columna: esa fila tiene `SALIDAS 55` y el
número vive sólo en el texto.

Se decidió no inventarlo: el stock arranca en lo que está registrado y **se cierra
con un conteo físico**, que deja el ajuste con su motivo escrito. Un saldo
negativo se ve —la pantalla lo muestra en rojo— y no se corrige solo.

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
| De una línea de Odoo a un movimiento, o a la bandeja | `lib/calidad/reconocer.ts` |
| Las diez celdas de una fila de la planilla | `lib/calidad/planilla.ts` |
| De un renglón de la planilla vieja a un movimiento | `lib/calidad/importar.ts` |
| La corrida contra Odoo | `lib/calidad/sincronizar.ts` |
| La escritura a Google | `lib/calidad/espejo.ts` |
| Que la recepción de Despacho escriba el movimiento | `lib/calidad/desdeLaRecepcion.ts` |
| Los tres niveles de permiso | `lib/calidad/auth.ts` |
| Rutas | `app/api/calidad/{movimientos,movimientos/[id],conteos,carbonilleros,productos,sincronizar}` |
| El cron diario, 8 UTC | `app/api/cron/calidad-sync` |
| Pantallas | `app/(app)/calidad/{,movimientos,carbonilleros,productos}` |
| La importación, una sola vez | `scripts/importar-stock-carbonilla.mts` |

## Lo que falta de una persona

- **El conteo físico**, que es lo que cierra las 283 toneladas.
- **`CALIDAD_DESDE`** en Vercel, con `2026-09-16`. En local ya está.
- **`GOOGLE_SHEETS_STOCK_CARBONILLA_ID`** en Vercel y en `.env.local`, más
  **permiso de EDITOR** para la cuenta de servicio sobre la planilla: hoy está
  compartida como lectora. Hasta entonces el espejo está apagado y cada
  movimiento nuevo queda con `sheets_pendiente` y su botón de reintentar.
- **`00019 AJUSTE VEGETAL` y `00020 AJUSTE RESIDUAL`** en
  `Listado articulos GRAL`, para que el espejo pueda escribir un ajuste.
- **Los 21 camiones del 04 al 15/09 que no están en Odoo.** El stock ya los tiene
  desde la planilla, pero **sin orden de compra no se les puede facturar**.
- **Los CUIT de nueve carbonilleros.** Bruzzone, Puricelli, Sosa y Fillia son los
  que más traen.

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
