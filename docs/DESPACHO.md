# Despacho — Estado del módulo

El séptimo módulo del SdG. Registra el camión **mientras está en el predio**, en
vez de transcribirlo a la mañana siguiente.

Diseño acordado:
[spec de órdenes de carga](superpowers/specs/2026-09-08-despacho-ordenes-de-carga-design.md).

## Qué reemplaza

El talonario en papel **ORDEN DE CARGA** (formulario `086/2`), con su número
preimpreso arriba a la derecha, y la planilla de Google `Órdenes de Carga`, que
se llenaba a la mañana siguiente con todas las órdenes del día anterior.

El papel tiene dos mitades y dos dueños, y eso no cambió: **administración pone
qué se lleva** (cliente, material, granulometría, envase) al emitir el remito, y
**la balanza pone cuándo pasó** (los cuatro horarios, notas, la firma del
supervisor). Lo que cambió es que la mitad de la balanza ya no se transcribe: se
marca en vivo y la planilla la escribe el sistema.

## La cadena del dato

```
ventas → pedido en Odoo → remito de Odoo ─┐
                                          ├─→ orden de carga (SdG) → planilla
                     talonario en papel  ─┘
```

Cliente, producto y cantidad **ya existían en un sistema**: están en el remito.
Lo único que no existía en ninguna parte es el vínculo entre el Nº del talonario
y ese remito, más los cuatro horarios. Eso es lo que guarda este módulo.

## Alcance de lo que está hecho

De los cinco frentes que tiene el área, está hecho **uno**: las órdenes de carga.

| Frente | Estado |
|---|---|
| Órdenes de carga | **hecho** (este spec) |
| Recepción de material | sin relevar |
| Programación del día | sin relevar |
| Stock de producto terminado | sin relevar |
| Pedidos de clientes | sin relevar |

## Las cinco decisiones que hay que conocer antes de tocar el módulo

**Los tiempos y el estado no se guardan: se despejan al leer.** `tiempo de
carga` es `fin_carga − inicio_carga`, y el estado es cuál de los cuatro horarios
falta. Es la misma decisión que Producción tomó con la producción misma, y por el
mismo motivo: un valor derivado guardado se desincroniza y nada avisa. En la
planilla esas dos columnas ya eran fórmulas.

**Manda el sistema; la planilla es un espejo de una sola vía.** Al revés que
Compras e Inventario, igual que Producción. Se escribe **al cerrar la orden**,
no en cada botón: una escritura por orden y no cuatro. Una corrección posterior
reescribe la misma fila, por `sheets_fila`.

**El remito es opcional y el enlace lo elige una persona.** Polysan deja remitos
en `draft` y `confirmed` —39 en 90 días— y el camión llega igual. Sin remito la
orden se guarda con el enlace en null y se ve que le falta. **Nunca se sugiere el
remito que se le parece**: un enlace equivocado no se nota nunca.

**El material no se parsea: se mapea.** Los tres campos del talonario están
metidos dentro del nombre del producto de Odoo (`CARBONATO DE CALCIO 0-1 BOLSÓN
(NA)`), con espacios al final y sufijos `(NA)`/`(EA)`. Una expresión regular
sobre eso es la forma segura de que un día `CAL EN TOLVA` entre como envase
Bolsa. La clasificación de cada producto la pone una persona en el catálogo
—`productos`, del núcleo, compartido con Producción desde el 10/09/2026— y lo
que falta se muestra **"sin clasificar"**.

**Los cuatro horarios se tipean** (cambiado el 11/09/2026). Hasta entonces la
pantalla tenía **un solo botón por fila** —el del próximo horario que falta— y
la hora la ponía el servidor: con un camión esperando, cuatro botones son cuatro
oportunidades de marcar el equivocado.

El argumento seguía siendo bueno y el supuesto no: **suponía que quien marca
está mirando pasar el camión**. En la práctica los horarios llegan tarde y de
gente que no está en Despacho, así que el botón obligaba a marcar "ahora" una
hora que había pasado hacía rato — y no había forma de cargar la que fue. Ahora
los cuatro son campos, se completan en cualquier orden y se corrigen tipeando
encima. Del diseño viejo queda la guía sin la obligación: **el campo del próximo
horario que falta va resaltado**.

