# Un catálogo de productos para todo el SdG

Acordado el 10 de septiembre de 2026.

## El problema

Dos módulos describen las mismas cosas físicas con dos vocabularios distintos,
en dos tablas, y **las dos están vacías**:

| | `produccion_productos` | `despacho_productos` |
|---|---|---|
| Filas hoy | 0 | 0 |
| Vocabulario | `familia` (filler, 0_2, cal, otros) + `envase` (bolsa, bolson) | `material` × `granulometria` × `envase` |
| Quién la carga | Calidad, cuando defina la correspondencia papel ↔ Excel | Quien mapee los productos de Odoo |
| Puente | — | `produccion_producto_id`, nullable, que nadie llenó nunca |

No es sólo que usen nombres distintos: **tienen grano distinto**. La `familia`
`0_2` no dice el material, y en el libro de Despacho `Calcio 0-2 en Bolsón` son
135 órdenes y `Dolomita 0-2 en Bolsón` son 20 — dos cosas que se despachan
distinto y que ese vocabulario cuenta juntas.

Que las dos estén vacías es lo que hace que este sea el momento: **no hay una
fila que migrar**. `produccion_productos` está vacía a propósito
([PRODUCCION.md](../../PRODUCCION.md)) porque la correspondencia entre los ~15
renglones del papel y las 17 columnas del Excel no está escrita en ningún lado;
`despacho_productos`, sólo porque nadie llegó a mapear.

## Lo que se midió antes de decidir (10/09/2026)

Contra Odoo, remitos de salida de los últimos 180 días:

| | |
|---|---|
| `product.product` en la base | **432** |
| Líneas de remito de salida | 2.786 |
| Productos distintos que salieron | **49** |
| Los 26 primeros | 92% de las líneas |
| De esos 49, archivados en Odoo | **5** (40 líneas) |

Y el hallazgo que cambió el diseño: **la terna no identifica un producto.**

| Producto de Odoo | Líneas | Su terna |
|---|---|---|
| `[CEB6570] CAL EN BOLSONES CUV 65-70` | 362 | Cal · — · Bolsón |
| `[CEBPD] CAL EN BOLSONES PUESTA EN DESTINO` | 268 | Cal · — · Bolsón |
| `[CEB5560] CAL EN BOLSONES CUV 55-60` | 16 | Cal · — · Bolsón |

Son **646 líneas, el 23% de todo lo que sale**, que caerían en una sola fila. Y
CUV 65-70 contra 55-60 es una especificación de calidad, no una ortografía.

Tres cosas más que la terna no tiene dónde poner:

- **El más despachado no tiene terna.** `[ME] MINERALES ECOLOGICOS`, 379 líneas,
  el 14%. Tampoco `[BIN] BINDER` (40), `[ESD] ESTABILIZADO DE DOLOMITA` (30),
  `TOSCA`, `[Bochas] ARENA CANCHA DE BOCHAS`.
- **Las marcas son productos reales de Odoo**, no erratas del libro: `Cal Bolsa
  guemes`, `Cal Bolsa Filca guemes`, `Cal Bolsa Moreno (UNIDAD)`, `Cal guemes
  Fillerizada en Bolsas` — 161 líneas. El `Cal en Bolsa guemes` que
  [DESPACHO.md](../../DESPACHO.md) documentó como "la marca se pierde" era esto.
- **`(NA)`/`(EA)`, `(UNIDAD)`/`(TN)` y "puesta en destino"** son dimensiones
  comerciales que viven en el nombre.

Nada de esto invalida la terna: **el libro nunca supo estas distinciones** —dice
"Cal en Bolsones" para las tres CUV—, así que para el histórico la terna es todo
lo que hay y las 159 equivalencias de
`lib/despacho/equivalenciasDelHistorico.ts` siguen sirviendo tal cual. Lo que se
rompe es usarla como **clave**.

## El modelo

### `productos`, en el núcleo

Una fila por producto, **con identidad de Odoo**, y la terna como clasificación
encima.