Lo que sí se conservó es que **el navegador no manda un instante**: manda
`"HH:MM"` y lo ancla el servidor contra la fecha de la orden. La zona horaria y
el reloj de esa PC no entran en el dato, y la regla del cruce de medianoche se
aplica en un solo lugar — el mismo `instanteEnElDia` que usa el importador del
libro.

## La frontera con Producción

`produccion_despachos` ya registra camiones: son los renglones del parte de
turno, **lo que el capataz dice que cargó — el registro de fábrica**, no el
remito ni el pesaje.

**El mismo camión queda registrado dos veces, y no es duplicación.** Fábrica
cuenta bultos por turno; Despacho registra el remito y los tiempos por camión.
Son dos mediciones independientes con grano distinto, y cruzarlas es lo que va a
mostrar los desajustes — un spec futuro con valor propio.

Producción también dejó **el granel afuera a propósito**. Despacho es por donde
entra: `FILLER A GRANEL` y `CAL EN TOLVA` están entre los más despachados y un
remito son 36 toneladas.

Y `produccion_despachos.cliente_raw` sigue siendo texto libre esperando el
catálogo de `clientes` en el núcleo, que **este spec no trae** (ver abajo).

## Lo que se relevó de Odoo (08/09/2026)

Contra la base real, con las dos empresas en `allowed_company_ids`:

| | |
|---|---|
| Remitos de salida (`picking_type_code = outgoing`) | **10.027** (Polysan 5.771, Polcecal 4.256) |
| Por día | **20 a 28**, picos de 37 y 49 |
| `sale.order` | 8.516 |
| `product.template` | 432 |

Cuatro cosas que conviene no volver a averiguar:

- **El Nº de la orden no tiene dónde vivir en Odoo.** `stock.picking` tiene 121
  campos y un único campo propio de Studio, que es un many2one de otra cosa. La
  instancia es de un partner y no admite módulos propios.
- **`carrier_id` está vacío en 1.422 de 1.422 remitos.** El transportista no
  existe en ningún sistema. Medir por transportista exige empezar a capturarlo.
- **Las dos empresas numeran y validan distinto.** Polcecal emite
  `0001-00077045` y valida casi todo (552 `done`, 1 `draft` en 90 días); Polysan
  emite `Polys/OUT/05776` y deja colgado (19 `confirmed`, 20 `draft`).
- **Los productos tienen código interno** —`[FAG]`, `[CET]`, `[CC02B]`,
  `[P620]`—, que es el identificador legible del mapeo.

## Cómo está armado

| | |
|---|---|
| Estado, tiempos y próximo horario | `lib/despacho/orden.ts` |
| El catálogo, las listas, y resolver un producto de Odoo | `lib/core/productos.ts` (núcleo) |
| De dónde saca su clasificación una orden, y la celda `Material` | `lib/despacho/clasificacion.ts` |
| La columna `Material` del histórico, texto por texto | `lib/despacho/equivalenciasDelHistorico.ts` |
| La planilla: fila, horas, fechas | `lib/despacho/planilla.ts` |
| El espejo de una sola vía | `lib/despacho/espejo.ts` |
| Importador del histórico (parseo) | `lib/despacho/importar.ts` |
| Promedios e indicadores | `lib/despacho/indicadores.ts` |
| Lecturas (con `traerTodo`) | `lib/despacho/consultas.ts` |
| Remitos y productos de Odoo | `lib/despacho/odoo.ts` |
| Permisos | `lib/despacho/auth.ts` |
| Filtros del histórico en la URL | `lib/despacho/filtrosUrl.ts` |
| Movimientos diarios (la pantalla de la balanza) | `app/(app)/despacho` |
| Histórico e indicadores | `app/(app)/despacho/ordenes` |
| Clasificar el catálogo | `app/(app)/despacho/productos` |
| Rutas | `app/api/despacho/{ordenes,ordenes/[id],remitos,productos,importar}` |
| Importador del histórico (script) | `scripts/importar-despacho.mts` |
| Comparar planilla contra base | `scripts/comparar-despacho.mts` |
| Diagnóstico de punta a punta | `scripts/probar-despacho.mts` |
| Migraciones (las cuatro **corridas**) | `20260908104728_despacho_enum_del_modulo.sql`, `20260908104729_despacho_schema.sql`, `20260909090003_despacho_la_planilla_es_una_pestana_por_mes.sql`, `20260909095546_despacho_la_planilla_no_dice_de_que_empresa_es.sql` |
| Migración del catálogo único (**pendiente de correr**) | `20260910104534_productos_el_catalogo_unico_del_nucleo.sql` |

## Lo que se relevó de la planilla (09/09/2026)

El spec se escribió sin poder abrir el libro y dejó dos supuestos declarados.
**Los dos eran falsos.** Se leyó con la cuenta de servicio desde local —las
credenciales de Google sí están en `.env.local`— y esto es lo que hay:

| | |
|---|---|
| Pestañas | **seis, una por mes**: `ABRIL 2026` … `SEPTIEMBRE 2026` |
| Órdenes | **1.714**, todas con Nº de orden |
| Textos distintos en `Material` | **201** |
| Nº de orden repetidos | **12** |
| Renglones cuya fecha no es del mes de su pestaña | **5** |

### No es una hoja: es una pestaña por mes

La pestaña **se despeja del mes de la orden** (`pestanaDelMes`), no se guarda ni
se configura: `GOOGLE_SHEETS_DESPACHO_TAB` quedó sin uso. Y eso obligó a la
migración `20260909090003`: el índice único sobre `sheets_fila` estaba mal,
porque la fila 45 de abril y la de mayo son dos órdenes distintas. Ahora el único
es por `(mes de la orden, fila)`.

El 1º de cada mes la pestaña nueva **no existe todavía**, así que el espejo la
crea copiando los encabezados de la anterior. Sin eso, el módulo dejaría de
escribir el primer día del mes y nadie se enteraría hasta fin de mes.

### `Tiempo de Carga` y `Tiempo en Predio` sí son fórmulas — a veces

Son `=F2-E2` y `=H2-G2` en abril, mayo, junio y julio, y **están vacías en agosto
y septiembre**: alguien no las arrastró. Así que hace dos meses la planilla no
muestra los tiempos que promete.

El espejo sigue escribiendo sólo `A:I` y no las toca: pisar una fórmula la
convierte en dato muerto. Devolverlas es arrastrarlas en la planilla, una vez.
De paso, esas fórmulas confirmaron el mapeo de columnas que el spec había
deducido del orden de los encabezados.

### La columna `Material`: 201 textos para quince cosas

`Filler a granel` aparece como `Filler a granel`, `filler a granel`,
`filller a granel`, `filer a granel` y `filler agranel` — **620 órdenes en cinco
ortografías**. Lo mismo `Cal en Bolsones` / `cal en bolson` / `cal en bolsones`.
Las granulometrías van como `02`, `0-2`, `01`, `0-1`, `200`, `1/2` y `1-2`.

Dos consecuencias. Una: **mapear en vez de parsear era la decisión correcta, y
por más margen del que suponía el spec** — ninguna expresión regular sobrevive a
esto. La otra: el módulo entrega algo que no estaba escrito, que es que la
columna pase a ser un dato clasificado y filtrable.

**De acá en más el sistema escribe la forma del libro con una sola ortografía**
(`textoParaLaPlanilla`): `Filler a granel`, `Cal en Bolsones`,
`Calcio 0-2 en Bolsones`, `Filler en Tolva`. Se eligió la del libro y no la del
sistema porque la planilla la sigue leyendo gente que tiene cinco meses de
historia arriba. Y apareció **Dolomita**, que el talonario no tiene: entró a la
lista de materiales.

### Hay celdas con el dato escondido por el formato

Varios renglones tienen la fecha cargada —el serial `46273`— y un formato de
número que la muestra **vacía**. Eso decide dos cosas:

- **El importador lee `sinFormato`**, o esas órdenes se perderían por "no tienen
  fecha". Medido: así entran las 1.714, con 0 salteadas.
- **`agregarFila` busca la última fila por la columna `B`, no la `A`.** Esa
  lectura pide el texto formateado, así que por la `A` la hoja parecería terminar
  antes y la escritura pisaría renglones cargados. Por eso `agregarFila` del
  núcleo ahora acepta qué columna manda.