| Campo | Por qué |
|---|---|
| `odoo_product_id` único, nullable | La identidad. Nullable porque fábrica puede hacer algo que Odoo no vende con ese nombre |
| `odoo_default_code`, `nombre` | `[CEB6570]`, `CAL EN BOLSONES CUV 65-70`. Cacheados para mostrar y buscar sin ir a Odoo, que tarda |
| `material`, `granulometria`, `envase` | La clasificación, **los tres o ninguno** (ver abajo) |
| `kg_por_unidad` | La bolsa son 25 kg. El bolsón sigue sin confirmar: null, no un número inventado |
| `activo` | Nuestro, no el de Odoo. Un producto archivado en Odoo entra inactivo |
| `cargado_por` / `cargado_en` / `actualizado_por` / `actualizado_en` | Igual que hoy en `despacho_productos` |

**Los tres o ninguno**, con un `check` en la tabla: material y envase van o
faltan juntos, y una granulometría sin material no existe. La granulometría
sigue pudiendo faltar sola —Chocolata y Pedregullo no tienen—, pero material sin
envase no es media clasificación: es una a medio cargar. El motivo no es
estético: el tipo `Clasificacion` es
`Clasificacion | null` en todo Despacho, y volverlo `material?: string` rompería
las 159 equivalencias, el texto de la planilla y los filtros del histórico. Un
producto sin clasificar se muestra con su nombre de Odoo, que es lo que la
pantalla ya hace.

### El renglón del papel, en Producción

`produccion_productos` deja de ser un catálogo y pasa a ser lo que es: **el
renglón del parte y la columna del Excel**. Se renombra a
`produccion_renglones_papel` y se queda con `nombre`, `nombre_planilla`, `orden`,
`familia` y `activo`. Pierde `envase` y `kg_por_unidad`, que son del producto
físico y se van al núcleo.

El nombre está libre: no existe ninguna `produccion_renglones`. Los renglones
cargados de un parte viven en `produccion_deposito` (lo que se produjo, por
producto) y en `produccion_despachos` (los camiones del turno).

### El puente, de muchos a muchos

`produccion_renglon_productos (renglon_papel_id, producto_id)`, clave primaria
las dos columnas.

Muchos a muchos y no una columna, por lo que se midió: si el papel cuenta "cal
en bolsón" en un solo renglón, ese renglón apunta a CUV 65-70, CUV 55-60 y
Puesta en Destino, y la suma sale bien sin que nadie tenga que elegir una y
perder dos en silencio. Una columna obligaría a elegir.

Nadie sabe hoy si el papel las cuenta juntas: eso lo define calidad, y el modelo
no lo prejuzga.

### Qué desaparece

`despacho_productos` se borra. Su trabajo se reparte: el ancla de Odoo y la
terna van a `productos`, y su `produccion_producto_id` lo reemplaza el puente.

**Tres** tablas cuelgan del catálogo de Producción, no dos:
`produccion_deposito.producto_id` —que además está **en su clave primaria**,
`(parte_id, producto_id)`— y `produccion_despachos.producto_id`. Las dos pasan a
llamarse `renglon_papel_id` y apuntan al renglón del papel, que es lo que el
capataz ve. Las tres tablas están vacías, así que es gratis: con datos, cambiar
una columna que está en la PK no lo sería.

`despacho_ordenes_carga.odoo_product_id` **no se toca**: es lo que dijo el
remito. Resuelve contra `productos.odoo_product_id`.

## La siembra: 49 filas con la terna vacía

La migración siembra los 49 productos que efectivamente salieron: id de Odoo,
código, nombre, y `activo = false` para los 5 que Odoo tiene archivados. Entran
igual porque un remito viejo los sigue nombrando, y uno de ellos —`[AC] ADITIVO
CALCAREO**`, 22 líneas— es un duplicado del `[ADCA]` activo que alguien
reemplazó.

**La terna va vacía, a propósito.** Ponerla el agente sería leer `[CEB6570] CAL
EN BOLSONES CUV 65-70` y deducir Cal · Bolsón: eso es parsear el nombre del
producto, que es exactamente lo que el módulo prohíbe y la razón de que exista
una tabla de mapeo. Lo que sí resuelve la siembra es que nadie tenga que buscar
los productos: quedan las 49 en pantalla ordenadas por volumen, y clasificar es
elegir tres valores de una lista. Las 26 primeras cubren el 92%.