### Los encabezados no se llaman igual en todas las pestañas

La columna de fecha es `Fecha`, `Fecha Orden` o `Fecha Orden de carga` según el
mes, y varias tienen espacios de más (`Hora Salida  de carga ` con dos). El
importador las busca **normalizadas y con alternativas**, y las columnas que no
son imprescindibles pueden faltar: exigir las nueve perdía las doscientas órdenes
de una pestaña a la que le faltara `Observaciones`.

## Lo que falta

### `GOOGLE_SHEETS_DESPACHO_ID` ya está cargada (09/09/2026)

`1jF2lqDn_9H_BRQ8TQFNopfappOPyMGCQwFsGkWSkonM`, en `.env.local` y en Vercel
(Production, proyecto `sistema-integral`). El libro ya está compartido con
`sheets-reader@mantenimientopp.iam.gserviceaccount.com`.

Sin la variable **el espejo no escribe** y cada orden que se cierre queda con
`sheets_pendiente`, que es el comportamiento buscado y se ve en el Inicio y en la
pantalla de movimientos diarios — pero la planilla se queda sin esas órdenes. Por eso conviene saber
las dos cosas que aparecieron al cargarla:

- **`vercel env ls` dice que la variable existe y no dice qué tiene adentro.**
  Las de este proyecto están guardadas como *sensitive*, así que `vercel env pull`
  las devuelve **todas en `""`** —incluida `NEXT_PUBLIC_SUPABASE_URL`, que en
  producción evidentemente no está vacía—. O sea que "está en el listado" no es
  prueba de que esté cargada. Ésta se volvió a escribir con `--force
  --no-sensitive`, que es lo correcto acá porque el id del libro no es un secreto
  (está en este documento), y ahora se puede verificar leyéndola de vuelta.
- **Un cambio de variable no lo toma el deploy que ya está corriendo.** Vercel
  las fija al construir, así que hay que redeployar producción para que el espejo
  empiece a escribir. Mientras no se redeploye, el síntoma es exactamente el de
  la variable faltante: órdenes con `sheets_pendiente`.

### Dar el módulo a alguien

**Administración → Usuarios**, módulo `despacho`: `edicion` para la balanza,
`admin` para el mapeo de productos y el importador.

### Clasificar los 49 productos del catálogo

`despacho_productos` **ya no existe**: el catálogo es uno solo y del núcleo
(`productos`), compartido con Producción — ver
[el spec](superpowers/specs/2026-09-10-productos-catalogo-unico-design.md). Viene
**sembrado con los 49 productos que salieron en 180 días**, con la terna vacía a
propósito: deducirla del nombre del producto sería parsear.

Así que toda orden que se cargue desde la balanza va a arrancar "sin clasificar"
hasta que alguien le ponga la terna en `/despacho/productos`, que ordena la lista
por cuántas órdenes de carga usaron cada producto. **Las 26 primeras cubren el
92%** de lo que sale, así que es una tarde. Y algunos van a quedar sin terna para
siempre y está bien: `MINERALES ECOLOGICOS` —el más despachado de todos, 379
líneas de remito— no es material × granulometría × envase, igual que `BINDER` y
`TOSCA`.

El histórico no depende de eso: se clasifica por texto, ver abajo.

**Y conviene hacerlo antes de la primera orden real, no después.** `producto_raw`
guarda el nombre del producto de Odoo (`CAL EN BOLSONES CUV 65-70`), y mientras
ese producto no tenga terna, `filaDeLaPlanilla` cae a ese texto para la celda
`Material`. O sea que una orden de un producto sin clasificar escribe en la
planilla el vocabulario de Odoo, en la misma columna que tiene cinco meses del
vocabulario del libro (`Cal en Bolsones`) — justo la divergencia de formas que
este módulo decidió terminar. Con el producto clasificado escribe
`textoParaLaPlanilla`, que es la forma del libro.

Ojo con quién puede: la pantalla pide **`admin` en el módulo**, y la balanza
tiene `edicion` (`despacho@polcecal.com`, asignado el 10/09/2026). Así que
clasifica un `admin_sistema`, o hay que subirle el nivel a quien lo vaya a
hacer.

## El histórico ya está importado (09/09/2026)

**1.702 órdenes**, de abril a septiembre de 2026. Se corrió
`npx tsx scripts/importar-despacho.mts --escribir`, que hace lo mismo que
`POST /api/despacho/importar` y con las mismas funciones — la ruta pide una sesión
de admin en el navegador, el script se resuelve con el service role. Los dos son
idempotentes (`ignoreDuplicates` por `numero`), así que volver a correrlos sólo
agrega lo que falte.

Cómo quedó, medido contra la base:

| | |
|---|---|
| Órdenes | **1.703** (1.714 filas leídas, 0 salteadas, 12 Nº repetidos, más `12034-2`) |
| Con los cuatro horarios | 971 |
| Sin salida del predio | 345 |
| Sin ningún horario | 52 |
| Con `sheets_fila` | 1.697 |
| Con `empresa_id` | 0 — la planilla no la tiene |
| Con `cargado_por` | 0 — nadie las cargó en el sistema |

### Las 345 sin salida del predio no son una alarma

Y eso hubo que resolverlo: los movimientos diarios muestran arriba las órdenes abiertas de
días anteriores, así que sin filtro habría abierto con **345 filas rojas** y el
Inicio habría avisado 345. Ninguna de ésas es un olvido accionable — la planilla
nunca tuvo esa hora.

Por eso las dos consultas cuentan **sólo las que nacieron en el sistema**
(`cargado_por` no nulo): `traerOrdenesAbiertasAnteriores` y `resumenDespacho` en
`app/api/home/resumen/route.ts`. Verificado contra la base: 345 sin el filtro, 0
con él. `cargado_por` es exactamente lo que distingue una fila importada de una
cargada en la balanza, y por eso el importador lo deja en null a propósito.

### Dos renglones del libro para revisar a mano

El importador no los toca, porque corregirlos sería inventar un dato. Están en la
salida del script, con pestaña y fila:

| Pestaña | Fila | Nº | Dice | Debería estar en | Cliente |
|---|---|---|---|---|---|
| `JUNIO 2026` | 5 | 12507 | 2026-05-30 | `MAYO 2026` | arrimati |
| `JULIO 2026` | 36 | 12857 | 2026-06-26 | `JUNIO 2026` | jefesa |

Entraron con `sheets_fila` en null a propósito: con la fila guardada, una
corrección reescribiría la fila 5 de la pestaña equivocada y pisaría una orden
ajena. Con la fila vacía, la corrección agrega un renglón — molesto pero visible.

También hay **12 Nº de orden repetidos** en la planilla —12034, 12201, 12238,
12375, 12507, 12502, 12512, 12928, 13040, 13280, 13644, 13706—; el Nº del
talonario tiene que ser único, y el importador se queda con el primero y los
cuenta. Uno ya se resolvió en el libro renombrándolo `12034-2`, y entró como una
orden más.

(Los dos años mal tipeados que tenía el libro —Nº 13094 en 2006 y Nº 13223 en
2023— ya se corrigieron en la planilla el 09/09 y se bajaron a la base.)

### Si la planilla se corrige después de importar

`ignoreDuplicates` por `numero` significa que una fila corregida **en la planilla
después** de importarla no vuelve a entrar: la base se queda con el valor viejo
y nada avisa. Ya pasó el mismo día del import, con esos dos años.

Para eso está `scripts/comparar-despacho.mts`, que dice en qué difieren y con
`--corregir` pisa la base con la planilla. Corrige también `sheets_fila`, que
cambia cuando una fila se mueve o cuando su fecha pasa a coincidir con la
pestaña.

No es una sincronización y no debe volverse una: de acá en más **manda el
sistema**. Es la herramienta del rato en que todavía se está acomodando el
histórico.

## El histórico ya está clasificado (10/09/2026)

Faltaba algo que el documento no decía y que sale de mirar la base: **las 1.703
órdenes importadas tienen `odoo_product_id` en null**, las 1.703. Vinieron de la
planilla, no de un remito. Y `clasificacionDe` mapea por producto de Odoo, así
que la pantalla de mapeo —por más que se carguen los 432 productos— **no iba a
poder clasificar el histórico nunca**. No era "todavía no lo mapearon": era un
camino que no llegaba.