No se siembran los 432: los 383 que no salieron en seis meses no son catálogo,
son ruido. El que aparezca se suma solo cuando su remito lo traiga.

## Permisos

`productos` es del núcleo: **lo lee cualquier autenticado y lo escribe quien
tenga `admin` en Producción o en Despacho**, con una función
`puede_editar_productos()`. Es el modelo de `proveedores`, que también es del
núcleo y se escribe con `puede_editar_compras()`.

No va a Administración: después de la 20260910084718 ahí quedaron tres personas,
y esto lo carga la planta.

## Pantallas

- `/despacho/productos` sigue siendo donde se clasifica contra Odoo, pero
  editando la tabla del núcleo. Ordena por volumen, como ya hace.
- `/produccion/productos` pasa a ser los renglones del papel y su enlace a
  productos.

## Qué se testea

Vitest sobre las funciones puras, que es donde están las decisiones:

- Resolver un `odoo_product_id` a su clasificación contra el catálogo nuevo.
- El "los tres o ninguno" del lado del código, antes de escribir: la ruta
  rechaza material sin envase en vez de dejar que lo haga el `check`.
- El agrupado renglón → productos que van a usar los resúmenes de Producción: un
  renglón con tres productos suma los tres.
- Las 8 pruebas de `equivalenciasDelHistorico` no se tocan: siguen devolviendo
  ternas, no productos.

## La migración

Un archivo, en este orden, y **la corre una persona** en el editor SQL de
Supabase:

1. `productos` + índices + RLS + `puede_editar_productos()`.
2. La siembra de las 49, con `on conflict do nothing` por `odoo_product_id`.
3. `drop table despacho_productos` — antes del rename, para no arrastrar su FK.
4. Renombrar `produccion_productos` a `produccion_renglones_papel`, quitarle
   `envase` y `kg_por_unidad`, y renombrar sus índices y policies.
5. Renombrar la columna `producto_id` a `renglon_papel_id` en
   `produccion_deposito` (está en su PK) y `produccion_despachos`.
6. El puente `produccion_renglon_productos` + RLS.

Un archivo y no seis porque el editor corre cada script en una transacción: si
algo falla, no queda a mitad de camino. No hay valores de enum nuevos, así que la
trampa del `55P04` no aplica.

## Lo que queda afuera a propósito

- **CUV, marca y "puesta en destino" como columnas propias.** Hoy viven en el
  nombre del producto de Odoo, que es donde el negocio las mantiene. Sacarlas a
  columnas es un relevamiento con ventas, no una migración, y hasta que alguien
  pregunte "cuánto se vendió de CUV 65-70" no hace falta.
- **El catálogo de clientes.** Sigue pendiente y sigue siendo por CUIT, no por
  nombre ([ODOO-INTEGRACION.md](../../ODOO-INTEGRACION.md)).
- **Los 1.154 artículos de Inventario.** Son repuestos e insumos con código,
  ubicación y stock de seguridad: otro dominio, no lo que la planta produce.
- **Cruzar `produccion_despachos` con las órdenes de carga.** Este spec deja el
  denominador común que ese cruce necesitaba; el cruce es su propio spec.

## Riesgos asumidos

- **La clasificación de los 49 la tiene que hacer una persona**, y hasta que la
  haga, Despacho muestra el nombre de Odoo en vez de la terna. Es visible en la
  pantalla, no silencioso.
- **El renglón del papel de Producción sigue sin definirse.** Este spec no lo
  resuelve: le da dónde vivir y un puente que admite el uno-a-varios. La lista la
  sigue debiendo calidad.
- **`nombre` y `odoo_default_code` son una copia.** Si alguien renombra el
  producto en Odoo, el catálogo queda con el nombre viejo hasta que se vuelva a
  leer. Es la misma decisión que ya tomó `despacho_productos`, y el motivo es que
  Odoo tarda: el alta con el camión esperando no puede depender de una llamada.