Así que se hizo la tabla por texto que este documento pedía:
`lib/despacho/equivalenciasDelHistorico.ts`, **159 textos exactos → 34
clasificaciones**. Medido contra la base: **1.649 de 1.703 órdenes clasificadas,
el 97%**.

| | |
|---|---|
| Filler a granel | 640, en 23 ortografías |
| Cal en Bolsones | 363, en 18 |
| Filler en Tolva | 150 |
| Calcio 0-2 en Bolsones | 135 |
| Cal en Bolsa | 91 |
| …otras 29 clasificaciones | 270 |

`clasificacionDeLaOrden()` es la que elige el camino, y el orden es la decisión:
**primero el mapeo de Odoo, que es un dato; el texto sólo si no hay**, porque es
una interpretación. Al revés, una orden con remito quedaría clasificada por lo
que alguien tipeó a mano.

Tres cosas que conviene saber:

**La tabla busca por texto exacto y está congelada.** No hay una función que
normalice antes de buscar, a propósito: eso sería otra decisión invisible, y acá
lo que se revisa es qué se convierte en qué. Por eso hay entradas casi iguales
—`Calcio 02  en Bolsones` con dos espacios es una clave propia—. Y no va a
crecer: el histórico está cerrado y de acá en más el sistema escribe la columna
con una sola ortografía.

**Ahora corregir una orden importada reescribe su celda `Material` con la forma
canónica**, no con el texto crudo que tenía. Antes caía a `producto_raw` porque
no había clasificación. Es la decisión que ya estaba tomada —una sola ortografía
de acá en más— aplicada a los renglones viejos que se toquen; los que nadie
toque quedan como están.

**La marca de la bolsa se pierde.** Las ~18 órdenes de `Cal en Bolsa guemes` y
`Cal moreno en Bolsa` entran como Cal en Bolsa. El material y el envase son los
correctos, pero la marca no es ninguno de los tres campos del talonario, así que
no tiene dónde ir. Si importa, es una columna nueva y no una clasificación.

### Las 54 que quedan sin clasificar, y por qué

No es lo que no se pudo: es lo que no se debe.

| Cuántas | Qué son |
|---|---|
| 13 | La celda viene vacía (12) o dice `-` (1) |
| 11 | Traen **dos granulometrías**: `Calcio 200 Bolsa + 01 en BOlsones`, `Calcio 01 y7 02 en Bolsones` |
| 9 | Traen **dos materiales**: `Calcio + Dolomita 02 bolsa`, `calcio magnesio 0-2 en bolsa` |
| 8 | No nombran un producto: `Arena`, `muestra`, `binder`, `3 rollos de membrana`, `pallet de cale`, `10 bolsas`, `40 Bolsas de cal guemes`, `bolsas de cal y de Dolomita` |
| 1 | Dos envases: `dolomita 02 en Bolsones + 02 en Bolsa` |
| 12 | Erratas o textos incompletos que **una persona puede confirmar** (abajo) |

Las de dos productos son el límite del modelo, no de la tabla: una orden tiene
una clasificación, y el camión llevó dos cosas. Representarlas exige renglones
por orden, que es otro spec.

**Los doce para confirmar**, que se dejaron afuera a propósito porque
escribirlos sería inventar el dato:

| Texto | Lo que parece | Por qué no se escribió |
|---|---|---|
| `calk en bolsones`, `Calk en bolsones`, `Cak en bolsones`, `cxal en bolson` | Cal en Bolsones | Son cuatro órdenes con `cal` mal tipeado, pero `cal` y `calcio` están a una letra y la tabla no adivina entre dos materiales |
| `fillerba granel`, `filklere a granel`, `filler a grael`, `filler a grranel` | Filler a granel | Igual, y acá el material no tiene con qué confundirse: son las más seguras de las doce |
| `Filler` (sola) | Filler ¿en qué? | No dice envase, y el filler sale a granel, en tolva y en bolsón |
| `calcio 1/2` | Calcio 1-2 ¿en qué? | Lo mismo |
| `cal #200 en bolson` | ¿Calcio #200 en Bolsón? | En las ~516 órdenes de Cal del libro la Cal **nunca** lleva granulometría, y `Calcio 0-2 en Bolsón` tiene 135 precedentes |
| `Cal 02 en Bolson` | ¿Calcio 0-2 en Bolsón? | La misma duda que la anterior |

Confirmadas, son doce líneas más en la tabla y doce órdenes menos sin
clasificar. Sin confirmar, se ven "sin clasificar" en la pantalla y la planilla
les sigue mostrando su texto crudo, que es el comportamiento correcto.

## Lo que encontró probar el módulo (09/09/2026)

Se probó de punta a punta con `scripts/probar-despacho.mts` (lectura) y una
escritura de prueba en la fila vacía del final, verificada y borrada. Anduvo
todo: la pestaña del mes, la fila que elige la columna `B`, y **los cuatro
horarios en su columna** —`E`/`F` la carga, `G`/`H` el predio—, que es la trampa
que más fácil pasa desapercibida. `J` y `K` no se tocaron.

Y salieron dos defectos, los dos medidos contra la base:

### La lista de remitos era de un día y tenía que ser una ventana

`remitosDelDia` filtraba por `scheduled_date` del día. Pero **131 de 1.383
remitos tienen `scheduled_date` de un día distinto al de su creación** (105 de
Polysan, 26 de Polcecal): uno de cada diez camiones no habría encontrado su
remito en la lista, y el encargado lo habría cargado "sin remito" teniendo el
papel en la mano.

Ahora es `remitosParaElAlta`, con una ventana de **siete días más el siguiente**
—ese último para el remito que administración emite por adelantado—, los más
nuevos primero. Son ~84 remitos, así que la pantalla del alta ganó un buscador
que **filtra en memoria**: Odoo tarda y el camión está esperando.

El rango se calcula en `rangoDeLaVentana`, que es pura y tiene tests, porque ahí
viven dos corrimientos que no fallan cuando están mal — devuelven la lista de
otro día.

### La regla del cruce de medianoche convertía errores en permanencias de 25 h

`parsearHoraDePlanilla` sumaba un día ante **cualquier** horario que cayera antes
del anterior. Con eso, una salida anotada cinco minutos antes del fin de carga
—un error de tipeo— pasaba a ser una permanencia de 23 h 55. **250 de las 1.702
órdenes importadas quedaron con tiempos absurdos**, y los absurdos positivos se
promedian sin que nada avise, al revés de un negativo, que se muestra en rojo.

La regla nueva: **gana la interpretación que da la duración más corta**, o sea
que se suma un día sólo cuando el salto hacia atrás pasa las 12 horas. No es un
umbral a dedo — se midieron los 394 saltos hacia atrás del libro y están
partidos en dos grupos con el valle justo ahí: 234 de menos de dos horas (tipeo)
y 106 de más de doce (cruces reales).

Después de corregir, contra la base: **de 250 tiempos absurdos a 29**, y las 41
órdenes que quedan en negativo se ven en rojo, que es lo que hay que ver.
Medianas: 60 minutos de carga, 84 en predio.

### Y una advertencia de operación

La API de Sheets corta a los ~60 pedidos de lectura por minuto y por usuario.
`importar-despacho` y `comparar-despacho` leen las seis pestañas cada vez, así
que correrlos varios veces seguidos devuelve un `429`. No es un error del
módulo: hay que esperar el minuto.

## Lo que queda para specs propios

- **El catálogo de `clientes` en el núcleo.** Producción lo está esperando. Son
  más de 3.000 `res.partner` en dos empresas y el cruce va **por CUIT (`vat`),
  no por nombre**: la lección de los 147 CUITs duplicados de
  [ODOO-INTEGRACION.md](ODOO-INTEGRACION.md).
- **Los otros cuatro frentes del área**: recepción de material, programación del
  día, stock de producto terminado y pedidos de clientes.
- **Cruzar con `produccion_despachos`** para ver los desajustes entre lo que
  fábrica dice que cargó y lo que salió con remito.
- **El pesaje.** El puesto es la balanza y el peso no está en el papel, ni en la
  planilla, ni en el remito más allá de la cantidad pedida.
- **Que la orden nazca en administración** y el sistema imprima el papel,
  jubilando el talonario. Es el destino natural, pero toca el hábito de otra
  área.
- **Confirmar las doce erratas** que la tabla de equivalencias dejó afuera (ver
  más abajo). Es mirar doce renglones, no un spec.
